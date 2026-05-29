# M5-WV — hide-finished header chip + render mount

ClickUp: [`86c9ytyq7`](https://app.clickup.com/t/86c9ytyq7)
Spec: `team/iris-ux/m5-hide-finished-spec.md` §4 (chip), §5 (count surface), §6 (visual), §7 (vocabulary contract).
Sibling: Felix M5-EH (host filter + config + types — parallel dispatch).

## Scope (per spec §0 decomposition table)

Maya-owned surfaces (this PR):

| Surface | File | Status |
|---|---|---|
| Header chip component | `src/webview/components/headerChip.ts` (NEW) | shipped |
| Chip mount in render | `src/webview/render.ts` (position 3, both branches) | shipped |
| Chip CSS block | `src/webview/styles/dashboard.css` (`.ct-header-chip` + reduced-motion) | shipped |
| Component tests | `tests/unit/webview/headerChip.test.ts` (NEW, 21 tests) | shipped |
| ClickUp pending entry | `team/log/clickup-pending.md` (ENTRY for `86c9ytyq7 -> in review`) | shipped |

## What this looks like

The new `.ct-header-chip` is an `<aside>` mounted at position 3 of the
dashboard mount (above session blocks, below both error chips) — always
rendered so the toggle is discoverable even when the dashboard is empty
(spec §4.6).

Visual treatment (spec §6.1):

* OFF baseline → muted border, muted text, `"Hide finished"` label.
* ON, count 0 → fg border + bg-hover inset (telegraphs "pressed"),
  `"Hide finished — none yet"` label with `opacity: 0.7`.
* ON, count N → same chrome, `"Hide finished — N hidden"` label.
* Hover lifts text to fg + adds bg-hover. Focus shows the `--ct-color-focus`
  outline.

All colors flow through M4-01 `--ct-*` tokens (which flow through
`--vscode-*`). Theme-switch is automatic — zero new tokens introduced.

Interaction (spec §4.3):

* Native `<button>` + ARIA `aria-pressed` for two-state semantics.
* Click + Enter + Space all fire the same handler (native button
  affordance — no custom keydown listener needed).
* Optimistic UI flips `data-hide-finished` + `aria-pressed` + `title`
  immediately on click. Host roundtrip re-confirms via the next
  `state:full`.

## Vocabulary contract (spec §7) — no Felix-surface touches

The dispatch brief named `src/shared/messages.ts`, `src/shared/types.ts`,
`package.json`, and `src/extension/**` as Felix's M5-EH ownership.
**Verified clean via `git diff --stat origin/main`:**

```
 src/webview/components/headerChip.ts  | 175 +++++++++++++++
 src/webview/render.ts                 |  47 ++++
 src/webview/styles/dashboard.css      |  70 ++++++
 tests/unit/webview/headerChip.test.ts | 392 ++++++++++++++++++++++++++++++++++
 team/log/clickup-pending.md           |   1 +
 5 files changed, 685 insertions(+)
```

Zero touches to Felix-owned files.

## Parallel-interlock note

This branch references the `SetConfigMessage` member of `WebviewMessage`
(spec §7.1 vocabulary contract) which Felix's M5-EH PR contributes to
`src/shared/messages.ts`. Until that PR lands, the union does not
include the `"ui:set-config"` discriminator — so the post-message
construction goes through `as unknown as WebviewMessage`. Once Felix's
PR lands, the `unknown` cast can be tightened to a direct typed literal
(filed as a NIT-class follow-up, not a blocker).

Per spec §10.1: **merge M5-EH first** if both PRs review-ready
simultaneously. Either order is mechanically clean (append-only diffs
on the shared file).

## Tests

`tests/unit/webview/headerChip.test.ts` (21 jsdom tests) covers:

* `labelTextForState` pure helper — every row of the spec §4.2 state
  matrix (off/0, off/N-invalid-renders-off, on/0, on/1, on/2, on/14).
* `renderHeaderChip` DOM shape — `<aside class="ct-header-chip"
  data-hide-finished data-hidden-count>` + inner `<button
  class="ct-header-chip-toggle" aria-pressed type="button" title>` +
  `<span class="ct-header-chip-label">` + hidden
  `<span class="ct-header-chip-count">`.
* Click posts `{ type: "ui:set-config", payload: { key:
  "hideFinishedAgents", value: !current } }` per spec §7.3.
* Optimistic UI flips data attrs + aria-pressed + title on click.
* `renderFull` mount order — chip BEFORE session blocks (with-sessions
  branch) AND BEFORE empty-state (empty branch) AND AFTER both error
  chips (spec §4.1).
* Defensive reads — `state.config` / `state.hiddenFinishedCount` absent
  → chip boots OFF with count=0 (spec §3.5 contract).
* Forward-compat — `state.config.hideFinishedAgents=true` + count=3
  boots chip ON with the correct label.
* State persistence across re-renders — chip reflects new state on
  subsequent `renderFull` calls.

## Self-Test Report

### CI gates (orchestrator + Sage will verify on the PR)

* **typecheck** — `npm run typecheck` clean.
* **lint** — `npm run lint` clean.
* **build** — `npm run build` produces host + webview + CLI bundles
  cleanly (webview bundle 35.6kb; CSS 70 lines added).
* **unit tests** — `npm run test:unit` reports **429 passed | 2 skipped
  (22 test files)** including the 21 new headerChip tests. Sibling
  tests untouched.

### AC walkthrough (per spec §9.2 implementation checklist)

* `headerChip.ts` (NEW) exports `renderHeaderChip(props: HeaderChipProps):
  HTMLElement` — DONE.
* Props shape `{ hideFinished, hiddenCount, postMessage }` — DONE per
  spec §7.2.
* DOM shape per spec §4.2 — DONE.
* Label templates per spec §5.2 / §7.3 with em-dash U+2014 — DONE.
* Click + Enter + Space fire `ui:set-config` — DONE (native `<button>`).
* Optimistic UI flips on click — DONE.
* `render.ts` mounts chip at position 3 in BOTH branches per spec §4.6
  — DONE.
* `state.config?.hideFinishedAgents ?? false` for initial state — DONE
  via `readHeaderChipState` defensive read.
* `state.hiddenFinishedCount ?? 0` for count — DONE.
* CSS block per spec §6.1 — DONE.
* `prefers-reduced-motion` extended per spec §6.2 — DONE.

### Manual reload / interactive screenshots — deferred per sub-agent GUI gap

Per `.claude/docs/testing-strategy.md` "Sub-agent GUI gap — webview-smoke
workaround" (M2-06 originating pattern), this PR's webview-smoke gate is
satisfied by AC(a) data-plane smoke; AC(b-d) interactive screenshots
(reload, theme-switch, chip click visual confirm) defer to sponsor
post-merge. AC(a) for this surface is the round-trip:

* Chip click in webview → `ui:set-config` posted to host → Felix's M5-EH
  handler `workspace.getConfiguration().update(...)` → host re-emits
  `state:full` with `config.hideFinishedAgents=true` + new
  `hiddenFinishedCount` → webview re-renders chip with updated label.

AC(a) is verifiable via the unit-test suite in this PR (21 tests cover
the chip's side of the round-trip; Felix's M5-EH PR covers the host
side). End-to-end live-data-plane smoke binds at the FIRST shipping PR
that has both ends on `main` — that is M5-EH + M5-WV both merged.
Sponsor confirms post-merge per the standard deferral.

### Failure-mode probes

* `state.config` absent → chip boots OFF (default `false`). Covered by
  `headerChip.test.ts` "defaults to OFF when state.config is absent".
* `hideFinished=false` + `hiddenCount>0` (host-contract violation) →
  renders off-label per spec §4.2 row 2. Covered by
  `labelTextForState` test.
* `hiddenCount=0` + filter ON → label "none yet"; CSS
  `[data-hidden-count="0"][data-hide-finished="true"]` reduces opacity
  to 0.7. Covered by render-state matrix test.

## Coordination

* On open: this PR queues `86c9ytyq7 -> in review`
  (ENTRY-2026-05-26T09:40:30Z in `team/log/clickup-pending.md`).
* Reviewer: Felix per Maya-PRs → Felix routing
  (`.claude/docs/orchestration-overview.md` §"PR & merge protocol").
* Cross-review check (per user-global "Parallel-agent shared-concept
  vocabulary discipline"): reviewer should grep this branch +
  `felix/<m5-eh-branch>` for `SetConfigMessage`, `hiddenFinishedCount`,
  `config.hideFinishedAgents`, `"ui:set-config"`, `"hideFinishedAgents"`
  and confirm names match the spec §7 contract verbatim.

## Non-obvious findings worth a doc-capture

* **Defensive state-read pattern for parallel-dispatched type
  additions.** When a webview consumes a wire field that a sibling
  parallel PR is contributing to the shared types module, casting
  through `Record<string, unknown>` lets the consumer compile in
  both pre-merge AND post-merge orderings without `--ts-ignore` /
  `any`. Pattern used in `render.ts:readHeaderChipState` —
  worth capturing in `.claude/docs/vscode-extension-conventions.md`
  if maintain-docs decides this generalizes.
