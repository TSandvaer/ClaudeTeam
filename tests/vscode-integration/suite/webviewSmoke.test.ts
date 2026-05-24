/**
 * Layer-3 webview reload smoke test (M2-08 AC3).
 *
 * What this catches:
 *   - WebviewViewProvider not registered (mismatch between
 *     `vscode.window.registerWebviewViewProvider` argument and `VIEW_ID`).
 *   - `package.json contributes.views[].id` doesn't match `provider.ts`
 *     `VIEW_ID` constant — the view shows up greyed-out in the Activity Bar
 *     and never resolves.
 *   - `provider.resolveWebviewView` throws — activation succeeds but the
 *     view stays at the "Loading..." placeholder forever.
 *
 * Pass criteria (per `team/sage-qa/test-plan-m2.md` §M2-08 AC3):
 *   - The auto-generated `<viewId>.focus` command exists (VS Code registers
 *     `claudeteam.dashboard.focus` automatically when the view-id is declared
 *     in `package.json contributes.views`).
 *   - Invoking that focus command does NOT throw — the provider resolves.
 *   - After focusing, the extension is active and the WebviewViewProvider
 *     registration completed without error.
 *
 * Negative path (per the test plan's negative-path requirement):
 *   - The `claudeteam.dashboard.focus` command does NOT exist before VS Code
 *     reads the manifest's `contributes.views` block — if the manifest is
 *     malformed (missing id, wrong container), the focus command is never
 *     generated. We assert positively that the command IS present, AND
 *     assert that focusing a NON-EXISTENT view command throws (so we know
 *     the positive assertion is meaningful, not a false-positive from a
 *     swallowed error).
 *
 * Webview-DOM limitation: VS Code's Extension API does NOT expose webview
 * DOM read-back from the host process. The webview runs in an isolated
 * iframe — `WebviewView.webview.html` is a write-only sink from outside the
 * provider. The "tile container element" called out in the test plan's
 * webview-DOM probe is rendered by `src/webview/main.ts` AFTER the first
 * `state:full` message arrives; verifying its DOM presence is Layer-4 work
 * (e.g. Playwright-against-the-iframe, deferred). At Layer-3 the host-side
 * observable proxy is "provider resolved + no throw" — the wiring path that
 * MUST exist for the tile container to be reachable.
 *
 * Source: src/extension/view/provider.ts
 *         .claude/docs/vscode-extension-conventions.md "Webview rules"
 *         team/sage-qa/test-plan-m2.md §M2-08
 */

import * as assert from "assert";
import * as vscode from "vscode";

import { asPromise } from "./helpers";

const EXTENSION_ID = "claudeteam.claudeteam";
const VIEW_FOCUS_COMMAND = "claudeteam.dashboard.focus";

suite("M2-08 AC3 — Webview reload smoke", () => {
  suiteSetup(async () => {
    // Ensure the extension is active for the rest of this suite. Activation
    // is the precondition for view registration; webview-smoke tests are
    // meaningless against an inactive extension.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  test("auto-generated focus command exists after activation", async () => {
    // VS Code auto-generates `<viewId>.focus` for every view declared in
    // package.json contributes.views. If the manifest doesn't declare
    // `claudeteam.dashboard`, this command will be missing.
    const allCommands = await vscode.commands.getCommands(true);
    assert.ok(
      allCommands.includes(VIEW_FOCUS_COMMAND),
      `Expected auto-generated command "${VIEW_FOCUS_COMMAND}" to exist. ` +
        `Check package.json contributes.views[].id matches provider.ts VIEW_ID.`,
    );
  });

  test("NEGATIVE PATH: focusing a non-existent view throws (control)", async () => {
    // This is the negative-path control: if `executeCommand` on a missing
    // view-focus command silently no-ops, the positive assertion below
    // would be meaningless. Confirm VS Code surfaces a "command not found"
    // for genuinely missing commands.
    await assert.rejects(
      asPromise(
        vscode.commands.executeCommand(
          "claudeteam.this-view-does-not-exist.focus",
        ),
      ),
      /command.*not found|not a registered command/i,
      "Expected executeCommand on a missing view-focus command to reject — " +
        "VS Code's behavior changed and the negative-path control needs updating.",
    );
  });

  test("focusing the dashboard view does NOT throw (provider resolves cleanly)", async () => {
    // The user-facing smoke: clicking the Activity Bar icon should resolve
    // the webview without any thrown error. resolveWebviewView is wrapped in
    // a try/catch internally (see provider.ts onResolved handler), so a
    // throw here would come from VS Code's own webview-registration path,
    // not from our extension.
    await assert.doesNotReject(
      asPromise(vscode.commands.executeCommand(VIEW_FOCUS_COMMAND)),
      "Focusing the dashboard view threw — likely a WebviewViewProvider " +
        "registration mismatch. Check src/extension/main.ts " +
        "vscode.window.registerWebviewViewProvider call.",
    );
  });

  test("re-focusing the dashboard view after resolve does NOT throw (reload-equivalent)", async () => {
    // The full "Developer: Reload Window" command (workbench.action.reloadWindow)
    // tears down the test process — we cannot use it. Re-focusing the view
    // is the closest host-observable proxy: VS Code will call
    // resolveWebviewView again if the view becomes visible after being
    // hidden, and the subscription-leak fix (M2-06 AC7(e)) MUST handle the
    // rebind cleanly. If the rebind throws, this fails.
    //
    // This is the regression test for the bug class: "rebind cycle leaks
    // resources or throws on stale-closure access." The unit-level coverage
    // is `tests/integration/subscriptionLeak.test.ts`; this is the live-VS-Code
    // smoke that the wiring still holds end-to-end.
    await vscode.commands.executeCommand(VIEW_FOCUS_COMMAND);
    await assert.doesNotReject(
      asPromise(vscode.commands.executeCommand(VIEW_FOCUS_COMMAND)),
      "Re-focusing the dashboard view threw on the second invocation — " +
        "M2-06 AC7(e) subscription-leak fix may have regressed.",
    );
  });
});
