/**
 * Type declarations for the pure helpers exported from
 * scripts/build-sprite-manifest.mjs so unit tests (tests/unit/webview/
 * buildSpriteManifest.test.ts) can import them under `tsc --noEmit` without an
 * implicit-any error. Only the pure, exported, unit-tested helpers are declared
 * here — the script's IO entry point (`main`) is not exported and not declared.
 */

/** Parse an `animations.json` map value into folder + optional explicit slug. */
export function parseAnimValue(value: string): {
  folder: string;
  animSlug: string | null;
};

/**
 * Pick the animation slug to resolve from the discovered dir names and an
 * optional explicit slug (folder/slug form). `ambiguous` is true only for the
 * legacy bare-folder form when the folder unexpectedly holds more than one anim.
 */
export function pickAnimSlug(
  slugDirs: string[],
  animSlug: string | null,
): { slug: string | null; ambiguous: boolean };
