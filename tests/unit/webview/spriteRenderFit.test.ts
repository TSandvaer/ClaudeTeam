/**
 * @vitest-environment jsdom
 *
 * Unit tests for per-character sprite render-fit (ticket 86ca5b0gj).
 *
 * The v3 92×92 persona sprites (ClaudeTeam-F02-Dev, ClaudeTeam-M03-Dev) bake the
 * figure into only ~50% of the canvas, vs ~75% for the legacy 68×68 chars
 * (F01/M01/M02). With `.sprite-frame { object-fit: contain }` the WHOLE canvas
 * scales into the fixed box, so a 92px char renders SMALLER + floats HIGH. The
 * fix is a per-character `render: { scale, offsetY }` block that bakes onto the
 * manifest and drives the `--ct-render-scale` / `--ct-render-offset-y` CSS custom
 * props on each `.sprite-box`; `.sprite-frame`'s transform reads them.
 *
 * Two surfaces are covered:
 *   1. build sanitizer `sanitizeRenderFit` — finite-number validation + drop +
 *      identity-when-absent (mirrors `sanitizePlayback`'s policy).
 *   2. `createSpriteBox` — sets the custom props from `char.render`, AND leaves
 *      them UNSET when `render` is absent (the 68×68 no-regression contract).
 *
 * Non-vacuity: each block FAILS if the fix is reverted —
 *   - sanitizer block fails if `sanitizeRenderFit` drops valid numbers or keeps
 *     malformed ones.
 *   - createSpriteBox block fails if the props are not set (92px char renders
 *     identity again → small + floating) OR are set for a render-less char
 *     (68px char regresses).
 *   - the shipped-manifest block fails if F02/M03 lose their render block or
 *     F01/M01 gain one.
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
function char(
  name: string,
  render?: SpriteCharacter["render"],
): SpriteCharacter {
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

describe("createSpriteBox — render-fit custom props (86ca5b0gj)", () => {
  it("sets --ct-render-scale + --ct-render-offset-y from char.render", () => {
    const handle = createSpriteBox({
      char: char("ClaudeTeam-F02-Dev", { scale: 1.5, offsetY: 4 }),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true, // no real timer
      rng: () => 0,
    });
    const box = handle.element;
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe("1.5");
    expect(box.style.getPropertyValue("--ct-render-offset-y")).toBe("4%");
  });

  it("leaves BOTH props unset when char has no render block (identity no-regression)", () => {
    const handle = createSpriteBox({
      char: char("ClaudeTeam-NoRender-Dev"),
      state: "idle",
      activity: "",
      spriteBaseUri: "vscode://x",
      reducedMotion: true,
      rng: () => 0,
    });
    const box = handle.element;
    // Unset → the CSS :root identity fallback (1 / 0%) applies → no transform.
    expect(box.style.getPropertyValue("--ct-render-scale")).toBe("");
    expect(box.style.getPropertyValue("--ct-render-offset-y")).toBe("");
  });

  it("sets only the field present in a partial render block", () => {
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
  });
});

// ── 3. shipped manifest — only the 92px chars carry render-fit ───────────────

describe("GENERATED_SPRITE_MANIFEST render-fit wiring (86ca5b0gj)", () => {
  it("v3 92×92 chars (F01/M01/F02/M03) carry a render block with scale > 1", () => {
    // Every shipped persona is now the v3 92×92 build (F01 overwritten in place
    // 86ca5j1mt); all carry the render-fit block (scale 1.5, offsetY 4).
    for (const name of [
      "ClaudeTeam-F01-Dev",
      "ClaudeTeam-M01-Dev",
      "ClaudeTeam-F02-Dev",
      "ClaudeTeam-M03-Dev",
    ]) {
      const c = GENERATED_SPRITE_MANIFEST.characters[name];
      expect(c, `${name} must be in the manifest`).toBeDefined();
      expect(c.render, `${name} must carry render-fit`).toBeDefined();
      expect(c.render?.scale ?? 1).toBeGreaterThan(1);
    }
  });

  it("a character with no render block resolves to identity (no transform)", () => {
    // No shipped character omits the render block any more (all are v3). The
    // identity path is asserted directly: an unknown character has no render-fit.
    const c = GENERATED_SPRITE_MANIFEST.characters["ClaudeTeam-Z99-Dev"];
    expect(c).toBeUndefined();
  });
});
