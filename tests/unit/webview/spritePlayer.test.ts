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
} from "../../../src/webview/sprites/spritePlayer.js";
import type { PlaybackOverrideTable } from "../../../src/webview/sprites/spritePlayer.js";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";
import type { SpriteCharacter } from "../../../src/webview/sprites/spriteManifest.js";

const M01 = "ClaudeTeam-M01-Dev";
const F01 = "ClaudeTeam-F01-Dev";
const F02 = "ClaudeTeam-F02-Dev";
const M03 = "ClaudeTeam-M03-Dev";
const M04 = "ClaudeTeam-M04-Dev";
const F03 = "ClaudeTeam-F03-Dev";

// Windowed raise-first stretch config — formerly baked into the 68×68 M01
// manifest (E1-refine 86ca21876). The v3 92×92 M01 (86ca5ed8v) ships a plain
// 50%-speed stretch instead, and no shipped character now carries the windowed
// variant, so the windowing/pingpong/finalDwell ENGINE is exercised via this
// injected playback table — the mechanism is still real and must stay covered.
const STRETCH_WINDOW: Record<string, PlaybackOverrideTable> = {
  [M01]: {
    idle_stretch: {
      speedMultiplier: 0.5,
      startFrame: 5,
      endFrame: 10,
      playbackMode: "pingpong",
      finalDwellMs: 800,
    },
  },
};

// Legacy 14-idle playback shape — formerly baked into the 68×68 F01 manifest
// (PR #205 parked the full speed/peak list on F01 after M01 went v3). The v3
// 92×92 F01 (86ca5j1mt) ships only the 3-pose v3 idle set, so the full-list
// resolution + sequencer ENGINE is now exercised via this injected table — the
// mechanism is still real and must stay covered, decoupled from any shipped
// manifest (same approach as STRETCH_WINDOW above).
const LEGACY_IDLE: Record<string, PlaybackOverrideTable> = {
  [F01]: {
    active_read: { speedMultiplier: 0.5 },
    active_work: { speedMultiplier: 0.5 },
    idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
    idle_snack: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
    idle_stretch: { speedMultiplier: 0.5 },
    idle_phone: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
    idle_hips: { speedMultiplier: 0.5 },
    idle_think: { speedMultiplier: 0.5 },
    idle_arms_crossed: { speedMultiplier: 0.5 },
    idle_pockets: { speedMultiplier: 0.5 },
    idle_neck_roll: { speedMultiplier: 0.5 },
    idle_yawn: { speedMultiplier: 0.5 },
    idle_watch: { speedMultiplier: 0.5 },
    idle_headphones: { speedMultiplier: 0.7 },
    // idle_wave intentionally absent → resolves to {} (no override).
  },
};

// Engine-contract fixture for the createSpriteBox sequencer tests that drive an
// M01 synthetic character. These tests assert the ENGINE's dwell/composition
// math (peak+final dwell, out-of-range peak, active-no-dwell) on a known
// 50%-speed config — they must NOT read the SHIPPED M01 manifest, whose values
// the sponsor retunes freely in the Playback Tuner (PR #210 changed idle_coffee
// to speed 1.1 + dwellFrameIndex 0 + window, breaking the old implicit-read
// assumption). Injecting this table keeps the math deterministic + tuning-proof.
const M01_ENGINE: Record<string, PlaybackOverrideTable> = {
  [M01]: {
    idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
    active_work: { speedMultiplier: 0.5 },
  },
};

/** Build a synthetic character with N-frame anims for the named poses. */
function char(name: string, frameCounts: Record<string, number>): SpriteCharacter {
  const animations: SpriteCharacter["animations"] = {};
  for (const [anim, n] of Object.entries(frameCounts)) {
    animations[anim] = {
      folder: anim,
      frames: Array.from({ length: n }, (_, i) => `${name}/${anim}/frame_${i}.png`),
    };
  }
  const ACTIVE_POOL_NAMES = ["typing", "work_cycle", "work_focus"];
  return {
    character: name,
    defaultIdle: "idle_coffee",
    idlePool: Object.keys(frameCounts).filter((k) => k.startsWith("idle_")),
    activePool: Object.keys(frameCounts).filter((k) =>
      ACTIVE_POOL_NAMES.includes(k),
    ),
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
  // Every shipped character (F01/F02/M01/M03) is now the v3 92×92 build carrying
  // only the 3-pose v3 idle set + actives, all at 50% speed. The legacy 14-idle
  // layout is no longer on any shipped manifest, so the full speed list is
  // asserted against the injected LEGACY_IDLE table (engine still real).
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
  ])("%s plays at 50%% speed (legacy full idle set, injected)", (anim) => {
    expect(resolvePlayback(F01, anim, LEGACY_IDLE).speedMultiplier).toBe(0.5);
  });

  // The v3 M01 idle/active speeds are SPONSOR-TUNED in the live manifest
  // (Playback Tuner 2026-06-12, PR #210) and will keep changing — pinning them
  // to a fixed number couples this engine test to live tuning data. The ENGINE
  // contract under test ("resolvePlayback returns the per-char speedMultiplier
  // verbatim") is asserted against the injected M01_SPEED fixture instead so a
  // future retune can never break it (same decoupling as LEGACY_IDLE above).
  const M01_SPEED: Record<string, PlaybackOverrideTable> = {
    [M01]: {
      active_read: { speedMultiplier: 0.5 },
      active_work: { speedMultiplier: 0.5 },
      idle_coffee: { speedMultiplier: 0.5 },
      idle_stretch: { speedMultiplier: 0.5 },
      idle_think: { speedMultiplier: 0.5 },
    },
  };
  it.each([
    "active_read",
    "active_work",
    "idle_coffee",
    "idle_stretch",
    "idle_think",
  ])("%s resolves the per-char speedMultiplier verbatim (injected M01 fixture)", (anim) => {
    expect(resolvePlayback(M01, anim, M01_SPEED).speedMultiplier).toBe(0.5);
  });

  it("idle_headphones plays at 70% speed (legacy, injected)", () => {
    expect(resolvePlayback(F01, "idle_headphones", LEGACY_IDLE).speedMultiplier).toBe(0.7);
  });

  it("idle_wave is unchanged (no override) (legacy, injected)", () => {
    expect(resolvePlayback(F01, "idle_wave", LEGACY_IDLE)).toEqual({});
  });

  it("an unknown anim or character resolves to the default (empty) override", () => {
    expect(resolvePlayback(M01, "idle_does_not_exist")).toEqual({});
    expect(resolvePlayback("ClaudeTeam-Z99-Dev", "idle_coffee")).toEqual({});
  });
});

describe("resolvePlayback — peak-frame dwell indices (character-specific)", () => {
  it("coffee/snack/phone peak at frame 4 (legacy full idle set, injected)", () => {
    expect(resolvePlayback(F01, "idle_coffee", LEGACY_IDLE).dwellFrameIndex).toBe(4);
    expect(resolvePlayback(F01, "idle_snack", LEGACY_IDLE).dwellFrameIndex).toBe(4);
    expect(resolvePlayback(F01, "idle_phone", LEGACY_IDLE).dwellFrameIndex).toBe(4);
  });

  // ENGINE CONTRACT — "resolvePlayback returns the per-char dwellFrameIndex
  // verbatim, alongside the speed" — asserted against an injected fixture so the
  // sponsor's live M01 tuning (PR #210, which moved idle_coffee's apex off frame
  // 4 and gave it a window) can never break it. The "does the SHIPPED manifest
  // carry sane playback?" question is covered by the data-following manifest test
  // below (it reads the value off the manifest, not a frozen constant).
  const M01_PEAK: Record<string, PlaybackOverrideTable> = {
    [M01]: {
      idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
      idle_stretch: { speedMultiplier: 0.5 },
    },
  };

  it("a mid-peak idle resolves its dwellFrameIndex verbatim (injected M01 fixture)", () => {
    expect(resolvePlayback(M01, "idle_coffee", M01_PEAK).dwellFrameIndex).toBe(4);
  });

  it("a plain-loop idle resolves with no window/pingpong/peak (injected M01 fixture)", () => {
    const m = resolvePlayback(M01, "idle_stretch", M01_PEAK);
    expect(m.speedMultiplier).toBe(0.5);
    expect(m.startFrame).toBeUndefined();
    expect(m.endFrame).toBeUndefined();
    expect(m.playbackMode).toBeUndefined();
    expect(m.dwellFrameIndex).toBeUndefined();
  });

  it("a peak pose retains its speed alongside the dwell (injected M01 fixture)", () => {
    const o = resolvePlayback(M01, "idle_coffee", M01_PEAK);
    expect(o.speedMultiplier).toBe(0.5);
    expect(o.dwellFrameIndex).toBe(4);
  });

  it("a non-peak speed pose carries speed only (no dwellFrameIndex) (legacy, injected)", () => {
    expect(resolvePlayback(F01, "idle_hips", LEGACY_IDLE).dwellFrameIndex).toBeUndefined();
    expect(resolvePlayback(F01, "idle_hips", LEGACY_IDLE).speedMultiplier).toBe(0.5);
  });

  it("the generated manifest carries playback for the harvested characters (E2 — map removed)", () => {
    // The former hardcoded PLAYBACK_OVERRIDES map was migrated INTO each
    // character's animations.json + baked into GENERATED_SPRITE_MANIFEST (E2).
    // resolvePlayback reads the manifest by default — assert the characters'
    // playback survived the migration as the new source of truth. F02 (86ca5aczf)
    // joined the manifest as the first v3 92×92 persona; M03 (86ca5at8f) as the second;
    // M01 (86ca5ed8v) was overwritten in place by the v3 92×92 build; M04 + F03
    // (86ca8r4jc) are the latest v3 chars wired into the picker.
    expect(Object.keys(GENERATED_SPRITE_MANIFEST.characters).sort()).toEqual([
      F01,
      F02,
      F03,
      M01,
      M03,
      M04,
    ]);
    // The PLAYBACK VALUES are SPONSOR-TUNED in the live Playback Tuner (PR #210)
    // and change freely — so assert the migration SHAPE (a playback block exists
    // and carries a valid speedMultiplier), NOT a frozen tuning constant, so a
    // retune can't break this. The end-to-end "tuned value → resolvePlayback"
    // round-trip is data-following in NO-REGRESSION below.
    for (const c of [F01, M01]) {
      const pb = GENERATED_SPRITE_MANIFEST.characters[c].animations.idle_stretch.playback;
      expect(pb).toBeDefined();
      expect(typeof pb?.speedMultiplier).toBe("number");
      expect(pb?.speedMultiplier).toBeGreaterThan(0);
    }
  });
});

describe("createSpriteBox — speed-scaled per-frame ms", () => {
  it("a 50% pose holds each frame for 2× the default ms", () => {
    const sched = recordingScheduler();
    createSpriteBox({
      char: char(F01, { idle_hips: 4 }), // idle_hips = 50% speed, no peak (legacy idle, injected)
      state: "idle",
      activity: "idle 10s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_hips", // stickiness: keep this pick
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: LEGACY_IDLE,
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
      char: char(F01, { idle_snack: 9 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_snack",
      rng: () => 0,
      playbackTable: LEGACY_IDLE,
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

  it("a windowed stretch override plays raise-first (5→10→5), NOT a mid-peak loop (E1-refine)", () => {
    const sched = recordingScheduler();
    // The windowed raise-first stretch (11 frames, windowed to [5,10] + pingpong)
    // plays the rest→up half raise-first, with NO mid-sequence peak dwell (the
    // apex hold is the finalDwell at the window end, not a dwellFrameIndex). Driven
    // via the injected STRETCH_WINDOW table — the v3 M01 manifest no longer bakes it.
    const handle = createSpriteBox({
      char: char(M01, { idle_stretch: 11 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_stretch",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: STRETCH_WINDOW,
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
    // Injected M01_ENGINE fixture (50% speed, idle_coffee peak 4) — decoupled
    // from the sponsor-tuned live M01 manifest so the engine math stays pinned.
    createSpriteBox({
      char: char(M01, { idle_coffee: 5 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: M01_ENGINE,
    });
    const base = FRAME_MS_DEFAULT / 0.5;
    for (let i = 0; i < 4; i++) sched.step();
    // Frame 4 = peak AND final → base + final dwell + peak dwell (both apply).
    expect(sched.calls[4]).toBe(base + DWELL_MS_DEFAULT + PEAK_DWELL_MS_DEFAULT);
  });

  it("ignores an out-of-range peak index without breaking the loop", () => {
    const sched = recordingScheduler();
    // Coffee with only 3 frames — peak index 4 is out of range; loop must run
    // at plain base speed with no dwell crash. Injected fixture (peak 4).
    createSpriteBox({
      char: char(M01, { idle_coffee: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: M01_ENGINE,
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
    // active_work: 50% speed, no peak, no final dwell (injected M01_ENGINE).
    createSpriteBox({
      char: char(M01, { active_work: 5 }),
      state: "running",
      activity: "tool:Edit x",
      spriteBaseUri: "base",
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: M01_ENGINE,
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
  it("a windowed override carries pingpong + finalDwellMs + window [5,10]", () => {
    const o = resolvePlayback(M01, "idle_stretch", STRETCH_WINDOW);
    expect(o.playbackMode).toBe("pingpong");
    expect(o.finalDwellMs).toBe(800);
    expect(o.startFrame).toBe(5);
    expect(o.endFrame).toBe(10);
  });

  // The SHIPPED M01/F01 idle_stretch stays a plain LOOP (no pingpong, no frame
  // window) — that part is the structural contract this guards. The sponsor MAY
  // tune a final-frame dwell / peak / speed on it via the Playback Tuner (PR
  // #210 added finalDwellMs), so those scalar fields are NOT asserted absent
  // here — only the loop STRUCTURE (no playbackMode / startFrame / endFrame),
  // which is what makes it a plain wrap-loop rather than a windowed pingpong.
  it("v3 M01 idle_stretch is a plain loop — no pingpong/window (manifest)", () => {
    const o = resolvePlayback(M01, "idle_stretch");
    expect(o.playbackMode).toBeUndefined();
    expect(o.startFrame).toBeUndefined();
    expect(o.endFrame).toBeUndefined();
  });

  it("F01 idle_stretch is a plain loop — no pingpong/window (near-static clip)", () => {
    const o = resolvePlayback(F01, "idle_stretch");
    expect(o.playbackMode).toBeUndefined();
    expect(o.startFrame).toBeUndefined();
    expect(o.endFrame).toBeUndefined();
  });

  it("a non-pingpong pose leaves playbackMode/finalDwellMs/window absent (loop default)", () => {
    const o = resolvePlayback(F01, "idle_hips");
    expect(o.playbackMode).toBeUndefined();
    expect(o.finalDwellMs).toBeUndefined();
    expect(o.startFrame).toBeUndefined();
    expect(o.endFrame).toBeUndefined();
  });
});

describe("createSpriteBox — windowed + generic pingpong frame sequence (AC3)", () => {
  it("a windowed stretch override (11 frames) plays the RAISE-first loop 5→10→5", () => {
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
      playbackTable: STRETCH_WINDOW,
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
      playbackTable: STRETCH_WINDOW,
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
      char: char(F01, { idle_hips: 3 }),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_hips",
      rng: () => 0,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
      playbackTable: LEGACY_IDLE,
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
      playbackTable: STRETCH_WINDOW,
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

describe("resolvePlayback — MANIFEST-FED resolution (E2 86ca2187g, AC3)", () => {
  // Build a minimal manifest in the production GeneratedSpriteManifest shape
  // (anim entries carrying an optional `playback` field). Mutating these values
  // must change the resolver output → non-vacuous.
  const synthManifest = {
    characters: {
      "Synth-A": {
        character: "Synth-A",
        defaultIdle: "idle_x",
        idlePool: ["idle_x"],
        activePool: [],
        animations: {
          idle_x: {
            folder: "f",
            frames: ["a/f/0.png"],
            playback: { speedMultiplier: 0.5, playbackMode: "pingpong" as const, finalDwellMs: 700 },
          },
          idle_plain: { folder: "g", frames: ["a/g/0.png"] }, // no playback
        },
      },
    },
  };

  it("reads the playback override off the manifest anim entry", () => {
    const o = resolvePlayback("Synth-A", "idle_x", synthManifest);
    expect(o).toEqual({ speedMultiplier: 0.5, playbackMode: "pingpong", finalDwellMs: 700 });
  });

  it("mutation-check: changing the manifest playback changes the result (non-vacuous)", () => {
    const mutated = {
      characters: {
        "Synth-A": {
          ...synthManifest.characters["Synth-A"],
          animations: {
            ...synthManifest.characters["Synth-A"].animations,
            idle_x: {
              folder: "f",
              frames: ["a/f/0.png"],
              playback: { speedMultiplier: 0.9 as number },
            },
          },
        },
      },
    };
    expect(resolvePlayback("Synth-A", "idle_x", mutated).speedMultiplier).toBe(0.9);
  });

  it("an anim with no manifest playback → empty override (default behavior)", () => {
    expect(resolvePlayback("Synth-A", "idle_plain", synthManifest)).toEqual({});
  });

  it("unknown character / anim → empty override", () => {
    expect(resolvePlayback("Nope", "idle_x", synthManifest)).toEqual({});
    expect(resolvePlayback("Synth-A", "nope", synthManifest)).toEqual({});
  });

  // ── E3 (86ca2187n): 3-layer field-level pose-default cascade ──────────────
  //
  // Non-vacuity (revert checklist):
  //   - "AC1 pose-default applies to all chars": dropping the `...poseDefault`
  //     spread reverts to per-char-only → the no-per-char-entry char resolves to
  //     {} and the AC1 assertion FAILS.
  //   - "AC2 field-level merge": reverting `{ ...poseDefault, ...perChar }` to a
  //     whole-object pick (perChar ?? poseDefault) drops the inherited fields →
  //     the inherit-mode-from-default assertion FAILS.
  //   - "AC4 precedence": swapping the spread order (perChar first) lets the
  //     pose-default win → the per-char-wins assertion FAILS.
  describe("E3 — 3-layer field-level pose-default cascade (AC1/AC2/AC4)", () => {
    // Manifest with a pose-default for idle_stretch + two characters: one with a
    // per-char override on idle_stretch (speed-only), one with NONE.
    const cascadeManifest = {
      poseDefaults: {
        idle_stretch: { playbackMode: "pingpong" as const, finalDwellMs: 800 },
        idle_coffee: { speedMultiplier: 0.5 },
      },
      characters: {
        "Has-PerChar": {
          character: "Has-PerChar",
          defaultIdle: "idle_stretch",
          idlePool: ["idle_stretch"],
          activePool: [],
          animations: {
            // per-char sets ONLY speedMultiplier → must inherit mode + dwell.
            idle_stretch: {
              folder: "f",
              frames: ["a/0.png"],
              playback: { speedMultiplier: 0.7 as number },
            },
            // per-char OVERRIDES a field the pose-default also sets.
            idle_coffee: {
              folder: "g",
              frames: ["a/0.png"],
              playback: { speedMultiplier: 0.9 as number },
            },
          },
        },
        "No-PerChar": {
          character: "No-PerChar",
          defaultIdle: "idle_stretch",
          idlePool: ["idle_stretch"],
          activePool: [],
          animations: {
            // NO playback at all → pose-default is the whole result.
            idle_stretch: { folder: "f", frames: ["a/0.png"] },
            idle_plain: { folder: "h", frames: ["a/0.png"] },
          },
        },
      },
    };

    it("AC1: a pose-default applies to a character with NO per-char edit", () => {
      expect(resolvePlayback("No-PerChar", "idle_stretch", cascadeManifest)).toEqual({
        playbackMode: "pingpong",
        finalDwellMs: 800,
      });
    });

    it("AC2: a per-char speed-only override INHERITS mode + dwell from the pose-default (field-level)", () => {
      // speedMultiplier from per-char; playbackMode + finalDwellMs from pose-default.
      expect(resolvePlayback("Has-PerChar", "idle_stretch", cascadeManifest)).toEqual({
        speedMultiplier: 0.7,
        playbackMode: "pingpong",
        finalDwellMs: 800,
      });
    });

    it("AC4: per-char field WINS over a pose-default field of the same name (precedence)", () => {
      // Both layers set speedMultiplier; per-char (0.9) must win over default (0.5).
      expect(resolvePlayback("Has-PerChar", "idle_coffee", cascadeManifest).speedMultiplier).toBe(0.9);
    });

    it("AC4: pose-default fills a field the per-char layer omits (engine default is the floor)", () => {
      // No-PerChar idle_coffee has no per-char entry → pose-default speed 0.5;
      // a field NEITHER layer sets (playbackMode) stays absent (engine default).
      const o = resolvePlayback("No-PerChar", "idle_coffee", cascadeManifest);
      expect(o.speedMultiplier).toBe(0.5);
      expect(o.playbackMode).toBeUndefined();
    });

    it("an anim with no pose-default AND no per-char entry → empty override (engine default)", () => {
      expect(resolvePlayback("No-PerChar", "idle_plain", cascadeManifest)).toEqual({});
    });

    it("an anim with a per-char entry but NO pose-default → per-char only (E2-equivalent)", () => {
      const noPoseDefault = {
        characters: cascadeManifest.characters,
        poseDefaults: { idle_stretch: { playbackMode: "pingpong" as const } },
      };
      // idle_coffee has a per-char entry on Has-PerChar but no pose-default here.
      expect(resolvePlayback("Has-PerChar", "idle_coffee", noPoseDefault)).toEqual({
        speedMultiplier: 0.9,
      });
    });

    it("AC3: a manifest with NO poseDefaults key resolves exactly as E2 (per-char only)", () => {
      const e2Shape = { characters: cascadeManifest.characters };
      expect(resolvePlayback("Has-PerChar", "idle_stretch", e2Shape)).toEqual({
        speedMultiplier: 0.7,
      });
      expect(resolvePlayback("No-PerChar", "idle_stretch", e2Shape)).toEqual({});
    });

    it("the flat injected playbackTable form has NO pose-default layer (sequencer-test contract)", () => {
      // The flat form is used by createSpriteBox sequencer tests; it must return
      // the per-char entry verbatim with no merge so those tests stay unaffected.
      const flat = { "Some-Char": { idle_yawn: { playbackMode: "pingpong" as const } } };
      expect(resolvePlayback("Some-Char", "idle_yawn", flat)).toEqual({ playbackMode: "pingpong" });
    });
  });

  it("NO-REGRESSION: resolvePlayback returns each char's BAKED manifest playback (data-following)", () => {
    // Each character's playback lives in its animations.json, baked into
    // GENERATED_SPRITE_MANIFEST; resolvePlayback's DEFAULT source is that manifest
    // (poseDefaults is absent on the live manifest, so the resolved override is
    // the per-char block verbatim). The sponsor RETUNES these values freely in the
    // Playback Tuner (PR #210), so this test FOLLOWS THE DATA rather than freezing
    // a constant: for each shipped char/anim, resolvePlayback must equal the
    // manifest's own `animations[anim].playback` block. That pins the RESOLVER
    // WIRING (reads the baked manifest, per-char verbatim) without breaking on the
    // next retune — exactly the decoupling the brief calls for.
    for (const c of [M01, F01]) {
      for (const a of ["idle_stretch", "idle_coffee", "idle_think", "active_work"]) {
        const baked =
          GENERATED_SPRITE_MANIFEST.characters[c].animations[a]?.playback ?? {};
        expect(resolvePlayback(c, a, GENERATED_SPRITE_MANIFEST)).toEqual(baked);
        // The default arg (no 3rd param) resolves identically to the explicit manifest.
        expect(resolvePlayback(c, a)).toEqual(baked);
      }
    }
    // The retired legacy F01 idle_headphones (70%) is preserved via the injected table.
    expect(
      resolvePlayback(F01, "idle_headphones", LEGACY_IDLE).speedMultiplier,
    ).toBe(0.7);
  });
});

// ── Active-work POOL + episode stickiness (ticket 86ca3mge9) ────────────────
//
// Mirrors the idle-pool stickiness: running + tool != Read draws ONE working
// anim per ACTIVE episode and loops it; it only re-rolls on a fresh active
// episode (idle→active). `active_read` (tool == Read) is never pool-drawn.
//
// Non-vacuity (revert checklist):
//   - drop the `else { activePick = ... }` branch in createSpriteBox → running
//     tiles always resolve active_work → the "renders a pool member" + "sticky"
//     assertions FAIL.
//   - remove the freshActiveEpisode re-roll guard (always keep priorActivePick)
//     → the "re-rolls on a fresh active episode" assertion FAILS.
//   - remove the active_read null-out → the "active_read reports null pick"
//     assertion FAILS.
describe("createSpriteBox — active_work pool + episode stickiness (86ca3mge9)", () => {
  const ACTIVE = { typing: 2, work_cycle: 2, work_focus: 2, active_work: 2, active_read: 2 };

  it("running + tool!=Read starts at activePool[0] IN ORDER (rotation, 86ca4atwt)", () => {
    // 86ca4atwt: the active pool now ROTATES IN ORDER (no longer a random draw).
    // A fresh active episode starts at activePool[0] = typing regardless of rng.
    const h = createSpriteBox({
      char: char(M01, ACTIVE),
      state: "running",
      activity: "tool:Edit reducer.ts",
      spriteBaseUri: "base",
      rng: () => 0.5, // rng no longer selects the active pool member
      scheduleFrame: recordingScheduler().schedule,
      cancelFrame: () => undefined,
    });
    expect(h.isActive).toBe(true);
    expect(h.activePick).toBe("typing");
    expect(h.pose).toBe("typing");
    expect(h.activeRotIdx).toBe(0);
  });

  it("the picked pose is always a declared active-pool member (membership)", () => {
    const pool = ["typing", "work_cycle", "work_focus"];
    for (let i = 0; i < 30; i++) {
      const h = createSpriteBox({
        char: char(M01, ACTIVE),
        state: "running",
        activity: "tool:Bash echo",
        spriteBaseUri: "base",
        rng: () => i / 30,
        scheduleFrame: recordingScheduler().schedule,
        cancelFrame: () => undefined,
      });
      expect(pool).toContain(h.activePick);
    }
  });

  it("resumes the rotation cursor across re-renders within an episode (86ca4atwt)", () => {
    // 86ca4atwt: the prior render was active at cursor 2 (work_focus); this
    // re-render must RESUME the cursor (mid-episode), playing activePool[2] — NOT
    // snap back to [0] (typing).
    const h = createSpriteBox({
      char: char(M01, ACTIVE),
      state: "running",
      activity: "tool:Edit reducer.ts",
      spriteBaseUri: "base",
      priorWasActive: true,
      priorActiveRotIdx: 2,
      priorActiveLoopCount: 0,
      rng: () => 0, // rng is irrelevant to the active rotation cursor
      scheduleFrame: recordingScheduler().schedule,
      cancelFrame: () => undefined,
    });
    expect(h.activePick).toBe("work_focus");
    expect(h.activeRotIdx).toBe(2);
  });

  it("resets rotation to activePool[0] on a fresh active episode (idle→active)", () => {
    // 86ca4atwt: prior render was IDLE (priorWasActive false) → fresh active
    // episode → rotation restarts at activePool[0] = typing, ignoring the stale
    // cursor.
    const h = createSpriteBox({
      char: char(M01, ACTIVE),
      state: "running",
      activity: "tool:Edit reducer.ts",
      spriteBaseUri: "base",
      priorWasActive: false,
      priorActiveRotIdx: 2, // stale; must be ignored on a fresh episode
      rng: () => 0,
      scheduleFrame: recordingScheduler().schedule,
      cancelFrame: () => undefined,
    });
    expect(h.activePick).toBe("typing");
    expect(h.activeRotIdx).toBe(0);
  });

  it("tool==Read renders active_read and reports a null active pick", () => {
    const h = createSpriteBox({
      char: char(M01, ACTIVE),
      state: "running",
      activity: "tool:Read src/x.ts",
      spriteBaseUri: "base",
      priorWasActive: true,
      priorActivePick: "work_cycle",
      rng: () => 0,
      scheduleFrame: recordingScheduler().schedule,
      cancelFrame: () => undefined,
    });
    expect(h.pose).toBe("active_read");
    expect(h.activePick).toBeNull();
  });

  it("falls back to active_work when the character has no active pool", () => {
    const h = createSpriteBox({
      char: char(M01, { active_work: 2, active_read: 2 }), // empty activePool
      state: "running",
      activity: "tool:Edit reducer.ts",
      spriteBaseUri: "base",
      rng: () => 0,
      scheduleFrame: recordingScheduler().schedule,
      cancelFrame: () => undefined,
    });
    expect(h.pose).toBe("active_work");
    expect(h.activePick).toBeNull();
  });
});
