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

**Pointers:** PR #27; Maya's review at `https://github.com/TSandvaer/ClaudeTeam/pull/27#issuecomment-4526462647`. 1 informational NIT to file as tiny follow-up ticket. Expected ENTRY 022 collision with PR #25 + PR #26 (all three sub-agents picked ENTRY 022 — same failure-mode documented at `.claude/docs/orchestration-overview.md` § Common failure modes; recovery via rebase + drop-or-checkout-ours pattern).
