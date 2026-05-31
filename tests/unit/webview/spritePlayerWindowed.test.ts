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
    // Render frame 5 (construction) then step 5 more → renders 6,7,8,9,10. The
    // tick that renders the apex (10) flips direction to descend and advances to
    // frame 9, so the live position is (9, -1): about to lower.
    b1.step(5);
    expect(b1.seq).toEqual([5, 6, 7, 8, 9, 10]);
    const pos = b1.handle.currentFrame();
    // After rendering the apex the loop has flipped to descend.
    expect(pos.direction).toBe(-1);
    expect(pos.frameIdx).toBe(9);
    b1.handle.dispose();

    // The ~2s poll re-render: a NEW box for the SAME pose, threading the prior
    // position. It must CONTINUE the descent (9,8,7,6,5…), not restart at 5.
    const b2 = buildBox(override, 11, {
      pose: "idle_stretch",
      frameIdx: pos.frameIdx,
      direction: pos.direction,
    });
    b2.step(4);
    expect(b2.seq).toEqual([9, 8, 7, 6, 5]);
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
