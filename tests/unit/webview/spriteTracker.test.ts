/**
 * Unit tests for the sprite tracker (idle-episode stickiness + timer disposal).
 *
 * Node environment — pure Map logic, no DOM.
 */

import { describe, it, expect, vi } from "vitest";
import { createSpriteTracker } from "../../../src/webview/spriteTracker.js";

describe("spriteTracker", () => {
  it("remembers the prior idle pick + active flag per member", () => {
    const t = createSpriteTracker();
    t.register("s1", "maya", {
      idlePick: "idle_snack",
      isActive: false,
      dispose: () => undefined,
    });
    expect(t.priorIdlePick("s1", "maya")).toBe("idle_snack");
    expect(t.priorWasActive("s1", "maya")).toBe(false);
  });

  it("returns undefined / false for an unseen member", () => {
    const t = createSpriteTracker();
    expect(t.priorIdlePick("s1", "ghost")).toBeUndefined();
    expect(t.priorWasActive("s1", "ghost")).toBe(false);
  });

  it("disposes the prior handle when re-registering the same key", () => {
    const t = createSpriteTracker();
    const dispose1 = vi.fn();
    t.register("s1", "maya", { idlePick: "a", isActive: false, dispose: dispose1 });
    const dispose2 = vi.fn();
    t.register("s1", "maya", { idlePick: "b", isActive: false, dispose: dispose2 });
    expect(dispose1).toHaveBeenCalledTimes(1);
    expect(dispose2).not.toHaveBeenCalled();
    expect(t.size()).toBe(1);
  });

  it("prune disposes + drops entries no longer present", () => {
    const t = createSpriteTracker();
    const disposeStale = vi.fn();
    const disposeKept = vi.fn();
    t.register("s1", "maya", { idlePick: "a", isActive: false, dispose: disposeKept });
    t.register("s1", "felix", { idlePick: "b", isActive: false, dispose: disposeStale });
    t.prune(new Set(["s1:maya"]));
    expect(disposeStale).toHaveBeenCalledTimes(1);
    expect(disposeKept).not.toHaveBeenCalled();
    expect(t.size()).toBe(1);
    expect(t.priorIdlePick("s1", "maya")).toBe("a");
  });
});
