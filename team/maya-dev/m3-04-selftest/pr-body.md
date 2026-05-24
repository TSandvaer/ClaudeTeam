## M3-04 — `feat(webview): roster-error chip + filtered-empty state + open-roster button`

Final visible M3 surface — once shipped, M3 Wave 0 is functionally complete.

### What this PR ships

**New component — `src/webview/components/rosterErrorChip.ts`** — data-driven roster-error chip rendered at the top of the dashboard when `DashboardState.rosterErrors` is non-empty.

- Uses the `--vscode-inputValidation-error*` palette (semantic-error per Iris M2-03 §8.3).
- Per-session dismissible (×) — chip hides until the FIRST error message string changes. The dismissed-key lives in the webview `boot()` closure; `roster:loaded` clears it.
- Displays the first error verbatim + `(+N more)` when multiple. Clicking the chip body toggles a details panel listing every error.
- "Edit Roster" button dispatches `{ type: "ui:open-roster" }` — the M3-02 host handler auto-creates / opens `~/.claudeteam/teams.yaml`.

**Filtered-empty state — `src/webview/components/emptyState.ts`** — backwards-compatible API addition. `renderEmptyState({ filtered: true })` renders the M3-03 AC6 message:

> No Claude Code sessions for this workspace.
> Run `claude` in this folder, or enable `claudeteam.showAllSessionsGlobally` to see sessions from other workspaces.

`render.ts` passes `state.filterApplied === true` to switch variants; default call site (`renderEmptyState()`) remains the M2-05 generic line for back-compat.

**State-shape extension — `AgentTree` + `SerializedDashboardState`** — both gain `rosterErrors?: string[]` and `rosterWarnings?: string[]`. Plain `string[]` — JSON-safe; no flatten step needed. `serializeState` defaults missing fields to `[]` on the wire; `hydrateState` preserves `undefined` if the host omits them (back-compat with pre-M3-04 senders).

**Host wire-up — `src/extension/watcher/watcherLoop.ts`** — `runTick` stamps `rosterErrors` / `rosterWarnings` from `RosterLoadResult` onto the emitted tree (parallel to the M3-03 `filterApplied` pattern). `hashState` includes both new fields so a YAML break/fix triggers re-emit even when the tile set is unchanged.

### Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1 — `rosterErrorChip` renders when `rosterErrors` non-empty; semantic error palette; per-session dismissible; reappears on error change | met | `tests/unit/webview/rosterErrorChip.test.ts` describe blocks "error-count coverage" + "dismiss / re-show lifecycle" |
| AC2 — first error verbatim + `(+N more)`; click body → details panel | met | `tests/unit/webview/rosterErrorChip.test.ts` "renders with 3 errors" + "clicking the body toggles the details panel" |
| AC3 — Edit Roster button → `{ type: "ui:open-roster" }` | met | `tests/unit/webview/rosterErrorChip.test.ts` "dispatches { type: 'ui:open-roster' }" |
| AC4 — filtered-empty state when `sessions.length === 0 && filterApplied === true`; "Show all sessions" rendered as plain text (no new message wired) | met | `src/webview/components/emptyState.ts` + `src/webview/render.ts` empty branch; full-pipeline smoke confirmed `empty-state--filtered` element + setting name in DOM |
| AC5 — `DashboardState` + `SerializedDashboardState` gain `rosterErrors` + `rosterWarnings`; host populates per tick from `RosterLoadResult` | met | `src/shared/types.ts:349-380`, `src/shared/messages.ts:56-80`, `src/extension/messageBus.ts:42-68`, `src/extension/watcher/watcherLoop.ts:365-380` |
| AC6 — drill-in regression check | deferred to sponsor post-merge per sub-agent GUI gap (no changes to `agentTile.ts` click handler nor `sessionBlock` flow; data-plane smoke proves the state-shape extensions don't break the surrounding tree) |
| AC7 — theme-switch probe (dark+light screenshots of chip, filtered-empty, drill-in) | **deferred to sponsor post-merge per sub-agent GUI gap reframe** (CLAUDE.md hard rule #3 — sub-agent author + sub-agent reviewer; AC(a) data-plane smoke present) |
| AC8 — component tests in `tests/unit/webview/rosterErrorChip.test.ts` covering 0 / 1 / 3 errors, dismissed, re-show after change | met — 13 new tests, all green |
| AC9 — all tests pass | met — 262 unit passed / 2 skipped, 68 integration passed |

### Self-Test Report

#### AC(a) live data-plane smoke (sub-agent GUI gap workaround)

End-to-end pipeline verified via `team/maya-dev/m3-04-selftest/smoke.mjs` (Stages 1-3) + an ad-hoc vitest-jsdom probe (Stages 4-6, deleted after run — output captured below). The smoke broke a YAML on purpose and traced the error string through every boundary:

```
=== M3-04 AC(a) pipeline smoke evidence ===
broken YAML path: C:\Users\...\m3-04-pipeline-djMk8g\teams.yaml
loadRoster errors[0]: global roster YAML parse error (...): bad indentation of a mapping entry (3:14)
 1 | teams:
 2 |   - id: bad
 3 |       members: not-a-list
------------------^
 4 |   - 12345
wire rosterErrors length: 1
JSON round-trip preserved: true
hydrate rosterErrors length: 1
chip DOM has Edit Roster button: true
renderFull mounted chip above empty-state: true
```

Verifiable evidence:
- `loadRoster(brokenYaml).errors` non-empty with verbatim parser message.
- `serializeState(tree).rosterErrors` equals input errors (no Map/Set/Date — plain `string[]` survives JSON).
- `JSON.parse(JSON.stringify(wire))` round-trip preserves the array.
- `hydrateState(roundTripped).rosterErrors` deep-equals the input.
- `renderRosterErrorChip` returns a non-null element with the Edit Roster button + details panel + ARIA attrs.
- `renderFull` mounts the chip above the empty-state in the same DOM node.

#### AC walkthrough — behavior I exercised locally

- **0 errors** — chip absent. Generic / filtered empty-state renders per `filterApplied`.
- **1 error** — chip renders; summary is the verbatim parser message; no `(+N more)` suffix; clicking body toggles details panel (which lists the one error).
- **3 errors** — summary is `<first> (+2 more)`; details panel lists all three when expanded.
- **Dismiss** — clicking × calls `onDismiss(firstError)`, removes the chip from DOM; subsequent renders with `dismissedKey === errors[0]` short-circuit and return `null`.
- **Re-show on change** — next tick where `errors[0]` differs, the cached dismiss-key no longer matches and `renderRosterErrorChip` returns a fresh element.
- **`roster:loaded` reset** — `onRosterLoaded` handler in `main.ts` clears `rosterErrorDismissedKey` so post-recovery errors render on their own merit.
- **Filtered-empty** — when `sessions.length === 0 && filterApplied === true`, `empty-state--filtered` renders with the M3-03 AC6 string (headline + guidance with monospace `claude` and `claudeteam.showAllSessionsGlobally` codes).
- **Drill-in regression** — no changes to `agentTile.ts` click handler nor `sessionBlock` flow; the only state-shape change is two additive top-level string arrays. The 24 existing `dashboardTile.test.ts` tests + 5 `hydrateState.test.ts` tests pass unchanged.

#### Theme-switch probe

**Deferred to sponsor post-merge per sub-agent GUI gap reframe** (`.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround"). Sub-agent author (Maya) + sub-agent reviewer (Felix) — no GUI runtime in scope. The chip uses the same `--vscode-inputValidation-error*` palette as M2-05's existing `errorChip` (which sponsor confirmed visually after M2-06 merge), so regression risk on theme switching is low.

#### State-coverage screenshots

Same deferral. The component tests + full-pipeline smoke prove every state branch renders the expected DOM; screenshots become the post-merge confirm-no-regression artifact.

#### Webview-smoke gate — manual install + reload cycle

**Deferred to sponsor post-merge** per the same reframe. The data-plane is the load-bearing failure mode; visual confirmation is the secondary check. Expected manual steps post-merge:
1. `vsce package --no-yarn` (no manifest changes; pre-existing `vsix` works).
2. `code --install-extension claudeteam-0.0.1.vsix`.
3. Open ClaudeTeam Activity Bar.
4. Break `~/.claudeteam/teams.yaml` (e.g. `teams: [` and save) → chip appears within ~1s.
5. Restore valid YAML → chip disappears next tick.
6. Click "Edit Roster" → file opens in editor (M3-02 path).
7. Toggle `claudeteam.showAllSessionsGlobally` to `false` in a workspace with no live `claude` session → filtered-empty state renders.

### Side-effect inventory

- `AgentTree` / `SerializedDashboardState` shape change — additive, optional fields. CLI driver (`src/cli/agentTree.ts`) untouched; it continues to ignore the new fields (the CLI's render path doesn't read them, and `loadRoster`'s output is logged separately in the CLI).
- `runTick` output now carries 2 additional string arrays per tick. Negligible cost — same allocations the CLI already pays.
- `hashState` includes the new fields → state-deduper now re-emits on YAML-edit even when the tile set is unchanged. This is the *correct* behavior; M2-05's pre-existing hash would have swallowed the change.
- `emptyState.ts` API extended from `renderEmptyState()` to `renderEmptyState(props?)` — backwards-compatible default-arg. Existing test call sites unchanged.
- `RenderContext` interface gains `rosterErrorDismissedKey?` + `onRosterErrorDismiss?` — optional fields; the type extension does not break any existing `renderFull` caller.

### Failure-mode probes

- **Roster file missing** — `loadRoster` emits a `warning`, not an error → no chip, just an empty roster. Verified: `tests/unit/loader.test.ts` "missing file warns".
- **Roster YAML syntactically broken** — `loadRoster.errors[0]` populated → chip renders with the parser message + line/column context (js-yaml provides the snippet).
- **Roster schema-rejected** — Zod errors enumerated per issue path → all surface in `errors`; first one becomes the chip summary; rest available in the details panel.
- **`postState` host disposal mid-tick** — pre-existing M2-06 try/catch in `messageBus.ts` swallows; new fields don't change that surface.

### Files in play

Owned (Maya):
- `src/webview/components/rosterErrorChip.ts` (new)
- `src/webview/components/emptyState.ts` (variant added)
- `src/webview/render.ts` (RenderContext + chip wiring)
- `src/webview/main.ts` (dismiss-key closure + hydrator extension)
- `src/webview/styles/dashboard.css` (chip + filtered-empty styles)
- `tests/unit/webview/rosterErrorChip.test.ts` (new — 13 tests)
- `team/maya-dev/m3-04-selftest/smoke.mjs` (AC(a) artifact)
- `team/log/clickup-pending.md` (ENTRY rows)

Modified (cross-lane — coordinate with Felix's host PRs):
- `src/shared/types.ts` (`AgentTree.rosterErrors` + `.rosterWarnings`)
- `src/shared/messages.ts` (`SerializedDashboardState.rosterErrors` + `.rosterWarnings`)
- `src/extension/messageBus.ts` (`serializeState` passes new fields)
- `src/extension/watcher/watcherLoop.ts` (`runTick` populates + `hashState` includes)

### Non-obvious findings (for maintain-docs)

- **Dismiss-key contract pattern** — the chip is data-driven (state stream) rather than event-driven, so a one-shot DOM `.remove()` would re-appear on the next tick. The fix is a renderer-level closure key + a `dismissedKey` prop on the chip; the chip itself is stateless. This pattern is reusable for any future "data-driven dismissible UI" surface.
- **Hash-state inclusion** — when adding a new field to `DashboardState` that drives webview rendering, `watcherLoop.hashState` MUST include the field, or the webview won't re-render after a change. Caught here while wiring `rosterErrors`; same applies in retrospect to M3-03's `filterApplied` (already included by Felix).
- **Back-compat hydrator pattern** — using `...(wire.field !== undefined ? { field: wire.field } : {})` instead of unconditional copy preserves the `undefined` signal when the host explicitly omits a field. Useful for back-compat against pre-M3-04 wire shapes.

### Dispatch + lifecycle

- Branch: `maya/m3-04-webview-error-chip` (off `origin/main`).
- ClickUp: `<M3-04-TASK-ID>` (sub-agent MCP gap — orchestrator substitutes); status flips logged in `team/log/clickup-pending.md` ENTRY-2026-05-24T16:30:00Z and ENTRY-2026-05-24T16:35:30Z.
- Peer reviewer: Felix (per backlog cross-review pairing).
- Sage QA: requested next.
- Extension-manifest gate: NO (no `package.json` `contributes` changes).
- Webview-smoke gate: YES — AC(a) data-plane smoke present + cited; AC(b-d) interactive screenshots deferred to sponsor post-merge per sub-agent GUI gap reframe.
