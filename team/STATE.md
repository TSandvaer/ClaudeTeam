# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-24 (M2 SHIPPED — PR #28 merged at b8ada36; Wave 3 / M2-08 + M2-close retro queued)

**This header is the live "what's going on right now" entry. Per-role sections further down are append-only history. Read this header first on resume.**

- **`origin/main` tip:** `4a41634` (PR #30 merge — CJS shim production fix `86c9y9yzu`). Verify: `git rev-parse origin/main`. **M2 fully closed + production .vsix activation bug fixed.**
- **M2 Wave 0 status: SHIPPED.** PR #19/#20/#21/#22 (M2-09/03/07/01).
- **M2 Wave 1 status: SHIPPED.** PR #23 (Felix M2-04 file-watcher) `807c3c6`. PR #24 (Maya M2-05 webview renderer) `09f95d3`.
- **M2 Wave 1 NITs follow-ups status: SHIPPED.** PR #25 (Maya M2-05 NITs) `e97dc7a`. PR #26 (Felix M2-01 NITs) `caf78a7`. PR #27 (Iris M2-03 NITs) `fa05bf4`.
- **M2 Wave 2 status: SHIPPED.** PR #28 (Felix M2-06 + absorbed M2-04 NITs) merged at `b8ada36` after Maya APPROVE_WITH_NITS. Sponsor authorized merge with webview-smoke AC7(b-d) screenshots deferred as post-merge sponsor verification (sub-agent runtime can't drive interactive VS Code). Ticket `86c9y9q6h` → `complete`.
- **M2 Wave 3 status: SHIPPED.** PR #29 (Sage M2-08 Layer-3 tests) merged at `ec8977f` after Felix clean APPROVE. 14/14 Layer-3 tests green on CI Ubuntu via xvfb-run; existing layers all stay green (215 unit + 49 integration). Ticket `86c9y9v7r` → `complete`. **M2 milestone fully closed.**
- **P0 follow-up SHIPPED:** `86c9y9yzu` (CJS shim production fix) merged at `4a41634` after Maya clean APPROVE. Production .vsix activation bug fixed (Node 22+ ERR_REQUIRE_ESM resolved via `.cjs` bundle rename + `package.json main` field update). Comment posted on `86c9y9q6h` informing sponsor the M2-06 AC7(b-d) screenshots are unblocked.
- **M2-close retro:** **READY TO AUTHOR.** All M2 work complete + the post-M2 P0 follow-up shipped. Sponsor decides: dispatch Nora now to author `.claude/retros/retro-2026-05-24-m2-close.md`, or defer to next session.
- **Test counts:** ~181 unit + 41 integration = **~222 tests green** on main post-Wave-1-NITs (CI green on every push). Felix's M2-06 PR will add integration coverage.
- **Open PRs:** none yet — Felix's M2-06 PR forthcoming.
- **In-flight agents:** none — Maya posted APPROVE_WITH_NITS on PR #28 at 2026-05-24 ~08:24 UTC. AC7(a) live-runTick smoke verified through Maya's actual `~/.claude/` (real `claudeteam-alpha` team materialized). AC7(e) integration test passes (subscription leak). Both absorbed M2-04 NITs verified clean. 215 unit + 49 integration tests green. Worktree detached at `12ce4bf` — merge unblocked. **PR is mergeable on content; webview-smoke gate (AC7(b-d) screenshots) is the open question — see "Sponsor-pending" below.**
- **Sponsor-pending:** PR #28 webview-smoke gate. CLAUDE.md hard rule #3 requires "Maya (or the PR author) to post a Self-Test Report confirming a manual webview reload in VS Code worked end-to-end." Both Felix and Maya are sub-agents — no GUI runtime, can't drive `Install from VSIX → Reload Window → screenshot`. Maya's NIT #1 reframes AC7(b-d) as sponsor-side post-merge verification (AC7(a) already covered the data plane via live runTick smoke). Sponsor: merge now + screenshot post-merge, OR install+screenshot first then merge?
- **Permission-rule landed (2026-05-24):** `mcp__clickup__update_task` added to project `.claude/settings.json` allow array per sponsor's Option A on the away-queue entry. Resolves the recurring auto-mode-classifier denials on orchestrator status flips of pre-existing tickets.
- **Sponsor decision (2026-05-24 ~07:57 UTC):** Sponsor chose to **leave `86c9y7y9z` at `to do`** rather than flip to `complete` — comment-on-ticket explaining "scope absorbed into M2-06 (`86c9y9q6h`)" provides the audit trail; no PR will open against the ticket. Board carries one extra `to do` row as a side-effect but this is stable, not pending.
- **Worktrees:** Felix worktree active on M2-06 lane; Maya / Sage / Nora / Iris / Bram idle.
- **Auto-status:** AWAY, session cron `130f53a0` (`8,23,38,53 * * * *`), last_tick `2026-05-24T07:56:32Z` (this session start — re-armed after prior disable).

**ClickUp board state:**
- **Complete (Wave 0 + Wave 1 + 3 NITs follow-ups, 9 tickets):** `86c9y7jn9` (M2-09), `86c9y7jf4` (M2-03), `86c9y7jjd` (M2-07), `86c9y7jdz` (M2-01), `86c9y7uhz` (M2-04), `86c9y7uka` (M2-05), `86c9y7u44` (M2-03 NITs), `86c9y7yzf` (M2-05 NITs), `86c9y7u4p` (M2-01 NITs).
- **In progress (Wave 2, Felix):**
  - **`86c9y9q6h`** — M2-06 (host↔webview integration) + absorbed M2-04 NITs. M2 shippable gate.
- **To do — left open by sponsor decision (scope absorbed into `86c9y9q6h`):**
  - `86c9y7y9z` — M2-04 NITs follow-up. Sponsor chose 2026-05-24 to leave at `to do` rather than close-as-duplicate; comment on ticket records the absorption. No PR will open against it.
- **Not yet created:**
  - M2-08 (Sage Layer-3 tests) — Wave 3, post-M2-06.

**This-session structural delta (newest at top):**

| Commit | Subject |
|---|---|
| `8494e58` | feat(scaffold): VS Code extension manifest + build pipeline (M2-01) (#22) |
| `5c650b4` | test-plan(m2): M2 acceptance test plan + webview-smoke gate spec (M2-07) (#21) |
| `ddf302d` | chore(orch): ENTRY 016 + PR #20 auto-merge decision log |
| `e989eed` | spec(ux): M2 dashboard tile spec — webview layout + interaction (#20) |
| `7af93bd` | chore(orch): ENTRY 015 — 86c9y7jn9 -> complete (PR #19 merged) |
| `ccc05c4` | chore(docs): enumerate APPROVE_WITH_NITS verdict in dispatch-template (M2-09) (#19) |

**Wave 2 ready to dispatch — sponsor decision queued:**

**M2-06 is the M2 shippable gate.** Extension installs from `.vsix`, Activity Bar tiles render live data, drill-in works. Once M2-06 merges, M2 is shippable.

**Two ordering options (sponsor: pick one):**

- **Path X — NITs-first.** Dispatch Felix on the M2-04 NITs follow-up (`86c9y7y9z`) *first*, then M2-06 (Felix again). Rationale: NIT #2 (`SerializedStateFullMessage` typed union) eliminates the `as unknown as DashboardState` cast that M2-06 will rely on for the live-data wire. Cleaner contract going into M2-06. ~2 sequential PRs from Felix.
- **Path Y — M2-06-first.** Create M2-06 ticket now, dispatch Felix on M2-06 directly. Roll the M2-04 NIT #2 fix INTO the M2-06 PR (since M2-06 is the consumer that benefits). Roll the M2-04 NIT #1 (subscription leak) in too. Closes `86c9y7y9z` as duplicate-of-M2-06. ~1 PR from Felix, slightly larger.

Orchestrator recommendation: **Path Y** — M2-06 is going to touch `messageBus.ts` and `main.ts` anyway (the two files with NITs), so combining is more economical than two PRs. Also lets the M2-05 NITs (`86c9y7yzf`) sit cleanly as Maya's separate small-PR follow-up.

Wave 3 (after Wave 2 lands):
- **M2-08 (Sage — `@vscode/test-electron` Layer-3 tests)**. Ticket not yet created.

Wave 3 (after Wave 2 lands):
- **M2-08 (Sage — `@vscode/test-electron` Layer-3 tests)**.

After Wave 3 → M2 close + retro at `.claude/retros/retro-YYYY-MM-DD-m2-close.md` using `.claude/retros/RETRO-TEMPLATE.md`.

**Open dispatch-time questions for Wave 1+ (per Iris's M2-03 PR report):**
- `DashboardState` vs `AgentTree` type aliasing — surface to Felix for M2-04
- `StateDelta` shape not yet defined — Felix M2-04 or Maya M2-05 to define
- Roster file path needed for `ui:open-roster` handler — Felix M2-06

**Process insight captured this session (maintain-docs):** ENTRY-number collision in `clickup-pending.md` — parallel sub-agent dispatches each picked the next sequential ENTRY number from current main, so two dispatches in the same round → same N → merge conflict on the second PR. Hit 2× this session (PR #19/PR #22 both took ENTRY 014; PR #20/PR #21 both took ENTRY 016). Recovery: orchestrator rebases the colliding PR onto current main + drops the colliding commit (or keeps main's clickup-pending content via `git checkout --ours` when commit also has other content), then adds canonical entry post-merge. Captured in `.claude/docs/orchestration-overview.md` § Common failure modes.

**M1 status: SHIPPED earlier this session.** 11/11 tickets complete + M1-09-followup (`86c9y6e17`) merged at `c31ae02`. Retro at [.claude/retros/retro-2026-05-23-m1-close.md](.claude/retros/retro-2026-05-23-m1-close.md).

**Already done from M2 backlog:**
- M2-02 (Bram — VS Code Extension API prior-art): merged at `b0e858b`. Key recs: `WebviewViewProvider` Activity Bar surface, `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (1.64+), vanilla TypeScript, lazy activation via `onView:claudeteam.dashboard`. Pixel Agents lesson: NO CSP — ClaudeTeam must NOT replicate.

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
