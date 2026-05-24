/**
 * Layer-3 theme switch test (M2-08 AC5).
 *
 * What this catches:
 *   - Changing `workbench.colorTheme` crashes the extension host
 *     (e.g., the provider unsubscribes a webview but a stale message
 *     tries to post afterward → unhandled rejection).
 *   - The extension fails to remain active across a theme toggle.
 *
 * Pass criteria (per `team/sage-qa/test-plan-m2.md` §M2-08 AC5):
 *   - After toggling `workbench.colorTheme` from a dark theme to a light
 *     theme, the extension is still active and the dashboard view's
 *     focus command still resolves without throwing.
 *   - After toggling back to dark, same invariant holds.
 *
 * Negative path (per the test plan's negative-path requirement):
 *   - The view-resolve invariant is asserted in BOTH theme states (dark
 *     AND light), not just one — a test that only checked the post-toggle
 *     dark theme would silently miss a bug that crashes the light path.
 *
 * Webview-iframe limitation: VS Code's Extension API does not expose the
 * webview iframe element from the host process — there is no
 * `WebviewView.iframe` property. The "iframe accessible" assertion called
 * out in the test plan translates at this layer to "the view's focus
 * command still resolves" — i.e., VS Code can re-attach the webview after
 * the theme-change rerender cycle.
 *
 * Source: src/webview/styles/dashboard.css (uses --vscode-* variables)
 *         .claude/docs/vscode-extension-conventions.md "Webview rules"
 *         team/sage-qa/test-plan-m2.md §M2-08
 */

import * as assert from "assert";
import * as vscode from "vscode";

import { asPromise } from "./helpers";

const EXTENSION_ID = "claudeteam.claudeteam";
const VIEW_FOCUS_COMMAND = "claudeteam.dashboard.focus";

// Use built-in VS Code themes that ship with the platform — no extension
// dependency. Names match the labels under Preferences → Color Theme.
const DARK_THEME = "Default Dark Modern";
const LIGHT_THEME = "Default Light Modern";

async function getCurrentTheme(): Promise<string | undefined> {
  return vscode.workspace
    .getConfiguration("workbench")
    .get<string>("colorTheme");
}

async function setTheme(themeName: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("workbench")
    .update(
      "colorTheme",
      themeName,
      vscode.ConfigurationTarget.Global,
    );
  // Give VS Code a beat to propagate the theme change and rerender. The
  // colorTheme update completes synchronously from the API's perspective
  // but the webview-paint cycle is async.
  await new Promise((resolve) => setTimeout(resolve, 200));
}

suite("M2-08 AC5 — Theme switch", () => {
  let originalTheme: string | undefined;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) {
      await ext.activate();
    }
    // Resolve the view at least once so subsequent re-resolves exercise
    // the rebind path (which is what theme-switch can trigger).
    await vscode.commands.executeCommand(VIEW_FOCUS_COMMAND);

    originalTheme = await getCurrentTheme();
  });

  suiteTeardown(async () => {
    // Restore the user's original theme — important when running locally.
    if (originalTheme !== undefined) {
      await setTheme(originalTheme);
    }
  });

  test("switching to dark theme: extension still active + view resolves", async () => {
    await setTheme(DARK_THEME);

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    assert.strictEqual(
      ext.isActive,
      true,
      "Extension deactivated during dark-theme switch",
    );

    await assert.doesNotReject(
      asPromise(vscode.commands.executeCommand(VIEW_FOCUS_COMMAND)),
      "Dashboard view focus threw after switching to dark theme",
    );
  });

  test("switching to light theme: extension still active + view resolves", async () => {
    // NEGATIVE-PATH PAIR: this is the "test BOTH states, not just one"
    // assertion called out by the test plan. A bug that crashed only the
    // light-theme rerender path would slip past a dark-theme-only test.
    await setTheme(LIGHT_THEME);

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    assert.strictEqual(
      ext.isActive,
      true,
      "Extension deactivated during light-theme switch",
    );

    await assert.doesNotReject(
      asPromise(vscode.commands.executeCommand(VIEW_FOCUS_COMMAND)),
      "Dashboard view focus threw after switching to light theme",
    );
  });

  test("toggling back to dark: extension still active + view resolves (rebind stability)", async () => {
    // Round-trip the toggle one more time to exercise the rebind path
    // multiple times — the kind of stress the user inflicts in normal
    // usage when comparing the dashboard's appearance across themes.
    await setTheme(DARK_THEME);

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    assert.strictEqual(
      ext.isActive,
      true,
      "Extension deactivated after toggling back to dark theme",
    );

    await assert.doesNotReject(
      asPromise(vscode.commands.executeCommand(VIEW_FOCUS_COMMAND)),
      "Dashboard view focus threw after toggling back to dark theme",
    );
  });
});
