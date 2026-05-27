/**
 * Diagnostic panel webview entry point (86c9zn7tm).
 *
 * Renders the tick-history table + current-state breakdown supplied by the
 * extension-host `DiagnosticPanelManager`. Theme-aware (CSS variables),
 * CSP-strict (no inline scripts), JSON-only wire shape.
 *
 * Boot sequence:
 *   1. Locate the #root mount node.
 *   2. Acquire the VS Code webview API. In browser dev mode (no
 *      `acquireVsCodeApi`), substitute a console-logging mock so the UI
 *      can be visually iterated without a host.
 *   3. Wire the message receiver. The host pushes `diagnostic:state`
 *      messages on every tick (unless paused).
 *   4. Send a `ui:diagnostic-refresh` once the receiver is wired — the
 *      pull-based handshake from `vscode-extension-conventions.md`
 *      §"`webview.postMessage` is fire-and-forget — NOT buffered".
 *
 * Source: ClickUp 86c9zn7tm.
 */

import type {
  DiagnosticStateMessage,
  HostMessage,
  WebviewMessage,
} from "../shared/messages.js";
import { renderPanel } from "./render.js";

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
  return {
    postMessage: (msg: WebviewMessage) => {
      // eslint-disable-next-line no-console
      console.log("[claudeteam:diagnostics:dev] postMessage:", msg);
    },
  };
}

/**
 * Webview-local view state. The panel is largely host-driven (the host
 * pushes a fresh `diagnostic:state` on every tick), but a few UI bits are
 * webview-local:
 *
 *   - paused: tracked so the button's label matches reality even if the
 *     host's pause state drifts (e.g. resume-then-immediate-pause races).
 *     The host is authoritative; the webview optimistically updates and
 *     waits for the next push to confirm.
 *   - lastPayload: latest snapshot from the host; held so "Pause" can
 *     freeze the current render and "Resume" can repaint immediately
 *     (without waiting for the next host tick).
 */
interface ViewState {
  paused: boolean;
  lastPayload: DiagnosticStateMessage["payload"] | null;
}

function boot(): void {
  const mount = document.getElementById("root");
  if (!mount) {
    // eslint-disable-next-line no-console
    console.error("[claudeteam:diagnostics] #root element not found");
    return;
  }
  mount.replaceChildren();

  const api = acquireApi();
  const view: ViewState = {
    paused: false,
    lastPayload: null,
  };

  const onPauseToggle = (): void => {
    view.paused = !view.paused;
    api.postMessage({
      type: "ui:diagnostic-pause",
      payload: { paused: view.paused },
    });
    // Re-render so the button reflects the optimistic state immediately.
    render();
  };

  const onClear = (): void => {
    api.postMessage({ type: "ui:diagnostic-clear" });
    // Optimistic local clear so the user sees an empty table before the
    // host's confirmation push lands. The host responds with a fresh
    // snapshot in the next round.
    if (view.lastPayload) {
      view.lastPayload = { ...view.lastPayload, ticks: [] };
      render();
    }
  };

  const onRefresh = (): void => {
    api.postMessage({ type: "ui:diagnostic-refresh" });
  };

  const render = (): void => {
    renderPanel({
      mount,
      payload: view.lastPayload,
      paused: view.paused,
      onPauseToggle,
      onClear,
      onRefresh,
    });
  };

  window.addEventListener("message", (event) => {
    const msg = event.data as HostMessage;
    if (msg && typeof msg === "object" && msg.type === "diagnostic:state") {
      view.lastPayload = msg.payload;
      render();
    }
  });

  // Initial render before any host data arrives — shows the "waiting for
  // the first tick" empty state.
  render();

  // Pull-handshake — see vscode-extension-conventions.md §"`webview.postMessage`
  // is fire-and-forget — NOT buffered". Without this the host's first push
  // from inside `show()` may race the webview listener registration and be
  // dropped, leaving the panel stranded.
  api.postMessage({ type: "ui:diagnostic-refresh" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
