/**
 * @vitest-environment jsdom
 *
 * Scene-bg full-bleed + PER-LABEL CHIP wiring (scene-bg feature 86ca3kjyk · Iris
 * spec §FIRM · per-label chips 86ca3kyzq). Layer-2.5 DOM-interaction: MOUNT the
 * real tile components and assert the FUNCTIONAL wiring of the scene attribute +
 * custom property + per-label chip marker class + chip CSS, NOT the visual
 * fidelity (scene-renders-behind-character + chip opacity/contrast + floor
 * anchor defer to the sponsor per the GUI gap).
 *
 * What's asserted (all functional, jsdom-decidable):
 *   1. PRESENT  — when the baked manifest carries a scene, a sprite-bearing tile
 *      sets `data-scene-bg` + `--ct-scene-url` (prefixed with spriteBaseUri) AND
 *      every meta label (name/role/model/status) carries the `ct-scene-chip`
 *      marker class; the hero sprite-box does NOT.
 *   2. ABSENT   — when `defaultScene()` returns null (degrade path §FIRM.3), the
 *      tile sets NEITHER attribute AND NO label carries the chip marker → flat-
 *      card no-regression path.
 *   3. SPRITE-LESS — a text tile (no sprite) never gets a scene or chip marker.
 *   4. MULTI-AGENT — the collapsed persona header (also a sprite-bearing
 *      `.agent-tile`) gets the same scene wiring AND chips on name/role/model/
 *      status + the ×N agent-count badge + the "(N agents)" count hint.
 *   5. CHIP CSS — the chip paint rule + hover rule + the three §-updated tokens
 *      exist in the live stylesheet, gated on `[data-scene-bg] .ct-scene-chip`;
 *      the superseded scrim BANDS (`::before`/`::after` background) are GONE.
 *
 * NON-VACUITY (revert-probe, mandatory per testing-strategy.md Layer 2.5):
 *   - Reverting the agentTile.ts scene block (deleting the `data-scene-bg` /
 *     `--ct-scene-url` set) FAILS test 1 + 4.
 *   - Reverting the chip-marker (`if (sceneResolved) span.classList.add(...)`)
 *     FAILS test 1's + test 4's per-label chip-class assertions.
 *   - Reverting the degrade guard (`if (scene !== null)` → unconditional) FAILS
 *     test 2 (the mocked null scene would still stamp the attribute + markers).
 *   - Removing the `:root` chip tokens or the `.ct-scene-chip` paint rule FAILS
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

  it("every meta label carries the ct-scene-chip marker; the hero does NOT (86ca3kyzq)", async () => {
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      // Use a state with a non-sentinel model + activity so model + activity
      // rows actually render (and thus carry the chip).
      tile: tile({
        memberId: "maya",
        state: "finished",
        model: "claude-opus-4-8",
        activity: "finished 5s",
      }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    // Name, role, model, status each carry the chip marker.
    expect(el.querySelector(".agent-display")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".agent-role")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".agent-model")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".agent-activity")!.classList.contains("ct-scene-chip")).toBe(true);
    // The hero sprite-box (and its frame) is NOT chipped — the character/scene
    // reads clean (§FIRM Zone B clear of chips).
    const spriteBox = el.querySelector(".sprite-box");
    expect(spriteBox).not.toBeNull();
    expect(spriteBox!.classList.contains("ct-scene-chip")).toBe(false);
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
    // And NO label carries the chip marker — flat-card labels are unchanged.
    expect(el.querySelectorAll(".ct-scene-chip").length).toBe(0);
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
    // Sprite-less text tile never carries a chip marker.
    expect(el.querySelectorAll(".ct-scene-chip").length).toBe(0);
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

  it("chips name/role/model/status + the ×N badge + the (N agents) hint (86ca3kyzq)", async () => {
    const { renderMultiAgentPersonaTile } = await import(
      "../../../src/webview/components/multiAgentPersonaTile.js"
    );
    const el = renderMultiAgentPersonaTile({
      // Non-sentinel headline model + activity so both rows render + chip.
      tile: multiTile({
        headlineActivity: "tool:Edit",
        headlineModel: "claude-opus-4-8",
      }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    expect(el.querySelector(".agent-display")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".agent-role")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".agent-model")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".agent-activity")!.classList.contains("ct-scene-chip")).toBe(true);
    // The ×N count badge + the "(N agents)" count hint both chip.
    expect(el.querySelector(".persona-count-badge")!.classList.contains("ct-scene-chip")).toBe(true);
    expect(el.querySelector(".persona-count-hint")!.classList.contains("ct-scene-chip")).toBe(true);
    // The sprite-box hero stays clear.
    expect(el.querySelector(".sprite-box")!.classList.contains("ct-scene-chip")).toBe(false);
  });

  it("does NOT chip the persona-instance rows (they stay flat — §FIRM.3)", async () => {
    const { renderMultiAgentPersonaTile } = await import(
      "../../../src/webview/components/multiAgentPersonaTile.js"
    );
    const el = renderMultiAgentPersonaTile({
      tile: multiTile(),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      // Expand so the instance rows populate.
      expandByDefault: true,
    });
    const region = el.querySelector(".persona-instances")!;
    // Instance rows + their inner spans carry NO chip marker — flat surface.
    expect(region.querySelectorAll(".ct-scene-chip").length).toBe(0);
  });
});

describe("scene-bg — per-label chip CSS exists + is gated (source-derived)", () => {
  const css = readFileSync(CSS_PATH, "utf8");

  it(":root declares the three scene tokens (chip α + anchor) with the 86ca3kyzq values", () => {
    expect(css).toMatch(/--ct-scene-chip:\s*rgba\(236,\s*239,\s*241,\s*0\.92\)/);
    expect(css).toMatch(
      /--ct-scene-chip-hover:\s*rgba\(225,\s*228,\s*230,\s*0\.94\)/,
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

  it("the chip paint rule is gated on [data-scene-bg] .ct-scene-chip + uses the chip token", () => {
    // The per-label chip rule keys on the marker class scoped to a scene tile.
    expect(css).toContain(
      '.agent-tile[data-has-sprite="true"][data-scene-bg] .ct-scene-chip',
    );
    // Chip is inline-block (sizes to text), rounded, painted with the chip token.
    const chipRule =
      /\.agent-tile\[data-has-sprite="true"\]\[data-scene-bg\]\s*\.ct-scene-chip\s*\{([^}]*)\}/;
    const m = chipRule.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/display:\s*inline-block/);
    expect(m![1]).toMatch(/background:\s*var\(--ct-scene-chip\)/);
    expect(m![1]).toMatch(/border-radius:\s*var\(--ct-radius-chip\)/);
  });

  it("the superseded scrim BANDS are GONE (no ::before/::after scrim background)", () => {
    // The §FIRM zone-bands were ::before/::after with `background:
    // var(--ct-scene-scrim)`. Per-label chips supersede them — neither the old
    // token nor a scrim-painted pseudo-band should remain.
    expect(css).not.toMatch(/--ct-scene-scrim\b/);
    expect(css).not.toMatch(/var\(--ct-scene-scrim\)/);
    expect(css).not.toMatch(/data-scene-bg\]::before/);
    expect(css).not.toMatch(/data-scene-bg\]::after/);
  });

  it("hover darkens the chips (not a flat card wash) on scene tiles", () => {
    expect(css).toMatch(/background:\s*var\(--ct-scene-chip-hover\)/);
    // The hover rule keys on the marker class scoped to a hovered scene tile.
    expect(css).toMatch(
      /\[data-scene-bg\]:hover\s*\.ct-scene-chip/,
    );
  });

  it(".persona-instances on a scene tile keeps a flat --ct-card-bg surface", () => {
    expect(css).toMatch(
      /\[data-scene-bg\]\s*>\s*\.persona-instances\s*\{[^}]*--ct-card-bg/,
    );
  });

  // ── Kebab-pin regression (Felix caught) ──────────────────────────────────
  // The content-lift rule gives scene-tile content children `position:
  // relative; z-index: 1` so chipped text + sprite composite above the scene.
  // `.agent-tile-overflow` ([⋯] kebab) is ALREADY `position: absolute` (its
  // top-right pin); if it gets swept into the content-lift selector, the added
  // `position: relative` clobbers the absolute pin and the kebab drops into
  // grid flow on scene tiles. The fix EXCLUDES it from the content-lift
  // selector and gives it z-index ALONE (absolute already honors z-index).
  //
  // jsdom cannot assert the rendered top-right position, so this is a
  // source-derived structural assertion of the bug-class wiring (positioning
  // itself stays a manual reload check — see the scene-bg manual checklist).
  //
  // NON-VACUITY (revert-probe): adding `> .agent-tile-overflow` to the
  // content-lift selector FAILS test 1; deleting the z-index-only overflow
  // rule FAILS test 2.
  it("the content-lift selector does NOT include .agent-tile-overflow (kebab pin preserved)", () => {
    // The content-lift rule sets `position: relative` on lifted children. The
    // overflow control must NOT be among them, or its absolute top-right pin
    // is clobbered. Match the content-lift rule body and assert the selector
    // list lacks `.agent-tile-overflow`.
    const liftRule =
      /(\.agent-tile\[data-has-sprite="true"\]\[data-scene-bg\]\s*>\s*\.tile-row[^{]*)\{[^}]*position:\s*relative/;
    const m = liftRule.exec(css);
    expect(m).not.toBeNull();
    // The selector list of the content-lift rule must not pin the overflow
    // control with position:relative.
    expect(m![1]).not.toContain(".agent-tile-overflow");
  });

  it("the [⋯] overflow control on a scene tile gets z-index only (no position clobber)", () => {
    // A separate rule lifts ONLY the overflow control's stacking (z-index)
    // without a `position` swap, so it stays `position: absolute` (its pin).
    const overflowZ =
      /\.agent-tile\[data-has-sprite="true"\]\[data-scene-bg\]\s*>\s*\.agent-tile-overflow\s*\{([^}]*)\}/;
    const m = overflowZ.exec(css);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/z-index:\s*1/);
    // Must NOT re-declare position here — that would re-introduce the clobber.
    expect(m![1]).not.toMatch(/position\s*:/);
  });
});
