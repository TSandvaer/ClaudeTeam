/**
 * removeMembersFilter — post-reducer projection that suppresses rostered tiles
 * whose `(teamId, memberId)` is in the user's persisted REMOVED-member set
 * (E-07a / EPIC 86ca11187 §7.3 — yaml-gated remove-agent).
 *
 * Structural sibling of `hideMembersFilter.ts`: the suppression mechanics
 * (drop bare tiles + CollapsedPersonaGroup wrappers by set-membership, prune
 * empty teams, never touch background) are identical. The DIFFERENCE is
 * downstream of this filter, not inside it:
 *
 *   - **Hide** suppresses a tile from the DEFAULT tree, but E-06b's "show
 *     hidden" recovery surface re-renders hidden members from
 *     `hiddenMemberKeys` (the un-filtered persisted set on the wire). One click
 *     un-hides.
 *   - **Remove** suppresses a tile from the default tree the same way — BUT a
 *     removed member is ALSO absent from any reveal surface: E-07b consumes
 *     `removedMemberKeys` precisely so it never offers a show/unhide affordance
 *     for a removed member. Restore is yaml-gated only (re-add to teams.yaml →
 *     `RemovedMembersStore.reconcile()` clears the record on the next reload).
 *
 * "More permanent than hide" therefore means: the SAME default-tree
 * suppression, PLUS the absence of a recovery affordance. The host enforces the
 * default-tree half (this filter); the wire's `removedMemberKeys` (vs.
 * `hiddenMemberKeys`) lets the webview enforce the recovery-surface half.
 *
 * ## Ordering with the other post-reducer filters
 *
 * Applied AFTER hide-finished / hide-idle / hide-members. The predicate is
 * set-membership by `(teamId, memberId)` — INDEPENDENT of tile state and of the
 * hidden set — so order relative to the other filters is irrelevant; a
 * deterministic last-in-chain placement avoids surprise. Empty set → identity
 * transform (no allocation, no walk).
 *
 * There is NO auto-remove path here (or anywhere) — the set is mutated solely
 * by the explicit `ui:remove-member` action + the yaml-gated reconcile (which
 * only SHRINKS the set). Sponsor REJECTED auto-hide/auto-remove (DECISIONS §36).
 * This filter only ever READS the supplied set.
 *
 * Source: `team/iris-ux/whole-team-display-spec.md` §7.3 + DECISIONS §30.
 */

import {
  isCollapsedPersonaGroup,
  isMultiAgentPersonaTile,
  removedMemberKey,
  type AgentTile,
  type AgentTree,
  type CollapsedPersonaGroup,
  type RemovedMemberKey,
  type RosterTileEntry,
  type SessionTree,
} from "../../shared/types.js";
import { rebuildMultiAgentTileFromInstances } from "./reducer.js";

/**
 * Result of applying the remove-members filter to an `AgentTree`.
 *
 * `tree` — either the input ref (when the set is empty — identity transform)
 * or a newly-allocated tree with removed members suppressed.
 *
 * `removedMemberCount` — total tiles suppressed across all sessions THIS TICK
 * (always >= 0; 0 when the set is empty). Tick-local diagnostic — the wire's
 * `removedMemberKeys.length` is the persisted-set size, which can differ (a
 * removed member with no live tile this session contributes 0 here).
 */
export interface RemoveMembersResult {
  tree: AgentTree;
  removedMemberCount: number;
}

/**
 * Apply the remove-members filter to an agent tree.
 *
 * Pure function — does not mutate its input. When `removedSet` is empty,
 * returns the input ref directly (identity transform).
 *
 * @param tree        Input tree (typically after the hide filters have run —
 *                    order is irrelevant since the predicates are disjoint).
 * @param removedSet  The persisted removed-member set as `RemovedMemberKey`
 *                    strings. READ-only — never mutated, never added to (AC4).
 * @returns           Filtered tree + count of tiles suppressed this tick.
 */
export function applyRemoveMembersFilter(
  tree: AgentTree,
  removedSet: ReadonlySet<RemovedMemberKey>,
): RemoveMembersResult {
  if (removedSet.size === 0) {
    // Identity transform — no allocation, no walk.
    return { tree, removedMemberCount: 0 };
  }

  let removedMemberCount = 0;

  const sessions: SessionTree[] = tree.sessions.map((session) => {
    const newRosterTiles = new Map<string, RosterTileEntry[]>();
    const newTeamOrder: string[] = [];

    for (const teamId of session.teamOrder) {
      const entries = session.rosterTiles.get(teamId);
      if (!entries) continue;

      const survivors: RosterTileEntry[] = [];
      for (const entry of entries) {
        if (isMultiAgentPersonaTile(entry)) {
          // 86ca1dtr5: every instance shares one memberId so the wrapper is
          // all-or-none, but the per-instance walk keeps the contract robust.
          const keptInstances: AgentTile[] = [];
          for (const inst of entry.instances) {
            if (removedSet.has(removedMemberKey(inst.teamId, inst.memberId))) {
              removedMemberCount += 1;
            } else {
              keptInstances.push(inst);
            }
          }
          const rebuilt = rebuildMultiAgentTileFromInstances(
            entry,
            keptInstances,
          );
          if (rebuilt !== null) survivors.push(rebuilt);
        } else if (isCollapsedPersonaGroup(entry)) {
          // Walk instances; drop removed ones; rebuild wrapper. In practice
          // every instance shares one memberId so the wrapper is all-or-none,
          // but the per-instance walk keeps the contract robust.
          const keptInstances: AgentTile[] = [];
          for (const inst of entry.instances) {
            if (removedSet.has(removedMemberKey(inst.teamId, inst.memberId))) {
              removedMemberCount += 1;
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
          if (removedSet.has(removedMemberKey(entry.teamId, entry.memberId))) {
            removedMemberCount += 1;
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
      // background untouched — unrostered agents have no member id to remove.
    };
  });

  return {
    tree: {
      ...tree,
      sessions,
    },
    removedMemberCount,
  };
}
