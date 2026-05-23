# ClaudeTeam V1 — Project Plan

Project Lead view of how V1-PLAN's four milestones become a team-executable program. Source: [docs/V1-PLAN.md](../../docs/V1-PLAN.md). Last updated by Nora on initial planning kickoff.

## Milestone shape

| # | Milestone | Output | Lane mix | Rough duration |
|---|---|---|---|---|
| **M1** | Data spike (CLI tool) | `npm run agent-tree` prints the live agent tree from `~/.claude/` local files. Validates parsers + roster matcher before any VS Code shell exists. | Backend-heavy: Felix 6 tickets, Bram 1, Iris 1, Sage 2. Maya cross-reviews only. | 1–2 days |
| **M2** | Extension scaffold | VS Code extension activates, registers Activity Bar view, renders M1 data in a hardcoded webview. Webview-host bridge functional. | Mixed: Felix host scaffold, Maya webview scaffold + first render, Iris dashboard wireframe, Sage activation + webview-reload tests. | 1–2 days |
| **M3** | Roster config + named tiles | Real `teams.yaml` (global + per-project) loaded; rostered agents render as named tiles, unrostered collapse into background-noise chip. | UX-heavy: Iris tile spec, Maya tile component, Felix wires loader into matcher (M1 logic already there), Sage covers matcher edge cases. | 1–2 days |
| **M4** | Live polish | Drill-in (click tile → open JSONL), status states (running/idle/finished), theme-switch behavior, polling-cadence tuning, manual reload checklist. | Maya + Iris dominate; Felix optimizes polling; Sage final regression pass. | 1–2 days |

V1-PLAN claims "~1 week of focused work." That's optimistic for a 4-person dev team running serially. Realistic estimate with parallel dispatch: **1.5–2.5 calendar weeks**, depending on how cleanly M1's data plane lands. M1 is the riskiest milestone because every later milestone consumes its outputs.

## Why this sequencing (not another)

**Option considered:** Scaffold the VS Code extension first (M2), then bolt on data + roster.

**Rejected because:** the data plane is where the schema-drift / liveness-inference / matcher correctness risk lives. If we ship a webview first and discover during M3 that the matcher needs a rule type the roster YAML doesn't support, we've now got a webview rendering wrong data while we re-cut the matcher. The data spike isolates that risk into a CLI that's easy to iterate and easy to test (vitest only — no VS Code reload loop).

**Chosen sequencing rationale (M1 → M2 → M3 → M4):**
1. **M1 first** validates the parsers + matcher against real fixtures. Cheapest place to find a schema-handling bug. CLI is throwaway after M2, but the modules underneath are not — they're reused as-is.
2. **M2 next** because once we trust the data, the only remaining question for the shell is "does VS Code activation + webview rendering work end-to-end?" Hardcoded webview content keeps Maya unblocked from waiting on Iris's full design.
3. **M3 third** because the roster's first real test is in the dashboard, not the CLI — the "rostered vs background" distinction is a UI concern (named tile vs collapsed chip), not a data-plane concern. M3 is when Iris's tile spec becomes load-bearing.
4. **M4 last** because polish (drill-in, theme handling, polling-cadence tuning) requires the full data + UI stack present so behavior changes can be observed.

## Lane breakdown per milestone

### M1 — Data spike (this backlog)

- **Felix (6):** scaffold + CI, meta.json parser, JSONL tailer, sessions/PID registry, roster loader+matcher, reducer + CLI driver.
- **Bram (1):** capture fresh fixtures (both meta.json schema versions, real JSONL samples, real sessions/{pid}.json files, anonymized).
- **Iris (1):** CLI output spec — what the printed tree looks like (line layout, glyph spec, state indicators).
- **Sage (2):** M1 acceptance test plan; integration tests against fixture filesystem.
- **Maya:** cross-reviews Felix's PRs. No primary tickets in M1.

### M2 — Extension scaffold

- **Felix:** extension entry (activation events, `package.json` contributes), `WebviewViewProvider`, host-side `messageBus`.
- **Maya:** webview scaffold (UI framework decision lands here — likely vanilla TS or Svelte for V1 bundle weight), CSP setup, first hardcoded render of an agent tree from a hardcoded payload.
- **Iris:** dashboard layout spec (Activity Bar dimensions, where the team-card sits, how the noise-chip looks).
- **Sage:** activation tests + webview-reload smoke harness; manual reload checklist v1.
- **Bram:** likely no ticket; on standby for "which VS Code API version is the minimum?" question.

### M3 — Roster config + named tiles

- **Iris:** roster-agent tile spec — running / idle / finished / error states.
- **Maya:** tile component, background-noise chip, expansion behavior.
- **Felix:** wire roster loader (already built in M1) into the live data flow; surface match misses gracefully (malformed YAML, empty roster).
- **Sage:** roster matcher edge-case coverage (duplicate ids, empty rules, schema drift).
- **Bram:** standby.

### M4 — Live polish

- **Maya:** drill-in (`workspace.openTextDocument(jsonlPath)`), state-indicator visuals, theme-switch correctness.
- **Iris:** state-state spec + design tokens. Decides any animation behavior.
- **Felix:** polling-cadence tuning, idle/finished state detection refinement.
- **Sage:** final regression pass + V1 release manual checklist.

## Risks (top 5, M1-focused)

| # | Risk | Mitigation | Owner |
|---|---|---|---|
| R1 | **Schema drift between v2.1.119 and v2.1.145 isn't fully captured in docs** — parser may pass tests on the captured fixtures but break on a third schema variant we haven't seen. | Bram captures fixtures from BOTH schema versions live before Felix writes the parser. Sage's tests include malformed/missing-field probes. Re-probe when Claude Code minor versions bump. | Bram + Felix |
| R2 | **JSONL flush cadence ≥ 2s** — polling at 2s plus disk staleness can blow up the "subagent activity" feel. M1's CLI accepts this; M4's polling tune may need to lift to event-based via `fs.watch` or `chokidar`. | M1 ticks tolerate this; flag for M4. | Felix |
| R3 | **`gh pr review --approve` may be blocked by shared git identity** — orchestration-overview already calls this out (fallback: `gh pr comment` with "APPROVE"). If both routes break, peer-review gate stalls. | Test on the first real PR (M1-01). If both block, escalate to sponsor for git identity decision. | orchestrator |
| R4 | **Felix is single-threaded on M1** — 6 of 10 tickets land on his lane. If he blocks, M1 stops. | Sequence carefully: bootstrap + parsers fire in parallel where possible; integration ticket (M1-09, M1-10) is the only true serial point. Maya cross-reviews to keep PRs moving. | Nora (sequencing) |
| R5 | **`vsce package` toolchain hasn't been verified locally** — extension-manifest gate (CLAUDE.md hard rule #4) requires `vsce package` output on every manifest-touching PR. If vsce is broken or unconfigured, every M2+ PR stalls. | M1-01 (scaffold) includes a smoke `vsce --version` check; sponsor confirms vsce is installed. | Felix (M1-01) |

Risks are tracked formally in [risk-register.md](risk-register.md). This list is the M1 cut.

## Parallel-dispatch recommendation (first wave)

**Fire these three in parallel** — zero deps between them, all can start now:

1. **M1-01** chore(repo): bootstrap scaffold + CI → **Felix**
2. **M1-02** research(fixtures): capture both schema versions + JSONL samples → **Bram**
3. **M1-03** spec(cli): CLI output layout + glyph spec → **Iris**

When M1-01 + M1-02 both merge, **fire the next wave (four in parallel)**:

4. **M1-05** feat(parser): meta.json parser → **Felix**
5. **M1-06** feat(parser): JSONL tailer → **Felix** (Felix sequential; or split if a second dev is added)
6. **M1-07** feat(parser): sessions registry → **Felix**
7. **M1-08** feat(roster): YAML loader + matcher → **Felix**

(Felix is sequential through M1-05/06/07/08. That's the M1 throughput ceiling. Maya can pull cross-review duty to keep PRs from stacking.)

When M1-03 merges, **fire M1-04 (test plan)** → **Sage**, parallel with the parser work.

Final wave (after all parsers + matcher land):
- **M1-09** feat(cli): reducer + CLI driver → **Felix**
- **M1-10** test(m1): integration tests against fixture filesystem → **Sage**

## Open questions for sponsor

Only **two** items genuinely need sponsor input before the team can ship M1:

1. **CLI output format ownership** — V1-PLAN says M1 produces "a CLI tool that prints the live agent tree." Is the CLI output format expected to mirror the final dashboard's visual hierarchy (so Iris specs it), or is it ad-hoc developer plumbing (Felix decides on the spot)? Ticket M1-03 assumes Iris specs it because the printed-tree layout informs the dashboard tile layout. If sponsor wants this faster, drop M1-03 and let Felix pick a reasonable text format.

2. **Test fixture sourcing** — Bram captures real fixtures from the sponsor's actual `~/.claude/` tree. That tree contains conversation content (the JSONL transcripts) that may be sensitive. Confirm: (a) is anonymization OK done by Bram (replace user message text with `<redacted>`)? (b) any sessions to exclude entirely from fixture capture (specific project slugs, time ranges)? Default assumption if no answer: capture only this project's sessions and `<redacted>` all user message content.

Everything else in V1-PLAN's "Open questions" section is a build-time decision (UI framework, polling cadence, background-noise grouping) and can be decided by Felix/Maya/Iris in the relevant milestone without sponsor input.

## Recommendation on this planning task's ClickUp lifecycle

**Option (b) — treat as orchestrator scaffolding, no ticket.** Rationale: this is the bootstrap of the backlog itself; creating a self-referential ticket adds ceremony without auditing value. The artifacts (this doc + the 10 M1 tickets) are the deliverable; ClickUp will reflect this work via the 10 tickets it produced.

## What I'm NOT proposing

- **No M2/M3/M4 tickets in ClickUp yet.** Premature; M1's outputs will reshape M2's surface. Re-plan M2 after M1-09 merges.
- **No design-token spec, no V1 release checklist, no demo plan.** All belong in M3/M4.
- **No ticket for sponsor demo / sign-off.** That's a milestone gate, not a ticket.
- **No coordination doc PR to bring `team/DECISIONS.md` into existence yet.** Created lazily when there's a first decision to log.
