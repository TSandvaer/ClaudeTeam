# Testing Strategy

Three layers. Each layer catches a different bug class. None of them is optional.

## Layer 1 — Unit (vitest)

Tests pure functions: parsers, matchers, reducers, helpers. No VS Code API, no DOM, no filesystem.

**Coverage targets:**
- Every meta.json parser branch (v2.1.119 schema, v2.1.145 schema, malformed input, missing fields).
- Every match rule type (name_prefix, name_equals, agentType_equals, description_contains).
- Every state-reducer transition (agent spawned, agent activity changed, agent finished, agent error).
- Edge cases: empty roster, duplicate member ids across teams, no-rule member.

**Where:** `tests/unit/`. Fast — should run in <2s for the whole suite. Pre-commit hook runs them.

## Layer 2 — Integration / fixture filesystem

Spin up a tempdir with captured `meta.json`, `jsonl`, and `sessions/{pid}.json` files. Point the watcher at it. Assert the watcher produces the expected state events.

**Coverage targets:**
- File-watcher state machine (session appears / disappears, subagent spawned / finished).
- Roster loader (global + project YAML merge, validation errors).
- Two sessions sharing the same `cwd` — they materialise separately.
- Schema drift — fixtures include both v2.1.119 and v2.1.145 layouts.
- Race: subagent JSONL appears before its parent's tool_use entry.

**Where:** `tests/integration/`. Slower (≤30s for the whole suite). Run on CI and pre-push.

## Layer 3 — VS Code integration (@vscode/test-electron)

Spin up VS Code with the extension installed, drive the webview via the test harness. Use sparingly — these are slow (~30s per test).

**Coverage targets:**
- Activation lifecycle (activation event fires, view registers, no errors in Output channel).
- Webview reload smoke (post-reload, dashboard renders with current state).
- Drill-in (click an agent tile → JSONL opens in the editor).
- Theme switch (toggle dark/light → no broken styling).

**Where:** `tests/vscode-integration/`. CI-only by default; locally on demand.

## Manual reload checklist

For every UI PR, Maya runs a manual reload before requesting Sage's QA. The checklist:

1. `Ctrl+Shift+P` → "Developer: Reload Window".
2. Open the ClaudeTeam dashboard (Activity Bar icon).
3. Confirm the dashboard renders the current state without errors in the Output channel.
4. Walk through each AC of the PR manually. Screenshot each one.
5. Toggle dark/light theme. Screenshot both.
6. Trigger an empty-state scenario (close all Claude Code sessions). Confirm dashboard shows the empty state gracefully.

## Self-Test Report contract

Every PR that affects UX (which is most of them) requires a Self-Test Report comment on the PR before requesting Sage's QA:

```markdown
## Self-Test Report

### AC walkthrough
- **AC1:** <description> — ✅ verified. Screenshot: <link>
- **AC2:** <description> — ✅ verified. Screenshot: <link>

### Side-effect inventory
- <surface this change can affect>

### Theme-switch probe
- Dark theme: <screenshot link>
- Light theme: <screenshot link>

### State-coverage
- Running: <screenshot>
- Idle: <screenshot>
- Finished: <screenshot>
- Empty: <screenshot>

### Failure-mode probes (for parser/host PRs)
- Missing session file: <observed behavior>
- Malformed JSONL: <observed behavior>
- Schema mismatch: <observed behavior>
- Empty roster: <observed behavior>
```

If the Self-Test Report is missing, Sage REQUESTs CHANGES with "Self-Test Report required" as the reason. No exceptions.

**PR-claim discipline (M3-01 NIT #2):** every "verified by test X" claim in the PR body or Self-Test Report must match the test's actual fixture shape, not the underlying mechanism. If the AC3 coalescing test rewrites the same file 3× via `bumpMtime` (rapid same-path mutations), don't claim it verifies vim-style `delete + create` atomic-replace — the mechanism (debounce resets) is the same, but the fixture shape isn't. Prefer "mechanism verified by <test>" over "<scenario> verified by <test>" when extrapolating.

### Placeholder-PR screenshot exception

If the PR's webview is a **placeholder slated for replacement in a downstream ticket** (i.e., a scaffold/stub that the next milestone PR overwrites end-to-end), the manual-reload screenshot binds at the **downstream** PR — not retroactively to the placeholder PR. The placeholder PR's Self-Test Report still includes AC walkthroughs and failure-mode probes, but the screenshot row can cite "screenshot binds at <downstream-ticket-id>" with a one-line justification.

**Originating example:** M2-01 (PR #22, scaffold + CSP-strict placeholder webview) → M2-05 (PR #24, real dashboard tile renderer). M2-05 shipped the manual-reload screenshots for the tile UI; re-shooting M2-01's empty-placeholder webview after the fact would have produced a screenshot of a deleted code path. Once a downstream PR replaces the placeholder, that downstream PR's screenshots are the binding artifact for the surface.

This exception does NOT apply when:
- The "placeholder" is the final shipped UI (no downstream PR planned).
- The downstream PR has not yet been scoped — speculation about future replacement is not a basis for skipping the screenshot.
- The placeholder PR changes user-visible chrome (icons, view titles, command palette entries) — those bind at the PR that introduces them, regardless of downstream UI work.

#### Install-path validation discipline

The placeholder exception releases the **screenshot** ACs at the first shipping PR; it does NOT release the **install path**. Even when the visible UI defers to a downstream PR, the `.vsix` install + activation on the project's target Node version (currently Node 22+) is load-bearing pre-merge for the FIRST shipping PR. A sponsor (or a GUI-capable agent if one exists in the loop) manually performs:

1. `vsce package --no-yarn`
2. `code --install-extension <vsix>`
3. Opens the Activity Bar entry for the extension
4. Confirms zero `ERR_REQUIRE_ESM` / activation errors in the Output channel within 5 seconds

Failure here blocks merge. The install path is the load-bearing test.

**Originating evidence (M2-01 → M2-08, PR #29).** The Node 22+ `ERR_REQUIRE_ESM` activation failure was latent from M2-01's `.vsix` and only surfaced at M2-08's Layer-3 tests three tickets later, because the placeholder exception masked the install-validation gap — screenshots had deferred, and the install path was implicitly deferred with them. By the time Layer-3 caught it, two more milestones had been authored against a `.vsix` that could not activate on the host machine. The discipline above is the rule that would have caught it at M2-01's PR-#22 review.

**Interaction with the sub-agent GUI gap.** When both the PR author and the designated reviewer are sub-agents, install-path validation is the ONE pre-merge gate that requires a GUI-capable executor (sponsor or a future GUI-capable agent). The data-plane smoke reframe (next section) covers webview-smoke at sub-agent author/reviewer pairs, but install activation cannot be smoke-tested from a headless harness — `code --install-extension` + Activity Bar open requires a real VS Code session. **Surface the install-validation requirement at dispatch time, not at merge time:** the dispatch brief should name who is performing the install (sponsor or a specific GUI-capable agent) so the merge gate isn't discovered to be unfulfillable after CI goes green.

### Sub-agent GUI gap — webview-smoke workaround

Sub-agents (Felix, Maya, and any other persona) run in a headless harness with no GUI session. They cannot drive `Developer: Reload Window`, take screenshots, or interact with VS Code's Activity Bar. This makes CLAUDE.md hard rule #3 ("Maya or the PR author posts a Self-Test Report confirming a manual webview reload worked end-to-end") structurally unachievable pre-merge for any webview-touching PR.

**Established pattern (first applied: M2-06, PR #28, 2026-05-24):**

- **AC(a) — data-plane smoke via live runTick:** the sub-agent runs the production `runTick()` path against real `~/.claude/` data and confirms the expected team/agent objects materialise end-to-end (e.g., Maya's M2-06 review materialized `claudeteam-alpha` with Felix + Maya tiles + 7 background agents). This is the load-bearing verification — it exercises the full parse → match → state-emit pipeline that drives the webview. Sub-agents CAN perform this; it is required pre-merge.
- **AC(b-d) — interactive screenshots** (`Reload Window`, tile click, Output channel capture over 30s, theme toggle): become **sponsor-side post-merge confirm-no-regression** rather than a blocking pre-merge gate. The Self-Test Report notes "screenshot AC deferred to sponsor post-merge per sub-agent GUI gap" for each affected AC.

**Why this is acceptable:** AC(a) covers the failure mode most likely to ship a regression (data-plane breakage). The screenshot ACs are visual-confirmation checks; if the data plane is correct and the webview rendering code is unchanged, regression risk from deferring screenshots is low.

**Criteria for applying this reframe:**
1. Both the PR author AND the designated reviewer are sub-agents (no human or GUI-capable agent in the loop).
2. The PR's data-plane smoke is performed and cited with verifiable evidence (real file path, real team name, observable output).
3. The sponsor is explicitly informed at merge time that (b-d) are deferred to post-merge confirm.

**This reframe does NOT apply when:**
- A human (sponsor) or a GUI-capable agent is available to perform the manual reload before merge.
- The PR changes webview rendering logic or CSS (not just data-plane code) — request a sponsor manual confirm before merge, not after.
- A Layer-3 `@vscode/test-electron` integration test (per M2-08) already covers the webview reload path — the automated test is the gate, not a screenshot.

**Sponsor obligation:** at first convenient opportunity after merging a PR where screenshots were deferred, open the extension, click through the affected views, note any visual regression in the originating ClickUp ticket comment. No formal Self-Test Report required — a one-line "confirmed no regression" or a follow-up bug ticket suffices.

**Sage QA gate:** accept the `sub-agent has no GUI` deferral for interactive-screenshot rows when a live data-plane smoke is present and cited. Do NOT REQUEST CHANGES solely for missing screenshots if the smoke evidence is there.

## Sage's QA contract

When the orchestrator dispatches Sage to QA a PR (vs author tests):

**REQUEST CHANGES when:**
- Self-Test Report missing.
- AC walkthrough not present or visually unconfirmed.
- Regression test not named for this bug class.
- Schema-drift not handled (for parser PRs).
- Manual reload screenshot missing (for UI PRs).
- Test coverage doesn't include at least one negative-path assertion.

**APPROVE when:**
- All AC met with cite-able evidence.
- Tests cover the bug class (not just the instance).
- Self-Test Report complete.
- Manual reload confirms behavior.

**Drain-mode preference:** err toward approving non-critical nits. Reserve REQUEST CHANGES for failed AC, regression risk, or contract violations.

## CI

GitHub Actions runs Layer 1 + Layer 2 on every push. Layer 3 runs on PRs targeting `main`. The merge gate is:

1. Layer 1 + 2 green.
2. Layer 3 green (PRs only).
3. Sage APPROVE comment.
4. Peer-reviewer APPROVE comment.

The orchestrator admin-merges with `gh pr merge --admin --squash --delete-branch`.

## Test fixtures

`tests/fixtures/` contains captured real-world data:

- `meta-old-schema.json` (v2.1.119)
- `meta-new-schema.json` (v2.1.145)
- `subagent-running.jsonl`
- `subagent-finished.jsonl`
- `subagent-malformed.jsonl`
- `session-alive.json`
- `session-dead-pid.json` (PID number that doesn't exist)
- `teams-valid.yaml`
- `teams-invalid.yaml` (YAML parse error)
- `teams-duplicate-ids.yaml`

Fixtures are **anonymized real captures**, not synthesized. When the schema changes, capture fresh fixtures from the new Claude Code version rather than editing existing ones.

## What we don't test

- Claude Code itself. It's an external dependency; we trust its output and probe behavior via Bram when behavior is ambiguous.
- Pixel Agents interop. Out of V1 scope.
- Cross-machine state sync. Out of V1 scope.
