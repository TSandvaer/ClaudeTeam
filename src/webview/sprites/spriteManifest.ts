/**
 * spriteManifest — webview sprite lookup: member id → character → animation
 * frames. Pure data + pure accessors; no DOM, no VS Code API (unit-testable).
 *
 * Two pieces of data:
 *   1. `MEMBER_SPRITE_BINDING` — roster member id → sprite character folder.
 *      The LEGACY gender binding, now a FALLBACK only (team-setup epic
 *      Decision 7 / spec §5.3 supersedes it with a per-member `character`
 *      choice). Used when a tile has NO `character` field (`undefined` — the
 *      pre-team-setup roster, or a host that hasn't stamped the field yet).
 *      When a tile DOES carry `Member.character` (a `CharacterSource` id, or
 *      explicit `null` for text tile), that drives the render instead — see
 *      `spriteForMember`'s `character` param + `spriteForCharacterId`.
 *
 *      GENDER binding (legacy, sponsor decision 2026-05-29 — see
 *      team/DECISIONS.md): all six roster members share the two harvested
 *      "Dev" characters by gender:
 *        - male   → `ClaudeTeam-M01-Dev`: felix, bram
 *        - female → `ClaudeTeam-F01-Dev`: maya, iris, nora, sage
 *      This remains the fallback so a project still on the pre-team-setup
 *      roster (no per-member character) keeps its sprites. Once the host
 *      stamps `tile.character` from `claudeteam.yaml`, the per-member choice
 *      takes over and this table is no longer consulted for that tile.
 *
 *   2. `GENERATED_SPRITE_MANIFEST` (imported) — per-character anim frame paths,
 *      baked at build time by scripts/build-sprite-manifest.mjs (PixelLab does
 *      NOT export semantic anim names; slugs are discovered at build time).
 *
 * Source: team/iris-ux/whole-team-display-spec.md §3 (sprite rendering, fallback)
 *         .claude/docs/persona-pixel-character-animation-prompts.md
 *           § Naming convention + § Webview wiring note
 */

import type { PlaybackOverride, PlaybackOverrideTable } from "./spritePlayer.js";
import { GENERATED_SPRITE_MANIFEST } from "./generatedManifest.js";

/** One animation: its build-time-resolved frame paths (relative to dist/webview/). */
export interface SpriteAnimation {
  /** Source slug folder under _pixellab_anims/ (provenance / debugging). */
  folder: string;
  /** Ordered frame paths relative to dist/webview/ (south view only). */
  frames: string[];
  /**
   * Per-animation playback tuning (anim-playback epic E2, 86ca2187g). Baked by
   * `scripts/build-sprite-manifest.mjs` from each character's `animations.json`
   * `playback` block (validated there — malformed fields dropped). Absent when
   * the anim has no playback overrides → the engine uses its defaults. Read by
   * `resolvePlayback` (spritePlayer.ts), which replaced the hardcoded
   * `PLAYBACK_OVERRIDES` map this manifest field supersedes.
   */
  playback?: PlaybackOverride;
}

/**
 * Per-character render-fit (ticket 86ca5b0gj; roster-wide AUTO-normalization
 * 86ca8n5pe). The roster mixes canvas sizes (92×92 v3 vs 68×68 legacy) AND fill
 * ratios — a v3 figure is ≈51% of its 92px canvas; a legacy M02 figure ≈71% of
 * its 68px canvas. `.sprite-frame` uses `object-fit: contain`, which fits the
 * WHOLE square canvas (including the transparent margin) into the fixed box — so
 * without correction a v3 char renders ≈51/71 ≈ 0.7× the apparent figure size of
 * an M02 char AND at a different vertical anchor.
 *
 * The build script (`scripts/build-sprite-manifest.mjs` → `computeRenderFit`)
 * MEASURES each character's figure bbox from its base/idle south frame and bakes
 * this block automatically so EVERY roster character (current + future M04/F03 —
 * no per-char special-casing) renders its figure at a UNIFORM on-tile height,
 * grounded on the scene floor. A character's `animations.json` MAY also carry a
 * hand-tuned `render` block that overrides the auto values per-field (the sponsor
 * nudge lever); the auto value is the default.
 *
 * The three fields drive a feet-anchored CSS transform on `.sprite-frame`:
 *   - `transform-origin: center <feetAnchorPct>` — the scale pivots about the
 *     figure's FEET, so the feet do NOT drift when the figure is enlarged. This
 *     is what preserves grounding on a scene room (floor pinned to box bottom);
 *     the old `center center` origin floated the figure off the floor.
 *   - `scale` enlarges/shrinks the figure about the feet to the uniform target.
 *   - `offsetY` (translateY %, applied after the scale) drops the feet from their
 *     measured position to the box bottom = the room floor.
 *
 * Absent → no transform (identity) → an unmeasured / render-less character renders
 * BYTE-IDENTICALLY (no-regression contract). The values bake into the
 * `--ct-render-scale` / `--ct-render-offset-y` / `--ct-render-feet-anchor` custom
 * props on each `.sprite-box`; the dashboard.css `:root` fallback tokens (1 / 0% /
 * 50%) are the single nudge point to retune the WHOLE roster without a rebuild.
 */
export interface SpriteRenderFit {
  /** Figure-size multiplier (CSS `scale`). 1 = unchanged. Computed as
   *  TARGET_FIGURE_FRACTION / measured-fill so the on-tile figure height is
   *  uniform across the roster. Absent → 1. */
  scale?: number;
  /** Vertical re-anchor as a % of the sprite box, POSITIVE = DOWN / forward
   *  toward the viewer (CSS `translateY(<offsetY>%)`). Computed as
   *  100 − feetAnchorPct so the feet drop to the box bottom (the room floor).
   *  Absent → 0. */
  offsetY?: number;
  /** The figure's FEET position as a % of the sprite box (CSS `transform-origin`
   *  Y). Measured = (figureBottom + 1) / canvasH × 100. Scaling pivots about this
   *  point so the feet stay grounded when the figure is enlarged. Absent → 50%
   *  (center — the legacy identity origin for an unmeasured char). */
  feetAnchorPct?: number;
}

/** One character's full animation set. */
export interface SpriteCharacter {
  /** Character folder name (e.g. "ClaudeTeam-M01-Dev"). */
  character: string;
  /**
   * Per-character render-fit correction (ticket 86ca5b0gj). Applied as a CSS
   * transform on the character's `.sprite-frame` so v3 92×92 sprites render at
   * the same apparent size + vertical anchor as the legacy 68×68 chars. Absent
   * → identity (no transform) → 68px chars unchanged. See `SpriteRenderFit`.
   */
  render?: SpriteRenderFit;
  /** Canonical default idle anim name (e.g. "idle_coffee"). */
  defaultIdle: string | null;
  /** Canonical names of all resolved idle-pool anims. */
  idlePool: string[];
  /**
   * Canonical names of all resolved active-pool anims (ticket 86ca3mge9). The
   * webview picks ONE per ACTIVE episode (running + tool != Read) and loops it,
   * exactly mirroring `idlePool` + idle-episode stickiness. Empty for a
   * character with no `active_pool` declared — the pose picker then falls back
   * to the single `active_work` pose (legacy behavior). `active_read`
   * (tool == Read) is NEVER drawn from this pool.
   */
  activePool: string[];
  /**
   * Per-character active-pool rotation cadence (ticket 86ca4atwt §A.2 cascade
   * layer 1) — loops-per-pose before the working tile advances IN ORDER. Baked
   * from the character's `animations.json` top-level `activePoolLoopsPerPose` when
   * present. WINS over the `claudeteam.activePoolLoopsPerPose` config (layer 2),
   * which wins over the engine default 1 (layer 3). Absent on characters whose
   * `animations.json` doesn't declare it (the common case) → the config/engine
   * cadence applies. NOT per-anim — a single per-character value.
   */
  activePoolLoopsPerPose?: number;
  /**
   * Per-character scene-override block (scene-per-pose feature, 86ca88nvd —
   * LOCKED vocabulary §5.6). Keyed by canonical anim name; the value is a scene
   * id OR the literal `"none"` sentinel (flat card, stops the cascade). Baked by
   * `scripts/build-sprite-manifest.mjs` from each character's `animations.json`
   * top-level `scenes` block (validated there — dangling ids dropped + warned).
   * This is the HIGHEST-priority layer of the 3-layer scene cascade (layer 1 —
   * see `resolveSceneId`): per-char wins over `sceneDefaults` wins over
   * `scenes.defaultSceneId`. An anim ABSENT here = unset = inherit the next
   * layer. Absent block (the common case) → every pose inherits. NOT the scene
   * REGISTRY — that is the manifest-root `scenes: SpriteScenes`; this names WHICH
   * scene each pose uses, not which scenes exist (spec §5.6 three-field note).
   */
  scenes?: Record<string, string>;
  /** Canonical anim name → frame data. */
  animations: Record<string, SpriteAnimation>;
}

/**
 * One scene backdrop — a static (single-image) pixel-art room rendered behind
 * the agent tile (scene-bg feature, 86ca3kjyk; full-bleed + scrim per Iris's
 * spec §FIRM). Unlike a `SpriteAnimation` (a frame SEQUENCE), a scene is ONE
 * flat image, so it carries a single `image` path, not a `frames[]` array.
 */
export interface SpriteScene {
  /** Stable scene id (e.g. `"room3"`). Same value as the `byId` key. */
  id: string;
  /**
   * Scene image path relative to `dist/webview/` (e.g.
   * `"sprites/scenes/room3.png"`) — IDENTICAL convention to `SpriteAnimation.frames`.
   * The webview prefixes it with the host-injected `spriteBaseUri` (the
   * `asWebviewUri` of `dist/webview`) to build the final `--ct-scene-url`.
   */
  image: string;
}

/**
 * The scene registry baked onto the manifest (scene-bg feature, 86ca3kjyk).
 * V1 ships ONE SHARED scene (per ticket + Iris spec §FIRM.3 "start SHARED,
 * architect per-role") — `defaultSceneId` points every tile at the one room in
 * `byId`. The shape is architected so per-ROLE scenes are a DATA-ONLY upgrade:
 * add more entries to `byId` and let a future member/character field name a
 * `sceneId`; the registry shape and the default-pointer contract are unchanged.
 *
 * Resolution contract (LOCKED): a tile with no explicit scene choice resolves
 * `scenes.byId[scenes.defaultSceneId]`. Maya's webview reads the resolved
 * scene's `image`, prefixes it with `spriteBaseUri`, and sets the inline
 * `--ct-scene-url` custom property + the `data-scene-bg` attribute (Iris §FIRM.4).
 */
export interface SpriteScenes {
  /** Id of the scene every tile uses by default (e.g. `"room3"`). */
  defaultSceneId: string;
  /** Scene id → scene. The shared-V1 registry has exactly one entry. */
  byId: Record<string, SpriteScene>;
}

/** Shape of the generated manifest module. */
export interface GeneratedSpriteManifest {
  characters: Record<string, SpriteCharacter>;
  /**
   * Scene-backdrop registry (scene-bg feature, 86ca3kjyk). Baked by
   * `scripts/build-sprite-manifest.mjs` from `assets/sprites/scenes/*.png`.
   * Absent when the scenes dir has no images (degrade path: no scene → today's
   * flat card, per Iris spec §FIRM.3). Read via `sceneForId` / `defaultScene`.
   */
  scenes?: SpriteScenes;
  /**
   * Pose-default SCENE block (scene-per-pose feature, 86ca88nvd — Iris spec §5.6
   * LOCKED). The POSE-DEFAULT layer (layer 2, middle) of the 3-layer scene
   * cascade: canonical anim name → a scene id OR the literal `"none"` sentinel.
   * Shared across ALL characters. Baked by `scripts/build-sprite-manifest.mjs`
   * from the repo-root `pose-defaults.json` `scenes` block (validated there —
   * dangling ids dropped). A key ABSENT = unset (inherit → falls through to the
   * registry's `defaultSceneId`, layer 3). Absent block = no pose-default scenes.
   *
   * Read by `resolveSceneId` as the MIDDLE layer: per-char `SpriteCharacter.scenes`
   * wins, else this `sceneDefaults`, else `scenes.defaultSceneId` (the floor).
   *
   * Named `sceneDefaults` to PARALLEL `poseDefaults` and NOT collide with the
   * manifest-root `scenes` REGISTRY field (`SpriteScenes`, "which scenes exist").
   * The registry is `scenes`; this cascade layer is `sceneDefaults` ("which scene
   * each pose inherits"). Three distinct manifest-root scene-related fields —
   * `scenes` (registry), `sceneDefaults` (pose-default layer), per-char
   * `SpriteCharacter.scenes` (per-char layer) — do NOT confuse them (spec §5.6).
   */
  sceneDefaults?: Record<string, string>;
  /**
   * Pose-keyed playback DEFAULTS, shared across ALL characters (anim-playback
   * epic E3, 86ca2187n). Baked by `scripts/build-sprite-manifest.mjs` from the
   * repo-root `assets/sprites/pose-defaults.json` `playback` block (validated
   * there — malformed fields dropped). Keyed by canonical anim name.
   *
   * Read by `resolvePlayback` as the MIDDLE layer of a 3-layer FIELD-LEVEL
   * cascade: per-character `animations[anim].playback.<field>` wins, else this
   * pose-default's `<field>`, else the engine default (absent-field behavior).
   * The merge is per-field (`{ ...poseDefault, ...perChar }`), NOT whole-object
   * — a per-char override that sets only `speedMultiplier` still inherits this
   * pose-default's `playbackMode`/`finalDwellMs`.
   *
   * Absent / `{}` → byte-identical to the E2 end-state (no pose-default layer).
   */
  poseDefaults?: PlaybackOverrideTable;
}

/** Male "Dev" character folder. Bound to the male roster members by gender. */
const MALE_DEV = "ClaudeTeam-M01-Dev";
/** Female "Dev" character folder. Bound to the female roster members by gender. */
const FEMALE_DEV = "ClaudeTeam-F01-Dev";

/**
 * Roster member id → sprite character folder. Sponsor-decided GENDER binding
 * (2026-05-29) — all six roster members share the two harvested "Dev"
 * characters by gender. See the file header for the rule + the fix it applies
 * (the earlier provisional binding had felix/maya genders swapped).
 */
export const MEMBER_SPRITE_BINDING: Record<string, string> = {
  // male → M01-Dev
  felix: MALE_DEV,
  bram: MALE_DEV,
  // female → F01-Dev
  maya: FEMALE_DEV,
  iris: FEMALE_DEV,
  nora: FEMALE_DEV,
  sage: FEMALE_DEV,
};

/**
 * Look up a sprite character by its `CharacterSource` id (team-setup epic
 * Decision 7 / spec §5.3). The id IS the manifest character-folder key for
 * bundled characters (e.g. `"ClaudeTeam-M01-Dev"`); the host's
 * `resolveCharacterSources()` uses the folder name as the stable id, so the
 * manifest lookup is direct.
 *
 * Returns the `SpriteCharacter` (with resolved frame paths) when the manifest
 * has frames for that id; `null` otherwise (unknown id — e.g. a user-folder
 * character that isn't baked into THIS bundle, or an id that no longer
 * resolves). A `null` result → the caller renders the text-tile fallback (no
 * broken image), exactly as for an unbound member.
 */
export function spriteForCharacterId(
  characterId: string,
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): SpriteCharacter | null {
  const char = manifest.characters[characterId];
  if (!char || Object.keys(char.animations).length === 0) {
    return null;
  }
  return char;
}

/**
 * Resolve the sprite character a member's tile should render (team-setup epic
 * Decision 7 / spec §5.3 — per-member character REPLACES the gender binding).
 *
 * Resolution order:
 *   1. `character` is a non-null id  → resolve by id via `spriteForCharacterId`.
 *      An unknown id falls through to `null` (text tile) — NOT the gender
 *      binding, because an explicit assignment that can't resolve in this
 *      bundle is honored as "render the text tile" rather than silently
 *      substituting a different character.
 *   2. `character === null`          → `null` (explicit text-tile choice).
 *   3. `character === undefined`     → LEGACY gender binding (`MEMBER_SPRITE_BINDING`)
 *      so a pre-team-setup roster (no per-member character) keeps its sprites.
 *
 * Returns the `SpriteCharacter` (with resolved frames) or `null`. `null` →
 * the caller renders the text-only tile (AC5/§5.3: no broken image).
 */
export function spriteForMember(
  memberId: string,
  character?: import("../../shared/types.js").MemberCharacter,
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): SpriteCharacter | null {
  // Per-member character (team-setup) takes precedence when the field is
  // present (incl. explicit null).
  if (character !== undefined) {
    if (character === null) {
      return null;
    }
    return spriteForCharacterId(character, manifest);
  }
  // Legacy fallback — gender binding by member id (pre-team-setup roster).
  const charName = MEMBER_SPRITE_BINDING[memberId];
  if (charName === undefined) {
    return null;
  }
  return spriteForCharacterId(charName, manifest);
}

/**
 * Look up a scene backdrop by its id (scene-bg feature, 86ca3kjyk). Returns the
 * `SpriteScene` (with its build-time-resolved `image` path) when the manifest
 * has a scene registry containing that id; `null` otherwise. A `null` result →
 * the caller omits `data-scene-bg` and the tile keeps today's flat card (the
 * load-bearing degrade path, Iris spec §FIRM.3).
 */
export function sceneForId(
  sceneId: string,
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): SpriteScene | null {
  return manifest.scenes?.byId[sceneId] ?? null;
}

/**
 * Resolve the DEFAULT scene every tile uses when it has no explicit per-role
 * scene choice (scene-bg V1 ships one SHARED scene — see `SpriteScenes`).
 * Returns the scene named by `scenes.defaultSceneId`, or `null` when the
 * manifest has no scene registry (degrade → flat card). The per-role upgrade
 * replaces the call site's id, not this resolver.
 */
export function defaultScene(
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): SpriteScene | null {
  const scenes = manifest.scenes;
  if (scenes === undefined) {
    return null;
  }
  return sceneForId(scenes.defaultSceneId, manifest);
}

/**
 * The literal `"none"` sentinel (scene-per-pose feature, 86ca88nvd — LOCKED
 * vocabulary §5.2). A scene-override value of exactly `"none"` means "flat card
 * here — no backdrop"; it STOPS the cascade (does NOT fall through). Distinct
 * from `unset` (key absent → inherit). Both the resolver and any caller match
 * this exact lowercase string, never `"None"` / `null` / `""`.
 */
export const SCENE_NONE = "none";

/**
 * Resolve the scene a tile/preview should render for a given (character, pose),
 * walking the 3-layer scene cascade (scene-per-pose feature, 86ca88nvd — spec
 * §2.1; the scene analogue of `resolvePlayback`). Mirrors the playback cascade's
 * highest-priority-last precedence, but the merged unit is ONE field (`sceneId`)
 * so the field-level merge reduces to a first-non-unset-wins walk, with ONE
 * extra semantic the playback cascade lacks: the `"none"` STOP sentinel.
 *
 *   1. Per-character    `manifest.characters[char].scenes["<anim>"]`   (layer 1)
 *   2. Pose-default     `manifest.sceneDefaults["<anim>"]`             (layer 2)
 *   3. Manifest default `manifest.scenes.defaultSceneId`               (the floor)
 *
 * Per layer the value is one of THREE states (§2.1):
 *   - a scene id  → resolve to that id; STOP (this layer answered).
 *   - `"none"`    → flat card; STOP (does NOT fall through to the next layer).
 *   - unset (key absent) → fall through to the next layer.
 *
 * Returns:
 *   - a scene id string  → the caller passes it to `sceneForId(id)` for the image.
 *   - `"none"`           → the caller OMITS `data-scene-bg` → today's flat card
 *                          (the existing omit-data-scene-bg degrade path).
 *   - `null`             → no scene registry (manifest.scenes undefined) → the
 *                          caller OMITS `data-scene-bg` → flat card (V1 degrade).
 *
 * NOTE on dangling ids: a returned scene id is NOT guaranteed to exist in the
 * registry `byId` (a stale hand-edited overlay could name an unknown id). The
 * caller MUST pass it through `sceneForId`, whose null-coalescing treats an
 * unknown id as unresolvable → flat card (spec §4 runtime-dangling row).
 *
 * No project layer (decision 7 — scope is GLOBAL/shared across orchestrations).
 */
export function resolveSceneId(
  characterName: string,
  animName: string,
  source: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): string | null {
  // Layer 1 — per-character.
  const perChar = source.characters[characterName]?.scenes?.[animName];
  if (perChar !== undefined) {
    // A set value (scene id OR "none") answers — stop the walk.
    return perChar;
  }
  // Layer 2 — pose-default (shared across all characters).
  const poseDefault = source.sceneDefaults?.[animName];
  if (poseDefault !== undefined) {
    return poseDefault;
  }
  // Layer 3 — the floor: the registry's default scene id, or null when there is
  // no registry at all (degrade → flat card).
  return source.scenes?.defaultSceneId ?? null;
}
