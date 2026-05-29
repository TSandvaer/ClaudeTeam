/**
 * Character-source resolver (TS-02 / team-setup epic, Decision 7 / spec §5, §7.1).
 *
 * `resolveCharacterSources()` merges TWO sources into one {@link CharacterSource}
 * list for the picker grid:
 *   1. BUNDLED characters — baked into the `.vsix` via `dist/webview/sprites/`
 *      by the existing sprite-manifest build (86ca191uy). Every install has
 *      these working defaults.
 *   2. USER characters — optionally discovered at runtime from the
 *      user-character folder ({@link USER_CHARACTER_DIR}, ratify default
 *      `~/.claudeteam/characters/`). Net-new; absent on a clean install.
 *
 * ## Dedupe tiebreak: BUNDLED WINS (documented per backlog)
 *
 * When a bundled character id collides with a user-folder character id, the
 * BUNDLED entry wins (the user copy is dropped). Rationale: bundled characters
 * are the validated, shipped defaults; a user folder shadowing a bundled id
 * (accidental or otherwise) should not silently replace the known-good asset.
 * The merge processes bundled first, records seen ids, then appends only
 * user-folder ids not already seen.
 *
 * ## Valid-character validation (ratify default, spec §7.1)
 *
 * A user-folder subfolder is a VALID character iff it contains BOTH
 * `animations.json` AND a `_pixellab_anims/` directory (the PixelLab harvest
 * signature). Folders missing either are SKIPPED (logged, not surfaced as an
 * error — a half-finished harvest must not break the picker). Bundled chars
 * are discovered from the same shape under the dist sprites root.
 *
 * ## Thumbnail source (ratify default, spec §7.1)
 *
 * The picker thumbnail is the character's SOUTH rotation frame (front-facing
 * idle — the most recognizable single still). This module resolves a best-effort
 * `thumbnailPath`; exact frame selection mirrors the sprite-manifest's
 * south-frame discovery. When no south frame is found, `thumbnailPath` is the
 * character folder itself (the webview defends an unresolvable thumbnail per
 * spec §5.2 empty-grid edge case).
 *
 * ## Flippable constant (ratify-on-return, spec §7.1)
 *
 * {@link USER_CHARACTER_DIR_NAME} + {@link resolveUserCharacterDir} gate the
 * user-folder path behind a named constant so the sponsor's ratification is a
 * ONE-LINE change. Do NOT hard-bake the path at call sites.
 *
 * I/O: synchronous `fs`. Never throws — a missing folder yields an empty
 * contribution from that source.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { CharacterSource } from "../shared/types.js";

/**
 * The user-character folder name under the user home (ratify default — spec
 * §7.1). Gated behind a constant so a sponsor ratification flips it in one
 * place. Mirrors the (now-dropped) `~/.claudeteam/` roster convention.
 */
export const USER_CHARACTER_DIR_NAME = ".claudeteam/characters" as const;

/**
 * Resolve the absolute user-character directory. Default
 * `~/.claudeteam/characters/` (ratify default). An explicit `homeDir` arg lets
 * tests point it at a tempdir without touching the real home.
 */
export function resolveUserCharacterDir(homeDir: string = homedir()): string {
  return join(homeDir, ".claudeteam", "characters");
}

/**
 * Is `charDir` a valid PixelLab-harvest character folder? Requires BOTH
 * `animations.json` AND a `_pixellab_anims/` directory (spec §7.1). Pure-ish
 * (stats the two paths). Exported for unit coverage.
 */
export function isValidCharacterDir(charDir: string): boolean {
  const manifest = join(charDir, "animations.json");
  const anims = join(charDir, "_pixellab_anims");
  if (!existsSync(manifest)) return false;
  if (!existsSync(anims)) return false;
  try {
    return statSync(anims).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Best-effort resolve the SOUTH idle thumbnail for a character folder (spec
 * §7.1). Walks `_pixellab_anims/<state>/animations/<slug>/south/frame_*.png`
 * and returns the first such frame found (alphabetical). Falls back to the
 * char folder path when no south frame exists (webview defends). Pure-ish.
 */
export function resolveThumbnailPath(charDir: string): string {
  const animsRoot = join(charDir, "_pixellab_anims");
  if (!existsSync(animsRoot)) return charDir;
  let states: string[];
  try {
    states = readdirSync(animsRoot).sort();
  } catch {
    return charDir;
  }
  for (const state of states) {
    const slugsRoot = join(animsRoot, state, "animations");
    if (!existsSync(slugsRoot)) continue;
    let slugs: string[];
    try {
      slugs = readdirSync(slugsRoot).sort();
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const southDir = join(slugsRoot, slug, "south");
      if (!existsSync(southDir)) continue;
      let frames: string[];
      try {
        frames = readdirSync(southDir)
          .filter((f) => /^frame_\d+\.png$/.test(f))
          .sort();
      } catch {
        continue;
      }
      if (frames.length > 0) {
        return join(southDir, frames[0]!);
      }
    }
  }
  return charDir;
}

/**
 * Scan a character-collection root for valid character subfolders → partial
 * {@link CharacterSource}[] tagged with `origin`. The `id` and `label` are the
 * subfolder name (the bundled folders are `ClaudeTeam-M01-Dev` etc.; the
 * label is the folder name as-is — the panel may prettify, but the id is the
 * stable referent stored in `Member.character`).
 *
 * Returns `[]` when `root` is absent / unreadable. Pure-ish (fs reads). Logs
 * skipped (invalid) folders via the optional `logger`.
 */
function scanCharacterRoot(
  root: string,
  origin: "bundled" | "user",
  logger?: { info?: (msg: string) => void },
): CharacterSource[] {
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const sources: CharacterSource[] = [];
  for (const name of entries) {
    const charDir = join(root, name);
    if (!isValidCharacterDir(charDir)) {
      logger?.info?.(
        `[characterSources] skipping ${origin} character "${name}" — missing animations.json or _pixellab_anims/`,
      );
      continue;
    }
    sources.push({
      id: name,
      label: name,
      origin,
      thumbnailPath: resolveThumbnailPath(charDir),
    });
  }
  return sources;
}

/** Options for {@link resolveCharacterSources}. */
export interface ResolveCharacterSourcesOptions {
  /**
   * Absolute path to the BUNDLED sprites root (baked into the `.vsix`).
   * Production: `<extensionUri>/dist/webview/sprites`. The bundled chars flow
   * through the existing sprite-manifest build copy (86ca191uy) — this is the
   * SAME tree the webview already loads frames from.
   */
  bundledSpritesDir: string;
  /**
   * Absolute path to the USER character folder. Default
   * {@link resolveUserCharacterDir}() (`~/.claudeteam/characters/`). Pass a
   * tempdir in tests.
   */
  userCharacterDir?: string;
  logger?: { info?: (msg: string) => void };
}

/**
 * Merge bundled + user-folder characters into one {@link CharacterSource}[],
 * deduped by `id` with BUNDLED WINNING on collision (documented above).
 *
 * Order: bundled first (alpha), then user-folder entries not shadowing a
 * bundled id (alpha) — matches the picker grid order proposal (spec §5.2).
 *
 * Never throws. An absent bundled dir yields `[]` from that source (the webview
 * defends the empty grid per spec §5.2); an absent user dir contributes nothing.
 */
export function resolveCharacterSources(
  opts: ResolveCharacterSourcesOptions,
): CharacterSource[] {
  const bundled = scanCharacterRoot(
    opts.bundledSpritesDir,
    "bundled",
    opts.logger,
  );
  const userDir = opts.userCharacterDir ?? resolveUserCharacterDir();
  const user = scanCharacterRoot(userDir, "user", opts.logger);

  const seen = new Set<string>(bundled.map((c) => c.id));
  const merged: CharacterSource[] = [...bundled];
  for (const u of user) {
    if (seen.has(u.id)) {
      opts.logger?.info?.(
        `[characterSources] user character "${u.id}" shadows a bundled id — bundled wins, dropping user copy`,
      );
      continue;
    }
    seen.add(u.id);
    merged.push(u);
  }
  return merged;
}
