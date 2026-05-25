# Applied global rule — Sub-agent worktree-concurrency discipline

**Applied:** 2026-05-25 by orchestrator on sponsor's explicit "make sure to persist in global orchestration rules 'orchestrator should not dispatch two tasks to same persona's worktree concurrently'" directive.

**Inserted into:** `C:\Users\538252\.claude\CLAUDE.md` as a new top-level section `## Sub-agent worktree-concurrency discipline`, placed between `## Sub-agent dispatch (background-only)` and `## Orchestrator wake-signal discipline` (both deal with sub-agent dispatch hygiene; new rule sits with them thematically).

## Triggering incident

ClaudeTeam session 2026-05-25 (this session). Sequence:

1. Sponsor authorized dispatch of two tasks: `86c9yfj5e` (PR #49 retro typo fix — Nora-owned) and `86c9y7y9z` (M2-04 NITs — Felix-owned).
2. Orchestrator dispatched both in parallel (background, per `[[always-background-dispatch-subagents]]`). Different personas, different worktrees. Safe.
3. Nora completed PR #49 retro typo (PR #51) in ~1 min.
4. Orchestrator immediately dispatched Felix for PR #51 peer-review per cross-review pairing convention (Felix raised the original PR #49 NIT, so natural reviewer).
5. **PROBLEM:** Felix was still in-flight on `86c9y7y9z`. Both Felix dispatches targeted `c:/Trunk/PRIVATE/ClaudeTeam-felix-wt`.
6. Orchestrator noticed the collision before any damage — Felix-reviewer had only checked CI counts, hadn't yet executed `gh pr checkout 51` in Step 0.
7. `TaskStop` killed the reviewer dispatch (task `ab81f56a5417c41dd`). No worktree corruption.

**Cost of the near-miss:** ~30 sec to detect + 5 sec to `TaskStop` + future re-dispatch needed (~5-10 min). Cost if undetected: worktree branch would have shifted under Felix-M2-04, requiring `git reflog` recovery + manual branch restore + agent re-dispatch from the recovered branch (~15-30 min if simple, longer if uncommitted edits were lost).

## Rule text (verbatim insertion into `~/.claude/CLAUDE.md`)

```
## Sub-agent worktree-concurrency discipline

When dispatching sub-agents via the `Agent` tool, NEVER dispatch two tasks to the same persona's worktree concurrently. Each persona has ONE physical worktree (e.g. `<project>-felix-wt`, `<project>-maya-wt`); two simultaneous Agent dispatches against the same worktree race on `git checkout` / `gh pr checkout` operations and can corrupt in-progress work.

[Rules 1-5, Why, How to apply — see ~/.claude/CLAUDE.md for full text]
```

## Composition with prior rules

- **Pairs with `[[always-background-dispatch-subagents]]`** — background dispatch is a precondition for the concurrency check (you have a `TaskList` to scan against).
- **Pairs with project's cross-review pairing convention** — when the natural reviewer's worktree is busy, route to the cross-review counterpart (e.g. Felix↔Maya).
- **Pairs with cross-session continuity rule §1** — STATE.md's Resume next-action should record per-persona in-flight task IDs so the next session resumes the concurrency check correctly.

## Open question (sponsor decision needed)

Should this discipline ALSO be enforced by automation (e.g. an orchestrator-side pre-dispatch hook that scans `TaskList` for the same worktree before allowing `Agent` to be called)? Or is the discipline-in-the-rule enough? Manual discipline is fragile (this near-miss is evidence); a hook would be more robust but adds orchestration plumbing complexity.
