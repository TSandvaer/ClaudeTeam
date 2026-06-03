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
 *   - `_note` — human documentation (the file ships with one).
 * Anything else at the root that looks like a playback entry is the editor
 * footgun this detector warns about.
 */
const POSE_DEFAULTS_ROOT_KEYS = ["playback", "_note"];

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
 * `poseDefaults` table (or null when absent / empty) plus any warnings. A
 * missing file is NOT an error — pose-defaults are optional (AC3: no file or
 * empty `{}` → no pose-default layer). Malformed JSON is warned + treated as
 * absent so a typo can never break the build.
 *
 * @returns {Promise<{ poseDefaults: object | null, warnings: string[] }>}
 */
async function readPoseDefaults() {
  if (!existsSync(POSE_DEFAULTS_SRC)) {
    return { poseDefaults: null, warnings: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(POSE_DEFAULTS_SRC, "utf8"));
  } catch (err) {
    return {
      poseDefaults: null,
      warnings: [
        `[sprite-manifest] pose-defaults.json: failed to parse — ignoring (${err instanceof Error ? err.message : String(err)})`,
      ],
    };
  }
  // Warn (do NOT fail) on anim-looking keys placed at the JSON root instead of
  // under `playback` — otherwise they are silently ignored (E3 NIT 86ca292rr).
  const { warnings: misplaced } = detectMisplacedPoseDefaults(parsed);
  const { poseDefaults, warnings } = buildPoseDefaults(parsed?.playback);
  return { poseDefaults, warnings: [...misplaced, ...warnings] };
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

async function buildCharacter(charName) {
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
  const idlePool = (animMap.idle_pool ?? []).filter(
    (name) => animations[name] !== undefined,
  );
  // active_pool (ticket 86ca3mge9) — the 3 working anims the webview cycles
  // through per active episode (running + tool != Read), mirroring idle_pool.
  // Filtered to anims that actually resolved to frames so a stale/missing pose
  // never reaches the picker.
  const activePool = (animMap.active_pool ?? []).filter(
    (name) => animations[name] !== undefined,
  );
  return {
    character: charName,
    defaultIdle: animMap.default_idle ?? idlePool[0] ?? null,
    idlePool,
    activePool,
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
        await copyFile(
          srcManifest,
          path.join(DIST_SPRITES, name, "animations.json"),
        );
      }
    }
  }

  // Pose-keyed playback defaults (E3 86ca2187n) — shared across all characters,
  // baked as a top-level sibling of `characters`. Omitted when absent / empty so
  // an empty pose-defaults.json is byte-identical to the E2 end-state (AC3).
  const { poseDefaults, warnings: poseWarnings } = await readPoseDefaults();
  for (const w of poseWarnings) console.warn(w);

  // Scene backdrops (scene-bg feature, 86ca3kjyk) — static single-image rooms in
  // `assets/sprites/scenes/`, copied into `dist/webview/sprites/scenes/` and
  // emitted as a top-level `scenes` registry. Omitted entirely when the dir has
  // no PNGs (degrade → flat card, Iris spec §FIRM.3).
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
        await copyFile(
          path.join(SCENES_SRC, fileName),
          path.join(DIST_SCENES, fileName),
        );
      }
    }
  }

  const manifestObj = {
    characters,
    ...(poseDefaults !== null ? { poseDefaults } : {}),
    ...(scenes !== null ? { scenes } : {}),
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
