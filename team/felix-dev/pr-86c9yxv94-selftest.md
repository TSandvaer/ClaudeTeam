## Self-Test Report — PR 86c9yxv94 (finished-elapsed suffix)

### AC walkthrough

- **AC1: `FinishedMap = Map<agentId, finishedAtMs>` replaces `FinishedSet = Set<string>`** — verified by inspection of `src/extension/state/reducer.ts:60` (type declaration). `grep -n "FinishedMap" src/extension/state/reducer.ts` confirms the type is exported. All call sites updated (4 source files, 2 test files).
- **AC2: `buildActivity("finished", …, finishedAtMs?)` produces `"finished ${elapsedS}s"` when timestamp supplied; bare `"finished"` otherwise** — verified by `tests/unit/reducer.test.ts:1000-1100+` (`buildActivity — finished elapsed-time suffix (86c9yxv94)` block — 8 direct-exercise tests + 2 buildAgentTree integration tests).
- **AC3: All callers updated to capture and pass timestamps** — verified by `src/extension/watcher/watcherLoop.ts:340-353` (host runTick path, reads `tool_result` record's top-level `timestamp` field, `Date.parse` to epoch ms, `finishedIds.set(agentId, finishedAtMs)`) and `src/cli/agentTree.ts:235-244` (CLI path, identical contract).
- **AC4: `buildActivity("finished", undefined, 1000, 0)` returns `"finished 1s"`** — verified by `tests/unit/reducer.test.ts:1000-1003` (literal AC4 test case as named in commit/PR body).
- **AC5: No regression** — `npm test` → 397 passed, 2 skipped (pre-existing). `npm run test:integration` → 71 passed. `npm run typecheck` clean. `npm run lint` clean. `npx vsce package --no-yarn` produced `claudeteam-0.0.1.vsix` (10 files, 388.2 KB) without errors.

### Side-effect inventory

- **Reducer (`src/extension/state/reducer.ts`):** type rename (`FinishedSet` → `FinishedMap`) + signature change on `inferState` + `buildActivity` gained optional `finishedAtMs` parameter + `buildActivity` now exported (was `function buildActivity`, now `export function buildActivity`). Only `tests/unit/reducer.test.ts` imports `buildActivity` directly; no other call sites.
- **Watcher loop (`src/extension/watcher/watcherLoop.ts`):** `readFinishedToolUseIds` return type changed from `Set<string>` to `Map<string, number>`. Internal helper — only called by `runTick`.
- **CLI (`src/cli/agentTree.ts`):** identical change pattern. CLI smoke confirms output unchanged in shape, only the `activity` string for rostered tiles now carries elapsed seconds.
- **Wire protocol (`AgentTile.activity` field):** string value changes from `"finished"` → `"finished Xs"` when timestamp present. **No type rename on the wire** — `activity` field name, `state` field name, all serialized shapes unchanged. Maya's `86c9yxvah` work on `CollapsedPersonaGroup` aggregation reads `state` (not `activity`), so the two PRs do not collide.
- **Tests:** integration fixture helper `appendFinishedToolResult` (in `tests/integration/helpers/tempdir.ts`) was already writing a `timestamp` ISO-8601 field on every tool_result record (line 271, `new Date().toISOString()`) — no helper change needed, the timestamp source was already in the fixture.

### Live data-plane smoke (load-bearing per testing-strategy.md sub-agent GUI gap reframe)

Ran the CLI driver against live `~/.claude/`:

```
$ cd c:/Trunk/PRIVATE/ClaudeTeam && \
  node c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/dist/cli/agentTree.js \
    --claude-home "$HOME/.claude" \
    --roster c:/Trunk/PRIVATE/ClaudeTeam/.claude/teams.yaml
```

Output (rostered tiles only — full output in PR body):

```
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
```

**Verification of the math:** the 362s Maya tile maps to the most recent Maya dispatch on disk (Maya's `86c9yxvah` triage review ~6 minutes before the smoke run). The 48678s Felix tile maps to a Felix dispatch ~13.5 hours ago (the `86c9yteju` doc-captures PR #65). Elapsed times scale correctly across the agent timeline.

### Failure-mode probes (per testing-strategy.md § Self-Test contract)

- **Missing parent JSONL:** `readFinishedToolUseIds` catches `readFileSync` failure, returns empty Map. Verified by code path in `src/extension/watcher/watcherLoop.ts:493-498` (try/catch returns `new Map()`).
- **Malformed JSONL line:** per-line try/catch inside `readFinishedToolUseIds` skips unparseable lines without aborting the scan. Verified in `src/extension/watcher/watcherLoop.ts:519-521`.
- **Missing `timestamp` field on a `tool_result` record:** `ts = rec["timestamp"]`; `typeof ts !== "string"` → `finishedAtMs = 0`. Map entry still created — agent marked finished, but elapsed renders as `nowMs / 1000` seconds (very large diagnostic value). Documented behavior; not encountered in production. Pinned by unit test `buildAgentTree: agentId in finishedIds with value 0 → 'finished <huge>s' (sentinel pass-through)` in `tests/unit/reducer.test.ts`.
- **Unparseable timestamp string** (e.g. `timestamp: "garbage"`): `Date.parse("garbage") = NaN`; `Number.isFinite(NaN) === false` → `finishedAtMs = 0`. Same fallback as missing field.
- **Schema mismatch** (v2.1.119 vs v2.1.145 meta.json): unchanged — the reducer's finished-detection key is `meta.toolUseId` matched against parent `tool_result.tool_use_id`. v2.1.119 has no `toolUseId` so its agents never enter `finishedIds` (existing behavior, unchanged by this PR).
- **Empty roster:** unchanged — `buildAgentTree` still produces background-only output. Verified by integration test `tests/unit/reducer.test.ts:337-355` (`empty roster → all agents in background`).
- **Two sessions with same `cwd`:** unchanged — each `SessionRecord` is processed independently with its own `parentJsonlPath`. Verified by integration test `tests/integration/fixtureFs.test.ts` AC2.5 block.

### Interactive screenshot ACs (deferred per sub-agent GUI gap reframe — testing-strategy.md § "Sub-agent GUI gap — webview-smoke workaround")

- **Reload Window:** N/A — sub-agent has no GUI. Sponsor post-merge confirm.
- **Tile transition `tool:X → finished Ns` with advancing elapsed time:** N/A — same. The live CLI smoke above confirms the data-plane (the load-bearing path); webview rendering of the activity string is unchanged (Maya's render path reads `tile.activity` verbatim — string content change only).
- **Theme toggle (dark/light):** N/A — no CSS change.
- **Output channel capture:** N/A — no logger change.

Sponsor obligation per docs: open the ClaudeTeam Activity Bar at next convenient opportunity, confirm rostered tiles show `finished Xs` rather than bare `finished`, note in ticket comment.

### Doc updates

- `.claude/docs/data-sources.md` § "Liveness inference" — new "Finished timestamp source (86c9yxv94)" subsection captures the parent JSONL `timestamp` field contract, the `FinishedMap` shape, and the parser's `0` sentinel semantics.
