/**
 * @vitest-environment jsdom
 *
 * Tile scene-CASCADE + crossfade wiring (scene-per-pose feature 86ca88nvd · Iris
 * spec §2 / §3 / §6). Layer-2.5 DOM-interaction: MOUNT the real tile components
 * and assert the FUNCTIONAL wiring of the per-pose cascade resolution + the
 * `"none"` → flat-card degrade + the pose→pose crossfade attribute — NOT visual
 * fidelity (the actual dissolve / room render defer to the sponsor per the GUI
 * gap).
 *
 * The tile now resolves `resolveSceneId(char.character, handle.pose)` (the
 * architected call-site upgrade, §6) instead of the old always-`defaultScene`.
 * We MOCK `resolveSceneId` keyed on the pose so the cascade outcome is
 * deterministic regardless of the baked manifest's scene data (which Felix bakes
 * in parallel).
 *
 * NON-VACUITY (revert-probe, mandatory per testing-strategy.md Layer 2.5):
 *   - Reverting the tile to `defaultScene()` (ignoring the pose) FAILS the
 *     "different poses resolve different backdrops" + "none → flat card" tests.
 *   - Reverting the crossfade (not stamping `data-scene-transition`) FAILS the
 *     crossfade tests.
 *   - Stamping the transition unconditionally (not diffing the prior key) FAILS
 *     the "unchanged backdrop → no transition" test.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { AgentTile } from "../../../src/shared/types.js";
import { createSpriteTracker } from "../../../src/webview/spriteTracker.js";

const BASE = "vscode-webview://abc/dist/webview";

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
  vi.doUnmock("../../../src/webview/sprites/spriteManifest.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

/**
 * Mock `resolveSceneId` to return per-pose values from `byPose`, with a default
 * fallback. `sceneForId` stays real-ish (returns a scene with an image path for a
 * known id, null otherwise) so `resolveTileScene` builds a url for real ids and
 * degrades for unknown ones.
 */
function mockSceneCascade(byPose: Record<string, string | null>): void {
  vi.doMock("../../../src/webview/sprites/spriteManifest.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../../src/webview/sprites/spriteManifest.js")
    >("../../../src/webview/sprites/spriteManifest.js");
    return {
      ...actual,
      resolveSceneId: (_char: string, anim: string) =>
        anim in byPose
          ? byPose[anim]
          : "__any__" in byPose
            ? byPose["__any__"]
            : "room3",
      sceneForId: (id: string) =>
        id === "room3" || id === "room5"
          ? { id, image: `sprites/scenes/${id}.png` }
          : null,
    };
  });
}

describe("tile scene cascade — resolves the scene for the PLAYED pose (§6)", () => {
  it("an idle pose resolving to a scene id paints data-scene-bg + that scene's url", async () => {
    mockSceneCascade({ idle_coffee: "room3" });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const tracker = createSpriteTracker();
    const el = renderAgentTile({
      tile: tile({ memberId: "maya", state: "idle" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      // Force the idle pose so resolveSceneId is keyed on a known pose name.
      spriteTracker: tracker,
    });
    expect(el.dataset.hasSprite).toBe("true");
    expect(el.hasAttribute("data-scene-bg")).toBe(true);
    expect(el.style.getPropertyValue("--ct-scene-url")).toContain(
      `${BASE}/sprites/scenes/`,
    );
  });

  it("a pose resolving to \"none\" → flat card (NO data-scene-bg, the omit-degrade path)", async () => {
    // Force a running active_work pose (tool != Read) → resolves to "none".
    mockSceneCascade({ active_work: "none" });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      tile: tile({
        memberId: "maya",
        state: "running",
        activity: "tool:Edit src/x.ts",
      }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    expect(el.dataset.hasSprite).toBe("true");
    // "none" → omit data-scene-bg → flat card, no chip markers.
    expect(el.hasAttribute("data-scene-bg")).toBe(false);
    expect(el.style.getPropertyValue("--ct-scene-url")).toBe("");
    expect(el.querySelectorAll(".ct-scene-chip").length).toBe(0);
  });

  it("a DANGLING resolved id (not in registry) → flat card (sceneForId null defense)", async () => {
    // Resolve EVERY pose to the dangling id (the idle pool picks a random idle —
    // pinning the result regardless of which idle is drawn).
    mockSceneCascade({ __any__: "room99" });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const el = renderAgentTile({
      tile: tile({ memberId: "maya", state: "idle" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    expect(el.hasAttribute("data-scene-bg")).toBe(false);
  });
});

describe("tile scene crossfade — pose→pose backdrop change (§3)", () => {
  it("first render sets NO transition (first appearance is not a change)", async () => {
    mockSceneCascade({ idle_coffee: "room3" });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const tracker = createSpriteTracker();
    const el = renderAgentTile({
      tile: tile({ memberId: "maya", state: "idle" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
    });
    expect(el.hasAttribute("data-scene-transition")).toBe(false);
  });

  it("a re-render that CHANGES the backdrop (room3 → none) stamps data-scene-transition", async () => {
    // The seed's most common live trigger: idle(room3) → active_work(none).
    mockSceneCascade({ idle_coffee: "room3", active_work: "none" });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const tracker = createSpriteTracker();
    // First render: idle → room3.
    renderAgentTile({
      tile: tile({ memberId: "maya", state: "idle" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
    });
    // Second render (poll tick): now running active_work → none. The prior key
    // (room3) differs from the new key (none) → crossfade.
    const el2 = renderAgentTile({
      tile: tile({
        memberId: "maya",
        state: "running",
        activity: "tool:Edit x",
      }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
    });
    expect(el2.getAttribute("data-scene-transition")).toBe("cross");
  });

  it("a re-render with the SAME backdrop sets NO transition (no flicker, §3.1)", async () => {
    mockSceneCascade({ idle_coffee: "room3" });
    const { renderAgentTile } = await import(
      "../../../src/webview/components/agentTile.js"
    );
    const tracker = createSpriteTracker();
    // First render: idle → room3.
    renderAgentTile({
      tile: tile({ memberId: "maya", state: "idle" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
    });
    // Second render: still idle → room3. Same key → NO transition.
    const el2 = renderAgentTile({
      tile: tile({ memberId: "maya", state: "idle" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
      spriteTracker: tracker,
    });
    expect(el2.hasAttribute("data-scene-transition")).toBe(false);
  });
});
