# Proposed global rule — Orchestrator main-thread bloat discipline

**Status:** staged — orchestrator cannot self-edit `~/.claude/CLAUDE.md` per memory `[[classifier-blocks-self-mod-of-orch-autonomy]]`. Sponsor reads + applies on return.

**Path of intended edit:** `C:\Users\538252\.claude\CLAUDE.md` (user-global, applies to ALL orchestrated projects on this machine).

**Authored:** 2026-05-25 by ClaudeTeam orchestrator after sponsor's repeated bloat call-outs across multiple sessions, including a concrete "look at this receipts" prompt where sponsor pasted 50K+ chars of conversation showing the volume.

---

## The incident (concrete trigger)

ClaudeTeam M3 Wave 1 — sponsor's bloat call-outs across multiple turns:

1. Sponsor shipped M3-08 ("main-thread merge-narration tightening" — `.claude/docs/orchestration-overview.md` section) precisely to codify one-line merge acks. Rule applied to merges but orchestrator continued bloating in other surfaces.
2. Sponsor sent screenshots showing a single rebase consuming 5 separate Bash dropdowns, full ~80-line dispatch briefs rendering in Agent tool dropdowns, predictive "next event" trailers after every tick, `grep -n -A 35` outputs printing 35-line backlog sections inline, etc.
3. Sponsor pasted ~50K chars of conversation transcript with the prompt *"read the entire conversation"* — implicitly: "look at what you actually produced, not what you committed to produce." Implicit ask: persist the bloat-cut commitments as a global rule so they stick across sessions and orchestrators.

The M3-08 rule covers one specific surface (merge-decision posts). This rule is broader — every kind of tool-call and orchestrator narration.

---

## The proposed global rule

Add to `~/.claude/CLAUDE.md` as a new top-level section, naturally after the "Cross-session orchestrator continuity discipline" section (once both prior staged rules are applied):

```
## Orchestrator main-thread bloat discipline

The orchestrator's main thread is the sponsor's only direct visibility
into orchestration. Every line printed costs sponsor attention and
context-window space. Apply these patterns by default; deviate only
when the deviation is load-bearing.

### 1. Chain related shell mechanics into one Bash call

Multi-step git/shell mechanics render as ONE dropdown when chained
with `&&` instead of N separate Bash calls. Chain fails loud —
per-step visibility into failures preserved inside the single
dropdown. Examples:

- Wrong (5 dropdowns): `git worktree add`, then `git rebase`, then
  `cat conflict-region`, then `git add`, then `git push`.
- Right (1 dropdown): `git worktree add ... && cd ... && git rebase
  ... && git add ... && git rebase --continue && git push
  --force-with-lease ...`

Applies to: rebase recovery, commit+push, multi-file staging, any
sequential mechanics that always go together.

### 2. Short dispatch briefs in main thread; full ACs in the ticket body

Sub-agent dispatch briefs in the Agent tool dropdown render verbatim
to the main thread. A typical 60-200 line brief (ACs, OOS, files in
play, lifecycle, reviewer, final-report contract) costs huge visible
surface. Keep main-thread brief to 10-30 lines max:

- Ticket ID + name (one line)
- Step 0 verbatim (the standard worktree cd + branch + pwd)
- State-shape contract or inter-agent coordination (one line if any)
- One-line scope hint per AC the agent owns
- OOS + reviewer + final-report contract (one line each)
- Pointer to the ClickUp ticket body for full ACs (agent reads via MCP)

The persona has MCP read access; it pulls ACs from ClickUp. The orch
brief is a routing slip, not a duplicated spec. Same applies for
agents without MCP access — point them at the backlog file or PR body.

### 3. No predictive trailers

After a substantive action, do NOT write "Next event: X will return"
or "Next cron at :07" or "Will dispatch Y when Z completes" or
"Waiting for the harness to notify me." Zero informational value —
sponsor can predict it from context. Cut.

### 4. No pre-tool one-liners for self-evident actions

Do NOT write "On it." / "Acknowledging." / "Dispatching X." / "Let
me check Y." before a tool call whose description already names the
action (Bash with description, Agent with description, Edit with
file path). Exception: when the action isn't self-evident OR an
orchestration decision precedes it (e.g., "Path A over Path B
because Z") — one line of decision rationale IS load-bearing.

### 5. No redundant MCP reads or file reads within a session

If you fetched a ClickUp ticket body 30 min ago and nothing has
changed (no other actor wrote — you'd see the change in chat if MCP
echoed back), cite from memory rather than re-fetching. Same for
file reads — if you read the file 5 turns ago and only your own
edits since, you know the current state.

### 6. No diagnostic state-check rituals when context already answers

When CI was last reported green minutes ago AND main hasn't moved
(verifiable from your own git pulls since), do NOT re-run `gh pr
view ... --json statusCheckRollup` before attempting merge. Just
attempt the merge — if it errors, you learn the state from the
error. The pre-check wastes a Bash dropdown.

Same for `git log --oneline -3` after every commit — the commit
output already showed the SHA + message. Skip the log-tail.

### 7. No Read-before-Edit when the old_string is uniquely identifiable

If the text to replace is unique enough that you can confidently
write old_string without re-reading the file (e.g., you wrote the
line yourself 2 turns ago + remember its exact shape), skip the
Read. Edit will error if old_string doesn't match — that's the
failsafe.

### 8. TodoWrite only on material status change

Do NOT re-print the full todo list on every Stop-hook reminder. Only
TodoWrite when a task transitioned (pending → in_progress →
completed), OR new tasks were added, OR a stale task was removed.
The reminder is not itself a trigger.

### 9. Prefer Read with offset/limit over `grep -n -A 35`

When pulling a known section of a long doc, `Read` with
`offset=X limit=N` is more compact than `grep -n -A 35 "## section"
file`. The Bash dropdown shows full `-A 35` output inline; Read's
dropdown is labeled by path + line range.

### 10. No commit-message + log-tail combos

`git commit -m "..." && git push && git log --oneline -3`
triple-prints the commit message (HEREDOC + commit-output + log).
Skip the trailing log-tail. Push output already confirms the
commit landed.

**Why:** Sponsor on ClaudeTeam M3 Wave 1 repeatedly called out
main-thread bloat ("still seeing a lot of clutter (bloat) in the
main chat"), including pasting back ~50K chars of orchestrator
conversation showing the volume. M3-08 covered one surface
(merge-decision posts); this rule is the broader sibling covering
every orchestrator tool-call surface. The orchestrator's
acknowledgment-then-regress pattern across sessions is itself
evidence that the discipline needs to be persistent and global,
not per-session sponsor reminders.

**How to apply:** Apply patterns by default in every orchestrator
turn. Deviate only when the deviation is load-bearing (e.g., a
new orchestration decision deserves one line of rationale before
the tool call). Some bloat sources are UNAVOIDABLE: commit-message
HEREDOCs (git nature), `<task-notification>` payloads
(`[[claude-code-task-notification-no-toggle]]` — GitHub #18544
closed not-planned), harness-injected sub-agent dispatch metadata.
Focus reduction on the avoidable surfaces (this rule's #1-10).
```

---

## Companion entry for `team/log/process-incidents.md`

Append after this session's other entries — see `## 2026-05-25 — Repeated sponsor bloat call-outs across sessions; staged main-thread bloat discipline rule`.

---

## How to apply this staged diff

When sponsor is back at the machine and ready to update global instructions:

1. Open `C:\Users\538252\.claude\CLAUDE.md`
2. Find the "Cross-session orchestrator continuity discipline" section (once applied per `team/log/proposed-global-rule-cross-session-continuity-2026-05-25.md`)
3. Insert the new "Orchestrator main-thread bloat discipline" section AFTER it
4. Optionally update memory entry `[[classifier-blocks-self-mod-of-orch-autonomy]]` to note this as the fourth known staged-diff-then-apply pattern (after rule 6.6 additions on 2026-05-24, wake-discipline on 2026-05-25, cross-session continuity on 2026-05-25)
5. Delete this staged file or move it to `team/log/applied/proposed-global-rule-main-thread-bloat-discipline-2026-05-25.md` as audit trail

---

## Cross-references

- Memory: `[[classifier-blocks-self-mod-of-orch-autonomy]]` — pattern this doc follows
- Memory: `[[session-bloat-distinct-from-project-bloat]]` — related framing (live-thread bloat tactics)
- Project doc: M3-08 shipped at PR #43 — `.claude/docs/orchestration-overview.md` § Main-thread narration discipline. This staged rule is the broader sibling.
- Staged: `team/log/proposed-global-rule-wake-discipline-2026-05-25.md` and `team/log/proposed-global-rule-cross-session-continuity-2026-05-25.md` — sibling staged rules
- Project doc: `team/log/proposed-rule-6.6-additions-2026-05-24.md` — original staged-diff precedent (now applied)
