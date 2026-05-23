# Retro — M1 close (Data-Spike CLI)

**Date:** 2026-05-23
**Scope:** M1 close — 11 tickets, 11 PRs merged, ~3 day arc, the data-plane spike validating parsers + matcher + reducer behind a throwaway CLI.
**Author:** orchestrator

## Outcome

M1 shipped. `npm run agent-tree` works end-to-end against the live `~/.claude/` tree on the sponsor's machine: prints Iris-specced output, surfaces rostered tiles (Felix / Maya / Sage), collapses unrostered agents into a background chip per session, gracefully handles empty / dead / schema-drift cases.

**Test totals on main at M1 close:** 99 unit tests + 31 integration tests = **130 tests, all green** at commit `29e98f2`. Three CI workflow steps (typecheck + lint + unit + integration) all SUCCESS.

| PR | Author / scope | Merged at | Reviewer verdict |
|---|---|---|---|
| #3 | Iris — M1-03 CLI output spec | `7487ccb` | orch-direct |
| #4 → recovered via `f870bef` | Felix — M1-01 scaffold + CI | `cc17fc3` (after recovery) | Maya APPROVE |
| #5 → #6 (linearized) | Bram — M1-02 fixtures | `77350e9` | orch-direct |
| #7 | Sage — M1-04 M1 test plan | `8d5246a` | Felix APPROVE |
| #9 | Bram — M1-11 data-sources update | `81bef17` | orch-direct |
| #10 | Felix — M1-08 roster YAML + matcher | `6c0edae` | Maya APPROVE |
| #11 | Felix — M1-05 meta.json parser (3-variant union) | `08e2791` | Maya APPROVE |
| #12 | Felix — M1-06 JSONL tailer + activity | `4e9af6f` | Maya APPROVE |
| #13 | Felix — M1-07 sessions/PID registry | `dbab662` | Maya APPROVE |
| #14 | Felix — M1-09 reducer + CLI driver | `2ef2025` | Maya APPROVE_WITH_NITS (5 nits → followup ticket `86c9y6e17`) |
| #15 | Sage — M1-10 integration tests | `29e98f2` | Felix APPROVE |

Plus an orch-doc bundle at `007ce9a` (bloat-prevention scaffolding) and a failure-mode capture at `57c78a7` mid-stream.

## What went well

- **The roster-matcher thesis is empirically validated.** Sage's M1 milestone done-when test against the sponsor's actual `~/.claude/` tree produced rostered tiles for Felix / Maya / Sage with the canonical glyph table, plus background-noise chips for MARIAN-TUTOR and RandomGame sessions. The V1 hypothesis ("sponsor-curated roster collapses everything else as background noise") works against real data.
- **The 3-tag `AgentMeta` union landed cleanly.** Bram's M1-02 captures surfaced a third schema variant (v2.1.145-persona) beyond the documented pair; Felix widened the union in M1-05 and the matcher (M1-08) was already schemaVersion-agnostic so the widening was type-only. No downstream rewrites. Documented in `team/DECISIONS.md`.
- **Cross-pair peer-review caught real signal.** Maya's M1-09 review flagged 5 substantive nits (dead stub code, module-level mutable state, plural-guard, tool-arg limitation, edge case in `buildActivity`) — none blocked the merge, but every one was a real code-quality issue future M2 work would have hit. Felix's M1-10 review verified Sage's tests exercised failure paths, not just happy paths. Cross-pair worked exactly as designed.
- **Bram's "I verified each fixture's source path exists" discipline (M1-02 AC9) prevented downstream fabrication.** Every M1-05/06/07/10 ticket consumed Bram's fixtures with confidence; no agent had to second-guess whether `tests/fixtures/meta-new-schema-persona.json` was real.
- **The orch-doc commit pattern works under bootstrap.** Per CLAUDE.md hard rule #1, orchestration-doc updates landed directly to `main` (bloat-prevention bundle, failure-mode capture). Saved ~8 PR-cycles' worth of overhead during M1. This pattern expires when the extension scaffold lands (M2+); the team will then go through full PR-flow for everything.
- **Tightened final-report contract (≤200 words) worked.** Sub-agent reports stayed scannable; detailed evidence (test counts, CLI output paste, Self-Test Report) lived in PR bodies — not in the orchestrator's main thread. Confirmed by inspecting Felix's M1-09 report (4 lines + PR URL) and Sage's M1-10 report (6 lines + PR URL).

## What went poorly

- **Three preventable git failures in the first 36 hours.** Squash-merge incompatibility with a branch-internal merge commit (PR #5 → #6 redo), `git reset --soft` deleted 10 files in PR #8 (recovered via `f870bef`), and peer-reviewer worktree blocking `--delete-branch` twice in PR #12 + #13. All three are now in `team/log/process-incidents.md` with full prevention rules. Net cost: ~2 hours of recovery work + one near-miss data loss event.
- **Failure modes accumulated in eagerly-loaded `.claude/docs/orchestration-overview.md` before the bloat-prevention bundle landed.** 6 multi-paragraph failure-mode entries × growth-rate-of-one-per-incident = every future SessionStart paying ever-increasing context tax. Detected mid-session; extracted to `team/log/process-incidents.md` in commit `007ce9a`. Saved ~50 lines of eagerly-loaded context now and bounded future growth.
- **Maya's review of M1-09 surfaced module-level mutable state (`teamNameForId`).** This was a Felix authoring miss that would have broken when M2's webview reused the reducer module. Caught by peer review, not by tests — because the reducer's unit tests instantiated it once per test run and didn't probe for reentrancy. Lesson: when M2 wires the reducer into the file-watcher loop, integration tests must exercise repeated `buildAgentTree` calls within one process.
- **Sub-agent `mcp__clickup__*` tools were silently absent at runtime despite being declared in persona files.** Bram's probe (PR #2) was the only thing that surfaced this; without that probe, every M1 dispatch would have failed its ClickUp status flip and the board would have rotted. Documented in `team/DECISIONS.md` 2026-05-23. Fallback (pending-queue) works but adds round-trip latency.
- **The `cwdToSlug` slug derivation rule lives in two places** (`src/cli/agentTree.ts` and `tests/integration/helpers/tempdir.ts`). Sage flagged correctly; M2 should extract to `src/shared/slug.ts`. Filed in M1-09-followup ticket `86c9y6e17`.

## Surprising findings

- **The persona-named v2.1.145 meta.json variant (5 of 10 of Bram's real captures).** Documentation only listed `agentType: "general-purpose"` for v2.1.145; reality has personas embedded as their own `agentType` values. Without Bram's captures, the matcher's first-match-wins rule would have silently routed every persona-named agent into background — defeating the V1 thesis. The 3-tag `AgentMeta` union is the explicit fix.
- **Iris's CLI output spec (M1-03) was load-bearing for THREE downstream tickets.** Felix's M1-09 reducer field names (`display`, `role`, `activity`, `model`, `state`) come straight from Iris's glossary §6; the M3 dashboard tile will inherit the same vocabulary; the background-noise chip format is identical in CLI and dashboard. Without Iris pre-shaping the language, M3 would have either re-derived it (cost) or diverged (worse). The investment in M1-03 paid out 3x.
- **The bloat-prevention scaffolding was imported from sibling projects mid-M1.** RandomGame's `team/STATE.md` + `team/DECISIONS.md` + `team/log/process-incidents.md` pattern + MarianLearning's `.claude/retros/` pattern were not in ClaudeTeam's initial scaffold (`create-orchestration-project` template predates these patterns at this project's create-time). User-flagged the bloat risk mid-M1; orchestrator surveyed sibling projects + imported in commit `007ce9a`. **Action for next `create-orchestration-project` skill upgrade:** port these patterns back into `template/` so new projects don't repeat ClaudeTeam's mid-flight remediation.
- **The auto-status local pulse + away tick pair worked even across mode-switches.** User toggled `local → off → local → away` across the session; the state-file + cron-job recreation flow handled every transition cleanly. The 5-min local pulse provided a low-cost heartbeat during dispatch; the 15-min away tick took over for the M1 close + retro authoring + M2 dispatch.
- **APPROVE_WITH_NITS is a load-bearing distinct verdict.** Maya's M1-09 review wasn't APPROVE (would have ignored 5 real issues) and wasn't REQUEST_CHANGES (would have blocked a shippable PR). APPROVE_WITH_NITS surfaces nits as follow-up tickets — the merged PR ships, the nits stay tracked. This is the verdict that future dispatch-template peer-review blocks should explicitly enumerate as valid.

## Patterns + anti-patterns to internalize

- **PATTERN — sub-agent docs preload preamble.** Every dispatch brief includes "Read CLAUDE.md and every `.claude/docs/*.md` file IN PARALLEL". Sub-agents don't inherit the SessionStart auto-load. Validated 11x across M1 — every persona dispatched correctly oriented before working.
- **PATTERN — Step 0 verbatim with explicit `cd <worktree>`.** Naming the worktree path is insufficient. Without `cd`, sub-agents inherit orchestrator CWD and edit the survey root. Validated 11x; the one near-miss (Felix's M1-01) was caught by the same-session re-survey.
- **PATTERN — final-step `git switch --detach HEAD`.** Author or reviewer worktrees holding a branch block the orchestrator's `gh pr merge --delete-branch`. Adding the detach to every brief's "worktree cleanup at end of task" block prevents recurrence. Validated post-incident.
- **PATTERN — peer-reviewer `git fetch origin pull/<n>/head:pr-<n>-review`.** Avoids binding the worktree to the author's branch entirely; reviewer's local branch is throwaway. Cleaner than `gh pr checkout` + `git switch --detach HEAD` afterward.
- **PATTERN — log autonomous-decision BEFORE executing (decisions-while-away.md).** Tested for the first time on PR #14 auto-merge. The audit-log entry IS the foundation for the decision; writing it forces the orchestrator to articulate the foundation citation before acting. Saved review effort on user return.
- **PATTERN — pending-queue with canonical section header.** `## Status-flip queue (sub-agent dispatch fallback)` (verbatim) plus appending INSIDE its existing code fence — never creating a new section. Prevents the merge-conflict failure mode observed early in M1.
- **ANTI-PATTERN — `git reset --soft` as "linearization".** Soft-reset to current main + commit DELETES every file added to main since the fork point. Use `git rebase` (force-push) or `git cherry-pick` onto a new branch. Codified in `team/log/process-incidents.md` and auto-memory `feedback_linearize_via_rebase_or_cherrypick`.
- **ANTI-PATTERN — squash-merge of a branch with `git merge origin/main` commits.** GitHub's `--squash` rejects this. Either rebase + force-push or open a fresh PR via cherry-pick.
- **ANTI-PATTERN — accumulating failure modes in eagerly-loaded `.claude/docs/orchestration-overview.md`.** Every SessionStart pays. Move to lazy-loaded `team/log/process-incidents.md`; keep only terse stable rules eager.

## Durable lessons promoted

- **Bloat-prevention scaffolding (`team/STATE.md`, `team/DECISIONS.md`, `team/log/process-incidents.md`, `.claude/retros/`)** → landed in commit `007ce9a`; documented in `CLAUDE.md` § Coordination state. Should also be ported to `create-orchestration-project` skill's `template/` (out-of-scope here; filed as a separate concern for the skill's `port-improvements` mode).
- **Reviewer-detach + author-detach rules** → captured in dispatch-template.md "Worktree cleanup" block and `team/log/process-incidents.md`. Auto-memory `feedback_reviewer_detach_after_pr_checkout`.
- **`git reset --soft` is NOT linearization** → auto-memory `feedback_linearize_via_rebase_or_cherrypick`.
- **3-tag `AgentMeta` union** → `team/DECISIONS.md` 2026-05-23 + `.claude/docs/data-sources.md` §4 three-variant schema table.
- **Sponsor doesn't review PRs** → auto-memory `feedback_sponsor_doesnt_review_prs` + `team/DECISIONS.md` 2026-05-23 + `CLAUDE.md` § Autonomy.
- **Sub-agent ClickUp MCP gap (permanent harness behavior)** → `.claude/docs/orchestration-overview.md` § ClickUp as hard gate + `team/DECISIONS.md` 2026-05-23.
- **APPROVE_WITH_NITS verdict** → semi-implicit in dispatch-template.md § Cross-review verdict format; pending elevation to explicit enumeration ("APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES" as the three valid headers) — flag for M2 dispatch-template tightening.

## Next-session backlog

1. **Dispatch Nora for M2 backlog authoring.** M2 = VS Code extension scaffold + webview message protocol + file-watcher loop on top of M1's data plane. Nora authors the backlog at `team/nora-pl/milestone-2-backlog.md`; orchestrator creates ClickUp tickets in list `901523520912` after sponsor approves the M2 scope.
2. **M1-09-followup (`86c9y6e17`)** — Felix addresses Maya's 5 NITs + 2 doc-promotion candidates. P2; can land in M2's early phase rather than gating it.
3. **`cwdToSlug` extraction to `src/shared/slug.ts`** — Sage's M1-10 finding; M2 work, integrates with M2's file-watcher slug computation.
4. **Port bloat-prevention scaffolding back to `create-orchestration-project` template.** `team/STATE.md` + `team/DECISIONS.md` + `team/log/process-incidents.md` + `.claude/retros/RETRO-TEMPLATE.md` + CLAUDE.md hard-rule-9 (CI-status discipline) + hard-rule-8 rationale phrase. File against the skill's `port-improvements` mode (separate from ClaudeTeam's own repo).
5. **Bram research for M2:** VS Code Extension API prior-art (other webview-based dashboards), `vsce package` best practices, webview-host message protocol patterns. Pre-dispatch before Nora's M2 backlog so Bram's findings feed Iris's M2 tile spec.
