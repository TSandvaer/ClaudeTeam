## Change

Hide the `.tile-row--activity` row on `<article class="agent-tile">` when the host emits the `"tool:?"` sentinel (running state + no current tool). Tile renders three rows instead of four; vertical layout collapses naturally.

**Before** (running + null `lastTool` — fresh spawn / between-tool-call moments):
```
[●] Felix
    Extension Host Dev
    tool:?            ← noise per sponsor
    claude-opus-4-7
```

**After:**
```
[●] Felix
    Extension Host Dev
    claude-opus-4-7
```

## Why

Sponsor V1 dogfood observation: `tool: ?` reads as noise rather than information. The reducer correctly stamps `"tool:?"` to keep the `tool:` prefix consistent for the CLI presenter (per M1-09 follow-up), but in the dashboard's visual context the row is more honest absent than as a `?` placeholder.

Sponsor decision LOCKED (ticket `86ca03ym7`): hide entirely. NOT em-dash, NOT state-aware label.

## Mechanism — webview-side, not parser

The fix recognizes the `"tool:?"` sentinel in `renderAgentTile` and skips the row construction entirely (`src/webview/components/agentTile.ts:283-295`).

OOS per dispatch brief: changing the reducer. The wire-shape sentinel stays load-bearing for the CLI presenter and any future non-webview consumers — only the webview renders the visual absence. Host-side reducer (`src/extension/state/reducer.ts:541`) unchanged.

## Files touched

- `src/webview/components/agentTile.ts` — guard the activity row construction on `activityText !== "tool:?"`. Cite block in comment references ticket id + sponsor decision.
- `tests/unit/webview/dashboardTile.test.ts` — new `describe("renderAgentTile — hide activity row when tool absent (86ca03ym7)")` block, 3 tests:
  1. Sentinel → no `.tile-row--activity` element; other rows still present.
  2. Real tool string (`"tool:Edit src/foo.ts"`) → row renders normally (negative path).
  3. Idle / finished / error activity strings render normally — sentinel scope is exclusively `"tool:?"`.

## CI evidence

- `npm run typecheck` — clean.
- `npm test` — 729 passed, 2 skipped (no regressions; 3 new tests in the dashboardTile suite, which goes from 82 → 85 tests).
- `npm run lint` — clean.
- `npm run build` — both bundles emit (`dist/extension/main.cjs`, `dist/webview/main.js`).

## Hard-rule gates

- **#3 webview-smoke gate:** see Self-Test Report comment for AC walkthrough + data-plane smoke + screenshot deferral note (sub-agent author + sub-agent reviewer per testing-strategy.md §"Sub-agent GUI gap — webview-smoke workaround"). The DOM-shape change is fully covered by the 3 new component tests.
- **#4 extension-manifest gate:** N/A — no `package.json` change.
- **#8 final-report:** tightened; details live here in the PR body.
- **#10 never-fabricate:** all cited file:line refs verified against the live worktree at branch `maya/86ca03ym7-hide-tool-row-when-absent` (main `58e86b8` + this change).

## Non-obvious findings

The sentinel `"tool:?"` is the ONLY value that triggers the hide. Other run-state strings (`"tool:Edit ..."`, `"idle Xs"`, `"finished"`, `"finished Xm"`, `"error: ..."`) all render normally. If a future reducer change introduces a different "absent" sentinel (e.g. `"tool:"` with empty suffix), the webview guard will need extension — the load-bearing contract is documented in the inline comment block referencing ticket `86ca03ym7`.
