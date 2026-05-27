# fix(watcher): Obs 13 — `stop_reason=end_turn` → `SubagentActivity.isFinished` → finished state

Closes ClickUp `86c9zmp5g`. Implements Bram's option (b) from the Obs 13 triage doc.

## What broke

Sponsor-observed symptom: after PR #82 fixed Obs 9 (background-dispatch ack misread as completion), **background sub-agents now never reach `"finished"`** — Bram tile stuck at `idle 162s+` / `idle 279s+` indefinitely. PR #82's filter correctly skips the async-launched ack, but no replacement completion signal was wired in: the parent JSONL never receives a real `tool_result` for `run_in_background: true` dispatches, ever.

## Why this is the fix surface

Bram's triage (`team/bram-research/obs13-background-finished-detection-2026-05-26.md`) examined 3 sessions and 21 background agents:

- E1: parent JSONL has 0 second-tool_result records for background agents across all sessions (verbatim PowerShell scan).
- E2: all 16 completed background agents in `baf09ef7` end on `type:"assistant", stop_reason:"end_turn"` in their own JSONL.
- E3: the M1-11 claim that "subagent JSONLs never carry a closing assistant message" was wrong — the original capture caught agents mid-write at 2026-05-23, not completed agents.

The only available completion signal for background dispatches lives in the **child JSONL's last assistant `stop_reason`**.

## What this PR changes

1. **`src/shared/types.ts`** — extends `SubagentActivity` with optional `isFinished?: boolean`. Optional for back-compat (legacy callers / fixtures absent the field are treated as false).

2. **`src/extension/watcher/subagentTailer.ts`** — backward pass now extracts `message.stop_reason` from the last assistant record; sets `isFinished = true` iff the value is exactly the string `"end_turn"`. Mid-write snapshots with `stop_reason: null`/`""` and mid-conversation `"tool_use"` records correctly stay false. Design note #4 rewritten to reflect Obs 13's correction of the M1-11 finding.

3. **`src/extension/state/reducer.ts:inferState`** — adds the `activity?.isFinished === true → "finished"` gate **between** the existing `finishedIds.has(agentId)` check and the JSONL-mtime running/idle gate. Ordering rationale: parent-signal wins (preserves authoritative `finishedAtMs`); child-signal beats stale-mtime (the Obs 13 fix proper); mtime gate runs as before for in-flight agents.

4. **`tests/fixtures/subagent-background-finished.jsonl`** (new) — 5-line fixture mirroring the real on-disk shape of a completed background sub-agent: assistant → tool_use → user tool_result → final assistant text with `stop_reason: "end_turn"`. Field names + record shapes match the verbatim `agent-ad8ae64968850a339.jsonl` capture cited in the triage doc.

5. **`tests/integration/fixtureFs.test.ts`** — new `AC2.4c` describe block (2 tests):
   - Positive: child JSONL with `stop_reason=end_turn` + parent JSONL carrying ONLY the async-launched ack → `finishedIds` empty, `activity.isFinished` true, tile `state === "finished"`.
   - Negative regression: child JSONL still running (no end_turn) → state ≠ finished, ensures the new gate is value-sensitive, not always-on.

6. **`tests/unit/subagentTailer.test.ts`** — new "isFinished detection (Obs 13)" describe block (8 tests) covers: `subagent-running.jsonl` (null/no end_turn → false), explicit `end_turn` → true, `tool_use` stop_reason → false, `null` stop_reason → false, empty-string stop_reason → false, earlier `end_turn` with later `tool_use` → false (backward-pass discipline), missing/empty file → false. Plus updates the existing `subagent-finished.jsonl` assertion to assert `isFinished: true` and rewrites the M1-11 framing note.

7. **`tests/unit/reducer.test.ts`** — 5 new tests in the state-transition block:
   - `isFinished=true → finished` even when `finishedIds` empty.
   - `isFinished=true` overrides stale mtime (the original `idle 162s+` symptom regression guard).
   - `isFinished=false` → existing running/idle path unchanged (negative regression).
   - `isFinished` undefined → treated as false (legacy back-compat).
   - When both signals present, `finishedIds` wins (preserves `finishedAtMs` precision).

8. **`.claude/docs/data-sources.md` §3 "JSONL closing semantics" + §"Liveness inference"** — corrects the wrong M1-11 framing per Bram's triage. The new copy spells out the foreground (parent-signal) vs background (child-signal) split and the Claude Code v2.1.145 verification caveat. Original M1-11 §AC4 framing labeled as superseded.

## Caveat (cited in code + doc)

`stop_reason=end_turn` behavior verified on Claude Code v2.1.145 only (the triage's evidence covers sessions 2026-05-23 → 2026-05-26 on v2.1.145). If pre-v2.1.145 sessions emit a different closing shape, the tailer falls back to `isFinished: false` because the gate is a strict string match — so the worst-case regression on older sessions is "stays idle indefinitely," which is exactly the pre-PR-82 behavior, not a worsened state.

## Self-Test Report

### AC walkthrough
- **AC1 — subagentTailer.ts detects `end_turn` and design note #4 corrected:** ✅ `extractStopReason` helper added; backward pass sets `isFinished` per record; design note #4 rewritten with Obs 13 attribution + v2.1.145-only caveat. Verified by 8 new unit tests in `tests/unit/subagentTailer.test.ts`.
- **AC2 — SubagentActivity extended with `isFinished?: boolean`:** ✅ field added (optional for back-compat); doc-comment block names the field semantics + Obs 13 origin + v2.1.145 caveat. Type-checks pass (`npm run typecheck` clean).
- **AC3 — reducer inferState checks isFinished BEFORE the JSONL-mtime running check:** ✅ gate inserted at reducer.ts:339-345 between `finishedIds.has(agentId)` and the `mtimeMs === 0` branch; doc-comment lists the new priority order. Verified by 5 new unit tests including the stuck-at-idle-300s regression.
- **AC4 — fixture pair + integration test asserting background sub-agent transitions to finished:** ✅ `tests/fixtures/subagent-background-finished.jsonl` (new); `tests/integration/fixtureFs.test.ts` describe block `AC2.4c` (2 tests, both green). Parent JSONL uses the verbatim `parent-jsonl-async-launched.jsonl` from PR #82.
- **AC5 — no regression on AC2.4b:** ✅ `npx vitest run --config vitest.integration.config.ts tests/integration/fixtureFs.test.ts -t "AC2.4"` → 9 passed (3 AC2.4 + 4 AC2.4b + 2 AC2.4c). Full integration suite: 94 passed.
- **AC6 — `.claude/docs/data-sources.md` §3 corrected:** ✅ "JSONL closing semantics" block rewritten to reflect Obs 13's finding; "Liveness inference" updated to include the child-signal path; M1-11 framing labeled as superseded.

### Side-effect inventory
- **`src/cli/agentTree.ts`:** uses `readActivity()` transparently — no source changes needed; new `isFinished` flows through automatically.
- **`src/extension/watcher/watcherLoop.ts`:** consumes `readActivity()` per agentId; no source changes needed.
- **Webview wire format:** `SubagentActivity` does NOT cross the host↔webview boundary (only `AgentTile` does, derived in reducer). `AgentTile.state` is the surface the webview consumes; "finished" already has full webview rendering support. No protocol changes.
- **`serializeState`/`hydrateState`:** unchanged — `isFinished` is a host-only intermediate field.

### Failure-mode probes
- **Missing session file:** N/A (this PR touches only finished-detection logic; session-file handling unchanged).
- **Malformed JSONL:** `extractStopReason` returns `null` on non-object/non-string; the tailer's existing `tryParse` skip-bad-lines path catches malformed lines before reaching `extractStopReason`. Verified by existing `subagent-malformed.jsonl` test (still passes).
- **`stop_reason` field absent:** returns `null` → not equal to `"end_turn"` → `isFinished:false`. Verified by `mid-write snapshot` unit test.
- **`stop_reason` is `null` (mid-write):** typeof `!== "string"` → returns `null` → `isFinished:false`. Verified by `stop_reason:null → isFinished:false` unit test.
- **`stop_reason` is `""` (empty string):** typeof is string but `!== "end_turn"` → `isFinished:false`. Verified.
- **`stop_reason` is `"tool_use"` (mid-conversation):** explicit not-end_turn → `isFinished:false`. Verified.
- **Earlier assistant has `end_turn`, last assistant is mid-action:** only the LAST in backward-pass governs → `isFinished:false`. Verified by `resumed.jsonl` unit test.

### Tests-green confirmation
- `npm run typecheck` → clean (no `tsc --noEmit` errors).
- `npm test` → **495 passed, 2 skipped** (added 5 reducer + 8 tailer tests).
- `npm run test:integration` → **94 passed** (added 2 fixture-fs tests). Full suite duration 4.62s.
- `npm run build` → CJS host + webview IIFE bundles emit cleanly.
- `npm run lint` → clean.

## Cites

- Triage doc: `team/bram-research/obs13-background-finished-detection-2026-05-26.md` (PR #85 merge `c7f0e1f`).
- Obs 9 prior art: PR #82 `6150e9f` (async-launched ack discriminator).
- Original M1-11 finding (now superseded): `team/bram-research/m1-fixtures-2026-05-23.md` §AC4.
