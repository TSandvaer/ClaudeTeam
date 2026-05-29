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
