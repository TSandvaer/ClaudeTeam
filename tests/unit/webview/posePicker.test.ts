/**
 * Unit tests for the pure pose-selection logic (posePicker.ts).
 *
 * Covers AC2 (pose → state) + AC6 (resolve via the character manifest):
 *   - active_read on tool == Read
 *   - active_work on tool != Read (incl. the `tool:?` sentinel)
 *   - idle-pool member otherwise (idle / available / finished / error)
 *   - graceful resolve fallback when a named pose is absent
 *   - deterministic idle pick under an injected RNG
 *
 * Pure functions — node environment, no DOM.
 */

import { describe, it, expect } from "vitest";
import {
  poseNameForTile,
  resolvePose,
  pickIdle,
  pickActive,
  toolFromActivity,
  ACTIVE_READ,
  ACTIVE_WORK,
} from "../../../src/webview/sprites/posePicker.js";
import type { SpriteCharacter } from "../../../src/webview/sprites/spriteManifest.js";

const CHAR: SpriteCharacter = {
  character: "Test-Char",
  defaultIdle: "idle_coffee",
  idlePool: ["idle_coffee", "idle_snack", "idle_phone"],
  activePool: ["typing", "work_cycle", "work_focus"],
  animations: {
    idle_coffee: { folder: "coffee", frames: ["a.png", "b.png"] },
    idle_snack: { folder: "snack", frames: ["c.png"] },
    idle_phone: { folder: "phone", frames: ["d.png"] },
    active_read: { folder: "read", frames: ["r1.png", "r2.png"] },
    active_work: { folder: "work", frames: ["w1.png", "w2.png"] },
    typing: { folder: "typing", frames: ["t1.png", "t2.png"] },
    work_cycle: { folder: "cycle", frames: ["wc1.png", "wc2.png"] },
    work_focus: { folder: "focus", frames: ["wf1.png", "wf2.png"] },
  },
};

describe("toolFromActivity", () => {
  it("extracts the tool name from a running activity string", () => {
    expect(toolFromActivity("tool:Read src/x.ts")).toBe("Read");
    expect(toolFromActivity("tool:Edit reducer.ts")).toBe("Edit");
  });
  it("returns the sentinel for tool:?", () => {
    expect(toolFromActivity("tool:?")).toBe("?");
  });
  it("returns null for non-tool activity", () => {
    expect(toolFromActivity("finished 4m")).toBeNull();
    expect(toolFromActivity("available")).toBeNull();
  });
});

describe("poseNameForTile — AC2", () => {
  it("running + tool==Read → active_read", () => {
    const r = poseNameForTile("running", "tool:Read src/x.ts", null);
    expect(r.name).toBe(ACTIVE_READ);
    expect(r.isActive).toBe(true);
  });

  it("running + tool!=Read → active_work", () => {
    const r = poseNameForTile("running", "tool:Edit reducer.ts", null);
    expect(r.name).toBe(ACTIVE_WORK);
    expect(r.isActive).toBe(true);
  });

  it("running + tool:? sentinel → active_work (non-Read)", () => {
    const r = poseNameForTile("running", "tool:?", null);
    expect(r.name).toBe(ACTIVE_WORK);
    expect(r.isActive).toBe(true);
  });

  it.each(["idle", "available", "finished", "error"] as const)(
    "%s → idle-pool member (uses injected pick)",
    (state) => {
      const r = poseNameForTile(state, "whatever", "idle_snack");
      expect(r.name).toBe("idle_snack");
      expect(r.isActive).toBe(false);
    },
  );
});

describe("resolvePose — AC6 + fallbacks", () => {
  it("returns the exact animation when named", () => {
    expect(resolvePose(CHAR, "active_read")?.folder).toBe("read");
    expect(resolvePose(CHAR, "idle_phone")?.folder).toBe("phone");
  });

  it("falls back to default idle when the named active pose is absent", () => {
    const noActive: SpriteCharacter = {
      ...CHAR,
      animations: {
        idle_coffee: CHAR.animations.idle_coffee,
      },
    };
    expect(resolvePose(noActive, "active_read")?.folder).toBe("coffee");
  });

  it("returns null when the character has no animations at all", () => {
    const empty: SpriteCharacter = {
      character: "Empty",
      defaultIdle: null,
      idlePool: [],
      activePool: [],
      animations: {},
    };
    expect(resolvePose(empty, "active_work")).toBeNull();
  });
});

describe("poseNameForTile — active pool (ticket 86ca3mge9)", () => {
  it("running + tool!=Read + activePick → uses the active-pool pick", () => {
    const r = poseNameForTile("running", "tool:Edit reducer.ts", null, "work_cycle");
    expect(r.name).toBe("work_cycle");
    expect(r.isActive).toBe(true);
  });

  it("running + tool!=Read + null activePick → falls back to active_work", () => {
    const r = poseNameForTile("running", "tool:Edit reducer.ts", null, null);
    expect(r.name).toBe(ACTIVE_WORK);
    expect(r.isActive).toBe(true);
  });

  it("running + tool:? sentinel + activePick → uses the pick (non-Read)", () => {
    const r = poseNameForTile("running", "tool:?", null, "typing");
    expect(r.name).toBe("typing");
    expect(r.isActive).toBe(true);
  });

  it("running + tool==Read ignores activePick → always active_read", () => {
    const r = poseNameForTile("running", "tool:Read src/x.ts", null, "work_focus");
    expect(r.name).toBe(ACTIVE_READ);
    expect(r.isActive).toBe(true);
  });

  it("idle ignores activePick → uses the idle pick", () => {
    const r = poseNameForTile("idle", "whatever", "idle_snack", "work_cycle");
    expect(r.name).toBe("idle_snack");
    expect(r.isActive).toBe(false);
  });
});

describe("pickActive — deterministic under injected RNG (ticket 86ca3mge9)", () => {
  it("picks the active-pool member at the rng-derived index", () => {
    // pool length 3; rng 0 → idx 0, 0.5 → idx 1, 0.99 → idx 2
    expect(pickActive(CHAR, () => 0)).toBe("typing");
    expect(pickActive(CHAR, () => 0.5)).toBe("work_cycle");
    expect(pickActive(CHAR, () => 0.99)).toBe("work_focus");
  });

  it("clamps rng=1.0 to the last index (no out-of-bounds)", () => {
    expect(pickActive(CHAR, () => 1)).toBe("work_focus");
  });

  it("every pick is a member of the active pool (membership invariant)", () => {
    for (let i = 0; i < 50; i++) {
      const pick = pickActive(CHAR, () => i / 50);
      expect(CHAR.activePool).toContain(pick);
    }
  });

  it("returns null when the active pool is empty (no-pool character)", () => {
    const noPool: SpriteCharacter = { ...CHAR, activePool: [] };
    expect(pickActive(noPool, () => 0)).toBeNull();
  });
});

describe("pickIdle — deterministic under injected RNG", () => {
  it("picks the pool member at the rng-derived index", () => {
    // pool length 3; rng 0 → idx 0, 0.5 → idx 1, 0.99 → idx 2
    expect(pickIdle(CHAR, () => 0)).toBe("idle_coffee");
    expect(pickIdle(CHAR, () => 0.5)).toBe("idle_snack");
    expect(pickIdle(CHAR, () => 0.99)).toBe("idle_phone");
  });

  it("clamps rng=1.0 to the last index (no out-of-bounds)", () => {
    expect(pickIdle(CHAR, () => 1)).toBe("idle_phone");
  });

  it("falls back to defaultIdle when the pool is empty", () => {
    const noPool: SpriteCharacter = {
      ...CHAR,
      idlePool: [],
      animations: { idle_coffee: CHAR.animations.idle_coffee },
    };
    expect(pickIdle(noPool, () => 0)).toBe("idle_coffee");
  });
});
