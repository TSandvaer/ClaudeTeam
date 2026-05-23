# ClaudeTeam V1 Plan

## Vision

A VS Code dashboard that gives an accurate, real-time overview of orchestrated Claude Code agent teams — surfacing identity (name, role, persona), current activity, and parent → child relationships, with a **sponsor-defined roster** that separates "my team" from background noise.

## Why this exists

Today the only tracking option in this environment is the Pixel Agents extension, which has clear limitations for an orchestrator's overview:

- Shows every spawn equally, including the ~74% of subagent spawns that have no `name` field (background `Explore` / `general-purpose` dispatches from skills like `/investigate`).
- Doesn't clearly surface what each agent is currently doing.
- Has no concept of teams or sponsor-defined roles.
- Treats short-lived ad-hoc spawns the same as long-running persona agents (Devon, Kevin, etc.).

V1 inverts the default: **only the rostered team gets named tiles**. Everything else is collapsed into a per-session noise counter so the sponsor knows it's still happening without it cluttering the view.

## V1 scope

### In scope
- Single-machine, local-files-only tracker (no remote/cloud agents).
- Sponsor-defined team roster (YAML config).
- VS Code webview view in the Activity Bar.
- Per-team dashboard cards with named tiles for rostered agents.
- Background-noise counter per session (collapsed but visible).
- Live-activity display via JSONL tailing (low-seconds staleness).
- Drill-in: open the agent's JSONL transcript in VS Code's native file viewer.

### Out of scope for V1
- Cross-machine / multi-user correlation.
- Cloud agents (`RemoteTrigger`, `/schedule` routines — leave no local artefacts).
- In-webview transcript rendering (use VS Code's existing JSONL viewer).
- Hook-based sub-second activity updates (cheap polling first; promote if needed).
- Agent control surfaces (start / stop / send-message — read-only V1).
- Persistence / history beyond what the JSONL files already provide.
- Authentication, multi-tenancy, sharing.

## Architecture

### Data sources (all local, all already on disk)

| Path | What it provides |
|---|---|
| `~/.claude/sessions/{pid}.json` | Live process registry. One file per running Claude Code session. Fields: `pid`, `sessionId`, `cwd`, `startedAt`, `version`, `entrypoint`. |
| `~/.claude/projects/{slug}/{sessionId}.jsonl` | Parent transcript. Use for `ai-title`, `last-prompt`, and parent tool-use entries. **NOT useful for live subagent activity** — parent transcripts are opaque during subagent execution. |
| `~/.claude/projects/{slug}/{sessionId}/subagents/agent-{agentId}.jsonl` | Subagent's own transcript. **Tail this for current activity.** |
| `~/.claude/projects/{slug}/{sessionId}/subagents/agent-{agentId}.meta.json` | Subagent metadata: `agentType`, `description`, optional `name`, `toolUseId` (links to parent). |

### Schema handling

The `meta.json` format changed between Claude Code v2.1.119 (April 2026) and v2.1.145 (May 2026). The tracker must handle both:

- **v2.1.119 (old):** `{ agentType: "<persona-name>", description: "..." }` — persona identity in `agentType`.
- **v2.1.145 (new):** `{ agentType: "general-purpose", name: "<persona-slug>", description: "...", toolUseId: "..." }` — persona identity moved to `name`; `agentType` is the execution-engine type.

### Two-tier data plane

1. **File-watcher (always on, V1):** poll `~/.claude/sessions/*.json` every ~2s. For each live session, materialise the agent tree from `meta.json` files and tail subagent JSONLs for current activity. Sub-3s staleness, zero load on Claude Code.
2. **Hook tap (optional, post-V1):** register a hook script in `~/.claude/settings.json` that posts to a dedicated local port (**NOT** Pixel Agents' port 55271 — own channel). Use for sub-second updates on `SubagentStart` / `SubagentStop` / `PreToolUse`. Hook script must silent-fail on connection refused so a stopped dashboard doesn't break sessions.

### Roster schema (proposed)

```yaml
teams:
  - id: claudeteam-alpha
    name: "ClaudeTeam Alpha"
    members:
      - id: devon
        display: "Devon"
        role: "Reviewer"
        color: "#5d8aa8"
        match:
          - name_prefix: "devon-"        # new schema (v2.1.145+)
          - agentType_equals: "devon"    # old schema (v2.1.119)
      - id: kevin
        display: "Kevin"
        role: "Implementer"
        color: "#9caf88"
        match:
          - name_prefix: "kevin-"
          - agentType_equals: "kevin"
```

**Resolution order per live agent:**
1. Walk each roster entry's match rules in order.
2. First match wins → assigned to that roster identity.
3. No match → bucket as "background" (counted per session, not named).

### Identity & display rules

- **Display name** = roster entry's `display` field if matched; otherwise `description` truncated.
- **Activity line** = last `tool_use.name` from the subagent's JSONL tail (e.g. "Grep", "Edit", "Bash").
- **Model** = parsed from the subagent's first assistant message in its JSONL (the spawn record is unreliable for custom personas — it records `model: ""`).
- **State**:
  - `running` — PID alive AND subagent JSONL mtime < ~10s ago.
  - `idle` — JSONL stale > ~10s but no completion signal.
  - `finished` — `SubagentStop` seen OR parent transcript shows the `tool_result` for this `toolUseId`.

### VS Code shell

- TypeScript extension scaffold (hand-rolled or `yo code`).
- Activity Bar view registered via `contributes.views`.
- Webview hosts the dashboard UI (tech TBD at M2 — React / Svelte / vanilla).
- Extension host owns the file-watcher; messages state to the webview.

## V1 milestones

| # | Milestone | Output | Rough effort |
|---|---|---|---|
| M1 | Data spike | CLI tool that prints the live agent tree from local files; validates file-watcher + roster matcher | 1–2 days |
| M2 | Extension scaffold | VS Code extension showing M1 data in a hardcoded webview | 1 day |
| M3 | Roster config | Load `teams.yaml`, apply matchers, render named tiles vs background bucket | 1–2 days |
| M4 | Live polish | Styling, drill-in, status states, refresh-cadence tuning | 1–2 days |

Total: ~1 week of focused work.

## Open questions (decide during build)

- **Roster config location:** global (`~/.claudeteam/teams.yaml`) vs per-project (`.claude/teams.yaml`)? Likely support both, with project overriding global.
- **Webview UI tech:** React vs Svelte vs vanilla TS — pick at M2 based on weight.
- **Activity polling cadence:** 2s is the default plan; tune in M4.
- **Background-noise display:** single count, or grouped by `subagent_type`?
- **Multi-window VS Code:** if two VS Code windows are both running the extension, do they share state or each render their own view of `~/.claude/`? Default assumption: each renders independently from the same filesystem source.

## Non-goals

- **Not a Pixel Agents replacement.** Pixel Agents stays installed; ClaudeTeam coexists by using its own hook port if/when it adopts the push tier.
- **Not an orchestrator.** It observes; it does not dispatch, kill, or message agents in V1.
- **Not a transcript reader.** Use VS Code's native JSONL viewer via drill-in.
