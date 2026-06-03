/**
 * @vitest-environment jsdom
 *
 * Scene-bg full-bleed + scrim wiring (scene-bg feature 86ca3kjyk · Iris spec
 * §FIRM). Layer-2.5 DOM-interaction: MOUNT the real tile components and assert
 * the FUNCTIONAL wiring of the scene attribute + custom property + scrim DOM,
 * NOT the visual fidelity (scene-renders-behind-character + scrim legibility +
 * floor anchor defer to the sponsor per the GUI gap).
 *
 * What's asserted (all functional, jsdom-decidable):
 *   1. PRESENT  — when the baked manifest carries a scene, a sprite-bearing tile
 *      sets `data-scene-bg` + `--ct-scene-url` (prefixed with spriteBaseUri).
 *   2. ABSENT   — when `defaultScene()` returns null (degrade path §FIRM.3), the
 *      tile sets NEITHER attribute → flat-card no-regression path.
 *   3. SPRITE-LESS — a text tile (no sprite) never gets a scene (selector is
 *      scoped to sprite-bearing tiles).
 *   4. MULTI-AGENT — the collapsed persona header (also a sprite-bearing
 *      `.agent-tile`) gets the same scene wiring.
 *   5. SCRIM CSS — the two pseudo-band scrim rules + tokens exist in the live
 *      stylesheet, gated on `[data-scene-bg]`, with the hero zone unscrimmed.
 *
 * NON-VACUITY (revert-probe, mandatory per testing-strategy.md Layer 2.5):
 *   - Reverting the agentTile.ts scene block (deleting the `data-scene-bg` /
 *     `--ct-scene-url` set) FAILS test 1 + 4.
 *   - Reverting the degrade guard (`if (scene !== null)` → unconditional) FAILS
 *     test 2 (the mocked null scene would still stamp the attribute).
 *   - Removing the `:root` tokens or the scrim `::before`/`::after` rules FAILS
 *     test 5.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AgentTile, MultiAgentPersonaTile } from "../../../src/shared/types.js";

const BASE = "vscode-webview://abc/dist/webview";

const here = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(
  here,
  "../../../src/webview/styles/dashboard.css",
);

function tile(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "maya",
    teamId: "alpha",
    display: "Maya",
    role: "Dev",
    activity: "idle 5s",
    model: "claude-opus-4-8",
    state: "idle",
    agentId: "a1",
    toolUseId: null,
    ...overrides,
  };
}

afterEach(() => {
  // doMock factories are NOT cleared by resetModules — unmock the manifest so
  // the null-scene factory from the degrade test can't leak into later tests
  // that need the real (scene-bearing) manifest.
  vi.doUnmock("../../../src/webview/sprites/spriteManifest.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("scene-bg — PRESENT (manifest carries a scene)", () => {
  it("a sprite-bearing tile sets data-scene-bg + --ct-scene-url from spriteBaseUri", async () => {
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      tile: tile({ memberId: "maya" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    // Sprite present (precondition).
    expect(el.dataset.hasSprite).toBe("true");
    // Scene gate attribute present (empty-string value).
    expect(el.hasAttribute("data-scene-bg")).toBe(true);
    // --ct-scene-url is the resolved image, base-prefixed, as a CSS url().
    const sceneUrl = el.style.getPropertyValue("--ct-scene-url");
    expect(sceneUrl).toContain("url(");
    expect(sceneUrl).toContain(`${BASE}/sprites/scenes/`);
    // No double slash between base and path (prefix join discipline).
    expect(sceneUrl).not.toContain("dist/webview//sprites");
  });
});

describe("scene-bg — ABSENT (degrade path §FIRM.3 — defaultScene null)", () => {
  it("tile sets NEITHER data-scene-bg NOR --ct-scene-url when no scene resolves", async () => {
    // Mock ONLY defaultScene → null; keep spriteForMember real so the tile
    // still renders its sprite (the degrade is "scene absent", not "sprite
    // absent"). This reproduces a baked manifest with no `scenes` registry.
    vi.doMock("../../../src/webview/sprites/spriteManifest.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../../src/webview/sprites/spriteManifest.js")
      >("../../../src/webview/sprites/spriteManifest.js");
      return { ...actual, defaultScene: () => null };
    });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      tile: tile({ memberId: "maya" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    // Sprite still renders (degrade is scene-only).
    expect(el.dataset.hasSprite).toBe("true");
    // No scene attribute, no scene url → CSS selectors don't match → flat card.
    expect(el.hasAttribute("data-scene-bg")).toBe(false);
    expect(el.style.getPropertyValue("--ct-scene-url")).toBe("");
  });
});

describe("scene-bg — SPRITE-LESS tile never gets a scene", () => {
  it("a text tile (character:null) has no sprite and no scene wiring", async () => {
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      tile: tile({ memberId: "felix", character: null }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    expect(el.dataset.hasSprite).toBeUndefined();
    expect(el.hasAttribute("data-scene-bg")).toBe(false);
    expect(el.style.getPropertyValue("--ct-scene-url")).toBe("");
  });

  it("no spriteBaseUri → no sprite → no scene", async () => {
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      tile: tile({ memberId: "maya" }),
      sessionId: "s1",
      postMessage: () => undefined,
      // spriteBaseUri omitted
    });
    expect(el.dataset.hasSprite).toBeUndefined();
    expect(el.hasAttribute("data-scene-bg")).toBe(false);
  });
});

describe("scene-bg — MULTI-AGENT collapsed persona header gets the same wiring", () => {
  function inst(overrides: Partial<AgentTile> = {}): AgentTile {
    return {
      memberId: "maya",
      teamId: "alpha",
      display: "Maya",
      role: "Dev",
      activity: "tool:Edit",
      model: "claude-opus-4-8",
      state: "running",
      agentId: "a1",
      sessionId: "s1",
      toolUseId: null,
      ...overrides,
    };
  }

  function multiTile(
    overrides: Partial<MultiAgentPersonaTile> = {},
  ): MultiAgentPersonaTile {
    const instances = overrides.instances ?? [
      inst({ agentId: "a1", state: "running" }),
      inst({ agentId: "a2", state: "idle", activity: "idle 5s" }),
    ];
    return {
      kind: "multi-agent-persona",
      memberId: "maya",
      teamId: "alpha",
      display: "Maya",
      role: "Dev",
      aggregateState: "running",
      headlineActivity: "tool:Edit",
      headlineModel: "claude-opus-4-8",
      count: instances.length,
      instances,
      ...overrides,
    };
  }

  it("sets data-scene-bg + --ct-scene-url on the persona header tile", async () => {
    const { renderMultiAgentPersonaTile } = await import(
      "../../../src/webview/components/multiAgentPersonaTile.js"
    );
    const el = renderMultiAgentPersonaTile({
      tile: multiTile(),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    expect(el.dataset.hasSprite).toBe("true");
    expect(el.hasAttribute("data-scene-bg")).toBe(true);
    expect(el.style.getPropertyValue("--ct-scene-url")).toContain(
      `${BASE}/sprites/scenes/`,
    );
  });
});

describe("scene-bg — scrim CSS exists + is gated (source-derived)", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  it(":root declares the three scene tokens with the §FIRM.4 values", () => {
    expect(css).toMatch(/--ct-scene-scrim:\s*rgba\(236,\s*239,\s*241,\s*0\.88\)/);
    expect(css).toMatch(
      /--ct-scene-scrim-hover:\s*rgba\(225,\s*228,\s*230,\s*0\.9\)/,
    );
    expect(css).toMatch(/--ct-scene-anchor-y:\s*bottom/);
  });

  it("scene paint rule is gated on [data-has-sprite][data-scene-bg] + uses cover + anchor-y", () => {
    expect(css).toContain(
      '.agent-tile[data-has-sprite="true"][data-scene-bg]',
    );
    expect(css).toMatch(/background-image:\s*var\(--ct-scene-url\)/);
    expect(css).toMatch(/background-size:\s*cover/);
    expect(css).toMatch(
      /background-position:\s*center var\(--ct-scene-anchor-y\)/,
    );
    expect(css).toMatch(/image-rendering:\s*pixelated/);
  });

  it("two scrim bands exist as ::before/::after on the scene tile (Zone A + Zone C)", () => {
    expect(css).toContain(
      '.agent-tile[data-has-sprite="true"][data-scene-bg]::before',
    );
    expect(css).toContain(
      '.agent-tile[data-has-sprite="true"][data-scene-bg]::after',
    );
    expect(css).toMatch(/background:\s*var\(--ct-scene-scrim\)/);
    // Bands placed in grid rows 1 (Zone A) and 3 (Zone C) — hero (row 2) is
    // intentionally UNscrimmed so the scene shows behind the character.
    expect(css).toMatch(/grid-row:\s*1;\s*\/\* Zone A/);
    expect(css).toMatch(/grid-row:\s*3;\s*\/\* Zone C/);
  });

  it("hover darkens the scrim bands (not a flat card wash) on scene tiles", () => {
    expect(css).toMatch(/background:\s*var\(--ct-scene-scrim-hover\)/);
  });

  it(".persona-instances on a scene tile keeps a flat --ct-card-bg surface", () => {
    expect(css).toMatch(
      /\[data-scene-bg\]\s*>\s*\.persona-instances\s*\{[^}]*--ct-card-bg/,
    );
  });
});
