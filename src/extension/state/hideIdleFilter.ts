/**
 * hideIdleFilter — post-reducer projection that suppresses rostered tiles
 * whose state is "idle" when `claudeteam.hideIdleAgents` is true
 * (spec 86c9zmyef — running-focused dashboard).
 *
 * Sibling of `hideFinishedFilter.ts`. Both filters apply at `buildAgentTree`
 * exit / `serializeState` entry — NOT inside the reducer. Keeping
 * classification (reducer) and presentation (these filters) separate means
 * the filters can be flipped on/off without invalidating the cached agent
 * tree, and each filter pass can produce BOTH the filtered tree AND the
 * corresponding count for the wire in one walk.
 *
 * Composition with the M5 hide-finished filter: apply
 * `applyHideFinishedFilter` first, then `applyHideIdleFilter` on the
 * intermediate result. Order is symmetric (`finished` and `idle` are
 * disjoint states, no double-counting risk), but the deterministic order
 * avoids surprise. The wire-shape carries both counts independently.
 *
 * Filter rules (mirrors hideFinishedFilter for the `idle` state — spec §3.3):
 *   - When `hideIdle === false`: identity transform — return the input
 *     tree unchanged AND `hiddenIdleCount: 0`. Referential identity
 *     preserved (`result.tree === input`).
 *   - When `hideIdle === true`:
 *     • Each session's `rosterTiles[teamId]` is walked.
 *     • Bare `AgentTile` with `state === "idle"` → dropped; counter ++.
 *     • `CollapsedPersonaGroup`: walk `instances`; drop each idle
 *       instance; counter ++ per drop. Rebuild the wrapper with survivors:
 *       N=0 → drop the wrapper entirely; N=1 → unwrap to a bare AgentTile
 *       (matches the reducer's pre-M3-10 N=1 shape); N>=2 → keep the wrapper
 *       with adjusted `count` + `instances`.
 *     • If a team's tile list becomes empty after filtering, the team key is
 *       removed from `rosterTiles` AND `teamOrder` (matches existing
 *       suppression behavior — sessionBlock omits empty teams).
 *     • Background agents are NEVER filtered (already collapsed via the
 *       background chip; further filtering would double-hide).
 *
 * The function does NOT mutate its input; a new tree is allocated when
 * `hideIdle === true`. Pure / cheap — safe to call on every tick.
 *
 * Source: `team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md` §3 + §7.1.
 */

import type {
  AgentTile,
  AgentTree,
  CollapsedPersonaGroup,
  RosterTileEntry,
  SessionTree,
} from "../../shared/types.js";
import { isCollapsedPersonaGroup } from "../../shared/types.js";

/**
 * Result of applying the hide-idle filter to an `AgentTree`.
 *
 * `tree` — either the input ref (when filter off — identity transform) or a
 * newly-allocated tree with idle tiles suppressed (when filter on).
 *
 * `hiddenIdleCount` — total idle tiles suppressed across all sessions this
 * tick. Always >= 0. When filter is off, always 0.
 */
export interface HideIdleResult {
  tree: AgentTree;
  hiddenIdleCount: number;
}

/**
 * Apply the hide-idle filter to an agent tree.
 *
 * Pure function — does not mutate its input. When `hideIdle === false`,
 * returns the input ref directly (identity transform) so callers can skip
 * downstream work when nothing changed.
 *
 * @param tree       Input tree from the reducer (typically after
 *                   `applyHideFinishedFilter` has already run — see
 *                   composition note in the file header).
 * @param hideIdle   Effective value of `claudeteam.hideIdleAgents`.
 * @returns          Filtered tree + count of suppressed tiles.
 */
export function applyHideIdleFilter(
  tree: AgentTree,
  hideIdle: boolean,
): HideIdleResult {
  if (!hideIdle) {
    // Identity transform — no allocation, no walk.
    return { tree, hiddenIdleCount: 0 };
  }

  let hiddenIdleCount = 0;

  const sessions: SessionTree[] = tree.sessions.map((session) => {
    const newRosterTiles = new Map<string, RosterTileEntry[]>();
    const newTeamOrder: string[] = [];

    for (const teamId of session.teamOrder) {
      const entries = session.rosterTiles.get(teamId);
      if (!entries) continue;

      const survivors: RosterTileEntry[] = [];
      for (const entry of entries) {
        if (isCollapsedPersonaGroup(entry)) {
          // Walk instances; drop idle ones; rebuild wrapper.
          const keptInstances: AgentTile[] = [];
          for (const inst of entry.instances) {
            if (inst.state === "idle") {
              hiddenIdleCount += 1;
            } else {
              keptInstances.push(inst);
            }
          }
          if (keptInstances.length === 0) {
            // Wrapper drops entirely.
            continue;
          }
          if (keptInstances.length === 1) {
            // N=1 → unwrap to bare AgentTile (matches reducer's N=1 shape).
            survivors.push(keptInstances[0]!);
            continue;
          }
          // N>=2 → keep the wrapper with adjusted count + instances.
          const rebuilt: CollapsedPersonaGroup = {
            kind: "collapsed-persona",
            personaName: entry.personaName,
            count: keptInstances.length,
            instances: keptInstances,
          };
          survivors.push(rebuilt);
        } else {
          // Bare AgentTile.
          if (entry.state === "idle") {
            hiddenIdleCount += 1;
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
      // background untouched per spec §3.3 (background agents are NOT filtered)
    };
  });

  return {
    tree: {
      ...tree,
      sessions,
    },
    hiddenIdleCount,
  };
}
