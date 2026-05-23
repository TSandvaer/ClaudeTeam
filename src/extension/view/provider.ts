/**
 * ClaudeTeamViewProvider — WebviewViewProvider for the Activity Bar dashboard.
 *
 * Implements `vscode.WebviewViewProvider` and registers via
 * `vscode.window.registerWebviewViewProvider`. On `resolveWebviewView`:
 *   1. Sets a strict Content-Security-Policy using `webview.cspSource`.
 *   2. Injects the compiled webview bundle via `webview.asWebviewUri`.
 *   3. Returns static placeholder HTML ("ClaudeTeam loading…") — live data
 *      wired in M2-06.
 *
 * CSP rationale: Pixel Agents ships with NO CSP; ClaudeTeam renders
 * user-controlled data (agent descriptions, JSONL paths) and must not
 * replicate that gap. Per Bram's M2-02 research: nonces are NOT needed
 * for M2 because there are no inline scripts — the bundle is injected as
 * a `<script src="...">` using `webview.cspSource`.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Webview rules"
 *         team/bram-research/m2-vscode-prior-art-2026-05-23.md §"Webview CSP"
 */

import * as vscode from "vscode";

/** The view-id registered in package.json contributes.views. */
export const VIEW_ID = "claudeteam.dashboard";

export class ClaudeTeamViewProvider implements vscode.WebviewViewProvider {
  private _view: vscode.WebviewView | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

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
  }

  /** Returns the current WebviewView if resolved; undefined otherwise. */
  get view(): vscode.WebviewView | undefined {
    return this._view;
  }

  private _getHtml(webview: vscode.Webview): string {
    // Resolve the webview bundle URI — the file must exist in dist/webview/
    // after `npm run build`.
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "webview", "main.js"),
    );

    // Content-Security-Policy:
    //   default-src 'none'               — deny everything by default
    //   img-src <cspSource>              — allow extension-local images
    //   style-src <cspSource>            — allow extension-local stylesheets
    //   script-src <cspSource>           — allow the bundled webview script
    //
    // ${webview.cspSource} resolves to the VS Code webview origin
    // (e.g. "vscode-webview://..."), ensuring only our bundle can run.
    // No nonces needed — no inline scripts.
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
  <title>ClaudeTeam</title>
</head>
<body>
  <div id="root">ClaudeTeam loading…</div>
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
