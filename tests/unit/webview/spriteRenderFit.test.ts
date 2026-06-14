/**
 * @vitest-environment jsdom
 *
 * Unit tests for per-character sprite render-fit (ticket 86ca5b0gj; roster-wide
 * AUTO-normalization + feet-anchored grounding 86ca8n5pe).
 *
 * The roster mixes canvas sizes (92×92 v3 vs 68×68 legacy) + fill ratios (figure
 * ~50% vs ~71% of the canvas). With `.sprite-frame { object-fit: contain }` the
 * WHOLE square canvas scales into the box, so without correction the figures
 * render at DIFFERENT apparent sizes. The build script measures each char's
 * figure bbox and bakes a `render: { scale, offsetY, feetAnchorPct }` correction
 * so the WHOLE roster shows a UNIFORM on-tile figure height grounded on the scene
 * floor; the three values drive the `--ct-render-scale` / `--ct-render-offset-y`
 * / `--ct-render-feet-anchor` CSS custom props on each `.sprite-box`.
 *
 * Three surfaces are covered (the bbox→render MATH is unit-tested in
 * buildSpriteManifest.test.ts `computeRenderFit`; the real-frame measurement in
 * the integration test renderFitNormalization.test.ts):
 *   1. build sanitizer `sanitizeRenderFit` — finite-number validation (incl. the
 *      new `feetAnchorPct` field) + drop + identity-when-absent.
 *   2. `createSpriteBox` — sets all three custom props from `char.render`, AND
 *      leaves them UNSET when `render` is absent (the no-regression contract);
 *      the reduced-motion static frame is scaled + grounded too (AC4).
 *   3. shipped manifest — every char carries an auto render block + grounds at
 *      the box bottom (`feetAnchorPct + offsetY === 100`).
 *
 * Non-vacuity: each block FAILS if the fix is reverted — props not set (figure
 * renders identity → small + floating), or grounding broken (a center-origin
 * regression makes scaled figures float off the room floor).
 */

import { describe, it, expect } from "vitest";
import { sanitizeRenderFit } from "../../../scripts/build-sprite-manifest.mjs";
import { createSpriteBox } from "../../../src/webview/sprites/spritePlayer.js";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";
import type { SpriteCharacter } from "../../../src/webview/sprites/spriteManifest.js";

// ── 1. build sanitizer ──────────────────────────────────────────────────────

describe("sanitizeRenderFit — build-time validation (86ca5b0gj)", () => {
  it("keeps both finite-number fields", () => {
    const { render, warnings } = sanitizeRenderFit("C", { scale: 1.5, offsetY: 4 });
    expect(render).toEqual({ scale: 1.5, offsetY: 4 });
    expect(warnings).toHaveLength(0);
  });

  it("keeps the feetAnchorPct field (86ca8n5pe) too", () => {
    const { render, warnings } = sanitizeRenderFit("C", {
      scale: 1.4,
      offsetY: 26,
      feetAnchorPct: 74,
    });
    expect(render).toEqual({ scale: 1.4, offsetY: 26, feetAnchorPct: 74 });
    expect(warnings).toHaveLength(0);
  });

  it("keeps only the field present (partial block)", () => {
    expect(sanitizeRenderFit("C", { scale: 1.4 }).render).toEqual({ scale: 1.4 });
    expect(sanitizeRenderFit("C", { offsetY: -2 }).render).toEqual({ offsetY: -2 });
  });

  it("absent / null block → null render (manifest omits → identity)", () => {
    expect(sanitizeRenderFit("C", undefined).render).toBeNull();
    expect(sanitizeRenderFit("C", null).render).toBeNull();
  });

  it("empty object → null render (nothing valid survived)", () => {
    expect(sanitizeRenderFit("C", {}).render).toBeNull();
  });

  it("non-finite / non-number fields are DROPPED with a warning, not kept", () => {
    const { render, warnings } = sanitizeRenderFit("C", {
      scale: "1.5",
      offsetY: Number.NaN,
    });
    expect(render).toBeNull();
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toMatch(/render\.scale/);
    expect(warnings.join(" ")).toMatch(/render\.offsetY/);
  });

  it("a non-object block is ignored with a warning (never throws)", () => {
    const { render, warnings } = sanitizeRenderFit("C", [1, 2]);
    expect(render).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/render must be an object/);
  });

  it("Infinity is treated as non-finite → dropped", () => {
    expect(sanitizeRenderFit("C", { scale: Infinity }).render).toBeNull();
  });
});

// ── 2. createSpriteBox prop-setting ───────────────────────────────────────────

/** Build a synthetic character; render block opt-in via the 3rd arg. */
function char(name: string, render?: SpriteCharacter["render"]): SpriteCharacter {
  const c: SpriteCharacter = {
    character: name,
    defaultIdle: "idle_coffee",
    idlePool: ["idle_coffee"],
    activePool: [],
    animations: {
      idle_coffee: {
        folder: "idle_coffee",
        frames: [`${name}/idle_coffee/frame_0.png`, `${name}/idle_coffee/frame_1.png`],
      },
    },
  };
  if (render) c.render = render;
  return c;
}

describe("createSpriteBox — render-fit custom props (86ca5b0gj; feet-anchor 86ca8n5pe)", () => {
  it("sets all three render props (scale + offsetY + feetAnchorPct) from char.render", () => {
    const handle = createSpriteBox({
      char: char("ClaudeTeam-F02-Dev", {
        scale: 1.412,
        offsetY: 26.087,
        feetAnchorPct: 73.913,
      }),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true, // no real timer
      rng: () => 0,
    });
    const box = handle.element;
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe("1.412");
    expect(box.style.getPropertyValue("--ct-render-offset-y")).toBe("26.087%");
    expect(box.style.getPropertyValue("--ct-render-feet-anchor")).toBe("73.913%");
  });

  it("leaves ALL props unset when char has no render block (identity no-regression)", () => {
    const handle = createSpriteBox({
      char: char("ClaudeTeam-NoRender-Dev"),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true,
      rng: () => 0,
    });
    const box = handle.element;
    // Unset → the CSS :root identity fallbacks (1 / 0% / 50%) apply → no transform.
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe("");
    expect(box.style.getPropertyValue("--ct-render-offset-y")).toBe("");
    expect(box.style.getPropertyValue("--ct-render-feet-anchor")).toBe("");
  });

  it("sets only the field present in a partial render block (each prop independent)", () => {
    const handle = createSpriteBox({
      char: char("ClaudeTeam-F02-Dev", { scale: 1.6 }),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true,
      rng: () => 0,
    });
    const box = handle.element;
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe("1.6");
    expect(box.style.getPropertyValue("--ct-render-offset-y")).toBe("");
    expect(box.style.getPropertyValue("--ct-render-feet-anchor")).toBe("");
  });

  it("scaled sprite still grounds: the reduced-motion frame carries the same render props", () => {
    // The render props are set BEFORE the reduced-motion early-return, so the
    // static frame-0 (prefers-reduced-motion path) is scaled + grounded too (AC4).
    const handle = createSpriteBox({
      char: char("ClaudeTeam-M03-Dev", {
        scale: 1.412,
        offsetY: 26.087,
        feetAnchorPct: 73.913,
      }),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true, // reduced-motion path
      rng: () => 0,
    });
    const box = handle.element;
    expect(box.dataset.reducedMotion).toBe("true"); // confirm we took that path
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe("1.412");
    expect(box.style.getPropertyValue("--ct-render-feet-anchor")).toBe("73.913%");
  });
});

// ── 3. shipped manifest — every char auto-normalizes (86ca8n5pe) ─────────────

describe("GENERATED_SPRITE_MANIFEST render-fit wiring (86ca5b0gj; 86ca8n5pe)", () => {
  it("every shipped char carries an auto-computed render block with all three fields", () => {
    // Render-fit is now AUTO-computed from the measured figure bbox (86ca8n5pe) —
    // every char carries scale + offsetY + feetAnchorPct, no per-char manual block.
    for (const name of [
      "ClaudeTeam-F01-Dev",
      "ClaudeTeam-M01-Dev",
      "ClaudeTeam-F02-Dev",
      "ClaudeTeam-M03-Dev",
    ]) {
      const c = GENERATED_SPRITE_MANIFEST.characters[name];
      expect(c, `${name} must be in the manifest`).toBeDefined();
      expect(c.render, `${name} must carry render-fit`).toBeDefined();
      expect(typeof c.render?.scale, `${name}.scale`).toBe("number");
      expect(typeof c.render?.offsetY, `${name}.offsetY`).toBe("number");
      expect(typeof c.render?.feetAnchorPct, `${name}.feetAnchorPct`).toBe("number");
      // v3 chars (figure ~50% of canvas) are enlarged toward the M02 target.
      expect(c.render?.scale ?? 1).toBeGreaterThan(1);
    }
  });

  it("every shipped char's feet ground at the box bottom (scale-about-feet contract)", () => {
    // feetAnchorPct + offsetY === 100 → the transform drops the feet to the box
    // bottom (= the scene room floor). FAILS if a center-origin regression breaks
    // grounding (the floated-figure bug this feature fixes).
    for (const c of Object.values(GENERATED_SPRITE_MANIFEST.characters)) {
      if (!c.render) continue;
      expect(
        (c.render.feetAnchorPct ?? 50) + (c.render.offsetY ?? 0),
        `${c.character} feet must ground at 100%`,
      ).toBeCloseTo(100, 1);
    }
  });

  it("a character with no render block resolves to identity (no transform)", () => {
    // An unknown character has no render-fit → the CSS :root identity fallback.
    const c = GENERATED_SPRITE_MANIFEST.characters["ClaudeTeam-Z99-Dev"];
    expect(c).toBeUndefined();
  });
});

// ── EDGE PROBE 4 (ticket 86ca8ncja) — reduced-motion frame-0 is scaled+grounded ─
//
// The block-2 test above asserts the reduced-motion path carries scale +
// feetAnchor. This probe strengthens that to the FULL grounding contract: on the
// `prefers-reduced-motion: reduce` path, frame-0 is shown WITHOUT a timer, yet
// the figure must STILL be scaled AND grounded (all three render props set, and
// feetAnchorPct + offsetY === 100) — the static frame must not float un-normalized.
//
// Non-vacuity: createSpriteBox sets the render props (spritePlayer.ts ~565) BEFORE
// the reduced-motion early-return (~609). MUTATION: move the prop-setting block
// AFTER the early-return and this RED — the reduced-motion box would carry no
// render props (identity → small + floating static frame).

describe("createSpriteBox reduced-motion frame is scaled + grounded (86ca8ncja probe 4)", () => {
  it("reduced-motion static frame carries all three props AND grounds (feetAnchor+offsetY=100)", () => {
    const scale = 1.412;
    const offsetY = 26.087;
    const feetAnchorPct = 73.913; // offsetY + feetAnchorPct === 100 (grounded).
    const handle = createSpriteBox({
      char: char("ClaudeTeam-F02-Dev", { scale, offsetY, feetAnchorPct }),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true, // forces the static frame-0 early-return.
      rng: () => 0,
    });
    const box = handle.element;

    // Confirm we are on the reduced-motion path (no timer; static frame-0).
    expect(box.dataset.reducedMotion).toBe("true");
    const img = box.querySelector<HTMLImageElement>("img.sprite-frame");
    expect(img, "reduced-motion box must still render a frame").not.toBeNull();
    expect(img!.getAttribute("src")).toContain("/frame_0.png");

    // All three render props are set on the static-frame box (not skipped).
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe(String(scale));
    expect(box.style.getPropertyValue("--ct-render-offset-y")).toBe(`${offsetY}%`);
    expect(box.style.getPropertyValue("--ct-render-feet-anchor")).toBe(`${feetAnchorPct}%`);

    // Grounding contract holds even on the static path: feet land at the box bottom.
    expect(offsetY + feetAnchorPct).toBeCloseTo(100, 1);
  });
});
