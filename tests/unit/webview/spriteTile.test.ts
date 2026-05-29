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
  DWELL_MS_DEFAULT,
  PEAK_DWELL_MS_DEFAULT,
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
    // active_read now resolves to the shared desk state (read-at-screen),
    // NOT the standalone book-reading pose (which moved to the idle pool).
    expect(img.getAttribute("src")).toContain("sitting_at_a_desk_fa");
    expect(img.getAttribute("src")).not.toContain("reading_an_open_book");
    expect(el.querySelector(".sprite-box")?.getAttribute("data-pose")).toBe(
      "active_read",
    );
  });

  it("running + tool!=Read renders the active_work pose", () => {
    const el = renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Edit reducer.ts", agentId: "a2" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      scheduleFrame: recordingScheduler().schedule,
    });
    const img = el.querySelector("img.sprite-frame") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain("sitting_at_a_desk");
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

describe("sprite rendering — AC3 slow playback + dwell", () => {
  // The default tile member is `maya` → ClaudeTeam-F01-Dev. active_work and
  // idle_coffee are both in the 50%-speed list (86ca1fntp), so their base
  // per-frame ms is FRAME_MS_DEFAULT / 0.5 = 2× the default.
  const HALF_SPEED_MS = FRAME_MS_DEFAULT / 0.5;

  it("schedules the first frame at the tuned (50% speed) duration", () => {
    const sched = recordingScheduler();
    renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Edit x", agentId: "a4" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      scheduleFrame: sched.schedule,
    });
    // active_work is a 50%-speed pose → first frame held at 2× the default.
    expect(sched.calls[0]).toBe(HALF_SPEED_MS);
  });

  it("dwells on the final frame of an idle loop before restarting", () => {
    const sched = recordingScheduler();
    // idle_coffee has 9 frames (indices 0..8). The delay scheduled AFTER the
    // final frame (idx 8) carries the final-frame dwell, on top of the
    // 50%-speed base ms.
    renderAgentTile({
      tile: tile({ state: "idle", activity: "idle 30s", agentId: "a5" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0, // idle_coffee
      scheduleFrame: sched.schedule,
    });
    // Step through to the last frame. coffee = 9 frames → 8 steps to reach idx 8.
    for (let i = 0; i < 8; i++) {
      sched.step();
    }
    // Final frame (8) ≠ peak frame (4) for coffee, so only the final-frame
    // dwell applies here, on the 50%-speed base.
    expect(sched.calls[sched.calls.length - 1]).toBe(
      HALF_SPEED_MS + DWELL_MS_DEFAULT,
    );
  });

  it("active poses loop at uniform cadence (NO dwell on final frame)", () => {
    const sched = recordingScheduler();
    // active_work has 9 frames; step to the last and confirm uniform (no
    // final-frame dwell) cadence — at the tuned 50% speed.
    renderAgentTile({
      tile: tile({ state: "running", activity: "tool:Edit x", agentId: "a6" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      scheduleFrame: sched.schedule,
    });
    for (let i = 0; i < 8; i++) {
      sched.step();
    }
    expect(sched.calls[sched.calls.length - 1]).toBe(HALF_SPEED_MS);
  });

  it("holds the mid-sequence peak frame longer (idle_coffee → frame 4)", () => {
    const sched = recordingScheduler();
    // idle_coffee peak (cup-at-mouth hold) is frame 4 for both characters.
    // The delay scheduled WHILE SHOWING frame 4 carries the peak dwell.
    renderAgentTile({
      tile: tile({ state: "idle", activity: "idle 30s", agentId: "a9" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      spriteRng: () => 0, // idle_coffee
      scheduleFrame: sched.schedule,
    });
    // Frame 0 shown immediately (calls[0]); each step advances one frame.
    // After 4 steps we are showing frame 4 → calls[4] is the peak-dwell delay.
    for (let i = 0; i < 4; i++) {
      sched.step();
    }
    // Peak frame (4) is not the final frame (8) → base 50% speed + peak dwell.
    expect(sched.calls[4]).toBe(HALF_SPEED_MS + PEAK_DWELL_MS_DEFAULT);
    // And a non-peak, non-final idle frame (e.g. frame 1) is the plain base ms.
    expect(sched.calls[1]).toBe(HALF_SPEED_MS);
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
