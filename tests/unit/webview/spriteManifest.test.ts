/**
 * Unit tests for sprite manifest lookup (spriteManifest.ts) + the committed
 * generated manifest (generatedManifest.ts).
 *
 * Covers the E-07b 6-member GENDER binding (sponsor decision 2026-05-29) +
 * AC6 (map from animations.json):
 *   - ALL SIX roster members are bound by gender (felix/bram → M01-Dev;
 *     maya/iris/nora/sage → F01-Dev) and resolve to a character with frames.
 *   - no roster member falls back to the text tile anymore.
 *   - the generated manifest matches the committed animations.json data.
 *
 * Pure data — node environment.
 */

import { describe, it, expect } from "vitest";
import {
  spriteForMember,
  sceneForId,
  defaultScene,
  MEMBER_SPRITE_BINDING,
  type GeneratedSpriteManifest,
} from "../../../src/webview/sprites/spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";

describe("spriteForMember — 6-member gender binding (E-07b) / AC6", () => {
  it("every bound member resolves to a character with animations", () => {
    for (const memberId of Object.keys(MEMBER_SPRITE_BINDING)) {
      const char = spriteForMember(memberId);
      expect(char, `member ${memberId} should have a sprite`).not.toBeNull();
      expect(Object.keys(char!.animations).length).toBeGreaterThan(0);
    }
  });

  it("binds all six roster members by gender (M01-Dev male, F01-Dev female)", () => {
    // Male → M01-Dev (fixes the prior backwards provisional binding).
    expect(MEMBER_SPRITE_BINDING.felix).toBe("ClaudeTeam-M01-Dev");
    expect(MEMBER_SPRITE_BINDING.bram).toBe("ClaudeTeam-M01-Dev");
    // Female → F01-Dev.
    expect(MEMBER_SPRITE_BINDING.maya).toBe("ClaudeTeam-F01-Dev");
    expect(MEMBER_SPRITE_BINDING.iris).toBe("ClaudeTeam-F01-Dev");
    expect(MEMBER_SPRITE_BINDING.nora).toBe("ClaudeTeam-F01-Dev");
    expect(MEMBER_SPRITE_BINDING.sage).toBe("ClaudeTeam-F01-Dev");
  });

  it("all six roster members are bound (no text-fallback for any member now)", () => {
    for (const memberId of ["felix", "bram", "maya", "iris", "nora", "sage"]) {
      expect(
        spriteForMember(memberId),
        `member ${memberId} should resolve to a sprite, not text fallback`,
      ).not.toBeNull();
    }
  });

  it("an unrostered id still resolves to null (text-tile fallback)", () => {
    expect(spriteForMember("not-a-roster-member")).toBeNull();
  });

  it("returns null when a bound character is absent from the manifest", () => {
    const emptyManifest: GeneratedSpriteManifest = { characters: {} };
    // `character: undefined` → legacy gender-binding fallback path.
    expect(spriteForMember("felix", undefined, emptyManifest)).toBeNull();
  });

  it("returns null when the bound character has zero animations", () => {
    // felix binds to M01-Dev under the gender map; the stub must match that.
    const zeroAnim: GeneratedSpriteManifest = {
      characters: {
        "ClaudeTeam-M01-Dev": {
          character: "ClaudeTeam-M01-Dev",
          defaultIdle: null,
          idlePool: [],
          activePool: [],
          animations: {},
        },
      },
    };
    expect(spriteForMember("felix", undefined, zeroAnim)).toBeNull();
  });
});

describe("generated manifest — AC6 shape", () => {
  it("contains the harvested dev characters (F01, F02, M01, M03)", () => {
    expect(
      Object.keys(GENERATED_SPRITE_MANIFEST.characters).sort(),
    ).toEqual([
      "ClaudeTeam-F01-Dev",
      "ClaudeTeam-F02-Dev",
      "ClaudeTeam-M01-Dev",
      "ClaudeTeam-M03-Dev",
    ]);
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

describe("read-at-screen wiring (regenerated manifest) — AC4 + AC5", () => {
  // All four shipped personas are now the v3 92×92 build (F01 overwritten in
  // place 86ca5j1mt; M01 86ca5ed8v; F02; M03). Each shares ONE desk state
  // holding BOTH active_work and active_read via the folder/slug value form, so
  // there is no book↔desk flip during active sessions, and the legacy book pose
  // (reading_an_open_book / idle_reading_book) is retired. The desk folder name
  // and read-anim slug differ per character (re-export variance), so this block
  // asserts the structural invariant (shared folder + distinct anims), not a
  // fixed slug string.
  it.each([
    "ClaudeTeam-F01-Dev",
    "ClaudeTeam-M01-Dev",
    "ClaudeTeam-F02-Dev",
    "ClaudeTeam-M03-Dev",
  ])(
    "%s: active_work + active_read share ONE desk folder but resolve to DISTINCT anims",
    (charName) => {
      const char = GENERATED_SPRITE_MANIFEST.characters[charName];
      const work = char.animations.active_work;
      const read = char.animations.active_read;
      expect(work).toBeDefined();
      expect(read).toBeDefined();
      // Same desk state folder (no flip between work and read)...
      expect(work.folder).toBe(read.folder);
      // ...but the folder/slug form disambiguated them onto DIFFERENT anims.
      expect(work.frames[0]).not.toBe(read.frames[0]);
      // No book pose in the active animations.
      expect(work.frames[0]).not.toContain("/reading_an_open_book/");
      expect(read.frames[0]).not.toContain("/reading_an_open_book/");
    },
  );

  it("M01 (v3): active anims live in the Sitting_at_a_desk_wo state, no book pose in the idle pool", () => {
    const char = GENERATED_SPRITE_MANIFEST.characters["ClaudeTeam-M01-Dev"];
    expect(char.animations.active_work.folder).toBe("Sitting_at_a_desk_wo");
    expect(char.animations.active_read.folder).toBe("Sitting_at_a_desk_wo");
    // v3 M01 idle pool is the 3-pose v3 set, NOT the legacy 14-idle layout.
    expect(char.idlePool).toEqual(["idle_coffee", "idle_stretch", "idle_think"]);
    expect(char.idlePool).not.toContain("idle_reading_book");
  });

  it("F01 (v3): active anims live in the Sitting_at_a_desk_wo state, no book pose in the idle pool", () => {
    const char = GENERATED_SPRITE_MANIFEST.characters["ClaudeTeam-F01-Dev"];
    expect(char.animations.active_work.folder).toBe("Sitting_at_a_desk_wo");
    expect(char.animations.active_read.folder).toBe("Sitting_at_a_desk_wo");
    // v3 F01 idle pool is the 3-pose v3 set, NOT the legacy 14-idle layout.
    expect(char.idlePool).toEqual(["idle_coffee", "idle_stretch", "idle_think"]);
    expect(char.idlePool).not.toContain("idle_reading_book");
  });
});

describe("scene-bg accessors — sceneForId / defaultScene (86ca3kjyk)", () => {
  const sceneManifest: GeneratedSpriteManifest = {
    characters: {},
    scenes: {
      defaultSceneId: "room3",
      byId: {
        room3: { id: "room3", image: "sprites/scenes/room3.png" },
        studio: { id: "studio", image: "sprites/scenes/studio.png" },
      },
    },
  };

  it("sceneForId resolves a known scene by id", () => {
    expect(sceneForId("room3", sceneManifest)).toEqual({
      id: "room3",
      image: "sprites/scenes/room3.png",
    });
    expect(sceneForId("studio", sceneManifest)).toEqual({
      id: "studio",
      image: "sprites/scenes/studio.png",
    });
  });

  it("sceneForId returns null for an unknown id (degrade → flat card)", () => {
    expect(sceneForId("no-such-scene", sceneManifest)).toBeNull();
  });

  it("sceneForId returns null when the manifest has no scenes registry", () => {
    expect(sceneForId("room3", { characters: {} })).toBeNull();
  });

  it("defaultScene resolves the registry's defaultSceneId", () => {
    expect(defaultScene(sceneManifest)).toEqual({
      id: "room3",
      image: "sprites/scenes/room3.png",
    });
  });

  it("defaultScene returns null when no scenes registry (flat-card degrade)", () => {
    expect(defaultScene({ characters: {} })).toBeNull();
  });

  it("defaultScene returns null if defaultSceneId points at a missing entry", () => {
    expect(
      defaultScene({
        characters: {},
        scenes: { defaultSceneId: "ghost", byId: {} },
      }),
    ).toBeNull();
  });

  it("the SHIPPED generated manifest carries the room3 scene as default", () => {
    // Binds to the real regenerated manifest — fails if the build script stops
    // emitting the scenes registry or the room3 asset is removed.
    const scene = defaultScene(GENERATED_SPRITE_MANIFEST);
    expect(scene).not.toBeNull();
    expect(scene!.id).toBe("room3");
    expect(scene!.image).toBe("sprites/scenes/room3.png");
  });
});
