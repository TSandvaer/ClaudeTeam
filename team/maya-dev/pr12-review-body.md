## APPROVE — peer review (Maya)

PR #12 — `feat(parser): subagent JSONL tailer + activity extraction` (M1-06, ticket `86c9y5ccb`).

Pulled `felix/m1-06-jsonl-tailer` (commit `ceee407`) into `c:/Trunk/PRIVATE/ClaudeTeam-maya-wt` and reproduced Felix's claims firsthand.

### Local repro

| Command | Exit | Evidence |
|---|---|---|
| `npm install` | 0 | clean lockfile |
| `npm run typecheck` | 0 | `tsc --noEmit` silent |
| `npm run test -- subagentTailer` | 0 | **13 / 13 tests passed** in 123 ms |
| `npm run test` (full suite) | 0 | **80 / 80 passed** — matcher 28 + meta 23 + tailer 13 + loader 16 |
| CI run [`26332188348`](https://github.com/TSandvaer/ClaudeTeam/actions/runs/26332188348) | `success` | confirmed green via `gh run view` |

### AC walkthrough (cite-validated)

- **AC1 — `readActivity(jsonlPath): SubagentActivity`** — `src/extension/watcher/subagentTailer.ts:75` exports `async function readActivity(jsonlPath: string): Promise<SubagentActivity>`. Return shape matches spec at `src/shared/types.ts:167-172` (`{ model, lastTool, lastTimestamp, mtimeMs }`). Async-ness is correct for fs ops — the AC text didn't bind sync/async, and async aligns with how M1-09 will consume it. ✓
- **AC2 — Tail-window read, 50 MB <100 ms** — `TAIL_BYTES = 256 * 1024` at `subagentTailer.ts:53`; `fs.open + fh.read(buf, 0, length, start)` at `:99-104` reads only the tail window. Performance test at `tests/unit/subagentTailer.test.ts:260` constructs a real ~50 MB file via streamed `appendFileSync` and asserts `dt < 100` ms — green locally. ✓
- **AC3 — Edge cases** —
  - Missing file → `EMPTY_ACTIVITY` sentinel at `:84` (no throw); test `:106`.
  - Empty file → sentinel with real mtime at `:90`; test `:116`.
  - Only-metadata → forward+backward passes both find no assistant; test `:133`.
  - Multi `tool_use` → `extractLastToolName` walks `content[]` backward at `:225`, returning the LAST `tool_use.name`; test `:151` asserts `"Edit"` (last of three).
  - Text-only last assistant → `extractLastToolName` returns null when no `tool_use` in content; test `:169` confirms `model` still resolved and `lastTool: null`. ✓
- **AC4 — Malformed JSONL skipped** — `tryParse` at `:181` catches every parse failure and returns null; forward/backward loops skip null records. Test `:187` mixes a truncated line + plain garbage + valid records; asserts `lastTool: "Grep"` from the surviving valid record. ✓
- **AC5 — `SubagentActivity` extends `types.ts`** — `src/shared/types.ts:167-172` adds the interface alongside existing `AgentMeta` / `Team` / `MatchResult` / `RosterLoadResult` types. Tailer imports via `../../shared/types.js` (`:44`). No redefinition. ✓
- **AC6 — Tests use M1-02 fixtures** — `tests/fixtures/subagent-running.jsonl`, `subagent-finished.jsonl`, `subagent-malformed.jsonl` all consumed at `tests/unit/subagentTailer.test.ts:42-98`. Verified fixture line-counts (18 / 7 / 3 lines) match Bram's M1-02 research note. ✓
- **AC7 — All tests pass** — local `npm run test -- subagentTailer` shows `13 passed (13)` (123 ms). Full suite `80 / 80` green. CI run `26332188348` reported `conclusion: success`. ✓

### Bram's M1-11 finding — verified correctly applied

The dispatch brief flagged a specific risk: that Felix's tests might ASSUME a closing assistant message in `subagent-finished.jsonl`, which Bram's PR #9 update to `.claude/docs/data-sources.md` §3 documents as never occurring in real captures. Closing-state detection is the reducer's job (M1-09 via parent JSONL `tool_result` correlation), not the tailer's.

Verification:

1. **Implementation comment block** `subagentTailer.ts:27-32` (point 4) calls out the no-closing-message semantics explicitly: *"Per Bram's M1-11 finding (data-sources.md §3 'JSONL closing semantics'), subagent JSONLs NEVER carry a closing assistant message in the wild. The reducer (M1-09) detects finished state by cross-referencing the parent transcript's `tool_result` with `meta.json.toolUseId`. This tailer reports 'what was last happening' regardless of whether the agent has actually finished."*
2. **`subagent-finished.jsonl` test** `tests/unit/subagentTailer.test.ts:65-81` carries the comment *"The tailer does NOT claim 'finished' — it just reports what it saw"* and asserts only `model` + `lastTool: null` (line 7 is text-only) + `lastTimestamp`. No "finished"/"stop_reason" branch is exercised as a state assertion. ✓
3. **`subagent-running.jsonl` test** `:42-63` asserts `lastTool: null` because the real fixture's line 18 is a text-only assistant (`"Now npm install and run the done-when test."`) — verified by tailing the fixture. This is the correct projection: tailer reports the most recent assistant's `tool_use` shape regardless of file position. ✓

The "finished" detection lives outside this PR's scope, exactly as the dispatch brief required.

### Non-obvious findings (good docs material)

Felix's PR body lists 6 findings; the standouts I'd flag for `.claude/docs/`:

1. **Two-pass over tail buffer** (forward for model, backward for lastTool) is simpler than single-pass with state. O(N) bounded; readable. Worth a short note in `vscode-extension-conventions.md` or a future `parsers.md`.
2. **Tail-window drops the partial first line** when `start > 0`. Sliced mid-record bytes get discarded at the first newline (`subagentTailer.ts:110-117`). Future maintainers will appreciate the rationale comment.
3. **50 MB perf test cannot validate `model`** — first assistant is by definition outside the tail window for >256 KiB files. Tradeoff documented at `:18-21`. Future M-tier optimization could do a head-read; not now.
4. **`name` field rejected when non-string** (`extractLastToolName:233`) — defensive `typeof name === "string"` check so malformed `name: null` doesn't propagate. Mirrors matcher's null-rejection pattern.

### Nits (non-blocking)

- **`subagent-running.jsonl` test comment minor wording** (`tests/unit/subagentTailer.test.ts:50-55`): "*Walking backward: line 16 is the LAST assistant with a tool_use, but the tailer's contract is 'most recent assistant message' — and line 18 IS more recent.*" The phrasing is correct but reads twice; consider tightening to "the tailer reports the most recent assistant message regardless of whether it carries a tool_use; line 18 is text-only so lastTool is null." Non-blocking — semantics are right.
- **`Buffer.allocUnsafe` at `:97`** is fine because the entire buffer is overwritten by `fh.read` before we touch it. A comment to that effect would help future readers who flinch at `allocUnsafe`. Non-blocking.

Neither nit warrants REQUEST CHANGES. Per drain-mode preference, erring toward APPROVE.

### Verdict

**APPROVE.** Seven ACs cite-validated, local 13/13 + 80/80 reproduce exit-0, CI `26332188348` green, Bram's M1-11 finding correctly applied throughout implementation + tests. Ready for Sage QA and orchestrator admin-merge.
