/**
 * freshness — elapsed-time formatter for tile freshness chips.
 *
 * Pure function (no DOM, no VS Code API, no filesystem). Lives in `src/shared`
 * so both the extension host (reducer's `buildActivity` for finished tiles)
 * and the webview (tooltip + back-compat tracker path) can import it. Used to
 * be `src/webview/freshness.ts`; moved 86c9zfmhp (Obs 11) when the host became
 * the single authority for `finished Xs/Xm/Xh/Xd` text emission.
 *
 * Produces compact "Xs / Xm / Xh / Xd" strings parallel to the existing
 * `idle <Ns>` convention emitted by the host reducer for active agents.
 *
 * Rollover thresholds (chosen to match the precedent of `idle <Ns>`):
 *   - elapsed < 60s    → "Xs" (whole seconds, rounded; clamped at 59 to avoid "60s")
 *   - elapsed < 1h     → "Xm" (whole minutes, floored)
 *   - elapsed < 24h    → "Xh" (whole hours, floored)
 *   - elapsed >= 24h   → "Xd" (whole days, floored)
 *
 * `Xd` was added 86c9zfmhp (Obs 11 — humanize finished elapsed-time format)
 * because the host's prior `"finished 19289s"` string was rendering 5+ hours
 * of wall-time-since-finish as raw seconds, unreadable at a glance. Day
 * rollover handles long-finished agents that survive across multiple
 * dashboard sessions without ever being cleared (e.g. completed dispatches
 * left visible for audit).
 *
 * Negative inputs (clock skew, finishedAtMs > nowMs) clamp to "0s" rather
 * than emitting "-3s" — clamping keeps the rendered string sensible without
 * surfacing what is almost always a benign timing race.
 *
 * Source: ClickUp 86c9ybtut (M3-04 NIT #3 — finished-status freshness)
 *         ClickUp 86c9zfmhp (Obs 11 — humanize finished elapsed-time format)
 *         .claude/docs/vscode-extension-conventions.md §"Webview rules"
 */

/** Threshold below which we render whole seconds ("Xs"). */
const MINUTE_MS = 60_000;
/** Threshold below which we render whole minutes ("Xm"); >= renders hours. */
const HOUR_MS = 60 * 60_000;
/** Threshold below which we render whole hours ("Xh"); >= renders days. */
const DAY_MS = 24 * HOUR_MS;

/**
 * Format an elapsed-ms value as a compact freshness string.
 *
 * Rollover NIT fix (M3-10, ClickUp 86c9ydz4k): elapsed values in the half-
 * second window just below the minute boundary used to round up to `"60s"`
 * — visually colliding with the next bucket's `"1m"`. `Math.round(59_999 /
 * 1000)` is 60, but the activity string `"60s"` reads as "one minute" to the
 * sponsor and breaks the seconds-bucket contract. Clamp the displayed
 * seconds at 59 so the last sub-minute tick reads `"59s"` and the next tick
 * (>= 60_000 ms) crosses cleanly to `"1m"`. Equivalent fix would be
 * `Math.floor` on seconds, but `Math.min(59, Math.round(...))` preserves the
 * existing half-up behavior for values < 59.5s (so 500ms still rounds to
 * 1s) — only the 59.500 → 59.999 window is affected.
 *
 * @param elapsedMs Elapsed time in milliseconds. Negative values clamp to 0.
 * @returns         "Xs" / "Xm" / "Xh" / "Xd" — see thresholds in module doc.
 */
export function formatFreshness(elapsedMs: number): string {
  const ms = Math.max(0, elapsedMs);
  if (ms < MINUTE_MS) {
    return `${Math.min(59, Math.round(ms / 1000))}s`;
  }
  if (ms < HOUR_MS) {
    return `${Math.floor(ms / MINUTE_MS)}m`;
  }
  if (ms < DAY_MS) {
    return `${Math.floor(ms / HOUR_MS)}h`;
  }
  return `${Math.floor(ms / DAY_MS)}d`;
}
