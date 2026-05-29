## Summary

Cosmetic NITs follow-up for PR #47 (M3-10 webview persona-tile collapse). XS, webview-side only. Pure cosmetic + defensive — no behavioral change to the happy path, no state-shape change, no host touch.

**Files changed:**
- `src/webview/components/collapsedPersonaTile.ts` — JSDoc drift fix + defensive count read
- `tests/unit/webview/collapsedPersonaTile.test.ts` — +1 defensive test (22 cases total, was 21)

## NITs absorbed

### NIT 1 — JSDoc drift (`data-team-id?`)

**Felix's call (PR #47 review):** the JSDoc DOM-shape block documented `data-team-id?` on the `<section>` but no code path sets `section.dataset.teamId`.

**Fix:** dropped the `data-team-id?` line from the JSDoc DOM-shape comment. Added a short note explaining where the teamId would be threaded (`CollapsedPersonaTileProps` → `section.dataset.teamId`) if a future feature needs it. Threading the field through props was the alternative Felix offered, but it expands scope (props change, `teamCard.ts` call-site change, test updates) and the wrapper's DOM does not currently need the teamId for any rendering decision — option (a) is the minimal cosmetic fix the brief asks for.

### NIT 2 — `count` vs `instances.length` field redundancy

**Felix's call:** `CollapsedPersonaGroup.count` is documented as "equals `instances.length`" but is a separate field. A host-side bug where `count !== instances.length` would silently render a mismatched header.

**Disposition per brief:** state-shape changes to `CollapsedPersonaGroup` are explicitly OOS (vocabulary already settled; field removal is the post-Felix/Maya unification follow-up). The in-scope defense is **webview-side**: read from `group.instances.length` at every render site so a host invariant violation surfaces as one wrong `count` field on the wire, not as a header that disagrees with the expanded list (two places, harder to diagnose).

**Fix:** introduced `const instanceCount = group.instances.length;` once at the top of `renderCollapsedPersonaTile` and used it at all three render sites (header text, aria-label collapsed, aria-label expanded). The `count` field stays in the type for the wire format and for host-side consumers that haven't been refactored yet.

Added a "Defensive count read" section to the file's top JSDoc block explaining the rationale, so a future reader (or a Felix/Maya unification PR) understands why `group.count` is read in zero places in the webview.

## Test coverage

**New (1):** `renders header text from instances.length, NOT from group.count (defensive)` — builds a tampered `CollapsedPersonaGroup` with `count: 99` and 3 actual instances. Asserts:
- Header text: `Felix ×3` (not `Felix ×99`).
- Aria-label collapsed: `Felix grouped — 3 instances, collapsed`.
- After expand: 3 `.agent-tile` children (not 99).
- Aria-label expanded: `Felix grouped — 3 instances, expanded`.

**Pre-existing (21) still green** — header-text test (`Felix ×4`), aria-expanded toggle, lazy populate, expand/collapse stability, drill-in dispatch, wire round-trip, finished-tracker integration. All unchanged in behavior because the happy-path host-emitted `count === instances.length` keeps `instanceCount` equal to the old `group.count` read.

## Verification

- TypeScript strict compile: clean.
- ESLint: clean.
- Unit tests: 355 / 2 skipped (was 354, +1 new defensive; 0 regressions).
- Integration tests: 68 (unchanged).
- esbuild: produces the same artifact set (`dist/extension/main.cjs`, `dist/webview/main.js`, `dist/webview/dashboard.css`, `dist/cli/agentTree.js`) — no CSP-breaking change, no `package.json` touch.

## Self-Test Report

### AC walkthrough

| AC | Status | Evidence |
|----|--------|----------|
| NIT 1 — JSDoc drift removed | verified | `src/webview/components/collapsedPersonaTile.ts:9` no longer mentions `data-team-id?`; new "if a future feature needs it" note at lines 20-24. |
| NIT 2 — defensive count read | verified | three render sites at `collapsedPersonaTile.ts:105`, `:116`, `:157` now read `instanceCount` (from `group.instances.length`); zero references to `group.count` in render code (only in JSDoc explaining the defense). |
| Webview-render parity (no behavior regression on happy path) | verified | all 21 pre-existing test cases still pass — they construct groups with `count === instances.length` so the rendered text is identical to the pre-PR text. |
| Defensive behavior under host invariant violation | verified | new test case at `tests/unit/webview/collapsedPersonaTile.test.ts:243-285` locks `Felix ×3` rendering for a `count: 99` / 3-instance group. |

### Side-effect inventory

- `dist/webview/main.js` — recompiled with `instanceCount` constant; identical text content rendered on the happy path; byte-level diff likely from the new local binding only.
- JSDoc-only change to the file header block — no runtime effect.

### Theme-switch probe

**Deferred to sponsor post-merge** per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround". Both author (Maya, sub-agent) and reviewer (Felix, sub-agent) are headless.

The change touches text content only — `${group.personaName} ×${N}` substitution where `N` is now `instances.length` instead of `count`. No CSS, no `--vscode-*` variable usage, no DOM shape change (other than the JSDoc-doc'd absence of an unset `data-team-id`). Theme behavior is identical to the pre-PR rendering on the happy path.

### State-coverage

The wrapper is purely a grouping concern; per-instance state coverage flows through the existing `renderAgentTile` path (unchanged). The new defensive test exercises the wrapper render under a tampered wire shape (host bug simulation) — the rest of the wrapper × state matrix is covered by the existing `finishedTracker integration` and `AC2 collapsed render` cases.

### Data-plane smoke (load-bearing per sub-agent GUI gap reframe)

This PR is webview-render-only; the data plane is exercised end-to-end via the pre-existing unit-test layer at the host↔webview boundary:

- **Wire round-trip** (`tests/unit/webview/collapsedPersonaTile.test.ts` § `CollapsedPersonaGroup wire-shape round-trip`) — still green. The defensive read does not affect what serializes / hydrates over the wire (the `count` field stays in the type).
- **renderFull integration** (same file, `renderFull — wrapper integration`) — still green.
- **finishedTracker integration** (same file) — still green.

### Failure-mode probes

- **Host emits `count !== instances.length`** — webview renders from `instances.length`. Locked by new test.
- **Host emits `instances: []`** — header renders `Felix ×0`; aria-label says `Felix grouped — 0 instances, collapsed`. Host invariant forbids this (only emits wrapper when N>1), so no positive test, but the defensive read keeps the failure mode bounded.
- **Type-guard `kind` discriminator** — unchanged; existing `isCollapsedPersonaGroup` tests still green.

### Sub-agent GUI gap acknowledgment

Per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround": interactive-screenshot ACs (Reload Window, theme toggle, hover/focus visual) are deferred to sponsor post-merge. The change is text-content-only on the happy path — regression risk is structurally low.

**Sponsor post-merge confirm-no-regression** — at first convenient opportunity, open the dashboard with a session that has ≥2 same-persona dispatches and verify the `<persona> ×<count>` row still renders identically to the pre-PR shape. No new visual surface.

## Reviewer: Felix

Felix raised the original NITs on PR #47 and the dispatch brief names Felix as peer. Felix should verify (a) the JSDoc drift fix matches what was requested, (b) the defensive-read approach is acceptable as the in-scope NIT 2 disposition (vs the field removal Felix deferred to the unification PR), (c) no host-side consumer is broken by the webview ignoring `count`.

Closes: ClickUp 86c9yee3g
