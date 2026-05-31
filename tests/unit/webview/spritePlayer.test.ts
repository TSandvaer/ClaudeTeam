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

  it("idle_stretch is windowed raise-first (M01) / plain held loop (F01) — E1-refine 86ca21876", () => {
    // M01 idle_stretch is authored up→rest→up (frame 0 = apex, 5 = rest, 10 =
    // apex). The override windows the loop to the rest→up half [5,10] + pingpong
    // so it reads RAISE → HOLD@apex → LOWER → restart (replaces the old
    // full-clip + dwellFrameIndex:8 seed which lowered-first).
    const m = resolvePlayback(M01, "idle_stretch");
    expect(m.startFrame).toBe(5);
    expect(m.endFrame).toBe(10);
    expect(m.playbackMode).toBe("pingpong");
    expect(m.finalDwellMs).toBe(800);
    expect(m.dwellFrameIndex).toBeUndefined(); // no mid-peak; apex hold = finalDwell
    // F01's clip is near-static (arms held high all 11 frames); it cannot
    // express a raise + sponsor said the held stretch "is fine" → plain gentle
    // loop (no window/pingpong/peak), keeping only the speed-half cadence.
    const f = resolvePlayback(F01, "idle_stretch");
    expect(f.startFrame).toBeUndefined();
    expect(f.endFrame).toBeUndefined();
    expect(f.playbackMode).toBeUndefined();
    expect(f.dwellFrameIndex).toBeUndefined();
    expect(f.speedMultiplier).toBe(0.5);
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
  it("holds the idle_snack peak frame (4) longer, mid-sequence (still uses dwellFrameIndex)", () => {
    const sched = recordingScheduler();
    // E1-refine: idle_stretch no longer uses a mid-peak (it's windowed pingpong).
    // idle_snack still does — 9 frames (0..8), 50% speed, peak = frame 4.
    createSpriteBox({
      char: char(M01, { idle_snack: 9 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_snack",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    // Advance to frame 4 (4 steps after the synchronous frame-0 schedule).
    for (let i = 0; i < 4; i++) sched.step();
    // Frame 4 = peak, not final (final is 8) → base + peak dwell.
    expect(sched.calls[4]).toBe(base + PEAK_DWELL_MS_DEFAULT);
    // Frame 2 = neither peak nor final → plain base.
    expect(sched.calls[2]).toBe(base);
  });

  it("M01 idle_stretch is windowed raise-first (5→10→5), NOT a mid-peak loop (E1-refine)", () => {
    const sched = recordingScheduler();
    // E1-refine: M01 idle_stretch (11 frames) is windowed to [5,10] + pingpong.
    // It must play the rest→up half raise-first, with NO mid-sequence peak dwell
    // (the apex hold is the finalDwell at the window end, not a dwellFrameIndex).
    const handle = createSpriteBox({
      char: char(M01, { idle_stretch: 11 }),
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
    for (let i = 0; i < 6; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    // First frame is the REST frame (5) → raise-first; RAISE 5→10, then LOWER.
    expect(seen).toEqual([5, 6, 7, 8, 9, 10, 9]);
    // Out-of-window frames (the lower-first half 0..4) are NEVER shown.
    expect(seen).not.toContain(0);
    expect(seen).not.toContain(4);
    handle.dispose();
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

// ── E1 (86ca21876): finalDwellMs + playbackMode + startFrame/endFrame window ──
//
// Non-vacuity (revert checklist):
//   - "windowed raise-first": reverting `let frameIdx = winStart` to `= 0` makes
//     the M01 idle_stretch loop start at the apex (lower-first) → the [5,6,7,…]
//     sequence assertion FAILS.
//   - "pingpong turnaround at window ends": reverting `frameIdx === winEnd` /
//     `=== winStart` to `=== lastIndex` / `=== 0` walks outside the window →
//     FAILS.
//   - "loop wrap to winStart": reverting `? winStart` to `? 0` (or `winEnd`)
//     breaks the wrap target → the windowed/loop sequence assertions FAIL.
//   - "finalDwellMs override": dropping the `override.finalDwellMs ?? …` resolve
//     reverts the apex hold to the fixed 400ms → the 800ms assertion FAILS.
//   - "final dwell only on forward arrival": dropping the `direction === 1` gate
//     adds the dwell on the reverse pass → the reverse-pass plain-base
//     assertion FAILS.

/** Extract the numeric frame index from an img src of the form …/frame_<i>.png. */
function frameOf(img: HTMLImageElement): number {
  const m = /frame_(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
  if (!m) throw new Error(`no frame index in src: ${img.getAttribute("src")}`);
  return Number(m[1]);
}

describe("PlaybackOverride — E1 + E1-refine fields resolve (AC1)", () => {
  it("M01 idle_stretch carries pingpong + finalDwellMs + window [5,10]", () => {
    const o = resolvePlayback(M01, "idle_stretch");
    expect(o.playbackMode).toBe("pingpong");
    expect(o.finalDwellMs).toBe(800);
    expect(o.startFrame).toBe(5);
    expect(o.endFrame).toBe(10);
  });

  it("F01 idle_stretch is a plain held loop — no pingpong/window (near-static clip)", () => {
    const o = resolvePlayback(F01, "idle_stretch");
    expect(o.playbackMode).toBeUndefined();
    expect(o.finalDwellMs).toBeUndefined();
    expect(o.startFrame).toBeUndefined();
    expect(o.endFrame).toBeUndefined();
  });

  it("a non-pingpong pose leaves playbackMode/finalDwellMs/window absent (loop default)", () => {
    const o = resolvePlayback(M01, "idle_hips");
    expect(o.playbackMode).toBeUndefined();
    expect(o.finalDwellMs).toBeUndefined();
    expect(o.startFrame).toBeUndefined();
    expect(o.endFrame).toBeUndefined();
  });
});

describe("createSpriteBox — windowed + generic pingpong frame sequence (AC3)", () => {
  it("M01 idle_stretch (11 frames) plays the windowed RAISE-first loop 5→10→5", () => {
    const sched = recordingScheduler();
    const handle = createSpriteBox({
      char: char(M01, { idle_stretch: 11 }),
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
    for (let i = 0; i < 8; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    // RAISE 5→10, then reverse LOWER 10→5, then a second raise begins.
    expect(seen).toEqual([5, 6, 7, 8, 9, 10, 9, 8, 7]);
    // The lower-first half (frames 0..4) is NEVER shown.
    expect(seen).not.toContain(0);
    expect(seen).not.toContain(4);
    handle.dispose();
  });

  it("a generic full-clip 3-frame pingpong (no window) plays 0,1,2,1,0,1,2,1,0", () => {
    const sched = recordingScheduler();
    // Drive a generic pingpong via the injected table so the full-clip
    // oscillation is asserted independent of the idle_stretch window seed.
    const table = {
      [M01]: { idle_yawn: { playbackMode: "pingpong" as const } },
    };
    const handle = createSpriteBox({
      char: char(M01, { idle_yawn: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_yawn",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: table,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    const seen: number[] = [frameOf(img)];
    for (let i = 0; i < 8; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    expect(seen).toEqual([0, 1, 2, 1, 0, 1, 2, 1, 0]);
    handle.dispose();
  });

  it("a generic 2-frame pingpong (no window) oscillates 0,1,0,1", () => {
    const sched = recordingScheduler();
    const table = {
      [M01]: { idle_yawn: { playbackMode: "pingpong" as const } },
    };
    const handle = createSpriteBox({
      char: char(M01, { idle_yawn: 2 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_yawn",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: table,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    const seen: number[] = [frameOf(img)];
    for (let i = 0; i < 4; i++) {
      sched.step();
      seen.push(frameOf(img));
    }
    expect(seen).toEqual([0, 1, 0, 1, 0]);
    handle.dispose();
  });
});

describe("createSpriteBox — finalDwellMs (AC2)", () => {
  it("holds the apex (window end, frame 10) for finalDwellMs (800), not the 400 default", () => {
    const sched = recordingScheduler();
    const base = FRAME_MS_DEFAULT / 0.5; // idle_stretch is also 50% speed
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
    // calls index → frame shown: [0]→5, [1]→6, … [5]→10 (forward arrival, apex).
    for (let i = 0; i < 5; i++) sched.step();
    expect(sched.calls[5]).toBe(base + 800);
    // Prove it is NOT the global 400 default.
    expect(sched.calls[5]).not.toBe(base + DWELL_MS_DEFAULT);
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
  it("does NOT add the final dwell on the reverse pass back through the window end", () => {
    const sched = recordingScheduler();
    const base = FRAME_MS_DEFAULT / 0.5;
    const handle = createSpriteBox({
      char: char(M01, { idle_stretch: 11 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    // Window [5,10]: the windowed sequence is 5,6,7,8,9,10(fwd),9,8,7,6,5,…
    // (proven by the windowed-sequence test above). calls[i] is the ms scheduled
    // while showing the frame at that step.
    //   calls[5] = forward arrival at the window end (frame 10) → +800.
    //   calls[6..10] = the full REVERSE pass (frames 9,8,7,6,5) → plain base.
    // The reverse pass re-enters the window end's neighbourhood without dwelling,
    // which is the Bram gotcha this guards.
    for (let i = 0; i < 11; i++) sched.step();
    expect(sched.calls[5]).toBe(base + 800); // forward arrival at apex → dwell
    expect(sched.calls[6]).toBe(base); // reverse pass frame 9 → plain base
    expect(sched.calls[7]).toBe(base); // reverse pass frame 8 → plain base
    expect(sched.calls[8]).toBe(base); // reverse pass frame 7 → plain base
    expect(sched.calls[9]).toBe(base); // reverse pass frame 6 → plain base
    expect(sched.calls[10]).toBe(base); // reverse arrival at winStart (5) → base
    // No reverse-pass frame leaked the dwell:
    expect(sched.calls.slice(6, 11).every((ms) => ms === base)).toBe(true);
    handle.dispose();
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
