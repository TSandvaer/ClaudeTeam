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

**Last flush:** 2026-05-23 18:40 UTC by orchestrator — flushed through ENTRY 018 (all M2 Wave 0 tickets `86c9y7jn9`/`86c9y7jf4`/`86c9y7jjd`/`86c9y7jdz` set to `complete` directly; intermediate "in review" entries 014 were redundant for sub-agents whose MCP gap meant the orchestrator was already going to be the one writing the final state). M1 entries 002-013 were pre-flushed during M1 via direct MCP calls (boards already at `complete`); they remain here as historical audit.

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
ENTRY 012: 86c9y5cmg -> in review
ENTRY 013: 86c9y6e17 -> in review
ENTRY 014: 86c9y7jn9 -> in review
ENTRY 015: 86c9y7jn9 -> complete
ENTRY 016: 86c9y7jf4 -> complete
ENTRY 017: 86c9y7jjd -> complete
ENTRY 018: 86c9y7jdz -> complete
ENTRY 019: 86c9y7uhz -> in review
ENTRY 020: 86c9y7uhz -> complete
ENTRY 021: 86c9y7uka -> complete
ENTRY 022: 86c9y7u44 -> in review
ENTRY 023: 86c9y7u44 -> complete
ENTRY 024: 86c9y7yzf -> complete
ENTRY 025: 86c9y7u4p -> complete
ENTRY 026: 86c9y9q6h -> in review
ENTRY 027: 86c9y9q6h -> complete
ENTRY 028: 86c9y9v7r -> in review
ENTRY 029: 86c9y9yzu -> in review (PR #30 opened — fix(scaffold): dist/extension CJS shim for Node 22+ require())
# --- Switchover 2026-05-24 (M3-05): entries above use legacy sequential ENTRY-NNN; entries below use timestamp-based ENTRY-<ISO-8601-UTC>. ---
ENTRY-2026-05-24T11:58:00Z: 86c9yaq1e -> in review (M3-01 PR opened — feat(roster): live YAML watch + hot-reload)
ENTRY-2026-05-24T12:36:00Z: 86c9yaq1e -> complete (PR #35 merged at a74cb94 — Maya APPROVE_WITH_NITS, 3 NITs non-blocking, NIT #3 absorbs into M3-02 per Maya's recommendation)
ENTRY-2026-05-24T13:30:01Z: 86c9yb0yg -> to do (M3-01 NITs follow-up — ticket created; see NEW-TICKET-REQUEST body block below for audit trail)
```

## NEW-TICKET-REQUEST — M3-01 NITs follow-up (orchestrator to create)

Sub-agent MCP gap (persistent — see `.claude/docs/orchestration-overview.md` § "Sub-agent MCP gap"): Nora cannot call `mcp__clickup__clickup_create_task` from this dispatch. Orchestrator creates the ticket on next tick and substitutes the resulting task ID in the ENTRY-2026-05-24T13:30:01Z line above.

- **List ID:** `901523520912`
- **Title:** `chore(roster): M3-01 NITs follow-up`
- **Status:** `to do`
- **Owner (assignee field):** Felix (peer reviewer: Maya)
- **Priority:** P2

### Body (markdown_description)

```markdown
M3-01 NITs from Maya's peer-review at https://github.com/TSandvaer/ClaudeTeam/pull/35#issuecomment-4528643161 (APPROVE_WITH_NITS, 3 NITs, 2 actionable here):

**NIT #1** — `package.json` `claudeteam.rosterPollIntervalMs` description/minimum mismatch.
- Current: description says "e.g. 5000" but in-code clamp `ROSTER_POLL_MIN_MS` is 250ms (lowered from 1000 in commit 397bd09 for CI flake fix).
- Fix: align them. Either raise the in-code clamp back to 1000 (preferred — `e.g. 5000` makes sense for prod) and find a different CI-flake fix, OR update the package.json description to reflect 250ms minimum (cheaper but signals to users that very-frequent polling is fine, which it's not for prod).
- Files: `package.json` (contributes.configuration description), `src/extension/roster/rosterWatcher.ts:320` (ROSTER_POLL_MIN_MS clamp value).

**NIT #2** — PR-body wording (no code fix): the M3-01 PR body claimed "Atomic-replace editor save: Verified by the coalescing test" — but the coalescing test exercises rapid rewrites, not vim `delete+create`. Mechanism is the same (250ms debounce coalesces), but the phrasing was loose. Action: note in dispatch brief / PR-author checklist for future PRs that body claims must match test fixture shapes exactly. No code or test change needed here.

**NIT #3** — DOES NOT NEED A TICKET — absorbs into M3-02 (`claudeteam.openRoster` command). The `registerDirWatcher` `existsSync` → `createFileSystemWatcher` race is acceptable for V1 (covered by try/catch, no retry-on-reappearance). M3-02 will auto-create the directory + roster file when `openRoster` is invoked, eliminating the race entirely. Backlog edit applied: `team/nora-pl/milestone-3-backlog.md § M3-02` explicitly states the NIT #3 absorption.

## Acceptance criteria
- AC1: `package.json` `rosterPollIntervalMs` description and clamp value are aligned (either-direction fix, dev's call with peer reviewer).
- AC2: All existing tests still green; new test if behavior changes.
- AC3: PR body documents which alignment direction was chosen and why.

## OOS
- Any other roster watcher tweaks beyond NITs #1 + #2.
- The NIT #3 scope (handled by M3-02 instead).

## Size: XS (≤30 line code change expected).
## Priority: P2 (non-blocking polish on shipped feature).
```

### Comment to post on M3-01 (`86c9yaq1e`) when flipping to complete

```
M3-01 merged at SHA `a74cb94`. Peer-reviewer: Maya — verdict APPROVE_WITH_NITS at https://github.com/TSandvaer/ClaudeTeam/pull/35#issuecomment-4528643161.

NITs follow-up: separate ticket created (M3-01 NITs follow-up) covering NIT #1 (package.json description/clamp mismatch) and NIT #2 (PR-body wording note). NIT #3 absorbed into M3-02 (auto-create roster directory + starter YAML in `claudeteam.openRoster` eliminates the `existsSync`→`createFileSystemWatcher` race).
```

**Note (orch comment to add):** the M3-01 → complete flip itself was already performed by the orchestrator on the parallel path (ENTRY-2026-05-24T12:36:00Z, commit 33bf117). This dispatch's remaining load-bearing action is the NEW-TICKET-REQUEST above. Orchestrator: please also post the comment block above on `86c9yaq1e` if it wasn't already added during the T12:36 flip.
