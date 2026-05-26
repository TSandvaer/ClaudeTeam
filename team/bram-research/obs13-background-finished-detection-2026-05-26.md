# Obs 13 — Background Sub-Agent Finished Detection Gap — 2026-05-26

## Question

After PR #82 (`6150e9f`) fixed Obs 9 by filtering out `toolUseResult.isAsync === true` ack records
in `readFinishedToolUseIds`, background sub-agents never reach the `"finished"` state on the
dashboard — sponsor observed Bram tile at `idle 162s+` and later `279s+` after merge, never
transitioning to `finished`. What is the most reliable completion signal for background sub-agents
from the available JSONL surfaces?

## Answer (1–3 sentences)

The parent JSONL **never receives a second `tool_result` for a background-dispatched agent** — the
only parent-side record for any background dispatch is the async-ack (now correctly skipped by
PR #82), so `readFinishedToolUseIds` returns nothing for background agents and they stay `idle`
forever. The reliable completion signal is in the **sub-agent's own JSONL**: all completed
background agents examined end with a `type: "assistant"` record whose `message.stop_reason ===
"end_turn"`. This directly contradicts the `data-sources.md §3` statement "A subagent JSONL never
carries a closing assistant message" — that claim was wrong, and the recommended fix is to detect
`stop_reason: "end_turn"` as a finished signal in `subagentTailer.ts` / the reducer, with a
watchdog timeout as fallback.

## Evidence

### E1 — Parent JSONL has no second tool_result for any background agent

Checked three sessions with background dispatches — 0 completion records found in all:

- Session `baf09ef7` (16 async-dispatched agents, all confirmed completed):
  `C:\Users\538252\.claude\projects\c--Trunk-PRIVATE-ClaudeTeam\baf09ef7-b940-458e-9693-da28b7fb6439.jsonl`
  PowerShell scan: `NONE — no non-async tool_results found for any of 16 async toolUseIds`.
  Verified 2026-05-26 by exhaustive scan of all 1689 lines.

- Session `c68d51dd` (21 async-dispatched agents):
  `C:\Users\538252\.claude\projects\c--Trunk-PRIVATE-ClaudeTeam\c68d51dd-1a6f-4934-9b64-6470cc4ac772.jsonl`
  PowerShell scan: `NONE`.

- Session `760cb86d` (4 async-dispatched agents, 1 confirmed completed — `a76e6419be426becb`):
  Parent JSONL last record at `2026-05-26T20:24:47Z`; sub-agent JSONL last record at `20:03:58Z`.
  Parent JSONL mtime: `22:24:48` — NOT updated after sub-agents completed.
  PowerShell scan: `NONE`.

Source: data-sources.md §"Background-dispatch acknowledgment is NOT a finished signal" (added PR #82):
confirms "no third record with this tool_use_id exists anywhere in the file, even though Bram
completed ~1 hour later."

### E2 — Completed background agents' own JSONL ends with `type=assistant, stop_reason=end_turn`

All 16 completed background agents in session `baf09ef7` end with `stop_reason=end_turn`:

```
PowerShell scan: stop_reason='end_turn' count=16  (all 16 agent JSONLs)
```

Specific verified examples:
- `agent-a28a960aae547407d.jsonl` (session `baf09ef7`): 124 records, last = `type=assistant, stop_reason=end_turn, ts=2026-05-26T08:47:21.896Z`.
- `agent-ad8ae64968850a339.jsonl` (Bram Round-3, the Obs 9 agent): 108 records, last = `type=assistant, stop_reason=end_turn, ts=2026-05-26T14:35:11.836Z`.
- `agent-a76e6419be426becb.jsonl` (session `760cb86d`, PR #83 Bram dispatch): 115 records, last = `type=assistant, stop_reason=end_turn, ts=2026-05-26T20:03:58.685Z`.

Survey of all 18 agents in session `5652d46e` (the M1 fixture session): 14 end with
`stop_reason=end_turn`; 4 end with `stop_reason=""` (empty). The empty-stop_reason agents are
likely mid-write snapshots at the time of fixture capture (2026-05-23), not a distinct completed
state.

Source: PowerShell scans against live JSONL files confirmed 2026-05-26.

### E3 — The data-sources.md §3 "JSONL closing semantics" claim is wrong

`data-sources.md §3` (line 92–98 in current main) states:

> "A subagent JSONL never carries a closing assistant message. Every subagent JSONL examined
> across 16 agents in two ClaudeTeam sessions ended on a `type: "user"` tool_result record."

This was asserted from 6 agents in session `5652d46e` at capture time 2026-05-23. Re-examination
of `agent-ac562b2a0aba872a6.jsonl` (the specific source for `subagent-finished.jsonl` fixture)
shows its last record at time of re-scan is `type=assistant, stop_reason=""` (not `end_turn` — this
agent's last turn appears to have been mid-write at capture time). All OTHER examined agents do
end with `type=assistant`. The M1 note's negative finding ("ends on user") was a point-in-time
observation during active dispatch, not a property of completed agents.

Evidence: `m1-fixtures-2026-05-23.md §AC4` (original claim) vs. current scan result above (E2).

### E4 — The `outputFile` field in the async-ack is NOT a completion signal

The async-ack's `toolUseResult.outputFile` field points to a temp path:
`C:\Users\538252\AppData\Local\Temp\claude\c--Trunk-PRIVATE-ClaudeTeam\<sessionId>\tasks\<agentId>.output`

All checked output files are **0 bytes** — including for agents that have definitively completed:
- `a76e6419be426becb.output` (760cb86d, completed `20:03:58Z`) — 0 bytes.
- `ad8ae64968850a339.output` (baf09ef7, Bram Round-3) — 0 bytes.

The output file is not written on completion; it is a placeholder. Not viable.

### E5 — The `subagentTailer.ts` design note 4 explicitly rejects child-JSONL finished inference

`src/extension/watcher/subagentTailer.ts` comment block line 27–30:
```
// 4. NO "FINISHED" INFERENCE. Per Bram's M1-11 finding (data-sources.md
//    §3 "JSONL closing semantics"), subagent JSONLs NEVER carry a closing
//    assistant message in the wild.
```

This design decision needs to be revised: the M1-11 finding was incorrect (E3 above).

### E6 — Current state after PR #82 for background agents

State machine path for a background sub-agent after PR #82:

1. Dispatch → async-ack written to parent JSONL → async-ack SKIPPED by `readFinishedToolUseIds`.
2. Next tick: agent JSONL exists + mtime < 10s → state = `"running"`. (Correct.)
3. Agent works for 5–40 min, makes no further JSONL flushes for > 10s → state = `"idle"`.
4. Agent completes, writes `stop_reason=end_turn` to own JSONL. JSONL mtime updated.
5. Watcher sees fresh mtime → state = `"running"` briefly. Then stale again → `"idle"`.
6. **STUCK**: never reaches `"finished"` because no parent-JSONL completion signal exists.

The sponsor's observation (`idle 162s+`, `idle 279s+`) is exactly step 6 — the agent completed
but the dashboard stuck on `idle` with growing elapsed time.

Source: `src/extension/watcher/watcherLoop.ts:584-639` (`readFinishedToolUseIds`),
`src/extension/state/reducer.ts:305-336` (`inferState`).

## Recommended fix surface

**Recommended: Option (b) — detect `stop_reason=end_turn` in the sub-agent JSONL as the completion signal.**

This requires changes in two places:

1. **`src/extension/watcher/subagentTailer.ts`** — add `isFinished: boolean` to
   `SubagentActivity`. In the backward pass (lines 152–163), detect when the last assistant record
   has `stop_reason === "end_turn"` and set `isFinished = true`.

2. **`src/extension/state/reducer.ts:inferState`** — add a check BEFORE the finishedIds lookup:
   if `activity.isFinished === true`, treat the agent as finished (add to finishedIds or return
   `"finished"` directly). For background agents, this is the only available completion signal.

3. **`src/shared/types.ts`** — extend `SubagentActivity` with `isFinished?: boolean`.

**Alternative considered: Option (c) — watchdog timeout.**
Marking an agent as `"finished"` after N minutes of `"idle"` is lossy — if the agent is
legitimately blocked waiting for a tool result, it would be misclassified. `stop_reason=end_turn`
is unambiguous. Watchdog timeout is viable as belt-and-suspenders (e.g. 30-minute idle → assume
finished) but should not be the PRIMARY signal.

**Alternative considered: Option (a) — parent-JSONL second tool_result.**
Definitively ruled out: E1 proves no such record exists. Not viable.

**Important: foreground (synchronous) agent completions are unaffected.** Their parent JSONL
DOES receive a regular `tool_result` (no `toolUseResult.isAsync`), which `readFinishedToolUseIds`
already handles correctly. The fix for option (b) must only affect agents where parent-side
detection fails — i.e., background agents. The simplest approach: always check the sub-agent JSONL
for `stop_reason=end_turn` as a supplementary signal regardless of dispatch mode.

## What I did NOT verify

1. Whether `stop_reason=end_turn` on the last assistant record is reliable across ALL Claude Code
   versions or just v2.1.145+. The evidence covers sessions from 2026-05-23 through 2026-05-26
   on CC v2.1.145. Pre-v2.1.145 behavior is not confirmed.

2. Whether a partially-written tail-read (truncated mid-flush) could produce a false
   `stop_reason=end_turn`. The tailer's tail-window (`TAIL_BYTES = 256*1024`) parses the last
   complete line; the backward pass skips unparseable lines. A genuine mid-write truncation at
   the final line could produce a false `null`/empty stop_reason but NOT a false `end_turn` string
   (partial JSON wouldn't parse at all). Low risk.

3. Whether agents that are killed mid-task (e.g., via TaskStop) also write `stop_reason=end_turn`
   or leave a different terminal state. Only naturally-completing agents were examined.

4. The exact `SubagentActivity` type extension shape — Iris may want to review the type contract
   before Felix implements.

## Implications for ClaudeTeam

- **Fix owner: Felix** (`subagentTailer.ts` + `reducer.ts` + `types.ts`). S-sized ticket. The
  `isAsync` discriminator pattern from PR #82 is the right model — add a parallel
  `isFinished` discriminator from the sub-agent JSONL side.
- **Fixture update needed**: `data-sources.md §3 "JSONL closing semantics"` needs correction —
  completed background agents DO end with a closing assistant record. The `subagent-finished.jsonl`
  fixture's synthesized line 7 is now correct by coincidence (it has `stop_reason=end_turn`) but
  was synthesized for the wrong reason. A real completed background-agent JSONL should replace it
  as the fixture source (AC opportunity for Felix's ticket).
- **Design note in `subagentTailer.ts`** (comment block, design note 4) must be updated to reflect
  the corrected closing-semantics finding.
