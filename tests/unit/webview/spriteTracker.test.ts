/**
 * Unit tests for the sprite tracker (idle-episode stickiness + timer disposal +
 * playback-position resume — E1 live-preview fix 86ca2c4t8).
 *
 * Node environment — pure Map logic, no DOM.
 */

import { describe, it, expect, vi } from "vitest";
import { createSpriteTracker } from "../../../src/webview/spriteTracker.js";

/** Minimal register entry with the required pose/currentFrame fields defaulted. */
function entry(over: {
  idlePick?: string | null;
  activePick?: string | null;
  activeRotIdx?: number;
  activeLoopCount?: number;
  isActive?: boolean;
  dispose?: () => void;
  pose?: string;
  frameIdx?: number;
  direction?: number;
  elapsedMs?: number;
}) {
  return {
    idlePick: over.idlePick ?? null,
    activePick: over.activePick ?? null,
    activeRotIdx: over.activeRotIdx ?? 0,
    activeLoopCount: over.activeLoopCount ?? 0,
    isActive: over.isActive ?? false,
    dispose: over.dispose ?? (() => undefined),
    pose: over.pose ?? "idle_coffee",
    currentFrame: () => ({
      frameIdx: over.frameIdx ?? 0,
      direction: over.direction ?? 1,
      elapsedMs: over.elapsedMs ?? 0,
    }),
  };
}

describe("spriteTracker", () => {
  it("remembers the prior idle pick + active flag per member", () => {
    const t = createSpriteTracker();
    t.register("s1", "maya", entry({ idlePick: "idle_snack", isActive: false }));
    expect(t.priorIdlePick("s1", "maya")).toBe("idle_snack");
    expect(t.priorWasActive("s1", "maya")).toBe(false);
  });

  it("returns undefined / false for an unseen member", () => {
    const t = createSpriteTracker();
    expect(t.priorIdlePick("s1", "ghost")).toBeUndefined();
    expect(t.priorActivePick("s1", "ghost")).toBeUndefined();
    expect(t.priorWasActive("s1", "ghost")).toBe(false);
    expect(t.priorPlayback("s1", "ghost")).toBeUndefined();
  });

  it("remembers the prior active pick per member (ticket 86ca3mge9)", () => {
    const t = createSpriteTracker();
    t.register(
      "s1",
      "felix",
      entry({ activePick: "work_cycle", isActive: true, pose: "work_cycle" }),
    );
    expect(t.priorActivePick("s1", "felix")).toBe("work_cycle");
    expect(t.priorWasActive("s1", "felix")).toBe(true);
  });

  it("remembers the active-pool rotation cursor + loop-count (ticket 86ca4atwt)", () => {
    const t = createSpriteTracker();
    t.register(
      "s1",
      "felix",
      entry({
        activePick: "work_focus",
        isActive: true,
        pose: "work_focus",
        activeRotIdx: 2,
        activeLoopCount: 1,
      }),
    );
    expect(t.priorActiveRotIdx("s1", "felix")).toBe(2);
    expect(t.priorActiveLoopCount("s1", "felix")).toBe(1);
    // Unseen member → undefined (so the player resets to a fresh active episode).
    expect(t.priorActiveRotIdx("s1", "ghost")).toBeUndefined();
    expect(t.priorActiveLoopCount("s1", "ghost")).toBeUndefined();
  });

  it("priorActivePick is undefined when the prior box stored a null pick", () => {
    const t = createSpriteTracker();
    // An active_read episode (or no-pool character) registers activePick: null.
    t.register(
      "s1",
      "felix",
      entry({ activePick: null, isActive: true, pose: "active_read" }),
    );
    expect(t.priorActivePick("s1", "felix")).toBeUndefined();
  });

  it("disposes the prior handle when re-registering the same key", () => {
    const t = createSpriteTracker();
    const dispose1 = vi.fn();
    t.register("s1", "maya", entry({ idlePick: "a", dispose: dispose1 }));
    const dispose2 = vi.fn();
    t.register("s1", "maya", entry({ idlePick: "b", dispose: dispose2 }));
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).not.toHaveBeenCalled();
    expect(t.size()).toBe(1);
  });

  it("prune disposes + drops entries no longer present", () => {
    const t = createSpriteTracker();
    const disposeStale = vi.fn();
    const disposeKept = vi.fn();
    t.register("s1", "maya", entry({ idlePick: "a", dispose: disposeKept }));
    t.register("s1", "felix", entry({ idlePick: "b", dispose: disposeStale }));
    t.prune(new Set(["s1:maya"]));
    expect(disposeStale).toHaveBeenCalledTimes(1);
    expect(disposeKept).not.toHaveBeenCalled();
    expect(t.size()).toBe(1);
    expect(t.priorIdlePick("s1", "maya")).toBe("a");
  });

  // ── Playback-position resume (E1 live-preview fix 86ca2c4t8) ───────────────
  it("priorPlayback reports the prior box's pose + live frame position", () => {
    const t = createSpriteTracker();
    t.register(
      "s1",
      "felix",
      entry({ pose: "idle_stretch", frameIdx: 8, direction: -1, elapsedMs: 120 }),
    );
    const pp = t.priorPlayback("s1", "felix");
    expect(pp).toEqual({
      pose: "idle_stretch",
      frameIdx: 8,
      direction: -1,
      elapsedMs: 120,
    });
  });

  it("priorPlayback reads currentFrame LIVE (not a snapshot taken at register time)", () => {
    const t = createSpriteTracker();
    // The box's frameIdx mutates over time as the loop ticks; the tracker must
    // read it through the closure at query time, not freeze it at register.
    let live = 5;
    t.register("s1", "felix", {
      idlePick: "idle_stretch",
      activePick: null,
      activeRotIdx: 0,
      activeLoopCount: 0,
      isActive: false,
      dispose: () => undefined,
      pose: "idle_stretch",
      currentFrame: () => ({ frameIdx: live, direction: 1, elapsedMs: 0 }),
    });
    expect(t.priorPlayback("s1", "felix")?.frameIdx).toBe(5);
    live = 9; // the loop advanced
    expect(t.priorPlayback("s1", "felix")?.frameIdx).toBe(9);
  });
});
