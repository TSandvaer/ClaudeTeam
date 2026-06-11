# Alignment Plan — adopt from MarianLearning
Generated: 2026-06-12   |   Current: `c:\Trunk\PRIVATE\ClaudeTeam`   |   Target: `C:\Trunk\PRIVATE\MarianLearning`
Status: APPLIED 2026-06-12
Applied files: `.claude/hooks/dispatch-sentinel-stop.py` (new), `.claude/settings.json`, `CLAUDE.md` (rule 9), `.claude/agents/sage.md`, `.claude/agents/nora.md`, `.claude/agents/dispatch-template.md` (6 edits), `.claude/alignment/handoff-to-MarianLearning-2026-06-12.md` (new). Note: `.claude/hooks/dispatch-sentinel-stop.sh` was ALREADY present (untracked, byte-identical to Marian's) before this run — presumably from a parallel session; not rewritten.

User directive for this run: plan only — nothing applied before explicit approval at the final gate.

## Decisions

| # | Dimension | Title | Decision | Adapt note |
|---|-----------|-------|----------|------------|
| 1 | hooks | Dispatch-sentinel Stop hook | Adopt | reason-text memory refs localized; Monitor counted as tripwire (flagged adaptation) |
| 2 | agents | Failing-First Verification Protocol → sage.md | Adapt | translate Playwright/e2e → vitest + fixture-filesystem integration tests |
| 3 | agents | Regression guard block → dispatch-template | Adopt | — |
| 4 | agents | Lesson-reminder block → dispatch-template | Adopt | starter list drawn from ClaudeTeam's own memories |
| 5 | claude.md | CI-by-HEAD-SHA query line → rule 9 | Adopt | — |
| 6 | agents | Work-type tag → dispatch-template + nora.md | Adopt | — |
| 7 | agents | `gh pr create --body-file` rule → dispatch-template | Adopt | — |
| 8 | agents | "When NOT to use this template" skip-list → dispatch-template | Adopt | routing-table half of the pair was skipped |

## Changes to apply (current project only)

### 1. Dispatch-sentinel Stop hook  [Adopt]

- **Action (a):** add `.claude/hooks/dispatch-sentinel-stop.sh` — copy **verbatim** from `C:\Trunk\PRIVATE\MarianLearning\.claude\hooks\dispatch-sentinel-stop.sh` (fully generic: stdin passthrough, `stop_hook_active` re-entry guard, delegates to the Python detector, swallows all errors → fail-open).
- **Action (b):** add `.claude/hooks/dispatch-sentinel-stop.py` — copy from `C:\Trunk\PRIVATE\MarianLearning\.claude\hooks\dispatch-sentinel-stop.py` with these exact adaptations:
  1. **Reason-text localization** (docstring + the `reason` string): replace `[[feedback_agent_staleness]]` with `[[feedback_background_agent_notifications_can_drop]] + [[feedback_poke_agents_nearing_completion]]`; replace the incident sentence `The 2026-05-13 (2 Kevin agents) and 2026-05-15 (Jessica forceHowlerUnlock) incidents proved the behavioral rule alone is insufficient.` with `The 2026-05-26 incident (Bram Round-3 silent completion — notification never arrived, ~40 min stall) proved the behavioral rule alone is insufficient.`; replace the trailing `(per [[feedback_no_idle_no_stale_agents]] rules 2 + 3)` cite with `(per the user-global "Background-agent staleness verification" rule)`.
  2. **Flagged functional adaptation — count `Monitor` as a tripwire.** ClaudeTeam's user-global wake-signal rule lists three valid signals: ScheduleWakeup, one-shot CronCreate, **Monitor**. Marian's detector counts only the first two and would false-block a Monitor-paired dispatch. In `detect_unpaired_dispatches`, add alongside the `ScheduleWakeup` branch:
     ```python
     elif name == "Monitor":
         tripwire_count += 1
     ```
- **Action (c):** append to `.claude/settings.json` `hooks.Stop` array (AFTER the existing maintain-docs entry — same ordering Marian runs):
  ```json
  {
    "hooks": [
      {
        "type": "command",
        "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch-sentinel-stop.sh\""
      }
    ]
  }
  ```
- **Source:** target `.claude/hooks/dispatch-sentinel-stop.{sh,py}` + target `settings.json` `hooks.Stop[1]`.
- **Risk/conflict:** requires `python` on PATH; the bash wrapper's `|| exit 0` makes a missing python fail-open (hook inert, never blocking). Coexists with maintain-docs-stop — Marian runs both Stop hooks in this order in production. Consistent with (and structurally enforces) the existing dispatch-template "Background-agent tripwire" block.

### 2. Failing-First Verification Protocol → `sage.md`  [Adapt]

- **Action:** insert a new section in `.claude/agents/sage.md` after `## Workflow per task` (it extends workflow item 4 "Failing-test-first when possible" into a binding protocol).
- **Source:** `C:\Trunk\PRIVATE\MarianLearning\.claude\agents\jessica.md` § "Failing-First Verification Protocol" (lines 54–84) + § "Count-assertion rules" (lines 86–93).
- **Adapt note (user):** translate Playwright/e2e tooling → vitest/jsdom + ClaudeTeam's fixture-filesystem integration tests.
- **Exact text to insert:**

  ```markdown
  ## Failing-First Verification Protocol

  Every regression / bug-class test you ship follows this protocol. Type-checks and lint don't catch behavioural test bugs — only you can. This makes workflow item 4 ("failing-test-first when possible") a binding contract for regression and gap-coverage tests.

  ### Step 1 — Verify RED on base before pushing

  Run the new test against the base state (origin/main — e.g. with the paired fix stashed/reverted, or on a branch without the implementation):

  ```
  npx vitest run <test-file>
  ```

  Confirm it **fails for the intended reason**. If it passes on base, the failing-first contract isn't established — revisit the assertion.

  ### Step 2 — Classify every assertion (docstring or inline comment)

  - **RED-on-base lever** — fails on base; must pass with the paired fix. The load-bearing failing-first assertion.
  - **Regression-lock** — passes on base (codifies existing behaviour); must still pass after the paired PR.
  - **Trivially-green counter-test** — passes on base for trivial reasons (e.g. "tile does NOT yet render" before the feature ships). Acceptable but must be flagged.

  At least one **RED-on-base lever** is required per regression spec. A spec with only regression-locks or trivially-green tests is not a failing-first spec.

  ### Step 3 — Paste RED-on-base output in the PR body

  Include the assertion error from running against current `main` as evidence. A bare "test is red" claim without output is not evidence.

  ### Step 4 — Verify GREEN post-merge

  After the paired implementation PR merges, confirm post-merge CI on `main` shows the test green. If not, the failing-first contract failed — investigate before declaring success.

  ## Count-assertion rules

  - **No `.toContain` / `.toContainEqual` on regression behaviour.** Use `.toEqual([item])` or `.toBe(value)` — `.toContain` passes `[item, item]` as well as `[item]` and silently allows duplicate-fire regressions.
  - **Exception:** `.toContain` is acceptable for membership-in-set tests where the SET itself is the contract — not for "the value appears at least once in this array."
  - For any "should fire exactly N times" contract (event emitted once, watcher callback once, message posted once): use `.toHaveBeenCalledTimes(N)` or `.toEqual([exact-array])`.
  ```

- **Risk/conflict:** none — extends, does not contradict, the existing workflow item 4 and the "No optimistic tests" hard rule.

### 3. Regression guard block → dispatch-template  [Adopt]

- **Action:** add to `.claude/agents/dispatch-template.md` as new mandatory block `### 8. Regression guard (mandatory for production-code changes)` (after §7), plus a pre-dispatch checklist line `- [ ] Regression guard line present (production-code dispatches).`
- **Source:** target dispatch-template § "Regression guard" (lines 155–159), adapted: `vitest unit or Playwright e2e` → `vitest unit or integration test`; `Marian-iPad-smoke-time` → `sponsor-dogfood-time`.
- **Exact text:**

  ```markdown
  ### 8. Regression guard (mandatory for any production code change)

  ```
  **Regression guard:** Name at least one test (vitest unit or integration) that would fail if this feature broke in a future unrelated PR. If none exists, add it in this PR. The named test is the artifact a future unrelated PR's CI run flips RED against, so the regression surfaces at PR-time rather than at sponsor-dogfood-time.
  ```
  ```

- **Risk/conflict:** none — sharpens the existing paired-tests bar; consistent with Sage's "no shipping a fixed bug without a regression test."

### 4. Lesson-reminder block → dispatch-template  [Adopt]

- **Action:** add to `.claude/agents/dispatch-template.md` under "Optional blocks (context-dependent)" as `### Lesson reminder (load-bearing this session)`, plus pre-dispatch checklist line `- [ ] 1–2 relevant lesson reminders injected (when a matching incident memory exists).`
- **Source:** target dispatch-template § "Lesson reminder" (lines 93–105); example list replaced with ClaudeTeam's own memories.
- **Exact text:**

  ```markdown
  ### Lesson reminder (load-bearing this session)

  Inject one or two relevant cautionary tales per dispatch, picked from this project's `[[feedback_*]]` memory. Examples:

  - `[[feedback_verify_subagent_cited_paths]]` — spot-check cited paths/evidence before building on an investigation report. Verify, don't reason from priors.
  - `[[feedback_fabrication_is_sequencing_not_knowledge]]` — never write an ID/SHA/URL you haven't seen in a tool result this task.
  - `[[feedback_author_detach_after_dispatch]]` — `git switch --detach HEAD` after PR open / review, or the merge's branch-delete fails.
  - `[[feedback_background_agent_notifications_can_drop]]` — commit + push after each milestone; agents die silently and uncommitted work is lost.
  - `[[feedback_implementer_verifies_triager_hypothesis]]` — verify/refute a triager's root-cause hypothesis from the authoritative source before fixing.

  ```markdown
  **Lesson reminder (load-bearing this session):** `[[<memory-name>]]` — <one-line summary of the cautionary tale + why it applies here>.
  ```
  ```

- **Risk/conflict:** none — additive; briefs stay short because only 1–2 lessons are injected.

### 5. CI-by-HEAD-SHA query line → `CLAUDE.md` rule 9  [Adopt]

- **Action:** append one sentence to hard rule 9 in `CLAUDE.md`.
- **Source:** target `CLAUDE.md` § "CI-status command discipline" (line 110, final sentence).
- **Exact text to append (end of rule 9):**

  > When querying CI on a just-pushed branch, query the run by HEAD SHA, not `--branch --limit 1` (avoids the run-list race).

- **Risk/conflict:** none — additive sentence inside the existing rule; does not alter the authoritative-command guidance.

### 6. Work-type tag → dispatch-template + `nora.md`  [Adopt]

- **Action (a):** add to `.claude/agents/dispatch-template.md` immediately after the §3 Scoped contract block:

  ```markdown
  **Work-type tag (ticket-level):** every ticket carries a free-text tag from `impl` / `spec` / `investigation` / `test` / `chore` / `cleanup`. The tag drives which acceptance gates apply: impl needs a green test, spec needs PR-opens-to-template, investigation needs question-answered-in-PR-body, test needs a failing-first contract, chore needs no behavior change, cleanup needs comment-only or follow-up reframe. Without a work-type tag, spec/investigation tickets get mis-scored against impl-shaped gates.
  ```

- **Action (b):** in `.claude/agents/nora.md` workflow item 5, extend the ticket-field list: after `title (conventional-commit format — \`feat(roster): ...\`, \`chore(docs): ...\`)`, insert `, **work-type tag** (\`impl\`/\`spec\`/\`investigation\`/\`test\`/\`chore\`/\`cleanup\` — drives which acceptance gates apply)`.
- **Source:** target dispatch-template § "Work-type tag (2026-05-22 retro)" (line 135).
- **Risk/conflict:** none — ClaudeTeam ticket titles already use conventional-commit prefixes that loosely encode type; the tag makes the gate mapping explicit rather than inferred.

### 7. `gh pr create --body-file` rule → dispatch-template  [Adopt]

- **Action:** append one line to the §5 final-report contract block in `.claude/agents/dispatch-template.md`:

  ```markdown
  Use `gh pr create --body-file <path>` for PR bodies longer than ~5 lines — avoids the 600s stream-watchdog kill observed on inline `--body` / heredoc patterns in sibling projects.
  ```

- **Source:** target dispatch-template line 196.
- **Risk/conflict:** none — mirrors the existing `--body-file` mandate for review comments (§ Cross-review verdict format).

### 8. "When NOT to use this template" skip-list → dispatch-template  [Adopt]

- **Action:** append a closing section to `.claude/agents/dispatch-template.md`:

  ```markdown
  ## When NOT to use this template

  Skip most blocks for:

  - Status-pulse cron firings (read-only summaries — no dispatch).
  - One-line ticket comments (no scope/worktree/gates needed).
  - Skill-driven dispatches that are already structured by the skill itself (e.g. /investigate).
  - Idle-tick state updates (no scope needed).

  The template is for **work-producing dispatches** (impl PRs, test PRs, review dispatches, spec PRs). Trivial admin actions stay short.
  ```

- **Source:** target dispatch-template § "When NOT to use this template" (lines 280–289), Marian persona names dropped.
- **Risk/conflict:** none.

## Self-verification (Step 6)

- [x] No internal conflicts — changes 3, 4, 6a, 7, 8 all touch dispatch-template.md but in disjoint sections (new §8, new optional block, post-§3 insert, §5 append, end-of-file append); applied sequentially with Edit.
- [x] No conflict with current project — sage.md change extends its own workflow item 4; rule-9 append is additive; settings.json Stop-array append preserves maintain-docs-first ordering; the sentinel hook enforces (not contradicts) the existing tripwire checklist line.
- [x] Production-protection intact — ClaudeTeam declares no production-protection rule; the "main is protected" hard rule is untouched by every change.
- [x] Add/append only — two new hook files, the rest are appended sections/sentences via Edit; no overwrites, no deletions.

## Skipped / excluded (audit trail)

- `mcp__clickup__*` wildcard allowlist — Skip (user; bypassPermissions default + PreToolUse guard make it low value).
- Track-based author-routing table — Skip (user; TEAM.md lane ownership already implies Felix=host / Maya=webview).
- Pedagogy gate — Excluded (domain-specific to Marian's curriculum surface).
- iPad-smoke gate — Excluded (domain-specific; webview-smoke gate is the existing analog).
- `settings.local.json` entries — Excluded (machine/one-PR-specific).
- Marian's maintain-docs SKILL.md + Stop hook, session-start hooks — Excluded (older/identical versions of ClaudeTeam's own).

## Reverse candidates (→ handoff doc on apply)

Six items for `handoff-to-MarianLearning-2026-06-12.md`: anti-fabrication PreToolUse hook, transcript-classifying maintain-docs Stop hook, maintain-docs SKILL.md refinements, Vocabulary contract block, worktree-detach Final step, per-persona anti-fabrication blocks.
