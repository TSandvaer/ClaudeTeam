# M2 Acceptance Test Plan

The orchestrator uses this document to gate M2's "complete" status. Each section maps a ticket's acceptance criteria to the concrete verification steps Sage runs before signing off the PR. The final section defines the compound **M2 milestone done-when** check.

- **Ticket:** [ClickUp 86c9y7jjd](https://app.clickup.com/t/86c9y7jjd) — `test-plan(m2): M2 acceptance test plan + webview-smoke gate spec`
- **Owner:** Sage
- **Peer reviewer:** Felix (host-side surfaces)
- **Source docs:**
  - `.claude/docs/testing-strategy.md` (canonical — Layer 1 / Layer 2 / Layer 3 mapping)
  - `team/nora-pl/milestone-2-backlog.md` (M2-01 through M2-09 AC source)
  - `team/iris-ux/m1-cli-output-spec.md` (field vocabulary: `display` / `role` / `activity` / `model` / `state`)
  - `team/iris-ux/m2-dashboard-tile-spec.md` (M2-03 — **tile spec pending M2-03 merge; update AC5/M2-05 coverage once spec lands**)
  - `.claude/docs/vscode-extension-conventions.md` (manifest conventions, message protocol, build targets)
  - CLAUDE.md hard rules #3 (webview-smoke gate) and #4 (extension-manifest gate)

## How to read this document

For every M2 ticket I list:

1. **Sign-off checklist** — line items I tick before approving the PR.
2. **Edge-case probes** — the specific failure modes I exercise. These map to testing-strategy.md Layer 1/2/3 targets.
3. **Self-Test Report required?** — per CLAUDE.md hard rule #3 (UX-visible PRs) and hard rule #4 (package.json PRs).
4. **Verification commands** — exact shell commands run against the worktree.

The QA contract from `testing-strategy.md` "Sage's QA contract" governs every decision: REQUEST CHANGES on missing Self-Test Report / missing AC walkthrough / missing regression test / unhandled schema drift; APPROVE when ACs met with cite-able evidence + bug-class coverage.

---

## Webview-smoke gate (CLAUDE.md hard rule #3)

**Hard rule:** any PR touching webview rendering or extension-host message-passing requires the author to post a Self-Test Report confirming a manual webview reload in VS Code worked end-to-end. The reload sequence is the `testing-strategy.md` "Manual reload checklist":

1. `Ctrl+Shift+P` → "Developer: Reload Window".
2. Open the ClaudeTeam dashboard (Activity Bar icon).
3. Confirm the dashboard renders the current state without errors in the Output channel.
4. Walk through each AC of the PR manually. Screenshot each one.
5. Toggle dark/light theme. Screenshot both.
6. Trigger empty-state scenario (close all Claude Code sessions). Confirm dashboard shows empty state gracefully.

**M2 tickets subject to the webview-smoke gate:**

| Ticket | Gate type | Reason |
|---|---|---|
| M2-01 | Extension-manifest gate (hard rule #4) + activation smoke | `package.json` `contributes` / `activationEvents` / `engines`; `vsce package` stdout required |
| M2-05 | Webview-smoke gate (hard rule #3) | Webview renderer — tiles, message receiver, theme-switch |
| M2-06 | Webview-smoke gate (hard rule #3) | Extension host ↔ webview bridge — live data in webview |

**M2 tickets that do NOT require the webview-smoke gate** (pure host-side or research):
- M2-02 (research note — no UX surface)
- M2-03 (design spec — no runnable artifact)
- M2-04 (file-watcher loop — host-side only; no webview render path)
- M2-07 (this document)
- M2-08 (Layer-3 tests — automated; Sage authors these, Felix peer-reviews)
- M2-09 (process docs only)

**Sage's REQUEST CHANGES triggers for the smoke gate:**
- Self-Test Report comment absent on the PR (no exceptions).
- AC walkthrough not present (every AC ticked with screenshot evidence or run-output link).
- Manual reload screenshot missing — specifically: a screenshot of the dashboard rendered after `Ctrl+Shift+P → Developer: Reload Window` is required for M2-05 and M2-06; `vsce package` stdout is required for M2-01.
- No negative-path assertion in tests (a test suite with only happy-path assertions is incomplete).
- Regression test not named for the bug class (e.g., "schema drift — v2.1.119 vs v2.1.145-persona" is a bug class; a generic "parses meta.json" test is not).

---

## M2-01 — `feat(scaffold): VS Code extension manifest + build pipeline` (Felix)

### Sign-off checklist

- [ ] `package.json` has `main: "dist/extension/main.js"`, `engines.vscode: "^1.85.0"` (or Bram's M2-02 recommended minimum), `publisher: "claudeteam"`, `displayName`, `version: "0.0.1"`.
- [ ] `contributes.views` registers `claudeteam.dashboard` under a `viewsContainers` Activity Bar entry with a codicon placeholder (AC2).
- [ ] `contributes.commands` includes `claudeteam.refresh`, `claudeteam.openRoster`, `claudeteam.openAgentTranscript` (AC3).
- [ ] `contributes.configuration` includes `claudeteam.rosterPath`, `claudeteam.pollIntervalMs` (default 2000), `claudeteam.showBackgroundCount` (default true) (AC4).
- [ ] `activationEvents: ["onView:claudeteam.dashboard"]` — lazy only, no `*` wildcard (AC5).
- [ ] `esbuild.config.mjs` builds two bundles: host → CJS (`--format=cjs`, `external: ["vscode"]`); webview → IIFE (`--format=iife`, no externals). Both `npm run build` entries exit 0 (AC6).
- [ ] `src/extension/main.ts` exports `activate(context)` + `deactivate()`; activate registers the `WebviewViewProvider` stub (AC7).
- [ ] `src/extension/view/provider.ts` implements `vscode.WebviewViewProvider`; `resolveWebviewView` sets nonce-based CSP (no `unsafe-inline`, no `eval`) and injects the webview bundle script tag (AC8).
- [ ] `npm run build && vsce package --no-yarn` exits 0; `claudeteam-0.0.1.vsix` produced (AC9).
- [ ] `vsce package` stdout pasted in Self-Test Report (hard rule #4 — extension-manifest gate).
- [ ] `npm run watch` starts both watchers (AC10).
- [ ] CI `ci.yml` gains `vsce package --no-yarn` step on PRs to `main` (AC11).
- [ ] `npm run typecheck && npm run test:unit` pass (AC12).
- [ ] `.vscodeignore` present and covers `node_modules/`, `src/`, `tests/`, config files.

### Edge-case probes

- **CSP strictness:** inspect the HTML produced by `resolveWebviewView`. Confirm no `unsafe-inline` in `script-src`. A test that only checks the stub renders is insufficient — the CSP header is load-bearing.
- **Lazy activation:** confirm `activationEvents` does NOT contain `*`. If it does, the extension activates on every VS Code startup (performance regression). Check `package.json` directly.
- **Two-bundle discipline:** host bundle must have `external: ["vscode"]`; importing `vscode` in the webview bundle would cause a runtime crash. Inspect `esbuild.config.mjs` for the `external` entry.
- **IIFE webview target (Bram's M2-02 finding):** webview bundle must be `--format=iife`, NOT `--format=esm`. An ESM webview bundle in a `vscode-webview://` context will fail silently (no module loader). Check the esbuild config.
- **Negative path — missing `viewsContainers` icon:** if the `icon` field for the container is omitted or points to a non-existent file, `vsce package` may warn or fail. The `vsce package` stdout in the Self-Test Report is the evidence.
- **Activation timing:** `activate` must NOT call `loadRoster()` or `startWatcher()` at import time. Confirm these are invoked inside `activate()` or `resolveWebviewView()` only.

### Self-Test Report required?

**YES — hard rule #4 (extension-manifest gate) + activation smoke.**
Required content:
- `vsce package --no-yarn` stdout (complete, not truncated).
- Confirmation the `.vsix` installs in VS Code (`Extensions → Install from VSIX`) and the Activity Bar icon appears.
- Screenshot of Activity Bar with ClaudeTeam icon visible.
- Output channel: no errors during the 5 seconds after icon click.

### Verification commands

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run build
vsce package --no-yarn
ls claudeteam-0.0.1.vsix
npm run typecheck && npm run test:unit
# In CI: gh pr view <pr-number> --json statusCheckRollup -q '.statusCheckRollup[] | {name, status, conclusion}'
```

---

## M2-02 — `research(vscode-api): VS Code Extension API prior-art + webview tech pick` (Bram)

### Sign-off checklist

- [ ] `team/bram-research/m2-vscode-api-<date>.md` (or equivalent filename) exists.
- [ ] Section (a): `WebviewViewProvider` vs `WebviewPanel` verdict with rationale; confirms `WebviewViewProvider` for Activity Bar view.
- [ ] Section (b): File-system watcher comparison — `vscode.workspace.createFileSystemWatcher`, chokidar, Node `fs.watch` — with verdict for M2-04.
- [ ] Section (c): minimum `engines.vscode` version for `WebviewViewProvider` + `createFileSystemWatcher` + `viewsContainers`.
- [ ] Section (d): Webview UI framework pick — React vs Svelte vs vanilla — with bundle-size and dev-ergonomics analysis. Verdict aligns with `.claude/docs/vscode-extension-conventions.md` "Open questions" update (vanilla TS confirmed per that doc).
- [ ] Section (e): Pixel Agents coexistence — Bram confirms the hook port (55271) and that ClaudeTeam's planned port does not collide. Cites actual `~/.pixel-agents/server.json` or hook registration observed.
- [ ] Section (f): Prior-art section — Claude Code transcript-tracker tools surveyed; one-line verdict on fork vs build-from-scratch.
- [ ] "I verified each cited path exists" statement present with paths listed (AC6 discipline — prevents fabrication).
- [ ] Verdict block ("Recommended decisions") is a bulleted list covering all four items: view type, file-watcher choice, engines.vscode minimum, framework pick.

### Edge-case probes

- **Pixel Agents port confirmation:** check Bram's cited path actually exists on this machine (`~/.pixel-agents/server.json` or equivalent). If Bram's note says "port 55271" but cites no path, I treat it as a fabrication risk and file a follow-up. The data-sources.md §5 already states port 55271 — Bram must verify, not repeat.
- **`engines.vscode` floor vs claimed minimum:** if Bram claims a floor lower than `^1.85.0`, it must be grounded in a VS Code docs URL — not an assumption.

### Self-Test Report required?

**No** — research note. The "I verified each cited path exists" block IS the report.

### Verification commands

```bash
ls team/bram-research/m2-vscode-api-*.md
cat team/bram-research/m2-vscode-api-*.md | grep -i "verified each cited path"
```

---

## M2-03 — `spec(ux): M2 dashboard tile spec` (Iris)

**NOTE: M2-03 tile spec not yet merged at time of M2-07 authoring. The probes below are written from the M2-03 AC list. Update this section once the spec lands — specifically the Self-Test Report done-when checklist cross-reference in M2-05.**

### Sign-off checklist

- [ ] `team/iris-ux/m2-dashboard-tile-spec.md` exists.
- [ ] Tile layout section maps `display`/`role`/`activity`/`model`/`state` (the M1-03 §6 glossary vocabulary) to webview DOM elements.
- [ ] State indicators section uses `--vscode-*` CSS variables for non-semantic colors; only the four semantic state colors use hardcoded hex (per vscode-extension-conventions.md "Webview rules").
- [ ] Background chip section specifies: collapsed vs expanded states; click trigger; count always visible; per M1-03 §4 bullet 3 requirement.
- [ ] Click-to-drill section specifies: `{ type: "ui:open-transcript", payload: { sessionId, agentId } }` message sent via `acquireVsCodeApi().postMessage(...)`.
- [ ] Error UI section specifies what renders for malformed roster YAML and file-watcher errors (per roster-matching.md "Loader edge cases").
- [ ] Empty state section specifies the "No live Claude Code sessions" UI.
- [ ] At least three divergences from M1-03 documented (minimum: wrap vs truncate, click-to-drill, background-chip-collapsed state).
- [ ] ASCII wireframe or text diagram with theme-variable labels present.
- [ ] CSS custom properties listed with usage annotation.
- [ ] "Dashboard-tile done-when" section lists observable behaviors Maya's Self-Test Report must document.

### Edge-case probes

- **Vocabulary consistency:** every field name in the spec must match M1-03 §6 glossary exactly (`display`, `role`, `activity`, `model`, `state`). Drift here causes a rename refactor across Maya's M2-05 output.
- **Background-chip count suppression:** spec must state the chip is suppressed when count = 0 (inherits M1-09 behavior). If not stated, Maya may render `+ 0 background agents`.
- **Error-UI spec completeness (two distinct cases):** (1) roster YAML malformed — what text/color renders; (2) file-watcher error — distinct or same as roster error? Both must be covered.

### Self-Test Report required?

**No** — design spec. No runnable artifact.

### Verification commands

```bash
ls team/iris-ux/m2-dashboard-tile-spec.md
grep -c "diverge\|divergence\|CLI is NOT" team/iris-ux/m2-dashboard-tile-spec.md
# Expects >= 1 hit (three divergences may not each use that word, but the section must exist)
```

---

## M2-04 — `feat(watcher): file-watcher polling loop` (Felix)

### Sign-off checklist

- [ ] `src/extension/watcher/watcherLoop.ts` exports `startWatcher(context, claudeHome, onStateChange): Disposable` (AC1).
- [ ] Poll interval reads from `vscode.workspace.getConfiguration("claudeteam").get("pollIntervalMs")` defaulting 2000ms (AC2).
- [ ] Each tick: `listSessions` → `meta.json` per session → JSONL tail → roster match → `DashboardState` → `onStateChange` if state changed (AC3).
- [ ] State diff strategy documented in a code comment; redundant re-renders avoided (AC4).
- [ ] `src/shared/slug.ts` exports `cwdToSlug(cwd: string): string`; `src/cli/agentTree.ts` and `tests/integration/helpers/tempdir.ts` updated to import from it — resolving M1-09-followup `86c9y6e17` (AC5).
- [ ] `src/extension/main.ts` calls `startWatcher` in `activate`; callback posts state via `messageBus` (AC6).
- [ ] File-watcher implementation aligns with Bram's M2-02 verdict (or notes the `setInterval`-only fallback with TODO comment per AC7).
- [ ] `tests/integration/watcherLoop.test.ts` exists; builds tempdir, starts watcher, mutates file, asserts `onStateChange` fires within 4 seconds (AC8).
- [ ] All tests pass: `npm run typecheck && npm run test:unit && npm run test:integration` (AC9).

### Edge-case probes

- **`cwdToSlug` extraction — no duplicate copies:** after M2-04 merges, `src/cli/agentTree.ts` must import from `src/shared/slug.ts`, not contain a local `cwdToSlug` function. Same for `tests/integration/helpers/tempdir.ts`. A test run that imports from the old path would silently pass while the production path was broken.
- **Dispose cleans up:** call `disposable.dispose()` in the integration test; confirm `onStateChange` does NOT fire after dispose. Missing dispose handling is a resource-leak class bug.
- **4-second `onStateChange` timing:** the integration test timeout for this assertion must be set to at least 5 seconds (test harness timeout > assertion deadline). A test that times out at 4s exactly would be flaky.
- **Configuration read on wrong thread:** `vscode.workspace.getConfiguration` must be called from the extension host context, not from a test helper that mocks it. Integration test must inject the poll interval directly (not via VS Code config) to keep the test environment clean.
- **Subagent JSONL race (M1-10 regression):** add a watcher integration test case where a subagent JSONL is created before its parent tool_use entry. Reducer must return the agent as `running`, not throw or show as orphaned. This is the same race from M1-10 — the watcher loop is the new execution path for it.

### Self-Test Report required?

**No** — host-side integration, no webview render path. CI test green is sufficient. If Felix wires `messageBus` in this PR (AC6 wiring), a partial integration smoke may be warranted but not the full webview-smoke gate.

### Verification commands

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test:integration -- watcherLoop
npm run typecheck
grep -rn "cwdToSlug" src/ tests/   # Should appear only in src/shared/slug.ts + importers
```

---

## M2-05 — `feat(webview): dashboard tile renderer + message receiver` (Maya)

**tile spec pending M2-03 — update AC coverage once spec lands; specifically AC3 visual-layout probes, AC4 hex color values, and the done-when checklist cross-reference.**

### Sign-off checklist

- [ ] `src/webview/messageReceiver.ts` exports `initMessageReceiver()` — registers `window.addEventListener("message", handler)` dispatching `HostMessage` to registered handlers (AC1).
- [ ] `src/webview/main.ts` (or `.tsx`) registers handlers for `state:full` and `state:delta`; re-renders on receipt (AC2).
- [ ] Dashboard renders: one session block per session; one team card per matched team; one tile per rostered agent with all five fields; background-noise chip with count + collapsed detail list; empty state (AC3).
- [ ] Four semantic hex colors used for state indicators (`running`/`idle`/`finished`/`error`); all other colors use `--vscode-*` variables. Hex values documented in a code comment; must align with Iris's M2-03 spec AC4. (Update this check once M2-03 lands.) (AC4).
- [ ] Background chip expand/collapse works; count always visible (AC5).
- [ ] Tile click sends `{ type: "ui:open-transcript", payload: { sessionId, agentId } }` via `acquireVsCodeApi().postMessage(...)` (AC6).
- [ ] Re-render discipline: `state:delta` patches only changed tiles; `state:full` triggers full update; no full-re-render on every polling tick (AC7).
- [ ] Static-fixture mode: when `acquireVsCodeApi` unavailable, webview renders from `src/shared/fixtures.ts` `FIXTURE_STATE` (AC8).
- [ ] `src/shared/fixtures.ts` exports `FIXTURE_STATE: DashboardState` with all six personas in at least three states (AC9).
- [ ] `tests/unit/webview/dashboardTile.test.ts` — renders tile component in each of four states; asserts state indicator color class, display text, activity text present (AC10).
- [ ] Self-Test Report posted with full Layer-3 manual reload checklist screenshots (AC11).
- [ ] `npm run typecheck && npm run test:unit` pass (AC12).

### Edge-case probes

- **`acquireVsCodeApi` guard (static-fixture mode):** test that when `acquireVsCodeApi` throws (not defined in the plain browser context), the webview falls through to `FIXTURE_STATE` — not a blank/white screen. This is a real failure mode during development; it needs a test, not just documentation.
- **`state:delta` wiring — not just declared:** the AC says delta patches only changed tiles. Verify a test exists where a `state:delta` message arrives for one agent and exactly one tile's DOM is modified (not the whole session block). "Diff at the message-receiver level" is a bug class — a naive `innerHTML = render(state)` implementation would pass AC2 but break AC7.
- **Background chip collapsed-by-default:** on first `state:full`, the detail list should be collapsed. Expand/collapse is toggle state — test that it starts collapsed, not expanded.
- **Empty roster chip suppression:** `FIXTURE_STATE` should include a session with background count = 0 to test that no `+ 0 background agents` line renders.
- **Theme-switch probe:** Sage runs a manual dark/light switch (testing-strategy.md "Manual reload checklist" step 5) during QA. Hardcoded hex colors will fail if they're used for non-semantic elements — request the color-class list from Maya's PR body.
- **CSP compliance:** webview script tag must use the nonce injected by `provider.ts`. Any `onclick=` inline handler would violate CSP and silently fail. Inspect the rendered HTML for inline event handlers.

### Self-Test Report required?

**YES — hard rule #3 (webview-smoke gate).** Required content per testing-strategy.md "Self-Test Report contract":
- AC walkthrough with screenshot per AC.
- Side-effect inventory (which files the webview reads/writes).
- Theme-switch probe: dark theme screenshot + light theme screenshot.
- State-coverage screenshots: running tile, idle tile, finished tile, error tile, empty state.
- Failure-mode probes: malformed roster YAML → error chip renders; `state:full` with empty sessions array → empty state renders.

Sage runs the manual reload checklist before approving: `Ctrl+Shift+P → Developer: Reload Window` → Activity Bar open → dashboard renders without Output channel errors.

### Verification commands

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-maya-wt
npm run build
npm run typecheck && npm run test:unit
# Verify webview bundle is IIFE not ESM:
grep "format" esbuild.config.mjs   # Should show 'iife' for webview target
```

---

## M2-06 — `feat(host): extension host ↔ webview message bridge integration` (Felix)

### Sign-off checklist

- [ ] `src/extension/messageBus.ts` implements `postState(webview, state): void` — serializes to `{ type: "state:full", payload: state }` and calls `webview.postMessage(...)` (AC1).
- [ ] `resolveWebviewView` registers `WebviewView.onDidReceiveMessage` listener; dispatches `WebviewMessage` objects to host handlers (AC2).
- [ ] `ui:open-transcript` handler calls `vscode.window.showTextDocument(vscode.Uri.file(jsonlPath))`; path derived from `sessionId` + `agentId` via `src/shared/slug.ts`; missing-file shows `vscode.window.showErrorMessage(...)` and does not throw (AC3).
- [ ] `ui:open-roster` handler shows the resolved roster YAML path (AC4).
- [ ] `ui:refresh` triggers one watcher tick immediately outside the poll interval (AC5).
- [ ] `src/extension/main.ts` wires `startWatcher` → `postState` → webview; watcher callback registered in `resolveWebviewView`, NOT at `activate` time (AC6).
- [ ] Self-Test Report on PR with evidence for: live tiles appear; drill-in opens correct JSONL; `ui:refresh` triggers immediate update; Output channel error-free for 30s (AC7).
- [ ] All tests pass: `npm run typecheck && npm run test:unit && npm run test:integration` (AC8).

### Edge-case probes

- **Missing JSONL file graceful failure (critical path):** `ui:open-transcript` for a session whose JSONL has been deleted since the last poll tick. Host must call `showErrorMessage` — not crash, not silently do nothing. Verify the integration test covers this path (not just the happy path where the file exists).
- **Watcher registered in `resolveWebviewView` not `activate`:** if `startWatcher` is called in `activate`, the watcher runs even when the ClaudeTeam view is closed — a battery/CPU drain. Check `src/extension/main.ts` explicitly.
- **`state:full` post-dispose crash:** if the view closes (user collapses the Activity Bar panel) while the watcher is ticking, `postMessage` on the disposed webview must NOT throw unhandled. Check that `onStateChange` callback guards for `webview.active` before posting.
- **Roster path resolution for `ui:open-roster`:** if no roster file was found (empty-roster scenario), `ui:open-roster` should show `showInformationMessage("No roster file loaded")` or similar. A crash or silent no-op is wrong. Test both the "roster loaded" and "roster not loaded" branches.
- **Schema-drift slug round-trip:** slug derived from `cwd` in `sessionRegistry` must round-trip through `cwdToSlug` to produce the correct JSONL path. Test with a Windows path (`c:\Trunk\PRIVATE\ClaudeTeam`) — the slug must be `c--Trunk-PRIVATE-ClaudeTeam`, not a forward-slash variant or double-slash.

### Self-Test Report required?

**YES — hard rule #3 (webview-smoke gate).** Required content:
- AC walkthrough with screenshot per AC.
- Live tile data screenshot (at least one rostered agent tile with real `~/.claude/` data).
- Drill-in screenshot (JSONL opens in VS Code editor).
- Output channel screenshot: no errors during the 30-second run period.
- `ui:refresh` evidence: screenshot showing an immediate tile update after clicking the refresh control.
- Theme-switch probe: dark/light screenshots (no broken styling).
- Failure-mode probes: click drill-in on an agent whose JSONL no longer exists → `showErrorMessage` appears (not crash).

### Verification commands

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run build
vsce package --no-yarn   # Confirm .vsix still builds after wiring
npm run typecheck && npm run test:unit && npm run test:integration
# Manual: install .vsix, open Activity Bar, let run 30s, screenshot Output channel
```

---

## M2-07 — `test-plan(m2): M2 acceptance test plan + webview-smoke gate spec` (Sage — THIS DOCUMENT)

Self-attestation only — peer-reviewer (Felix) confirms the plan is complete and the M2 done-when command is executable.

### Sign-off checklist (for Felix as reviewer)

- [ ] Sections present for M2-01 through M2-09.
- [ ] Each section lists concrete verification commands, not just prose.
- [ ] Webview-smoke gate section identifies which M2 tickets require Self-Test Reports (M2-01, M2-05, M2-06 at minimum).
- [ ] Layer-3 coverage targets are listed (four `@vscode/test-electron` test cases for M2-08).
- [ ] "M2 milestone done-when" section defines the compound check that proves M2 shippable.
- [ ] "Not tested in M2 (deferred)" section is present.
- [ ] M2-03 tile-spec conflict rule applied correctly (placeholder present, not blocked).

### Self-Test Report required?

**No** — this is the test plan itself, not a tested artifact.

---

## M2-08 — `test(m2): Layer-3 VS Code integration tests (@vscode/test-electron)` (Sage)

### Sign-off checklist (Felix as peer-reviewer)

- [ ] `@vscode/test-electron` and runner packages added to `devDependencies`; `npm run test:vscode` script present (AC1).
- [ ] CI `ci.yml` gains a `test:vscode` step running on PRs to `main` (AC1).
- [ ] `tests/vscode-integration/suite/activation.test.ts` — opens VS Code with extension, opens ClaudeTeam Activity Bar view, asserts no Output channel errors within 5 seconds (AC2).
- [ ] `tests/vscode-integration/suite/webviewSmoke.test.ts` — sends `Reload Window` command, waits for view re-registration, asserts webview HTML contains tile container element (AC3).
- [ ] `tests/vscode-integration/suite/drillIn.test.ts` — posts `ui:open-transcript` with a fixture JSONL path, asserts `vscode.workspace.textDocuments` includes a document at that path (AC4).
- [ ] `tests/vscode-integration/suite/themeSwitch.test.ts` — programmatically toggles VS Code theme dark/light, asserts webview iframe still accessible after each toggle (no crash) (AC5).
- [ ] All four suites green: `npm run test:vscode` (AC6).
- [ ] Any production bugs found during authoring are filed as follow-up tickets, NOT fixed in this PR (AC7).

### Layer-3 coverage targets (the four `@vscode/test-electron` test cases M2-08 must implement)

These are the non-negotiable Layer-3 targets per `testing-strategy.md` §"Layer 3 — VS Code integration":

| Test file | What it covers | Pass criteria |
|---|---|---|
| `activation.test.ts` | Activation lifecycle: event fires, view registers, no Output channel errors | No error messages in Output channel within 5s of view open |
| `webviewSmoke.test.ts` | Webview reload smoke: post-reload, dashboard renders with current state | Webview HTML contains the tile container element (presence check — content is live-data dependent) |
| `drillIn.test.ts` | Drill-in: click tile → JSONL opens in editor | `vscode.workspace.textDocuments` includes a doc at the fixture JSONL path after `ui:open-transcript` dispatch |
| `themeSwitch.test.ts` | Theme switch: dark/light toggle → no broken styling | Webview iframe accessible after each toggle (no crash, no `undefined` iframe) |

**Negative-path requirements (each test must include at least one):**
- `activation.test.ts`: assert that `claudeteam.dashboard` view is NOT registered before activation (pre-activation state check).
- `webviewSmoke.test.ts`: assert the tile container element was NOT present before the watcher produced its first state update (presence is earned, not assumed).
- `drillIn.test.ts`: dispatch `ui:open-transcript` with a path to a file that does NOT exist; assert `showErrorMessage` was called (not a crash, not silence).
- `themeSwitch.test.ts`: assert the iframe is accessible in BOTH dark AND light — not just one of the two states.

### Self-Test Report required?

**No** — automated test PR. CI green is the evidence. Felix confirms no production code is touched (this is a Sage-authored test-only PR).

### Verification commands

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-sage-wt
npm run test:vscode
# CI: gh pr view <pr-number> --json statusCheckRollup -q '.statusCheckRollup[] | {name, status, conclusion}'
```

---

## M2-09 — `chore(m1-followup): dispatch-template tightening + APPROVE_WITH_NITS elevation` (Nora)

### Sign-off checklist

- [ ] `agents/dispatch-template.md` (or confirmed equivalent path — if file doesn't exist, it is created new with only the verdict enumeration block) contains explicit definitions for `APPROVE`, `APPROVE_WITH_NITS`, and `REQUEST_CHANGES` (AC1).
- [ ] `APPROVE_WITH_NITS` definition is exactly: "PR ships as-is; NITs are filed as follow-up tickets before the next milestone close, not blocking this merge." (AC1 verbatim).
- [ ] `.claude/docs/orchestration-overview.md` § "PR & merge protocol" step 4 contains the three-verdict enumeration (AC2).
- [ ] PR diff is ≤ 20 lines total (AC4 scope gate — if larger, Sage requests narrowing before approving).
- [ ] No other process-doc changes sneaked in (AC3).

### Edge-case probes

- **Path verification:** Nora must confirm `agents/dispatch-template.md` path at PR time. If the file was newly created, confirm the PR body says "created new" (per AC conflict rule). If it existed, confirm only the verdict enumeration was changed (diff scope).
- **Verb alignment with CLAUDE.md:** `APPROVE_WITH_NITS` as a verdict must be consistent with CLAUDE.md's "Drain-mode preference" wording. Confirm the definition in dispatch-template.md doesn't contradict "err toward approving non-critical nits."

### Self-Test Report required?

**No** — process doc. The diff IS the report.

### Verification commands

```bash
grep -n "APPROVE_WITH_NITS" agents/dispatch-template.md
grep -n "APPROVE_WITH_NITS" .claude/docs/orchestration-overview.md
git diff --stat HEAD   # Confirm ≤ 20 lines
```

---

## Layer-3 coverage targets (summary for M2-08)

Per `testing-strategy.md` "Layer 3 — VS Code integration (@vscode/test-electron)", M2-08 must implement exactly these four tests. This section is the canonical source M2-08's dispatch brief cites.

### (a) Activation lifecycle test

**File:** `tests/vscode-integration/suite/activation.test.ts`

**What it catches:** Extension fails to register the view (e.g., `activationEvents` mis-configured, `contributes.views` ID mismatch, startup crash).

**Pass:** `claudeteam.dashboard` view is registered in the VS Code Activity Bar after opening, and the Output channel contains zero error messages within 5 seconds.

**Negative path:** assert the view is NOT present before the extension activates (pre-activation state check).

### (b) Webview reload smoke test

**File:** `tests/vscode-integration/suite/webviewSmoke.test.ts`

**What it catches:** Webview HTML is not injected post-reload (provider fails to re-attach), or the tile container element is missing (renderer crashed).

**Pass:** After `vscode.commands.executeCommand("workbench.action.reloadWindow")` and view re-registration, the webview HTML contains the tile container element (a `querySelector` presence check — content is live-data dependent and non-deterministic).

**Negative path:** assert the tile container element was NOT present immediately before the first `state:full` message arrived (pre-data state check).

### (c) Drill-in test

**File:** `tests/vscode-integration/suite/drillIn.test.ts`

**What it catches:** `ui:open-transcript` handler not wired (message dispatched but nothing happens), or path derivation bug (wrong slug produces wrong JSONL path).

**Pass:** After dispatching `{ type: "ui:open-transcript", payload: { sessionId, agentId } }` with a fixture JSONL path, `vscode.workspace.textDocuments` includes a `TextDocument` at that path.

**Negative path:** dispatch `ui:open-transcript` with a path to a non-existent file; assert `vscode.window.showErrorMessage` was called (not a throw, not silence).

### (d) Theme switch test

**File:** `tests/vscode-integration/suite/themeSwitch.test.ts`

**What it catches:** Hardcoded hex colors that render invisible in one theme; CSS `var()` references to undefined variables; iframe teardown on theme change.

**Pass:** Programmatically toggle from dark theme to light theme (via `vscode.workspace.getConfiguration("workbench").update("colorTheme", ...)`) and back; assert the webview iframe is accessible (not `undefined`, no crash) after each toggle.

**Negative path:** assert that the webview iframe IS accessible in both states, not just the initial state — both branches of the toggle must be tested.

---

## Self-Test Report checklist (for Maya and Felix)

This is the exact screenshot and evidence inventory required per `testing-strategy.md` "Self-Test Report contract". Sage's REQUEST CHANGES is triggered when any of these items is absent for a gate-covered PR.

### For M2-01 (extension-manifest gate)

```markdown
## Self-Test Report

### AC walkthrough
- **AC1:** package.json fields — verified. Screenshot: <manifest section>
- **AC2:** Activity Bar icon visible — verified. Screenshot: <Activity Bar>
- **AC5:** activationEvents is ["onView:claudeteam.dashboard"] — verified. Screenshot: <package.json diff>
- **AC6:** npm run build exits 0 — verified. Screenshot/log: <build output>
- **AC9:** vsce package --no-yarn output — paste full stdout here.

### Extension-manifest gate
- `vsce package` stdout: <paste here>
- .vsix produced: claudeteam-0.0.1.vsix — confirmed (ls output).
- .vsix installs in VS Code: confirmed. Activity Bar icon screenshot: <link>
- Output channel: no errors after 5s. Screenshot: <link>
```

### For M2-05 (webview renderer)

```markdown
## Self-Test Report

### AC walkthrough
- **AC3:** dashboard renders with all fields (display, role, activity, model, state indicator) — verified. Screenshot: <link>
- **AC4:** state indicator colors (hex documented in PR body) — verified. Screenshot per state: <links>
- **AC5:** background chip expands/collapses on click — verified. Screenshot collapsed + expanded: <links>
- **AC6:** tile click triggers ui:open-transcript — verified. Screenshot of JSONL opening: <link>
- **AC7:** state:delta patches only changed tiles (not full re-render) — verified. Description of how tested.
- **AC8:** static-fixture mode works in plain browser — verified. Screenshot: <link>
- **AC10:** dashboardTile.test.ts green — verified. Screenshot of test run: <link>

### Side-effect inventory
- Files read: (webview has no filesystem access — all data via message protocol)
- Files written: none

### Theme-switch probe
- Dark theme: <screenshot link>
- Light theme: <screenshot link>

### State-coverage
- Running: <screenshot>
- Idle: <screenshot>
- Finished: <screenshot>
- Error: <screenshot>
- Empty (no sessions): <screenshot>

### Failure-mode probes
- Malformed roster YAML (sent via state:full with error payload): <observed behavior + screenshot>
- state:full with empty sessions array: <empty state rendered — screenshot>
- acquireVsCodeApi unavailable (plain browser): <static-fixture mode rendered — screenshot>
```

### For M2-06 (host integration)

```markdown
## Self-Test Report

### AC walkthrough
- **AC1:** postState serializes correctly and webview receives state:full — verified. Description.
- **AC3:** ui:open-transcript opens JSONL in editor — verified. Screenshot: <link>
- **AC4:** ui:open-roster opens teams.yaml — verified. Screenshot: <link>
- **AC5:** ui:refresh triggers immediate watcher tick — verified. Description of how tested.
- **AC6:** watcher starts in resolveWebviewView, not activate — verified. Code reference: <file:line>
- **AC7:** live tile data appears within ~5 seconds — verified. Screenshot: <link>
- **AC8:** all tests pass — verified. CI run URL: <link>

### Output channel probe
- Output channel: no errors during 30-second run. Screenshot: <link>

### Theme-switch probe
- Dark theme: <screenshot link>
- Light theme: <screenshot link>

### Failure-mode probes
- ui:open-transcript for non-existent JSONL: <showErrorMessage appeared — screenshot>
- Watcher disposed while view closed: no error thrown (tested via dispose call in integration test).
```

---

## M2 milestone done-when

This is the compound check that proves M2 is shippable. The orchestrator runs this after every M2-XX merge; M2 is "complete" when it passes end-to-end.

```bash
# From a fresh clone or up-to-date worktree
cd c:/Trunk/PRIVATE/ClaudeTeam
npm ci
npm run typecheck
npm run lint
npm run test:unit              # Layer 1 — unit tests
npm run test:integration       # Layer 2 — fixture filesystem
npm run test:vscode            # Layer 3 — @vscode/test-electron

npm run build
vsce package --no-yarn
# Exits 0; claudeteam-0.0.1.vsix produced

# Install and smoke-test manually:
# Extensions → Install from VSIX → claudeteam-0.0.1.vsix
# Open Activity Bar → ClaudeTeam icon → dashboard appears
# Wait ~5 seconds → live agent tiles visible (requires a running Claude Code session)
# Click a rostered agent tile → JSONL opens in VS Code editor
# Open Output channel → no errors during 30-second observation
```

**Pass criteria (all five must hold):**

1. Every `npm` command exits 0. CI green on the most recent PR merged into `main` (cite run-id URL).
2. `vsce package --no-yarn` produces `claudeteam-0.0.1.vsix` without warnings or errors.
3. After installing the `.vsix` in VS Code, the Activity Bar icon appears and clicking it opens the ClaudeTeam dashboard.
4. Within 5 seconds of opening the dashboard (with at least one running Claude Code session on the machine), at least one rostered agent tile renders — or the empty state "No live Claude Code sessions" renders when no sessions exist. No error chip in the Output channel during this wait.
5. Clicking a rostered agent tile triggers drill-in: the agent's JSONL file opens in a VS Code text editor tab.

**Acceptance evidence captured by the orchestrator:**
- Screenshot of the dashboard showing live tiles (or the documented empty-state fallback).
- Screenshot of drill-in — JSONL file open in editor tab.
- Screenshot of Output channel: no errors during 30-second run.
- Cite-able CI run-id URL for the last green M2 PR (`gh pr view <num> --json statusCheckRollup`).
- Each M2-XX ClickUp ticket flipped to `complete`.

If the user's `~/.claude/` tree contains zero live sessions at the moment of the done-when check, the Layer-3 `activation.test.ts` and `webviewSmoke.test.ts` (which use fixture data) substitute as the dispositive shippable signal. The empty-state render plus a green `npm run test:vscode` is sufficient.

---

## What is NOT tested in M2 (deferred to M3+)

Sage's M2 pass-criteria do NOT include any of the following. A PR that adds them is welcome but does not block M2.

1. **Roster live-reload.** `vscode.workspace.createFileSystemWatcher` on `teams.yaml` — M3 work. M2 loads the roster once at watcher start; no dynamic reload on YAML change.
2. **`state:delta` partial updates.** M2-06 uses `state:full` on every tick. Delta optimization is M4 work (per M2-06 OOS).
3. **Error-chip UI in the webview.** What renders when the file-watcher itself errors (not just an empty roster). Spec pending Iris's M3 design pass.
4. **Custom SVG Activity Bar icon.** Iris's M4 deliverable. M2 uses a codicon placeholder.
5. **Animation and transitions.** M4 scope.
6. **Roster-config editor UI.** Interactive YAML editor, roster live-edit — M3 scope.
7. **`state:delta` consumer in the webview.** M2-05 registers a handler for `state:delta` (AC2), but the delta-diffing logic on the host side is deferred to M4. M2 always receives `state:full`.
8. **Hook-tap tier (post-V1).** Sub-second updates via `SubagentStart`/`SubagentStop`/`PreToolUse` hooks. M5+ work.
9. **Cross-machine state correlation.** Out of V1 scope.
10. **Performance/load testing under high session counts.** M2 covers activation and single-session smoke; concurrent-session load is M3+.
11. **`vsce publish`.** Not shipping to the marketplace in V1.
12. **Pixel Agents coexistence hook conflicts.** M5+ work — no hook tap in M2.
13. **Subagent depth-3+ nesting in the webview.** V1 renders depth-1 and depth-2 (per M1-03 §1.5); depth-3+ flatten. M2 webview inherits this rule; no test beyond depth-2.

---

## Sage's QA workflow during M2 (operational note)

For every M2-XX PR opened, Sage:

1. Reads the PR diff + Self-Test Report (if required per the webview-smoke gate table above).
2. Runs the ticket's "Verification commands" against the author's worktree or a fresh clone of the PR branch.
3. Spot-checks at least one edge-case probe from this plan (chosen for the bug class most likely to regress).
4. **REQUEST CHANGES** if: Self-Test Report missing where required, AC walkthrough not present or missing screenshot evidence, regression test not named for the bug class, no negative-path assertion, schema-drift coverage missing for a parser PR, manual reload screenshot missing for M2-05 or M2-06, `vsce package` stdout missing for M2-01. Hard-line per testing-strategy.md "Sage's QA contract."
5. **APPROVE** when: all ACs met with cite-able evidence (file:line, screenshot, run-id URL), tests cover the bug class not just the instance, Self-Test Report complete where required, manual reload behavior confirmed.
6. Posts approval via `gh pr review --approve` or `gh pr comment` with "APPROVE" if shared-identity blocks.

**Drain-mode preference:** err toward approving non-critical nits. Reserve REQUEST CHANGES for failed AC, missing Self-Test Report, regression risk, or contract violations.

---

## Non-obvious considerations

1. **M2-03 tile spec pending.** This plan was authored while M2-03 was in flight. AC coverage for M2-05 visual-layout probes, hex color values, and the done-when checklist cross-reference in M2-05 carries a placeholder. Sage must update §M2-05 probes after M2-03 merges before signing off Maya's PR. This is a process dependency, not a content gap — the structural probes (CSP, static-fixture mode, `state:delta` wiring) are tile-spec-independent and complete.

2. **Layer-3 tests are authored by Sage (M2-08), not Felix or Maya.** This inverts the usual "author the implementation, Sage reviews" flow. Felix peer-reviews M2-08's test code as the host-side reviewer. Sage must not QA M2-08 (no self-QA rule) — Felix's APPROVE is the gate. The orchestrator admin-merges after Felix's APPROVE on M2-08.

3. **The `cwdToSlug` extraction (M2-04 AC5) is a regression test target.** If the shared slug produces different output from either of the two M1 copies (even by case or separator), the integration test suite would pass (using the shared implementation) while a production bug existed in the drill-in path (M2-06 AC3). The M2-06 edge-case probe for "schema-drift slug round-trip" is specifically designed to catch this class.

4. **`state:full` vs `state:delta` is a non-observable difference in M2.** The webview registers a handler for both per M2-05 AC2, but the host only sends `state:full` in M2 (M2-06 OOS). A test that verifies `state:delta` is handled is future-proof but currently exercises an untriggered handler. The delta-dispatch wiring test (M2-05 edge-case probe) is explicitly a "not yet triggered" variant — it protects against a future M4 regression, not a current M2 bug.

5. **The 5-second tile-appear SLA (done-when criterion 4) depends on a live Claude Code session.** If the user's machine has no running sessions at acceptance time, the empty-state is the correct answer — not a failure. The done-when text covers this. The orchestrator must not mark M2 failed solely because no live sessions were present during the check.
