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
 * NON-VACUITY (each block fails when the relevant fix is reverted; mutation-
 * verified 2026-05-31 against spritePlayer.ts):
 *  - "windowed-pingpong full cycle": FAILS if the turnaround keys off the global
 *    lastIndex/0 instead of winEnd/winStart (mutation: reverse-at-lastIndex /
 *    forward-at-0 lets the lower pass run past winStart down to frame 0).
 *  - "apex dwell forward-only at a MID-clip endFrame": FAILS if the dwell fires
 *    on the reverse pass through endFrame (mutation: drop the `direction === 1`
 *    guard -> the 2nd visit to endFrame on the way down also gets the long hold).
 *  - "loop + no window byte-identical": FAILS if windowing changes the historic
 *    +1/wrap-to-0 advance for an override without start/endFrame.
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
    const cb = pending;
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

  it("apex finalDwell fires ONLY on the FORWARD arrival at a MID-clip endFrame, not the reverse pass", () => {
    // Window [3,7] on an 11-frame clip: endFrame(7) is NOT the clip's last frame,
    // so the reverse pass DOES travel back through 7 — the exact moment a
    // direction-blind dwell would wrongly double-hold.
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
