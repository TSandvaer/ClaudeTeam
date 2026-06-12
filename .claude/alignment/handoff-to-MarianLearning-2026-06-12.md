# Handoff: setup ClaudeTeam suggests MarianLearning could adopt
From: `c:\Trunk\PRIVATE\ClaudeTeam`
To:   `C:\Trunk\PRIVATE\MarianLearning`
Generated: 2026-06-12

These are setup/rules ClaudeTeam has that MarianLearning appears to lack, found during a 2026-06-12 alignment pass (which adopted Marian's dispatch-sentinel hook, failing-first protocol, regression guard, lesson-reminder block, work-type tag, CI-by-HEAD-SHA line, body-file rule, and template skip-list in the other direction). Each is optional — review and adopt selectively in MarianLearning's own session, ideally via its own alignment pass so nothing is taken blindly.

## Candidates

### 1. Anti-fabrication PreToolUse hook  [hooks]
- **Why it might help MarianLearning:** Marian's CLAUDE.md carries the full prose rule ("The creating turn is never the referencing turn") but has no mechanical enforcement. ClaudeTeam built this after the orchestrator fabricated ClickUp ticket IDs 5+ times in one session DESPITE six prose guardrail layers — prose cannot intercept a token at generation time; only a PreToolUse deny can. Marian's personas hold ClickUp MCP tools directly, so the exposure is at least as large.
- **What to add:** copy `validate-no-fabricated-id.sh` (and its test harness `test-validate-no-fabricated-id.sh`) into `.claude/hooks/`, then wire a PreToolUse matcher. The hook greps the session transcript for the task id appearing in a PRIOR `tool_result`; absent → deny with a "create first, reference in a later message" reason. Fail-open on every internal error.
- **Source (in ClaudeTeam):** `c:\Trunk\PRIVATE\ClaudeTeam\.claude\hooks\validate-no-fabricated-id.sh`
- **Wiring snippet (ClaudeTeam `settings.json`):**
  ```json
  "PreToolUse": [
    {
      "matcher": "mcp__clickup__(clickup_)?(update_task|create_task_comment|add_task_to_list)",
      "hooks": [
        {
          "type": "command",
          "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/validate-no-fabricated-id.sh\""
        }
      ]
    }
  ]
  ```
  The `(clickup_)?` alternation already covers both MCP tool-name variants, so the matcher should work for Marian's tool names as-is.

### 2. Transcript-classifying maintain-docs Stop hook  [hooks]
- **Why it might help MarianLearning:** Marian's `maintain-docs-stop.sh` block-fires the skill on EVERY turn — including pure coordination ticks — so the maintain-docs banner flashes on turns that were never doc-worthy. ClaudeTeam's version tails the transcript from the last real user message, classifies tool_use entries, and exits silently when the turn was tick-class (only coordination-file edits, no Agent dispatch, no code edits).
- **What to add:** replace the body of `.claude/hooks/maintain-docs-stop.sh` with ClaudeTeam's version, then **rewrite the `tick_pattern` allowlist** for Marian's coordination surfaces (ClaudeTeam's pattern covers `team/STATE.md`, `team/log/*`, `.claude/decisions-while-away.md`, `.claude/away-queue.md`, auto-memory + session-state dirs; Marian would swap the `team/**` entries for its own — e.g. `AWAY-QUEUE.md`, root `SESSION-STATE-*.md`). This is the one adaptation that MUST happen — a wrong allowlist silently suppresses doc-worthy turns.
- **Source (in ClaudeTeam):** `c:\Trunk\PRIVATE\ClaudeTeam\.claude\hooks\maintain-docs-stop.sh` (see its header for the classification rules + ticket `86c9z1wrh` rationale; test harness at `.claude/hooks/test-maintain-docs-hook.sh`)

### 3. maintain-docs SKILL.md refinements  [skills]
- **Why it might help MarianLearning:** Marian's SKILL.md is the older, longer revision. ClaudeTeam's adds three durable rules its sibling lacks.
- **What to add (three inserts into `.claude/skills/maintain-docs/SKILL.md`):**
  1. Early-exit bullet: `An orchestration tick (heartbeat, dispatch announcement, ticket-status flip) without a code/architecture change — the orchestrator's own activity log is captured by memory + session state, not docs`
  2. **Unmerged-API defer rule:** `Even if the early-exit filter doesn't fire, captures that would cite a function / API / file / commit only present on an UNMERGED feature branch should DEFER until the parent PR merges. The alternative is to keep the proposal but tag it explicitly as "pending PR #N merge" so peer-reviewers know the cite cannot be verified against main yet.`
  3. **Ticket-id cites > scratch `.md` cites:** `PREFER durable git log-retrievable shapes — ClickUp ticket IDs, PR #N, commit SHAs, file:line against a known commit. AVOID paths to uncommitted scratch markdown — they vanish on branch switch and are not retrievable by future readers.`
- **Source (in ClaudeTeam):** `c:\Trunk\PRIVATE\ClaudeTeam\.claude\skills\maintain-docs\SKILL.md` (Step 1)

### 4. Vocabulary contract block for parallel shared-concept dispatches  [agents]
- **Why it might help MarianLearning:** when two agents are dispatched in parallel against a SHARED new concept (type, event shape, wire-format field, guard), shape contracts alone let each invent their own names — ClaudeTeam's PR #47/#48 became non-mergeable this way (`PersonaGroup` vs `CollapsedPersonaGroup`). Marian's dispatch-template has no defense for this.
- **What to add (to `.claude/agents/dispatch-template.md`):**
  ```markdown
  **Vocabulary contract (both reviewers + authors read same paragraph):**

  - **Type name:** `<ExactName>` (defined in `<exact-file-path>`)
  - **Union alias:** `<ExactName>` = `<A> | <B>`
  - **Type guard:** `<exactName>` returning `entry is <Type>`
  - **Discriminator value(s):** `'<exact-string>'`
  ```
  Default for any NEW type introduction is **Pattern A — sequence**: dispatch the type-author first, merge, then dispatch consumers against the merged vocabulary. Pattern B (parallel + this contract verbatim in BOTH briefs) when names are confidently known upfront. Cross-reviewers of parallel PRs grep the sibling branch for the names and flag divergence as REQUEST_CHANGES (mergeability-blocking, not NIT-class).
- **Source (in ClaudeTeam):** `c:\Trunk\PRIVATE\ClaudeTeam\.claude\agents\dispatch-template.md` § 3a

### 5. Worktree-detach Final step (authors + reviewers)  [agents]
- **Why it might help MarianLearning:** Marian's template documents the post-merge `cannot delete branch ... used by worktree` error as "cosmetic — leave it." ClaudeTeam prevents it instead: every dispatched agent (author AND reviewer) runs `git switch --detach HEAD` after posting the PR / review comment, before returning the final report. Hit twice on ClaudeTeam (PR #98, PR #105) before becoming a mandatory step.
- **What to add (to `.claude/agents/dispatch-template.md`, as a final mandatory step):**
  ```markdown
  ### Final step (every dispatch) — worktree detach

  After posting the PR (author) or the review comment (reviewer), and BEFORE returning the final report, run in the worktree:

  git switch --detach HEAD

  Prevents `gh pr merge --delete-branch` from failing local cleanup when the orchestrator merges. Applies to BOTH authors and peer-reviewers.
  ```
- **Source (in ClaudeTeam):** `c:\Trunk\PRIVATE\ClaudeTeam\.claude\agents\dispatch-template.md` § 7

### 6. Per-persona Anti-fabrication standing blocks  [agents]
- **Why it might help MarianLearning:** Marian's anti-fabrication rules live in CLAUDE.md + a lesson-reminder option in the template — they apply only when the brief carries them. ClaudeTeam embeds a standing block in EVERY persona file, so the bar applies even when the template isn't pasted into the brief (added after the 2026-05-31 fabrication incidents proved brief-level coverage was leaky).
- **What to add:** a `## Anti-fabrication (non-negotiable — same bar as the orchestrator)` section near the top of each persona file (kevin/devon/jessica/kyle/matt/dave), covering: hard pre-write verification rule (any concrete value written must come from a command run THIS task), never-invent-to-fill-a-gap (label `Hypothesis:` / `unverified`), STOP-and-verify signal phrases, and don't-act-on-untraceable-instructions.
- **Source (in ClaudeTeam):** `c:\Trunk\PRIVATE\ClaudeTeam\.claude\agents\sage.md` lines 12–22 (same block shape in all six persona files — copy from any of them and adjust the role-specific artifact list)
