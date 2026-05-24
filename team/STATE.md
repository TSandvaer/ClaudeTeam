# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-24 1746 UTC (M3 Wave 0 SHIPPED; Felix dispatched on `86c9ybrk0` P2 DEAD-bleed fix; auto-status AWAY re-engaged)

**This header is the live "what's going on right now" entry. Per-role sections further down are append-only history. Read this header first on resume.**

- **`origin/main` tip:** `f6af8c5` (chore(orch): parallel-orch-race failure mode + M3-10 NEW-TICKET-REQUEST + 86c9ybrk0 dispatch flip — orch-direct push this tick). Previous shippable PR was `9c0572c` (PR #40 — M3-01-NITs cleanup, Felix). Verify: `git rev-parse origin/main`.
- **M3 Wave 0 SHIPPED end-to-end** (prior session — 6 PRs merged to main): M3-01 hot-reload (PR #35, `a74cb94`), M3-02 openRoster command (PR #37, `d0225aa`), M3-03 window-scoped session filtering (PR #38, `1bc422c`), M3-04 webview chip + filtered-empty + open-roster button (PR #39, `b22de25`), M3-01-NITs cleanup (PR #40, `9c0572c`), plus M3-06 dispatch-template update (PR #36, `cd3553c`). Sponsor's M3 scope-correction directive ("show only sessions from this VS Code window") addressed via M3-03 default-on window-scoping with `claudeteam.showAllSessionsGlobally` opt-out.
- **Test counts:** 262 unit (+2 pre-existing skips) + 68 integration green on main as of PR #40 merge.
- **Open PRs:** none.
- **In-flight agents:** **Felix** on `86c9ybrk0` (M3-03 DEAD-session bleed fix — P2 follow-up filed last session, sponsor-verified via screenshot), agentId `a00029c1b2e467da9`, dispatched 2026-05-24T17:46Z background-mode, branch `felix/86c9ybrk0-dead-session-bleed-fix` (TBD on first push). Maya idle (will review Felix's PR when opened). Nora, Iris, Sage, Bram idle.
- **Queued for sponsor (non-blocking):**
  - **M3-10 ticket creation** — sponsor authorized `File M3-10 ticket now (P3)` at session resume; heuristic chosen = `group by roster persona-name, show 'Felix ×3' with expandable list`. Orchestrator's ClickUp MCP did not connect this session, so NEW-TICKET-REQUEST block added to `team/log/clickup-pending.md` for next session with live MCP. Sponsor can also file manually using the body block already drafted there.
  - **M3-04 NITs (`86c9ybtut`) split-preference** noted for Wave 1 dispatch: Felix host (NIT #1 model:? fallback + NIT #2 error format), Maya webview (NIT #3 finished timestamp). Sponsor's explicit "Split per surface" answer overrides "bundle" recommendation.
  - **M3 close + retro timing:** deferred until all Wave 1 work (NITs + chores M3-07/08/09) ships, per sponsor's explicit answer.
- **Sponsor-held tickets (no action):** `86c9y7y9z` (M2-04 NITs) — standing "leave at to do" call, do NOT auto-close.
- **Auto-status:** AWAY re-engaged 2026-05-24T17:45Z, this-session cron `dfc3430f` (`7,22,37,52 * * * *`). State file `enabled=true, mode=away, interval=15m, last_tick=2026-05-24T17:45:00Z`.
- **Working tree:** clean of code modifications. 4 untracked Maya scratch files at `team/maya-dev/pr-*.md` (sub-agent review-body drafts from prior PRs; NOT coord state — leave untracked or sponsor moves to `.scratch/` at later call).
- **New documented failure mode this session:** parallel-orchestrator race condition (two Claude Code sessions on same project). Documented in `.claude/docs/orchestration-overview.md` § Common failure modes + full entry in `team/log/process-incidents.md`. Prevention: only ONE Claude Code session should orchestrate a given project at a time; kill the other's auto-status via `/auto-status off` first.
- **CLAUDE.md global rule #8 added** (prior session, sponsor-authorized): tickets/bugs/postmortems must cite sources for concrete values; speculative claims labeled `Hypothesis:` / `Likely:` / `Predicted:`. Triggered by ticket `86c9ybrk0` fabrication incident (now corrected via audit-trail comment).

**ClickUp board state:**
- **Complete (M3 Wave 0):** `86c9yaq1e` (M3-01), `86c9yb473` (M3-02), `86c9yb59k` (M3-03), `86c9ybdxe` (M3-04), `86c9yb0yg` (M3-01-NITs).
- **In progress:** `86c9ybrk0` (M3-03 DEAD-bleed fix, Felix) — orch-side flip queued via clickup-pending.md (MCP unavailable).
- **To do (open follow-ups):** `86c9ybtut` (M3-04 NITs split, P3); `86c9y7y9z` (M2-04 NITs, sponsor-held).
- **To do (pending creation):** M3-10 persona-tile-collapse (P3, sponsor-authorized, NEW-TICKET-REQUEST queued).

**Wave 1 remaining (per Nora's backlog):**
- **`86c9ybrk0`** — DEAD-bleed fix (Felix, in-flight this tick).
- **`86c9ybtut`** — M3-04 NITs (Felix host + Maya webview split, 2 PRs).
- **M3-07** — `docs(testing): install-path validation discipline at first-shipping PR` (Nora orch-direct, S, P1).
- **M3-08** — `docs(orch): main-thread merge-narration tightening` (Nora orch-direct, S, P2).
- **M3-09** — Sage Layer-3 expansion absorbing Sage's PR-#39 coverage-gap NITs.
- **M3-10** — persona-tile-collapse (post ticket-creation, Felix reducer + Maya webview).

**This-session structural delta (newest at top):**

| Commit | Subject |
|---|---|
| `f6af8c5` | chore(orch): parallel-orch-race failure mode + M3-10 NEW-TICKET-REQUEST + 86c9ybrk0 dispatch flip (this tick) |
| `9c0572c` | chore(m3-01-nits): clamp-vs-description alignment + PR-claim discipline note (#40) |
| `b22de25` | feat(webview): roster-error chip + filtered-empty state + open-roster button (M3-04) (#39) |
| `8887c4b` | chore(orch): clickup-pending.md cleanup — substitute M3-02/03 placeholders + remove fulfilled NEW-TICKET-REQUEST blocks |
| `1bc422c` | feat(host): window-scoped session filtering (M3-03) (#38) |
| `d0225aa` | feat(roster): claudeteam.openRoster command + auto-create starter YAML (#37) |
| `d702826` | chore(orch): STATE — M3-01 NITs ticket 86c9yb0yg created, queue cleared |

**M2 fully closed (unchanged):** all 12 PRs merged + P0 CJS shim + retro PR #31. Production .vsix activates on Node 22+.

**M1 status: SHIPPED 2026-05-23.** 11/11 tickets + M1-09-followup. Retro at [.claude/retros/retro-2026-05-23-m1-close.md](.claude/retros/retro-2026-05-23-m1-close.md).

---

## Worktree state — 2026-05-23

| Worktree | At commit | Branch state | Notes |
|---|---|---|---|
| `c:\Trunk\PRIVATE\ClaudeTeam` | `57c78a7` | `main` | Orchestrator survey — READ-ONLY for code |
| `c:\Trunk\PRIVATE\ClaudeTeam-bram-wt` | `7f79ba6` | detached | Was on `bram/m1-11-data-sources-update` |
| `c:\Trunk\PRIVATE\ClaudeTeam-felix-wt` | `b19c5bf` | detached | Was on `felix/m1-07-sessions-registry` |
| `c:\Trunk\PRIVATE\ClaudeTeam-iris-wt` | `53f5269` | detached | — |
| `c:\Trunk\PRIVATE\ClaudeTeam-maya-wt` | `b19c5bf` | detached | — |
| `c:\Trunk\PRIVATE\ClaudeTeam-nora-wt` | `ed64350` | detached | — |
| `c:\Trunk\PRIVATE\ClaudeTeam-sage-wt` | `8fc667c` | detached | — |

Felix's dispatch on M1-09 will start with `git -C <felix-wt> fetch origin && git checkout -B felix/m1-09-cli-driver origin/main` — standard Step 0.

---

## ClickUp ticket map (M1) — 2026-05-23

| Ticket | ClickUp ID | Status | Owner | Reviewer |
|---|---|---|---|---|
| M1-01 | `86c9y5c4g` | complete | Felix | Maya |
| M1-02 | `86c9y5c7v` | complete | Bram | orch |
| M1-03 | `86c9y5c8m` | complete | Iris | Felix |
| M1-04 | `86c9y5ca3` | complete | Sage | Felix |
| M1-05 | `86c9y5cah` | complete | Felix | Maya |
| M1-06 | `86c9y5ccb` | complete | Felix | Maya |
| M1-07 | `86c9y5ccn` | complete | Felix | Maya |
| M1-08 | `86c9y5cfe` | complete | Felix | Maya |
| **M1-09** | `86c9y5chc` | **to do** | Felix | Maya |
| **M1-10** | `86c9y5cmg` | **to do** | Sage | Felix |
| M1-11 | `86c9y5q8d` | complete | Bram | orch |

---

## Per-role sections (append-only history below)

### Nora (Project Lead)

- Last updated: 2026-05-24 (M2-close retro authored)
- Status: idle (M2-close retro shipped)
- Working on: nothing in flight
- Blocked on: nothing — M3 backlog authoring is the next likely dispatch

**Run log of substantive coordination-doc PRs (newest at top):**

#### 2026-05-24 — M2-close retro authored

- Retro: `.claude/retros/retro-2026-05-24-m2-close.md` (~3100 words; comparable to M1 retro depth, slightly longer to cover 12 merged PRs + 10 auto-decisions)
- Surfaced 10/10 auto-decide / 0-reversal calibration finding → recommendation to promote more rule 6.6 classes (NITs-ticket-creation, log-only-conflict recovery, NITs-absorption-into-downstream)
- Surfaced chain-of-deferred-validations anti-pattern (M2-01 placeholder-screenshot deferral → M2-06 sub-agent-GUI deferral → CJS shim bug only caught at M2-08 Layer-3 in PR #29)
- 8 next-session backlog items filed (M3 scope confirm, auto-decide promotion draft, ENTRY-NNN collision prevention, cross-project port of GUI-gap + permission-rule, test-plan executor mapping discipline, install-path validation at first-shipping PR, main-thread merge-narration tightening, M3 Layer-3 expansion)
- Branch: `nora/m2-close-retro`

#### 2026-05-23 — M1 backlog created

- Project plan: `team/nora-pl/project-plan.md`
- M1 backlog: `team/nora-pl/milestone-1-backlog.md` (10 tickets, dispatch-ready)
- Risk register: `team/nora-pl/risk-register.md` (5 entries, all `held`)
- ClickUp tickets created in list `901523520912` (IDs appended once created)
- Open questions surfaced for sponsor: (1) CLI output ownership; (2) fixture sourcing / anonymization scope
- Branch: `nora/v1-planning-kickoff`
- Recommended first wave: M1-01 (Felix), M1-02 (Bram), M1-03 (Iris) — all zero-dep, fired in parallel.

### Iris (UX Designer)

- Last updated: 2026-05-23 (M1-03 merged in PR #3, commit `7487ccb`)
- Status: idle (M1-03 CLI output spec shipped; M2/M3 design work blocked on M1-09)
- Working on: nothing in flight
- Blocked on: nothing — M2 dashboard tile spec is the next likely dispatch

### Felix (Senior Dev — extension host)

- Last updated: 2026-05-23 (M1-07 merged in PR #13, commit `dbab662`)
- Status: idle pre-M1-09; **next dispatch target**
- Working on: nothing in flight; M1-09 is the next dispatch
- Blocked on: nothing — all M1-09 dependencies (M1-05/06/07/08) merged

### Maya (Senior Dev — webview)

- Last updated: 2026-05-23 (most recent activity: peer-reviewing PR #12 + PR #13)
- Status: idle; reviewer for M1-09 when Felix opens that PR
- Working on: nothing in flight
- Blocked on: nothing — M1-09 review when PR opens; no M1 primary work for Maya

### Sage (QA / Tester)

- Last updated: 2026-05-23 (M1-04 merged in PR #7, commit `8d5246a`)
- Status: idle pre-M1-10
- Working on: nothing in flight
- Blocked on: M1-09 merge — M1-10 integration tests depend on M1-09's reducer being available

### Bram (Research / Internals)

- Last updated: 2026-05-23 (M1-11 merged in PR #9, commit `81bef17`)
- Status: idle
- Working on: nothing in flight
- Blocked on: nothing — no pending research asks for M1; M2 research may surface VS Code Extension API prior-art needs
