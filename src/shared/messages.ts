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

import type { AgentTree, Team } from "./types.js";

// =============================================================================
// Host → Webview
// =============================================================================

/** Full state snapshot sent on every poll tick (and on initial view load). */
export type StateFullMessage = {
  type: "state:full";
  payload: AgentTree;
};

/**
 * Partial state delta — reserved for M4 optimization.
 * At M2 scope the host only sends `state:full`.
 */
export type StateDeltaMessage = {
  type: "state:delta";
  payload: Record<string, unknown>;
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
