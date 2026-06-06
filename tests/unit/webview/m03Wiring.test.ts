/**
 * M03 (ClaudeTeam-M03-Dev) wiring + 92×92 source-size tests (ticket 86ca5at8f).
 *
 * Near-exact mirror of f02Wiring.test.ts — M03 is the second v3 92×92 persona
 * character (after F02; F01/M01 are older 68×68). This ticket harvests M03's
 * PixelLab group, authors its `animations.json`, and bakes it into the generated
 * manifest. Two things need non-vacuous coverage:
 *
 *   1. MANIFEST WIRING — M03 lands in GENERATED_SPRITE_MANIFEST with all FIVE
 *      animations resolved to real frame paths, and the desk-share trap holds:
 *      the shared `sitting_at_a_desk_wo` desk state's TWO anims disambiguate
 *      cleanly into active_work (seated/typing) vs active_read (head-scan at
 *      monitor) via the folder/slug value form. A regression to slugDirs.sort()[0]
 *      would collapse both onto one slug; this pins them distinct.
 *
 *   2. 92×92 SOURCE SIZE — the harvested M03 frames really ARE 92×92 (read from
 *      the PNG IHDR, not a claim). The webview carries NO per-character size
 *      branch: `.sprite-frame` is a FIXED `--ct-sprite-size` box with
 *      `object-fit: contain`, proven source-resolution-independent by the
 *      f02Wiring.test.ts CSS scale-contract block (character-agnostic — not
 *      re-asserted here to avoid duplicate coverage of the same single CSS rule).
 *
 * Non-vacuity:
 *   - drop M03 from the manifest                 → wiring assertions fail
 *   - collapse active_work/active_read onto one  → distinctness assertion fails
 *   - re-roll M03 at 68px (or any non-92)        → the IHDR assertion fails
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const M03 = "ClaudeTeam-M03-Dev";

describe("M03 manifest wiring (86ca5at8f)", () => {
  const char = GENERATED_SPRITE_MANIFEST.characters[M03];

  it("M03 is present in the generated manifest", () => {
    expect(char, "ClaudeTeam-M03-Dev missing from manifest").toBeDefined();
    expect(char.character).toBe(M03);
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
      expect(anim, `M03 anim ${name} missing`).toBeDefined();
      expect(anim.frames.length, `M03 anim ${name} has no frames`).toBeGreaterThan(0);
    }
  });

  it("idlePool is exactly the three idle poses; there is NO active pool (single active_work pose)", () => {
    expect([...char.idlePool].sort()).toEqual(["idle_coffee", "idle_stretch", "idle_think"]);
    // M03 ships a single working pose — no active_pool stickiness (mirrors F02).
    expect(char.activePool ?? []).toEqual([]);
  });

  it("default idle is idle_coffee", () => {
    expect(char.defaultIdle).toBe("idle_coffee");
  });

  it("frame paths are dist-relative under sprites/ClaudeTeam-M03-Dev/", () => {
    expect(char.animations.idle_coffee.frames[0]).toMatch(
      /^sprites\/ClaudeTeam-M03-Dev\/_pixellab_anims\/.+frame_\d+\.png$/,
    );
  });

  it("active_work + active_read SHARE the sitting_at_a_desk_wo desk state but resolve to DISTINCT anims", () => {
    const work = char.animations.active_work;
    const read = char.animations.active_read;
    // Both live in the one shared desk folder (no book↔desk flip during active).
    expect(work.folder).toBe("sitting_at_a_desk_wo");
    expect(read.folder).toBe("sitting_at_a_desk_wo");
    // ...but the folder/slug form disambiguates them to different subfolders.
    expect(work.frames[0]).not.toBe(read.frames[0]);
    // active_read is the head-scan-at-monitor anim ("...reads_wh...").
    expect(read.frames[0]).toMatch(/reads_wh-[0-9a-f]+\/south\//);
    // active_work is the seated/typing anim — NOT the reads_wh one.
    expect(work.frames[0]).not.toMatch(/reads_wh-/);
    expect(work.frames[0]).toMatch(/stays_seated[^/]*\/south\//);
  });
});

describe("M03 is a 92×92 source sprite (read from PNG IHDR — proves the larger-sprite case)", () => {
  const char = GENERATED_SPRITE_MANIFEST.characters[M03];

  /** Read a PNG's intrinsic size from its IHDR chunk (width@16, height@20, BE). */
  function pngSize(distRelPath: string): { w: number; h: number } {
    // Manifest frame paths are dist-relative ("sprites/<char>/..."); the same
    // tree is the harvest source under assets/sprites/<char>/_pixellab_anims/.
    const rel = distRelPath.replace(
      /^sprites\/ClaudeTeam-M03-Dev\//,
      "assets/sprites/ClaudeTeam-M03-Dev/",
    );
    const buf = readFileSync(join(root, rel));
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }

  it("every M03 anim's first frame is 92×92 (NOT the older 68×68)", () => {
    for (const name of Object.keys(char.animations)) {
      const { w, h } = pngSize(char.animations[name].frames[0]);
      expect({ name, w, h }).toEqual({ name, w: 92, h: 92 });
    }
  });
});
