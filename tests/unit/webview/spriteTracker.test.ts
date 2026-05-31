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
  isActive?: boolean;
  dispose?: () => void;
  pose?: string;
  frameIdx?: number;
  direction?: number;
}) {
  return {
    idlePick: over.idlePick ?? null,
    isActive: over.isActive ?? false,
    dispose: over.dispose ?? (() => undefined),
    pose: over.pose ?? "idle_coffee",
    currentFrame: () => ({
      frameIdx: over.frameIdx ?? 0,
      direction: over.direction ?? 1,
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
    expect(t.priorWasActive("s1", "ghost")).toBe(false);
    expect(t.priorPlayback("s1", "ghost")).toBeUndefined();
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
      entry({ pose: "idle_stretch", frameIdx: 8, direction: -1 }),
    );
    const pp = t.priorPlayback("s1", "felix");
    expect(pp).toEqual({ pose: "idle_stretch", frameIdx: 8, direction: -1 });
  });

  it("priorPlayback reads currentFrame LIVE (not a snapshot taken at register time)", () => {
    const t = createSpriteTracker();
    // The box's frameIdx mutates over time as the loop ticks; the tracker must
    // read it through the closure at query time, not freeze it at register.
    let live = 5;
    t.register("s1", "felix", {
      idlePick: "idle_stretch",
      isActive: false,
      dispose: () => undefined,
      pose: "idle_stretch",
      currentFrame: () => ({ frameIdx: live, direction: 1 }),
    });
    expect(t.priorPlayback("s1", "felix")?.frameIdx).toBe(5);
    live = 9; // the loop advanced
    expect(t.priorPlayback("s1", "felix")?.frameIdx).toBe(9);
  });
});
