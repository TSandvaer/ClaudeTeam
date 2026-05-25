# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-25 (M4 OPEN — Nora authoring backlog + Felix on detach-codification in parallel)

**Resume next-action:** If this session dies right now, next orchestrator should: (a) check **Nora's agent `a81f32acd9eb40daa`** via `TaskOutput` — dispatched ~2026-05-25T06:30Z on M4 backlog at `team/nora-pl/milestone-4-backlog.md` (branch `nora/m4-backlog` in `ClaudeTeam-nora-wt`), expected-by ~2026-05-25T06:45Z; (b) check **Felix's agent `a33fd3a08c266a7c4`** via `TaskOutput` — dispatched same tick on ticket `86c9yfj6n` (dispatch-template detach codification, branch `felix/86c9yfj6n-detach-codification` in `ClaudeTeam-felix-wt`), expected-by ~2026-05-25T06:45Z; (c) after Nora backlog PR opens, orchestrator reviews + merges + creates ClickUp tickets M4-01..M4-06 via `mcp__clickup__create_task`; (d) after M4-01 ticket exists, dispatch Iris for design specs (Iris LEADS per sponsor's AskUserQuestion answer); (e) after Felix dispatch-template PR opens + Maya APPROVE + admin-merge, orch updates user-scope memory `[[reviewer-detach-after-pr-checkout]]` "Process gap (open)" line → CLOSED with PR SHA cite. Auto-status AWAY cron `4,19,34,49 * * * *` (job `1c16d790`) armed.

**Sponsor's M4 scope decisions (settled via AskUserQuestion 2026-05-25T06:25Z):**
- All four V1-PLAN M4 areas: styling, drill-in, status states, refresh-cadence tuning.
- Marketplace publication DEFERRED post-V1.
- Iris LEADS — design specs before any dev dispatch (for styling + status-states; M4-03 drill-in + M4-04 cadence don't need Iris).
- `86c9yfj6n` dispatch-template detach codification ships alongside M4 (in flight now).

- **`origin/main` tip:** `37d2c98` (PR #51 squash-merge — Nora retro test-count fix `86c9yfj5e`). Verify: `git rev-parse origin/main`.
- **M3 fully shipped** — Wave 0 + Wave 1 + retro (PR #49) + all in-scope NITs (PR #50) + retro test-count fix (PR #51). Tests on main: **353 passing unit (+3 known skips, 356 total) + 68 integration + 23 Layer-3 = 444 passing** (M3 net delta +166 passing per Nora's verified count).
- **6 global orchestrator-discipline rules now active in `~/.claude/CLAUDE.md`** (was 5; +1 added this round): wake-signal, background-agent staleness verification, **sub-agent worktree-concurrency** (NEW), cross-session continuity, main-thread bloat, parallel-agent shared-concept vocabulary. Audit trail at [team/log/applied/](team/log/applied/).
- **In-flight agents:**
  - **Nora `a81f32acd9eb40daa`** — M4 backlog authoring at `team/nora-pl/milestone-4-backlog.md`. Dispatched ~2026-05-25T06:30Z, expected-by ~2026-05-25T06:45Z. Worktree `c:\Trunk\PRIVATE\ClaudeTeam-nora-wt` on branch `nora/m4-backlog`. 6 tickets: M4-01 (Iris specs) through M4-06 (V1 close retro). Reviewer: orchestrator. Per staleness-verification rule: on cron tick / "Status" trigger, run `TaskOutput a81f32acd9eb40daa` + `git -C C:/Trunk/PRIVATE/ClaudeTeam-nora-wt log --oneline -5 origin/nora/m4-backlog` + `gh pr list --author "@me" --state open` BEFORE reporting.
  - **Felix `a33fd3a08c266a7c4`** — `86c9yfj6n` dispatch-template detach codification. XS-S doc-only. Dispatched ~2026-05-25T06:30Z, expected-by ~2026-05-25T06:45Z. Worktree `c:\Trunk\PRIVATE\ClaudeTeam-felix-wt` on branch `felix/86c9yfj6n-detach-codification`. Reviewer: Maya. Per staleness-verification rule: same ritual as Nora but `TaskOutput a33fd3a08c266a7c4`.
- **Queued (post-Nora-backlog-merge):** Orchestrator creates M4-01 through M4-06 ClickUp tickets via `mcp__clickup__create_task` (Nora drafts bodies in backlog, orch files via MCP per project pattern). Then dispatches Iris for M4-01 design specs first; M4-03 + M4-04 (drill-in + cadence) can dispatch in parallel since they're independent of Iris specs.
- **Open PRs:** none.
- **ClickUp board state:** ALL M3 + carryover tickets at `complete`:
  - `86c9yee3g` (PR #47 NITs) → complete (PR #50 merged).
  - `86c9y7y9z` (M2-04 NITs) → complete as **phantom** (M2-06 PR #28 absorbed both NITs; comment posted with file:line evidence).
  - `86c9yfj5e` (PR #49 retro typo) → complete (PR #51 merged).
- **Sponsor-pending now:** **M4 opening** — scope/sequence/tickets, plus optional dispatch authorization for `86c9yfj6n`.
- **Completed this session (newest first, abbreviated for older items):**
  - Auto-merge PR #51 — Nora retro test-count fix → main tip `37d2c98`. Decision-log entry `2026-05-25 0543 UTC`.
  - Phantom-close `86c9y7y9z` — Felix evidence (NIT #1 + #2 already on main since PR #28 `b8ada36`). Decision-log entry `2026-05-25 0540 UTC`.
  - Persisted **Sub-agent worktree-concurrency discipline** rule to `~/.claude/CLAUDE.md` (sponsor-direct). Decision-log entry `2026-05-25 0535 UTC`. Audit at `team/log/applied/applied-rule-worktree-concurrency-2026-05-25.md`.
  - Worktree-collision **near-miss recovery** (TaskStop'd duplicate Felix dispatch before Step 0). Triggered the new rule above.
  - Felix `ae0cfdc95d506d8af` — peer-review PR #51 → APPROVE (took 1.5 min).
  - Felix `a8cccc4405f9c1b84` — M2-04 NITs investigation → **NO-OP phantom** (both NITs already on main).
  - Nora `a0c2ffc8d18ab1000` — PR #49 retro typo fix → PR #51 opened (took 1.1 min).
  - ClickUp MCP reconnected mid-session, enabling: flip 86c9yee3g, create 86c9yfj5e + 86c9yfj6n, phantom-close 86c9y7y9z, flip 86c9yfj5e through workflow → complete.
  - Auto-merges PR #49 + PR #50 (Nora retro + Maya PR #47 NITs) — decision-log entries `0030 UTC` + `0045 UTC`. Peer-reviews Felix `ab48057bad3b13bf9` + `a8ea637ff05d77632` + `a8ea637ff05d77632` (retro APPROVE_WITH_NITS, PR #50 APPROVE). Authoring dispatches Nora `a404fd831f7036701` (retro) + Maya `a596cce4ec0eb3fdc` (PR #47 NITs).
- **NIT outstanding:** `86c9yee3g` (queued for Maya post-retro); `86c9y7y9z` (M2-04 NITs, sponsor-held — do NOT auto-close).
- **Auto-status:** sponsor invoked `/auto-status away` this turn — state file should reflect `enabled=true, mode=away` after skill execution.
- **Working tree (main):** clean of code. 5 untracked Maya scratch files at `team/maya-dev/pr-*-review*.md` — NOT coord state, leave or sponsor moves to `.scratch/` later.

**ClickUp board state:**
- **Complete:** all M3-01 through M3-10 main tickets + Wave 0 NIT follow-ups + `86c9ydz4k` (formatFreshness NIT, absorbed into PR #47).
- **To do (active):** `86c9yee3g` (Maya, queued post-retro).
- **To do (sponsor-held):** `86c9y7y9z` (M2-04 NITs, do NOT auto-close).

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

- Last updated: 2026-05-25 (M4 backlog authored)
- Status: in review (M4 backlog PR open)
- Working on: nothing in flight after PR open
- Blocked on: nothing — M4-01 Iris dispatch is the next likely orch action (per sponsor's "Iris first, then parallel dev wave" sequencing)

**Run log of substantive coordination-doc PRs (newest at top):**

#### 2026-05-25 — M4 backlog authored

- Backlog: `team/nora-pl/milestone-4-backlog.md` (6 tickets — M4-01 Iris spec / M4-02 Maya tokens / M4-03 Felix+Maya drill-in polish / M4-04 Felix cadence / M4-05 Maya status states / M4-06 Nora M4+V1-close retro)
- All six get ClickUp tickets (zero orch-direct chore class this milestone per sponsor scope)
- Wave plan: Iris solo Wave 0 → 4-agent (or 3-if-Maya-sequenced) Wave 1 → Nora retro Wave 2
- Out-of-M4 follow-ups documented at top: 4 outstanding NITs/sponsor-held tickets reassessed at M4-06, plus dispatch-template vocab block + STATE.md schema rollout + decisions-log batch from M3 retro
- Marketplace publication confirmed DEFERRED post-V1 per sponsor 2026-05-25; gets its own milestone
- Branch: `nora/m4-backlog`

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
