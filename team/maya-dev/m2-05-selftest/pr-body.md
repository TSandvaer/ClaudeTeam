## Summary

Implements the webview half of the host↔webview bridge for M2-05 per Iris's M2-03 spec. Vanilla TypeScript renderer + typed message receiver + static-fixture mode so the dashboard renders without VS Code or live data; Felix's M2-06 layers live data on top.

- Ticket: ClickUp [`86c9y7uka`](https://app.clickup.com/t/86c9y7uka)
- Peer reviewer: **Felix** (Felix ↔ Maya cross-review pair)
- Spec: `team/iris-ux/m2-dashboard-tile-spec.md`

## What ships

| Surface | File | Purpose |
|---------|------|---------|
| Message dispatcher | `src/webview/messageReceiver.ts` | Typed `window.message` → per-type handler dispatch with unknown-message defense (AC1). |
| Renderer | `src/webview/render.ts` | `renderFull` wholesale replace; `applyDelta` typed no-op until host emits deltas (AC3, AC7). |
| Components | `src/webview/components/{agentTile,teamCard,sessionBlock,backgroundChip,emptyState,errorChip}.ts` | Vanilla-TS DOM builders, exact shape per Iris §4–§8. |
| Styles | `src/webview/styles/dashboard.css` | All colors from `--vscode-*` vars except the 4 semantic state-dot hex (spec §10.2). No inline styles. |
| Fixtures | `src/shared/fixtures.ts` | `FIXTURE_STATE` covers all 6 personas × all 4 states (AC9). |
| Message types | `src/shared/messages.ts` | `StateDelta` shape `{added, updated, removed}` per Felix's M2-04 plan (dispatch brief coordination). |
| Build | `esbuild.config.mjs` | 4th target emits `dist/webview/dashboard.css`. |
| Provider | `src/extension/view/provider.ts` | Adds `<link rel="stylesheet">` for CSS bundle. No CSP change. |

## Tests

- **24 new component tests** in `tests/unit/webview/dashboardTile.test.ts` (vitest + jsdom):
  state coverage (all 4 dot colors), display/role/activity/model text, keyboard activation
  (Enter/Space), bg-chip toggle, error-chip Open Roster dispatch, `renderFull` re-render
  discipline. **All 164 unit tests + 31 integration tests green; `tsc --noEmit` clean.**

## Self-Test Report

Per CLAUDE.md hard rule #3 — full report at [`team/maya-dev/m2-05-selftest/SELF-TEST.md`](team/maya-dev/m2-05-selftest/SELF-TEST.md). The webview can't be reloaded in VS Code from a sub-agent shell (no GUI), so screenshots were captured by serving the **exact** `dist/webview/main.js` + `dist/webview/dashboard.css` through a stand-alone harness (`harness.html`) under headless Edge with the spec §10.1 theme variables.

Seven PNGs cover:

| File | What it shows |
|------|---------------|
| `01-fixture-dark.png` | All 4 states (Felix green/Maya amber/Iris grey/Sage red) + collapsed bg chip + dead session, dark theme |
| `02-fixture-light.png` | Same in light theme — state dots unchanged, all other colors flipped |
| `03-bgchip-expanded-dark.png` | Bg chip expanded, 3 detail rows visible, chevron ▶→▼ |
| `04-empty-dark.png` | "No live Claude Code sessions." empty state |
| `05-error-roster-dark.png` | Roster-error chip at top + Open Roster File button |
| `06-empty-light.png` | Light theme empty state |
| `07-error-roster-light.png` | Light theme error chip — `--vscode-inputValidation-error*` vars apply |

The first **real** VS Code reload happens when Felix's M2-06 merges; the webview-smoke gate at that point should live-verify against `~/.claude/`. Sage's QA may also choose to install the VSIX and reload locally — `npm run build && npx vsce package --no-yarn` produces a 31.57 KB `claudeteam-0.0.1.vsix` that installs cleanly.

## Coordination with M2-04 (Felix)

Per dispatch brief: implemented against existing `AgentTree` (current `DashboardState` alias) + the planned `StateDelta` shape `{added, updated, removed}`. If M2-04 renames `AgentTree → DashboardState` or refines the delta shape, this PR rebases mechanically — no logic change.

## Test plan (Felix → Sage)

- [ ] Felix peer-review: confirm message-protocol contracts match `src/shared/messages.ts` (added `StateDelta` shape ok?), CSP unchanged, no inline scripts/styles in injected HTML.
- [ ] Felix peer-review: confirm `acquireVsCodeApi()` shim pattern is sound (called once, browser-fallback for dev).
- [ ] Sage QA: install VSIX in VS Code, reload window, open ClaudeTeam Activity Bar. Expected — webview renders FIXTURE_STATE (since M2-06 isn't wired yet, the live-data path is the dev-fallback path). Confirm no Output channel errors, theme switch works, click on a tile fires `ui:open-transcript` (M2-06 will handle it; M2-05 just dispatches).
- [ ] Sage QA: verify Self-Test screenshots match what a live VS Code reload produces.
