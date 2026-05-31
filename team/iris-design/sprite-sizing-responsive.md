# Responsive character-sprite sizing — design brief

Ticket: `86ca2522v` · Branch: `iris/86ca2522v-sprite-sizing-responsive` · Author: Iris

> **Path note:** the dispatch brief named `team/iris-design/` as the deliverable path; Iris's existing workspace is `team/iris-ux/`. This file lives at the dispatched path verbatim. If the team prefers one canonical Iris dir, fold it into `iris-ux/` in a follow-up — flagged, not assumed.

> **Sequencing (load-bearing):** Maya implements this AFTER PR #155 (`maya/86ca23utq-card-bg-impl`, whole-card-light) merges. PR #155 was **OPEN, not merged** at spec time (verified `gh pr view 155 --json state` → `"OPEN"`, `mergedAt: null`, 2026-05-31). Every `.agent-tile` token reference below is reconciled against the **post-#155** card (`gh pr diff 155`), not pre-#155 `origin/main`.

---

## Sponsor request (verbatim)

> "I want the characters to be a bit bigger maybe scale when i make the dashboard column wider (until a certain point of course, not too big)."

Decoded into three asks:
1. Baseline sprite a bit bigger than today.
2. Sprite scales **up** as the dashboard column / webview panel widens.
3. Capped at a sensible max — "not too big."

---

## 1. Current render size (grounded in real code)

All values grepped from `src/webview/styles/dashboard.css` on `origin/main` (SHA `64ce230` at spec time) and cross-checked against PR #155's diff.

| What | Value | Source (file:line) |
|---|---|---|
| Sprite token | `--ct-sprite-size: 68px;` | `dashboard.css:89` |
| Sprite box | `.sprite-box { width: var(--ct-sprite-size); height: var(--ct-sprite-size); }` | `dashboard.css:316-323` |
| Sprite frame img | `.sprite-frame { width: var(--ct-sprite-size); height: var(--ct-sprite-size); image-rendering: pixelated; object-fit: contain; }` | `dashboard.css:325-334` |
| Grid template | `.agent-tile[data-has-sprite="true"] { grid-template-columns: var(--ct-sprite-size) 1fr; }` | `dashboard.css:297-302` |

**So the sprite renders at a fixed 68×68 CSS px today**, driven entirely by the single `--ct-sprite-size` token. The token is used in 4 sites (box w/h, frame w/h, grid column) — changing the token changes all of them coherently. That is the **only** lever needed.

**Pixel-source note:** the PixelLab base characters are generated at `size=48` and states re-synthesize at the same canvas (per `.claude/docs/persona-pixel-character-animation-prompts.md` § Operational pipeline step 1: `create_character(... size=48 ...)`). So today's 68px box already **upscales a 48px source by ~1.42×** (non-integer). Crispness section below addresses this.

---

## 2. Panel-width → card-width math (grounds the scaling range)

The sprite box is NOT flush to the panel edge — it sits inside four nested padded containers. Horizontal chrome from the webview panel's inner edge to the sprite box's outer edge:

| Container | Padding token | px/side | Source |
|---|---|---|---|
| `#root` | `--ct-space-m` | 12 | `dashboard.css:109-114` |
| `.session-block` | `--ct-space-l` | 16 | `dashboard.css:130-138` |
| `.team-card` | `--ct-space-m` | 12 | `dashboard.css:241-246` |
| `.agent-tile` | `--ct-space-s` | 8 | `dashboard.css:270-280` (post-#155 keeps `--ct-space-s` padding) |

Total fixed horizontal chrome ≈ **2 × (12+16+12+8) = 96px** (both sides), plus the `--ct-space-s` (8px) grid `column-gap` between sprite and text. So the space available to **{sprite box + text column}** is roughly `panelWidth − 96px`.

Typical VS Code side-bar panel widths (the Activity-Bar webview lives in the Side Bar):
- **Narrow** (default-ish side bar): ~240–300px panel → ~150–200px content row.
- **Comfortable**: ~340–420px panel.
- **Wide** (sponsor dragging it out): ~480–600px+ panel.

This is the range the scaling must feel good across. The text column (`1fr`) must always keep enough room to render the display name + activity line — so the sprite can't eat the whole row. That bounds the max.

---

## 3. Proposed scaling — recommendation: **container query + `clamp()`**

### 3.1 Why container query (not viewport `vw`)

The webview panel is its own resizable container; its width is **independent of the OS window / viewport**. A `vw`-based `clamp()` would scale with the whole VS Code window, not the side-bar drag — exactly the wrong signal. Container Query Units (`cqw` = 1% of the query container's inline size) track the **panel** width, which is what the sponsor is dragging.

Container queries + `cqi`/`cqw` units are supported in the Electron/Chromium that current VS Code ships (Chromium ≥105; VS Code's webview is well past that on the `^1.85.0` engine floor). No polyfill needed.

### 3.2 The recommended rule

Declare a container on a stable wrapper, then size the token off it:

```css
/* Establish the query container. The session block is the right scope — it
 * spans the full panel-content width and wraps the team cards / tiles.
 * `inline-size` = horizontal-only containment (does not trap block layout). */
.session-block {
  container-type: inline-size;
  container-name: ct-panel;
}

:root {
  /* baseline (carry-over default for non-container contexts / reduced-motion) */
  --ct-sprite-size: 76px;          /* see §3.3 — nudged up from 68px */
}

@container ct-panel (min-width: 0) {
  .agent-tile {
    /* min 76px, grows at ~26% of container width, capped 112px */
    --ct-sprite-size: clamp(76px, 26cqw, 112px);
  }
}
```

Because `--ct-sprite-size` already feeds the box, the frame, and the grid column, **redefining the token inside the tile is the entire change** — no other selector edits required. (Maya sets it on `.agent-tile`, not `:root`, so the live value can read the container; the `:root` value stays the safe fallback.)

### 3.3 Concrete numbers + the growth curve

| | px | Rationale |
|---|---|---|
| **Baseline / min** | **76px** | "A bit bigger" than 68 without a big layout shove. ≈ +12%. |
| **Preferred (slope)** | **26cqw** | At a ~290px-wide container → 26% ≈ 75px (≈ baseline, narrow panels stay at min). At ~430px → ≈ 112px (hits the cap). Grows smoothly through the comfortable range. |
| **Max / cap** | **112px** | "Not too big." Leaves the `1fr` text column ≥ ~250px even on a wide panel, so the name + wrapped activity line never get crushed. ≈ 1.65× baseline; ≈ 2.33× the 48px source. |

**Growth window:** the sprite is at min (76px) until the panel is roughly **~290px** wide, ramps through the comfortable range, and pins at the 112px cap once the panel passes roughly **~430px**. Past that the sprite holds — only the text column keeps widening. That matches "scale when wider, but not too big."

> `cqw` slope + the px cap numbers are a **first-pass recommendation tuned from the §2 math, not sponsor-validated visually.** The exact slope (26cqw) and cap (112px) are render-time-tunable with zero cost — the sponsor should eyeball the feel on a live reload and nudge. Treat §3.3 as the starting table, same posture as the playback-override table in the persona-anim doc.

### 3.4 Fallback if Maya prefers to avoid container queries

A pure-`clamp()` token with **no** container — `--ct-sprite-size: clamp(76px, 18vw, 112px)` — is simpler but keys off the **viewport**, so it scales with the whole VS Code window rather than the side-bar drag. **Not recommended** — it ignores the sponsor's actual gesture (dragging the column). Documented only as the no-container-query degrade path. If chosen, the `vw` coefficient needs re-derivation against typical window widths, not panel widths.

---

## 4. Pixel-art crispness

These are pixel sprites (`image-rendering: pixelated` already set, `dashboard.css:329`). Upscaling pixel art to **non-integer** multiples of the source resolution introduces uneven pixel doubling (some source pixels render 2px wide, neighbors 3px) — visible as shimmer/irregularity, worst *during* a smooth resize.

**Source is 48px** (PixelLab `size=48`). Integer multiples: 48 / 96 / 144. Today's 68px is already non-integer (1.42×) and ships fine per current dogfood, because `image-rendering: pixelated` makes nearest-neighbour scaling *crisp* (hard edges) even at fractional ratios — it just isn't perfectly uniform. So:

**Recommendation: accept non-integer (continuous) scaling.** Rationale:
- `image-rendering: pixelated` already guarantees no blur — the upscale stays hard-edged at any ratio (this is the property's whole job). The artifact is *uneven pixel widths*, not fuzziness.
- A smooth `clamp()`/`cqw` ramp is the sponsor-requested feel ("scale when I make it wider"). **Stepped sizes would make the sprite jump in discrete jerks** as the panel crosses thresholds — visually worse than a slight pixel-width unevenness, and contrary to the request.
- The 48→76–112 range stays in the 1.6×–2.33× band; at 68px (1.42×) the current build already reads acceptably, so the slightly-higher ratios are no worse.

**If** the sponsor finds the continuous scale shimmery on a live drag, the cheap fallback is to **snap to integer multiples of 48** via a small step ladder (e.g. `--ct-sprite-size` resolves to 96px in a mid band, 144px only on very wide panels) — but 144px likely violates "not too big," so a 96px-capped stepped variant is the realistic stepped option. **Default to continuous; offer stepped only if shimmer is reported.** This is a sponsor-eye call (visual fidelity), not a functional one — defer the final pick to a reload.

---

## 5. Token(s) / selector(s) Maya changes

Keep everything in the token so the sponsor can tweak live (per design discipline + the existing token-source-of-truth comment at `dashboard.css:84-92`):

| Change | Where | Note |
|---|---|---|
| Bump baseline | `--ct-sprite-size` at `dashboard.css:89` → `76px` (from `68px`) | The `:root` value becomes the fallback / reduced-motion size. |
| Add container | `.session-block` (`dashboard.css:130`) → add `container-type: inline-size; container-name: ct-panel;` | `inline-size` containment only — does not affect vertical flow. |
| Scale the token | New `@container ct-panel { .agent-tile { --ct-sprite-size: clamp(76px, 26cqw, 112px); } }` | Single new rule; redefines the existing token so box + frame + grid column all follow with no further edits. |

**No new selectors on the sprite elements themselves** — `.sprite-box`, `.sprite-frame`, and the grid `grid-template-columns` already consume `--ct-sprite-size` and need zero changes. That is the safety of the existing token design.

Optional nicety (sponsor convenience, not required): split the three magic numbers into their own tokens so they're tweakable without touching the rule —
```css
--ct-sprite-size-min: 76px;
--ct-sprite-size-max: 112px;
--ct-sprite-grow: 26cqw;
/* then: --ct-sprite-size: clamp(var(--ct-sprite-size-min), var(--ct-sprite-grow), var(--ct-sprite-size-max)); */
```
Recommended — it makes the sponsor's live-tuning a one-line token edit each.

---

## 6. Layout safety

Confirmed against the **post-#155** card (`gh pr diff 155`, 2026-05-31):

1. **Single-agent card (`.agent-tile[data-has-sprite="true"]`)** — the sprite is grid column 1 (`var(--ct-sprite-size)`), text is `1fr`. Growing column 1 to 112px max leaves the text column the remaining width. With the §2 math, even on a narrow ~290px content row the text column keeps ≥ ~180px; on a wide panel it keeps ≥ ~250px. The activity line already `word-break`s and never truncates (`dashboard.css:359-366`), so a narrower text column degrades gracefully by wrapping, never clipping. **Safe.**

2. **PR #155 whole-card-light** — #155 changes `.agent-tile` *background/border/text color* only (`--ct-card-bg`, `--ct-card-hairline`, dark-on-light text). It does **not** touch the grid template, `--ct-sprite-size`, `.sprite-box`, or `.sprite-frame`. The light card simply gets taller as the sprite grows — the bg + hairline scale with the card box automatically. **No conflict with #155.** The bigger sprite reads *better* on the light card (more portrait presence), which is the card-bg PR's whole intent.

3. **Collapsed / expanded multi-agent tiles** — verified the compact instance rows are **sprite-less**: `dashboard.css:713-716` — "One compact instance row — sprite-less (spec §3.2: the sprite belongs to the … [main tile])". The `.persona-instance-row` / `.agent-tile--compact` rows do **not** consume `--ct-sprite-size`. So scaling the token has **zero effect** on the collapsed/expanded compact list — only the single primary persona tile and the standalone `.agent-tile`s scale. **No multi-agent layout risk.**

4. **`.collapsed-persona-header`** (the multi-agent persona card root, post-#155 also light) — does not render a sprite box at the header level in current code; it carries the chevron + name + status hint. Unaffected by `--ct-sprite-size`. (If a future ticket adds a header-level sprite, it would inherit the scaled token for free — note, not a current concern.)

5. **Reduced motion** — sprites already fall back to frame-0-only under `prefers-reduced-motion` (per the playback doc). Sizing is orthogonal to motion; the `clamp()` still applies (a bigger still frame is fine). No special-case needed.

---

## 7. ASCII mock — min vs max

Narrow panel (~290px) — sprite at **76px baseline**:

```
┌─ Side Bar panel (~290px) ───────────────────┐
│ ┌ session-block ────────────────────────┐   │
│ │ ┌ team-card ──────────────────────┐    │   │
│ │ │ ┌ agent-tile (light card #155) ┐ │    │   │
│ │ │ │ ┌──────┐  ● Felix             │ │    │   │
│ │ │ │ │ 76px │     Extension Host   │ │    │   │
│ │ │ │ │ ☕    │     tool:Edit src/…  │ │    │   │
│ │ │ │ └──────┘     opus             │ │    │   │
│ │ │ └──────────────────────────────┘ │    │   │
│ │ └─────────────────────────────────┘    │   │
│ └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

Wide panel (~520px) — sprite pinned at **112px cap**, text column absorbs the extra width:

```
┌─ Side Bar panel (~520px, sponsor dragged wide) ─────────────────────────┐
│ ┌ session-block ────────────────────────────────────────────────────┐  │
│ │ ┌ team-card ──────────────────────────────────────────────────┐    │  │
│ │ │ ┌ agent-tile (light card #155) ────────────────────────────┐ │    │  │
│ │ │ │ ┌─────────┐                                               │ │    │  │
│ │ │ │ │         │  ● Felix                                      │ │    │  │
│ │ │ │ │  112px  │     Extension Host Dev                        │ │    │  │
│ │ │ │ │   ☕    │     tool:Edit src/extension/watcher/loop.ts   │ │    │  │
│ │ │ │ │         │     opus                                      │ │    │  │
│ │ │ │ └─────────┘                                               │ │    │  │
│ │ │ └──────────────────────────────────────────────────────────┘ │    │  │
│ │ └─────────────────────────────────────────────────────────────┘    │  │
│ └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

The sprite grows from 76→112 across the drag; past ~430px it holds at 112 and only the text column keeps widening — "scale when wider, not too big."

---

## 8. Open questions for sponsor

1. **Baseline 76 / max 112 / slope 26cqw** — these are math-derived, not eyeballed. Sponsor should nudge on a live reload (zero-cost token tweaks). Is 112px the right "not too big" ceiling, or should the cap sit lower (e.g. 96px = exact 2× source, perfectly crisp)?
2. **Continuous vs stepped scaling** — recommendation is continuous (smooth, matches the request); stepped (snap to 48-multiples) only if continuous shimmers on a live drag. Sponsor's eye is the gate.
3. **Container scope** — `.session-block` is the chosen query container. If the sponsor ever wants the sprite to scale by team-card width rather than full-panel width, the container moves to `.team-card` — flag if that's desired (default: panel-width per the request wording).
