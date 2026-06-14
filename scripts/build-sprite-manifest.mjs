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
 *
 *   Per-animation PLAYBACK fields (anim-playback epic E2, 86ca2187g): each
 *   character's `animations.json` MAY carry an optional top-level `playback`
 *   block keyed by canonical anim name. The build script threads validated
 *   fields onto each manifest anim entry as `entry.playback`, so the webview's
 *   `resolvePlayback` reads them from the baked manifest instead of a hardcoded
 *   map. The `animations` string-map is untouched — `playback` is a SEPARATE
 *   sibling block so the two concerns stay decoupled. Schema (all optional):
 *     "playback": {
 *       "<anim>": { speedMultiplier?, dwellFrameIndex?, dwellMs?,
 *                   finalDwellMs?, playbackMode?, startFrame?, endFrame? }
 *     }
 *   `playbackMode` is the literal `"loop"` or `"pingpong"`; any other value is
 *   dropped (defaulting to loop) with a warning — see `sanitizePlayback`.
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
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SPRITES_SRC = path.join(ROOT, "assets", "sprites");
const POSE_DEFAULTS_SRC = path.join(SPRITES_SRC, "pose-defaults.json");
const DIST_SPRITES = path.join(ROOT, "dist", "webview", "sprites");

/**
 * Scene backdrops (scene-bg feature, 86ca3kjyk). Static single-image rooms live
 * in `assets/sprites/scenes/*.png` (NOT a per-character `_pixellab_anims` tree —
 * a scene is a flat image, not a frame sequence). They are copied into
 * `dist/webview/sprites/scenes/` so they sit under the existing `dist/webview`
 * localResourceRoot (same CSP/served-path posture as sprite frames). The baked
 * manifest emits a `scenes` registry of id → relative path; the webview prefixes
 * the path with the host-injected sprite base URI exactly like a frame path.
 */
const SCENES_SRC = path.join(SPRITES_SRC, "scenes");
const DIST_SCENES = path.join(DIST_SPRITES, "scenes");
/**
 * The shared default scene id (scene-bg V1 ships ONE scene for all tiles — see
 * Iris spec §FIRM.3 "start SHARED, architect per-role"). The id is the scene
 * PNG's basename without extension. Per-role is a DATA-ONLY upgrade: drop more
 * PNGs in `scenes/` and point a future member/character field at their id.
 */
const DEFAULT_SCENE_ID = "room3";
const GENERATED_TS = path.join(ROOT, "src", "webview", "sprites", "generatedManifest.ts");

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

/** Canonical playback-mode literals (mirror `PlaybackMode` in spritePlayer.ts). */
const PLAYBACK_MODES = ["loop", "pingpong"];

/** Numeric playback fields that are validated as finite numbers + passed through. */
const PLAYBACK_NUMERIC_FIELDS = [
  "speedMultiplier",
  "dwellFrameIndex",
  "dwellMs",
  "finalDwellMs",
  "startFrame",
  "endFrame",
];

/**
 * All recognized playback field names (numeric + `playbackMode`). Used to
 * fingerprint a "looks like a playback entry" object when detecting misplaced
 * pose-defaults (E3 NIT 86ca292rr).
 */
const PLAYBACK_FIELD_NAMES = [...PLAYBACK_NUMERIC_FIELDS, "playbackMode"];

/**
 * Root keys that are legitimately allowed at the top of `pose-defaults.json`:
 *   - `playback` — the wrapper that holds the actual pose-default entries.
 *   - `scenes` — the scene-per-pose pose-default block (scene-per-pose feature,
 *     86ca88nvd — spec §4.1). Holds anim → scene-id (or `"none"`); baked onto the
 *     manifest as `sceneDefaults`. Added here so the misplaced-key detector does
 *     NOT warn on a legitimate `scenes` block (without it, a sponsor seeding the
 *     scene desk-clash fix would get a spurious "misplaced playback entry" warn).
 *   - `_note` — human documentation (the file ships with one).
 * Anything else at the root that looks like a playback entry is the editor
 * footgun this detector warns about.
 */
const POSE_DEFAULTS_ROOT_KEYS = ["playback", "scenes", "_note"];

/** The literal flat-card scene sentinel (scene-per-pose, 86ca88nvd — spec §5.2). */
const SCENE_NONE_SENTINEL = "none";

/**
 * Sanitize a `scenes` block (per-char `animations.json` or `pose-defaults.json`)
 * into the anim → scene-id table baked onto the manifest (scene-per-pose feature,
 * 86ca88nvd — spec §4.1 / §5.1). Pure — no filesystem, exported for unit
 * coverage.
 *
 * Each value must be a STRING that is either the literal `"none"` sentinel
 * (always valid — the flat-card STOP, spec §5.2) OR a scene id present in the
 * resolved registry `validSceneIds`. Validation policy mirrors `sanitizePlayback`
 * (malformed → drop the field + warn, never throw):
 *   - a value that is not a string → dropped + warned.
 *   - a string `"none"` → kept (the explicit flat-card sentinel).
 *   - a string scene id IN `validSceneIds` → kept.
 *   - a string scene id NOT in `validSceneIds` (a DANGLING id — no matching PNG)
 *     → dropped + warned (it then falls through the cascade as if unset, spec §4
 *     degrade "Dangling scene id (build-time)"). Consistent with the malformed-
 *     playback drop+warn handling.
 *
 * Returns `{ scenes, warnings }`. `scenes` is `null` when nothing valid survived
 * (so the baked block is OMITTED entirely — byte-identical to a no-scenes file,
 * the no-`scenes`-block degrade). `warnings` are surfaced by the caller as
 * console.warn.
 *
 * @param {string} label `<char>` or `pose-defaults` for warning context
 * @param {unknown} raw the raw `scenes` block (or undefined)
 * @param {Set<string>} validSceneIds the resolved registry scene ids (from `buildScenes`)
 * @returns {{ scenes: Record<string, string> | null, warnings: string[] }}
 */
export function sanitizeScenes(label, raw, validSceneIds) {
  const warnings = [];
  if (raw === undefined || raw === null) {
    return { scenes: null, warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(
      `[sprite-manifest] ${label}: scenes must be an object — ignoring (got ${Array.isArray(raw) ? "array" : typeof raw})`,
    );
    return { scenes: null, warnings };
  }
  const out = {};
  for (const [anim, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      warnings.push(
        `[sprite-manifest] ${label}: scenes.${anim} must be a string scene id or "none" — dropping (got ${JSON.stringify(value)})`,
      );
      continue;
    }
    if (value === SCENE_NONE_SENTINEL) {
      out[anim] = value; // explicit flat card — always valid.
      continue;
    }
    if (validSceneIds.has(value)) {
      out[anim] = value;
    } else {
      warnings.push(
        `[sprite-manifest] ${label}: scenes.${anim} names scene "${value}" not found in registry — dropping (falls through to inherit)`,
      );
    }
  }
  return { scenes: Object.keys(out).length > 0 ? out : null, warnings };
}

/**
 * Sanitize one anim's raw playback object from `animations.json` into the
 * shape baked onto the manifest (anim-playback epic E2, 86ca2187g). Pure —
 * no filesystem, exported for unit coverage.
 *
 * Validation policy (malformed → drop the field + warn, never throw):
 *   - numeric fields (speed/dwell/window indices): kept only when a finite
 *     number; non-numbers/NaN/Infinity dropped with a warning.
 *   - `playbackMode`: kept only when exactly `"loop"` or `"pingpong"`; any
 *     other value (e.g. `"bounce"`) dropped → the engine defaults to `"loop"`.
 *   - unknown keys: ignored (forward-compat — a future field a stale build
 *     doesn't know yet must not crash the build).
 *
 * Returns `{ playback, warnings }`. `playback` is `null` when nothing valid
 * survived (so the manifest entry omits the field entirely, byte-identical to
 * a no-playback anim). `warnings` are surfaced by the caller as console.warn.
 *
 * @param {string} label `<char>/<anim>` for warning context
 * @param {unknown} raw the raw per-anim playback object (or undefined)
 * @returns {{ playback: object | null, warnings: string[] }}
 */
export function sanitizePlayback(label, raw) {
  const warnings = [];
  if (raw === undefined || raw === null) {
    return { playback: null, warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(
      `[sprite-manifest] ${label}: playback must be an object — ignoring (got ${Array.isArray(raw) ? "array" : typeof raw})`,
    );
    return { playback: null, warnings };
  }
  const out = {};
  for (const field of PLAYBACK_NUMERIC_FIELDS) {
    if (!(field in raw)) continue;
    const v = raw[field];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[field] = v;
    } else {
      warnings.push(
        `[sprite-manifest] ${label}: playback.${field} must be a finite number — dropping (got ${JSON.stringify(v)})`,
      );
    }
  }
  if ("playbackMode" in raw) {
    const m = raw.playbackMode;
    if (PLAYBACK_MODES.includes(m)) {
      out.playbackMode = m;
    } else {
      warnings.push(
        `[sprite-manifest] ${label}: playback.playbackMode must be one of ${PLAYBACK_MODES.map((x) => `"${x}"`).join(" | ")} — dropping (got ${JSON.stringify(m)}); engine will default to "loop"`,
      );
    }
  }
  return { playback: Object.keys(out).length > 0 ? out : null, warnings };
}

/**
 * Sanitize the repo-root `pose-defaults.json` `playback` block into the
 * pose-default table baked onto the manifest as `poseDefaults` (anim-playback
 * epic E3, 86ca2187n). Pure — no filesystem, exported for unit coverage.
 *
 * Each entry is run through `sanitizePlayback` with the SAME validation policy
 * as a character's per-anim playback (malformed fields dropped + warned, never
 * thrown). An entry whose object yields no valid field is dropped entirely.
 *
 * Returns `{ poseDefaults, warnings }`. `poseDefaults` is `null` when the block
 * is absent / not-an-object / empty after sanitizing — so the manifest OMITS
 * the `poseDefaults` field entirely, making an empty `pose-defaults.json`
 * byte-identical to the E2 end-state (AC3). `warnings` are surfaced by the
 * caller as console.warn.
 *
 * @param {unknown} rawBlock the `playback` block from pose-defaults.json (or undefined)
 * @returns {{ poseDefaults: object | null, warnings: string[] }}
 */
export function buildPoseDefaults(rawBlock) {
  const warnings = [];
  if (rawBlock === undefined || rawBlock === null) {
    return { poseDefaults: null, warnings };
  }
  if (typeof rawBlock !== "object" || Array.isArray(rawBlock)) {
    warnings.push(
      `[sprite-manifest] pose-defaults.json: playback must be an object — ignoring (got ${Array.isArray(rawBlock) ? "array" : typeof rawBlock})`,
    );
    return { poseDefaults: null, warnings };
  }
  const out = {};
  for (const [anim, raw] of Object.entries(rawBlock)) {
    const { playback, warnings: w } = sanitizePlayback(`pose-defaults/${anim}`, raw);
    for (const warn of w) warnings.push(warn);
    if (playback !== null) {
      out[anim] = playback;
    }
  }
  return { poseDefaults: Object.keys(out).length > 0 ? out : null, warnings };
}

/**
 * Roster-wide on-tile figure normalization (ticket 86ca8n5pe). Goal: EVERY
 * character renders its figure at a UNIFORM on-tile height regardless of canvas
 * size (92×92 v3 vs 68×68 legacy) or fill ratio (~50% vs ~75%). Without this,
 * `.sprite-frame { object-fit: contain }` fits the WHOLE square canvas into the
 * box, so a 92px char (figure ~51% of canvas) renders ~50/71 ≈ 0.7× the apparent
 * figure size of a 68px M02 char (figure ~71%) — the v3 chars look SMALLER.
 *
 * The fix is computed at BUILD time from each character's measured figure bbox:
 *   - `scale = TARGET_FIGURE_FRACTION / (figureH / canvasH)` enlarges (or shrinks)
 *     the figure so its on-tile height is uniform across the roster.
 *   - `feetAnchorPct = (figureBottom + 1) / canvasH * 100` is where the figure's
 *     feet sit as a % of the box (object-fit maps the canvas 1:1 into the square
 *     box, so a canvas y-fraction is a box y-fraction). The CSS scales ABOUT this
 *     feet point (`transform-origin: center <feetAnchorPct>%`) so the feet do NOT
 *     drift when the figure is enlarged — preserving grounding on scene rooms,
 *     whose floor is pinned to the box bottom (dashboard.css `--ct-scene-anchor-y:
 *     bottom`). A `translateY(100 − feetAnchorPct)` (baked as `offsetY`) then drops
 *     the feet to the box bottom = the room floor.
 *
 * `TARGET_FIGURE_FRACTION` ≈ the legacy 68×68 M02 apparent size (figure 48/68 ≈
 * 0.706 of the canvas → 0.706 of the box) — the ticket's "scale v3 UP to M02"
 * target. Sponsor-tunable: the FINAL on-tile-size visual feel is sponsor-domain
 * (queued for their return); this is the code-correct starting value.
 */
const TARGET_FIGURE_FRACTION = 0.706;

/**
 * Alpha threshold (0–255) above which a pixel counts as "figure" when measuring
 * the bbox. >16 ignores near-transparent anti-alias fringe so the bbox tracks the
 * solid figure, matching the measurement that produced the documented ~51% fill.
 */
const FIGURE_ALPHA_THRESHOLD = 16;

/**
 * Decode a PNG file's pixels and return the tight bounding box of its non-
 * transparent (alpha > `FIGURE_ALPHA_THRESHOLD`) pixels — the "figure bbox" used
 * to normalize on-tile figure size (ticket 86ca8n5pe). Returns `null` when the
 * image has no alpha channel (color types 0/2/3 — opaque, no figure to isolate)
 * or no pixel clears the threshold (fully transparent frame).
 *
 * Self-contained PNG reader (the repo ships no PNG library): parses IHDR for
 * dimensions + color type, inflates the IDAT stream, then un-filters each
 * scanline (None/Sub/Up/Average/Paeth, the 5 PNG filter types). Handles 8-bit
 * depth only (every PixelLab harvest is RGBA8 — color type 6); other depths throw
 * so a future format change fails loud rather than silently mis-measuring.
 *
 * NOT pure (reads a file) — the pure bbox→render math is `computeRenderFit`,
 * which is the unit-tested seam; this decoder is exercised by the integration
 * pass over the real shipped frames.
 *
 * @param {string} filePath absolute path to a PNG frame
 * @returns {Promise<{ canvasW: number, canvasH: number, minX: number, minY: number, maxX: number, maxY: number } | null>}
 */
export async function readPngAlphaBbox(filePath) {
  const data = await readFile(filePath);
  if (
    data.length < 8 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47
  ) {
    throw new Error(`not a PNG: ${filePath}`);
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];
  while (pos + 8 <= data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString("ascii", pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
    } else if (type === "IDAT") {
      idatChunks.push(body);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len; // length(4) + type(4) + data(len) + CRC(4)
  }
  // Alpha lives only in color types 4 (gray+alpha) and 6 (RGBA). Others have no
  // figure/background distinction — return null so the caller skips normalization.
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) {
    throw new Error(`unsupported PNG color type ${colorType}: ${filePath}`);
  }
  if (bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth} (want 8): ${filePath}`);
  }
  const alphaIndex = colorType === 6 ? 3 : colorType === 4 ? 1 : -1;
  if (alphaIndex === -1) {
    return null; // no alpha channel → no figure to isolate.
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = channels; // bytes-per-pixel at 8-bit depth.
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  const paeth = (a, b, c) => {
    const pp = a + b - c;
    const pa = Math.abs(pp - a);
    const pb = Math.abs(pp - b);
    const pc = Math.abs(pp - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= bpp ? out[rowStart + i - bpp] : 0;
      const b = y > 0 ? out[prevStart + i] : 0;
      const c = y > 0 && i >= bpp ? out[prevStart + i - bpp] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`bad PNG filter ${filter} on row ${y}: ${filePath}`);
      out[rowStart + i] = v & 0xff;
    }
  }
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * stride;
    for (let xx = 0; xx < width; xx++) {
      if (out[rowStart + xx * bpp + alphaIndex] > FIGURE_ALPHA_THRESHOLD) {
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null; // fully transparent.
  }
  return { canvasW: width, canvasH: height, minX, minY, maxX, maxY };
}

/**
 * Compute the per-character render-fit transform from a measured figure bbox so
 * every roster character renders at a UNIFORM on-tile figure height (ticket
 * 86ca8n5pe). PURE — takes already-measured numbers, no filesystem; this is the
 * unit-tested seam (the PNG decode in `readPngAlphaBbox` is the impure half).
 *
 * Inputs: the figure's bbox top/bottom Y (pixel rows, inclusive) and the canvas
 * height. Output `{ scale, offsetY, feetAnchorPct }`:
 *   - `feetAnchorPct` — the feet position as a % of the box. `object-fit: contain`
 *     maps the square canvas 1:1 into the square box, so a canvas y-fraction is a
 *     box y-fraction. Feet = the bbox bottom edge: `(figureBottom + 1) / canvasH`
 *     (the +1 makes it the row BELOW the last opaque pixel — the contact line).
 *     Used as the CSS `transform-origin` Y so the scale pivots about the feet and
 *     they do NOT drift (grounding preserved on scene rooms — floor at box bottom).
 *   - `scale` — `TARGET_FIGURE_FRACTION / (figureH / canvasH)`. Enlarges a sparse
 *     v3 figure (51% fill) up to the M02 apparent size (~71%), shrinks an
 *     over-large one down. A char already AT the target gets ~1.0 (near-identity).
 *   - `offsetY` — `100 − feetAnchorPct` (a % of the box). Applied as `translateY`
 *     AFTER the feet-anchored scale, it drops the feet from `feetAnchorPct` to the
 *     box bottom (100%) = the scene room floor. So the whole roster grounds on the
 *     same baseline AND shows a uniform figure height.
 *
 * Returns `null` when the inputs are degenerate (non-finite, non-positive canvas,
 * zero-height figure) so the caller falls back to identity (no transform) rather
 * than baking a NaN/Infinity that would blank the tile.
 *
 * @param {{ figureTop: number, figureBottom: number, canvasH: number }} m measured bbox rows
 * @param {number} [targetFraction] target figure height as a fraction of the box (default TARGET_FIGURE_FRACTION)
 * @returns {{ scale: number, offsetY: number, feetAnchorPct: number } | null}
 */
export function computeRenderFit(m, targetFraction = TARGET_FIGURE_FRACTION) {
  if (m === null || m === undefined || typeof m !== "object") return null;
  const { figureTop, figureBottom, canvasH } = m;
  if (
    !Number.isFinite(figureTop) ||
    !Number.isFinite(figureBottom) ||
    !Number.isFinite(canvasH) ||
    !Number.isFinite(targetFraction) ||
    canvasH <= 0 ||
    targetFraction <= 0
  ) {
    return null;
  }
  const figureH = figureBottom - figureTop + 1;
  if (figureH <= 0) return null;
  const fillFraction = figureH / canvasH;
  const scale = round3(targetFraction / fillFraction);
  // Feet = the contact line just below the last opaque row, as a % of the box.
  const feetAnchorPct = round3(((figureBottom + 1) / canvasH) * 100);
  const offsetY = round3(100 - feetAnchorPct);
  return { scale, offsetY, feetAnchorPct };
}

/** Round to 3 decimals to keep the baked manifest tidy + deterministic. */
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** Numeric render-fit fields (tickets 86ca5b0gj + 86ca8n5pe) validated as finite numbers. */
const RENDER_FIT_NUMERIC_FIELDS = ["scale", "offsetY", "feetAnchorPct"];

/**
 * Sanitize a character's optional top-level `render` block (ticket 86ca5b0gj;
 * extended 86ca8n5pe with `feetAnchorPct`) into the `{ scale?, offsetY?,
 * feetAnchorPct? }` shape baked onto the manifest character entry. Mirrors
 * `sanitizePlayback`'s policy: malformed fields are DROPPED + warned, never
 * thrown, so a typo can never break the build. Pure — exported for unit coverage.
 *
 * Used for the MANUAL override path: a character's `animations.json` may carry a
 * hand-tuned `render` block that overrides the auto-computed (bbox-measured)
 * values per-field (`mergeRenderFit`). Returns `{ render, warnings }`; `render`
 * is `null` when nothing valid survived (then only the auto value, if any, baked).
 *
 * @param {string} label `<char>` for warning context
 * @param {unknown} raw the raw per-character render object (or undefined)
 * @returns {{ render: object | null, warnings: string[] }}
 */
export function sanitizeRenderFit(label, raw) {
  const warnings = [];
  if (raw === undefined || raw === null) {
    return { render: null, warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push(
      `[sprite-manifest] ${label}: render must be an object — ignoring (got ${Array.isArray(raw) ? "array" : typeof raw})`,
    );
    return { render: null, warnings };
  }
  const out = {};
  for (const field of RENDER_FIT_NUMERIC_FIELDS) {
    if (!(field in raw)) continue;
    const v = raw[field];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[field] = v;
    } else {
      warnings.push(
        `[sprite-manifest] ${label}: render.${field} must be a finite number — dropping (got ${JSON.stringify(v)})`,
      );
    }
  }
  return { render: Object.keys(out).length > 0 ? out : null, warnings };
}

/**
 * Merge the auto-computed render-fit (bbox-measured, ticket 86ca8n5pe) with a
 * character's optional MANUAL override block (sanitized via `sanitizeRenderFit`).
 * PURE — exported for unit coverage. Field-level merge: a hand-tuned field WINS
 * over the auto value (so the sponsor can nudge ONE field — e.g. nudge `offsetY`
 * by a few % — without discarding the auto `scale`/`feetAnchorPct`). Mirrors the
 * playback cascade's `{ ...auto, ...manual }` per-field precedence.
 *
 * Returns `null` when BOTH inputs are null (→ manifest omits `render` → identity
 * transform → no normalization for a char with no measurable base frame and no
 * manual block). Otherwise the merged object.
 *
 * @param {{ scale?: number, offsetY?: number, feetAnchorPct?: number } | null} auto auto-computed fit
 * @param {{ scale?: number, offsetY?: number, feetAnchorPct?: number } | null} manual sanitized manual override
 * @returns {{ scale?: number, offsetY?: number, feetAnchorPct?: number } | null}
 */
export function mergeRenderFit(auto, manual) {
  if (auto === null && manual === null) return null;
  return { ...(auto ?? {}), ...(manual ?? {}) };
}

/**
 * Detect anim-looking keys placed at the JSON ROOT of `pose-defaults.json`
 * instead of nested under the expected `playback` wrapper (E3 NIT 86ca292rr).
 *
 * The editor footgun: pose-default entries belong under `playback`
 * (`{ "playback": { "idle_stretch": {...} } }`). If a sponsor writes the entry
 * at the root (`{ "idle_stretch": {...} }`), `buildPoseDefaults` only ever reads
 * `parsed.playback`, so the root key is SILENTLY ignored — the sponsor edits +
 * rebuilds and nothing changes, with no signal why. This emits a build warning
 * naming each misplaced key so the mistake is visible.
 *
 * Detection policy (conservative — warn only on a strong signal, never a hard
 * failure):
 *   - only ROOT keys that are NOT one of the legitimate root keys
 *     (`playback`, `_note`) are candidates.
 *   - a candidate is flagged ONLY when its value is a plain object that carries
 *     at least one recognized playback field (`speedMultiplier`, `dwellMs`,
 *     `playbackMode`, …). This fingerprint avoids false-positiving on arbitrary
 *     future scalar metadata or unrelated objects — the key has to actually
 *     look like a misplaced playback entry.
 *
 * Pure — no filesystem, exported for unit coverage. Returns `{ warnings }`.
 *
 * @param {unknown} parsed the parsed `pose-defaults.json` root object
 * @returns {{ warnings: string[] }}
 */
export function detectMisplacedPoseDefaults(parsed) {
  const warnings = [];
  if (parsed === undefined || parsed === null) {
    return { warnings };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { warnings };
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (POSE_DEFAULTS_ROOT_KEYS.includes(key)) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const looksLikePlayback = PLAYBACK_FIELD_NAMES.some((f) => f in value);
    if (looksLikePlayback) {
      warnings.push(
        `[sprite-manifest] pose-defaults.json: key "${key}" looks like a playback entry but sits at the JSON root — it must be nested under "playback" (e.g. { "playback": { "${key}": {...} } }) or it is silently ignored`,
      );
    }
  }
  return { warnings };
}

/**
 * Read + sanitize the repo-root `pose-defaults.json`. Returns the baked
 * `poseDefaults` table (or null when absent / empty), the baked `sceneDefaults`
 * table (scene-per-pose, 86ca88nvd — null when absent / empty), plus any
 * warnings. A missing file is NOT an error — pose-defaults are optional (AC3: no
 * file or empty `{}` → no pose-default layer). Malformed JSON is warned + treated
 * as absent so a typo can never break the build.
 *
 * `validSceneIds` is the resolved scene registry's id set (from `buildScenes`) —
 * used to validate the `scenes` block (dangling ids dropped + warned).
 *
 * @param {Set<string>} validSceneIds resolved registry scene ids
 * @returns {Promise<{ poseDefaults: object | null, sceneDefaults: object | null, warnings: string[] }>}
 */
async function readPoseDefaults(validSceneIds) {
  if (!existsSync(POSE_DEFAULTS_SRC)) {
    return { poseDefaults: null, sceneDefaults: null, warnings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(POSE_DEFAULTS_SRC, "utf8"));
  } catch (err) {
    return {
      poseDefaults: null,
      sceneDefaults: null,
      warnings: [
        `[sprite-manifest] pose-defaults.json: failed to parse — ignoring (${err instanceof Error ? err.message : String(err)})`,
      ],
    };
  }
  // Warn (do NOT fail) on anim-looking keys placed at the JSON root instead of
  // under `playback` — otherwise they are silently ignored (E3 NIT 86ca292rr).
  const { warnings: misplaced } = detectMisplacedPoseDefaults(parsed);
  const { poseDefaults, warnings } = buildPoseDefaults(parsed?.playback);
  // Pose-default SCENE block (scene-per-pose, 86ca88nvd — spec §4.1). Read +
  // sanitize the top-level `scenes` block alongside `playback`; baked onto the
  // manifest as `sceneDefaults` (parallels `poseDefaults`). Dangling ids dropped.
  const { scenes: sceneDefaults, warnings: sceneWarnings } = sanitizeScenes(
    "pose-defaults",
    parsed?.scenes,
    validSceneIds,
  );
  return {
    poseDefaults,
    sceneDefaults,
    warnings: [...misplaced, ...warnings, ...sceneWarnings],
  };
}

/**
 * Discover the animation directory inside
 * `<charDir>/_pixellab_anims/<folder>/animations/` named by `value` and return
 * its south frame paths (sorted), relative to `dist/webview/`. `value` follows
 * the folder-or-folder/slug format parsed by `parseAnimValue`.
 */
async function resolveAnimFrames(charName, value) {
  const { folder, animSlug } = parseAnimValue(value);
  const animsParent = path.join(SPRITES_SRC, charName, "_pixellab_anims", folder, "animations");
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
  const frames = (await readdir(southDir)).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
  if (frames.length === 0) {
    return null;
  }
  // Relative to dist/webview/ (the localResourceRoot base the webview prefixes).
  return frames.map(
    (f) => `sprites/${charName}/_pixellab_anims/${folder}/animations/${slug}/south/${f}`,
  );
}

/**
 * Resolve a single static scene image filename into its webview-relative path
 * (scene-bg feature, 86ca3kjyk). The counterpart of `resolveAnimFrames` for the
 * SCENE plane: where `resolveAnimFrames` discovers a frame SEQUENCE under an
 * `animations/<slug>/south/` tree, `resolveStaticImage` handles a FLAT single
 * PNG that lives directly in `assets/sprites/scenes/`.
 *
 * Pure (takes the already-listed filename, no filesystem access) so it is
 * unit-testable. Returns `{ id, image }` where:
 *   - `id`   — the basename without the `.png` extension (the scene's stable id).
 *   - `image`— the path relative to `dist/webview/` (the localResourceRoot base
 *              the webview prefixes), IDENTICAL convention to frame paths.
 * Returns `null` for a non-`.png` filename so the caller skips non-image files.
 *
 * @param {string} fileName a filename from `assets/sprites/scenes/`
 * @returns {{ id: string, image: string } | null}
 */
export function resolveStaticImage(fileName) {
  const m = /^(.+)\.png$/i.exec(fileName);
  if (m === null) {
    return null;
  }
  return { id: m[1], image: `sprites/scenes/${fileName}` };
}

/**
 * Build the manifest `scenes` registry from the list of files in the scenes dir
 * (scene-bg feature, 86ca3kjyk). Pure: takes the already-listed filenames so it
 * is unit-testable without a real filesystem.
 *
 * Returns `{ scenes, warnings }`. `scenes` is `null` when no `.png` resolved
 * (manifest then OMITS the field — degrade path: no scene → today's flat card,
 * Iris spec §FIRM.3). Otherwise `{ defaultSceneId, byId }` where `byId` is keyed
 * by each scene's id. When the `DEFAULT_SCENE_ID` PNG is missing but other
 * scenes exist, the alphabetically-first id is used as the default + a warning
 * is emitted (so a renamed/removed `room3.png` never silently yields a registry
 * whose `defaultSceneId` resolves to nothing).
 *
 * @param {string[]} fileNames filenames listed from `assets/sprites/scenes/`
 * @returns {{ scenes: { defaultSceneId: string, byId: Record<string, {id:string,image:string}> } | null, warnings: string[] }}
 */
export function buildScenes(fileNames) {
  const warnings = [];
  const byId = {};
  for (const name of [...fileNames].sort()) {
    const resolved = resolveStaticImage(name);
    if (resolved === null) {
      continue;
    }
    byId[resolved.id] = resolved;
  }
  const ids = Object.keys(byId);
  if (ids.length === 0) {
    return { scenes: null, warnings };
  }
  let defaultSceneId = DEFAULT_SCENE_ID;
  if (!(DEFAULT_SCENE_ID in byId)) {
    defaultSceneId = ids[0]; // ids are sorted (byId built from sorted names)
    warnings.push(
      `[sprite-manifest] scenes: default scene "${DEFAULT_SCENE_ID}.png" not found — falling back to "${defaultSceneId}" as the default`,
    );
  }
  return { scenes: { defaultSceneId, byId }, warnings };
}

async function buildCharacter(charName, validSceneIds) {
  const manifestPath = path.join(SPRITES_SRC, charName, "animations.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const animMap = JSON.parse(await readFile(manifestPath, "utf8"));
  // Per-anim playback block (E2 86ca2187g) — optional sibling of `animations`.
  const playbackBlock =
    animMap.playback && typeof animMap.playback === "object" && !Array.isArray(animMap.playback)
      ? animMap.playback
      : {};
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
    const entry = { folder, frames: framePaths };
    // Thread validated playback fields (E2). Malformed values are dropped with
    // a warning rather than crashing the build (AC4).
    const { playback, warnings } = sanitizePlayback(
      `${charName}/${canonical}`,
      playbackBlock[canonical],
    );
    for (const w of warnings) console.warn(w);
    if (playback !== null) {
      entry.playback = playback;
    }
    animations[canonical] = entry;
  }
  // Warn on playback entries that name an anim absent from the `animations`
  // map — a likely typo the sponsor should see (it would otherwise vanish).
  for (const animName of Object.keys(playbackBlock)) {
    if (!(animName in (animMap.animations ?? {}))) {
      console.warn(
        `[sprite-manifest] ${charName}: playback names anim "${animName}" which is not in the animations map — ignoring`,
      );
    }
  }
  // idle_pool filtered to anims that actually resolved to frames.
  const idlePool = (animMap.idle_pool ?? []).filter((name) => animations[name] !== undefined);
  // active_pool (ticket 86ca3mge9) — the 3 working anims the webview cycles
  // through per active episode (running + tool != Read), mirroring idle_pool.
  // Filtered to anims that actually resolved to frames so a stale/missing pose
  // never reaches the picker.
  const activePool = (animMap.active_pool ?? []).filter((name) => animations[name] !== undefined);
  // Per-character render-fit — AUTO-computed from the measured figure bbox so
  // every roster char renders at a uniform on-tile figure height + grounds on the
  // scene floor (ticket 86ca8n5pe), with an optional MANUAL override block
  // (ticket 86ca5b0gj) winning per-field.
  //
  // Measure the BASE/idle south frame_000: pick `default_idle` (the resting
  // pose the dashboard shows by default), else the first resolved idle, else the
  // first resolved anim. Measuring the resting pose (not a desk pose, whose baked
  // furniture would inflate the bbox) keeps the figure-height target consistent.
  const baseAnimName =
    (animMap.default_idle && animations[animMap.default_idle] !== undefined
      ? animMap.default_idle
      : undefined) ??
    idlePool[0] ??
    Object.keys(animations)[0];
  let autoRender = null;
  if (baseAnimName !== undefined && animations[baseAnimName] !== undefined) {
    const rel = animations[baseAnimName].frames[0];
    if (rel) {
      // `frames[]` are relative to dist/webview/ (`sprites/<char>/...`); the
      // source PNG lives under assets/sprites/<char>/... — strip the leading
      // `sprites/` and re-root at SPRITES_SRC.
      const srcFrame = path.join(SPRITES_SRC, rel.replace(/^sprites\//, ""));
      try {
        const bbox = await readPngAlphaBbox(srcFrame);
        if (bbox !== null) {
          autoRender = computeRenderFit({
            figureTop: bbox.minY,
            figureBottom: bbox.maxY,
            canvasH: bbox.canvasH,
          });
        }
      } catch (err) {
        console.warn(
          `[sprite-manifest] ${charName}: could not measure base frame for render-fit (${err instanceof Error ? err.message : String(err)}) — falling back to manual/identity`,
        );
      }
    }
  }
  const { render: manualRender, warnings: renderWarnings } = sanitizeRenderFit(
    charName,
    animMap.render,
  );
  for (const w of renderWarnings) console.warn(w);
  const render = mergeRenderFit(autoRender, manualRender);
  // Per-character SCENE block (scene-per-pose feature, 86ca88nvd — spec §4.1) —
  // optional top-level `scenes` block (sibling of `playback`), anim → scene-id
  // (or `"none"`). Dangling ids (no matching PNG) dropped + warned; absent →
  // omitted. Validated against the resolved registry's valid ids.
  const { scenes: charScenes, warnings: sceneWarnings } = sanitizeScenes(
    charName,
    animMap.scenes,
    validSceneIds,
  );
  for (const w of sceneWarnings) console.warn(w);
  return {
    character: charName,
    ...(render !== null ? { render } : {}),
    defaultIdle: animMap.default_idle ?? idlePool[0] ?? null,
    idlePool,
    activePool,
    animations,
    ...(charScenes !== null ? { scenes: charScenes } : {}),
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

  // Scene backdrops (scene-bg feature, 86ca3kjyk; cascade scene-per-pose 86ca88nvd)
  // — static single-image rooms in `assets/sprites/scenes/`, emitted as a
  // top-level `scenes` REGISTRY. Built FIRST (before characters + pose-defaults)
  // so its resolved id set validates the per-char + pose-default scene blocks
  // (dangling-id drop+warn, spec §4.1). Omitted entirely when the dir has no PNGs
  // (degrade → flat card, Iris spec §FIRM.3 → an empty validSceneIds → every
  // scene override but `"none"` drops as dangling).
  let scenes = null;
  if (existsSync(SCENES_SRC)) {
    const sceneFiles = (await readdir(SCENES_SRC, { withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => e.name);
    const { scenes: built, warnings: sceneWarnings } = buildScenes(sceneFiles);
    for (const w of sceneWarnings) console.warn(w);
    scenes = built;
    if (scenes !== null) {
      // Copy every resolved scene PNG into dist/webview/sprites/scenes/ so it
      // sits under the existing dist/webview localResourceRoot.
      await mkdir(DIST_SCENES, { recursive: true });
      for (const scene of Object.values(scenes.byId)) {
        const fileName = path.basename(scene.image);
        await copyFile(path.join(SCENES_SRC, fileName), path.join(DIST_SCENES, fileName));
      }
    }
  }
  // The valid scene-id set the per-char + pose-default scene blocks validate
  // against (empty when no registry → only the `"none"` sentinel survives).
  const validSceneIds = new Set(scenes !== null ? Object.keys(scenes.byId) : []);

  const characters = {};
  for (const name of charNames) {
    const built = await buildCharacter(name, validSceneIds);
    if (built) {
      characters[name] = built;
      // Copy this character's PNG tree into dist/webview/sprites/<char>/.
      const srcCharDir = path.join(SPRITES_SRC, name, "_pixellab_anims");
      if (existsSync(srcCharDir)) {
        await copyDir(srcCharDir, path.join(DIST_SPRITES, name, "_pixellab_anims"));
      }
      // TS-02 (team-setup epic, AC7): also copy `animations.json` into the dist
      // char folder so the BUNDLED character matches the valid-character shape
      // (`animations.json` + `_pixellab_anims/`) that `resolveCharacterSources`
      // validates. Without this, the picker grid sees zero bundled characters
      // after a clean build (the webview frame-render path uses the baked
      // generatedManifest.ts, but the character-SOURCE resolver reads the dist
      // folder directly). Mirrors the spec §7.1 PixelLab-harvest signature.
      const srcManifest = path.join(SPRITES_SRC, name, "animations.json");
      if (existsSync(srcManifest)) {
        await mkdir(path.join(DIST_SPRITES, name), { recursive: true });
        await copyFile(srcManifest, path.join(DIST_SPRITES, name, "animations.json"));
      }
    }
  }

  // Pose-keyed playback defaults (E3 86ca2187n) + pose-default SCENE block
  // (scene-per-pose, 86ca88nvd — spec §4.1) — shared across all characters, baked
  // as top-level siblings of `characters` (`poseDefaults` + `sceneDefaults`).
  // Each omitted when absent / empty so an empty pose-defaults.json is
  // byte-identical to the E2 end-state (AC3). Scene block validated against the
  // already-resolved registry (`validSceneIds`).
  const {
    poseDefaults,
    sceneDefaults,
    warnings: poseWarnings,
  } = await readPoseDefaults(validSceneIds);
  for (const w of poseWarnings) console.warn(w);

  const manifestObj = {
    characters,
    ...(scenes !== null ? { scenes } : {}),
    ...(sceneDefaults !== null ? { sceneDefaults } : {}),
    ...(poseDefaults !== null ? { poseDefaults } : {}),
  };

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
    manifestObj,
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
  const sceneCount = scenes !== null ? Object.keys(scenes.byId).length : 0;
  console.log(
    `[sprite-manifest] wrote ${charCount} character(s), ${animCount} animation(s), ${sceneCount} scene(s) → ${path.relative(ROOT, GENERATED_TS)}`,
  );
}

main().catch((err) => {
  console.error("[sprite-manifest] failed:", err);
  process.exit(1);
});
