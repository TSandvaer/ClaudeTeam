# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-23 (M1 SHIPPED; M2 backlog + Bram prior-art ready; HOLDING for sponsor scope-overlap decision)

**This header is the live "what's going on right now" entry. Per-role sections further down are append-only history. Read this header first on resume.**

- **`origin/main` tip:** `697987e` (decisions log update — PR #18 auto-merge entry). Verify: `git rev-parse origin/main`.
- **M1 status: SHIPPED.** 11 / 11 tickets complete + M1-09-followup (`86c9y6e17`) merged. Retro at [.claude/retros/retro-2026-05-23-m1-close.md](.claude/retros/retro-2026-05-23-m1-close.md).
- **Test counts:** 127 unit + 31 integration = **158 tests green**. CI: 2x typecheck+lint+unit+integration COMPLETED+SUCCESS.
- **Open PRs:** none.
- **Open ClickUp tickets:** none. (M1-09-followup `86c9y6e17` merged in PR #18 at `c31ae02`; ticket flipped `complete`.)
- **Worktrees:** all detached post-merge.
- **In-flight agents:** none.
- **Auto-status:** AWAY (active orchestration tick every 15 min), cron job `f55a798f` (`7,22,37,52 * * * *`).

**Blocked on sponsor:** [.claude/away-queue.md](.claude/away-queue.md) "2026-05-23 1330 UTC — M2/M3 scope-overlap" — sponsor must pick Option A (absorb M3's roster-render into M2 — orchestrator's recommendation; backlog already written for it) vs Option B (keep V1-PLAN's hardcoded-strings-in-M2 separation). M2-04 (file-watcher) + M2-05 (message protocol) ClickUp ticket creation + dispatch holds pending this answer.

**Ready to dispatch on sponsor-greenlight (Wave 1, parallel):**
- M2-01 (Felix — extension manifest + activation events, P0)
- M2-03 (Iris — M2 dashboard tile spec inheriting M1-03 vocabulary, P0)
- M2-07 (Sage — M2 test plan + Layer-3 manual VS Code reload checklist, P0)
- M2-09 (Nora — dispatch-template tightening, P2)

After Wave 1 lands and CI green:
- Wave 2: M2-04 (Felix — file-watcher) + M2-05 (Maya — webview message protocol). Lanes diverge by Option A/B; sponsor scope-overlap answer determines which.

**Already done from M2 backlog:**
- M2-02 (Bram — VS Code Extension API prior-art): merged at `b0e858b`. Key recs landed: `WebviewViewProvider` Activity Bar surface, `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (1.64+), vanilla TypeScript (Pixel Agents' React build = 291 KB cautionary data point), lazy activation via `onView:claudeteam.dashboard`. Pixel Agents lesson: NO CSP — ClaudeTeam must NOT replicate.

**This session's structural delta vs save-session base (`dbab662`):**

| Commit | Subject |
|---|---|
| `57c78a7` | docs(orch): capture peer-reviewer-worktree-blocks-delete-branch failure mode (pre-bundle) |
| `007ce9a` | chore(orch): adopt bloat-prevention scaffolding from sibling projects (STATE/DECISIONS/process-incidents/retros) |
| `2ef2025` | feat(cli): reducer + agent-tree CLI driver (M1-09) |
| `29e98f2` | test(m1): integration tests against fixture filesystem (M1-10) |
| `f71fa09` | docs(orch): M1 close — retro + decisions log + STATE update |
| `cf6e8f9` | docs(planning): author M2 backlog — extension scaffold + webview milestone |
| `d68f3b2` | docs(orch): queue M2/M3 scope-overlap question for sponsor |
| `b0e858b` | research(vscode-api): M2 VS Code Extension API prior-art + webview tech pick (M2-02) |
| `c31ae02` | fix(reducer+cli): M1-09-followup NIT cleanup — AC1-7 (`86c9y6e17`) |
| `697987e` | docs(orch): log PR #18 auto-merge decision (M1-09-followup) |

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

- Last updated: 2026-05-23 (M1 backlog complete; pre-bloat-prevention-bundle this session)
- Status: idle (M1 backlog complete; M2 backlog not yet authored)
- Working on: nothing in flight
- Blocked on: nothing — M2 planning starts after M1-10 merges

**Run log of substantive coordination-doc PRs (newest at top):**

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
