/**
 * Layer-3 test entry point (M2-08).
 *
 * Spawns a real VS Code instance via `@vscode/test-electron`, loading the
 * compiled extension from `dist/extension/main.js` and the compiled test
 * suite from `out/vscode-integration/tests/vscode-integration/suite/index.js`.
 *
 * Pre-requisites (enforced by the `pretest:vscode` npm script):
 *   1. `npm run build` has produced `dist/extension/main.js` and the webview
 *      bundle in `dist/webview/`.
 *   2. `tsc -p tsconfig.vscode-integration.json` has compiled the test sources
 *      to `out/vscode-integration/`.
 *
 * VS Code download caches under `.vscode-test/` (gitignored). First run is
 * slow (~30-60s); subsequent runs reuse the cache.
 *
 * Headless-CI rationale: the test plan (`team/sage-qa/test-plan-m2.md`
 * §"Layer-3 coverage targets") calls for green-on-CI on PRs to main. On
 * Ubuntu Actions runners VS Code needs `xvfb-run -a` because the test
 * harness spawns the real Electron binary. We do NOT pre-pin a VS Code
 * version here — `runTests` resolves "stable" by default, matching the
 * `engines.vscode` floor in package.json (^1.85.0).
 *
 * Source: .claude/docs/testing-strategy.md §"Layer 3 — VS Code integration"
 *         team/sage-qa/test-plan-m2.md §M2-08 "Layer-3 coverage targets"
 */

import { runTests } from "@vscode/test-electron";
import * as path from "path";

async function main(): Promise<void> {
  try {
    // CRITICAL: unset ELECTRON_RUN_AS_NODE before spawning VS Code.
    //
    // When `ELECTRON_RUN_AS_NODE=1` is set in the process environment, Electron-
    // based executables (including Code.exe) launch as a Node.js interpreter
    // instead of the GUI shell — every VS Code CLI flag is then rejected as
    // "bad option" by Node's argument parser. This env var is set inside any
    // shell spawned from VS Code's integrated terminal (which is itself an
    // Electron child process running Node), and `@vscode/test-electron`'s
    // `cp.spawn` inherits the env by default.
    //
    // The fix is local-only: we delete the var from our own `process.env`
    // before invoking runTests, which in turn passes the filtered env to its
    // child spawn. CI runners (GitHub Actions Ubuntu) never have this set, so
    // this is a no-op there.
    delete process.env.ELECTRON_RUN_AS_NODE;

    // Repo root. __dirname at runtime is
    // <repo>/out/vscode-integration/tests/vscode-integration/.
    const extensionDevelopmentPath = path.resolve(__dirname, "../../../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // We deliberately do NOT pass a workspace folder via launchArgs. The
    // first positional arg in launchArgs is interpreted by VS Code's CLI as
    // a file/folder to open — on Windows + headless test mode this can be
    // mis-resolved as a Node module path. The Layer-3 suites do not need a
    // workspace (they exercise extension activation, command registration,
    // and document-open via vscode.window.showTextDocument with absolute
    // paths from tempdirs they create themselves). When `vscode.workspace.
    // workspaceFolders` is needed by a future test, prefer passing a `.code-
    // workspace` file or use --folder-uri rather than a bare positional.
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // Pin VS Code version: 1.121 (the current "stable" at time of authoring)
      // rejected the `--no-sandbox` and `--extensionTestsPath` CLI flags from
      // @vscode/test-electron@2.5.2 on Windows (logged as "bad option" in the
      // Code.exe stderr). Pinning to 1.96.4 (Dec 2024 stable) restores the
      // expected CLI flag set. Re-evaluate when bumping @vscode/test-electron.
      version: "1.96.4",
      launchArgs: [
        // Disable other extensions so they don't interfere with activation timing.
        "--disable-extensions",
        // Skip the welcome / release-notes / sync popups on first launch.
        "--disable-workspace-trust",
      ],
    });
  } catch (err) {
    console.error("[claudeteam.vscode-integration] runTests failed:", err);
    process.exit(1);
  }
}

void main();
