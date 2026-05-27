# polish(webview): auto-collapse uniform clusters + compact rows + status hint (86c9zmqa8)

Implements Iris's uniform-cluster spec (`team/iris-ux/86c9zmqa8-uniform-cluster-spec.md`) per sponsor-confirmed direction 2026-05-27: **Option A + B + A.1 combined**, label `"all idle"` / `"all finished"`, default `true`, A.1 included in this PR.

Addresses sponsor verbatim 2026-05-27: *"why do i need to see al these repeadet names under each name? what is the value?"*

## What changes (visual)

For a `CollapsedPersonaGroup` whose instances are **all-same-state + all-same-role** AND the shared state is `idle` or `finished` (`running` and `error` excluded per spec §1.2):

- **Auto-collapsed by default** regardless of `expandedGroupsTracker` (Option A, §2.3) — the chevron still works; manual click expands.
- **Header status hint** reads `"all idle"` or `"all finished"` (Option A.1, §2.4) — right-anchored, muted, `aria-hidden` (header `aria-label` already conveys state).
- **Compact one-line instance rows when expanded** (Option B, §3.2) — single state-dot + `Felix [a]` / `[b]` / `[c]` disambiguator + activity span. Drill-in click contract verbatim from `renderAgentTile` (real `agentId` on `data-agent-id`).

Mixed clusters (any varying state / role, or shared state `running` / `error`) render per M3-10 + Obs 10 baseline unchanged.

## Vocabulary contract (spec §8 — all identifiers verbatim)

| Identifier | Kind | Source |
|---|---|---|
| `claudeteam.autoCollapseUniformClusters` | `package.json` config scalar (boolean, default `true`) | `package.json` |
| `computeIsUniform(instances) => boolean` | exported pure fn | `src/webview/components/collapsedPersonaTile.ts` |
| `STATUS_HINT_LABEL` | exported const map `{idle, finished}` | `collapsedPersonaTile.ts` |
| `DISAMBIGUATOR_LETTERS` | exported const string `"abcdefghijklmnopqrstuvwxyz"` | `collapsedPersonaTile.ts` |
| `disambiguatorFor(index)` | exported pure fn (`[a]`/`[b]`/…/`[aa]`) | `collapsedPersonaTile.ts` |
| `agent-tile--compact` | CSS class modifier on `<article>` | `dashboard.css` |
| `agent-activity-compact` | CSS class on activity span | `dashboard.css` |
| `collapsed-persona-status-hint` | CSS class on header hint span | `dashboard.css` |
| `data-uniform` | HTML data attribute on `<section.collapsed-persona>` | `collapsedPersonaTile.ts` |
| `data-compact` | HTML data attribute on `.collapsed-persona-instances` | `collapsedPersonaTile.ts` |

## Plumbing

The flag is webview-only behavior — Felix's reducer / parsers are **untouched**. Wire path:

1. `package.json` declares the config scalar (default `true`).
2. `extension/main.ts` adds `getAutoCollapseUniformClusters` resolver + onDidChangeConfiguration listener → instant-effect `triggerTick()`.
3. `watcher/watcherLoop.ts` reads via the resolver, stamps onto `AgentTree.config.autoCollapseUniformClusters`. Added to `hashState` so toggling re-emits even if visible tile set is unchanged.
4. `messageBus.ts → serializeState` passes the field onto the wire (`SerializedDashboardState.config`).
5. `webview/main.ts → hydrateState` passes `wire.config` through verbatim (existing pattern).
6. `webview/render.ts → readAutoCollapseUniformClusters` extracts; threaded through `renderSessionBlock → renderTeamCard → renderCollapsedPersonaTile`.
7. `renderCollapsedPersonaTile`:
   - computes `isUniform = computeIsUniform(group.instances)`;
   - `isUniformPolish = flag === true && isUniform` gates auto-collapse, status hint, and compact-row rendering;
   - mixed clusters / flag-off retain pre-86c9zmqa8 (M3-10 + Obs 10) behavior verbatim.

## Self-Test Report

### AC walkthrough (from Iris spec §7 recommendation + §8.4 grep-discoverable tests)

| AC | Verification |
|---|---|
| Auto-collapse uniform cluster regardless of tracker (Option A) | `"uniform cluster — auto-collapsed regardless of tracker"` test verifies `data-expanded="false"` even after `tracker.setExpanded(key, true)`. |
| Status hint `"all idle"` / `"all finished"` (Option A.1) | `"renders the status-hint row in the header"` + `"renders the status-hint row as 'all finished'"` tests. |
| Compact one-line rows with `[a]`/`[b]`/`[c]` (Option B) | `"expands to N compact rows with [a]/[b]/[c] labels"` test asserts 3 rows, disambiguator labels, no role/model rows. |
| Compact-row drill-in fires `ui:open-transcript` with the real `agentId` (NOT the letter) | `"compact row click dispatches ui:open-transcript with the real agentId"` + Enter-key test. |
| Mixed cluster respects tracker (back-compat) | `"mixed cluster: initial-expanded state still follows the tracker"` test. |
| Flag `false` → uniform cluster behaves as M3-10 baseline (sponsor escape hatch) | `"claudeteam.autoCollapseUniformClusters=false → uniform cluster behaves as M3-10 baseline"` test. |
| Obs 10 expansion-preservation invariant preserved for mixed clusters | Existing Obs 10 tests still pass; tracker is still written on uniform-cluster clicks (intent recorded). |

### Data-plane smoke (sub-agent GUI gap workaround — `testing-strategy.md` §"Sub-agent GUI gap")

Both PR author (Maya) and reviewer (Felix) are sub-agents. Per the established AC(a) data-plane / AC(b-d) sponsor-post-merge pattern:

- **Data-plane verification** — `npm test` runs 522 unit tests (60 in `collapsedPersonaTile.test.ts` — 26 new for this PR), all green. `npm run test:integration` runs 94 integration tests, all green. `npm run typecheck` + `npm run lint` clean. The full webview render path (uniform / mixed / flag-off / status-hint / compact-row / freshness-suffix / drill-in keyboard) is exercised by the unit suite.
- **Interactive screenshots (Reload Window, theme-toggle, state-coverage)** — deferred to sponsor post-merge confirm. Surface is purely additive: when `autoCollapseUniformClusters: true` (default) the polish applies; when `false` the M3-10 baseline is preserved verbatim. The mixed-cluster path is unchanged.

### Failure-mode probes

- **Empty `instances`** — `computeIsUniform([])` returns `false` (defensive — test covers).
- **Single-instance `instances`** — `computeIsUniform([t])` returns `false` (size guard — test covers).
- **`running` shared state** — `computeIsUniform([running, running])` returns `false` (running excluded per §1.2 — test covers).
- **`error` shared state** — `computeIsUniform([error, error])` returns `false` (error excluded — test covers).
- **Disambiguator beyond 26** — `disambiguatorFor(26)` → `"[aa]"` (base-26 rollover — test covers).
- **Negative / non-integer index** — `disambiguatorFor(-1)` / `disambiguatorFor(1.5)` → `"[?]"` (defensive — test covers).
- **`STATUS_HINT_LABEL.running` / `.error`** — both `undefined` so a future widening doesn't surface "all running" labels (test covers).

### Manifest gate (vsce package)

`package.json` `contributes.configuration` adds `claudeteam.autoCollapseUniformClusters` (boolean, default `true`).

`npx vsce package --no-yarn` succeeded — `claudeteam-0.0.1.vsix` (11 files, 418.89 KB). Bundled `dist/extension/main.cjs` is 676.11 KB; webview `main.js` 43.04 KB. No new dependencies.

### Theme-switch probe + state-coverage screenshots

Deferred to sponsor post-merge confirm per the documented sub-agent GUI gap workaround. The polish CSS is theme-aware throughout — only `--ct-color-fg-muted` is consumed for the status-hint span (resolving through `--vscode-descriptionForeground`), and the `agent-tile--compact` modifier reuses the base `.agent-tile` hover/focus styling so dark/light parity is structural.

## Composition with sibling polish surfaces

- **Obs 10 (`86c9zfmh1` expansion tracker, PR #87)** — preserved: tracker is still consulted for mixed clusters, still written on every click (uniform AND mixed) so click intent is recorded. The uniformity gate short-circuits the tracker READ for the initial render only — `setExpanded` writes regardless. Tested by `"manual click still expands"` / `"writes 'true' to the tracker"`.
- **Defect 6b (`86c9yxvah` `computeGroupState`)** — unchanged: both functions coexist; `computeGroupState` continues to drive the header state-dot, `computeIsUniform` only gates the uniform-cluster polish.
- **M5 hide-finished filter** — composes cleanly: the M5 filter operates on the host-side before serialization; if all finished instances are filtered out, the wrapper unwraps (host reducer logic) and there's no uniform cluster left to check. If some finished survive, `computeIsUniform` runs on the survivor set.
- **M3-10 N=1 back-compat** — unchanged: bare `AgentTile` entries don't pass through `renderCollapsedPersonaTile` and never see the polish.

## Files changed

- `package.json` — config scalar.
- `src/shared/types.ts` — `AgentTree.config.autoCollapseUniformClusters?: boolean`.
- `src/shared/messages.ts` — mirror on `SerializedDashboardState.config`.
- `src/extension/messageBus.ts` — pass-through in `serializeState`.
- `src/extension/watcher/watcherLoop.ts` — `getAutoCollapseUniformClusters` resolver, hashState inclusion, config-block stamp.
- `src/extension/main.ts` — read setting + `onDidChangeConfiguration` listener.
- `src/webview/render.ts` — `readAutoCollapseUniformClusters` + threading.
- `src/webview/components/sessionBlock.ts` — thread.
- `src/webview/components/teamCard.ts` — thread.
- `src/webview/components/collapsedPersonaTile.ts` — `computeIsUniform`, `disambiguatorFor`, `STATUS_HINT_LABEL`, `DISAMBIGUATOR_LETTERS`, status-hint row, compact-row variant (`renderCompactInstanceRow`), `data-uniform` + `data-compact` attributes.
- `src/webview/styles/dashboard.css` — `.collapsed-persona-status-hint`, `.agent-tile--compact`, `.agent-activity-compact` rules.
- `tests/unit/webview/collapsedPersonaTile.test.ts` — 26 new tests covering all §8.4 grep-discoverable phrases plus disambiguator / hint / freshness-suffix / keyboard-accessibility / back-compat.

## Reviewer notes

- Cross-pair reviewer: Felix.
- Vocabulary contract fully satisfied (no `[A]` / `instance-N` / alternative naming introduced).
- Webview-only behavior — host code in `watcher/watcherLoop.ts` only stamps the config scalar onto the produced tree; the reducer / matcher / state machine are untouched.
- Iris spec recommended path was Option A + B + A.1; this PR ships exactly that, no deviation.
