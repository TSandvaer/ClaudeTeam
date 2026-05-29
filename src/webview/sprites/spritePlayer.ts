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
import {
  pickIdle,
  poseNameForTile,
  resolvePose,
} from "./posePicker.js";

/** Default slow per-frame duration (ms) — mirrors --ct-anim-frame-ms-default. */
export const FRAME_MS_DEFAULT = 160;
/** Default hold-final-frame dwell (ms) — mirrors --ct-anim-dwell-ms-default. */
export const DWELL_MS_DEFAULT = 400;

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
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
  ) {
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
  const cancel =
    cancelFrame ?? ((h: number) => window.clearTimeout(h));

  let frameIdx = 0;
  let handle: number | null = null;
  let disposed = false;

  const lastIndex = frameUris.length - 1;

  const tick = (): void => {
    if (disposed) return;
    img.src = frameUris[frameIdx];
    // Dwell on the final frame before wrapping (idle poses only — active
    // poses loop at uniform slow cadence so typing/reading feels continuous).
    const isFinal = frameIdx === lastIndex;
    const ms =
      isFinal && !isActive
        ? FRAME_MS_DEFAULT + DWELL_MS_DEFAULT
        : FRAME_MS_DEFAULT;
    frameIdx = frameIdx === lastIndex ? 0 : frameIdx + 1;
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
