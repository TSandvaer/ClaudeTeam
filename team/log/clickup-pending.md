# ClickUp pending — M1 ticket creation

These ten tickets need to be created by the orchestrator in list `901523520912` (ClaudeTeam board), all in status `to do`. Nora's session does NOT have the `mcp__clickup__clickup_create_task` tool surfaced (despite being in her persona's tool list — the harness filtered it). Each row is one `mcp__clickup__clickup_create_task` call.

Schema reference:
- `list_id`: `901523520912` (ClaudeTeam list)
- `status`: `to do` (case-sensitive)
- `name`: ticket title (conventional-commit format)
- `markdown_description`: the full body, copied from the relevant section of `team/nora-pl/milestone-1-backlog.md`

After creation, append the resulting ClickUp task IDs back into `team/nora-pl/milestone-1-backlog.md` next to each ticket header.

## Tickets to create (in order — but creation can be parallel)

| # | ID | Name | Owner | Priority |
|---|---|---|---|---|
| 1 | M1-01 | `chore(repo): bootstrap TypeScript scaffold + CI` | Felix | P0 |
| 2 | M1-02 | `research(fixtures): capture meta.json + JSONL + sessions samples` | Bram | P0 |
| 3 | M1-03 | `spec(cli): M1 CLI output layout + glyph spec` | Iris | P1 |
| 4 | M1-04 | `test-plan(m1): M1 acceptance test plan` | Sage | P1 |
| 5 | M1-05 | `feat(parser): meta.json parser (v2.1.119 + v2.1.145)` | Felix | P0 |
| 6 | M1-06 | `feat(parser): subagent JSONL tailer + activity extraction` | Felix | P0 |
| 7 | M1-07 | `feat(parser): sessions/PID registry + liveness` | Felix | P0 |
| 8 | M1-08 | `feat(roster): YAML loader + matcher` | Felix | P0 |
| 9 | M1-09 | `feat(cli): reducer + agent-tree CLI driver` | Felix | P0 |
| 10 | M1-10 | `test(m1): integration tests against fixture filesystem` | Sage | P0 |

Suggested ClickUp `markdown_description` for each ticket: copy the entire `## M1-XX — <title>` section from `team/nora-pl/milestone-1-backlog.md` (everything up to but not including the next `## M1-XX` header). Each ticket body already includes: Owner, Peer reviewer, Size, Priority, Source, Scope, Acceptance criteria, Out of scope, Done-when test, Files in play, Dependencies.

## After tickets are created

1. Orchestrator captures each ClickUp task ID.
2. Orchestrator (or dispatches Nora again) PR-appends them into `team/nora-pl/milestone-1-backlog.md` per-section header (e.g., `## M1-01 — chore(repo): ... — ClickUp #abc123`).
3. Optional: write the ID mapping to `team/log/clickup-ticket-map.md` for cross-reference.

## Why this exists (process note)

The `mcp__clickup__clickup_create_task` tool was listed in Nora's persona file (`/.claude/agents/nora.md` line 4) but is NOT exposed to the Nora session at runtime in the current Claude Code harness version. The persona-file tool list is best-effort declarative — the runtime harness controls actual availability. **Until this is fixed, ClickUp ticket creation flows back through the orchestrator.** Nora drafts the tickets as backlog markdown; orchestrator creates them in ClickUp.

Logged this gap explicitly so future planning sessions don't repeat the surprise.

## Status-flip queue (sub-agent dispatch fallback)

Per `.claude/docs/orchestration-overview.md` "ClickUp as hard gate" — sub-agents append intended status transitions here; orchestrator flushes on each tick.

```
ENTRY 002: 86c9y5c4g -> in review
ENTRY 003: 86c9y5c8m -> in review
ENTRY 004: 86c9y5c7v -> in review
ENTRY 005: 86c9y5ca3 -> in review
ENTRY 006: 86c9y5q8d -> in review
ENTRY 007: 86c9y5cfe -> in review
ENTRY 008: 86c9y5cah -> in review
ENTRY 009: 86c9y5ccb -> in review
ENTRY 010: 86c9y5ccn -> in review
ENTRY 011: 86c9y5chc -> in review
```

