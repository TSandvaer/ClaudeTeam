/**
 * liveManifestOverlay — unit coverage for the in-session save store + overlay
 * (ticket 86ca2wrnq).
 *
 * Pure module (no DOM); asserts that `apply(baked)` produces an effective
 * manifest matching the field-level set/clear merge the host writer performs, so
 * the tuner's re-seed reads in-session saves instead of the stale baked value.
 *
 * Non-vacuity: each block asserts a DIFFERENCE from the baked manifest that only
 * exists because the overlay merged a recorded save — reverting `apply` to
 * `return baked` fails every "reflects the save" assertion.
 */

import { describe, it, expect } from "vitest";
import { createLiveManifestOverlay } from "../../../src/webview/liveManifestOverlay.js";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";

function baked(): GeneratedSpriteManifest {
  return {
    characters: {
      "ClaudeTeam-M01-Dev": {
        character: "ClaudeTeam-M01-Dev",
        defaultIdle: "idle_stretch",
        idlePool: ["idle_stretch", "idle_coffee"],
        activePool: [],
        animations: {
          idle_stretch: {
            folder: "stretch",
            frames: ["a.png", "b.png", "c.png"],
            // Pre-existing baked per-char override + a window field (OOS, must survive).
            playback: { speedMultiplier: 0.5, startFrame: 1, endFrame: 2 },
          },
          idle_coffee: { folder: "coffee", frames: ["a.png", "b.png"] },
        },
      },
      "ClaudeTeam-F01-Dev": {
        character: "ClaudeTeam-F01-Dev",
        defaultIdle: "idle_coffee",
        idlePool: ["idle_coffee"],
        activePool: [],
        animations: {
          idle_coffee: { folder: "coffee", frames: ["a.png", "b.png"] },
        },
      },
    },
    poseDefaults: { idle_stretch: { playbackMode: "pingpong" } },
  };
}

describe("liveManifestOverlay", () => {
  it("returns the baked manifest unchanged when nothing recorded", () => {
    const overlay = createLiveManifestOverlay();
    const b = baked();
    expect(overlay.apply(b)).toBe(b);
  });

  it("overlays a per-char save onto the matching anim's playback block", () => {
    const overlay = createLiveManifestOverlay();
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { finalDwellMs: 1200 },
    });
    const eff = overlay.apply(baked());
    expect(
      eff.characters["ClaudeTeam-M01-Dev"].animations.idle_coffee.playback,
    ).toEqual({ finalDwellMs: 1200 });
  });

  it("merges set fields and CLEARS absent tunable fields including the window pair (field-omission == clear) (86ca7yumw)", () => {
    const overlay = createLiveManifestOverlay();
    // The baked block has speedMultiplier:0.5 + a baked window {1,2}. Save a draft
    // that sets ONLY finalDwellMs — the host writer clears speedMultiplier AND the
    // window pair (all absent tunable keys), so the overlay must do the same.
    // NON-VACUOUS: with startFrame/endFrame OUTSIDE TUNABLE_KEYS (the shipped bug)
    // the window survives → block === { finalDwellMs, startFrame:1, endFrame:2 },
    // diverging from disk. Adding the window keys makes them clear here.
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { finalDwellMs: 900 },
    });
    const block =
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_stretch.playback;
    // speedMultiplier cleared; finalDwellMs set; window pair CLEARED (now tunable).
    expect(block).toEqual({ finalDwellMs: 900 });
  });

  it("overlays a window-pair save onto the matching anim's playback block (86ca7yumw)", () => {
    const overlay = createLiveManifestOverlay();
    // Save a NEW window {5,10} on idle_stretch (baked window is {1,2}). The overlay
    // must reflect the SAVED window so a re-seed reads it (the bug: overlay drops
    // startFrame/endFrame → re-seed shows the stale baked {1,2}).
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 0.5, startFrame: 5, endFrame: 10 },
    });
    const block =
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_stretch.playback;
    expect(block).toEqual({ speedMultiplier: 0.5, startFrame: 5, endFrame: 10 });
  });

  it("clears the baked window when a later save omits the window pair (86ca7yumw)", () => {
    const overlay = createLiveManifestOverlay();
    // The baked block carries window {1,2}. A save that keeps speed but drops the
    // window (the [reset]/full-clip branch in onWindowChange) must CLEAR the
    // baked window — matching the host writer, which deletes the absent keys on
    // disk. With the bug the overlay preserved {1,2}, so disk and overlay drift.
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 2 },
    });
    const block =
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_stretch.playback;
    expect(block).toEqual({ speedMultiplier: 2 });
  });

  it("drops the whole playback block when no tunable AND no other field remains", () => {
    const overlay = createLiveManifestOverlay();
    // idle_coffee starts with NO playback block; an empty override clears nothing
    // and leaves nothing → block must be absent (matches host removing it).
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: {},
    });
    expect(
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_coffee.playback,
    ).toBeUndefined();
  });

  it("overlays a pose-default save onto poseDefaults[anim]", () => {
    const overlay = createLiveManifestOverlay();
    overlay.record({
      writeTarget: "pose-default",
      animName: "idle_stretch",
      override: { playbackMode: "loop", finalDwellMs: 300 },
    });
    expect(overlay.apply(baked()).poseDefaults?.idle_stretch).toEqual({
      playbackMode: "loop",
      finalDwellMs: 300,
    });
  });

  it("last write wins for the same (writeTarget, char, anim)", () => {
    const overlay = createLiveManifestOverlay();
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { speedMultiplier: 1.5 },
    });
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { speedMultiplier: 3 },
    });
    expect(
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_coffee.playback,
    ).toEqual({ speedMultiplier: 3 });
  });

  // 86ca5eve1 Phase-2 (apex pair through the store) — the apex-hold pair
  // (dwellFrameIndex/dwellMs) IS in liveManifestOverlay's TUNABLE_KEYS, but no
  // store test exercised it (only speed/hold/mode did). A regression that drops
  // the apex keys from the overlay's TUNABLE_KEYS would silently make the tuner's
  // apex re-seed read the stale baked value after an in-session apex save — the
  // exact stale-manifest class this overlay exists to prevent (spec §12.4 +
  // vscode-extension-conventions.md § "baked sprite manifest is a LOAD-TIME
  // snapshot"). NON-VACUOUS: removing "dwellFrameIndex"/"dwellMs" from
  // liveManifestOverlay.TUNABLE_KEYS fails these (the recorded apex never lands
  // on / never clears from the overlaid block).
  it("overlays a per-char APEX-pair save onto the matching anim's playback block (86ca5eve1)", () => {
    const overlay = createLiveManifestOverlay();
    // idle_coffee starts with NO playback block — a pure apex save must create it.
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { dwellFrameIndex: 1, dwellMs: 2000 },
    });
    expect(
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_coffee.playback,
    ).toEqual({ dwellFrameIndex: 1, dwellMs: 2000 });
  });

  it("CLEARS the apex pair from a block when a later save omits it (field-omission == clear, apex) (86ca5eve1)", () => {
    const overlay = createLiveManifestOverlay();
    // First save sets speed + an apex pair on idle_coffee.
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { speedMultiplier: 1.5, dwellFrameIndex: 0, dwellMs: 800 },
    });
    // Second save (last-write-wins) keeps speed but OMITS the apex pair — the
    // "Off" branch in the tuner. The overlaid block must drop both apex keys,
    // mirroring the host writer's mergePlaybackEntry clear-absent behavior.
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { speedMultiplier: 1.5 },
    });
    expect(
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_coffee.playback,
    ).toEqual({ speedMultiplier: 1.5 });
  });

  it("overlays a pose-default APEX-pair save onto poseDefaults[anim] (86ca5eve1)", () => {
    const overlay = createLiveManifestOverlay();
    overlay.record({
      writeTarget: "pose-default",
      animName: "idle_stretch",
      override: { dwellFrameIndex: 2, dwellMs: 1500 },
    });
    // The baked pose-default for idle_stretch is { playbackMode: "pingpong" };
    // an apex pose-default save clears playbackMode (absent tunable key) and sets
    // the apex pair (last-write-wins, full field-level merge).
    expect(overlay.apply(baked()).poseDefaults?.idle_stretch).toEqual({
      dwellFrameIndex: 2,
      dwellMs: 1500,
    });
  });

  // 86ca7yumw — window pair through the pose-default surface. Mirrors the apex
  // pose-default test: the window flows through the SAME field-level merge, so a
  // regression dropping startFrame/endFrame from TUNABLE_KEYS makes the recorded
  // window never land on poseDefaults → the pose-default window re-seed reads the
  // stale baked value. NON-VACUOUS: with the bug, the pose-default block keeps
  // playbackMode (window never set) → assertion fails.
  it("overlays a pose-default WINDOW-pair save onto poseDefaults[anim] (86ca7yumw)", () => {
    const overlay = createLiveManifestOverlay();
    overlay.record({
      writeTarget: "pose-default",
      animName: "idle_stretch",
      override: { startFrame: 3, endFrame: 7 },
    });
    // The baked pose-default for idle_stretch is { playbackMode: "pingpong" }; a
    // window pose-default save clears playbackMode (absent tunable key) and sets
    // the window pair (full field-level merge, mirroring the host writer).
    expect(overlay.apply(baked()).poseDefaults?.idle_stretch).toEqual({
      startFrame: 3,
      endFrame: 7,
    });
  });

  it("does NOT mutate the baked manifest", () => {
    const overlay = createLiveManifestOverlay();
    const b = baked();
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 2 },
    });
    overlay.apply(b);
    // Original baked block untouched.
    expect(b.characters["ClaudeTeam-M01-Dev"].animations.idle_stretch.playback)
      .toEqual({ speedMultiplier: 0.5, startFrame: 1, endFrame: 2 });
  });

  it("clones the override on record (later draft mutation can't leak in)", () => {
    const overlay = createLiveManifestOverlay();
    const draft = { speedMultiplier: 1.25 };
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: draft,
    });
    draft.speedMultiplier = 99; // mutate after record
    expect(
      overlay.apply(baked()).characters["ClaudeTeam-M01-Dev"].animations
        .idle_coffee.playback,
    ).toEqual({ speedMultiplier: 1.25 });
  });

  it("reset() clears all recorded saves", () => {
    const overlay = createLiveManifestOverlay();
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { speedMultiplier: 2 },
    });
    overlay.reset();
    const b = baked();
    expect(overlay.apply(b)).toBe(b);
  });
});
