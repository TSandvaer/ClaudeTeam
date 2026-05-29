/**
 * ClaudeTeamViewProvider — WebviewViewProvider for the Activity Bar dashboard.
 *
 * Implements `vscode.WebviewViewProvider` and registers via
 * `vscode.window.registerWebviewViewProvider`. On `resolveWebviewView`:
 *   1. Sets a strict Content-Security-Policy using `webview.cspSource`.
 *   2. Injects the compiled webview bundle via `webview.asWebviewUri`.
 *   3. Registers an `onDidReceiveMessage` listener that dispatches typed
 *      `WebviewMessage` objects to the per-type handler (M2-06 AC2).
 *   4. Invokes the `onResolved` callback so the activation flow can wire
 *      the file-watcher loop to this specific `vscode.Webview` instance.
 *
 * CSP rationale: Pixel Agents ships with NO CSP; ClaudeTeam renders
 * user-controlled data (agent descriptions, JSONL paths) and must not
 * replicate that gap. Per Bram's M2-02 research: nonces are NOT needed
 * for M2 because there are no inline scripts — the bundle is injected as
 * a `<script src="...">` using `webview.cspSource`.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Webview rules" +
 *         "Message protocol"
 *         team/bram-research/m2-vscode-prior-art-2026-05-23.md §"Webview CSP"
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC2
 */

import * as vscode from "vscode";

import type {
  AssignCharacterMessage,
  ConfirmOrphanDeleteMessage,
  DismissSetupSuggestionMessage,
  HideMemberMessage,
  OpenManageTeamMessage,
  OpenRosterMessage,
  OpenTranscriptMessage,
  RefreshMessage,
  RemoveMemberMessage,
  RunSetupMessage,
  SaveTeamMessage,
  ShowAllHiddenMessage,
  ShowMemberMessage,
  WebviewMessage,
} from "../../shared/messages.js";

/** The view-id registered in package.json contributes.views. */
export const VIEW_ID = "claudeteam.dashboard";

/**
 * Optional callback invoked once the webview view resolves. Used by the
 * extension host's activation flow to kick off the file-watcher loop only
 * when the view is actually visible (avoids paying the cost on every
 * extension activation event).
 */
export type ViewResolvedHandler = (webview: vscode.Webview) => void;

/**
 * Per-type handlers for `WebviewMessage` (webview → host). All optional —
 * a missing handler means the corresponding message is silently dropped
 * (with a warning logged in `onUnknown`'s default).
 *
 * Wired from `main.ts` so the activation flow controls the actual side
 * effects (open document, refresh watcher) — the provider only does the
 * type-dispatch.
 */
export interface WebviewMessageHandlers {
  onOpenTranscript?(msg: OpenTranscriptMessage): void;
  onOpenRoster?(msg: OpenRosterMessage): void;
  onRefresh?(msg: RefreshMessage): void;
  /**
   * User hid a rostered member (E-06a `ui:hide-member`). Host adds the
   * `(teamId, memberId)` pair to the persisted hidden-member set + triggers a
   * tick.
   */
  onHideMember?(msg: HideMemberMessage): void;
  /**
   * User un-hid a single rostered member (E-06a `ui:show-member`). Host
   * removes the pair from the persisted set + triggers a tick.
   */
  onShowMember?(msg: ShowMemberMessage): void;
  /**
   * User clicked "show all" on the hidden-members chip (E-06a
   * `ui:show-all-hidden`). Host clears the entire persisted set + triggers a
   * tick.
   */
  onShowAllHidden?(msg: ShowAllHiddenMessage): void;
  /**
   * User removed a rostered member (E-07a `ui:remove-member`). Host adds the
   * `(teamId, memberId)` pair to the persisted REMOVED-member set + triggers a
   * tick. More permanent than hide — no symmetric un-remove handler (restore is
   * yaml-gated; see `RemovedMembersStore`).
   */
  onRemoveMember?(msg: RemoveMemberMessage): void;
  /**
   * Team-setup epic (TS-02 Pt-2 wires the side effects; this provider only
   * dispatches). Maya's TS-03 webview emits these; Felix's host handlers
   * generate/write `claudeteam.yaml` + ack via `setup:config-saved`.
   */
  onOpenManageTeam?(msg: OpenManageTeamMessage): void;
  onRunSetup?(msg: RunSetupMessage): void;
  onSaveTeam?(msg: SaveTeamMessage): void;
  onAssignCharacter?(msg: AssignCharacterMessage): void;
  onConfirmOrphanDelete?(msg: ConfirmOrphanDeleteMessage): void;
  onDismissSetupSuggestion?(msg: DismissSetupSuggestionMessage): void;
  /** Called for messages that don't match a known discriminator. */
  onUnknown?(raw: unknown): void;
}

export class ClaudeTeamViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;
  private _onResolved: ViewResolvedHandler | undefined;
  private _messageHandlers: WebviewMessageHandlers = {};

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /**
   * Register a callback that fires when `resolveWebviewView` runs.
   *
   * The callback receives the live `vscode.Webview` and can use it as the
   * sink for posted state messages. Replacing an existing handler is
   * supported (last-write-wins) — useful in tests but should not happen in
   * production where `activate` registers exactly once.
   */
  onResolved(handler: ViewResolvedHandler): void {
    this._onResolved = handler;
  }

  /**
   * Register the per-type handlers for `WebviewMessage` (webview → host).
   * Replaces any prior handler set (last-write-wins). Handlers are invoked
   * inside the `onDidReceiveMessage` listener attached in `resolveWebviewView`.
   */
  setMessageHandlers(handlers: WebviewMessageHandlers): void {
    this._messageHandlers = handlers;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      // Restrict the webview to only load resources from the extension's
      // dist/webview directory and the VS Code built-in resource origin.
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "dist", "webview"),
      ],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // Wire the webview → host message dispatch (M2-06 AC2). The listener's
    // disposable is owned by the WebviewView itself — VS Code disposes it
    // when the view is disposed. No need to push onto context.subscriptions.
    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      this._dispatchWebviewMessage(raw);
    });

    // Notify the activation flow that the webview is live. The file-watcher
    // loop is wired here. The handler is invoked AFTER the HTML is set and
    // AFTER the message listener is attached, so any state initial state
    // posted from it lands cleanly.
    if (this._onResolved) {
      try {
        this._onResolved(webviewView.webview);
      } catch (err) {
        // Defensive: don't let a downstream handler error break view init.
        console.error(
          `[claudeteam] onResolved handler threw: ${(err as Error).message}`,
        );
      }
    }
  }

  /** Returns the current WebviewView if resolved; undefined otherwise. */
  get view(): vscode.WebviewView | undefined {
    return this._view;
  }

  /**
   * Type-guard + dispatch for `WebviewMessage`. Exposed via prototype only —
   * external callers should use `setMessageHandlers` to register, not call
   * this directly. Exported for tests via the `_dispatchWebviewMessage` name.
   */
  _dispatchWebviewMessage(raw: unknown): void {
    if (!isWebviewMessage(raw)) {
      const unknownHandler =
        this._messageHandlers.onUnknown ?? defaultUnknownHandler;
      unknownHandler(raw);
      return;
    }
    switch (raw.type) {
      case "ui:open-transcript":
        this._messageHandlers.onOpenTranscript?.(raw);
        return;
      case "ui:open-roster":
        this._messageHandlers.onOpenRoster?.(raw);
        return;
      case "ui:refresh":
        this._messageHandlers.onRefresh?.(raw);
        return;
      case "ui:hide-member":
        this._messageHandlers.onHideMember?.(raw);
        return;
      case "ui:show-member":
        this._messageHandlers.onShowMember?.(raw);
        return;
      case "ui:show-all-hidden":
        this._messageHandlers.onShowAllHidden?.(raw);
        return;
      case "ui:remove-member":
        this._messageHandlers.onRemoveMember?.(raw);
        return;
      case "ui:open-manage-team":
        this._messageHandlers.onOpenManageTeam?.(raw);
        return;
      case "ui:run-setup":
        this._messageHandlers.onRunSetup?.(raw);
        return;
      case "ui:save-team":
        this._messageHandlers.onSaveTeam?.(raw);
        return;
      case "ui:assign-character":
        this._messageHandlers.onAssignCharacter?.(raw);
        return;
      case "ui:confirm-orphan-delete":
        this._messageHandlers.onConfirmOrphanDelete?.(raw);
        return;
      case "ui:dismiss-setup-suggestion":
        this._messageHandlers.onDismissSetupSuggestion?.(raw);
        return;
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    // Resolve the webview bundle + stylesheet URIs — both files must exist in
    // dist/webview/ after `npm run build` (the esbuild config emits both).
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        "dist",
        "webview",
        "dashboard.css",
      ),
    );

    // Sprite base URI (whole-team-display 86ca191uy): the webview resolves
    // persona pixel-character frame paths (`sprites/<char>/...`) against this.
    // Points at the dist/webview directory (where the build copies the sprite
    // PNG tree) — already under localResourceRoots, so frames load under the
    // same `${webview.cspSource}` origin the CSP's `img-src` permits. Passed
    // as a `data-` attribute on #root (NOT an inline script — CSP-strict).
    const spriteBaseUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview"),
    );

    // Content-Security-Policy:
    //   default-src 'none'               — deny everything by default
    //   img-src <cspSource>              — allow extension-local images
    //   style-src <cspSource>            — allow extension-local stylesheets
    //   script-src <cspSource>           — allow the bundled webview script
    //
    // ${webview.cspSource} resolves to the VS Code webview origin
    // (e.g. "vscode-webview://..."), ensuring only our bundle can run.
    // No nonces needed — no inline scripts AND no inline styles. The
    // dashboard's CSS is loaded via <link rel="stylesheet"> from the same
    // cspSource origin.
    //
    // Source: VS Code docs https://code.visualstudio.com/api/extension-guides/webview#content-security-policy
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
  <title>ClaudeTeam</title>
</head>
<body>
  <div id="root" data-sprite-base="${spriteBaseUri}">ClaudeTeam loading…</div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Derive the extension's installation directory from a module path.
   * Used by tests that construct a provider with a known path.
   */
  static fromExtensionPath(extensionPath: string): ClaudeTeamViewProvider {
    return new ClaudeTeamViewProvider(vscode.Uri.file(extensionPath));
  }
}

/**
 * Structural type-guard for `WebviewMessage`. Validates the discriminator
 * and the minimum shape — the handler is responsible for any deeper payload
 * checks. Exported for tests.
 */
export function isWebviewMessage(raw: unknown): raw is WebviewMessage {
  if (typeof raw !== "object" || raw === null) return false;
  const t = (raw as { type?: unknown }).type;
  if (t === "ui:refresh" || t === "ui:open-roster") {
    return true;
  }
  if (t === "ui:open-transcript") {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const { sessionId, agentId } = p as {
      sessionId?: unknown;
      agentId?: unknown;
    };
    return typeof sessionId === "string" && typeof agentId === "string";
  }
  // E-06a (EPIC 86ca11187 §7.2): hide / show a single member carry a
  // `{ teamId, memberId }` pair; show-all carries no payload.
  // E-07a (EPIC 86ca11187 §7.3): ui:remove-member carries the same
  // `{ teamId, memberId }` pair shape as hide / show.
  if (
    t === "ui:hide-member" ||
    t === "ui:show-member" ||
    t === "ui:remove-member"
  ) {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const { teamId, memberId } = p as {
      teamId?: unknown;
      memberId?: unknown;
    };
    return typeof teamId === "string" && typeof memberId === "string";
  }
  if (t === "ui:show-all-hidden") {
    return true;
  }
  // Team-setup epic — no-payload webview→host messages.
  if (t === "ui:open-manage-team" || t === "ui:dismiss-setup-suggestion") {
    return true;
  }
  // ui:run-setup { include: string[] }
  if (t === "ui:run-setup") {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const { include } = p as { include?: unknown };
    return Array.isArray(include) && include.every((x) => typeof x === "string");
  }
  // ui:save-team { config: ClaudeTeamConfig } — structural guard on config
  // being a versioned object with a teams array (deep validation is the host
  // handler's / zod schema's job, mirroring how ui:open-transcript only checks
  // the discriminator-adjacent shape).
  if (t === "ui:save-team") {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const { config } = p as { config?: unknown };
    if (typeof config !== "object" || config === null) return false;
    const { version, teams } = config as { version?: unknown; teams?: unknown };
    return typeof version === "number" && Array.isArray(teams);
  }
  // ui:assign-character { memberId: string; character: string | null }
  if (t === "ui:assign-character") {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const { memberId, character } = p as {
      memberId?: unknown;
      character?: unknown;
    };
    return (
      typeof memberId === "string" &&
      (character === null || typeof character === "string")
    );
  }
  // ui:confirm-orphan-delete { memberId: string }
  if (t === "ui:confirm-orphan-delete") {
    const p = (raw as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return false;
    const { memberId } = p as { memberId?: unknown };
    return typeof memberId === "string";
  }
  return false;
}

function defaultUnknownHandler(raw: unknown): void {
  console.warn("[claudeteam.provider] unknown webview message shape:", raw);
}

/**
 * Extracts the Content-Security-Policy meta-tag content from the HTML string
 * produced by `_getHtml`. Exported for Self-Test Report verification.
 *
 * Returns the CSP string, or null if not found.
 */
export function extractCsp(html: string): string | null {
  // The meta tag may span multiple lines (template literal format in _getHtml).
  // Use dotAll (`s`) flag so `.` matches newlines. The content attribute is
  // always double-quoted in our HTML template; use `[^"]+` as the terminator
  // so the CSP value (which contains single quotes from `'none'`) is matched
  // in full.
  const match = html.match(
    /<meta\s[\s\S]*?http-equiv=["']Content-Security-Policy["'][\s\S]*?content="([^"]+)"/is,
  );
  return match?.[1] ?? null;
}
