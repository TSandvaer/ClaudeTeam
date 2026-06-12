# Scene-per-pose-per-character — UX + vocabulary spec

**Ticket:** `86ca88nvd` (design spec) · **Author:** Iris (UX) · **Date:** 2026-06-12
**Reviewer:** Maya (visual) / Felix (data-shape edges). NOT Sage (no production code in this PR).
**Gates:** the parallel build wave — Felix (host: writer + build-script + wire + seed) ∥ Maya (webview: picker, overlay, crossfade, tile cascade); Sage QA before merge.
**This spec DOUBLES as the parallel-dispatch vocabulary contract** (`.claude/agents/dispatch-template.md` § Vocabulary contract; user-global "Parallel-agent shared-concept vocabulary discipline"). §5 is LOCKED and load-bearing — Felix + Maya implement from the SAME names.

**Builds on / does not re-litigate:**
- **8 LOCKED decisions** — `team/DECISIONS.md` § "2026-06-12 — Scene-per-pose-per-character feature: 8 locked decisions" (sponsor, grill-me, all 8 AskUserQuestion-clicked). Canonicalized in §0 below; NOT re-opened.
- **Scene-bg V1** — `team/iris-ux/scene-bg-design-spec.md` §FIRM (full-bleed + scrim, LOCKED) + ticket `86ca3kjyk`. This feature is the *architected call-site upgrade* per the `SpriteScenes` JSDoc (`src/webview/sprites/spriteManifest.ts:143-161`): "the registry shape and the default-pointer contract are unchanged."
- **Playback cascade** — `team/iris-design/anim-tuner-spec.md` (E4) + `resolvePlayback` 3-layer field-level merge. The scene cascade MIRRORS it.

---

## 0. The 8 LOCKED decisions (canonicalized — do NOT re-litigate)

Verbatim source: `team/DECISIONS.md` § 2026-06-12. Each was sponsor-clicked via AskUserQuestion (recommended option).

| # | Decision (LOCKED) | Where this spec specs it |
|---|---|---|
| 1 | **Resolution = 3-layer field-level cascade** mirroring playback: per-char `animations.json` → `pose-defaults.json` → manifest `defaultSceneId` (`room3`). | §2 |
| 2 | **Value space = 3-state:** scene id \| literal `"none"` (flat card, stops cascading) \| unset (inherit next layer). | §2.1 |
| 3 | **UI = scene picker row in the Playback Tuner**, reusing the two existing save targets (per-char / pose-default); preview renders the chosen backdrop live. | §1 |
| 4 | **Live in-session apply** like all tuner controls — scene field joins the wire payload + `liveManifestOverlay`; host↔overlay TUNABLE_KEYS parity invariant applies (the #213/#214 defect class). | §1.4, §5 |
| 5 | **Pose→pose backdrop change = short crossfade** (~couple hundred ms; Iris specs exact duration/curve), incl. to/from flat card. | §3 |
| 6 | **Mechanism first:** ships with `room3` only; new scene art is a separate sponsor-present PixelLab arc (PNGs in `assets/sprites/scenes/` auto-join via build step, zero code). | §4, §6 |
| 7 | **Scope = GLOBAL/shared across orchestrations** (same as all tuning); no per-project override layer. | §2 (no project layer in the cascade) |
| 8 | **Seed the desk-clash fix:** `pose-defaults.json` ships `scenes: { active_work: "none", active_read: "none" }` — idles keep `room3` via the default pointer. | §7 |

---

## 0.1 Verified ground truth (read before implementing)

Every ref below was `grep`/Read-verified against the live tree this task. **`origin/main = 869a7f33ab87da67a8c7e34ae0be9536eda21a93`** (`git rev-parse origin/main`, this task). Trust these refs — they are live, not from a stale backlog.

| Concept | Live location (verified this task) | Note |
|---|---|---|
| `SpriteScene` `{ id, image }` | `src/webview/sprites/spriteManifest.ts:131-141` | one flat image path, not a frame sequence |
| `SpriteScenes` `{ defaultSceneId, byId }` | `spriteManifest.ts:156-161` | the baked registry; V1 has one `byId` entry (`room3`) |
| `scenes?: SpriteScenes` on the manifest | `spriteManifest.ts:172` | absent when `assets/sprites/scenes/` has no PNGs → degrade to flat card |
| `sceneForId(sceneId, manifest)` | `spriteManifest.ts:282-287` | `manifest.scenes?.byId[sceneId] ?? null` |
| `defaultScene(manifest)` | `spriteManifest.ts:296-304` | `sceneForId(scenes.defaultSceneId)`; `null` when no registry |
| tile scene paint — `data-scene-bg` + `--ct-scene-url` | `agentTile.ts:301-318`, `multiAgentPersonaTile.ts:289-298` | `defaultScene()` null → set NEITHER → flat card (the **omit-data-scene-bg degrade path**, decision-4 §FIRM.3) |
| tuner-preview scene paint (same vocab) | `playbackTunerPreview.ts:182-200` + `dashboard.css:2368` | `.ct-tuner-preview-box[data-scene-bg]`; NOT overloading the tile rule |
| `resolvePlayback(char, anim, source)` 3-layer field cascade | `spritePlayer.ts:171-192` | `{ ...poseDefault, ...perChar }`; the SHAPE the scene cascade mirrors |
| host writer `TUNABLE_KEYS` + `TunablePlaybackOverride` + `mergePlaybackEntry` | `src/extension/sprites/playbackOverrideWriter.ts:57-83, 102-145` | field-omission == clear; the writer the scene field extends |
| webview overlay `TUNABLE_KEYS` + `mergeBlock` | `src/webview/liveManifestOverlay.ts:90-99, 152-166` | MUST stay byte-identical to the host writer's keys (the #213/#214 parity invariant) |
| wire `ui:save-playback-override` + `playback:override-saved` | `src/shared/messages.ts:358-404` | the round-trip the scene field extends |
| per-char `animations.json` shape — `playback` is a **top-level sibling of `animations`** | `assets/sprites/ClaudeTeam-M01-Dev/animations.json:26-67` | so the `scenes` block is ALSO a top-level sibling |
| `pose-defaults.json` — reads ONLY `parsed?.playback`; root keys `["playback", "_note"]` | `scripts/build-sprite-manifest.mjs:192, 411` + `assets/sprites/pose-defaults.json` | **a new `scenes` root block needs a build-script read + an allowed-root-key add (Felix)** — see §4.1 |
| build-script scene registry builder `buildScenes(fileNames)` | `build-sprite-manifest.mjs:~496-532` + `DEFAULT_SCENE_ID = "room3"` `:79` | dangling-default fallback already handled there |

---

## 1. Scene picker row in the Playback Tuner (decision 3)

The scene picker is a NEW control row added to the existing tuner panel (`team/iris-design/anim-tuner-spec.md` §3). It is NOT a new panel — it reuses the tuner's char/anim selectors, write-target chooser, persistence banner, cascade source table, and live-preview mechanism wholesale.

### 1.1 Placement in the panel

The scene row lives in a dedicated **`── Scene ──` section** placed **directly above `── Write target ──`** and **below the `── Controls ──` block** (after Mode). Rationale: scene is a *backdrop* choice (a property of the whole tile), conceptually distinct from the timing controls (speed/hold/mode/window/apex) — it deserves its own labelled section, like Write target, rather than sitting inside the motion-controls block. It comes after Controls because the sponsor tunes the motion first, then chooses the stage it plays on.

ASCII (delta to the §3 tuner wireframe — the bracketed `── Scene ──` block is new):

```
│  ── Controls ──────────────────────────────────────────  │
│  Speed        ──────●─────────   0.50×    [reset]         │
│  Hold (final) ──────●────────    800 ms   [reset]         │
│ ┌── Hold (apex) ─────────────────────────── [reset] ──┐  │
│ │  Frame  [ frame 7 ▾ ]    Apex hold ──●── 600 ms      │  │
│ └──────────────────────────────────────────────────────┘  │
│  Mode         ( ) loop   (•) pingpong                     │
│                                                           │
│  ── Scene ─────────────────────────────────────────────  │  ← §1 NEW section
│  Backdrop   [ room3 (default)        ▾ ]   [reset]        │  ← §1.2 scene <select>
│  ↳ Inherits: pose-default → room3                        │  ← §1.3 effective-source line
│                                                           │
│  ── Write target ──   (•) This character  ( ) All chars  │
│  [ persistence banner ]                                   │
```

### 1.2 The scene `<select>` — control type DECISION

> **DECISION (AC1): a native `<select>` (single dropdown), NOT a thumbnail grid, NOT radio buttons.** Bounded to the manifest's scene registry plus the two sentinels. Mirrors the char/anim selector idiom already in the panel (theme-styled `<select>`).

Justification:

| Form | Verdict | Rationale |
|---|---|---|
| **Native `<select>`** ✅ CHOSEN | Chosen | The scene set is a *discrete, small, enumerable* list (V1 = 1 real scene; future = a handful of rooms). A `<select>` shows the full set, makes the two sentinels (`Inherit` / `None`) first-class first options, and re-populates trivially from `Object.keys(manifest.scenes.byId)`. It is the natural twin of the char/anim selectors already in the panel — one control vocabulary. No icon-only (each option has a text label — Iris hard rule). |
| **Thumbnail grid (mini scene previews)** ✗ rejected | — | Charming but heavyweight for a solo-user dev aid at 1-handful scenes; needs each scene rendered as a thumbnail (extra asset-resolve + layout). The live preview (§1.5) already shows the chosen backdrop full-size behind the sprite — a grid duplicates that. Reconsider only if the scene library grows large enough that a flat list is unwieldy (not V1). |
| **Radio group** ✗ rejected | — | Radios don't scale past ~3-4 options and the scene set will grow; a `<select>` is the scalable discrete-choice idiom. |

**Dropdown contents (LOCKED option set + order):**

1. **`Inherit (<resolved>)`** — the `unset` sentinel (value `""` / option not setting the field). First option. The label shows the inherited resolution in parens so the sponsor sees what unset means here, e.g. `Inherit (pose-default → room3)` or `Inherit (default → room3)`. Selecting it **clears** the scene field from the draft (field-omission == clear, §5). This is the **default selected option** when no per-(target) scene override exists.
2. **`None (flat card)`** — the `"none"` sentinel (decision 2). Selecting it writes the literal string `"none"`, which **stops the cascade** and renders today's flat `--ct-card-bg` card (the omit-`data-scene-bg` path). Distinct from `Inherit` — `None` is an explicit "no backdrop here," `Inherit` defers to the next layer.
3. **One option per scene id** — `Object.keys(manifest.scenes.byId)`, each labelled by its id. The current default is annotated: `room3 (default)`. (V1 has exactly one: `room3`.)

- **Re-populated whenever the character changes** (a future per-char scene set is uniform across the shared registry today, but the resolution annotation in option 1 depends on (char, anim) — recompute it). Re-populate on anim change too (the inherited resolution + the current selected value are per-(char, anim, writeTarget)).
- **`[reset]`** beside the dropdown clears the scene field from the draft (→ falls back to `Inherit`), exactly like the other controls' `[reset]`.

### 1.3 Effective-source line (mirrors the cascade source table §3.5)

Below the dropdown, a single read-only line shows the **effective resolved scene** for the current (char, anim) AND **which cascade layer it came from** — the scene-row analogue of the playback cascade source table:

```
↳ Inherits: pose-default → room3
↳ Per-char: none (flat card)
↳ Default: room3
```

The scene field is ONE field (unlike the multi-field playback table), so this is one line, not a table. Compute the source tag by walking the three layers top-down on the BAKED (effective-overlay) manifest (§2): per-char wins, else pose-default, else `defaultSceneId`. When the resolved value is `"none"`, render `none (flat card)`. This line is the scene-row's honesty surface — the sponsor must understand why a backdrop is (or isn't) showing before changing it.

**Shadowing warning (mirror §3.7):** when the write target is **All characters** (pose-default) but a **per-char** scene override already exists for this (char, anim), the per-char value WINS on the dashboard — the pose-default scene the sponsor is setting won't show for THIS character. Surface the SAME inline warning shape the playback controls use (`--vscode-inputValidation-warning*` tokens): *"⚠ `<char>` overrides the scene per-char; the pose-default backdrop you set won't show for this character."* Derive it from the effective-source line: if the source tag is `per-char` and the target is `pose-default`, show the warning.

### 1.4 Behavior at N=1 scenes (the V1 reality — load-bearing)

V1 ships with exactly ONE real scene (`room3`, decision 6). The dropdown therefore renders **three options**: `Inherit (… → room3)`, `None (flat card)`, `room3 (default)`. This is **fully functional, not degenerate** — the meaningful choice at N=1 is between **room3** (inherit or explicit) and **None** (flat card). The seed (§7) uses exactly this: `active_work`/`active_read` get `None`, idles inherit `room3`. **Do NOT special-case or hide the picker at N=1** — the `None` vs `room3` choice IS the feature's V1 value (it's how the desk-clash fix is expressed). The picker only becomes empty-of-real-scenes (and degrades — §4) when the manifest has NO `scenes` registry at all (zero PNGs).

### 1.5 Preview-renders-backdrop-live behavior (decision 3 + 4)

The tuner preview already paints `defaultScene` behind its sprite (`playbackTunerPreview.ts:182-200`, the SAME `data-scene-bg` + `--ct-scene-url` vocabulary as the dashboard tile). The scene picker makes that backdrop **track the draft**:

- On scene-dropdown change, the preview re-resolves its backdrop from the **draft scene value** (not the baked default) and re-paints:
  - draft = a scene id → set `data-scene-bg` + `--ct-scene-url` to `sceneForId(id).image` (prefixed by the host sprite base URI, exactly as the tile does).
  - draft = `"none"` → **remove** `data-scene-bg` + `--ct-scene-url` → the preview box shows the flat card (the same omit path the tile uses).
  - draft = unset (`Inherit`) → resolve through the cascade (§2) and paint the inherited scene (or flat card if it resolves to `none`).
- This is **webview-local + instant**, exactly like the playback live-preview (`team/iris-design/anim-tuner-spec.md` §1.2). No host round-trip for the visual feedback; the backdrop swaps in the preview the moment the dropdown changes.
- **Crossfade in the preview:** when the draft scene changes, the preview applies the SAME crossfade (§3) it would apply on a dashboard pose→pose change, so the sponsor previews the transition feel, not just the end state. (A dropdown change is the tuner's stand-in for a pose→pose backdrop change.)

### 1.6 Reuse of the existing per-char / pose-default save targets (decision 3)

The scene picker writes through the **existing write-target chooser** (`team/iris-design/anim-tuner-spec.md` §3.7) — no new target UI:

- **(•) This character** → the scene field lands in `<selectedCharacterFolder>/animations.json`'s `scenes["<anim>"]` block (the per-char layer).
- **( ) All characters** → the scene field lands in `assets/sprites/pose-defaults.json`'s `scenes["<anim>"]` block (the pose-default layer, shared across all chars).

The scene field rides the SAME `ui:save-playback-override` round-trip (§5) — it is added to that message's `override` payload, NOT a new message type. The persistence banner (`§3.6`) covers it unchanged: *"✎ Saved to `<filename>`. Rebuild + reload to apply to the live dashboard tiles."* — the preview moved (backdrop visible), the real tiles are baked-until-rebuild. **No scene-specific banner copy** — the single per-save banner already tells the truth for the scene field, exactly as it does for the apex pair (anim-tuner-spec §12.4).

---

## 2. The 3-layer scene cascade + 3-state value semantics (decisions 1, 2, 7)

The scene cascade **mirrors the playback cascade `resolvePlayback`** (`spritePlayer.ts:171-192`) — same 3 layers, same field-level precedence, EXCEPT the merged unit is ONE field (`sceneId`), not an object, so the "field-level merge" reduces to a **first-non-unset-wins walk**.

```
1. Per-character   manifest.characters[char].scenes["<anim>"]   (highest priority)
2. Pose-default    manifest.poseDefaults_scenes["<anim>"]        (shared across all chars)
3. Manifest default manifest.scenes.defaultSceneId  (= "room3")  (the floor)
```

> **No project layer (decision 7).** Scope is GLOBAL/shared across orchestrations — the cascade has NO per-project override layer. The three layers above are the complete set. This matches the playback cascade (which is also 3-layer, no project layer).

### 2.1 The 3-state value semantics (decision 2)

Each scene field at layers 1 and 2 holds one of THREE states:

| Value | Meaning | Cascade behavior |
|---|---|---|
| **a scene id** (e.g. `"room3"`) | "use this backdrop here" | Resolves to that scene. Stops the walk (this layer answered). |
| **`"none"`** (literal string sentinel) | "flat card here — no backdrop" | **Stops the cascade** (decision 2). Resolves to the flat-card render (omit `data-scene-bg`). Does NOT fall through to the next layer. |
| **unset** (key absent) | "inherit" | **Falls through** to the next layer. |

The **resolver walk** (the scene analogue of `resolvePlayback`, exported for unit coverage — see §5 for the name `resolveSceneId`):

```
resolveSceneId(char, anim, manifest):
  perChar = manifest.characters[char]?.scenes?.[anim]
  if perChar === "none"      → return "none"          # explicit flat card, stop
  if perChar is a scene id   → return perChar         # explicit backdrop, stop
  # perChar unset → fall through
  poseDefault = manifest.poseDefaults_scenes?.[anim]
  if poseDefault === "none"  → return "none"          # flat card, stop
  if poseDefault is a scene id → return poseDefault   # backdrop, stop
  # poseDefault unset → fall through
  return manifest.scenes?.defaultSceneId ?? null      # the floor (room3); null = no registry → flat card
```

**Tile consumption (decision-2 + degrade):** the tile resolves `resolveSceneId(...)`, then:
- result is a scene id present in `byId` → set `data-scene-bg` + `--ct-scene-url` = `sceneForId(id).image`.
- result is `"none"` → omit `data-scene-bg` + `--ct-scene-url` → flat card (the existing omit path — §FIRM.3, decision 4 of the locked set wires it through the SAME `data-scene-bg` absence the V1 degrade already uses).
- result is `null` (no registry) → omit both → flat card (the V1 degrade path, unchanged).

So `"none"` and "no registry" both land on the SAME omit-`data-scene-bg` render — the difference is intent (explicit vs absent), and both produce today's flat card. This is the load-bearing reuse the brief calls out: `"none"` rides the EXISTING omit-`data-scene-bg` path, no new render branch.

### 2.2 Mirroring the playback field-level merge (precise correspondence)

| Playback cascade (`resolvePlayback`) | Scene cascade (`resolveSceneId`) |
|---|---|
| `{ ...poseDefault, ...perChar }` per-FIELD spread | per-FIELD walk on the single `sceneId` field (perChar wins, else poseDefault, else default) |
| a per-char field of `undefined` is NOT in the spread → pose-default survives | a per-char `unset` (key absent) falls through → pose-default consulted |
| no explicit "stop" sentinel (every field independently resolves) | `"none"` is an explicit STOP sentinel (decision 2) — the ONE semantic the playback cascade lacks, because a backdrop choice needs an "explicitly no backdrop here" that differs from "inherit" |

The `"none"` STOP sentinel is the only structural difference from the playback cascade and it exists because scene has a meaningful "explicitly off" state (flat card) that timing fields don't. Everything else is the same 3-layer, per-(char, anim), highest-priority-last resolution.

---

## 3. Crossfade spec for pose→pose backdrop changes (decision 5)

When the dashboard tile (or the tuner preview) switches pose and the resolved backdrop CHANGES (e.g. idle `room3` → `active_work` `none`, or one scene → another once multiple ship), the backdrop transition is a **short crossfade**, not a hard cut.

### 3.1 Trigger

A crossfade fires when, on a pose change, `resolveSceneId(char, newAnim)` differs from the currently-painted backdrop. It fires for ALL four transition directions:

| From → To | Visual |
|---|---|
| scene A → scene B | A fades out as B fades in (cross-dissolve) |
| scene → `none`/null (flat card) | scene fades out, revealing the flat `--ct-card-bg` underneath |
| `none`/null (flat card) → scene | scene fades in over the flat card |
| no change | **no crossfade** (don't animate a backdrop that didn't change — avoids a needless flicker on every pose toggle when the scene is the same) |

The most common live trigger is the desk-clash seed (§7): an agent toggling work↔idle flips `none`↔`room3` constantly, so this crossfade is what makes that flip read as a gentle dissolve, not a jarring backdrop blink.

### 3.2 Duration / curve / easing (LOCKED defaults — render-tunable)

| Property | Value | Rationale |
|---|---|---|
| **Duration** | **200 ms** | "a couple hundred ms" per decision 5. Long enough to read as a deliberate dissolve, short enough not to lag the pose change. Matches the calm-but-responsive feel of the dashboard. |
| **Timing function** | **`ease-in-out`** (`cubic-bezier(0.4, 0.0, 0.2, 1)`) | Symmetric ease — the fade accelerates in and decelerates out, the standard "material" cross-dissolve curve. No abrupt start/stop. |
| **Property animated** | **`opacity`** | A cross-dissolve is an opacity transition between two stacked backdrop layers. NOT `background-image` (not animatable) — see §3.3 for the two-layer mechanism. |
| **Reduced-motion** | under `prefers-reduced-motion: reduce` → **hard cut** (duration 0), no fade. The dashboard tiles honor reduced-motion; the crossfade is motion. (The tuner PREVIEW overrides reduced-motion to always animate, mirroring the playback-preview reduced-motion override, anim-tuner-spec §5.4 — so the sponsor can always SEE the crossfade in the tuner.) |

These are the same class of render-tunable feel values the playback tuner exposes (the sponsor is the feel-judge); they ship as the defaults and are tunable in CSS without a re-spec.

### 3.3 Implementation shape (for Maya — the two-layer cross-dissolve)

`background-image` is not animatable, so a true cross-dissolve needs two stacked backdrop layers on the tile:

- **Recommended: a single transitioning `::before` backdrop layer + opacity.** The simplest correct shape: the scene paints on a `.agent-tile[data-scene-bg]::before` (or a dedicated backdrop pseudo-layer) carrying `--ct-scene-url`; `transition: opacity var(--ct-scene-crossfade-ms) var(--ct-scene-crossfade-ease)`. On a pose change that changes the scene: fade the layer to `opacity: 0`, swap `--ct-scene-url` to the new scene (or remove `data-scene-bg` for `none`), fade back to `opacity: 1`. For a true cross-dissolve (no flash of empty between out and in), use **two backdrop layers** (an A/B pair) and crossfade their opacities in opposite directions — the outgoing scene fades 1→0 while the incoming fades 0→1 over the same 200 ms. Maya picks per live result; both are LOCKED-compatible. **Note:** §FIRM.4 already paints the scene as `background-image` on `.agent-tile` itself and uses `::before`/`::after` for the SCRIM bands. The crossfade backdrop layer must NOT collide with those scrim pseudo-elements — Maya may need to move the scene paint onto a dedicated backdrop layer (a child element or a third stacking context) so it can opacity-transition independently of the scrims. Flag: this is a §FIRM.1 z-order refinement (the scene moves from the card's own `background-image` to a transitionable backdrop layer behind the scrims + content); the scrims and click-through behavior (§FIRM.1 rule 4) must be preserved.
- The crossfade is **scene-layer only** — the sprite itself swaps pose on its own existing cadence (sprite frame change is not part of the backdrop crossfade). The two are independent: the sprite changes pose, the backdrop cross-dissolves underneath it.

### 3.4 Tokens

| Token | Value | Notes |
|---|---|---|
| `--ct-scene-crossfade-ms` | `200ms` | duration; render-tunable |
| `--ct-scene-crossfade-ease` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | ease-in-out cross-dissolve |

(These are `--ct-*` tokens, consistent with the existing scene tokens `--ct-scene-url` / `--ct-scene-scrim` / `--ct-scene-anchor-y` in §FIRM.4. The crossfade does NOT touch theme — the scene + scrim are intentionally theme-independent per §FIRM.3.)

---

## 4. Degrade paths (decision 6 mechanism-first; brief item 4)

The feature must degrade to **today's flat card** at every failure point — never a broken backdrop, never a crash. Four paths:

| Degrade path | Condition | Behavior | Mechanism |
|---|---|---|---|
| **No scenes registry** | `assets/sprites/scenes/` has zero PNGs → build emits NO `scenes` block → `manifest.scenes === undefined` | `resolveSceneId` returns `null` at the floor; tile omits `data-scene-bg` → flat card. The tuner scene picker shows ONLY `Inherit` + `None` (no real-scene options); the effective-source line reads `Default: (no scene registry)`. | `defaultScene()` already returns `null` when `scenes === undefined` (`spriteManifest.ts:300`). The scene cascade's floor (`scenes?.defaultSceneId ?? null`) handles it. No new branch. |
| **Dangling scene id** (build-time) | a per-char / pose-default `scenes` value names an id with NO matching PNG | **Build-time drop + warn** (mirror `sanitizePlayback`): the build script validates each `scenes` value against the resolved `byId` registry; an id not in `byId` (and not the `"none"` sentinel) is DROPPED from the baked block + a `console.warn` is emitted (e.g. `[sprite-manifest] <char>/<anim>: scene "<id>" not found in registry — dropping`). The dropped field then falls through the cascade as if unset. | NEW build-script validation (Felix) — parallels `sanitizePlayback`'s malformed-field drop+warn. The dangling-DEFAULT case is ALREADY handled by `buildScenes` (`build-sprite-manifest.mjs:~525-529` falls back to the alphabetically-first id + warns when `DEFAULT_SCENE_ID` PNG is missing). |
| **Dangling scene id** (runtime, e.g. stale hand-edited overlay) | a recorded overlay save / baked value names an id not in `byId` | `sceneForId(id)` returns `null` (`spriteManifest.ts:286`) → the resolver treats it as unresolvable → falls through / floor → flat card. The picker resolves an unknown draft id to `Inherit` on populate (never displays a dangling id). | `sceneForId` null-coalescing already defends this. The picker re-populate (§1.2) drops unknown ids. |
| **`"none"` → flat card** | resolved value is `"none"` (explicit) | Omit `data-scene-bg` + `--ct-scene-url` → today's flat `--ct-card-bg` card via the EXISTING omit-data-scene-bg path. NO new render branch. | The exact path the V1 degrade already uses (§FIRM.3 "absent attribute = today's flat card"). `"none"` reuses it. |

**Build-script change scope (Felix — §4.1):** to read a `scenes` block from `pose-defaults.json`, the build script must (a) add `"scenes"` to `POSE_DEFAULTS_ROOT_KEYS` (`build-sprite-manifest.mjs:192`) so the misplaced-key detector doesn't warn on it, AND (b) read + sanitize `parsed?.scenes` alongside `parsed?.playback` (`:411`), validating each value against the `byId` registry (dangling-drop+warn) and the `"none"` sentinel. The per-char `scenes` block is read the same way the per-char `playback` block is threaded onto each manifest anim entry.

### 4.1 Where the resolved scene-cascade data lands on the manifest (Felix data-shape)

The cascade resolver needs the per-char and pose-default scene blocks readable on `GeneratedSpriteManifest`. Two manifest additions (Felix owns the exact field names — see §5 vocabulary contract for the LOCKED names):

- **Per-char:** a `scenes?: Record<animName, string>` block on each `SpriteCharacter` (sibling of the per-char `animations` / `playback` data), baked from each `animations.json`'s top-level `scenes` block. Values are a scene id OR `"none"`.
- **Pose-default:** a `sceneDefaults?: Record<animName, string>` block on `GeneratedSpriteManifest` (sibling of `poseDefaults`), baked from `pose-defaults.json`'s top-level `scenes` block. Values are a scene id OR `"none"`.

(Naming LOCKED in §5. The brief's recommended on-disk key is `scenes` sibling to `playback`; the BAKED manifest field for the pose-default layer is named `sceneDefaults` to parallel `poseDefaults` and avoid colliding with the existing `scenes` REGISTRY field `SpriteScenes` on the manifest root — see §5 note.)

---

## 5. VOCABULARY CONTRACT (LOCKED — load-bearing; Felix + Maya implement from this)

Per `.claude/agents/dispatch-template.md` § Vocabulary contract + the user-global "Parallel-agent shared-concept vocabulary discipline" — exact identifier names, not just shapes. Felix (host: writer + build-script + wire + seed) and Maya (webview: picker + overlay + crossfade + tile cascade) read the SAME names here. Any divergence is REQUEST_CHANGES at cross-review (mergeability-blocking, not a NIT).

### 5.1 On-disk JSON key shape

**Per-char `animations.json`** — a NEW top-level `scenes` block, **sibling to the existing `playback` block** (which is itself a sibling of `animations` — verified `ClaudeTeam-M01-Dev/animations.json:26,34`). Keyed by canonical anim name. Value = a scene id OR the `"none"` sentinel. A key ABSENT = unset (inherit).

```jsonc
{
  "animations": { "...": "..." },
  "playback":   { "...": { } },
  "scenes": {                    // ← NEW block, sibling of `playback`
    "active_work": "none",       // explicit flat card here
    "idle_coffee": "room3"       // explicit backdrop (rare per-char; usually inherited)
    // an anim absent here = unset = inherit from pose-default → default
  }
}
```

**`pose-defaults.json`** — a NEW top-level `scenes` block, **sibling to the existing `playback` block** (verified `assets/sprites/pose-defaults.json:3` `"playback": {}`). Same keying + value space.

```jsonc
{
  "_note": "...",
  "playback": { },
  "scenes": {                    // ← NEW block, sibling of `playback`
    "active_work": "none",       // the seed (§7)
    "active_read": "none"
    // idles absent → inherit the manifest defaultSceneId (room3)
  }
}
```

### 5.2 The `"none"` sentinel spelling (LOCKED)

The literal lowercase string **`"none"`** — exactly, byte-for-byte. NOT `"None"`, NOT `null`, NOT `""`, NOT `false`. It is a first-class value distinct from `unset` (key absent). Both the build-script sanitizer and the resolver match the exact string `"none"`.

### 5.3 Wire-payload field name (LOCKED)

The scene field is added to the EXISTING `ui:save-playback-override` message's `override` payload (`messages.ts:358-392`) as **`sceneId?: string`**. It is NOT a new message type.

```ts
// SavePlaybackOverrideMessage.payload.override — ADD this field:
override: {
  speedMultiplier?: number;
  finalDwellMs?: number;
  playbackMode?: "loop" | "pingpong";
  dwellFrameIndex?: number;
  dwellMs?: number;
  startFrame?: number;
  endFrame?: number;
  sceneId?: string;        // ← NEW: a scene id, or the literal "none". Absent = clear (inherit).
}
```

- `sceneId` value = a scene id OR `"none"`. **Absent from the payload = clear** (field-omission == clear — the SAME semantic as every other tunable field, §4.1 of anim-tuner-spec). The host writer writes it into the json `scenes["<anim>"]` block; absent → DELETES it (→ inherit).
- The ack is the UNCHANGED `playback:override-saved { ok, error }` (`messages.ts:401`) — no new ack type.

> **Naming note (why `sceneId` on the wire, not `scene`):** `sceneId` is unambiguous (it carries an id or `"none"`), parallels the manifest's `defaultSceneId` / `sceneForId` vocabulary, and reads clearly in the writer's owned-key list. The on-disk BLOCK is `scenes` (plural, keyed by anim) to parallel `playback`; the per-(anim) VALUE inside it and the wire field are the singular `sceneId`. Keep this split: block = `scenes`, field/wire = `sceneId`.

### 5.4 Overlay merge key (LOCKED — the parity invariant)

The scene field participates in the live-overlay field-level merge. Because the scene value lives in a SEPARATE on-disk block (`scenes`) from the playback block, it is NOT added to the playback `TUNABLE_KEYS` array. Instead:

- The host writer (`playbackOverrideWriter.ts`) gains a SEPARATE write path for the `scenes["<anim>"]` block keyed by `sceneId` (set when present, delete when absent — mirroring `mergePlaybackEntry`'s set/clear, but on the `scenes` block, not `playback`).
- The webview overlay (`liveManifestOverlay.ts`) gains the matching scene-block overlay so an in-session scene save re-seeds correctly (the #213/#214 stale-re-seed defect class — see `vscode-extension-conventions.md` § TUNABLE_KEYS parity invariant).
- **PARITY INVARIANT (LOCKED, greppable):** the host-side scene write + the webview-overlay scene merge MUST stay identical in their set/clear semantics for `sceneId`, exactly as the `TUNABLE_KEYS` arrays must for the playback fields. A scene save that the host writes but the overlay doesn't mirror → in-session re-seed reads the stale baked scene (the #213/#214 class). **When wiring the scene field, edit BOTH the host scene-write path AND the overlay scene-merge in the same PR pair**, and add a parity test (mirror the existing `TUNABLE_KEYS` parity test).

### 5.5 Webview resolver function name(s) (LOCKED)

| Function | Signature | Location | Role |
|---|---|---|---|
| **`resolveSceneId`** | `resolveSceneId(characterName: string, animName: string, source?: GeneratedSpriteManifest): string \| null` | NEW, `src/webview/sprites/spriteManifest.ts` (sibling of `sceneForId` / `defaultScene`) | The 3-layer cascade walk (§2.1). Returns a scene id, `"none"`, or `null` (no registry). The scene analogue of `resolvePlayback`. Exported for unit coverage. |
| `sceneForId` | (existing) `sceneForId(sceneId, manifest)` | `spriteManifest.ts:282` | UNCHANGED — id → `SpriteScene \| null`. The resolved id from `resolveSceneId` (when not `"none"`/`null`) is passed to `sceneForId` to get the `image`. |
| `defaultScene` | (existing) `defaultScene(manifest)` | `spriteManifest.ts:296` | UNCHANGED — still the floor resolver; `resolveSceneId` calls into the `scenes.defaultSceneId` it reads. |

`resolveSceneId` returning `"none"` → tile/preview omit `data-scene-bg`. Returning a scene id → tile/preview call `sceneForId(id)` for the `image`. Returning `null` → omit (no registry).

### 5.6 Export sites + manifest field names (LOCKED)

| Identifier | Kind | Location (owner) | Definition |
|---|---|---|---|
| `SpriteCharacter.scenes?` | manifest type field | `src/webview/sprites/spriteManifest.ts` (Felix bakes; Maya reads) | `Record<string /*animName*/, string /*sceneId \| "none"*/>` — the per-char scene block, baked from `animations.json`'s `scenes`. |
| `GeneratedSpriteManifest.sceneDefaults?` | manifest type field | `spriteManifest.ts` (Felix bakes; Maya reads) | `Record<string /*animName*/, string /*sceneId \| "none"*/>` — the pose-default scene block, baked from `pose-defaults.json`'s `scenes`. Named `sceneDefaults` to parallel `poseDefaults` and NOT collide with the existing `scenes: SpriteScenes` REGISTRY field. |
| `resolveSceneId` | function | `spriteManifest.ts` (defined by whoever lands the cascade — recommend Felix with the manifest fields, Maya imports) | §5.5 |
| `sceneId` | wire field | `src/shared/messages.ts` `SavePlaybackOverrideMessage.payload.override` (Felix host + Maya webview both import) | §5.3 |
| on-disk block key | json key | `animations.json` + `pose-defaults.json` | `scenes` (§5.1) |
| `"none"` | sentinel string | everywhere | §5.2 |

**Three manifest-root fields now coexist — do NOT confuse them:**
- `scenes: SpriteScenes` — the REGISTRY (`{ defaultSceneId, byId }`, the available rooms). EXISTING.
- `sceneDefaults: Record<anim, sceneId>` — the POSE-DEFAULT layer (which scene each pose inherits). NEW.
- per-char `SpriteCharacter.scenes: Record<anim, sceneId>` — the PER-CHAR layer. NEW.

The registry is "what scenes exist"; the two `*scenes`/`sceneDefaults` blocks are "which scene each pose uses." Keep the registry name `scenes` (existing, locked by V1) and the new layers `sceneDefaults` (root) + `SpriteCharacter.scenes` (per-char). The per-char one reuses the `scenes` name because it lives under `SpriteCharacter` (no collision with the root `scenes` registry).

---

## 6. Cross-ref — scene-bg V1 contract (86ca3kjyk): defaultSceneId pointer UNCHANGED

This feature is the **architected call-site upgrade** the `SpriteScenes` JSDoc anticipated (`src/webview/sprites/spriteManifest.ts:143-161`, verified this task):

> "The shape is architected so per-ROLE scenes are a DATA-ONLY upgrade: add more entries to `byId` and let a future member/character field name a `sceneId`; the registry shape and the default-pointer contract are unchanged."

**What is unchanged (LOCKED — do NOT touch):**
- `SpriteScenes = { defaultSceneId, byId }` — the registry shape. UNCHANGED.
- `defaultSceneId` (= `"room3"`) — still the floor of the cascade (layer 3, §2). The V1 "every tile uses `defaultScene()`" behavior becomes the CASCADE FLOOR: a pose with no per-char and no pose-default scene override resolves to `defaultSceneId`, exactly as today. UNCHANGED.
- `sceneForId` / `defaultScene` — the registry resolvers. UNCHANGED (the new `resolveSceneId` calls THROUGH them; it does not replace them).
- The `data-scene-bg` + `--ct-scene-url` + scrim render vocabulary (§FIRM.4). UNCHANGED — the scene cascade decides WHICH scene id (or none) resolves; the RENDER of a resolved scene is the existing §FIRM machinery verbatim.

**What this feature ADDS (the upgrade):** the two cascade layers ABOVE `defaultSceneId` — per-char `scenes` + pose-default `sceneDefaults` — so a pose can OVERRIDE the shared default (or opt OUT to flat card via `"none"`). The V1 "one shared room behind everything" is now "one shared room as the inherited default, overridable per pose per character." The `defaultSceneId` pointer contract that V1 locked is the floor this builds on — never modified.

The brief's call-site phrasing: V1 wired every tile to `defaultScene()`. This feature replaces that single call with `resolveSceneId(char, anim)` at the SAME call sites (`agentTile.ts:301-318`, `multiAgentPersonaTile.ts:289-298`, `playbackTunerPreview.ts:182-200`) — the call site upgrades from "always the default" to "the cascade-resolved scene"; the resolver's FLOOR is still `defaultScene()`'s value. That is the architected upgrade, no registry/pointer change.

---

## 7. Seed note (decision 8)

`pose-defaults.json` ships with a `scenes` block seeding the desk-clash fix:

```jsonc
{
  "playback": { },
  "scenes": {
    "active_work": "none",
    "active_read": "none"
  }
}
```

**Effect:** the two DESK poses (`active_work`, `active_read` — which bake their OWN desk + monitor into the sprite, per `persona-pixel-character-animation-prompts.md` + scene-bg-design-spec Catch 1) resolve to `"none"` → flat card → **no room behind the desk → no double-desk / no grounding clash** (`[[project_scene_bg_clash_finding]]`). The IDLE poses have NO entry in the seed → they fall through to the manifest `defaultSceneId` → **`room3`**, so idles keep standing in the room (the validated `room3_idle.png` composite). This is exactly the §FIRM.3 / Catch-1 1D resolution, now expressed as DATA in the cascade rather than a hard-coded special case.

**Seed lives at the pose-default layer** (not per-char) because the desk-clash applies to EVERY character's desk poses (all share the desk-state architecture) — one pose-default `scenes` block fixes it for the whole roster, exactly as decision 8 specifies ("idles keep `room3` via the default pointer").

**Crossfade interaction:** because the seed makes work poses `none` and idle poses `room3`, an agent toggling work↔idle flips the backdrop `none`↔`room3` on every tool-call boundary — this is precisely the transition the §3 crossfade smooths (the most common live trigger). Without the crossfade the room would blink in/out on every Read/non-Read toggle (the exact flicker Catch-1 option 1A was rejected for); WITH the 200ms crossfade it reads as a gentle dissolve — which is why decision 5 (crossfade) and decision 8 (seed) are complementary, not independent.

---

## 8. Design tokens (theme-aware)

The scene cascade adds NO new theme-dependent surfaces. New tokens (all `--ct-*`, consistent with §FIRM.4):

| Token | Value | Notes |
|---|---|---|
| `--ct-scene-crossfade-ms` | `200ms` | crossfade duration (§3.2); render-tunable |
| `--ct-scene-crossfade-ease` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | ease-in-out cross-dissolve (§3.2) |

UNCHANGED + reused: `--ct-scene-url`, `--ct-scene-scrim`, `--ct-scene-scrim-hover`, `--ct-scene-anchor-y` (§FIRM.4). The scene + scrim stay intentionally theme-independent (§FIRM.3) — the crossfade is opacity-only, no theme remap. The tuner scene-picker chrome uses the EXISTING tuner `--vscode-*` tokens (`<select>` = `--vscode-settings-dropdownBackground` / `--vscode-settings-dropdownBorder`; shadowing warning = `--vscode-inputValidation-warning*`; effective-source line = `--vscode-descriptionForeground`) — anim-tuner-spec §8. No new `--vscode-*` token needed.

`[hidden]`-guard reminder (load-bearing): if the scene shadowing-warning element is toggled via the `hidden` attribute AND its CSS declares `display:flex|grid`, it MUST carry a `.<class>[hidden] { display:none }` guard (jsdom won't catch its absence — `vscode-extension-conventions.md` § `[hidden]`-toggled flex/grid). E5-class test is source-derived (scan, don't allowlist).

---

## 9. Accessibility

- The scene `<select>` has a visible `Backdrop` label AND an `aria-label` ("Tile backdrop scene for this pose") — no icon-only (Iris hard rule). Each option has a text label (`Inherit (…)`, `None (flat card)`, `room3 (default)`).
- The effective-source line + shadowing warning are real text (screen-reader accessible) — they are the SR representation of the resolved backdrop state (the backdrop `<img>`/CSS-bg is decorative, `aria-hidden`).
- Focus order: the scene `<select>` slots into the existing tuner focus chain AFTER Mode and BEFORE Write target (§1.1 placement): … → mode → **scene** → write-target → close.
- The crossfade is decorative motion → suppressed under `prefers-reduced-motion: reduce` on the dashboard tiles (hard cut), per §3.2. (Tuner preview overrides this to always animate, scoped exception, anim-tuner-spec §5.4.)

---

## 10. Out of scope (for the build wave — explicit)

The Felix ∥ Maya build wave for THIS feature MUST NOT include:

1. **New scene ART / PixelLab generation** — decision 6: mechanism ships with `room3` ONLY. New rooms are a separate sponsor-present PixelLab arc (PNGs auto-join via the build's scene-copy step, zero code).
2. **A per-project scene override layer** — decision 7: scope is GLOBAL/shared. The cascade is 3-layer, no project layer.
3. **A thumbnail-grid scene picker** — §1.2: the `<select>` is chosen; a grid is a deferred nicety if the scene library grows large.
4. **Registry-shape or `defaultSceneId`-pointer changes** — §6: the V1 contract is unchanged; this feature only adds the two cascade layers above the floor.
5. **Animating the SPRITE pose transition** — §3.3: only the BACKDROP cross-dissolves; the sprite swaps pose on its existing cadence.
6. **Re-rolling the desk poses to sit in a room** — Catch-1 1B was rejected; the seed (§7 `none` for desk poses) is the chosen fix, not a pose re-gen.
7. **Per-anim-instance scenes inside the multi-agent expand rows** — `.persona-instances` rows are sprite-less + flat (§FIRM.3 Q4); they get NO scene, hence NO scene cascade. The cascade applies to sprite-bearing tiles + the tuner preview only.

---

## 11. Dispatch-readiness checklist (zero clarifying rounds)

Felix (host) + Maya (webview) implement directly from this spec. Decisions are all made:

- ✅ Scene picker = native `<select>` row in the tuner, `── Scene ──` section above Write target (§1.1–1.2).
- ✅ Dropdown contents: `Inherit (<resolved>)` + `None (flat card)` + one-per-scene-id (`room3 (default)`); default = `Inherit` (§1.2).
- ✅ N=1 behavior: 3-option picker is functional; `None` vs `room3` IS the V1 value — do NOT hide (§1.4).
- ✅ Preview renders backdrop live from the draft, with the §3 crossfade on dropdown change (§1.5).
- ✅ Reuses the existing per-char / pose-default write-target chooser + `ui:save-playback-override` round-trip + persistence banner (§1.6).
- ✅ 3-layer cascade `resolveSceneId` (per-char → pose-default → defaultSceneId), 3-state value (id \| `"none"` \| unset), `"none"` STOPS the cascade (§2).
- ✅ Crossfade: 200ms ease-in-out opacity cross-dissolve, all 4 directions incl. to/from flat card, reduced-motion = hard cut (§3).
- ✅ Degrade: no-registry → flat; dangling id → build-time drop+warn (+ runtime `sceneForId` null defense); `"none"` → flat via existing omit-`data-scene-bg` path (§4).
- ✅ **Vocabulary contract LOCKED** (§5): on-disk block `scenes` sibling of `playback`; sentinel `"none"`; wire field `sceneId` on the existing message; overlay parity invariant; resolver `resolveSceneId`; manifest fields `SpriteCharacter.scenes` + `GeneratedSpriteManifest.sceneDefaults`; export sites named.
- ✅ Scene-bg V1 `defaultSceneId` pointer contract UNCHANGED — this is the architected call-site upgrade (§6).
- ✅ Seed: `pose-defaults.json` `scenes: { active_work: "none", active_read: "none" }` (§7).
- ✅ Tokens theme-aware (§8); a11y (§9); OOS (§10).

**Build-script change is Felix's spec-edge** (§4.1): add `"scenes"` to `POSE_DEFAULTS_ROOT_KEYS`, read + sanitize `parsed?.scenes` (per-char + pose-default), validate values against `byId` (dangling drop+warn) + the `"none"` sentinel, bake `SpriteCharacter.scenes` + `GeneratedSpriteManifest.sceneDefaults`.

**No open sponsor item** — the 8 decisions are LOCKED; every design choice here either canonicalizes one of them or is a render-tunable default (crossfade 200ms / ease-in-out) the sponsor feel-tunes post-merge with zero re-spec.
