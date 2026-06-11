/**
 * @vitest-environment jsdom
 *
 * Component tests for persona pixel-character sprite rendering in the agent
 * tile (agentTile.ts + spritePlayer.ts). Covers the ticket ACs:
 *   - AC2: pose selection — active_read (tool==Read), active_work (tool!=Read),
 *          idle-pool member for idle/available/finished.
 *   - AC3: SLOW playback + dwell-before-restart at render time (injected
 *          scheduler asserts per-frame ms + final-frame dwell).
 *   - AC4: prefers-reduced-motion → single static frame, no timer scheduled.
 *   - AC5: sprite-less member (no binding) → no sprite box, no <img>, no
 *          broken image; tile renders text-only.
 *
 * The sprite base URI + tracker + injected RNG/scheduler keep these
 * deterministic without a live host or real timers.
 */

import { describe, it, expect, vi } from "vitest";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { createSpriteTracker } from "../../../src/webview/spriteTracker.js";
import {
  FRAME_MS_DEFAULT,
  resolvePlayback,
} from "../../../src/webview/sprites/spritePlayer.js";
import type { AgentTile, AgentState } from "../../../src/shared/types.js";

const BASE = "vscode-webview://abc/dist/webview";

function tile(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "maya",
    teamId: "claudeteam-alpha",
    display: "Maya",
    role: "Webview UI Dev",
    activity: "available",
    model: "model:?",
    state: "available",
    agentId: "",
    toolUseId: null,
    ...overrides,
  };
}

/** A scheduler that records (ms) per call and never fires — lets us inspect
 * the FIRST scheduled delay deterministically. */
function recordingScheduler() {
  const calls: number[] = [];
  const cbs: Array<() => void> = [];
  const schedule = (cb: () => void, ms: number): number => {
    calls.push(ms);
    cbs.push(cb);
    return calls.length; // opaque handle
  };
  const step = (): void => {
    const cb = cbs.shift();
    if (cb) cb();
  };
  return { calls, schedule, step };
}

describe("sprite rendering — AC2 pose selection", () => {
  it("running + tool==Read renders the active_read DESK pose (read-at-screen, not the book)", () => {
    const sched = recordingScheduler();
    const el = renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Read src/x.ts", agentId: "a1" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      scheduleFrame: sched.schedule,
    });
    const img = el.querySelector("img.sprite-frame") as HTMLImageElement;
    expect(img).not.toBeNull();
    // active_read now resolves to the shared v3 desk state (read-at-screen),
    // NOT the standalone book-reading pose (retired with the legacy 68×68 build).
    expect(img.getAttribute("src")).toContain("Sitting_at_a_desk_wo");
    expect(img.getAttribute("src")).not.toContain("reading_an_open_book");
    expect(el.querySelector(".sprite-box")?.getAttribute("data-pose")).toBe(
      "active_read",
    );
  });

  it("running + tool!=Read renders the active_work desk pose (v3 1-member active_pool, ticket 86ca5ftzp)", () => {
    const el = renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Edit reducer.ts", agentId: "a2" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0, // 1-member active_pool → active_work → shared desk state
      scheduleFrame: recordingScheduler().schedule,
    });
    const img = el.querySelector("img.sprite-frame") as HTMLImageElement;
    // v3 F01 has a single-member active_pool [active_work] sharing the desk state.
    expect(img.getAttribute("src")).toContain("Sitting_at_a_desk_wo");
    expect(el.querySelector(".sprite-box")?.getAttribute("data-pose")).toBe(
      "active_work",
    );
  });

  it.each(["idle", "available", "finished"] as const)(
    "%s renders a deterministic idle-pool pose (rng=0 → first pool member)",
    (state: AgentState) => {
      const el = renderAgentTile({
        tile: tile({ state, agentId: state === "available" ? "" : "a3" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: createSpriteTracker(),
        spriteRng: () => 0,
        scheduleFrame: recordingScheduler().schedule,
      });
      // rng=0 → idle_coffee (first pool member) → folder holding_a_coffee_cup
      const img = el.querySelector("img.sprite-frame") as HTMLImageElement;
      expect(img.getAttribute("src")).toContain("holding_a_coffee_cup");
      expect(el.querySelector(".sprite-box")?.getAttribute("data-pose")).toBe(
        "idle_coffee",
      );
    },
  );
});

describe("sprite rendering — AC3 slow playback + dwell (tile WIRES manifest speed → scheduler)", () => {
  // The default tile member is `maya` → ClaudeTeam-F01-Dev (v3 92×92). The
  // per-frame ms the scheduler receives is FRAME_MS_DEFAULT / resolved-speed for
  // the rendered pose. The F01 SPEEDS are SPONSOR-TUNED in the live Playback
  // Tuner (PR #210) and change freely, so these tests DATA-DERIVE the expected
  // base ms from the manifest (resolvePlayback off GENERATED_SPRITE_MANIFEST)
  // rather than freezing a 0.5 / 0.6 constant — a future retune can't re-break
  // them. The frame-by-frame dwell/peak/composition ENGINE math is covered
  // non-vacuously against injected fixtures in spritePlayer.test.ts; here we only
  // assert the TILE threads the resolved speed through to the scheduler.
  const F01 = "ClaudeTeam-F01-Dev";
  const baseMsFor = (anim: string): number => {
    const pb = resolvePlayback(F01, anim);
    const speed =
      typeof pb.speedMultiplier === "number" && pb.speedMultiplier > 0
        ? pb.speedMultiplier
        : 1;
    return FRAME_MS_DEFAULT / speed;
  };
  // Find the first scheduled delay for a frame that is NEITHER the pose's peak
  // (dwellFrameIndex) NOR a window endpoint — i.e. a plain base-ms frame, so the
  // assertion isolates the SPEED wiring from any dwell add-on. For F01 active_work
  // and idle_coffee the peak is frame 0; the second scheduled call (frame 1) is a
  // plain interior frame for both, so it equals the pure base ms.
  it("schedules an interior frame of active_work at the manifest-derived base ms", () => {
    const sched = recordingScheduler();
    renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Edit x", agentId: "a4" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      scheduleFrame: sched.schedule,
    });
    sched.step(); // advance to frame 1 (interior, non-peak, non-endpoint)
    expect(sched.calls[1]).toBe(baseMsFor("active_work"));
  });

  it("schedules an interior frame of idle_coffee at the manifest-derived base ms", () => {
    const sched = recordingScheduler();
    renderAgentTile({
      tile: tile({ state: "idle", activity: "idle 30s", agentId: "a5" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0, // idle_coffee
      scheduleFrame: sched.schedule,
    });
    sched.step(); // advance to frame 1 (interior, non-peak)
    // Frame 1 is neither the peak (frame 0) nor a window endpoint → plain base ms.
    expect(sched.calls[1]).toBe(baseMsFor("idle_coffee"));
  });

  it("holds the pose's apex frame longer than a plain interior frame (dwell wired through)", () => {
    const sched = recordingScheduler();
    // idle_coffee's apex is its dwellFrameIndex (frame 0 in the live F01 tune).
    // The delay scheduled WHILE SHOWING the apex carries the peak dwell on top of
    // the base ms — so it must EXCEED a plain interior frame's base ms. Asserting
    // the inequality (not a frozen ms) keeps this tuning-proof while still proving
    // the tile threads the dwell, not just the speed.
    renderAgentTile({
      tile: tile({ state: "idle", activity: "idle 30s", agentId: "a9" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0, // idle_coffee
      scheduleFrame: sched.schedule,
    });
    const pb = resolvePlayback(F01, "idle_coffee");
    const apex =
      typeof pb.dwellFrameIndex === "number" ? pb.dwellFrameIndex : 0;
    const base = baseMsFor("idle_coffee");
    // Step to the apex frame; calls[apex] is the delay scheduled while showing it.
    for (let i = 0; i < apex; i++) sched.step();
    expect(sched.calls[apex]).toBeGreaterThan(base);
  });
});

describe("sprite rendering — AC4 reduced motion", () => {
  it("shows a single static frame and schedules NO timer", () => {
    const schedule = vi.fn();
    const el = renderAgentTile({
      tile: tile({ state: "idle", activity: "idle 5s", agentId: "a7" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0,
      reducedMotion: true,
      scheduleFrame: schedule,
    });
    const box = el.querySelector(".sprite-box") as HTMLElement;
    const img = el.querySelector("img.sprite-frame") as HTMLImageElement;
    expect(box.getAttribute("data-reduced-motion")).toBe("true");
    expect(img.getAttribute("src")).toMatch(/frame_000\.png$/);
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("sprite rendering — AC5 graceful degrade", () => {
  it("a sprite-less (unbound) member renders NO sprite box and NO img", () => {
    // E-07b: all six ROSTER members are now bound by gender, so the graceful-
    // degrade path is exercised with an id that is NOT in MEMBER_SPRITE_BINDING
    // (an unrostered / unknown member id).
    const el = renderAgentTile({
      tile: tile({ memberId: "ghost", display: "Ghost", state: "available" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
    });
    expect(el.querySelector(".sprite-box")).toBeNull();
    expect(el.querySelector("img")).toBeNull();
    expect(el.getAttribute("data-has-sprite")).toBeNull();
    // The text rows still render (text-only tile).
    expect(el.querySelector(".agent-display")?.textContent).toBe("Ghost");
  });

  it("no sprite box when spriteBaseUri is absent (browser-dev / test mode)", () => {
    const el = renderAgentTile({
      tile: tile({ memberId: "maya", state: "available" }),
      sessionId: "s1",
      postMessage: () => undefined,
    });
    expect(el.querySelector(".sprite-box")).toBeNull();
    expect(el.getAttribute("data-has-sprite")).toBeNull();
  });

  it("a bound member sets data-has-sprite and prepends the sprite box", () => {
    const el = renderAgentTile({
      tile: tile({ memberId: "felix", display: "Felix", state: "available" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0,
      scheduleFrame: recordingScheduler().schedule,
    });
    expect(el.getAttribute("data-has-sprite")).toBe("true");
    expect(el.querySelector(".sprite-box")).not.toBeNull();
  });
});

describe("idle-episode stickiness — AC2 / spec §3.3", () => {
  it("keeps the same idle pose across re-renders (no re-roll mid-episode)", () => {
    const tracker = createSpriteTracker();
    let rngVal = 0; // first render → idle_coffee
    const rng = () => rngVal;
    const render = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "idle", activity: "idle 10s", agentId: "" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: rng,
        scheduleFrame: recordingScheduler().schedule,
      });
    const first = render();
    const firstPose = first.querySelector(".sprite-box")?.getAttribute("data-pose");
    // Change rng — a naive re-roll would pick a different pose. Stickiness
    // must keep the prior pick because the prior render was also idle.
    rngVal = 0.99;
    const second = render();
    const secondPose = second.querySelector(".sprite-box")?.getAttribute("data-pose");
    expect(secondPose).toBe(firstPose);
  });

  it("re-rolls the idle pose on a fresh idle episode (active → idle)", () => {
    const tracker = createSpriteTracker();
    const renderActive = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "running", activity: "tool:Edit x", agentId: "a8" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        scheduleFrame: recordingScheduler().schedule,
      });
    const renderIdle = (rng: number) =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "idle", activity: "idle 10s", agentId: "" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => rng,
        scheduleFrame: recordingScheduler().schedule,
      });
    renderActive(); // prior pose active
    const idleEl = renderIdle(0.99); // fresh episode → rng picks last pool member
    const pose = idleEl.querySelector(".sprite-box")?.getAttribute("data-pose");
    // rng=0.99 over a 13-member pool → a non-first pose (proves a re-roll happened)
    expect(pose).not.toBe("idle_coffee");
  });
});

// ── Active-work POOL episode stickiness — END-TO-END through the tile caller
//    (Sage QA gap-fill for ticket 86ca3mge9) ─────────────────────────────────
//
// spritePlayer.test.ts already proves the createSpriteBox stickiness math in
// isolation (threading priorActivePick by hand). These tests drive TWO real
// `renderAgentTile` poll re-renders through a SHARED tracker so the wiring
// agentTile → tracker.priorActivePick/priorWasActive → createSpriteBox →
// tracker.register is exercised end-to-end — the exact Layer-2.5 poll-tick
// survivability seam the testing-strategy doc marks REQUIRED for functional
// behavior. The idle equivalents above proved idle stickiness this way; the
// active pool had no through-the-tile counterpart until now.
//
// maya → ClaudeTeam-F01-Dev. Every shipped persona is now the v3 92×92 build
// (F01 overwritten in place 86ca5j1mt), which carries a SINGLE-member active_pool
// [active_work] (ticket 86ca5ftzp) — so `pickActive` always returns active_work,
// keeping the dashboard pose identical to a no-pool char while still feeding the
// tuner's Active-pool controls. The MULTI-pose rotation ENGINE (in-order advance,
// cursor survival across re-render, read→work resume from a non-zero cursor) is
// covered non-vacuously against a synthetic 3-pose pool in
// spritePlayerActiveRotation.test.ts; this block asserts the v3 single-pose path
// END-TO-END through the tile.
//
// Non-vacuity (revert checklist):
//   - "active_work stable across re-render": if agentTile stops threading the
//     active pick / resume, the pose flickers or resets across the poll re-render.
//   - "work→read resolves active_read (never pool-drawn)": if the Read gate is
//     dropped, the read render shows active_work → the active_read assertion FAILS.
describe("active-pool (v3 single-member) — END-TO-END through the tile (86ca5ftzp)", () => {
  it("keeps active_work across re-renders within an active episode", () => {
    const tracker = createSpriteTracker();
    const render = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "running", activity: "tool:Edit reducer.ts", agentId: "a10" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0.99, // 1-member pool → rng irrelevant → always active_work
        // No frame scheduler stepping → no loop completes → cursor never advances,
        // so the pose is STABLE across the two poll re-renders.
        scheduleFrame: recordingScheduler().schedule,
      });
    const first = render();
    const firstPose = first.querySelector(".sprite-box")?.getAttribute("data-pose");
    expect(firstPose).toBe("active_work"); // sole active_pool member
    const second = render();
    const secondPose = second.querySelector(".sprite-box")?.getAttribute("data-pose");
    expect(secondPose).toBe(firstPose); // cursor survived the re-render
  });

  it("read→work resumes active_work (active_read freezes the single-member cursor)", () => {
    const tracker = createSpriteTracker();
    const renderRead = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "running", activity: "tool:Read src/x.ts", agentId: "a11" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0,
        scheduleFrame: recordingScheduler().schedule,
      });
    const renderWork = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "running", activity: "tool:Edit reducer.ts", agentId: "a11" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0,
        scheduleFrame: recordingScheduler().schedule,
      });
    // First a work render establishes the active episode at active_work...
    expect(renderWork().querySelector(".sprite-box")?.getAttribute("data-pose")).toBe("active_work");
    // ...a Read renders active_read (never pool-drawn)...
    const readEl = renderRead();
    expect(readEl.querySelector(".sprite-box")?.getAttribute("data-pose")).toBe("active_read");
    // ...read→work resumes the (single-member) cursor → active_work, not a flip.
    const workEl = renderWork();
    expect(workEl.querySelector(".sprite-box")?.getAttribute("data-pose")).toBe("active_work");
  });

  it("work→read resolves active_read (not a pool pose)", () => {
    const tracker = createSpriteTracker();
    const renderWork = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "running", activity: "tool:Edit reducer.ts", agentId: "a12" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0,
        scheduleFrame: recordingScheduler().schedule,
      });
    const renderRead = () =>
      renderAgentTile({
        tile: tile({ memberId: "maya", state: "running", activity: "tool:Read src/x.ts", agentId: "a12" }),
        sessionId: "s1",
        postMessage: () => undefined,
        spriteBaseUri: BASE,
        spriteTracker: tracker,
        spriteRng: () => 0,
        scheduleFrame: recordingScheduler().schedule,
      });
    expect(renderWork().querySelector(".sprite-box")?.getAttribute("data-pose")).toBe("active_work");
    // work→read: the Read tool resolves active_read regardless of the threaded
    // working pick — active_read is never pool-drawn.
    expect(renderRead().querySelector(".sprite-box")?.getAttribute("data-pose")).toBe("active_read");
  });
});
