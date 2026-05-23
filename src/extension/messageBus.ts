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
import type { AgentTree } from "../shared/types.js";
import type { HostMessage } from "../shared/messages.js";

/**
 * Serialize and post a `state:full` message to the given webview.
 *
 * VS Code serializes the message via JSON.stringify internally, so the
 * payload must be JSON-serializable. `AgentTree.sessions[].rosterTiles` is a
 * `Map<string, AgentTile[]>` — which is NOT JSON-serializable. M2-06 must
 * convert it to a plain object before calling this function.
 *
 * At M2-01 scope this is a type-correct stub. Full implementation in M2-06.
 */
export function postState(
  webview: vscode.Webview,
  _state: AgentTree,
): Thenable<boolean> {
  // M2-06: serialize state (convert Map fields to plain objects) then post.
  const msg: HostMessage = {
    type: "state:full",
    payload: _state,
  };
  return webview.postMessage(msg);
}
