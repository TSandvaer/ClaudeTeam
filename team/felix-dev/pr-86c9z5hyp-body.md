# fix(ext): forceRefresh bypass for boot-time hash-skip race (Obs 3)

**Ticket:** [`86c9z5hyp`](https://app.clickup.com/t/86c9z5hyp) — Obs 3 host-side force-refresh fix
**Triage source:** Bram's round-2 triage [`86c9z5a3k`](https://app.clickup.com/t/86c9z5a3k) (PR #75, branch `bram/86c9z5a3k-obs3-round2-triage`)
**Reviewer:** Maya (cross-review pairing)
**Size:** XS — 2 files (`src/extension/watcher/watcherLoop.ts`, `src/extension/main.ts`) + 1 test file extension (`tests/integration/watcherHandle.test.ts`).

## Decision: Option A — add `forceRefresh()` to `WatcherHandle`

Picked **Option A** over Option B (modify `triggerTick` itself):

- **A keeps `triggerTick`'s semantics intact** — FS-watcher events (`onDidCreate`/`onDidChange`/`onDidDelete`) and config-change listeners genuinely want hash-skip when content didn't change. The fix surface for the boot race is narrow: only the explicit "the prior emission may not have reached anyone — re-send regardless" signal needs to bypass.
- **Option B (bypass on every `triggerTick`)** would burn webview DOM-diff cycles every time `claudeteam.collapsePersonaTiles` / `showAllSessionsGlobally` / `hideFinishedAgents` toggles fire `triggerTick()` against unchanged content — small per-call cost but a measurable regression at steady state.
- The new method's name signals intent at call sites; `triggerTick` stays the cheap default.

## What changed

```
src/extension/watcher/watcherLoop.ts | +27 -3   (interface doc + new method)
src/extension/main.ts                |  +9 -1   (onRefresh calls forceRefresh)
tests/integration/watcherHandle.test.ts | +97 -0 (new describe block, 3 tests)
team/log/clickup-pending.md          |  +2 -0   (status-flip queue entries)
```

### Load-bearing changes

**`watcherLoop.ts` — add `forceRefresh` to `WatcherHandle`:**

```ts
forceRefresh: () => {
  // 86c9z5hyp: clear the hash BEFORE firing the tick so the new tick's
  // hash comparison at `if (hash === priorStateHash)` ALWAYS misses
  // (null !== string), guaranteeing `onStateChange` is invoked.
  priorStateHash = null;
  void tick();
},
```

**`main.ts:265` — `onRefresh` calls `forceRefresh()` instead of `triggerTick()`:**

```ts
onRefresh: () => {
  watcherHandle?.forceRefresh();
},
```

## Why

Bram's round-2 triage (verdict HIGH-confidence) traced the actual failure of PR #73:

1. `startWatcher` at `watcherLoop.ts:238` fires `void tick()` (tick-0) on startup.
2. Tick-0 completes file I/O → produces `DashboardState` → calls `onStateChange` → `postState(webview, state)`. But the webview IIFE has NOT yet executed in the renderer; `window.addEventListener("message", ...)` (registered by `initMessageReceiver`) is not wired. The `state:full` message is silently dropped.
3. Critically, tick-0 also sets `priorStateHash = hash(state)` at `watcherLoop.ts:224`.
4. PR #73's `ui:refresh` from `boot()` then arrives → `onRefresh` → `triggerTick()` → tick-1.
5. Tick-1 computes the same hash → `hash === priorStateHash` → hash-skip at `watcherLoop.ts:220-223` → `onStateChange` NOT called → webview never receives `state:full` → empty-state persists.

`forceRefresh()` clears `priorStateHash` before firing the tick, so tick's `if (hash === priorStateHash)` compares `<string> === null` → false → emission proceeds. The webview receives the replay it was asking for.

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| AC1: `forceRefresh` path exposed on WatcherHandle | Done | `src/extension/watcher/watcherLoop.ts` — `WatcherHandle` interface + closure return |
| AC2: `onRefresh` calls `forceRefresh()` not `triggerTick()` | Done | `src/extension/main.ts:265-275` |
| AC3: Surface A (close+reopen ≤2s) | Sponsor-side | sub-agent GUI gap — `.claude/docs/testing-strategy.md § Sub-agent GUI gap workaround`. Data-plane evidence: AC5 test asserts force-path re-emits identical state, which is the exact mechanism the webview needs after close+reopen. |
| AC4: Surface C (window-reload ≤2s) | Sponsor-side | same GUI gap rationale; force-bypass mechanism asserted by AC5 test |
| AC5: Unit/integration test asserts force-path bypasses hash-skip | Done | new test `"AC5 — forceRefresh re-emits identical state"` in `tests/integration/watcherHandle.test.ts` — drives the actual `startWatcher` + waits for tick-0 + asserts `triggerTick` hash-skips but `forceRefresh` re-emits the same content. |
| AC6: No regression on steady-state hash-skip | Done | new test `"AC6 — steady-state hash-skip behavior unchanged when forceRefresh is NOT called"` — fires 5× `triggerTick` against unchanged state, asserts zero new emissions |
| AC7: CI green + vsce package clean | In progress | `npm run typecheck` clean; `npm run lint` clean; `npm run test` → 24 files, 456 passed, 2 skipped; `npm run test:integration` → 7 files, 77 passed; `npx vsce package --no-yarn` succeeded (`Packaged: ...claudeteam-86c9z5hyp.vsix (10 files, 401.64 KB)`); CI may not fire per GitHub Actions incident flagged in dispatch brief |
| AC8: Self-Test Report posted | Done | this PR body |

## Self-Test Report

### AC walkthrough

- **AC1 — `forceRefresh` exposed:** verified at `src/extension/watcher/watcherLoop.ts` (interface declaration in `WatcherHandle` + implementation in `startWatcher` closure return). Documented with the same callsite cite from Bram's triage.
- **AC2 — `onRefresh` calls it:** verified at `src/extension/main.ts:265-275`. The comment block on the handler cites Bram's triage doc explicitly.
- **AC3 / AC4 — sponsor-side close+reopen / window-reload ≤2s:** sub-agent GUI gap — deferred to sponsor per `.claude/docs/testing-strategy.md § Sub-agent GUI gap — webview-smoke workaround`. The data-plane smoke for the fix is the AC5 integration test: it asserts that `forceRefresh` re-emits state even when the hash is unchanged. This is the exact mechanism by which the webview's `ui:refresh` from `boot()` after close+reopen reliably drives state to the freshly-mounted webview.
- **AC5 — force-path test:** new integration test `AC5 — forceRefresh re-emits identical state (defeats boot-time hash-skip race)` in `tests/integration/watcherHandle.test.ts`. The test:
  1. Starts the watcher with a 5s slow poll; waits for tick-0 emission (primes `priorStateHash`).
  2. Calls `triggerTick()` against unchanged state → asserts no new emission (hash-skip works).
  3. Calls `forceRefresh()` against the same unchanged state → asserts a new emission lands within 1.5s.
  4. Asserts the re-emitted state shape equals the baseline (no spurious mutation).
- **AC6 — steady-state hash-skip regression guard:** new test `AC6 — steady-state hash-skip behavior unchanged` — fires 5× `triggerTick()` against unchanged content, asserts zero new emissions land within 500ms. Confirms the hash-skip optimization is intact for the `triggerTick` path (only `forceRefresh` bypasses).
- **AC7 — CI + package:**
  - `npm run typecheck` → exit 0, no errors.
  - `npm run lint` → exit 0, no errors.
  - `npm run test` (unit) → `Test Files 24 passed | Tests 456 passed | 2 skipped`.
  - `npm run test:integration` → `Test Files 7 passed | Tests 77 passed`.
  - `npm run build` → all 4 bundles produced (`dist/extension/main.cjs`, `dist/webview/main.js`, `dist/webview/dashboard.css`, `dist/cli/agentTree.js`).
  - `node -e "require('./dist/extension/main.cjs')"` → fails on `Cannot find module 'vscode'` (expected — proves CJS load reached `require('vscode')`; no `ERR_REQUIRE_ESM` regression).
  - `npx vsce package --no-yarn` → `Packaged: ...claudeteam-86c9z5hyp.vsix (10 files, 401.64 KB)` — clean, only the standard `LICENSE not found` warning.
  - `grep -c "forceRefresh" dist/extension/main.cjs` → 2 (definition + call site survived bundling).
  - CI may not fire — GitHub Actions incident flagged in dispatch brief; orch will merge when Actions recovers.
- **AC8 — Self-Test Report posted:** this section.

### Side-effect inventory

- **`startWatcher` return value:** added one new method (`forceRefresh`). The `composedDispose` wrapper in `main.ts:214-218` only replaces `.dispose`, not `.forceRefresh` — verified.
- **`triggerTick` callers unaffected:** the only behavioral change is to `onRefresh`. All other `triggerTick()` call sites (`claudeteam.refresh` command at `main.ts:295`, `onDidChangeConfiguration` listeners for `showAllSessionsGlobally` / `collapsePersonaTiles` / `hideFinishedAgents` at `main.ts:190-208`, FS-watcher `onDidCreate/onDidChange/onDidDelete` in `watcherLoop.ts:247-253`, rosterWatcher `onRosterChange` callback in `main.ts:228-238`) continue to use `triggerTick()` — hash-skip is still respected for those paths (intentional — those events may fire many times for unchanged content).
- **PR #66 host-side replay (`main.ts:181-183`) and PR #73 webview `ui:refresh` (`src/webview/main.ts:275`):** both retained. PR #66's synchronous replay is now harmless secondary fast-path; PR #73's `ui:refresh` is the load-bearing path that this PR makes actually work.
- **Hash-skip semantics:** unchanged for steady-state — the `tick()` body still computes and compares hashes; only the explicit `forceRefresh()` resets `priorStateHash = null` before the tick.

### Theme-switch probe

N/A — host-side only, no CSS / DOM / theme variable usage.

### State-coverage

Affected states:
- **First open (no prior state):** webview boots → empty-state → fires `ui:refresh` → host's `forceRefresh()` clears the hash that tick-0 primed → tick-1 emits `state:full` → webview renders.
- **Close + reopen (live state on disk):** webview boots fresh → empty-state → fires `ui:refresh` → host's `forceRefresh()` resets the hash → tick re-emits the live state → webview renders tiles. **This is the regression-target path.** Pre-fix: hash-skip dropped the re-emit, empty-state persisted indefinitely. Post-fix: force-bypass guarantees re-emit within one tick cycle.
- **Window reload:** identical to close+reopen mechanically — `resolveWebviewView` fires, new watcher constructed, webview's `boot()` sends `ui:refresh`, force-bypass emits state.
- **Steady-state (no UI action):** unaffected. `triggerTick`-driven FS / config / roster events still hash-skip; the watcher's regular interval still hash-skips. Only the explicit `ui:refresh` / `claudeteam.refresh` flow is force-driven (and the user-triggered Refresh command at `main.ts:295` is intentionally still on `triggerTick` — that command is a "kick the tick" affordance, not a "the webview missed the prior message" signal; if a user wants a forced re-emit they can close+reopen the pane, which uses the new path).

### Failure-mode probes (for host PRs)

- **`forceRefresh` after `dispose`:** test `forceRefresh after dispose is a no-op (does not throw)` — verified. The `tick()` body's `if (stopped) return` early-exit catches this; the `priorStateHash = null` assignment is a benign no-op when no future ticks fire.
- **Concurrent `forceRefresh()` + regular interval tick:** both call `void tick()`; the underlying `tick` body is async but idempotent against itself (it reads disk anew, computes a fresh hash). Two in-flight ticks may both pass the hash check (one sees `priorStateHash === null` after force; the second sees the freshly set hash) — both emit. This is a minor double-emit in a vanishingly-rare race, not a correctness bug.
- **`onStateChange` throws after `forceRefresh()`:** existing guard at `watcherLoop.ts:227-231` catches and logs; the loop continues. No change in error-handling semantics.
- **Schema mismatch / missing session file / malformed JSONL:** unchanged — those paths exit before the hash comparison; the new method only modifies post-tick hash-skip behavior, not pre-tick read/parse behavior.
- **Empty roster:** unchanged — roster loading is inside `runTick`, unrelated to the hash-skip surface.

## OOS (per dispatch)

- `hydrateState` M5-fields side-finding (Bram noted `config.hideFinishedAgents` / `hiddenFinishedCount` dropped on the webview side) — tracked separately under Maya ticket `86c9z5j3r`.
- PR #66 + PR #73 retention — both kept as harmless secondary paths; no revert.
- Watcher-loop internals beyond the new method.

## Anti-fabrication cites

- **PR #73 merge SHA:** `daf6109` (verified via `git log --oneline origin/main` — top: `7db627d` ; `git log --format=%H origin/main | head -3` includes `daf6109bf903ac7e85ca2a8ce849a66f84d7650c`).
- **Test results:** `Test Files 24 passed | Tests 456 passed | 2 skipped` (unit); `Test Files 7 passed | Tests 77 passed` (integration). Both observed from `npm run test` / `npm run test:integration` output this session.
- **Bundle survival:** `grep -c "forceRefresh" dist/extension/main.cjs` → `2`.
- **Existing callsites in dispatch brief:** `src/extension/main.ts:265` (`onRefresh` handler) — was `watcherHandle?.triggerTick()`, now `watcherHandle?.forceRefresh()`. Verified by `Read`.
- **Hash-skip line:** `src/extension/watcher/watcherLoop.ts:220-223` (`if (hash === priorStateHash) { return; }`).
- **`vsce package` output:** `Packaged: C:/Users/538252/AppData/Local/Temp/claudeteam-86c9z5hyp.vsix (10 files, 401.64 KB)`.

## Doc updates

None this PR — Bram's triage doc already captured the boot-race mechanism; the production code comments cite Bram's triage as the authoritative source. The `maintain-docs` skill may surface follow-up doc additions post-merge if the pattern is reusable beyond this one fix.
