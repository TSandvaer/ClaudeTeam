# feat(ext): diagnostic webview panel — tick history + current state breakdown (86c9zn7tm)

ClickUp: [86c9zn7tm](https://app.clickup.com/t/86c9zn7tm)

## Summary

New VS Code editor-tab panel `"ClaudeTeam Diagnostics"`, opened via the
`claudeteam.openDiagnosticPanel` command. Companion to PR #92 / `86c9zn7vw`
(Felix's Output channel) — same per-tick data, structured + refreshable.

The panel surfaces:

- **Header chips** — Output-channel verbose state (ON/OFF), tick-count in history.
- **Tick history table** (newest first) — timestamp, tick #, duration, emitted/skip flag, per-row transition list (`agent-12 → idle`).
- **Current state section** — one card per session, agent table (team / persona / state badge / agentId / activity / model), background-agent list, and a roster-error/warning banner.
- **Controls** — Refresh / Pause / Clear history. Pause stops auto-push (host keeps recording in the ring buffer); Resume sends a catch-up snapshot.

The ring buffer (capped at 50 ticks) captures **every** tick regardless of
`claudeteam.diagnostic.verbose` — opening the panel mid-session shows recent
history immediately. The verbose setting still gates Output-channel writes
only.

## Surface-design choices (sponsor decisions)

Defaults the brief said to call and surface here:

| Question | Default chosen | Rationale |
|---|---|---|
| Panel vs editor-tab? | **Editor tab** (`vscode.WebviewPanel`) | Activity-bar dashboard is intentionally narrow; the diagnostic panel is a wide tabular view. Editor-tab placement lets the user split-pane it next to a JSONL transcript or pull it into a separate window. |
| Auto-refresh on tick vs manual? | **Tick-driven push + explicit Pause / Clear / Refresh** | Matches the dashboard cadence the user already understands. Pause is the release valve for inspecting a frozen moment. |
| Per-session detail drill-down vs flat table? | **Flat table per session (no drill-in)** | V1-scope answer — the dashboard already owns drill-in; the panel is "what's the watcher seeing right now?" not "let me explore one agent." Drill-in is a clean follow-up if dogfooding asks for it. |
| Theme handling | `--vscode-*` variables throughout; semantic state colors hardcoded hex (shared with dashboard) | Matches `vscode-extension-conventions.md` § Webview rules + the existing dashboard token discipline. |

No surface change felt like it needed Iris design input — the panel's
visual language (state badges, banners, tables) is a straight reuse of the
existing M2/M3/M4 dashboard tokens. If dogfooding finds visual issues,
follow-up Iris pass.

## What changed

| File | Change |
|---|---|
| `src/extension/diagnostics/output.ts` | Added tick ring buffer (`TICK_HISTORY_LIMIT=50`), `subscribe(listener)`, `getSnapshot()`, `clearHistory()`. Buffer + subscribers fire on every tick (independent of verbose); Output channel still gated by verbose. Verbose's "first-tick clean slate" preserved via a separate `verbosePrimed` flag so log-readability is unchanged. |
| `src/extension/diagnostics/panel.ts` (new) | Panel manager — singleton `vscode.WebviewPanel`, idempotent `show()`, message dispatch for `ui:diagnostic-{clear,pause,refresh}`, post-on-tick via the subscriber. CSP-strict HTML; lazy-allocated panel. |
| `src/extension/main.ts` | Constructs the panel manager at activate-time (cheap — actual panel is lazy on `show()`); registers `claudeteam.openDiagnosticPanel` command; disposes via `context.subscriptions` cleanup wrapper. |
| `src/shared/messages.ts` | New types: `DiagnosticTickTransition`, `DiagnosticTickHistoryEntry`, `DiagnosticStateMessage`, `DiagnosticClearMessage`, `DiagnosticPauseMessage`, `DiagnosticRefreshMessage`. Unions extended. |
| `src/diagnostics/main.ts` (new) | Webview entry point — boot, message receiver, optimistic UI for Pause/Clear, pull-handshake via `ui:diagnostic-refresh` on boot. |
| `src/diagnostics/render.ts` (new) | Pure DOM renderer — header / tick table / state section. Exported `stateBadge` + `formatTickTimestamp` for unit coverage. |
| `src/diagnostics/panel.css` (new) | Theme-aware styles — every color flows through `--vscode-*` (with explicit fallback) or one of the four semantic state hex codes shared with the dashboard. |
| `package.json` | New `claudeteam.openDiagnosticPanel` command. Activation event auto-derived from `contributes.commands` per modern VS Code conventions. |
| `esbuild.config.mjs` | Two new bundles: `dist/diagnostics/main.js` (IIFE) + `dist/diagnostics/panel.css`. Wired into both `build` and `watch` modes. |
| `tests/unit/diagnosticTickHistory.test.ts` (new) | 11 tests — ring buffer capture / cap / clear, snapshot freshness, subscribe lifecycle, throwing-listener isolation, dispose semantics. |
| `tests/unit/diagnosticPanel.test.ts` (new) | 18 tests — `show()` idempotency, panel-close lifecycle, push-on-tick, pause/resume/clear/refresh flow, verbose-flag wire stamp, Map → object flatten, CSP block. |
| `tests/unit/webview/diagnosticPanelRender.test.ts` (new) | 25 jsdom tests — empty boot, header chips, button callbacks, tick table newest-first ordering, hash-skip modifier, transition badges, session cards, CollapsedPersonaGroup flatten, dead-session badge, background-agent list, roster banners (error + warn), `stateBadge` + `formatTickTimestamp`. |
| `tests/integration/subscriptionLeak.test.ts` | `afterActivate` count bumped from 6 → 7 to account for the new command registration. |
| `team/log/clickup-pending.md` | Lifecycle entries. |

## Acceptance criteria

| AC | Status | Evidence |
|---|---|---|
| New command `claudeteam.openDiagnosticPanel` registered | ✅ | `package.json` `contributes.commands`; `main.ts` `vscode.commands.registerCommand` |
| Opening the panel reveals a singleton (re-invoking the command does NOT open a second tab) | ✅ | Test: `show() creates a single panel; calling twice reveals the existing one` |
| Panel renders tick history (timestamp, tick #, duration, emitted, transitions) | ✅ | `renderTickTable` + 4 jsdom tests covering row count, ordering, hash-skip modifier, transitions |
| Panel renders current-state breakdown per session (agents + background + roster banners) | ✅ | `renderSessionCard` + 6 jsdom tests |
| Auto-refresh on tick — host pushes `diagnostic:state` after every tick when panel is open | ✅ | Test: `posts a diagnostic:state on every tick after the panel is open` |
| Pause suppresses pushes; Resume sends a catch-up snapshot | ✅ | Test: `pause suppresses pushes; resume sends one catch-up snapshot` |
| Clear empties the ring buffer | ✅ | Test: `ui:diagnostic-clear empties the ring buffer AND re-posts` |
| Manual Refresh button pulls a fresh snapshot | ✅ | Test: `ui:diagnostic-refresh sends a fresh snapshot on demand` |
| Theme-aware: every color comes from `--vscode-*` (state colors hardcoded by design) | ✅ | `panel.css` — all colors flow through `var(--vscode-NAME, fallback)` or `--ct-diag-state-*` (shared semantic codes) |
| CSP-strict (no inline scripts, no `unsafe-*`) | ✅ | Test: `includes a strict CSP scoped to the webview cspSource` |
| Webview-host JSON wire shape — Maps flattened to plain objects | ✅ | Test: `flattens the in-memory DashboardState (Maps) to wire shape (plain objects)` |
| Disposal: closing the panel tears down the subscription; manager disposal closes the panel | ✅ | Two lifecycle tests cover both paths |

## Failure-mode probes

| Probe | Expected | Observed |
|---|---|---|
| Panel opened with no ticks in history | "Waiting for the first watcher tick…" empty state | Verified jsdom test `empty boot state` |
| Throwing tick subscriber | Other subscribers + dispatcher continue; one bad listener does NOT take down the panel | Verified test `throwing listener does not block other listeners` |
| Panel disposed (user closed tab) → new tick fires on the host | No `postMessage` attempted; manager handles in-flight messages defensively | Verified `dispose() after show() closes the panel + tears down the subscription` |
| Ring buffer overflow (TICK_HISTORY_LIMIT + 7 ticks recorded) | Oldest 7 entries drop; newest 50 retained | Verified `caps at TICK_HISTORY_LIMIT — oldest entries fall off` |
| Verbose mid-session toggle off→on | Output channel preserves "first verbose tick is clean slate" behavior; panel keeps seeing all transitions | Verified existing 23 `diagnosticChannel.test.ts` tests pass unchanged + `captures transitions even with verbose OFF` confirms panel independence |
| Manager dispose before any show | No panel allocated; no further allocations possible on `show()` | Verified `dispose() before show() never allocates a panel` + `show() after dispose() throws` |

## Test plan

```
npm run typecheck                                              # ✅ clean
npm run lint                                                   # ✅ clean
npm run test:unit -- diagnosticTickHistory                     # ✅ 11 passed
npm run test:unit -- diagnosticPanel                           # ✅ 18 passed
npm run test:unit -- diagnosticPanelRender                     # ✅ 25 passed
npm run test:unit -- diagnosticChannel                         # ✅ 23 passed (no regressions from output.ts refactor)
npm run test:unit                                              # ✅ 609 passed (2 skipped — pre-existing)
npm run test:integration                                       # ✅ 99 passed (subscriptionLeak count updated to 7)
npm run build                                                  # ✅ all bundles emitted, host main.cjs = 688.3kb
npx vsce package --no-yarn                                     # ✅ claudeteam-0.0.1.vsix packaged (15 files, 458 KB)
node -e "require('./dist/extension/main.cjs')"                 # ✅ post-format-check — fails only on `vscode` external (expected)
```

## Self-Test Report

### AC walkthrough — sub-agent GUI gap reframe

This PR ships an interactive webview panel — the visual surface is observable
only inside a live VS Code session. Per `.claude/docs/testing-strategy.md`
§ "Sub-agent GUI gap — webview-smoke workaround", **AC(a) data-plane smoke**
is performed via the unit + integration test suites:

- **77 new tests** (11 ring buffer + 18 panel manager + 25 renderer + 23 existing channel) lock the wire format, the per-tick subscriber lifecycle, the optimistic UI flows (Pause / Clear / Refresh), and the DOM structure of every rendered section.
- The renderer tests run under `jsdom` and assert structural shape (data-state badges, modifier classes, button labels, row counts) — the same discipline `dashboardTile.test.ts` uses for the dashboard.
- Existing 23-test `diagnosticChannel.test.ts` continues to pass — the verbose Output-channel contract is preserved by the new `verbosePrimed` flag.

**AC(b-d) interactive screenshots** (Reload Window + `Ctrl+Shift+P → ClaudeTeam: Open Diagnostic Panel` + live tick observation + theme toggle dark/light) are deferred to **sponsor-side post-merge confirm-no-regression** per the established pattern. The data plane is fully smoke-tested; the rendered surface uses the same theme tokens as the dashboard which has shipped post-merge confirmation across M2/M3/M4.

### Side-effect inventory

- The diagnostic channel's `recordTick` now ALWAYS updates the per-(session,agent) prevState map (regardless of verbose) so the panel sees structured transitions. The verbose Output-channel cleanliness invariant ("first verbose tick after a verbose-off period is a clean slate") is preserved via a separate `verbosePrimed` flag — the existing `verbose toggled mid-session` test (line 306 of `diagnosticChannel.test.ts`) confirms this still holds.
- New command in command palette: `ClaudeTeam: Open Diagnostic Panel` (codicon `$(pulse)`).
- New activation surface: opening the panel via command activates the extension if not already active. The activation cost is unchanged at first open of the activity-bar pane; the panel manager itself is cheap (object + closures).
- `package.json` touched (command added). `vsce package --no-yarn` reported `claudeteam-0.0.1.vsix` packaged successfully with the new `dist/diagnostics/` directory (15 files, 458.48 KB total).

### Theme-switch probe (deferred per sub-agent GUI gap)

Sponsor post-merge confirmation: switch between VS Code dark and light themes
with the diagnostic panel open. Every color in `panel.css` flows through a
`--vscode-*` variable; the four semantic state badges (running green / idle
amber / finished slate / error red) are intentionally hardcoded hex shared
with the dashboard — they MUST NOT theme per `vscode-extension-conventions.md`
§ Webview rules.

### State-coverage (deferred per sub-agent GUI gap)

Sponsor verification on real session data:

- **Running tick** — header chip flips to `Output channel: ON` if verbose is toggled; new row appears at the top of the tick table; transitions render badges.
- **Idle / finished** — agent rows update; state badge colors match the dashboard.
- **Error state** — roster YAML break renders the `.diagnostic-banner--error` banner at the top of the current-state section.
- **Empty roster / empty sessions** — appropriate empty placeholders render.

### Failure-mode probes — covered above

### Manual-reload (deferred per sub-agent GUI gap)

Sponsor post-merge confirmation:
1. `Ctrl+Shift+P` → `ClaudeTeam: Open Diagnostic Panel`.
2. Panel opens as an editor tab titled "ClaudeTeam Diagnostics".
3. After 1-2 watcher ticks, the tick table populates.
4. Click `Pause` → no new rows; click `Resume` → catch-up snapshot lands.
5. Click `Clear history` → table empties; next tick repopulates.
6. Toggle dark/light VS Code theme → panel re-themes; state badges stay hardcoded.

## Doc updates

None this PR — the diagnostic panel mirrors the Output-channel contract Felix
documented in PR #92, and the panel itself is a developer/debug surface (same
audience as the Output channel). If dogfooding finds patterns worth
documenting (drill-in scope, panel-keyboard shortcuts, etc.), follow-up
ticket.

## Non-obvious findings

- **Ring buffer is independent of the verbose gate.** Felix's original design
  routed all per-tick work through the verbose-on fast path. For the panel to
  show recent history when the user opens it mid-session, the buffer must be
  filled regardless. Cost is negligible (a small object per tick + a single
  Set walk for transitions) and the panel is the only consumer when the
  panel is closed (subscribers list is empty → notification loop is a no-op).

- **`verbosePrimed` flag preserves Output-channel cleanliness.** The original
  contract — "first verbose-on tick after a verbose-off period emits the
  tick line but no transitions" — is preserved by tracking a boolean that
  flips false on every verbose-off observation. The diagnostic channel's
  in-memory state graduation diverges from the Output channel's view of
  graduation, and both contracts coexist cleanly.

- **Panel uses `retainContextWhenHidden: true`.** The user's scroll position
  + pause state survive editor-tab drag-and-drop between editor groups.
  Memory cost is negligible at the panel's scale (≤50 rows + small state
  table); without it, switching to a sibling editor tab and back would
  reset the panel to "waiting for first tick" until the next push.

- **`onCommand:` activation event is auto-derived.** Modern VS Code generates
  `onCommand:<id>` activation events from `contributes.commands` entries
  automatically. The IDE diagnostic flagged my initial explicit
  `onCommand:claudeteam.openDiagnosticPanel` as redundant — removed.

- **Renderer reuses `SerializedDashboardState` directly.** The webview-side
  `hydrateState` (which builds `Map<string, RosterTileEntry[]>` for the
  dashboard's `renderAgentTile` API) is intentionally NOT reused — the
  panel only reads state, never mutates it, so the renderer iterates the
  plain-object `Record<string, RosterTileEntry[]>` shape directly. Avoids a
  Map allocation per tick push.
