# M2-08 — Layer-3 (@vscode/test-electron) run notes

Sage's authoring log for the Layer-3 integration test harness (ticket
[86c9y9v7r](https://app.clickup.com/t/86c9y9v7r)). Covers what the harness
proves, what the surface limitations are, what the negative-paths catch,
and the two distinct production bugs uncovered during authoring.

## Test surface

Four suites under `tests/vscode-integration/suite/`, executed by Mocha
inside a real VS Code 1.96.4 instance spawned via `@vscode/test-electron`.

| Suite | AC | What it catches |
|---|---|---|
| `activation.test.ts` | AC2 | Extension fails to register / activate; `activationEvents` regresses to an eager trigger; declared commands not registered after activation. |
| `webviewSmoke.test.ts` | AC3 | `WebviewViewProvider` not registered; `package.json contributes.views[].id` mismatch with `provider.ts VIEW_ID`; provider throws on re-resolve (subscription-leak fix regression). |
| `drillIn.test.ts` | AC4 | `vscode.window.showTextDocument` integration broken at the URI/scheme level; `vscode.workspace.textDocuments` not populated by opened JSONLs. |
| `themeSwitch.test.ts` | AC5 | Theme toggle crashes the extension host; styling breaks after dark↔light cycle; rebind path unstable. |

Each suite includes at least one explicit `NEGATIVE PATH` test that earns
the positive assertion (per testing-strategy.md §"Sage's QA contract").
Total: 14 tests, all green on `npm run test:vscode`.

## Pinned VS Code version

`runTest.ts` pins `version: "1.96.4"`. The current `stable` channel
(1.121.0 at authoring time) accepted the spawn but produced a working
test environment indistinguishable from 1.96.4 once the
`ELECTRON_RUN_AS_NODE` env-var trap was solved (see below). The pin is
defensive — 1.96.4 is the December 2024 stable that was current when the
`@vscode/test-electron@2.5.2` API surface was published, so it's the
known-aligned binary.

Re-evaluate the pin when bumping `@vscode/test-electron`.

## Surface limitations (documented in each test header)

- **No Output-channel read-back.** VS Code does not expose Output-channel
  content via the Extension API. The "no errors in Output channel" AC is
  approximated by "activation didn't throw" + "extension is active."
- **No webview-DOM read-back from the host.** `WebviewView.webview.html`
  is a write-only sink from outside the provider. The "tile container
  element present" AC translates at Layer-3 to "the wiring path that
  must exist for the tile container to be reachable, exists" — true DOM
  presence is Layer-4 (Playwright-against-the-iframe), deferred.
- **No webview-iframe handle.** `WebviewView` does not expose
  `.iframe`. The theme-switch AC for "iframe accessible after toggle"
  translates to "view-focus command still resolves after toggle."
- **Cannot post `ui:open-transcript` from the test.** The
  `WebviewViewProvider` instance is held in `activate`'s closure and not
  exposed via the extension API. Layer-3 verifies the VS Code-side path
  that `handleOpenTranscript` calls into (`vscode.window.showTextDocument`
  + `vscode.workspace.textDocuments`); the message dispatch + handler
  logic is fully covered by unit tests
  (`tests/unit/main.test.ts`, `tests/unit/webviewMessageDispatch.test.ts`).

These are honest limitations of the Layer-3 harness, not gaps in
coverage — the unit suite covers what Layer-3 cannot, and Layer-3 covers
what the unit suite cannot.

## Production bugs uncovered during authoring

Both filed as follow-up tickets per ticket AC7 — NOT fixed in this PR.

### Bug #1 — `dist/extension/main.js` requires CJS shim

**Symptom.** Loading the built extension fails with
`ERR_REQUIRE_ESM: require() of ES Module dist/extension/main.js not
supported`. The error fires inside VS Code's extension host when it tries
to `require()` the extension's entry point on Node 22+.

**Cause.** Root `package.json` has `"type": "module"`. Node's module
resolution uses the nearest `package.json` to determine `.js` interpretation.
`dist/extension/main.js` is CJS source (correctly emitted by esbuild
with `format: "cjs"`) but Node sees the parent `"type": "module"` and
treats `.js` as ESM. The fix is a sibling `dist/extension/package.json`
with `{"type": "commonjs"}`, written either by `esbuild.config.mjs` or
by a `postbuild` step.

**Impact.** **Production-affecting.** Any user installing the `.vsix`
produced by `vsce package --no-yarn` on Node 22+ would see the extension
fail to activate. This is not a test-only concern. M2-06 shipped without
catching this because the manual reload check ran under VS Code's
bundled Node (often older / more permissive) — Layer-3 with
`@vscode/test-electron` 2.5.2 on Node 22.22.1 surfaced it.

**Workaround in this PR.** `package.json` script
`shim:cjs-dist` writes the sibling shim file before
`compile:vscode-integration` runs. `test:vscode` is now self-contained
and green. Production `npm run build && vsce package` is still broken;
that lives in the follow-up ticket below.

**Follow-up.** Filed in `team/log/clickup-pending.md` as ENTRY 028 — to
be created by orchestrator. Suggested title:
`fix(scaffold): dist/extension CJS shim for Node 22+ require()`.
Suggested owner: Felix (M2-01 esbuild-config owner). Fix: add the shim
write to `esbuild.config.mjs` post-build (one-liner — see this doc's
package.json `shim:cjs-dist` for the exact form). Once that ships, the
`shim:cjs-dist` script can be removed from `test:vscode` and the M2 done-
when check can re-verify production .vsix activation.

### Bug #2 — `ELECTRON_RUN_AS_NODE` env-var leak from VS Code integrated terminal

**Symptom.** Spawning the test VS Code instance produces `bad option:
<every-CLI-flag>` on stderr; exit code 9. Every Electron CLI flag
(`--no-sandbox`, `--extensionTestsPath=...`) is rejected.

**Cause.** Claude Code's integrated terminal sets
`ELECTRON_RUN_AS_NODE=1` in its environment to make `Code.exe` runnable
as Node. The `@vscode/test-electron` runner inherits the env when
spawning the test VS Code, so the spawned `Code.exe` becomes a Node
interpreter instead of the GUI shell — which then rejects every Electron
CLI flag as unknown.

**Impact.** Local-only. CI runners (GitHub Actions Ubuntu) do not have
`ELECTRON_RUN_AS_NODE` set, so this never surfaces in CI. Affects any
developer running `npm run test:vscode` from inside a Claude Code session.

**Workaround in this PR.** `tests/vscode-integration/runTest.ts` does
`delete process.env.ELECTRON_RUN_AS_NODE` before invoking `runTests()`.
No follow-up ticket needed — this is the canonical fix for the
class of bugs. Documented in `runTest.ts` so the next developer who
sees `bad option:` knows what to look for.

## CI integration

`.github/workflows/ci.yml` gains one new step (PR-only, after the VSIX
package step):

```yaml
- name: VS Code integration tests (Layer 3 — M2-08)
  run: xvfb-run -a npm run test:vscode
  if: github.event_name == 'pull_request' && github.base_ref == 'main'
```

Ubuntu Actions runners are headless, so `xvfb-run -a` is required to
give Electron a display. `@vscode/test-electron` downloads VS Code on
first run (~140MB for 1.96.4); the download is cached under
`.vscode-test/` (gitignored).

## Files in play

- New: `tests/vscode-integration/runTest.ts`,
  `tests/vscode-integration/suite/index.ts`,
  `tests/vscode-integration/suite/helpers.ts`,
  `tests/vscode-integration/suite/activation.test.ts`,
  `tests/vscode-integration/suite/webviewSmoke.test.ts`,
  `tests/vscode-integration/suite/drillIn.test.ts`,
  `tests/vscode-integration/suite/themeSwitch.test.ts`,
  `tsconfig.vscode-integration.json`.
- Modified: `package.json` (devDeps + 3 scripts), `.github/workflows/ci.yml`
  (1 new step), `tsconfig.json` (exclude `out/` + vscode-integration tests
  from main project), `.eslintrc.cjs` (mocha env override + ignore `out/`),
  `.vscodeignore` (exclude `out/` + `.vscode-test/`).
- Read-only references: every M2-01 / M2-04 / M2-05 / M2-06 production file.

## What this PR does NOT change

- No production source files touched (per ticket AC7 / OOS).
- No M1 production code touched.
- The `vsce package --no-yarn` output is still affected by Bug #1 above
  — the production .vsix activation gap is the follow-up ticket's scope.
