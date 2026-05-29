## Summary

Make the hide-finished header chip label state-aware: when the filter is ON (finished tiles hidden), the label now reads `Show finished — N hidden` instead of `Hide finished — N hidden`. OFF-state label is unchanged.

The label now names **the action the click WILL TAKE**, matching the sponsor's verbatim UX intent from V1 dogfood (ticket `86c9zfmgg`, Obs 8, `team/dogfood/2026-05-26-obs-dashboard-quirks.md` § Observation 8):

> *"If i click the 'Hide finished x hidden' button, that should be named 'show finished x hidden'."*

### State matrix (revised)

| `hideFinished` | `hiddenCount` | Label (before)              | Label (after)                | aria-pressed | Click WILL |
|---|---|---|---|---|---|
| `false` | 0   | `Hide finished`               | `Hide finished`               | `false` | hide |
| `true`  | 0   | `Hide finished — none yet`    | `Show finished — none yet`    | `true`  | show |
| `true`  | 1   | `Hide finished — 1 hidden`    | `Show finished — 1 hidden`    | `true`  | show |
| `true`  | N>1 | `Hide finished — N hidden`    | `Show finished — N hidden`    | `true`  | show |

Tooltip / `title` was already state-aware via the same convention (`Show finished agents` when ON, `Hide finished agents` when OFF) — no change there. `aria-pressed` continues to reflect the toggle's current state per the W3C toggle-button pattern.

## Scope

- `src/webview/components/headerChip.ts` — `labelTextForState` returns `Show finished …` on the ON branch; OFF branch unchanged; doc-comment state table revised with the action-named convention.
- `tests/unit/webview/headerChip.test.ts` — updated label assertions on ON-branch cases (`labelTextForState` direct calls + state-matrix + boots-ON integration). 21/21 unit tests pass. Negative case (OFF + spurious count) still asserts `Hide finished` (off label).

OOS: chip color/icon, click-handler restructuring, spec doc rewrite (spec stays as historical record; new convention is the in-code authority — follow-up filed at NIT level if sponsor wants the spec doc resynced).

## Self-Test Report

### AC walkthrough

- **AC1 — OFF baseline label unchanged.** `labelTextForState(false, 0)` → `"Hide finished"` (verified by `headerChip.test.ts` line 55-56 + smoke).
- **AC2 — ON + 0 hidden reads "Show finished — none yet".** `labelTextForState(true, 0)` → `"Show finished — none yet"` (verified by `headerChip.test.ts` line 58-60 + smoke).
- **AC3 — ON + 1 hidden reads "Show finished — 1 hidden".** `labelTextForState(true, 1)` → `"Show finished — 1 hidden"` (verified line 62-64 + smoke).
- **AC4 — ON + N>1 hidden reads "Show finished — N hidden".** `labelTextForState(true, 2)` → `"Show finished — 2 hidden"`; `labelTextForState(true, 14)` → `"Show finished — 14 hidden"` (verified line 66-71 + smoke).
- **AC5 — sponsor-observed `16 hidden` state.** Live jsdom render confirmed the chip outputs `label.textContent: "Show finished — 16 hidden"` (smoke output below).

### Data-plane smoke (jsdom render output — sub-agent GUI gap workaround per `testing-strategy.md`)

```
--- OFF baseline       (click WILL hide)
  label.textContent : "Hide finished"
  aria-pressed      : false
  title             : "Hide finished agents"
--- ON  + 0 hidden     (click WILL show)
  label.textContent : "Show finished — none yet"
  aria-pressed      : true
  title             : "Show finished agents"
--- ON  + 1 hidden     (click WILL show)
  label.textContent : "Show finished — 1 hidden"
  aria-pressed      : true
  title             : "Show finished agents"
--- ON  + 16 hidden    (sponsor-observed; click WILL show)
  label.textContent : "Show finished — 16 hidden"
  aria-pressed      : true
  title             : "Show finished agents"
```

Output captured from a one-off vitest jsdom smoke driving `renderHeaderChip` against the four states; cleaned up post-run. The `16 hidden` case is the exact state the sponsor observed in dogfood 2026-05-26 (Obs 8). After the patch it reads `Show finished — 16 hidden`, matching the sponsor's UX request.

### Side-effect inventory

- Chip toggle interaction: unchanged — `ui:set-config` payload + optimistic UI flip identical.
- ARIA contract: `aria-pressed` still reflects current state (W3C toggle-button pattern). No screen-reader regression — when ON, assistive tech announces "Show finished, pressed" (clear intent of what the press WILL do).
- `data-hidden-count` CSS selector (spec §6.1) and `--vscode-*` token usage untouched.
- Mount position and re-render order untouched (rosterErrorChip → errorChip → headerChip → sessions/empty).

### Theme-switch probe

Not applicable — this is a text-only change; no color, no token, no styling touched. The chip continues to use the existing `--vscode-*` tokens via the M4-01 `--ct-*` indirection layer.

### State-coverage

- Filter OFF: `Hide finished` (smoke confirmed).
- Filter ON + 0 hidden: `Show finished — none yet` (smoke confirmed).
- Filter ON + 1 hidden: `Show finished — 1 hidden` (smoke confirmed).
- Filter ON + N>1 hidden: `Show finished — N hidden` (smoke confirmed at N=2, N=14, N=16).
- Optimistic-UI flip post-click: data-hide-finished/aria-pressed/title flip on click (existing test `optimistic UI flips ...` line 233-252 still passes — those assertions are state-attribute-based, not label-text-based).

### Manual-reload screenshot (sub-agent GUI gap)

This PR's author and reviewer are both sub-agents. Per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround", interactive screenshot ACs (Developer: Reload Window + sponsor visual confirm of the relabel) are deferred to sponsor post-merge confirm. The data-plane smoke above is the load-bearing pre-merge verification — the rendered DOM text is the exact bytes that the production webview will display, because the same `renderHeaderChip` call drives both code paths.

## Verification commands

```
npm run typecheck          # passes (no diagnostic output)
npx vitest run             # 24 files, 464 passed, 2 skipped
```

## Cross-references

- Symptom: `team/dogfood/2026-05-26-obs-dashboard-quirks.md` § Observation 8 (sponsor verbatim).
- Spec (historical): `team/iris-ux/m5-hide-finished-spec.md` §4.2 / §5.2 / §7.3 — spec still describes the old "Hide finished — N hidden" convention. The in-code label is the new authority; resyncing the spec is filed as a follow-up NIT if the sponsor wants the doc to track.
- Reviewer: Felix (cross-pair, host-side neutral surface).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
