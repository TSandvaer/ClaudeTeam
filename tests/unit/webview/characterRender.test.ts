/**
 * @vitest-environment jsdom
 *
 * AC6/AC7 — per-member character rendering REPLACES the hardcoded gender
 * binding. Covers the team-setup spec §5.3 resolution order in
 * `spriteForMember(memberId, character?)` + `spriteForCharacterId`, and the
 * agent-tile wiring that drives the sprite off `tile.character`.
 *
 * Resolution order asserted:
 *   1. character = <id>      → resolve by id (the per-member choice wins).
 *   2. character = null      → text tile (null), NOT the gender binding.
 *   3. character = undefined → legacy gender binding (back-compat).
 */

import { describe, it, expect } from "vitest";
import {
  spriteForMember,
  spriteForCharacterId,
} from "../../../src/webview/sprites/spriteManifest.js";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import type { AgentTile } from "../../../src/shared/types.js";

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

describe("spriteForCharacterId — direct manifest lookup by id", () => {
  it("resolves a known bundled character id", () => {
    const c = spriteForCharacterId("ClaudeTeam-F01-Dev");
    expect(c).not.toBeNull();
    expect(c!.character).toBe("ClaudeTeam-F01-Dev");
  });
  it("returns null for an unknown id (text-tile fallback, no broken image)", () => {
    expect(spriteForCharacterId("not-a-real-character")).toBeNull();
  });
});

describe("spriteForMember — per-member character REPLACES gender binding (§5.3)", () => {
  it("character id wins — resolves by id regardless of memberId", () => {
    // maya's legacy gender binding is F01; assigning M01 must yield M01.
    const c = spriteForMember("maya", "ClaudeTeam-M01-Dev");
    expect(c!.character).toBe("ClaudeTeam-M01-Dev");
  });

  it("character null → text tile (null), NOT the gender binding", () => {
    // felix's gender binding would be M01; explicit null must be honored.
    expect(spriteForMember("felix", null)).toBeNull();
  });

  it("character undefined → legacy gender binding (back-compat)", () => {
    expect(spriteForMember("felix", undefined)!.character).toBe(
      "ClaudeTeam-M01-Dev",
    );
    expect(spriteForMember("maya", undefined)!.character).toBe(
      "ClaudeTeam-F01-Dev",
    );
  });

  it("unknown assigned id → text tile (null), does NOT fall back to gender", () => {
    // An explicit assignment that can't resolve in this bundle is honored as
    // "render the text tile", not silently substituted with the gender char.
    expect(spriteForMember("felix", "user-char-not-baked")).toBeNull();
  });

  it("unbound member + undefined character → null (text tile)", () => {
    expect(spriteForMember("stranger", undefined)).toBeNull();
  });
});

describe("agentTile — sprite driven by tile.character (AC7)", () => {
  it("renders the assigned character's sprite (M01 for a member bound F01 by gender)", () => {
    const el = renderAgentTile({
      tile: tile({ memberId: "maya", character: "ClaudeTeam-M01-Dev" }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    const box = el.querySelector<HTMLElement>(".sprite-box");
    expect(box).not.toBeNull();
    expect(box!.dataset.character).toBe("ClaudeTeam-M01-Dev");
  });

  it("character:null → text tile (no sprite box)", () => {
    const el = renderAgentTile({
      tile: tile({ memberId: "felix", character: null }),
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    expect(el.querySelector(".sprite-box")).toBeNull();
    expect(el.dataset.hasSprite).toBeUndefined();
  });

  it("character undefined → legacy gender sprite still renders (back-compat)", () => {
    const el = renderAgentTile({
      tile: tile({ memberId: "felix" }), // no character field
      sessionId: "s1",
      postMessage: () => undefined,
      spriteBaseUri: BASE,
    });
    const box = el.querySelector<HTMLElement>(".sprite-box");
    expect(box).not.toBeNull();
    expect(box!.dataset.character).toBe("ClaudeTeam-M01-Dev");
  });
});
