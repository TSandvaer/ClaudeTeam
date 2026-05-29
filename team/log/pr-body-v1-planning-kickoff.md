## Summary

Initial project planning kickoff for ClaudeTeam V1. Sponsor stepped back; this PR establishes the Nora-owned coordination artifacts the team will execute against.

## Artifacts

- **`team/nora-pl/project-plan.md`** — M1–M4 lane breakdown, sequencing rationale (why M1 → M2 → M3 → M4 and not extension-first), realistic duration estimate (1.5–2.5 calendar weeks, not 1), open questions for sponsor.
- **`team/nora-pl/milestone-1-backlog.md`** — 10 dispatch-ready M1 tickets. Each has: title (conventional-commit), owner, peer reviewer (cross-pair rules applied), size, priority, source, scope, acceptance criteria (verifiable), out-of-scope, done-when test (exact command/check), files in play, conflict rule, dependencies.
- **`team/nora-pl/risk-register.md`** — 5 active risks for M1 (schema drift, JSONL staleness, `gh pr review` identity, Felix single-threaded, vsce toolchain).
- **`team/STATE.md`** — Nora's run log.
- **`team/log/clickup-pending.md`** — orchestrator action item: 10 ticket creations in list `901523520912`. (`mcp__clickup__clickup_create_task` is declared in Nora's persona but not surfaced at runtime — gap flagged in the doc.)

## M1 ticket headline

| # | Title | Owner | Reviewer | Deps |
|---|---|---|---|---|
| M1-01 | chore(repo): bootstrap TypeScript scaffold + CI | Felix | Maya | — |
| M1-02 | research(fixtures): capture meta.json + JSONL + sessions samples | Bram | orch | — |
| M1-03 | spec(cli): M1 CLI output layout + glyph spec | Iris | Felix | — |
| M1-04 | test-plan(m1): M1 acceptance test plan | Sage | Felix | M1-03 |
| M1-05 | feat(parser): meta.json parser (v2.1.119 + v2.1.145) | Felix | Maya | M1-01, M1-02 |
| M1-06 | feat(parser): subagent JSONL tailer + activity extraction | Felix | Maya | M1-01, M1-02 |
| M1-07 | feat(parser): sessions/PID registry + liveness | Felix | Maya | M1-01, M1-02 |
| M1-08 | feat(roster): YAML loader + matcher | Felix | Maya | M1-01 |
| M1-09 | feat(cli): reducer + agent-tree CLI driver | Felix | Maya | M1-05/06/07/08, M1-03 |
| M1-10 | test(m1): integration tests against fixture filesystem | Sage | Felix | M1-09, M1-02 |

## Parallel-dispatch recommendation (first wave)

Fire these three in parallel — all zero-dep:
1. **M1-01** → Felix
2. **M1-02** → Bram
3. **M1-03** → Iris

Once M1-01 + M1-02 land, second wave fires M1-05/06/07/08 — all on Felix, sequential through his lane. M1-04 fires once M1-03 merges. M1-09 + M1-10 are the final integration layer.

## Open questions for sponsor (2)

Only items that genuinely block. Both are in `team/nora-pl/project-plan.md` §"Open questions for sponsor."

1. **CLI output format ownership** — does Iris spec the M1 CLI output (M1-03 assumes yes), or does Felix decide ad-hoc? Affects: drop M1-03 if Felix decides.
2. **Test-fixture sourcing for Bram (M1-02)** — anonymization scope (default: `<redacted>` user content, capture only this project's sessions) — sponsor confirms or scopes.

Everything else (UI framework, polling cadence, background-noise grouping) is a build-time decision the relevant role makes during the milestone.

## Doc updates suggested for `.claude/docs/`

None this PR. The existing six docs were sufficient input; nothing learned during planning that contradicts them. The CLI output spec landing in M1-03 may seed a future addition (e.g., `cli-output-conventions.md`) but premature this turn.

## Verdict

Ready for dispatch. The 10 M1 tickets are dispatch-ready per `.claude/agents/dispatch-template.md`; the orchestrator can lift any ticket section verbatim into a brief without back-and-forth.

## Self-Test Report

N/A — this PR contains only planning markdown; no extension code, no webview, no parser.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
