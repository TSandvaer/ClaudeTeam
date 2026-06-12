/**
 * playbackOverrideWriter — integration tests against a tempdir (E5 86ca2189v).
 *
 * Drives the host-side `savePlaybackOverride` end-to-end on a real filesystem:
 * the structured field-level json merge into `animations.json` (per-char) and
 * `pose-defaults.json` (pose-default), plus field-omission==clear semantics and
 * the schema-compatibility contract with the build script's E2 reader.
 *
 * NON-VACUOUS: each test asserts an observable on-disk OUTCOME (the merged json),
 * not just a return value. Reverting the merge to a whole-file replace fails the
 * "preserves other keys" tests; reverting clear-on-omit fails the clear tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  savePlaybackOverride,
  mergePlaybackEntry,
  mergeSceneEntry,
  resolvePlaybackTargetPath,
} from "../../src/extension/sprites/playbackOverrideWriter.js";

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "ct-tuner-"));
});
afterEach(() => {
  rmSync(ws, { recursive: true, force: true });
});

/** Write a per-char animations.json with a starting playback block. */
function seedAnimationsJson(char: string, doc: unknown): string {
  const dir = join(ws, "assets", "sprites", char);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "animations.json");
  writeFileSync(path, JSON.stringify(doc, null, 2));
  return path;
}

function seedPoseDefaults(doc: unknown): string {
  const dir = join(ws, "assets", "sprites");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "pose-defaults.json");
  writeFileSync(path, JSON.stringify(doc, null, 2));
  return path;
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8"));

// ===========================================================================
// resolvePlaybackTargetPath
// ===========================================================================

describe("resolvePlaybackTargetPath", () => {
  it("per-char → <ws>/assets/sprites/<char>/animations.json", () => {
    expect(
      resolvePlaybackTargetPath(ws, "per-char", "ClaudeTeam-M01-Dev"),
    ).toBe(join(ws, "assets", "sprites", "ClaudeTeam-M01-Dev", "animations.json"));
  });
  it("pose-default → <ws>/assets/sprites/pose-defaults.json", () => {
    expect(resolvePlaybackTargetPath(ws, "pose-default")).toBe(
      join(ws, "assets", "sprites", "pose-defaults.json"),
    );
  });
});

// ===========================================================================
// mergePlaybackEntry (pure field-level merge — AC2/§4.1)
// ===========================================================================

describe("mergePlaybackEntry — field-level merge + clear-on-omit", () => {
  it("sets a present field and DELETES an absent tunable field", () => {
    // existing has speed+mode; override sets only speed → mode (absent) cleared.
    const merged = mergePlaybackEntry(
      { speedMultiplier: 0.5, playbackMode: "pingpong" },
      { speedMultiplier: 0.7 },
    );
    expect(merged).toEqual({ speedMultiplier: 0.7 });
  });

  it("preserves a NON-tunable field the tuner doesn't own (e.g. an unknown future key)", () => {
    const merged = mergePlaybackEntry(
      { speedMultiplier: 0.5, customFutureKey: "preserved" },
      { finalDwellMs: 800 },
    );
    // speedMultiplier (tunable, absent from override) cleared; the unknown
    // non-tunable key survives untouched. (86ca2wj6u: startFrame/endFrame are NOW
    // tunable — covered by the window set/clear tests below.)
    expect(merged).toEqual({
      customFutureKey: "preserved",
      finalDwellMs: 800,
    });
  });

  // 86ca2wj6u — the window pair (startFrame/endFrame) is now tuner-owned: a
  // present field is set, an absent one is CLEARED (clear → full clip), exactly
  // like the other tunable keys. NON-VACUOUS: reverting the TUNABLE_KEYS
  // extension makes these fields fall through to the "preserve untouched" path →
  // the clear assertion fails (the stale startFrame survives the override).
  it("sets the window pair (startFrame + endFrame) when present", () => {
    const merged = mergePlaybackEntry(
      { speedMultiplier: 0.5 },
      { startFrame: 4, endFrame: 9 },
    );
    // speedMultiplier cleared (absent); window pair set.
    expect(merged).toEqual({ startFrame: 4, endFrame: 9 });
  });

  it("CLEARS a stale window pair when the override omits it (clear → full clip)", () => {
    const merged = mergePlaybackEntry(
      { startFrame: 5, endFrame: 10, speedMultiplier: 0.5 },
      { speedMultiplier: 0.7 },
    );
    // The window pair is absent from the override → cleared (full clip).
    expect(merged).toEqual({ speedMultiplier: 0.7 });
  });

  // 86ca2bqe1 — apex hold (dwellFrameIndex/dwellMs) is now tuner-owned: a present
  // field is set, an absent one is CLEARED (clear → inherit), exactly like the
  // other tunable keys. NON-VACUOUS: reverting the TUNABLE_KEYS extension makes
  // these fields fall through to the "preserve untouched" path → the clear
  // assertion fails (the stale dwellFrameIndex survives the override).
  it("sets the apex pair (dwellFrameIndex + dwellMs) when present", () => {
    const merged = mergePlaybackEntry(
      { speedMultiplier: 0.5 },
      { dwellFrameIndex: 3, dwellMs: 2000 },
    );
    // speedMultiplier cleared (absent); apex pair set.
    expect(merged).toEqual({ dwellFrameIndex: 3, dwellMs: 2000 });
  });

  it("CLEARS a stale apex pair when the override omits it (clear → inherit)", () => {
    const merged = mergePlaybackEntry(
      { dwellFrameIndex: 4, dwellMs: 800, customFutureKey: "kept" },
      { speedMultiplier: 0.7 },
    );
    // The apex pair is absent from the override → cleared. An unknown non-tunable
    // key is preserved. (86ca2wj6u: startFrame/endFrame are now tunable, so they
    // would NOT survive an omitting override — see the window clear test above.)
    expect(merged).toEqual({
      speedMultiplier: 0.7,
      customFutureKey: "kept",
    });
  });

  it("returns null when the entry is empty after merge (so the key is dropped)", () => {
    expect(mergePlaybackEntry({ speedMultiplier: 0.5 }, {})).toBeNull();
    expect(mergePlaybackEntry(undefined, {})).toBeNull();
  });

  it("creates an entry from scratch when none existed", () => {
    expect(
      mergePlaybackEntry(undefined, {
        speedMultiplier: 0.5,
        playbackMode: "pingpong",
      }),
    ).toEqual({ speedMultiplier: 0.5, playbackMode: "pingpong" });
  });
});

// ===========================================================================
// savePlaybackOverride — per-char (AC2: correct write target + payload)
// ===========================================================================

describe("savePlaybackOverride — per-char write target", () => {
  it("merges into the CORRECT char's animations.json playback block", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      character: "ClaudeTeam-M01-Dev",
      animations: { idle_stretch: "a_relaxed_tired_upwa" },
      playback: { idle_stretch: { speedMultiplier: 0.5 } },
    });

    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 0.7, playbackMode: "pingpong" },
    });
    expect(res.ok).toBe(true);

    const doc = readJson(path);
    // Load-bearing: the targeted anim's playback fields are merged.
    expect((doc.playback as Record<string, unknown>).idle_stretch).toEqual({
      speedMultiplier: 0.7,
      playbackMode: "pingpong",
    });
    // The animations name→folder map is preserved untouched (NOT a whole-file
    // replace) — reverting the merge to a replace fails this.
    expect(doc.animations).toEqual({ idle_stretch: "a_relaxed_tired_upwa" });
    expect(doc.character).toBe("ClaudeTeam-M01-Dev");
  });

  it("does NOT touch OTHER anims' playback entries", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { idle_stretch: "x", idle_coffee: "y" },
      playback: {
        idle_stretch: { speedMultiplier: 0.5 },
        idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
      },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { finalDwellMs: 800 },
    });
    const pb = readJson(path).playback as Record<string, unknown>;
    // idle_coffee is untouched.
    expect(pb.idle_coffee).toEqual({ speedMultiplier: 0.5, dwellFrameIndex: 4 });
  });

  it("clears the anim key entirely when the override is empty (all reset)", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { idle_stretch: "x" },
      playback: { idle_stretch: { speedMultiplier: 0.5 } },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: {},
    });
    const pb = readJson(path).playback as Record<string, unknown>;
    expect("idle_stretch" in pb).toBe(false);
  });

  // 86ca2wj6u — the playback window now persists to disk end-to-end (the spec
  // §0.1 gap: before the TUNABLE_KEYS promotion, a newly-set window was silently
  // dropped — the control previewed but never persisted). NON-VACUOUS: reverting
  // the TUNABLE_KEYS extension makes startFrame/endFrame fall through to "preserve
  // if already present" — a NEW window (none on disk) is dropped, failing this.
  it("PERSISTS a newly-set window (startFrame/endFrame) to disk", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { idle_stretch: "x" },
      playback: { idle_stretch: { speedMultiplier: 0.5 } },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 0.5, startFrame: 4, endFrame: 9 },
    });
    const pb = readJson(path).playback as Record<string, unknown>;
    expect(pb.idle_stretch).toEqual({
      speedMultiplier: 0.5,
      startFrame: 4,
      endFrame: 9,
    });
  });

  it("CLEARS a previously-saved window when the override omits it (reset → full clip)", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { idle_stretch: "x" },
      playback: { idle_stretch: { speedMultiplier: 0.5, startFrame: 4, endFrame: 9 } },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 0.5 }, // window omitted → cleared
    });
    const pb = readJson(path).playback as Record<string, unknown>;
    expect(pb.idle_stretch).toEqual({ speedMultiplier: 0.5 });
  });

  // 86ca2bqe1 AC2 — the apex pair lands in the CORRECT char's animations.json
  // playback block (assert both payload fields + the resolved path).
  it("writes the apex pair (dwellFrameIndex + dwellMs) to the per-char file", () => {
    const path = seedAnimationsJson("ClaudeTeam-F01-Dev", {
      character: "ClaudeTeam-F01-Dev",
      animations: { idle_coffee: "drink_slug" },
      playback: {},
    });
    // The resolved write path is the F01 animations.json (AC2 path assertion).
    expect(
      resolvePlaybackTargetPath(ws, "per-char", "ClaudeTeam-F01-Dev"),
    ).toBe(path);

    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-F01-Dev",
      animName: "idle_coffee",
      override: { dwellFrameIndex: 3, dwellMs: 2500 },
    });
    expect(res.ok).toBe(true);

    const pb = readJson(path).playback as Record<string, unknown>;
    // AC2 payload assertion: both apex fields persisted under the anim key.
    expect(pb.idle_coffee).toEqual({ dwellFrameIndex: 3, dwellMs: 2500 });
  });

  it("creates a playback block when none existed in the file", () => {
    const path = seedAnimationsJson("ClaudeTeam-F01-Dev", {
      animations: { idle_coffee: "z" },
    });
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-F01-Dev",
      animName: "idle_coffee",
      override: { speedMultiplier: 0.5 },
    });
    expect(res.ok).toBe(true);
    const pb = readJson(path).playback as Record<string, unknown>;
    expect(pb.idle_coffee).toEqual({ speedMultiplier: 0.5 });
  });
});

// ===========================================================================
// savePlaybackOverride — pose-default (AC2)
// ===========================================================================

describe("savePlaybackOverride — pose-default write target", () => {
  it("merges into pose-defaults.json's top-level playback block", () => {
    const path = seedPoseDefaults({ playback: {} });
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "idle_stretch",
      override: { playbackMode: "pingpong", finalDwellMs: 800 },
    });
    expect(res.ok).toBe(true);
    const pb = readJson(path).playback as Record<string, unknown>;
    expect(pb.idle_stretch).toEqual({
      playbackMode: "pingpong",
      finalDwellMs: 800,
    });
  });

  // 86ca2cg8a gap #1 — DIRECT assertion that an apex pair (dwellFrameIndex +
  // dwellMs) save with writeTarget:"pose-default" lands on the CORRECT path
  // (<ws>/assets/sprites/pose-defaults.json — NOT a per-char file) with the
  // CORRECT payload. The existing apex-pair writer tests above all target
  // per-char (line ~220); the apex→pose-default path was only TRANSITIVELY
  // covered (a generic pose-default merge + a separate per-char apex merge).
  // This binds the two together: apex fields THROUGH the pose-default branch.
  //
  // NON-VACUITY (mutation-verified 2026-06-01 against playbackOverrideWriter.ts):
  //  - PATH probe: reverting resolvePlaybackTargetPath's pose-default branch
  //    (line 135-137) to fall through to the per-char join makes the resolved
  //    path assertion FAIL (it would resolve to `.../""/animations.json`).
  //  - PAYLOAD probe: dropping dwellFrameIndex/dwellMs from TUNABLE_KEYS (line
  //    87-94) makes the apex fields fall through to the "preserve untouched"
  //    path — they would NOT be written into a fresh entry, failing the toEqual.
  it("writes the apex pair (dwellFrameIndex + dwellMs) to pose-defaults.json with the correct path + payload", () => {
    const path = seedPoseDefaults({ playback: {} });
    // PATH assertion (gap #1): the resolved write target IS the top-level
    // pose-defaults.json, not any per-char animations.json.
    expect(resolvePlaybackTargetPath(ws, "pose-default")).toBe(path);

    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "idle_coffee",
      override: { dwellFrameIndex: 4, dwellMs: 2000 },
    });
    expect(res.ok).toBe(true);

    // PAYLOAD assertion (gap #1): both apex fields persisted under the anim key
    // in the pose-defaults top-level playback block, nothing else.
    const pb = readJson(path).playback as Record<string, unknown>;
    expect(pb.idle_coffee).toEqual({ dwellFrameIndex: 4, dwellMs: 2000 });
  });

  // 86ca2cg8a gap #1 (companion) — an apex pose-default merge PRESERVES other
  // anims + a co-located non-apex field on the SAME anim entry (structured
  // field-level merge, not whole-file replace) on the pose-default path too.
  it("apex pose-default merge preserves other anims + co-located tunable fields", () => {
    const path = seedPoseDefaults({
      _note: "shared pose defaults",
      playback: {
        idle_stretch: { speedMultiplier: 0.5 },
        idle_coffee: { speedMultiplier: 0.6 },
      },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "idle_coffee",
      // Co-set speed + apex pair in one save → all three land; idle_stretch
      // and the _note comment survive untouched.
      override: { speedMultiplier: 0.6, dwellFrameIndex: 4, dwellMs: 2000 },
    });
    const doc = readJson(path);
    const pb = doc.playback as Record<string, unknown>;
    expect(pb.idle_coffee).toEqual({
      speedMultiplier: 0.6,
      dwellFrameIndex: 4,
      dwellMs: 2000,
    });
    // The sibling anim + the document-level comment are preserved.
    expect(pb.idle_stretch).toEqual({ speedMultiplier: 0.5 });
    expect(doc._note).toBe("shared pose defaults");
  });
});

// ===========================================================================
// Round-trip with the build script's E2 reader (Felix spec-edge §4.3)
// ===========================================================================

describe("schema compatibility — written json round-trips through sanitizePlayback", () => {
  it("the written per-char entry survives the build script's validation verbatim", async () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { idle_stretch: "x" },
      playback: {},
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_stretch",
      override: { speedMultiplier: 0.75, finalDwellMs: 800, playbackMode: "pingpong" },
    });
    const written = (readJson(path).playback as Record<string, unknown>)
      .idle_stretch;

    // The build script reads the SAME schema; sanitizePlayback must keep all
    // three fields (finite numbers + valid mode) — i.e. the writer emits a
    // byte-compatible shape (no silent field drop on rebuild).
    const { sanitizePlayback } = await import(
      "../../scripts/build-sprite-manifest.mjs"
    );
    const { playback, warnings } = sanitizePlayback("test/idle_stretch", written);
    expect(warnings).toEqual([]);
    expect(playback).toEqual({
      speedMultiplier: 0.75,
      finalDwellMs: 800,
      playbackMode: "pingpong",
    });
  });

  // 86ca2bqe1 — the written apex pair survives the build script's E2 reader too
  // (build-sprite-manifest already validates dwellFrameIndex/dwellMs as finite
  // numbers, so no engine/build change was needed — this proves round-trip).
  it("the written apex pair survives sanitizePlayback verbatim", async () => {
    const path = seedAnimationsJson("ClaudeTeam-F01-Dev", {
      animations: { idle_coffee: "x" },
      playback: {},
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-F01-Dev",
      animName: "idle_coffee",
      override: { dwellFrameIndex: 3, dwellMs: 2500 },
    });
    const written = (readJson(path).playback as Record<string, unknown>)
      .idle_coffee;
    const { sanitizePlayback } = await import(
      "../../scripts/build-sprite-manifest.mjs"
    );
    const { playback, warnings } = sanitizePlayback("test/idle_coffee", written);
    expect(warnings).toEqual([]);
    expect(playback).toEqual({ dwellFrameIndex: 3, dwellMs: 2500 });
  });
});

// ===========================================================================
// mergeSceneEntry — pure scene set/clear (scene-per-pose 86ca88nvd §5.4)
// ===========================================================================

describe("mergeSceneEntry — scene set/clear (field-omission == clear)", () => {
  it("returns the scene id when sceneId is present", () => {
    expect(mergeSceneEntry({ sceneId: "room3" })).toBe("room3");
  });

  it('returns the literal "none" sentinel verbatim when present', () => {
    expect(mergeSceneEntry({ sceneId: "none" })).toBe("none");
  });

  it("returns null when sceneId is ABSENT (clear → inherit)", () => {
    expect(mergeSceneEntry({})).toBeNull();
    // A playback-only override (no sceneId) clears the scene too.
    expect(mergeSceneEntry({ speedMultiplier: 0.5 })).toBeNull();
  });
});

// ===========================================================================
// savePlaybackOverride — scene block persistence (scene-per-pose 86ca88nvd §5.1)
//
// NON-VACUOUS: each test asserts the on-disk `scenes` block (a SEPARATE top-level
// block from `playback`). Reverting the scene write path makes the set tests fail
// (no `scenes` key written); reverting clear-on-omit makes the clear tests fail
// (the stale scene survives). The §5.4 parity with mergePlaybackEntry's set/clear
// is the load-bearing contract the webview overlay (86ca88p45) must mirror.
// ===========================================================================

describe("savePlaybackOverride — scene block (per-char)", () => {
  it('writes sceneId into a SEPARATE top-level "scenes" block, NOT the playback block', () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { active_work: "x" },
      playback: {},
    });
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: { sceneId: "none" },
    });
    expect(res.ok).toBe(true);
    const doc = readJson(path);
    // The scene lands in `scenes`, keyed by anim — NOT in `playback`.
    expect((doc.scenes as Record<string, unknown>).active_work).toBe("none");
    // playback stays empty (sceneId is not a playback field).
    expect("active_work" in (doc.playback as Record<string, unknown>)).toBe(false);
  });

  it("persists a real scene id and coexists with a playback field in one save", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { idle_coffee: "y" },
      playback: {},
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { sceneId: "room3", speedMultiplier: 0.5 },
    });
    const doc = readJson(path);
    // Scene block AND playback block both updated for the same anim.
    expect((doc.scenes as Record<string, unknown>).idle_coffee).toBe("room3");
    expect((doc.playback as Record<string, unknown>).idle_coffee).toEqual({
      speedMultiplier: 0.5,
    });
  });

  it("CLEARS a stale scene (key absent from override) — none-vs-absent distinction", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { active_work: "x", idle_coffee: "y" },
      scenes: { active_work: "none", idle_coffee: "room3" },
    });
    // Save for active_work WITHOUT a sceneId → its scene key is cleared (inherit),
    // while idle_coffee's scene is untouched (different anim).
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: { speedMultiplier: 0.7 },
    });
    const scenes = readJson(path).scenes as Record<string, unknown>;
    // active_work cleared (absent → inherit); idle_coffee preserved untouched.
    expect("active_work" in scenes).toBe(false);
    expect(scenes.idle_coffee).toBe("room3");
  });

  it('"none" (explicit flat card) is DISTINCT from absent (clear): "none" is written, absent deletes', () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { active_work: "x" },
    });
    // First save: explicit "none" → present in the file.
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: { sceneId: "none" },
    });
    expect((readJson(path).scenes as Record<string, unknown>).active_work).toBe(
      "none",
    );
    // Second save: omit sceneId → the key is DELETED (clear → inherit), not "none".
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: {},
    });
    // The whole scenes block empties → dropped from the file entirely.
    expect("scenes" in readJson(path)).toBe(false);
  });

  it("drops the whole scenes block when it empties (file stays byte-minimal)", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { active_work: "x" },
      scenes: { active_work: "none" },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: {}, // no sceneId → clear → block empties → dropped
    });
    expect("scenes" in readJson(path)).toBe(false);
  });

  it("does NOT touch OTHER anims' scene entries", () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { active_work: "x", active_read: "y" },
      scenes: { active_work: "none", active_read: "none" },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: { sceneId: "room3" },
    });
    const scenes = readJson(path).scenes as Record<string, unknown>;
    expect(scenes.active_work).toBe("room3");
    // active_read's scene is preserved untouched (structured merge, not replace).
    expect(scenes.active_read).toBe("none");
  });
});

describe("savePlaybackOverride — scene block (pose-default)", () => {
  it("writes the scene seed into pose-defaults.json's top-level scenes block", () => {
    const path = seedPoseDefaults({ playback: {} });
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "active_work",
      override: { sceneId: "none" },
    });
    expect(res.ok).toBe(true);
    expect((readJson(path).scenes as Record<string, unknown>).active_work).toBe(
      "none",
    );
  });

  it("a scene save preserves the playback block + _note (structured merge)", () => {
    const path = seedPoseDefaults({
      _note: "shared pose defaults",
      playback: { idle_stretch: { speedMultiplier: 0.5 } },
      scenes: { active_read: "none" },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "active_work",
      override: { sceneId: "none" },
    });
    const doc = readJson(path);
    // The new scene is added; the existing scene + playback + note all survive.
    expect((doc.scenes as Record<string, unknown>).active_work).toBe("none");
    expect((doc.scenes as Record<string, unknown>).active_read).toBe("none");
    expect((doc.playback as Record<string, unknown>).idle_stretch).toEqual({
      speedMultiplier: 0.5,
    });
    expect(doc._note).toBe("shared pose defaults");
  });
});

describe("scene compatibility — written scenes block round-trips through sanitizeScenes", () => {
  it("the written scene entries survive the build script's sanitizeScenes verbatim", async () => {
    const path = seedAnimationsJson("ClaudeTeam-M01-Dev", {
      animations: { active_work: "x", idle_coffee: "y" },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "active_work",
      override: { sceneId: "none" },
    });
    savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { sceneId: "room3" },
    });
    const written = readJson(path).scenes;
    // The build script reads the SAME schema; with room3 in the registry both
    // values survive sanitizeScenes (no silent drop on rebuild).
    const { sanitizeScenes } = await import(
      "../../scripts/build-sprite-manifest.mjs"
    );
    const { scenes, warnings } = sanitizeScenes(
      "ClaudeTeam-M01-Dev",
      written,
      new Set(["room3"]),
    );
    expect(warnings).toEqual([]);
    expect(scenes).toEqual({ active_work: "none", idle_coffee: "room3" });
  });
});

// ===========================================================================
// Failure paths (NEVER throws)
// ===========================================================================

describe("savePlaybackOverride — failure paths", () => {
  it("no workspace → ok:false", () => {
    const res = savePlaybackOverride({
      writeTarget: "pose-default",
      animName: "x",
      override: {},
    });
    expect(res).toEqual({ ok: false, error: "no workspace folder open" });
  });

  it("per-char with no characterFolder → ok:false", () => {
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "per-char",
      animName: "x",
      override: {},
    });
    expect(res.ok).toBe(false);
  });

  it("missing target file → ok:false (does not create it)", () => {
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "x",
      override: { speedMultiplier: 0.5 },
    });
    expect(res.ok).toBe(false);
  });

  it("malformed existing json → ok:false (no throw)", () => {
    const dir = join(ws, "assets", "sprites");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pose-defaults.json"), "{ not json");
    const res = savePlaybackOverride({
      workspaceFolderPath: ws,
      writeTarget: "pose-default",
      animName: "x",
      override: { speedMultiplier: 0.5 },
    });
    expect(res.ok).toBe(false);
  });
});
