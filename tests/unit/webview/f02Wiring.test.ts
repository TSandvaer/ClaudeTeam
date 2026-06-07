/**
 * F02 (ClaudeTeam-F02-Dev) wiring + 92×92 scale-contract tests (ticket 86ca5aczf).
 *
 * F02 is the first v3 92×92 persona character (F01/M01 are older 68×68). This
 * ticket harvests F02's PixelLab group, authors its `animations.json`, and bakes
 * it into the generated manifest. Two things need non-vacuous coverage:
 *
 *   1. MANIFEST WIRING — F02 lands in GENERATED_SPRITE_MANIFEST with all FIVE
 *      animations resolved to real frame paths, and (the F02-specific trap) the
 *      shared `add_a_small_computer` desk state's TWO anims disambiguate cleanly
 *      into active_work (seated/typing) vs active_read (head-scan at monitor) via
 *      the folder/slug value form — exactly the M01/F01 desk-share pattern but on
 *      a different folder name. A regression to slugDirs.sort()[0] would collapse
 *      both onto one slug; this pins them distinct.
 *
 *   2. 92×92 SCALE CONTRACT — the larger source sprite must render in-tile with
 *      no clip / overflow. The webview does NOT carry a per-character size branch:
 *      `.sprite-frame` is a FIXED `--ct-sprite-size` box with `object-fit: contain`
 *      + `image-rendering: pixelated`, so a 92×92 source `contain`s into the same
 *      box as a 68×68 source — scaling, never clipping. This test proves (a) the
 *      harvested F02 frames really ARE 92×92 (reads the PNG IHDR — not a claim),
 *      and (b) the CSS box-sizing is source-resolution-independent.
 *
 * Non-vacuity:
 *   - drop F02 from the manifest                → wiring assertions fail
 *   - collapse active_work/active_read onto one → distinctness assertion fails
 *   - re-roll F02 at 68px (or any non-92)       → the IHDR assertion fails
 *   - remove object-fit:contain / fixed box     → the scale-contract assertion fails
 *   - add a per-character px size branch in CSS  → the single-lever assertion fails
 *
 * Manifest + IHDR are pure data (node env); the CSS contract is read from the
 * committed dashboard.css text (same harness style as heroLayout / cardBg tests).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const F02 = "ClaudeTeam-F02-Dev";

describe("F02 manifest wiring (86ca5aczf)", () => {
  const char = GENERATED_SPRITE_MANIFEST.characters[F02];

  it("F02 is present in the generated manifest", () => {
    expect(char, "ClaudeTeam-F02-Dev missing from manifest").toBeDefined();
    expect(char.character).toBe(F02);
  });

  it("exposes all FIVE canonical anims (3 idle + active_work + active_read), each with frames", () => {
    for (const name of [
      "idle_coffee",
      "idle_stretch",
      "idle_think",
      "active_work",
      "active_read",
    ]) {
      const anim = char.animations[name];
      expect(anim, `F02 anim ${name} missing`).toBeDefined();
      expect(anim.frames.length, `F02 anim ${name} has no frames`).toBeGreaterThan(0);
    }
  });

  it("idlePool is exactly the three idle poses; activePool is the single-member [active_work] (ticket 86ca5ftzp)", () => {
    expect([...char.idlePool].sort()).toEqual(["idle_coffee", "idle_stretch", "idle_think"]);
    // F02 ships a single working pose, declared as a 1-member active_pool so
    // pickActive always returns active_work (dashboard pose identical to a
    // no-pool char) while the tuner's Active-pool / Cycle controls light up.
    expect(char.activePool).toEqual(["active_work"]);
  });

  it("frame paths are dist-relative under sprites/ClaudeTeam-F02-Dev/", () => {
    expect(char.animations.idle_coffee.frames[0]).toMatch(
      /^sprites\/ClaudeTeam-F02-Dev\/_pixellab_anims\/.+frame_\d+\.png$/,
    );
  });

  it("active_work + active_read SHARE the add_a_small_computer desk state but resolve to DISTINCT anims", () => {
    const work = char.animations.active_work;
    const read = char.animations.active_read;
    // Both live in the one shared desk folder (no book↔desk flip during active).
    expect(work.folder).toBe("add_a_small_computer");
    expect(read.folder).toBe("add_a_small_computer");
    // ...but the folder/slug form disambiguates them to different subfolders.
    expect(work.frames[0]).not.toBe(read.frames[0]);
    // active_read is the head-scan-at-monitor anim ("...reads_wh...").
    expect(read.frames[0]).toMatch(/reads_wh-[0-9a-f]+\/south\//);
    // active_work is the seated/typing anim — NOT the reads_wh one.
    expect(work.frames[0]).not.toMatch(/reads_wh-/);
    expect(work.frames[0]).toMatch(/stays_seated[^/]*\/south\//);
  });
});

describe("F02 is a 92×92 source sprite (proves the larger-sprite case, read from PNG IHDR)", () => {
  const char = GENERATED_SPRITE_MANIFEST.characters[F02];

  /** Read a PNG's intrinsic size from its IHDR chunk (width@16, height@20, BE). */
  function pngSize(distRelPath: string): { w: number; h: number } {
    // Manifest frame paths are dist-relative ("sprites/<char>/..."); the same
    // tree is the harvest source under assets/sprites/<char>/_pixellab_anims/.
    // Map "sprites/ClaudeTeam-F02-Dev/_pixellab_anims/..." → the asset path.
    const rel = distRelPath.replace(
      /^sprites\/ClaudeTeam-F02-Dev\//,
      "assets/sprites/ClaudeTeam-F02-Dev/",
    );
    const buf = readFileSync(join(root, rel));
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }

  it("every F02 anim's first frame is 92×92 (NOT the older 68×68)", () => {
    for (const name of Object.keys(char.animations)) {
      const { w, h } = pngSize(char.animations[name].frames[0]);
      expect({ name, w, h }).toEqual({ name, w: 92, h: 92 });
    }
  });
});

describe("92×92 scale contract — CSS sizes the sprite box source-resolution-independently", () => {
  const css = readFileSync(
    join(root, "src", "webview", "styles", "dashboard.css"),
    "utf8",
  );
  const normalized = css.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

  function bodyFor(selectorRegex: string, label: string): string {
    const re = new RegExp(`(?:^|[,{}\\s])${selectorRegex}\\s*\\{([^}]*)\\}`, "g");
    const bodies = [...normalized.matchAll(re)].map((m) => m[1]);
    expect(bodies.length, `no rule for ${label}`).toBeGreaterThan(0);
    return bodies.join(" ");
  }

  it(".sprite-frame is a FIXED --ct-sprite-size box (w === h === the single size token)", () => {
    const body = bodyFor("\\.sprite-frame", ".sprite-frame");
    expect(body).toMatch(/width:\s*var\(--ct-sprite-size\)/);
    expect(body).toMatch(/height:\s*var\(--ct-sprite-size\)/);
  });

  it(".sprite-frame uses object-fit: contain — a 92×92 source scales to fit, never clips/overflows", () => {
    const body = bodyFor("\\.sprite-frame", ".sprite-frame");
    expect(body).toMatch(/object-fit:\s*contain/);
  });

  it(".sprite-frame keeps image-rendering: pixelated (crisp at any scale ratio, incl. 92→box)", () => {
    const body = bodyFor("\\.sprite-frame", ".sprite-frame");
    expect(body).toMatch(/image-rendering:\s*pixelated/);
  });

  it("the box size is NOT branched per character / per source resolution (no 68px or 92px literal on the frame box)", () => {
    const body = bodyFor("\\.sprite-frame", ".sprite-frame");
    // The ONLY sizing lever is --ct-sprite-size; a hardcoded 68px/92px on the
    // frame box would mean a per-source branch — the failure this AC guards.
    expect(body).not.toMatch(/\b68px\b/);
    expect(body).not.toMatch(/\b92px\b/);
  });
});
