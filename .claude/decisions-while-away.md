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
