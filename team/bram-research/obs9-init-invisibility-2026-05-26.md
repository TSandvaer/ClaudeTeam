# Obs 9 — Running sub-agent not visible on dashboard during init phase — 2026-05-26

## Question

Why is a freshly-dispatched background sub-agent (Bram Round-3 triage, in flight for ~44 min at observation time) not showing as a running tile on the ClaudeTeam dashboard? Three candidate root causes enumerated in the dogfood doc — which is it?

## Answer (1–3 sentences)

Root cause is **candidate (c) — a bug in the running-tile pipeline**, but misidentified in the dogfood doc. The root cause is NOT the rendering layer; it is `readFinishedToolUseIds` in `src/extension/watcher/watcherLoop.ts` (lines 566–607) incorrectly treating the background-dispatch acknowledgment `tool_result` (written by Claude Code immediately at spawn, textLen=847 bytes) as a completion signal. Every background-dispatched sub-agent is classified as `"finished"` within 2 seconds of dispatch, and when `hideFinishedAgents` is ON the tile is suppressed entirely.

## Evidence

### Candidate (a): Agent JSONL not yet on disk

**Verdict: REFUTED** — both meta.json and JSONL appear on disk simultaneously at dispatch time.

- `C:\Users\538252\.claude\projects\c--Trunk-PRIVATE-ClaudeTeam\baf09ef7-b940-458e-9693-da28b7fb6439\subagents\agent-ad8ae64968850a339.meta.json`
  - CreationTime: `2026-05-26T13:21:17.863Z`
  - The meta.json for the Obs 9 Bram dispatch appeared at dispatch time, not after first tool call.

- `agent-ad8ae64968850a339.jsonl`:
  - CreationTime: `2026-05-26T13:21:17.973Z` — 110ms after meta.json, simultaneous from any poll perspective.
  - First JSONL record: `type=user timestamp=2026-05-26T13:21:17.713Z` — dispatch context is flushed at spawn.
  - First tool_use in JSONL: `name=Bash timestamp=2026-05-26T13:21:21.247Z` — only 3.4 seconds after meta.json.

- LIVE REPRO (current dispatch, agent `a6088f8ededb0c051`):
  - meta.json CreationTime: `2026-05-26T15:26:47.818Z`
  - JSONL CreationTime: `2026-05-26T15:26:47.919Z` — 101ms gap
  - Both files appear at dispatch time. The "agent in thinking phase with no JSONL" window is < 200ms — negligible.

The `subagentTailer.ts` ENOENT branch (`readActivity` returns `EMPTY_ACTIVITY` on missing file, `mtimeMs=0`) and the reducer's `inferState` "fresh spawn" branch (`return "running"` when mtimeMs===0 and session alive) would handle a missing JSONL correctly — but this scenario does not occur in practice at any useful timescale.

### Candidate (b): Watcher tick race

**Verdict: REFUTED** — the watcher fires an immediate tick at startup and the files are present at dispatch time. Any race window is < 200ms. Not a 44-minute invisibility.

The FS watcher's `onDidCreate` handler fires within the 2000ms poll interval. The observation was 44 minutes after dispatch — ruling out any tick-timing race.

### Candidate (c): Active-state rendering bug for running tiles

**Verdict: CONFIRMED — but root cause is the finished-detection layer, not rendering.**

The actual bug is in `readFinishedToolUseIds` (`src/extension/watcher/watcherLoop.ts:566-607`). This function scans the parent JSONL for `tool_result` items and maps `tool_use_id → finishedAtMs`. It is designed to detect sub-agent completion.

**The bug:** when an Agent call is dispatched with `run_in_background: true`, Claude Code writes an IMMEDIATE `tool_result` in the parent JSONL at spawn time: `"Async agent launched successfully. agentId: <id>..."`. This acknowledgment is written into the parent JSONL at the same timestamp as the agent's meta.json creation.

**Verified from parent JSONL** (`baf09ef7-b940-458e-9693-da28b7fb6439.jsonl`):

```
tool_result #151 at 2026-05-26T13:21:17.860Z
  toolUseId=toolu_01MMAeiEPr44os17jq9mJ8UY  (= bram-obs3-r3-surface-c's toolUseId)
  textLen=847
  content: "Async agent launched successfully. agentId: ad8ae64968850a339 ..."
```

This fires `readFinishedToolUseIds` to add `bram-obs3-r3`'s toolUseId to the `FinishedMap`. On the next tick, `inferState` in `reducer.ts:313` fires the `finishedIds.has(agentId)` check FIRST, returns `"finished"`, and the tile enters the finished-tiles group.

All 4 Bram agents in session `baf09ef7` have exactly 1 `tool_result` in the parent JSONL, all at their dispatch timestamps, all textLen=847 (the acknowledgment boilerplate). None have a second, longer `tool_result` that would represent actual completion — because the real completion report goes elsewhere (PR comments, note files), not back through the parent JSONL's tool_result mechanism for background agents.

**Observation timing vs JSONL activity gap:**

The Obs 9 agent (`bram-obs3-r3-surface-c`) was active from `13:21:17` to `13:26:11` (5 minutes of source-read + planning), then had a 66-minute silence gap (`13:26:11` to `14:32:36`) during which it was waiting for something (model thinking, long LLM calls). At `14:05:30Z` (observation time), the JSONL mtime was `13:26:11` — 39 minutes stale, which would classify as `"idle"` under `IDLE_THRESHOLD_MS=10_000`. But the agent never reached `"idle"` in the dashboard — it was already permanently `"finished"` from the dispatch-acknowledgment mis-classification.

**`hideFinishedAgents` interaction:** the sponsor had the filter OFF at observation time (finished tiles were visible as `Bram ×4`). The Round-3 agent was already merged into the `×4` group as a finished tile — it shows up counted but not flagged as running. If the filter had been ON, the tile would have been fully suppressed (textLen=0 invisible). Either way, the running state is never surfaced.

**Live repro confirmation:** my current dispatch (agent `a6088f8ededb0c051`, dispatched at `15:26:47Z`) will also be immediately classified as `"finished"` by the same mechanism. The sponsor can verify this is the current behavior on the live dashboard — if I appear in `Bram ×5` as a finished tile rather than a running tile, root cause (c) is confirmed.

## What I did NOT verify

1. Whether `data-sources.md` §3 "The critical limitation" section was describing SYNCHRONOUS agent completion (where the tool_result IS the final result), and background dispatch creates a separate first-acknowledgment tool_result pattern. I assumed based on the textLen=847 evidence and "Async agent launched successfully" text — but I did not check whether SYNCHRONOUS Agent calls also write an immediate acknowledgment vs write only on completion. This distinction matters for the fix scope.

2. Whether there is any other mechanism Claude Code uses to signal background-agent completion back to the parent JSONL besides a second tool_result (e.g. a separate record type).

3. The exact fix — whether to filter out textLen=847 "Async agent launched" acknowledgments, or to filter by content text, or to treat background agents differently by some other signal in the parent JSONL.

## Implications for ClaudeTeam

- **Fix scope for Felix:** `readFinishedToolUseIds` in `src/extension/watcher/watcherLoop.ts:566-607` needs to distinguish the background-dispatch acknowledgment from the actual completion signal. One approach: skip tool_result entries whose text content starts with `"Async agent launched successfully."`. A more robust approach: require a second tool_result for the same `tool_use_id` (the actual completion report). Needs Bram or Felix to determine whether background agents ever get a second tool_result on real completion (requires capturing a session where a background agent completes + examining the parent JSONL for two tool_results with the same toolUseId).

- **Impact:** this bug affects EVERY background-dispatched sub-agent in V1. No rostered agent can ever show as `"running"` on the dashboard — they are all immediately `"finished"`. This is a P1 defect for V1's core product promise ("real-time dashboard of orchestrated agent teams").
