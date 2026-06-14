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
  detectMisplacedPoseDefaults,
  resolveStaticImage,
  buildScenes,
  sanitizeScenes,
  computeRenderFit,
  mergeRenderFit,
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
    expect(
      warnings.some((w) => w.includes("pose-defaults/idle_stretch") && w.includes("bounce")),
    ).toBe(true);
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

describe("detectMisplacedPoseDefaults — root-level anim footgun warn (E3 NIT 86ca292rr)", () => {
  // Non-vacuity: each "warns" case fails if the detector is reverted (returns no
  // warnings); each "does not warn" case fails if the detector over-fires.

  it("warns on a root-level anim-looking key (playback fields at the JSON root)", () => {
    const { warnings } = detectMisplacedPoseDefaults({
      // MISPLACED: should be under `playback`, not at the root.
      idle_stretch: { playbackMode: "pingpong", finalDwellMs: 800 },
      _note: "docs",
      playback: {},
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("idle_stretch");
    expect(warnings[0]).toContain("playback");
  });

  it("does NOT warn when the entry is correctly nested under `playback`", () => {
    const { warnings } = detectMisplacedPoseDefaults({
      _note: "docs",
      playback: { idle_stretch: { playbackMode: "pingpong", finalDwellMs: 800 } },
    });
    expect(warnings).toEqual([]);
  });

  it("does NOT warn on the shipped empty-file shape (`_note` string + empty `playback`)", () => {
    const { warnings } = detectMisplacedPoseDefaults({ _note: "docs", playback: {} });
    expect(warnings).toEqual([]);
  });

  it("warns once per misplaced key (multiple root anims)", () => {
    const { warnings } = detectMisplacedPoseDefaults({
      idle_stretch: { playbackMode: "pingpong" },
      idle_coffee: { speedMultiplier: 0.5 },
      playback: {},
    });
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes("idle_stretch"))).toBe(true);
    expect(warnings.some((w) => w.includes("idle_coffee"))).toBe(true);
  });

  it("does NOT warn on a root object that carries NO recognized playback field", () => {
    // A root object that isn't a playback entry (no known field) is not flagged —
    // avoids false-positiving on unrelated/future metadata objects.
    const { warnings } = detectMisplacedPoseDefaults({
      somethingElse: { foo: 1, bar: 2 },
      playback: {},
    });
    expect(warnings).toEqual([]);
  });

  it("does NOT warn on scalar root values (a future scalar metadata key)", () => {
    const { warnings } = detectMisplacedPoseDefaults({
      _note: "docs",
      version: 2,
      label: "team-defaults",
      playback: {},
    });
    expect(warnings).toEqual([]);
  });

  it("absent / null / non-object root → no warnings, never throws", () => {
    expect(detectMisplacedPoseDefaults(undefined).warnings).toEqual([]);
    expect(detectMisplacedPoseDefaults(null).warnings).toEqual([]);
    expect(detectMisplacedPoseDefaults([1, 2]).warnings).toEqual([]);
    expect(detectMisplacedPoseDefaults(42).warnings).toEqual([]);
  });
});

describe("resolveStaticImage — scene filename → {id,image} (scene-bg 86ca3kjyk)", () => {
  it("a .png filename → id (basename, no ext) + dist-relative image path", () => {
    expect(resolveStaticImage("room3.png")).toEqual({
      id: "room3",
      image: "sprites/scenes/room3.png",
    });
  });

  it("preserves dots/underscores in the id (only the final .png is stripped)", () => {
    expect(resolveStaticImage("cozy_office.v2.png")).toEqual({
      id: "cozy_office.v2",
      image: "sprites/scenes/cozy_office.v2.png",
    });
  });

  it("is case-insensitive on the extension", () => {
    expect(resolveStaticImage("Room3.PNG")).toEqual({
      id: "Room3",
      image: "sprites/scenes/Room3.PNG",
    });
  });

  it("returns null for a non-.png filename (caller skips it)", () => {
    expect(resolveStaticImage("notes.txt")).toBeNull();
    expect(resolveStaticImage("room3")).toBeNull();
    expect(resolveStaticImage(".gitkeep")).toBeNull();
  });
});

describe("buildScenes — manifest scenes registry (scene-bg 86ca3kjyk)", () => {
  it("the shipped V1 case: room3.png → defaultSceneId room3 + one byId entry", () => {
    const { scenes, warnings } = buildScenes(["room3.png"]);
    expect(scenes).toEqual({
      defaultSceneId: "room3",
      byId: { room3: { id: "room3", image: "sprites/scenes/room3.png" } },
    });
    expect(warnings).toEqual([]);
  });

  it("architected per-role: multiple scenes all land in byId, room3 stays default", () => {
    const { scenes, warnings } = buildScenes(["studio.png", "room3.png", "lab.png"]);
    expect(scenes!.defaultSceneId).toBe("room3");
    expect(Object.keys(scenes!.byId).sort()).toEqual(["lab", "room3", "studio"]);
    expect(scenes!.byId.studio).toEqual({
      id: "studio",
      image: "sprites/scenes/studio.png",
    });
    expect(warnings).toEqual([]);
  });

  it("no PNGs → null scenes (manifest omits the field → flat-card degrade)", () => {
    expect(buildScenes([])).toEqual({ scenes: null, warnings: [] });
    expect(buildScenes(["readme.md", ".gitkeep"])).toEqual({
      scenes: null,
      warnings: [],
    });
  });

  it("default scene PNG missing but others present → alphabetically-first default + warn", () => {
    const { scenes, warnings } = buildScenes(["studio.png", "lab.png"]);
    // ids sorted: lab < studio → lab becomes the fallback default.
    expect(scenes!.defaultSceneId).toBe("lab");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("room3");
    expect(warnings[0]).toContain("lab");
  });

  it("ignores non-PNG files while still building from the PNGs", () => {
    const { scenes } = buildScenes(["room3.png", "README.md", "thumbs.db"]);
    expect(Object.keys(scenes!.byId)).toEqual(["room3"]);
  });
});

describe("sanitizeScenes — per-char + pose-default scene block (scene-per-pose 86ca88nvd §4.1)", () => {
  const valid = new Set(["room3", "studio"]);

  it("keeps a scene id present in the registry", () => {
    const { scenes, warnings } = sanitizeScenes(
      "ClaudeTeam-M01-Dev",
      { idle_coffee: "room3" },
      valid,
    );
    expect(scenes).toEqual({ idle_coffee: "room3" });
    expect(warnings).toEqual([]);
  });

  it('always keeps the literal "none" sentinel (flat card), even with an empty registry', () => {
    // "none" is valid regardless of the registry — it is the explicit flat-card
    // STOP, not a scene id. This is the seed shape (§7).
    const { scenes, warnings } = sanitizeScenes(
      "pose-defaults",
      { active_work: "none", active_read: "none" },
      new Set(),
    );
    expect(scenes).toEqual({ active_work: "none", active_read: "none" });
    expect(warnings).toEqual([]);
  });

  it("DROPS a dangling scene id (not in the registry) + warns (build-time degrade §4)", () => {
    const { scenes, warnings } = sanitizeScenes(
      "ClaudeTeam-M01-Dev",
      { idle_coffee: "room3", idle_stretch: "ghost_room" },
      valid,
    );
    // room3 survives; ghost_room dropped → the block keeps only the valid entry.
    expect(scenes).toEqual({ idle_coffee: "room3" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ghost_room");
    expect(warnings[0]).toContain("not found in registry");
  });

  it("drops a non-string value + warns (malformed)", () => {
    const { scenes, warnings } = sanitizeScenes(
      "pose-defaults",
      { active_work: 7, idle_coffee: "room3" },
      valid,
    );
    expect(scenes).toEqual({ idle_coffee: "room3" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("active_work");
    expect(warnings[0]).toContain("must be a string");
  });

  it("returns null scenes when EVERY value dropped (block omitted → no-scenes degrade)", () => {
    const { scenes, warnings } = sanitizeScenes(
      "ClaudeTeam-M01-Dev",
      { idle_coffee: "ghost", idle_stretch: "phantom" },
      valid,
    );
    expect(scenes).toBeNull();
    expect(warnings).toHaveLength(2);
  });

  it("absent / null / empty block → null scenes, no warnings", () => {
    expect(sanitizeScenes("x", undefined, valid)).toEqual({
      scenes: null,
      warnings: [],
    });
    expect(sanitizeScenes("x", null, valid)).toEqual({
      scenes: null,
      warnings: [],
    });
    expect(sanitizeScenes("x", {}, valid)).toEqual({
      scenes: null,
      warnings: [],
    });
  });

  it("a non-object block (array / scalar) → null scenes + warn", () => {
    const arr = sanitizeScenes("x", ["room3"], valid);
    expect(arr.scenes).toBeNull();
    expect(arr.warnings).toHaveLength(1);
    expect(arr.warnings[0]).toContain("must be an object");

    const scalar = sanitizeScenes("x", "room3", valid);
    expect(scalar.scenes).toBeNull();
    expect(scalar.warnings).toHaveLength(1);
  });

  it('with NO registry (empty validSceneIds), a real scene id drops but "none" survives', () => {
    // The no-scenes-registry degrade (§4 "No scenes registry"): a seed that names
    // a real room would dangle (no PNG), but the "none" desk-clash seed stays.
    const { scenes, warnings } = sanitizeScenes(
      "pose-defaults",
      { active_work: "none", idle_coffee: "room3" },
      new Set(),
    );
    expect(scenes).toEqual({ active_work: "none" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("room3");
  });
});

// ===========================================================================
// Bake round-trip — registry validates the scene blocks (mirrors main()'s
// ordering: buildScenes → validSceneIds → sanitizeScenes per-char + pose-default)
// (scene-per-pose 86ca88nvd — manifest bake AC)
// ===========================================================================
describe("scene bake round-trip — registry validates per-char + pose-default blocks", () => {
  // Reproduce the exact composition `main()` performs so the wiring (registry id
  // set feeds both sanitize calls) is asserted end-to-end without a filesystem.
  function bake(opts: { sceneFiles: string[]; perChar?: unknown; poseDefaultScenes?: unknown }) {
    const { scenes } = buildScenes(opts.sceneFiles);
    const validSceneIds = new Set(scenes !== null ? Object.keys(scenes.byId) : []);
    const charBake = sanitizeScenes("M01", opts.perChar, validSceneIds);
    const poseBake = sanitizeScenes("pose-defaults", opts.poseDefaultScenes, validSceneIds);
    return {
      scenes,
      charScenes: charBake.scenes,
      sceneDefaults: poseBake.scenes,
      warnings: [...charBake.warnings, ...poseBake.warnings],
    };
  }

  it("the SEED + a real registry: pose-default scenes bakes the desk-clash seed verbatim", () => {
    const out = bake({
      sceneFiles: ["room3.png"],
      poseDefaultScenes: { active_work: "none", active_read: "none" },
    });
    // The seed (§7) round-trips: both desk poses → "none" (flat card).
    expect(out.sceneDefaults).toEqual({ active_work: "none", active_read: "none" });
    expect(out.warnings).toEqual([]);
    // The registry still ships room3 (the inherited default for idles).
    expect(out.scenes!.defaultSceneId).toBe("room3");
  });

  it("a per-char real scene id round-trips when its PNG is in the registry", () => {
    const out = bake({
      sceneFiles: ["room3.png", "studio.png"],
      perChar: { idle_coffee: "studio", active_work: "none" },
    });
    expect(out.charScenes).toEqual({ idle_coffee: "studio", active_work: "none" });
    expect(out.warnings).toEqual([]);
  });

  it("a per-char DANGLING id drops + warns; the valid sibling survives (drop+warn AC)", () => {
    const out = bake({
      sceneFiles: ["room3.png"], // studio.png is NOT shipped → studio dangles
      perChar: { idle_coffee: "studio", idle_stretch: "room3" },
    });
    // Dangling "studio" dropped; "room3" (in registry) kept.
    expect(out.charScenes).toEqual({ idle_stretch: "room3" });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("studio");
    expect(out.warnings[0]).toContain("not found in registry");
  });

  it("NO registry at all → real ids dangle, only the seed's none survives (full degrade)", () => {
    const out = bake({
      sceneFiles: [], // no PNGs → manifest omits the registry
      poseDefaultScenes: { active_work: "none", active_read: "none", idle_coffee: "room3" },
    });
    expect(out.scenes).toBeNull();
    // none survives, room3 dangles (no registry).
    expect(out.sceneDefaults).toEqual({ active_work: "none", active_read: "none" });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain("room3");
  });
});

// ── computeRenderFit — bbox → uniform on-tile figure height (86ca8n5pe) ───────
//
// Non-vacuity: each assertion below FAILS if the math is reverted —
//   - the figure-height uniformity assertion fails if `scale` stops normalizing
//     to TARGET_FIGURE_FRACTION (e.g. a hardcoded 1.5).
//   - the grounding assertion fails if `feetAnchorPct` / `offsetY` stop tracking
//     the measured feet (the "scale about the feet, not center" contract — a
//     center-origin regression makes scaled figures float off the room floor).
describe("computeRenderFit — per-char figure-size normalization (86ca8n5pe)", () => {
  const TARGET = 0.706; // matches TARGET_FIGURE_FRACTION (the M02 apparent size).

  it("a v3 92×92 char (figure ~51% of canvas) scales UP toward the target", () => {
    // figure rows 22..68 → height 47 of 92 → fill ≈ 0.511 → scale ≈ 0.706/0.511.
    const fit = computeRenderFit({ figureTop: 22, figureBottom: 68, canvasH: 92 });
    expect(fit).not.toBeNull();
    // The on-tile figure height = scale × fill must land on the target.
    const fill = (68 - 22 + 1) / 92;
    expect(fit!.scale * fill).toBeCloseTo(TARGET, 3);
    expect(fit!.scale).toBeGreaterThan(1); // v3 is enlarged
  });

  it("a legacy 68×68 char (figure ~71%) is already ~at target → scale ≈ 1 (no special-casing)", () => {
    // figure rows 10..58 → height 49 of 68 → fill ≈ 0.721 → scale ≈ 0.706/0.721 < 1.
    const fit = computeRenderFit({ figureTop: 10, figureBottom: 58, canvasH: 68 });
    expect(fit).not.toBeNull();
    const fill = (58 - 10 + 1) / 68;
    expect(fit!.scale * fill).toBeCloseTo(TARGET, 3);
    expect(fit!.scale).toBeLessThan(1.05); // near identity — the M02 baseline
  });

  it("produces a UNIFORM on-tile figure height across a mixed roster (the whole point)", () => {
    // Two different canvas sizes + fill ratios must yield the SAME on-tile height.
    const v3 = computeRenderFit({ figureTop: 22, figureBottom: 68, canvasH: 92 })!;
    const legacy = computeRenderFit({ figureTop: 10, figureBottom: 58, canvasH: 68 })!;
    const onTileV3 = v3.scale * ((68 - 22 + 1) / 92);
    const onTileLegacy = legacy.scale * ((58 - 10 + 1) / 68);
    expect(onTileV3).toBeCloseTo(onTileLegacy, 3); // uniform regardless of canvas
    expect(onTileV3).toBeCloseTo(TARGET, 3);
  });

  it("anchors the scale about the FEET (not center) so grounding is preserved", () => {
    // feetAnchorPct = (figureBottom + 1) / canvasH × 100 — the measured contact line.
    const fit = computeRenderFit({ figureTop: 22, figureBottom: 68, canvasH: 92 })!;
    expect(fit.feetAnchorPct).toBeCloseTo(((68 + 1) / 92) * 100, 3); // ≈ 75%
    // offsetY drops the feet from feetAnchorPct to the box bottom (100%) = floor.
    expect(fit.offsetY).toBeCloseTo(100 - fit.feetAnchorPct, 3);
    // Post-transform feet position = feetAnchorPct + offsetY = 100% (grounded).
    expect(fit.feetAnchorPct + fit.offsetY).toBeCloseTo(100, 3);
  });

  it("degenerate inputs → null (caller falls back to identity, never bakes NaN)", () => {
    expect(computeRenderFit({ figureTop: 0, figureBottom: 0, canvasH: 0 })).toBeNull();
    expect(computeRenderFit({ figureTop: 50, figureBottom: 10, canvasH: 92 })).toBeNull(); // zero/negative figure height
    expect(computeRenderFit({ figureTop: Number.NaN, figureBottom: 68, canvasH: 92 })).toBeNull();
    expect(computeRenderFit(null)).toBeNull();
  });

  it("honors an explicit target fraction", () => {
    const fit = computeRenderFit({ figureTop: 22, figureBottom: 68, canvasH: 92 }, 0.6)!;
    expect(fit.scale * ((68 - 22 + 1) / 92)).toBeCloseTo(0.6, 3);
  });
});

// ── mergeRenderFit — auto + manual override per-field (86ca8n5pe) ─────────────
describe("mergeRenderFit — auto value with manual per-field override", () => {
  const auto = { scale: 1.4, offsetY: 26, feetAnchorPct: 74 };

  it("no manual block → the auto value passes through unchanged", () => {
    expect(mergeRenderFit(auto, null)).toEqual(auto);
  });

  it("a manual field WINS over the auto field; un-overridden auto fields survive", () => {
    // Sponsor nudges only offsetY — scale + feetAnchorPct stay auto.
    expect(mergeRenderFit(auto, { offsetY: 30 })).toEqual({
      scale: 1.4,
      offsetY: 30,
      feetAnchorPct: 74,
    });
  });

  it("a full manual block overrides every field", () => {
    const manual = { scale: 2, offsetY: 0, feetAnchorPct: 50 };
    expect(mergeRenderFit(auto, manual)).toEqual(manual);
  });

  it("both null → null (manifest omits render → identity, no normalization)", () => {
    expect(mergeRenderFit(null, null)).toBeNull();
  });

  it("auto null + manual present → the manual block (pure manual char)", () => {
    expect(mergeRenderFit(null, { scale: 1.2 })).toEqual({ scale: 1.2 });
  });
});
