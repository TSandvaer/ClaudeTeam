/**
 * spriteManifest — webview sprite lookup: member id → character → animation
 * frames. Pure data + pure accessors; no DOM, no VS Code API (unit-testable).
 *
 * Two pieces of data:
 *   1. `MEMBER_SPRITE_BINDING` — roster member id → sprite character folder.
 *      ONLY members present here render a pixel character; everyone else
 *      degrades to the existing text tile (no sprite box, no broken image —
 *      AC5). The monogram / never-run skin is E-05's scope, not this ticket.
 *
 *      PROVISIONAL binding (flagged in the PR body for sponsor confirm):
 *      only two sprites exist today — the generic "Dev" characters
 *      `ClaudeTeam-M01-Dev` + `ClaudeTeam-F01-Dev`. The roster's two devs are
 *      Felix + Maya, so they get the dev sprites. There is NO sponsor-locked
 *      member→face mapping yet (DECISIONS 2026-05-28 confirms M01/F01 are
 *      generic dev characters, not bound to personas). When more characters
 *      land (M02-M05, F02-F05), extend this map.
 *
 *   2. `GENERATED_SPRITE_MANIFEST` (imported) — per-character anim frame paths,
 *      baked at build time by scripts/build-sprite-manifest.mjs (PixelLab does
 *      NOT export semantic anim names; slugs are discovered at build time).
 *
 * Source: team/iris-ux/whole-team-display-spec.md §3 (sprite rendering, fallback)
 *         .claude/docs/persona-pixel-character-animation-prompts.md
 *           § Naming convention + § Webview wiring note
 */

import { GENERATED_SPRITE_MANIFEST } from "./generatedManifest.js";

/** One animation: its build-time-resolved frame paths (relative to dist/webview/). */
export interface SpriteAnimation {
  /** Source slug folder under _pixellab_anims/ (provenance / debugging). */
  folder: string;
  /** Ordered frame paths relative to dist/webview/ (south view only). */
  frames: string[];
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

/**
 * Roster member id → sprite character folder. See file header for the
 * PROVISIONAL nature of this binding.
 */
export const MEMBER_SPRITE_BINDING: Record<string, string> = {
  felix: "ClaudeTeam-F01-Dev",
  maya: "ClaudeTeam-M01-Dev",
};

/**
 * Look up the sprite character bound to a roster member id. Returns the
 * `SpriteCharacter` (with resolved frame paths) when both (a) the member is
 * bound AND (b) the generated manifest actually has frames for that
 * character. Returns `null` otherwise — the caller renders the text-only
 * tile (AC5: no broken image).
 */
export function spriteForMember(
  memberId: string,
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): SpriteCharacter | null {
  const charName = MEMBER_SPRITE_BINDING[memberId];
  if (charName === undefined) {
    return null;
  }
  const char = manifest.characters[charName];
  if (!char || Object.keys(char.animations).length === 0) {
    return null;
  }
  return char;
}
