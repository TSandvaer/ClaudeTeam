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

`gh pr review --approve` may be blocked by shared git identity. Fall back to `gh pr comment --body-file <path>` with "APPROVE" in the body.

## ClickUp as hard gate

Every dispatch / PR-open / merge pairs with a ClickUp status flip in the same tool round. Status names (case-sensitive): `to do` → `in progress` → `in review` → `complete`.

If MCP is unreachable, the agent appends the intended transition to `team/log/clickup-pending.md` as `ENTRY NNN: <ticket_id> -> <new_status>`. The orchestrator flushes on reconnect.

## Autonomy log

Every autonomous orchestrator decision is appended to [.claude/decisions-while-away.md](../decisions-while-away.md) with the schema defined in user-global CLAUDE.md (`Decided / Foundation / Alternative / Reversibility / Status`). Sponsor reviews on return; updates `Status` to `accepted` or `reversed`. Calibration target: 5–10% reversal rate.

## Away queue

Items requiring sponsor sign-off go in [.claude/away-queue.md](../away-queue.md). The orchestrator does NOT auto-decide on:
- Strategic priority shifts (which milestone ships next, scope cuts, sequence changes).
- Subjective-feel calls (visual polish, motion feel, design aesthetic).
- Externally-visible actions (Teams/Slack posts, force-push, deletes, third-party API calls).
- Billing / credit usage / infrastructure config.

## Common failure modes

- **Sub-agent inherits orchestrator cwd** — Step 0 was omitted from the brief. Always include it verbatim.
- **`gh pr` stalls on markdown special characters** — never use inline `--body "..."` or heredocs; always `--body-file <path>`.
- **`--delete-branch` fails locally** — role worktree still on the branch. Detach before merging.
- **Background agent dies silently** — no `ScheduleWakeup` tripwire was set, or wakeup was longer than the expected duration. Set tripwires at ~2× expected duration.
- **Fabricated cites in research notes** — Bram (or any agent) reports a path/SHA/function that doesn't exist. The orchestrator's verification step before acting catches this; verify cited URLs/SHAs/artifacts before downstream action.
