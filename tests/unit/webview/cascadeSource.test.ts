/**
 * cascadeSource — unit tests for the per-field effective-value + originating-
 * layer resolution that drives the Playback Tuner's source table (E5 86ca2189v /
 * E4 spec §3.5, AC3).
 *
 * NON-VACUOUS: the field-level-independence tests fail if `computeCascadeSource`
 * collapses to a whole-object resolution (labeling the whole anim with one
 * source) instead of resolving each field independently.
 */

import { describe, it, expect } from "vitest";
import {
  computeCascadeSource,
  APEX_FRAME_NONE,
} from "../../../src/webview/sprites/cascadeSource.js";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";

function manifest(
  parts: Partial<GeneratedSpriteManifest> & {
    perChar?: Record<string, unknown>;
    poseDefault?: Record<string, unknown>;
  } = {},
): GeneratedSpriteManifest {
  const { perChar, poseDefault } = parts;
  return {
    characters: {
      "ClaudeTeam-M01-Dev": {
        character: "ClaudeTeam-M01-Dev",
        defaultIdle: "idle_stretch",
        idlePool: ["idle_stretch"],
        animations: {
          idle_stretch: {
            folder: "x",
            frames: ["a", "b"],
            ...(perChar ? { playback: perChar } : {}),
          },
        },
      },
    },
    ...(poseDefault
      ? { poseDefaults: { idle_stretch: poseDefault } }
      : {}),
  } as unknown as GeneratedSpriteManifest;
}

describe("computeCascadeSource — per-field effective value + layer (AC3)", () => {
  it("all three fields resolve to engine default when no layer sets them", () => {
    const src = computeCascadeSource("ClaudeTeam-M01-Dev", "idle_stretch", manifest());
    expect(src.speedMultiplier).toEqual({ value: 1, layer: "engine default" });
    expect(src.finalDwellMs).toEqual({ value: 400, layer: "engine default" });
    expect(src.playbackMode).toEqual({ value: "loop", layer: "engine default" });
  });

  it("a per-char field wins and is tagged per-char", () => {
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({ perChar: { speedMultiplier: 0.5 } }),
    );
    expect(src.speedMultiplier).toEqual({ value: 0.5, layer: "per-char" });
  });

  it("a pose-default field is used (tagged pose-default) when per-char absent", () => {
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({ poseDefault: { playbackMode: "pingpong", finalDwellMs: 800 } }),
    );
    expect(src.playbackMode).toEqual({ value: "pingpong", layer: "pose-default" });
    expect(src.finalDwellMs).toEqual({ value: 800, layer: "pose-default" });
  });

  it("FIELD-LEVEL: speed=per-char, mode=pose-default, hold=engine — three distinct layers", () => {
    // The load-bearing field-independence assertion. A whole-object resolution
    // would label all three the same; here each resolves on its own merit.
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({
        perChar: { speedMultiplier: 0.7 },
        poseDefault: { playbackMode: "pingpong" },
      }),
    );
    expect(src.speedMultiplier).toEqual({ value: 0.7, layer: "per-char" });
    expect(src.playbackMode).toEqual({ value: "pingpong", layer: "pose-default" });
    expect(src.finalDwellMs).toEqual({ value: 400, layer: "engine default" });
  });

  it("per-char beats pose-default for the SAME field", () => {
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({
        perChar: { finalDwellMs: 1200 },
        poseDefault: { finalDwellMs: 800 },
      }),
    );
    expect(src.finalDwellMs).toEqual({ value: 1200, layer: "per-char" });
  });

  it("an unknown char / anim resolves to engine defaults (no throw)", () => {
    const src = computeCascadeSource("nope", "also-nope", manifest());
    expect(src.speedMultiplier.layer).toBe("engine default");
    expect(src.playbackMode.value).toBe("loop");
  });
});

// ===========================================================================
// 86ca2bqe1 — apex hold (dwellFrameIndex / dwellMs) per-field resolution
//
// NON-VACUOUS: the "none" sentinel test fails if dwellFrameIndex were given a
// numeric engine default (it has none — absent means the hold is OFF); the
// dwellMs default test fails if PEAK_DWELL_MS_DEFAULT (600) isn't the fallback.
// ===========================================================================

describe("computeCascadeSource — apex hold fields (dwellFrameIndex / dwellMs)", () => {
  it("no layer sets the apex → frame index is the 'none' sentinel, ms is the 600 default", () => {
    const src = computeCascadeSource("ClaudeTeam-M01-Dev", "idle_stretch", manifest());
    expect(src.dwellFrameIndex).toEqual({
      value: APEX_FRAME_NONE,
      layer: "engine default",
    });
    // dwellMs engine default = PEAK_DWELL_MS_DEFAULT (600).
    expect(src.dwellMs).toEqual({ value: 600, layer: "engine default" });
  });

  it("a per-char apex pair wins and is tagged per-char", () => {
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({ perChar: { dwellFrameIndex: 2, dwellMs: 2500 } }),
    );
    expect(src.dwellFrameIndex).toEqual({ value: 2, layer: "per-char" });
    expect(src.dwellMs).toEqual({ value: 2500, layer: "per-char" });
  });

  it("a pose-default apex frame is used (tagged pose-default) when per-char absent", () => {
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({ poseDefault: { dwellFrameIndex: 1 } }),
    );
    expect(src.dwellFrameIndex).toEqual({ value: 1, layer: "pose-default" });
    // dwellMs still falls back to the engine default since no layer set it.
    expect(src.dwellMs).toEqual({ value: 600, layer: "engine default" });
  });

  it("FIELD-LEVEL: apex frame per-char while apex ms inherits engine default", () => {
    const src = computeCascadeSource(
      "ClaudeTeam-M01-Dev",
      "idle_stretch",
      manifest({ perChar: { dwellFrameIndex: 3 } }),
    );
    expect(src.dwellFrameIndex).toEqual({ value: 3, layer: "per-char" });
    expect(src.dwellMs.layer).toBe("engine default");
  });
});
