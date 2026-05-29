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
          animations: {},
        },
      },
    };
    expect(spriteForMember("felix", undefined, zeroAnim)).toBeNull();
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

describe("read-at-screen wiring (regenerated manifest) — AC4 + AC5", () => {
  it.each(["ClaudeTeam-M01-Dev", "ClaudeTeam-F01-Dev"])(
    "%s: active_read resolves to the DESK read anim, not the book pose",
    (charName) => {
      const char = GENERATED_SPRITE_MANIFEST.characters[charName];
      const read = char.animations.active_read;
      // Folder is the shared desk state, NOT reading_an_open_book.
      expect(read.folder).toBe("sitting_at_a_desk_fa");
      expect(read.frames[0]).toContain("/sitting_at_a_desk_fa/");
      expect(read.frames[0]).not.toContain("/reading_an_open_book/");
      // The inner slug is the head-scan-at-monitor read anim ("...reads_wh...").
      expect(read.frames[0]).toMatch(/reads_wh-[0-9a-f]+\/south\//);
    },
  );

  it.each(["ClaudeTeam-M01-Dev", "ClaudeTeam-F01-Dev"])(
    "%s: active_work resolves to the WORKING desk anim, distinct from active_read (AC5 disambiguation)",
    (charName) => {
      const char = GENERATED_SPRITE_MANIFEST.characters[charName];
      const work = char.animations.active_work;
      const read = char.animations.active_read;
      // Both live in the shared desk folder...
      expect(work.folder).toBe("sitting_at_a_desk_fa");
      expect(read.folder).toBe("sitting_at_a_desk_fa");
      // ...but resolve to DIFFERENT animation subfolders (the folder/slug form
      // disambiguated them; the old slugDirs.sort()[0] would have collapsed
      // both onto one slug).
      expect(work.frames[0]).not.toBe(read.frames[0]);
      // active_work is the "seated still / typing" anim, not the "reads_wh" one.
      expect(work.frames[0]).not.toMatch(/reads_wh-/);
    },
  );

  it.each(["ClaudeTeam-M01-Dev", "ClaudeTeam-F01-Dev"])(
    "%s: idle_reading_book joined the idle pool and points at the book pose",
    (charName) => {
      const char = GENERATED_SPRITE_MANIFEST.characters[charName];
      expect(char.idlePool).toContain("idle_reading_book");
      const book = char.animations.idle_reading_book;
      expect(book).toBeDefined();
      expect(book.folder).toBe("reading_an_open_book");
      expect(book.frames.length).toBeGreaterThan(0);
    },
  );
});
