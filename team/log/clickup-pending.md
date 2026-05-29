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
ENTRY-2026-05-24T14:53:00Z: 86c9yb473 -> in review (M3-02 PR #37 opened — feat(roster): claudeteam.openRoster command + auto-create starter YAML)
ENTRY-2026-05-24T14:54:25Z: 86c9yb473 -> complete (PR #37 merged at d0225aa — Maya APPROVE 8/8 ACs)
ENTRY-2026-05-24T15:30:00Z: 86c9yb59k -> in progress (M3-03 dispatch — feat(host): window-scoped session filtering)
ENTRY-2026-05-24T15:30:01Z: 86c9yb59k -> in review (M3-03 PR #38 opened)
ENTRY-2026-05-24T16:00:57Z: 86c9yb59k -> complete (PR #38 merged at 1bc422c — Maya APPROVE 10/10 ACs)
ENTRY-2026-05-24T16:30:00Z: 86c9ybdxe -> in progress (M3-04 dispatch — feat(webview): roster-error chip + filtered-empty state + open-roster button)
ENTRY-2026-05-24T16:35:30Z: 86c9ybdxe -> in review (M3-04 PR #39 opened)
ENTRY-2026-05-24T17:15:00Z: 86c9yb0yg -> in progress (M3-01 NITs follow-up — Felix accepted dispatch)
ENTRY-2026-05-24T17:30:00Z: 86c9yb0yg -> in review (M3-01 NITs PR opened)
ENTRY-2026-05-24T17:46:00Z: 86c9ybrk0 -> in progress (M3-03 DEAD-session bleed fix — Felix dispatched, orch-side MCP unavailable so flip queued)
ENTRY-2026-05-24T18:07:00Z: 86c9ybrk0 -> in review (PR #41 ready for Maya — scope-corrected to webview-boot fixture; host AC3 + webview boot-bleed fix + 4 jsdom tests at HEAD 77cbe6c, CI green)
ENTRY-2026-05-24T19:34:57Z: 86c9ybrk0 -> complete (PR #41 merged at 0fbf028 — Maya APPROVE, host AC3 + webview boot-bleed fix landed; 268 unit + 68 integration green)
ENTRY-2026-05-24T20:08:00Z: 86c9ydufh -> in review (M3-09 PR opened — Sage Layer-3 expansion + bonus NIT-coverage absorb) [placeholder M3-09 substituted post-MCP-reconnect 2026-05-24T22:30Z]
ENTRY-2026-05-24T20:23:00Z: 86c9ydufh -> complete (PR #44 merged at e9d2457 — Felix APPROVE, 281 unit + 68 integration + 23 Layer-3 green) [created retrospectively at `complete` status via MCP 2026-05-24T22:30Z, so these flips are historical-only audit]
ENTRY-2026-05-24T22:30:00Z: 86c9ybrk0 -> complete (FLUSHED — was queued at 19:34Z while MCP down; flushed via MCP at session resume)
ENTRY-2026-05-24T22:30:01Z: 86c9ybtut -> in progress (M3-04 NITs dispatch — Felix host NIT #1+#2 + Maya webview NIT #3, parallel split per sponsor)
ENTRY-2026-05-24T23:35:00Z: 86c9ybtut -> in review (Maya webview NIT #3 PR opened — finished-status freshness suffix)
ENTRY-2026-05-24T23:35:01Z: 86c9ybtut -> in review (PR #45 opened — Felix host NITs #1+#2: parse-error model fallback + human-readable error format)
ENTRY-2026-05-25T00:58:00Z: 86c9ydug9 -> in review (PR #47 opened — Maya webview render + Self-Test + 86c9ydz4k NIT absorbed)
ENTRY-2026-05-25T06:39:22Z: 86c9yfj6n -> in review (PR #52 opened — chore(dispatch-template): codify "git switch --detach HEAD" as mandatory final step)
ENTRY-2026-05-25T07:00:00Z: 86c9ygcgv -> in progress (M4-01 dispatch — Iris three-part design spec start)
ENTRY-2026-05-25T07:03:36Z: 86c9ygcgv -> in review (PR #54 opened — M4-01 polish spec: tokens + status-state visuals + drill-in affordance)
ENTRY-2026-05-25T07:51:16Z: 86c9ygckv -> in review (M4-05 PR opened — status-state visuals + transitions per M4-01 §2)
ENTRY-2026-05-25T10:25:00Z: 86c9ygck9 -> in progress (M4-04 recovery dispatch — Felix resumed prior scaffold; running foreground measurement)
ENTRY-2026-05-25T10:55:00Z: 86c9ygck9 -> in review (M4-04 PR #59 opened — cadence tuning + memory probe; 386 unit + 68 integration green; vsce package clean)
ENTRY-2026-05-26T00:30:00Z: 86c9yteju -> in progress (Felix dispatched on doc-captures phase — 4 doc additions to vscode-extension-conventions.md + 1 package.json description tweak)
ENTRY-2026-05-26T00:45:00Z: 86c9yteju -> in review (PR #65 opened — 4 doc additions + rosterPath description flip; Self-Test Report posted; vsce package clean; 386 unit + 68 integration green)
ENTRY-2026-05-26T01:00:00Z: 86c9ytyq7 -> in review (M5 hide-finished spec PR opened — Iris design spec; Shape 1 + header-chip hybrid; parallel-ready vocabulary contract for Felix M5-EH + Maya M5-WV)
ENTRY-2026-05-26T08:50:00Z: 86c9yxv6d -> in review (PR #66 opened — fix(host): replay last-known state to remounted webview; eliminates pane-reopen empty-state flash; 386 unit + 71 integration green; Self-Test Report posted)
ENTRY-2026-05-26T10:58:00Z: 86c9z171k -> in review (PR opened — fix(webview): boot-time ui:refresh to pull host state after message listener is wired; one-line dispatch in boot() + bootRefresh.test.ts; 456 unit + 2 skipped green; lint + typecheck clean)
ENTRY-2026-05-26T22:30:00Z: 86c9zfmgg -> in progress (Maya accepted dispatch — Obs 8 hide-finished chip state-aware label)
ENTRY-2026-05-26T22:31:00Z: 86c9zfmgg -> in review (PR #84 opened — fix(webview): hide-finished chip label state-aware; ON branch reads "Show finished — N hidden"; 464 unit + 2 skipped green; jsdom data-plane smoke output included in Self-Test Report)
ENTRY-2026-05-27T00:00:00Z: 86c9zmqa8 -> in progress (Iris dispatched — polish spec for uniform-cluster expansion (auto-collapse vs compact-row); branch iris/86c9zmqa8-uniform-cluster-spec)
ENTRY-2026-05-27T00:15:00Z: 86c9zmqa8 -> in review (PR #91 opened — Iris spec; four candidate shapes A/B/C/D + comparison matrix; recommend Option A+B+A.1; three sponsor questions reserved for confirmation)
ENTRY-2026-05-28T00:00:00Z: 86ca10anf -> in progress (Felix dispatched — flip hideIdleAgents default true→false; whole team always displayed)
ENTRY-2026-05-28T00:01:00Z: 86ca10anf -> in review (PR #108 opened https://github.com/TSandvaer/ClaudeTeam/pull/108 — feat(config): flip hideIdleAgents default true→false; Maya requested as reviewer; 730 unit + 111 integration green; vsce package clean; Self-Test Report posted)
```

## NEW-TICKET-REQUEST — M3-01 NITs follow-up (FULFILLED — ticket `86c9yb0yg`)

Resolved 2026-05-24. NIT #1 (package.json description/clamp mismatch) + NIT #2 (PR-body wording process note) tracked in `86c9yb0yg`. NIT #3 absorbed into M3-02 per backlog edit.

## NEW-TICKET-REQUEST — M3-09 Sage Layer-3 expansion (FULFILLED — ticket `86c9ydufh`, created retrospectively at `complete` status 2026-05-24T22:30Z post-MCP-reconnect; PR #44 already merged at `e9d2457`)

**Status:** queued — orchestrator's ClickUp MCP did not connect this session, so ticket creation deferred to next session with live MCP. Sage has been dispatched IN PARALLEL — she'll author the body inline with her PR and append her own ENTRY when the PR opens. Orch substitutes the placeholder `M3-09` ID for the real ClickUp ID post-creation.

**Foundation:** M3 backlog `team/nora-pl/milestone-3-backlog.md` § M3-09 explicit `ClickUp: yes (create at dispatch)`. Sage's M3-09 dispatch this tick triggers the queue.

**Body to file** (per backlog M3-09 lines 498-543): name=`test(m3): Layer-3 expansion — YAML hot-reload + window-filter + roster-error chip (M3-09)`, list_id=`901523520912`, status=`to do`, markdown_description=Sage's PR body (Layer-3 test suite expansion — see backlog spec for ACs).

## NEW-TICKET-REQUEST — M3-10 persona-tile-collapse (FULFILLED — ticket `86c9ydug9`, created at `to do` status 2026-05-24T22:30Z post-MCP-reconnect; ready to dispatch when Felix+Maya have capacity)

**Status:** queued — orchestrator's ClickUp MCP did not connect this session, so ticket creation deferred to next session with live MCP, or sponsor can file manually.

**Sponsor authorization:** explicit `File M3-10 ticket now (P3)` answer to orchestrator's AskUserQuestion at session resume (2026-05-24T17:40Z). Heuristic choice: `Group by roster persona-name; show 'Felix ×3' with expandable list`.

**Foundation for ticket scope:** sponsor's screenshot earlier this session showed 16 rostered tiles in a dashboard whose roster has 6 personas — each sub-agent dispatch creates its own tile, so multiple Felix/Maya/etc dispatches in the same session accumulate visually.

### Draft body (for ClickUp markdown_description)

```
**Ticket:** M3-10 — `feat(webview): persona-tile-collapse — group by roster persona name`
**Owner:** Felix (reducer-side change primary) + Maya (webview render hunk)
**Peer reviewer:** Maya (host-side) / Felix (webview)
**Size:** M
**Priority:** P3
**Source:** sponsor inspection 2026-05-24 — dashboard showed 16 tiles for a 6-persona roster

**Scope:**
- When N>1 rostered tiles match the same persona name (matched roster entry), they collapse into a single header tile showing `<persona-name> ×N`.
- Collapsed tile is expandable to show per-session details (session ID, last-activity timestamp, dispatched-ticket when known).
- Unrostered subagents continue to flow into the existing per-session noise counter (unchanged).
- Single-instance tiles (N=1) render unchanged.

**Acceptance criteria:**
- AC1: Reducer groups by roster persona-name; output state shape includes `{personaName, count, instances[]}` for groups with N>1.
- AC2: Webview renders collapsed header tile + expand/collapse chevron + expanded list of `instances[]`.
- AC3: When N=1, tile renders as today (no header wrapper).
- AC4: Unrostered subagents bypass grouping and continue to flow into the noise counter.
- AC5: Optional config `claudeteam.collapsePersonaTiles` (default true) — opt-out for users who prefer flat list.
- AC6: Unit tests cover the reducer grouping (N=1, N=2, mixed rostered+unrostered).
- AC7: Webview tests cover render with collapsed/expanded state.
- AC8: Self-Test Report — install .vsix in fresh VS Code window, observe collapse with multiple dispatches of same persona.

**Out of scope:**
- Animation/transitions on expand/collapse (M4 polish).
- Sponsor-configurable threshold beyond simple `collapsePersonaTiles` boolean.
- Grouping by anything other than roster persona name.

**Done-when test:** `npm test && npm run test:integration` green + Self-Test Report shows collapse working in installed `.vsix`.
```

Create with: `list_id=901523520912`, `status=to do`, `name="feat(webview): persona-tile-collapse — group by roster persona name (M3-10)"`, `markdown_description=` the body above.

## NEW-TICKET-REQUEST — M3-09 Layer-3 expansion (PENDING)

**Status:** queued — orchestrator's ClickUp MCP unavailable this session per dispatch brief; ticket creation deferred to next session with live MCP. PR opened in parallel; ENTRY line above uses `M3-09` as the placeholder ID for the orch to substitute after creation.

### Draft body (for ClickUp markdown_description)

```
**Ticket:** M3-09 — `test(m3): Layer-3 expansion — YAML hot-reload + window-filter + roster-error chip`
**Owner:** Sage
**Peer reviewer:** Felix (host-side primary touch — runTick + sessionFilter wiring; webview rendering is incidental)
**Size:** M
**Priority:** P2
**Source:** team/nora-pl/milestone-3-backlog.md § M3-09 (depends on M3-01 + M3-03 + M3-04 all merged); M2-08 PR #29 set up the Layer-3 pipeline this ticket extends.

**Scope:**

Extend the `@vscode/test-electron` Layer-3 suite (`tests/vscode-integration/`) with three new test cases covering the M3 surfaces:

1. **YAML hot-reload smoke (M3-01):** write a roster YAML to a tempdir, drive `runTick` against the tempdir paths, mutate the YAML mid-test, re-tick, assert the `DashboardState.rosterTiles` reflects the new member id (and the old one is gone — leaky-reducer regression test).
2. **Window-scoped filtering smoke (M3-03):** seed three sessions across three workspaces in a tempdir; pin `workspaceFolders` to ONE of them; assert the filtered set + `filterApplied === true`. Negative-path pair asserts the don't-strand passthrough on undefined folders AND the `showAllSessionsGlobally` override branch.
3. **Roster-error chip smoke (M3-04):** write malformed YAML to the roster path; assert `state.rosterErrors` non-empty AND `serializeState` carries it to the wire shape the chip reads from. Control test (valid YAML → empty errors) gives the assertion meaning.

Test-plan executor-mapping discipline (M3-06) applies to this PR's ACs.

**Acceptance criteria:**

- AC1: `tests/vscode-integration/suite/rosterHotReload.test.ts` — YAML hot-reload smoke. Tempdir + direct `runTick` invocation. Asserts member id present in `state.sessions[].rosterTiles` BEFORE and AFTER mutation; mutation changes the visible id; old id is gone post-mutation.
- AC2: `tests/vscode-integration/suite/windowFilter.test.ts` — window-scoped filtering smoke. Asserts `filterApplied === true` + filtered session count == 1 of 3 seeded. Negative-path pair covers don't-strand passthrough + `showAllSessionsGlobally` override.
- AC3: `tests/vscode-integration/suite/rosterErrorChip.test.ts` — error-chip smoke. Writes malformed YAML; asserts `state.rosterErrors` non-empty + the wire-shape preserves it. Control test asserts valid YAML → empty errors.
- AC4: All three test suites green on CI: `npm run test:vscode`. Existing M2-08 suites still green.
- AC5: Sage posts findings of any bugs surfaced in Felix/Maya's M3 modules as follow-up tickets (M2-08 AC7 discipline — do not fix production code in this PR). [No bugs surfaced this round — all three M3 paths behaved correctly under Layer-3 exercise.]
- AC6: Executor-mapping table in the test plan section of the PR body lists each AC's executor — AC1-3 are Layer-3-automated (`@vscode/test-electron` headless via xvfb on Ubuntu CI per M2-08's pipeline).

**Bonus (absorbed from PR-#39 Sage review NIT gaps):**

- 7 new unit tests in `tests/unit/webview/hydrateState.test.ts` covering the M3-03/M3-04 back-compat hydrator branches (`filterApplied`, `rosterErrors`, `rosterWarnings` top-level fields).
- 6 new unit tests in `tests/unit/webview/dashboardTile.test.ts` covering `renderEmptyState({filtered: true})` (PR-#39 gap 1) + `renderFull` empty-with-filter variant + chip-above-empty layering invariant (PR-#39 gap 3).

**Out of scope:**

- Layer-1 or Layer-2 test changes (those live in M3-01/03/04 PRs).
- New CI infrastructure beyond extending the existing `test:vscode` step from M2-08.
- Coverage of the M3-02 `openRoster` command (host-side command unit-tested cheaply in Layer-1; Layer-3 coverage adds little).
- Production code fixes — file follow-up tickets if any bugs surface (AC5).

**Done-when test:**

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-sage-wt
npm test && npm run test:integration && npm run test:vscode
# All three layers green; 281 unit + 68 integration + 23 Layer-3 (9 new + 14 from M2-08)
```

**Webview-smoke / extension-manifest gate:**

- Webview-smoke gate: NO — this PR adds Layer-3 tests (the tests themselves ARE the webview-smoke verification for M3 surfaces). No production rendering changes here.
- Extension-manifest gate: NO.

**Files in play:**

- Owned (Sage writes): `tests/vscode-integration/suite/rosterHotReload.test.ts` (new), `tests/vscode-integration/suite/windowFilter.test.ts` (new), `tests/vscode-integration/suite/rosterErrorChip.test.ts` (new), `tests/unit/webview/hydrateState.test.ts` (bonus extension), `tests/unit/webview/dashboardTile.test.ts` (bonus extension), `tsconfig.vscode-integration.json` (include src/ for Layer-3 host-module imports).
- Read-only references: `.claude/docs/testing-strategy.md`, M2-08 PR #29 (existing suite structure), M3-01 / M3-03 / M3-04 merged code.
```

## Status-flip queue — appended 2026-05-25 (orchestrator MCP unavailable this session)

```
ENTRY-2026-05-25T00:42:00Z: 86c9yee3g -> in review (PR #50 opened by Maya; PR https://github.com/TSandvaer/ClaudeTeam/pull/50; Felix peer-review dispatched same tick)
ENTRY-2026-05-25T00:46:00Z: 86c9yee3g -> complete (PR #50 admin-merged at SHA 4115ae6; Felix APPROVE comment https://github.com/TSandvaer/ClaudeTeam/pull/50#issuecomment-4530707451; decision-log entry .claude/decisions-while-away.md 2026-05-25 0045 UTC)
ENTRY-2026-05-26T09:45:00Z: 86c9ytyq7 -> in review (M5-EH impl PR opened by Felix; ticket was complete after spec merge — orch handles re-open/close lifecycle nuance per dispatch brief)
```

## NEW-TICKET-REQUEST — PR #49 M3-close retro test-count NIT (FULFILLED — ticket `86c9yfj5e` created 2026-05-25T05:32Z via MCP after ClickUp reconnect; Nora authored PR #51 same round, ticket flipped `to do → in progress → in review`)

**Status:** queued — orchestrator MCP toolset lacks `clickup_create_task`; route to next sponsor-touch (sponsor files manually) OR dispatch Nora with the create_task tool to file. Sponsor decision on next dispatch round.

**Foundation:** Felix's PR #49 peer-review comment https://github.com/TSandvaer/ClaudeTeam/pull/49#issuecomment-4530651689 (APPROVE_WITH_NITS) — 1 NIT enumerated with file:line ref, mechanical scope. Promoted auto-decide class "NITs-ticket-creation from APPROVE_WITH_NITS comments when scope is mechanical" triggered + decision-log entry `2026-05-25 0030 UTC`. PR #49 already merged (`gh pr merge 49 --admin --squash --delete-branch`); main tip `196f224`.

**Body to file** (when sponsor/Nora has MCP):

```
**Ticket:** `chore(retro): PR #49 NIT follow-up — M3-close retro test-count off-by-one`
**Owner:** Nora (retro author) OR Maya (XS doc-touchup, can bundle if dispatched on similar XS work)
**Peer reviewer:** Felix (already reviewed PR #49 with the NIT)
**Size:** XS (single-line doc edit)
**Priority:** P3
**Source:** Felix peer-review on PR #49 https://github.com/TSandvaer/ClaudeTeam/pull/49#issuecomment-4530651689
**Source PR / SHA:** PR #49 merged at main tip `196f224`; retro doc `.claude/retros/retro-2026-05-25-m3-close.md` line 9.

**Scope:**
- Retro line 9 claims `354 unit + 68 integration + 23 Layer-3 = 445`.
- CI run `26376835294` (parent commit `9fb6444`, ran 2026-05-25T00:17:41Z) reports `353 passed + 3 skipped (356)` unit, not 354 passed.
- True passing total is 444, not 445.

**Acceptance criteria:**
- AC1: Retro line 9 updated to either `353 passed unit (+3 known skips)` or `353 passing unit (356 total) + 68 integration + 23 Layer-3 = 444 passing`.
- AC2: CI run ID cited inline for verifiability.
- AC3: No other retro content changes (no scope creep).

**Out of scope:**
- Re-running CI to validate counts (already validated by Felix in review).
- Editing milestone narrative — the off-by-one is cosmetic, milestone story unchanged.

**Done-when test:** retro line 9 matches CI run `26376835294` unit-pass count. No new CI required (doc-only).

**Webview-smoke / extension-manifest gate:** NO — doc-only.

**Files in play:**
- Owned: `.claude/retros/retro-2026-05-25-m3-close.md` (line 9 only)
- Read-only: CI run `26376835294` (already validated by Felix).
```

Create with: `list_id=901523520912`, `status=to do`, `name="test(m3): Layer-3 expansion — YAML hot-reload + window-filter + roster-error chip (M3-09)"`, `markdown_description=` the body above. After creation, substitute the placeholder `M3-09` in the ENTRY line above with the assigned ClickUp ID.

## NEW-TICKET-REQUEST — never-fabricate rule propagation (PENDING)

**Status:** queued — Felix's sub-agent runtime lacks `mcp__clickup__clickup_create_task` (documented sub-agent MCP gap per `.claude/docs/orchestration-overview.md § ClickUp as hard gate`). Orchestrator creates the ticket, then flushes `to do → in progress → in review` to mirror this PR's lifecycle.

**Foundation:** dispatch brief 2026-05-25 `chore(orch): propagate "Never fabricate" rule to sub-agents via project CLAUDE.md + dispatch-template`. Source: user-global `~/.claude/CLAUDE.md` "Never fabricate, never guess, never extrapolate" rule + memory `[[never-fabricate-propagation-and-handling]]` Part 1.

**Body to file** (when orchestrator creates):

```
**Ticket:** `chore(orch): propagate never-fabricate rule to sub-agents + dispatch-template`
**Owner:** Felix
**Peer reviewer:** Maya
**Size:** XS (docs-only)
**Priority:** P1
**Source:** user-global `~/.claude/CLAUDE.md` "Never fabricate, never guess, never extrapolate" rule + memory `[[never-fabricate-propagation-and-handling]]` Part 1. Sub-agents do not inherit user-global CLAUDE.md; rule must land in project-level surfaces.

**Scope:**
- Add rule 10 "Never fabricate, never guess, never extrapolate" under project `CLAUDE.md` § Hard rules (≤30 lines).
- Add `## Anti-fabrication contract` section to `.claude/agents/dispatch-template.md` enumerating sourcing commands (gh / git / grep / mcp__clickup).
- Add inheritance pointer at bottom of pre-dispatch checklist so orchestrators don't paste fabrication language inline.

**Acceptance criteria:**
- AC1: `CLAUDE.md` Hard rules contains rule 10 titled "Never fabricate, never guess, never extrapolate" (≤30 lines, observed 11 lines body).
- AC2: `.claude/agents/dispatch-template.md` contains `## Anti-fabrication contract` section with sourcing commands.
- AC3: PR body cites user-global `~/.claude/CLAUDE.md` rule (by name) + memory `[[never-fabricate-propagation-and-handling]]` Part 1.
- AC4: `npm run typecheck` green (sanity check; docs-only edits).
- AC5: ClickUp ticket created in list `901523520912`, flipped `to do → in progress → in review`.

**Out of scope:**
- Editing user-global `~/.claude/CLAUDE.md`.
- Per-persona agent files (`.claude/agents/{nora,maya,...}.md`).
- New tests.
- `.claude/docs/orchestration-overview.md` edits.

**Done-when test:** `grep -n "Never fabricate" CLAUDE.md` returns the rule 10 line; `grep -n "Anti-fabrication contract" .claude/agents/dispatch-template.md` returns the section header.
```

Create with: `list_id=901523520912`, `status=to do` (then immediately flip to `in progress` to reflect Felix accepted dispatch, then `in review` once PR opens), `name="chore(orch): propagate never-fabricate rule to sub-agents + dispatch-template"`, `markdown_description=` the body above.

```
ENTRY-2026-05-25T08:15:00Z: <placeholder-never-fabricate-ticket> -> in review (PR opened — never-fabricate rule propagation; substitute placeholder with assigned ClickUp ID after orch creates)
ENTRY-2026-05-25T09:00:00Z: 86c9ygcmj -> in progress (M4-06 dispatch — Nora retro authoring at branch `nora/86c9ygcmj-m4-close-retro`)
ENTRY-2026-05-25T09:00:01Z: 86c9ygcmj -> in review (M4-06 PR opened — V1 close retro + cross-arc retrospective)
ENTRY-2026-05-25T11:15:00Z: 86c9yjy4w -> in progress (M4-04 follow-up dispatch — Felix authoring extension-host heap-probe procedure addendum)
ENTRY-2026-05-25T11:30:00Z: 86c9yjy4w -> in review (PR opened — extension-host heap-probe procedure addendum; procedure-only Path C, no production code change)
ENTRY-2026-05-26T00:00:00Z: 86c9yteju -> in review (Bram PR opened — dogfood triage; 6 observations classified; 3 defect follow-up tickets drafted)
ENTRY-2026-05-26T06:44:00Z: 86c9yxvah -> in review (Maya PR opened — Defect 6b fix: collapsed-group state-dot with worst-case-live-instance priority; 33 unit tests green incl. ACs 2/3/4)
ENTRY-2026-05-26T08:55:00Z: 86c9yxv94 -> in review (Felix PR opened — fix(reducer): FinishedMap with finishedAtMs + "finished Xs" suffix per Obs 6a; 397 unit + 71 integration green; live CLI smoke confirms elapsed-time on rostered tiles)
ENTRY-2026-05-26T09:40:30Z: 86c9ytyq7 -> in review (Maya PR opened — M5-WV hide-finished header chip; new `src/webview/components/headerChip.ts` + render.ts mount at position 3 in BOTH empty + with-sessions branches + dashboard.css `.ct-header-chip` block + 21 jsdom tests; 429 unit tests green, typecheck clean, build clean; vocabulary contract preserved — no touches to `src/shared/messages.ts` / `src/shared/types.ts` / `package.json` / `src/extension/**`)
ENTRY-2026-05-26T14:00:00Z: 86c9z5hyp -> in progress (Felix accepted dispatch — Obs 3 host-side force-refresh fix; Option A — add `forceRefresh()` to WatcherHandle that clears `priorStateHash` before tick to defeat the boot-time hash-skip race)
ENTRY-2026-05-26T14:05:00Z: 86c9z5hyp -> in review (Felix PR opened — fix(ext): forceRefresh bypass; +`forceRefresh()` on WatcherHandle, `onRefresh` calls it instead of `triggerTick`; 3 new integration tests in `tests/integration/watcherHandle.test.ts` covering AC5 force-bypass / AC6 steady-state hash-skip retained / dispose no-op; 456 unit + 77 integration green; typecheck clean; vsce package clean)
ENTRY-2026-05-26T14:40:00Z: 86c9z4p86 -> in progress (Felix accepted dispatch — PR #74 NITs follow-up; single-pass scan + HEREDOC fixtures + cites footer 2-line)
ENTRY-2026-05-26T14:50:00Z: 86c9z4p86 -> in review (Felix PR #79 opened — chore(hooks): PR #74 NITs; 3 NITs applied; 11/11 hook tests PASS; 464 unit + 2 skipped green; typecheck clean; vsce package clean LICENSE warn separate ticket 86c9z7ahe)
```

## NEW-TICKET-REQUEST — In-extension-host heap snapshot probe (M4-04 follow-up; Felix-recommended, Maya-endorsed NIT-class)

**Status:** queued — Nora sub-agent runtime lacks `mcp__clickup__clickup_create_task` (documented sub-agent MCP gap per `.claude/docs/orchestration-overview.md § ClickUp as hard gate`). Orchestrator creates the ticket post-M4-06 merge.

**Foundation:** M4-04 PR #59 body § "Decisions" + Maya peer-review verdict APPROVE explicitly recommends an in-extension-host heap probe to confirm/refute the +4.6 MB / 10 min tsx-harness delta. Maya endorsed as NIT-class (not blocking M4-04 merge). Promoted auto-decide class rule 6.6 #5 (NITs-ticket-creation from APPROVE comment when scope is mechanical) applies.

**Body to file** (when orchestrator creates):

```
**Ticket:** `chore(ext): in-extension-host heap snapshot probe (M4-04 follow-up)`
**Owner:** Felix
**Peer reviewer:** Maya
**Size:** S (≤ 1 day; measurement + doc only, no production code changes expected)
**Priority:** P3 (NIT-class — M4-04 shipped with "Plausibly clean — follow-up needed" verdict; this confirms or refutes)
**Source:** M4-04 PR #59 body § Decisions + § Memory posture + Maya peer-review verdict (APPROVE)
**Source PR / SHA:** PR #59 merged at `d9b1b49`; methodology doc `team/felix-dev/m4-04-cadence-measurement.md` § Memory posture

**Scope:**

Replicate the M4-04 memory probe under VS Code extension-host runtime (not tsx). Methodology:

1. Install the production `.vsix` in a fresh VS Code window with `~/.claude/` populated (3+ live sessions ideal).
2. Open `Developer: Open Process Explorer`; identify the extension-host process.
3. Capture a heap snapshot at t=0; let the watcher run for 60 min under realistic load; capture a heap snapshot at t=60min.
4. Compare the two snapshots; identify any monotonic growth attributable to the watcher/reducer/webview code path.
5. Compare against the tsx-harness +4.6 MB / 10 min slope: confirm (production has similar slope = real leak) or refute (production is flat = tsx-runtime artifact).

**Acceptance criteria:**
- AC1: Heap-snapshot probe ran for ≥60 min under realistic multi-session load.
- AC2: Two snapshots captured + diffed via Chrome DevTools (or VS Code's Process Explorer equivalent).
- AC3: Verdict documented in `team/felix-dev/m4-04-heap-probe.md` (new) OR appended to existing `m4-04-cadence-measurement.md` § Memory posture.
- AC4: If a real leak is confirmed, follow-up implementation ticket filed with file:line scoping.
- AC5: If refuted, methodology doc updated to mark "memory posture: clean" with the run evidence.

**Out of scope:**
- Implementing any leak fix (this ticket is measurement-only; fix lands as a separate follow-up if AC4 fires).
- Changing the tsx harness (M4-04's harness stays as-is; this is a separate runtime).
- Long-duration probes beyond ~60 min unless evidence motivates.

**Done-when test:** verdict documented; if leak confirmed, fix ticket exists; if refuted, methodology doc marks the posture clean.

**Webview-smoke / extension-manifest gate:** NO — measurement-only.

**Files in play:**
- Owned: `team/felix-dev/m4-04-heap-probe.md` (new) OR extension of `team/felix-dev/m4-04-cadence-measurement.md` § Memory posture.
- Read-only: production `.vsix`, `~/.claude/` live data, M4-04 methodology doc.
```

Create with: `list_id=901523520912`, `status=to do`, `name="chore(ext): in-extension-host heap snapshot probe (M4-04 follow-up)"`, `markdown_description=` the body above.

```
ENTRY-2026-05-26T15:34:00Z: 86c9zbuqq -> in progress (Bram accepted dispatch — Obs 9 init-phase invisibility triage)
ENTRY-2026-05-26T15:34:01Z: 86c9zbuqq -> in review (Bram PR opened — research(obs9): init-phase invisibility root cause identified — background-dispatch acknowledgment misread as finished signal)
ENTRY-2026-05-26T16:30:00Z: 86c9zfbpg -> in progress (Bram accepted dispatch — obs-roster-count chip triage)
ENTRY-2026-05-26T16:30:01Z: 86c9zfbpg -> in review (Bram PR opened — research(obs-roster-count): chip label is by-design, not a bug)
ENTRY-2026-05-26T22:45:00Z: 86c9zfmh1 -> in review (Maya PR opened — fix(webview): preserve collapsed-group expansion state across re-renders — Obs 10)
ENTRY-2026-05-26T21:09:31Z: 86c9zfrzt -> in progress (Felix accepted dispatch — Obs 8 NITs follow-up: stale comment + M5 spec resync)
ENTRY-2026-05-26T21:11:30Z: 86c9zfrzt -> in review (Felix PR opened — chore(docs): Obs 8 NITs follow-up — stale comment + M5 spec resync)
ENTRY-2026-05-27T05:54:00Z: 86c9zmp5g -> in progress (Felix accepted dispatch — Obs 13 IMPL: stop_reason=end_turn → SubagentActivity.isFinished → finished state)
ENTRY-2026-05-27T08:09:00Z: 86c9zmp5g -> in review (Felix PR #90 opened — fix(watcher): Obs 13 IMPL — stop_reason=end_turn → SubagentActivity.isFinished → finished state)
ENTRY-2026-05-27T06:45:00Z: 86c9zn7vw -> in progress (Felix accepted dispatch — diagnostic output channel: verbose per-tick state-delta logging)
ENTRY-2026-05-27T08:58:00Z: 86c9zmqa8 -> in progress (Maya accepted dispatch — uniform-cluster polish impl per Iris spec Option A+B+A.1)
ENTRY-2026-05-27T09:00:00Z: 86c9zmqa8 -> in review (Maya PR #93 opened — polish(webview): auto-collapse uniform clusters + compact rows + status hint)
ENTRY-2026-05-27T09:20:00Z: 86c9zfj2g -> in progress (Maya accepted dispatch — chip-label rename `rostered` → `visible` per sponsor decision)
ENTRY-2026-05-27T09:25:00Z: 86c9zfj2g -> in review (Maya PR #94 opened — polish(webview): chip label clarity rename `rostered` → `visible`)
```
ENTRY-2026-05-26T23:00:00Z: 86c9zfmhp -> in progress (Maya accepted dispatch — fix(webview): humanize finished elapsed-time format (Obs 11))
ENTRY-2026-05-26T23:10:00Z: 86c9zfmhp -> in review (Maya PR #88 opened — fix(webview): humanize finished elapsed-time format (Obs 11) — sponsor approval requested on format choice)
ENTRY 2026-05-27T1430-iris-86c9zmyef-todo-to-inprogress: 86c9zmyef -> in progress
ENTRY 2026-05-27T1445-iris-86c9zmyef-inprogress-to-inreview: 86c9zmyef -> in review (PR opening)
ENTRY-2026-05-27T10:00:00Z: 86c9zn7tm -> in progress (Maya accepted dispatch — diagnostic panel: interactive companion to Output channel)
ENTRY-2026-05-27T10:25:00Z: 86c9zn7tm -> in review (Maya PR opened — feat(ext): diagnostic webview panel — tick history + current state breakdown)
ENTRY-2026-05-27T15:48:00Z: 86ca03ym7 -> in progress (Maya accepted dispatch — hide tool: row entirely when no current tool)
ENTRY-2026-05-27T15:58:00Z: 86ca03ym7 -> in review (Maya PR #106 opened — fix(webview): hide tool: row when no current tool — Self-Test Report posted)
ENTRY-2026-05-29T00:00:00Z: 86ca19uk1 -> in progress (Maya accepted dispatch — E-05 baseline/available state skin per whole-team-display-spec §1)
ENTRY-2026-05-29T00:30:00Z: 86ca19uk1 -> in review (Maya PR opened — feat(webview): skin the available/never-run baseline state (E-05) — Self-Test Report posted)
ENTRY-2026-05-29T14:30:00Z: 86ca1ej5c -> in progress (Maya accepted dispatch — Phase 2b webview multi-agent persona tile, ×N badge + inline expand)
ENTRY-2026-05-29T14:45:00Z: 86ca1ej5c -> in review (Maya PR #125 opened — feat(webview): MultiAgentPersonaTile renderer — Self-Test Report posted)
ENTRY-2026-05-29T12:00:00Z: 86ca1agc5 -> in progress (Maya accepted dispatch — E-07b remove-agent webview: per-tile Remove affordance + confirm-step + removed-mask on show-hidden + 6-member gender sprite binding)
ENTRY-2026-05-29T12:30:00Z: 86ca1agc5 -> in review (Maya PR opened — feat(webview): remove-agent affordance + confirm-step + removed-from-show-hidden mask + 6-member sprite binding (E-07b))
NEW-TICKET-REQUEST-2026-05-29T12:25:00Z: CREATE child of epic 86ca11187 in list 901523520912, name "test(qa): whole-team-always-visible epic — test plan + QA pass" (E-09); on create, flip to do -> in progress -> in review (Sage PR opened — E-09 test plan + no-auto-cull pipeline guard). Sub-agent has no ClickUp MCP access; orchestrator must create + record the new ticket ID. Sage PR body references this request line for the ID backfill. [RESOLVED 2026-05-29: orchestrator created 86ca1c1az at status "in review"; ID backfilled to PR #121.]
ENTRY-2026-05-29T15:00:00Z: 86ca1d7er -> in progress (Iris accepted dispatch — multi-agent persona-tile spec; rostered member with N≥2 live agents ALWAYS renders ONE persona tile + ×N badge + expand; branch iris/86ca1d7er-multiagent-persona-tile-spec)
ENTRY-2026-05-29T15:01:00Z: 86ca1d7er -> in review (Iris PR opened — spec(webview): multi-agent persona-tile — single tile + ×N badge + expand for rostered N≥2; aggregate-state rule; host/webview decomposition; supersedes M3-10 CollapsedPersonaGroup for rostered members)
NEW-TICKET-REQUEST-2026-05-29T14:50:00Z: CREATE child of parent 86ca1d7er in list 901523520912, name "test(qa): multi-agent persona tile — QA sweep + error-collapsed regression"; on create, flip to do -> in progress -> in review (Sage PR opened — QA sweep of host PR #124 + webview PR #125 multi-agent persona tile feature; adds Felix NIT 1 error-aggregate-stays-collapsed regression + bug-class no-auto-expand coverage). Sub-agent has no ClickUp MCP access; orchestrator must create + record the new ticket ID. Sage PR body references this request line for the ID backfill. This QA closes parent 86ca1d7er on merge.
ENTRY-2026-05-29T15:15:00Z: 86ca1fjqu -> in progress (Maya accepted dispatch — fix(webview): overflow "..." menu — add menu to multi-agent ×N tiles (BUG 1) + persist menu-open across poll re-render (BUG 2))
ENTRY-2026-05-29T15:30:00Z: 86ca1fjqu -> in review (Maya PR opened — fix(webview): overflow menu on multi-agent tiles + menu-open survives poll re-render via MenuOpenTracker — Self-Test Report posted)
