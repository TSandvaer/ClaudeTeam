/**
 * Webview entry point — M2-05 dashboard renderer + message receiver.
 *
 * Boot sequence:
 *   1. Locate the #root mount node.
 *   2. Acquire the VS Code webview API (`acquireVsCodeApi`). If it's
 *      undefined we're running in a plain browser (dev mode) and fall back
 *      to a console-log mock so click handlers + fixture rendering still
 *      work — spec §9 + AC8 "static-fixture mode."
 *   3. Initial render — `FIXTURE_STATE` in dev mode; an empty state until the
 *      first `state:full` lands in VS Code mode.
 *   4. Wire `initMessageReceiver` to handle host → webview messages. New
 *      states fully replace the current DOM (AC7 discipline note).
 *
 * CSP rationale (load-bearing): provider.ts injects this file via
 *   <script src="..."></script>
 * with no inline scripts and no `eval`. The bundle is IIFE per esbuild config
 * to satisfy the `script-src 'self'`-equivalent CSP — no ES module imports at
 * runtime, no dynamic import().
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Webview rules"
 *         team/iris-ux/m2-dashboard-tile-spec.md §9
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC1, AC2, AC8
 */

import { FIXTURE_STATE } from "../shared/fixtures.js";
import type { AgentTree } from "../shared/types.js";
import type { WebviewMessage } from "../shared/messages.js";
import { initMessageReceiver } from "./messageReceiver.js";
import {
  renderFull,
  type DashboardErrorState,
  type RenderContext,
} from "./render.js";

// =============================================================================
// VS Code API shim
// =============================================================================

/**
 * Webview-global function injected by VS Code when running inside the
 * extension host. Returns an object with `postMessage` / `setState` /
 * `getState`. Calling it twice throws — guarded by the single-call pattern in
 * `acquireApi()`.
 *
 * In browser dev mode the symbol is undefined; we substitute a console-logging
 * mock so click handlers and renderer flows still execute.
 */
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

interface WebviewApi {
  postMessage(msg: WebviewMessage): void;
}

function acquireApi(): WebviewApi {
  if (typeof acquireVsCodeApi === "function") {
    const api = acquireVsCodeApi();
    return {
      postMessage: (msg: WebviewMessage) => api.postMessage(msg),
    };
  }
  // Browser dev fallback — log clicks so Maya can verify shape without VS Code.
  return {
    postMessage: (msg: WebviewMessage) => {
      console.log("[claudeteam:dev] postMessage:", msg);
    },
  };
}

// =============================================================================
// Boot
// =============================================================================

function boot(): void {
  const mount = document.getElementById("root");
  if (!mount) {
    console.error("[claudeteam] #root element not found");
    return;
  }
  // Clear the static "ClaudeTeam loading…" placeholder from provider.ts.
  mount.replaceChildren();

  const api = acquireApi();
  let currentError: DashboardErrorState | null = null;
  let currentState: AgentTree = FIXTURE_STATE;

  // Browser dev mode → render fixture immediately. VS Code mode → render the
  // fixture too as an "until first message arrives" placeholder. The first
  // `state:full` from the host replaces it.
  const buildCtx = (): RenderContext => ({
    mount,
    postMessage: api.postMessage,
    error: currentError,
  });

  renderFull(buildCtx(), currentState);

  initMessageReceiver({
    onStateFull: (msg) => {
      currentState = msg.payload;
      // A successful state:full clears any prior watcher-error chip because
      // we just received fresh data — but it does NOT clear a roster YAML
      // error (that requires a roster:loaded). Track which subtype is active.
      if (currentError && currentError.title === "File-watcher error") {
        currentError = null;
      }
      renderFull(buildCtx(), currentState);
    },
    onStateDelta: () => {
      // M2-05 scope (per backlog AC7 footnote): host only emits state:full.
      // If a delta arrives, we conservatively re-render against the last known
      // state so the UI doesn't drift. Real delta-application is M4 work.
      renderFull(buildCtx(), currentState);
    },
    onRosterLoaded: () => {
      // Roster reloaded successfully → clear any roster-error chip.
      currentError = null;
      renderFull(buildCtx(), currentState);
    },
    onRosterError: (msg) => {
      currentError = {
        level: "error",
        title: "Roster error",
        detail: msg.payload.error,
        showOpenRosterButton: true,
      };
      renderFull(buildCtx(), currentState);
    },
  });
}

// DOM is available immediately because <script> is at end of body. No need
// for DOMContentLoaded — but be defensive in case the script ever moves.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
