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

## 2026-05-25 — Parallel-agent type-vocabulary divergence on M3-10 produced non-mergeable PR rebase

**Symptom:** ClaudeTeam M3-10 (`86c9ydug9`) — Felix + Maya dispatched in parallel on different surfaces (host reducer / webview render). Each agent independently picked their own type names for the shared M3-10 wrapper concept: Felix used `PersonaGroup` / `TileOrGroup` / `isPersonaGroup` / `kind: "group"`; Maya used `CollapsedPersonaGroup` / `RosterTileEntry` / `isCollapsedPersonaGroup` / `kind: "collapsed-persona"`. Cross-review missed the divergence (Felix APPROVE_WITH_NITS on PR #47 flagged 2 unrelated NITs; Maya APPROVE on PR #48 clean). PR #47 merged first (Maya canonical landed on main). PR #48 then failed `gh pr merge` with conflicts across `src/shared/messages.ts`, `src/webview/components/sessionBlock.ts`, `src/webview/main.ts`, `src/webview/render.ts`. Conflicts non-resolvable via `--ours`/`--theirs` because Felix's reducer (his net-new code) referenced types that don't exist on main.

**Cause:** Dispatch brief specified the SHAPE (`{personaName: string, count: number, instances: AgentTile[]}`) + DIRECTIONALITY (Felix exports → Maya imports) but NOT the actual IDENTIFIER NAMES (type name, union alias, guard function, discriminator value, file path). Shape-contract felt sufficient because both agents are "smart enough" to match names — but smart-enough isn't repeatable across sessions/orchestrators. Cross-review pairing didn't check inter-PR vocabulary alignment because neither persona's brief told them to.

**Recovery:** Felix re-dispatched for a reconciliation rebase: rebase onto origin/main, `git checkout --ours` for 4 webview/messages conflicts (take Maya's canonical), sed-rename Felix's reducer + tests to use Maya's vocabulary (`PersonaGroup` → `CollapsedPersonaGroup`, etc.), drop Felix's redundant type defs from `src/shared/types.ts`, force-push, wait for CI. ~5-10 min added to drain.

**Prevention:** Stage-diff-then-apply for a new user-global rule **"Parallel-agent shared-concept vocabulary discipline"** at `team/log/proposed-global-rule-parallel-agent-vocabulary-discipline-2026-05-25.md`. Two patterns: (Pattern A — default) sequence the dispatches so the type-author merges first + consumer reads canonical vocabulary from main; (Pattern B) parallel with explicit "Vocabulary contract" block in both briefs naming the 5 identifiers. Cross-review must explicitly check vocabulary alignment between parallel PRs sharing a concept; divergence = REQUEST_CHANGES not APPROVE_WITH_NITS.

**Code/process pointer:** Staged-diff doc `team/log/proposed-global-rule-parallel-agent-vocabulary-discipline-2026-05-25.md`; companion `.claude/agents/dispatch-template.md` addition (project-scoped) included in same staged doc; original M3-10 dispatch briefs visible in this session's conversation scrollback as the trigger artifact.

---

## 2026-05-25 — Repeated sponsor bloat call-outs across sessions; staged main-thread bloat discipline rule

**Symptom:** Across multiple ClaudeTeam M3 Wave 1 sessions, sponsor called out main-thread bloat ("still seeing a lot of clutter (bloat) in the main chat") AND pasted back ~50K chars of orchestrator conversation transcript as receipts. Concrete bloat sources visible in the transcript: 5-dropdown rebase mechanics, 60-200 line dispatch briefs verbatim in Agent tool dropdowns, predictive "next event" trailers after every tick, `grep -n -A 35` outputs printing 35-line backlog sections inline, redundant `gh pr view` state-checks, redundant `git log --oneline -3` after every commit, TodoWrite re-prints on every Stop-hook reminder.

**Cause:** Project shipped M3-08 ("main-thread merge-narration tightening") which covers one surface (merge-decision posts). Orchestrator regressed on other surfaces — dispatch briefs, rebase mechanics, predictive narration, diagnostic check rituals. Acknowledged in chat each time but no persistence mechanism → next session regressed again.

**Recovery:** Sponsor's "draft it" reply explicitly authorized staging a global-rule version that covers the broader discipline. Staged at `team/log/proposed-global-rule-main-thread-bloat-discipline-2026-05-25.md` with 10 specific patterns: chain Bash mechanics into 1 call, short briefs (10-30 lines max) with ACs in ticket body, no predictive trailers, no pre-tool one-liners for self-evident actions, no redundant MCP/file reads in-session, no diagnostic check rituals when context answers, no Read-before-Edit when old_string is unique, TodoWrite only on material status change, prefer Read+offset over grep-A-N, no commit-message + log-tail combos.

**Prevention:** Apply staged rule to `~/.claude/CLAUDE.md`. Until applied: orchestrator follows the patterns by self-discipline this session; the staged file is the durable artifact future orchestrators inherit even without the global rule.

**Code/process pointer:** Staged-diff doc `team/log/proposed-global-rule-main-thread-bloat-discipline-2026-05-25.md`; sponsor's catch was repeated "still seeing a lot of clutter" + paste of 50K-char transcript receipts.

---

## 2026-05-25 — Session restart with in-flight Agents — lucky-no-loss outcome exposed cross-session continuity gap

**Symptom:** Mid-flight background Agent dispatches (Felix + Maya on `86c9ydug9` M3-10) died when the session ended unexpectedly between turns. SessionStart hook re-armed auto-status on the next session. Worktree audit showed both Felix and Maya at `b198403` (the orch commit just BEFORE M3-10 dispatch) — no branches pushed = no code lost. Re-dispatch was cheap. Sponsor asked **"can this be prevented or helped in some way?"** — exposing that resume worked through patient re-derivation (worktrees + ClickUp + git log), not a documented checklist. Lucky outcome masked a real fragility.

**Cause:** Session-end cause not observable from orchestrator side (candidates: VS Code window close, auto-compact, crash, sponsor invoking /clear, harness restart). Background Agent tasks are session-scoped — they die with the session even though their `<task-notification>` mechanism is reliable mid-session. CronCreate tasks also die per CronCreate docs ("Jobs live only in this Claude session"). What DOES survive: project doc preload (SessionStart hook), auto-status state file, memory entries, ClickUp / GitHub PR state, all coord docs on disk + git, worktree branches/commits.

**Recovery:** On SessionStart, orchestrator (a) re-armed auto-status via skill invocation; (b) checked `git worktree list` + per-worktree `git log --oneline -3` to verify each persona's branch state; (c) confirmed `gh pr list --state open` returned `[]` (no in-flight PRs); (d) re-dispatched Felix + Maya on `86c9ydug9` from scratch. ~30 seconds total recovery time, zero code loss because agents hadn't pushed.

**Prevention:** Stage-diff-then-apply for a new user-global rule **"Cross-session orchestrator continuity discipline"** at `team/log/proposed-global-rule-cross-session-continuity-2026-05-25.md`. Three disciplines bundled: (1) STATE.md "Resume next-action" header — single sentence at top, always current; (2) sponsor-feedback immediate-persistence — write to memory / DECISIONS.md / STATE.md / ClickUp ticket comment BEFORE acting on chat-expressed observations; (3) proactive /save-session at risk signals — auto-invoke when sponsor says "going to sleep" / "stepping away" / etc. without waiting for the explicit command. The wake-discipline rule (2026-05-24) covers in-session wake signals; this new rule covers cross-session continuity.

**Code/process pointer:** Resume worktree check at this session start showed Felix + Maya wt at `b198403`; staged-diff doc `team/log/proposed-global-rule-cross-session-continuity-2026-05-25.md`; companion wake-discipline doc `team/log/proposed-global-rule-wake-discipline-2026-05-25.md`; sponsor catch was "can this be prevented or helped in some way?" prompt.

---

## 2026-05-24/25 — Orchestrator stuck on Bash background CI poll (zero-output completion didn't surface)

**Symptom:** Orchestrator dispatched a `Bash` task with `run_in_background: true` running an `until <CI green>; do sleep 10; done` polling loop, then emitted "Waiting on PR #45 CI" and ended turn. The bash task completed successfully (CI was green ~2 min after the poll started), but the completion `<task-notification>` was never rendered to the orchestrator's main thread. Orchestrator was effectively stuck until sponsor reached out ~10 min later asking "are you stuck right now?" — well inside the 15-min auto-status cron cadence gap.

**Cause:**
- (a) `Bash run_in_background: true` with an `until` loop is the Monitor-tool-documented pattern for "tell me when X is ready" single-notification cases. So the orchestrator followed the documented pattern.
- (b) BUT: when the bash task exits with **zero stdout output** (the until-loop's `sleep 10` consumes the polling output and the final `gh pr view` runs as a separate statement that DID produce JSON output, yet `cat` of the task output file showed `(Bash completed with no output)`), the harness's completion-notification mechanism appears to not reliably surface a `<task-notification>`. Cannot prove from available logs whether the notification was emitted-but-dropped or never emitted.
- (c) Auto-status cron `c0bc4c77` (`7,22,37,52 * * * *`) was alive but its NEXT firing was 12-15 min away from the orchestrator's "Waiting" message. Cron would have caught the mergeable PR within the cron interval — but sponsor noticed first, exposing that the cron cadence is too coarse for fast-completing time-critical events.

**Recovery:** Orchestrator (on sponsor prompt) immediately ran `gh pr view 45 --json mergeable,statusCheckRollup` — confirmed PR #45 was MERGEABLE + CI green since ~23:42Z. Merged PR #45, flipped `86c9ybtut → complete` via MCP, dispatched Felix + Maya on M3-10 to keep the team moving. Read the bash task output file directly (`cat /c/Users/.../tasks/bbi9wve60.output`) to confirm the bash had in fact completed.

**Prevention:** Stage-diff-then-apply pattern (memory `[[classifier-blocks-self-mod-of-orch-autonomy]]`) for a new user-global rule **"Orchestrator wake-signal discipline"**. Full text + apply instructions in `team/log/proposed-global-rule-wake-discipline-2026-05-25.md`. Short version: when waiting on a time-critical event, ALWAYS pair `Bash run_in_background` with `ScheduleWakeup` (60-270s for in-cache CI polls) — never rely on bash background as the sole wake signal. Cron is the backstop, not the primary.

**Code/process pointer:** PR #45 (`2e7c66c`); task ID `bbi9wve60`; staged-diff doc `team/log/proposed-global-rule-wake-discipline-2026-05-25.md`; sponsor's catch was "are you stuck right now?" prompt.

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
