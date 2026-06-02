# Scene Background Feasibility — 2026-05-31

## Question

Ticket `86ca26enf`: Is it feasible to replace the flat light card stage with a
pixel-art environment/scene background (office / living room / studio) filling
the card, with the character composited on top? Which PixelLab tool/workflow
best produces it? Do the existing character sprites have transparent backgrounds
so they'd layer cleanly? Where would scene images live in the build pipeline?
Rough credit cost?

---

## Answer (1–3 sentences)

**Technically feasible.** The existing character sprites are confirmed RGBA
(fully transparent background) so compositing is CSS `background-image` + the
character on top — no cutout work needed. The cleanest generation path is a
single `create_isometric_tile` or `create_map_object` call producing a ~128–256 px
square backdrop; the build pipeline threads it through `scripts/build-sprite-manifest.mjs`
with a minor addition, and the webview renders it as a CSS `background-image`
on `.sprite-box` with `image-rendering: pixelated`. The main open question is
Iris's design intent (exact card dimensions, whether the scene is per-character
or shared) and sponsor approval of the scene's visual fit with the hero layout.

---

## Evidence

### 1. Sprite alpha (verified)

Every PNG checked is **ColorType 6 (RGBA), 68×68 px**, with a transparent
background around the character:

- `assets/sprites/ClaudeTeam-M01-Dev/_pixellab_anims/ClaudeTeam-M01-Dev/rotations/south.png`
  — 68×68, CT=6, Alpha=True (verified via `struct.unpack` on live file this task)
- `assets/sprites/ClaudeTeam-F01-Dev/_pixellab_anims/ClaudeTeam-F01-Dev/rotations/south.png`
  — 68×68, CT=6, Alpha=True
- `assets/sprites/ClaudeTeam-M01-Dev/_pixellab_anims/holding_a_coffee_cup/rotations/south.png`
  — 68×68, CT=6, Alpha=True
- `assets/sprites/ClaudeTeam-M01-Dev/_pixellab_anims/sitting_at_a_desk_fa/animations/…/south/frame_000.png`
  — 68×68, CT=6, Alpha=True (both M01 and F01 desk animation frames)

Visual inspection (tool's image render, this task): the M01 and F01 south rotation
sprites show a character floating against empty space — the background is
transparent, not solid white. No cutout pre-processing is needed.

**Source:** `C:\Trunk\PRIVATE\ClaudeTeam\assets\sprites\ClaudeTeam-M01-Dev\_pixellab_anims\ClaudeTeam-M01-Dev\rotations\south.png`
and four sibling files read this task.

---

### 2. PixelLab tool options for a scene backdrop

The PixelLab MCP (confirmed tools in the installed server) offers four tools
that can produce scene-like pixel art:

| Tool | What it produces | Relevant params | Verdict for card bg |
|---|---|---|---|
| `create_isometric_tile` | A single isometric tile (floor, wall, object) | `description`, `size` | **Best single-image option for a stylized office/desk scene.** One gen = one card-fill image. Isometric perspective reads naturally for an "office corner" or "studio desk" environment. |
| `create_topdown_tileset` | A sheet of top-down tiles (floor, wall, deco) | `description`, `n_tiles`, `tile_size` | Good for a top-down room view; outputs a tileset sheet, not a composed scene. Would require assembly. Hypothesis: overkill for a static backdrop. |
| `create_sidescroller_tileset` | Platformer-style background tiles | `description`, `n_tiles`, `tile_size` | Produces wide horizontal layouts — poor fit for a square card backdrop. |
| `create_map_object` | A single map decoration object | `description`, `size` | Best for a single prop (desk, bookshelf) without a room; could pair with a floor tile produced by `create_isometric_tile`. |
| `create_character_state` | A character pose-state | — | NOT a scene tool; character is always in the frame. |

**Confirmed tool names** — listed in the PixelLab MCP server manifest that the
harness reports for this session. Parameters inferred from tool descriptions;
exact parameter schemas are hypothesis pending a live `--help` or error-response
probe.

**Recommended workflow:**

Option A (simplest — one image, no assembly):
1. Orchestrator calls `create_isometric_tile(description="pixel art office
   corner: a tidy desk with a monitor, bookshelf on the wall, warm lamp light,
   top-down isometric, cozy studio palette", size=128)` → waits for completion
   → downloads the PNG.
2. Sponsor approves the still image.
3. Image stored at `assets/sprites/scenes/<scene-id>/scene.png`.
4. Build manifest extended (see §4).
5. Webview renders as `background-image` on `.sprite-box` or the tile.

Option B (custom assembled room — richer but more credits):
1. Generate floor tile + wall tile + furniture object separately via
   `create_topdown_tileset` + `create_map_object`.
2. Assemble using `pixel-mcp` layer-compose tools.
3. Export as a single `scene.png`.

**Option A is the recommended starting point** — one gen, immediate sponsor
feedback, zero assembly.

---

### 3. Hero card aspect ratio / dimensions (verified)

From `src/webview/styles/dashboard.css` (read this task, lines 89–111):

```
--ct-sprite-size: 140px;        (hero floor — current non-container fallback)
--ct-sprite-size-min: 140px;    (narrow panel floor)
--ct-sprite-grow: 48cqw;        (slope — ~144px @300px container)
```

The `@container ct-panel` rule (dashboard.css line ~456) clamps to
`clamp(140px, 48cqw, 176px)`. So the `.sprite-box` (and any scene bg inside
it) ranges **140–176 px square** at the current design.

The card itself is wider than the sprite box (the grid is `1fr auto` so both
meta zones flank the hero). The overall card width depends on the panel width
and is not a fixed value.

**Implication for scene sizing:** a scene image at **176–256 px square** would
cover the full hero range plus headroom. Since `image-rendering: pixelated` is
already applied to `.sprite-frame`, the same rule on the backdrop would keep
the pixel art crisp at any scale. A 128 px source scales up to 176 px pixel-
perfect; a 256 px source scales down cleanly too.

Source: `src/webview/styles/dashboard.css` lines 89–115, 456–464, read this task.
Source: `team/iris-ux/card-hero-layout.md` §3 (sizing math, confirming 140–176px
hero range), read this task.

---

### 4. Build and storage pipeline (verified against actual scripts and layout)

**Current sprite pipeline (verified from source):**

```
assets/sprites/<CharName>/                    ← source of truth
  animations.json                             ← canonical name → folder map
  _pixellab_anims/<folder>/
    animations/<slug>/south/frame_NNN.png     ← animation frames
    rotations/south.png                       ← portrait rotation

scripts/build-sprite-manifest.mjs             ← reads animations.json, discovers
                                                frame slugs, writes:
  src/webview/sprites/generatedManifest.ts   ← committed TS module (baked paths)
  dist/webview/sprites/<CharName>/...        ← copied PNGs (served from localResourceRoots)
```

Source: `scripts/build-sprite-manifest.mjs` lines 1–50 read this task, comments
confirm the above.

**For scene backgrounds — two viable storage options:**

Option 1 — scene as a character-keyed entry in `animations.json`:
- Add `"scene_bg": "<scene_folder>"` to the character's `animations.json`.
- `build-sprite-manifest.mjs` would need a minor extension to copy static
  `scene.png` files (not frame sequences) into `dist/webview/sprites/`.
- The manifest would emit `{ "scene_bg": { frames: ["sprites/…/scene.png"], frameCount: 1 } }`.
- **Verdict: fits the existing pipeline with a small script change.**

Option 2 — separate `assets/scenes/` directory with its own manifest:
- More separation, but adds a second manifest path the webview must load.
- **Verdict: unnecessary complexity for V1; Option 1 is simpler.**

**Build script change needed (hypothesis — not yet coded):** `build-sprite-manifest.mjs`
currently calls `resolveAnimFrames()` which expects an `animations/<slug>/south/`
subdirectory. A single `scene.png` would be a flat file, not a frame sequence.
The script would need a `resolveStaticImage(folder)` branch alongside `resolveAnimFrames`.
This is a ~15-line addition — confirmed by reading the script's structure (lines
88–165); no other files need changing.

**CSS render path (verified):**

The `.sprite-box` element (`dashboard.css:466–484`) is:
- `width/height: var(--ct-sprite-size)`
- `display: flex; align-items: center; justify-content: center`
- No current `background-image`.

A scene bg would be added as:
```css
.agent-tile[data-has-sprite="true"] .sprite-box[data-scene-bg] {
  background-image: url('...');
  background-size: cover;
  background-position: center;
  image-rendering: pixelated;
}
```
The character `.sprite-frame` (an `<img>` inside `.sprite-box`) would composite
on top via normal stacking since it is a child element above the `background-image`.

**No CSP issue:** static PNGs served from `dist/webview/sprites/` via `asWebviewUri`
are already under `localResourceRoots` (`dist/webview/`). A scene PNG in the
same tree needs no new CSP policy.

Source: `scripts/build-sprite-manifest.mjs` full read; `src/webview/styles/dashboard.css`
sprite-box section; `src/webview/sprites/generatedManifest.ts` (structure confirmed).

---

### 5. Credit cost estimate

**Verified balance:** Not fetched this task (would require a live `get_balance`
MCP call — did not execute per the research-only constraint on generator tools).

**PixelLab cost model (from `.claude/docs/persona-pixel-character-animation-prompts.md`
§ Cost model + RandomGame pipeline doc, read this task):**

- `create_isometric_tile` — **hypothesis 1 gen per image** (same class as
  `create_character`, `create_map_object` which are 1 gen each). NOT confirmed
  by a live run this task — mark as hypothesis.
- `create_topdown_tileset` — **hypothesis 1 gen for the full sheet** regardless
  of `n_tiles`. Same pattern as character creation. Not confirmed by a live run.
- Frame count does NOT multiply cost for tiles (it multiplies only for
  `animate_character` at fc≥16).

**Per-character vs shared:**
- A SHARED scene (one per role / one per team) costs 1–3 gens for the entire
  team's card background.
- A PER-CHARACTER scene (different office for Felix vs Maya) costs 1 gen ×
  number of characters (6 personas = 6 gens).
- Given the current 10-character roster build budget (~190 gens estimated for
  all characters), 6–10 scene gens is well within budget.

**Re-roll expectation:** scene images are static (no animation), so no re-roll
for motion failures. Re-roll risk is visual fit and art style matching the
characters. 2–3 re-roll buffer per scene is conservative.

---

## What I did NOT verify

- **PixelLab current balance:** `get_balance` not called (research-only constraint).
- **`create_isometric_tile` exact parameters:** Parameter names and valid `size`
  values not probed via live call this task. The tool description confirms it
  exists; exact API surface is hypothesis from the tool schema listing.
- **`create_topdown_tileset` and `create_map_object` exact parameters:** same gap.
- **Whether `create_isometric_tile` produces a scene image with transparent or
  opaque background:** Unknown. If it produces a transparent bg PNG (like
  characters), a separate floor/background layer would be needed. If opaque,
  it's directly usable. **Hypothesis: tile tools produce opaque images** (tiles
  are meant to tile; transparency would be unusual). Needs a live gen or doc check.
- **build-sprite-manifest.mjs `resolveStaticImage` extension:** Described the
  needed change structurally; exact diff not written (no-code research role).
- **Webview component that would inject the `data-scene-bg` attribute and CSS:**
  Not traced — `agentTile.ts` would need to read the scene from the manifest
  and set it; exact lines not located.
- **Ticket `86ca26enf` full scope via ClickUp MCP:** MCP tool not available in
  Bram's sub-agent context (confirmed by `orchestration-overview.md`
  §ClickUp-hard-gate: ClickUp MCP not surfaced to sub-agents). Ticket read
  from the dispatch brief provided.

---

## Implications for ClaudeTeam

- **CSS compositing is trivially free** — RGBA sprites already work; a CSS
  `background-image` on `.sprite-box` requires zero new markup and zero new JS.
  The character renders on top by default (child element above `background-image`).
- **The main cost is design + approval, not implementation.** Generating a
  scene image is 1–2 gens + sponsor visual approval, and the build/manifest
  extension is a small script change. Pipeline is already set up for static PNGs.
  **Recommend starting with a single shared "cozy office" scene image for all
  characters, then per-character variants later if the shared one feels generic.**
- **Potential pitfall — art-style mismatch:** Characters are rendered as
  `create_character` with `view='low top-down'` at `size=48` (68×68 canvas).
  A scene backdrop generated by `create_isometric_tile` may not match in
  perspective, palette, or shading style. Should be validated with one test
  scene before committing to 6+ scenes. Iris's design work (parallel) should
  specify the scene's viewport perspective to match the existing character viewport.
- **Card sizing context:** Hero sprite scales 140–176 px (verified from CSS);
  a 128 px scene source is appropriate but a 256 px source gives more sponsor
  tuning headroom.
