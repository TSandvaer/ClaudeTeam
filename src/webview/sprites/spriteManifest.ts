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
 *      GENDER binding (sponsor decision 2026-05-29 — see team/DECISIONS.md):
 *      ALL SIX roster members are bound by gender to the two harvested "Dev"
 *      characters. Only `ClaudeTeam-M01-Dev` + `ClaudeTeam-F01-Dev` sprite
 *      folders exist on disk — that is expected; the six members share those
 *      two by gender:
 *        - male   → `ClaudeTeam-M01-Dev`: felix, bram
 *        - female → `ClaudeTeam-F01-Dev`: maya, iris, nora, sage
 *      This FIXES the earlier provisional binding (`felix → F01-Dev`,
 *      `maya → M01-Dev`), which had the genders backwards. No roster member
 *      resolves to the text fallback now — every member has a bound character.
 *      When per-persona characters land (M02-M05, F02-F05), re-point each
 *      member at its own character.
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
