## Summary

ClickUp ticket: `86c9yxv94` (P3 bug — V1 dogfood Defect 6a per Bram's triage `team/bram-research/86c9yteju-triage-2026-05-26.md` § Defect 6a).

Sponsor's V1 dogfood Observation 6 saw `"Bram finished 2s"` static on a tile for minutes after Bram actually completed — the `2s` was unrelated to finish-time elapsed. Root cause: `buildActivity("finished", …)` returned the bare string `"finished"`; there was no finish timestamp threaded through the reducer to compute elapsed time. The dashboard couldn't distinguish "just finished" from "finished 20 min ago."

This PR introduces `FinishedMap = Map<agentId, finishedAtMs>` (was `FinishedSet = Set<string>`), sources the timestamp from the parent JSONL `tool_result` record's top-level `timestamp` ISO-8601 field, and emits `"finished Xs"` on the tile's `activity` string.

## Changes

- `src/extension/state/reducer.ts` — `FinishedSet` → `FinishedMap`; `buildActivity` accepts optional `finishedAtMs`, renders `"finished ${elapsedS}s"` when supplied and bare `"finished"` when omitted (back-compat). Exported for direct unit-test exercise.
- `src/cli/agentTree.ts` — `readFinishedToolUseIds` returns `Map<toolUseId, finishedAtMs>`; `collect()` propagates timestamps into `finishedIds`.
- `src/extension/watcher/watcherLoop.ts` — same parser change; same map propagation in `runTick`.
- `.claude/docs/data-sources.md` § "Liveness inference" — captures the timestamp-source contract (top-level `timestamp` field, parser sentinel semantics).
- `tests/unit/reducer.test.ts` — 11 new tests covering AC4 literal + edge cases + `buildAgentTree` integration; existing finished-tile test updated to expect the elapsed suffix.
- `tests/integration/fixtureFs.test.ts` — `FinishedSet` → `FinishedMap` in helpers; AC2.4 finished-detection test now asserts `/^finished \d+s$/` regex (timing-robust against the `appendFinishedToolResult` helper's `new Date().toISOString()` stamp).

## Acceptance criteria

- [x] **AC1:** `FinishedMap = Map<string, number>` replaces `FinishedSet = Set<string>` in `src/extension/state/reducer.ts` line 60. Value = epoch ms parsed from the parent JSONL `tool_result` record's top-level `timestamp` field via `Date.parse`. Verifiable: `grep -n "FinishedMap" src/extension/state/reducer.ts` returns the type declaration.
- [x] **AC2:** `buildActivity("finished", activity, nowMs, finishedAtMs?)` returns `"finished ${elapsedS}s"` when `finishedAtMs !== undefined`; bare `"finished"` otherwise. Source: `src/extension/state/reducer.ts:445-466`.
- [x] **AC3:** Callers updated — `src/extension/watcher/watcherLoop.ts:340-353` (host `runTick`) and `src/cli/agentTree.ts:235-244` (CLI) read the parent JSONL `tool_result` record's `timestamp` field, parse via `Date.parse`, propagate through `FinishedMap.set(agentId, finishedAtMs)`.
- [x] **AC4:** Unit test `buildActivity("finished", undefined, 1000, 0)` returns `"finished 1s"` — `tests/unit/reducer.test.ts:1000-1003` (`buildActivity — finished elapsed-time suffix (86c9yxv94)` block, first test).
- [x] **AC5:** No regression — `397 unit + 71 integration tests green` locally (vitest run pre-push, CI run pending). Lint clean (`npm run lint`). Typecheck clean (`npm run typecheck`). `vsce package --no-yarn` succeeds (`claudeteam-0.0.1.vsix`, 388.2 KB, 10 files).

## Vocabulary contract (parallel work — Obs 6b on Maya's lane)

Maya's parallel ticket `86c9yxvah` (Obs 6b, `CollapsedPersonaGroup` state-label aggregation) touches `src/webview/components/collapsedPersonaTile.ts` (or equivalent) only. **This PR does NOT change the wire field name carrying finished-state.** The reducer's `finishedIds` parameter is host-internal, not webview-facing. The webview-visible `activity` string on each `AgentTile` is the only changed surface: `"finished"` → `"finished Xs"` when a timestamp is available. The `state` field stays unchanged (`"running" | "idle" | "finished" | "error"`). Maya reads `state` to compute group aggregation; her code path is unaffected.

The `CollapsedPersonaGroup.instances[]` shape and the wire payload are untouched — `Map<string, AgentTile[]>` (host-side) flattens via the same `messageBus.ts` `serializeState` pattern; no Map-on-the-wire field renames in this PR.

## Live data-plane smoke (sub-agent GUI gap — Self-Test Report below)

Ran `node dist/cli/agentTree.js --claude-home "$HOME/.claude" --roster c:/Trunk/PRIVATE/ClaudeTeam/.claude/teams.yaml` from the ClaudeTeam project root. Live `~/.claude/` had session `c68d51dd` (PID 35944) with 10 rostered + 3 background agents. Output:

```
SESSION c68d51dd  [claude-vscode]  pid=35944  v2.1.145  state=alive
  cwd:   c:\Trunk\PRIVATE\ClaudeTeam
  TEAM ClaudeTeam Alpha  (10 rostered, 3 background in this session)
    [v]  Felix    Extension Hos..  finished 2671s                  claude-opus-4-7
    [v]  Felix    Extension Hos..  finished 1199s                  claude-opus-4-7
    [v]  Felix    Extension Hos..  finished 48678s                 claude-opus-4-7
    [v]  Felix    Extension Hos..  finished 703s                   claude-opus-4-7
    [v]  Maya     Webview UI Dev   finished 1186s                  claude-opus-4-7
    [v]  Maya     Webview UI Dev   finished 362s                   claude-opus-4-7
    [v]  Maya     Webview UI Dev   finished 2033s                  claude-opus-4-7
    [v]  Maya     Webview UI Dev   finished 556s                   claude-opus-4-7
    [v]  Iris     UX Designer      finished 1164s                  claude-opus-4-7
    [v]  Bram     Internals Con..  finished 3940s                  claude-sonnet-4-6

    + 3 background agents (this session)
        - general-purpose  "Agent A — code-path trace"  finished  claude-sonnet-4-6
```

Each rostered tile now shows its individual elapsed time. The most-recent Maya (362s ≈ 6 min ago) clearly distinguishes from the oldest Felix (48678s ≈ 13.5 hours ago) — that distinction was previously lost. Background agents (which don't carry an `activity` field — `BackgroundAgent.state` is a literal word) render `finished` unchanged.

## Test plan

- [x] Layer 1 (vitest unit) — 397 passed, 2 skipped (pre-existing skips unrelated). Reducer block has 11 new `86c9yxv94` tests including the AC4 literal case.
- [x] Layer 2 (integration / fixture FS) — 71 passed. Includes Felix's M4-04-fixture `mainReplay.test.ts` (3 tests) that landed on main post-rebase.
- [x] Manual CLI smoke — see live data-plane block above.
- [ ] Layer 3 (`@vscode/test-electron`) — CI will run on push.

## Files in play

- Owned: `src/extension/state/reducer.ts`, `src/cli/agentTree.ts`, `src/extension/watcher/watcherLoop.ts`, `tests/unit/reducer.test.ts`, `tests/integration/fixtureFs.test.ts`, `.claude/docs/data-sources.md`.
- Read-only references: `team/bram-research/86c9yteju-triage-2026-05-26.md` § Defect 6a, `team/dogfood/2026-05-25-session-lifecycle-quirks.md` § Observation 6.

## Self-Test Report posted

Will post as a follow-up comment on this PR — see ticket `86c9yxv94` Self-Test Report block (sub-agent GUI gap reframe applies: AC(a) live data-plane smoke is load-bearing pre-merge, AC(b-d) interactive screenshots deferred sponsor-side post-merge per testing-strategy.md § "Sub-agent GUI gap — webview-smoke workaround").

## Doc updates

- `.claude/docs/data-sources.md` § "Finished timestamp source (86c9yxv94)" — new subsection under "Liveness inference" capturing the parent JSONL timestamp contract.
