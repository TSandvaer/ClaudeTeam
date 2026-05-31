/**
 * @vitest-environment jsdom
 *
 * Unit tests for spritePlayer per-animation playback tuning (86ca1fntp):
 *   - resolvePlayback: pure (character, anim) → override resolution, incl. the
 *     50% / 70% speed list and character-specific peak-frame dwell indices.
 *   - createSpriteBox frame sequencer: speed-scaled per-frame ms, mid-sequence
 *     peak-frame dwell, final-frame idle dwell, and their composition — all via
 *     an injected deterministic scheduler (no real timers).
 *   - reduced-motion regression: still frame-0-only, no timer (unchanged).
 *
 * These drive the player directly (not through agentTile) so the timing
 * contract is asserted in isolation against a synthetic manifest.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSpriteBox,
  resolvePlayback,
  FRAME_MS_DEFAULT,
  DWELL_MS_DEFAULT,
  PEAK_DWELL_MS_DEFAULT,
  PLAYBACK_OVERRIDES,
} from "../../../src/webview/sprites/spritePlayer.js";
import type { SpriteCharacter } from "../../../src/webview/sprites/spriteManifest.js";

const M01 = "ClaudeTeam-M01-Dev";
const F01 = "ClaudeTeam-F01-Dev";

/** Build a synthetic character with N-frame anims for the named poses. */
function char(name: string, frameCounts: Record<string, number>): SpriteCharacter {
  const animations: SpriteCharacter["animations"] = {};
  for (const [anim, n] of Object.entries(frameCounts)) {
    animations[anim] = {
      folder: anim,
      frames: Array.from({ length: n }, (_, i) => `${name}/${anim}/frame_${i}.png`),
    };
  }
  return {
    character: name,
    defaultIdle: "idle_coffee",
    idlePool: Object.keys(frameCounts).filter((k) => k.startsWith("idle_")),
    animations,
  };
}

/** A scheduler that records each delay and lets the test step the loop. */
function recordingScheduler() {
  const calls: number[] = [];
  const cbs: Array<() => void> = [];
  const schedule = (cb: () => void, ms: number): number => {
    calls.push(ms);
    cbs.push(cb);
    return calls.length;
  };
  const step = (): void => {
    const cb = cbs.shift();
    if (cb) cb();
  };
  return { calls, schedule, step };
}

describe("resolvePlayback — speed list (86ca1fntp)", () => {
  it.each([
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
  ])("%s plays at 50%% speed on both characters", (anim) => {
    expect(resolvePlayback(M01, anim).speedMultiplier).toBe(0.5);
    expect(resolvePlayback(F01, anim).speedMultiplier).toBe(0.5);
  });

  it("idle_headphones plays at 70% speed", () => {
    expect(resolvePlayback(M01, "idle_headphones").speedMultiplier).toBe(0.7);
    expect(resolvePlayback(F01, "idle_headphones").speedMultiplier).toBe(0.7);
  });

  it("idle_wave is unchanged (no override)", () => {
    expect(resolvePlayback(M01, "idle_wave")).toEqual({});
    expect(resolvePlayback(F01, "idle_wave")).toEqual({});
  });

  it("an unknown anim or character resolves to the default (empty) override", () => {
    expect(resolvePlayback(M01, "idle_does_not_exist")).toEqual({});
    expect(resolvePlayback("ClaudeTeam-Z99-Dev", "idle_coffee")).toEqual({});
  });
});

describe("resolvePlayback — peak-frame dwell indices (character-specific)", () => {
  it("coffee/snack/phone peak at frame 4 for both characters", () => {
    for (const c of [M01, F01]) {
      expect(resolvePlayback(c, "idle_coffee").dwellFrameIndex).toBe(4);
      expect(resolvePlayback(c, "idle_snack").dwellFrameIndex).toBe(4);
      expect(resolvePlayback(c, "idle_phone").dwellFrameIndex).toBe(4);
    }
  });

  it("stretch peak differs by character (M01 frame 8, F01 frame 5)", () => {
    expect(resolvePlayback(M01, "idle_stretch").dwellFrameIndex).toBe(8);
    expect(resolvePlayback(F01, "idle_stretch").dwellFrameIndex).toBe(5);
  });

  it("peak poses retain their 50% speed alongside the dwell", () => {
    const o = resolvePlayback(M01, "idle_coffee");
    expect(o.speedMultiplier).toBe(0.5);
    expect(o.dwellFrameIndex).toBe(4);
  });

  it("a non-peak speed pose carries speed only (no dwellFrameIndex)", () => {
    expect(resolvePlayback(M01, "idle_hips").dwellFrameIndex).toBeUndefined();
    expect(resolvePlayback(M01, "idle_hips").speedMultiplier).toBe(0.5);
  });

  it("PLAYBACK_OVERRIDES exposes both character tables", () => {
    expect(Object.keys(PLAYBACK_OVERRIDES).sort()).toEqual([F01, M01]);
  });
});

describe("createSpriteBox — speed-scaled per-frame ms", () => {
  it("a 50% pose holds each frame for 2× the default ms", () => {
    const sched = recordingScheduler();
    createSpriteBox({
      char: char(M01, { idle_hips: 4 }), // idle_hips = 50% speed, no peak
      state: "idle",
      activity: "idle 10s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_hips", // stickiness: keep this pick
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    // First frame (idx 0): base 50% ms, no dwell (not peak, not final).
    expect(sched.calls[0]).toBe(FRAME_MS_DEFAULT / 0.5);
  });

  it("idle_wave (no override) holds each frame for the plain default ms", () => {
    const sched = recordingScheduler();
    createSpriteBox({
      char: char(M01, { idle_wave: 4 }),
      state: "idle",
      activity: "idle 10s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_wave",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    expect(sched.calls[0]).toBe(FRAME_MS_DEFAULT);
  });
});

describe("createSpriteBox — peak-frame dwell + composition (deterministic)", () => {
  it("holds the M01 stretch peak frame (8) longer, mid-sequence", () => {
    const sched = recordingScheduler();
    // idle_stretch: 11 frames (0..10), 50% speed, M01 peak = frame 8.
    createSpriteBox({
      char: char(M01, { idle_stretch: 11 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    // Advance to frame 8 (8 steps after the synchronous frame-0 schedule).
    for (let i = 0; i < 8; i++) sched.step();
    // Frame 8 = peak, not final (final is 10) → base + peak dwell.
    expect(sched.calls[8]).toBe(base + PEAK_DWELL_MS_DEFAULT);
    // Frame 2 = neither peak nor final → plain base.
    expect(sched.calls[2]).toBe(base);
  });

  it("F01 stretch peak is frame 5 (different sequence)", () => {
    const sched = recordingScheduler();
    createSpriteBox({
      char: char(F01, { idle_stretch: 11 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    for (let i = 0; i < 5; i++) sched.step();
    expect(sched.calls[5]).toBe(base + PEAK_DWELL_MS_DEFAULT);
    // M01's peak index (8) must NOT dwell on F01.
    for (let i = 5; i < 8; i++) sched.step();
    expect(sched.calls[8]).toBe(base);
  });

  it("composes peak dwell + final-frame dwell when peak lands on the last frame", () => {
    const sched = recordingScheduler();
    // Synthetic 5-frame coffee so the peak (4) IS the final frame.
    createSpriteBox({
      char: char(M01, { idle_coffee: 5 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    for (let i = 0; i < 4; i++) sched.step();
    // Frame 4 = peak AND final → base + final dwell + peak dwell (both apply).
    expect(sched.calls[4]).toBe(base + DWELL_MS_DEFAULT + PEAK_DWELL_MS_DEFAULT);
  });

  it("ignores an out-of-range peak index without breaking the loop", () => {
    const sched = recordingScheduler();
    // Coffee with only 3 frames — peak index 4 is out of range; loop must run
    // at plain base speed with no dwell crash.
    createSpriteBox({
      char: char(M01, { idle_coffee: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    expect(sched.calls[0]).toBe(base);
    sched.step();
    expect(sched.calls[1]).toBe(base);
    sched.step(); // frame 2 = final → final dwell only
    expect(sched.calls[2]).toBe(base + DWELL_MS_DEFAULT);
  });

  it("active poses never dwell on the final frame (continuous loop)", () => {
    const sched = recordingScheduler();
    // active_work: 50% speed, no peak, no final dwell.
    createSpriteBox({
      char: char(M01, { active_work: 5 }),
      state: "running",
      activity: "tool:Edit x",
      spriteBaseUri: "base",
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    for (let i = 0; i < 4; i++) sched.step();
    // Final frame (4) for an active pose → plain base, no dwell.
    expect(sched.calls[4]).toBe(base);
  });
});

describe("createSpriteBox — reduced-motion regression (AC4 unchanged)", () => {
  it("shows frame 0 only and schedules NO timer", () => {
    const schedule = vi.fn();
    const handle = createSpriteBox({
      char: char(M01, { idle_coffee: 9 }),
      state: "idle",
      activity: "idle 10s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      reducedMotion: true,
      scheduleFrame: schedule,
      cancelFrame: () => undefined,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/frame_0\.png$/);
    expect(handle.element.getAttribute("data-reduced-motion")).toBe("true");
    expect(schedule).not.toHaveBeenCalled();
  });
});

// ── E1 (86ca21876): finalDwellMs + playbackMode:"pingpong" ──────────────────
//
// Non-vacuity (revert checklist):
//   - "pingpong index sequence": reverting the direction-aware advance back to
//     `frameIdx = frameIdx === lastIndex ? 0 : frameIdx + 1` makes the observed
//     frame order 0,1,2,0,1,2 (loop wrap) instead of 0,1,2,1,0,1 → FAILS.
//   - "finalDwellMs override": dropping the `override.finalDwellMs ?? …` resolve
//     reverts the final-frame hold to the fixed 400ms → the 800ms assertion FAILS.
//   - "loop mode byte-identical": if the loop branch is replaced by pingpong the
//     wrap order changes → FAILS.
//   - "final dwell only on forward arrival": dropping the `direction === 1` gate
//     adds the dwell on the reverse pass through lastIndex too → the reverse-pass
//     plain-base assertion FAILS.

/** Extract the numeric frame index from an img src of the form …/frame_<i>.png. */
function frameOf(img: HTMLImageElement): number {
  const m = /frame_(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
  if (!m) throw new Error(`no frame index in src: ${img.getAttribute("src")}`);
  return Number(m[1]);
}

describe("PlaybackOverride — new E1 fields exist + resolve (AC1)", () => {
  it("idle_stretch carries playbackMode:'pingpong' + finalDwellMs on both chars", () => {
    for (const c of [M01, F01]) {
      const o = resolvePlayback(c, "idle_stretch");
      expect(o.playbackMode).toBe("pingpong");
      expect(o.finalDwellMs).toBe(800);
    }
  });

  it("a non-pingpong pose leaves playbackMode/finalDwellMs absent (loop default)", () => {
    const o = resolvePlayback(M01, "idle_hips");
    expect(o.playbackMode).toBeUndefined();
    expect(o.finalDwellMs).toBeUndefined();
  });
});

describe("createSpriteBox — pingpong frame sequence (AC3)", () => {
  it("plays [0,1,2] forward then reverses: 0,1,2,1,0,1,2,1,0", () => {
    const sched = recordingScheduler();
    // idle_stretch is seeded pingpong; 3 frames → peak (8) is out of range so it
    // does not interfere with the pure index-sequence assertion.
    const handle = createSpriteBox({
      char: char(M01, { idle_stretch: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    const seen: number[] = [frameOf(img)]; // frame shown by the synchronous tick()
    for (let i = 0; i < 8; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    expect(seen).toEqual([0, 1, 2, 1, 0, 1, 2, 1, 0]);
  });

  it("a 2-frame pingpong oscillates 0,1,0,1 (endpoints adjacent)", () => {
    const sched = recordingScheduler();
    const handle = createSpriteBox({
      char: char(M01, { idle_stretch: 2 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    const seen: number[] = [frameOf(img)];
    for (let i = 0; i < 4; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    expect(seen).toEqual([0, 1, 0, 1, 0]);
  });
});

describe("createSpriteBox — finalDwellMs (AC2)", () => {
  it("holds the final frame for the per-anim finalDwellMs (800), not the 400 default", () => {
    const sched = recordingScheduler();
    // Loop-mode pose with an explicit finalDwellMs via a custom override table
    // through createSpriteBox is not reachable (the engine reads PLAYBACK_OVERRIDES),
    // so drive it through the seeded pingpong idle_stretch and assert the FORWARD
    // arrival hold. 3 frames: forward arrival at frame 2 (direction +1).
    const base = FRAME_MS_DEFAULT / 0.5; // idle_stretch is also 50% speed
    createSpriteBox({
      char: char(M01, { idle_stretch: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    // calls[0]=frame0, [1]=frame1, [2]=frame2 (forward arrival → +800 finalDwell).
    sched.step(); // schedule for frame 1
    sched.step(); // schedule for frame 2 (forward arrival)
    expect(sched.calls[2]).toBe(base + 800);
    // Prove it is NOT the global 400 default.
    expect(sched.calls[2]).not.toBe(base + DWELL_MS_DEFAULT);
  });

  it("absent finalDwellMs preserves the global DWELL_MS_DEFAULT (400) on the final frame", () => {
    const sched = recordingScheduler();
    // idle_hips: 50% speed, loop mode, no finalDwellMs → final frame holds 400.
    const base = FRAME_MS_DEFAULT / 0.5;
    createSpriteBox({
      char: char(M01, { idle_hips: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_hips",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    sched.step();
    sched.step(); // frame 2 = final
    expect(sched.calls[2]).toBe(base + DWELL_MS_DEFAULT);
  });
});

describe("createSpriteBox — final dwell fires only on FORWARD arrival in pingpong (Bram gotcha)", () => {
  it("does NOT add the final dwell on the reverse pass back through lastIndex", () => {
    const sched = recordingScheduler();
    const base = FRAME_MS_DEFAULT / 0.5;
    createSpriteBox({
      char: char(M01, { idle_stretch: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    // Index sequence (frames shown): 0,1,2,1,0,1,2,…
    // calls index → frame shown: [0]→0, [1]→1, [2]→2(fwd, +800), [3]→1, [4]→0,
    //   [5]→1, [6]→2(fwd again, +800).
    // lastIndex (2) is only ever reached via forward arrival, so it always
    // dwells; the gate's value is that frames 1/0 on the REVERSE pass carry
    // plain base (no spurious final dwell leaking onto a non-last frame).
    for (let i = 0; i < 6; i++) sched.step();
    expect(sched.calls[2]).toBe(base + 800); // forward arrival at last
    expect(sched.calls[3]).toBe(base); // reverse pass, frame 1 → plain base
    expect(sched.calls[4]).toBe(base); // reverse pass, frame 0 → plain base
    expect(sched.calls[6]).toBe(base + 800); // next forward arrival at last
  });
});

describe("createSpriteBox — loop-mode regression: advance byte-identical to historic", () => {
  it("a loop-mode pose wraps last→0 (0,1,2,0,1,2), never reversing", () => {
    const sched = recordingScheduler();
    // idle_hips = loop (no playbackMode) — must keep the historic wrap.
    const handle = createSpriteBox({
      char: char(M01, { idle_hips: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_hips",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    const seen: number[] = [frameOf(img)];
    for (let i = 0; i < 5; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    expect(seen).toEqual([0, 1, 2, 0, 1, 2]);
  });
});
