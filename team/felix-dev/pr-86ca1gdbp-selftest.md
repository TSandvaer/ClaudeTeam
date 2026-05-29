## Self-Test Report — 86ca1gdbp (remove global hide-finished/hide-idle chips)

Sub-agent GUI gap applies (Felix author + Maya reviewer, both headless). AC(a) data-plane smoke is the load-bearing pre-merge check; interactive-screenshot ACs defer to sponsor post-merge confirm per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap".

### AC walkthrough

- **AC1 — both global chips gone:** `renderHeaderChip` deleted (`headerChip.ts` removed); both `renderHeaderChip` mounts removed from `render.ts`. Grep for `renderHeaderChip`/`ct-header-chip` across `src/` returns 0 live refs. ✅ (data-plane: the CLI driver renders the live tree with no chip surface — chips are webview-only, verified absent via grep + unit suite).
- **AC2 — settings / commands / messages removed:** `package.json` no longer declares `claudeteam.hideFinishedAgents` / `claudeteam.hideIdleAgents` (config) or `claudeteam.toggleHideFinished` / `claudeteam.toggleHideIdle` (commands) — confirmed by `vsce package --no-yarn` succeeding with no schema error. `SetConfigMessage` + `ui:set-config` removed from `messages.ts` + `provider.ts`; the guard now rejects `ui:set-config` (2-case test). ✅
- **AC3 — per-member hide/remove/show-hidden + baseline/available + multi-agent tiles UNREGRESSED:** `hideMembersFilter.ts` + `removeMembersFilter.ts` behavior untouched (only a doc-comment note updated). `hideMember.test.ts` (31), `removeMember.test.ts` (19), `availableTile.test.ts` (7), `multiAgentPersonaTile.test.ts` (35), `collapsedPersonaTile.test.ts` (62) all green. Live data-plane smoke (CLI driver against real `~/.claude/`) materialized 3 live sessions + 22 background agents with correct running/idle/finished classification and the background-count chip — full parse→match→reduce pipeline intact. ✅
- **AC4 — removed-filter tests deleted, suite green, no dangling refs:** 4 test files deleted; removed-field assertions pruned from 7 others. Full suite: 915 unit + 118 integration green. Grep for `hideFinished`/`hideIdle`/`set-config` across `src/` returns only one intentional explanatory note in `hideMembersFilter.ts`. ✅

### Side-effect inventory

- **Reducer pipeline (`watcherLoop.runTick`):** filter chain shortened — `buildAgentTree` → `applyHideMembersFilter` → `applyRemoveMembersFilter`. The two state-filters were the first links; `applyHideMembersFilter` now takes `tree` directly. Order is irrelevant (member-hide predicate is state-independent).
- **Wire shape (`SerializedDashboardState` / `AgentTree`):** four fields dropped (`hiddenFinishedCount`, `hiddenIdleCount`, `config.hideFinishedAgents`, `config.hideIdleAgents`). `config.autoCollapseUniformClusters` + the hide/remove-member surfaces remain. `hashState` no longer hashes the dropped fields (no spurious re-emit on a setting that no longer exists).
- **Message protocol:** `WebviewMessage` union lost `SetConfigMessage`. Remaining webview→host messages (`ui:open-transcript`, `ui:open-roster`, `ui:refresh`, `ui:hide-member`, `ui:show-member`, `ui:show-all-hidden`, `ui:remove-member`, diagnostic trio) unchanged.
- **Command palette / Settings UI:** two fewer commands, two fewer settings. `subscriptionLeak` count 9 → 7.
- **CSS:** `.ct-header-chip*` + `.ct-team-idle-row` rules removed; the source-derived `[hidden]`-guard test (`removeMember.test.ts`) auto-excludes the deleted classes and still passes (non-vacuous).

### Failure-mode probes

- **Missing session file:** unchanged — session-registry + reducer paths untouched; integration `watcherLoop.test.ts` (20 tests) green incl. dead/missing-session cases.
- **Malformed JSONL line:** unchanged — parser/tailer untouched; `fixtureFs.test.ts` (40) green.
- **Schema mismatch (v2.1.119 / v2.1.145 / persona-named meta):** unchanged — matcher + meta loader untouched; `readSessionMetadata.test.ts` (17) green.
- **Empty roster:** unchanged — live smoke shows "no rostered teams matched" gracefully (no roster on survey root) with the background chip still rendering.
- **Stale webview sends `ui:set-config`:** `isWebviewMessage` now returns `false` → the message is dropped by `onUnknown` (no handler, no crash). Regression-guarded by 2 new dispatch-test cases.
- **Two sessions same cwd:** unchanged — `sessionFilter.test.ts` (7) green.

### Screenshot ACs

Deferred to sponsor post-merge confirm per sub-agent GUI gap (no GUI runtime). The change removes UI surface (chips); the remaining dashboard rendering code is unchanged, so visual-regression risk is low (a removed-element confirm, not a new-element confirm).
