/**
 * messageBus — host → webview message dispatch.
 *
 * Exports `postState(webview, state)` which serializes the in-memory
 * `DashboardState` (containing `Map<string, AgentTile[]>`) to the JSON-safe
 * `SerializedDashboardState` shape (containing plain `Record<string, AgentTile[]>`)
 * before calling `webview.postMessage`.
 *
 * The wire shape lives in `src/shared/messages.ts` as `SerializedDashboardState`,
 * which is what `StateFullMessage.payload` is typed as. This eliminates the
 * `as unknown as DashboardState` cast that lived here in M2-04 (absorbed M2-04
 * NIT #2 — see ClickUp 86c9y9q6h AC1).
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Message protocol" +
 *         "JSON-serialization constraint"
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC1
 */

import type * as vscode from "vscode";
import type { DashboardState } from "../shared/types.js";
import type {
  HostMessage,
  SerializedDashboardState,
  SerializedSessionTree,
} from "../shared/messages.js";

// Re-export the shared types so existing consumers (Maya's webview helpers,
// older tests) keep their import paths stable across the M2-04 → M2-06
// transition. New code SHOULD import from `src/shared/messages.ts` directly.
export type { SerializedDashboardState, SerializedSessionTree };

/**
 * Convert an in-memory `DashboardState` to its JSON-safe wire shape.
 *
 * The reducer's `SessionTree.rosterTiles` is a `Map<string, AgentTile[]>`.
 * Maps do NOT round-trip through `JSON.stringify` — they serialize to `{}`.
 * VS Code's `webview.postMessage` uses JSON internally, so we convert each
 * session's Map to a plain object keyed by teamId before sending.
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
    // M3-03: pass through the window-filter flag. Boolean is JSON-safe — no
    // flatten step needed. Default to false when the in-memory state omits it
    // so the webview always sees a real boolean on the wire.
    filterApplied: state.filterApplied === true,
    // M3-04: roster errors / warnings are plain string[] — JSON-safe; pass
    // verbatim. Empty arrays on the wire when the host omits them so the
    // webview always sees real arrays (no `undefined` branch in the renderer).
    rosterErrors: state.rosterErrors ?? [],
    rosterWarnings: state.rosterWarnings ?? [],
    // M5: hide-finished filter wire surface. The watcher stamps these fields
    // onto the in-memory tree (see `applyHideFinishedFilter` + watcherLoop
    // integration); `serializeState` passes them through. Default 0 / explicit
    // false so the webview always sees real values (no `undefined` branch).
    hiddenFinishedCount: state.hiddenFinishedCount ?? 0,
    // 86c9zq9vm: hide-idle filter wire surface (mirrors hidden-finished —
    // see spec 86c9zmyef §3.1). Default 0 when the host omits — back-compat
    // with CLI driver / pre-86c9zq9vm tests.
    hiddenIdleCount: state.hiddenIdleCount ?? 0,
    // E-06a (EPIC 86ca11187 §7.2): hide-members wire surface. `hiddenMemberCount`
    // = tiles suppressed this tick; `hiddenMemberKeys` = the FULL persisted set
    // (string[] — JSON-safe; a Set would serialize to {}). Defaults to 0 / []
    // when the host omits so the webview always sees real values (no
    // `undefined` branch in the "show hidden" renderer). E-06b consumes both.
    hiddenMemberCount: state.hiddenMemberCount ?? 0,
    hiddenMemberKeys: state.hiddenMemberKeys ?? [],
    config: {
      hideFinishedAgents: state.config?.hideFinishedAgents === true,
      // 86c9zmqa8 (uniform-cluster polish): mirror the auto-collapse flag onto
      // the wire so the webview's collapsedPersonaTile renderer can read it
      // without re-reading VS Code Settings. Defaults to false here when the
      // host omits the field — back-compat with pre-86c9zmqa8 watchers.
      autoCollapseUniformClusters:
        state.config?.autoCollapseUniformClusters === true,
      // 86c9zq9vm (spec 86c9zmyef §3.2): mirror the hide-idle scalar onto
      // the wire so the webview chip boots with its toggle reflecting truth.
      // Defaults to false here when the host omits — back-compat with
      // pre-86c9zq9vm watchers (CLI driver, older tests).
      hideIdleAgents: state.config?.hideIdleAgents === true,
    },
  };
}

/**
 * Serialize and post a `state:full` message to the given webview.
 *
 * Returns the postMessage promise so callers can await delivery in tests.
 *
 * Defensive: catches synchronous errors from `webview.postMessage` (which
 * can throw when the view has been disposed mid-tick — e.g. the user
 * collapses the Activity Bar panel while a tick is in flight). Returns
 * `Thenable<false>` in that case so callers can short-circuit.
 */
export function postState(
  webview: vscode.Webview,
  state: DashboardState,
): Thenable<boolean> {
  const msg: HostMessage = {
    type: "state:full",
    payload: serializeState(state),
  };
  try {
    return webview.postMessage(msg);
  } catch (err) {
    // The webview has been disposed (or some other host-side failure). Log
    // but do not propagate — the watcher loop must keep running.
    console.warn(
      `[claudeteam.messageBus] postState failed: ${(err as Error).message}`,
    );
    return Promise.resolve(false);
  }
}
