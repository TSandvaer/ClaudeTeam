/**
 * build-sprite-manifest — generates the webview-consumable sprite manifest.
 *
 * Why this exists (load-bearing):
 *   - PixelLab does NOT export the semantic `animation_name` — the harvested
 *     folders are action-description slugs (`holding_a_coffee_cup`) and the
 *     single animation inside each is a slug+hash directory
 *     (`the_coffee_cup_stays_pressed_to_the_lips_and_both-f7bbb25b`). Neither
 *     is knowable by the webview at runtime. The canonical name→folder map
 *     lives in each character's committed `animations.json`; the inner
 *     animation-slug must be DISCOVERED by listing the `animations/` dir.
 *   - The webview runs under a strict CSP (`default-src 'none'`) and cannot
 *     `fs.readdir` or fetch a manifest at runtime. So we bake the resolved
 *     frame layout at BUILD time into a committed TS module the webview
 *     imports, plus copy the PNG frames into `dist/webview/sprites/` so they
 *     sit under the existing `localResourceRoots` (`dist/webview`).
 *
 * Outputs (two, both required):
 *   1. `src/webview/sprites/generatedManifest.ts` — committed TS module the
 *      webview imports. Per character: every canonical anim name → its
 *      relative frame paths (under `sprites/<char>/...`) + frameCount. The
 *      webview resolves a full webview-URI by prefixing the host-injected
 *      sprite base. Re-harvest-safe: re-run this script after any harvest /
 *      re-roll and the slugs are re-discovered automatically.
 *   2. `dist/webview/sprites/<char>/...` — copied PNG frames + rotations,
 *      reachable from the webview via `asWebviewUri` under the existing
 *      `dist/webview` localResourceRoot.
 *
 * Run automatically by `npm run build` (esbuild.config.mjs calls it). Also
 * runnable standalone: `node scripts/build-sprite-manifest.mjs`.
 *
 * Source: .claude/docs/persona-pixel-character-animation-prompts.md
 *         § Naming convention + § Webview wiring note
 *         team/iris-ux/whole-team-display-spec.md §3
 */

import { readdir, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPRITES_SRC = path.join(ROOT, "assets", "sprites");
const DIST_SPRITES = path.join(ROOT, "dist", "webview", "sprites");
const GENERATED_TS = path.join(
  ROOT,
  "src",
  "webview",
  "sprites",
  "generatedManifest.ts",
);

/** Recursively copy a directory tree (PNG frames + rotations). */
async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

/**
 * Parse an `animations.json` value into its folder + optional explicit anim
 * slug. The value-format (sponsor-locked 2026-05-29, see the manifests'
 * `_note`):
 *   - bare `<state_folder>` → folder holds exactly ONE animation; the inner
 *     slug is DISCOVERED at build time (legacy default).
 *   - `<state_folder>/<anim_slug>` → folder holds MORE THAN ONE animation;
 *     resolve THAT exact animation subfolder. Used by `active_work` +
 *     `active_read`, which now SHARE the `sitting_at_a_desk_fa` desk state
 *     (same posture → no book↔desk flip during active sessions), differing
 *     only by their residual motion (typing vs head-scan).
 *
 * Splits on the FIRST `/` only — the folder name itself never contains a
 * slash, and the anim slug never does either (PixelLab slugs are flat dir
 * names). Pure: no filesystem access, exported for unit coverage.
 *
 * @param {string} value the raw `animations.json` map value
 * @returns {{ folder: string, animSlug: string | null }}
 */
export function parseAnimValue(value) {
  const i = value.indexOf("/");
  if (i === -1) {
    return { folder: value, animSlug: null };
  }
  return { folder: value.slice(0, i), animSlug: value.slice(i + 1) };
}

/**
 * Pick the animation slug directory to resolve given the discovered slug dirs
 * and an optional explicit anim slug. Pure: takes the already-listed dir names
 * so it is unit-testable without a real filesystem.
 *
 *   - explicit `animSlug` supplied → must match one of `slugDirs` exactly;
 *     returns it, or null (caller logs + skips) if the named anim is absent.
 *     This is what disambiguates a multi-anim folder so `active_work` resolves
 *     to the WORKING anim and `active_read` to the READ anim within the shared
 *     `sitting_at_a_desk_fa` folder.
 *   - no `animSlug` (legacy bare-folder form) → sole-anim behavior: the single
 *     dir; if a stray extra appears, the alphabetically-first deterministically
 *     (with a warning by the caller). A bare-folder value pointing at a
 *     multi-anim folder is ambiguous and warned.
 *
 * @param {string[]} slugDirs animation dir names under `<folder>/animations/`
 * @param {string | null} animSlug explicit slug from the folder/slug form
 * @returns {{ slug: string | null, ambiguous: boolean }}
 */
export function pickAnimSlug(slugDirs, animSlug) {
  if (slugDirs.length === 0) {
    return { slug: null, ambiguous: false };
  }
  if (animSlug !== null) {
    // Folder/slug form — resolve the EXACT named anim; null if missing.
    return {
      slug: slugDirs.includes(animSlug) ? animSlug : null,
      ambiguous: false,
    };
  }
  // Legacy bare-folder form — expect exactly one anim per folder.
  const sorted = [...slugDirs].sort();
  return { slug: sorted[0], ambiguous: slugDirs.length > 1 };
}

/**
 * Discover the animation directory inside
 * `<charDir>/_pixellab_anims/<folder>/animations/` named by `value` and return
 * its south frame paths (sorted), relative to `dist/webview/`. `value` follows
 * the folder-or-folder/slug format parsed by `parseAnimValue`.
 */
async function resolveAnimFrames(charName, value) {
  const { folder, animSlug } = parseAnimValue(value);
  const animsParent = path.join(
    SPRITES_SRC,
    charName,
    "_pixellab_anims",
    folder,
    "animations",
  );
  if (!existsSync(animsParent)) {
    return null;
  }
  const slugDirs = (await readdir(animsParent, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const { slug, ambiguous } = pickAnimSlug(slugDirs, animSlug);
  if (slug === null) {
    if (animSlug !== null) {
      console.warn(
        `[sprite-manifest] ${charName}/${folder}: explicit anim slug "${animSlug}" not found among ${slugDirs.length} dir(s) — skipping`,
      );
    }
    return null;
  }
  if (ambiguous) {
    // Bare-folder value but the folder holds >1 anim — the value should have
    // used the folder/slug form to disambiguate. Resolve deterministically + warn.
    console.warn(
      `[sprite-manifest] ${charName}/${folder} has ${slugDirs.length} animation dirs but the value is a bare folder; using "${slug}" — use the "<folder>/<anim_slug>" form to disambiguate`,
    );
  }
  const southDir = path.join(animsParent, slug, "south");
  if (!existsSync(southDir)) {
    return null;
  }
  const frames = (await readdir(southDir))
    .filter((f) => /^frame_\d+\.png$/.test(f))
    .sort();
  if (frames.length === 0) {
    return null;
  }
  // Relative to dist/webview/ (the localResourceRoot base the webview prefixes).
  return frames.map(
    (f) =>
      `sprites/${charName}/_pixellab_anims/${folder}/animations/${slug}/south/${f}`,
  );
}

async function buildCharacter(charName) {
  const manifestPath = path.join(SPRITES_SRC, charName, "animations.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const animMap = JSON.parse(await readFile(manifestPath, "utf8"));
  const animations = {};
  for (const [canonical, value] of Object.entries(animMap.animations ?? {})) {
    const framePaths = await resolveAnimFrames(charName, value);
    if (framePaths === null) {
      console.warn(
        `[sprite-manifest] ${charName}: anim "${canonical}" (value "${value}") has no frames — skipping`,
      );
      continue;
    }
    // Store the bare folder (not the folder/slug value) for provenance.
    const { folder } = parseAnimValue(value);
    animations[canonical] = { folder, frames: framePaths };
  }
  // idle_pool filtered to anims that actually resolved to frames.
  const idlePool = (animMap.idle_pool ?? []).filter(
    (name) => animations[name] !== undefined,
  );
  return {
    character: charName,
    defaultIdle: animMap.default_idle ?? idlePool[0] ?? null,
    idlePool,
    animations,
  };
}

async function main() {
  if (!existsSync(SPRITES_SRC)) {
    console.warn(`[sprite-manifest] no assets/sprites dir — emitting empty manifest`);
  }

  const charNames = existsSync(SPRITES_SRC)
    ? (await readdir(SPRITES_SRC, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];

  const characters = {};
  for (const name of charNames) {
    const built = await buildCharacter(name);
    if (built) {
      characters[name] = built;
      // Copy this character's PNG tree into dist/webview/sprites/<char>/.
      const srcCharDir = path.join(SPRITES_SRC, name, "_pixellab_anims");
      if (existsSync(srcCharDir)) {
        await copyDir(
          srcCharDir,
          path.join(DIST_SPRITES, name, "_pixellab_anims"),
        );
      }
    }
  }

  const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Produced by scripts/build-sprite-manifest.mjs from assets/sprites/*\\/animations.json.
 * Re-run \`node scripts/build-sprite-manifest.mjs\` (or \`npm run build\`) after any
 * sprite harvest / re-roll. Frame paths are relative to dist/webview/; the
 * webview prefixes them with the host-injected sprite base URI.
 */
import type { GeneratedSpriteManifest } from "./spriteManifest.js";

export const GENERATED_SPRITE_MANIFEST: GeneratedSpriteManifest = ${JSON.stringify(
    { characters },
    null,
    2,
  )} as const;
`;

  await mkdir(path.dirname(GENERATED_TS), { recursive: true });
  await writeFile(GENERATED_TS, banner, "utf8");

  const charCount = Object.keys(characters).length;
  const animCount = Object.values(characters).reduce(
    (sum, c) => sum + Object.keys(c.animations).length,
    0,
  );
  console.log(
    `[sprite-manifest] wrote ${charCount} character(s), ${animCount} animation(s) → ${path.relative(ROOT, GENERATED_TS)}`,
  );
}

main().catch((err) => {
  console.error("[sprite-manifest] failed:", err);
  process.exit(1);
});
