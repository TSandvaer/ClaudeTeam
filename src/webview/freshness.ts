/**
 * freshness — elapsed-time formatter for tile freshness chips.
 *
 * Webview-local pure function. Produces compact "Xs / Xm / Xh" strings parallel
 * to the existing `idle Xs` convention emitted by the host reducer for active
 * agents (`src/extension/state/reducer.ts` § buildActivity → "idle"). The host
 * does NOT emit a freshness suffix for `finished` tiles — it just emits the
 * literal `"finished"` — so this util closes the UX gap by formatting on the
 * render side from a webview-tracked first-seen timestamp.
 *
 * Why webview-side rather than host-side:
 *   - The webview tracks "when did we first SEE this tile in finished state"
 *     via an ephemeral Map keyed by sessionId:agentId. This is purely UI
 *     state (allowed per .claude/docs/vscode-extension-conventions.md
 *     §"Webview rules" → "Webview-local state is for ephemeral UI concerns").
 *   - No new fields on AgentTile / AgentTree — agent state lifecycle is
 *     unchanged per ticket OOS ("don't add new timestamp fields if AgentTree
 *     already exposes one").
 *   - Host already re-emits `state:full` on every poll tick (~2s cadence),
 *     so the displayed freshness refreshes naturally on each re-render —
 *     no setInterval needed in the webview.
 *
 * Rollover thresholds (chosen to match the precedent of `idle <Ns>`):
 *   - elapsed < 60s    → "Xs" (whole seconds, rounded)
 *   - elapsed < 3600s  → "Xm" (whole minutes, floored)
 *   - elapsed >= 3600s → "Xh" (whole hours, floored)
 *
 * Negative inputs (clock skew, finishedAtMs > nowMs) clamp to "0s" rather
 * than emitting "-3s" — clamping keeps the rendered string sensible without
 * surfacing what is almost always a benign timing race.
 *
 * Source: ClickUp 86c9ybtut (M3-04 NIT #3 — finished-status freshness)
 *         .claude/docs/vscode-extension-conventions.md §"Webview rules"
 */

/** Threshold below which we render whole seconds ("Xs"). */
const MINUTE_MS = 60_000;
/** Threshold below which we render whole minutes ("Xm"); >= renders hours. */
const HOUR_MS = 60 * 60_000;

/**
 * Format an elapsed-ms value as a compact freshness string.
 *
 * @param elapsedMs Elapsed time in milliseconds. Negative values clamp to 0.
 * @returns         "Xs" / "Xm" / "Xh" — see thresholds in module doc.
 */
export function formatFreshness(elapsedMs: number): string {
  const ms = Math.max(0, elapsedMs);
  if (ms < MINUTE_MS) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (ms < HOUR_MS) {
    return `${Math.floor(ms / MINUTE_MS)}m`;
  }
  return `${Math.floor(ms / HOUR_MS)}h`;
}
