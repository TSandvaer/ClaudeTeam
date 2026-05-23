# ClaudeTeam — Agent Team

Six named agents handle the ClaudeTeam build. The Sponsor (Thomas) talks to the **orchestrator** (the Claude Code session). The orchestrator fans out directly to Nora, Iris, Felix, Maya, Sage, and Bram via the `Agent` tool. **Nested-Agent spawning is unsupported** in the current Claude Code build — top-level fan-out is the permanent model (see *Topology* below).

## Roster

| Agent | Role | Workspace folder | Owns |
|---|---|---|---|
| [Nora](nora.md) | Project Lead | `team/nora-pl/` | Backlog, ClickUp board, scope, schedule, retros, dispatch contracts, process docs |
| [Iris](iris.md) | UX Designer | `team/iris-ux/` | Dashboard layout, tile design, interaction specs, design tokens, visual direction |
| [Felix](felix.md) | Senior Dev — Extension Host | `team/felix-dev/` | TypeScript extension host, file-watcher, JSONL parsing, schema handling, roster matcher |
| [Maya](maya.md) | Senior Dev — Webview UI | `team/maya-dev/` | Webview UI (React/Svelte/vanilla TBD), rendering, extension-host ↔ webview message protocol |
| [Sage](sage.md) | QA / Tester | `team/sage-qa/` | Test plans, unit + integration tests, manual VS Code checklists, sign-off readiness |
| [Bram](bram.md) | Claude Code Internals Consultant | `team/bram-research/` | Research notes on hooks, JSONL schema drift, VS Code extension API, prior-art comparison |

## Communication topology

```
              Thomas (Sponsor)
                    │
                    ▼
              Orchestrator  ◄── single fan-out / fan-in point
              ┌──┬──┬──┬──┬──┬──┐
              ▼  ▼  ▼  ▼  ▼  ▼  ▼
            Nora Iris Felix Maya Sage Bram
                        │     │
                        │     ↕ (peer PR review)
                        ▼     │
              (Felix ↔ Maya for cross-dev review;
               Sage QAs both; Iris design PRs reviewed by Maya/Felix by surface)
```

- **Sponsor talks to the orchestrator**, not to any single agent. Per user-global `sponsor-decision-delegation` pattern: Sponsor only signs off big deliveries (milestone boundaries); orchestrator makes recommended cross-role calls.
- **Felix ↔ Maya peer-review** for code PRs (extension host and webview lanes review each other).
- **Sage QAs all UX-visible PRs** before merge per the testing bar (webview reload smoke, manifest verify, paired tests).
- **Bram does research only** — no code PRs except research notes under `team/bram-research/`. Cannot peer-review code PRs.
- **Nora does NOT spawn peers** — she authors tickets, retros, dispatch contracts. The orchestrator dispatches based on her recommendations.

**Why this topology and not Nora-as-fan-out:** Anthropic's Claude Code runtime filters the `Agent` tool out of the toolset exposed to sub-agents, so a spawned Nora cannot itself spawn Felix/Maya/etc. The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` flag is **confirmed inert in this Claude Code build**. Top-level fan-out is the permanent model. Re-probe if Anthropic ships native nested-Agent.

## Task lifecycle

1. **Sponsor → Orchestrator:** feature request / direction / decision.
2. **Orchestrator → Nora:** "decompose this" / "add to backlog." Nora drafts ClickUp task(s) with acceptance criteria, suggests assignee + priority. Returns plan.
3. **Orchestrator → Iris** (if UX/visual needed): writes a spec under `team/iris-ux/`. Returns spec.
4. **Orchestrator → Bram** (if research/internals question): produces a research note. Returns findings + PR with the note.
5. **Orchestrator → Felix or Maya:** branches `{role}/<id>-<slug>`, implements, opens PR. Returns PR # + tight final report.
6. **Orchestrator → the other developer:** peer-reviews via `gh pr review` (or `gh pr comment` with "APPROVE" if shared-identity blocks formal approve).
7. **Orchestrator → Sage:** QA per testing bar. Returns APPROVE / REQUEST CHANGES.
8. **Merge** (only after Sage approval; orchestrator triggers via `gh pr merge --admin --squash --delete-branch`).
9. **ClickUp status flip** (paired with merge in same tool round: `in review → complete`).

## Shared references

Every agent reads these on first substantive task of a session:

- [CLAUDE.md](../../CLAUDE.md) — project brief and hard rules
- [.claude/docs/architecture-overview.md](../docs/architecture-overview.md) — V1 architecture
- [.claude/docs/data-sources.md](../docs/data-sources.md) — Claude Code paths and schemas
- [.claude/docs/roster-matching.md](../docs/roster-matching.md) — roster YAML and matcher
- [.claude/docs/vscode-extension-conventions.md](../docs/vscode-extension-conventions.md) — extension scaffold patterns
- [.claude/docs/testing-strategy.md](../docs/testing-strategy.md) — testing layers
- [.claude/docs/orchestration-overview.md](../docs/orchestration-overview.md) — dispatch + PR/merge protocol
- [docs/V1-PLAN.md](../../docs/V1-PLAN.md) — V1 product plan
- [.claude/agents/dispatch-template.md](dispatch-template.md) — reusable dispatch blocks

## Operational IDs

- **ClickUp workspace:** `90151646138`
- **ClickUp list (ClaudeTeam board):** `901523520912`
- **ClickUp space (TSandvaer Development):** `90156932495`
- **Status workflow (4-state, case-sensitive):** `to do` → `in progress` → `in review` → `complete`
- **GitHub repo:** `TSandvaer/ClaudeTeam`
- **Target editor:** VS Code (>= 1.85 expected; pin in extension manifest)

## Worktree map

- Project root (orchestrator survey, READ-ONLY for code): `c:\Trunk\PRIVATE\ClaudeTeam`
- Per-role: `c:\Trunk\PRIVATE\ClaudeTeam-{nora,iris,felix,maya,sage,bram}-wt`
- All role worktrees start on their `<role>/idle` branch and switch to `<role>/<id>-<slug>` per dispatch.

## Models

All six agents are `opus` by default EXCEPT Bram (`sonnet`). Rationale:
- **Opus** — Nora/Iris/Felix/Maya/Sage do work where correctness + design judgment dominate (tickets, specs, code, tests).
- **Sonnet for Bram** — research/synthesis benefits from larger context + faster iteration; Bram's output is notes the orchestrator validates, not code that ships.

Downgrade other lanes to `sonnet` only if a specific lane proves consistently throughput-bound without quality regression.

## Forward-compat note

`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set in `.claude/settings.json` for forward-compat — currently inert. If Anthropic ships native nested-Agent or `subagent_type` matching for named personas, the persona files in this directory become harness-loadable automatically.
