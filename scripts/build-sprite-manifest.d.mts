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

/** Validated per-anim playback shape baked onto the manifest (anim-playback E2). */
export interface SanitizedPlayback {
  speedMultiplier?: number;
  dwellFrameIndex?: number;
  dwellMs?: number;
  finalDwellMs?: number;
  startFrame?: number;
  endFrame?: number;
  playbackMode?: "loop" | "pingpong";
}

/**
 * Sanitize one anim's raw `playback` object from `animations.json` (E2
 * 86ca2187g). Malformed fields are dropped (with a warning) rather than
 * throwing: numeric fields must be finite numbers; `playbackMode` must be
 * exactly `"loop"`|`"pingpong"`; unknown keys are ignored. Returns `null`
 * playback when nothing valid survives (the manifest entry then omits the
 * field). `warnings` are surfaced by the caller as console.warn.
 */
export function sanitizePlayback(
  label: string,
  raw: unknown,
): { playback: SanitizedPlayback | null; warnings: string[] };

/**
 * Sanitize the repo-root `pose-defaults.json` `playback` block into the
 * pose-keyed defaults table baked onto the manifest as `poseDefaults`
 * (anim-playback E3 86ca2187n). Each entry runs through `sanitizePlayback`'s
 * same drop-malformed-field-and-warn policy; an entry yielding no valid field
 * is dropped, and an absent/empty/non-object block returns `null` poseDefaults
 * (the manifest then omits the field — byte-identical to the E2 end-state).
 * `warnings` are surfaced by the caller as console.warn.
 */
export function buildPoseDefaults(rawBlock: unknown): {
  poseDefaults: Record<string, SanitizedPlayback> | null;
  warnings: string[];
};

/**
 * Detect anim-looking keys placed at the JSON ROOT of `pose-defaults.json`
 * instead of nested under the expected `playback` wrapper (E3 NIT 86ca292rr).
 * A root key (other than the legitimate `playback` / `_note`) whose value is a
 * plain object carrying at least one recognized playback field is flagged with
 * a build warning — it would otherwise be silently ignored. Warn only; never
 * fails the build. Pure — no filesystem.
 */
export function detectMisplacedPoseDefaults(parsed: unknown): {
  warnings: string[];
};

/** One resolved scene backdrop (scene-bg feature, 86ca3kjyk). */
export interface ResolvedScene {
  /** Scene id — the PNG basename without extension (e.g. `"room3"`). */
  id: string;
  /** Path relative to `dist/webview/` (e.g. `"sprites/scenes/room3.png"`). */
  image: string;
}

/**
 * Resolve a single static scene-image filename from `assets/sprites/scenes/`
 * into its `{ id, image }` (scene-bg feature, 86ca3kjyk). The SCENE-plane
 * counterpart of the frame-sequence `resolveAnimFrames`: a scene is ONE flat
 * PNG, not a `frames[]` array. Returns `null` for a non-`.png` filename so the
 * caller skips it. Pure — no filesystem.
 */
export function resolveStaticImage(fileName: string): ResolvedScene | null;

/**
 * Build the manifest `scenes` registry from the scenes-dir filenames (scene-bg
 * feature, 86ca3kjyk). Returns `null` scenes when no `.png` resolved (manifest
 * omits the field → degrade to today's flat card). Otherwise
 * `{ defaultSceneId, byId }` keyed by scene id; when the default scene PNG is
 * missing but other scenes exist, the alphabetically-first id becomes the
 * default with a warning. Pure — no filesystem.
 */
export function buildScenes(fileNames: string[]): {
  scenes: { defaultSceneId: string; byId: Record<string, ResolvedScene> } | null;
  warnings: string[];
};
