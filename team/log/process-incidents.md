# Process Incidents — append-only chronicle

Failure modes observed in this project's orchestration. Append a new entry whenever a process-class failure happens (not a code bug — a coordination / workflow / harness failure that future sessions could repeat). The maintain-docs Stop hook and the orchestrator's resume reading should NOT eagerly load this file; it is a **per-need reference** consulted when a known-class failure recurs or when a retro author audits patterns.

Why this file exists separately from `.claude/docs/orchestration-overview.md`: `orchestration-overview.md` is auto-loaded into every session start via the SessionStart hook. Letting failure-mode entries accumulate there means every future session pays an ever-growing context cost on load for history most sessions never need. This file is the opt-in chronicle; `orchestration-overview.md` keeps the stable patterns.

**Entry format:**

```
## YYYY-MM-DD — <short headline>

**Symptom:** <what was observed>
**Cause:** <root cause>
**Recovery:** <what was done>
**Prevention:** <rule / template change applied>
**Code/process pointer:** <PR / SHA / doc-section reference>
```

Append below. Newest entries at the top.

---

## 2026-05-24 — Parallel-orchestrator race (two Claude Code sessions on same project)

**Symptom:** During M3 Wave 0, a second Claude Code session was orchestrating ClaudeTeam in parallel — its cron tick + away-mode loop ran independently of the primary session. Symptoms observed: (a) PR #35 showed MERGED at a commit SHA the primary session didn't push; (b) `team/log/clickup-pending.md` had entries appearing "from nowhere" between the primary's last read and current state; (c) NEW-TICKET-REQUEST blocks were resolved by the parallel session while the primary was mid-rebase. Sponsor noticed the divergent activity and told the parallel thread to save + step down.

**Cause:** SessionStart hook auto-re-armed auto-status on the second session because `auto-status.state` still had `enabled=true` from a prior fresh session boundary. Both sessions then ran the same `7,22,37,52 * * * *` cron and each thought it was the canonical orchestrator. There is no machine-level lock — the state file is single-writer-assumed.

**Recovery:** Sponsor told the parallel session to `/save-session`; primary session absorbed the parallel's state via the saved-session one-liner (already had the merge/edits propagated via origin). Both sessions then had `/auto-status off` applied. The primary continued M3 Wave 0 dispatch from the absorbed state without re-doing work.

**Prevention:**
- **Only ONE Claude Code session should orchestrate a given project at a time.** When opening a second window, kill the other's `auto-status` via `/auto-status off` first.
- Before any merge / status-flip / dispatch action, re-read authoritative state: `gh pr view --json state`, `mcp__clickup__get_tasks` (when MCP live), `git fetch && git log origin/main`. Skip the action if it's already been done.
- One-line terse summary added to `.claude/docs/orchestration-overview.md` § Common failure modes for inline awareness in future session loads.

**Code/process pointer:** Hit 1× this session. Terse pointer in `.claude/docs/orchestration-overview.md` § Common failure modes (line ~128). Full narrative here. Memory entry `[[parallel-orchestrator-race-condition]]` may be worth saving if this recurs across other orchestrated projects.

---

## 2026-05-23 — Peer-reviewer worktree blocks `gh pr merge --delete-branch`

**Symptom:** Orchestrator's `gh pr merge --admin --squash --delete-branch` succeeded the remote merge but failed local branch delete with `cannot delete branch ... used by worktree at <reviewer-wt>`.

**Cause:** When a sub-agent does `gh pr checkout <N>` to verify a PR's done-when test locally, their worktree gets bound to the author's branch. If they don't `git switch --detach HEAD` before posting their final report, the branch stays claimed when the orchestrator tries to delete it.

**Recovery:** Detach the reviewer's worktree (`git -C <reviewer-wt> switch --detach HEAD`), `git branch -D <branch>` locally, then `git pull --ff-only origin main` to pick up the squash-merge that already happened on remote.

**Prevention:** Every peer-review dispatch brief must end with the detach step. Same applies to author dispatches — final step of every persona dispatch SHOULD be `git switch --detach HEAD` so worktrees never hold a branch the orchestrator needs to delete.

**Pointers:** PR #12 (Maya reviewing Felix's M1-06), PR #13 (Felix's worktree still on his own M1-07 branch). Commit `57c78a7` captures the failure mode in `orchestration-overview.md` (since extracted to this file).

---

## 2026-05-23 — Divergent section headers in `clickup-pending.md`

**Symptom:** When multiple PRs each created the "pending status flips" section under different names (e.g. `## PR transitions pending` vs. `## Status-flip queue`), the second-merging PR conflicted on the section header.

**Cause:** No canonical section name was specified in the dispatch template; each persona picked their own.

**Recovery:** Manual conflict resolution + canonicalization to `## Status-flip queue (sub-agent dispatch fallback)`.

**Prevention:** Once the canonical section exists on main, all subsequent persona PRs append their `ENTRY NNN:` lines INSIDE its existing code fence — they do NOT create a new section header. Updated in [agents/dispatch-template.md](../../.claude/agents/dispatch-template.md) ClickUp lifecycle block on 2026-05-23.

---

## 2026-05-23 — `git reset --soft` deleted 10 files from a "linearization" PR

**Symptom:** An attempted linearization of Felix's M1-01 via `git reset --soft origin/main && git commit` (PR #8) silently DELETED 10 files added by PR #3 + PR #6 + commit `89fa86f` — Iris's CLI output spec, Bram's 7 fixtures + research note, 3 failure-mode doc entries, dispatch-template ClickUp lifecycle update.

**Cause:** `git reset --soft` preserves the BRANCH'S TREE STATE (all files on disk as they were at the branch tip). A branch forked from an old base, soft-reset to current `origin/main`, then committed produces a single commit whose tree = the branch's tree = MISSING every file added to main since the fork point. Committing this **deletes that newer content on merge**.

**Recovery:** `git checkout <prior-sha> -- <paths>` to restore each file from its source commit, then commit + push. Recovery commit: `f870bef`.

**Prevention:** The correct linearization tools are `git rebase` (force-push required, requires user permission) and `git cherry-pick` (apply branch's commits onto a new branch from current main; no force-push needed). NEVER use `git reset --soft` for linearization. Memory: `feedback_linearize_via_rebase_or_cherrypick`.

---

## 2026-05-23 — Squash-merge incompatible with branch-internal merge commit

**Symptom:** When Bram's M1-02 branch had a `git merge origin/main` commit resolving a conflict, GitHub's `gh pr merge --squash` failed with `is not mergeable: the merge commit cannot be cleanly created`.

**Cause:** Squash-merge computes the diff from the merge-base, ignoring the branch's intermediate conflict resolution. The branch tree at PR-tip differs from the squash-computed tree in unrecoverable ways.

**Recovery:** Closed PR #5; opened PR #6 by cherry-picking Bram's commits onto a fresh branch from current main.

**Prevention:** When a branch needs to incorporate `origin/main` updates mid-PR, prefer `git rebase origin/main` (force-push needed) over `git merge origin/main`. Or open the PR fresh via cherry-pick. Document in dispatch briefs that explicit-merge-into-feature-branch is a squash-merge incompatibility risk.

---

## 2026-05-23 — Sub-agent edits orchestrator-survey path instead of worktree

**Symptom:** A persona asked to append to a shared coordination file (`team/log/clickup-pending.md`) edited the survey-root copy directly (`c:\Trunk\PRIVATE\ClaudeTeam\team\log\...`) instead of its own worktree copy. The edit wasn't committed through their PR, but DID leave the orchestrator's working tree dirty. Next `git pull --ff-only origin main` after a teammate's PR merged aborted with `error: Your local changes to the following files would be overwritten by merge`.

**Cause:** Sub-agents inherit the orchestrator's CWD unless Step 0 (`cd <worktree-path>`) is explicit. Without it, all file-modifying tool calls land in the survey path.

**Recovery:** Discard the orchestrator-side edit (`git checkout HEAD -- <file>`) and pull.

**Prevention:** Dispatch briefs must instruct personas to write to `<base>-<role>-wt/<file>`, NEVER to the survey path. Step 0 (`cd <role-worktree>`) is mandatory and must be the literal first action of every brief. Updated in [agents/dispatch-template.md](../../.claude/agents/dispatch-template.md) on 2026-05-23. Observed with Felix's M1-01 (PR #4) and Bram's M1-02.

---

## 2026-05-23 — Sub-agent inherits orchestrator cwd (general class)

**Symptom:** Sub-agent's edits to source files land in the orchestrator-survey root instead of the assigned worktree. Branches collide; merge cleanup short-circuits.

**Cause:** Step 0 was omitted from the brief, OR named the worktree without an explicit `cd` command. Sub-agent shell tools inherit the orchestrator's working directory; naming the worktree path in the brief is not sufficient.

**Recovery:** `git -C <root> diff` to capture the patch, apply in the target worktree via `git -C <target-wt> apply`, then `git -C <root> checkout -- .` and clean untracked files.

**Prevention:** Every dispatch brief MUST begin with a verbatim Step 0 block (see `.claude/agents/dispatch-template.md` §1). This is recurring across all orchestrated projects on this machine (also observed in RandomGame, Devon W1, 2026-05-22).

---

## 2026-05-23 — `gh pr` stalls on markdown special characters in inline `--body`

**Symptom:** `gh pr create` and `gh pr comment` invocations stalled mid-stream when the body contained backticks, `$`, `<`, `>`, `*`, `_`, or `#` in inline `--body "..."` or heredoc forms. The 600s stream watchdog killed the process before recovery.

**Cause:** Markdown special characters collide with shell quoting (both bash and PowerShell). Heredoc + inline string forms are both vulnerable.

**Recovery:** Re-dispatch with `--body-file <path>` form.

**Prevention:** ALWAYS pass PR/comment bodies via `--body-file <path>`. Never inline via heredoc or `--body "..."`. Codified in `.claude/docs/orchestration-overview.md` § PR & merge protocol. Same trap applies to `gh issue create`, `gh issue comment`, and any other `gh` command that takes `--body`.

---

## How to use this file

- **On a known-class recurrence:** scan this file for the headline pattern; the entry's "Prevention" block tells you what rule should have caught it. If the rule exists and was violated, update the dispatch template or orchestration-overview.md to make it more prominent. If no rule exists, codify one now.
- **At retro time:** audit recent entries to spot pattern classes worth promoting into `.claude/docs/orchestration-overview.md` (stable patterns) or auto-memory (cross-project lessons).
- **Do NOT** copy-paste resolutions; understand the cause + apply the prevention. Recipe-following without understanding leaks failure modes back in.
