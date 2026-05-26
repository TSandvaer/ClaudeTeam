/**
 * hideFinishedFilter — post-reducer projection that suppresses rostered tiles
 * whose state is "finished" when the `claudeteam.hideFinishedAgents` config
 * is true (M5).
 *
 * The filter applies at `buildAgentTree` exit / `serializeState` entry (see
 * `team/iris-ux/m5-hide-finished-spec.md` §3.1) — NOT inside the reducer.
 * Keeping classification (reducer) and presentation (this filter) separate
 * means the filter can be flipped on/off without invalidating the cached
 * agent tree, and the filter pass can produce BOTH the filtered tree AND
 * the `hiddenFinishedCount` for the wire in one walk.
 *
 * Filter rules (spec §3.2):
 *   - When `hideFinished === false`: identity transform — return the input
 *     tree unchanged AND `hiddenFinishedCount: 0`. Referential identity
 *     preserved (`result.tree === input`).
 *   - When `hideFinished === true`:
 *     • Each session's `rosterTiles[teamId]` is walked.
 *     • Bare `AgentTile` with `state === "finished"` → dropped; counter ++.
 *     • `CollapsedPersonaGroup`: walk `instances`; drop each finished
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
 * `hideFinished === true`. Pure / cheap — safe to call on every tick.
 *
 * Source: `team/iris-ux/m5-hide-finished-spec.md` §3 + §7.1.
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
 * Result of applying the hide-finished filter to an `AgentTree`.
 *
 * `tree` — either the input ref (when filter off — identity transform) or a
 * newly-allocated tree with finished tiles suppressed (when filter on).
 *
 * `hiddenFinishedCount` — total finished tiles suppressed across all sessions
 * this tick. Always >= 0. When filter is off, always 0.
 */
export interface HideFinishedResult {
  tree: AgentTree;
  hiddenFinishedCount: number;
}

/**
 * Apply the hide-finished filter to an agent tree.
 *
 * Pure function — does not mutate its input. When `hideFinished === false`,
 * returns the input ref directly (identity transform) so callers can skip
 * downstream work when nothing changed.
 *
 * @param tree           Input tree from the reducer.
 * @param hideFinished   Effective value of `claudeteam.hideFinishedAgents`.
 * @returns              Filtered tree + count of suppressed tiles.
 */
export function applyHideFinishedFilter(
  tree: AgentTree,
  hideFinished: boolean,
): HideFinishedResult {
  if (!hideFinished) {
    // Identity transform — no allocation, no walk.
    return { tree, hiddenFinishedCount: 0 };
  }

  let hiddenFinishedCount = 0;

  const sessions: SessionTree[] = tree.sessions.map((session) => {
    const newRosterTiles = new Map<string, RosterTileEntry[]>();
    const newTeamOrder: string[] = [];

    for (const teamId of session.teamOrder) {
      const entries = session.rosterTiles.get(teamId);
      if (!entries) continue;

      const survivors: RosterTileEntry[] = [];
      for (const entry of entries) {
        if (isCollapsedPersonaGroup(entry)) {
          // Walk instances; drop finished ones; rebuild wrapper.
          const keptInstances: AgentTile[] = [];
          for (const inst of entry.instances) {
            if (inst.state === "finished") {
              hiddenFinishedCount += 1;
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
          if (entry.state === "finished") {
            hiddenFinishedCount += 1;
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
      // background untouched per spec §3.2 (background agents are NOT filtered)
    };
  });

  return {
    tree: {
      ...tree,
      sessions,
    },
    hiddenFinishedCount,
  };
}
