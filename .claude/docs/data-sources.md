# Data Sources

ClaudeTeam reads four kinds of file under `~/.claude/`. Every parser/matcher must be grounded in the actual on-disk shape — verify before assuming.

> **On Windows:** `~/.claude/` resolves to `C:\Users\<username>\.claude\` (e.g. `C:\Users\538252\.claude\`).

## 1. Live process registry

**Path:** `~/.claude/sessions/{pid}.json`

One JSON file per running Claude Code process. The registry is the authoritative "who is alive right now" source — cross-reference against `Get-Process | Where Name -eq 'claude'` to confirm liveness.

**Schema (verified):**

```json
{
  "pid": 68644,
  "sessionId": "7b53d0ee-da11-4c38-9899-a9c24b754b93",
  "cwd": "c:\\Trunk\\PRIVATE\\ClaudeTeam",
  "startedAt": 1779523286513,
  "procStart": 639151272847822440,
  "version": "2.1.145",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "claude-vscode"
}
```

Field semantics:
- `pid` — OS PID; matches the filename.
- `sessionId` — UUID, used to find the project transcript.
- `cwd` — project working directory; maps to the project slug under `projects/`.
- `version` — Claude Code version; informational for schema detection. NOTE: feature-detect on `meta.json` field presence is more reliable than version comparison — see §4 "Schema detection rule".
- `entrypoint` — `claude-vscode` (VS Code integration) vs `cli` (terminal).
- `kind` — `interactive` for normal sessions; remote/cloud kinds (if they exist) have NOT been observed locally.

## 2. Parent session transcript

**Path:** `~/.claude/projects/{project-slug}/{sessionId}.jsonl`

**Project slug** = the `cwd` with path separators replaced per the cwdToSlug rule below (e.g. `c:\Trunk\PRIVATE\ClaudeTeam` → `c--Trunk-PRIVATE-ClaudeTeam`).

### cwdToSlug rule (verified against on-disk directories)

1. Strip the drive colon (e.g. `c:` → `c`, `C:` → `C`).
2. Replace the **first** path separator (backslash or forward slash) after the drive letter with `--` (double dash).
3. Replace every **subsequent** path separator with `-` (single dash).

| `cwd` | slug |
|---|---|
| `c:\Trunk\PRIVATE\ClaudeTeam` | `c--Trunk-PRIVATE-ClaudeTeam` |
| `C:\Trunk\PRIVATE\Axelot-tutor` | `C--Trunk-PRIVATE-Axelot-tutor` |
| `c:\Trunk\PRIVATE\MARIAN-TUTOR` | `c--Trunk-PRIVATE-MARIAN-TUTOR` |

POSIX paths (no drive letter): replace all `/` with `-`; strip any leading `-`.

**Duplication note:** This rule is currently implemented in two places — `src/cli/agentTree.ts` (`cwdToSlug`) and `tests/integration/helpers/tempdir.ts` (`cwdToSlug`). Both copies are intentionally identical; not shared to avoid coupling the test helper to the production module. Extraction to `src/shared/slug.ts` is deferred to M2 (per Sage's M1-10 finding). When that PR lands, delete both copies and import the shared one.

One JSONL line per record. Records include:
- `type: "user"` — user message.
- `type: "assistant"` — assistant response with `message.model`, `message.content[]` (text + tool_use entries).
- `type: "queue-operation"`, `type: "file-history-snapshot"`, `type: "last-prompt"`, `type: "ai-title"` — metadata.
- Every record includes `sessionId`, `timestamp`, `cwd`, `version`, `uuid`, `parentUuid`, `isSidechain` (true for subagent context), `agentId` (populated for subagent messages).

**Critical limitation:** the parent transcript is **opaque during subagent execution**. While a child runs (potentially 30+ minutes), the parent JSONL receives zero `tool_result` entries from the child — only a single `tool_result` lands at the very end. **Do not read parent transcripts for "what is this child doing right now"** — tail the child's own JSONL instead.

The `ai-title` record (typically near the top of the JSONL) contains a human-readable session title — use this for the team-card display label per session.

## 3. Subagent transcript

**Path:** `~/.claude/projects/{project-slug}/{sessionId}/subagents/agent-{agentId}.jsonl`

Each spawned subagent gets its own JSONL with full transcript. Schema is identical to the parent transcript but every line has `isSidechain: true` and `agentId` set.

**Use this file to determine "what is the subagent currently doing":**
- Tail the file (last ~100 lines is plenty).
- Find the most recent `type: "assistant"` record with a `message.content[]` entry of `type: "tool_use"`.
- That tool's `name` is the current activity (e.g. "Grep", "Edit", "Bash").
- The first assistant message in the file has `message.model` — the resolved model the subagent is actually running on (not the value from the spawn call, which is empty for custom personas).

**Flush cadence:** JSONL files flush in discrete bursts, 2–56 seconds of staleness observed in practice. Polling cadence should be ≥2s; lower polling won't see anything new.

### Tool-argument limitation (M1-06 tailer — tracked, not yet resolved)

The M1-06 subagent tailer (`src/extension/watcher/subagentTailer.ts`) extracts `lastTool` (the tool name from the last `tool_use` content entry) but does **not** preserve tool input arguments. The activity-line format spec (`iris-ux/m1-cli-output-spec.md` §1.4) calls for `tool:<tool-name> <one-line summary>` where the summary is the first argument or path from `tool_use.input`. M1-06 only delivers the first half (`tool:<tool-name>`); the argument summary is silently omitted.

Downstream effect: `buildActivity` in `src/extension/state/reducer.ts` currently emits `tool:Edit` rather than `tool:Edit src/extension/...`. The CLI output and dashboard tile will show the tool name but not the path/argument.

**Deferral:** Extracting tool input arguments into `SubagentActivity.lastToolArg` is filed as a future ticket (`tailer-extract-tool-args`). It is not in the current M2 scope (pending sponsor approval of M2 lanes). Until that ticket ships, `tool:<tool-name>` without an argument summary is the defined V1 behavior.

### JSONL closing semantics (verified, 2026-05-23)

**A subagent JSONL never carries a closing assistant message.** Every subagent JSONL examined across 16 agents in two ClaudeTeam sessions ended on a `type: "user"` tool_result record — the agent's final report turn is NOT written into the subagent's own JSONL. The closing result lives exclusively in the **parent** JSONL as a `tool_result` content entry for the `Agent`/`Task` tool_use, identified by `toolUseId` (see §4).

Implications for the tailer:
- Do NOT use "last record is type:assistant with stop_reason:end_turn" as a finished-detection heuristic — you will never see it in real data.
- The reliable finished signal is: parent JSONL contains a `tool_result` with `tool_use_id == meta.json.toolUseId`.
- The `subagent-finished.jsonl` test fixture (`tests/fixtures/subagent-finished.jsonl`) includes one synthesized line 7 with `stop_reason: "end_turn"` for parser branch coverage only — this is marked `"requestId": "req_SYNTHESIZED"` and does NOT reflect real on-disk behavior.

Source: `team/bram-research/m1-fixtures-2026-05-23.md` §AC4.

## 4. Subagent metadata

**Path:** `~/.claude/projects/{project-slug}/{sessionId}/subagents/agent-{agentId}.meta.json`

Compact metadata about a subagent spawn. **Three schema variants exist** — the parser must handle all three. Source: `team/bram-research/m1-fixtures-2026-05-23.md` §Schema divergence summary; verified against 16 real meta.json files captured 2026-05-23.

### Variant summary table

| Variant | `agentType` value | `name` field | `toolUseId` | Example source |
|---|---|---|---|---|
| **v2.1.119 (old)** | persona slug (e.g. `"devon"`) | absent | absent | `tests/fixtures/meta-old-schema.json` (synthesized) |
| **v2.1.145 general-purpose** | engine type string (`"general-purpose"`, `"Explore"`) | absent or `null` | present | `tests/fixtures/meta-new-schema.json` |
| **v2.1.145 persona-named** | persona slug (e.g. `"felix"`, `"bram"`) | absent | present | live captures, session 5652d46e (11/11 persona agents) |

### v2.1.119 (old, April 2026 and earlier)

```json
{
  "agentType": "devon",
  "description": "Devon reviews Kevin's PR #2"
}
```

- `agentType` holds the **persona slug**.
- No `name` field.
- No `toolUseId` (parent→child link must be inferred from JSONL context).

Test fixture: `tests/fixtures/meta-old-schema.json` (synthesized from documented schema; no v2.1.119 session was available in scope — see research note §AC1).

### v2.1.145 general-purpose (new, May 2026)

```json
{
  "agentType": "general-purpose",
  "description": "Agent B: limitations & edge cases",
  "name": null,
  "toolUseId": "toolu_01DSwxyg6yrTCn8nxkVwoXqt"
}
```

- `agentType` holds an **engine type string** — observed values: `"general-purpose"`, `"Explore"`. Other values (e.g. `"Plan"`) are possible but not yet observed locally.
- `name` is **absent or explicitly `null`** in every real capture to date (0 of 16 real meta.json files had a populated `name`). Treat both `undefined` and `null` as "no name".
- `toolUseId` links to the parent transcript's `content[].id` for the `Agent`/`Task` tool_use entry that spawned this child.

Test fixture: `tests/fixtures/meta-new-schema.json` (real capture from `C:/Users/538252/.claude/projects/c--Trunk-PRIVATE-ClaudeTeam/7b53d0ee-.../subagents/agent-a1d53b4a2db17f2f5.meta.json`; fixture adds explicit `"name": null` for parser branch coverage).

### v2.1.145 persona-named (new, May 2026) — PREVIOUSLY UNDOCUMENTED

```json
{
  "agentType": "felix",
  "description": "Felix — M1-01 scaffold + CI",
  "toolUseId": "toolu_01SZsHqGceAQC4Loovg6ion1"
}
```

- `agentType` holds the **persona slug** — same position as the old schema, but `toolUseId` IS present.
- **No `name` field** — identity comes solely from `agentType`.
- `toolUseId` present (distinguishes from v2.1.119).
- Observed in **11 of 11 persona agents** in session 5652d46e (felix, bram, sage, maya, iris, nora). This is the dominant variant when the orchestrator dispatches named-persona sub-agents.

No dedicated test fixture yet — can be synthesized from the live examples above. Add `tests/fixtures/meta-new-schema-persona.json` when Felix authors M1-05.

### Schema detection rule (feature-detect — do NOT rely on session version alone)

The session `version` field in `~/.claude/sessions/{pid}.json` is unreliable for discriminating the three variants because all three can appear in v2.1.145+ sessions within the same session. Use field-presence detection instead:

1. **`toolUseId` absent** → v2.1.119 old schema. `agentType` = persona slug.
2. **`toolUseId` present AND `agentType` is an engine-type string** (i.e. one of `"general-purpose"`, `"Explore"`, or any value that is NOT a known persona slug) → v2.1.145 general-purpose. Persona identity must come from `name` (if non-null) or fall back to `description`.
3. **`toolUseId` present AND `agentType` is a persona slug** → v2.1.145 persona-named. Persona identity comes from `agentType` directly.

The roster matcher's `agentType_equals` rule works correctly for both variant 1 and variant 3 — it fires on the persona slug in both cases. No rule change needed for the matcher; the parser must normalize `agentType` correctly before handing off.

## 5. Identity & display rules

Given a parsed `meta.json`, resolve the agent's display identity in this priority order:

1. **v2.1.145 persona-named variant** (`toolUseId` present + `agentType` is a persona slug): use `agentType` as the persona slug directly.
2. **v2.1.145 general-purpose variant** (`toolUseId` present + `agentType` is engine type): check `name` field — if non-null and non-empty, use `name` as the persona slug. If `name` is null/absent, fall back to step 3.
3. **v2.1.119 old variant** (`toolUseId` absent): use `agentType` as the persona slug.
4. **Fallback** (no persona slug resolved from above): use `description` for display. The roster matcher will attempt `description_contains` rules. If no match, bucket as background.

**What this means for the matcher:** the `agentType_equals` roster rule correctly matches persona slugs in both variant 1 (new-persona) and variant 3 (old). It will NOT match engine type strings like `"general-purpose"` or `"Explore"` — those only match via `name_prefix`/`name_equals` (if name is present) or `description_contains` (always available as a fallback).

Source: `team/bram-research/m1-fixtures-2026-05-23.md` §Implications; verified against 16 real captures 2026-05-23.

## Liveness inference

A subagent is `running` if:
1. The session it belongs to has a live `~/.claude/sessions/{pid}.json` AND its PID maps to an actual `claude.exe` process.
2. The subagent JSONL mtime is < ~10s old.

A subagent is `finished` if:
- The parent transcript has a `tool_result` entry with `tool_use_id == meta.json.toolUseId`.
- OR a `SubagentStop` hook event was observed (post-V1, when the hook tap is online).

Otherwise → `idle` (PID alive but JSONL stale > 10s).

### Finished timestamp source (86c9yxv94)

The `tool_result` record's **top-level `timestamp` field** (ISO-8601 string, parseable via `Date.parse`) is the authoritative `finishedAtMs` for elapsed-time rendering on the finished tile. The reducer's input is `FinishedMap = Map<agentId, finishedAtMs>` (was `Set<string>` before 86c9yxv94); `buildActivity` uses the value to emit `"finished Xs"` when the timestamp is supplied and falls back to bare `"finished"` when omitted. Unparseable timestamps produce a `0` sentinel from the parser — `buildActivity`'s gate is `!== undefined`, so a `0` sentinel renders a very large elapsed value (diagnostic shape; production JSONL timestamps are always parseable).

## Pixel Agents coexistence

The user's machine runs the **Pixel Agents** VS Code extension, which has its own hook server at `~/.pixel-agents/server.json` (port 55271, bearer-token auth, accepts POSTs to `/api/hooks/claude`). All 11 Claude Code lifecycle hooks are registered in `~/.claude/settings.json` to forward to that server.

When ClaudeTeam adopts the hook-tap tier (post-V1):
- **Do not share Pixel Agents' port.** Pick a different local port and add a SECOND hook entry in `settings.json` alongside the existing one — both consumers receive every event.
- **Silent-fail on connection refused** so a stopped ClaudeTeam dashboard doesn't break sessions. Mirror the pattern in `~/.pixel-agents/hooks/claude-hook.js`.
