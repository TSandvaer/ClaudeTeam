## Summary

Replace the unreadable, double-clocked `finished 19289s 3s` shape on finished tiles with a single humanized elapsed-time + precise-ISO tooltip. Humanization moves to the host reducer (single source of truth); the webview drops the parallel `formatFreshness(now − first-seen)` suffix and adds a `Finished at 2026-05-26T...Z` tooltip on the activity span.

### Before

```
finished 19289s 3s        ← host's wall-time since tool_result (5.4h) + webview's first-seen (3s)
```

Two clocks competing. Host's seconds unreadable at large N. Webview's clock resets on reload and lies about freshness. Sponsor flagged in V1 dogfood (Obs 11, `team/dogfood/2026-05-26-obs-dashboard-quirks.md`).

### After (this PR — recommended)

```
finished 5h               ← host-humanized via formatFreshness, single clock
title="Finished at 2026-05-26T16:42:08Z"   (tooltip on .agent-activity span)
```

Buckets follow the existing `idle <Ns>` convention with day rollover added 86c9zfmhp:

| Elapsed         | Rendered  |
|---|---|
| 0 – 59.999 s    | `Xs` (clamped at 59) |
| 1 m – 59.999 m  | `Xm` |
| 1 h – 23.999 h  | `Xh` |
| ≥ 24 h          | `Xd` |

## Alternates considered — **sponsor sign-off requested on format choice**

Per ticket AC1, three candidates were considered. Each is implementable in <30 lines of additional change; the PR ships Candidate A as the default but the others remain viable.

### Candidate A — Compact humanized (this PR)

- Activity row: `finished 5h`
- Tooltip on activity span: `Finished at 2026-05-26T16:42:08Z`
- Matches existing `idle 14s` skim shape; no UI noise; freshness signal visible at a glance; precise wall-clock available on hover for audit.
- Trade-off: ambiguity about "5h since what" — the tooltip resolves it but only on hover.

### Candidate B — Explicit "ago" phrasing

- Activity row: `finished 5h ago`
- Tooltip: same as A
- Pros: unambiguous reading without tooltip; reads as English.
- Cons: 4 extra chars on every finished tile; breaks symmetry with `idle 14s` (which omits "ago").
- One-line patch: change `\`finished ${formatFreshness(...)}\`` → `\`finished ${formatFreshness(...)} ago\`` in `buildActivity`.

### Candidate C — Tooltip-only freshness

- Activity row: `finished` (static — pre-86c9yxv94 shape)
- Tooltip: `Finished 5h ago (2026-05-26T16:42:08Z)`
- Pros: minimal visual noise; resolves both freshness AND precise-time on hover.
- Cons: loses skim signal — sponsor's original Obs 6 complaint ("Bram finished 2s static for several minutes") returns at scale. Defeats 86c9yxv94's purpose.
- Not recommended; included for completeness per ticket AC1.

**Default ships as A.** If sponsor prefers B or C, two-line follow-up patches available — flag at PR review and the orchestrator routes a NITs ticket OR I'll respin before merge per sponsor's preference.

## Scope

- `src/shared/freshness.ts` **(new)** — moved from `src/webview/freshness.ts` so the extension host's `buildActivity` can import. Added `Xd` rollover for ≥24h elapsed. Same `Math.min(59, Math.round(...))` rollover-NIT clamp preserved.
- `src/webview/freshness.ts` — collapsed to a re-export shim of the shared module so existing `from "../freshness.js"` imports keep working without churn.
- `src/extension/state/reducer.ts` — `buildActivity` finished branch now calls `formatFreshness(nowMs − finishedAtMs)` instead of emitting raw `${elapsedS}s`. The `!== undefined` gate, the `Math.max(0, ...)` clamp, and the bare-`"finished"` fallback for absent timestamps are unchanged. CLI presenter (`src/cli/agentTree.ts`) inherits humanization automatically — no CLI change needed.
- `src/shared/types.ts` — `AgentTile` gains an optional `finishedAtMs?: number` field carrying the host's authoritative parent-JSONL `tool_result.timestamp`. JSON-safe primitive — survives the `serializeState` round-trip without flattening. Reducer omits the field when the parser sentinel `0` arrives so the webview doesn't render a misleading `1970-01-01` tooltip.
- `src/webview/components/agentTile.ts` — drops the unconditional `${tile.activity} ${formatFreshness(...)}` concat that was the parallel-clock bug shape. Gated to only fire when `tile.activity === "finished"` literally (back-compat with fixtures / tests where the host emits the bare string). Adds `activityTitle` derived from `tile.finishedAtMs` and attaches as `title=` on the `.agent-activity` span (NOT the row wrapper — keeps it from overlapping the article-level drill-in tooltip).

OOS:
- Changing the CLI activity format spec (`iris-ux/m1-cli-output-spec.md` §1.4) — the spec calls "presenter-agnostic at the reducer boundary"; we now humanize at the reducer, but the produced string still fits the spec's `finished <suffix>` shape. If sponsor wants the spec re-anchored to enumerate buckets, follow-up NIT.
- Removing the webview's `finishedTracker` plumbing — kept intact for the back-compat branch (bare-`"finished"` from host); retiring it entirely is a future cleanup once the host has shipped humanization for ≥1 milestone with zero "bare finished" regressions observed.
- Tile-level visual treatment (color, icon, font weight) of the elapsed suffix — Iris design surface, out of this fix's scope.

## Self-Test Report

### AC walkthrough

- **AC1 — proposed alternates surface for sponsor approval.** Three candidates listed above; default ships as A; B and C are <30-line follow-up patches if sponsor prefers.
- **AC2 — single clock, no double-clock regression.** `renderAgentTile — Obs 11` test "renders host-emitted humanized activity verbatim (no double-clock)" pins the exact V1-dogfood shape: tile.activity = `"finished 5h"`, tracker-supplied finishedAtMs = 999_000, nowMs = 60_000ms later → rendered text is `"finished 5h"` (NOT `"finished 5h 60s"`). `tests/unit/webview/dashboardTile.test.ts` lines following the Obs 11 describe block.
- **AC3 — humanization at host applied to every bucket.** Reducer test "elapsed buckets cover Xs / Xm / Xh / Xd rollovers" pins 5s/90s/2h/5h/1d outputs from `buildActivity`. `tests/unit/reducer.test.ts` line ~1023.
- **AC4 — tooltip carries precise ISO.** "attaches precise-ISO tooltip to the activity span when finishedAtMs is on tile" → asserts `title="Finished at 2023-11-14T22:13:20.000Z"` matches `new Date(epoch).toISOString()`. Gated on state=finished AND finishedAtMs on tile (two negative-case tests for non-finished states + omitted timestamp).
- **AC5 — boundary tests for s/m/h/d transitions.** Freshness tests pin `23h 59m 59.999s → "23h"`, `24h → "1d"`, `47h 59m 59.999s → "1d"`, `48h → "2d"`. `tests/unit/webview/freshness.test.ts` lines ~98–119.
- **AC6 — Math.max clock-skew clamp preserved.** Pre-existing reducer test "nowMs < finishedAtMs (clock skew) → 'finished 0s' (clamped)" still passes (humanized output for elapsed=0 is `0s`, matching).

### Data-plane smoke (sub-agent GUI gap — `testing-strategy.md` § "Sub-agent GUI gap")

`npx vitest run` — 25 test files, **490 passed, 2 skipped, 0 failed**. 5 new tests added under `renderAgentTile — Obs 11 humanized finished + ISO tooltip` describe block. Integration suite (`vitest.integration.config.ts`) — **83 passed, 0 failed**.

`npm run build` clean: `dist/extension/main.cjs` (675 kb), `dist/webview/main.js`, `dist/webview/dashboard.css`. `npm run lint` clean. `npm run typecheck` clean.

### Side-effect inventory

- **CLI presenter** — `src/cli/agentTree.ts` pads `tile.activity` to 30 chars. Was previously printing `finished 19289s ` (15 chars + pad); now prints `finished 5h     ` (11 chars + pad). No layout regression — narrower string fits the same field. Verified visually on the CLI output golden tests (still passing).
- **`finishedTracker` plumbing** — `src/webview/finishedTracker.ts` + its passes through `teamCard` / `sessionBlock` / `collapsedPersonaTile` / `main.ts` are unchanged. The tracker continues to feed `finishedAtMs` props into `agentTile`; that prop now only matters in the back-compat (bare-`"finished"`) branch.
- **CSS scoping** — the new `title=` on `.agent-activity` is an HTML attribute, not a class/data-attribute. No CSS selector touches it. Theme-token bindings (`--vscode-foreground`, `--ct-*` indirection layer) untouched.
- **Wire shape** — `AgentTile.finishedAtMs` is a number primitive. JSON-stringify clean; round-trip verified by existing webview hydrate tests passing.

### Theme-switch probe

Not applicable — pure data + tooltip change. No CSS, no color, no `--vscode-*` token touched. The activity row continues to inherit text color from the tile's existing `--ct-*` cascade.

### State-coverage (jsdom assertions — sub-agent GUI gap workaround)

- **finished + recent (< 1m):** `finished 5s` (tested at 5_000 ms elapsed).
- **finished + minute scale:** `finished 1m`, `finished 2m` (90s, 120s).
- **finished + hour scale:** `finished 2h`, `finished 5h` (sponsor-observed exact case at 19_289_000 ms).
- **finished + day scale:** `finished 1d`, `finished 2d`, `finished 7d` (newly enumerated).
- **finished + sentinel timestamp (parser failure):** `finished <N>d` (humanized; `tile.finishedAtMs` undefined → no misleading 1970 tooltip).
- **finished + tooltip:** `title="Finished at 2023-11-14T22:13:20.000Z"` (epoch → ISO formatter; UTC-anchored).
- **idle / running / error tiles:** unchanged — humanization is gated on state=finished; tooltip same.

### Manual-reload screenshot (sub-agent GUI gap)

Both PR author and reviewer are sub-agents. Per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround", the interactive Reload Window screenshot is deferred to sponsor post-merge confirm. Load-bearing pre-merge verification is the jsdom data-plane smoke above — the rendered DOM text + title attribute are the exact bytes the production webview will emit on the next host poll.

## Cross-references

- Symptom: `team/dogfood/2026-05-26-obs-dashboard-quirks.md` § Obs 11 (sponsor verbatim — `finished 19289s 3s`).
- Predecessor: ClickUp `86c9yxv94` (Defect 6a — added the `finished Xs` suffix at the host) + `86c9ybtut` (M3-04 NIT #3 — added the webview-tracker suffix). Obs 11 unifies the two clocks into one host-authoritative humanized string.
- Reviewer: Felix (cross-pair, host-side surface change in `reducer.ts`).
- Spec: `iris-ux/m1-cli-output-spec.md` §1.4 — activity format. The spec's intent ("presenter-agnostic") survives; humanization sits at the same boundary, just produces a more readable shape.

## Verification commands

```
npm run typecheck       # clean
npm run lint            # clean
npm run build           # clean (host + webview + cli bundles)
npx vitest run          # 490 passed / 2 skipped / 0 failed
npx vitest run --config vitest.integration.config.ts   # 83 passed
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
