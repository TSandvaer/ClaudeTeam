# Orchestration Overview

How the orchestrator runs ClaudeTeam. This doc is the canonical coordination reference for in-session conventions.

## Roles

- **Orchestrator** — the Claude Code main session. Briefs agents, gates PRs, merges. **Never codes.**
- **Six sub-agents** — Nora, Iris, Felix, Maya, Sage, Bram. See [agents/TEAM.md](../agents/TEAM.md) for full roster.
- **Sponsor** — Thomas. Talks only to the orchestrator.

## Worktrees

One worktree per role, persistent across dispatches. All worktrees live alongside the project root:

```
c:\Trunk\PRIVATE\ClaudeTeam              ← orchestrator survey (READ-ONLY for code)
c:\Trunk\PRIVATE\ClaudeTeam-nora-wt      ← Nora's worktree (branch: nora/idle)
c:\Trunk\PRIVATE\ClaudeTeam-iris-wt      ← Iris's worktree
c:\Trunk\PRIVATE\ClaudeTeam-felix-wt     ← Felix's worktree
c:\Trunk\PRIVATE\ClaudeTeam-maya-wt      ← Maya's worktree
c:\Trunk\PRIVATE\ClaudeTeam-sage-wt      ← Sage's worktree
c:\Trunk\PRIVATE\ClaudeTeam-bram-wt      ← Bram's worktree
```

**Single-tenancy rule:** only one agent may use a role worktree at a time. Spawning two agents to the same worktree produces write conflicts and ticket-status collisions.

**Branch-per-dispatch:** every dispatch starts with `git checkout -B <role>/<id>-<slug> origin/main`. The `-B` flag force-creates from `origin/main`, discarding prior branch state.

**Cleanup before merge:** before `gh pr merge --delete-branch`, the role worktree must detach from the branch — otherwise `--delete-branch` local cleanup fails. Either the agent does `git switch --detach HEAD` at end of task, or the orchestrator does it from the survey root before merging.

## Dispatch

Every dispatch brief MUST include the mandatory blocks from [agents/dispatch-template.md](../agents/dispatch-template.md):

1. **Step 0** — `cd <worktree>` + `git fetch` + `git checkout -B`.
2. **Doc preload preamble** — sub-agents do NOT inherit SessionStart docs-load; tell them to Read every `.claude/docs/*.md`.
3. **Scoped contract** (for non-trivial tickets) — Goal / AC / OOS / Done-when / Files-in-play.
4. **ClickUp lifecycle** — paired flips (to do → in progress on accept; in progress → in review on PR open).
5. **Tightened final-report contract** — ≤200 words, cite-able evidence.
6. **Non-obvious findings postamble** — surface gotchas in PR body for maintain-docs to capture.

Plus context-dependent blocks (Self-Test Report for UX-visible, background tripwire for `run_in_background`).

## Parallel dispatch

Default density: **3–5 agents in flight simultaneously**. Tickets aren't progress, dispatches are. The orchestrator's job is to keep the team busy on independent lanes.

Track-based routing (most common assignments):
- **Extension host / data / parser work** → Felix.
- **Webview / UI / styling / interaction** → Maya.
- **Tickets / specs / acceptance criteria / retros** → Nora.
- **Design specs / wireframes / tokens** → Iris.
- **Test plans / QA passes / regression** → Sage.
- **Claude Code internals research / prior-art comparison** → Bram.

Cross-lane: when a ticket spans surfaces, decompose into one ticket per lane and dispatch in parallel.

## Background agents

Every `run_in_background: true` Agent dispatch MUST be paired with a `ScheduleWakeup` tripwire at ~2× the agent's expected duration. Background agents die silently; the wakeup is the only signal that anything went wrong.

Background agents must `git commit && git push` after each milestone — uncommitted work in a dead agent's worktree is lost.

## PR & merge protocol

1. **Author opens PR** with `gh pr create` and `--body-file` (never inline `--body "..."` — heredocs and inline strings stall on markdown special characters).
2. **Author posts Self-Test Report** (for UX-visible PRs).
3. **Author moves ticket `in progress → in review`** (paired with PR open).
4. **Peer-reviewer reviews:**
   - Felix's PRs → Maya reviews.
   - Maya's PRs → Felix reviews.
   - Iris's PRs → Maya (visual) or Felix (data-shape).
   - Sage's PRs → Felix (host-side) or Maya (webview).
   - Bram's PRs → orchestrator-merge direct.
   - Nora's PRs → orchestrator-merge direct unless they touch shared coordination docs.
5. **Sage QAs** UX-visible PRs (per testing-strategy.md). REQUEST CHANGES or APPROVE.
6. **Orchestrator admin-merges:** `gh pr merge --admin --squash --delete-branch`.
7. **Orchestrator moves ticket `in review → complete`** (paired with merge).

`gh pr review --approve` may be blocked by shared git identity. Fall back to `gh pr comment --body-file <path>` with the verdict header `## REVIEW VERDICT: APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES` followed by per-finding bullets. Three valid verdicts — `APPROVE_WITH_NITS` is mergeable + ships a follow-up ticket for the nits (used 1× this session on M1-09; nits filed under `86c9y6e17` and shipped in PR #18 without blocking M1's merge).

**Reviewer-side checkout pattern (prefer over `gh pr checkout`).** When a peer-reviewer pulls down a PR to verify locally, use:

```bash
git -C <reviewer-wt> fetch origin pull/<n>/head:pr-<n>-review
git -C <reviewer-wt> checkout pr-<n>-review
```

This creates a throwaway local-only branch that does NOT bind the reviewer's worktree to the author's branch. `gh pr checkout <n>` does bind, which blocks the orchestrator's subsequent `gh pr merge --delete-branch` until the reviewer detaches (see `team/log/process-incidents.md` "Peer-reviewer worktree blocks `gh pr merge --delete-branch`"). The fetch-into-local-branch pattern is the upstream prevention — eliminates the failure mode entirely instead of recovering from it. Pattern source: sibling project MarianLearning's dispatch-template. Validated 3× this session (Maya reviewing PR #14 + PR #18, Felix reviewing PR #15) — zero `--delete-branch` blocks after adopting.

Whichever pattern the reviewer uses, **end with `git switch --detach HEAD`** — defense-in-depth.

### Main-thread narration discipline

The main conversation window is the orchestrator's working surface — every line written there is paid for in context. After an auto-merge, the orchestrator posts **one line** to the main thread: `PR #N auto-merged — decision logged`. That's it. The detailed `Decided / Foundation / Alternative / Reversibility / Status` block lives in [`.claude/decisions-while-away.md`](../decisions-while-away.md) — it is the audit record. Do NOT duplicate audit content in the main conversation; the sponsor reads the log on return, not the chat backscroll.

Same discipline applies upstream to dispatch-brief authoring: briefs are terse, point at backlog sections and contract docs by path, and do not re-state spec content the agent will read directly. M2 already followed this for dispatch; the merge-decision post is the remaining surface.

**Motivation (M2-close retro).** The retro flagged "10-20 lines per auto-merge × 10+ per milestone" as a context-bloat surface that compounds across the session. At one orchestrator-narrated milestone close, the narration alone consumed more main-thread bytes than any single dispatch brief — pure overhead, because the structured log was already written. One-line acknowledgment + log pointer eliminates the duplication.

## ClickUp as hard gate

Every dispatch / PR-open / merge pairs with a ClickUp status flip in the same tool round. Status names (case-sensitive): `to do` → `in progress` → `in review` → `complete`.

**Sub-agent MCP gap (permanent).** Persona-declared `mcp__clickup__*` tools are NOT surfaced to sub-agent runtimes in the current Claude Code harness — confirmed 2026-05-23 by Bram's probe ([PR #2](https://github.com/TSandvaer/ClaudeTeam/pull/2), see `team/bram-research/probe-clickup-mcp.md`). This is structural harness behavior, not a transient connection gap (same filtering pattern as the `Agent` tool described in `agents/TEAM.md` line 39). The orchestrator owns ClickUp writes; sub-agents append intended transitions to `team/log/clickup-pending.md` as `ENTRY NNN: <ticket_id> -> <new_status>`, and the orchestrator flushes on each tick. Ticket creation, status flips, and comments happen from the orchestrator's surface — never from a sub-agent dispatch.

## Autonomy log

Every autonomous orchestrator decision is appended to [.claude/decisions-while-away.md](../decisions-while-away.md) with the schema defined in user-global CLAUDE.md (`Decided / Foundation / Alternative / Reversibility / Status`). Sponsor reviews on return; updates `Status` to `accepted` or `reversed`. Calibration target: 5–10% reversal rate.

## Away queue

Items requiring sponsor sign-off go in [.claude/away-queue.md](../away-queue.md). The orchestrator does NOT auto-decide on:
- Strategic priority shifts (which milestone ships next, scope cuts, sequence changes).
- Subjective-feel calls (visual polish, motion feel, design aesthetic).
- Externally-visible actions (Teams/Slack posts, force-push, deletes, third-party API calls).
- Billing / credit usage / infrastructure config.

## Common failure modes (stable rules)

These are the **stable, terse rules** every session needs in eager context. Detailed write-ups of past incidents — symptom / cause / recovery / prevention narrative for each — live in [`team/log/process-incidents.md`](../../team/log/process-incidents.md) (lazy-loaded chronicle, consulted on per-need basis).

- **Sub-agent inherits orchestrator cwd** — Step 0 was omitted from the brief. Always include it verbatim. Briefs must use `cd <worktree>`, not just name the worktree path.
- **`gh pr` stalls on markdown special characters** — never use inline `--body "..."` or heredocs; always `--body-file <path>`. Applies to `gh pr create`, `gh pr comment`, `gh issue create/comment`.
- **`--delete-branch` fails locally when a worktree holds the branch** — author and peer-reviewer worktrees must `git switch --detach HEAD` before posting their final report. Every dispatch brief ends with the detach step.
- **Background agent dies silently** — no `ScheduleWakeup` tripwire was set, or wakeup was longer than the expected duration. Set tripwires at ~2× expected duration.
- **Fabricated cites in research notes** — Bram (or any agent) reports a path/SHA/function that doesn't exist. Verify cited URLs/SHAs/artifacts before downstream action.
- **Sub-agent edits orchestrator-survey path** — dispatch briefs MUST tell personas to write to `<base>-<role>-wt/<file>`, never to the survey path. The survey root is READ-ONLY for code.
- **Squash-merge fails on branch-internal merge commits** — when a feature branch has a `git merge origin/main` commit, `gh pr merge --squash` rejects it. Use `git rebase origin/main` (force-push) or cherry-pick onto a fresh branch.
- **`git reset --soft` is NOT a linearization tool** — soft-resetting to current main then committing DELETES every file added to main since the fork point. Use `git rebase` or `git cherry-pick` instead.
- **Divergent section headers in `clickup-pending.md`** — once the canonical section `## Status-flip queue (sub-agent dispatch fallback)` exists on main, all subsequent persona PRs append `ENTRY NNN:` lines INSIDE its existing code fence — they do NOT create a new section header.
- **ENTRY-number collision in `clickup-pending.md`** — parallel sub-agent dispatches each pick the next sequential `ENTRY NNN:` from current main, so two dispatches in the same round → same N → merge conflict on the second PR. Recovery: orchestrator rebases the colliding PR on current main and drops the colliding commit (`git rebase --skip` at the conflict); canonical entry for the dropped flip is added by the orchestrator post-merge as part of the merge-flip pair. Prevention applied 2026-05-24: timestamp-based IDs per `.claude/agents/dispatch-template.md` § Status-flip queue. Legacy sequential IDs in entries dated before 2026-05-24 remain as historical. Hit 1× this session — PR #22 (Felix M2-01) and PR #19 (Nora M2-09) both took ENTRY 014 for different tickets.
- **`mcp__clickup__update_task` blocked by auto-mode classifier (non-deterministic boundary) — RESOLVED for this project** — the auto-mode classifier sometimes denies ClickUp status flips, treating them as "externally-visible actions on pre-existing state" requiring explicit per-action authorization. Initial hypothesis was that only tickets created in a *prior session* were affected, but a second hit (2026-05-24, ticket `86c9y9q6h`, M2-06 — created in the *same* Claude-process session ~20 min earlier, after a cron-tick boundary) shows the classifier denial can occur regardless of when the ticket was created. The true trigger is unknown (candidates: time-elapsed, cron-tick context-reload, non-deterministic classifier sampling). **Permanent fix applied 2026-05-24:** `mcp__clickup__update_task` added to project `.claude/settings.json` allow-list (sponsor authorized) — orchestrator ClickUp writes are now unconditionally permitted for ClaudeTeam, classifier bypassed. Other orchestrated projects without the rule will still hit this — recovery there is to surface the intended flip to sponsor via AskUserQuestion, leave the ticket unchanged + comment as audit trail. Hits before fix: 2026-05-24 — `86c9y7y9z` (M2-04 NITs, prior-session ticket; sponsor chose comment-only audit), `86c9y9q6h` (M2-06, same-session ticket after cron tick).

- **Parallel-Agent batch silently drops one call** — when authoring multiple `Agent` calls in one batch, one call can be silently omitted between reasoning-phase brief authoring and tool-call submission; the missing dispatch is undetectable until the expected completion never arrives (~5–10 min later), and any `decisions-while-away.md` entry written in the same turn will falsely claim both fired. Prevention: before submitting a multi-Agent batch, state the intended dispatch count in user-visible text (e.g. "dispatching 2 agents: Nora + Bram") and verify the tool-call array contains exactly that many `Agent` entries. For batches ≥3, prefer sequential dispatch unless parallelism is load-bearing. Recovery: re-dispatch the missing agent on the next turn and amend the spurious decisions-log entry (`claim — agent NOT actually dispatched, see <HHMM> UTC entry below`).
- **Parallel-orchestrator race condition (two Claude Code sessions on the same project)** — if the sponsor has two Claude Code sessions open against the same project worktree, both sessions' cron + away-mode loops will fire independently and BOTH will try to merge PRs, flip ClickUp tickets, dispatch agents, and edit `STATE.md` / `decisions-while-away.md` / `auto-status.state` / `clickup-pending.md`. Symptoms: (a) PR shows MERGED at a SHA you didn't push, (b) the coord-log file has entries appearing "from nowhere" between your last read and current state, (c) `auto-status.state` `last_tick` skips ahead, (d) ClickUp tickets flip status without your tool call. Recovery: minimize duplicate work — before any merge / status-flip / dispatch action, re-read the authoritative state (`gh pr view --json state`, `mcp__clickup__get_tasks`, `git fetch && git log origin/main`); skip the action if it's already been done. Prevention: only ONE Claude Code session should orchestrate a given project at a time. When the sponsor opens a second window for the same project, surface this explicitly and ask which session is canonical — kill the other's `auto-status` (`/auto-status off`) before resuming work. Hit 1× this session — parallel session merged PR #35 + queued NEW-TICKET-REQUEST while this session was mid-rebase.
- **Orch-side rebase conflict resolution: ALWAYS Read-before-Edit, and verify after `rebase --continue`** — when the orchestrator resolves a rebase conflict (e.g. log-only-conflict per CLAUDE.md rule 6.6 #5), two failure modes compose dangerously: (a) `Edit` fails silently if the file wasn't `Read` first in the conversation; (b) `git add <file> && git rebase --continue` accepts whatever is staged AS-IS — it does NOT re-detect conflict markers, so unresolved `<<<<<<<` / `=======` / `>>>>>>>` lines get committed into history. Recovery: `git reset --hard origin/<branch>` to restore the pre-rebase remote state (assuming you haven't force-pushed yet), then redo with Read-then-Edit-then-continue. Additionally: when BOTH PRs ADD to the same coord-log file (one PR appends entries, the other appends a marker), pure `git checkout --ours <log-file>` would LOSE the other side's add — manual merge to preserve BOTH adds is required, not the one-liner `--ours` recovery. Hit 1× this session on PR #35 (Felix's M3-01 ENTRY add collided with main's M3-05 switchover marker). Prevention: any orch Edit call against a conflicted file MUST be preceded by Read in the same session; after `rebase --continue` runs, ALWAYS verify the resolved hunk via `git show HEAD~N -- <file>` before force-pushing.
- **Foreground sub-agent dispatch blocks the orchestrator and floods the main thread** — `Agent` calls without `run_in_background: true` are synchronous: the orchestrator cannot respond to the sponsor until the sub-agent returns (often 5–15 min for substantive work), AND every sub-agent tool call (`Read`/`Bash`/`Edit`/etc.) streams into the sponsor's main view in real time, drowning the orchestrator's own messages. The sponsor can only interrupt by rejecting the in-flight tool use entirely — losing partial work and forcing a re-dispatch. **Prevention: every `Agent` call from the orchestrator MUST use `run_in_background: true`** (optional `name:` for `SendMessage` addressability). The harness notifies the orchestrator on completion; in the meantime the orchestrator stays free to answer sponsor questions, do other tick work, or merge unrelated PRs. Foreground dispatch is acceptable only when the orchestrator genuinely cannot proceed without the result before its next response — rare in well-designed orchestration. Documented after sponsor explicit feedback 2026-05-24 — foreground Felix M3-01 dispatch flooded the main view and had to be rejected mid-flight. See memory `[[always-background-dispatch-subagents]]`.

Append new entries to [`team/log/process-incidents.md`](../../team/log/process-incidents.md) (with full symptom/cause/recovery/prevention narrative) and add a one-line terse summary to this list ONLY if the failure mode is recurring and dispatchers need to remember it inline.
