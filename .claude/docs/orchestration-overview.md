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

**Sub-agent MCP gap (permanent).** Persona-declared `mcp__clickup__*` tools are NOT surfaced to sub-agent runtimes in the current Claude Code harness — confirmed 2026-05-23 by Bram's probe ([PR #2](https://github.com/TSandvaer/ClaudeTeam/pull/2), see `team/bram-research/probe-clickup-mcp.md`). This is structural harness behavior, not a transient connection gap (same filtering pattern as the `Agent` tool described in `agents/TEAM.md` line 39). The orchestrator owns ClickUp writes; sub-agents append intended transitions to `team/log/clickup-pending.md` as `ENTRY NNN: <ticket_id> -> <new_status>`, and the orchestrator flushes on each tick. Ticket creation, status flips, and comments happen from the orchestrator's surface — never from a sub-agent dispatch.

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
- **Sub-agent edits orchestrator-survey path** — a persona, asked to append to a shared coordination file (e.g. `team/log/clickup-pending.md`), edits the survey-root copy directly (`c:\Trunk\PRIVATE\ClaudeTeam\team\log\...`) instead of its own worktree copy. The edit isn't committed through their PR, but DOES leave the orchestrator's working tree dirty. Symptom: next `git pull --ff-only origin main` after a teammate's PR merges aborts with `error: Your local changes to the following files would be overwritten by merge`. Fix: discard the orchestrator-side edit (`git checkout HEAD -- <file>`) and pull. Prevention: dispatch briefs must instruct personas to write to `<base>-<role>-wt/<file>`, never to the survey path. Observed 2026-05-23 with Felix's M1-01 (PR #4) and Bram's M1-02.
- **Squash-merge incompatible with branch-internal merge commit** — when a sub-agent's branch has a `git merge origin/main` commit resolving a conflict, GitHub's `gh pr merge --squash` still fails with `is not mergeable: the merge commit cannot be cleanly created`. Squash-merge computes the diff from the merge-base, ignoring the branch's intermediate conflict resolution. Workarounds: (a) linearize via `git reset --soft origin/main && git commit -m "..."` then force-push (requires user permission for force-push under auto mode); (b) create a fresh branch from current main with a single re-committed change, close the old PR, open a new PR (no force-push needed). Use (b) when force-push is blocked. Observed 2026-05-23 — PR #5 (Bram's M1-02) had to be re-opened as PR #6.
- **Divergent section headers in `clickup-pending.md`** — when multiple PRs each create the "pending status flips" section under different names (e.g. `## PR transitions pending` vs. `## Status-flip queue`), the second-merging PR conflicts on the section header. Convention: once the canonical section `## Status-flip queue (sub-agent dispatch fallback)` exists on main, all subsequent persona PRs append their `ENTRY NNN:` lines INSIDE its existing code fence — they do NOT create a new section header. Updated in [agents/dispatch-template.md](../agents/dispatch-template.md) ClickUp lifecycle block on 2026-05-23.
