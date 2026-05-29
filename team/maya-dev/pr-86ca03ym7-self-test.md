## Self-Test Report

### AC walkthrough

- **AC1 — When `tile.activity === "tool:?"`, the activity row is not rendered.** Verified by `tests/unit/webview/dashboardTile.test.ts` describe block `"renderAgentTile — hide activity row when tool absent (86ca03ym7)"` test 1 (`does NOT render .tile-row--activity when activity is the 'tool:?' sentinel`). The test asserts `el.querySelector(".tile-row--activity")` returns `null` and that all three other rows (`.tile-row--primary`, `.tile-row--role`, `.tile-row--model`) remain present. Component-test executed at PR open time: PASS (85/85 in the dashboardTile suite, 729/729 in the full unit suite).
- **AC2 — Real tool strings still render normally.** Verified by test 2 (`DOES render .tile-row--activity for a known tool (e.g. 'tool:Edit ...')`). Asserts the row IS present and the text matches `"tool:Edit src/foo.ts"` verbatim.
- **AC3 — Other activity strings (idle/finished/error) are unaffected.** Verified by test 3 (`DOES render .tile-row--activity for idle/finished/error activity strings`). Iterates over four representative activity strings (`"idle 14s"`, `"finished"`, `"finished 5m"`, `"error: agent state unavailable"`) and asserts each renders the row with the verbatim text content.

### Data-plane smoke (AC(a) — sub-agent GUI gap workaround per testing-strategy.md)

This PR is a pure DOM-render change in `renderAgentTile`. The data-plane (host parser, reducer, message bus, state diffing) is untouched. The component tests above exercise the production `renderAgentTile` function directly with the exact `AgentTile` shape that arrives over the host→webview wire — verifying the DOM output for every relevant input class. The test fixture (`makeTile` factory at `tests/unit/webview/dashboardTile.test.ts:47-60`) matches the real wire-shape (`AgentTile` type from `src/shared/types.ts:282-306`).

### Side-effect inventory

- **No CSS changed.** The hide is achieved by not appending the row element; existing `.tile-row--activity` selectors continue to apply when the row IS rendered. The padding-left indent calc on rows 2-4 (`dashboard.css:235-238`) is unaffected because rows 2 and 4 remain in the DOM.
- **No state-tracker change.** The `prevStateTracker` / `data-transition` mechanism (M4-05) only fires when `prevState !== tile.state`; activity-row presence/absence is orthogonal.
- **No `data-state` change.** The tile's `data-state` attribute is still set from `tile.state`, so all state-scoped CSS rules (running pulse, idle fade, finished check) continue to apply unchanged.
- **No aria-label change.** The aria-label still combines display + role + state — no information loss on the absent row because the state itself communicates the relevant context.

### Theme-switch probe

**Deferred to sponsor post-merge confirm per sub-agent GUI gap (testing-strategy.md §"Sub-agent GUI gap — webview-smoke workaround").** Sub-agent author + sub-agent reviewer (Felix) → no GUI session available. The change is structural (skip an element) rather than chromatic — no theme variables touched; both dark and light themes will render identically for the row absence (the row was using `--ct-color-fg-muted` text on `--vscode-editor-background`; absence is uniform across themes).

### State-coverage

**Component-test coverage** (executed at PR open):

- **Running + known tool** (`tile.activity = "tool:Edit src/foo.ts"`): row renders. (test 2)
- **Running + null tool** (`tile.activity = "tool:?"`): row does NOT render. (test 1 — the target behavior)
- **Idle** (`tile.activity = "idle 14s"`): row renders. (test 3a)
- **Finished bare** (`tile.activity = "finished"`): row renders. (test 3b)
- **Finished with elapsed** (`tile.activity = "finished 5m"`): row renders. (test 3c)
- **Error** (`tile.activity = "error: agent state unavailable"`): row renders. (test 3d)

**Interactive screenshots deferred** to sponsor post-merge confirm per the sub-agent GUI gap reframe. The DOM-shape verification by component test is the load-bearing pre-merge gate; sponsor's post-merge visual confirm catches any pixel-level regression (none expected — the change is a row-skip, not a CSS/color/layout edit).

### Failure-mode probes

- **`tile.activity` is `undefined`:** The TypeScript `AgentTile.activity: string` contract forbids this; the renderer's `activityText` always resolves to a string. If a wire-deserialization bug ever produced `undefined`, the `!== "tool:?"` comparison would be `true` and the row would render with `String(undefined) === "undefined"` text — a visible diagnostic, not a crash.
- **`tile.activity` is an empty string:** Not the sentinel — row renders with an empty `.agent-activity` span. Acceptable (the wire contract requires a non-empty string; this would be a host-side bug visible as a blank row).
- **Sentinel introduced via a different value (e.g. `"tool:"`, `"tool:undefined"`):** Won't trigger the hide. Documented in the PR-body "Non-obvious findings" section — the only sentinel is the exact string `"tool:?"`.

### Reviewer-detach note

Will perform `git switch --detach HEAD` as the final step before reporting back to the orchestrator — addresses the merge-block failure mode from prior PRs.
