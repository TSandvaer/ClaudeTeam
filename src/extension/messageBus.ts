/**
 * messageBus — host → webview message dispatch (stub).
 *
 * Exports the typed `postState` function used to send `state:full` messages
 * to the webview. The actual call site is in M2-06 (extension host ↔ webview
 * message bridge); this stub ensures the module import chain typechecks.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Message protocol"
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC1
 */

import type * as vscode from "vscode";
import type { DashboardState, SessionTree, AgentTile } from "../shared/types.js";
import type { HostMessage } from "../shared/messages.js";

/**
 * JSON-serializable shape of one session. `rosterTiles` is a plain object
 * keyed by teamId, NOT a Map (Map values do not survive JSON.stringify;
 * VS Code's postMessage serializes via JSON internally).
 */
export interface SerializedSessionTree
  extends Omit<SessionTree, "rosterTiles"> {
  rosterTiles: Record<string, AgentTile[]>;
}

/** JSON-serializable shape of the full state. */
export interface SerializedDashboardState {
  sessions: SerializedSessionTree[];
}

/**
 * Convert a `DashboardState` to a JSON-serializable shape.
 *
 * The reducer's `SessionTree.rosterTiles` is a `Map<string, AgentTile[]>`.
 * Maps do NOT round-trip through JSON.stringify (`{}` is the result), so we
 * convert each session's map to a plain object keyed by teamId before
 * handing the payload to `webview.postMessage`.
 *
 * Pure function; preserves all other fields verbatim.
 */
export function serializeState(state: DashboardState): SerializedDashboardState {
  return {
    sessions: state.sessions.map((session) => ({
      shortId: session.shortId,
      sessionId: session.sessionId,
      pid: session.pid,
      entrypoint: session.entrypoint,
      version: session.version,
      isAlive: session.isAlive,
      cwd: session.cwd,
      title: session.title,
      // Map<string, AgentTile[]> → Record<string, AgentTile[]>
      rosterTiles: Object.fromEntries(session.rosterTiles),
      teamOrder: session.teamOrder,
      background: session.background,
    })),
  };
}

/**
 * Serialize and post a `state:full` message to the given webview.
 *
 * Maps are flattened to plain objects via `serializeState` before posting,
 * because `webview.postMessage` serializes the payload via JSON internally.
 * The webview receives a `DashboardState` shape but with `rosterTiles` as a
 * plain object — the renderer must use `Object.entries` instead of
 * `Map.entries` on the receiving side.
 *
 * Returns the postMessage promise so callers can await delivery in tests.
 */
export function postState(
  webview: vscode.Webview,
  state: DashboardState,
): Thenable<boolean> {
  const msg: HostMessage = {
    type: "state:full",
    // The runtime payload differs from DashboardState (rosterTiles is plain).
    // We cast at this boundary because the host→webview contract is "JSON
    // round-trips of DashboardState"; the on-wire shape is the serialized
    // variant. Maya's M2-05 renders against the same SerializedDashboardState.
    payload: serializeState(state) as unknown as DashboardState,
  };
  return webview.postMessage(msg);
}
