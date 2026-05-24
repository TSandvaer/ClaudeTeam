## chore(dashboard): M3-04 NIT #3 — `finished` tiles render freshness suffix

Closes the M3-04 NIT #3 surface from ticket `86c9ybtut` (webview half of the
split — Felix ships NITs #1 + #2 in a separate host-side PR).

### What this PR ships

**Problem (sponsor screenshot 2026-05-24):** active agents render `idle 14s` /
`idle 47s` — a clear freshness signal. Finished agents render just `finished`,
indistinguishable whether the agent finished 4 seconds ago or 4 hours ago.
Stale tiles look identical to fresh-finished tiles.

**Fix (webview-only, OOS-respecting):**

- **`src/webview/freshness.ts`** (new) — pure formatter `formatFreshness(ms)` →
  `Xs` / `Xm` / `Xh` with rollover at 60s and 3600s. Negative inputs clamp to
  `"0s"` (clock-skew defense). Documented as parallel to the host-side
  `idle Xs` convention emitted by `reducer.ts § buildActivity`.
- **`src/webview/finishedTracker.ts`** (new) — webview-local Map keyed by
  `sessionId:agentId` that records the first wall-clock ms each finished tile
  was observed. Subsequent renders return the original ms (so the suffix
  advances by clock time, not by re-render count). Includes a `prune()` pass
  driven by `render.ts` to drop entries when a tile transitions out of
  `finished` or vanishes from the dashboard — no memory leak over long
  sessions.
- **`src/webview/components/agentTile.ts`** — accepts optional `finishedAtMs`
  + `nowMs` props. When `tile.state === "finished"` AND `finishedAtMs` is
  provided, the activity row renders `${tile.activity} ${formatFreshness(now -
  finishedAtMs)}` (e.g. `"finished 5s"`). When `finishedAtMs` is omitted, the
  bare `tile.activity` renders verbatim — back-compat with pre-NIT#3 callers
  and component tests.
- **Threading: `render.ts` → `sessionBlock.ts` → `teamCard.ts` → `agentTile.ts`**
  — the optional `finishedTracker` + `nowMs` flow through `RenderContext`. The
  per-team tile loop calls `tracker.observe(sessionId, agentId, now)` once per
  finished tile and passes the returned ms down.
- **`src/webview/main.ts`** — instantiates one tracker at `boot()` (closure
  scope; persists across re-renders for the dashboard's lifetime).

### What this PR does NOT touch

- `AgentTile` / `AgentTree` / `SessionTree` shapes — unchanged. The tracker is
  webview-ephemeral state, NOT a new host-side field. OOS line "don't add new
  timestamp fields if AgentTree already exposes one" is respected.
- `src/extension/state/reducer.ts § buildActivity` — unchanged. The host still
  emits `"finished"` for finished tiles; webview enriches on render.
- Agent state lifecycle — unchanged. No reducer transition rule edits.
- Background-chip rendering — unchanged. Background agents already render
  their state as literal text per spec §1.6; NIT #3 only targets rostered tiles.

### Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| AC1 — finished tiles render `finished Xs/Xm/Xh`; formatter unit-tested at 5s/30s/2m/1h/4h | met | `tests/unit/webview/freshness.test.ts` (13 tests covering the brief-mandated deltas + boundary + clock-skew) |
| AC2 — existing tests stay green (281 unit / 68 integration / 23 Layer-3 on main) | met | `npm test` → 304 passed / 2 skipped (281 baseline + 13 freshness + 10 dashboardTile freshness integration); `npm run test:integration` → 68 passed |
| AC3 — Self-Test Report; AC walkthrough cited per AC with file:line; mechanical jsdom is the load-bearing pre-merge gate | met (this comment + `team/maya-dev/m3-04-nit3-selftest/smoke.mjs`) |

### Self-Test Report

#### AC(a) live data-plane smoke (sub-agent GUI gap workaround)

End-to-end pipeline verified via `team/maya-dev/m3-04-nit3-selftest/smoke.mjs`
— re-runnable vitest pass against the two load-bearing suites:

```
=== M3-04 NIT #3 smoke — vitest re-run against load-bearing suites ===
 ✓ tests/unit/webview/freshness.test.ts  (13 tests)  2ms
 ✓ tests/unit/webview/dashboardTile.test.ts  (40 tests)  52ms

 Test Files  2 passed (2)
      Tests  53 passed (53)

=== M3-04 NIT #3 smoke evidence ===
Both freshness.test.ts (13 tests) and the dashboardTile.test.ts
'finished freshness' describe blocks (10 tests) ran to green.
PASS — data-plane verified end-to-end.
```

Verifiable evidence:
- `formatFreshness(5_000)` returns `"5s"`; `formatFreshness(2 * 60_000)` →
  `"2m"`; `formatFreshness(4 * 60 * 60_000)` → `"4h"`. (13/13 freshness tests
  green incl. boundaries: 59_999ms → `"60s"`, 60_000ms → `"1m"`, 3_599_999ms →
  `"59m"`, 3_600_000ms → `"1h"`.)
- `createFinishedTracker().observe(sessionId, agentId, t0)` returns `t0`;
  second observe with the same key + `t0 + 30_000` returns `t0` (anchored).
- `renderFull(ctx, state)` with a finished tile + `nowMs = t0` renders
  `.agent-activity` text === `"finished 0s"`. Same call at `nowMs = t0 +
  30_000` → `"finished 30s"`. Tracker size stays at 1 across both renders.
- State transition `finished → running` drops the tracker entry on the next
  render (size = 0). Tile disappearing (empty `sessions: []`) drops it too.
- Back-compat: `renderFull({ mount, postMessage })` without `finishedTracker`
  renders the bare `"finished"` string — no NaN, no `"undefined"`, no suffix.

#### AC walkthrough — behavior I exercised locally

- **Fresh-finished** (`nowMs - finishedAtMs < 60s`) — activity reads
  `finished Xs` where X is the elapsed seconds (rounded).
- **Minute-scale** — at 60s+, rolls to `finished Xm` (floored).
- **Hour-scale** — at 3600s+, rolls to `finished Xh` (floored).
- **Anchored across re-renders** — the displayed elapsed time advances by
  wall-clock alone, not by every render tick. Host posts `state:full` at ~2s
  cadence; suffix refreshes automatically on each re-render.
- **Tracker pruning** — verified that finished → running transitions drop
  the entry; verified that vanished sessions drop their entries. No memory
  leak under churn.
- **Back-compat path** — finished tiles render bare `"finished"` when no
  tracker is provided. Existing 30 `renderAgentTile` test cases pass
  unchanged because they don't supply `finishedAtMs`.

#### Side-effect inventory

- `RenderContext` interface gains two optional fields (`finishedTracker`,
  `nowMs`) — purely additive. Existing call sites (component tests, fixture
  mode) work unchanged.
- `SessionBlockProps` + `TeamCardProps` gain the same two optional fields.
- `AgentTileProps` gains `finishedAtMs` + `nowMs` (optional).
- No CSS changes — the suffix becomes part of the existing `.agent-activity`
  text node and inherits `var(--vscode-foreground)`. Theme-awareness preserved
  automatically.
- No `package.json` changes — no `contributes`, no `configuration` edits,
  extension-manifest gate not triggered.
- No host-side files touched (Felix's surface). NIT #1 + NIT #2 ship in his
  separate PR per sponsor's "split per surface" preference.

#### Theme-switch probe

Deferred to sponsor post-merge per the sub-agent GUI gap reframe
(`.claude/docs/testing-strategy.md` §"Sub-agent GUI gap — webview-smoke
workaround"). Both author (Maya) and reviewer (Felix) are sub-agents; the
chip uses the existing `--vscode-foreground` palette via the `.agent-activity`
selector (no new colors introduced) so regression risk is structurally low.

#### State-coverage

| State | Activity text | Verified |
|---|---|---|
| running | `tool:Edit src/extension/main.ts` (verbatim from `tile.activity`) | `dashboardTile.test.ts` "state coverage" (existing) + freshness "does NOT append a freshness suffix to non-finished states" |
| idle | `idle 14s` (verbatim from `tile.activity`) | same row above |
| finished + tracker | `finished 0s / 5s / 30s / 2m / 4h` (suffix appended) | new `dashboardTile.test.ts` "finished freshness suffix" + freshness suite |
| finished, no tracker | `finished` (bare, back-compat) | new "renders bare 'finished' when no tracker is provided" |
| error | `error: meta.json parse failed (missing-agentType)` (verbatim) | existing "state coverage" + freshness "non-finished" guard |
| empty | `No live Claude Code sessions.` (unchanged) | existing empty-state tests |

### Files in play

- New: `src/webview/freshness.ts`, `src/webview/finishedTracker.ts`,
  `tests/unit/webview/freshness.test.ts`,
  `team/maya-dev/m3-04-nit3-selftest/smoke.mjs`,
  `team/maya-dev/m3-04-nit3-selftest/pr-body.md` (this file).
- Modified: `src/webview/components/agentTile.ts`,
  `src/webview/components/teamCard.ts`,
  `src/webview/components/sessionBlock.ts`, `src/webview/render.ts`,
  `src/webview/main.ts`, `tests/unit/webview/dashboardTile.test.ts`.

### Non-obvious findings (for maintain-docs)

- The host reducer's `buildActivity()` emits raw `idle Xs` (no minute
  rollover). This PR's `formatFreshness()` introduces the first webview-side
  formatter with rollover; if a future ticket promotes the rollover convention
  to the host side, the two formatters should share the same thresholds (60s →
  Xm, 3600s → Xh).
- "Webview-local first-seen" is a legitimate alternative to "add a `finishedAt`
  field to AgentTile" when the data plane already re-emits state at a useful
  cadence. The tracker accuracy is bounded by the host poll cadence (~2s for
  ClaudeTeam) — close enough for a freshness chip; the same trick would not be
  appropriate for absolute-time displays.
- The optional-fields-via-conditional-spread pattern used to thread
  `finishedTracker` / `nowMs` through `renderSessionBlock` / `renderTeamCard`
  matches the back-compat pattern Maya used in M3-04 (`...(wire.x !==
  undefined ? { x: wire.x } : {})`) and should stay consistent across the
  webview tree.

### Reviewer cues for Felix

- The tracker is owned by `main.ts` (one instance per webview boot), threaded
  through `RenderContext`. If you'd prefer a singleton-by-import pattern,
  flag it; the closure-owned shape was chosen for test isolation (each
  `renderFull` test gets its own tracker, no shared state across files).
- `formatFreshness(59_999)` returns `"60s"` (not `"1m"`) because the rollover
  threshold compares raw ms, not the rounded seconds value. Documented in the
  test ("renders the last second before the minute rollover as `Xs`"). Happy
  to change if you'd prefer a stricter cutoff, but the next render tick
  resolves the visual at ~2s cadence so the cosmetic edge is short-lived.
- Back-compat for component tests was preserved by making `finishedAtMs`
  optional — every existing `renderAgentTile` test call in
  `dashboardTile.test.ts` works unchanged.
