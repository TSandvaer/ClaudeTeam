/**
 * @vitest-environment jsdom
 *
 * Windowed-pingpong + mid-clip apex-dwell regression coverage (E1 86ca21876).
 *
 * Companion to spritePlayer.test.ts. Kept as a separate file because the sibling
 * carries box-drawing comment chars that the current edit tooling cannot
 * exact-match against. The sibling already covers the M01 idle_stretch [5,10]
 * window + 800ms apex dwell + the forward-only "Bram gotcha"; this file adds an
 * independent driver and a STRONGER mid-clip apex probe (window [3,7] where the
 * window end is NOT the clip's last frame, so the reverse pass genuinely travels
 * back through the end frame).
 *
 * NON-VACUITY (mutation-verified 2026-05-31 against spritePlayer.ts):
 *  - "windowed-pingpong full cycle": FAILS if the turnaround keys off the global
 *    lastIndex/0 instead of winEnd/winStart (mutation: reverse-at-lastIndex /
 *    forward-at-0 lets the lower pass run past winStart down to frame 0). Proven:
 *    under that mutation `Tests 1 failed | 3 passed`.
 *  - "loop + no window byte-identical": FAILS if windowing changes the historic
 *    +1/wrap-to-0 advance (this assertion is what the windowed-cycle test relies
 *    on for the loop-mode branch).
 *
 * NOTE on the `direction === 1` guard at winEnd: the `apex dwell at a MID-clip
 * endFrame` test below asserts the dwell lands at the right frame/ms, but it is
 * NOT a non-vacuity probe for the `direction === 1` guard. Verified by mutation:
 * dropping that guard does NOT fail any test here, because in pingpong the window
 * END frame is rendered exactly ONCE per oscillation and always on the forward
 * arrival (the advance flips direction AT winEnd then steps inward, so winEnd is
 * never re-rendered descending — trace [3,7]: 3,4,5,6,7,6,5,4,3,…). The guard is
 * therefore redundant for the `finalDwellMs` dwell specifically; it only governs
 * a hypothetical mid-window dwell. The apex test stays as a placement/magnitude
 * assertion, not a guard-mutation probe.
 */
import { describe, it, expect } from "vitest";
import {
  createSpriteBox,
  FRAME_MS_DEFAULT,
  type PlaybackOverride,
  type PlaybackOverrideTable,
} from "../../../src/webview/sprites/spritePlayer.js";

interface Driver {
  idx: number[];
  ms: number[];
}

/**
 * Drive createSpriteBox for an idle tile whose idle pick is `idle_stretch`, with
 * the given override and frame count, stepping the injected scheduler `steps`
 * times. Returns the frame index shown and the ms scheduled at each step.
 */
function driveSequence(
  override: PlaybackOverride,
  frameCount: number,
  steps: number,
): Driver {
  const char = {
    character: "TEST-CHAR",
    defaultIdle: "idle_stretch",
    idlePool: ["idle_stretch"],
    activePool: [],
    animations: {
      idle_stretch: {
        folder: "idle_stretch",
        frames: Array.from({ length: frameCount }, (_, i) => `f${i}.png`),
      },
    },
  };
  const table: Record<string, PlaybackOverrideTable> = {
    "TEST-CHAR": { idle_stretch: override },
  };
  const idx: number[] = [];
  const ms: number[] = [];
  let pending: (() => void) | null = null;
  let nextMs = 0;
  const schedule = (cb: () => void, m: number): number => {
    pending = cb;
    nextMs = m;
    return 1;
  };
  const handle = createSpriteBox({
    char,
    state: "idle",
    activity: "idle 30s",
    spriteBaseUri: "base",
    priorIdlePick: "idle_stretch",
    rng: () => 0,
    scheduleFrame: schedule,
    cancelFrame: () => undefined,
    playbackTable: table,
  });
  const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
  const readIdx = (): number => {
    const m = /f(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
    return m ? Number(m[1]) : -1;
  };
  for (let i = 0; i < steps; i++) {
    idx.push(readIdx());
    ms.push(nextMs);
    // `pending` is reassigned indirectly inside the `schedule` closure that
    // createSpriteBox invokes, which TS control-flow analysis can't see — it
    // narrows `pending` to `null` (then `never` after the guard). Read through a
    // typed local to defeat the over-narrowing without weakening any real types.
    const cb = pending as (() => void) | null;
    pending = null;
    if (!cb) break;
    cb();
  }
  handle.dispose();
  return { idx, ms };
}

describe("spritePlayer windowed pingpong (E1 86ca21876)", () => {
  it("windowed-pingpong full cycle over [5,10]: raise -> apex -> lower -> restart, never escaping the window", () => {
    const { idx } = driveSequence(
      { startFrame: 5, endFrame: 10, playbackMode: "pingpong", finalDwellMs: 800 },
      11,
      22,
    );
    expect(idx).toEqual([
      5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 6, 7, 8, 9, 10, 9, 8, 7, 6, 5, 6,
    ]);
    expect(Math.min(...idx)).toBe(5);
    expect(Math.max(...idx)).toBe(10);
  });

  it("apex finalDwell lands at the MID-clip endFrame with the right magnitude (placement assertion)", () => {
    // Window [3,7] on an 11-frame clip: endFrame(7) is NOT the clip's last frame.
    // This asserts the dwell magnitude (frameMs + finalDwellMs) lands on the
    // endFrame render and nowhere else. It is NOT a `direction === 1` guard probe
    // (see the file header: winEnd is rendered once per oscillation, always
    // ascending, so the guard is redundant for the finalDwellMs dwell).
    const { idx, ms } = driveSequence(
      {
        startFrame: 3,
        endFrame: 7,
        playbackMode: "pingpong",
        finalDwellMs: 500,
        speedMultiplier: 0.5,
      },
      11,
      18,
    );
    const frameMs = FRAME_MS_DEFAULT / 0.5; // 320
    const apexHold = frameMs + 500; // 820
    idx.forEach((frame, i) => {
      const ascendingArrival = frame === 7 && idx[i - 1] === 6;
      if (ascendingArrival) {
        expect(ms[i]).toBe(apexHold); // forward arrival at window end -> long hold
      } else {
        expect(ms[i]).toBe(frameMs); // everything else, incl. reverse pass, base
      }
    });
    const holds = ms.filter((m) => m === apexHold).length;
    const ascendingArrivals = idx.filter((f, i) => f === 7 && idx[i - 1] === 6).length;
    expect(holds).toBe(ascendingArrivals);
    expect(holds).toBeGreaterThan(0);
  });

  it("loop mode + no window stays byte-identical to historic +1/wrap-to-0", () => {
    const { idx } = driveSequence({ playbackMode: "loop" }, 4, 10);
    expect(idx).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  });

  it("absent playbackMode (default) also loops +1/wrap-to-0 over the full clip", () => {
    const { idx } = driveSequence({}, 4, 10);
    expect(idx).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
  });
});

/**
 * Apex-dwell at frame 0 — and the window-exclusion bug (86ca2w1g9).
 *
 * SPONSOR SYMPTOM: M01 idle_stretch (baked window [5,10], pingpong, finalDwell)
 * + a draft Apex frame=0 / hold=9100ms produced NO apex pause — only the
 * finalDwell at frame 10 fired. ROOT CAUSE: the engine's apex guard validated
 * dwellFrameIndex against the FULL clip [0, lastIndex], but the loop only renders
 * frames in the active window [winStart, winEnd]; frame 0 is outside [5,10] so
 * `frameIdx === peakIndex` never became true and the dwell silently did nothing.
 * FIX: validate the apex against [winStart, winEnd] — a within-window apex fires,
 * an out-of-window apex is correctly NOT armed (and the tuner constrains its
 * frame picker to the window so the sponsor can only pick a reachable apex).
 *
 * NON-VACUITY (mutation-verified 2026-06-01 against spritePlayer.ts — mutating
 * the guard's lower bound `peakIndex >= winStart` to `peakIndex > winStart`
 * fails the first three tests below; this is the exact off-by-one the orchestrator
 * flagged — winStart must be an INCLUSIVE, valid apex):
 *  - "frame-0 apex dwells (loop, no window)" + "(pingpong, no window)": FAIL under
 *    `> winStart` (winStart=0 → frame 0 dropped) — also fails any truthiness guard
 *    `peakIndex && …` / `peakIndex > 0`. Frame 0 would get only the base ms.
 *  - "within-window apex (winStart=5) dwells": FAIL under `> winStart` — frame 5
 *    (the window start, the arms-down rest of the rest→up slice) would not arm.
 *  - "out-of-window apex does NOT dwell": the apex (frame 0) is outside [5,10] so
 *    it is never RENDERED regardless of the guard, so this assertion alone is
 *    guard-insensitive; non-vacuity comes from the COMPANION assertion that the
 *    within-window finalDwell at winEnd STILL fires (proves the loop actually ran)
 *    PLUS the picker-side test in playbackTunerApexWindow.test.ts (the picker is
 *    the real fix — it prevents the sponsor from ever selecting an unreachable
 *    apex; mutating its window-bound back to the full clip fails that test).
 */
describe("spritePlayer apex dwell at frame 0 + window exclusion (86ca2w1g9)", () => {
  it("frame-0 apex dwells in LOOP mode with no window", () => {
    // 5-frame clip, loop, apex frame 0 hold 9100. finalDwellMs:0 isolates the
    // apex hold from the final-frame idle dwell. Frame 0 must carry base+9100.
    const { idx, ms } = driveSequence(
      { playbackMode: "loop", dwellFrameIndex: 0, dwellMs: 9100, finalDwellMs: 0 },
      5,
      12,
    );
    idx.forEach((frame, i) => {
      if (frame === 0) {
        expect(ms[i]).toBe(FRAME_MS_DEFAULT + 9100);
      } else {
        expect(ms[i]).toBe(FRAME_MS_DEFAULT);
      }
    });
    // Frame 0 was actually rendered (guard against a vacuous all-pass).
    expect(idx).toContain(0);
    expect(ms.filter((m) => m === FRAME_MS_DEFAULT + 9100).length).toBeGreaterThan(0);
  });

  it("frame-0 apex dwells in PINGPONG mode with no window (start AND reverse arrival)", () => {
    // 11-frame clip, pingpong, apex 0 hold 9100. finalDwellMs:0 so the only long
    // hold is the apex. Frame 0 is the pingpong start and the reverse-turnaround
    // — both renders must carry the apex hold.
    const { idx, ms } = driveSequence(
      { playbackMode: "pingpong", dwellFrameIndex: 0, dwellMs: 9100, finalDwellMs: 0 },
      11,
      24,
    );
    idx.forEach((frame, i) => {
      if (frame === 0) expect(ms[i]).toBe(FRAME_MS_DEFAULT + 9100);
    });
    const apexHolds = ms.filter((m) => m === FRAME_MS_DEFAULT + 9100).length;
    const frameZeroRenders = idx.filter((f) => f === 0).length;
    expect(apexHolds).toBe(frameZeroRenders);
    expect(apexHolds).toBeGreaterThan(0);
  });

  it("within-window apex (winStart) dwells under a [5,10] pingpong window", () => {
    // Apex at the window START (5) — reachable, must fire. Validates the
    // window-aware guard arms an apex inside the window even when winStart>0.
    const { idx, ms } = driveSequence(
      {
        startFrame: 5,
        endFrame: 10,
        playbackMode: "pingpong",
        dwellFrameIndex: 5,
        dwellMs: 9100,
      },
      11,
      22,
    );
    idx.forEach((frame, i) => {
      if (frame === 5) expect(ms[i]).toBe(FRAME_MS_DEFAULT + 9100);
    });
    expect(ms.filter((m) => m === FRAME_MS_DEFAULT + 9100).length).toBeGreaterThan(0);
    // The loop never escaped the window.
    expect(Math.min(...idx)).toBe(5);
    expect(Math.max(...idx)).toBe(10);
  });

  it("out-of-window apex (frame 0) does NOT dwell under a [5,10] window — the sponsor's exact config", () => {
    // M01 idle_stretch baked window [5,10] + sponsor draft Apex frame=0 / 9100ms
    // + finalDwell 6450ms. Frame 0 is outside [5,10] → unreachable → no apex pause.
    // The finalDwell at winEnd(10) STILL fires (proves the loop actually ran —
    // this is what makes the "no apex hold anywhere" assertion non-vacuous).
    const { idx, ms } = driveSequence(
      {
        speedMultiplier: 0.5,
        startFrame: 5,
        endFrame: 10,
        playbackMode: "pingpong",
        dwellFrameIndex: 0,
        dwellMs: 9100,
        finalDwellMs: 6450,
      },
      11,
      22,
    );
    const frameMs = FRAME_MS_DEFAULT / 0.5; // 320
    // Frame 0 is never rendered (outside the window).
    expect(idx).not.toContain(0);
    // No frame ever carries the 9100ms apex hold (it's unreachable).
    expect(ms.some((m) => m >= frameMs + 9100)).toBe(false);
    // …but the finalDwell at winEnd(10) DID fire — the loop ran (non-vacuity).
    const finalHold = frameMs + 6450;
    expect(ms.filter((m) => m === finalHold).length).toBeGreaterThan(0);
  });
});

/**
 * Pose-rotation boundary: the full cycle (raise → apex → LOWER → settle) must
 * complete across the ~2s poll re-render, NOT restart at the window start each
 * tick. This is the regression test for the live-preview bug (86ca2c4t8): the
 * descent (10→5) never rendered because every re-render disposed the box and
 * built a fresh one that restarted at winStart.
 *
 * The fix threads the prior box's frame position + direction back in (via the
 * tracker's `priorPlayback`) so the new box RESUMES the cycle. This harness
 * drives that resume directly: it builds a box, steps it a few frames, captures
 * its live position (what the tracker would read), then builds the NEXT box
 * with that position threaded in — and asserts the second box continues the
 * descent instead of snapping back to the rest frame.
 *
 * NON-VACUITY (mutation-verified): reverting the resume init in spritePlayer.ts
 * (`if (priorPose === canonicalName …) frameIdx = …`) back to an unconditional
 * `frameIdx = winStart` makes "resumes the descent across a re-render" FAIL —
 * the post-re-render box restarts at frame 5 (the rest frame) and the descent
 * 10→9→8 never appears. The pose-mismatch + fresh-start cases below pin that the
 * resume is GUARDED (only same-pose resumes).
 */
function buildBox(
  override: PlaybackOverride,
  frameCount: number,
  prior?: { pose: string; frameIdx: number; direction: number },
) {
  const char = {
    character: "TEST-CHAR",
    defaultIdle: "idle_stretch",
    idlePool: ["idle_stretch"],
    activePool: [],
    animations: {
      idle_stretch: {
        folder: "idle_stretch",
        frames: Array.from({ length: frameCount }, (_, i) => `f${i}.png`),
      },
    },
  };
  const table: Record<string, PlaybackOverrideTable> = {
    "TEST-CHAR": { idle_stretch: override },
  };
  let pending: (() => void) | null = null;
  const schedule = (cb: () => void, _m: number): number => {
    pending = cb;
    return 1;
  };
  const handle = createSpriteBox({
    char,
    state: "idle",
    activity: "idle 30s",
    spriteBaseUri: "base",
    priorIdlePick: "idle_stretch",
    rng: () => 0,
    scheduleFrame: schedule,
    cancelFrame: () => undefined,
    playbackTable: table,
    ...(prior
      ? {
          priorPose: prior.pose,
          priorFrameIdx: prior.frameIdx,
          priorDirection: prior.direction,
        }
      : {}),
  });
  const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
  const readIdx = (): number => {
    const m = /f(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
    return m ? Number(m[1]) : -1;
  };
  const seq: number[] = [];
  // tick() already ran once during construction (frame rendered). Record it,
  // then step the rest.
  const step = (n: number): void => {
    seq.push(readIdx());
    for (let i = 0; i < n; i++) {
      const cb = pending as (() => void) | null;
      pending = null;
      if (!cb) break;
      cb();
      seq.push(readIdx());
    }
  };
  return { handle, step, seq };
}

describe("spritePlayer pose-rotation boundary — full cycle survives re-render (86ca2c4t8)", () => {
  it("resumes the descent across a re-render instead of restarting at winStart", () => {
    // M01 idle_stretch window [5,10] pingpong. First box: raise to the apex.
    const override: PlaybackOverride = {
      startFrame: 5,
      endFrame: 10,
      playbackMode: "pingpong",
      finalDwellMs: 800,
    };
    const b1 = buildBox(override, 11);
    // Render frame 5 (construction) then step 5 more → renders 6,7,8,9,10. Frame
    // 10 (the apex) is now ON SCREEN holding its dwell. `currentFrame()` reports
    // the DISPLAYED position (10, travelling +1) — NOT the already-advanced next
    // frame — so a re-render that lands mid-dwell resumes the apex frame and
    // finishes its hold instead of skipping it (86ca2apxn #1).
    b1.step(5);
    expect(b1.seq).toEqual([5, 6, 7, 8, 9, 10]);
    const pos = b1.handle.currentFrame();
    // The displayed apex frame, captured travelling forward (the endpoint flip
    // governs the NEXT advance, not the displayed position).
    expect(pos.frameIdx).toBe(10);
    expect(pos.direction).toBe(1);
    b1.handle.dispose();

    // The ~2s poll re-render: a NEW box for the SAME pose, threading the prior
    // position. It re-renders the apex (10) to finish its interrupted dwell, then
    // CONTINUES the descent (10,9,8,7,6,5…) — it does NOT restart at the rest
    // frame 5, and does NOT skip the on-screen apex frame.
    const b2 = buildBox(override, 11, {
      pose: "idle_stretch",
      frameIdx: pos.frameIdx,
      direction: pos.direction,
    });
    b2.step(5);
    expect(b2.seq).toEqual([10, 9, 8, 7, 6, 5]);
    // It did NOT snap back to the rest frame and re-raise — descent ran fully.
    expect(b2.seq[0]).not.toBe(5);
    b2.handle.dispose();
  });

  it("does NOT resume when the pose changed (fresh pose starts at winStart)", () => {
    const override: PlaybackOverride = {
      startFrame: 5,
      endFrame: 10,
      playbackMode: "pingpong",
      finalDwellMs: 800,
    };
    // Prior position belonged to a DIFFERENT pose → guard rejects the resume.
    const b = buildBox(override, 11, {
      pose: "idle_coffee",
      frameIdx: 9,
      direction: -1,
    });
    b.step(2);
    expect(b.seq[0]).toBe(5); // started clean at winStart, not 9
    b.handle.dispose();
  });

  it("first render (no prior) starts at winStart", () => {
    const override: PlaybackOverride = {
      startFrame: 5,
      endFrame: 10,
      playbackMode: "pingpong",
      finalDwellMs: 800,
    };
    const b = buildBox(override, 11);
    b.step(1);
    expect(b.seq[0]).toBe(5);
    b.handle.dispose();
  });

  it("clamps a stale prior index into the live window (cannot park out of bounds)", () => {
    const override: PlaybackOverride = {
      startFrame: 5,
      endFrame: 10,
      playbackMode: "pingpong",
      finalDwellMs: 800,
    };
    // Prior index 99 (window shrank between renders) must clamp to winEnd(10).
    const b = buildBox(override, 11, {
      pose: "idle_stretch",
      frameIdx: 99,
      direction: -1,
    });
    b.step(1);
    expect(b.seq[0]).toBe(10);
    b.handle.dispose();
  });
});

/**
 * 86ca2apxn #1 — a poll re-render that lands WHILE a frame is on screen part-way
 * through a long dwell must NOT skip that frame. At slow speed the cup-at-mouth
 * peak dwell (PEAK_DWELL_MS_DEFAULT 600) and the cup-down final dwell (2000)
 * exceed the ~2s poll interval, so the re-render is guaranteed to interrupt a
 * frame mid-dwell. Before the fix, `currentFrame()` returned the already-advanced
 * NEXT position, so the resume skipped the on-screen frame and dropped the rest
 * of its hold — the sponsor saw "the loop restarts before completing".
 *
 * Build a box, step it until a dwell frame is on screen, capture the resume
 * position, build the next box from it, and assert: (a) the resumed box's FIRST
 * rendered frame is the one that was on screen (not the next), and (b) that frame
 * is scheduled with its full dwell again. The mid-dwell interruption is modelled
 * by reading `currentFrame()` between ticks (exactly when the dispose fires).
 *
 * NON-VACUITY (mutation-verified): reverting `currentFrame()` to return the
 * advanced `{ frameIdx, direction }` makes "re-shows the interrupted dwell frame"
 * FAIL — the resumed first frame becomes the NEXT one (skip) and the dwell is
 * not re-applied.
 */
function buildWithMs(
  override: PlaybackOverride,
  frameCount: number,
  prior?: { pose: string; frameIdx: number; direction: number },
) {
  const char = {
    character: "TEST-CHAR",
    defaultIdle: "idle_coffee",
    idlePool: ["idle_coffee"],
    activePool: [],
    animations: {
      idle_coffee: {
        folder: "idle_coffee",
        frames: Array.from({ length: frameCount }, (_, i) => `f${i}.png`),
      },
    },
  };
  const table: Record<string, PlaybackOverrideTable> = {
    "TEST-CHAR": { idle_coffee: override },
  };
  let pending: (() => void) | null = null;
  let nextMs = 0;
  const handle = createSpriteBox({
    char,
    state: "idle",
    activity: "idle 30s",
    spriteBaseUri: "base",
    priorIdlePick: "idle_coffee",
    rng: () => 0,
    scheduleFrame: (cb, m) => {
      pending = cb;
      nextMs = m;
      return 1;
    },
    cancelFrame: () => undefined,
    playbackTable: table,
    ...(prior
      ? { priorPose: prior.pose, priorFrameIdx: prior.frameIdx, priorDirection: prior.direction }
      : {}),
  });
  const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
  const readIdx = (): number => {
    const m = /f(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
    return m ? Number(m[1]) : -1;
  };
  const seq: number[] = [readIdx()];
  const ms: number[] = [nextMs];
  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      const cb = pending as (() => void) | null;
      pending = null;
      if (!cb) break;
      cb();
      seq.push(readIdx());
      ms.push(nextMs);
    }
  };
  return { handle, step, seq, ms };
}

describe("spritePlayer #1 — mid-dwell poll re-render must not skip the on-screen frame (86ca2apxn)", () => {
  // F01 idle_coffee live config: 9 frames [0,8], peak f4 (cup-at-mouth),
  // finalDwell at f8 (cup-down), pingpong, slow speed.
  const COFFEE: PlaybackOverride = {
    speedMultiplier: 0.55,
    dwellFrameIndex: 4,
    finalDwellMs: 2000,
    playbackMode: "pingpong",
  };
  const frameMs = FRAME_MS_DEFAULT / 0.55; // ~290.9

  it("re-shows the interrupted PEAK (cup-at-mouth) frame and re-applies its dwell", () => {
    // Step to the apex frame 4 ON SCREEN (construction renders 0, then 1,2,3,4).
    const b1 = buildWithMs(COFFEE, 9);
    b1.step(4);
    expect(b1.seq).toEqual([0, 1, 2, 3, 4]);
    // Frame 4 is on screen, holding peak dwell (frameMs + 600). The re-render
    // fires NOW — currentFrame() must report frame 4 (the displayed one).
    const pos = b1.handle.currentFrame();
    expect(pos.frameIdx).toBe(4);
    b1.handle.dispose();

    const b2 = buildWithMs(COFFEE, 9, {
      pose: "idle_coffee",
      frameIdx: pos.frameIdx,
      direction: pos.direction,
    });
    // The resumed box's FIRST frame is the interrupted one (4), NOT the next (5).
    expect(b2.seq[0]).toBe(4);
    // …and it is scheduled with the FULL peak dwell again (frameMs + 600), so the
    // cup-at-mouth hold completes instead of being cut short.
    expect(b2.ms[0]).toBe(frameMs + 600);
  });

  it("re-shows the interrupted cup-down FINAL-dwell frame and re-applies its 2000ms hold", () => {
    // Step to frame 8 ON SCREEN (0..8 = 8 steps).
    const b1 = buildWithMs(COFFEE, 9);
    b1.step(8);
    expect(b1.seq[b1.seq.length - 1]).toBe(8);
    const pos = b1.handle.currentFrame();
    // Displayed frame 8, captured travelling forward (the endpoint flip governs
    // the NEXT advance, not the displayed position).
    expect(pos.frameIdx).toBe(8);
    expect(pos.direction).toBe(1);
    b1.handle.dispose();

    const b2 = buildWithMs(COFFEE, 9, {
      pose: "idle_coffee",
      frameIdx: pos.frameIdx,
      direction: pos.direction,
    });
    expect(b2.seq[0]).toBe(8);
    // The 2000ms final dwell re-applies (frameMs + 2000) — the long cup-down hold
    // is NOT dropped by the re-render.
    expect(b2.ms[0]).toBe(frameMs + 2000);
    // Then it descends (pingpong reverse): 8 → 7 → 6 …
    b2.step(2);
    expect(b2.seq.slice(0, 3)).toEqual([8, 7, 6]);
  });
});
