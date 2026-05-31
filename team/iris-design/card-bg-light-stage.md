# Card background — light "stage" behind the pixel character

**Ticket:** `86ca23utq` — pixel characters disappear into the dark card/tile background; sponsor wants a lighter background (white OR a better light hex) so they read clearly.
**Author:** Iris (UX) · **Reviewer:** Maya (visual)
**Status:** spec for sponsor color-pick → Maya implements after pick (separate ticket).

---

## TL;DR

- **Recommendation: a light STAGE panel behind ONLY the character sprite — not a whole-card-light repaint.** Add one new token `--ct-sprite-stage-bg` on `.sprite-box`. The tile/card text stays exactly where it is on the dark surface, so **no text or status-dot color flip is required** — much lower blast radius and theme-safe.
- **Primary recommended hex: `#ECEFF1`** (Material Blue-Grey 50 — soft cool off-white). Pure white `#FFFFFF` is the second option if the sponsor wants maximum pop.
- One token change for Maya. The character sprites already have dark outlines and read well on light — this is the cheapest path to "characters pop."

---

## 1. What's actually behind the character today (grounded in live code)

The cascade that puts the sprite on a dark surface (read this task from `src/webview/styles/dashboard.css`):

| Layer | Selector | Background | Source |
|---|---|---|---|
| Page | `body` | `--ct-color-bg-editor` = `var(--vscode-editor-background, #1e1e1e)` | `dashboard.css:106` + token `:55` |
| Session container | `.session-block` | `--ct-color-bg-sidebar` = `var(--vscode-sideBar-background, …)` | `:135` + token `:56` |
| Team card | `.team-card` | *(none — transparent)* | `:241-246` |
| Agent tile | `.agent-tile` | `background-color: transparent` | `:276` |
| **Sprite box** | `.sprite-box` | *(none — transparent; "Sprite sits on transparent tile background; no frame/border")* | `:316-323` |

The sprite `<img class="sprite-frame">` lives inside `<div class="sprite-box">`, both created in `spritePlayer.ts:283-288`. So the **effective background directly behind the 68×68 character is the dark editor/sidebar color** — that is the disappearing problem.

The tile is laid out as a 2-column grid when it has a sprite: column 1 = the 68px `.sprite-box`, column 2 = the text rows (`.tile-row--role / --activity / --model`) — `dashboard.css:297-314`. **The character and the text occupy different columns.** That separation is what makes the stage-only approach clean: we can light the sprite column without touching the text column.

**No existing light-background / "stage" / paper token exists** (grepped `light|#fff|stage|sprite-bg|paper` this task — only `--vscode-button-foreground` `#ffffff` fallbacks, unrelated). So this is a net-new token, not a duplicate.

---

## 2. The decision: whole-card-light vs sprite-only "stage"

### Option A — Whole agent-tile goes light (`.agent-tile { background: <light> }`)
- Character pops, BUT the tile **text now sits on a light background**. `--ct-color-fg` resolves to `--vscode-foreground` (~`#cccccc` in dark theme) → light-grey text on a light tile = **fails contrast badly**. You MUST flip every text row + chips + the activity/model muted text light→dark, AND re-check the status dot, the finished-check stroke (`--ct-color-bg-editor`, `:456`), the hover token (`--ct-color-bg-hover` is a translucent white — invisible on light), and the idle/available dimming opacities. Large blast radius; fragile across theme switches.
- Also visually heavy: a column of solid light tiles in a dark VS Code side bar reads as a foreign UI, not "VS Code-native."

### Option B — Light STAGE behind only the sprite (RECOMMENDED)
- Paint a light rounded panel **only on `.sprite-box`** (column 1). The character gets its light backdrop; **all text stays in column 2 on the dark surface and is untouched** — zero contrast work on text/dots/chips/hover/finished-check.
- Reads like a deliberate "portrait frame / spotlight" behind each teammate — intentional, on-theme, and it makes the roster scan-friendly (each character is a little lit stage).
- One new token, one rule. Smallest possible change; easiest for Maya to land and for Sage to QA.

**Recommendation: Option B.** It solves the stated problem (characters disappear) at a fraction of the cost and risk of Option A, because the existing 2-column grid already isolates the sprite from the text.

> If the sponsor explicitly wants the **entire tile** lit (not just a portrait stage), fall back to Option A and treat the text/dot/hover/finished-check flip as REQUIRED scope — see §5 for the exact values. Do not ship Option A without the flip; light-grey-on-light is the failure mode.

---

## 3. Candidate background colors (exact hex)

All three are **hardcoded hex, NOT theme-mapped** — the stage must read light in BOTH dark and light VS Code themes (same exemption rationale as the semantic state colors, `dashboard.css:61-65`). A `var(--vscode-…)` background would go dark again under a dark theme and re-create the problem.

| # | Hex | Name / feel | Character pop | Notes |
|---|---|---|---|---|
| **1 (PRIMARY)** | `#ECEFF1` | Material Blue-Grey 50 — soft cool off-white | Strong | Slightly cool/neutral; sits naturally beside the existing Blue-Grey state dots (`--ct-color-state-idle-quiet #90a4ae`, finished `#78909c`). Not clinical-bright; gentle on the eye in a dark side bar. **Recommended.** |
| 2 | `#FFFFFF` | Pure white | Strongest | Maximum contrast / pop. Can feel like a harsh light box in a dark theme and slightly "blows out" a light-outlined sprite edge. Pick this if the sponsor wants the loudest possible separation. |
| 3 | `#F5F1E8` | Warm light paper / parchment | Strong | Warmer, softer, "paper portrait" feel. Pleasant but introduces a warm tone that clashes a touch with the cool Blue-Grey dots; less neutral than #1. |

**Recommendation: `#ECEFF1`.** It gives near-white pop without the harshness of pure white, stays tonally consistent with the Blue-Grey palette already on the tile, and reads clearly light under any theme.

### Contrast rationale — against the character sprites
The persona sprites are pixel characters with **dark outlines** (per `persona-pixel-character-animation-prompts.md` — low top-down pixel art, dark-edged). Dark-outlined sprites are designed to read on light; on the current dark surface the dark outline merges into the dark background, which is exactly the disappearing complaint. Any of the three candidates flips that: the dark outline now contrasts hard against a light stage. `#ECEFF1` vs a near-black sprite outline (~`#1a1a1a`) is ≈ **15:1** luminance contrast — far above the WCAG 3:1 non-text / 4.5:1 text bars, with margin for the sprite's mid-tone interior pixels.

### Contrast rationale — against the card TEXT
With Option B, **the text is not on the stage** — it stays in column 2 on the dark tile, so its existing `--ct-color-fg` / `--ct-color-fg-muted` contrast is unchanged and already-passing. **No text color change needed.** This is the core reason Option B is recommended. (Option A's text-flip table is in §5 only as the fallback if the sponsor insists on a fully-light tile.)

---

## 4. Token + the single rule Maya changes

**New token** (add to `:root` in `dashboard.css`, near the sprite tokens at `:84-91`):

```css
/* Light stage behind the persona sprite so the dark-outlined pixel character
 * reads against the dark side bar (86ca23utq). HARDCODED hex — must stay light
 * in BOTH themes (same no-theme exemption as the semantic state colors). */
--ct-sprite-stage-bg: #ECEFF1;          /* sponsor-picked: #ECEFF1 | #FFFFFF | #F5F1E8 */
--ct-sprite-stage-radius: 4px;          /* = --ct-radius-tile; portrait corner softening */
```

**The rule** — extend the existing `.sprite-box` (`dashboard.css:316-323`); Maya adds three properties, no markup change:

```css
.sprite-box {
  width: var(--ct-sprite-size);
  height: var(--ct-sprite-size);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 86ca23utq — light stage so the character pops off the dark side bar */
  background-color: var(--ct-sprite-stage-bg);
  border-radius: var(--ct-sprite-stage-radius);
}
```

That's the whole change for Option B: **one new token + one declaration on `.sprite-box`.** Token name Maya touches: **`--ct-sprite-stage-bg`** (new). No host-side / data-model change — Felix is not in the loop.

Optional polish (Maya's call at impl, NOT required): a hairline inset shadow `box-shadow: inset 0 0 0 1px rgba(0,0,0,0.06)` to seat the stage; or a tiny `padding: 2px` so the sprite doesn't touch the stage edge. Leave these to Maya's visual review — flag, don't mandate.

---

## 5. Fallback ONLY — if sponsor picks whole-tile-light (Option A)

Required companion flips so text stays legible on the light tile. Specify these on `.agent-tile { background: var(--ct-sprite-stage-bg) }` and add a paired dark text token:

| Surface | Current | Option-A value | Why |
|---|---|---|---|
| Primary text (`--ct-color-fg`) | `~#cccccc` (light) | **`#1f2933`** (near-black slate) | ≈ 13:1 on `#ECEFF1` — passes AA/AAA |
| Muted text (role/activity/model, `--ct-color-fg-muted`) | `~#858585` | **`#52606D`** (slate-grey) | ≈ 6:1 on `#ECEFF1` — passes AA |
| Hover (`--ct-color-bg-hover`) | translucent white | **`rgba(0,0,0,0.06)`** | translucent-white hover is invisible on light |
| Finished-check stroke (`:456`, uses `--ct-color-bg-editor`) | dark | re-point to the light stage hex | the check outline must contrast the now-light tile |
| Status dots | unchanged | unchanged | semantic hex (`#4caf50/#ffa726/#78909c/#ef5350`) all pass ≥3:1 on `#ECEFF1` — verified |

This is the larger-blast-radius path — only take it if the sponsor explicitly rejects the portrait-stage look.

---

## 6. Card states on the new background (Option B — recommended)

The stage is constant; the **tile** still carries all state affordances exactly as today. Nothing about the state system changes — the stage is purely a backdrop.

| State | Stage (`.sprite-box`) | Tile (`.agent-tile`) behavior — unchanged from current |
|---|---|---|
| **default** | `#ECEFF1` stage, character animating | transparent tile; text rows full color |
| **hover / focus** | `#ECEFF1` stage unchanged | tile bg → `--ct-color-bg-hover`, `1px` `--ct-color-focus` outline (`:282-286`). The hover highlight wraps the whole grid incl. the stage column — stage stays light, hover tints the tile gutter around it. Reads correctly. |
| **selected** | `#ECEFF1` stage unchanged | (selection today = focus-visible outline; no separate selected bg exists in code — confirmed) |
| **active (running)** | `#ECEFF1` stage; sprite plays `active_*` anim | running dot (member color or `--ct-color-state-running`), pulse halo — all on the dark text column, untouched |
| **idle** | `#ECEFF1` stage; idle sprite anim | text dimmed to `--ct-opacity-available`/idle treatment (`:474-492`) — **dimming applies to the text rows, NOT the stage**, so the character stays clearly lit even when idle. Good: a quiet teammate is still visible. |
| **available (never-run)** | `#ECEFF1` stage | available dimming on text rows (`opacity --ct-opacity-available 0.6`); stage full opacity. Character reads even for never-run members — supports the whole-team-always-visible thesis. |
| **error** | `#ECEFF1` stage | error dot `#ef5350` + `to-error` flash outline (`:514-538`) on the tile — contrasts fine against both stage and dark column |

> **Decision to flag for Maya:** should the idle/available **dimming opacity also dim the stage** (character fades with the row) or **keep the stage at full opacity** (character always crisp, only text fades)? Spec recommends **keep stage full-opacity** — the whole point of this ticket is that characters are visible; dimming the stage with the row would partially re-introduce the disappearing problem for idle/available members. Maya: scope `opacity` to the text rows, not `.sprite-box`.

---

## 7. ASCII mock — agent tile with the light stage (Option B)

```
 ┌──────────────────────────────────────────────┐   ← .agent-tile (transparent,
 │  ┌──────────┐                                 │     on dark .session-block)
 │  │░░░░░░░░░░│   ● Felix            ← name + running dot
 │  │░░▓▓▓▓░░░░│     Extension Host Dev   ← role  (muted)
 │  │░░▓██▓░░░░│     tool:Edit src/…       ← activity (muted)
 │  │░▓████▓░░░│     opus                  ← model (muted)
 │  └──────────┘                                 │
 └──────────────────────────────────────────────┘
    ▲ .sprite-box        ▲ text column (column 2) stays on the
    light stage #ECEFF1    DARK surface — no color flip needed
    (col 1, 68×68,
     radius 4px)

 Legend:  ░ = light stage (#ECEFF1)   ▓█ = dark-outlined pixel character
          ● = status dot              text = existing --ct-color-fg / muted
```

Contrast read at a glance: the dark-outlined character now sits in a lit 68px panel, popping out of the dark side bar; the name/role/activity text is unchanged on the dark column to its right. Each roster member reads as a little portrait.

---

## 8. Open questions for the sponsor

1. **Exact hex pick:** `#ECEFF1` (recommended, soft cool off-white) vs `#FFFFFF` (max pop, can feel harsh) vs `#F5F1E8` (warm paper)? — color is a subjective-feel call, sponsor decides.
2. **Stage-only vs whole-tile-light:** recommend the portrait STAGE (Option B, low-risk). Confirm the sponsor is happy with "lit portrait behind the character" rather than "the entire tile is a light card." If they want the whole tile light, §5 scope applies.
3. **Idle dimming:** confirm the stage stays full-opacity while idle/available text dims (recommended), so quiet teammates' characters stay visible.

---

## 9. Implementation handoff (separate ticket, post-pick)

- **Files:** `src/webview/styles/dashboard.css` only (token block ~`:84-91`, `.sprite-box` rule `:316-323`). No markup change (`.sprite-box`/`.sprite-frame` already exist, `spritePlayer.ts:283-288`).
- **Owner:** Maya. **Reviewer:** Felix (or Maya self if trivial). **QA:** Sage — theme-switch probe (stage stays light in both themes) + state-coverage screenshots.
- **No host/data change** — Felix not required.
- Webview-smoke gate applies (touches webview rendering): manual reload screenshot of the lit tile in dark + light theme.
