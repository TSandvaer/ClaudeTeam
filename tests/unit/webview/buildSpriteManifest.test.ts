/**
 * Unit tests for the sprite-manifest generator's value-resolution logic
 * (scripts/build-sprite-manifest.mjs) — AC5.
 *
 * The generator consumes each character's `animations.json`, whose values use
 * a TWO-form vocabulary (sponsor-locked 2026-05-29):
 *   - bare `<state_folder>`        → folder holds ONE anim; discover it.
 *   - `<state_folder>/<anim_slug>` → folder holds MANY; resolve THAT one.
 *
 * `active_work` + `active_read` now SHARE the `sitting_at_a_desk_fa` desk
 * state, so both use the folder/slug form to disambiguate the WORKING anim
 * from the READ anim within the one shared folder. These tests pin the pure
 * helpers that drive that disambiguation so a regression to the old
 * `slugDirs.sort()[0]` (which would resolve BOTH active poses to the same,
 * alphabetically-first slug) fails loudly.
 *
 * Pure functions — node environment, no real filesystem.
 */

import { describe, it, expect } from "vitest";
// The generator is an ESM .mjs; vitest resolves it directly.
import {
  parseAnimValue,
  pickAnimSlug,
  sanitizePlayback,
  buildPoseDefaults,
} from "../../../scripts/build-sprite-manifest.mjs";

describe("parseAnimValue — folder/slug value-format (AC5)", () => {
  it("bare folder → folder + null animSlug (legacy sole-anim form)", () => {
    expect(parseAnimValue("holding_a_coffee_cup")).toEqual({
      folder: "holding_a_coffee_cup",
      animSlug: null,
    });
  });

  it("folder/slug → splits on the FIRST slash", () => {
    expect(
      parseAnimValue(
        "sitting_at_a_desk_fa/the_character_sits_facing_the_monitor_and_reads_wh-8f46a4d2",
      ),
    ).toEqual({
      folder: "sitting_at_a_desk_fa",
      animSlug: "the_character_sits_facing_the_monitor_and_reads_wh-8f46a4d2",
    });
  });

  it("only the first slash splits (slug itself is treated as opaque)", () => {
    // PixelLab slugs are flat, but guard the split semantics regardless.
    expect(parseAnimValue("folder/a/b")).toEqual({
      folder: "folder",
      animSlug: "a/b",
    });
  });
});

describe("pickAnimSlug — disambiguation (AC5)", () => {
  // The real shared desk folder for M01: two anims, work + read.
  const WORK_M01 = "the_character_stays_seated_and_completely_still_th-a1b98373";
  const READ_M01 = "the_character_sits_facing_the_monitor_and_reads_wh-8f46a4d2";
  const DESK_DIRS = [WORK_M01, READ_M01];

  it("explicit slug resolves the EXACT anim — active_work ≠ active_read in the shared folder", () => {
    expect(pickAnimSlug(DESK_DIRS, WORK_M01)).toEqual({
      slug: WORK_M01,
      ambiguous: false,
    });
    expect(pickAnimSlug(DESK_DIRS, READ_M01)).toEqual({
      slug: READ_M01,
      ambiguous: false,
    });
  });

  it("explicit slug NOT order-dependent — read sorts before work, but each resolves to its own", () => {
    // Regression guard for the old slugDirs.sort()[0] bug: sorted, READ_M01
    // ("...sits...") precedes WORK_M01 ("...stays..."), so the old code would
    // have returned READ_M01 for BOTH. The explicit-slug path must not.
    const sorted = [...DESK_DIRS].sort();
    expect(sorted[0]).toBe(READ_M01); // confirm the ordering trap exists
    expect(pickAnimSlug(DESK_DIRS, WORK_M01).slug).toBe(WORK_M01);
  });

  it("explicit slug absent from dirs → null (caller skips + warns)", () => {
    expect(pickAnimSlug(DESK_DIRS, "no_such_slug")).toEqual({
      slug: null,
      ambiguous: false,
    });
  });

  it("bare-folder form with exactly one anim → that anim, not ambiguous", () => {
    const sole = ["the_coffee_cup_stays_pressed-0a57ab90"];
    expect(pickAnimSlug(sole, null)).toEqual({
      slug: sole[0],
      ambiguous: false,
    });
  });

  it("bare-folder form with >1 anim → deterministic sort()[0] + ambiguous flag", () => {
    const r = pickAnimSlug(DESK_DIRS, null);
    expect(r.slug).toBe([...DESK_DIRS].sort()[0]); // READ_M01 (deterministic)
    expect(r.ambiguous).toBe(true); // signals the value should use folder/slug
  });

  it("empty dir list → null, not ambiguous", () => {
    expect(pickAnimSlug([], null)).toEqual({ slug: null, ambiguous: false });
    expect(pickAnimSlug([], "anything")).toEqual({
      slug: null,
      ambiguous: false,
    });
  });
});

describe("sanitizePlayback — playback-field validation + threading (E2 86ca2187g)", () => {
  it("passes a fully-valid override through unchanged (the migrated M01 idle_stretch)", () => {
    const raw = {
      speedMultiplier: 0.5,
      startFrame: 5,
      endFrame: 10,
      playbackMode: "pingpong",
      finalDwellMs: 800,
    };
    const { playback, warnings } = sanitizePlayback("M01/idle_stretch", raw);
    expect(playback).toEqual(raw);
    expect(warnings).toEqual([]);
  });

  it("threads dwellFrameIndex + dwellMs (peak fields) through", () => {
    const { playback, warnings } = sanitizePlayback("M01/idle_coffee", {
      speedMultiplier: 0.5,
      dwellFrameIndex: 4,
      dwellMs: 600,
    });
    expect(playback).toEqual({ speedMultiplier: 0.5, dwellFrameIndex: 4, dwellMs: 600 });
    expect(warnings).toEqual([]);
  });

  it("AC4: unknown playbackMode is DROPPED + warned (engine defaults to loop, no crash)", () => {
    const { playback, warnings } = sanitizePlayback("M01/idle_yawn", {
      speedMultiplier: 0.5,
      playbackMode: "bounce",
    });
    // The bad mode is removed; the valid speedMultiplier survives.
    expect(playback).toEqual({ speedMultiplier: 0.5 });
    expect(playback).not.toHaveProperty("playbackMode");
    expect(warnings.some((w) => w.includes("playbackMode") && w.includes("bounce"))).toBe(true);
  });

  it("accepts both canonical playbackMode literals", () => {
    expect(sanitizePlayback("c/a", { playbackMode: "loop" }).playback).toEqual({
      playbackMode: "loop",
    });
    expect(sanitizePlayback("c/a", { playbackMode: "pingpong" }).playback).toEqual({
      playbackMode: "pingpong",
    });
  });

  it("drops non-finite + non-numeric numeric fields + warns, keeps the good ones", () => {
    const { playback, warnings } = sanitizePlayback("c/a", {
      speedMultiplier: "fast", // wrong type → dropped
      finalDwellMs: Infinity, // non-finite → dropped
      startFrame: NaN, // NaN → dropped
      endFrame: 10, // valid → kept
    });
    expect(playback).toEqual({ endFrame: 10 });
    expect(warnings).toHaveLength(3);
    expect(warnings.some((w) => w.includes("speedMultiplier"))).toBe(true);
    expect(warnings.some((w) => w.includes("finalDwellMs"))).toBe(true);
    expect(warnings.some((w) => w.includes("startFrame"))).toBe(true);
  });

  it("an all-invalid object yields null playback (manifest omits the field entirely)", () => {
    const { playback } = sanitizePlayback("c/a", { playbackMode: "wat", speedMultiplier: "nope" });
    expect(playback).toBeNull();
  });

  it("absent / null playback → null, no warning (no-playback anim is byte-identical)", () => {
    expect(sanitizePlayback("c/a", undefined)).toEqual({ playback: null, warnings: [] });
    expect(sanitizePlayback("c/a", null)).toEqual({ playback: null, warnings: [] });
  });

  it("a non-object playback value (array / scalar) → null + warn, never throws", () => {
    expect(sanitizePlayback("c/a", [1, 2]).playback).toBeNull();
    expect(sanitizePlayback("c/a", [1, 2]).warnings).toHaveLength(1);
    expect(sanitizePlayback("c/a", 42).playback).toBeNull();
    expect(sanitizePlayback("c/a", "loop").playback).toBeNull();
  });

  it("ignores unknown keys (forward-compat — a future field must not crash the build)", () => {
    const { playback, warnings } = sanitizePlayback("c/a", {
      speedMultiplier: 0.7,
      someFutureField: 123,
    });
    expect(playback).toEqual({ speedMultiplier: 0.7 });
    expect(warnings).toEqual([]);
  });
});

describe("buildPoseDefaults — pose-keyed defaults block (E3 86ca2187n)", () => {
  it("AC3: an empty {} block → null poseDefaults (manifest omits the field, byte-identical to E2)", () => {
    expect(buildPoseDefaults({})).toEqual({ poseDefaults: null, warnings: [] });
  });

  it("AC3: absent / null block → null poseDefaults, no warning", () => {
    expect(buildPoseDefaults(undefined)).toEqual({ poseDefaults: null, warnings: [] });
    expect(buildPoseDefaults(null)).toEqual({ poseDefaults: null, warnings: [] });
  });

  it("sanitizes each entry through the same policy as per-char playback", () => {
    const { poseDefaults, warnings } = buildPoseDefaults({
      idle_stretch: { playbackMode: "pingpong", finalDwellMs: 800 },
      idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
    });
    expect(poseDefaults).toEqual({
      idle_stretch: { playbackMode: "pingpong", finalDwellMs: 800 },
      idle_coffee: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
    });
    expect(warnings).toEqual([]);
  });

  it("drops a malformed field within an entry + warns (entry survives with its good fields)", () => {
    const { poseDefaults, warnings } = buildPoseDefaults({
      idle_stretch: { playbackMode: "bounce", finalDwellMs: 800 },
    });
    expect(poseDefaults).toEqual({ idle_stretch: { finalDwellMs: 800 } });
    expect(warnings.some((w) => w.includes("pose-defaults/idle_stretch") && w.includes("bounce"))).toBe(
      true,
    );
  });

  it("drops an entry whose object yields no valid field entirely", () => {
    const { poseDefaults } = buildPoseDefaults({
      idle_yawn: { playbackMode: "wat", speedMultiplier: "nope" },
    });
    // The only entry produced nothing valid → whole block collapses to null.
    expect(poseDefaults).toBeNull();
  });

  it("keeps the valid entries when ONE entry is all-invalid", () => {
    const { poseDefaults } = buildPoseDefaults({
      idle_yawn: { playbackMode: "wat" }, // dropped entirely
      idle_hips: { speedMultiplier: 0.5 }, // kept
    });
    expect(poseDefaults).toEqual({ idle_hips: { speedMultiplier: 0.5 } });
  });

  it("a non-object block (array / scalar) → null + warn, never throws", () => {
    expect(buildPoseDefaults([1, 2]).poseDefaults).toBeNull();
    expect(buildPoseDefaults([1, 2]).warnings).toHaveLength(1);
    expect(buildPoseDefaults(42).poseDefaults).toBeNull();
    expect(buildPoseDefaults("loop").poseDefaults).toBeNull();
  });
});
