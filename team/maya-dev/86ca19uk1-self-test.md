## Self-Test Report

### AC walkthrough

- **AC1 — baseline visual per spec §1/§2.2-2.3:** ✅ verified. New
  `.state-dot[data-state="available"]` paints `--ct-color-state-idle-quiet`
  (#90a4ae) — static, no pulse/check. Rows 2-4 drop to `--ct-opacity-available`
  (0.6) via `.agent-tile[data-state="available"] .tile-row--{role,activity,model}`.
  Confirmed present in the built bundle: `grep ct-color-state-idle-quiet
  dist/webview/dashboard.css` → 2 hits (decl + usage); `available]
  .tile-row--{role,activity,model}` selectors emitted. Screenshot AC deferred
  to sponsor post-merge (sub-agent GUI gap — both author + reviewer headless).
- **AC2 — consume E-01's exact literal `"available"`:** ✅ verified.
  `src/shared/types.ts:290` defines the `AgentState` `"available"` literal;
  reducer seeds `activity: "available"`. The webview renders `tile.activity`
  verbatim and does NOT invent a new state. Component test
  `availableTile.test.ts` asserts `.agent-activity` textContent === "available"
  and that the row is NOT suppressed by the `"tool:?"` branch.
- **AC3 — hide filters must NOT hide baseline:** ✅ verified.
  `availableFilterInteraction.test.ts` (5 tests): hide-idle keeps available
  (count unaffected), hide-finished keeps available, both-composed (the §1.1
  sponsor scenario) leaves running + 3× available intact; a never-run-only team
  card survives without going empty. Predicates confirmed exact-match:
  `hideIdleFilter.ts:104,129` (`=== "idle"`), `hideFinishedFilter.ts:96,121`
  (`=== "finished"`).
- **AC4 — theme-aware, no hex, tests:** ✅ verified. Only `--ct-`/`--vscode-`
  tokens used; the single hardcoded hex (`#90a4ae`) is a SEMANTIC state color
  (theme-stable by design, same exemption as the 4 existing `--ct-color-state-*`
  hexes). `npm run typecheck` clean; `npm run lint` clean. 12 new tests.
- **AC5 — composes with E-04 sprites:** ✅ verified. `availableTile.test.ts`:
  available + sprite-bound member (`maya` → ClaudeTeam-M01-Dev) renders the
  sprite box (`.sprite-box`/`<img>`) AND keeps `data-state="available"` (skin
  composes on top); available + sprite-less member renders text-only baseline
  (no `<img>`, no `data-has-sprite`) — no regression to E-04's fallback.

### Data-plane smoke (AC(a) — load-bearing, sub-agent GUI gap)

The `available` baseline state flows through the **production pipeline**
end-to-end, verified via the reducer + filter + tile test set against the
real code paths:

```
npx vitest run reducer.test.ts hideIdleFilter.test.ts hideFinishedFilter.test.ts \
  availableFilterInteraction.test.ts webview/availableTile.test.ts webview/spriteTile.test.ts
→ 6 files / 141 tests passed
```

- `reducer.test.ts` (E-01, merged) confirms the reducer seeds `available`
  tiles with `state: "available"` + `activity: "available"` for un-detected
  roster members (existing coverage, lines 197-220, 565-571, 680-681).
- The new tests confirm those tiles (a) survive both hide-filters and (b)
  render the never-run skin + compose with sprites.

Full suite: **852 passed / 2 skipped (854)**, 43 files, 2.72s.
Build: all 5 bundles emitted incl. `dist/webview/dashboard.css`. Host CJS
format unchanged (webview-only change — no host bundle touched).

### Side-effect inventory

- `dashboard.css` `:root` gained 2 tokens — no existing selector altered; the
  two new selectors are additive (new `data-state` value, previously unstyled).
- No `agentTile.ts` change → no change to any other state's rendering.
- No host/wire/reducer change → CLI presenter + diagnostic panel unaffected.

### Theme-switch probe

- Dark theme: deferred to sponsor post-merge (sub-agent GUI gap). The dot hex
  is theme-stable by design; rows inherit `--ct-color-fg` so they track theme.
- Light theme: deferred to sponsor post-merge. `#90a4ae` (BG-300, mid-
  saturation) passes contrast on both editor backgrounds per the
  roster-matching.md theme-contrast note.

### State-coverage

- **Available (never-run):** covered by `availableTile.test.ts` (dot, rows,
  activity, aria-label, sprite composition). Visual screenshot deferred to
  sponsor post-merge.
- **Idle / Finished / Running / Error:** untouched (no `agentTile.ts` or CSS
  change to those selectors); existing `dashboardTile.test.ts` (85) still green.
- **Empty roster:** untouched (no roster-load path change).

### Deferred-to-sponsor (post-merge confirm-no-regression)

Per testing-strategy.md § "Sub-agent GUI gap": this PR changes webview CSS, so
the interactive manual-reload + theme-toggle screenshots bind at sponsor
post-merge confirm. The data-plane smoke above is the load-bearing pre-merge
gate and is present + cited. Suggested sponsor check: open the dashboard with a
roster member that has not dispatched this session → confirm the quiet
blue-grey dot + dim `available` row read distinctly from idle (amber) and
finished (grey+check), in both dark and light themes.
