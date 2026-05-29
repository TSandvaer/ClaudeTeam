/**
 * `claudeteam.openSettings` command (86ca16r2d).
 *
 * Opens VS Code's native Settings UI pre-filtered to ClaudeTeam's
 * `contributes.configuration` properties via the `@ext:<publisher>.<name>`
 * query. Surfaced as a gear icon in the Dashboard view's title bar
 * (`contributes.menus` → `view/title`, `group: navigation`) per the sponsor
 * request — a one-click route from the dashboard to its own settings without
 * hunting through the global Settings tree.
 *
 * ## The `@ext:` query (anti-fabrication — verified, not assumed)
 *
 * VS Code's `workbench.action.openSettings` accepts a query string. The
 * `@ext:<publisher>.<name>` form scopes the Settings UI to a single
 * extension's contributed configuration. The exact value is derived from
 * `package.json`:
 *   - `publisher` = `"claudeteam"`
 *   - `name`      = `"claudeteam"`
 *   => query = `"@ext:claudeteam.claudeteam"`
 *
 * This matches the installed extension folder `claudeteam.claudeteam-0.0.1`
 * and the `EXTENSION_ID` constant used by the Layer-3 activation test
 * (`tests/vscode-integration/suite/activation.test.ts:42`,
 * `"claudeteam.claudeteam"`). The constant below is exported so the unit
 * test pins it against the live `package.json` values rather than a
 * hard-coded literal — if the publisher or name ever changes, the test
 * fails loudly instead of silently opening an unfiltered Settings pane.
 *
 * ## OOS
 *
 * No in-webview settings surface and no new configuration keys — this
 * command only routes to the existing native Settings UI.
 *
 * Source: ClickUp 86ca16r2d
 *         .claude/docs/vscode-extension-conventions.md §"Extension manifest essentials"
 */

import * as vscode from "vscode";

/**
 * The Settings-UI filter query that scopes the native Settings pane to
 * ClaudeTeam's contributed configuration. Format: `@ext:<publisher>.<name>`.
 *
 * Exported so the unit test can assert it matches the live `package.json`
 * `publisher` + `name` fields (anti-fabrication guard — see module docstring).
 */
export const SETTINGS_QUERY = "@ext:claudeteam.claudeteam";

/**
 * Run the `claudeteam.openSettings` command: open the native Settings UI
 * filtered to ClaudeTeam's configuration. Surfaces any failure via
 * `vscode.window.showErrorMessage` and NEVER throws — a title-bar gear click
 * should not bubble a stack trace to the user.
 *
 * Exported for unit tests.
 */
export async function openSettings(): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      SETTINGS_QUERY,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: failed to open settings: ${(err as Error).message}`,
    );
  }
}

/**
 * Register the `claudeteam.openSettings` command on the extension context.
 * Pushes the resulting `Disposable` onto `context.subscriptions` for cleanup
 * on deactivate.
 *
 * Returns the `Disposable` so callers (and tests) can hold a reference
 * without going through `context.subscriptions`.
 */
export function registerOpenSettingsCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand(
    "claudeteam.openSettings",
    () => {
      void openSettings();
    },
  );
  context.subscriptions.push(disposable);
  return disposable;
}
