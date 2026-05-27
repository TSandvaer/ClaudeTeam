/**
 * Diagnostic webview panel — interactive companion to the Output channel
 * (86c9zn7tm).
 *
 * The Output channel (PR #92 / 86c9zn7vw) is good for tail-and-grep. The
 * panel exposes the same per-tick data as a structured, refreshable editor
 * tab: a tick-history table (timestamp + tick # + duration + emitted +
 * transitions count), the current state breakdown by session (agents +
 * their current state / activity / model), and the verbose-mode chip.
 *
 * ## Surface choice — WebviewPanel (editor tab), not WebviewView
 *
 * The activity-bar dashboard pane (Maya's primary surface) is intentionally
 * narrow — the diagnostic panel is a much wider tabular view. Opening it as
 * a `vscode.WebviewPanel` puts it in the editor area where the user can
 * split-pane it next to the JSONL transcript they're inspecting, or pull it
 * out into a separate VS Code window. The dashboard pane stays focused on
 * "what's happening right now" while the panel becomes "what just happened
 * and why."
 *
 * ## Auto-refresh — tick-driven push, with explicit pause
 *
 * The panel subscribes to the diagnostic channel's `subscribe(listener)` API
 * which fires on every watcher tick. Posting a `diagnostic:state` per tick
 * matches the dashboard cadence the user already understands. The "Pause"
 * button in the panel header stops pushes (ring buffer keeps filling on the
 * host); "Resume" sends a fresh snapshot immediately so the panel catches
 * up. The webview-initiated `ui:diagnostic-refresh` is the boot handshake
 * (pull pattern — see `vscode-extension-conventions.md` §"`webview.postMessage`
 * is fire-and-forget — NOT buffered") AND the manual-refresh button when
 * paused.
 *
 * ## Singleton — opening twice reveals the existing panel
 *
 * The command `claudeteam.openDiagnosticPanel` is idempotent. If a panel
 * is already open, it gets revealed (`panel.reveal()`) rather than opening
 * a second one. This matches the user's mental model — "open the
 * diagnostic panel" doesn't mean "open another one."
 *
 * ## CSP, theme, JSON wire shape
 *
 * Same discipline as the dashboard webview:
 *   - Strict CSP using `webview.cspSource` — no inline scripts.
 *   - `--vscode-*` theme variables for every color that isn't semantically
 *     state-coded.
 *   - JSON-safe payloads only (Maps flatten to objects); the panel reuses
 *     `SerializedDashboardState` from `src/shared/messages.ts`.
 *
 * Source: ClickUp 86c9zn7tm + `.claude/docs/vscode-extension-conventions.md`
 */

import * as vscode from "vscode";

import type {
  DiagnosticChannel,
  DiagnosticSnapshot,
  TickHistoryEntry,
} from "./output.js";
import type {
  DiagnosticClearMessage,
  DiagnosticPauseMessage,
  DiagnosticRefreshMessage,
  DiagnosticStateMessage,
  DiagnosticTickHistoryEntry,
} from "../../shared/messages.js";
import { serializeState } from "../messageBus.js";

/**
 * Panel webview type-id — passed to `vscode.window.createWebviewPanel` and
 * also used by VS Code if the panel needs to be revived after a window
 * reload (we do NOT implement `WebviewPanelSerializer` in V1; the panel is
 * re-creatable on demand via the command, so reload simply closes it).
 */
export const DIAGNOSTIC_PANEL_VIEW_TYPE = "claudeteam.diagnosticPanel";

/** Panel title — shown in the editor tab label. */
export const DIAGNOSTIC_PANEL_TITLE = "ClaudeTeam Diagnostics";

/**
 * Options accepted by {@link createDiagnosticPanelManager}. Dependency-
 * injected so the unit tests don't need a real VS Code instance — Felix's
 * `output.ts` follows the same pattern.
 */
export interface CreateDiagnosticPanelManagerOptions {
  /** The diagnostic channel exposing tick history + per-tick subscriptions. */
  diagnosticChannel: DiagnosticChannel;
  /**
   * Resolver for the `claudeteam.diagnostic.verbose` setting. Used to stamp
   * the verbose-chip on the wire so the panel header reflects the current
   * Output-channel state. Read fresh per push.
   */
  isVerbose: () => boolean;
  /**
   * Factory for the underlying VS Code webview panel. Defaults to
   * `vscode.window.createWebviewPanel`; tests substitute a fake.
   */
  createPanel?: (
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn,
    options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
  ) => vscode.WebviewPanel;
  /**
   * Resolver for the extension URI — used to scope webview local resources
   * to the extension's `dist/diagnostics` directory. In tests the resolver
   * may return any URI; the panel does not load resources in tests.
   */
  extensionUri: vscode.Uri;
}

/**
 * Diagnostic-panel manager. The orchestrator wiring in `main.ts` keeps a
 * single instance for the extension's lifetime and disposes it via the
 * activate-level `context.subscriptions` cleanup wrapper.
 *
 * `show()` is idempotent — calling it twice reveals the existing panel.
 */
export interface DiagnosticPanelManager extends vscode.Disposable {
  /**
   * Open (or reveal) the diagnostic panel. The first call creates the
   * panel + subscribes to tick events; subsequent calls reveal it. Returns
   * the underlying `vscode.WebviewPanel` for tests.
   */
  show(): vscode.WebviewPanel;
  /**
   * Whether the panel is currently open. False before `show()` is called
   * and after the user closes the panel's editor tab.
   */
  isOpen(): boolean;
}

/**
 * Construct a panel manager. The panel is NOT created eagerly — only the
 * first `show()` call allocates the underlying webview, so a user who
 * never opens the panel pays zero cost beyond the manager object itself.
 *
 * Idempotent disposal — `dispose()` may be called twice.
 */
export function createDiagnosticPanelManager(
  opts: CreateDiagnosticPanelManagerOptions,
): DiagnosticPanelManager {
  const createPanel =
    opts.createPanel ??
    ((viewType, title, showOptions, panelOpts) =>
      vscode.window.createWebviewPanel(viewType, title, showOptions, panelOpts));

  let panel: vscode.WebviewPanel | null = null;
  let tickSubscription: vscode.Disposable | null = null;
  let paused = false;
  let disposed = false;

  /**
   * Serialize a snapshot to the wire shape posted to the panel. Pure —
   * exported via the snapshot accessor inside `show()` for unit-test
   * direct invocation.
   */
  const toWire = (snap: DiagnosticSnapshot): DiagnosticStateMessage["payload"] => ({
    ticks: snap.ticks.map(toWireTick),
    state: snap.state === null ? null : serializeState(snap.state),
    verbose: opts.isVerbose(),
  });

  /** Post a state snapshot to the panel. No-op when panel isn't open. */
  const post = (): void => {
    if (panel === null) return;
    const msg: DiagnosticStateMessage = {
      type: "diagnostic:state",
      payload: toWire(opts.diagnosticChannel.getSnapshot()),
    };
    try {
      void panel.webview.postMessage(msg);
    } catch (err) {
      // Panel disposed mid-flight; same defensive pattern as messageBus.
      console.warn(
        `[claudeteam.diagnosticPanel] postMessage failed: ${(err as Error).message}`,
      );
    }
  };

  const handleWebviewMessage = (raw: unknown): void => {
    if (!isPanelMessage(raw)) {
      console.warn("[claudeteam.diagnosticPanel] unknown webview message:", raw);
      return;
    }
    switch (raw.type) {
      case "ui:diagnostic-clear":
        opts.diagnosticChannel.clearHistory();
        // Re-post so the panel's view of the ring buffer matches the host
        // (now empty). Without this push the panel would still show the
        // pre-clear entries until the next tick.
        post();
        return;
      case "ui:diagnostic-pause":
        paused = raw.payload.paused;
        // On resume, send the latest snapshot so the panel catches up to
        // anything that landed while paused.
        if (!paused) post();
        return;
      case "ui:diagnostic-refresh":
        post();
        return;
    }
  };

  return {
    show(): vscode.WebviewPanel {
      if (disposed) {
        throw new Error("diagnostic panel manager has been disposed");
      }
      if (panel !== null) {
        panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Active);
        return panel;
      }
      const created = createPanel(
        DIAGNOSTIC_PANEL_VIEW_TYPE,
        DIAGNOSTIC_PANEL_TITLE,
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          // Persist the webview across editor-tab moves so the user's
          // scroll position / pause state survives drag-and-drop between
          // editor groups. Negligible memory cost at the panel's scale.
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(opts.extensionUri, "dist", "diagnostics"),
          ],
        },
      );
      panel = created;
      created.webview.html = renderPanelHtml(
        created.webview,
        opts.extensionUri,
      );
      created.webview.onDidReceiveMessage(handleWebviewMessage);
      created.onDidDispose(() => {
        // Tear down per-panel state. The manager remains usable — a
        // subsequent `show()` will allocate a fresh panel.
        tickSubscription?.dispose();
        tickSubscription = null;
        panel = null;
        paused = false;
      });

      // Subscribe to tick events AFTER wiring the message listener so the
      // panel's webview-initiated boot pull (ui:diagnostic-refresh) and
      // any in-flight ticks both find a receiver.
      tickSubscription = opts.diagnosticChannel.subscribe(() => {
        if (paused) return;
        post();
      });

      return created;
    },
    isOpen(): boolean {
      return panel !== null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      tickSubscription?.dispose();
      tickSubscription = null;
      panel?.dispose();
      panel = null;
    },
  };
}

/**
 * Convert a host-side `TickHistoryEntry` to its JSON-safe wire shape. The
 * conversion is structurally identical (all fields are JSON primitives
 * already) — the wrapping function exists to make the boundary explicit and
 * to let the wire type evolve independently of the in-memory type without
 * a sweep of the panel manager.
 *
 * Exported for unit-test coverage.
 */
export function toWireTick(entry: TickHistoryEntry): DiagnosticTickHistoryEntry {
  return {
    tickNumber: entry.tickNumber,
    timestampMs: entry.timestampMs,
    durationMs: entry.durationMs,
    emitted: entry.emitted,
    transitions: entry.transitions.map((t) => ({
      sessionShortId: t.sessionShortId,
      agentShortId: t.agentShortId,
      sessionId: t.sessionId,
      agentId: t.agentId,
      prev: t.prev,
      next: t.next,
    })),
  };
}

/**
 * Type-guard for `WebviewMessage` variants the panel cares about. Mirrors
 * the dashboard's `isWebviewMessage` discipline — the manager validates the
 * discriminator before dispatching. Exported for tests.
 */
export function isPanelMessage(
  raw: unknown,
): raw is DiagnosticClearMessage | DiagnosticPauseMessage | DiagnosticRefreshMessage {
  if (typeof raw !== "object" || raw === null) return false;
  const t = (raw as { type?: unknown }).type;
  if (t === "ui:diagnostic-clear" || t === "ui:diagnostic-refresh") return true;
  if (t === "ui:diagnostic-pause") {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const paused = (p as { paused?: unknown }).paused;
    return typeof paused === "boolean";
  }
  return false;
}

/**
 * Render the panel HTML — same discipline as the dashboard webview
 * (`ClaudeTeamViewProvider._getHtml`). CSP-strict, no inline scripts.
 *
 * Exported for tests so the CSP block can be regression-checked without
 * spinning up a real webview.
 */
export function renderPanelHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "diagnostics", "main.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "diagnostics", "panel.css"),
  );

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src ${webview.cspSource}`,
  ].join("; ");

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="${csp}"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>ClaudeTeam Diagnostics</title>
</head>
<body>
  <div id="root">ClaudeTeam diagnostics loading…</div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

