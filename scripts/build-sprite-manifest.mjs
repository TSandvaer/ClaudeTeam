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
 * Discover the single animation directory inside
 * `<charDir>/_pixellab_anims/<folder>/animations/` and return its south
 * frame paths (sorted), relative to `dist/webview/`.
 */
async function resolveAnimFrames(charName, folder) {
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
  if (slugDirs.length === 0) {
    return null;
  }
  // Exactly one animation per folder (state-per-pose). If more than one
  // appears (stray), take the first deterministically and warn.
  if (slugDirs.length > 1) {
    console.warn(
      `[sprite-manifest] ${charName}/${folder} has ${slugDirs.length} animation dirs; using "${slugDirs[0]}"`,
    );
  }
  const slug = slugDirs.sort()[0];
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
  for (const [canonical, folder] of Object.entries(animMap.animations ?? {})) {
    const framePaths = await resolveAnimFrames(charName, folder);
    if (framePaths === null) {
      console.warn(
        `[sprite-manifest] ${charName}: anim "${canonical}" (folder "${folder}") has no frames — skipping`,
      );
      continue;
    }
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
