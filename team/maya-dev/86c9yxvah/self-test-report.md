## Self-Test Report

### AC walkthrough

- **AC1** — Renderer computes group state via `running > idle > all-finished > error` priority. **met** — `computeGroupState()` in `src/webview/components/collapsedPersonaTile.ts:113-132`; state-dot rendering at lines 205-213.
- **AC2** — Unit test: `[finished, idle, finished]` renders as `idle`. **met** — `tests/unit/webview/collapsedPersonaTile.test.ts` test name `"AC2: [finished, idle, finished] → idle"`; assertion `expect(computeGroupState(instances)).toBe("idle")`; plus end-to-end DOM assertion in `"state-dot mirrors the computed group state"` test.
- **AC3** — Unit test: `[finished, finished]` renders as `finished`. **met** — test `"AC3: [finished, finished] → finished"`.
- **AC4** — Unit test: `[running, finished]` renders as `running`. **met** — test `"AC4: [running, finished] → running"`; plus end-to-end DOM assertion in `"running group renders a running state-dot"` test.
- **AC5** — NO change to reducer or host-side code. **met** — diff scoped to `src/webview/components/collapsedPersonaTile.ts` + `tests/unit/webview/collapsedPersonaTile.test.ts` + `team/log/clickup-pending.md`. No changes under `src/extension/`, `src/shared/`, or `src/cli/`. Verify: `git diff --stat origin/main...HEAD` shows only webview + tests + log.

### Side-effect inventory

- **`dashboard.css`** — UNTOUCHED. The new state-dot reuses existing selectors `.state-dot[data-state="running" | "idle" | "finished" | "error"]` from `src/webview/styles/dashboard.css:247-281` (M2 §5.2 + M4-01 §2.2 running-pulse).
- **Host-side reducer (`src/extension/state/reducer.ts`)** — UNTOUCHED (AC5).
- **`CollapsedPersonaGroup` wire shape (`src/shared/types.ts`)** — UNTOUCHED. The group state is COMPUTED in the webview, not added to the wire type.
- **`agentTile.ts` / per-instance rendering** — UNTOUCHED. Per-tile state dots inside an expanded group still render via the existing `renderAgentTile` path.
- **`teamCard.ts` / `render.ts`** — UNTOUCHED. The wrapper-vs-bare routing is unchanged.
- **Public API** — `computeGroupState` newly exported for unit testing; everything previously exported (`renderCollapsedPersonaTile`, `isCollapsedPersonaGroup`, `CollapsedPersonaTileProps`) is back-compatible.
- **Aria-label format** — extended from 2-segment (`Felix grouped — 3 instances, collapsed`) to 3-segment (`Felix grouped — 3 instances, Running, collapsed`). Screen-reader users now hear the state at the group level. Confirmed by tests; one existing test updated to match new format.

### Sub-agent GUI gap reframe

Per `.claude/docs/testing-strategy.md § Sub-agent GUI gap — webview-smoke workaround`: both PR author (Maya) and designated reviewer (Felix) are sub-agents with no GUI session. AC(a) data-plane smoke is the load-bearing pre-merge gate; AC(b-d) interactive screenshots defer to sponsor post-merge.

### AC(a) — Data-plane smoke (load-bearing)

The data plane here is purely webview-side (the host emits the same `CollapsedPersonaGroup` shape it did pre-PR; the change is wholly within `renderCollapsedPersonaTile()`). The data-plane is exercised end-to-end by the new unit tests against jsdom — `AgentTile[]` input → `computeGroupState` → DOM with `data-state` + `.state-dot[data-state="..."]`.

Cite-able evidence (all from `tests/unit/webview/collapsedPersonaTile.test.ts`, observed under `npx vitest run`):

```
✓ tests/unit/webview/collapsedPersonaTile.test.ts (33 tests)
  ✓ computeGroupState — worst-case-live-instance priority (86c9yxvah)
    ✓ AC2: [finished, idle, finished] → idle
    ✓ AC3: [finished, finished] → finished
    ✓ AC4: [running, finished] → running
    ✓ running beats every other state regardless of position
    ✓ idle beats finished when at least one idle is present
    ✓ error surfaces only when no running/idle AND not all finished
    ✓ running takes priority over error (live activity dominates)
    ✓ empty instances → error (defensive — should not happen on the wire)
  ✓ renderCollapsedPersonaTile — group state-dot rendering (86c9yxvah)
    ✓ state-dot mirrors the computed group state
    ✓ running group renders a running state-dot (sponsor's at-a-glance read)
    ✓ aria-label includes the state segment in collapsed AND expanded modes
```

Full project: `397 passed | 2 skipped (399)` across 21 test files (`npx vitest run`). Typecheck clean (`tsc --noEmit`). Lint clean (`eslint .`). Build clean (`npm run build`).

### AC(b) — Reload Window smoke

DEFERRED to sponsor post-merge per sub-agent GUI gap. Once the merged `.vsix` is installed, dispatch (or simulate) 2 finished + 1 running of the same persona; confirm the collapsed group header displays a state-dot in the running color (theme tokens: `--ct-color-state-running`).

### AC(c) — Theme-switch probe

DEFERRED to sponsor post-merge per sub-agent GUI gap. Regression risk is structurally low — the new state-dot reuses CSS selectors already shipped for `agentTile.ts`; no new color tokens introduced.

### AC(d) — State-coverage screenshots

DEFERRED to sponsor post-merge per sub-agent GUI gap. The four `AgentState` values (`running`, `idle`, `finished`, `error`) propagate to the `data-state` attribute on both the section wrapper AND the state-dot; verified at the DOM level by the unit tests.

### Failure-mode probes

- **Empty-instances group** (defensive, should not occur on the wire per reducer invariant `count >= 2`) → `computeGroupState([])` returns `error`. Test name `"empty instances → error (defensive — should not happen on the wire)"`. Rationale: surfacing `error` makes a host-side invariant violation visible rather than silently picking `finished`.
- **All-finished group** → `finished` only when EVERY instance is `finished` (no `running`, no `idle`, no `error`). Verified by AC3 test + by negative path `[finished, error] → error`.
- **Order-independence** → `[finished, idle, error, running]` with `running` at index 3 still returns `running`. Test name `"running beats every other state regardless of position"`.
- **Group state vs per-instance state** — group label is COMPUTED from instances; per-tile state-dots inside the expanded list continue to render the per-instance state via the unchanged `renderAgentTile` path. A user expanding a group with mixed states sees each instance's true state.

### Verification commands run

```
cd c:/Trunk/PRIVATE/ClaudeTeam-maya-wt

npx vitest run tests/unit/webview/collapsedPersonaTile.test.ts
  → 33 tests passed (22 prior + 11 new)

npx vitest run
  → 397 passed | 2 skipped (399) across 21 files

npm run typecheck
  → tsc --noEmit (no output, clean)

npm run lint
  → eslint . (no output, clean)

npm run build
  → dist/extension/main.cjs (668.4kb) + dist/webview/main.js + dist/webview/dashboard.css + dist/cli/agentTree.js, all built clean
```

### Sponsor confirmation request (post-merge)

When convenient, please confirm in the installed `.vsix`:

1. Dispatch (or simulate, e.g. via fixture state) 2+ instances of one persona where states are mixed (e.g. 2 finished + 1 running).
2. Open the dashboard; verify the collapsed-group header (`<Persona> ×<N>`) shows a colored state-dot.
3. Verify the state-dot color reflects the worst-case-live-instance (running > idle > finished > error).
4. (Optional) toggle dark/light theme; the state-dot color comes from theme tokens shared with bare agent tiles — should be consistent.
