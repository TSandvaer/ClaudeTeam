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

### Placeholder-PR screenshot exception

If the PR's webview is a **placeholder slated for replacement in a downstream ticket** (i.e., a scaffold/stub that the next milestone PR overwrites end-to-end), the manual-reload screenshot binds at the **downstream** PR — not retroactively to the placeholder PR. The placeholder PR's Self-Test Report still includes AC walkthroughs and failure-mode probes, but the screenshot row can cite "screenshot binds at <downstream-ticket-id>" with a one-line justification.

**Originating example:** M2-01 (PR #22, scaffold + CSP-strict placeholder webview) → M2-05 (PR #24, real dashboard tile renderer). M2-05 shipped the manual-reload screenshots for the tile UI; re-shooting M2-01's empty-placeholder webview after the fact would have produced a screenshot of a deleted code path. Once a downstream PR replaces the placeholder, that downstream PR's screenshots are the binding artifact for the surface.

This exception does NOT apply when:
- The "placeholder" is the final shipped UI (no downstream PR planned).
- The downstream PR has not yet been scoped — speculation about future replacement is not a basis for skipping the screenshot.
- The placeholder PR changes user-visible chrome (icons, view titles, command palette entries) — those bind at the PR that introduces them, regardless of downstream UI work.

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
