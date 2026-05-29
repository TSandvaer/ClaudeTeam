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
