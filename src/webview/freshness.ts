/**
 * freshness — re-export shim for back-compat with existing webview imports.
 *
 * The implementation moved to `src/shared/freshness.ts` 86c9zfmhp (Obs 11)
 * so the extension host (reducer's `buildActivity`) can humanize the
 * "finished Xs/Xm/Xh/Xd" suffix at the source rather than letting the
 * webview append a parallel second clock. This shim keeps the historical
 * `src/webview/freshness.ts` import path live while new code imports from
 * `src/shared/freshness.js`.
 *
 * Source: ClickUp 86c9zfmhp (Obs 11 — humanize finished elapsed-time format)
 */

export { formatFreshness } from "../shared/freshness.js";
