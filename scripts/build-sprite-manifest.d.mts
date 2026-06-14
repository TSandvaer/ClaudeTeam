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

/** Validated per-character render-fit shape baked onto the manifest (86ca5b0gj;
 *  `feetAnchorPct` added 86ca8n5pe for feet-anchored roster normalization). */
export interface SanitizedRenderFit {
  scale?: number;
  offsetY?: number;
  feetAnchorPct?: number;
}

/**
 * Sanitize a character's optional MANUAL `render` override block (ticket
 * 86ca5b0gj; extended 86ca8n5pe with `feetAnchorPct`) into `{ scale?, offsetY?,
 * feetAnchorPct? }`. Mirrors `sanitizePlayback`'s policy: numeric fields must be
 * finite numbers, malformed ones dropped (with a warning) never thrown; a
 * non-object block is ignored. Returns `null` render when nothing valid survives.
 */
export function sanitizeRenderFit(
  label: string,
  raw: unknown,
): { render: SanitizedRenderFit | null; warnings: string[] };

/**
 * Decode a PNG and return the tight bounding box of its non-transparent pixels —
 * the "figure bbox" used to normalize on-tile figure size (ticket 86ca8n5pe).
 * Self-contained PNG reader (no PNG library in the repo): handles 8-bit RGBA /
 * gray+alpha (color types 6 / 4); returns `null` when the image has no alpha
 * channel or is fully transparent; throws on a non-PNG / unsupported depth.
 * Impure (reads a file) — the pure bbox→render math is `computeRenderFit`.
 */
export function readPngAlphaBbox(filePath: string): Promise<{
  canvasW: number;
  canvasH: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null>;

/**
 * Compute the per-character render-fit transform from a measured figure bbox so
 * every roster character renders at a UNIFORM on-tile figure height + grounds on
 * the scene floor (ticket 86ca8n5pe). PURE — the unit-tested seam.
 *   - `feetAnchorPct` = (figureBottom + 1) / canvasH × 100 — the feet position as
 *     a % of the box (CSS transform-origin Y; scale pivots about the feet).
 *   - `scale` = targetFraction / (figureH / canvasH) — enlarges/shrinks to target.
 *   - `offsetY` = 100 − feetAnchorPct — drops the feet to the box bottom (floor).
 * Returns `null` for degenerate inputs (non-finite, non-positive canvas, zero-
 * height figure) so the caller falls back to identity rather than baking a NaN.
 */
export function computeRenderFit(
  m: { figureTop: number; figureBottom: number; canvasH: number } | null | undefined,
  targetFraction?: number,
): { scale: number; offsetY: number; feetAnchorPct: number } | null;

/**
 * Merge the auto-computed render-fit (bbox-measured) with a character's optional
 * MANUAL override (ticket 86ca8n5pe). PURE. Field-level merge — a hand-tuned
 * field WINS over the auto value (sponsor nudge one field without losing the
 * others). Returns `null` only when BOTH inputs are null.
 */
export function mergeRenderFit(
  auto: SanitizedRenderFit | null,
  manual: SanitizedRenderFit | null,
): SanitizedRenderFit | null;

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

/**
 * Sanitize a `scenes` block (per-char `animations.json` or `pose-defaults.json`)
 * into the anim → scene-id table baked onto the manifest (scene-per-pose feature,
 * 86ca88nvd — spec §4.1 / §5.1). Each value must be a string that is either the
 * literal `"none"` sentinel (always valid — the flat-card STOP) OR a scene id in
 * `validSceneIds`. Non-strings + dangling ids (not in the registry) are DROPPED +
 * warned (mirroring `sanitizePlayback`'s drop-malformed-field policy); the dropped
 * value falls through the cascade as if unset. Returns `null` scenes when nothing
 * valid survives (the baked block is then OMITTED). Pure — no filesystem.
 */
export function sanitizeScenes(
  label: string,
  raw: unknown,
  validSceneIds: Set<string>,
): { scenes: Record<string, string> | null; warnings: string[] };
