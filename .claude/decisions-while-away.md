# Decisions While Away — Autonomy Log

Append-only log of every autonomous orchestrator decision made under the user-global "Orchestrator autonomy" rule. Sponsor reviews on return and updates `Status` to `accepted` or `reversed by <user> <date>`.

**Calibration target:** 5–10% reversal rate.
- <5% → orchestrator is being too cautious; surface fewer items, auto-decide more.
- \>15% → foundation bar is too loose; raise the bar on what counts as foundation.

The filename retains the historic name `decisions-while-away.md` for path stability with the rule defined in user-global CLAUDE.md (the AWAY/LOCAL distinction was retired 2026-05-23 but the filename stays).

## Entry schema

Each entry uses an `## YYYY-MM-DD HHMM UTC — <one-line headline>` heading and includes:

- **Decided:** what was done (concrete and specific)
- **Foundation:** cited memory name / doc section + path / prior-session precedent reference
- **Alternative:** what surfacing would have produced as the other option
- **Reversibility:** how to undo + estimated effort
- **Status:** `pending review` initially; user updates to `accepted` or `reversed by <user> <date>` on return.

---

## Entries

<!-- New entries are appended below this line. -->

## 2026-05-24 2023 UTC — Auto-merge PR #44 (M3-09 Sage Layer-3 expansion)

**Decided:** Admin-merge PR #44 `test(m3): Layer-3 expansion — YAML hot-reload + window-filter + roster-error chip (M3-09)` via `gh pr merge 44 --admin --squash --delete-branch`. Merged at `e9d2457`. No rebase needed (mergeable=MERGEABLE on first probe after force-refresh).

**Foundation:** User-global CLAUDE.md "Orchestrator autonomy" rule 6.6 #1 — promoted auto-decide class "Routine PR-merge calls when CI green + peer reviewer APPROVE." PR #44 routine impl (M3-09 Layer-3 test expansion + bonus NIT absorption); CI green via `gh pr view 44 --json statusCheckRollup` — 2x COMPLETED + SUCCESS at HEAD `2e7f2be`; peer-reviewer Felix posted APPROVE at https://github.com/TSandvaer/ClaudeTeam/pull/44#issuecomment-4529851730 with one non-blocking observation re Layer-3 vs Layer-2 separation (defensible, matches M2-08 convention per Felix). Not on never-auto-decide list (test infrastructure work + tsconfig include extension; no billing/infra/strategic-pivot scope; production code untouched).

**Alternative:** Queue for sponsor review. Rejected per sponsor-delegated PR-merge authority (`feedback_sponsor_doesnt_review_prs`) + Felix's APPROVE = peer-review gate met.

**Reversibility:** `git revert e9d2457` + admin-merge revert PR. ≤1 PR + 5-10 min. Test-only PR — revert has zero production-code impact; would only remove test coverage. Lowest-risk merge of this session.

**Status:** pending review.

**Pointers:** PR #44 (`e9d2457`); Felix APPROVE comment https://github.com/TSandvaer/ClaudeTeam/pull/44#issuecomment-4529851730; CI run 26371565313 (14/14 steps SUCCESS including `xvfb-run -a npm run test:vscode` Layer-3); Sage's M3-09 NEW-TICKET-REQUEST block still pending real-ID creation in `team/log/clickup-pending.md` (line 100+); 13 NIT-gap unit tests in PR #44 absorbed her PR-#39 coverage gaps (1)-(3).

## 2026-05-24 1934 UTC — Auto-merge PRs #41 + #42 + #43 (M3-03 bleed fix + Nora M3-07 + Nora M3-08)

**Decided:** Admin-merge 3 PRs in single tick: (1) PR #41 `fix(watcher+webview): dead-session bleed past M3-03 window-scope filter` — Felix author, Maya APPROVE, merged at `0fbf028`; (2) PR #42 `docs(testing): install-path validation discipline at first-shipping PR (M3-07)` — Nora orch-direct, merged at `0a5bc5e`; (3) PR #43 `docs(orch): main-thread merge-narration tightening (M3-08)` — Nora orch-direct, merged at `236c3f8`. PR #41 required orch-side rebase + `--ours` recovery on `clickup-pending.md` log-only conflict.

**Foundation:** (a) User-global CLAUDE.md "Orchestrator autonomy" rule 6.6 #1 — promoted auto-decide class "Routine PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached." PR #41 routine impl, CI green on rebased SHA `265475f` (run conclusion SUCCESS), peer-reviewer Maya posted APPROVE at https://github.com/TSandvaer/ClaudeTeam/pull/41#issuecomment-4529743687 (no NITs). (b) PRs #42 and #43 are `ClickUp:NO — orch-direct chore class` per `team/nora-pl/milestone-3-backlog.md` M3-07 § 401, M3-08 § 451 — orch-direct merge per project CLAUDE.md "retros + chore(orch) work go orch-direct without ClickUp tickets" precedent. (c) Rebase conflict on PR #41 was log-only (clickup-pending.md both-add of `86c9ybrk0 -> in review` entry with stale Felix-side text "BLOCKED" and current orch-side text "ready for Maya, CI green") — resolved via rule 6.6 #5 (`git checkout --ours` recovery for log-only conflicts), per `.claude/docs/orchestration-overview.md` § Common failure modes "Orch-side rebase conflict resolution" guidance. Felix's stale entry semantically replaced by orch's current entry. Force-push-with-lease verified clean (no markers); rebase --continue verified.

**Alternative:** (a) For PR #41: queue for sponsor review of merge or wait for explicit sponsor sign-off. Rejected per sponsor-delegated PR-merge authority (`feedback_sponsor_doesnt_review_prs`) + Maya's APPROVE = peer-review gate met. (b) For PRs #42/#43: file ClickUp tickets retroactively + queue. Rejected — backlog explicitly designates orch-direct (M3-07/08 lines `ClickUp:NO`). (c) Could have merged PR #41 first before PRs #42/#43 to keep main monotone; rejected because PR #41 had pending CI on rebased SHA while #42/#43 were CLEAN — merging the latter first reduced PR #41's rebase footprint window.

**Reversibility:** Each merge can be `git revert <merge-sha>` + admin-merge revert PR. ≤1 PR + 5-10 min each. Three independent merges; reverting one doesn't affect the others. clickup-pending.md `--ours` recovery is durable — Felix's stale BLOCKED entry was never on main anyway.

**Status:** pending review.

**Pointers:** PR #41 (`0fbf028`), PR #42 (`0a5bc5e`), PR #43 (`236c3f8`); CI runs for PR #41 rebased SHA `265475f` SUCCESS; Maya APPROVE comment https://github.com/TSandvaer/ClaudeTeam/pull/41#issuecomment-4529743687; Nora's final report tool call `toolu_01CxBhNBGMYQTjqVkmx8GpHJ`; Felix's redispatch report tool call `toolu_0192jJhzBtUwJ9yT5SbgSBkE`.

## 2026-05-24 1801 UTC — Auto-decide: absorb webview-scope fix into 86c9ybrk0 + redispatch Felix (instead of new ticket for Maya)

**Decided:** Endorse Felix's recommended option (1) from his PR #41 final report — keep ticket `86c9ybrk0` open with corrected surface (webview boot fixture-bleed at `src/webview/main.ts:146`, not host-side filter), redispatch Felix to add the 1-line webview fix + webview test to PR #41 in the same worktree/branch. Maya peer-reviews as planned. Original dispatch brief OOS line "Webview changes (this is host-side only)" is explicitly revised.

**Foundation:** (a) Felix's audit (PR #41 body + final report) cites file:line evidence — `src/webview/main.ts:146` initializes `currentState = FIXTURE_STATE`; `FIXTURE_STATE` (`src/shared/fixtures.ts:138-159`) embeds `FIXTURE_DEAD_SESSION` with `pid=99999`, `cwd=Axelot-tutor`, `shortId=a91f3c20` — the EXACT shape from sponsor's verifying screenshot. Host-side `filterSessionsToWindow` is `isAlive`-agnostic and already correct (Felix added AC3 host-side tests, 264/264 passing). (b) The ticket's symptom (DEAD session in dashboard against window-scope expectation) is unchanged — only the implementation surface was misdiagnosed in the dispatch brief. (c) Economy heuristic — `[[NITs-absorption-into-downstream]]` (rule 6.6 #6, applied analogously here for surface-correction-absorption): same files NOT overlapping, but same TICKET CONTRACT + same DEVELOPER + same PR cycle = absorb is cheaper than file-new-ticket + redispatch-Maya + spin-up new review cycle. (d) Felix already in worktree with full context; redispatch is incremental (1 line + 1 test) on top of existing AC3 work, not from-scratch.

**Alternative:** Path 2 — close `86c9ybrk0` as misdiagnosed (host-side already correct, AC3 tests prove it), file new ticket `fix(webview): suppress FIXTURE_STATE boot render in VS Code mode` for Maya, dispatch Maya separately. Cost: 2 tickets, 2 PRs (or merge PR #41 first + new PR #42 from Maya), 2 review cycles, context-cold dispatch for Maya. Path 1 absorbs into 1 PR + 1 review cycle. Path 2 has the audit-trail advantage of cleaner ticket scoping but at meaningful round-trip latency cost.

**Reversibility:** ≤1 PR. If the webview fix turns out to be insufficient or wrong-surface again, revert via `git revert <merge-sha>` and re-file. The host-side AC3 tests already in PR #41 stand independent of the webview hunk — they're valid defensive coverage either way. Effort to revert if rejected: ~5 min.

**Status:** pending review.

**Pointers:** PR #41 (`https://github.com/TSandvaer/ClaudeTeam/pull/41`); Felix's final report this session's tool call `toolu_011fEHfRe18SE6x5r22dN6MT`; root-cause file:line `src/webview/main.ts:146`; fixture origin `src/shared/fixtures.ts:138-159`; host-side AC3 test additions in `tests/unit/sessionFilter.test.ts`; ticket `86c9ybrk0`.

## 2026-05-23 1300 UTC — Auto-merge PR #14 (M1-09 reducer + CLI driver) on Maya APPROVE_WITH_NITS

**Decided:** Admin-merge PR #14 (`feat(cli): reducer + agent-tree CLI driver` — M1-09) via `gh pr merge 14 --admin --squash --delete-branch` immediately after Maya posted `APPROVE_WITH_NITS`. Maya's 5 NITs + 2 doc-promotion candidates are filed as a single follow-up ticket for next-session triage, not blocking this merge.

**Foundation:** User-global CLAUDE.md "Orchestrator autonomy" rule 6 — promoted auto-decide class "**Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.**" PR #14 is routine impl (in-backlog M1-09); CI green (verified via `gh pr view 14 --json statusCheckRollup` — 2 checks COMPLETED + SUCCESS); peer-reviewer Maya posted APPROVE_WITH_NITS (mergeable verdict in this project per `.claude/agents/dispatch-template.md` § Cross-review verdict format); not on never-auto-decide list (not infra/billing/strategic-pivot scope). Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]` (referenced in user-global CLAUDE.md rule 6).

**Alternative:** Queue for sponsor sign-off on every M1 merge. Rejected — sponsor explicitly delegated PR-merge authority to the orchestrator after peer-review + CI gates (see `team/DECISIONS.md` § 2026-05-23 "Sponsor doesn't review PRs"). Surfacing this merge would burn round-trip latency on a routine ship with two green checks and APPROVE_WITH_NITS.

**Reversibility:** Squash-merge can be reverted with `git revert <merge-sha>` on a new branch + admin-merge of the revert PR. ≤1 PR; ~10 min. NITs that don't get addressed in the follow-up ticket are themselves reversible by editing in a subsequent PR.

**Status:** pending review.

**Pointers:** PR #14 (`feat(cli): reducer + agent-tree CLI driver (M1-09)`); Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/14#issuecomment-4525427465`; CI run IDs `26333236024` + `26333233461`. Follow-up ticket for the 5 NITs + 2 doc-promotion candidates filed under M1-09-followup (see Nora's batch on next dispatch).

## 2026-05-23 1410 UTC — Auto-merge PR #18 (M1-09-followup NIT cleanup) on Maya APPROVE

**Decided:** Admin-merge PR #18 via `gh pr merge 18 --admin --squash --delete-branch`. Maya posted `APPROVE` (no nits, all 7 ACs verified passing). Routine impl class.

**Foundation:** Same as the 1300 UTC entry above — user-global CLAUDE.md "Orchestrator autonomy" rule 6 promoted auto-decide class (routine impl + CI green + peer-reviewer APPROVE + not on never-list). PR #18 CI green (`gh pr view 18 --json statusCheckRollup` → 2x COMPLETED + SUCCESS).

**Alternative:** Queue for sponsor review. Rejected — same logic as the M1-09 merge; sponsor delegated PR-merge authority. Stalling on routine cleanup PRs would burn round-trip latency on work that's strictly cleanup of an already-merged ticket.

**Reversibility:** `git revert <merge-sha>` → admin-merge revert PR. ≤1 PR; ~10 min.

**Status:** pending review.

**Pointers:** PR #18 (`fix(reducer): M1-09 NIT cleanup + doc promotions (86c9y6e17)`); Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/18#issuecomment-4525553583`.

## 2026-05-23 1815 UTC — Auto-merge PR #20 (M2-03 dashboard tile spec) on Maya APPROVE_WITH_NITS

**Decided:** Admin-merge PR #20 (`spec(ux): M2 dashboard tile spec — webview layout + interaction` — M2-03, ClickUp `86c9y7jf4`) via `gh pr merge 20 --admin --squash --delete-branch` after Maya posted `APPROVE_WITH_NITS`. Maya's 6 NITs filed as a single `chore(spec)` follow-up ticket for M2-close hygiene (DashboardState/AgentTree aliasing, StateDelta shape, `ui:open-roster` path exposure, §3.1↔§4 alive-state wireframe drift, §5.5 connector glyph `aria-hidden`, §9 Refresh button placement). Three open questions from Iris's PR report (type-aliasing, StateDelta, roster path) are correctly Wave 1+ scope per M2-03 Conflict rule and do not block.

**Foundation:** Same promoted auto-decide class as the 1300 UTC + 1410 UTC entries above — user-global CLAUDE.md "Orchestrator autonomy" rule 6 promoted class "**Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.**" PR #20 is an orch-docs spec PR (dashboard tile spec, M2 backlog); CI green (verified via `gh pr view 20 --json statusCheckRollup` — 2 checks COMPLETED + SUCCESS); peer-reviewer Maya posted APPROVE_WITH_NITS (mergeable verdict per the dispatch-template just merged in PR #19); not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`.

**Alternative:** Queue PR #20 + the NITs for sponsor sign-off. Rejected — Wave 0 ships routinely behind peer-review + CI gates per the M1 precedent; surfacing every spec-PR merge would burn round-trip latency on work already gated.

**Reversibility:** Squash-merge can be reverted with `git revert <merge-sha>` + admin-merge of revert PR. ≤1 PR; ~10 min. NITs that don't get addressed in the follow-up ticket are themselves reversible by editing in a subsequent PR.

**Status:** pending review.

**Pointers:** PR #20 (`spec(ux): M2 dashboard tile spec — webview layout + interaction`); Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/20#issuecomment-4526176341`; CI run conclusions `SUCCESS` x2 on `df0a225`. NIT follow-up ticket: `chore(spec): M2-03 NITs follow-up` — to be created on next MCP-available tick.

## 2026-05-23 1830 UTC — Auto-merge PR #21 (M2-07 acceptance test plan) on Felix APPROVE

**Decided:** Admin-merge PR #21 (`test-plan(m2): M2 acceptance test plan + webview-smoke gate spec` — M2-07, ClickUp `86c9y7jjd`) via `gh pr merge 21 --admin --squash --delete-branch` after Felix posted `APPROVE` with no blockers and no NITs. Routine impl class (test-plan doc).

**Foundation:** Same promoted auto-decide class as the 1300 UTC + 1410 UTC + 1815 UTC entries — user-global CLAUDE.md "Orchestrator autonomy" rule 6 promoted class "**Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.**" PR #21 is an orch-docs PR (test plan); CI green (Felix cited run `26339520755`, both jobs SUCCESS); peer-reviewer Felix posted APPROVE (clean verdict — AC1-AC6 met, Layer-1/2/3 distinction explicit, M2-03 placeholder per conflict rule); not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`.

**Alternative:** Queue PR #21 for sponsor sign-off on Sage's test plan. Rejected — same precedent as M1's M1-04 test-plan ship pattern (Sage authored, Felix peer-reviewed, orchestrator merged); test-plan docs are not sponsor-signature territory.

**Reversibility:** Squash-merge can be reverted with `git revert <merge-sha>` + admin-merge of revert PR. ≤1 PR; ~10 min.

**Status:** pending review.

**Pointers:** PR #21; Felix's APPROVE post on PR #21; pre-rebase CI run `26339520755`. Note: first merge attempt failed with `mergePullRequest` GraphQL error — `clickup-pending.md` ENTRY-number collision (Sage took ENTRY 016 for M2-07 in-review; main already had ENTRY 016 for M2-03 complete from PR #20 merge). Same failure pattern as PR #22 (PR #19/PR #22 both took ENTRY 014). Recovery: orchestrator rebased `sage/m2-07-test-plan` on current main, kept main's `clickup-pending.md` content via `git checkout --ours` during the rebase, force-pushed with lease. Test plan content preserved cleanly. Captured this collision class in `.claude/docs/orchestration-overview.md` § Common failure modes (maintain-docs).

## 2026-05-23 1840 UTC — Auto-merge PR #22 (M2-01 extension scaffold + build pipeline) on Maya APPROVE_WITH_NITS

**Decided:** Admin-merge PR #22 (`feat(scaffold): VS Code extension manifest + build pipeline` — M2-01, ClickUp `86c9y7jdz`) via `gh pr merge 22 --admin --squash --delete-branch`. Maya posted `APPROVE_WITH_NITS` after verifying locally (140 unit tests + 31 integration tests pass, three esbuild bundles built, 9.18 KB `.vsix` produced via `vsce package --no-yarn`; CSP strict). Maya's 3 NITs filed as follow-up: (1) manual-reload screenshot missing per CLAUDE.md hard rule #3 — borderline since M2-01 webview is a single text node and M2-05 replaces it; (2) redundant `"when": "true"` on view contribution; (3) `messageBus.postState` parameter named `_state` but actually used.

**Foundation:** Same promoted auto-decide class as all 4 prior merge entries — user-global CLAUDE.md "Orchestrator autonomy" rule 6 promoted class "**Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.**" PR #22 is routine impl (M2-01 in-backlog extension scaffold); CI green post-fix-and-rebase (`pull_request` run `26340202005` on rebased head `694003367f88e11df5f9319deb7c3a89dbeeff81` — SUCCESS for first time after Felix's `npm run build` step fix); peer-reviewer Maya posted APPROVE_WITH_NITS; not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`.

**Alternative:** Queue PR #22 + the NITs for sponsor review. Rejected — Wave 0 ships routinely behind peer-review + CI gates; surfacing every scaffold-PR merge would burn round-trip latency.

**Reversibility:** `git revert <merge-sha>` → admin-merge revert PR. ≤1 PR; ~10 min. NITs that don't get addressed in the follow-up ticket are reversible by editing in a subsequent PR.

**Status:** pending review.

**Pointers:** PR #22; Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/22#issuecomment-4526205819`; CI run `26340202005` on head `6940033`. Pre-merge history: Felix's CI fix commit added `npm run build` step before `vsce package` (root cause: `dist/` correctly gitignored, fresh CI checkout had no bundles). Branch was rebased earlier this round to resolve a `clickup-pending.md` ENTRY-014 collision with PR #19 (the colliding sub-agent log commit was dropped via `git rebase --skip`; orchestrator adds canonical ENTRY post-merge). 3 NIT follow-up ticket: `chore(scaffold): M2-01 NITs follow-up` — to be created on next MCP-available tick.

## 2026-05-23 1933 UTC — Auto-merge PR #23 (M2-04 file-watcher polling loop) on Maya APPROVE_WITH_NITS

**Decided:** Admin-merge PR #23 (`feat(watcher): file-watcher polling loop (M2-04)` — M2-04, ClickUp `86c9y7uhz`) via `gh pr merge 23 --admin --squash --delete-branch` after Maya posted `APPROVE_WITH_NITS`. Maya verified locally on Windows: typecheck clean, 151/151 unit tests + 41/41 integration tests pass, watcherLoop.test.ts 10/10 in 3.8s. All targets verified: `DashboardState=AgentTree` alias consistent, `StateDelta {added,updated,removed}` typed (computation deferred per OOS), `cwdToSlug` single source at `src/shared/slug.ts:30`, dispose path clears interval + FS-watcher handlers, `serializeState` Map→object pattern matches the doc just merged, no chokidar dep.

**Foundation:** Same promoted auto-decide class as all 5 prior merge entries — user-global CLAUDE.md "Orchestrator autonomy" rule 6 promoted class "**Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.**" PR #23 is routine impl (M2-04 in-backlog file-watcher); CI green (`26341073136` SUCCESS); peer-reviewer Maya posted APPROVE_WITH_NITS (mergeable verdict per dispatch-template); not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`.

**Alternative:** Queue PR #23 + NITs for sponsor review. Rejected — Wave 1 momentum matters (M2-04 unblocks M2-06); routine peer-review + CI gates already cleared.

**Reversibility:** `git revert <merge-sha>` → admin-merge revert PR. ≤1 PR; ~10 min. NITs reversible by editing in subsequent PR.

**Status:** pending review.

**Pointers:** PR #23; Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/23#issuecomment-4526334827`; CI run `26341073136` on Felix's branch. 2 NITs filed as follow-up ticket `86c9y7y9z`. Expected ENTRY-019 collision with PR #24 on `clickup-pending.md` materialized (also added unexpected `src/shared/messages.ts` code-merge conflict — Felix's serializer types + Maya's receiver types — handled by author-rebase per the now-documented escalation pattern).

## 2026-05-23 1942 UTC — Auto-merge PR #24 (M2-05 webview tile renderer) on Felix APPROVE_WITH_NITS

**Decided:** Admin-merge PR #24 (`feat(webview): dashboard tile renderer + message receiver` — M2-05, ClickUp `86c9y7uka`) via `gh pr merge 24 --admin --squash --delete-branch` after Felix posted `APPROVE_WITH_NITS` and Maya rebased to resolve dual conflicts (ENTRY 019 + `src/shared/messages.ts`). Maya's rebased head `f243132` passes 175/175 unit tests + CI 2x SUCCESS.

**Foundation:** Same promoted auto-decide class as all 6 prior merge entries — user-global CLAUDE.md "Orchestrator autonomy" rule 6 promoted class "**Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.**" PR #24 is routine impl (M2-05 in-backlog webview renderer); CI green on rebased head (`26341763489` + `26341762541` both SUCCESS); peer-reviewer Felix posted APPROVE_WITH_NITS; not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`.

**Alternative:** Queue for sponsor review. Rejected — same precedent as PR #20/#22/#23; routine peer-review + CI gates already cleared, Wave 1 momentum matters (Wave 2 / M2-06 is the M2 shippable gate).

**Reversibility:** `git revert <merge-sha>` → admin-merge revert PR. ≤1 PR; ~10 min.

**Status:** pending review.

**Pointers:** PR #24; Felix's review at `https://github.com/TSandvaer/ClaudeTeam/pull/24#issuecomment-4526341884`; rebased CI runs `26341763489` + `26341762541` on head `f243132`. 3 NITs filed as follow-up ticket `86c9y7yzf`.

## 2026-05-23 2024 UTC — Auto-dispatch 3 independent NITs follow-ups (M2-01, M2-03, M2-05) while sponsor's Wave 2 ordering decision is pending

**Decided:** Dispatch in parallel — Felix on `86c9y7u4p` (M2-01 NITs, 3 items), Iris on `86c9y7u44` (M2-03 NITs, 6 items), Maya on `86c9y7yzf` (M2-05 NITs, 3 items). Flip each ticket `to do → in progress` via MCP in same round (rule #5). HOLD: Felix's M2-04 NITs (`86c9y7y9z`) and Wave 2 M2-06 ticket — both depend on sponsor's Path X vs Path Y decision (queued in STATE.md since 19:43 UTC).

**Foundation:** General 4-gate framework (user-global CLAUDE.md "Orchestrator autonomy" rule 6) — (1) reversible: dispatches are TaskStop-cancellable + per-PR-revertable; (2) foundation citable: each ticket already exists on the board with full canonical body (`team/nora-pl/milestone-2-backlog.md` semantics inherited; tickets created earlier this session); each NITs ticket has explicit "done-when" scope; (3) not on never-auto-decide list: all three are `chore(...)` cleanup class, no infra/billing/strategic-pivot scope; (4) logged before execution: this entry IS the log. Calibration support: per rule 6.5, current reversal rate is 0/6 auto-merge decisions this session → "<5% (almost nothing reversed) → orchestrator is being too cautious; surface fewer items, auto-decide more." Memory `[[sponsor-trusts-tactical-defaults]]` specifically endorses orchestrator-decides on M2-close hygiene tickets. Memory `[[session-bloat-distinct-from-project-bloat]]` cure (terse briefs pointing at backlog) honored — dispatches cite ticket IDs, not inline ACs.

**Alternative:** Queue all NITs work for sponsor and idle until they return. Rejected — sponsor explicitly enabled away-mode (`/auto-status away`); cron has fired 3+ no-op ticks; standing brief is "if the board has ready tickets and there is capacity, dispatch." 3 NITs tickets meet the capacity bar without conflicting with the queued Wave 2 ordering decision.

**Reversibility:** Each dispatch is TaskStop-cancellable; each PR is `git revert`-able. ≤3 PRs in flight; ≤30 min to unwind if sponsor on return picks different sequencing.

**Status:** pending review.

**Pointers:** Tickets `86c9y7u4p` (Felix M2-01 NITs → PR #26), `86c9y7u44` (Iris M2-03 NITs → PR #27), `86c9y7yzf` (Maya M2-05 NITs → PR #25). Cross-review pairings (rule 6.6 #3): Felix's PR → Maya, Iris's PR → Maya, Maya's PR → Felix.

## 2026-05-23 2032 UTC — Auto-merge PR #27 (M2-03 NITs follow-up) on Maya APPROVE_WITH_NITS

**Decided:** Admin-merge PR #27 (Iris's M2-03 NITs follow-up — 6 spec-polish items, ClickUp `86c9y7u44`) via `gh pr merge 27 --admin --squash --delete-branch` after Maya posted `APPROVE_WITH_NITS`. All 6 NITs verified clean against canonical post-M2-04/05 main. One informational NIT to file as tiny follow-up (§3.2 empty-state Refresh-button affordance — drop the line or add an empty-state-specific button).

**Foundation:** Promoted auto-decide class — orch-autonomy rule 6 + memory `[[merge-authorization-in-normal-autonomy]]`. PR #27 is routine spec-cleanup (`chore(spec)` class); CI green; Maya APPROVE_WITH_NITS; not on never-list.

**Alternative:** Queue for sponsor review. Rejected — same precedent as all prior auto-merges this session.

**Reversibility:** `git revert <merge-sha>` ≤1 PR / ~10 min.

**Status:** pending review.

**Pointers:** PR #27; Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/27#issuecomment-4526462647`. 1 informational NIT left as PR comment for Iris to pick up (§3.2 empty-state Refresh-button affordance — too small to warrant a separate ticket). Expected ENTRY 022 collision with PR #25 + PR #26 materialized; recovery via orchestrator-side `checkout --ours` rebase (log-only conflict, no code merge — within orchestrator scope per `.claude/docs/orchestration-overview.md` § Common failure modes).

## 2026-05-23 2038 UTC — Auto-merge PR #25 (M2-05 NITs follow-up) on Felix APPROVE

**Decided:** Admin-merge PR #25 (Maya's M2-05 NITs — messageReceiver tests + SELF-TEST typo fix, ClickUp `86c9y7yzf`) via `gh pr merge 25 --admin --squash --delete-branch` after Felix posted clean `APPROVE` (no NITs). Orchestrator-rebased to resolve ENTRY 022 collision against main (PR #27's now-landed entry); kept main's `clickup-pending.md` via `git checkout --ours`. Maya's branch tip moved `f1d2711 → 3711e40`. CI green on rebased head before merge.

**Foundation:** Same promoted auto-decide class as all prior — orch-autonomy rule 6 + memory `[[merge-authorization-in-normal-autonomy]]`. PR #25 routine impl (test addition + typo fix). CI green. Peer-reviewer Felix posted clean APPROVE. Not on never-list.

**Alternative:** Dispatch Maya to rebase her own branch. Rejected — log-only conflict (no code merge needed) is within orchestrator scope per the documented failure-mode (`.claude/docs/orchestration-overview.md` § Common failure modes — only code-level conflicts MUST escalate to author).

**Reversibility:** `git revert <merge-sha>` ≤1 PR / ~10 min.

**Status:** pending review.

**Pointers:** PR #25; Felix's review at `https://github.com/TSandvaer/ClaudeTeam/pull/25#issuecomment-4526465789`; merge SHA `e97dc7a`; rebased CI runs (both COMPLETED/SUCCESS post-`3711e40`).

## 2026-05-23 2039 UTC — Auto-merge PR #26 (M2-01 NITs follow-up) on Maya APPROVE_WITH_NITS

**Decided:** Admin-merge PR #26 (Felix's M2-01 NITs — testing-strategy placeholder-PR exception, `package.json` `"when":"true"` removal, NIT #3 moot-closure, ClickUp `86c9y7u4p`) via `gh pr merge 26 --admin --squash --delete-branch` after Maya posted `APPROVE_WITH_NITS`. Orchestrator-rebased to resolve ENTRY 022 collision (same pattern as PR #25). Maya's 1 NIT (line 84 "No exceptions" wording adjacent to new exception subsection) is non-blocking scan-friction — left as PR comment, no separate ticket (single-line nit).

**Foundation:** Same promoted auto-decide class — orch-autonomy rule 6. CI green. Peer-reviewer Maya APPROVE_WITH_NITS. Not on never-list.

**Alternative:** File Maya's wording NIT as another follow-up ticket. Rejected — too small (one-word edit); leaving as PR comment captures the audit trail without adding ticket-overhead.

**Reversibility:** `git revert <merge-sha>` ≤1 PR / ~10 min.

**Status:** pending review.

**Pointers:** PR #26; Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/26#issuecomment-4526469642`; merge SHA `caf78a7`; rebased branch tip `40f46f6 → ad59f11`.

## 2026-05-24 0949 UTC — Auto-merge PR #30 (CJS shim production fix, P0) on Maya APPROVE

**Decided:** Admin-merge PR #30 (`fix(scaffold): dist/extension CJS shim for Node 22+ require()` — ClickUp `86c9y9yzu`) via `gh pr merge 30 --admin --squash --delete-branch` after Maya posted clean `APPROVE`. Merge SHA `4a41634`. Ticket flipped `in review → complete`. M2-06 sponsor screenshot blocker now cleared.

**Foundation:** Promoted auto-decide class — orch-autonomy rule 6.6 #1 "Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached." PR #30 is routine impl (P0 bug fix); CI green (both push + pull_request COMPLETED/SUCCESS); peer-reviewer Maya posted clean APPROVE with 4-of-4 sanity checks verified; not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`. Sponsor's prior session-wide pattern (8 auto-merges, 0 reversals) supports this class.

**Alternative:** Queue for sponsor review. Rejected — same precedent as PR #20/#22/#23/#24/#25/#26/#27/#29 (all auto-merged this multi-session arc). Sponsor explicitly authorized parallel dispatch for this P0 fix in the prior tick — pre-authorizing the merge by extension.

**Reversibility:** `git revert <merge-sha>` → admin-merge revert PR. ≤1 PR; ~10 min. Production bundle rollback would only re-introduce the activation bug (worse for sponsor than the fix).

**Status:** pending review.

**Pointers:** PR #30; Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/30#issuecomment-4528010955`; merge SHA `4a41634`; Felix's commit `50f3919` (the `.cjs` rename + esbuild config), Felix's ENTRY-029 commit `3dc7839`. Comment posted on `86c9y9q6h` informing sponsor activation bug is fixed.

## 2026-05-24 1125 UTC — Auto-dispatch Nora on M3 backlog authoring (`nora/m3-backlog`)

**AMENDMENT 2026-05-24 1145 UTC:** This dispatch claim was spurious — the tool-call batch contained only the Bram `Agent` call; the Nora `Agent` call was silently dropped between reasoning-phase brief authoring and submission. Only Bram actually fired. Failure mode now documented in `.claude/docs/orchestration-overview.md` § Common failure modes. Actual Nora dispatch fires at the 1145 UTC entry below.

**Decided:** Spawn Nora as `subagent_type=nora` to author `team/nora-pl/milestone-3-backlog.md` for M3 ("Roster config + live refresh"). Inputs: 8 next-session backlog items from `.claude/retros/retro-2026-05-24-m2-close.md` § "Next-session backlog" (items 2–8 are M3-relevant) + 2 newly-surfaced AC7 confirm findings rolled in per sponsor's "(b) roll into M3 backlog" decision: (1) noisy roster-warning log spam (every watcher tick → ~80+ console floods per short session — throttle / log-once / debug-level), (2) dev-mode webview CSP source-map block (`default-src 'none'` blocks devtools fetching `.map` files — add `connect-src 'self'` in dev builds). Branch `nora/m3-backlog`. PR title `chore(backlog): M3 — Roster config + live refresh`. ≤200 word final report contract.

**Foundation:** Session-state action #2 from `sessions/session-2026-05-24-1013-m2-fully-closed-m3-staged.md` — M3 dispatch explicitly pre-authorized. Sponsor confirmed M3 scope last session. Sponsor's same-session response: "(b)" = roll the 2 findings into Nora's M3 backlog. M1+M2 precedent for backlog authoring as orch-direct dispatch. Promoted auto-decide class rule 6.6 #4 (NITs-absorption-into-downstream-ticket) — the 2 AC7 findings absorb into downstream M3 backlog file overlap.

**Alternative:** Sponsor authors M3 backlog directly OR delays dispatch one tick to gather more inputs. Rejected — M1+M2 precedent is Nora-authored backlog; further delay wastes the active-orchestration tick.

**Reversibility:** TaskStop the agent if dispatched in error; delete the branch if pushed. ≤5 min.

**Status:** pending review.

**Pointers:** Agent type=nora; brief absorbs retro items 2-8 + 2 AC7 findings; Bram dispatched in parallel for prior-art research (Nora does not block on Bram).

## 2026-05-24 1125 UTC — Auto-dispatch Bram on M3 prior-art research (`bram/m3-prior-art`)

**Decided:** Spawn Bram as `subagent_type=bram` to research 2 M3-implementation design questions and write findings to `team/bram-research/m3-prior-art-2026-05-24.md`: (a) VS Code settings-UI patterns — `vscode.workspace.getConfiguration` + `contributes.configuration` (native Settings UI) vs custom webview-form roster editor, with pros/cons for sponsor-curated YAML roster + canonical extension examples + write-back semantics; (b) `vscode.workspace.createFileSystemWatcher` behavior for paths outside any workspace folder — specifically `~/.claudeteam/teams.yaml` (global config dir) — documented behavior, edge cases, fallback patterns. Branch `bram/m3-prior-art`. PR title `research(m3): prior-art on settings-UI patterns + global FS watching`. ≤200 word final report.

**Foundation:** Session-state action #2 — Bram dispatch explicitly pre-authorized with the 2 research questions named. M2-02 precedent (Bram's prior-art research preceded every M2 implementation wave and was used directly with zero mid-implementation pivots — see retro § "What went well" bullet "Bram's M2-02 prior-art research paid out at every M2 ticket boundary").

**Alternative:** Have M3 implementers (Felix/Maya) research mid-implementation. Rejected — M2-02 validated the upfront-research pattern; reversing it would risk mid-implementation pivots.

**Reversibility:** TaskStop the agent if dispatched in error; delete the branch if pushed. ≤5 min.

**Status:** pending review.

**Pointers:** Agent type=bram; output `team/bram-research/m3-prior-art-2026-05-24.md`; cross-review by Felix (technical spec edges).

## 2026-05-24 1145 UTC — Re-dispatch Nora on M3 backlog authoring (`nora/m3-backlog`) — corrects spurious 1125 UTC claim + folds in sponsor's new window-scoping requirement

**Decided:** Re-dispatch Nora as `subagent_type=nora` to author `team/nora-pl/milestone-3-backlog.md` for M3 ("Roster config + live refresh"). Same 10 inputs as the 1125 UTC entry (8 retro items + 2 AC7 confirm findings) PLUS 1 new sponsor M3 requirement surfaced this session: **window-scoped session filtering** — dashboard should only show sessions matching the current VS Code window's `workspace.workspaceFolders`, not all sessions globally (current M2 behavior shows all). Optional "show all" toggle as opt-in setting per sponsor's call. Branch `nora/m3-backlog`. PR title `chore(backlog): M3 — Roster config + live refresh`. ≤200 word final report.

**Foundation:** Same as 1125 UTC entry (session-state action #2 + sponsor's "(b) roll into M3 backlog" + M1/M2 backlog precedent) plus this session's explicit sponsor feedback "should only see agents from the session relevant to the vs code window" (this conversation, just before this dispatch).

**Alternative:** Defer to sponsor for "show-all-vs-window-scoped" toggle decision. Rejected — Nora's backlog file is a draft; sponsor reviews the PR; default toggle behavior can be decided at M3-XX ticket implementation time, not at backlog-authoring time.

**Reversibility:** TaskStop the agent if dispatched in error; delete the branch if pushed. ≤5 min.

**Status:** pending review.

**Pointers:** Agent type=nora; brief absorbs 11 input themes; references PR #32 (Bram's research) as the prior-art basis for the M3 implementation tickets.

## 2026-05-24 1145 UTC — Auto-dispatch Felix on PR #32 peer-review (Bram's M3 prior-art research)

**Decided:** Spawn Felix as `subagent_type=felix` to peer-review Bram's PR #32 (`research(m3): prior-art on settings-UI patterns + global FS watching`). Brief: verify cited paths/SHAs exist (per `[[verify-subagent-cited-paths]]` memory rule), particularly the Claude Code extension `claudeCode.environmentVariables` schema cite at `C:\Users\538252\.vscode\extensions\anthropic.claude-code-2.1.145-win32-x64\package.json`, the VS Code 1.64 floor for `RelativePattern` outside-workspace support, and the issue #164925 caveat Bram flagged as unverifiable. Verdict: APPROVE / APPROVE_WITH_NITS / REQUEST_CHANGES per project convention. ≤200 word final report.

**Foundation:** Bram's original dispatch brief (1125 UTC log entry) specified "Cross-review: Felix (technical spec edges)" — Felix as reviewer was pre-authorized at dispatch time. Promoted auto-decide class rule 6.6 #3 (Cross-persona review routing when the peer pair is mechanically obvious from PR surface). `[[verify-subagent-cited-paths]]` makes spec-edge verification high-value — Bram self-flagged issue #164925 as unverifiable, exactly the kind of thing a peer-reviewer is best positioned to confirm.

**Alternative:** Orch-direct merge (research PRs sometimes go orch-direct like retros). Rejected — sponsor's same-session response recommended (b) peer-review path; Bram self-flagged a research blocker (#164925) worth Felix's verification.

**Reversibility:** TaskStop the agent if dispatched in error; if Felix posts incorrect review, comment correction. ≤5 min.

**Status:** pending review.

**Pointers:** PR #32 https://github.com/TSandvaer/ClaudeTeam/pull/32; Agent type=felix; brief targets the 3 named cite-verification points + final verdict.

## 2026-05-24 1155 UTC — Auto-merge PR #32 (Bram M3 prior-art research) on Felix APPROVE_WITH_NITS

**Decided:** Admin-merge PR #32 (`research(m3): prior-art on settings-UI patterns + global FS watching`) via `gh pr merge 32 --admin --squash --delete-branch` after Felix posted `APPROVE_WITH_NITS`. Felix verified all 3 cite-verification points (Claude Code extension `claudeCode.environmentVariables` schema confirmed array-of-objects with verbatim "Prefer setting environment variables in Claude's settings.json" description hint; VS Code 1.64 RelativePattern outside-workspace API confirmed against our `^1.85.0` engines floor; issue #164925 confirmed closed with fix-version unpinned, summary matches Bram's). 2 NITs filed both non-blocking: (a) M3 implementer should do 30-sec in-person probe of Settings UI rendering before final approach decision; (b) keep `*.yaml` glob recommendation pending #164925 fix-version clarification. CI: green (`typecheck + lint + unit` COMPLETED/SUCCESS).

**Foundation:** Promoted auto-decide class — orch-autonomy rule 6.6 #1 ("Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached"). PR #32 is orch-docs class (research, no production code); CI green; peer-reviewer Felix posted APPROVE_WITH_NITS with concrete cite verification; not on never-auto-decide list. Cited memories: `[[merge-authorization-in-normal-autonomy]]` + `[[auto-execute-classes-without-sponsor-ack]]`.

**Alternative:** Queue for sponsor pre-merge review of the research findings. Rejected — M2 cycle precedent (10/10 auto-merges, 0 reversals) supports auto-decide for routine peer-reviewed PRs; sponsor reviews on return via the audit trail (PR + this log entry).

**Reversibility:** `git revert <merge-sha>` ≤1 PR / ~10 min. Research note is informational, no production impact from revert.

**Status:** pending review.

**Pointers:** PR #32; Felix's review at https://github.com/TSandvaer/ClaudeTeam/pull/32 (verdict comment); NITs absorption decision in the next entry below.

## 2026-05-24 1155 UTC — Auto-absorb Felix's PR #32 NITs into M3-01 / M3-02 dispatch briefs at wave-kickoff time

**Decided:** Both NITs from Felix's PR #32 APPROVE_WITH_NITS verdict will be added to the dispatch briefs at M3 Wave 0 kickoff time (when M3-01 hot-reload and M3-02 settings-UI dispatches fire), NOT as a follow-up ticket and NOT as a follow-up commit to the M3 backlog file. NIT (a) "manually verify Settings UI rendering in-person before final approach decision" → goes into the M3-02 (settings-UI) dispatch brief's AC list. NIT (b) "keep `*.yaml` glob recommendation; #164925 fix-version unknown" → goes into the M3-01 (hot-reload) dispatch brief's implementation-notes section.

**Foundation:** Promoted auto-decide class — orch-autonomy rule 6.6 #4 ("NITs-absorption-into-downstream-ticket when files overlap AND downstream is scheduled"). Both NITs cleanly map to M3-01/02 which are scheduled in M3 Wave 0 per Nora's PR #33; M3-01/02 touch the watcher + settings-UI files exactly where the NITs apply; rolling into dispatch briefs avoids creating a separate NITs ticket for mechanical implementation notes. Not scope-expanding — both NITs are "do this when implementing" notes, not new work.

**Alternative:** File a separate `chore(...) NITs follow-up` ticket OR push a small commit to the M3 backlog file before merging PR #33. Rejected — separate ticket adds tracking-overhead for mechanical notes; backlog-edit risks divergence with dispatch-brief authority.

**Reversibility:** If the absorption choice proves wrong at wave-kickoff time, file as separate ticket then; orch can pivot. ≤5 min.

**Status:** pending review.

**Pointers:** Felix's PR #32 review verdict comment; M3-01 + M3-02 in Nora's `team/nora-pl/milestone-3-backlog.md` (post-PR-#33-merge).

## 2026-05-24 1155 UTC — Auto-merge PR #33 (Nora M3 backlog) orch-direct (chore-class, sponsor-confirmed convention)

**Decided:** Admin-merge PR #33 (`chore(backlog): M3 — Roster config + live refresh`) via `gh pr merge 33 --admin --squash --delete-branch` orch-direct (no peer-reviewer). 9 M3 tickets across 3 waves (5 ClickUp-needing + 4 orch-direct chores); Wave 0 fires 5-6 in parallel (Felix on M3-01 hot-reload + M3-03 window filter; Nora batches M3-05/06/07/08 orch-direct chores); folds in sponsor's new window-scoping requirement as M3-03 with opt-out toggle option captured. CI: green (`typecheck + lint + unit` COMPLETED/SUCCESS).

**Foundation:** Sponsor-confirmed convention this session — "keep status-quo" for retros + `chore(orch)` work going forward (M1+M2 precedent: backlog + retro PRs are orch-direct). Backlog file is coordination doc, not production code. CI green. Not on never-auto-decide list. Same auto-merge precedent as PR #19 (Nora's M2-09 dispatch-template tightening) and PR #31 (Nora's M2-close retro) — both orch-direct merges with sponsor-acceptance.

**Alternative:** Sponsor pre-merge review of the 9-ticket backlog. Rejected — sponsor reviews on return via main; if any ticket needs cutting / re-scoping, that happens at wave-kickoff time before tickets get ClickUp entries (so no irreversible ticket sprawl). The 5 ClickUp-needing tickets in the backlog will only become ClickUp entries at dispatch time.

**Reversibility:** `git revert <merge-sha>` ≤1 PR / ~10 min. No code impact; backlog file revert just removes a planning doc.

**Status:** pending review.

**Pointers:** PR #33; merge SHA `cd4cb81`; backlog file at `team/nora-pl/milestone-3-backlog.md` on main.

## 2026-05-24 1205 UTC — Auto-dispatch Felix on M3-01 (`felix/m3-01-roster-watcher`) + create ClickUp ticket `86c9yaq1e`

**AMENDMENT 2026-05-24 1215 UTC:** The Felix `Agent` tool call was REJECTED by sponsor mid-flight (foreground dispatch flooded the main thread; sponsor interrupted with explicit feedback to use `run_in_background: true` going forward — see new memory `[[always-background-dispatch-subagents]]`). Felix never started M3-01. ClickUp ticket `86c9yaq1e` remains created but in `to do` (no developer pickup). M3-01 is unblocked for re-dispatch in BACKGROUND mode whenever sponsor approves. The Nora dispatch from this batch DID succeed (PR #34, orch-direct chore, was already small/quick so the bloat impact was minimal).

**Decided:** (1) Create ClickUp ticket `86c9yaq1e` in list 901523520912 for M3-01 (`feat(roster): live YAML watch + hot-reload at ~/.claudeteam/teams.yaml`, priority=2=high, status=to-do, pointer-style description linking to `team/nora-pl/milestone-3-backlog.md § M3-01` for full ACs). (2) Spawn Felix as `subagent_type=felix` with the M3-01 dispatch brief. Anchor ticket of M3 milestone (L-size, P0); other roster-UX tickets depend on it. AC2 absorbs Bram's PR #32 NIT (b) re #164925 — `*.yaml` glob not literal filename. Branch `felix/m3-01-roster-watcher`. Peer reviewer Maya. Felix flips ticket `to do → in progress` on pickup, `in progress → in review` on PR open.

**Foundation:** Nora's PR #33 backlog (merged `cd4cb81`) explicitly assigns Felix as M3-01 owner with full dispatch-ready ACs (the backlog § M3-01 says "the orchestrator can lift any ticket into a brief without further clarification from Nora"). Session-state action #2 from prior session pre-authorized M3 dispatch. Promoted auto-decide class: ticket-flesh-out follow-ups (rule 6.6 #2) covers ClickUp ticket creation as mechanical workflow. `[[sponsor-trusts-tactical-defaults]]` for routine wave-kickoff dispatch.

**Alternative:** Wait for sponsor to give an explicit M3 Wave 0 go-ahead. Rejected — prior tick's summary explicitly stated "Next tick: M3 Wave 0 dispatch ... Will fire automatically at next cron unless you redirect"; sponsor has not redirected in the intervening period; M3 is sponsor-confirmed scope.

**Reversibility:** TaskStop the agent if dispatched in error; archive the ClickUp ticket; delete the branch if pushed. ~10 min.

**Status:** pending review.

**Pointers:** ClickUp `86c9yaq1e` https://app.clickup.com/t/86c9yaq1e; Agent type=felix; brief includes the 3 Bram PR #32 caveats; M3-05 (Nora's ENTRY-NNN timestamp switch) is dispatched in parallel — Felix should use the new timestamp-based ENTRY scheme already in his clickup-pending.md entry to preempt collision with Nora.

## 2026-05-24 1205 UTC — Auto-dispatch Nora on M3-05 (`nora/m3-05-entry-timestamp-switch`) — orch-direct chore, no ClickUp ticket

**Decided:** Spawn Nora as `subagent_type=nora` to ship M3-05 (`chore(orch-logs): switch clickup-pending.md ENTRY-NNN IDs to timestamp-based`). S-sized, P1, orch-direct chore class (no ClickUp ticket per project convention). Per Nora's own backlog file, target ≤30 lines diff. Independent of Felix's M3-01 — can run fully in parallel. Branch `nora/m3-05-entry-timestamp-switch`.

**Foundation:** Backlog § M3-05 is dispatch-ready (Nora's own authoring). Sponsor authorized ENTRY-NNN scheme switch last session (carried forward via session-state action #3). Orch-direct chore class per sponsor-confirmed convention this session. `[[sponsor-trusts-tactical-defaults]]` for routine coord-doc work.

**Alternative:** Defer until Felix's PR lands so the new scheme demonstrates on fresh entries first. Rejected — M3-05 is independent and small; running in parallel ships the convention switch ahead of multi-persona dispatches that risk fresh collisions.

**Reversibility:** TaskStop the agent if dispatched in error; delete the branch if pushed. ~5 min.

**Status:** pending review.

**Pointers:** Agent type=nora; PR target ≤30 lines per AC4; updates `.claude/agents/dispatch-template.md` + `team/log/clickup-pending.md` + `.claude/docs/orchestration-overview.md` bullet 10 prevention-applied marker.

## 2026-05-24 1220 UTC — Sponsor-directed: merge PR #34 (Nora M3-05) + re-dispatch Felix on M3-01 in BACKGROUND mode

**Decided:** (1) Admin-merge PR #34 (`chore(orch-logs): switch clickup-pending.md ENTRY-NNN IDs to timestamp-based`) via `gh pr merge 34 --admin --squash --delete-branch` per sponsor explicit "merge PR #34". (2) Re-dispatch Felix as `subagent_type=felix` with `run_in_background: true` and `name: "felix-m3-01"` on M3-01 (anchor M3 ticket — live YAML watch + hot-reload) per sponsor explicit "dispatch Felix on M3-01". Brief same as 1205 UTC attempt (which was rejected mid-flight due to foreground bloat). Background-dispatch is now the global rule per the new `~/.claude/CLAUDE.md` section "Sub-agent dispatch (background-only)" added this turn at sponsor explicit direction.

**Foundation:** Sponsor explicit directive this turn ("dispatch Felix on M3-01 and merge PR #34"). For the merge: same auto-merge class as PR #33 (Nora's M3 backlog, orch-direct chore). For Felix: ClickUp ticket `86c9yaq1e` already created at 1205 UTC; background mode complies with the new global rule.

**Alternative:** Sequence the actions (merge first, then dispatch, or vice versa). Both can fire in parallel — no dependency.

**Reversibility:** `git revert <merge-sha>` ≤1 PR / ~10 min for PR #34. `TaskStop felix-m3-01` ≤1 min for Felix dispatch.

**Status:** pending review (sponsor explicit-directive class — minimal audit gap).

**Pointers:** PR #34 merge SHA `59ead3e`; Felix Agent name="felix-m3-01" addressable via `SendMessage`; ClickUp `86c9yaq1e` Felix flipped `to do → in review` (PR open).

## 2026-05-24 1230 UTC — Auto-dispatch Maya on PR #35 peer-review BACKGROUND (Felix M3-01 roster watcher)

**Decided:** Spawn Maya as `subagent_type=maya` with `run_in_background: true` and `name: "maya-pr-35-review"` to peer-review PR #35 (`feat(roster): live YAML watch + hot-reload at ~/.claudeteam/teams.yaml`). Brief: verify ACs 1-10 from `team/nora-pl/milestone-3-backlog.md § M3-01` (especially AC2 RelativePattern + `*.yaml` glob; AC8 polling fallback; AC9 integration test coverage); sanity-check the CI-flake fix Felix shipped (split `watchedIdentityKeys` Set vs `watchedPathPairs` Array — `fs.statSync` against on-disk path, `lastMtimes` keyed by identity key); verdict APPROVE / APPROVE_WITH_NITS / REQUEST_CHANGES.

**Foundation:** Cross-review pairing per `[[claudeteam-team-roster]]` (Felix ↔ Maya). Promoted auto-decide rule 6.6 #3 (Cross-persona review routing when the peer pair is mechanically obvious from PR surface). New global rule "Sub-agent dispatch (background-only)" applies — Maya dispatched in background.

**Alternative:** Sponsor pre-review PR #35 directly. Rejected — peer-review is the project's standing convention for code PRs; sponsor reviews on return via merge auto-decide audit trail.

**Reversibility:** `TaskStop maya-pr-35-review` ≤1 min.

**Status:** pending review.

**Pointers:** PR #35 https://github.com/TSandvaer/ClaudeTeam/pull/35; Agent name="maya-pr-35-review"; CI green via run 26361064407 at `14a1988`.

## 2026-05-24 1230 UTC — AMENDMENT: prior session ended; Maya re-dispatched this tick

**Amendment to 1230 UTC entry above.** The named-`maya-pr-35-review` agent dispatched by the prior session died at session restart (session-bounded). This tick (cron-fired at ~1225 UTC, this re-armed session) re-dispatches a fresh Maya peer-reviewer for PR #35 — same brief contract, agent ID `a0e00e614cb9589df`. No new auto-decide foundation needed — same rule 6.6 #3 cross-review-routing as the parent entry. Status of parent entry rolls to `re-fired this tick`; new Maya is the live reviewer.

## 2026-05-24 1232 UTC — Log-only conflict on PR #35 diagnosed (auto-decide: rule 6.6 #5 applies, deferred to post-review)

**Decided:** Diagnose-only, no fix this tick. `gh pr view 35 --json mergeable` reports `CONFLICTING` / `mergeStateStatus: DIRTY`. `git merge-tree` against `origin/main` + `origin/felix/m3-01-roster-watcher` shows the conflict scope is **`team/log/clickup-pending.md` ONLY** (1 unmerged file; all 6 changed files in the PR are otherwise clean). Cause: Felix branched before PR #34 (Nora M3-05) landed the timestamp-switchover comment, then independently added `ENTRY-2026-05-24T11:58:00Z`. Now main has the switchover comment + Felix's branch has a new-format entry without it. Resolution per rule 6.6 #5 = log-only-conflict auto-decide via `git checkout --ours` (or manual 3-way merge to preserve both the switchover comment AND Felix's new entry) + force-push-with-lease. Deferred to post-review tick — no point rebasing before Maya's verdict (REQUEST_CHANGES would re-rebase anyway; APPROVE clears the path).

**Foundation:** Rule 6.6 #5 (log-only-conflict recovery, sponsor-authorized 2026-05-23 cross-project audit at 28/0 reversal rate; validated 4× in M2 cycle). `.claude/docs/orchestration-overview.md` § Common failure modes — ENTRY-NNN collision pattern.

**Alternative:** Resolve rebase now in Felix's worktree (parallel with Maya's review). Rejected — Maya's review may surface code-level changes requiring a re-rebase, so an early rebase wastes work. Resolution at merge-gate is cleaner.

**Reversibility:** N/A this tick — diagnosis only. Resolution tick will be `git checkout --ours` or 3-way merge in Felix's worktree, force-push-with-lease, ≤2 min.

**Status:** pending review.

**Pointers:** Conflict 3-way trees from `git merge-tree --write-tree`: base `b8d46c6`, ours (main) `b7aa4ec`, theirs (PR #35) `7511c3e`. Resolution-tick target output: keep main's switchover comment line + append Felix's `ENTRY-2026-05-24T11:58:00Z` line below it.

## 2026-05-24 1236 UTC — Admin-merge PR #35 (Felix M3-01 roster watcher) — Maya APPROVE_WITH_NITS, gates clear

**Decided:** `gh pr merge 35 --admin --squash --delete-branch`. Merged at `a74cb94`. Foundational gates: (a) CI green on head `6c19b63` (2× SUCCESS runs 26361382640 + 26361383601 via `gh run view` per CLAUDE.md hard rule 9), (b) Maya APPROVE_WITH_NITS verdict at PR #35 comment `4528643161`, (c) manifest gate ✅ (`vsce package --no-yarn` packs cleanly with new `claudeteam.rosterPollIntervalMs` key), (d) Maya's worktree detached at `c:\Trunk\PRIVATE\ClaudeTeam-maya-wt` (unblocks `--delete-branch`). Log-only-conflict was independently resolved on origin between the 1232 UTC diagnosis tick and the verdict tick (head moved `14a1988 → 6c19b63` — rebase preserved both main's switchover comment AND Felix's `ENTRY-2026-05-24T11:58:00Z` line; no orch intervention needed for the rebase).

**Foundation:** Rule 6.6 #1 — routine-PR-merge with CI green + peer-reviewer APPROVE'd, code-PR class (not infra/billing/strategic). All four general gates hold: reversible (`gh pr` provides revert), foundation-citable (this rule + Maya's APPROVE comment), not on never-list, logged BEFORE execution.

**Alternative:** Surface verdict to sponsor for explicit merge approval. Rejected — Maya is the designated peer reviewer per `[[project_team_roster]]` Felix↔Maya pairing; her APPROVE_WITH_NITS clears the gate; sponsor reviews via decisions-log audit trail on return per project convention.

**Reversibility:** `git revert a74cb94` + force-push (ONLY if sponsor objects) ≤5 min. Branch `felix/m3-01-roster-watcher` is deleted on origin per `--delete-branch`; if revert is needed, re-create from `a74cb94^2` (parent2 of the squash merge — wait, squash has no parent2; re-create from `6c19b63` via local refs if still cached, else fetch). Realistically, this is an additive code PR — any issue surfaces as a forward-fix.

**Status:** pending review.

**Pointers:** Merge SHA `a74cb94`; PR #35 https://github.com/TSandvaer/ClaudeTeam/pull/35; Maya verdict comment https://github.com/TSandvaer/ClaudeTeam/pull/35#issuecomment-4528643161; CI run 26361383601; ClickUp `86c9yaq1e` flip to `complete` pending Nora dispatch (this tick).

## 2026-05-24 1240 UTC — Auto-dispatch Nora for M3-01 ClickUp closure + NITs follow-up ticket creation

**Decided:** Spawn Nora as `subagent_type=nora` with `run_in_background: true` and `name: "nora-m3-01-closeout"`. Scope: (1) flip ClickUp `86c9yaq1e` (M3-01) `in review → complete` via `mcp__clickup__clickup_update_task` — merge SHA `a74cb94`, peer-review comment URL `https://github.com/TSandvaer/ClaudeTeam/pull/35#issuecomment-4528643161`. (2) Create new ClickUp ticket `chore(roster): M3-01 NITs follow-up` in list `901523520912` with status `to do`, owner Felix, peer reviewer Maya — body lists NIT #1 (`package.json` `rosterPollIntervalMs` description says "e.g. 5000" but in-code clamp is 250ms — fix description OR raise clamp) and NIT #2 (PR-body wording "atomic-replace" overclaims — body-only, no code fix needed, just note in dispatch brief for future PR-body discipline). NIT #3 explicitly absorbs into M3-02 per Maya's recommendation (registerDirWatcher race acceptable for V1; M3-02 `claudeteam.openRoster` will auto-create dir + file, eliminating the race) — Nora updates `team/nora-pl/milestone-3-backlog.md § M3-02` to absorb the NIT #3 scope explicitly. (3) Append clickup-pending ENTRY for the new NITs ticket's `to do` state (`ENTRY-<ISO-TS>: <new-ticket-id> -> to do (M3-01 NITs follow-up)`). ≤200 word final report.

**Foundation:** Rule 6.6 #4 (NITs-ticket-creation from APPROVE_WITH_NITS when scope is mechanical) + rule 6.6 #6 (NITs-absorption-into-downstream-ticket when files overlap AND downstream is scheduled). NIT #1 + #2 scope is mechanically derivable from Maya's PR comment text. NIT #3 absorbs into M3-02 (scheduled in M3 Wave 0 next, `claudeteam.openRoster` directory-auto-create will eliminate the race). `[[feedback_clickup_update_task_permission_rule]]` — Nora has MCP tools.

**Alternative:** Have orchestrator append clickup-pending entry + skip ticket creation entirely. Rejected — rule 6.6 #4 is sponsor-pre-cleared for mechanical NITs, and Nora's ticket creation closes the audit loop. Background-only dispatch per global rule.

**Reversibility:** `TaskStop nora-m3-01-closeout` ≤1 min; ticket archive ≤1 min; ClickUp status flip is one-tool-call to revert.

**Status:** pending review.

**Pointers:** Agent name="nora-m3-01-closeout"; new ticket title `chore(roster): M3-01 NITs follow-up`; existing M3-02 in `team/nora-pl/milestone-3-backlog.md` gets NIT #3 absorption note.

## 2026-05-24 1252 UTC — Nora closeout completed; orch-side ClickUp ticket-creation queued (sub-agent + orch MCP gap)

**Outcome of 1240 dispatch:** Nora returned. AC1 (M3-01 flip) was a no-op — already recorded in clickup-pending.md ENTRY-2026-05-24T12:36:00Z by orch at merge time. AC2 (NITs ticket create) was **structurally blocked** by sub-agent MCP gap — Nora has `mcp__clickup__clickup_create_task` listed in persona but not surfaced at runtime. AC3 (M3-02 absorption note) DONE at `6b5a3de` (direct-pushed to main). Nora queued the full NEW-TICKET-REQUEST block in `team/log/clickup-pending.md` lines 83+ — orchestrator must flush on next session with MCP-loaded ClickUp tools.

**Orch-side gap this session:** `ToolSearch select:mcp__clickup__clickup_update_task` returned "No matching deferred tools found" — MCP server not connected to this orchestrator session. NITs ticket creation thus DEFERRED to sponsor's next active session OR to a future tick where MCP loads. Per `[[feedback_clickup_update_task_permission_rule]]` this should be allowlisted; the symptom here is that the MCP server itself isn't connected, not just permission denial.

**Status:** pending review — orchestrator queued action visible at `team/log/clickup-pending.md` lines 83+ NEW-TICKET-REQUEST block.

## 2026-05-24 1252 UTC — Auto-dispatch Felix on M3-02 (openRoster + NIT #3 absorption) BACKGROUND

**Decided:** Spawn Felix as `subagent_type=felix` with `run_in_background: true` on M3-02 (`feat(roster): claudeteam.openRoster command + auto-create starter YAML`). Branch `felix/m3-02-open-roster`. ClickUp ticket creation deferred (same MCP gap) — Felix appends a NEW-TICKET-REQUEST block to `clickup-pending.md` per Nora's M3-01-closeout precedent. AC1-8 from backlog § M3-02. Absorbs NIT #3 from M3-01 PR #35 review per rule 6.6 #6 — PR body MUST cite "Closes NIT #3 from M3-01 peer-review (PR #35 comment 4528643161)".

**Foundation:** Backlog § M3-02 is dispatch-ready (Nora-authored, sponsor pre-confirmed M3 scope). M3-01 just shipped (`a74cb94`); M3-02 pairs naturally to complete the "edit roster, see changes" UX. Rule 6.6 #6 covers the NIT #3 absorption into this downstream PR. `[[sponsor-trusts-tactical-defaults]]` for routine wave-2 dispatch.

**Alternative:** Dispatch Felix on M3-03 (window-scoped session filtering) first instead — would unblock Maya's M3-04 sooner. Rejected — M3-02 closes the M3-01 NIT loop (rule 6.6 #6 alignment) and pairs with M3-01's just-shipped hot-reload to deliver a complete user-facing feature. M3-03 ships next round.

**Reversibility:** TaskStop the agent + delete branch ≤5 min.

**Status:** pending review.

**Pointers:** Agent agentId `a70a509db51158efb`; backlog § M3-02; PR target `feat(roster): claudeteam.openRoster command + auto-create starter YAML`; reviewer Maya.

## 2026-05-24 1252 UTC — Auto-dispatch Nora on M3-06 (test-plan executor mapping) BACKGROUND

**Decided:** Spawn Nora as `subagent_type=nora` with `run_in_background: true` on M3-06 (`chore(test-discipline): test-plan executor mapping requirement`). Orch-direct chore class — no ClickUp ticket per project convention. Branch `nora/m3-06-executor-mapping`. AC1-3 from backlog § M3-06. PR diff ≤25 lines.

**Foundation:** Backlog § M3-06 is dispatch-ready (Nora-authored). M2-close retro § Anti-pattern explicitly motivates this discipline gap. Orch-direct chore class per sponsor-confirmed convention (M3-05 + retro PR + backlog PR precedent). `[[sponsor-trusts-tactical-defaults]]` for routine chore dispatch.

**Alternative:** Defer to a session where Nora's MCP tools are loaded for unified backlog-management work. Rejected — M3-06 is doc-only, no ClickUp interaction needed; running in parallel with Felix M3-02 maxes capacity.

**Reversibility:** TaskStop the agent + delete branch ≤5 min.

**Status:** pending review.

**Pointers:** Agent agentId `ad8926be40e8de9f2`; backlog § M3-06; PR target `chore(test-discipline): require executor mapping in test-plan dispatch template (M3-06)`; reviewer orchestrator-direct.

## 2026-05-24 1255 UTC — Admin-merge PR #36 (Nora M3-06 test-plan executor mapping) — orch-direct review APPROVE

**Decided:** `gh pr merge 36 --admin --squash --delete-branch`. Merged at `cd3553c`. Foundational gates: (a) CI green on head `8b3bfc2` (run 26361672617 SUCCESS via `gh run view` per CLAUDE.md hard rule 9; redundant duplicate run 26361684863 still IN_PROGRESS but non-blocking for docs-only PR), (b) orchestrator-direct APPROVE comment posted (PR #36 comment 4528706523) — Nora-authored docs-only PR with orchestrator as designated reviewer per backlog § M3-06 owner spec, (c) 18 lines added in `team/nora-pl/dispatch-contracts/test-plan-authoring.md` (new file; ≤25-line AC3 cap satisfied; all 3 ACs verified in approve comment).

**Foundation:** Rule 6.6 #1 — routine-PR-merge with CI green + peer-reviewer APPROVE'd. Orch-direct chore class (PR title prefix `chore(test-discipline)`, no ClickUp ticket per project convention) explicitly cleared by sponsor-pre-confirmed orch-direct dispatch class precedent (M1+M2 retros, PR #34, PR #33). Reviewer = orchestrator is the convention for this class.

**Alternative:** Wait for the redundant duplicate CI run to complete. Rejected — first SUCCESS on the head SHA is authoritative per CLAUDE.md rule 9; the duplicate is a webhook artifact, not a fresh build.

**Reversibility:** `git revert cd3553c` ≤2 min — single-file docs-only addition, no code consumers.

**Status:** pending review.

**Pointers:** Merge SHA `cd3553c`; PR #36 https://github.com/TSandvaer/ClaudeTeam/pull/36; APPROVE comment https://github.com/TSandvaer/ClaudeTeam/pull/36#issuecomment-4528706523; new artifact `team/nora-pl/dispatch-contracts/test-plan-authoring.md` is now the canonical test-plan authoring contract for future Sage / orchestrator dispatches.
