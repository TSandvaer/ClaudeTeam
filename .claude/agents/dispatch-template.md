# Dispatch Template

Reusable snippets the orchestrator appends to every Agent brief. NOT a persona file — a reference document for the orchestrator.

## Mandatory blocks (every dispatch)

### 1. Step 0 — worktree state (verbatim)

The first action of every dispatched agent must be:

```bash
cd C:/Trunk/PRIVATE/ClaudeTeam-<role>-wt
git fetch origin
git checkout -B <role>/<id>-<slug> origin/main
pwd   # verify you're in the worktree, not the orchestrator's cwd
```

**Why this is non-negotiable:** Sub-agents inherit the orchestrator's cwd if Step 0 is omitted. Edits then land in the survey root instead of the role worktree, branches collide, and the merge cleanup short-circuits. RandomGame learned this the hard way (Devon W1, 2026-05-22). Make Step 0 the literal first line of the agent's task list.

### 2. Doc preload preamble

```
Before any other work: read CLAUDE.md and every .claude/docs/*.md file IN PARALLEL (multiple Read calls in one message). Sub-agents do NOT inherit the SessionStart docs-preload — you have to read them yourself, once per session.
```

### 3. Scoped contract (mandatory for non-trivial tickets — 2h+ or 3+ files)

```
**Goal:** <one sentence — what does success look like?>
**Acceptance criteria:**
- AC1: <observable, testable>
- AC2: ...
**Out of scope (OOS):**
- <thing 1>
- <thing 2>
**Done-when test:** <the exact command/check that proves done>
**Files in play:**
- Owned (you write): <paths>
- Read-only references: <paths>
**Conflict rule:** if you discover OOS scope is load-bearing, STOP and file a follow-up ticket — do not expand mid-PR.
```

### 3a. Vocabulary contract (mandatory for parallel dispatches sharing a NEW concept)

When dispatching multiple agents in parallel where two or more will reference a NEW type / event shape / wire-format field / guard function, include the following block in BOTH briefs verbatim so both agents read identical identifier names:

```
**Vocabulary contract (both reviewers + authors read same paragraph):**

- **Type name:** `<ExactName>` (defined in `<exact-file-path>`)
- **Union alias:** `<ExactName>` = `<A> | <B>`
- **Type guard:** `<exactName>` returning `entry is <Type>`
- **Discriminator value(s):** `'<exact-string>'`
- **Webview/host variant suffix (if any):** `Webview<X>` vs `<X>`
```

The default for any NEW type introduction is **Pattern A — Sequence**: dispatch the type-author first, merge their PR, then dispatch the consumer(s) against the merged vocabulary. Pattern B (parallel with this contract) is acceptable when the orchestrator has high confidence about the names upfront and wants the parallelism. See user-global CLAUDE.md "Parallel-agent shared-concept vocabulary discipline" for the cross-review check + REQUEST_CHANGES escalation.

### 4. ClickUp lifecycle (paired flips)

```
**ClickUp lifecycle for this dispatch:**

The Claude Code harness does NOT surface `mcp__clickup__*` tools to sub-agent runtimes (permanent gap, see `.claude/docs/orchestration-overview.md` "ClickUp as hard gate"). The orchestrator owns ClickUp writes; sub-agents append intended transitions to `team/log/clickup-pending.md` and orchestrator flushes on each tick.

For YOU (the dispatched persona):

- Ticket <ID> has been pre-flipped to `in progress` by the orchestrator in the same tool round as this dispatch. No action on accept.
- On PR open, append (IN YOUR OWN WORKTREE at `<base>-<role>-wt/team/log/clickup-pending.md`, NEVER the orchestrator-survey path) inside the EXISTING code fence under the `## Status-flip queue (sub-agent dispatch fallback)` section:
    ```
    ENTRY-<ISO-8601-UTC-timestamp>: <ticket_id> -> in review
    ```
  Use `ENTRY-<ISO-8601-UTC-timestamp>:` as the line prefix, where the timestamp is captured at the moment the persona writes the entry (e.g., `ENTRY-2026-05-24T08:30:00Z:`). DO NOT use sequential numeric IDs — they collide under parallel dispatch. Do NOT create a new section header — that produces merge conflicts (see orchestration-overview.md "Common failure modes"). Commit + push through your PR.
- Orchestrator handles `in review → complete` flip on merge.
```

### 5. Tightened final-report contract (≤200 words)

```
**Final report — return in this shape and EXIT (do not wait for merge):**

PR: <URL>
Verdict: <"AC met, ready for review" | "blocked — see notes" | "needs decision from sponsor on X">
Blockers: <none | one-line>
Doc updates: <none | "added .claude/docs/<file>.md" | "updated <file>.md @ section X">
Decision drafts (if any): <one per line, prefixed `Decision draft:`>

Anything beyond this goes in the PR body, ticket comments, or your workspace folder — NOT in the orchestrator-bound report. Cite verifiable evidence for every state claim (run-id URL, SHA, file:line, screenshot URL).
```

### 6. Non-obvious findings postamble

```
At the end of your work, list any non-obvious findings (gotchas, surprising constraints, validated patterns, "I almost did X but here's why Y is right") in your PR body. These are the input to maintain-docs — the more concretely you surface them, the more useful future Claude sessions become.
```

### 7. Final step (every dispatch) — worktree detach

After posting the PR (author) or the review comment (reviewer), and BEFORE returning the final report, run in the worktree:

```bash
git switch --detach HEAD
```

**Rationale:** prevents `gh pr merge --delete-branch` from failing local cleanup when the orchestrator merges. A worktree still holding the branch blocks the post-merge `--delete-branch` step (documented failure mode in `orchestration-overview.md` § Common failure modes). Applies to BOTH authors and peer-reviewers — defense-in-depth even when the reviewer used the `fetch into local-only branch` pattern.

Include this verbatim as the final action of every dispatch brief, alongside the final-report contract (§5). Do NOT duplicate it inside other blocks — the peer-review routing block (Optional blocks below) references this global Final step rather than repeating the command.

## Anti-fabrication contract

Every dispatched agent inherits project `CLAUDE.md` rule 10 "Never fabricate, never guess, never extrapolate" — this section enumerates concrete sourcing commands so agents don't have to look them up. Orchestrators do NOT need to paste this inline into briefs; agents read it as part of the dispatch-template preload.

**Concrete values that must be fetched, not invented:**

- **PR URLs:** `gh pr view <num> --json url -q .url`, or capture the URL printed by `gh pr create` at creation.
- **Ticket IDs / state / body:** `mcp__clickup__clickup_get_task` (orch-side only — sub-agents lack the MCP tool; route via `team/log/clickup-pending.md` NEW-TICKET-REQUEST per `.claude/docs/orchestration-overview.md § ClickUp as hard gate`).
- **SHAs:** `git log -1 --format=%H` for HEAD, `git rev-parse <ref>` for any other ref, `git log --oneline <range>` for a list.
- **File:line refs:** `grep -n <pattern> <file>` on the LIVE file in your worktree — never extrapolate line numbers from memory or sibling files.
- **CI run IDs / status:** `gh run list --limit 1 --json databaseId,status,conclusion` or `gh pr view <num> --json statusCheckRollup`.
- **Workflow run URLs:** `gh run view <run-id> --json url -q .url`.
- **Comment URLs:** capture from `gh pr comment` output, or `gh api repos/<owner>/<repo>/pulls/<num>/comments` for existing ones.

**STOP-and-verify signal phrases.** If you find yourself writing "should be at...", "probably...", "lives in...", "is the same as..." in a PR body / Self-Test Report / ticket comment without a concrete check behind it — STOP. Fetch the value, or label the claim `Hypothesis:` / `Predicted:` / `Speculative — no source yet`.

**Observed-symptom discipline.** Every concrete value in a PR body, Self-Test Report, ticket comment, or `process-incidents.md` entry must be quoted from a real source in the same paragraph (tool output you just ran, file you just read, user-provided text). Phrasings like "Dashboard shows X" / "Output was Y" / "Concrete instance: <value>" read as observed reality — if invented, they create false evidence that a future sub-agent dispatched against the ticket cannot distinguish from a real repro path.

## Optional blocks (context-dependent)

### Self-Test Report (for UX-visible PRs)

```
**Self-Test Report — required before requesting Sage's QA:**

1. AC walkthrough on a real VS Code reload — for each AC, the observed behavior + screenshot.
2. Side-effect inventory — every surface this change touches.
3. Theme-switch probe — screenshots in dark and light VS Code theme.
4. State-coverage — screenshots of each state your change affects.
```

### Background-agent tripwire (for `run_in_background: true` spawns)

```
This agent is being dispatched in the background. The orchestrator MUST pair this dispatch with a ScheduleWakeup at ~2× the agent's expected duration so a silent agent-death is caught. Background agents must `git commit && git push` after each milestone — agents die silently and uncommitted work is lost.
```

### Peer-review routing

- **Felix's code PRs** → reviewer is Maya. Sage QAs.
- **Maya's code PRs** → reviewer is Felix. Sage QAs.
- **Iris's spec PRs** → reviewer is Maya (visual) or Felix (data-shape implications). Sage spot-checks if the spec drives test changes.
- **Sage's test PRs** → reviewer is Felix (host-side tests) or Maya (webview tests).
- **Bram's research PRs** → orchestrator-merge direct (research notes don't need code peer-review). If the research drives a code-change recommendation, file a separate ticket for the change.
- **Nora's ticket/doc PRs** → orchestrator-merge direct unless they touch shared coordination docs that other roles depend on.

Reviewers MUST run the global Final step (§7 above — `git switch --detach HEAD`) in their worktree after posting the review comment, before returning the final report. Do NOT re-state the command here — the global Final step is the single source of truth.

### Cross-review verdict format

Use `gh pr comment --body-file <path>` (never inline `--body "..."`) with the verdict header as the first line:

```
## REVIEW VERDICT: APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES
```

Three valid verdicts — all are load-bearing:

- **`APPROVE`** — PR ships as-is; no outstanding issues.
- **`APPROVE_WITH_NITS`** — PR ships as-is; NITs are filed as follow-up tickets before the next milestone close, not blocking this merge.
- **`REQUEST_CHANGES`** — PR does NOT merge until the listed issues are resolved.

`APPROVE_WITH_NITS` is the correct verdict when the PR meets all acceptance criteria but has non-blocking quality issues worth tracking. Do NOT downgrade to `APPROVE` (silently drops the nits) or upgrade to `REQUEST_CHANGES` (incorrectly blocks a shippable PR).

## Worktree map (reference)

| Role | Worktree path | Default branch |
|---|---|---|
| Nora | `c:\Trunk\PRIVATE\ClaudeTeam-nora-wt` | `nora/idle` |
| Iris | `c:\Trunk\PRIVATE\ClaudeTeam-iris-wt` | `iris/idle` |
| Felix | `c:\Trunk\PRIVATE\ClaudeTeam-felix-wt` | `felix/idle` |
| Maya | `c:\Trunk\PRIVATE\ClaudeTeam-maya-wt` | `maya/idle` |
| Sage | `c:\Trunk\PRIVATE\ClaudeTeam-sage-wt` | `sage/idle` |
| Bram | `c:\Trunk\PRIVATE\ClaudeTeam-bram-wt` | `bram/idle` |

## Pre-dispatch checklist (orchestrator-side)

Before sending a brief:

- [ ] Ticket ID + body included verbatim in the brief.
- [ ] Worktree path matches the assigned role.
- [ ] Branch name follows `<role>/<id>-<slug>` format.
- [ ] Scoped contract block present (for non-trivial tickets).
- [ ] If parallel dispatch shares a NEW type/event/guard: Vocabulary contract block (§ 3a) present in BOTH briefs verbatim, OR Pattern A sequencing chosen (type-author first → consumer next).
- [ ] ClickUp lifecycle block present.
- [ ] Final-report contract block present.
- [ ] Final step block (§7 — `git switch --detach HEAD`) present, for author AND any peer-reviewer dispatched against this PR.
- [ ] Doc-preload preamble present.
- [ ] Non-obvious findings postamble present.
- [ ] If background dispatch: ScheduleWakeup tripwire scheduled.
- [ ] If UX-visible: Self-Test Report block present.

(All briefs inherit the **Anti-fabrication contract** section above + project `CLAUDE.md` rule 10 — orchestrators do NOT need to paste fabrication-discipline language inline. Sub-agents read both as part of the dispatch-template + CLAUDE.md preload.)
