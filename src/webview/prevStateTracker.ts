/**
 * prevStateTracker — webview-local last-rendered state per tile, used to
 * detect `state`-change transitions at the render boundary (M4-05 §2.5).
 *
 * Pure webview state (Map keyed by "sessionId:agentId" → last-rendered
 * `AgentState`). Mirrors the `finishedTracker` lifecycle pattern so the
 * webview owns ephemeral UI state without duplicating host data.
 *
 * Lifecycle per tile key:
 *   - First render where the key is observed → `previous(...)` returns
 *     `undefined` (caller skips the transition class — first appearance is
 *     not a transition per M4-01 §2.5 rule 3). The current state is then
 *     recorded via `record(...)`.
 *   - Subsequent renders → `previous(...)` returns the LAST recorded state.
 *     If it differs from the new state, the caller applies the
 *     `data-transition="to-<newState>"` attribute for the animation window.
 *   - Tile disappears between renders → `prune(...)` clears the entry on
 *     the next render pass, parallel to `finishedTracker.prune`.
 *
 * Why ephemeral here (not in the host `AgentTile` shape):
 *   - The host already emits the current state; "what state was this tile
 *     last time the webview rendered it" is a webview-only concern.
 *   - State that already exists in the extension host should NOT be
 *     duplicated in the webview per
 *     `.claude/docs/vscode-extension-conventions.md` § "Webview rules".
 *   - Webview-local state is the correct surface for ephemeral UI
 *     concerns (hover, scroll, expansion, transition tracking).
 *
 * Accuracy note: "previous-as-seen-by-THIS-webview" is the only definition
 * we can implement without a host-side delta channel. A webview reload
 * resets the tracker, so the first render after reload never shows a
 * transition flash — exactly the same as the very first render at boot.
 * Acceptable: reload is a coarse user action and the steady-state visuals
 * still convey the current state correctly.
 *
 * Source: team/iris-ux/m4-polish-spec.md §2.5 (state-transition detection)
 *         M4-05 backlog AC6 (state-transition test)
 */

/** Key shape: "{sessionId}:{agentId}". Mirrors finishedTracker.ts. */
type TrackerKey = `${string}:${string}`;

/** Permitted state values — re-exported from shared types for clarity. */
import type { AgentState } from "../shared/types.js";

/** Public surface of the tracker — single instance per webview boot. */
export interface PrevStateTracker {
  /**
   * Return the LAST-recorded state for this (sessionId, agentId), or
   * `undefined` if no entry has been recorded yet (first-render case).
   *
   * Read-only — does not mutate the tracker. Callers pair this with a
   * follow-up `record(...)` after rendering.
   */
  previous(sessionId: string, agentId: string): AgentState | undefined;

  /**
   * Record the current state for this tile. Overwrites any prior entry.
   * Called after each render so the NEXT render sees this as `previous`.
   */
  record(sessionId: string, agentId: string, state: AgentState): void;

  /**
   * Prune entries whose tile is no longer present in the dashboard. Pass
   * the set of (sessionId:agentId) keys currently rendered; everything
   * else is removed. Mirrors `finishedTracker.prune`.
   *
   * Called once per render after `record(...)`s; keeps the Map from
   * growing unboundedly as agents come and go.
   */
  prune(currentKeys: Set<TrackerKey>): void;

  /** Test/debug surface — count of tracked entries. */
  size(): number;
}

/** Factory — returns an isolated tracker instance. Pure (no shared state). */
export function createPrevStateTracker(): PrevStateTracker {
  const lastState = new Map<TrackerKey, AgentState>();

  return {
    previous(sessionId: string, agentId: string): AgentState | undefined {
      const key: TrackerKey = `${sessionId}:${agentId}`;
      return lastState.get(key);
    },

    record(sessionId: string, agentId: string, state: AgentState): void {
      const key: TrackerKey = `${sessionId}:${agentId}`;
      lastState.set(key, state);
    },

    prune(currentKeys: Set<TrackerKey>): void {
      for (const key of lastState.keys()) {
        if (!currentKeys.has(key)) {
          lastState.delete(key);
        }
      }
    },

    size(): number {
      return lastState.size;
    },
  };
}
