# polish(webview): chip label clarity rename — `rostered` → `visible`

## Before / After

```
- TEAM ClaudeTeam Alpha    (3 rostered)
+ TEAM ClaudeTeam Alpha    (3 visible)
```

Counting logic unchanged. The chip value remains `tiles.length` (the
`RosterTileEntry[]` items currently on this team card in this session,
post host-side `hideFinishedFilter`). Only the **label** string flips.

## Why

`rostered` misread as "members declared in `teams.yaml`" — sponsor
expected `(6 rostered)` from a 6-member roster YAML, but the chip
correctly shows the matched-and-visible subset (e.g. `(1 visible)` when
the hide-finished filter trimmed everything except a single live agent).
Triage in `team/bram-research/obs-roster-count-chip-2026-05-26.md`
confirmed the math is correct; the word was wrong.

Sponsor decision via AskUserQuestion 2026-05-27 — `(N visible)` chosen
over `(N active)`, `(N showing)`, `(N of M rostered)`.

## Scope

- `src/webview/components/teamCard.ts:114` — render string flipped.
- `src/webview/components/teamCard.ts:7,34-38` — doc-comment + props
  JSDoc updated to reflect the new label semantics + a load-bearing
  reminder that the count is on-screen tiles, not YAML members.
- `tests/unit/webview/collapsedPersonaTile.test.ts` — existing
  `team-count` assertion updated from `(2 rostered)` → `(2 visible)`;
  two new focused tests pin the label across filter-OFF (3 personas
  present → `(3 visible)`) and filter-ON (subset survives → `(1 visible)`)
  states. Both include a regression guard that the literal string
  `rostered` does NOT appear in the chip.

## OOS (explicitly)

- The CLI tree (`src/cli/agentTree.ts:421` — `(N rostered, M background…)`)
  is a separate text surface and is **not** part of this label rename.
  Scope: webview team-card chip only.
- No count-logic change; `tiles.length` unchanged.

## Verification

```
$ npx vitest run tests/unit/webview/collapsedPersonaTile.test.ts
Test Files  1 passed (1)
     Tests  62 passed (62)

$ npx vitest run tests/unit/webview/
Test Files  10 passed (10)
     Tests  232 passed (232)

$ npm run typecheck
(no output → green)
```

## Self-Test Report

### AC walkthrough

- **AC1** — chip reads `(N visible)` after the rename. Verified by
  `tests/unit/webview/collapsedPersonaTile.test.ts` line 574 (updated
  existing assertion: `(2 visible)`) + two new focused tests (filter-OFF
  `(3 visible)`, filter-ON `(1 visible)`).
- **AC2** — counting logic unchanged. The render-call site still passes
  `tiles.length`; no projection or transformation introduced. The
  collapsed-persona wrapper still counts as 1 in the header — pinned by
  the existing `(2 visible)` test (Felix ×4 wrapper + Maya bare tile →
  `(2 visible)`, not `(5 visible)`).
- **AC3** — design-doc comment in `teamCard.ts:7,34-38` updated to
  reflect the new label and the sponsor's decision rationale. Verified
  by reading the diff.

### Theme-switch probe

No CSS / color changes in this PR — the `.team-count` selector and its
`--vscode-*`-driven styling are untouched (`src/webview/styles/dashboard.css:179`).
Theme-switch behavior unchanged from previous tick; covered by prior
Maya self-tests on this surface.

### State-coverage (jsdom snapshot diff)

Pinned by the new tests in `collapsedPersonaTile.test.ts`:

| State                              | Chip text       | Assertion                          |
|------------------------------------|-----------------|------------------------------------|
| Filter OFF, 3 personas matched     | `(3 visible)`   | `chip label reads ... filter OFF`  |
| Filter ON, 1 persona survives      | `(1 visible)`   | `chip label reads ... filter ON`   |
| Wrapper ×4 + bare tile (existing)  | `(2 visible)`   | `team-count counts each entry…`    |

Regression guard included: each new test additionally asserts the chip
text does **NOT** contain the substring `rostered`.

### Sub-agent GUI-gap deferral

Maya runs in a headless harness — `Reload Window` + Activity Bar
screenshots deferred to sponsor post-merge confirm per the established
sub-agent GUI gap (`testing-strategy.md § Sub-agent GUI gap`). The
data-plane smoke for this PR is the jsdom snapshot diff above:
production `renderTeamCard` invoked with realistic `tiles[]` shapes
emits the new label string in both filter states. Risk is low — single
literal string change, no rendering-pipeline or CSS modifications.

## Source

- Sponsor decision: AskUserQuestion 2026-05-27 — `(N visible)`.
- Triage backing the rename: `team/bram-research/obs-roster-count-chip-2026-05-26.md`.
- ClickUp ticket: `86c9zfj2g`.
