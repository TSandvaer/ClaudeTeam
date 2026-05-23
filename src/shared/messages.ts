/**
 * Host ↔ Webview message protocol.
 *
 * Single source of truth — both `src/extension/**` (extension host) and
 * `src/webview/**` (webview) import from here. Keep free of runtime
 * dependencies on either side.
 *
 * Every message is a discriminated union object with a `type` field.
 * Add new message types rather than overloading existing ones.
 *
 * JSON constraint: all payload values must be JSON-serializable. No `undefined`
 * values, no class instances, no circular refs, no functions. VS Code serializes
 * postMessage payloads via JSON.stringify internally.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Message protocol"
 */

import type { DashboardState, StateDelta, Team } from "./types.js";

// =============================================================================
// Host → Webview
// =============================================================================

/**
 * Full state snapshot sent on every poll tick (and on initial view load).
 *
 * `DashboardState` is an alias of the reducer's `AgentTree` — the names are
 * interchangeable; see `types.ts` for the rationale.
 */
export type StateFullMessage = {
  type: "state:full";
  payload: DashboardState;
};

/**
 * Partial state delta. Shape coordinated with Felix's M2-04 watcher plan and
 * canonicalized in `types.ts` as `StateDelta`:
 *   - `added`   — tiles newly observed since the last `state:full` baseline.
 *   - `updated` — tiles whose state / activity / model changed.
 *   - `removed` — `TileKey`s (`sessionId:agentId`) whose tile should be dropped
 *                 (session ended, agent disappeared).
 *
 * At M2-05 the host only sends `state:full`; the webview MAY no-op on incoming
 * `state:delta` messages or fall back to a request-state-full pattern. Wiring
 * delta application is M4 optimization. Defined here so the type is available
 * across both processes from day one.
 */
export type StateDeltaMessage = {
  type: "state:delta";
  payload: StateDelta;
};

/** Roster loaded successfully. */
export type RosterLoadedMessage = {
  type: "roster:loaded";
  payload: { teams: Team[] };
};

/** Roster failed to load (YAML parse error, missing file, etc.). */
export type RosterErrorMessage = {
  type: "roster:error";
  payload: { error: string };
};

/** Union of all host → webview messages. */
export type HostMessage =
  | StateFullMessage
  | StateDeltaMessage
  | RosterLoadedMessage
  | RosterErrorMessage;

// =============================================================================
// Webview → Host
// =============================================================================

/** User clicked on a rostered agent tile — open its JSONL in the editor. */
export type OpenTranscriptMessage = {
  type: "ui:open-transcript";
  payload: { sessionId: string; agentId: string };
};

/** User triggered the "Open Roster" action. */
export type OpenRosterMessage = {
  type: "ui:open-roster";
};

/** User triggered manual refresh. */
export type RefreshMessage = {
  type: "ui:refresh";
};

/** Union of all webview → host messages. */
export type WebviewMessage =
  | OpenTranscriptMessage
  | OpenRosterMessage
  | RefreshMessage;
