/**
 * @vitest-environment jsdom
 *
 * Feature A — active-pool ROTATION (ticket 86ca4atwt). While an agent works
 * CONTINUOUSLY, the tile advances IN ORDER through `char.activePool`
 * (activePool[0] → [1] → … → wrap) on a loops-per-pose cadence, instead of
 * sticking on one random pick for the whole episode (the shipped PR #190
 * behavior).
 *
 * NON-VACUITY (spec A.8 + .claude/docs/vscode-extension-conventions.md
 * § Re-render-resume): every advance/resume assertion drives a SECOND
 * `createSpriteBox` seeded from the PRIOR handle's reported cursor/loop-count —
 * exactly as the tile caller + spriteTracker thread them across the ~2s poll
 * re-render. A single-mount test is vacuous w.r.t. the survive-the-poll-tick
 * class these tests exist to lock.
 *
 * Revert failure modes (each describe FAILS if the fix is reverted):
 *  - "advances in order across loops" — if the cursor never advances in tick(),
 *    the pose stays activePool[0] forever (stick-on-one regression).
 *  - "cursor survives the poll re-render" — if the resume seeds from 0 instead
 *    of priorActiveRotIdx, the re-rendered box snaps back to activePool[0].
 *  - "no double-count on the resumed wrap" — if the loop-count re-increments for
 *    a wrap the prior box already counted, the cursor over-advances.
 *  - "idle→active resets to 0" — if the fresh-active-episode reset is dropped,
 *    rotation resumes mid-pool after an idle gap.
 *  - "read→work resumes (not reset)" — if the cursor isn't preserved across an
 *    active_read render, a Read mid-work restarts rotation at the top.
 */

import { describe, it, expect } from "vitest";
import { createSpriteBox } from "../../../src/webview/sprites/spritePlayer.js";
import type {
  SpriteBoxHandle,
  SpriteBoxProps,
} from "../../../src/webview/sprites/spritePlayer.js";
import type { SpriteCharacter } from "../../../src/webview/sprites/spriteManifest.js";

const POOL = ["work_a", "work_b", "work_c"];

/** A 3-member active pool, each a 3-frame loop anim (frames 0,1,2). */
function poolChar(): SpriteCharacter {
  const animations: SpriteCharacter["animations"] = {};
  for (const anim of [...POOL, "active_read", "idle_coffee"]) {
    animations[anim] = {
      folder: anim,
      frames: [`x/${anim}/0.png`, `x/${anim}/1.png`, `x/${anim}/2.png`],
    };
  }
  return {
    character: "ClaudeTeam-M01-Dev",
    defaultIdle: "idle_coffee",
    idlePool: ["idle_coffee"],
    activePool: [...POOL],
    animations,
  };
}

/** A scheduler that records each delay + lets the test step the loop manually. */
function recordingScheduler() {
  const cbs: Array<() => void> = [];
  const schedule = (cb: () => void): number => {
    cbs.push(cb);
    return cbs.length;
  };
  const step = (): void => {
    const cb = cbs.shift();
    if (cb) cb();
  };
  return { schedule, step };
}

/** Read the rendered pose name off the box dataset. */
function poseOf(handle: SpriteBoxHandle): string | undefined {
  return (handle.element as HTMLElement).dataset.pose;
}

/** Build a working box, threading prior rotation state like the caller does. */
function workBox(
  over: Partial<SpriteBoxProps>,
  schedule: (cb: () => void, ms: number) => number,
): SpriteBoxHandle {
  return createSpriteBox({
    char: poolChar(),
    state: "running",
    activity: "tool:Edit src/x.ts", // non-Read → active_work pool pose
    spriteBaseUri: "base",
    priorWasActive: true, // continuation of an active episode (no fresh reset)
    loopsPerActivePose: 1,
    scheduleFrame: schedule,
    cancelFrame: () => undefined,
    ...over,
  });
}

/** Step `n` frame ticks (each advances one frame within the current loop). */
function steps(step: () => void, n: number): void {
  for (let i = 0; i < n; i++) step();
}

describe("active-pool rotation — advances IN ORDER across loops (A.1/A.2)", () => {
  it("the cursor advances one pool member per completed loop at cadence=1", () => {
    const s = recordingScheduler();
    // Fresh active episode (priorWasActive false → idle→active) starts at [0].
    const h = workBox(
      { priorWasActive: false },
      s.schedule,
    );
    expect(poseOf(h)).toBe("work_a"); // activePool[0]
    expect(h.activeRotIdx).toBe(0);

    // A 3-frame loop wraps on the tick that advances frame 2 → 0. Sync tick
    // painted frame 0 + scheduled; step 0→1, 1→2, 2→wrap (3 steps = one loop).
    steps(s.step, 3);
    // One loop complete at cadence 1 → cursor advanced to 1.
    expect(h.activeRotIdx).toBe(1);
    expect(h.activeLoopCount).toBe(0); // reset after the advance

    // Another full loop → cursor 2.
    steps(s.step, 3);
    expect(h.activeRotIdx).toBe(2);

    // Wrap-around: another loop → back to 0 (% pool length).
    steps(s.step, 3);
    expect(h.activeRotIdx).toBe(0);
  });

  it("cadence=2 advances only after TWO completed loops (sponsor default)", () => {
    const s = recordingScheduler();
    const h = workBox({ priorWasActive: false, loopsPerActivePose: 2 }, s.schedule);
    expect(h.activeRotIdx).toBe(0);
    steps(s.step, 3); // 1 loop
    expect(h.activeRotIdx).toBe(0); // not yet — cadence 2
    expect(h.activeLoopCount).toBe(1);
    steps(s.step, 3); // 2nd loop
    expect(h.activeRotIdx).toBe(1); // now advances
    expect(h.activeLoopCount).toBe(0);
  });

  it("clamps cadence <= 0 / non-finite up to 1 (never freeze on one pose)", () => {
    const s = recordingScheduler();
    const h = workBox({ priorWasActive: false, loopsPerActivePose: 0 }, s.schedule);
    steps(s.step, 3);
    expect(h.activeRotIdx).toBe(1); // behaved as cadence 1
  });

  it("per-character char.activePoolLoopsPerPose WINS over the threaded config (A.2 layer 1)", () => {
    const s = recordingScheduler();
    const char = poolChar();
    char.activePoolLoopsPerPose = 2; // per-char cadence 2 overrides config 1
    const h = createSpriteBox({
      char,
      state: "running",
      activity: "tool:Edit x",
      spriteBaseUri: "base",
      priorWasActive: false,
      loopsPerActivePose: 1, // config layer — must be overridden by per-char
      scheduleFrame: s.schedule,
      cancelFrame: () => undefined,
    });
    steps(s.step, 3); // 1 loop
    expect(h.activeRotIdx).toBe(0); // not advanced — per-char cadence is 2
    steps(s.step, 3); // 2nd loop
    expect(h.activeRotIdx).toBe(1);
  });
});

describe("active-pool rotation — survives the ~2s poll re-render (A.3)", () => {
  it("the cursor SURVIVES + advances across a SECOND render (no snap-back)", () => {
    const s1 = recordingScheduler();
    const first = workBox({ priorWasActive: false }, s1.schedule);
    steps(s1.step, 3); // complete one loop → cursor 1 on the first box
    expect(first.activeRotIdx).toBe(1);

    // Simulate the poll re-render: a NEW box seeded from the prior handle's
    // reported cursor + loop-count (exactly what spriteTracker threads back).
    const s2 = recordingScheduler();
    const second = workBox(
      {
        priorActiveRotIdx: first.activeRotIdx,
        priorActiveLoopCount: first.activeLoopCount,
      },
      s2.schedule,
    );
    // The resumed box plays activePool[1] — NOT a snap-back to [0].
    expect(poseOf(second)).toBe("work_b");
    expect(second.activeRotIdx).toBe(1);

    // It keeps advancing from there.
    steps(s2.step, 3);
    expect(second.activeRotIdx).toBe(2);
  });

  it("a re-render mid-loop resumes the SAME pose with no double-count on the wrap", () => {
    const s1 = recordingScheduler();
    const first = workBox({ priorActiveRotIdx: 1, priorActiveLoopCount: 0 }, s1.schedule);
    expect(poseOf(first)).toBe("work_b");
    // Advance PART of a loop (1 step after the sync frame-0 paint) — mid-loop,
    // before the wrap at frame 2 fires.
    steps(s1.step, 1);
    expect(first.activeRotIdx).toBe(1); // cursor unchanged mid-loop
    expect(first.activeLoopCount).toBe(0);

    // Poll re-render lands mid-loop — seed from the prior (un-wrapped) values.
    const s2 = recordingScheduler();
    const second = workBox(
      {
        priorActiveRotIdx: first.activeRotIdx,
        priorActiveLoopCount: first.activeLoopCount,
        priorPose: poseOf(first),
        priorFrameIdx: first.currentFrame().frameIdx,
        priorDirection: first.currentFrame().direction,
        priorElapsedMs: first.currentFrame().elapsedMs,
      },
      s2.schedule,
    );
    // Same pose resumes; cursor still 1 (the wrap was NOT counted by either box).
    expect(poseOf(second)).toBe("work_b");
    expect(second.activeRotIdx).toBe(1);
    // Now drive a FULL loop on the resumed box → exactly one advance (no double).
    steps(s2.step, 3);
    expect(second.activeRotIdx).toBe(2);
  });

  it("cadence=2: a re-render landing EXACTLY on the wrap frame counts the wrap ONCE", () => {
    // The seam Felix flagged (PR #192 review). At cadence >= 2 — the SHIPPED
    // default — if the poll re-render re-seats the resumed box on `winEnd`, the
    // very frame the prior box just counted, the resumed box's first tick
    // re-paints winEnd and would re-fire `willWrap`. The wrap must be counted
    // exactly once across the box swap (A.3) or rotation advances after ONE real
    // loop instead of two. The mid-loop test above can't catch this: it lands
    // mid-window (never on winEnd) and is cadence 1.
    const s1 = recordingScheduler();
    const first = workBox(
      { priorWasActive: false, loopsPerActivePose: 2 },
      s1.schedule,
    );
    // Mount paints frame 0; two steps put the DISPLAYED frame on winEnd (frame 2)
    // with the wrap counted exactly once → loopCount 1, cursor still 0 (cadence 2).
    steps(s1.step, 2);
    expect(first.currentFrame().frameIdx).toBe(2); // winEnd on screen
    expect(first.activeLoopCount).toBe(1); // counted once
    expect(first.activeRotIdx).toBe(0); // not advanced yet (cadence 2)

    // Poll re-render re-seats a NEW box EXACTLY on winEnd, seeded from the prior
    // post-wrap-count values — the double-count trap.
    const s2 = recordingScheduler();
    const second = workBox(
      {
        loopsPerActivePose: 2,
        priorActiveRotIdx: first.activeRotIdx,
        priorActiveLoopCount: first.activeLoopCount,
        priorPose: poseOf(first),
        priorFrameIdx: first.currentFrame().frameIdx,
        priorDirection: first.currentFrame().direction,
        priorElapsedMs: first.currentFrame().elapsedMs,
      },
      s2.schedule,
    );
    // The resumed box's first (synchronous mount) tick re-painted winEnd. The wrap
    // must be SUPPRESSED: cursor still 0, loopCount still 1. WITHOUT the fix the
    // wrap re-counts → loopCount hits 2 → the cursor over-advances to 1 HERE
    // (this assertion is the revert-probe — it fails on the un-fixed code).
    expect(poseOf(second)).toBe("work_a");
    expect(second.activeRotIdx).toBe(0);
    expect(second.activeLoopCount).toBe(1);

    // A FULL genuine second loop on the resumed box NOW advances (two real loops
    // total → cadence 2 satisfied), proving the suppression was one-shot, not a
    // permanent stall.
    steps(s2.step, 3);
    expect(second.activeRotIdx).toBe(1);
    expect(second.activeLoopCount).toBe(0);
  });
});

describe("active-pool rotation — episode boundaries (A.4 / A.5)", () => {
  it("idle→active RESETS rotation to activePool[0]", () => {
    const s = recordingScheduler();
    // The prior render was IDLE (priorWasActive false) but a stale cursor exists
    // from an earlier episode — the fresh-active-episode predicate must reset it.
    const h = workBox(
      { priorWasActive: false, priorActiveRotIdx: 2, priorActiveLoopCount: 1 },
      s.schedule,
    );
    expect(poseOf(h)).toBe("work_a"); // back to [0], not work_c
    expect(h.activeRotIdx).toBe(0);
    expect(h.activeLoopCount).toBe(0);
  });

  it("read→work RESUMES the cursor (a Read is not an idle gap)", () => {
    const s1 = recordingScheduler();
    // Working at cursor 1, mid-episode.
    const work = workBox({ priorActiveRotIdx: 1, priorActiveLoopCount: 0 }, s1.schedule);
    expect(work.activeRotIdx).toBe(1);

    // The agent reads (tool == Read) — still an active episode. The cursor must
    // be PRESERVED (frozen), not advanced and not reset.
    const s2 = recordingScheduler();
    const read = workBox(
      {
        activity: "tool:Read src/x.ts",
        priorActiveRotIdx: work.activeRotIdx,
        priorActiveLoopCount: work.activeLoopCount,
      },
      s2.schedule,
    );
    expect(poseOf(read)).toBe("active_read");
    expect(read.activeRotIdx).toBe(1); // frozen at the work cursor
    steps(s2.step, 3); // reading loops complete — cursor must NOT advance
    expect(read.activeRotIdx).toBe(1);

    // Back to work — the cursor RESUMES at 1 (work_b), not reset to [0].
    const s3 = recordingScheduler();
    const back = workBox(
      {
        priorActiveRotIdx: read.activeRotIdx,
        priorActiveLoopCount: read.activeLoopCount,
      },
      s3.schedule,
    );
    expect(poseOf(back)).toBe("work_b");
    expect(back.activeRotIdx).toBe(1);
  });
});

describe("active-pool rotation — degrade (A.6)", () => {
  it("a single-member pool wraps 0→0 (visual no-op, no crash)", () => {
    const s = recordingScheduler();
    const char = poolChar();
    char.activePool = ["work_a"];
    const h = createSpriteBox({
      char,
      state: "running",
      activity: "tool:Edit x",
      spriteBaseUri: "base",
      priorWasActive: false,
      loopsPerActivePose: 1,
      scheduleFrame: s.schedule,
      cancelFrame: () => undefined,
    });
    expect(poseOf(h)).toBe("work_a");
    steps(s.step, 3);
    expect(h.activeRotIdx).toBe(0); // 0 → 0, same pose forever
  });

  it("an EMPTY pool falls back to active_work, no rotation", () => {
    const s = recordingScheduler();
    const char = poolChar();
    char.activePool = [];
    char.animations.active_work = {
      folder: "active_work",
      frames: ["x/active_work/0.png", "x/active_work/1.png"],
    };
    const h = createSpriteBox({
      char,
      state: "running",
      activity: "tool:Edit x",
      spriteBaseUri: "base",
      priorWasActive: false,
      loopsPerActivePose: 1,
      scheduleFrame: s.schedule,
      cancelFrame: () => undefined,
    });
    expect(poseOf(h)).toBe("active_work");
    expect(h.activePick).toBeNull();
    steps(s.step, 2);
    expect(h.activeRotIdx).toBe(0); // never advances
  });
});
