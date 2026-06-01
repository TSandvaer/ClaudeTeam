## Self-Test Report — 86ca23utq whole-card-light pivot

**Scope:** CSS-only (`src/webview/styles/dashboard.css`) + test rename. No markup, no host/data change.

**GUI-gap note (per testing-strategy.md § "Sub-agent GUI gap"):** I run headless — no `Developer: Reload Window`, no screenshots. Visual fidelity (the look/feel of the light card, theme contrast in a real window) is **sponsor-gated post-merge** per the reframe. What I CAN and DID verify headlessly is below. No manual-reload claim is made.

### AC walkthrough (observed via source + tests, not a live reload)
- **Light bg on the agent card container (the blue-selected-border element):** ✅ `.agent-tile { background-color: var(--ct-card-bg) }` at `dashboard.css:312`; `.collapsed-persona-header` (multi-agent cluster card root) at `:647`. Asserted by `cardBg.test.ts` "paints the light card-bg + a delineating border".
- **Token reused/repurposed, hex kept in a token:** ✅ `--ct-card-bg: #ECEFF1` in `:root` (single declaration); tweakable live.
- **All card text + chrome flipped dark-on-light:** ✅ name (`.agent-display`), role (`.agent-role`), activity/status line (`.agent-activity`), model (`.agent-model`), `(N agents)` (`.persona-count-hint`), `×N` badge (`.persona-count-badge`+chevron), status dot fallback (`.state-dot`), finished-check stroke, collapsed-persona name/chevron/status-hint. Asserted by `cardBg.test.ts` "card text flipped dark-on-light".
- **Blue SELECTED border kept as-is:** ✅ `.agent-tile:hover, :focus-visible { outline: 1px solid var(--ct-color-focus) }` unchanged. Asserted by `cardBg.test.ts` "keeps the blue SELECTED/focus border".
- **Sprite stage folded in:** ✅ `.sprite-box` no longer paints a background. Asserted by `cardBg.test.ts` "redundant sprite stage folded in".
- **Theme safety (both themes):** ✅ card bg + flipped text are hardcoded hex (not `var(--vscode-*)`), so identical in dark + light themes; `--ct-card-hairline` border + blue focus outline delineate the card in a light theme. (Final theme-contrast look is the sponsor's eyeball.)

### Side-effect inventory
- `.agent-tile` is the shared chrome for: single tiles, multi-agent persona tiles (`data-count`), and compact instance rows (`.agent-tile--compact`) — all now light. Intentional (the brief targets "the agent container"); flagged as open question #3.
- `.persona-instance-row` (the OTHER instance-row variant in `multiAgentPersonaTile.ts`) is NOT an `.agent-tile` and stays on the dark session-block with theme-native text — unchanged.
- Idle/available row-opacity dimming (`:489`/`:505`) unchanged — dims text rows, character/card stay full opacity.

### Theme-switch probe
- Dark theme: **sponsor post-merge** (headless — no screenshot).
- Light theme: **sponsor post-merge** (headless — no screenshot). Structural cue verified: hairline + focus border present for delineation.

### State-coverage (structural — semantic dot hex verified, visual deferred)
- running / idle / finished / error / available dot hex all unchanged (semantic), each ≥3:1 on `#ECEFF1` per spec §5; finished-check stroke now dark (`--ct-card-fg`) so it reads on the grey dot in both themes. Pixel-level appearance: sponsor post-merge.
- empty roster: unaffected (no `.agent-tile` rendered).

### Build / test evidence
- `npm run build` — green (host CJS + webview IIFE + CSS emitted).
- `npm run typecheck` — clean.
- `npx vitest run tests/unit` — 1130 passed, 2 skipped.
- Non-vacuity mutation check: reverting `.agent-tile` bg OR un-flipping card text each fails a `cardBg.test.ts` describe; restored after.
