## Summary

Fix Defect 6b (ClickUp `86c9yxvah`) — a collapsed persona-group header (e.g. `Priya ×3`) had **no state indicator at all**, so a group containing one live `idle` Priya and two `finished` Priyas read identically to a group of three `finished` Priyas. The dogfood (Bram's triage in `team/bram-research/86c9yteju-triage-2026-05-26.md` § Defect 6b) reported the group "shows `finished` for an `idle` instance"; the root cause turns out to be the absence of any group-level state surface, not a wrong-state selection.

This PR introduces a `computeGroupState(instances)` helper and renders a state-dot on the header reflecting most-active-first priority: `running` > `idle` > `finished` > `error`. Reuses the existing `.state-dot[data-state="..."]` CSS rules from `agentTile.ts` (M2 §5.2 + M4-01 §2.2 running-pulse) — no new CSS.

## Before / after (DOM shape)

```
BEFORE (pre-86c9yxvah):
<section class="collapsed-persona" data-persona-name="Priya" data-expanded="false">
  <button class="collapsed-persona-header" aria-label="Priya grouped — 3 instances, collapsed">
    <span class="collapsed-persona-chevron">▶</span>
    <span class="collapsed-persona-name">Priya ×3</span>
  </button>
  ...
</section>

AFTER:
<section class="collapsed-persona" data-persona-name="Priya" data-expanded="false" data-state="idle">
  <button class="collapsed-persona-header" aria-label="Priya grouped — 3 instances, Idle, collapsed">
    <span class="state-dot" data-state="idle" aria-label="Idle" title="Idle"></span>
    <span class="collapsed-persona-chevron">▶</span>
    <span class="collapsed-persona-name">Priya ×3</span>
  </button>
  ...
</section>
```

## Root cause confirmation (Bram's hypothesis)

**Refuted in its exact form.** Bram's triage at `team/bram-research/86c9yteju-triage-2026-05-26.md` § Defect 6b flagged this as load-bearing-unverified: *"the webview source (`src/webview/`) was not read in this session ... This is the load-bearing open question for Defect 6b's root cause."* I verified by reading `src/webview/components/collapsedPersonaTile.ts` pre-edit (specifically the `renderCollapsedPersonaTile()` function, lines 90-199 on `3296167`).

There was **no first-instance selection logic, no majority-vote logic, and no state label of any kind** on the collapsed-group header. The header rendered `<personaName> ×<N>` and a chevron. The "shows `finished` for an `idle` instance" perception in the dogfood arose because:

- The bare-tile renderer (`agentTile.ts:188-191`) does emit a `.state-dot` with `data-state` — so an N=1 Priya rendered as a bare tile shows a state indicator correctly.
- The wrapper renderer (`collapsedPersonaTile.ts`) did NOT emit any state-dot at the group level — so an N≥2 Priya group displayed only `Priya ×3` with no aggregate state signal. The user has to expand to see per-instance state.

The fix is to **introduce** the group-level state-dot with the priority order specified in AC1, rather than fix an existing wrong-state selection (which didn't exist).

## Implementation

**`src/webview/components/collapsedPersonaTile.ts`** (+95 lines)

- New exported `computeGroupState(instances: AgentTile[]): AgentState` — pure function over per-instance states implementing the AC1 priority:
  - any `running` → `running`
  - else any `idle` → `idle`
  - else all `finished` → `finished`
  - else `error`
- Renderer now:
  - Computes the group state once during render.
  - Sets `section.dataset.state = groupState` for future CSS hooks at the section level.
  - Inserts a `<span class="state-dot" data-state="...">` as the FIRST child of the header (before chevron and persona name), matching the visual scan order in `agentTile.ts`.
  - Extends the aria-label from 2-segment (`Felix grouped — 3 instances, collapsed`) to 3-segment (`Felix grouped — 3 instances, Running, collapsed`) so screen-reader users get the state at the group level.
- `STATE_LABEL` mirrors the table in `agentTile.ts` so the aria-label vocabulary is consistent across both tile shapes.
- Empty-instances input (defensive — should not occur on the wire per reducer invariant `count >= 2`) returns `error` so the host invariant violation is visible in the dashboard rather than silently picking `finished`.

**No host-side / reducer changes** (AC5).

## Test coverage

`tests/unit/webview/collapsedPersonaTile.test.ts` — new `describe` blocks (+ ~180 lines):

**`computeGroupState — worst-case-live-instance priority`** (8 cases):
- **AC2** `[finished, idle, finished] → idle` — exact dogfood Priya×3 scenario.
- **AC3** `[finished, finished] → finished`.
- **AC4** `[running, finished] → running`.
- Running-last (order-independence): `[finished, idle, error, running] → running`.
- Idle-first: `[idle, finished, finished] → idle`.
- `[finished, error] → error` (residual branch).
- `[running, error] → running` (live activity dominates).
- Empty input → `error` (defensive).

**`renderCollapsedPersonaTile — group state-dot rendering`** (3 cases):
- State-dot reflects the computed group state (dataset + aria-label + title); section also carries `data-state`.
- Running group renders running state-dot end-to-end.
- Aria-label includes the state segment in both collapsed and expanded modes.

Plus updated the existing defensive-count test to account for the new 3-segment aria-label (was 2-segment).

Total: 33 tests in this file (22 prior + 11 new). Project-wide: 397 passed + 2 skipped, all green.

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npx vitest run` — `397 passed | 2 skipped (399)` across 21 test files.
- `npm run build` — clean; host CJS + webview IIFE + CLI ESM + dashboard CSS all built.

## Self-Test Report (sub-agent GUI gap reframe)

Both author (Maya) and reviewer (Felix) are sub-agents — per `.claude/docs/testing-strategy.md § Sub-agent GUI gap — webview-smoke workaround`, AC(a) data-plane smoke is required pre-merge; AC(b-d) interactive screenshots deferred to sponsor post-merge.

### AC(a) — data-plane smoke

The state-aggregation path is exercised end-to-end by the new unit tests:

- **Inputs:** `AgentTile[]` arrays with mixed states (the type that `CollapsedPersonaGroup.instances` carries on the wire).
- **Path:** `computeGroupState(instances)` → `renderCollapsedPersonaTile` → DOM with `data-state` + `.state-dot[data-state="..."]`.
- **Outputs verified (cite-able):**
  - `[finished, idle, finished]` → `el.dataset.state === "idle"` AND `el.querySelector(".state-dot").dataset.state === "idle"` (test "state-dot mirrors the computed group state", `tests/unit/webview/collapsedPersonaTile.test.ts`).
  - `[running, finished]` → `el.dataset.state === "running"` (test "running group renders a running state-dot").
  - `[finished, finished]` aria-label = `Maya grouped — 2 instances, Finished, collapsed` → flips to `..., Finished, expanded` on click (test "aria-label includes the state segment in collapsed AND expanded modes").

Live `runTick()` against `~/.claude/` is unnecessary here — the change is wholly within the webview renderer; the host emits the same `CollapsedPersonaGroup` shape it did pre-PR. The renderer's input contract is `AgentTile[]` which is what the unit tests feed.

### AC(b) — Reload Window smoke

DEFERRED to sponsor post-merge per sub-agent GUI gap.

### AC(c) — Theme-switch probe

DEFERRED to sponsor post-merge per sub-agent GUI gap. The state-dot reuses CSS rules from `.state-dot[data-state="..."]` in `dashboard.css` already shipped in M2 — theme-handling regression risk is zero (no new color tokens, no new selectors).

### AC(d) — State-coverage screenshots

DEFERRED to sponsor post-merge per sub-agent GUI gap. The four `AgentState` values render the dot in the same way the bare `agentTile` does today (verified at the `data-state` attribute level by the unit tests above).

### Side-effect inventory

- `dashboard.css` — UNTOUCHED. Reuses existing `.state-dot[data-state="..."]` selectors.
- Host-side reducer — UNTOUCHED (AC5).
- `CollapsedPersonaGroup` wire shape — UNTOUCHED. The new state is COMPUTED in the webview, not added to the wire type.
- Public exports — `computeGroupState` newly exported for unit testing; back-compat (no removals).
- aria-label format — extended from 2-segment to 3-segment; screen-reader users now hear the state. Confirmed via tests.

### Failure-mode probes

- Empty-instances group (defensive, should not occur on the wire) → `error` (verified in test).
- All-finished group → `finished` only when EVERY instance is finished (verified, AC3).
- Mixed running + error → `running` wins (verified — live activity dominates).
- Order-independence → running at index 3 still wins (verified).

## Verdict matrix vs ACs

| AC  | Description                                                              | Status |
|-----|--------------------------------------------------------------------------|--------|
| AC1 | Renderer computes group state via `running > idle > all-finished > error` priority | met — `computeGroupState()` + state-dot rendering |
| AC2 | Unit test: `[finished, idle, finished]` renders as `idle`                | met — `"AC2"` test in `computeGroupState` describe |
| AC3 | Unit test: `[finished, finished]` renders as `finished`                  | met — `"AC3"` test |
| AC4 | Unit test: `[running, finished]` renders as `running`                    | met — `"AC4"` test |
| AC5 | NO change to reducer or host-side code                                   | met — diff scoped to `src/webview/components/collapsedPersonaTile.ts` + tests |

## Non-obvious findings (for maintain-docs)

1. The `collapsedPersonaTile` header pre-PR had no state surface at all — Bram's hypothesis about "first-instance or majority state selection" doesn't match reality; the failure mode was absence-of-signal, not wrong-signal. Worth capturing as a "trust your file:line verification, not the analytic prior" lesson in process-incidents.
2. The fix reuses `.state-dot[data-state="..."]` CSS rules already shipped in `dashboard.css` for `agentTile.ts` — no new CSS needed. Token-reuse pattern: any future "group-level state indicator" should reach for the same selectors. Could note in `vscode-extension-conventions.md § Webview rules` (theme-variables-only paragraph).
3. Empty-instances input → `error` is a defensive choice; the reducer invariant is `count >= 2` per `src/shared/types.ts` JSDoc, so this branch should never fire — but if a host-side invariant violation slips through (e.g. mid-tick race), surfacing `error` makes the bug visible rather than silently picking `finished`.

## Source

- ClickUp `86c9yxvah` — Defect 6b "fix(webview): CollapsedPersonaGroup state label should reflect worst-case live instance, not first instance"
- `team/bram-research/86c9yteju-triage-2026-05-26.md` § Defect 6b — load-bearing-unverified hypothesis (refuted by webview source read; underlying defect confirmed at a different layer).
- `src/webview/components/collapsedPersonaTile.ts` (pre-PR @ `3296167`, lines 90-199).
- `src/webview/components/agentTile.ts:188-191` — state-dot pattern reused.
- `src/webview/styles/dashboard.css:247-281` — `.state-dot[data-state="..."]` selectors reused.
