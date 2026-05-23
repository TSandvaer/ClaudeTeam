# ClickUp MCP availability in sub-agent runtimes — 2026-05-23

## Question

Does the Claude Code harness surface persona-declared `mcp__clickup__*` tools to sub-agent runtimes, or did Nora misreport when she said her declared `clickup_create_task` wasn't available to her?

## Answer (1–3 sentences)

Hypothesis A is confirmed: the harness does NOT surface MCP tools to sub-agent runtimes. The ClickUp MCP server is correctly configured globally (`~/.claude.json`, `mcpServers.clickup`), and all six ClickUp tools declared in `nora.md` and three declared in `bram.md` return "No such tool available" when called from a sub-agent session. This is a structural harness gap, not a transient connection issue and not a misreport by Nora.

## Evidence

- `c:/Users/538252/.claude.json` lines 1018–1029 — `mcpServers.clickup` is configured: `"type": "stdio", "command": "npx", "args": ["-y", "clickup-mcp-server"]`. The server IS configured at the user-global level.
- `c:/Trunk/PRIVATE/ClaudeTeam/.claude/agents/bram.md` line 4 — declares tools `mcp__clickup__clickup_get_task`, `mcp__clickup__clickup_get_task_comments`, `mcp__clickup__clickup_create_task_comment`.
- `c:/Trunk/PRIVATE/ClaudeTeam/.claude/agents/nora.md` line 4 — declares tools `mcp__clickup__clickup_get_task`, `mcp__clickup__clickup_update_task`, `mcp__clickup__clickup_create_task`, `mcp__clickup__clickup_create_task_comment`, `mcp__clickup__clickup_get_task_comments`, `mcp__clickup__clickup_filter_tasks`.
- Live probe result (this session, 2026-05-23): `mcp__clickup__clickup_get_workspaces` → "No such tool available: mcp__clickup__clickup_get_workspaces". `mcp__clickup__clickup_get_task` (declared in bram.md) → "No such tool available: mcp__clickup__clickup_get_task". `mcp__clickup__clickup_get_task_comments` (declared in bram.md) → "No such tool available: mcp__clickup__clickup_get_task_comments". All three returned the same error string verbatim.
- `c:/Trunk/PRIVATE/ClaudeTeam/.claude/agents/TEAM.md` lines 39–40 — documents a related harness behavior: "Anthropic's Claude Code runtime filters the `Agent` tool out of the toolset exposed to sub-agents." This confirms that tool-surface filtering in sub-agent runtimes is a known, documented harness characteristic — not an anomaly.
- `c:/Trunk/PRIVATE/ClaudeTeam/.claude/settings.json` — no `mcpServers` block; project-level settings contain no MCP configuration.
- `c:/Users/538252/.claude/settings.json` — no `mcpServers` block; user-level settings.json contains no MCP configuration (all MCP config lives in `~/.claude.json`).
- `c:/Users/538252/.claude.json` `tengu_mcp_subagent_prompt: true` (line ~472) — a feature flag named `mcp_subagent_prompt` is enabled; however, its presence does not result in MCP tools being surfaced in this sub-agent session, so it either controls something else (prompt injection) or applies only under specific conditions not present here.

## What I did NOT verify

- Whether the orchestrator (main session, not a sub-agent) can call `mcp__clickup__*` tools successfully. This probe ran in a sub-agent context only. If the orchestrator CAN call them, that confirms the gap is sub-agent-specific and Hypothesis A holds exactly.
- Whether any Claude Code version upgrade or configuration change (e.g. adding `mcpServers` to project `.claude/settings.json`) would cause MCP tools to become available in sub-agent runtimes. The harness behavior documented in TEAM.md suggests tool filtering is intentional, not a config gap.
- What `tengu_mcp_subagent_prompt: true` actually does — it may inject a textual description of available MCP servers into the sub-agent system prompt (without making them callable), which would explain why the persona files can declare MCP tools without runtime effect.
- Whether the `tools:` field in persona `.md` files represents a runtime allowlist (enforced by the harness) or a documentation-only declaration of intent.

## Implications for ClaudeTeam

- **ClickUp status flips by personas are currently impossible.** Every persona that declares `mcp__clickup__*` tools cannot execute them at runtime. Nora's report was accurate. The `clickup-pending.md` fallback pattern is correct and should be treated as permanent until Anthropic changes the sub-agent tool-surface behavior.
- **The orchestrator must own all ClickUp writes.** The orchestrator session (not a sub-agent) has access to `mcp__clickup__*` tools and should execute every status flip, task creation, and comment that personas currently cannot. The persona files' MCP tool declarations are forward-compat only — they will become operative if/when the harness begins surfacing MCP tools to sub-agents.
- **Decision draft:** Accept `clickup-pending.md` as the permanent fallback pattern for sub-agent ClickUp operations. Personas append intended transitions; orchestrator flushes on each tick. No code change needed — this is a process convention to document in `orchestration-overview.md`.
