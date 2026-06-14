/**
 * Integration test for roster-wide on-tile figure-size normalization
 * (ticket 86ca8n5pe).
 *
 * The build script measures each character's figure bbox from its base/idle south
 * frame and bakes a `render: { scale, offsetY, feetAnchorPct }` correction so the
 * WHOLE roster renders its figure at a UNIFORM on-tile height grounded on the
 * scene floor — regardless of canvas size (92×92 v3 vs 68×68 legacy) or fill
 * ratio (figure ~50% vs ~71% of the canvas).
 *
 * This suite drives the IMPURE half (`readPngAlphaBbox` over the real shipped
 * PNGs) that the pure-function unit tests in
 * `tests/unit/webview/buildSpriteManifest.test.ts` (`computeRenderFit` /
 * `mergeRenderFit`) cannot — it confirms:
 *   1. `readPngAlphaBbox` decodes the real RGBA8 frames + isolates the figure.
 *   2. The SHIPPED `generatedManifest.ts` render block, applied to each char's
 *      MEASURED fill, yields the SAME on-tile figure height for every character
 *      (the normalization goal).
 *   3. Every char's baked feet-anchor + offset grounds the feet at the box bottom
 *      (= the scene room floor) — the "scale about the feet, not center" contract.
 *
 * Non-vacuity: assertion (2) FAILS if the build reverts to a hardcoded per-char
 * scale (the old 1.5) — the on-tile heights would diverge with each char's fill.
 * Assertion (3) FAILS if a center-origin regression breaks grounding.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPngAlphaBbox, computeRenderFit } from "../../scripts/build-sprite-manifest.mjs";
import { GENERATED_SPRITE_MANIFEST } from "../../src/webview/sprites/generatedManifest.js";
import type { SpriteCharacter } from "../../src/webview/sprites/spriteManifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SPRITES_SRC = path.join(ROOT, "assets", "sprites");

/** The committed manifest the webview imports — the shipped artifact under test. */
function loadShippedManifest(): { characters: Record<string, SpriteCharacter> } {
  return GENERATED_SPRITE_MANIFEST;
}

/** Resolve the absolute source PNG for a char's base/idle south frame_000. */
function baseFramePath(char: SpriteCharacter): string | null {
  const idle =
    (char.defaultIdle && char.animations[char.defaultIdle] ? char.defaultIdle : undefined) ??
    char.idlePool[0] ??
    Object.keys(char.animations)[0];
  const rel = idle ? char.animations[idle]?.frames[0] : undefined;
  if (!rel) return null;
  return path.join(SPRITES_SRC, rel.replace(/^sprites\//, ""));
}

describe("readPngAlphaBbox — real shipped frames (86ca8n5pe)", () => {
  it("decodes every shipped char's base/idle frame + isolates a plausible figure bbox", async () => {
    const manifest = loadShippedManifest();
    const chars = Object.values(manifest.characters);
    expect(chars.length).toBeGreaterThan(0);
    for (const char of chars) {
      const frame = baseFramePath(char);
      expect(frame, `${char.character} must have a base frame`).not.toBeNull();
      const bbox = await readPngAlphaBbox(frame!);
      expect(bbox, `${char.character} frame must decode with an alpha bbox`).not.toBeNull();
      // The figure must be a real sub-region of the canvas, not the whole canvas
      // and not empty — a sanity check that the decoder isolated the sprite.
      const figureH = bbox!.maxY - bbox!.minY + 1;
      expect(figureH).toBeGreaterThan(0);
      expect(figureH).toBeLessThan(bbox!.canvasH); // a transparent margin exists
      expect(bbox!.canvasW).toBeGreaterThan(0);
      expect(bbox!.canvasH).toBeGreaterThan(0);
    }
  });
});

describe("shipped manifest normalizes the WHOLE roster to a uniform on-tile height (86ca8n5pe)", () => {
  it("every char's (baked scale × measured fill) lands on the same on-tile figure height", async () => {
    const manifest = loadShippedManifest();
    const chars = Object.values(manifest.characters);
    const onTileHeights: number[] = [];
    for (const char of chars) {
      const render = char.render;
      expect(render, `${char.character} must carry an auto render block`).toBeDefined();
      expect(typeof render!.scale).toBe("number");
      expect(typeof render!.offsetY).toBe("number");
      expect(typeof render!.feetAnchorPct).toBe("number");

      const frame = baseFramePath(char)!;
      const bbox = (await readPngAlphaBbox(frame))!;
      const fill = (bbox.maxY - bbox.minY + 1) / bbox.canvasH;
      // On-tile figure height = scale × fill (object-fit maps canvas→box 1:1).
      onTileHeights.push(render!.scale! * fill);

      // Grounding: feet land at the box bottom (= room floor) after the transform.
      expect(
        render!.feetAnchorPct! + render!.offsetY!,
        `${char.character} feet must ground at 100%`,
      ).toBeCloseTo(100, 1);

      // The baked feetAnchorPct must equal the MEASURED feet position — proving
      // the scale pivots about the real feet (grounding-preserving), not center.
      const measuredFeetPct = ((bbox.maxY + 1) / bbox.canvasH) * 100;
      expect(render!.feetAnchorPct!).toBeCloseTo(measuredFeetPct, 1);
    }
    // All on-tile heights equal → uniform figure size across the roster.
    const first = onTileHeights[0];
    for (const h of onTileHeights) {
      expect(h).toBeCloseTo(first, 2);
    }
  });

  it("the baked render block matches a fresh computeRenderFit on the measured bbox (no drift)", async () => {
    const manifest = loadShippedManifest();
    for (const char of Object.values(manifest.characters)) {
      const frame = baseFramePath(char)!;
      const bbox = (await readPngAlphaBbox(frame))!;
      const fresh = computeRenderFit({
        figureTop: bbox.minY,
        figureBottom: bbox.maxY,
        canvasH: bbox.canvasH,
      })!;
      // The committed manifest must equal a fresh re-measurement (catches a stale
      // generatedManifest.ts — i.e. a build that wasn't re-run after a frame swap).
      expect(char.render!.scale).toBeCloseTo(fresh.scale, 3);
      expect(char.render!.offsetY).toBeCloseTo(fresh.offsetY, 3);
      expect(char.render!.feetAnchorPct).toBeCloseTo(fresh.feetAnchorPct, 3);
    }
  });
});
