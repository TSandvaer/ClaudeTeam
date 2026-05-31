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
import type { SpriteCharacter } from "./spriteManifest.js";
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
 * Speed-only override shared by BOTH characters (the brief's 50% / 70% list).
 * Peak-frame dwell indices are layered per-character on top of these because
 * the apex frame differs between M01 and F01 frame sequences.
 *
 * 50% speed (≈half the default rate): active_read, active_work + the listed
 * idle poses. 70%: idle_headphones. idle_wave + any unlisted anim → unchanged.
 */
const SPEED_HALF: PlaybackOverride = { speedMultiplier: 0.5 };
const SPEED_HALF_NAMES = [
  "active_read",
  "active_work",
  "idle_coffee",
  "idle_snack",
  "idle_stretch",
  "idle_phone",
  "idle_hips",
  "idle_think",
  "idle_arms_crossed",
  "idle_pockets",
  "idle_neck_roll",
  "idle_yawn",
  "idle_watch",
];

function baseSpeedTable(): PlaybackOverrideTable {
  const t: PlaybackOverrideTable = {};
  for (const name of SPEED_HALF_NAMES) {
    t[name] = { ...SPEED_HALF };
  }
  t["idle_headphones"] = { speedMultiplier: 0.7 };
  // idle_wave: intentionally absent → unchanged (default rate, no dwell).
  return t;
}

/**
 * Merge a peak-frame `dwellFrameIndex` into a speed override for a pose.
 * Keeps any existing speedMultiplier.
 */
function withPeak(base: PlaybackOverride | undefined, dwellFrameIndex: number): PlaybackOverride {
  return { ...(base ?? {}), dwellFrameIndex };
}

/**
 * Per-character playback override tables (86ca1fntp).
 *
 * Speed multipliers are identical across characters (the brief's list applies
 * to BOTH M01 + F01). Peak-frame dwell indices are character-specific because
 * the two characters' frame sequences put the gesture apex at different
 * indices (verified by inspecting the harvested south-view frames):
 *
 *   PEAK FRAMES (mid-sequence apex held longer):
 *   - idle_coffee (cup at mouth)  — 9-frame loop, both → frame 4 (mid-loop hold)
 *   - idle_snack  (hand at mouth) — 9-frame loop, both → frame 4
 *   - idle_phone  (phone at face) — 9-frame loop, both → frame 4
 *   - idle_stretch (arms fully up) — 11-frame loop. The two genders' clips
 *     differ in AUTHORED MOTION (verified by inspecting the south frames +
 *     measuring the silhouette top-reach per frame, E1-refine 86ca21876):
 *       · M01 (`a_slow_stretching_loop_from_the_overhead_stretched`): a LARGE
 *         sweep. Frame 0 = arms OVERHEAD (apex); frame 5 = arms DOWN (rest);
 *         frame 10 = arms OVERHEAD again. So the clip is `up → rest → up`.
 *         Played forward from frame 0 it reads "starts hands up, LOWERS slowly,
 *         restarts" — the sponsor's bug. The fix windows the loop to the
 *         rest→up HALF (frames 5..10) and runs it pingpong: forward 5→10 is a
 *         clean RAISE, the finalDwell holds at 10 (apex), reverse 10→5 is a
 *         clean LOWER, restart. Result: RAISE → HOLD-at-top → LOWER → restart.
 *       · F01 (`a_gentle_tired_stretching_motion_the_arms_reach_a`): NEAR-STATIC.
 *         The measured top-reach varies by ~1px across all 11 frames — the arms
 *         stay up/stretched the entire clip (only a small body/knee bob). It
 *         physically CANNOT express a raise sweep. The sponsor said F01's
 *         held-stretch "is fine," so F01 keeps a plain gentle loop (no pingpong,
 *         no apex window) — faking a raise here is impossible without new art.
 *
 * Sponsor visually tunes the exact feel on reload — these indices/ms are the
 * starting point.
 *
 * E1-refine (86ca21876): M01 `idle_stretch` is windowed to frames 5..10 +
 * `playbackMode:"pingpong"` + `finalDwellMs:800` so the preview shows the
 * corrected raise-first loop. F01 keeps held-stretch (sponsor-approved). This
 * seeding lives in the hardcoded map only as the E1 preview surface — E2 (86ca…)
 * routes these fields through `animations.json` and removes the map.
 */
export const PLAYBACK_OVERRIDES: Record<string, PlaybackOverrideTable> = (() => {
  const m01 = baseSpeedTable();
  m01["idle_coffee"] = withPeak(m01["idle_coffee"], 4);
  m01["idle_snack"] = withPeak(m01["idle_snack"], 4);
  m01["idle_phone"] = withPeak(m01["idle_phone"], 4);
  // M01 stretch: window to the rest→up half (5..10) + pingpong so it plays
  // RAISE(5→10) → HOLD@10(apex, finalDwell) → LOWER(10→5) → restart. No new art.
  m01["idle_stretch"] = {
    ...m01["idle_stretch"],
    startFrame: 5,
    endFrame: 10,
    playbackMode: "pingpong",
    finalDwellMs: 800,
  };

  const f01 = baseSpeedTable();
  f01["idle_coffee"] = withPeak(f01["idle_coffee"], 4);
  f01["idle_snack"] = withPeak(f01["idle_snack"], 4);
  f01["idle_phone"] = withPeak(f01["idle_phone"], 4);
  // F01 stretch: near-static held stretch (sponsor said "fine"). Plain gentle
  // loop — its frames can't express a raise sweep, so no pingpong/window/peak.
  // Speed-half from baseSpeedTable() is kept for a calm cadence.

  return {
    "ClaudeTeam-M01-Dev": m01,
    "ClaudeTeam-F01-Dev": f01,
  };
})();

/**
 * Resolve the playback override for (character, canonical anim name). Returns
 * an empty override (default behavior) when the character or anim is unlisted.
 * Exported for unit-test coverage.
 */
export function resolvePlayback(
  characterName: string,
  animName: string,
  table: Record<string, PlaybackOverrideTable> = PLAYBACK_OVERRIDES,
): PlaybackOverride {
  return table[characterName]?.[animName] ?? {};
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
   * Override the per-character playback table (tests only). Defaults to the
   * baked-in PLAYBACK_OVERRIDES. Lets a test drive a generic pingpong / window
   * without depending on the shipped idle_stretch seed.
   */
  playbackTable?: Record<string, PlaybackOverrideTable>;
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
    };
  }

  const base = spriteBaseUri.replace(/\/+$/, "");
  const frameUris = anim.frames.map((p) => `${base}/${p}`);

  box.dataset.pose = isActive ? name : (idlePick ?? name);

  // Reduced motion (AC4) — show frame 0 only, no timer.
  if (prefersReducedMotion(reducedMotion)) {
    img.src = frameUris[0];
    box.dataset.reducedMotion = "true";
    return {
      element: box,
      dispose: () => undefined,
      idlePick,
      isActive,
    };
  }

  // ── Frame sequencer (AC3) ───────────────────────────────────────────────
  const sched =
    scheduleFrame ??
    ((cb: () => void, ms: number) => window.setTimeout(cb, ms) as unknown as number);
  const cancel = cancelFrame ?? ((h: number) => window.clearTimeout(h));

  // Per-animation playback tuning (86ca1fntp). The canonical anim name is the
  // active pose name OR the idle pick; resolve the override for this character.
  const canonicalName = isActive ? name : (idlePick ?? name);
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
  let handle: number | null = null;
  let disposed = false;

  // Guard against an out-of-range peak index (frame counts differ M01 vs F01;
  // a stale index must not break the loop).
  const peakIsValid = typeof peakIndex === "number" && peakIndex >= 0 && peakIndex <= lastIndex;

  const tick = (): void => {
    if (disposed) return;
    img.src = frameUris[frameIdx];
    // Base per-frame duration (speed-scaled).
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
  };
}
