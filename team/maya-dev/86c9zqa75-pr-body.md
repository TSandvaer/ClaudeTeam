## Summary

Pt 2 of 86c9zmyef (running-focused dashboard). **Webview render layer** — paints the wire fields Felix's Pt 1 shipped at `f7ffc1f`:

- Per-tile **running-state dot member-color** via inline `--ct-color-running-dot` custom property (semantic-token fallback).
- **`Hide idle` header chip** mounted alongside M5's `Hide finished` chip (same component, `kind` discriminator).
- **Per-team passive "N idle hidden — show" row** appended after a team's tiles when the global filter is on AND the global count > 0.
- **Empty state** continues to render the running-focused chip pair so the toggle is discoverable on a fresh install.

Closes ClickUp `86c9zqa75`.

Spec: `team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md` (PR #95 — merge `4928838`). Vocabulary contract locked per spec §7; live wire shape on main at `f7ffc1f` (PR #97 — Felix's Pt 1).

## What changed (per AC)

| AC | Change | Files |
|---|---|---|
| AC1 — member-color paint | `renderAgentTile` sets `style="--ct-color-running-dot: <color>"` on the article when `tile.state === "running"` AND `tile.memberColor` defined. CSS `.state-dot[data-state="running"]` now reads `var(--ct-color-running-dot, var(--ct-color-state-running))` — untagged tiles paint unchanged. Same paint logic also applied to `renderCompactInstanceRow` (uniform-cluster compact row variant) for forward-compat. | `src/webview/components/agentTile.ts`, `src/webview/components/collapsedPersonaTile.ts`, `src/webview/styles/dashboard.css` |
| AC2 — Hide-idle header chip | `renderHeaderChip` generalized with a `kind: "finished" \| "idle"` discriminator + `CHIP_COPY` lookup table (noun, configKey, dataKey, dataCountKey). M5 callers unchanged (default `kind="finished"`). `render.ts` mounts both chips side-by-side after the error-chip stack. | `src/webview/components/headerChip.ts`, `src/webview/render.ts` |
| AC3 — Per-team idle row | `renderTeamCard` appends a `<button class="ct-team-idle-row">` after the last tile when `hideIdle === true` AND `hiddenIdleCount > 0`. Click fires the same `ui:set-config` message as the global chip — passive informational hint per spec §3.4 Option A+B. | `src/webview/components/sessionBlock.ts`, `src/webview/components/teamCard.ts`, `src/webview/styles/dashboard.css` |
| AC4 — Empty state | The chip pair already renders unconditionally per M5's §4.6 ("always rendered") discipline; the idle chip now sits alongside in the empty branch — toggle discoverable even on a fresh install with no agents yet. No new branch logic; the existing chip-mount block in `render.ts` simply renders both. | `src/webview/render.ts` (existing always-mount branch) |
| AC5 — Halo decision | **Option b — drop the box-shadow halo guardrail from the spec.** Live `dashboard.css` already has no halo, only an opacity pulse (`ct-pulse` at lines 357-360 on main); opacity-only modulation inherits the dot's resolved color and provides motion/attention-attracting signal without competing with the member-color identity. A green halo around a blue dot reads as a bug, not a guardrail; sponsor authority for color contrast is already documented in `roster-matching.md` per Felix's Pt 1. Spec §2.5 #2 to be updated by Iris in a follow-up; not blocking this PR. | (rationale only) |

## Wire-shape passthrough — `hydrateState` extension

`src/webview/main.ts:hydrateState` now passes through `wire.hiddenIdleCount` verbatim (parallel to the existing `hiddenFinishedCount` passthrough). Without this the idle chip would read 0 even when Felix's Pt 1 wire delivered real counts. `config.hideIdleAgents` already rides through the existing `config` passthrough block — no new branch needed there.

## Vocabulary contract — spec §7 verbatim

| Surface | Implementation |
|---|---|
| Chip label OFF | `"Hide idle"` |
| Chip label ON + 0 hidden | `"Show idle — none yet"` |
| Chip label ON + N=1 | `"Show idle — 1 hidden"` |
| Chip label ON + N>1 | `"Show idle — N hidden"` |
| Per-team row N=1 | `"1 idle hidden — show"` |
| Per-team row N>1 | `"N idle hidden — show"` |
| `data-hide-idle` attribute | `"true"` / `"false"` |
| `data-hidden-idle-count` attribute | string form of N |
| `--ct-color-running-dot` | per-tile inline custom property |
| `ct-team-idle-row` | CSS class on the per-team row |
| `SetConfigMessage` key literal | `"hideIdleAgents"` |

Em-dash is U+2014 (single source — `EM_DASH` const in `headerChip.ts` + mirrored in `teamCard.ts`).

## V1 limitation flagged

The per-team row reuses the **global** `hiddenIdleCount` value. For multi-team rosters this means the same N appears in every team's row. V1 dogfood roster has one team (`claudeteam-alpha`) so the discrepancy doesn't surface; per-team-breakdown counts would require Felix to extend the wire shape (per-session or per-team count map) — flagged here as a post-V1 follow-up if multi-team rosters become a sponsor pattern.

## Tests

- **`tests/unit/webview/dashboardTile.test.ts`** — +13 new cases:
  - 4× member-color paint (running + memberColor set, undefined, idle/finished/error suppression).
  - 9× per-team idle row (suppressed-when-off, suppressed-when-count=0, count-matches-team-count, singular label, plural label, plural aria-label, click posts `ui:set-config`, row position is last child).
- **`tests/unit/webview/headerChip.test.ts`** — +15 new cases:
  - 4× `labelTextForState` idle variant (off / 0 / 1 / N>1).
  - 6× idle chip render (dataset attrs, aria-pressed, title, label, click-OFF, click-ON, optimistic UI).
  - 1× back-compat default kind = "finished".
  - 5× `renderFull` integration (both chips render, finished-before-idle order, idle ON-state binding from `state.config`, idle defaults to 0/false when fields absent, full chip stack after error chips).

**Unit tests: 660 → 688 (+28, all green).** Integration tests: 102 green (unchanged — no host-side touches). Build / typecheck / lint: clean.

## Self-Test Report — sub-agent GUI gap reframe

Per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround" (originating example M2-06 PR #28), both PR author + designated reviewer (Maya, Felix) are sub-agents with no GUI session. AC(a) data-plane smoke is performed and cited via the jsdom unit tests (real `renderFull` cycle against augmented `FIXTURE_STATE` — assertions on actual DOM attributes, label text, click dispatch); AC(b-d) interactive screenshots (`Reload Window`, theme toggle, state-coverage screenshots) defer to sponsor post-merge confirm.

### AC walkthrough — evidence cites against this branch

- **AC1 — member-color paint:** verified by `tests/unit/webview/dashboardTile.test.ts` "renderAgentTile — member-color paint" describe block (4 cases). jsdom asserts the inline `--ct-color-running-dot` CSS custom property is set on the article only when `state === "running"` AND `tile.memberColor` is defined; idle / finished / error states confirmed not to paint the override.
- **AC2 — Hide-idle header chip:** verified by `tests/unit/webview/headerChip.test.ts` "renderHeaderChip — idle variant state matrix" (6 cases) + "renderFull — both header chips mount (86c9zqa75)" (5 cases). Asserts: `data-hide-idle` / `data-hidden-idle-count` data attributes distinct from M5's `data-hide-finished` / `data-hidden-count`; click dispatches `ui:set-config` with `hideIdleAgents` key; both chips render side-by-side in canonical order.
- **AC3 — Per-team idle row:** verified by `tests/unit/webview/dashboardTile.test.ts` "per-team idle-hidden row" describe (9 cases). Asserts: suppression when filter off / count 0; rendering when both conditions met; label vocabulary (singular vs plural + em-dash); click dispatches `ui:set-config { hideIdleAgents: false }`; row position is the team-card's `lastElementChild`.
- **AC4 — Empty-state chip discoverability:** existing `tests/unit/webview/headerChip.test.ts` "renderFull — M5 header chip mount" cases already assert both chips render in the empty branch (extended to assert both finished + idle chips present per new `renderFull — both header chips mount` block).
- **AC5 — Halo decision recorded** in this PR body and inline in `dashboard.css` (next to the `.state-dot[data-state="running"]` rule).
- **AC6 — Wire passthrough:** `tests/unit/webview/hydrateState.test.ts` already covers the existing `hiddenFinishedCount` passthrough pattern; the new `hiddenIdleCount` line is structurally identical. End-to-end data-plane verified by `tests/unit/webview/headerChip.test.ts` "idle chip boots ON when state.config.hideIdleAgents=true" — augmented state → `renderFull` → chip reads correct values.

### Side-effect inventory

- **`agentTile.ts`:** one new branch — `if (tile.state === "running" && tile.memberColor !== undefined) article.style.setProperty(...)`. Non-running tiles untouched.
- **`collapsedPersonaTile.ts:renderCompactInstanceRow`:** same branch mirrored. `computeIsUniform` already excludes `state === "running"` from compact rows so this branch is effectively unreachable today; forward-compat guard.
- **`headerChip.ts`:** generalized with `kind` discriminator + `CHIP_COPY` lookup. The pre-existing `SetConfigMessage` cast (`msg as unknown as WebviewMessage`) is no longer needed because the message type now matches the union literally — cast removed, replaced with a typed literal. M5 callers continue to work (default `kind="finished"`).
- **`render.ts`:** new `readIdleChipState` helper (parallels `readHeaderChipState`); new idle-chip mount after the finished chip; idle-state threaded into `renderSessionBlock` props.
- **`sessionBlock.ts` / `teamCard.ts`:** two new optional props (`hideIdle`, `hiddenIdleCount`) threaded down. Defaults preserve pre-PR behavior.
- **`teamCard.ts`:** new `renderTeamIdleRow` private function; widening cast for `postMessage` (PostMessageFn was narrowly-typed for OpenTranscriptMessage; cast through `unknown` to the union — same pattern as the pre-merge M5 chip used).
- **`main.ts:hydrateState`:** one new passthrough branch for `hiddenIdleCount`.
- **`dashboard.css`:** updated `.state-dot[data-state="running"]` rule to consume the new override (with fallback to existing semantic token); added new `.ct-team-idle-row` block.
- **`fixtures.ts`:** Felix + Nora gain `memberColor` in `FIXTURE_TILES` so browser-dev mode visually demonstrates the spec §2.2 "two distinct running dots" affordance. Color values match spec §2.5 examples (`#5d8aa8` slate, `#9caf88` sage). Doesn't affect VS Code production rendering (FIXTURE_STATE isn't shipped — only used as the dev-mode default + test fixture).

### Failure-mode probes

- **Empty roster:** unchanged. Both chips still render in the empty branch; no agent tiles render, no per-team rows render.
- **Filter on, count 0:** chip shows "Show idle — none yet"; per-team row suppressed (rendered only when count > 0).
- **Filter on, count > 0, no idle tiles in this team:** the per-team row would still render with the global count — V1 limitation flagged above. Multi-team rosters surface this; single-team rosters don't.
- **Invalid memberColor on the wire:** Felix's Pt 1 loader normalization guarantees the value is either 6-digit lowercase hex with `#` or undefined; invalid values are dropped upstream with a warning chip. The webview's defensive contract: `undefined → no paint`; valid hex → inline custom property. No webview-side validation needed.
- **State transitions (running → idle → running):** the inline custom property is set per-render. When a tile transitions running → idle, the next render produces an article without the inline property; cascade falls back to the semantic `--ct-color-state-idle` for the idle dot (which the rule reads directly, not via the override). When it transitions back idle → running, the override re-applies. The M4-01 transition flash continues unchanged.
- **Reduced motion:** unchanged. The `@media (prefers-reduced-motion: reduce)` block already elides the pulse animation; the dot still paints in the member color, just statically.

### Theme-switch probe

Deferred to sponsor post-merge confirm per sub-agent GUI gap reframe. Theme variables used throughout — `.ct-team-idle-row` consumes `--ct-color-fg-muted` / `--ct-color-fg` / `--ct-color-bg-hover` / `--ct-color-focus`; the chip variant reuses every M5 chip token unchanged. No hardcoded hex anywhere except the four semantic state colors (`--ct-color-state-*`) and the spec §2.5 fixture-only member colors.

### State-coverage

Deferred to sponsor post-merge confirm. Coverage in the jsdom test suite:
- **Running tiles** with memberColor — paints `--ct-color-running-dot`.
- **Idle tiles** with memberColor — does NOT paint the override; the M4-01 `--ct-color-state-idle` token still resolves.
- **Finished + Error tiles** with memberColor — same suppression.
- **Empty state** — chip pair still renders.
- **Hidden-idle scenario** — chip + per-team row + 0 tiles rendered for the team's all-idle members.

## Composition with prior specs

- **M5 hide-finished:** independent — both filters can be on; both chips render side-by-side. Disjoint states + Felix's deterministic-order filter chain on host side.
- **M3-10 wrapper:** `CollapsedPersonaGroup` instances are walked by Felix's host-side filter (per `hideIdleFilter.ts`) — partial drops rebuild the wrapper; N=1 unwraps; N=0 drops. Webview renders the post-filter wrapper unchanged.
- **86c9zmqa8 uniform-cluster polish:** `computeIsUniform` runs webview-side after host-side filters. Once `idle` tiles are filtered, a previously-uniform-idle cluster either disappears entirely OR becomes a non-uniform cluster; both reduce to existing logic. The compact row renderer also got the memberColor branch (forward-compat — `computeIsUniform` excludes running today).
- **M4-01 §2.4 pulse animation:** opacity-only modulation; inherits whatever the dot's `background-color` resolves to. No animation code changed.

## Reviewer

Felix per cross-pair routing (Felix ↔ Maya). Felix's Pt 1 lives on `main` at `f7ffc1f`; this PR's vocabulary contract is sourced from spec §7 verbatim.

## Doc updates

None this PR — the Pt 1 PR already updated `roster-matching.md` for the color schema, and `vscode-extension-conventions.md` already documents the JSON-serialization constraint that all the new fields obey. Spec §2.5 #2 (halo guardrail removal per AC5 Option b) lives with Iris.
