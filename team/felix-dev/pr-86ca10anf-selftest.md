## Self-Test Report — 86ca10anf (flip `hideIdleAgents` default `true → false`)

**Sub-agent GUI gap applies:** I run headless — no `Developer: Reload Window`, no screenshots. Per `.claude/docs/testing-strategy.md § Sub-agent GUI gap`, AC(a) data-plane/automated proof is the load-bearing pre-merge gate (provided below); the interactive VS Code reload + Settings UI screenshot is **sponsor-side post-merge confirm-no-regression**. I did NOT perform a manual GUI reload.

### AC walkthrough (automated proof + code trace)

- **AC1 — `package.json` default flipped to `false` + description updated.** `claudeteam.hideIdleAgents.default` is now `false` (verified: `vsce package --no-yarn` succeeded with the manifest; grep `package.json:128 "default": false`). Description rewritten to "Default false — V1 ships the whole team always-visible … when set true … running-focused view." ✅
- **AC2 — code-level default fallbacks flipped; host read ⇄ wire default agree (no split-brain).** ✅
  - Host config-read: `main.ts:223` (`getHideIdleAgents`) `?? false`; `main.ts:442` (`toggleHideIdle` current-read) `?? false`; `watcherLoop.ts:292` (options-builder) `?? false`.
  - Filter-application: `watcherLoop.ts:591` `const hideIdle = opts.hideIdleAgents === true` (was `!== false`). Now matches the `hideFinished === true` sibling (`watcherLoop.ts:578`).
  - Wire serializer `messageBus.ts:88` (`=== true`), hash `watcherLoop.ts:696` (`=== true`), webview reader `render.ts:214-217` (boolean-typeof else `false`) — all already default-false; now ALL sites consistently treat absent → `false`.
- **AC3 — integration test updated.** `tests/integration/watcherLoop.test.ts` default-behavior test (was line ~635 comment + ~646 assertion) rewritten: omit `hideIdleAgents` → idle tile **stays** (`rosterTiles.get("claudeteam-alpha")` defined, length > 0), `hiddenIdleCount === 0`, `config.hideIdleAgents === false`. Explicit-on / explicit-off tests unchanged. ✅
- **AC4 — unit `hideIdleFilter.test.ts` intact.** Pure-filter logic unchanged; the filter still hides idle tiles when invoked with `hideIdle === true`. ✅
- **AC5 — toggle/chip preserved as a capability.** `headerChip.ts`, `teamCard.ts:229` (chip renders when `hideIdle === true && hiddenIdleCount > 0`), `provider.ts:263`, `messages.ts` `SetConfigMessage` union (`"hideIdleAgents"` member), `claudeteam.toggleHideIdle` command — ALL untouched except the toggle's fallback default. ✅

### Data-plane proof (the load-bearing pre-merge gate)

`tests/integration/watcherLoop.test.ts` describe-block `86c9zq9vm: runTick applies hideIdleAgents filter` exercises the full production `runTick()` path against a fixture filesystem (real meta.json + JSONL + sessions/{pid}.json). With `hideIdleAgents` omitted (the new V1 default), the idle Felix tile materializes and stays in `state.sessions[0].rosterTiles.get("claudeteam-alpha")` — the whole-team-always-visible behavior end-to-end through parse → reduce → filter → state-emit. All 16 watcherLoop integration tests green.

### Side-effect inventory

- **Roster matcher:** unaffected — the flip is post-reducer filter behavior, not matching.
- **Other filters:** `hideFinishedAgents` untouched (separate scalar, `=== true` default-false, line 578). `autoCollapseUniformClusters` untouched.
- **Message protocol:** `SetConfigMessage` union, wire `config.hideIdleAgents`, `hiddenIdleCount` — all unchanged shapes; only the default *value* flowing through them changed.
- **Hash/emission:** `hashState` includes `config.hideIdleAgents` (`=== true`) so a sponsor toggling the chip still re-emits; default change does not affect emission logic.
- **CLI (`cli/agentTree.ts`):** does not surface this filter (verified — no `hideIdle` references); unaffected.

### Failure-mode probes

- **Missing session file:** unchanged — filter runs post-reduction; an absent session yields no tiles to filter regardless of default.
- **Malformed JSONL line:** unchanged — parser/reducer handle malformed lines upstream; filter is downstream and default-agnostic to parse errors.
- **Schema mismatch (v2.1.119 vs v2.1.145 meta):** unchanged — schema detection is in the parser; filter operates on reduced state.
- **Empty roster:** unchanged — no rostered tiles → nothing to hide; `hiddenIdleCount === 0` either way.
- **Two sessions same `cwd`:** unchanged — they materialize separately; the filter applies per-tile within each session's `rosterTiles`.
- **Setting entirely unregistered (`get()` → undefined):** now resolves to `false` via the flipped `?? false` fallbacks — consistent with the package.json default; no split-brain.

### Extension-manifest gate (package.json touched)

`vsce package --no-yarn` output:
```
 DONE  Packaged: claudeteam-0.0.1.vsix (15 files, 489.01 KB)
```
15 files; `extension/dist/extension/main.cjs [696.41 KB]`; manifest validated. (Generated `.vsix` removed from worktree; `*.vsix` is gitignored.)

### Webview-smoke gate (sub-agent GUI gap)

Automated proof in lieu of interactive reload: data-plane proof above + `npm run build` (all bundles emitted) + `npm run typecheck` clean. **Interactive VS Code reload (open dashboard, confirm idle members now render by default, flip the chip ON to confirm hide-idle still works) = sponsor-side post-merge confirmation.** I did not and cannot perform the GUI reload.

### Evidence (verifiable)

- Branch HEAD SHA: `490652f97252d4b361286cb94576f9c679c347e4`
- `npm run typecheck` — clean (exit 0).
- `npm run build` — all 6 bundles emitted incl. `dist/extension/main.cjs`.
- `npm run test:unit` — **730 passed / 2 skipped / 0 failed**.
- `npm run test:integration` — **111 passed / 0 failed** (incl. 16 watcherLoop tests).
- `vsce package --no-yarn` — `Packaged: claudeteam-0.0.1.vsix (15 files, 489.01 KB)`.
- `node -e "require('./dist/extension/main.cjs')"` — fails on `Cannot find module 'vscode'` (expected: `vscode` is host-provided; this is NOT `ERR_REQUIRE_ESM`, confirming the `.cjs` format is valid — the bundle executed to its `require("vscode")` line).
