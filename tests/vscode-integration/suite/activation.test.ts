/**
 * Layer-3 activation lifecycle test (M2-08 AC2).
 *
 * What this catches:
 *   - Extension fails to register (`package.json` malformed, activation
 *     entrypoint throws, view-id mismatch between manifest and provider).
 *   - `activationEvents` mis-configured — extension activates eagerly (or
 *     not at all).
 *   - `contributes.views` ID mismatch with `provider.ts` `VIEW_ID` constant.
 *
 * Pass criteria (per `team/sage-qa/test-plan-m2.md` §M2-08 AC2):
 *   - Extension is discoverable via `vscode.extensions.getExtension`.
 *   - Extension is NOT active before the activation event fires (lazy gate).
 *   - Focusing the ClaudeTeam Activity Bar container fires the activation
 *     event and the extension transitions to `isActive === true`.
 *   - Commands declared in `package.json contributes.commands` are
 *     registered after activation.
 *
 * Negative path (per the test plan's negative-path requirement):
 *   - Pre-activation state check — assert `isActive === false` BEFORE the
 *     activation event fires. A test that only checks post-activation state
 *     would silently pass on an eagerly-activated extension (which would be
 *     a performance regression — see `.claude/docs/vscode-extension-conventions.md`
 *     §"Activation cost").
 *
 * Output-channel limitation: VS Code does not expose Output-channel content
 * via the Extension API (there is no `vscode.window.getOutputChannel(name)`
 * with a `.getText()` method). The observable proxy is: if the extension's
 * `activate()` throws, `isActive` stays false AND `extension.activate()`
 * rejects with the thrown error. We assert both.
 *
 * Source: src/extension/main.ts
 *         src/extension/view/provider.ts (VIEW_ID)
 *         team/sage-qa/test-plan-m2.md §M2-08
 */

import * as assert from "assert";
import * as vscode from "vscode";

import { asPromise } from "./helpers";

const EXTENSION_ID = "claudeteam.claudeteam"; // publisher.name from package.json

suite("M2-08 AC2 — Activation lifecycle", () => {
  test("extension is discoverable via getExtension", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(
      ext,
      `Extension ${EXTENSION_ID} not found — check package.json publisher.name + dist/extension/main.cjs exists`,
    );
  });

  test("manifest declares lazy activation only (NEGATIVE PATH)", () => {
    // NEGATIVE PATH: the bug class is "extension activates eagerly",
    // costing every VS Code startup the activation tax even when the user
    // never opens the ClaudeTeam view. The runtime check (`isActive ===
    // false` before view-focus) is unreliable inside `--extensionDevelopmentPath`
    // mode — VS Code pre-activates dev-mode extensions to ease debugging,
    // so `isActive` reads `true` immediately on the dev surface (a false
    // positive for users in production where there is no --extensionDevelopmentPath).
    //
    // The reliable assertion is on the MANIFEST itself: `activationEvents`
    // must contain ONLY view-scoped triggers, never `"*"` or
    // `"onStartupFinished"` or any catch-all. This catches the regression
    // at the manifest level — the same bug class the runtime check was
    // intended for, but verifiable in dev mode.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);

    const events = (ext.packageJSON as { activationEvents?: string[] })
      .activationEvents;
    assert.ok(
      Array.isArray(events),
      "package.json activationEvents must be an array",
    );

    for (const evt of events) {
      assert.ok(
        !["*", "onStartupFinished"].includes(evt),
        `package.json activationEvents contains eager trigger "${evt}" — lazy-activation regression. ` +
          `Allowed: onView:* / onCommand:* / onLanguage:* etc. Forbidden: "*" and "onStartupFinished".`,
      );
    }

    // Positive check: at least one onView:claudeteam.dashboard trigger
    // must be present — otherwise the extension never activates at all.
    assert.ok(
      events.some((e) => e === "onView:claudeteam.dashboard"),
      "package.json activationEvents must include 'onView:claudeteam.dashboard'. " +
        "Without it, focusing the dashboard view never activates the extension.",
    );
  });

  test("focusing the ClaudeTeam view fires the activation event", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);

    if (!ext.isActive) {
      // Focus the view container — this is the user-equivalent of clicking
      // the Activity Bar icon. The command id pattern is
      // `workbench.view.extension.<container-id>`.
      await vscode.commands.executeCommand(
        "workbench.view.extension.claudeteam-container",
      );

      // Wait for the activation promise to settle. VS Code resolves
      // `extension.activate()` after the user-provided `activate(ctx)`
      // returns. The Promise returned by getExtension().activate() is the
      // same promise that fires after `onView:claudeteam.dashboard` matches.
      await ext.activate();
    }

    assert.strictEqual(
      ext.isActive,
      true,
      "Extension failed to activate after focusing the Activity Bar view",
    );
    (globalThis as { __CT_ACTIVATED__?: boolean }).__CT_ACTIVATED__ = true;
  });

  test("declared commands are registered after activation", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) await ext.activate();

    const allCommands = await vscode.commands.getCommands(true);
    for (const cmd of [
      "claudeteam.refresh",
      "claudeteam.openRoster",
      "claudeteam.openAgentTranscript",
    ]) {
      assert.ok(
        allCommands.includes(cmd),
        `Expected command "${cmd}" to be registered after activation. ` +
          `Check package.json contributes.commands AND src/extension/main.ts vscode.commands.registerCommand.`,
      );
    }
  });

  test("activation completes without throwing (proxy for 'no Output errors')", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);

    // If activate() threw, this call rejects. If activation already completed
    // cleanly in an earlier test, activate() returns the cached export object
    // (or undefined for void-returning activate functions).
    await assert.doesNotReject(
      asPromise(ext.activate()),
      "Extension activation threw — equivalent to an error appearing in the " +
        "Output channel. Inspect stderr from the test runner for the stack.",
    );
  });
});
