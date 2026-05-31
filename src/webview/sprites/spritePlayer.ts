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
 *   - idle_stretch (arms fully up) — 11-frame loop:
 *       · M01 sequence starts at the overhead peak (frame 0) and re-peaks
 *         mid-sequence at frame 8 (overhead→lower→overhead). Hold frame 8 so
 *         the loop reads "up → HOLD → relax → up", not exercise reps.
 *       · F01 sequence is gentler (no full overhead); max arm-raise is at
 *         frame 5. Hold frame 5.
 *
 * Sponsor visually tunes the exact feel on reload — these indices/ms are the
 * starting point.
 *
 * E1 (86ca21876) pingpong preview: `idle_stretch` is wired to
 * `playbackMode: "pingpong"` + a longer `finalDwellMs` on both characters so the
 * sponsor can eyeball the endpoint feel (the AC5 sponsor-preview gate). The
 * arms-up→down→up sweep reads as a natural stretch under pingpong rather than a
 * jump-cut wrap. This seeding lives in the hardcoded map only as the E1 preview
 * surface — E2 (86ca…) routes these fields through `animations.json` and
 * removes the map. The existing peak `dwellFrameIndex` (M01 8 / F01 5) still
 * composes with pingpong (extra apex hold at the overhead frame).
 */
export const PLAYBACK_OVERRIDES: Record<string, PlaybackOverrideTable> = (() => {
  const m01 = baseSpeedTable();
  m01["idle_coffee"] = withPeak(m01["idle_coffee"], 4);
  m01["idle_snack"] = withPeak(m01["idle_snack"], 4);
  m01["idle_phone"] = withPeak(m01["idle_phone"], 4);
  m01["idle_stretch"] = {
    ...withPeak(m01["idle_stretch"], 8),
    playbackMode: "pingpong",
    finalDwellMs: 800,
  };

  const f01 = baseSpeedTable();
  f01["idle_coffee"] = withPeak(f01["idle_coffee"], 4);
  f01["idle_snack"] = withPeak(f01["idle_snack"], 4);
  f01["idle_phone"] = withPeak(f01["idle_phone"], 4);
  f01["idle_stretch"] = {
    ...withPeak(f01["idle_stretch"], 5),
    playbackMode: "pingpong",
    finalDwellMs: 800,
  };

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
  const override = resolvePlayback(char.character, canonicalName);
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

  let frameIdx = 0;
  // Advance direction (+1 forward / -1 reverse). Only meaningful in pingpong
  // mode; loop mode never sets it to -1 so the advance stays historic.
  let direction = 1;
  let handle: number | null = null;
  let disposed = false;

  const lastIndex = frameUris.length - 1;
  // Guard against an out-of-range peak index (frame counts differ M01 vs F01;
  // a stale index must not break the loop).
  const peakIsValid = typeof peakIndex === "number" && peakIndex >= 0 && peakIndex <= lastIndex;

  const tick = (): void => {
    if (disposed) return;
    img.src = frameUris[frameIdx];
    // Base per-frame duration (speed-scaled).
    let ms = frameMs;
    // Final-frame idle dwell before turnaround/wrap (idle poses only — active
    // poses loop at uniform cadence so typing/reading feels continuous). In
    // pingpong mode this fires ONLY on the FORWARD arrival at the last frame
    // (direction still +1), not on the reverse pass back through it (Bram's
    // gotcha — E1 86ca21876).
    if (frameIdx === lastIndex && !isActive && direction === 1) {
      ms += finalDwellMs;
    }
    // Mid-sequence peak-frame dwell (hold the gesture apex). Composes with the
    // final-frame dwell when the peak coincides with the last frame.
    if (peakIsValid && frameIdx === peakIndex) {
      ms += peakDwellMs;
    }
    // Advance to the next frame.
    if (isPingpong && lastIndex > 0) {
      // Reverse direction AT each endpoint (naive endpoint-hold: 0 and N-1 each
      // show once per turnaround). Single-frame anims never reach here (handled
      // below) and a 2-frame anim oscillates 0,1,0,1,….
      if (frameIdx === lastIndex) direction = -1;
      else if (frameIdx === 0) direction = 1;
      frameIdx += direction;
    } else {
      // Loop mode (default/absent) — byte-identical historic advance.
      frameIdx = frameIdx === lastIndex ? 0 : frameIdx + 1;
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
