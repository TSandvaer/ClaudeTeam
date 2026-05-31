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

import type { PlaybackOverride } from "./spritePlayer.js";
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

/** One character's full animation set. */
export interface SpriteCharacter {
  /** Character folder name (e.g. "ClaudeTeam-M01-Dev"). */
  character: string;
  /** Canonical default idle anim name (e.g. "idle_coffee"). */
  defaultIdle: string | null;
  /** Canonical names of all resolved idle-pool anims. */
  idlePool: string[];
  /** Canonical anim name → frame data. */
  animations: Record<string, SpriteAnimation>;
}

/** Shape of the generated manifest module. */
export interface GeneratedSpriteManifest {
  characters: Record<string, SpriteCharacter>;
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
