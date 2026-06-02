/**
 * @vitest-environment jsdom
 *
 * 86ca3a7x3 — "idle pose frozen on a single frame" regression coverage.
 *
 * Root cause: the ~2s poll re-render disposes the live sprite box and builds a
 * fresh one seeded with the prior box's DISPLAYED frame (86ca2apxn #1 — report
 * the shown frame so an interrupted dwell finishes). When the re-render cadence
 * is SHORTER than the displayed frame's on-screen duration — the production
 * out-of-band file-event tick can fire well under the 320ms slow-frame interval
 * (vscode-extension-conventions.md § DEAD prune / onDidDelete out-of-band tick)
 * — the box is disposed BEFORE its own frame timer fires, so `currentFrame()`
 * keeps reporting the SAME displayed frame and the resuming box re-shows it
 * forever. The tile freezes on one frame. It is per-POSE not per-character: any
 * tile that lands on a config where this holds freezes, and the frozen set
 * re-rolls each reload as tiles pick different idle poses.
 *
 * Fix: `currentFrame()` reports `elapsedMs` (how long the displayed frame has
 * been on screen); the resuming box STEPS PAST a frame whose `elapsedMs >=
 * frameMs` (it got its full base hold), guaranteeing forward progress per
 * re-render regardless of whether the prior box's timer ever fired. A frame
 * shown for < frameMs is re-shown + re-armed (preserves the 86ca2apxn #1
 * mid-dwell hold).
 *
 * NON-VACUITY (mutation-verified): this suite FAILS on the pre-fix engine. The
 * `REVERT-PROBE` describe block builds boxes through a `resumeWithoutElapsed`
 * path (threads NO elapsedMs / never steps past — the old behavior) and asserts
 * the freeze REPRODUCES, so reverting the production fix (deleting the
 * `elapsed >= frameMs` step-past in spritePlayer's resume block) makes the
 * positive "advances" assertions fail while the revert-probe stays green —
 * i.e. the test is anchored to the real engine behavior, not a tautology.
 */
import { describe, it, expect } from "vitest";
import {
  createSpriteBox,
  FRAME_MS_DEFAULT,
  type PlaybackOverride,
  type PlaybackOverrideTable,
  type SpriteBoxProps,
} from "../../../src/webview/sprites/spritePlayer.js";

/**
 * Single-timer virtual clock that ALSO backs `nowMs` so on-screen elapsed time
 * is measured against the same virtual wall clock that fires the frame timer.
 */
function makeClock() {
  let now = 0;
  let fireAt: number | null = null;
  let cb: (() => void) | null = null;
  return {
    now: () => now,
    schedule(c: () => void, ms: number): number {
      cb = c;
      fireAt = now + ms;
      return 1;
    },
    cancel() {
      cb = null;
      fireAt = null;
    },
    /** Advance virtual time by `ms`, firing the frame timer as it elapses. */
    advance(ms: number) {
      const target = now + ms;
      while (fireAt !== null && fireAt <= target) {
        now = fireAt;
        const c = cb;
        fireAt = null;
        cb = null;
        if (c) c();
      }
      now = target;
    },
  };
}

function makeChar(frameCount: number) {
  return {
    character: "TEST-CHAR",
    defaultIdle: "idle_coffee",
    idlePool: ["idle_coffee"],
    animations: {
      idle_coffee: {
        folder: "idle_coffee",
        frames: Array.from({ length: frameCount }, (_, i) => `f${i}.png`),
      },
    },
  };
}

const readIdx = (img: HTMLImageElement): number => {
  const m = /f(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
  return m ? Number(m[1]) : -1;
};

/**
 * Drive the PRODUCTION re-render loop: every `pollMs` of virtual time, read the
 * live box's `currentFrame()`, dispose it, and build a fresh box seeded with
 * that prior position (exactly what spriteTracker + agentTile do per poll).
 * Returns EVERY distinct frame painted across the whole run — the frame at the
 * start of each poll AND each frame the box's own timer paints DURING the poll
 * window — i.e. exactly what the user's eye sees over time. A freeze shows up as
 * a single distinct value; a healthy animation as a sweep across the window.
 *
 * `threadElapsed=false` models the PRE-FIX engine (never thread elapsedMs / the
 * resuming box can't know the frame's on-screen time → it re-shows forever).
 */
function runProductionLoop(
  override: PlaybackOverride,
  frameCount: number,
  pollMs: number,
  polls: number,
  threadElapsed = true,
): number[] {
  const clock = makeClock();
  const table: Record<string, PlaybackOverrideTable> = {
    "TEST-CHAR": { idle_coffee: override },
  };
  const shown: number[] = [];
  let prior:
    | { pose: string; frameIdx: number; direction: number; elapsedMs: number }
    | undefined;

  for (let p = 0; p < polls; p++) {
    const resume: Partial<SpriteBoxProps> = prior
      ? {
          priorPose: prior.pose,
          priorFrameIdx: prior.frameIdx,
          priorDirection: prior.direction,
          ...(threadElapsed ? { priorElapsedMs: prior.elapsedMs } : {}),
        }
      : {};
    const handle = createSpriteBox({
      char: makeChar(frameCount),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: clock.schedule,
      cancelFrame: clock.cancel,
      nowMs: clock.now,
      playbackTable: table,
      ...resume,
    });
    const img = handle.element.querySelector("img.sprite-frame") as HTMLImageElement;
    // Frame painted at poll start (the resumed/boot frame).
    shown.push(readIdx(img));
    // Advance the poll window; the box's own timer paints intermediate frames —
    // sample after each ms step so DURING-poll frames are recorded too.
    const stepMs = Math.max(1, Math.floor(pollMs / 8));
    let remaining = pollMs;
    while (remaining > 0) {
      const dt = Math.min(stepMs, remaining);
      clock.advance(dt);
      shown.push(readIdx(img));
      remaining -= dt;
    }
    const pos = handle.currentFrame();
    prior = {
      pose: "idle_coffee",
      frameIdx: pos.frameIdx,
      direction: pos.direction,
      elapsedMs: pos.elapsedMs,
    };
    handle.dispose();
  }
  return shown;
}

// Production slow-idle cadence: speedMultiplier 0.5 → frameMs = 160/0.5 = 320.
const FRAME_MS = FRAME_MS_DEFAULT / 0.5; // 320

describe("spritePlayer 86ca3a7x3 — idle pose must keep advancing across poll re-renders", () => {
  it("advances when a FAST out-of-band re-render fires under the frame duration (300ms poll, 320ms frames)", () => {
    // poll (300) < frameMs (320): the box is disposed before its own timer ever
    // fires. The carried-forward on-screen time still accumulates past frameMs
    // across successive re-shows, so the resume steps the frame forward.
    const shown = runProductionLoop({ speedMultiplier: 0.5 }, 9, 300, 12);
    // Must traverse multiple distinct frames, not pin on one.
    expect(new Set(shown).size).toBeGreaterThan(1);
  });

  it("advances a LONG-PEAK pose whose apex dwell exceeds the poll interval (peak +2500ms at 2s poll)", () => {
    // peak hold = 320 + 2500 = 2820ms > 2000ms poll. Pre-fix the box's timer
    // never fires before the poll disposes it on the apex → frozen on f4. Here
    // the resume steps past the apex once its base hold (>= frameMs) elapsed.
    const shown = runProductionLoop(
      { speedMultiplier: 0.5, dwellFrameIndex: 4, dwellMs: 2500 },
      9,
      2000,
      10,
    );
    // After the apex is reached, the loop must get PAST it into the descent/wrap.
    expect(shown).toContain(5);
    // …and it must not park on the apex forever — frames beyond 5 also appear.
    expect(shown).toContain(6);
  });

  it("advances a long FINAL dwell that exceeds the poll interval (final +2400ms at 2s poll, plain loop, 5 frames)", () => {
    // 5-frame loop, final dwell on f4 = 320 + 2400 = 2720ms > 2000ms poll.
    const shown = runProductionLoop(
      { speedMultiplier: 0.5, finalDwellMs: 2400 },
      5,
      2000,
      12,
    );
    expect(new Set(shown).size).toBeGreaterThan(1);
    // Wraps back through the window start (0) after the held final frame, and
    // reaches the final frame (4) — the full loop traverses.
    expect(shown).toContain(0);
    expect(shown).toContain(4);
  });

  it("a plain fast loop crosses the loop boundary (wraps to start) rather than parking on the last frame", () => {
    // 4-frame plain loop, fast poll. Over enough polls it should display the
    // wrap (…3 → 0) — proving the loop boundary is crossed, not frozen at 3.
    const shown = runProductionLoop({ speedMultiplier: 0.5 }, 4, 350, 16);
    expect(shown).toContain(0);
    expect(shown).toContain(3);
  });
});

describe("spritePlayer 86ca3a7x3 — REVERT-PROBE (proves non-vacuity): pre-fix path freezes", () => {
  it("freezes on a single frame when elapsedMs is NOT threaded (the old behavior)", () => {
    // threadElapsed=false models the engine WITHOUT the elapsed-driven step-past.
    // Under a sub-frame poll (300 < frameMs 320) the timer never fires AND the
    // resume never steps, so every paint is the same boot frame → frozen.
    const shown = runProductionLoop({ speedMultiplier: 0.5 }, 9, 300, 12, false);
    expect(new Set(shown).size).toBe(1);
    expect(shown.every((f) => f === shown[0])).toBe(true);
  });

  it("freezes on the apex when a long peak dwell exceeds the poll and elapsedMs is NOT threaded", () => {
    const shown = runProductionLoop(
      { speedMultiplier: 0.5, dwellFrameIndex: 4, dwellMs: 2500 },
      9,
      2000,
      10,
      false,
    );
    // Without the fix the box advances 0→1→2→3→4 via its OWN timer within the
    // first 2s poll, then parks on the apex (dwell 2820 > 2000ms) and re-shows
    // f4 forever — so every poll AFTER the first paints only frame 4.
    const sweep = 9 + 1; // poll-start + up-to-9 intermediate samples per poll
    const tail = shown.slice(sweep); // everything after the first poll window
    expect(new Set(tail)).toEqual(new Set([4]));
  });
});

describe("spritePlayer 86ca3a7x3 — must NOT regress the 86ca2apxn #1 mid-dwell hold", () => {
  it("re-shows + re-arms the full dwell for a frame interrupted BEFORE its base hold elapsed", () => {
    // Build a box on the apex, advance only 100ms (< frameMs 320 → base hold not
    // complete), then resume. The resuming box must RE-SHOW the apex (not step
    // past) and re-arm its full peak dwell so the interrupted hold finishes.
    const clock = makeClock();
    const table: Record<string, PlaybackOverrideTable> = {
      "TEST-CHAR": {
        idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 0, dwellMs: 600 },
      },
    };
    const b1 = createSpriteBox({
      char: makeChar(5),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: clock.schedule,
      cancelFrame: clock.cancel,
      nowMs: clock.now,
      playbackTable: table,
    });
    // Apex is frame 0 (dwellFrameIndex 0) — shown at construction. Advance only
    // 100ms: under the 320ms base + 600ms peak hold, so the frame was interrupted
    // mid-hold.
    clock.advance(100);
    const pos = b1.currentFrame();
    expect(pos.frameIdx).toBe(0);
    expect(pos.elapsedMs).toBe(100); // < frameMs → must re-show, not step past
    b1.dispose();

    // Re-mount the box at the same virtual time, capturing the scheduled ms.
    let scheduledMs = -1;
    const b2 = createSpriteBox({
      char: makeChar(5),
      state: "idle",
      activity: "idle 30s",
      spriteBaseUri: "base",
      priorIdlePick: "idle_coffee",
      rng: () => 0,
      scheduleFrame: (cb, ms) => {
        scheduledMs = ms;
        return clock.schedule(cb, ms);
      },
      cancelFrame: clock.cancel,
      nowMs: clock.now,
      playbackTable: table,
      priorPose: "idle_coffee",
      priorFrameIdx: pos.frameIdx,
      priorDirection: pos.direction,
      priorElapsedMs: pos.elapsedMs,
    });
    const img2 = b2.element.querySelector("img.sprite-frame") as HTMLImageElement;
    // RE-SHOWS the interrupted apex frame 0 (NOT stepped to 1) …
    expect(readIdx(img2)).toBe(0);
    // … and schedules the REMAINING hold (frameMs 320 + 600 peak − 100 already
    // served) so the apex hold finishes at the configured total rather than
    // restarting from full — the interrupted dwell completes, not skipped.
    expect(scheduledMs).toBe(FRAME_MS + 600 - 100);
    b2.dispose();
  });
});
