/**
 * Mocha test suite loader for Layer-3 (@vscode/test-electron).
 *
 * Invoked from inside the spawned VS Code instance by `runTest.ts` via
 * `extensionTestsPath`. Discovers every compiled `*.test.js` under this
 * directory and feeds them to Mocha for in-VS-Code execution.
 *
 * Why a programmatic Mocha here (vs. mocharc): runTests() invokes this
 * function with the spawned-VS-Code process's working directory, which is
 * not the repo root — a static mocharc config wouldn't find the test files
 * reliably. The programmatic API takes absolute paths.
 *
 * Source: VS Code docs https://code.visualstudio.com/api/working-with-extensions/testing-extension
 *         team/sage-qa/test-plan-m2.md §M2-08
 */

import * as path from "path";
import { glob } from "glob";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    // TDD interface (suite/test/suiteSetup/suiteTeardown) — matches the
    // VS Code-docs canonical example and the suite() calls in the .test.ts
    // files. BDD (describe/it) would be acceptable too, but the four AC
    // suites use TDD vocabulary so the ui setting must agree.
    ui: "tdd",
    color: true,
    // Per-test timeout: VS Code activation can take 5-10s cold, plus the
    // theme-switch test awaits config-change propagation. 20s is generous
    // without masking real hangs.
    timeout: 20_000,
  });

  const testsRoot = __dirname;

  // glob 13.x returns Promise<string[]> by default.
  const files = await glob("**/*.test.js", { cwd: testsRoot });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}
