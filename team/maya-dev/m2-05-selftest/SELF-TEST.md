# M2-05 Self-Test Report

Ticket: [`86c9y7uka`](https://app.clibrate.com/t/86c9y7uka) — `feat(webview): dashboard tile renderer + message receiver`
Branch: `maya/m2-05-webview-tile-renderer`

## How the screenshots were captured

The VS Code extension host requires a live VS Code window to render the
webview view. Because this PR ships only the webview side of the bridge
(M2-05 — host wiring is M2-06), the renderer can be exercised **without**
VS Code by serving the built `dist/webview/main.js` + `dist/webview/dashboard.css`
into a stand-alone HTML harness (`team/maya-dev/m2-05-selftest/harness.html`)
that:

1. Loads the exact CSS from `dist/webview/dashboard.css` via `<link rel="stylesheet">`.
2. Loads the exact IIFE bundle from `dist/webview/main.js`.
3. Mirrors the VS Code `--vscode-*` theme variables for dark + light (values
   lifted from `team/iris-ux/m2-dashboard-tile-spec.md` §10.1 fallback table).
4. Exercises the renderer's browser-dev fallback (no `acquireVsCodeApi`
   defined) so `FIXTURE_STATE` renders directly.

Capture command (Edge headless — `msedge.exe` on PATH; same approach works
with Chrome):

```bash
msedge --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
  --window-size=540,1400 \
  --screenshot=team/maya-dev/m2-05-selftest/01-fixture-dark.png \
  --virtual-time-budget=4000 \
  "file:///<repo>/team/maya-dev/m2-05-selftest/harness.html?theme=dark"
```

This is **the same DOM/CSS** the production webview produces; the only
difference is the harness substitutes `console.log` for `acquireVsCodeApi().postMessage`
(spec §9, AC8 — browser-dev fallback). When the orchestrator merges M2-05
and dispatches M2-06, Felix's PR will be the first time the dashboard
renders inside a real VS Code window. The webview-smoke gate at that
point will live-reload-verify against `~/.claude/` data.

## AC walkthrough

| AC  | Description | Evidence |
|-----|------------|----------|
| AC1 | `messageReceiver.ts` exports `initMessageReceiver()` — `window.addEventListener("message", ...)` + dispatch | `src/webview/messageReceiver.ts` + 1 vitest assertion via direct call |
| AC2 | `main.ts` registers handlers for `state:full`, `state:delta`, `roster:loaded`, `roster:error` | `src/webview/main.ts` — `initMessageReceiver({ onStateFull, onStateDelta, onRosterLoaded, onRosterError })` |
| AC3 | Renders session block / team card / tiles (5 fields) / bg chip / empty state | Screenshot 01 (all states), 03 (bg chip expanded), 04 (empty) |
| AC4 | Four semantic hex colors + `--vscode-*` variables for everything else | `src/webview/styles/dashboard.css` lines 165-184; spot-check in 01-fixture-dark — Felix dot green, Maya amber, Iris grey, Sage red |
| AC5 | Background chip expand/collapse on click; count always visible | Screenshot 01 (collapsed: "+ 3 background agents" + ▶) vs 03 (expanded: 3 detail rows + ▼); test `toggles expanded state on header click` |
| AC6 | Click on rostered tile sends `ui:open-transcript` via `acquireVsCodeApi().postMessage(...)` | Test `dispatches ui:open-transcript on click` + `dispatches the same message on Enter and Space keydown` |
| AC7 | `state:full` triggers full DOM update; delta no-ops at M2-05 (host doesn't emit) | `src/webview/render.ts` `renderFull` + `applyDelta`; test `clears previous render on subsequent calls` |
| AC8 | Static-fixture mode when `acquireVsCodeApi` undefined | `src/webview/main.ts` `acquireApi()`; screenshots are the proof — they render via the dev fallback |
| AC9 | `src/shared/fixtures.ts` exports `FIXTURE_STATE` with all six personas + four states | `src/shared/fixtures.ts` lines 32-95; visible in screenshot 01 |
| AC10 | Component tests in `tests/unit/webview/dashboardTile.test.ts` — 4 states + display/role/activity text | 24 tests pass — `npm run test:unit` (164 total pass) |
| AC11 | Self-Test Report posted | THIS DOCUMENT |
| AC12 | `npm run typecheck && npm run test:unit` pass | typecheck clean; 164/164 unit + 31/31 integration |

## State-coverage screenshots

| File | State | Notes |
|------|-------|-------|
| `01-fixture-dark.png` | All four states + collapsed bg chip + dead session | Dark theme baseline. Felix green (running), Maya amber (idle), Iris grey (finished), Sage red (error), Nora green (running), Bram amber (idle). |
| `02-fixture-light.png` | Same content, light theme | Theme-switch probe. All `--vscode-*` variables resolve to light-theme values; semantic hex state-dots survive theme switch unchanged (spec §10.2). |
| `03-bgchip-expanded-dark.png` | Bg chip expanded — 3 detail rows visible | Header click toggles `data-expanded`, swaps ▶→▼, unhides `<ul.chip-detail-list>`. |
| `04-empty-dark.png` | Empty state — "No live Claude Code sessions." | String matches CLI M1-03 §1.7 verbatim. |
| `05-error-roster-dark.png` | Roster error chip at top of dashboard + "Open Roster File" button | Spec §8.1; chip persists until `roster:loaded` clears it. Session blocks still render below (fall-back to empty-roster mode). |
| `06-empty-light.png` | Light-theme empty state | Theme parity for empty state. |
| `07-error-roster-light.png` | Light-theme error chip | Theme parity for error UI; error chip uses `--vscode-inputValidation-error*` variables. |

## Theme-switch probe

Both dark (01, 03, 04, 05) and light (02, 06, 07) themes render without
artifacts. State-dot colors are identical across themes (hardcoded hex per
spec §10.2); all other colors flip with the VS Code theme variables.

## CSP compliance

`src/extension/view/provider.ts` (modified in this PR — added stylesheet
link only) keeps the strict CSP from M2-01:

```
default-src 'none'; img-src ${cspSource}; style-src ${cspSource}; script-src ${cspSource}
```

- No inline `<style>` tags. CSS loads via `<link rel="stylesheet">` from
  `${cspSource}` (the same origin as the script).
- No inline `<script>` tags or `onclick="..."` attributes. All event
  listeners attach via `addEventListener` in TypeScript.
- No `unsafe-inline`, no `unsafe-eval`. Verified by the existing
  `tests/unit/provider.test.ts` CSP assertions which still pass.

## Side-effect inventory

This PR touches:

- `src/shared/messages.ts` — refines `StateDeltaMessage.payload` from
  `Record<string, unknown>` to the canonical `StateDelta` shape coordinated
  with Felix's M2-04 plan per the dispatch brief. If Felix's M2-04 lands
  with a different shape, this is a small mechanical rebase.
- `src/shared/fixtures.ts` — NEW. No existing consumers; introduces no risk.
- `src/extension/view/provider.ts` — adds `<link>` stylesheet tag + a
  `styleUri` variable. No CSP changes. Existing `extractCsp` + HTML
  scaffold tests still pass.
- `esbuild.config.mjs` — adds a fourth bundle target (CSS) and a fourth
  watcher. `npm run build` produces `dist/webview/dashboard.css` alongside
  the existing three bundles.
- `package.json` — adds `jsdom` devDep for the component tests; no runtime
  surface change.

No production consumers of `state:delta` exist yet (M4 wires delta
application), so the type refinement is safe.

## Failure-mode probes

- **Missing `acquireVsCodeApi`** — `acquireApi()` falls back to a console-log
  mock. Verified by all 7 screenshots — they exercise this path.
- **Unknown HostMessage type** — `messageReceiver` calls `onUnknown`
  (default: `console.warn`); state is untouched. Defensive against VS Code
  internals posting on the same channel.
- **`#root` element missing** — `boot()` logs an error and returns. No
  uncaught exception.
- **Empty roster** — fixture `FIXTURE_EMPTY_STATE` renders "No live Claude
  Code sessions." cleanly (screenshots 04, 06).
- **`state:delta` arrives** — webview re-renders against the last known
  `state:full` (M2-05 scope per backlog AC7 footnote). Test:
  `applyDelta` is a typed no-op until M4.

## Build verification

```
$ npm run build
  dist\extension\main.js      4.3kb
  dist\webview\dashboard.css  7.4kb
  dist\webview\main.js       16.8kb
  dist\cli\agentTree.js     643.5kb
Done.

$ npx vsce package --no-yarn
DONE  Packaged: claudeteam-0.0.1.vsix (10 files, 31.57 KB)
   ├─ dist/extension/main.js
   ├─ dist/webview/main.js
   └─ dist/webview/dashboard.css           ← new asset included
```

## Test results

```
$ npm run test:unit
Test Files  8 passed (8)
Tests       164 passed (164)
  ↳ tests/unit/webview/dashboardTile.test.ts: 24 new tests

$ npm run test:integration
Test Files  1 passed (1)
Tests       31 passed (31)

$ npx tsc --noEmit
(clean)
```

## Open follow-ups (logged for the orchestrator)

1. **Light-theme harness artefact** — the headless harness renders a dark
   gap below the dashboard content in light theme (the body's
   `background-color: var(--vscode-editor-background)` doesn't propagate
   to `<html>` in standalone). Harness-only — does NOT affect the real
   VS Code webview (the iframe is sized to fit, body fills it).
2. **`state:delta` application** — currently a typed no-op. M4 ticket
   `applyDelta-impl` should add per-tile DOM patching.
3. **Felix's M2-04 type alignment** — `StateDelta` shape used here matches
   the brief's stated plan (`{ added, updated, removed }`). If M2-04 lands
   with a renamed `DashboardState` (currently aliased as `AgentTree` in
   `src/shared/types.ts`), this PR rebases mechanically — no logic change.
