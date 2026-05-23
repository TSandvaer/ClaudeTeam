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

Append new entries to [`team/log/process-incidents.md`](../../team/log/process-incidents.md) (with full symptom/cause/recovery/prevention narrative) and add a one-line terse summary to this list ONLY if the failure mode is recurring and dispatchers need to remember it inline.
