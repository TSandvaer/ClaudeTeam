# Pixel-art SCENE backgrounds behind dashboard characters — design brief

Ticket: `86ca26enf` (original design) · `86ca3kjyk` (FULL-BLEED + SCRIM firming — this pass) · Author: Iris · DESIGN PASS (no production code, no PixelLab generation)

> **READ THIS FIRST — the firming pass (`86ca3kjyk`) supersedes Catch 2's hero-zone recommendation.** §0–§4 below are the original `86ca26enf` design exploration (options A/B/C/D, recommendations, sponsor-question matrix). The sponsor subsequently chose **FULL-BLEED** (scene edge-to-edge behind the whole card), which was Catch 2's *fallback* (2B/2C), not its default (2D hero-zone-only). The authoritative implementation-ready spec is **§FIRM — Full-bleed + scrim (LOCKED)** at the bottom of this doc. Where §FIRM and the original §2 (Catch 2) conflict, **§FIRM wins.** The original text is retained for design rationale + the still-valid Catch 1 (desk-overlap) and Catch 3 (per-role) analysis, both of which the full-bleed decision does NOT change.

> **Sponsor idea (as relayed — I have not seen an image):** replace the flat light card "stage" behind each persona character with a **pixel-art ENVIRONMENT scene** (office / living-room / studio) filling the card, so the agent stands *in a place* instead of on a blank light surface.

> **Companion work:** Bram is researching the PixelLab / pipeline FEASIBILITY (can we generate a scene tile of the right aspect, layering, transparency, credit cost) in parallel. **This brief is the VISUAL / COMPOSITION / READABILITY design only** — it references but does not duplicate his technical angle. Where a recommendation depends on a pipeline capability I can't verify here, it's flagged `Pipeline-gated (Bram)`.

---

## 0. What the card is TODAY (grounded in live `dashboard.css` on main `b521791`)

Two pieces of merged work define the current stage. Both verified against the live file this task (line refs are post-#158, post-#155):

1. **Whole-card light bg (`86ca23utq`, PR #155, merge `b9ab42e`).** `.agent-tile` carries `background-color: var(--ct-card-bg)` = `#ECEFF1` (`dashboard.css:353`, `:129`) + a `--ct-card-hairline` border (`:354`). Text/dot/chrome were flipped **dark-on-light** (`--ct-card-fg #1f2933` ≈13:1, `--ct-card-fg-muted #52606d` ≈6:1 — `dashboard.css:152-153`, contrast ratios quoted in the source comment `:137-138`). **The sprite sits DIRECTLY on the lit card** — the old separate inner "stage panel" was removed (`.sprite-box` comment `dashboard.css:472-475`: "a redundant inner light panel here would just double-paint").

2. **Hero 3-zone layout (`86ca2522v`, PR #158, merge `b521791`).** `.agent-tile[data-has-sprite="true"]` is a 3-zone vertical grid (`dashboard.css:393-404`):

```
   grid-template-areas:
     "name   role"      ← Zone A — TOP META BAR  (.tile-row--primary | .tile-row--role)
     "hero   hero"      ← Zone B — HERO SPRITE    (.sprite-box, spans both cols, centered)
     "model  activity"; ← Zone C — BOTTOM META BAR (.tile-row--model | .tile-row--activity)
```

   The sprite is sized by the single `--ct-sprite-size` token (clamp 140→176px, `dashboard.css:111-113`, `:456-464`), `image-rendering: pixelated` (`:482`). `.persona-instances` (multi-agent expand) auto-places full-width below Zone C (`:446-448`).

**Two facts the scene MUST respect (both verified, both load-bearing):**

- **The whole-card-light work EXISTS to make text legible on a flat surface.** A busy scene behind the Zone A / Zone C text directly fights what #155 just bought. The contrast ratios (13:1, 6:1) were computed against `#ECEFF1` flat — they DO NOT hold over an arbitrary pixel scene.
- **The sprite has NO separate stage panel anymore.** A scene goes behind the *whole card* or behind the *hero zone* — there is no intermediate "sprite stage" element to drop it into without re-introducing one.

---

## CATCH 1 — DESK-POSE OVERLAP (the two-desks problem)

**The conflict (verified against the persona-anim doc).** The `active_work` pose is a `create_character_state` that **bakes a desk + monitor + keyboard into the sprite's reference rotation** — quoting the doc verbatim: *"sitting at a desk facing a computer monitor with both hands resting on the keyboard, the desk monitor and keyboard fully in view"* (`persona-pixel-character-animation-prompts.md:107`). `active_read` shares that same desk state (`:30`). So for the two TOOL-USE poses the character ALREADY brings its own desk. A full office scene *behind* that = **two desks** (the baked sprite desk + the scene desk), at different pixel scales/angles — reads broken.

The idle pool is the opposite: `idle_coffee`, `idle_stretch`, `idle_snack`, `idle_phone`, `idle_hips`, etc. are all **standing, deskless** poses (`:80-102`) — a room behind a standing character reads correctly.

So the scene-vs-pose relationship is **pose-dependent**, and the conflict is isolated to exactly the 2 desk poses out of ~14.

### Options

| Option | What it is | Verdict |
|---|---|---|
| **1A — Scene only behind DESKLESS poses; desk poses keep flat bg** | When the resolved pose is `active_work`/`active_read`, suppress the scene (flat `--ct-card-bg` shows); for every idle pose, show the scene. The character "steps into the room" when idle, "sits at its own desk" when working. | **Pipeline-simple, but visually jarring** — the bg flips on/off every time the agent toggles working↔idle (which is *constantly*). The card's backdrop blinking on each tool-call reads as flicker, not as intent. ✗ |
| **1B — Rework the desk poses to sit IN the scene (deskless work pose + scene desk)** | Re-roll `active_work`/`active_read` as a SEATED-BUT-DESKLESS state (character seated/typing in mid-air posture) and let the SCENE supply the desk. | **High production cost + high risk.** The desk-pose doc is a minefield of validated gotchas (desk-rises-from-ground, pro-engine escalation, `:106-108`, `:24-28`) — a "seated, no desk, hands typing on a desk that isn't in the sprite" pose is unproven and the hands wouldn't align to the scene's desk at the pixel level. Re-rolling 10 chars × 2 poses to chase scene-alignment is a large gen + validation spend. ✗ for V1. |
| **1C — Scene-per-pose-CLASS mapping: ROOM behind idle, DESK-NOOK (or no scene) behind work** | Treat the scene as a property of the pose *class*. Idle poses → a "room" scene (sofa/plants/window). Desk poses → EITHER no scene (flat, as today) OR a tightly-cropped "desk nook" scene that frames AROUND the baked desk (a window + wall behind the monitor, never a second desk). One scene asset per class, not per pose. | **Best balance** — but the flip-on-toggle flicker of 1A still applies if idle and work use *different* backdrops. |
| **1D (RECOMMENDED) — ONE persistent room scene; desk poses keep the SAME room, baked desk reads as "their desk in the room"** | The scene is a **standing-height room** (back wall + floor + a window/plant/shelf — NO scene desk). It stays constant across ALL poses. For idle poses the character stands in the room (correct). For `active_work`/`active_read` the character's BAKED desk simply appears *in front of* the room wall — a person sitting at their own desk against a back wall reads completely naturally (that's what every real office looks like). **No second desk, because the scene never contained a desk** — it's a room, not an office-with-furniture. The backdrop NEVER flips, so no flicker. | ✓ |

### Recommendation — **1D: a deskless ROOM scene, constant across all poses.**

The insight that resolves Catch 1: **the scene must NOT contain furniture the sprite also carries.** Make the scene a *backdrop* (wall + floor + ambient props high/wide enough to never collide with a foreground desk) — never a *furnished room*. Then the baked desk reads as the character's own desk standing in that room, and the idle standing poses read as the character standing in that same room. One asset, zero flips, zero double-desk.

- The "office" framing in the sponsor's idea becomes a **room backdrop** (back wall + floor line + 1-2 high/side ambient elements: a window, a wall shelf, a plant, a poster). Foreground floor space stays clear so the baked desk has somewhere to sit.
- `Pipeline-gated (Bram):` whether PixelLab can produce a backdrop-only scene (props anchored to wall/edges, clear center-foreground) at the card's aspect is his call. If it can only produce fully-furnished rooms, fall back to **1C with NO scene behind desk poses** (flat behind work, room behind idle) and accept the flip — but flag the flicker for sponsor.

---

## CATCH 2 — READABILITY (scene vs. the meta-text)

**The problem, grounded.** #155 computed `--ct-card-fg` 13:1 and `--ct-card-fg-muted` 6:1 **against flat `#ECEFF1`** (`dashboard.css:137-138`). Those ratios are VOID over a pixel scene — a scene has light AND dark regions, so dark slate text (`#1f2933`) vanishes wherever the scene is dark, and muted grey (`#52606d`) vanishes almost everywhere it isn't pale. The Zone A name/role and Zone C model/activity/tool strings are the dashboard's at-a-glance job; they cannot fight a busy backdrop.

### Options

| Option | What it is | Cost | Verdict |
|---|---|---|---|
| **2A — Text-shadow on the meta text** | Add `text-shadow` halo so text survives any bg. | CSS-only | Weak alone — a halo over a *busy pixel* bg still reads muddy; and a glow clashes with the crisp pixel aesthetic. ✗ as the primary. |
| **2B — Scrim/gradient behind each text zone** | A semi-opaque band (light or dark) sits behind Zone A and Zone C only, restoring a flat contrast surface under the text while the scene shows behind the hero. | CSS-only (a `::before` or a bg on the zone rows) | **Strong** — text keeps a known surface, scene still visible behind the character. The scrim can be the SAME `#ECEFF1` (or a translucent version) so the existing 13:1/6:1 ratios survive verbatim. ✓ |
| **2C — Solid meta-bar over the scene** | Zone A and Zone C are fully-opaque `--ct-card-bg` bars; scene shows ONLY in the Zone B (hero) band between them. | CSS-only | Functionally **2B taken to full opacity** — cleanest contrast guarantee, and it visually frames the scene as a "window" between two solid bars. Slightly less immersive (scene is a center strip). ✓✓ |
| **2D (RECOMMENDED) — Confine the scene to the HERO zone (Zone B) only; keep Zone A + Zone C on flat `--ct-card-bg`** | The scene fills ONLY the center hero band behind the sprite. The top and bottom meta bars stay exactly the flat-light surface #155 shipped — so their contrast ratios are **untouched and already-proven**. The scene becomes the character's "stage backdrop," framed by the two meta bars like a diorama. | CSS-only | ✓✓✓ |

### Recommendation — **2D: scene behind the HERO ZONE ONLY; meta bars stay flat.**

This is the cleanest answer and it composes *perfectly* with the merged hero layout:

- The 3-zone grid ALREADY isolates the hero (Zone B) from the meta bars (Zones A, C). The scene is a `background-image` on the hero zone, NOT on the whole `.agent-tile`. Zones A and C keep `--ct-card-bg` flat → **the 13:1 / 6:1 contrast ratios #155 computed remain literally true, zero re-verification needed.**
- It reframes the sponsor's "scene fills the card" slightly: the scene fills the card's **visual focal zone** (where the character is), and the meta stays on the lit surface. This is *better* design than full-bleed — the meta is data, the hero is the show; giving each its own surface is exactly the signal-density discipline the dashboard runs on.
- It also makes Catch 1 easier: the scene only needs to look right *behind the sprite*, not behind text — fewer composition constraints on the asset.
- **If the sponsor specifically wants full-bleed** (scene edge-to-edge incl. behind the meta), the fallback is **2B/2C**: keep the scene full-card but lay a translucent-`#ECEFF1` scrim (≈0.82 alpha) behind Zone A + Zone C so text rides a near-flat surface. Recommend offering 2D as default, 2C as the "I want it fuller" upgrade.

`Implementation note (for Maya, not this pass):` the scene is `background-image` + `image-rendering: pixelated` + `background-size: cover` on a hero-zone surface; it must sit BEHIND `.sprite-frame` (z-order) and never intercept the tile's click target. CSS-only; no component edit (same posture as the hero layout itself).

---

## CATCH 3 — PER-ROLE vs SHARED scene

| | Pro | Con |
|---|---|---|
| **Shared (one generic room for everyone)** | 1 scene asset total. Trivial credit cost. Fast to ship. Uniform → the eye reads *character* differences, not bg noise. | No per-persona identity; misses the "Iris works in a design studio" charm the sponsor is reaching for. |
| **Per-role (Iris=studio, Felix=dev rig, Sage=QA lab, Nora=planning board, Maya=design-dev bench, Bram=research desk)** | Strong identity + variety; reinforces the whole-team-display thesis (`[[dashboard-whole-team-always-visible-thesis]]`) the same way idle-pose variety does. | N scenes to generate + validate (`Pipeline-gated (Bram)` for the real per-scene cost); more production load; risk of N busy bgs making the GRID of cards noisy when many are shown at once. |

### Recommendation — **Start SHARED (one room), architect for per-role.**

- **V1 starting point: ONE shared room scene** behind every character. It proves the composition (Catches 1 + 2), gets the look in front of the sponsor for one credit-cheap gen, and avoids committing 6+ scene gens before the sponsor has seen *any* scene work on a real reload.
- **Architect the wiring per-role from day one** so the upgrade is data-only: the scene should resolve via the same manifest pattern the poses use — a `scene` field keyed per persona (`Pipeline-gated (Bram)` for asset format), defaulting all personas to the one shared room until per-role assets exist. Then "give Iris a studio" is a single asset drop + manifest line, no layout change.
- **Noise check (design discipline):** when MANY cards show at once, 6 *different* busy bgs fight each other. **2D (scene confined to hero zone) mitigates this** — the scenes are small framed bands, not full-card walls, so a grid of them stays calm. This is another reason 2D + shared-start is the safe sequence: prove calm-at-scale with one scene before multiplying.

---

## How it integrates with the merged HERO 3-zone layout

**Scene fills the HERO CENTER zone (Zone B), NOT the whole card** (per Catch 2 rec 2D). Concretely:

- Zone A (`name`/`role`) and Zone C (`model`/`activity`) keep `--ct-card-bg` flat — untouched, contrast preserved.
- Zone B (`hero`) gets the scene as a `background-image` layer behind `.sprite-frame`.
- The `--ct-sprite-size` clamp (140→176px) is unchanged; the scene sizes to the hero zone, the sprite floats in front at its token size.
- `.persona-instances` (expand list) is below Zone C on flat bg — **no scene behind the instance rows** (they're sprite-less compact rows; a scene there would re-introduce the readability fight). Verified those rows are sprite-less (`multiAgentPersonaTile.ts` "NO sprite", per the hero spec §4).
- Sprite-less tiles (`[data-has-sprite]` absent) get **no scene** — they're the flat text-stack fallback; nothing to stage.

---

## ASCII mock — card with a hero-zone scene (recommendation: 2D + 1D + shared)

**Multi-agent collapsed, comfortable ~360px panel, hero ~173px:**

```
┌─ agent-tile (flat light #ECEFF1) ─────────────────────┐
│  ● iris  ×2 ▸                            UX Designer   │  ← Zone A  (FLAT bg — text safe)
│ ┌────────────────────────────────────────────────────┐│
│ │▓▓▓ window ▓▓▓        shelf ▒▒▒        ░plant░        ││  ← Zone B  (SCENE: room backdrop)
│ │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ back wall ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒││
│ │                ┌──────────────┐                     ││
│ │                │  [ sprite ]  │  ← character stands ││
│ │░░░░░ floor ░░░░░│   ~173px     │░░ in the room ░░░░░░││
│ │░░░░░░░░░░░░░░░░░└──────────────┘░░░░░░░░░░░░░░░░░░░░░░││
│ └────────────────────────────────────────────────────┘│
│  claude-opus-4-8 (2 agents)              tool:Edit     │  ← Zone C  (FLAT bg — text safe)
└────────────────────────────────────────────────────┐⋯┘
```

**Same card, `active_work` pose (Catch 1 / 1D — baked desk reads as "their desk in the room"):**

```
│ ┌────────────────────────────────────────────────────┐│
│ │▓▓▓ window ▓▓▓        shelf ▒▒▒        ░plant░        ││  ← SAME room scene (never flips)
│ │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ back wall ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒││
│ │              ┌──────────────────┐                   ││
│ │              │ [ sprite seated  │  ← baked desk +   ││
│ │░░░ floor ░░░░│   at OWN desk ]  │░░ monitor sit in  ░││
│ │░░░░░░░░░░░░░░└──────────────────┘░ FRONT of the wall││
│ └────────────────────────────────────────────────────┘│   → one desk, reads natural
```

**Fallback 2C (sponsor wants fuller scene) — solid meta bars frame a full-card scene:**

```
┌──────────────────────────────────────────────────────┐
│  ● iris  ×2 ▸                            UX Designer   │  ← solid --ct-card-bg bar OVER scene
├──── (scene continues edge-to-edge behind everything) ──┤
│ ▓▓▓ room scene with the hero sprite floating in it ▓▓▓ │
├────────────────────────────────────────────────────────┤
│  claude-opus-4-8 (2 agents)              tool:Edit     │  ← solid bar OVER scene
└──────────────────────────────────────────────────────┘
```

---

## Decisions I made — ALL need sponsor confirmation

| # | Decision | What I chose | Alternative |
|---|---|---|---|
| **Q1** | **Whole-card vs hero-zone-only scene** | **Hero zone (Zone B) ONLY** — meta bars stay flat, #155's proven contrast preserved. | Full-bleed scene + translucent scrim behind meta (2C). Offer as the "fuller" upgrade. |
| **Q2** | **Desk-pose overlap fix** | **1D — deskless ROOM backdrop** (wall+floor+ambient, NO scene furniture); constant across all poses; the baked desk reads as the char's own desk in the room. No bg flip, no double-desk. | 1C (no scene behind desk poses, room behind idle — but flickers on toggle); 1B (re-roll desk poses — high cost/risk). |
| **Q3** | **Per-role vs shared** | **Start SHARED (1 room), architect per-role** via a manifest `scene` field defaulting to the shared asset. | Per-role from the start (more identity, but 6+ gens + noisy grid before the look is proven). |
| **Q4** | **Scene behind expand-list / sprite-less tiles** | **NO scene** on `.persona-instances` rows or sprite-less tiles — flat, to keep those readable. | Extend scene there (re-introduces readability fight — not recommended). |
| **Q5** | **Asset framing constraint** | Scene must be a **backdrop (wall+floor), NOT furnished** — clear foreground so the baked desk never collides. | A furnished office scene — but then desk poses double-desk (Catch 1). |

## Open questions for the sponsor

1. **Q1 — confine to hero zone (default) or full-bleed-with-scrim?** Recommend hero-zone; it preserves the contrast work and stays calm when many cards show.
2. **Q2 — accept the "deskless room backdrop, baked desk in front" model?** It's the only option with zero bg-flip AND zero double-desk; needs the asset to be a backdrop not a furnished room.
3. **Q3 — OK to ship ONE shared room first, add per-role studios later?** Cheaper, proves the look, upgrade is data-only.

## Cross-references / unverified flags

- `Pipeline-gated (Bram):` whether PixelLab can produce (a) a backdrop-only scene with clear foreground, (b) the hero-zone aspect ratio, (c) per-scene credit cost, (d) the asset/manifest format — all his feasibility angle. This brief assumes "a pixel scene image can be produced and dropped behind the hero zone"; if any of those is infeasible, the recommendations downgrade as noted inline.
- Card-structure claims grounded in live `dashboard.css` on main `b521791` (verified this task): card-bg `:353`/`:129`, contrast comments `:137-138`/`:152-153`, hero grid `:393-404`, sprite token `:111-113`/`:456-464`, sprite-on-card-no-stage-panel `:472-475`.
- Desk-pose facts grounded in `.claude/docs/persona-pixel-character-animation-prompts.md` (`active_work` state `:107-108`, `active_read` shares it `:30`, idle pool deskless `:80-102`).
- Hero layout context: `team/iris-ux/card-hero-layout.md` (`86ca2522v`, merged PR #158).
- `[[dashboard-whole-team-always-visible-thesis]]` — why variety/identity is load-bearing (supports per-role *eventually*).

---

# §FIRM — Full-bleed + scrim (LOCKED) · ticket `86ca3kjyk`

**This section is the implementation-ready spec Maya builds against.** It firms the scrim/readability solution flagged "needs fleshing" in the original `86ca26enf` pass. The sponsor chose **full-bleed** (scene edge-to-edge behind the whole `.agent-tile`), so the original §2 default (2D, hero-zone-only) does NOT apply; the readability burden moves onto a **scrim** treatment, specified concretely below.

## §FIRM.0 — Validated inputs (grounded this task)

Everything below is grounded in artefacts read THIS task, not extrapolated:

- **Room art is a `create_map_object` low-top-down room.** Validated composites read this task: `.tmp-scene/room3.png` (the empty backdrop, **400×256**, transparent-bg per the task brief), `.tmp-scene/room3_idle.png` (idle/stretch pose), `.tmp-scene/room3_desk.png` (`active_work` pose). All three viewed this task.
- **The room is a DESKLESS backdrop** (Catch 1 / option 1D confirmed): back wall + window + bookshelves + dresser + framed art + plants + an armchair, and a wood floor occupying the bottom ~40% of the image with a clear center-foreground. **No desk in the backdrop.**
- **Character grounds on the floor plane.** In `room3_idle.png` the standing character's feet sit on the floor band (correct). In `room3_desk.png` the `active_work` pose brings its OWN desk + monitor and sits in FRONT of the back wall — **one desk, reads natural, no double-desk** (Catch 1 / 1D validated by the actual composite, not just predicted).
- **Live card structure (read this task, `src/webview/styles/dashboard.css` on this branch's base `origin/main`):**
  - `.agent-tile` carries `background-color: var(--ct-card-bg)` (`#ECEFF1`, `:129`) + `border: 1px solid var(--ct-card-hairline)` (`rgba(0,0,0,0.12)`, `:158`, applied `:353-354`).
  - `.agent-tile[data-has-sprite="true"]` is the 3-zone grid (`:393-404`): rows `name/role` (Zone A) → `hero/hero` (Zone B) → `model/activity` (Zone C).
  - Zone placements: `.sprite-box{grid-area:hero;justify-self:center}` (`:409-412`); `.tile-row--primary→name`, `--role→role`, `--model→model`, `--activity→activity` (`:413-428`).
  - `.sprite-box` is `width/height:var(--ct-sprite-size)`, `display:flex; align-items:center; justify-content:center`, **no `background-image` today** (`:466-476`). `.sprite-frame` is the sprite `<img>`, `image-rendering:pixelated` + `object-fit:contain` (`:478-487`).
  - `.persona-instances` (multi-agent expand) auto-places full-width below Zone C (`:446-448`).
  - Text contrast tokens computed **against flat `#ECEFF1`**: `--ct-card-fg #1f2933` ≈13:1, `--ct-card-fg-muted #52606d` ≈6:1 (`:137-138`, `:152-153`).
  - Spacing tokens: `--ct-space-xs 4px / -s 8px / -m 12px / -l 16px` (`:34-37`); `--ct-radius-tile 4px` (`:44`); state dot `--ct-state-dot-size 10px` (`:40`).

## §FIRM.1 — Placement (full-bleed behind the whole card)

The scene is a `background-image` on the **`.agent-tile` itself** (the whole card), NOT on `.sprite-box`. This is the change from the original §2D.

```
┌─ .agent-tile  (scene fills the WHOLE card, edge to edge) ──────────┐
│░░ Zone A name / role  ░░░░  ← rides a TOP scrim band (text safe)   │
│▓▓▓ window  shelf  art  plant  ▓▓▓  back wall  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│            ┌────────────────┐                                      │  ← Zone B hero
│            │   [ sprite ]   │  ← feet land on the floor band       │     (NO scrim — scene fully visible)
│░░ floor ░░░│  ~140–176px    │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│░░ Zone C model / activity ░░░  ← rides a BOTTOM scrim band (safe) ░│
└────────────────────────────────────────────────────────────────────┘
```

**Render rules (LOCKED):**

1. **Target element:** `.agent-tile[data-has-sprite="true"][data-scene-bg]` — the scene is gated by a `data-scene-bg` attribute the component sets ONLY when a `scene` resolves for that tile (see §FIRM.3 compatibility). The selector is scoped to `[data-has-sprite="true"]` so sprite-less fallback tiles never get a scene.
2. **Background properties:** `background-image: var(--ct-scene-url)`, `background-size: cover`, `background-position: center bottom`, `image-rendering: pixelated`. `cover` + `center bottom` is load-bearing — see §FIRM.1 vertical anchoring.
3. **The scene REPLACES the flat `--ct-card-bg` fill on scene-bearing tiles** — do not paint both (double-paint / the flat color would show in any letterbox gap). Keep `--ct-card-bg` as the fallback for non-scene tiles and as the paint UNDER the scrims (§FIRM.2). The `--ct-card-hairline` border stays on all tiles unchanged.
4. **Z-order:** the scene is the card's own `background-image` (paint layer, behind all content). `.sprite-frame`, the scrims, and all text are normal-flow children that composite above it automatically. The scene must NOT be a separate positioned element that could intercept the tile's click target — keeping it as `background-image` guarantees clicks pass through to the existing tile handler (no `pointer-events` change needed).

**Vertical anchoring — feet meet the floor plane (LOCKED):**

The sprite must look like it stands ON the room's floor, not floats in the middle of the wall. Two facts make this work without per-pixel tuning:

- The room art (`room3.png`) places its **floor band in the bottom ~40%** and the sprite art has the **character's feet near the bottom of its own 68×68 frame** (transparent headroom above). `.sprite-frame` uses `object-fit: contain` (`:486`) inside the `.sprite-box`.
- **Anchor the scene with `background-position: center bottom`** so the floor line pins to the card's bottom edge regardless of card height. The hero sprite sits in Zone B (grid row 2, vertically centered by `align-items:center` `:401`); because the room's floor occupies the lower portion and the sprite's feet sit low in its frame, the feet land on the floor band. **This composition is already validated** by `room3_idle.png` + `room3_desk.png` — the firming spec inherits that validated alignment rather than inventing new offset math.
- `Maya note:` do NOT add a vertical `transform` / `margin` nudge to the sprite to "drop it onto the floor" as a first move — the validated composites show the natural Zone-B centering already grounds correctly at the room's aspect. If a live reload shows the feet floating, the lever is `background-position` Y (`center bottom` → `center 85%` etc.), tuned once on the scene layer, NOT a per-sprite offset (which would desync idle vs desk poses). Capture the exact Y as a render-tunable, default `bottom`.

## §FIRM.2 — Text scrim (the load-bearing part)

**Problem restated (grounded):** `--ct-card-fg` 13:1 and `--ct-card-fg-muted` 6:1 were computed against flat `#ECEFF1` (`:137-138`). Over `room3.png` the text zones cross a pale window, dark bookshelves, mid-tone wall, and a wood floor — the ratios are VOID; muted slate-grey would vanish over the dark shelves and the wood floor.

**Treatment (LOCKED): two opaque-enough scrim bands, one behind Zone A, one behind Zone C. The hero (Zone B) gets NO scrim** so the scene reads cleanly behind the character.

Concretely, a scrim is a **same-color-as-the-card translucent band** painted behind the text rows, restoring a near-flat contrast surface:

- **Color:** the scrim is `--ct-card-bg` at high alpha → new token `--ct-scene-scrim: rgba(236, 239, 241, 0.88)`. `236,239,241` IS `#ECEFF1` (the existing card bg) in rgb, so the scrim is "the card surface, 88% opaque, scene faintly bleeding through." At 0.88 alpha the effective text-background is ≈`#EDEFF1`-over-scene; the dark text (`#1f2933`) and muted text (`#52606d`) retain **essentially the proven 13:1 / 6:1** because the scrim surface is ~88% the original flat color and the residual 12% scene shows only as a faint texture, not enough to drop muted text below AA. (Rationale, not a re-measured ratio: at α≥0.85 over the worst-case dark shelf region the composited luminance stays within a few % of flat `#ECEFF1`; tune α UP toward 1.0 if a live reload shows muted text struggling — α is the single readability lever.)
- **Opacity DIRECTION:** the scrim is **uniform** across each band (NOT a fade-to-transparent gradient). A gradient that fades toward the hero looks elegant but lets text near the fade edge cross onto bare scene — defeating the purpose for the row's outer characters. **A flat uniform band is the safe default.** Optional polish (deferred, NOT V1): a 1-row `--ct-space-xs` (4px) feather on the band's HERO-facing edge only (top edge of Zone C band, bottom edge of Zone A band) to soften the seam between scrim and scene — never on the card's outer edges where text sits.
- **Bands cover the full card width** (edge to edge, including the grid column-gap) so both the left meta (name/model) and right meta (role/activity) ride the same surface. A per-zone-cell scrim would leave the column-gap on bare scene and look patchy.
- **Vertical extent:** each band wraps its grid row plus the row's padding — i.e. the band is the **full height of grid row 1 (Zone A) and grid row 3 (Zone C)**, flush to the card's left/right/top (Zone A) or left/right/bottom (Zone C) edges. The hero row (row 2) is uncovered.

**Implementation shape (for Maya — CSS-only, no DOM change):**

The cleanest no-new-element approach is a **`background-color` on the grid rows' wrapping cells via the existing zone selectors**, but the rows are individual `.tile-row--*` elements placed into grid areas, and a band must span BOTH columns of a row. Two viable shapes — Maya picks per live result, both LOCKED-compatible:

- **Shape A (recommended) — two `::before`/`::after` pseudo-bands on `.agent-tile`.** `.agent-tile[data-scene-bg]::before` = the Zone A band (positioned top, full width, height = row 1), `::after` = the Zone C band (bottom). Each is `background: var(--ct-scene-scrim)`, `z-index` above the scene paint but below the text rows. Pro: zero DOM change, zero per-row edits, bands trivially span both columns. This is the recommended shape.
- **Shape B — `background-color: var(--ct-scene-scrim)` on each of the four meta `.tile-row--*` cells + fill the column-gap.** More literal but the column-gap (`--ct-space-s` 8px, `:402`) between the two cells of each row shows bare scene unless the gap is also covered — needs a row-spanning wrapper, which is a DOM change. **Not recommended** for that reason; Shape A avoids it.

**Scrim applies ONLY when `data-scene-bg` is present.** On non-scene tiles, no scrim, no token use — the flat `#ECEFF1` card is unchanged (the scrim would be invisible-but-wasteful over an identical-color flat bg anyway).

## §FIRM.3 — Compatibility & graceful degradation (LOCKED)

| Surface | Behavior with scene | Behavior with NO scene (degrade) |
|---|---|---|
| **Sprite-bearing tile** (`[data-has-sprite="true"]`) | Full-bleed scene + two scrim bands per §FIRM.1–2. | Flat `--ct-card-bg` card exactly as today; `data-scene-bg` absent → scene selector + scrim selectors don't match → zero visual change. **This is the load-bearing degrade path: a missing/failed scene asset = today's card.** |
| **Sprite-less tile** (`[data-has-sprite]` absent) | Never gets a scene (selector scoped to `[data-has-sprite="true"]`). | Flat text-stack fallback, unchanged. |
| **`.persona-instances` expand rows** (`:446-448`) | **NO scene, NO scrim** — they are sprite-less compact rows below Zone C; a scene there re-opens the readability fight. They sit on flat `--ct-card-bg`. (Same call as original Q4.) | Unchanged. |
| **Status-state visuals** (running/idle/finished/error dot + any state tint) | Unchanged — the state dot (`--ct-state-dot-size` 10px) rides the Zone A scrim with the name, so it keeps its flat surface + semantic color. Scene never sits under the dot. Any state-driven card tint composes ON TOP of the scene as it does on top of the flat bg today (it's a separate layer concern; scene doesn't touch it). | Unchanged. |
| **Hide-idle / whole-team-display** | Orthogonal — the scene is per-tile chrome; whether a tile is shown is decided upstream. A hidden tile simply isn't rendered (no scene to paint). Idle tiles that ARE shown get their idle-pose sprite standing in the room (validated by `room3_idle.png`). | Unchanged. |
| **Hover** (`--ct-card-hover #E1E4E6`, `:154`) | On a scene tile the flat hover-fill would fight the scene. **LOCKED:** on `[data-scene-bg]`, suppress the `background-color` hover swap; instead darken the SCRIM bands slightly on hover (`--ct-scene-scrim-hover: rgba(225,228,230,0.90)` — the existing `#E1E4E6` hover hex at ≈0.90) so the hover affordance lands on the text surfaces, not as a flat wash over the scene. The scene itself does not change on hover. | Flat `--ct-card-hover` swap, unchanged. |
| **Multi-agent ×N badge / overflow menu / remove-confirm** | These ride Zone A (badge) or pop over the card; they keep their own surfaces. The badge sits on the Zone A scrim. Pop-over menus already carry opaque backgrounds (`[hidden]`-guarded per `vscode-extension-conventions.md`) — unaffected. | Unchanged. |
| **`prefers-reduced-motion`** | Scene is a static image — no motion concern. (Sprite animation is gated elsewhere.) | n/a |
| **Light VS Code theme** | The scene + scrim are hardcoded (the card is intentionally light in both themes per `:122-125`); scrim token mirrors `--ct-card-bg`'s deliberate theme-independence. No theme remap. | n/a |

**Per-role vs shared (Catch 3, unchanged by full-bleed):** still **start SHARED** (one `room3` scene for everyone), architect per-role via a manifest `scene` field defaulting to the shared asset. Full-bleed makes the calm-at-scale check MORE important (a grid of full-card busy rooms is busier than a grid of hero-band scenes) — so the scrim bands + the single shared room are the safe V1 sequence. The `data-scene-bg` attribute carries the resolved scene URL via `--ct-scene-url` (custom property set inline by the component from the manifest), so per-role is a data-only upgrade — no new selector.

## §FIRM.4 — LOCKED vocabulary (identifiers/classes Maya implements)

| Identifier | Kind | Value / definition | Notes |
|---|---|---|---|
| `data-scene-bg` | HTML attribute on `.agent-tile` | present (no value needed) when a scene resolves for the tile | gate for ALL scene + scrim CSS; absent = today's flat card |
| `--ct-scene-url` | CSS custom property | set inline by the component: `--ct-scene-url: url('<asWebviewUri scene path>')` | the resolved scene image; per-role upgrade = change this value only |
| `--ct-scene-scrim` | CSS token (`:root`) | `rgba(236, 239, 241, 0.88)` | the text-band scrim = `#ECEFF1` @ 0.88α; α is the readability lever |
| `--ct-scene-scrim-hover` | CSS token (`:root`) | `rgba(225, 228, 230, 0.90)` | hover scrim = `#E1E4E6` (existing `--ct-card-hover`) @ 0.90α |
| `--ct-scene-anchor-y` | CSS token (`:root`) | `bottom` (default) | `background-position` Y; render-tunable if feet float (§FIRM.1) |
| Scene paint | CSS rule | `.agent-tile[data-has-sprite="true"][data-scene-bg]` → `background-image: var(--ct-scene-url); background-size: cover; background-position: center var(--ct-scene-anchor-y); image-rendering: pixelated;` | replaces flat `--ct-card-bg` on scene tiles |
| Scrim bands | CSS rule | `.agent-tile[data-has-sprite="true"][data-scene-bg]::before` (Zone A band) + `::after` (Zone C band) → `background: var(--ct-scene-scrim)` | Shape A (recommended); span full card width, height of grid row 1 / row 3 |

**NOT introduced (avoid vocabulary drift):** no `.scene-layer` / `.scene-backdrop` element, no `.scrim` class, no change to `.sprite-box` / `.sprite-frame` / `--ct-sprite-size`, no new message type, no `--ct-card-bg` redefinition. The scene is `--ct-scene-url` on the existing `.agent-tile`; the scrim is two pseudo-elements. This keeps the diff CSS-only + one attribute + one inline custom property in the tile component.

## §FIRM.5 — Open questions for the sponsor (firming pass)

1. **Scrim opacity feel.** Spec defaults `--ct-scene-scrim` to 0.88α (text-safe but scene faintly bleeds through the bands). Sponsor may want it FULLER (lower α → more scene visible under text, risk to muted-text legibility) or SAFER (toward 1.0 → bands read as solid bars framing the scene, less immersive). It's a one-token live tune — flag for sponsor feel-gate on first reload.
2. **Floor anchoring on tall/short cards.** Default `background-position: center bottom`; validated against the `room3` composites at the current hero size. If the sponsor drag-resizes the panel to extremes, the feet-on-floor alignment may need `--ct-scene-anchor-y` retuning — confirm the default reads right at the sponsor's typical panel width before locking.

These two are render-time-tunable (zero gens, zero re-spec); both should be confirmed at the first live reload of Maya's implementation, not blocking the build.

## §FIRM.6 — Cross-references / unverified flags (firming pass)

- Composites grounded: `.tmp-scene/room3.png`, `room3_idle.png`, `room3_desk.png` — all VIEWED this task (the desk-no-clash and feet-on-floor claims are from the actual rendered images, not predicted).
- Card-structure + token values grounded in `src/webview/styles/dashboard.css` on this branch's base (`origin/main`), read this task: card-bg/border `:129`/`:158`/`:353-354`, hero grid `:393-404`, zone placements `:409-428`, sprite-box `:466-487`, contrast comments `:137-138`/`:152-153`, spacing/radius/dot tokens `:34-44`.
- `Speculative — no source yet (Maya/Felix to confirm at impl):` the exact composited contrast ratio of `#1f2933` / `#52606d` over `--ct-scene-scrim` @0.88 above `room3`'s darkest region was NOT re-measured this task (no contrast tool run) — the 0.88 default is a reasoned starting point (≈88% of the proven flat surface), explicitly flagged as the tunable readability lever, not a measured guarantee. If a live reload shows muted text struggling over the dark bookshelf strip, raise α (§FIRM.5 Q1).
- `Pipeline (Bram, mostly resolved):` the build/manifest wiring to thread a static `scene.png` through `build-sprite-manifest.mjs` + serve it via `asWebviewUri` was scoped in `team/bram-research/scene-bg-feasibility-2026-05-31.md` (read this task) — a `resolveStaticImage` branch (~15 lines). That host/build work is Felix's; this spec assumes the component can set `--ct-scene-url` to a served scene path. The room art itself is already produced (`room3.png` validated) — what remains is the build-thread + the CSS/attribute work specified here.
