## Summary

Design spec for ClickUp [`86c9ytyq7`](https://app.clickup.com/t/86c9ytyq7) — hide-finished-agents control for the dashboard. Adds `team/iris-ux/m5-hide-finished-spec.md`.

**Chosen shape:** **Hybrid Shape 1 + Shape 2 affordance.** A `claudeteam.hideFinishedAgents: boolean` config scalar (Shape 1) is the source of truth, paired with an in-dashboard **header chip** (Shape 2 affordance — but still opt-in, default OFF) so the sponsor can flip the filter without opening Settings. Filter scope is **`finished` state only** — `idle` filtering is deferred until Defect 6 (idle misclassification) closes; `error` is never filtered.

**Why not Shape 3 (auto-expire):** auto-expire requires a per-tile finished-at timestamp that would couple this spec to Felix's in-flight Defect 6a (`86c9yxv94`) elapsed-time fix. Spec §1.2 + §5.3 spell out the non-interaction.

## File-surface decomposition (parallel-safe per global vocabulary rule)

| Lane | Owner | Touches | Exclusively |
|---|---|---|---|
| **M5-EH** — host filter + config | Felix | `package.json` (config + command), `src/shared/types.ts` (+`hiddenFinishedCount` field), `src/shared/messages.ts` (+`SetConfigMessage`), `src/extension/state/hideFinishedFilter.ts` (NEW), `src/extension/messageBus.ts`, host config handler in `main.ts` | Yes |
| **M5-WV** — chip + visuals | Maya | `src/webview/components/headerChip.ts` (NEW), `src/webview/render.ts` (mount), `src/webview/styles/dashboard.css` (`.ct-header-chip` block + reduced-motion extension) | Yes |

The only shared file is `src/shared/messages.ts` — Felix declares the type, Maya imports it. Append-only addition; rebase trivial.

Spec §7 enumerates every identifier (config key, command id, function name, TS type names, CSS class names, data-attribute names, message-type discriminator, label literals) so both implementers consume the same vocabulary verbatim.

## Open questions for Sponsor (spec §8)

1. **Q1 — Idle extension follow-up?** Sponsor's verbatim was *"idle agents"* but Defect 6 blocks reliable idle classification. Recommend: file follow-up `hideIdleAgents` ticket after Defect 6 closes; M5 ships finished-only.
2. **Q2 — Default false or true?** Recommend: ship `false` for install safety, revisit after dogfood.
3. **Q3 — Config target Global or Workspace?** Recommend: Global. One toggle, applies everywhere.

All three have default answers; sponsor confirms or overrides.

## Test plan

- [ ] Spec reviewed by sponsor (Q1/Q2/Q3 answered).
- [ ] Spec reviewed by Maya for visual feasibility (chip CSS uses only M4-01 §1 tokens — no new tokens introduced).
- [ ] After approval: dispatch Felix (M5-EH) + Maya (M5-WV) in parallel using the §9.1 / §9.2 paste blocks.
- [ ] Cross-link to Defect 6a (`86c9yxv94`) — non-interaction confirmed per spec §5.3.

## ClickUp lifecycle

- `86c9ytyq7` queued `in progress → in review` via `team/log/clickup-pending.md` ENTRY-2026-05-26T01:00:00Z.

## Peer review

Maya (visual) per Iris-PRs → Maya routing.

## Files changed

- `team/iris-ux/m5-hide-finished-spec.md` (NEW) — full spec.
- `team/iris-ux/m5-hide-finished-pr-body.md` (NEW) — this body.
- `team/log/clickup-pending.md` — status-flip entry.
