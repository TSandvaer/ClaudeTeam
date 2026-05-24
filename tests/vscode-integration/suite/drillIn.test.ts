/**
 * Layer-3 drill-in test (M2-08 AC4).
 *
 * What this catches:
 *   - `vscode.window.showTextDocument` integration broken (URI shape,
 *     scheme handling) when called against a real on-disk file.
 *   - `vscode.workspace.textDocuments` does not include opened JSONLs
 *     after `showTextDocument` resolves — would surface as drill-in
 *     "tab opens but VS Code doesn't track it."
 *
 * Pass criteria (per `team/sage-qa/test-plan-m2.md` §M2-08 AC4):
 *   - Opening a fixture JSONL via the same call path used by
 *     `handleOpenTranscript` (`vscode.window.showTextDocument` with a
 *     `vscode.Uri.file` URI) adds a TextDocument to
 *     `vscode.workspace.textDocuments`.
 *
 * Negative path (per the test plan's negative-path requirement):
 *   - Open a path to a non-existent file → assert `showTextDocument`
 *     rejects. This is the failure mode `handleOpenTranscript`'s
 *     `existsSync` guard prevents from ever reaching VS Code; the
 *     Layer-3 control verifies VS Code itself does reject (so the
 *     `existsSync` guard is meaningful, not redundant).
 *
 * Why not dispatch via the webview message: the WebviewViewProvider
 * instance is held in `activate`'s closure and not exposed via the
 * extension API — there is no Layer-3-accessible handle to post a
 * `ui:open-transcript` message to. The webview-message dispatch
 * (provider._dispatchWebviewMessage → handlers.onOpenTranscript →
 * handleOpenTranscript) is fully covered by:
 *   - `tests/unit/webviewMessageDispatch.test.ts` — message-dispatch unit
 *   - `tests/unit/main.test.ts` — handler unit (slug, session lookup,
 *     non-existent file → showErrorMessage)
 * This Layer-3 test verifies the *VS Code integration* surface that the
 * unit tests cannot — that `showTextDocument` against a live VS Code
 * really does what `handleOpenTranscript` expects.
 *
 * Source: src/extension/main.ts handleOpenTranscript
 *         team/sage-qa/test-plan-m2.md §M2-08
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { asPromise } from "./helpers";

const EXTENSION_ID = "claudeteam.claudeteam";

suite("M2-08 AC4 — Drill-in (vscode.window.showTextDocument integration)", () => {
  let tempRoot: string;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) {
      await ext.activate();
    }
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ct-m2-08-drillin-"));
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test("opening a fixture JSONL adds it to vscode.workspace.textDocuments", async () => {
    // Build a fixture JSONL mirroring the drill-in target shape:
    //   <tempRoot>/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl
    // This is the exact path shape produced by `handleOpenTranscript`.
    const sessionId = "11111111-2222-3333-4444-555555555555";
    const agentId = "abcd1234ef567890";
    const slug = "c--Trunk-PRIVATE-ClaudeTeam";
    const subagentsDir = path.join(
      tempRoot,
      "projects",
      slug,
      sessionId,
      "subagents",
    );
    fs.mkdirSync(subagentsDir, { recursive: true });
    const jsonlPath = path.join(subagentsDir, `agent-${agentId}.jsonl`);
    fs.writeFileSync(
      jsonlPath,
      '{"type":"user","content":"M2-08 fixture line"}\n',
    );

    // Pre-condition: the document is NOT yet in workspace.textDocuments
    // (negative-path setup — we are about to *earn* its presence).
    const beforeUris = vscode.workspace.textDocuments.map((d) =>
      d.uri.fsPath.toLowerCase(),
    );
    assert.ok(
      !beforeUris.includes(jsonlPath.toLowerCase()),
      `Test bug: ${jsonlPath} was already open before the test ran. ` +
        `Pick a fresh tempdir name or close it first.`,
    );

    // Use the exact same call shape as handleOpenTranscript:
    //   vscode.window.showTextDocument(vscode.Uri.file(jsonlPath))
    const editor = await vscode.window.showTextDocument(
      vscode.Uri.file(jsonlPath),
    );
    assert.ok(editor, "showTextDocument returned no editor");

    const afterUris = vscode.workspace.textDocuments.map((d) =>
      d.uri.fsPath.toLowerCase(),
    );
    assert.ok(
      afterUris.includes(jsonlPath.toLowerCase()),
      `After showTextDocument, ${jsonlPath} should appear in ` +
        `vscode.workspace.textDocuments. Saw: ${afterUris.join(", ")}`,
    );

    // Tidy up so subsequent tests start with a clean editor stack.
    await vscode.commands.executeCommand(
      "workbench.action.closeActiveEditor",
    );
  });

  test("NEGATIVE PATH: showTextDocument of a non-existent file rejects", async () => {
    // This is why handleOpenTranscript guards with existsSync — VS Code
    // surfaces a "cannot open" error if the file is missing. Confirm that
    // behavior is still real, so the guard's value remains meaningful.
    const missingPath = path.join(tempRoot, "does-not-exist.jsonl");
    // Defensive: actually confirm the file does NOT exist before asserting.
    assert.ok(
      !fs.existsSync(missingPath),
      `Test bug: ${missingPath} unexpectedly exists`,
    );

    await assert.rejects(
      asPromise(vscode.window.showTextDocument(vscode.Uri.file(missingPath))),
      "Expected showTextDocument on a missing file to reject. " +
        "If VS Code changed this behavior, handleOpenTranscript's existsSync " +
        "guard becomes superfluous and the unit-test contract needs updating.",
    );
  });
});
