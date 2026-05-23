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
- `version` — Claude Code version; **load-bearing for schema detection** (`meta.json` v2.1.119 vs v2.1.145 — see below).
- `entrypoint` — `claude-vscode` (VS Code integration) vs `cli` (terminal).
- `kind` — `interactive` for normal sessions; remote/cloud kinds (if they exist) have NOT been observed locally.

## 2. Parent session transcript

**Path:** `~/.claude/projects/{project-slug}/{sessionId}.jsonl`

**Project slug** = the `cwd` with path separators replaced by `--` (e.g. `c:\Trunk\PRIVATE\ClaudeTeam` → `c--Trunk-PRIVATE-ClaudeTeam`).

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

## 4. Subagent metadata

**Path:** `~/.claude/projects/{project-slug}/{sessionId}/subagents/agent-{agentId}.meta.json`

Compact metadata about a subagent spawn. **Schema changed between v2.1.119 and v2.1.145** — the matcher must handle both:

### v2.1.119 (old, April 2026)

```json
{
  "agentType": "devon",
  "description": "Devon reviews Kevin's PR #2"
}
```

- `agentType` holds the **persona name**.
- No `name` field.
- No `toolUseId` (parent→child link must be inferred from JSONL).

### v2.1.145 (new, May 2026)

```json
{
  "agentType": "general-purpose",
  "description": "Devon cross-review PR #310",
  "name": "devon-pr310-review",
  "toolUseId": "toolu_01..."
}
```

- `agentType` holds the **engine type** (`general-purpose`, `Explore`, `Plan`, etc.) — NOT the persona.
- `name` (optional) holds the persona slug or human-supplied name. **~74% of real spawns have no name**, so most agents have only `agentType` + `description` to identify them.
- `toolUseId` links to the parent transcript's `content[].id` field for the `Agent`/`Task` tool_use entry that spawned this child.

### Schema detection rule

Read the parent session's `version` from `~/.claude/sessions/{pid}.json`. Compare numerically:
- `< 2.1.145` (e.g. `2.1.119`, `2.1.130`) → use old schema (persona in `agentType`).
- `>= 2.1.145` → use new schema (persona in `name` if present; `agentType` is engine type).

When in doubt (mixed historical sessions across the projects tree), feature-detect: if `name` is present, treat as new schema; otherwise treat as old.

## Liveness inference

A subagent is `running` if:
1. The session it belongs to has a live `~/.claude/sessions/{pid}.json` AND its PID maps to an actual `claude.exe` process.
2. The subagent JSONL mtime is < ~10s old.

A subagent is `finished` if:
- The parent transcript has a `tool_result` entry with `tool_use_id == meta.json.toolUseId`.
- OR a `SubagentStop` hook event was observed (post-V1, when the hook tap is online).

Otherwise → `idle` (PID alive but JSONL stale > 10s).

## Pixel Agents coexistence

The user's machine runs the **Pixel Agents** VS Code extension, which has its own hook server at `~/.pixel-agents/server.json` (port 55271, bearer-token auth, accepts POSTs to `/api/hooks/claude`). All 11 Claude Code lifecycle hooks are registered in `~/.claude/settings.json` to forward to that server.

When ClaudeTeam adopts the hook-tap tier (post-V1):
- **Do not share Pixel Agents' port.** Pick a different local port and add a SECOND hook entry in `settings.json` alongside the existing one — both consumers receive every event.
- **Silent-fail on connection refused** so a stopped ClaudeTeam dashboard doesn't break sessions. Mirror the pattern in `~/.pixel-agents/hooks/claude-hook.js`.
