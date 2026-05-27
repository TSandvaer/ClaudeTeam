## Summary

Design spec for the V1-reframe sponsor proposed 2026-05-27 — shift the dashboard's primary purpose from "audit which rostered members exist" to "show who's actively working right now." Two coupled mechanisms:

1. **Member-defined color on the running dot** — each rostered member's running-state dot renders in a roster-supplied hex color, distinguishing personas at a glance. Idle / finished / error states retain M4-01 semantic colors. Schema (`Member.color?: string`) already exists on `main` (`src/shared/types.ts:111`); spec adds the wire-shape glue (`AgentTile.memberColor?: string`), the webview paint mechanism (per-tile `--ct-color-running-dot` CSS custom property with semantic-token fallback), and the validation + invalid-color handling.
2. **Hide-idle-by-default** — clones M5's `hideFinishedAgents` pattern at structural level (host-side filter + count field + config-mirror + chip). New scalar `claudeteam.hideIdleAgents` defaults `true`. Composes cleanly with M5 (hide-finished) and 86c9zmqa8 (uniform-cluster collapse).

The spec also recommends a **transition strategy (§4)**: per-feature settings scalars with the new behavior as default (Option C) — no master `runningFocusedDashboard` flag. This matches how M5 and 86c9zmqa8 already shipped and avoids master-flag rot.

## Key design decisions

- **Member color is running-only.** Idle / finished / error keep semantic colors. Personalization is "identification while working," not always-on branding.
- **`hideIdleAgents` defaults `true`** (different from M5's `false`). Sponsor's verbatim was "hide idle by default" — the running-focused dashboard's first-install experience IS the running-focused experience.
- **Per-team "N idle hidden — show" row + global chip both render** (Option A+B in §3.4). Per-team rows are passive informational hints firing the same `ui:set-config` message; global chip is canonical.
- **Wire-shape additions are append-only.** One new field on `AgentTile` (`memberColor`), one new optional count + one new `config` entry on `AgentTree`. JSON-safe, back-compat — pre-86c9zmyef wire emitters omit them; webview defaults to current behavior.
- **No new design tokens.** Reuses M4-01 §1 token set; only addition is a per-tile inline CSS custom property (`--ct-color-running-dot`) that falls back to the existing `--ct-color-state-running`.
- **Invalid-color handling: drop + warn.** A bad hex value emits a `RosterLoadResult` warning (surfaces via existing M3-04 chip); the dashboard still renders with semantic colors. No crash; no auto-correction.

## Open questions for sponsor (§8)

Four small calls awaiting sponsor confirmation before downstream impl dispatch:

- **Q1 — Defaults.** `hideIdleAgents=true` (recommended), `hideFinishedAgents` stays at M5's `false`, member color = Option A (no auto-generate).
- **Q2 — Per-team "N idle" hint surface.** Recommend A+B (per-team rows + global chip).
- **Q3 — Color default (Option A vs B).** Recommend Option A (curatorial, no auto-generate).
- **Q4 — 3-digit hex shorthand acceptance.** Recommend accept-and-normalize (`#5da` → `#55ddaa`).

## Composition with prior specs

Spec §9 enumerates: clean composition with M5 hide-finished (independent filters), M3-10 wrapper, 86c9zmqa8 uniform clusters, M4-01 polish (semantic tokens + pulse animation unaffected), roster-matching docs.

## Sourcing discipline

Every concrete value cited in the spec is sourced from a live `main` Read or grep, verified 2026-05-27. The audit-trail block (§10) enumerates every source file + line range. No pattern extrapolation, no fabricated identifiers.

## Spec file

`team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md`

## Out of scope (spec also enumerates in §6)

- Any TypeScript impl (Maya's + Felix's follow-on tickets).
- Roster schema enforcement code (loader extension is a downstream Felix ticket).
- New webview message types beyond extending `SetConfigMessage.payload.key` union.
- CLI / non-dashboard surfaces (this spec is dashboard-only).
- Multi-color per member; per-state color; in-dashboard color picker; auto-contrast correction.

## Test plan (for reviewer + sponsor)

- [ ] Spec-only — no code changes; CI's typecheck/lint should pass trivially.
- [ ] Felix (reviewer) sanity-checks §2.2 wire-shape addition is implementable without reducer churn (the new `AgentTile.memberColor` is stamped in `buildAgentTree` from the matched `Member.color`).
- [ ] Felix confirms §3.3 filter's composition with M5's existing `applyHideFinishedFilter` is sequence-clean (no double-counting; both counts independently populated on the wire).
- [ ] Sponsor reviews §4 transition strategy + §8 Q1–Q4 and confirms recommendations.
- [ ] Downstream impl tickets get filed by orchestrator after sponsor sign-off.
