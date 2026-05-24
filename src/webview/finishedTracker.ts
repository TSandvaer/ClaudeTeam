/**
 * finishedTracker — webview-local first-seen timestamps for finished tiles.
 *
 * Pure webview state (Map keyed by "sessionId:agentId" → epoch ms of first
 * observation in finished state). Used by `agentTile.ts` to render the
 * `finished Xs / Xm / Xh` freshness suffix (M3-04 NIT #3).
 *
 * Lifecycle per tile key:
 *   - First render where tile.state === "finished" → record current ms.
 *   - Subsequent renders in finished state → return the recorded ms.
 *   - Tile transitions out of finished state → entry cleared on the next
 *     `prune` pass (caller passes the set of currently-finished keys).
 *
 * Why ephemeral here (not in the host AgentTile shape):
 *   - Adding a `finishedAtMs` field to AgentTile would change agent state
 *     lifecycle — explicitly OOS per ticket 86c9ybtut ("don't add new
 *     timestamp fields if AgentTree already exposes one").
 *   - Webview-local state is the correct surface for ephemeral UI concerns
 *     per .claude/docs/vscode-extension-conventions.md §"Webview rules".
 *
 * Accuracy note: "first-seen by THIS webview" is not the same as "finished
 * AT". Re-loading the webview resets the tracker, so a long-finished tile
 * will start back at "finished 0s". This is acceptable for a UX freshness
 * chip — the precision target is "freshly finished vs. stale finished",
 * not absolute wall-clock time of completion. The bare "finished" with NO
 * timestamp (current behavior on main) is worse: zero freshness signal.
 *
 * Source: ClickUp 86c9ybtut (M3-04 NIT #3 — finished-status freshness)
 */

/** Key shape: "{sessionId}:{agentId}". */
type TrackerKey = `${string}:${string}`;

/** Public surface of the tracker — single instance per webview boot. */
export interface FinishedTracker {
  /**
   * Record (or fetch) the first-seen timestamp for a tile observed in the
   * `finished` state. Subsequent calls with the same (sessionId, agentId)
   * return the original recorded value — the tile's apparent freshness only
   * advances by clock time, not by re-renders.
   *
   * @param sessionId   Session UUID owning the tile.
   * @param agentId     Agent id within the session.
   * @param nowMs       Wall-clock ms to record if no entry exists yet.
   * @returns           Recorded first-seen ms (NEW on first call, prior on
   *                    subsequent calls within the same finished episode).
   */
  observe(sessionId: string, agentId: string, nowMs: number): number;

  /**
   * Prune entries whose tile is no longer in `finished` state OR no longer
   * present in the dashboard at all. Pass the set of (sessionId:agentId)
   * keys currently observed in `finished` state; everything else is removed.
   *
   * Called once per render after observe()s; keeps the Map from growing
   * unboundedly as agents come and go across the dashboard's lifetime.
   */
  prune(currentFinishedKeys: Set<TrackerKey>): void;

  /** Test/debug surface — count of tracked entries. */
  size(): number;
}

/** Factory — returns an isolated tracker instance. Pure (no shared state). */
export function createFinishedTracker(): FinishedTracker {
  const firstSeen = new Map<TrackerKey, number>();

  return {
    observe(sessionId: string, agentId: string, nowMs: number): number {
      const key: TrackerKey = `${sessionId}:${agentId}`;
      const existing = firstSeen.get(key);
      if (existing !== undefined) {
        return existing;
      }
      firstSeen.set(key, nowMs);
      return nowMs;
    },

    prune(currentFinishedKeys: Set<TrackerKey>): void {
      for (const key of firstSeen.keys()) {
        if (!currentFinishedKeys.has(key)) {
          firstSeen.delete(key);
        }
      }
    },

    size(): number {
      return firstSeen.size;
    },
  };
}
