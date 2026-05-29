/**
 * Unit tests for sprite manifest lookup (spriteManifest.ts) + the committed
 * generated manifest (generatedManifest.ts).
 *
 * Covers AC6 (map from animations.json) + AC5 (sprite-less members resolve to
 * null so the caller degrades to a text tile):
 *   - bound members (felix/maya) resolve to a character with frames.
 *   - unbound members (sage/iris/nora/bram) resolve to null.
 *   - the generated manifest matches the committed animations.json data.
 *
 * Pure data — node environment.
 */

import { describe, it, expect } from "vitest";
import {
  spriteForMember,
  MEMBER_SPRITE_BINDING,
  type GeneratedSpriteManifest,
} from "../../../src/webview/sprites/spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";

describe("spriteForMember — AC5 / AC6", () => {
  it("bound members resolve to a character with animations", () => {
    for (const memberId of Object.keys(MEMBER_SPRITE_BINDING)) {
      const char = spriteForMember(memberId);
      expect(char, `member ${memberId} should have a sprite`).not.toBeNull();
      expect(Object.keys(char!.animations).length).toBeGreaterThan(0);
    }
  });

  it("felix/maya are the two bound members", () => {
    expect(MEMBER_SPRITE_BINDING.felix).toBe("ClaudeTeam-F01-Dev");
    expect(MEMBER_SPRITE_BINDING.maya).toBe("ClaudeTeam-M01-Dev");
  });

  it.each(["sage", "iris", "nora", "bram"])(
    "unbound member %s resolves to null (text-tile fallback, AC5)",
    (memberId) => {
      expect(spriteForMember(memberId)).toBeNull();
    },
  );

  it("returns null when a bound character is absent from the manifest", () => {
    const emptyManifest: GeneratedSpriteManifest = { characters: {} };
    expect(spriteForMember("felix", emptyManifest)).toBeNull();
  });

  it("returns null when the bound character has zero animations", () => {
    const zeroAnim: GeneratedSpriteManifest = {
      characters: {
        "ClaudeTeam-F01-Dev": {
          character: "ClaudeTeam-F01-Dev",
          defaultIdle: null,
          idlePool: [],
          animations: {},
        },
      },
    };
    expect(spriteForMember("felix", zeroAnim)).toBeNull();
  });
});

describe("generated manifest — AC6 shape", () => {
  it("contains both harvested dev characters", () => {
    expect(
      Object.keys(GENERATED_SPRITE_MANIFEST.characters).sort(),
    ).toEqual(["ClaudeTeam-F01-Dev", "ClaudeTeam-M01-Dev"]);
  });

  it("each character exposes active_read + active_work + an idle pool", () => {
    for (const char of Object.values(GENERATED_SPRITE_MANIFEST.characters)) {
      expect(char.animations.active_read).toBeDefined();
      expect(char.animations.active_work).toBeDefined();
      expect(char.idlePool.length).toBeGreaterThan(0);
      // Every idle-pool member must have resolved frames.
      for (const name of char.idlePool) {
        expect(char.animations[name]?.frames.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("frame paths are dist-relative under sprites/<char>/", () => {
    const f = GENERATED_SPRITE_MANIFEST.characters[
      "ClaudeTeam-M01-Dev"
    ].animations.active_read.frames[0];
    expect(f).toMatch(/^sprites\/ClaudeTeam-M01-Dev\/_pixellab_anims\/.+frame_\d+\.png$/);
  });
});
