# Pixel-art SCENE backgrounds behind dashboard characters — design brief

Ticket: `86ca26enf` · Author: Iris · DESIGN PASS (no production code, no PixelLab generation)

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
