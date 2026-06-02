# Hero-character card layout — design spec

Ticket: `86ca2522v` (reconciles + supersedes the responsive-sizing pass) · Author: Iris

> **This doc SUPERSEDES `team/iris-design/sprite-sizing-responsive.md` (PR #156).** That doc landed in the wrong dir (`iris-design/`, not Iris's real `iris-ux/`) and proposed a *bigger-sprite-in-the-2-column-grid* treatment. The sponsor has since mocked up a **HERO-CHARACTER** card — the sprite becomes large and CENTRAL with meta wrapping around it, a 3-zone vertical stack. That changes the GRID, not just the sprite size, so the #156 layout is folded in here and its responsive-sizing recommendation is carried forward (re-tuned for the hero size). **Action for the team: close/retarget PR #156 onto this doc; do not land the `iris-design/` file.** (Flagged, not assumed — orchestrator's call.)

> **Sequencing (load-bearing):** Maya implements this AFTER PR #155 (`maya/86ca23utq-card-bg-impl`, whole-card-light) merges. PR #155 was **OPEN, not merged** at spec time (verified `gh pr view 155 --json state` → `OPEN`, 2026-05-31). Every token/selector below is reconciled against the **post-#155** card (`gh pr diff 155`) — the light `--ct-card-bg` / `--ct-card-fg*` tokens this spec reuses are INTRODUCED by #155, so #155 must land first or these token refs dangle.

---

## 0. Sponsor mockup (verbatim, as relayed — I have not seen the image)

A single multi-agent **`iris`** card on the light `#ECEFF1` whole-card:

- **TOP ROW:** left = green status dot + **`iris`** (name, bold) + **`×2 ▸`** (count badge + expand chevron); right = **`UX Designer`** (role, muted).
- **CENTER:** the sprite rendered **LARGE** (~150–180px wide), centered, dominating the card — working-at-desk pose.
- **BOTTOM ROW:** left = **`claude-opus-4-8`** (model, muted) · center = **`tool:Edit`** (activity/tool, bold) · right = **`(2 agents)`** (muted).
- Net: 3-zone vertical layout — top meta bar / hero sprite / bottom meta bar.

---

## 1. Current layout (grounded in real code)

The card today is a **2-column grid** (sprite left, text stacked right) — NOT a vertical hero. Grepped from `dashboard.css` (post-#155 reconciled) + the two component files.

| Element | Class | Created at | Current grid placement |
|---|---|---|---|
| Tile root | `.agent-tile` (`<article>`) | `agentTile.ts:221` / `multiAgentPersonaTile.ts:234` | `display:grid; grid-template-columns: var(--ct-sprite-size) 1fr` when `[data-has-sprite="true"]` (`dashboard.css:297-302`); else `display:flex; flex-direction:column` (`dashboard.css:270-280`) |
| Sprite box | `.sprite-box` | `spritePlayer.createSpriteBox` (appended `agentTile.ts:304`) | `grid-column:1; grid-row:1/-1` (`dashboard.css:305-309`); fixed `--ct-sprite-size` (68px) box |
| Row 1 (dot + name [+ badge]) | `.tile-row.tile-row--primary` → `.state-dot`, `.agent-display`, (`.persona-count-badge`→`.persona-count-badge-count`+`.persona-count-chevron`) | `agentTile.ts:352-367` / `multiAgentPersonaTile.ts:320-361` | `grid-column:2` (`dashboard.css:312-314`) |
| Row 2 (role) | `.tile-row.tile-row--role` → `.agent-role` | `agentTile.ts:370` | col 2 |
| Row 3 (activity/tool) | `.tile-row.tile-row--activity` → `.agent-activity` | `agentTile.ts:396-405` | col 2 |
| Row 4 (model [+ count hint]) | `.tile-row.tile-row--model` → `.agent-model`, (`.persona-count-hint`) | `agentTile.ts:423` / `multiAgentPersonaTile.ts:384-396` | col 2 |
| Kebab menu | `.agent-tile-overflow` (`>.agent-tile-overflow-btn`) | `buildOverflowMenu`, appended `agentTile.ts:439` | `position:absolute; top/right` (`dashboard.css:905-909`), anchored to `.agent-tile{position:relative}` (`dashboard.css:901-903`) |

**Token already drives the sprite** at 4 sites — `--ct-sprite-size: 68px` (`dashboard.css:89`) feeds `.sprite-box` w/h, `.sprite-frame` w/h, and the grid column. Changing the token changes all coherently. That single-lever property is preserved by this spec.

**Key constraint the hero layout must respect:** the SAME `.agent-tile` markup serves single-agent (`renderAgentTile`) AND multi-agent (`renderMultiAgentPersonaTile`) — the multi-agent tile adds the `.persona-count-badge` (row 1), the `.persona-count-hint` (row 4), and an inline `.persona-instances` expand region appended AFTER row 4. The hero layout is a CSS-only re-flow of these EXISTING elements; **no element moves in the DOM, no new element is added.** (See §8 on why the badge/instances placement works out.)

---

## 2. The 3-zone hero layout (CSS-only re-flow)

The mockup's 3 zones map cleanly onto the existing rows **without changing the DOM order** the components emit (sprite-box first, then primary/role/activity/model rows, then overflow + instances). We switch `.agent-tile[data-has-sprite="true"]` from a **2-column grid** to a **3-zone vertical grid** and re-place the existing children.

### 2.1 Zone → existing-element mapping

```
┌─────────────────────────────────────────────────┐
│ ZONE A — TOP META BAR                           │  ← .tile-row--primary  (left)
│  ● iris  ×2 ▸                    UX Designer     │  + .tile-row--role     (right)
├─────────────────────────────────────────────────┤
│                                                 │
│ ZONE B — HERO SPRITE (centered)                 │  ← .sprite-box
│            ┌───────────────┐                    │     (grows to hero size)
│            │   [ sprite ]  │                    │
│            │   ~160px      │                    │
│            └───────────────┘                    │
│                                                 │
├─────────────────────────────────────────────────┤
│ ZONE C — BOTTOM META BAR                        │  ← .tile-row--model    (left)
│  claude-opus-4-8    tool:Edit      (2 agents)   │  + .tile-row--activity (center)
└─────────────────────────────────────────────────┘
                                      [⋯ kebab — absolute top-right, unchanged]
```

### 2.2 The grid structure (recommended — CSS grid with named areas)

`.agent-tile[data-has-sprite="true"]` becomes a 3-ROW grid (was 2-column). The existing rows are assigned to areas via `grid-row` (or `order` in a flex column — see §2.4 for the flex alternative). Recommended is **grid with explicit row assignment** because the top and bottom zones each pack TWO existing rows side-by-side, which grid handles with a nested layout cleanly.

Zone A and Zone C are each a horizontal 2-up. The cleanest implementation keeps the OUTER tile as a vertical stack and makes the **primary+role pair** and the **model+activity pair** each their own horizontal flex sub-row. BUT the components emit role and activity as SEPARATE sibling rows, not pre-grouped — so we use `grid` on the tile and place each row into a sub-grid cell by `grid-row`/`grid-column`:

```css
/* HERO layout — supersedes the 2-column grid at dashboard.css:297-302.
 * Existing children keep their DOM order; we re-place them with grid lines. */
.agent-tile[data-has-sprite="true"] {
  display: grid;
  grid-template-columns: 1fr auto;   /* left meta | right meta */
  grid-template-rows: auto auto auto; /* TOP bar | HERO | BOTTOM bar */
  grid-template-areas:
    "name   role"      /* Zone A */
    "hero   hero"      /* Zone B — sprite spans both columns, centered */
    "model  activity"; /* Zone C */
  align-items: center;
  column-gap: var(--ct-space-s);
  row-gap: var(--ct-space-xs);
}

.agent-tile[data-has-sprite="true"] > .sprite-box        { grid-area: hero;     justify-self: center; }
.agent-tile[data-has-sprite="true"] > .tile-row--primary { grid-area: name;     justify-self: start; }
.agent-tile[data-has-sprite="true"] > .tile-row--role    { grid-area: role;     justify-self: end; }
.agent-tile[data-has-sprite="true"] > .tile-row--model   { grid-area: model;    justify-self: start; }
.agent-tile[data-has-sprite="true"] > .tile-row--activity{ grid-area: activity; justify-self: end; }
```

**Decision — activity placement (§2.3 below):** the mockup shows the activity/tool string `tool:Edit` CENTER of the bottom row, bold, with model left and count-hint right. The components emit activity (row 3) and model+count (row 4) as separate rows. In a 2-cell bottom bar I place **model left / activity right** and let the `(N agents)` count-hint stay appended to the model row (it's a child of `.tile-row--model`, see `multiAgentPersonaTile.ts:392-395`). See §8 for why a literal 3-up "model · activity · count" bottom row would require a component edit (out of scope for a design pass).

### 2.3 Indent reset (load-bearing)

Rows 2-4 currently carry a left indent to align past the state dot: `.tile-row--role, --activity, --model { padding-left: calc(--ct-state-dot-size + --ct-state-dot-gap) }` (`dashboard.css:343-347`). In the hero layout these rows are no longer stacked under the dot — they're in their own grid cells — so the indent is wrong and must be zeroed inside the hero scope:

```css
.agent-tile[data-has-sprite="true"] > .tile-row--role,
.agent-tile[data-has-sprite="true"] > .tile-row--activity,
.agent-tile[data-has-sprite="true"] > .tile-row--model {
  padding-left: 0;
}
```

### 2.4 Flex-column alternative (NOT recommended)

A pure `flex-direction:column` with `order:` on children can stack the 3 zones, but it cannot place two rows side-by-side in one zone (Zone A's name|role, Zone C's model|activity) without wrapping each zone's two rows in a parent element — which the components don't emit. Grid with `grid-template-areas` does the 2-up zones with zero DOM change. **Grid is the recommendation.**

---

## 3. Hero sprite size — concrete px + scaling

### 3.1 Decision: hero size SCALES with column width (carry-forward of the #156 container-query rec, re-tuned)

The #156 spec established that the panel is a resizable container and the sprite should scale with the **panel drag** (container-query units `cqw`), capped. The sponsor's "scale when I make the dashboard column wider (until a certain point)" still applies — the hero just starts bigger and caps higher. So the hero size is **`clamp(min, grow, max)` on the existing `--ct-sprite-size` token**, same mechanism as #156, new numbers.

### 3.2 Concrete numbers (recommended starting table — render-time tunable, zero gens)

| | px | Rationale |
|---|---|---|
| **Baseline / min** | **140px** | The hero floor on a narrow panel. Mockup says ~150–180; 140 keeps the card from overflowing a ~240px narrow side bar (see §3.3 width math). |
| **Preferred (slope)** | **48cqw** | At ~300px container → ~144px (≈ floor on narrow). At ~360px → ~173px (mockup's sweet spot). Caps shortly after. |
| **Max / cap** | **176px** | Top of the mockup's stated range (~150–180). "Until a certain point." |

```css
:root {
  /* Hero baseline — was 68px (2-column era). Fallback for non-container /
   * reduced-motion contexts. Three sub-tokens so the sponsor live-tunes
   * each independently without touching the clamp rule. */
  --ct-sprite-size: 140px;
  --ct-sprite-size-min: 140px;
  --ct-sprite-size-max: 176px;
  --ct-sprite-grow: 48cqw;
}

.session-block { container-type: inline-size; container-name: ct-panel; }

@container ct-panel (min-width: 0) {
  .agent-tile[data-has-sprite="true"] {
    --ct-sprite-size: clamp(
      var(--ct-sprite-size-min),
      var(--ct-sprite-grow),
      var(--ct-sprite-size-max)
    );
  }
}
```

Because `--ct-sprite-size` already feeds `.sprite-box` w/h, `.sprite-frame` w/h, **redefining the token inside the hero tile is the whole sizing change** — no per-element edits.

> Slope/cap are **math-derived, not eyeballed** — the sponsor nudges on a live reload (zero cost). Same posture as the playback-override table in the persona-anim doc.

### 3.3 Width math (does the hero fit a narrow panel?)

Horizontal chrome from the panel inner edge to the sprite box (from #156 §2, re-verified against the live padding tokens): `#root` 12 + `.session-block` 16 + `.team-card` 12 + `.agent-tile` 8 = 48px/side → **~96px total**. On a narrow ~240px side bar the card content width ≈ **144px**. A 140px hero **just fits**; that is why the floor is 140, not 160. On the comfortable ~330–360px panel the card has ~234–264px and the hero sits at its 160–176 sweet spot, with the top/bottom meta bars getting their breathing room. **Decision flagged:** if the sponsor wants the floor at the mockup's 150–160 even on the narrowest panel, the hero would slightly clip on a <250px side bar — acceptable? (sponsor call — §10 Q1).

---

## 4. Single-agent vs multi-agent · collapsed vs expanded

| Card type | Hero layout applies? | Notes |
|---|---|---|
| **Single-agent** (`renderAgentTile`, `[data-has-sprite=true]`, no `data-count`) | **YES** | Same 3-zone grid. Zone A has dot+name (no `×N` badge); Zone C has model + activity (no count-hint). The mockup is multi-agent but the layout is identical minus the multiplicity chrome. **Recommended: hero applies to both** — consistency is the whole-team-display thesis. |
| **Multi-agent COLLAPSED** (`renderMultiAgentPersonaTile`, `data-count`, instances `hidden`) | **YES — this IS the mockup.** | `×N ▸` badge sits in Zone A next to the name (it's a child of `.tile-row--primary`, so it rides into the `name` area). `(N agents)` count-hint rides with the model in Zone C (child of `.tile-row--model`). |
| **Multi-agent EXPANDED** (instances visible) | **YES, hero stays + instance list flows below Zone C** | The `.persona-instances` region is appended AFTER row 4 in the DOM (`multiAgentPersonaTile.ts:428`). It is NOT assigned a `grid-area`, so it lands in an **implicit grid row below the explicit 3** (grid auto-placement). It spans full width naturally. The compact instance rows stay **sprite-less** (verified `multiAgentPersonaTile.ts:509` "NO sprite") — so expansion adds a list under the hero, it does not multiply sprites. **Safe.** See §8.2. |

**Decision flagged (§10 Q2):** in the EXPANDED state the hero sprite + the instance list both show — the card gets tall. Acceptable (sponsor's whole-team thesis favors presence), or should expanded mode shrink the hero back toward 68px to make room? Recommendation: **keep the hero; let the card grow** — collapsing the hero on expand would make the sprite "jump" size on a click, which reads as jank.

---

## 5. Idle vs working pose at hero size

The mockup shows the **working-at-desk** pose (`active_work`). At hero size (140–176px) the SAME `.sprite-frame` renders whatever pose the state resolves — idle pool (`idle_coffee`, `idle_stretch`, `idle_snack`, etc.) plays at the hero size too, since pose selection is independent of size (`createSpriteBox` picks the pose from `state`/`activity`; CSS sizes the box).

**Confirmation: hero size is fine for idle poses, including the merged `idle_stretch` pingpong.** Reasoning:

- All persona poses are authored at the same 48px PixelLab source and the same south-view frame canvas (per `persona-pixel-character-animation-prompts.md` § Operational pipeline). They scale uniformly — no pose has a different intrinsic size. A 140–176px box that works for `active_work` works identically for every idle pose.
- `idle_stretch` reaches arms-overhead at its peak frame (M01 frame 8 / F01 frame 5 per the playback table). At hero size the overhead reach is BIGGER but stays inside the square sprite box (the source frame already contains the full stretched silhouette within its canvas — PixelLab composes the whole pose inside the frame). **No clipping concern** — the box scales the whole frame, arms included.
- The calm always-visible idle variety is the REASON the hero is justified (`[[dashboard-whole-team-always-visible-thesis]]`) — bigger idle poses make the always-on tile more characterful, not less.

**One watch-item (flagged, not a blocker):** at hero size, pixel-source identity drift between a character's pose-states (the `create_character_state` re-synthesis drift noted in the anim doc § Identity-consistency) is MORE visible than at 68px. If a character's `active_work` desk and its `idle_coffee` standing pose differ slightly in proportion/color, that's more noticeable when large. This is a SPRITE-ASSET concern (re-roll the state if it's jarring), not a layout one — flagged for the sponsor's eye on reload (§10 Q3).

---

## 6. Pixel crispness at hero size

`image-rendering: pixelated` is already set (`dashboard.css:329`) and is the whole-job property: nearest-neighbour, hard edges, never blurry at any scale. Carry-forward of #156 §4:

- **Source is 48px** (PixelLab `size=48`). Integer multiples: 48 / 96 / **144** / 192. The hero range 140–176 brackets the **144 (=3×) integer multiple** — landing the cap or floor on 144 gives perfectly uniform pixel doubling.
- **Recommendation: keep continuous `clamp()` scaling** (matches the "scale when wider" gesture). `image-rendering: pixelated` keeps it crisp (hard-edged) at every ratio; the only artifact of non-integer is slightly uneven pixel WIDTHS, never blur. A stepped ladder would make the sprite jump in jerks on drag — visually worse and contrary to the request.
- **Cheap fallback if shimmer is reported on a live drag:** snap the floor or cap to **144px (exact 3×)** for a perfectly-crisp pinned size. Offer only if the sponsor reports shimmer — default continuous. (§10 Q4.)

---

## 7. Tokens / selectors Maya changes

Everything stays in tokens for live tuning (per design discipline + the token-source-of-truth block at `dashboard.css:84-92`).

| Change | Where | Note |
|---|---|---|
| Bump hero baseline + add 3 sub-tokens | `:root` near `dashboard.css:89` | `--ct-sprite-size: 140px` (from 68); add `--ct-sprite-size-min/max/grow` |
| Add container | `.session-block` (`dashboard.css:130`) | `container-type: inline-size; container-name: ct-panel;` (carry-forward #156) |
| Scale the token | new `@container ct-panel { .agent-tile[data-has-sprite=true] { --ct-sprite-size: clamp(...) } }` | redefines the existing token; box + frame follow |
| **Re-flow the grid (the hero change)** | replace `.agent-tile[data-has-sprite="true"]` rule at `dashboard.css:297-302` | 2-column → 3-zone `grid-template-areas` (§2.2) |
| Re-place each existing child | new `grid-area` rules for `.sprite-box` + each `.tile-row--*` (§2.2) | replaces the old `grid-column:1 / grid-row:1/-1` (sprite) + `grid-column:2` (rows) rules at `dashboard.css:305-314` |
| Zero the row indent in hero scope | new rule (§2.3) | rows 2-4 no longer stacked under the dot |

**Unchanged:** `.sprite-box` / `.sprite-frame` sizing rules (they already consume `--ct-sprite-size`); the kebab `.agent-tile-overflow` absolute positioning (still anchors to `.agent-tile{position:relative}`); all #155 color/bg tokens; the `.persona-instances` expand region (auto-places below). **No component (.ts) edit required** — this is pure CSS over the existing markup.

---

## 8. Layout safety

### 8.1 vs PR #155 (whole-card-light)
#155 changes `.agent-tile` **bg/border/text color** only (`--ct-card-bg`, `--ct-card-hairline`, dark-on-light text/chrome) — it does NOT touch the grid template, `--ct-sprite-size`, `.sprite-box`, or `.sprite-frame` (verified `gh pr diff 155`). This spec ONLY re-flows the grid + scales the token. **No overlap** — the two edits touch disjoint property sets on `.agent-tile`. The hero sprite reads BETTER on the light card (more portrait presence — #155's whole intent). **Maya sequences this after #155 merges** so the `--ct-card-*` tokens exist. The grid re-flow rule REPLACES the body of `.agent-tile[data-has-sprite="true"]`, which #155 does not touch — clean.

### 8.2 Multi-agent badge + count-hint + instances
- The `×N ▸` badge is a child of `.tile-row--primary` (`multiAgentPersonaTile.ts:360`), so it travels into the `name` grid area automatically — no separate placement. It sits inline after the name, matching the mockup's `iris ×2 ▸`.
- The `(N agents)` count-hint is a child of `.tile-row--model` (`multiAgentPersonaTile.ts:395`), so it travels into the `model` grid area. In the mockup it's the right-most bottom item; here it rides with the model on the LEFT of the bottom bar. **Decision flagged (§10 Q5):** the mockup's exact bottom order is `model(left) · activity(center) · count(right)` — a literal 3-up. My CSS-only layout yields `model+count(left bar) · activity(right bar)`. Matching the mockup's 3-up exactly would require splitting the count-hint out of the model row in the component (a .ts edit) — OUT OF SCOPE for a design pass. Recommend: ship the CSS-only 2-up bottom bar; if the sponsor wants the literal 3-up, file a small follow-up for the component split.
- `.persona-instances` (expand region) is appended after row 4 and carries no `grid-area`, so grid auto-placement drops it in an implicit 4th row, full-width below Zone C. It declares `display:flex` + toggles via `hidden` and ALREADY has its `[hidden]` guard (per `vscode-extension-conventions.md` § [hidden]-toggled popovers). **The hero grid does not break the expand region.** Verify on reload that auto-placement lands it below (expected — implicit rows stack after explicit ones).

### 8.3 Sprite-less tiles
Tiles WITHOUT `data-has-sprite` keep the original `flex-direction:column` layout (`dashboard.css:270-280`) untouched — the hero grid is scoped to `[data-has-sprite="true"]`. A member whose sprite fails to resolve degrades to the text stack exactly as today. **Safe.**

### 8.4 Text-fit at hero width
Zone A: name + `×N ▸` on the left, role on the right of a ~144–264px bar. Long roles ("UX Designer", "Extension Host Dev") fit; if a role is very long it wraps within its cell (it's a `.tile-row` flex span, no `white-space:nowrap` on `.agent-role`). Zone C: model (`claude-opus-4-8`, ~13 chars monospace) + count left, activity right — `tool:Edit src/...` activity wraps within its cell (`.agent-activity` is `word-break:break-word`, `dashboard.css:359-366`, never truncates). **No clipping** — both bars degrade by wrapping. Flag: on the narrowest panel the two-up bars get tight; the sponsor eyeballs (§10 Q1).

---

## 9. ASCII mock — single-agent + multi-agent (collapsed + expanded)

**Multi-agent COLLAPSED (the sponsor mockup), comfortable ~360px panel, hero ~173px:**

```
┌─ agent-tile (light card #155) ────────────────────────┐
│  ● iris  ×2 ▸                            UX Designer   │  ← Zone A
│                                                        │
│                  ┌────────────────────┐                │
│                  │                    │                │
│                  │     [ sprite ]     │                │  ← Zone B
│                  │      ~173px        │   (desk pose)  │
│                  │                    │                │
│                  └────────────────────┘                │
│                                                        │
│  claude-opus-4-8 (2 agents)              tool:Edit     │  ← Zone C
└────────────────────────────────────────────────────┐⋯┘  (kebab on hover)
```

**Single-agent, same panel:**

```
┌─ agent-tile (light card #155) ────────────────────────┐
│  ● Felix                              Extension Host   │  ← Zone A (no ×N badge)
│                  ┌────────────────────┐                │
│                  │     [ sprite ]     │                │  ← Zone B
│                  └────────────────────┘                │
│  claude-opus-4-8            tool:Edit src/extension/…  │  ← Zone C (no count hint)
└────────────────────────────────────────────────────┐⋯┘
```

**Multi-agent EXPANDED — hero stays, instance list flows below Zone C:**

```
┌─ agent-tile ──────────────────────────────────────────┐
│  ● iris  ×2 ▾                            UX Designer   │  ← Zone A (chevron ▾)
│                  ┌────────────────────┐                │
│                  │     [ sprite ]     │                │  ← Zone B (hero held)
│                  └────────────────────┘                │
│  claude-opus-4-8 (2 agents)              tool:Edit     │  ← Zone C
│ ┌────────────────────────────────────────────────────┐│
│ │ ● a1b2c3d4  tool:Edit src/foo.ts                   ││  ← .persona-instances
│ │ ● e5f6a7b8  idle 12s                               ││     (auto-placed row 4,
│ └────────────────────────────────────────────────────┘│      sprite-less rows)
└────────────────────────────────────────────────────┐⋯┘
```

**Narrow ~240px panel — hero pinned at 140px floor, two-up bars get tight:**

```
┌─ agent-tile (~144px content) ──┐
│ ● iris ×2 ▸        UX Designer  │  ← Zone A (tight; role may wrap)
│      ┌──────────────┐          │
│      │  [ sprite ]  │          │  ← Zone B
│      │   140px      │          │
│      └──────────────┘          │
│ opus (2)         tool:Edit     │  ← Zone C
└──────────────────────────────┘
```

---

## 10. Decisions I made — ALL need sponsor confirmation

| # | Decision | What I chose | Alternative |
|---|---|---|---|
| **Q1** | **Hero floor px / narrow-panel fit** | Floor **140px** so the hero fits a ~240px narrow side bar (~144px content). | Floor 150–160 (matches mockup low end) but clips slightly on <250px panels. Sponsor: is a tight/slightly-clipped hero on the narrowest side bar acceptable, or hold the floor at 140? |
| **Q2** | **Hero on single-agent too** | **YES** — single + multi share the hero (consistency, whole-team thesis). | Hero only for multi-agent; single stays the 2-column 68px tile. |
| **Q3** | **Expanded multi-agent: hero size** | **Hold the hero**; let the card grow + instance list flows below. | Shrink hero toward 68px on expand to save height (but the sprite "jumps" size on click — reads as jank). |
| **Q4** | **Hero cap px** | **176px** (top of the mockup's ~150–180 range). | 144px = exact 3× source = perfectly crisp pinned size (lower but flawless pixels). |
| **Q5** | **Bottom-bar order** | **CSS-only 2-up**: `model + (N agents)` left, `activity` right. | Mockup's literal 3-up (`model · activity · count`) needs a component edit to split the count-hint out of the model row — out of scope for a design pass; file a follow-up if wanted. |
| **Q6** | **Continuous vs stepped scaling / crispness** | **Continuous `clamp()`** (smooth, matches "scale when wider"); `image-rendering:pixelated` keeps it crisp. | Stepped (snap to 144) only if continuous shimmers on a live drag — sponsor's eye is the gate. |
| **Q7** | **Identity drift at hero size** | Flagged as a sprite-asset watch-item, not a blocker — bigger size makes per-character pose-drift more visible; re-roll the offending STATE if jarring. | Accept drift (it's subtle); revisit only if the sponsor flags a specific character on reload. |
| **Q8** | **Fold/retarget the #156 `iris-design/` doc** | This `iris-ux/` doc supersedes it; close/retarget PR #156 onto this. | Keep both docs (NOT recommended — two Iris dirs + a stale 2-column rec). Orchestrator's call. |
