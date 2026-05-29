## What this looks like

A never-run roster member now renders a **visually distinct baseline tile**: a
quiet blue-grey static dot (not idle's amber, not finished's grey-with-check),
the literal muted word `available` as the activity row, and rows 2-4 dimmed to
`0.6` — sitting between dead (0.5) and live-idle (0.78) on the legibility ramp.

```
┌────┐ ○ Nora           available                     │  ← never-run (quiet blue-grey dot)
│spr.│ Planning Lead                          [⋯]     │     rows 2-4 @ opacity 0.6
└────┘                                                │
┌────┐ ● Felix          tool:Edit reducer.ts  …running│  ← running (green pulse), for contrast
└────┘ ...                                            │
◐ Sage  finished 4m  ...                              │  ← finished (grey + check)
```

The win (spec §2.4): Nora / Iris / Bram render even though they never dispatched
this session — and they read as "real team member, just not active," not as a
broken/greyed-out card.

## What changed

This skins the `available` state that **E-01 already seeds** in the reducer and
**E-04 already renders a sprite for** — it builds on both, doesn't fight them.

- **`src/webview/styles/dashboard.css`**
  - New tokens: `--ct-color-state-idle-quiet: #90a4ae` (Material Blue-Grey 300)
    and `--ct-opacity-available: 0.6`.
  - `.state-dot[data-state="available"]` → quiet static dot.
  - `.agent-tile[data-state="available"] .tile-row--{role,activity,model}` →
    `opacity: var(--ct-opacity-available)`, mirroring the existing idle-fade rule.
- **`tests/unit/availableFilterInteraction.test.ts`** (5) — AC3 regression:
  hide-idle / hide-finished / both-composed leave `available` tiles intact.
- **`tests/unit/webview/availableTile.test.ts`** (7) — AC1/AC2/AC5: the
  never-run skin's CSS hooks (`data-state` on article + dot, "Available"
  aria-label, no running member-color leak), literal `available` activity (no
  `tool:?` collision), and sprite composition (bound member shows sprite +
  baseline; sprite-less member shows text-only baseline).

No `agentTile.ts` change was needed — it already renders `tile.activity`
verbatim and stamps `data-state`, so the skin is a pure CSS layer keyed on the
existing DOM contract. `STATE_LABEL.available = "Available"` was already present
from E-01.

## AC coverage

| AC | How |
|---|---|
| **AC1** baseline visual per §1/§2.2-2.3 | quiet `--ct-color-state-idle-quiet` dot + `--ct-opacity-available` rows (the `--ct-color-state-idle-quiet` token the #109 review noted). |
| **AC2** consume E-01's exact literal `"available"` | host emits `activity: "available"` + `state: "available"` (verified `src/shared/types.ts:290`); webview renders verbatim — no invented type. |
| **AC3** hide filters must NOT hide baseline | both filters drop ONLY `state === "idle"` / `state === "finished"` (verified `hideIdleFilter.ts:104,129` / `hideFinishedFilter.ts:96,121`); `available` survives by construction, locked by `availableFilterInteraction.test.ts`. |
| **AC4** theme-aware, no hex, tests | colors via `--ct-`/`--vscode-` tokens; the one hardcoded hex is a semantic state color (theme-stable, per the CLAUDE.md state-indicator exemption — same class as the 4 existing state hexes). Typecheck + lint clean; 12 new tests. |
| **AC5** composes with E-04 sprites | available + sprite-bound member → idle-pool sprite (E-04 pose map) + baseline skin; sprite-less → text-only baseline, no regression to E-04 fallback. |

## Non-obvious notes (for maintain-docs)

- `available` is NOT filesystem-derived — it's the *absence* of a detected
  agent (reducer baseline seed). The two hide-filters are safe against it ONLY
  because they match exact state strings; a future "hide quiet members" filter
  must explicitly decide whether `available` is in scope.
- `--ct-color-state-idle-quiet` is deliberately Blue-Grey 300, one step lighter
  than finished's Blue-Grey 400 (`#78909c`) — close enough to read "low-key,"
  distinct enough to tell never-run from finished at a glance.
