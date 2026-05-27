# feat(ext): diagnostic Output channel — verbose per-tick state-delta logging

ClickUp: [86c9zn7vw](https://app.clickup.com/t/86c9zn7vw)

## Summary

New VS Code Output channel `"Claude Team — Diagnostics"`, gated by the
`claudeteam.diagnostic.verbose` setting (default `false`). When enabled, emits:

- One line per watcher tick: `[<ISO>] tick #<N> took <ms>ms — emitted=<bool>`
- Per-agent state-transition lines on every tick where an agent's state changed
  vs the prior tick: `[<ISO>] transition session=<sid8> agent=<aid8> <prev> → <next>`
- Roster reload events: `[<ISO>] roster reloaded — teams=<N> errors=<N> warnings=<N>`
- Watcher error events: `[<ISO>] error: <message>`

Toggling the setting at runtime takes effect within one tick — no Reload Window
required. The setting is read via `isVerbose()` fresh per emit; the underlying
`vscode.OutputChannel` is allocated **lazily** on the first verbose emit, so a
user who never enables verbose mode never sees the channel in their Output
dropdown.

Companion: ClickUp `86c9zn7tm` (Maya) covers the live-state-inspection panel —
this PR is just the tick-history Output channel.

## What changed

| File | Change |
|---|---|
| `src/extension/diagnostics/output.ts` (new) | Lazy-allocating diagnostic dispatcher. Owns the `prevState: Map<sessionId:agentId → AgentState>` for transition diffing. Mirrors the webview's `prevStateTracker` pattern on the host side per CLAUDE.md M3 brief. |
| `src/extension/watcher/watcherLoop.ts` | Added `onTickComplete` option + sequential `tickNumber` counter + wall-clock duration measurement. Hook fires AFTER the emit decision; errors caught + surfaced via `logger.warn` so a broken diagnostic cannot kill the watcher loop. |
| `src/extension/main.ts` | Constructs the diagnostic dispatcher once on `activate` (survives `resolveWebviewView` remounts). Wires `onTickComplete` → `recordTick`, the roster watcher's `onRosterChange` → `recordRosterReload`, and the watcher's `logger.warn` → `recordError`. Dispatcher disposed via `context.subscriptions` on extension shutdown. |
| `package.json` | New scalar setting `claudeteam.diagnostic.verbose` (boolean, default false). |
| `tests/unit/diagnosticChannel.test.ts` (new) | 23 unit tests — line formatters, lazy allocation, verbose gating, transition diff, CollapsedPersonaGroup walk, prevState pruning, dispose idempotency. |
| `tests/integration/watcherTickComplete.test.ts` (new) | 5 integration tests — hook fires with tickNumber=1, monotonic increment, `emitted: false` on hash-skip ticks, hook state ref matches `onStateChange` ref, throwing hook caught + loop survives. |

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| New Output channel `"Claude Team — Diagnostics"` registered | ✅ | `DIAGNOSTIC_CHANNEL_NAME` constant in `diagnostics/output.ts`; allocated via `vscode.window.createOutputChannel` |
| Gated by `claudeteam.diagnostic.verbose` (boolean, default false) | ✅ | `package.json` `contributes.configuration.properties.claudeteam.diagnostic.verbose` |
| Verbose off → no log emission, no channel allocation | ✅ | Test: `verbose off — never allocates the underlying OutputChannel` |
| One log line per watcher tick (timestamp + duration + state-change flag) | ✅ | Test: `verbose on — every tick produces exactly one tick line` |
| Per-agent state-transition lines on tick where `inferState` differs from prior | ✅ | Tests: `running → idle emits one transition line`, `running → idle → finished emits two transition lines` |
| Roster reload events emitted | ✅ | Test: `verbose on — both [recordRosterReload + recordError] emit one line each`; wired in `main.ts` via `onRosterChange` |
| Error events emitted | ✅ | Tests + `main.ts` wiring of `logger.warn` → `recordError` |
| Runtime toggle takes effect within one tick (no reload) | ✅ | Test: `verbose toggled mid-session — flipping off→on does NOT replay history (first verbose tick has no transitions)` |

## Failure-mode probes

| Probe | Expected | Observed |
|---|---|---|
| Setting toggled OFF→ON mid-session | First verbose tick has tick line but NO transitions (clean slate) | Verified via test (line 252-271) |
| Setting toggled ON→OFF mid-session | Emissions stop; channel scrollback preserved | Fast-path returns before any append |
| Watcher's `onTickComplete` hook throws | Logged via `logger.warn`; loop continues to next tick | Verified via test (line 153-169 integration) |
| Channel never used in a session | No `OutputChannel` ever allocated; no Output-dropdown entry | Verified via test (lazy allocation block) |
| `dispose()` called twice | Idempotent — second call no-op | Verified via test (`dispose is idempotent`) |
| CollapsedPersonaGroup agent transitions | Walked via `instances` array; each instance diffed individually | Verified via test (`walks CollapsedPersonaGroup instances`) |
| Agent disappears + reappears between ticks | Pruned from prevState; reappearance is a first observation (no transition) | Verified via test (`prunes prevState when tiles disappear`) |

## Test plan

```
npm run typecheck                                        # ✅ clean
npm run lint                                             # ✅ clean
npm run test:unit -- diagnosticChannel                   # ✅ 23 passed
npm run test:integration -- watcherTickComplete          # ✅ 5 passed
npm run test:unit                                        # ✅ 518 passed (no regressions)
npm run test:integration                                 # ✅ 99 passed (no regressions)
npm run build                                            # ✅ dist/extension/main.cjs 678.8kb
```

## Self-Test Report

### AC walkthrough — sub-agent GUI gap reframe

This PR's effect is observable only through the VS Code Output panel. Per
`.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke
workaround", the **AC(a) data-plane smoke** is performed via the unit +
integration test suites:

- **23 unit tests** lock the format of each log-line class (tick / transition /
  roster / error) AND the verbose-gate fast-path AND the lazy-allocation
  invariant AND the transition-diff semantics on bare AgentTile + CollapsedPersonaGroup.
- **5 integration tests** exercise the live watcher loop end-to-end (tempdir
  + real I/O), verifying `onTickComplete` fires with monotonic tickNumber,
  honest `emitted` flag (false on hash-skip), and survives a throwing hook.

**AC(b-d) interactive screenshots** (Reload Window + manual setting toggle +
real-time Output channel capture of `running → idle → finished` on a live
sub-agent JSONL) are deferred to **sponsor-side post-merge confirm-no-regression**
per the established pattern. The data-plane is fully smoke-tested; the visual
surface is a `vscode.window.createOutputChannel` line dump whose format is
regression-locked.

### Side-effect inventory

- Watcher loop now tracks tick numbers and wall-clock durations on every tick.
  When `onTickComplete` is unset (the test path that doesn't pass the hook),
  the counter still ticks but the hook is never invoked — no allocation, no
  observable change in behavior. All 99 existing integration tests pass.
- The `logger.warn` chain now also calls `diagnosticChannel.recordError(msg)` —
  this is a no-op when verbose is off, but means a verbose-on session will see
  warnings interleaved with tick history in one Output channel.
- The `onRosterChange` handler in `main.ts` now consumes the `RosterLoadResult`
  (previously discarded) to feed `recordRosterReload`. Behavior unchanged for
  non-verbose users.

### Failure-mode probes — covered above

### Manual-reload (deferred per sub-agent GUI gap)

Sponsor post-merge confirmation: open the VS Code command palette →
`Preferences: Open User Settings (UI)` → search `claudeteam.diagnostic` →
toggle `claudeteam.diagnostic.verbose` to `true` → open Output panel →
select `Claude Team — Diagnostics` from the dropdown → observe tick lines
appearing every ~2s (default `pollIntervalMs`). Toggle a live sub-agent
between running/idle/finished states to observe transition lines. No
Reload Window required between toggles.

## Doc updates

None this PR — the diagnostic channel is a developer/debug surface, not a
sponsor-facing feature. The package.json description is the documented
contract for the setting. If dogfooding finds new diagnostic value worth
documenting, follow-up ticket.

## Non-obvious findings

- **prev-state tracker lives in the diagnostic module, not the reducer.**
  The brief suggested mirroring the webview's `prevStateTracker` pattern from
  `src/extension/state/reducer.ts`. The reducer is a pure function with no
  per-tick memory by design (M1-09 invariant). The natural seam for the
  prev-tracker is the diagnostic dispatcher whose lifecycle matches the
  dispatcher's: allocate on first verbose emit, prune per tick, clear on
  dispose. This keeps the reducer free of host-side state.

- **Verbose off → off path does NOT update prevState.** When the user toggles
  verbose mid-session, the first verbose tick is treated as a clean slate
  (no transitions emitted relative to pre-verbose history). Otherwise we'd
  log a misleading `undefined → running` cascade as soon as the toggle
  fires. This matches the webview's `prevStateTracker.previous(...)`
  first-observation contract.

- **Lazy channel allocation matters.** Eagerly calling
  `vscode.window.createOutputChannel("Claude Team — Diagnostics")` on
  activate would put the channel in the Output dropdown forever, polluting
  the dropdown UX for users who never enable verbose mode. Allocation on
  first verbose emit means the channel only appears when the user has
  actually opted in.
