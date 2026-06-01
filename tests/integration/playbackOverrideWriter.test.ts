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

  it("preserves NON-tunable fields the tuner doesn't own (startFrame/endFrame window)", () => {
    const merged = mergePlaybackEntry(
      { speedMultiplier: 0.5, startFrame: 5, endFrame: 10 },
      { finalDwellMs: 800 },
    );
    // speedMultiplier (tunable, absent from override) cleared; the non-tunable
    // startFrame / endFrame window survives untouched. (86ca2bqe1: dwellFrameIndex
    // /dwellMs are now TUNABLE — covered by the apex set/clear tests below.)
    expect(merged).toEqual({
      startFrame: 5,
      endFrame: 10,
      finalDwellMs: 800,
    });
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
      { dwellFrameIndex: 4, dwellMs: 800, startFrame: 1, endFrame: 9 },
      { speedMultiplier: 0.7 },
    );
    // The apex pair is absent from the override → cleared. The startFrame/endFrame
    // window (still non-tunable) is preserved.
    expect(merged).toEqual({
      speedMultiplier: 0.7,
      startFrame: 1,
      endFrame: 9,
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
