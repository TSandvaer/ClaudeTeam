# Testing Strategy

Three layers plus a webview DOM-interaction sub-layer (Layer 2.5). Each layer catches a different bug class. None of them is optional. See "Layer 2.5 — Webview DOM-interaction" + "Layer decision rule" below for which layer a given behavior belongs in — the load-bearing rule is that FUNCTIONAL interactive behavior is NOT sponsor-deferrable.

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

## Layer 2.5 — Webview DOM-interaction (jsdom harness)

Added 2026-05-31 (ticket `86ca1u4ef`) after **four functional Manage Team panel bugs reached the sponsor** despite full data-plane coverage. The data-plane layers (host message protocol + reducer + fixture filesystem) assert *what the host sends*; they cannot assert *what the webview does over time* when DOM events and re-renders interleave. This layer fills that gap.

**What it is.** vitest tests that run under `@vitest-environment jsdom`, MOUNT the real webview components (no host, no VS Code API), and DRIVE them through **time-separated DOM events and simulated poll re-renders**. It is a sub-layer of Layer 2 (component tests) distinguished by its emphasis on *interaction sequence + render-cycle survivability* of webview-local state, not just first-paint output.

**Reference implementation:** `tests/unit/webview/panelInteraction.test.ts` (the four-bug harness). Sibling examples: `tests/unit/webview/overflowMenuPersistence.test.ts`, `tests/unit/webview/expandedGroupsTracker.test.ts`, `tests/unit/webview/removeMember.test.ts`.

### How to mount + drive a webview component

1. **Mount.** Build a detached root: `const mount = document.createElement("div")`. For a single component, call its `render*` function directly (`renderSetupWizard({ scanned, teamNameSeed, postMessage })` returns the root element). For a panel that lives inside the full render tree, call `renderFull(ctx, tree)` with a `RenderContext` (mount + `postMessage` spy + panel flags + any webview-local trackers) and a minimal `RenderableState` (`{ sessions: [], rosterErrors: [] }` is enough when the Manage Team branch short-circuits before the session walk).
2. **Drive.** Query the real selectors (`.ct-manage-pick-btn`, `.ct-wizard-preview-btn`, `.ct-character-cell`) and `.click()` / `dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`. jsdom toggles `checked` on `.click()` but does NOT always fire `change` — dispatch it explicitly when a listener reads it (`cb.click(); cb.dispatchEvent(new Event("change"))`).
3. **Simulate the poll tick.** Call `renderFull(ctx, tree)` a SECOND time with the **same** webview-local tracker instance. This reproduces the ~2s poll re-render that rebuilds the panel DOM — the exact moment webview-local open-state is lost if a fix is missing. Assert the post-re-render DOM (picker still open, banner still present, etc.).
4. **Capture host-bound messages.** Pass `postMessage` as `vi.fn()` (or `(m) => posted.push(m)`) and assert message shape with `posted.some((m) => m.type === "ui:assign-character")`.
5. **Timers.** For auto-dismiss / debounce behavior use `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` inside a `try/finally` that restores `vi.useRealTimers()`.

**Non-vacuity is mandatory.** Each describe block must FAIL when its fix is reverted. State the revert failure mode in a header comment (`panelInteraction.test.ts` lines 14-23 document it per bug). A DOM-interaction test that passes both with and against the fix is worthless — the four bugs shipped *because* the data-plane tests were vacuous w.r.t. interaction.

### Layer decision rule — which layer covers a given behavior

When a behavior needs a test, classify it and pick the layer. **The classification is not a preference — it is a contract:**

| Behavior class | Layer | Example |
|---|---|---|
| **Data-plane** — host parse / match / reduce / message shape, file-watcher state machine | Layer 1 (unit) + Layer 2 (fixture fs) | "the reducer seeds an `available` baseline tile for a never-run member"; "`ui:save-team` is posted with the correct payload" |
| **DOM-interaction (functional)** — a click / blur / keypress / re-render produces the correct *functional* result: an element opens/closes/persists, a value renders, a control toggles, webview-local state survives a poll tick | **Layer 2.5 (jsdom DOM-interaction) — REQUIRED** | "the picker stays open after a poll re-render"; "the Save banner survives the interleaved `setup:detection` re-render"; "the preview row shows the auto-derived role, not `—`" |
| **Sponsor-visual (fidelity only)** — pixel-level appearance, theme contrast, sprite animation smoothness, layout aesthetics, color correctness | Manual reload + sponsor confirm (deferred to sponsor) | "the running-state dot paints in the member's `color`"; "the idle sprite animates smoothly"; "dark/light theme contrast reads well" |

**The load-bearing rule (codified after the 2026-05-30 incident):**

> **FUNCTIONAL interactive behavior MUST have a Layer-2.5 DOM-interaction test. Only TRUE visual fidelity may be deferred to the sponsor.**

"Does the picker reopen after the poll tick?", "does Save show feedback?", "does the preview show the right role?" are **functional** questions with a deterministic right answer in jsdom — they are NOT visual-fidelity questions and may NOT be deferred. The only things the sponsor's eyes are the gate for are questions jsdom genuinely cannot answer: how a rendered thing *looks* (pixels, theme, animation feel), not whether it *works*.

**Decision test when unsure:** ask "can I assert the correct outcome on the jsdom DOM tree or on a captured `postMessage`?" If YES → it is functional → Layer 2.5 is required. If the only assertion possible is "a human looks at it and judges the appearance" → it is visual fidelity → sponsor-deferred. Most "the UI is broken" reports are functional; reach for visual-deferral sparingly.

### Cross-ref — the 2026-05-30 incident (why this layer exists)

Sponsor dogfood on build `8dc156b` found **four functional Manage Team panel bugs** that full data-plane coverage missed: (D, SEVERE) "Save team" had no visible effect — the banner was wiped by an interleaved `setup:detection` re-render; (A) preview roles showed `—` despite auto-derived roles; (B) the character picker vanished on the ~2s poll tick; (C) the picker thumbnail showed an arms-raised sprite instead of the neutral `default_idle` frame. All four are interaction-sequence / render-survivability failures — every one is now covered by a non-vacuous Layer-2.5 test (`panelInteraction.test.ts` for A/B/D; `teamSetupFs.test.ts` § `resolveThumbnailPath` for C). Full root-cause analysis: `team/bram-research/86ca1u41m-panel-quad-triage-2026-05-30.md` § "Why the data-plane tests missed all four". The data-plane tests at `tests/unit/webview/teamSetup.test.ts:333-360` asserted `ui:save-team`'s payload shape (a spy-only assertion that never touched banner DOM) and passed throughout — a textbook vacuous-w.r.t.-interaction case.

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

## Performance probes

For memory / leak / throughput investigations, the runtime under measurement matters: `tsx` (used by ad-hoc scripts like `scripts/measure-cadence.ts`) is NOT the production VS Code extension-host runtime, and retention / heap behavior diverges. Measurements done via `npx tsx <script>` can show patterns that are plausibly artifacts of the tsx runtime (transient harness arrays, module cache, transformer overhead) rather than the bundled `dist/extension/main.cjs` behavior.

**Probe discipline:**

- Frame measurement-class verdicts honestly: "plausibly clean — follow-up needed" is the right shape when probing in a non-target runtime. Avoid "no leak detected" claims based on tsx-only data — that's stronger than the evidence supports.
- For definitive verdicts on production memory posture, probe inside the VS Code extension-host process (Run Extension debug target OR installed `.vsix` in a fresh window) and capture heap via Task Manager / Activity Monitor / Process Explorer.
- The tsx-harness probe is still useful as a fast first signal — it can rule OUT obvious leaks (a +50 MB/min growth would be visible everywhere). But it cannot rule IN "no leak" definitively.

Codified after M4-04 PR #59 (`d9b1b49`) — Felix's `+4.6 MB / 10 min` tsx-harness delta correctly framed as "plausibly clean — follow-up needed"; extension-host validation deferred to ticket `86c9yjy4w`.

## What we don't test

- Claude Code itself. It's an external dependency; we trust its output and probe behavior via Bram when behavior is ambiguous.
- Pixel Agents interop. Out of V1 scope.
- Cross-machine state sync. Out of V1 scope.
