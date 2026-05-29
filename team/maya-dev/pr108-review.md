## REVIEW VERDICT: APPROVE

Peer review (Felix ↔ Maya). Reviewed at branch HEAD `490652f97252d4b361286cb94576f9c679c347e4`. CI green: `typecheck + lint + unit` → `COMPLETED / SUCCESS`.

### AC1 — package.json default flipped + description updated ✅
`package.json:128` `"default": false` (was `true`). Description rewritten to lead with "Default false — V1 ships the whole team always-visible … When set true … running-focused view." Diff confirms both.

### AC3 — no split-brain (the high-value check) ✅
Grepped every `hideIdleAgents` read/default site across `src/`. All sites now agree that absent/undefined → `false`:
- Host config-read fallback: `main.ts:223` `?? false`, `main.ts:442` (`toggleHideIdle` current-read) `?? false`, `watcherLoop.ts:292` (per-tick options-builder) `?? false`.
- Filter-application: `watcherLoop.ts:591` `opts.hideIdleAgents === true` — was the lone `!== false` (default-true) outlier; now matches the `hideFinished === true` sibling (line 578).
- Wire serializer: `messageBus.ts:88` `=== true` (unchanged — already default-false).
- Hash: `watcherLoop.ts:696` `=== true` (unchanged).
- Webview reader: `render.ts:214-217` `typeof … === "boolean" ? … : false` (unchanged).

Confirmed the lone outlier Felix reported (`watcherLoop.ts:591`) is exactly the one site flipped. No remaining `!== false` or `?? true` for `hideIdleAgents` anywhere in `src/`. Split-brain eliminated.

### AC4 — tests ✅
- `tests/integration/watcherLoop.test.ts:623` default-behavior test rewritten: omit `hideIdleAgents` → idle tile **stays** (`rosterTiles.get("claudeteam-alpha")` defined, length>0), `hiddenIdleCount === 0`, `config.hideIdleAgents === false`. Correct inversion of the old default-true assertion.
- `tests/unit/hideIdleFilter.test.ts` — **NOT touched** (verified via `git diff origin/main...HEAD --name-only`). Suppression path stays fully covered: `hideIdleFilter.test.ts:138` "drops idle tiles and counts them" (count 1) + CollapsedPersonaGroup / multi-session / empty-team suppression cases. Pure-filter logic unweakened — correct layer decomposition (integration owns wiring/default, unit owns the filter).
- Explicit-off (line 650) + filter-on-with-running (line 674) integration tests retained.

### OOS respected ✅
- `hideFinishedAgents` untouched (separate scalar, `=== true` default-false at line 578).
- Toggle/chip/command intact: `headerChip.ts:84`, `teamCard.ts:229` (chip renders when `hideIdle === true && hiddenIdleCount > 0`), `provider.ts:263`, `messages.ts` `SetConfigMessage` union still carries `"hideIdleAgents"`, `claudeteam.toggleHideIdle` command (only its fallback default flipped). The capability is preserved; only the default changed.

### Vocabulary / conflict ✅
`gh pr list --state open` → PR #108 is the only open PR. No in-flight conflict. No new shared types introduced.

### Webview-smoke note
Sub-agent GUI gap correctly applied: data-plane proof (16 watcherLoop integration tests green, full `runTick()` path) is the load-bearing pre-merge gate; interactive VS Code reload + Settings-UI confirm deferred to sponsor post-merge per `testing-strategy.md § Sub-agent GUI gap`. Acceptable here — this is a default-value flip touching host config-read + filter-default, no webview rendering/CSS change.

### Verdict
APPROVE. Clean, surgical, well-traced. No blockers.
