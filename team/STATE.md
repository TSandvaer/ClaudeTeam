# Team State

This file is the orchestrator's source of truth between heartbeat ticks / between sessions. Each role updates its own section; the orchestrator reads this file on resume and at the start of each tick to spot stalls, instead of re-deriving "where are we" from conversation history.

**Conventions:**
- Each section is owned by one role. Don't edit other roles' sections.
- Last-updated timestamp uses ISO date `YYYY-MM-DD`.
- "Stale" = no update for 2+ heartbeat ticks (~40 min in away mode) **while a tick was active**. Long gaps when the user is asleep / paused are not stale.
- The **Current state** header at the top is the authoritative "what's going on right now" — supersedes the per-role sections below. Older per-role updates are append-only history.

---

## Current state — 2026-05-24 1232 UTC (M3 Wave 0 in motion: PR #35 Felix M3-01 in review by Maya; log-only conflict diagnosed, deferred to post-review)

**This header is the live "what's going on right now" entry. Per-role sections further down are append-only history. Read this header first on resume.**

- **`origin/main` tip:** `cd4cb81` (PR #33 merge — Nora's M3 backlog). Verify: `git rev-parse origin/main`. **M3 kicked off; Wave 0 ready to dispatch.**
- **M3 status: backlog landed.** Nora's M3 backlog (PR #33 → `cd4cb81`) authored 9 tickets across 3 waves (5 ClickUp-needing + 4 orch-direct chores). Wave 0 fires 5-6 in parallel: **Felix on M3-01 (hot-reload, L) + M3-03 (window-scoped session filtering, M); Nora batches M3-05/06/07/08 orch-direct chores.** Backlog file: `team/nora-pl/milestone-3-backlog.md`.
- **M3 prior-art research SHIPPED:** PR #32 (Bram `research(m3): prior-art on settings-UI patterns + global FS watching`) merged at `7d14976` after Felix APPROVE_WITH_NITS (all 3 cite-verifications passed). Two NITs (non-blocking) absorbed into M3-01/02 dispatch briefs at wave-kickoff time per rule 6.6 #4: (a) M3-02 implementer should do 30-sec in-person probe of Settings UI rendering; (b) M3-01 keep `*.yaml` glob recommendation pending VS Code #164925 fix-version clarification. Research note at `team/bram-research/m3-prior-art-2026-05-24.md`. **Recommendations: native Settings UI cannot render arrays-of-objects (falls to "Edit in settings.json") — use `claudeteam.openRoster` opening YAML in native editor; `createFileSystemWatcher(new RelativePattern(...))` works outside workspace folders since VS Code 1.64 (within our `^1.85.0` floor).**
- **M2 fully closed (unchanged):** all 12 PRs merged + P0 CJS shim + retro PR #31. Production .vsix activates on Node 22+. M2-06 AC7(b-d) sponsor-confirmed **PASS** this session via in-person install → reload → render → drill-in verification (audit comment posted on `86c9y9q6h`).
- **Rule 6.6 additions APPLIED to `~/.claude/CLAUDE.md` (2026-05-24):** all 3 sponsor-authorized auto-decide classes from M2-close retro (NITs-ticket-creation, log-only-conflict recovery, NITs-absorption-into-downstream) landed via explicit sponsor re-authorization this session. Classifier-blocked-last-session edit is now resolved. Audit trail: staged diff at `team/log/proposed-rule-6.6-additions-2026-05-24.md` (now applied — orch can move to `team/log/applied/` or leave as audit per sponsor's later call).
- **Test counts:** unchanged from M2 close — **215 unit + 49 integration + 14 Layer-3 = 278 tests green** on main. CI green on every push. M3 Wave 0 implementation will add coverage.
- **Open PRs:** **#35** — Felix M3-01 (`feat(roster): live YAML watch + hot-reload`). CI green (run 26361064407, head `14a1988`). `mergeable: CONFLICTING` — conflict scoped to `team/log/clickup-pending.md` ONLY (log-only-conflict, rule 6.6 #5 auto-decide cleared, resolution deferred to post-review tick). No review yet — Maya dispatched this tick.
- **In-flight agents:** **Maya** — peer-reviewing PR #35 in background (agentId `a0e00e614cb9589df`; this is a re-dispatch — the prior session's `maya-pr-35-review` died at session restart). PR #34 (Nora M3-05 ENTRY-timestamp switch) merged at `59ead3e` last session. Felix is idle post-M3-01-author (waiting on review).
- **Sponsor-pending (not blocking):** none. M2-06 AC7(b-d) verdict was confirmed PASS this session. 2 polish findings (noisy roster-warning log spam; dev-mode webview CSP source-map block) rolled into M3 backlog per sponsor's "(b) into M3 backlog" decision — captured as M3 backlog items #8 and #9 in `team/nora-pl/milestone-3-backlog.md`.
- **`86c9y7y9z` standing call (unchanged):** sponsor's standing decision — leave at `to do` with comment-only audit trail. No action; do NOT auto-decide to close.
- **Convention confirmed this session:** retros + `chore(orch)` work go orch-direct without ClickUp tickets (M1+M2 precedent). Applies to backlog files too (PR #33 was orch-direct).
- **New documented failure mode (this session):** parallel-Agent batch silently drops one call (hit 1× this session — only Bram's `Agent` call landed in a batch that intended Nora+Bram). Documented in `.claude/docs/orchestration-overview.md` § Common failure modes. Prevention rule: state intended dispatch count in user-visible text + verify tool-call array count before submitting; batches ≥3 prefer sequential.
- **Worktrees:** all detached at last activity (Felix on PR #32 review; Nora on PR #33; Bram on PR #32 author). Sync to main before M3 Wave 0 dispatch.
- **Auto-status:** AWAY, this-session cron `65f92980` (`7,22,37,52 * * * *` — re-armed on session start), last_tick `2026-05-24T12:32:00Z`.

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
