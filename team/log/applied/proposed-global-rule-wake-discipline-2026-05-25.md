# Proposed global rule — Orchestrator wake-signal discipline

**Status:** staged — orchestrator cannot self-edit `~/.claude/CLAUDE.md` per memory `[[classifier-blocks-self-mod-of-orch-autonomy]]`. Sponsor reads + applies on return.

**Path of intended edit:** `C:\Users\538252\.claude\CLAUDE.md` (user-global, applies to ALL orchestrated projects on this machine).

**Authored:** 2026-05-25 by ClaudeTeam orchestrator after a real "stuck" incident the sponsor caught.

---

## The incident (concrete trigger)

Timeline on 2026-05-24/25 ClaudeTeam M3 Wave 1 close:

1. **23:35Z** — Maya completes PR #45 peer review (APPROVE). Orchestrator attempts `gh pr merge 45 --admin --squash --delete-branch`.
2. **23:36Z** — Merge fails with `Pull Request has merge conflicts` (clickup-pending.md both-add: PR #45 and PR #46 both appended `86c9ybtut -> in review` ENTRY lines).
3. **23:38Z** — Orchestrator rebases via scratch worktree `/tmp/felix-rebase-tmp2`, manually merges (preserves BOTH entries, bumps Felix's timestamp by +1s), force-pushes-with-lease.
4. **23:40Z** — `gh pr view 45` shows `MERGEABLE` but CI `IN_PROGRESS` on the rebased SHA.
5. **23:40Z** — Orchestrator schedules a background Bash poll: `until gh pr view 45 ... | grep -v null | grep -qv ""; do sleep 10; done; gh pr view 45 ...` with `run_in_background: true`. Task ID `bbi9wve60`. Per Monitor-tool docs, this is the **documented correct pattern** for "tell me when X is ready."
6. **23:55Z** — Orchestrator emits "Waiting on PR #45 CI; will merge when green" and ends turn.
7. **~00:05Z** (~10 min later) — Sponsor wakes up, observes orchestrator idle, asks **"are you stuck right now?"**.
8. **00:08Z** — Orchestrator reads `bbi9wve60.output` directly and finds `(Bash completed with no output)` — the poll DID complete successfully (CI was green since 23:42Z), but no completion notification was ever surfaced to the orchestrator's main thread.

### Why cron didn't save the orchestrator in time

Cron `c0bc4c77` was alive on `7,22,37,52 * * * *`. Last fire was 23:52Z (handled). Next scheduled fire was 00:07Z — would have caught the mergeable PR and merged it. **Sponsor reached out ~10 min after the "Waiting" message — inside the 15-min cron gap.** So cron WOULD have caught it eventually (worst-case 15 min), but the gap exposed that **cron is not a tight-enough wake signal for fast-completing time-critical events**.

### Why the bash background notification didn't surface

Hypothesis (cannot prove from available logs): when a `Bash run_in_background: true` task completes with **zero stdout output**, the harness's completion-notification mechanism doesn't reliably render a `<task-notification>` to the orchestrator's main thread. The Monitor-tool docs implicitly recommend this exact pattern ("For 'tell me when X is ready,' use Bash `run_in_background` with an `until` loop"), but the recommendation assumes the notification reliably arrives. In practice, **a zero-output background bash exit silently dies as far as the orchestrator is concerned**.

(Independent: `Agent` tool dispatches with `run_in_background: true` notify RELIABLY — every sub-agent completion this session produced a `<task-notification>` exactly once. The flaw is bash-specific, not background-task-general.)

---

## The proposed global rule

Add to `~/.claude/CLAUDE.md` as a new top-level section after the existing "Sub-agent dispatch (background-only)" section:

```
## Orchestrator wake-signal discipline

When an orchestrator is waiting on a time-critical event before its next
useful action (CI completing, deploy finishing, external state changing),
it MUST have at least ONE active wake signal beyond auto-status cron. Cron
is the BACKSTOP (15-min worst case), not the primary.

**Reliable wake signals (use one):**
1. `Agent` tool dispatch with `run_in_background: true` — sub-agent
   completion notifies as `<task-notification>` exactly once, reliably.
   Trust this.
2. `ScheduleWakeup` with `delaySeconds` matched to expected event timing
   (60-270s for in-cache CI polls, 1200s+ for long fallbacks).
3. `Monitor` tool with `persistent: true` for indefinite event watches
   (per-occurrence notifications).

**Unreliable — DO NOT rely on as sole wake signal:**
- `Bash` with `run_in_background: true` for "wake me when X is ready"
  patterns (e.g., `until <condition>; do sleep N; done`). The bash
  completion notification has been observed to NOT surface when the
  task exits with zero stdout output. The Monitor-tool docs recommend
  this pattern for single-notification cases, but in practice it can
  silently fail — ALWAYS pair with `ScheduleWakeup` as belt-and-suspenders.

**Rules:**

1. **Never end a turn that's waiting on a time-critical event without
   an active wake mechanism beyond cron.** Compose: `<task-notification>`
   from an Agent dispatch OR Monitor OR ScheduleWakeup. Cron alone is
   not enough — 15-min worst case stuck-time is too long when the user
   may interrupt sooner.

2. **For waiting on CI/test/deploy completion on a force-pushed branch
   (the most common case):** prefer `ScheduleWakeup(180, "watching PR
   #N CI on rebased SHA after force-push")` over a bare `Bash
   run_in_background` poll. The wakeup is guaranteed to fire. Pair with
   the bash poll if you want the fast-path notification too.

3. **For waiting on a sub-agent peer-review completion or implementation
   completion:** Agent tool background dispatches notify reliably. Cron
   is the appropriate backstop.

4. **For long external waits (deploy, queue, manual sponsor action):**
   `ScheduleWakeup` at 1200s+ to stay outside the prompt-cache window.

5. **Diagnostic ritual on "are you stuck?":** when the user prompts
   with any variant of "are you stuck", "what's the status", or
   apparent surprise that the orchestrator is idle:
   (a) Read the relevant background-task output file directly.
   (b) `git fetch && gh pr list` — PRs may have changed.
   (c) Check `.claude/auto-status.state` last_tick — if much older than
   cron interval × 2, the cron died.
   (d) Audit in-flight Agent task expectations (they should have
   notified by now if completed).
   (e) Apply fix-forward immediately — investigate root cause AFTER
   unsticking. Capture the failure mode in this rule's "Why" section.

**Why:** A real incident on ClaudeTeam 2026-05-24/25 — orchestrator
relied on `Bash run_in_background` as the sole wake signal for a CI
poll on a force-pushed branch (per Monitor-tool documented pattern).
Bash poll completed successfully, but the zero-output completion did
NOT surface as a `<task-notification>`. Orchestrator was effectively
stuck for ~10 min until sponsor reached out. Cron would have caught it
within 15 min but sponsor noticed first — exposing the gap. The cost
of pairing wake signals is low (one ScheduleWakeup call); the cost of
a silently-stuck orchestrator is high (user trust + perceived
responsiveness + wasted heartbeat capacity).

**How to apply:** Every orchestrator turn that ends with "waiting"
status MUST have at least one wake signal from the reliable list above
active. If you're about to end a turn and the only thing keeping you
alive is the auto-status cron, ADD a ScheduleWakeup or Monitor first.
Treat cron as the backstop only.
```

---

## How to apply this stage diff

When sponsor is back at the machine and ready to update global instructions:

1. Open `C:\Users\538252\.claude\CLAUDE.md`
2. Find the existing "Sub-agent dispatch (background-only)" section heading
3. Insert the new "Orchestrator wake-signal discipline" section AFTER it (before "maintain-docs invocation policy" or wherever the natural location is — sponsor's call)
4. Optionally update the memory entry `[[classifier-blocks-self-mod-of-orch-autonomy]]` to note that wake-signal discipline was the second known case of staged-diff-then-apply pattern (after rule 6.6 additions on 2026-05-24)
5. Delete this staged file or move it to `team/log/applied/proposed-global-rule-wake-discipline-2026-05-25.md` as audit trail

---

## Companion entry for `team/log/process-incidents.md`

Already added — see entry `## 2026-05-24/25 — Orchestrator stuck on Bash background CI poll (zero-output completion notification didn't surface)`.

---

## Cross-references

- Memory: `[[classifier-blocks-self-mod-of-orch-autonomy]]` — pattern this doc follows
- Project doc: `team/log/proposed-rule-6.6-additions-2026-05-24.md` — prior staged-diff precedent (now applied)
- Memory: `[[always-background-dispatch-subagents]]` — related: Agent dispatches MUST be background. This new rule clarifies that Bash backgrounds need wake-signal pairing.
