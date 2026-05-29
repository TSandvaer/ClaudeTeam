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
  toolFromActivity,
  ACTIVE_READ,
  ACTIVE_WORK,
} from "../../../src/webview/sprites/posePicker.js";
import type { SpriteCharacter } from "../../../src/webview/sprites/spriteManifest.js";

const CHAR: SpriteCharacter = {
  character: "Test-Char",
  defaultIdle: "idle_coffee",
  idlePool: ["idle_coffee", "idle_snack", "idle_phone"],
  animations: {
    idle_coffee: { folder: "coffee", frames: ["a.png", "b.png"] },
    idle_snack: { folder: "snack", frames: ["c.png"] },
    idle_phone: { folder: "phone", frames: ["d.png"] },
    active_read: { folder: "read", frames: ["r1.png", "r2.png"] },
    active_work: { folder: "work", frames: ["w1.png", "w2.png"] },
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
      animations: {},
    };
    expect(resolvePose(empty, "active_work")).toBeNull();
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
