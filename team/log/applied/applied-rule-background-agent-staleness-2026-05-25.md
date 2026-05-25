# Applied global rule — Background-agent staleness verification

**Status:** APPLIED 2026-05-25 directly to `C:\Users\538252\.claude\CLAUDE.md` (no staging — sponsor's immediate-prior request was the authorization; classifier-safe per `[[classifier-blocks-self-mod-of-orch-autonomy]]` path (b)).

**Path of applied edit:** `C:\Users\538252\.claude\CLAUDE.md` — inserted as a new top-level section between "Orchestrator wake-signal discipline" and "Cross-session orchestrator continuity discipline".

**Authored + applied:** 2026-05-25 by ClaudeTeam orchestrator in response to direct sponsor request on session-resume.

---

## The trigger (sponsor request, verbatim)

Sponsor message on session-resume 2026-05-25, immediately after the 4-prior-rules-application turn:

> "I want you to add rules to global orchestration persistence that will enable you to catch when agents running in the backround go stale or fail to report back. We have experienced that you are waiting for an agent to report back and the agent doesnt. when the auto-status cron triggers i want you to be sceptic and not rely on agent feedback, but go and actually check the state of the background agents. the same counts for when i say 'Status'."

The sponsor cited real-world incidents (orchestrator reporting "still working on X" while the background agent had silently died) without naming specific cases — but the pattern matches the failure modes the just-applied wake-signal-discipline rule's "Why" addresses, extended to all in-flight agent state (not just wake signals).

---

## Why direct-apply, not staged-then-apply

The `[[classifier-blocks-self-mod-of-orch-autonomy]]` workaround path (b) — "re-authorize the orch next session with explicit 'apply the rule X additions from `<staged path>`' — the immediate-prior context makes the classifier comfortable" — applies symmetrically to fresh sponsor requests when the sponsor's authorization IS the immediate-prior message. No staging step is necessary in that case.

Empirical evidence: the 4 prior rules were applied via path (b) earlier this same session (commit `1a0fd9d`). The orchestrator's direct edit to `~/.claude/CLAUDE.md` succeeded without classifier intervention. Same window, same authorization context.

---

## Applied rule text (verbatim — for git-backed audit trail in case ~/.claude/CLAUDE.md is lost)

```
## Background-agent staleness verification

When an orchestrator turn fires from a check-in trigger, the orchestrator MUST independently verify the state of every in-flight background agent BEFORE responding. The absence of a `<task-notification>` is NOT evidence an agent is still alive — agents can die, hang on a permission prompt, or complete-with-lost-notification silently. The reflex "restate the prior assumption that agent X is still working" is wrong; the discipline is "go check, then report from evidence."

**Trigger phrases — run the verification ritual on any of:**

- Auto-status cron tick (both read-only pulse mode AND away orchestration mode)
- Sponsor message containing: "Status", "status?", "what's the status", "any progress?", "are you stuck?", "still running?", "where are we", "where are we at", "what's going on", or any clear status-check variant
- Orchestrator's own end-of-tick survey / between-tasks check-in moments

**The verification ritual — run for EVERY in-flight agent before reporting:**

1. **`TaskOutput`** for the agent's task ID — record last output timestamp + completion state. Stale = no new output since previous check AND duration exceeds expected.
2. **`git fetch && git -C <agent-worktree> log --oneline -5 origin/<branch>`** — has the agent committed anything since dispatch? No commits + past expected duration = suspicious.
3. **`gh pr list --author "@me" --state open`** (or by branch prefix) — did a PR open since last check? A PR-open + no notification = completion with lost notification (rare but documented; see `[[claude-code-task-notification-no-toggle]]`).
4. **Compare against the expected-completion timestamp** recorded in `team/STATE.md` at dispatch time (cross-session continuity rule §1 already requires the Resume header to record in-flight agents; extend that to also record dispatch-time + expected-by).

**Verdict per agent (record in STATE.md tick summary):**

- **Alive + progressing** — recent TaskOutput output OR recent commit OR PR opened since the previous check. Cite the evidence (timestamp / SHA / URL).
- **Alive but slow** — recent output, past expected duration. Continue waiting; schedule the next check.
- **Likely dead** — no output for ≥ 2× expected duration AND no commits AND no PR. Mark stale → re-dispatch fresh OR escalate to sponsor with the evidence trail.

**Reporting back:**

- **On cron tick:** append per-agent verdict to STATE.md as part of the tick summary. Main-thread output stays terse (one line per agent + evidence cite).
- **On sponsor "Status":** main-thread per-agent one-liner with ground-truth evidence (last commit SHA OR PR URL OR "no output since `<timestamp>`; likely dead, re-dispatching"). Do NOT reply "still waiting on Felix" without first running TaskOutput + git fetch on Felix's worktree.
- **On orchestrator's own check-in:** silent if everything is alive + progressing. Surface only stale-or-dead findings.

**Why:** Real incidents on ClaudeTeam — orchestrator reported "still working on X" multiple times when the background agent had silently died, hung on a permission prompt, or completed with a lost notification. Sponsor caught it only by asking "Status" or "are you stuck?". The orchestrator's reflex was to restate the prior assumption rather than independently verify. The cost of a per-agent verification check is ~5 seconds; the cost of stale-state confidence is sponsor blocking on a dead agent for an entire cron cycle.

**Composition with other rules:**

- **Pairs with wake-signal discipline:** wake-signal ensures you wake up at the right time; staleness verification ensures you don't TRUST your prior mental model of agent state when you do wake up.
- **Pairs with cross-session continuity rule §1:** STATE.md "Resume" header should record dispatch-time + expected-completion timestamp for every in-flight agent, so staleness comparisons have a reference point that survives session restarts.
- **Does NOT override main-thread bloat discipline:** verification ritual's main-thread output is a per-agent one-liner with evidence cite (SHA / URL / timestamp), not multi-paragraph narration. Batch parallel `TaskOutput` + `git fetch` calls when N≥3 agents to keep dropdown count down.

**How to apply:** Every check-in trigger fires the ritual BEFORE the orchestrator responds. Never reply "still waiting on Felix" without first running `TaskOutput` for Felix's task ID + `git fetch && git log` on Felix's worktree. For 3+ in-flight agents, batch the checks via one parallel-Bash + parallel `TaskOutput` calls. Update STATE.md's in-flight section in the same tick.
```

---

## Composition with the 4 prior-applied rules (same session, 2026-05-25)

This is the 6th rule in the orchestrator-discipline cluster on user-global CLAUDE.md (after the 1 prior 2026-05-24 rule 6.6 additions + the 4 rules applied earlier today at commit `1a0fd9d`). Composition pairs:

- **Wake-signal discipline** (1st rule today): ensures the orchestrator wakes up at the right time on a time-critical event. This new rule extends it: when you do wake up, verify state from evidence rather than trusting prior beliefs.
- **Cross-session continuity** (2nd rule today): rule §1 requires the STATE.md Resume header to record in-flight agents. This new rule REQUIRES extending the header schema to ALSO record dispatch-time + expected-completion, so staleness comparisons have a reference point.
- **Main-thread bloat** (3rd rule today): governs the format of verification output (terse per-agent one-liners + evidence cite), not the substance.

The composition shape: wake-signal → cross-session continuity → staleness verification all share the same root failure mode (orchestrator's mental model of agent state diverges from reality). Each rule covers a different surface: when to wake, what to persist across sessions, how to verify on wake.

---

## STATE.md schema extension needed

The cross-session continuity rule §1 requires the STATE.md "Resume" header to record in-flight agents. This new rule extends the schema:

**Before (cross-session continuity §1 only):**
> "Felix + Maya in flight on M3-10 (agentIds afbefdae / a25a7b44); on resume, check worktrees first — if no branches pushed, re-dispatch fresh."

**After (with staleness extension):**
> "Felix in flight on M3-10 host (agentId afbefdae, dispatched 12:00Z, expected-by 13:30Z); Maya in flight on M3-10 webview (agentId a25a7b44, dispatched 12:00Z, expected-by 13:00Z). On resume OR on next check-in trigger, run verification ritual per [[background-agent-staleness-verification]] rule."

Convention applies on the NEXT dispatch. STATE.md currently shows "M3 Wave 1 FULLY CLOSED" with no in-flight agents — no retroactive update needed; the new convention applies on next active dispatch.

---

## Cross-references

- Applied rule lives in: `C:\Users\538252\.claude\CLAUDE.md` (section "Background-agent staleness verification", between "Orchestrator wake-signal discipline" and "Cross-session orchestrator continuity discipline")
- Sibling applied rules (same session): `team/log/applied/proposed-global-rule-{wake-discipline,cross-session-continuity,main-thread-bloat-discipline,parallel-agent-vocabulary-discipline}-2026-05-25.md`
- Memory: `[[claude-code-task-notification-no-toggle]]` — referenced by the rule for the "completion-with-lost-notification" failure mode
- Memory: `[[classifier-blocks-self-mod-of-orch-autonomy]]` — pattern that governs whether to direct-apply or stage; direct-apply was used here because sponsor's immediate-prior message was the authorization
- Sibling rule precedent: `team/log/applied/proposed-global-rule-wake-discipline-2026-05-25.md` — thematic parent
