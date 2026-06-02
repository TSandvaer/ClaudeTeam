/**
 * @vitest-environment jsdom
 *
 * QA SWEEP (86ca3bm87) — the playback-resume WIRING SEAM at the TILE level.
 *
 * Why this file exists. The sprite-playback / re-render-resume subsystem had a
 * 5-bug cluster (speed-cap #172, apex-window #173, manifest-staleness #174,
 * hold-final-on-active 86ca2apxn, idle-freeze-under-poll-re-render #179). The
 * engine-level fixes are well covered by the spritePlayer*.test.ts files, which
 * drive `createSpriteBox` DIRECTLY and thread the prior box's
 * pose/frameIdx/direction/elapsedMs BY HAND. But the PRODUCTION resume path is
 * not createSpriteBox-called-by-a-test — it is:
 *
 *     renderAgentTile / renderMultiAgentPersonaTile
 *        → spriteTracker.priorPlayback(sessionId, memberId)              (READ)
 *        → createSpriteBox({ priorPose, priorFrameIdx, priorDirection, … })
 *        → spriteTracker.register(... pose, currentFrame ...)            (WRITE-BACK)
 *
 * If ANY link in that chain breaks — the tile forgets to forward `priorPose`
 * (the resume guard never matches → every ~2s tick restarts at winStart, the
 * 86ca2c4t8 snap-back) or `priorFrameIdx` (no resume), or registers a stale
 * `currentFrame` reader — EVERY engine-level test still passes (they inject the
 * prior values directly, bypassing the tracker). Only a test that re-renders the
 * REAL tile through the REAL tracker catches the wiring break. That is this
 * file's job: cover the bug CLASS (the read→thread→write-back seam), not the
 * instance (the engine math, already covered).
 *
 * Method: render the tile once with an injected recording scheduler, step the
 * loop a few frames, then re-render the SAME tile with the SAME tracker (the
 * ~2s poll re-render render.ts performs) and assert the second box resumed the
 * in-flight cycle rather than restarting at frame 0 / winStart.
 *
 * SCOPE NOTE — the freeze fix's `priorElapsedMs` TIMING is intentionally NOT
 * re-asserted here: `createSpriteBox`'s on-screen clock reads `performance.now()`
 * in production (the tile does NOT forward an injectable clock to the box — its
 * own `nowMs` prop is a freshness-text snapshot, not a `() => number`), so
 * elapsed-driven step-past cannot be virtualized through the tile. That timing
 * is fully covered at the box layer in spritePlayerIdleAdvance.test.ts with an
 * injected `nowMs`. What IS verifiable at this seam — and what these tests pin —
 * is that the tile READS the tracker's prior position and THREADS it, so the
 * resume actually fires. (Coverage-audit finding recorded in the PR body.)
 *
 * NON-VACUITY (mutation-verified THIS task — probes in the PR body):
 *  - deleting `priorPose: pp.pose` from the agentTile spread → the resume guard
 *    in spritePlayer (`priorPose === canonicalName`) never matches → the
 *    "resumes the in-flight cycle" assertion FAILS (box restarts at frame 0).
 *  - deleting `priorFrameIdx: pp.frameIdx` → same FAILURE.
 *  - same probes against multiAgentPersonaTile's spread for its block.
 */

import { describe, it, expect } from "vitest";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { renderMultiAgentPersonaTile } from "../../../src/webview/components/multiAgentPersonaTile.js";
import { createSpriteTracker } from "../../../src/webview/spriteTracker.js";
import type {
  AgentTile,
  MultiAgentPersonaTile,
} from "../../../src/shared/types.js";

const BASE = "vscode-webview://abc/dist/webview";
// maya → ClaudeTeam-F01-Dev. rng=0 → idle_coffee (first pool member): the REAL
// shipped config is 9 frames [0..8], speedMultiplier 0.5, dwellFrameIndex 4
// (peak). loop mode (no window) so frames advance 0,1,2,…,8 then wrap to 0.

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

function tile(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "maya",
    teamId: "claudeteam-alpha",
    display: "Maya",
    role: "Webview UI Dev",
    activity: "idle 30s",
    model: "model:?",
    state: "idle",
    agentId: "",
    toolUseId: null,
    ...overrides,
  };
}

const frameOf = (img: HTMLImageElement | null): number => {
  const m = /frame_(\d+)\.png$/.exec(img?.getAttribute("src") ?? "");
  return m ? Number(m[1]) : -1;
};
const imgIn = (el: HTMLElement): HTMLImageElement =>
  el.querySelector("img.sprite-frame") as HTMLImageElement;

describe("playback resume WIRING — renderAgentTile threads tracker → box (86ca2c4t8 seam)", () => {
  it("a poll re-render RESUMES the in-flight idle cycle instead of restarting at frame 0", () => {
    const tracker = createSpriteTracker();
    // A FRESH scheduler per render — the production re-render disposes the prior
    // box (whose pending timer is gone) and builds a new box on its own timer.
    // Sharing one scheduler would leave the disposed box's stale callbacks
    // queued and pop them on step(); a per-render scheduler models reality.
    const render = (sched: { schedule: (cb: () => void, ms: number) => number }) =>
      renderAgentTile({
        tile: tile(),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0, // idle_coffee
        scheduleFrame: sched.schedule,
        cancelFrame: () => undefined,
      });

    // First render paints frame 0; step the loop to frame 3 (kept clear of the
    // peak frame 4 so this is a plain forward-resume, not a dwell case).
    const s1 = recordingScheduler();
    const first = render(s1);
    expect(frameOf(imgIn(first))).toBe(0);
    s1.step(); // → 1
    s1.step(); // → 2
    s1.step(); // → 3
    expect(frameOf(imgIn(first))).toBe(3);

    // The ~2s poll re-render: a fresh tile for the SAME member + SAME tracker.
    // The tile must read priorPlayback() and thread it so the new box re-shows
    // the displayed frame (3) rather than snapping back to frame 0.
    const s2 = recordingScheduler();
    const second = render(s2);
    expect(frameOf(imgIn(second))).toBe(3);
    // …and the resumed box keeps advancing forward from there (its OWN timer).
    s2.step();
    expect(frameOf(imgIn(second))).toBe(4);
  });

  it("a fresh idle EPISODE (active→idle, pose change) starts the new pose clean at frame 0", () => {
    // Guard the other direction: the resume guard must REJECT a position from a
    // different pose. Render active (active_work), step it, then render idle — the
    // idle box must start at frame 0, not a stale resume from the active cycle.
    const tracker = createSpriteTracker();
    const sched = recordingScheduler();
    renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Edit x", agentId: "a1" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
      scheduleFrame: sched.schedule,
      cancelFrame: () => undefined,
    });
    sched.step();
    sched.step(); // active pose advanced to frame 2
    const idleEl = renderAgentTile({
      tile: tile({ state: "idle", activity: "idle 5s", agentId: "" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
      spriteRng: () => 0, // idle_coffee — DIFFERENT pose than active_work
      scheduleFrame: recordingScheduler().schedule,
      cancelFrame: () => undefined,
    });
    expect(frameOf(imgIn(idleEl))).toBe(0);
  });

  it("crossing the loop boundary survives a re-render (resumes near the wrap, not at 0)", () => {
    // Step to the final frame (8), re-render, and confirm the resumed box re-shows
    // 8 and then WRAPS to 0 — i.e. the loop boundary is crossed by resuming, not
    // by restarting (which would also show 0 but for the wrong reason). Asserting
    // the re-show of 8 first distinguishes resume from restart.
    const tracker = createSpriteTracker();
    const render = (sched: { schedule: (cb: () => void, ms: number) => number }) =>
      renderAgentTile({
        tile: tile(),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0,
        scheduleFrame: sched.schedule,
        cancelFrame: () => undefined,
      });
    const s1 = recordingScheduler();
    const first = render(s1);
    for (let i = 0; i < 8; i++) s1.step(); // 0→8
    expect(frameOf(imgIn(first))).toBe(8);
    const s2 = recordingScheduler();
    const second = render(s2);
    // Resumed on the final frame (NOT restarted at 0)…
    expect(frameOf(imgIn(second))).toBe(8);
    // …then wraps to the loop start on the next step (its OWN timer).
    s2.step();
    expect(frameOf(imgIn(second))).toBe(0);
  });
});

describe("playback resume WIRING — renderMultiAgentPersonaTile threads tracker → box", () => {
  function multiTile(
    overrides: Partial<MultiAgentPersonaTile> = {},
  ): MultiAgentPersonaTile {
    const inst = (id: string): AgentTile => ({
      memberId: "maya",
      teamId: "claudeteam-alpha",
      display: "Maya",
      role: "Webview UI Dev",
      activity: "idle 30s",
      model: "model:?",
      state: "idle",
      agentId: id,
      sessionId: "s1",
      toolUseId: null,
    });
    return {
      memberId: "maya",
      teamId: "claudeteam-alpha",
      display: "Maya",
      role: "Webview UI Dev",
      aggregateState: "idle",
      headlineActivity: "idle 30s",
      headlineModel: "model:?",
      instances: [inst("a1"), inst("a2")],
      ...overrides,
    } as MultiAgentPersonaTile;
  }

  it("the multi-agent persona sprite RESUMES across a poll re-render (same tracker seam as the single tile)", () => {
    const tracker = createSpriteTracker();
    const render = (sched: { schedule: (cb: () => void, ms: number) => number }) =>
      renderMultiAgentPersonaTile({
        tile: multiTile(),
        sessionId: "s1",
        teamId: "claudeteam-alpha",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0, // idle_coffee aggregate pose
        scheduleFrame: sched.schedule,
        cancelFrame: () => undefined,
      });
    const s1 = recordingScheduler();
    const first = render(s1);
    expect(frameOf(imgIn(first))).toBe(0);
    s1.step(); // 1
    s1.step(); // 2
    expect(frameOf(imgIn(first))).toBe(2);
    const s2 = recordingScheduler();
    const second = render(s2);
    // Resumed on frame 2, not restarted at 0 — proves the multi-tile threads the
    // tracker's priorPlayback exactly like the single tile (the seam was added
    // separately per-tile, so it needs its OWN regression test).
    expect(frameOf(imgIn(second))).toBe(2);
    s2.step();
    expect(frameOf(imgIn(second))).toBe(3);
  });
});
