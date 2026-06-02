/**
 * spritePlayer — DOM frame-sequencer for one tile's persona pixel character.
 *
 * Renders a 68×68 sprite box containing an <img> that cycles through a pose's
 * south-view frames. Owns the per-tile playback timers + idle-episode
 * stickiness. The frame timing is the CONSUMER's concern (PixelLab exports
 * frame images only, no timing) — see the persona doc § Playback-speed note:
 * default SLOW + hold-the-final-frame dwell so the always-visible tile reads
 * calm, not mechanical.
 *
 * Render-time contract (AC3):
 *   - per-frame default duration `--ct-anim-frame-ms-default` (160ms, slow).
 *   - final-frame dwell `--ct-anim-dwell-ms-default` (+400ms) before the loop
 *     restarts — applied to idle poses so short loops don't read repetitively.
 *
 * Per-animation playback tuning (86ca1fntp):
 *   - PLAYBACK_OVERRIDES maps a canonical anim name → optional tuning:
 *       { speedMultiplier?, dwellFrameIndex?, dwellMs? }.
 *   - `speedMultiplier` scales the per-frame duration. The manifest names the
 *     SPEED as a fraction of the default RATE (50% speed = half the frame rate
 *     = 2× the per-frame ms). So the effective per-frame ms is
 *     `FRAME_MS_DEFAULT / speedMultiplier` (0.5 → 320ms/frame; 0.7 → ~229ms).
 *   - `dwellFrameIndex` holds ONE mid-sequence "peak" frame longer (the apex of
 *     the gesture — cup at mouth, hand at mouth, arms overhead, phone at face)
 *     for `dwellMs` extra. This is distinct from the final-frame idle dwell and
 *     composes with it (a peak that lands on the final frame adds both).
 *   - Peak-frame indices are character-specific (M01 vs F01 frame sequences
 *     differ) — see PLAYBACK_OVERRIDES per-character note.
 *
 * AC2: pose chosen from (state, activity) via posePicker — active_read on
 *   tool==Read, active_work on tool!=Read, random idle_* otherwise/available.
 * AC4: when `prefers-reduced-motion: reduce`, NO timer runs — a single static
 *   frame (frame 0) is shown. Honors the OS/VS Code accessibility setting.
 * AC5: a sprite-less member never reaches this module — the caller checks
 *   `spriteForMember` first and renders the text tile when null. No broken img.
 *
 * Idle-episode stickiness (spec §3.3): one idle-pool member is picked per idle
 * EPISODE and looped; on a fresh idle episode (after a running stint) a new
 * pool member may be picked. Pose does NOT cycle mid-loop. A live tile is
 * re-rendered every ~2s poll tick (full DOM replace), so the player attaches
 * the current idle pick to the produced element's dataset and the caller
 * threads the prior pick back in so the loop survives re-renders without
 * snapping to frame 0.
 *
 * Source: team/iris-ux/whole-team-display-spec.md §3
 *         .claude/docs/persona-pixel-character-animation-prompts.md § Playback-speed
 */

import type { AgentState } from "../../shared/types.js";
import type { GeneratedSpriteManifest, SpriteCharacter } from "./spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "./generatedManifest.js";
import { pickIdle, poseNameForTile, resolvePose } from "./posePicker.js";

/** Default slow per-frame duration (ms) — mirrors --ct-anim-frame-ms-default. */
export const FRAME_MS_DEFAULT = 160;
/** Default hold-final-frame dwell (ms) — mirrors --ct-anim-dwell-ms-default. */
export const DWELL_MS_DEFAULT = 400;

/** Default peak-frame dwell add-on (ms) for poses that name a `dwellFrameIndex`
 *  but no explicit `dwellMs`. Long hold so the apex beat reads clearly. */
export const PEAK_DWELL_MS_DEFAULT = 600;

/**
 * Frame-advance mode for a pose's loop (anim-playback epic E1, 86ca21876).
 *   - `"loop"` (default/absent): advance +1, wrap last→0 (the historic behavior).
 *   - `"pingpong"`: advance forward to the last frame, then reverse to the
 *     first, then repeat — frames `[a,b,c]` play `0,1,2,1,0,1,2,…`. Endpoint
 *     behavior is NAIVE endpoint-hold: frame 0 and frame N-1 each display once
 *     per turnaround (the direction reverses ON them). No new frame assets.
 */
export type PlaybackMode = "loop" | "pingpong";

/**
 * Per-animation playback override (86ca1fntp; extended by E1 86ca21876). All
 * fields optional; an absent field means "use the default behavior". Keyed by
 * canonical anim name.
 */
export interface PlaybackOverride {
  /**
   * Fraction of the DEFAULT FRAME RATE. 0.5 = half the rate = plays at half
   * speed = 2× the per-frame ms. Effective per-frame ms is
   * `FRAME_MS_DEFAULT / speedMultiplier`. Absent → 1.0 (default rate).
   */
  speedMultiplier?: number;
  /**
   * Index of the mid-sequence "peak" frame to hold longer (the gesture apex).
   * Character-specific — see PLAYBACK_OVERRIDES per-character branch.
   */
  dwellFrameIndex?: number;
  /** Extra ms to hold the peak frame. Absent → PEAK_DWELL_MS_DEFAULT. */
  dwellMs?: number;
  /**
   * Per-anim final-frame hold (ms) before the loop restarts (E1 86ca21876).
   * Overrides the global DWELL_MS_DEFAULT for this anim's final-frame idle
   * dwell. Absent → DWELL_MS_DEFAULT (current fixed-400ms behavior). In
   * pingpong mode the dwell fires only on the FORWARD arrival at the last
   * frame, not on the reverse pass back through it.
   */
  finalDwellMs?: number;
  /**
   * Frame-advance mode (E1 86ca21876). Absent → `"loop"` (byte-identical to the
   * historic +1/wrap behavior).
   */
  playbackMode?: PlaybackMode;
  /**
   * Inclusive lower bound of the frame SUB-WINDOW the loop animates within
   * (E1-refine 86ca21876). Absent → `0` (start of the clip). The sequencer
   * clamps both endpoints to the real frame count, so a stale index can never
   * break the loop. Use with `endFrame` to animate only a contiguous slice of
   * a clip — e.g. a stretch authored as `up → rest → up` can be played as a
   * clean `rest → up → (hold) → rest` by windowing to the rest→up half and
   * running it pingpong. NOT pose-specific; any pose may declare a window.
   *
   * In pingpong the window endpoints are the turnaround points (the loop
   * oscillates `startFrame … endFrame … startFrame`). In loop mode it advances
   * `startFrame … endFrame` then wraps back to `startFrame` (NOT to 0).
   */
  startFrame?: number;
  /**
   * Inclusive upper bound of the frame sub-window (E1-refine 86ca21876).
   * Absent → the clip's last frame. See `startFrame`. The per-anim
   * `finalDwellMs` hold fires on the FORWARD arrival at `endFrame` (the window
   * end), so windowing the apex to `endFrame` makes the hold land on the apex.
   */
  endFrame?: number;
}

/** A per-character override table: canonical anim name → override. */
export type PlaybackOverrideTable = Record<string, PlaybackOverride>;

/**
 * Resolve the playback override for (character, canonical anim name).
 *
 * MANIFEST-FED (anim-playback epic E2, 86ca2187g). The per-anim playback fields
 * live in each character's `animations.json` `playback` block, threaded into
 * `GENERATED_SPRITE_MANIFEST` at build time by
 * `scripts/build-sprite-manifest.mjs` (which validates them — malformed values
 * are dropped there).
 *
 * 3-LAYER FIELD-LEVEL CASCADE (anim-playback epic E3, 86ca2187n). The resolved
 * override is a per-FIELD merge of three layers, highest-priority last:
 *
 *   1. Engine default      — the absent-field behavior in the sequencer
 *                            (no entry in either layer below → field omitted).
 *   2. Pose-default        — `manifest.poseDefaults[anim].<field>`, shared
 *                            across ALL characters (repo-root
 *                            `assets/sprites/pose-defaults.json`). Sets e.g.
 *                            `idle_stretch = pingpong + finalDwellMs` ONCE.
 *   3. Per-character        — `manifest.characters[char].animations[anim]
 *                            .playback.<field>` (the character's own
 *                            `animations.json`). WINS field-by-field.
 *
 * The merge is `{ ...poseDefault, ...perChar }` — per-FIELD, not whole-object.
 * A per-char override that sets ONLY `speedMultiplier` still inherits the
 * pose-default's `playbackMode` / `finalDwellMs` (AC2). When `poseDefaults` is
 * absent / empty the result is byte-identical to the E2 read (AC3).
 *
 * Returns an empty override (engine default) when neither layer lists the
 * character/anim. Exported for unit-test coverage.
 *
 * The third arg is an optional source override for tests:
 *   - a `GeneratedSpriteManifest` (the production shape; default is the baked
 *     `GENERATED_SPRITE_MANIFEST`), OR
 *   - a flat `Record<charName, PlaybackOverrideTable>` (the injected
 *     `playbackTable` form used by the `createSpriteBox` sequencer tests to
 *     drive a generic pingpong/window without depending on the shipped seed).
 *     The flat form has NO pose-default layer — it returns the per-char entry
 *     directly so existing sequencer tests stay unaffected.
 * The two shapes are disambiguated by the presence of a `characters` key.
 */
export function resolvePlayback(
  characterName: string,
  animName: string,
  source: GeneratedSpriteManifest | Record<string, PlaybackOverrideTable> = GENERATED_SPRITE_MANIFEST,
): PlaybackOverride {
  // Injected flat override-table form (tests): `{ [char]: { [anim]: override } }`.
  // No pose-default layer in this form — return the per-char entry directly.
  if (!isManifestSource(source)) {
    return source[characterName]?.[animName] ?? {};
  }
  const poseDefault = source.poseDefaults?.[animName];
  const perChar = source.characters[characterName]?.animations?.[animName]?.playback;
  // Field-level cascade: per-char field wins over pose-default field, which
  // wins over the engine default (absent → field omitted). Object spread merges
  // per-field with perChar last, so a perChar field of `undefined` is NOT in
  // the spread (the sanitizer never emits undefined-valued keys) and the
  // pose-default field survives — exactly the AC2 inherit-mode-from-default case.
  if (poseDefault === undefined && perChar === undefined) {
    return {};
  }
  return { ...poseDefault, ...perChar };
}

/** True when `source` is a `GeneratedSpriteManifest` (has a `characters` map). */
function isManifestSource(
  source: GeneratedSpriteManifest | Record<string, PlaybackOverrideTable>,
): source is GeneratedSpriteManifest {
  return (
    typeof (source as GeneratedSpriteManifest).characters === "object" &&
    (source as GeneratedSpriteManifest).characters !== null
  );
}

export interface SpriteBoxProps {
  char: SpriteCharacter;
  state: AgentState;
  activity: string;
  /** Sprite base URI (host-injected) — frame paths are resolved against it. */
  spriteBaseUri: string;
  /**
   * The idle-pool pick from the PRIOR render of this tile (if it was idle).
   * Threaded by the caller so an idle episode keeps the same pose across the
   * ~2s poll re-renders rather than re-rolling every tick. Undefined on first
   * render or when the prior pose was active.
   */
  priorIdlePick?: string;
  /**
   * Whether the prior render was an ACTIVE pose. Combined with the current
   * pose to decide if this is a "fresh idle episode" (active→idle) that may
   * re-roll the idle pick. Defaults to false (first render).
   */
  priorWasActive?: boolean;
  /** Injected RNG for deterministic idle picks in tests. Defaults Math.random. */
  rng?: () => number;
  /**
   * Reduced-motion override for tests. Production reads
   * `matchMedia("(prefers-reduced-motion: reduce)")`. When true, no timer
   * runs; frame 0 is shown statically (AC4).
   */
  reducedMotion?: boolean;
  /**
   * Timer scheduler — defaults to window.setTimeout. Tests inject a manual
   * scheduler to step frames deterministically. Returns an opaque handle.
   */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Clear a scheduled frame — defaults to window.clearTimeout. */
  cancelFrame?: (handle: number) => void;
  /**
   * Monotonic clock (ms) for measuring how long the displayed frame has been on
   * screen (86ca3a7x3 freeze fix). Defaults to `performance.now()` (falling back
   * to `Date.now()`). Tests inject a virtual clock so the elapsed-on-screen time
   * is deterministic and decoupled from real wall time.
   */
  nowMs?: () => number;
  /**
   * Override the per-character playback table (tests only). Defaults to the
   * baked-in PLAYBACK_OVERRIDES. Lets a test drive a generic pingpong / window
   * without depending on the shipped idle_stretch seed.
   */
  playbackTable?: Record<string, PlaybackOverrideTable>;
  /**
   * Playback-position resume across re-renders (E1 live-preview fix 86ca2c4t8).
   *
   * A tile is fully re-rendered (DOM replaced, handle disposed, new box built)
   * every ~2s poll tick. WITHOUT resume, each new box restarts its loop at
   * `winStart` — so a pose whose full cycle is LONGER than the poll interval
   * never gets to play past the point the re-render lands on. For M01
   * `idle_stretch` (window [5,10], 320ms/frame) the apex is reached at ~1.6s
   * and held; the ~2s re-render resets to the arms-down `winStart` BEFORE the
   * descent (10→5) ever renders — the sponsor saw "raise → hold → immediate
   * swap" with no lower. Threading the prior frame index + direction back in
   * lets the new box RESUME the in-flight cycle instead of restarting it, so
   * raise → hold → lower → settle plays as ONE continuous motion that spans
   * however many poll re-renders it takes — exactly one full cycle before the
   * loop returns to its natural beginning.
   *
   * `priorPose` guards the resume: the position is only resumed when the new
   * canonical pose name (and therefore its window) matches the prior one.
   * A pose change (or fresh idle episode → new pick) starts at `winStart`.
   * Undefined on first render / pose change → start at `winStart`.
   */
  priorFrameIdx?: number;
  /** Prior advance direction (+1 / -1) for pingpong resume. See `priorFrameIdx`. */
  priorDirection?: number;
  /**
   * Wall-clock ms the resumed frame had ALREADY been on screen in the prior box
   * (now − the time the prior box last painted the displayed frame). 86ca3a7x3
   * freeze fix: the resuming box re-shows the frame but CARRIES this value
   * forward — it back-dates the new box's frame clock and shortens the frame's
   * remaining hold by the already-served time. So the on-screen time ACCUMULATES
   * across the poll re-render instead of resetting to 0. Without it, when the
   * re-render cadence is shorter than the frame's hold (fast out-of-band
   * file-event ticks, or a long peak/final dwell that exceeds the ~2s poll) each
   * fresh box's timer never fires before the next disposal → the frame is
   * re-shown forever (frozen). With it, the remaining hold shrinks each
   * re-render until the timer fires and the loop advances normally — while a
   * frame's full configured dwell is still respected (just spread across the
   * re-renders it takes to elapse). Absent → 0 (the frame's clock starts fresh —
   * the first-render / pose-change default). Only consulted when the resume
   * actually fires (pose match + finite index).
   */
  priorElapsedMs?: number;
  /**
   * The canonical pose name the prior render was playing. Resume only fires when
   * it equals the pose this render resolves to (same window math). See
   * `priorFrameIdx`.
   */
  priorPose?: string;
}

/** Handle returned so the caller can stop the timer on tile teardown. */
export interface SpriteBoxHandle {
  element: HTMLElement;
  /** Stop any running frame timer (call when the tile is removed). */
  dispose(): void;
  /** The idle-pool pick used (or null if the pose was active). For re-render threading. */
  idlePick: string | null;
  /** Whether the rendered pose is an active pose. For re-render threading. */
  isActive: boolean;
  /**
   * The canonical pose name this box is playing (active name or idle pick).
   * Threaded back on re-render so the player only RESUMES position when the
   * pose is unchanged (E1 live-preview fix 86ca2c4t8).
   */
  pose: string;
  /**
   * Current playback position — the LAST frame index shown + the advance
   * direction the loop is heading. Read at re-render time so the next box
   * resumes the in-flight cycle instead of restarting at `winStart`. For a
   * disposed/static box this is the frame it stopped on. (E1 fix 86ca2c4t8.)
   *
   * `elapsedMs` (86ca3a7x3) — wall-clock ms the displayed frame has been on
   * screen (now − the time `tick()` last painted it). The resuming box steps
   * PAST the frame when this is `>= frameMs` (it got its full base hold), which
   * guarantees forward progress per re-render even when this box was disposed
   * before its own frame timer fired (fast out-of-band re-render cadence — the
   * freeze). When `< frameMs` the frame was interrupted before completing its
   * base hold, so the resuming box re-shows it + re-arms its dwell (preserves
   * the 86ca2apxn #1 mid-dwell fix).
   */
  currentFrame(): { frameIdx: number; direction: number; elapsedMs: number };
}

function prefersReducedMotion(override?: boolean): boolean {
  if (typeof override === "boolean") {
    return override;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return false;
}

/**
 * Build the sprite box element + start its animation. Pure of the tile's other
 * concerns — the caller wraps the returned element into the tile's leading
 * edge and stores the handle for disposal.
 */
export function createSpriteBox(props: SpriteBoxProps): SpriteBoxHandle {
  const {
    char,
    state,
    activity,
    spriteBaseUri,
    priorIdlePick,
    priorWasActive,
    rng = Math.random,
    reducedMotion,
    scheduleFrame,
    cancelFrame,
    playbackTable,
    priorFrameIdx,
    priorDirection,
    priorPose,
    priorElapsedMs,
    nowMs,
  } = props;

  // ── Pose selection (AC2) ────────────────────────────────────────────────
  // Decide the idle pick FIRST (needed even for the idle branch of poseName).
  // Stickiness: keep the prior idle pick UNLESS this is a fresh idle episode
  // (the prior render was active OR there was no prior pick).
  const wantActive = state === "running";
  let idlePick: string | null = null;
  if (!wantActive) {
    const freshEpisode = priorWasActive === true || priorIdlePick === undefined;
    idlePick = freshEpisode ? pickIdle(char, rng) : priorIdlePick;
  }

  const { name, isActive } = poseNameForTile(state, activity, idlePick);
  const anim = resolvePose(char, name);

  // Canonical pose name for this render (active name or idle pick). Used for
  // playback-position resume (E1 fix 86ca2c4t8) and exposed on the handle so a
  // re-render only resumes position when the pose is unchanged.
  const canonicalName = isActive ? name : (idlePick ?? name);

  // ── DOM ───────────────────────────────────────────────────────────────
  const box = document.createElement("div");
  box.className = "sprite-box";
  box.dataset.character = char.character;

  const img = document.createElement("img");
  img.className = "sprite-frame";
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  img.decoding = "async";
  box.appendChild(img);

  // No frames at all → empty box (caller should have prevented this via
  // spriteForMember; defensive). Return a no-op handle.
  if (!anim || anim.frames.length === 0) {
    return {
      element: box,
      dispose: () => undefined,
      idlePick,
      isActive,
      pose: canonicalName,
      currentFrame: () => ({ frameIdx: 0, direction: 1, elapsedMs: 0 }),
    };
  }

  const base = spriteBaseUri.replace(/\/+$/, "");
  const frameUris = anim.frames.map((p) => `${base}/${p}`);

  box.dataset.pose = canonicalName;

  // Reduced motion (AC4) — show frame 0 only, no timer.
  if (prefersReducedMotion(reducedMotion)) {
    img.src = frameUris[0];
    box.dataset.reducedMotion = "true";
    return {
      element: box,
      dispose: () => undefined,
      idlePick,
      isActive,
      pose: canonicalName,
      currentFrame: () => ({ frameIdx: 0, direction: 1, elapsedMs: 0 }),
    };
  }

  // ── Frame sequencer (AC3) ───────────────────────────────────────────────
  const sched =
    scheduleFrame ??
    ((cb: () => void, ms: number) => window.setTimeout(cb, ms) as unknown as number);
  const cancel = cancelFrame ?? ((h: number) => window.clearTimeout(h));

  // Per-animation playback tuning (86ca1fntp). `canonicalName` (the active pose
  // name OR the idle pick) was resolved above; resolve the override for it.
  const override = playbackTable
    ? resolvePlayback(char.character, canonicalName, playbackTable)
    : resolvePlayback(char.character, canonicalName);
  const speedMultiplier =
    typeof override.speedMultiplier === "number" && override.speedMultiplier > 0
      ? override.speedMultiplier
      : 1;
  // 50% speed = half the RATE = 2× the per-frame ms.
  const frameMs = FRAME_MS_DEFAULT / speedMultiplier;
  const peakIndex = override.dwellFrameIndex;
  const peakDwellMs =
    typeof override.dwellMs === "number" ? override.dwellMs : PEAK_DWELL_MS_DEFAULT;
  // Final-frame idle dwell (E1 86ca21876): per-anim override falls back to the
  // global default so an absent field preserves today's fixed-400ms behavior.
  const finalDwellMs =
    typeof override.finalDwellMs === "number" ? override.finalDwellMs : DWELL_MS_DEFAULT;
  // Frame-advance mode (E1 86ca21876): only "pingpong" diverges; anything else
  // (incl. absent) is treated as "loop" → byte-identical historic advance.
  const isPingpong = override.playbackMode === "pingpong";

  const lastIndex = frameUris.length - 1;

  // Frame SUB-WINDOW (E1-refine 86ca21876). Clamp both endpoints into
  // [0, lastIndex] and ensure winStart <= winEnd, so a stale/inverted override
  // can never break the loop. Absent fields → [0, lastIndex] (full clip), which
  // makes the windowed advance below byte-identical to the historic behavior.
  const clamp = (n: number): number => Math.max(0, Math.min(lastIndex, Math.trunc(n)));
  let winStart = typeof override.startFrame === "number" ? clamp(override.startFrame) : 0;
  let winEnd = typeof override.endFrame === "number" ? clamp(override.endFrame) : lastIndex;
  if (winStart > winEnd) {
    // Inverted window → fall back to the full clip rather than animating nothing.
    winStart = 0;
    winEnd = lastIndex;
  }

  // Start at the window's lower bound (the loop's natural beginning — for a
  // windowed raise this is the REST frame, so the first thing shown is the
  // start of the raise, not the apex).
  let frameIdx = winStart;
  // Advance direction (+1 forward / -1 reverse). Only meaningful in pingpong
  // mode; loop mode never sets it to -1 so the advance stays historic.
  let direction = 1;
  // On-screen time the RESUMED frame had already accrued in the prior box when
  // it was re-shown without stepping past (elapsed < frameMs). Back-dates the
  // first tick's `shownAtMs` so accumulated on-screen time survives the box
  // swap and a sub-frame re-render cadence still eventually advances (86ca3a7x3).
  let carryElapsedMs = 0;

  // ── Playback-position RESUME across re-renders (E1 live-preview fix
  // 86ca2c4t8) ────────────────────────────────────────────────────────────
  // The tile DOM is replaced every ~2s poll tick, disposing this box and
  // building a fresh one. Without resume the fresh box restarts at `winStart`,
  // so a cycle longer than the poll interval (M01 idle_stretch: ~2.7s for
  // raise+hold+lower) NEVER plays past where the re-render lands — the descent
  // is dropped and the loop visibly snaps back to the rest frame. When the
  // caller threads back the prior box's position AND the pose is unchanged,
  // resume from it so raise → hold → lower → settle plays as ONE continuous
  // cycle spanning however many re-renders it takes.
  //
  // Guard: only resume on an exact pose match (priorPose === canonicalName) so
  // a pose change / fresh idle episode starts cleanly at `winStart`. The prior
  // index is clamped into the live window so a stale index (window changed
  // between renders) can never park the loop out of bounds.
  if (
    priorPose === canonicalName &&
    typeof priorFrameIdx === "number" &&
    Number.isFinite(priorFrameIdx)
  ) {
    frameIdx = Math.max(winStart, Math.min(winEnd, Math.trunc(priorFrameIdx)));
    if (priorDirection === -1 || priorDirection === 1) {
      direction = priorDirection;
    }
    // 86ca3a7x3 — the "frozen on one frame" fix. The prior box reports how long
    // its displayed frame had been ON SCREEN (`priorElapsedMs`). The resuming
    // box re-shows that frame (preserving the 86ca2apxn #1 mid-dwell hold) but
    // CARRIES FORWARD the already-served on-screen time as `carryElapsedMs`. The
    // first tick then (a) back-dates `shownAtMs` so the measured on-screen time
    // keeps ACCUMULATING across the box swap, and (b) shortens the scheduled
    // hold by the already-served time. That is what kills the freeze: when the
    // re-render cadence is SHORTER than the frame's hold (fast out-of-band
    // file-event ticks, or a long peak/final dwell that exceeds the ~2s poll),
    // the prior box is disposed before its OWN timer fires — so WITHOUT the
    // carry every fresh box resets the clock to 0, the remaining hold never
    // shrinks, and the timer never fires before the next disposal → the frame
    // is re-shown forever (frozen). With the carry, the remaining hold shrinks
    // by the elapsed each re-render, so after enough accumulated on-screen time
    // the timer fires and `tick()` advances normally — for ANY pose the tile
    // lands on (the bug is per-POSE, not per-character) — while a frame's full
    // configured dwell (peak/final) is still respected, just spread across the
    // re-renders it takes to elapse.
    const elapsed =
      typeof priorElapsedMs === "number" && priorElapsedMs >= 0 ? priorElapsedMs : 0;
    carryElapsedMs = elapsed;
  }

  let handle: number | null = null;
  let disposed = false;

  // The frame CURRENTLY DISPLAYED + the direction it was travelling when shown.
  // Distinct from the working `frameIdx`/`direction`, which `tick()` advances to
  // the NEXT frame before scheduling. A poll re-render can dispose this box at
  // ANY wall-clock moment — including WHILE a frame is still on screen part-way
  // through its (possibly long) dwell. Resuming from the already-advanced NEXT
  // position would SKIP the on-screen frame and drop the remainder of its dwell;
  // the bug surfaces hardest at slow speed, where the cup-at-mouth peak dwell
  // (600ms) and the cup-down final dwell (2000ms) each exceed the ~2s poll
  // interval, so the re-render is GUARANTEED to land mid-dwell and the long hold
  // never completes — "the loop restarts before completing" (86ca2apxn #1).
  // `currentFrame()` reports the DISPLAYED position so a resuming box re-renders
  // the same frame and re-applies its dwell, continuing the cycle without a skip.
  let shownIdx = frameIdx;
  let shownDirection = direction;
  // Monotonic clock — wall-clock ms reader used to measure how long the
  // currently-displayed frame has been on screen (86ca3a7x3). `currentFrame()`
  // reports `now − shownAtMs` so the NEXT box can step past a frame that already
  // got its full base hold, independent of whether this box's frame timer ever
  // fired (the freeze the prior fired-timer-only signal could not catch).
  const clock: () => number =
    nowMs ??
    (typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now());
  // Wall-clock ms when `tick()` last painted the displayed frame.
  let shownAtMs = clock();

  // Guard the peak (apex) index. It must be a real, REACHABLE frame: a finite
  // number inside the ACTIVE WINDOW [winStart, winEnd] — NOT merely inside the
  // full clip [0, lastIndex] (86ca2w1g9). The loop only ever renders frames in
  // the window, so an apex outside it (e.g. dwellFrameIndex=0 on a [5,10] window)
  // is never reached and `frameIdx === peakIndex` never becomes true — the dwell
  // silently does nothing. Validating against the window makes that explicit: a
  // within-window apex always fires; an out-of-window one is correctly NOT armed
  // (the tuner constrains its frame picker to the window so the sponsor can only
  // pick a reachable apex — see playbackTuner.populateApexFrames). With no window
  // declared (winStart=0, winEnd=lastIndex) this is byte-identical to the old
  // full-clip guard, so frame 0 (and any clip frame) still dwells as before.
  const peakIsValid =
    typeof peakIndex === "number" && peakIndex >= winStart && peakIndex <= winEnd;

  // True only for the synchronous construction tick (the box's first paint).
  // The first paint may RESUME a frame the prior box re-showed without finishing
  // its base hold — `carryElapsedMs` is the time already accrued, applied once
  // here to (a) back-date `shownAtMs` so `currentFrame().elapsedMs` keeps
  // accumulating across the box swap and (b) shorten the scheduled hold by the
  // already-served time so the total on-screen duration is unchanged (86ca3a7x3).
  let firstTick = true;

  const tick = (): void => {
    if (disposed) return;
    img.src = frameUris[frameIdx];
    // Capture the displayed position BEFORE the endpoint flip / advance below so
    // `currentFrame()` reports the frame actually on screen (+ the direction it
    // was travelling when rendered), not the next one. Stamp the paint time so
    // a resuming box can tell how long this frame has been shown (86ca3a7x3).
    // On the first paint, back-date by any carried-over elapsed so accumulated
    // on-screen time survives the box swap.
    shownIdx = frameIdx;
    shownDirection = direction;
    const carry = firstTick ? carryElapsedMs : 0;
    shownAtMs = clock() - carry;
    // Base per-frame duration (speed-scaled), minus any already-served time on
    // a resumed-and-re-shown frame so the TOTAL hold is unchanged.
    let ms = frameMs;
    // Final-frame idle dwell before turnaround/wrap (idle poses only — active
    // poses loop at uniform cadence so typing/reading feels continuous). Fires
    // on the FORWARD arrival at the WINDOW END (the apex when the window is the
    // raise half), NOT on the reverse pass back through it (Bram's gotcha —
    // E1 86ca21876).
    if (frameIdx === winEnd && !isActive && direction === 1) {
      ms += finalDwellMs;
    }
    // Mid-sequence peak-frame dwell (hold the gesture apex). Composes with the
    // final-frame dwell when the peak coincides with the window end.
    if (peakIsValid && frameIdx === peakIndex) {
      ms += peakDwellMs;
    }
    // Subtract already-served time on a resumed-and-re-shown frame so the TOTAL
    // hold (across the box swap) equals the configured frameMs+dwell, then floor
    // at a minimal positive delay so the timer still fires (86ca3a7x3). Only the
    // first paint can carry; later ticks have carry === 0.
    if (carry > 0) {
      ms = Math.max(1, ms - carry);
    }
    firstTick = false;
    // Advance to the next frame WITHIN the window.
    if (isPingpong && winEnd > winStart) {
      // Reverse direction AT each window endpoint (naive endpoint-hold: winStart
      // and winEnd each show once per turnaround). A single-frame window
      // (winEnd === winStart) is handled by the else branch (stays put).
      if (frameIdx === winEnd) direction = -1;
      else if (frameIdx === winStart) direction = 1;
      frameIdx += direction;
    } else {
      // Loop mode (default/absent) — advance within the window, wrap winEnd →
      // winStart. With a full-clip window [0, lastIndex] this is byte-identical
      // to the historic +1/wrap-to-0 advance.
      frameIdx = frameIdx === winEnd ? winStart : frameIdx + 1;
    }
    handle = sched(tick, ms);
  };

  // Single-frame anim → just show it, no loop.
  if (frameUris.length === 1) {
    img.src = frameUris[0];
    return {
      element: box,
      dispose: () => undefined,
      idlePick,
      isActive,
      pose: canonicalName,
      currentFrame: () => ({ frameIdx: 0, direction: 1, elapsedMs: 0 }),
    };
  }

  tick();

  return {
    element: box,
    dispose: () => {
      disposed = true;
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
    idlePick,
    isActive,
    pose: canonicalName,
    // Report the DISPLAYED frame + the direction it was travelling when shown
    // (NOT the already-advanced next position). A resuming box re-renders this
    // frame and re-runs the SAME dwell+advance logic, so a frame interrupted
    // mid-dwell by a poll re-render finishes its hold instead of being skipped
    // (86ca2apxn #1). Live — reads the current value whenever the next render
    // asks for it. `elapsedMs` tells the next box how long the displayed frame
    // has been on screen: ≥ frameMs ⇒ it got its base hold ⇒ STEP PAST it (kills
    // the freeze regardless of timer firing); < frameMs ⇒ re-show + re-arm its
    // dwell so an interrupted hold finishes — 86ca3a7x3 freeze fix.
    currentFrame: () => ({
      frameIdx: shownIdx,
      direction: shownDirection,
      elapsedMs: Math.max(0, clock() - shownAtMs),
    }),
  };
}
