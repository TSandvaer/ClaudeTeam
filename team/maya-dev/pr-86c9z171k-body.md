# fix(webview): boot-time `ui:refresh` to pull host state after listener wired

**Ticket:** [`86c9z171k`](https://app.clickup.com/t/86c9z171k) — Obs 3 follow-up
**Triage source:** [`team/bram-research/86c9yteju-triage-2026-05-26.md` § Obs 3 — PR #66 follow-up verification](../tree/maya/86c9z171k-obs3-boot-refresh/team/bram-research/86c9yteju-triage-2026-05-26.md#L103-L232) (lines 103-232)
**Reviewer:** Felix (cross-review pairing)
**Size:** XS — one-line `api.postMessage({ type: "ui:refresh" })` + paired unit test.

## What changed

```
src/webview/main.ts                  | +14 -0   (one-line dispatch + comment)
tests/unit/webview/bootRefresh.test.ts | +99 -0   (NEW — 2 jsdom tests)
team/log/clickup-pending.md          | +1  -0   (status-flip queue entry)
```

The single load-bearing change is at the end of `boot()` in `src/webview/main.ts`, AFTER `initMessageReceiver({...})` returns:

```ts
api.postMessage({ type: "ui:refresh" });
```

## Why

PR #66 (`0a6945d`) shipped a host-side push-based replay: inside `_onResolved`, the host posts `state:full` to the fresh webview to eliminate the pane-reopen empty-state. The replay is structurally correct but fires SYNCHRONOUSLY inside the extension-host's call stack — **before** the webview's IIFE has executed in the renderer process and registered `window.addEventListener("message", ...)` via `initMessageReceiver`. VS Code does NOT buffer `postMessage` calls; the message arrives at the iframe's message queue, no listener is wired, and it is silently dropped.

Sponsor's 2026-05-26 dogfood (`team/dogfood/2026-05-26-obs3-fix-incomplete-on-0a6945d.md`) confirmed: after close+reopen on a vsix built from `0a6945d`, the session tile did not re-appear within >30s.

Bram's triage (cited above) ruled out hypotheses (a) payload-empty and (c) shape-wrong via live source-trace, leaving hypothesis (b) **timing** as the failure mode. The recommended fix is **Pattern A — pull-based**: the webview sends `ui:refresh` as the closing act of `boot()`, AFTER `initMessageReceiver` wires the listener. The host's existing handler at `src/extension/main.ts:265-267` calls `watcherHandle?.triggerTick()`, which immediately re-emits `state:full` — and this one lands on a wired listener.

PR #66's host-side replay is **retained** as a harmless secondary fast-path; it may land in some VS Code configurations and costs nothing if dropped.

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| AC1: one-line `api.postMessage({type: "ui:refresh"})` at end of `boot()` | ✅ | `src/webview/main.ts:275` (post-`initMessageReceiver`) |
| AC2: close+reopen on built vsix shows session tile within ≤2s | ⏸ sponsor-side | sub-agent GUI gap — no headless harness for VS Code reload + timing observation; deferred to sponsor post-merge per [`testing-strategy.md` § Sub-agent GUI gap workaround](.claude/docs/testing-strategy.md#sub-agent-gui-gap--webview-smoke-workaround). Data-plane smoke instead: see below. |
| AC3: new `tests/unit/webview/bootRefresh.test.ts` asserts the dispatch | ✅ | 2 jsdom tests; both pass (`npx vitest run tests/unit/webview/bootRefresh.test.ts` → 2/2 green) |
| AC4: no regression on first-open | ✅ | `triggerTick()` is hash-skip-aware; full suite 456 unit + 2 skipped pass — `bootBleed.test.ts` still asserts no DEAD-bleed at boot (includes a now-visible `[claudeteam:dev] postMessage: { type: 'ui:refresh' }` log in browser-dev mode, the new expected behavior) |
| AC5: CI green + vsce package clean | ⏳ | CI pending on push; locally `npm run typecheck` + `npm run lint` + `npm run build` all clean; webview bundle contains `ui:refresh` at the expected callsite (`dist/webview/main.js:1082`) |
| AC6: Self-Test Report with vsix install commands + timing observation | ⏸ partial | see Self-Test Report below — install/timing rows defer to sponsor per sub-agent GUI gap; data-plane evidence is here |

## Self-Test Report

### AC walkthrough

- **AC1 — one-line dispatch at end of `boot()`:** ✅ verified at `src/webview/main.ts:275` (after `initMessageReceiver({...})` returns at line 260). The comment block above the dispatch cites Bram's triage doc and explains the PR #66 timing failure.
- **AC2 — close+reopen ≤2s session tile re-render:** ⏸ sponsor-side post-merge per sub-agent GUI gap. Bram's triage explicitly flagged that the secondary `>30s anomaly` is **unverified** (his § "What I did NOT verify" item 2). If post-merge timing still shows >30s, that anomaly stays out of scope per dispatch OOS — flag for separate triage.
- **AC3 — paired unit test:** ✅ `tests/unit/webview/bootRefresh.test.ts` — 2 tests:
  1. "dispatches `{ type: 'ui:refresh' }` via api.postMessage after boot()" — filters the mock's call list for `ui:refresh`, asserts exactly one call.
  2. "sends ui:refresh AFTER `initMessageReceiver` wires the listener" — asserts `postMessage` was called AND the last call is the trailing `ui:refresh` (no other webview→host messages happen during empty-state boot).
- **AC4 — no first-open regression:** ✅ full suite green: `npx vitest run` → `24 test files, 456 passed, 2 skipped`. `bootBleed.test.ts` (4 tests, browser-dev + VS-Code modes) still passes — the new trailing `ui:refresh` does NOT introduce a DEAD-fixture bleed.
- **AC5 — CI + vsce package:** local build chain green. `node -e "require('./dist/extension/main.cjs')"` parses past the bundle and reaches `require('vscode')` (the expected "needs extension-host runtime" error), confirming no `ERR_REQUIRE_ESM` regression. Webview bundle survives bundling: `grep -n "ui:refresh" dist/webview/main.js` → `1082: api.postMessage({ type: "ui:refresh" });`.

### Side-effect inventory

- **`onRefresh` handler is already wired in host (`src/extension/main.ts:265-267`):** `triggerTick()` exists, is hash-skip-aware, and was previously only triggered by the `claudeteam.refresh` command. This PR now triggers it on every webview boot — adds one tick per pane open. Cost: negligible (hash-skip suppresses re-emit when content is unchanged).
- **PR #66's replay is retained (`src/extension/main.ts:181-183`):** harmless secondary fast-path. If VS Code's postMessage ever starts buffering, the replay lands first; otherwise the ui:refresh path lands and the replay is a no-op (dropped).
- **No host-side changes in this PR** (OOS per dispatch).

### Theme-switch probe

⏸ sub-agent GUI gap — deferred to sponsor post-merge. The change is a single `postMessage` dispatch with no CSS, no DOM, no theme variable usage.

### State-coverage

Affected states for this change:
- **First open (no prior state):** webview boots → renders empty-state → fires `ui:refresh` → host runs first tick → posts `state:full` → webview renders tiles. Hash-skip means no double-emit if `triggerTick`'s tick produces the same hash as PR #66's replay would have.
- **Close + reopen (live state on disk):** webview boots fresh → renders empty-state → fires `ui:refresh` (listener wired) → host's `triggerTick()` emits live `state:full` → webview renders tiles. **This is the regression-target path.** Pre-fix: empty-state persisted >30s. Post-fix: empty-state ≤ one tick cycle.
- **Cold extension activation:** unaffected — the change is webview-side; activation timing in the host is identical.

### Failure-mode probes

- **`acquireVsCodeApi` undefined (browser dev mode):** verified via `bootBleed.test.ts` browser-dev test — the dev fallback's `console.log("[claudeteam:dev] postMessage:", msg)` now logs `{ type: 'ui:refresh' }` at boot (visible in test stdout). Non-breaking; expected.
- **Host disposed mid-boot:** `api.postMessage` is the same VS Code shim used by every other webview→host message — if VS Code has torn down the bridge, the call is a no-op (same as every other postMessage in the codebase).
- **`initMessageReceiver` throws:** the `api.postMessage` line is AFTER `initMessageReceiver(...)` returns, so a synchronous throw inside that call would prevent the ui:refresh dispatch — the empty-state would persist until the next watcher tick (same as the pre-fix steady-state behavior). No new failure surface.

### Doc updates

None this PR — Bram's triage doc (`team/bram-research/86c9yteju-triage-2026-05-26.md`) already captures the timing failure mode + the Pattern A fix recommendation. The code comment in `main.ts` cites that doc as the authoritative source.

## OOS (per dispatch)

- Host-side changes beyond retaining PR #66 code (NOT reverted; harmless secondary fast-path)
- Watcher-loop internals
- Roster changes
- Secondary >30s anomaly investigation (Bram flagged as unverified; separate triage if AC2 still observes >30s post-merge)

## Anti-fabrication cites

- **PR #66 merge SHA:** `0a6945d` (verified via `git log origin/main`).
- **Webview bundle line:** `dist/webview/main.js:1082` (verified via `grep -n "ui:refresh" dist/webview/main.js` post-build).
- **Existing onRefresh handler location:** `src/extension/main.ts:265-267` (per dispatch brief; also cited in Bram's triage § "Fix direction" line 189).
- **Test result:** `Test Files 1 passed (1) / Tests 2 passed (2)` for the new file; `Test Files 24 passed / Tests 456 passed | 2 skipped (458)` for the full suite. Both observed from `npx vitest run` output this session.
