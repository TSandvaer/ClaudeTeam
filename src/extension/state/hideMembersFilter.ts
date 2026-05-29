/**
 * hideMembersFilter — post-reducer projection that suppresses rostered tiles
 * whose `(teamId, memberId)` is in the user's persisted hidden-member set
 * (E-06a / EPIC 86ca11187 §7.2 — reversible hide-agent).
 *
 * Sibling of `hideFinishedFilter.ts` / `hideIdleFilter.ts`. All three apply at
 * `buildAgentTree` exit / `serializeState` entry — NOT inside the reducer.
 * Keeping classification (reducer) and presentation (these filters) separate
 * means the filters can be flipped without invalidating the cached agent tree,
 * and each pass produces BOTH the filtered tree AND the wire count in one walk.
 *
 * ## Crucial difference from the state-driven siblings
 *
 * `hideIdle` / `hideFinished` suppress by tile *state* (transient, recomputed
 * every tick from filesystem signals). This filter suppresses by an EXPLICIT,
 * PERSISTED user decision keyed to a roster member — it is INDEPENDENT of the
 * tile's state. A hidden member stays hidden whether it is running, idle,
 * finished, available, or error. There is NO code path here (or anywhere) that
 * adds to the hidden set based on time / inactivity — sponsor REJECTED
 * auto-hide (DECISIONS §36 / spec §11). `applyHideMembersFilter` only ever
 * READS the supplied set; the set's contents are mutated solely by explicit
 * `ui:hide-member` / `ui:show-member` / `ui:show-all-hidden` user actions
 * (see `src/extension/state/hiddenMembersStore.ts`). This separation is what
 * the AC4 regression-guard test asserts.
 *
 * ## Filter rules (mirror the sibling filters; predicate is set-membership)
 *
 *   - When the hidden set is EMPTY: identity transform — return the input tree
 *     unchanged AND `hiddenMemberCount: 0`. Referential identity preserved
 *     (`result.tree === input`). (Note: `hiddenMemberKeys` on the wire is set
 *     by the caller from the store, NOT by this filter — see the watcher loop;
 *     this filter only owns the suppression + the suppressed-this-tick count.)
 *   - When the hidden set is non-empty:
 *     • Each session's `rosterTiles[teamId]` is walked.
 *     • Bare `AgentTile` whose `(teamId, memberId)` is in the set → dropped;
 *       counter ++.
 *     • `CollapsedPersonaGroup`: every instance shares one `memberId` (the
 *       reducer groups by `memberId` — see `reducer.ts` § collapseByPersona),
 *       so the wrapper is hidden as a UNIT when that member is hidden. Drop the
 *       whole wrapper; counter += `instances.length` (each suppressed instance
 *       counts once, consistent with the sibling filters' per-instance count).
 *       Defensive: should a future grouping ever mix memberIds, the per-instance
 *       walk below still drops only the hidden ones and rebuilds survivors with
 *       the same N=0→drop / N=1→unwrap / N>=2→keep-wrapper shape contract as the
 *       sibling filters.
 *     • If a team's tile list becomes empty after filtering, the team key is
 *       removed from `rosterTiles` AND `teamOrder` (matches sibling behavior —
 *       sessionBlock omits empty teams).
 *     • Background agents are NEVER filtered (they are unrostered — no
 *       member id to hide; the per-session count chip already collapses them).
 *
 * The function does NOT mutate its input; a new tree is allocated when the set
 * is non-empty. Pure / cheap — safe to call on every tick.
 *
 * Source: `team/iris-ux/whole-team-display-spec.md` §7.2 + §9.3.
 */

import {
  hiddenMemberKey,
  isCollapsedPersonaGroup,
  type AgentTile,
  type AgentTree,
  type CollapsedPersonaGroup,
  type HiddenMemberKey,
  type RosterTileEntry,
  type SessionTree,
} from "../../shared/types.js";

/**
 * Result of applying the hide-members filter to an `AgentTree`.
 *
 * `tree` — either the input ref (when the set is empty — identity transform)
 * or a newly-allocated tree with hidden members suppressed.
 *
 * `hiddenMemberCount` — total tiles suppressed across all sessions THIS TICK.
 * Always >= 0. When the set is empty, always 0. NOTE this is the number of
 * tiles actually dropped this tick (a hidden member with no live tile in any
 * surfaced session contributes 0), which can differ from the size of the
 * persisted hidden set — the chip's "N hidden" uses the persisted-set size via
 * `hiddenMemberKeys.length`, not this tick-local count. This count is the
 * "how many tiles did I just suppress" diagnostic.
 */
export interface HideMembersResult {
  tree: AgentTree;
  hiddenMemberCount: number;
}

/**
 * Apply the hide-members filter to an agent tree.
 *
 * Pure function — does not mutate its input. When `hiddenSet` is empty, returns
 * the input ref directly (identity transform) so callers can skip downstream
 * work when nothing is hidden.
 *
 * @param tree       Input tree (typically after the hide-finished / hide-idle
 *                   filters have already run — order is irrelevant since the
 *                   predicates are disjoint, but keep a deterministic sequence).
 * @param hiddenSet  The persisted hidden-member set as `HiddenMemberKey`
 *                   strings. The filter only READS it — never mutates it, never
 *                   adds to it. (Auto-hide is forbidden; AC4.)
 * @returns          Filtered tree + count of tiles suppressed this tick.
 */
export function applyHideMembersFilter(
  tree: AgentTree,
  hiddenSet: ReadonlySet<HiddenMemberKey>,
): HideMembersResult {
  if (hiddenSet.size === 0) {
    // Identity transform — no allocation, no walk.
    return { tree, hiddenMemberCount: 0 };
  }

  let hiddenMemberCount = 0;

  const sessions: SessionTree[] = tree.sessions.map((session) => {
    const newRosterTiles = new Map<string, RosterTileEntry[]>();
    const newTeamOrder: string[] = [];

    for (const teamId of session.teamOrder) {
      const entries = session.rosterTiles.get(teamId);
      if (!entries) continue;

      const survivors: RosterTileEntry[] = [];
      for (const entry of entries) {
        if (isCollapsedPersonaGroup(entry)) {
          // Walk instances; drop hidden ones; rebuild wrapper. In practice
          // every instance shares one memberId so the wrapper is all-or-none,
          // but the per-instance walk keeps the contract robust.
          const keptInstances: AgentTile[] = [];
          for (const inst of entry.instances) {
            if (hiddenSet.has(hiddenMemberKey(inst.teamId, inst.memberId))) {
              hiddenMemberCount += 1;
            } else {
              keptInstances.push(inst);
            }
          }
          if (keptInstances.length === 0) {
            continue; // wrapper drops entirely
          }
          if (keptInstances.length === 1) {
            // N=1 → unwrap to bare AgentTile (matches reducer's N=1 shape).
            survivors.push(keptInstances[0]!);
            continue;
          }
          const rebuilt: CollapsedPersonaGroup = {
            kind: "collapsed-persona",
            personaName: entry.personaName,
            count: keptInstances.length,
            instances: keptInstances,
          };
          survivors.push(rebuilt);
        } else {
          // Bare AgentTile.
          if (hiddenSet.has(hiddenMemberKey(entry.teamId, entry.memberId))) {
            hiddenMemberCount += 1;
          } else {
            survivors.push(entry);
          }
        }
      }

      if (survivors.length > 0) {
        newRosterTiles.set(teamId, survivors);
        newTeamOrder.push(teamId);
      }
    }

    return {
      ...session,
      rosterTiles: newRosterTiles,
      teamOrder: newTeamOrder,
      // background untouched — unrostered agents have no member id to hide.
    };
  });

  return {
    tree: {
      ...tree,
      sessions,
    },
    hiddenMemberCount,
  };
}
