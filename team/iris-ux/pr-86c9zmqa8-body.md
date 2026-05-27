## Summary

Design spec for the polish pass on `CollapsedPersonaGroup` (M3-10) addressing sponsor verbatim 2026-05-27: *"why do i need to see al these repeadet names under each name? what is the value?"* — for uniform clusters (all idle/finished, same role), the per-instance expand surfaces no marginal information.

Four candidate shapes enumerated (Option A — auto-collapse, B — compact rows, C — header-only, D — text link), with a side-by-side comparison matrix and a recommended default (Option A + B + A.1 sub-variant).

- Ticket: [ClickUp 86c9zmqa8](https://app.clickup.com/t/86c9zmqa8)
- Spec file: `team/iris-ux/86c9zmqa8-uniform-cluster-spec.md`

## Design decisions

1. **Recommend Option A + B combined.** A (auto-collapse uniform clusters) directly answers the sponsor's verbatim question; B (compact rows when expanded) mitigates A's "click doesn't stick" regression. Both reversible per-option.
2. **"Uniform cluster" defined as:** N≥2 instances + all same state + state is `idle` or `finished` (NOT `running` or `error`) + all same role. Spec §1.2 explains each gate.
3. **`running` clusters excluded from auto-collapse** — activity-line updates per poll give real per-instance differentiation; drill-in IS valuable there.
4. **`error` clusters excluded from auto-collapse** — errors are load-bearing alerts; auto-hiding them is the wrong call.
5. **No wire-shape change.** Uniformity is computed webview-side from existing `AgentTile.state` + `AgentTile.role`. Felix's host code is untouched.
6. **Option C (header-only) and Option D (text link) documented but NOT recommended.** C has affordance-flicker risk on cluster-state changes; D doesn't compose as cleanly as A+B.
7. **Vocabulary contract in §8** pre-names every identifier the downstream Maya impl will reference: `claudeteam.autoCollapseUniformClusters` config scalar (default `true`), `computeIsUniform` pure function, `agent-tile--compact` CSS modifier, `collapsed-persona-status-hint` class, status-hint labels `"all idle"` / `"all finished"`.

## Open questions for sponsor (§9)

Three small calls reserved for sponsor confirmation before downstream Maya impl dispatch:

- **Q1** — Status-hint label wording (recommend `"all idle"` / `"all finished"`).
- **Q2** — Default for `claudeteam.autoCollapseUniformClusters` (recommend `true`).
- **Q3** — Include Option A.1 (status-hint row in collapsed header) in first impl PR, or hold for follow-up (recommend include — purely additive, low cost).

## Reviewer

Orch-direct merge per Iris-design-only convention after sponsor approves direction. Sponsor sign-off is on the recommended option + Q1/Q2/Q3 answers; downstream impl ticket is filed after that.

## Files changed

- `team/iris-ux/86c9zmqa8-uniform-cluster-spec.md` (NEW) — the spec.
- `team/log/clickup-pending.md` — ENTRY for the `to do → in progress` flip.
- `team/iris-ux/pr-86c9zmqa8-body.md` (this body) — PR body source.

## Composability notes

- **M5 hide-finished filter** (§11.1) — wrapper survivors post-filter still pass through `computeIsUniform`; no interaction conflict.
- **Defect 6b group state label** (§11.2) — `computeGroupState` and `computeIsUniform` coexist; the wrapper header's dot still uses `computeGroupState`.
- **Obs 10 expansion tracker** (§11.3) — when uniformity gate fires, tracker read is bypassed but `setExpanded` still writes (diagnostic preservation). No tracker contract change.
