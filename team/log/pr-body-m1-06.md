# feat(parser): subagent JSONL tailer + activity extraction

Ticket: [ClickUp 86c9y5ccb](https://app.clickup.com/t/86c9y5ccb) — M1-06.
Branch: `felix/m1-06-jsonl-tailer` (forked from `origin/main`).
Peer reviewer: **Maya**.

## What this adds

`src/extension/watcher/subagentTailer.ts` — pure async function `readActivity(jsonlPath) → SubagentActivity` that tails a subagent JSONL and extracts:

- **`model`** — resolved model from the FIRST `type:"assistant"` record's `message.model`.
- **`lastTool`** — tool name from the LAST `tool_use` content entry in the LAST `type:"assistant"` record. Null when the last assistant is text-only.
- **`lastTimestamp`** — epoch ms parsed from the last assistant record's ISO timestamp.
- **`mtimeMs`** — `fs.stat` mtime of the JSONL file. 0 when file missing.

Pure projection — no liveness / finished inference. The reducer (M1-09) decides finished by cross-referencing the parent transcript's `tool_result` with `meta.json.toolUseId` (Bram's M1-11 finding, codified in `.claude/docs/data-sources.md` §3).

## AC walkthrough

| AC | Where | Evidence |
|----|-------|----------|
| AC1 | `src/extension/watcher/subagentTailer.ts:79` (`export async function readActivity`) + `src/shared/types.ts:113` (`SubagentActivity`) | Returns `{ model, lastTool, lastTimestamp, mtimeMs }`. |
| AC2 | `src/extension/watcher/subagentTailer.ts:43` (`TAIL_BYTES = 256 * 1024`) + tests/unit/subagentTailer.test.ts: `handles a 50MB JSONL in <100ms` | Test asserts `dt < 100`ms after constructing a ~50MB file. Passed locally (see test output below). |
| AC3 | Tests: missing/empty/metadata-only/multi-tool-use/text-only-last | 13 tests, all green. |
| AC4 | `tryParse` (subagentTailer.ts:151) returns null on any JSON.parse throw → caller skips line. Test: `malformed line in middle: skipped` | Mixed valid+truncated+garbage lines still resolve `lastTool: "Grep"`. |
| AC5 | `src/shared/types.ts:113-138` | `SubagentActivity` exported, extended (not redefined). |
| AC6 | `tests/unit/subagentTailer.test.ts` | All three Bram fixtures covered + 9 synthesized scenarios + perf. |
| AC7 | `npm run test -- subagentTailer` | 13 / 13 passed. |

## Verification (local, exit codes)

```
$ npm run typecheck   # exit 0
$ npm run lint        # exit 0 (eslint silent on success)
$ npm run test -- subagentTailer
  Test Files  1 passed (1)
       Tests  13 passed (13)
       Start at  14:01:47
       Duration  1.72s
$ npm run test        # full suite
  Test Files  3 passed (3)
       Tests  57 passed (57)   (matcher 28 + tailer 13 + loader 16)
$ npm run build       # exit 0 (scaffold-only stub)
```

## No-closing-message handling (per Bram's M1-11 finding)

`.claude/docs/data-sources.md` §3 "JSONL closing semantics" documents that **a subagent JSONL never contains a closing assistant message** — the final record is always a `type:"user"` tool_result; the closing/result lives in the PARENT JSONL.

This tailer is deliberately **finished-state-agnostic**:

1. The implementation comment block at the top of `subagentTailer.ts` (point 4) calls this out explicitly so future contributors don't add a `stop_reason === "end_turn"` heuristic against the child JSONL.
2. The `subagent-finished.jsonl` test (`tests/unit/subagentTailer.test.ts`) asserts the tailer produces a sensible `model + lastTimestamp` for that fixture but **does NOT** claim "finished" — the fixture's synthesized line 7 (with `requestId: "req_SYNTHESIZED"`) only exists to give the parser a text-only-last-assistant case. The same shape is produced for `subagent-running.jsonl` (line 18 is also a text-only assistant message).
3. `readActivity` documents `lastTool` as "what the agent was last doing" — explicitly NOT "running" or "finished". The reducer (M1-09) owns that state derivation.

## Non-obvious findings (for maintain-docs)

1. **Two-pass over the tail buffer is simpler than one-pass with state.** The forward pass extracts `model` (first assistant wins); the backward pass extracts `lastTool` + `lastTimestamp` (most recent assistant wins). Each is O(N) over the bounded tail window. Threading both projections through one walk would require remembering "have I seen any assistant yet?" plus "have I resolved model yet?" — readable cost > performance gain on a 256 KiB buffer.

2. **The tail-window read intentionally drops the first partial line.** When `start > 0` we sliced through a record mid-byte; the first newline in the buffer marks the start of the next complete record. We discard everything before it. For files <256 KiB we read from offset 0 and keep every line.

3. **The 50MB perf test cannot validate `model` extraction.** The first assistant record (head of file) is BY DEFINITION outside the tail window for files >256 KiB. The test asserts `lastTool === "Grep"` instead, and the comment notes `model` is expected null in that synthetic case. This is a known V1 tradeoff documented at the top of `subagentTailer.ts` (point 2). A future two-pass implementation (head + tail) could fix it; out of scope for M1-06.

4. **Defensive: `name_prefix` / `tool_use.name` rules never coerce null.** The tailer rejects non-string `name` fields (test `tool_use entry with non-string name: returns null`) so a malformed record can't shadow a valid one with `null` propagating up. Mirrors the matcher's null-rejection pattern.

5. **No `chokidar`/`fs.watch` here.** This ticket is the pure read fn; polling logic lives in M1-09's file-watcher orchestrator. Decision: defer the watcher-implementation choice (native `fs.watch` vs `chokidar`) to M1-09 where it actually matters.

6. **Timestamp parse via `Date.parse` is the cheapest correct call.** ISO-8601 strings from Claude Code records (`"2026-05-23T10:54:54.379Z"`) round-trip cleanly. We return 0 sentinel on `NaN` so downstream comparisons (`lastTimestamp > X`) are well-defined.

## Files touched

- `src/extension/watcher/subagentTailer.ts` — NEW (240 lines, exhaustively commented).
- `src/shared/types.ts` — extended with `SubagentActivity` (35 lines of type + comments).
- `tests/unit/subagentTailer.test.ts` — NEW (13 tests).
- `team/log/clickup-pending.md` — appended `ENTRY 009: 86c9y5ccb -> in review` inside existing `## Status-flip queue` fence.

## What's deliberately out of scope

- No polling loop (M1-09).
- No state reduction or finished-state derivation (M1-09).
- No `meta.json` reading (M1-05, in-flight PR #11).
- No filesystem watching primitive choice (M1-09).
