# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-23 (M2 Wave 1 SHIPPED — Wave 2 / M2-06 next; sponsor decision queued)

**This header is the live "what's going on right now" entry. Per-role sections further down are append-only history. Read this header first on resume.**

- **`origin/main` tip:** `09f95d3` (PR #24 merge — M2-05 webview dashboard tile renderer + message receiver). Verify: `git rev-parse origin/main`.
- **M2 Wave 0 status: SHIPPED.** PR #19/#20/#21/#22 (M2-09/03/07/01).
- **M2 Wave 1 status: SHIPPED.** PR #23 (Felix M2-04 file-watcher polling loop) `807c3c6` — Maya APPROVE_WITH_NITS, auto-merged. PR #24 (Maya M2-05 webview dashboard tile renderer) `09f95d3` — Felix APPROVE_WITH_NITS, rebased + auto-merged (resolved expected ENTRY 019 collision + unexpected `src/shared/messages.ts` code conflict). Wave 1 unblocked Wave 2 (M2-06 = M2 shippable gate).
- **Test counts:** 175 unit + 41 integration = **216 tests green** post-Wave-1 (Maya verified locally during rebase).
- **Open PRs:** none.
- **In-flight agents:** none. Felix detached post-PR-#24-review; Maya detached at `f243132` post-rebase.
- **Worktrees:** Felix worktree active on M2-04 lane (was detached at `6940033`); Maya worktree active on M2-05 lane (was detached at `df0a225`). Sage + Nora + Iris + Bram idle (no current dispatches).
- **Auto-status:** AWAY, session cron `0d78272c` (`7,22,37,52 * * * *`), last_tick `2026-05-23T18:42:00Z` (this cron tick — sponsor picked Path A, Wave 1 dispatched).

**ClickUp board state:**
- **Complete (all Wave 0 + Wave 1):** `86c9y7jn9` (M2-09), `86c9y7jf4` (M2-03), `86c9y7jjd` (M2-07), `86c9y7jdz` (M2-01), `86c9y7uhz` (M2-04), `86c9y7uka` (M2-05).
- **To do (NITs follow-ups, 4 tickets queued):**
  - `86c9y7u44` — M2-03 NITs (Iris, 6 items — spec polish + type alignment with M2-04's shipped types).
  - `86c9y7u4p` — M2-01 NITs (Felix, 3 items — scaffold cleanup).
  - `86c9y7y9z` — M2-04 NITs (Felix, 2 items — **NIT #2 should land before M2-06 dispatch**: `SerializedStateFullMessage` typed union eliminating the cast in `messageBus.ts:81`).
  - `86c9y7yzf` — M2-05 NITs (Maya, 3 items — messageReceiver tests, M2-06 cross-link, typo fix).

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
