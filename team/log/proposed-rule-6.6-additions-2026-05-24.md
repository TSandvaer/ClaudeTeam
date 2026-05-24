# Proposed user-global CLAUDE.md rule 6.6 additions (2026-05-24)

**Status:** AUTHORIZED by sponsor 2026-05-24 (via M2-close retro AskUserQuestion: "Approve all 3 (recommended)"). Auto-mode classifier blocked the orchestrator's direct edit to `~/.claude/CLAUDE.md` ("self-modification of orch autonomy rules without immediate-prior authorization"). Sponsor may either:
- **Option A:** copy-paste the diff below into `~/.claude/CLAUDE.md` manually.
- **Option B:** re-authorize the orch next session via "apply the rule 6.6 additions from `team/log/proposed-rule-6.6-additions-2026-05-24.md`" — the immediate-prior context makes the classifier comfortable.

## Foundation

ClaudeTeam M2-close audit: 10 auto-merges + 1 auto-dispatch round + 0 sponsor reversals = 0% reversal rate vs orch-autonomy rule 6.5's healthy 5-10% range. Per Nora's retro `.claude/retros/retro-2026-05-24-m2-close.md`, the orchestrator is below the "too cautious" floor; three additional classes had effectively 0 sponsor pushback across 7+ instances each.

## Diff

Locate this in `~/.claude/CLAUDE.md` (around line 111):

```
6. **Additionally-promoted auto-decide classes (2026-05-23, from cross-project audit at 28/0 reversal rate).** Beyond the general 4-gate framework, the following classes are explicitly cleared as auto-decide territory whenever the four gates hold — the orchestrator should NOT queue these for the user:
   - **Routine-PR-merge calls when CI green + orch-docs / cleanup class with peer reviewer attached.** ...
   - **Ticket-flesh-out follow-ups when a required field (OOS / success-test / acceptance criteria) is missing.** ...
   - **Cross-persona review routing when the peer pair is mechanically obvious from PR surface.** ...
```

Update the rule-6.6 leading sentence to extend the audit attribution:

> 6. **Additionally-promoted auto-decide classes (2026-05-23, from cross-project audit at 28/0 reversal rate; extended 2026-05-24 from ClaudeTeam M2-close audit at 10/10 reversal rate).** ...

Then APPEND these three bullets after the existing three:

```markdown
   - **NITs-ticket-creation from APPROVE_WITH_NITS review comments when scope is mechanical (added 2026-05-24).** Foundation: `[[sponsor-trusts-tactical-defaults]]` + ClaudeTeam M2 cycle audit (7× APPROVE_WITH_NITS used; every filed follow-up ticket's scope was mechanically derivable from the peer-reviewer's comment text; 0 sponsor revisions). Trigger: peer-reviewer's PR comment enumerates NITs as a numbered list with file:line refs; orchestrator authors a `chore(...): <ticket> NITs follow-up` ticket directly from the comment text without adding new scope. Composition: NITs ticket creation pairs with the merge auto-decide; both happen in the same orch round. Does NOT apply if the reviewer flags any NIT as "needs discussion" or scope-expanding.
   - **`clickup-pending.md` log-only-conflict recovery via `git checkout --ours` (added 2026-05-24).** Foundation: failure mode documented in `.claude/docs/orchestration-overview.md` § Common failure modes (ENTRY-NNN collision bullet); recovery via orch-side `git checkout --ours` applies ONLY when the rebase conflict is scoped to the log file with no code conflict. Validated 4× in ClaudeTeam M2 cycle with 0 audit gaps. Trigger: PR rebase fails with conflict scoped to `clickup-pending.md` (or equivalent coordination log) and no other files; orchestrator uses `git checkout --ours <log-file>` + continues rebase + force-pushes-with-lease. Does NOT apply when the conflict includes any code or non-coordination file — that escalates to author-rebase per the documented pattern.
   - **NITs-absorption-into-downstream-ticket when files overlap AND downstream is scheduled (added 2026-05-24).** Foundation: Path Y pattern (ClaudeTeam 2026-05-24, M2-04 NITs absorbed into M2-06) — sponsor-confirmed in one round; the heuristic is reusable across projects. Trigger: a follow-up NITs ticket and a downstream feature ticket touch the same files, the downstream ticket is already in the next dispatch wave, the NIT scope can be cleanly rolled into the downstream PR without expanding downstream's scope inappropriately. Orchestrator rolls NITs into downstream + closes the NITs ticket as duplicate-of-downstream + downstream PR's ACs absorb the NIT scope explicitly. Surface to sponsor ONLY when the downstream timeline isn't already known or when the absorption would notably grow downstream's size (M→L). Otherwise mechanical.
```

## Calibration target after this change

- 6 promoted classes vs current 3.
- Expected M3 reversal-rate target: rises into the healthy 5-10% range as the orchestrator auto-decides more boundary cases. If reversal rate stays 0%, promote more in the next retro. If reversal rate exceeds 15%, tighten the trigger language.

## Audit pointer

`.claude/decisions-while-away.md` is the audit record. Per rule 6.3, every auto-decided action gets a log entry with Foundation/Alternative/Reversibility/Status. Sponsor reviews on return.

## Cross-project port

These 3 classes are cross-project reusable per the audit framing. After applying to user-global CLAUDE.md, consider running `create-orchestration-project` skill's `port-improvements` mode to back-port to sibling orchestrated projects' local CLAUDE.md (if any have project-level orch-autonomy overrides).
