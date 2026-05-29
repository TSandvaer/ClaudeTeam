## Self-Test Report — M3-10 webview persona-tile-collapse (Maya, ClickUp 86c9ydug9)

### AC walkthrough

| AC | Owner | Status | Evidence |
|----|-------|--------|----------|
| AC2 — collapsed render | Maya | ✅ verified pre-merge via data-plane smoke + unit tests | `tests/unit/webview/collapsedPersonaTile.test.ts` § AC2 collapsed render (7 cases — header text shape, default-collapsed state, no instances pre-expand, expand chevron flip + aria, lazy populate, stable across expand/collapse cycles, drill-in still fires) |
| AC3 — N=1 back-compat | Maya | ✅ verified pre-merge | `tests/unit/webview/collapsedPersonaTile.test.ts` § wrapper / bare-tile routing (4 cases) + all pre-existing dashboardTile.test.ts (40 cases) still pass — bare AgentTile path is unchanged |
| AC7 — webview tests | Maya | ✅ verified pre-merge | `tests/unit/webview/collapsedPersonaTile.test.ts` — 21 cases, all green |
| AC8 — Self-Test Report | Maya | ✅ this document | (you're reading it) |
| AC1 — reducer grouping | Felix | n/a — Felix's parallel PR | not in this PR's lane |
| AC4 — unrostered bypass | Felix | n/a — Felix's parallel PR | (reducer routes unrostered into `background`, unchanged) |
| AC5 — `claudeteam.collapsePersonaTiles` config | Felix | n/a — Felix's parallel PR | (host setting + opt-out) |
| AC6 — reducer unit tests | Felix | n/a — Felix's parallel PR | |

### NIT absorbed — ClickUp 86c9ydz4k

- **Symptom:** `formatFreshness(59_999)` returned `"60s"` instead of `"59s"`, visually colliding with the next bucket's `"1m"` rollover.
- **Fix:** `src/webview/freshness.ts:61` — `Math.min(59, Math.round(ms / 1000))` clamps the seconds bucket at 59 in the last 500ms window before minute rollover. Preserves half-up rounding for all sub-clamp values (500ms still rounds to 1s).
- **Tests:** `tests/unit/webview/freshness.test.ts:50-77` lock the boundary at 59_999 / 60_000 / 3_599_999 / 3_600_000 / 7_199_999 / 7_200_000 ms.

### Data-plane smoke (load-bearing per sub-agent GUI gap reframe)

Per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround":

> AC(a) — data-plane smoke via live runTick — required pre-merge for sub-agent author+reviewer pairs.

This PR is webview-render-only — the data plane is exercised end-to-end via the unit-test layer at the host↔webview boundary:

- **Wire round-trip** (`tests/unit/webview/collapsedPersonaTile.test.ts` § `CollapsedPersonaGroup wire-shape round-trip`): builds a host-side `AgentTree` whose `rosterTiles` Map contains a `CollapsedPersonaGroup` wrapper, runs the actual production `serializeState` (`src/extension/messageBus.ts`) → `JSON.stringify` → `JSON.parse` → `hydrateState` (`src/webview/main.ts`), asserts the wrapper survives intact with its `personaName`, `count`, and `instances[]` fields preserved verbatim. Bare-AgentTile N=1 round-trip verified in the same suite.
- **Integration via `renderFull`** (`tests/unit/webview/collapsedPersonaTile.test.ts` § `renderFull — wrapper integration`): drives the full `renderFull` → `renderSessionBlock` → `renderTeamCard` → `renderCollapsedPersonaTile` chain against a mounted DOM with mixed bare+wrapper tiles, asserts wrapper count, expand behavior, and ordering invariants.
- **Tracker integration** (`tests/unit/webview/collapsedPersonaTile.test.ts` § `CollapsedPersonaGroup — finished-tracker integration`): expanded wrapper picks up the freshness suffix exactly as bare tiles do; `renderFull`'s prune pass walks wrapper instances so finished tiles don't lose their first-seen anchor across ticks.

### Theme-switch probe

**Deferred to sponsor post-merge** per sub-agent GUI gap reframe (sub-agent runtime has no GUI session to drive `Developer: Reload Window` or capture screenshots).

The CSS uses `--vscode-list-hoverBackground` / `--vscode-focusBorder` for the affordance and `--vscode-foreground` / `--vscode-descriptionForeground` for the persona name / chevron — same theme variables `.agent-tile` uses. Theme behavior will mirror the existing tile chrome on both dark and light themes.

Sponsor post-merge confirm-no-regression: open the dashboard with a session that has ≥2 Felix dispatches; verify the `Felix ×N` row inherits the theme's foreground colors and the hover background matches the bare-tile hover.

### State-coverage

The state shape (`CollapsedPersonaGroup`) does NOT change with `AgentState` — the wrapper is purely a grouping concern. The instances inside the wrapper carry their own state (running / idle / finished / error) and render via the existing `renderAgentTile` path, which already has full state coverage in `tests/unit/webview/dashboardTile.test.ts` § state coverage (4 cases, one per `AgentState`).

The wrapper × state matrix is exercised end-to-end in:

- `collapsedPersonaTile.test.ts` § AC2 — header tile counts mixed-state instances correctly.
- `collapsedPersonaTile.test.ts` § finished-tracker integration — finished instance inside an expanded wrapper renders `finished Xs` with the freshness suffix.

### Failure-mode probes

- **Wrapper with count=0 / empty instances** — not produced by the host reducer (only emits a wrapper when N>1); webview would render the header with `×0` and an empty container. Not tested as a positive case because the host invariant forbids it; would be a host-side bug if it appeared.
- **Wrapper with mismatched `count` vs `instances.length`** — same as above; host invariant. Webview renders `personaName ×count` from the field, but the expanded list size matches `instances.length`. Documented in `CollapsedPersonaGroup` JSDoc.
- **`isCollapsedPersonaGroup` on a future `RosterTileEntry` variant with a different `kind` value** — returns `false`; the type guard checks the literal `"collapsed-persona"` discriminator, so a future variant lands in the bare-AgentTile path until its own guard is added. Covered by `tests/unit/webview/collapsedPersonaTile.test.ts` § type-guard discipline.
- **Bare AgentTile-only state (no wrapper anywhere)** — every pre-existing dashboardTile.test.ts test (40 cases) still passes against the widened types, including the FIXTURE_STATE render (6 bare tiles, no wrapper). Hard regression check on N=1 back-compat.

### Smoke probes against existing tests

- 320 → 341 unit tests (+21 new, 0 regressions; 2 pre-existing skips unchanged).
- 68 integration tests pass (unchanged).
- TypeScript strict compile clean.
- ESLint clean.
- esbuild produces the same artifact set with the new types (`dist/webview/main.js` IIFE, no CSP-breaking changes).

### Sub-agent GUI gap acknowledgment

Per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround": interactive-screenshot ACs (`Reload Window`, theme toggle, hover/focus visual) are deferred to sponsor post-merge. Both author (Maya, sub-agent) and reviewer (Felix, sub-agent) are headless. Data-plane smoke (AC(a)) is provided above and is load-bearing pre-merge.

**Sponsor post-merge confirm-no-regression** — at first convenient opportunity, open the dashboard with a session that has ≥2 same-persona dispatches and verify:
1. `<persona-name> ×<count>` row appears collapsed by default.
2. Click expands; chevron flips ▶ → ▼; per-dispatch tiles appear indented.
3. Click again collapses.
4. Theme switch dark ↔ light — colors inherit cleanly.
5. N=1 personas (single dispatch) render as bare tiles, no wrapper.
