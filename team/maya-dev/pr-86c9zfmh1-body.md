## Summary

CollapsedPersonaGroup wrappers (M3-10 surface) snap shut on every ~2s
host poll-tick. Sponsor verbatim symptom (Obs 10, `86c9zfmh1`):

> If i click on bram i see image 2, but it closes in 1 second everytime
> i try to expand a finished agent.

Root cause: `renderFull` does a wholesale `mount.replaceChildren()` on
every `state:full` arrival, and each `renderCollapsedPersonaTile` call
constructs a fresh `<section>` with `data-expanded="false"`. There was
no webview-local state preserving the user's expansion intent across
re-builds.

Fix: a new webview-local `ExpandedGroupsTracker` (`Set<string>` keyed
by `sessionId:teamId:personaName`) threaded through
`renderFull → sessionBlock → teamCard → renderCollapsedPersonaTile`.
Same pattern + lifecycle as `finishedTracker` and `prevStateTracker`.

## How it works

- **Read on construct** — `renderCollapsedPersonaTile` reads
  `isExpanded(key)` once in its constructor; when true, it builds the
  wrapper into the expanded shape (chevron ▼, `aria-expanded=true`,
  instances populated eagerly, `hidden=false`). When false / unknown,
  the default-collapsed path is unchanged.
- **Write on click** — the existing `setExpanded(...)` toggle calls
  `tracker.setExpanded(key, value)`. Collapsing REMOVES the entry
  rather than storing `false`, so a user-collapsed wrapper does not
  snap back open on the next tick.
- **Key shape** — `${sessionId}:${teamId}:${personaName}` so a same-
  named persona in two different teams (rare but possible per roster
  shape) and a same-named persona in two different sessions track
  independently. The personaName segment matches the wrapper's
  `dataset.personaName` so the key is recoverable from DOM for
  debugging.
- **Prune** — `renderFull`'s existing single-pass tracker-prune scan
  registers the wrapper key per-tile and evicts entries whose wrapper
  is no longer present. Keeps the Set bounded across long-lived
  dashboards.

## Persistence scope (per ticket)

- ✅ Survives `forceRefresh` / poll-tick `renderFull` — the load-
  bearing case.
- ❌ Does NOT survive webview reload — acceptable per ticket; reload
  is a coarse user action.
- ❌ Does NOT survive across VS Code sessions — no `vscode.setState`;
  expansion is transient interaction state, not config.

## Files touched

**Owned (new + edited):**

- `src/webview/expandedGroupsTracker.ts` *(new)* — factory + lifecycle
  doc, mirrors `finishedTracker.ts` and `prevStateTracker.ts` shape.
- `src/webview/components/collapsedPersonaTile.ts` — reads tracker in
  constructor + writes through in `setExpanded(...)`; new optional
  `teamId` + `expandedGroupsTracker` props (back-compat — old callers
  still work).
- `src/webview/components/teamCard.ts` — threads tracker + supplies
  `teamId` to the wrapper.
- `src/webview/components/sessionBlock.ts` — threads tracker downstream.
- `src/webview/render.ts` — accepts tracker on `RenderContext`,
  threads through, prunes in the single-pass scan.
- `src/webview/main.ts` — instantiates the tracker once at boot,
  threads it via `buildCtx()`.

**Tests:**

- `tests/unit/webview/expandedGroupsTracker.test.ts` *(new)* — 18
  jsdom tests:
  - Tracker unit lifecycle (factory, isExpanded, setExpanded,
    collapsed-removes-entry invariant, key independence, prune).
  - Wrapper integration: pre-expand-on-construct, default-collapsed
    fallback, click write-through, absent-tracker back-compat.
  - End-to-end `renderFull` re-render preservation: expand → re-render
    → still expanded; 5 consecutive ticks; user-collapsed stays
    collapsed; forceRefresh-equivalent; absent-tracker preserves the
    pre-Obs-10 legacy (the bug as a pinned regression baseline).
  - Prune pass: wrapper-disappears evicts entry; wrapper-survives
    preserves entry.

## Acceptance

- ✅ AC: Wrapper expansion survives the next host `state:full` poll-
  tick re-render. Covered by `renderFull — Obs 10 expansion preserved
  across re-render` describe block.
- ✅ AC: Expansion persists across forceRefresh but NOT window reload.
  forceRefresh = same-state re-render covered explicitly; window
  reload = fresh webview boot = fresh tracker instance, no persistence.
- ✅ S-scope: jsdom integration test covers expand → re-render → still-
  expanded. `expand → identical-state re-render → wrapper is STILL
  expanded` (file:line `tests/unit/webview/expandedGroupsTracker.test.ts:227`).

## Self-Test Report

### Data-plane smoke (load-bearing, sub-agent harness)

jsdom Layer-2 tests stand in for the manual reload smoke (sub-agent GUI
gap per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap").
Tests drive the same DOM API the production webview uses
(`document.createElement`, `mount.replaceChildren`, `header.click()`,
`section.dataset.expanded`). The `renderFull → click → renderFull
again → assert STILL expanded` flow is a faithful proxy for the
sponsor's reported click + 1-second wait + snap-shut symptom.

### Tests

```
$ npx vitest run
 Test Files  25 passed (25)
      Tests  482 passed | 2 skipped (484)
```

(178 of those were the pre-existing webview suite, all green; 18 are
the new `expandedGroupsTracker.test.ts` suite.)

### Build + typecheck + lint

```
$ npm run typecheck   → tsc --noEmit, clean
$ npm run lint        → eslint ., clean
$ npm run build       → dist/extension/main.cjs + dist/webview/main.js + dashboard.css, all emitted
```

### AC walkthrough

- **AC1 (expand survives re-render):** verified by `renderFull — Obs
  10 expansion preserved across re-render > expand → identical-state
  re-render → wrapper is STILL expanded`. Asserts
  `dataset.expanded === "true"` AND `aria-expanded === "true"` AND
  chevron `▼` AND all 3 instances present after the second renderFull.
- **AC2 (forceRefresh persistence, NOT window reload):** verified by
  `forceRefresh-equivalent (re-render same state) preserves expansion`
  + the back-compat test pinning that a freshly-constructed tracker
  (= fresh webview boot) starts empty so reload-equivalent loses
  state.
- **AC3 (collapse stays collapsed):** verified by `user-collapsed
  wrappers stay collapsed across re-renders` — expand → collapse →
  re-render → still collapsed AND tracker size 0.

### Side-effect inventory

- `RenderContext` gains an optional `expandedGroupsTracker?` field.
  All existing callers (component tests, fixture mode) work
  unchanged — `renderCollapsedPersonaTile` props `teamId` +
  `expandedGroupsTracker` are both optional and the wrapper falls
  back to pre-Obs-10 default-collapsed behavior when either is
  absent.
- `renderFull` prune pass now walks `rosterTiles.entries()` (Map
  iteration over `[teamId, entries]`) instead of `.values()`. Visited
  the same entries in the same order — only the iteration shape
  changed.
- No CSS changes. No host changes. No message protocol changes.

### Theme-switch probe

Not applicable — no new CSS / hex colors / theme-sensitive surfaces.
The state-dot inside the wrapper already follows
`--vscode-list-hoverBackground` and the rest of the M3-10 CSS;
expansion only toggles `data-expanded` / `hidden` / chevron text.

### State-coverage

- **Running:** wrapper with at least one `running` instance — group
  state-dot shows running (existing M3-10 behavior). Expansion state
  orthogonal to instance state.
- **Idle:** [running, idle, finished] → group reads idle (existing
  M3-10 behavior); expansion state-dot picks up the same.
- **Finished:** [finished, finished] — wrapper with finished group
  state; new `expanded wrapper picks up the freshness suffix for
  finished instances` test (existing in
  `collapsedPersonaTile.test.ts`) still green after this change.
- **Error:** [finished, error] → group reads error.
- **Empty:** No wrappers at all — `renderFull` empty-state branch
  unchanged.

## Non-obvious findings

- **`setExpanded(key, false)` must REMOVE the entry, not store
  `false`.** The first attempt stored the boolean; this leaked entries
  for every wrapper the user touched even once. Switched to add /
  delete semantics so a user-collapsed wrapper does NOT differ from a
  never-touched wrapper at tracker-state level — both render as
  default-collapsed on the next re-render, which is the principle of
  least surprise.
- **Prune pass must iterate `Map.entries()` to register the wrapper
  key.** The previous prune walked `Map.values()` because per-tile
  keys don't need the team scope. Wrapper keys do — without the
  `teamId` from the Map key, you can't compose the tracker key
  correctly, and pruning would drop everything every tick. Caught at
  test-authoring time.
- **Eagerly populate on initial-expanded path.** The pre-Obs-10
  `populateInstances` was lazy-on-click. When the tracker reports
  pre-expand, the constructor must populate eagerly so the DOM matches
  the `data-expanded` / `hidden=false` state set above; otherwise the
  user sees an expanded wrapper with no visible instances. The
  `populated` guard in `populateInstances` makes this idempotent — a
  later click would no-op the populate.
- **Back-compat path matters for tests.** Many existing
  `collapsedPersonaTile.test.ts` tests construct the wrapper without
  a tracker or `teamId`. The new optional-props pattern preserves the
  pre-Obs-10 behavior verbatim; the one new
  `absent tracker preserves the pre-Obs-10 contract` test pins the
  legacy bug as a regression baseline so a future contributor who
  "fixes" the back-compat path by always-tracking sees an explicit
  failure.

## Doc updates

None this PR. Tracker docstring is verbose by design so future
contributors don't have to reverse-engineer the lifecycle — same
shape as `finishedTracker.ts` and `prevStateTracker.ts`.
