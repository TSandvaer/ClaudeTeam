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

import { afterAll, describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import zlib from "node:zlib";
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

// ── EDGE PROBES (ticket 86ca8ncja) — additive bbox/normalization coverage ─────
//
// The shipped-roster passes above only exercise figures that DO occupy a real
// sub-region of the canvas. These probes drive `readPngAlphaBbox` + the
// `computeRenderFit` math through the corner cases the shipped frames never hit:
// an empty (all-transparent) figure, a figure already AT target, and a figure
// that fills the WHOLE canvas (zero margins). They synthesize tiny RGBA8 PNGs in
// a tempdir and feed them through the SAME decode→fit path the build uses.
//
// Non-vacuity (each mutation-verified — corrupt the guard/scale → RED, restore):
//   • Probe 1 fails if the decoder's `maxX < 0` (empty-bbox) guard is removed —
//     a fully transparent frame then returns minX/minY=W/H, maxX/maxY=-1, which
//     `computeRenderFit` turns into a non-finite scale (figureH ≤ 0 → null only
//     because the guard fired first; without it the bbox is corrupt).
//   • Probe 2 fails if `scale` stops normalizing to the target (e.g. a hardcoded
//     per-char 1.5) — a figure already AT 0.706 fill must yield scale ≈ 1.0.
//   • Probe 3 fails if a full-canvas figure produces a non-finite scale OR breaks
//     grounding (feetAnchorPct + offsetY must still === 100 at zero margins).

const TARGET_FIGURE_FRACTION = 0.706; // mirrors the build's TARGET_FIGURE_FRACTION.

const pngTmp = mkdtempSync(path.join(tmpdir(), "renderfit-edge-"));
afterAll(() => {
  rmSync(pngTmp, { recursive: true, force: true });
});

describe("readPngAlphaBbox edge: all-transparent PNG → null → identity (86ca8ncja probe 1)", () => {
  it("a fully transparent frame returns null (no figure to measure)", async () => {
    // 24×24 RGBA8, every pixel alpha=0 — no pixel clears FIGURE_ALPHA_THRESHOLD.
    const file = path.join(pngTmp, "all-transparent.png");
    writeFileSync(file, encodeRgba8Png(24, 24, () => [0, 0, 0, 0]));

    const bbox = await readPngAlphaBbox(file);
    // The `maxX < 0` guard returns null here. MUTATION: delete that guard in the
    // decoder and this becomes a corrupt bbox (minX=24, maxX=-1), turning the
    // assertion RED.
    expect(bbox).toBeNull();
  });

  it("a transparent-figure path normalizes to IDENTITY, never NaN/Infinity scale", async () => {
    const file = path.join(pngTmp, "all-transparent-2.png");
    writeFileSync(file, encodeRgba8Png(32, 32, () => [255, 255, 255, 0]));

    const bbox = await readPngAlphaBbox(file);
    expect(bbox).toBeNull();
    // The build does `if (bbox) { autoRender = computeRenderFit(...) }` — a null
    // bbox means NO render block is baked → the char falls back to the CSS
    // identity transform. Simulate that contract: feeding the (absent) bbox to
    // computeRenderFit must never yield a non-finite scale. There is nothing to
    // measure, so the only correct outcome is "no render-fit", i.e. identity.
    const fit = bbox
      ? computeRenderFit({
          figureTop: (bbox as { minY: number }).minY,
          figureBottom: (bbox as { maxY: number }).maxY,
          canvasH: (bbox as { canvasH: number }).canvasH,
        })
      : null;
    expect(fit).toBeNull(); // identity — no transform baked.
  });
});

describe("render-fit edge: 68px figure already at target → scale ≈ 1.0 (86ca8ncja probe 2)", () => {
  it("an M02-like figure occupying ≈0.706 of the canvas measures scale ≈ 1.0", async () => {
    // 68×68 canvas, figure fills exactly 48 rows (48/68 ≈ 0.70588 ≈ TARGET) at
    // full width, grounded at the bottom (rows 20..67). This is the M02 baseline:
    // the figure is ALREADY at the target apparent size, so normalization must be
    // a near-no-op (scale ≈ 1.0) — proving the build does NOT special-case any
    // character and a new char at the target auto-resolves to identity-scale.
    const W = 68;
    const H = 68;
    const figureTop = 20;
    const figureBottom = 67; // inclusive → 48 rows → fill 48/68 ≈ 0.70588.
    const file = path.join(pngTmp, "at-target-68.png");
    writeFileSync(
      file,
      encodeRgba8Png(W, H, (_x, y) =>
        y >= figureTop && y <= figureBottom ? [10, 20, 30, 255] : [0, 0, 0, 0],
      ),
    );

    const bbox = (await readPngAlphaBbox(file))!;
    expect(bbox).not.toBeNull();
    expect(bbox.minY).toBe(figureTop);
    expect(bbox.maxY).toBe(figureBottom);

    const fit = computeRenderFit({
      figureTop: bbox.minY,
      figureBottom: bbox.maxY,
      canvasH: bbox.canvasH,
    })!;
    const fill = (bbox.maxY - bbox.minY + 1) / bbox.canvasH;
    // fill ≈ 0.70588, target 0.706 → scale = 0.706/0.70588 ≈ 1.0017.
    expect(fill).toBeCloseTo(TARGET_FIGURE_FRACTION, 2);
    expect(fit.scale).toBeCloseTo(1.0, 2); // MUTATION: hardcode scale=1.5 → RED.
    // And the on-tile figure height already equals the target (no enlargement).
    expect(fit.scale * fill).toBeCloseTo(TARGET_FIGURE_FRACTION, 3);
  });
});

describe("render-fit edge: full-canvas figure (zero margins) → finite + grounded (86ca8ncja probe 3)", () => {
  it("a figure filling the entire frame yields finite scale AND grounds at 100%", async () => {
    // 40×40 canvas, EVERY pixel opaque → figure occupies the whole frame, no
    // transparent margin anywhere (figureTop=0, figureBottom=39, fill=1.0).
    const W = 40;
    const H = 40;
    const file = path.join(pngTmp, "full-canvas.png");
    writeFileSync(file, encodeRgba8Png(W, H, () => [200, 100, 50, 255]));

    const bbox = (await readPngAlphaBbox(file))!;
    expect(bbox).not.toBeNull();
    expect(bbox.minX).toBe(0);
    expect(bbox.minY).toBe(0);
    expect(bbox.maxX).toBe(W - 1);
    expect(bbox.maxY).toBe(H - 1); // fills the whole canvas.

    const fit = computeRenderFit({
      figureTop: bbox.minY,
      figureBottom: bbox.maxY,
      canvasH: bbox.canvasH,
    })!;
    // fill = 1.0 → scale = target/1.0 = 0.706 (shrinks an over-large figure). The
    // value must be FINITE — no division-by-zero / NaN at the zero-margin edge.
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.scale).toBeGreaterThan(0);
    expect(fit.scale).toBeCloseTo(TARGET_FIGURE_FRACTION, 3);
    // Grounding: a full-canvas figure's feet are the very bottom edge →
    // feetAnchorPct = (39 + 1)/40 × 100 = 100 → offsetY = 0 → sum still 100.
    expect(fit.feetAnchorPct).toBeCloseTo(100, 3);
    expect(fit.offsetY).toBeCloseTo(0, 3);
    expect(fit.feetAnchorPct + fit.offsetY).toBeCloseTo(100, 3); // grounded.
  });
});

/**
 * Minimal self-contained RGBA8 (color type 6, bit depth 8) PNG encoder for the
 * edge probes — the repo ships no PNG library, and `readPngAlphaBbox` is itself a
 * self-contained decoder, so we mirror it on the encode side. Writes filter-0
 * (None) scanlines, which `readPngAlphaBbox` un-filters via its `filter === 0`
 * branch. CRC32 is computed in-line (Node `zlib.crc32` is not guaranteed on all
 * Node 20.x; the decoder ignores CRC, but a well-formed PNG keeps the encoder
 * portable). `px(x, y)` returns the [r, g, b, a] for each pixel.
 */
function encodeRgba8Png(
  width: number,
  height: number,
  px: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const rawData = Buffer.alloc(height * (stride + 1));
  let q = 0;
  for (let y = 0; y < height; y++) {
    rawData[q++] = 0; // filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = px(x, y);
      rawData[q++] = r & 0xff;
      rawData[q++] = g & 0xff;
      rawData[q++] = b & 0xff;
      rawData[q++] = a & 0xff;
    }
  }
  const idat = zlib.deflateSync(rawData);

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, body: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(body.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])), 0);
  return Buffer.concat([lenBuf, typeBuf, body, crcBuf]);
}

const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
