/**
 * Unit tests for the scene cascade resolver `resolveSceneId` + the `sceneBackdrop`
 * helper (scene-per-pose feature 86ca88nvd · Iris spec §2 / §3 / §6). Pure data —
 * node environment.
 *
 * Covers the LOCKED 3-layer cascade + 3-state value semantics (spec §2.1):
 *   1. per-character `SpriteCharacter.scenes["<anim>"]`  (layer 1, highest)
 *   2. pose-default  `GeneratedSpriteManifest.sceneDefaults["<anim>"]` (layer 2)
 *   3. manifest      `scenes.defaultSceneId`             (the floor)
 * with the THREE per-layer states: a scene id (stop) / `"none"` sentinel (STOP,
 * flat card, no fall-through) / unset (fall through).
 *
 * MUTATION-VERIFICATION (mandatory per the brief): the §"mutation probe" block
 * documents the exact edits that must FAIL these tests — e.g. dropping the
 * per-char layer from `resolveSceneId`, or treating `"none"` as fall-through.
 */

import { describe, it, expect } from "vitest";
import {
  resolveSceneId,
  SCENE_NONE,
  type GeneratedSpriteManifest,
  type SpriteScene,
} from "../../../src/webview/sprites/spriteManifest.js";
import {
  resolveTileScene,
  sceneKeyOf,
} from "../../../src/webview/sprites/sceneBackdrop.js";

const BASE = "vscode-webview://abc/dist/webview";

const room3: SpriteScene = { id: "room3", image: "sprites/scenes/room3.png" };
const room5: SpriteScene = { id: "room5", image: "sprites/scenes/room5.png" };

/** A manifest with a 2-room registry; per-char + pose-default layers parameterised. */
function manifest(opts: {
  perCharScenes?: Record<string, string>;
  sceneDefaults?: Record<string, string>;
  noRegistry?: boolean;
}): GeneratedSpriteManifest {
  return {
    characters: {
      "ClaudeTeam-F02-Dev": {
        character: "ClaudeTeam-F02-Dev",
        defaultIdle: "idle_coffee",
        idlePool: ["idle_coffee"],
        activePool: ["active_work"],
        animations: {
          idle_coffee: { folder: "f", frames: ["a.png", "b.png"] },
          active_work: { folder: "g", frames: ["c.png", "d.png"] },
          active_read: { folder: "g", frames: ["c.png", "d.png"] },
        },
        ...(opts.perCharScenes ? { scenes: opts.perCharScenes } : {}),
      },
    },
    ...(opts.noRegistry
      ? {}
      : { scenes: { defaultSceneId: "room3", byId: { room3, room5 } } }),
    ...(opts.sceneDefaults ? { sceneDefaults: opts.sceneDefaults } : {}),
  };
}

const CHAR = "ClaudeTeam-F02-Dev";

describe("resolveSceneId — layer 3 (the floor: defaultSceneId)", () => {
  it("a pose with no per-char and no pose-default resolves to defaultSceneId", () => {
    const m = manifest({});
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room3");
  });

  it("returns null when the manifest has NO scene registry (degrade → flat card)", () => {
    const m = manifest({ noRegistry: true });
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBeNull();
  });
});

describe("resolveSceneId — layer 2 (pose-default sceneDefaults)", () => {
  it("a pose-default scene id wins over the floor and stops the walk", () => {
    const m = manifest({ sceneDefaults: { idle_coffee: "room5" } });
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room5");
  });

  it("a pose-default of \"none\" STOPS the cascade → flat card (does NOT fall to floor)", () => {
    // The seed (spec §7): active_work/active_read → none, idles inherit room3.
    const m = manifest({
      sceneDefaults: { active_work: SCENE_NONE, active_read: SCENE_NONE },
    });
    expect(resolveSceneId(CHAR, "active_work", m)).toBe(SCENE_NONE);
    expect(resolveSceneId(CHAR, "active_read", m)).toBe(SCENE_NONE);
    // An idle pose with NO pose-default entry falls through to the floor (room3).
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room3");
  });

  it("an absent pose-default key FALLS THROUGH to the floor", () => {
    const m = manifest({ sceneDefaults: { active_work: SCENE_NONE } });
    // idle_coffee not in sceneDefaults → inherit floor.
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room3");
  });
});

describe("resolveSceneId — layer 1 (per-character scenes) wins highest", () => {
  it("a per-char scene id wins over BOTH pose-default and floor", () => {
    const m = manifest({
      perCharScenes: { idle_coffee: "room5" },
      sceneDefaults: { idle_coffee: "room3" },
    });
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room5");
  });

  it("a per-char \"none\" STOPS the cascade even when pose-default sets a real scene", () => {
    const m = manifest({
      perCharScenes: { idle_coffee: SCENE_NONE },
      sceneDefaults: { idle_coffee: "room5" },
    });
    // per-char none wins → flat card; pose-default room5 is NOT consulted.
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe(SCENE_NONE);
  });

  it("an absent per-char key falls through to the pose-default layer", () => {
    const m = manifest({
      perCharScenes: { active_work: SCENE_NONE },
      sceneDefaults: { idle_coffee: "room5" },
    });
    // idle_coffee not in per-char → pose-default room5 answers.
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room5");
  });

  it("per-char id wins for one pose while another pose still inherits (per-pose independence)", () => {
    const m = manifest({
      perCharScenes: { idle_coffee: "room5" },
      sceneDefaults: { active_work: SCENE_NONE },
    });
    expect(resolveSceneId(CHAR, "idle_coffee", m)).toBe("room5"); // layer 1
    expect(resolveSceneId(CHAR, "active_work", m)).toBe(SCENE_NONE); // layer 2
  });
});

describe("resolveSceneId — no project layer (decision 7, global scope)", () => {
  it("the cascade is exactly 3 layers — there is no project override", () => {
    // (Documentation test: the only inputs are per-char + sceneDefaults +
    //  defaultSceneId; there is no 4th source the resolver consults.)
    const m = manifest({});
    expect(resolveSceneId("not-a-char", "idle_coffee", m)).toBe("room3");
  });
});

describe("resolveTileScene — paint decision + url build + dangling defense", () => {
  it("a resolved scene id → kind:scene with a base-prefixed url", () => {
    const m = manifest({ sceneDefaults: { idle_coffee: "room5" } });
    const r = resolveTileScene(CHAR, "idle_coffee", BASE, m);
    expect(r.kind).toBe("scene");
    expect(r.id).toBe("room5");
    expect(r.url).toContain(`${BASE}/sprites/scenes/room5.png`);
    // No double-slash between base and path.
    expect(r.url).not.toContain("dist/webview//sprites");
  });

  it("the \"none\" sentinel → kind:none (flat card) — no url", () => {
    const m = manifest({ sceneDefaults: { active_work: SCENE_NONE } });
    const r = resolveTileScene(CHAR, "active_work", BASE, m);
    expect(r.kind).toBe("none");
    expect(r.id).toBe(SCENE_NONE);
    expect(r.url).toBeUndefined();
  });

  it("no registry → kind:none (flat card)", () => {
    const m = manifest({ noRegistry: true });
    const r = resolveTileScene(CHAR, "idle_coffee", BASE, m);
    expect(r.kind).toBe("none");
  });

  it("a DANGLING per-char id (not in byId) → kind:none (sceneForId null defense, §4)", () => {
    const m = manifest({ perCharScenes: { idle_coffee: "room99" } });
    const r = resolveTileScene(CHAR, "idle_coffee", BASE, m);
    // resolveSceneId returns "room99"; sceneForId(null) → treat as flat card.
    expect(r.kind).toBe("none");
  });

  it("absent spriteBaseUri → kind:none (browser-dev parity with sprite frames)", () => {
    const m = manifest({ sceneDefaults: { idle_coffee: "room5" } });
    expect(resolveTileScene(CHAR, "idle_coffee", undefined, m).kind).toBe(
      "none",
    );
    expect(resolveTileScene(CHAR, "idle_coffee", "", m).kind).toBe("none");
  });
});

describe("sceneKeyOf — stable per-render crossfade key", () => {
  it("a real scene → its id; explicit none → \"none\"; dangling/no-registry → \"\"", () => {
    const sceneM = manifest({ sceneDefaults: { idle_coffee: "room5" } });
    expect(sceneKeyOf(resolveTileScene(CHAR, "idle_coffee", BASE, sceneM))).toBe(
      "room5",
    );
    const noneM = manifest({ sceneDefaults: { active_work: SCENE_NONE } });
    expect(sceneKeyOf(resolveTileScene(CHAR, "active_work", BASE, noneM))).toBe(
      SCENE_NONE,
    );
    const danglingM = manifest({ perCharScenes: { idle_coffee: "roomX" } });
    expect(
      sceneKeyOf(resolveTileScene(CHAR, "idle_coffee", BASE, danglingM)),
    ).toBe("");
  });

  it("a none key DIFFERS from a real scene key → drives a crossfade on work↔idle", () => {
    // The desk-clash seed flips active_work(none) ↔ idle(room3) — the keys differ,
    // so the crossfade fires (spec §3.1 most-common trigger).
    const seedM = manifest({
      sceneDefaults: { active_work: SCENE_NONE },
    });
    const workKey = sceneKeyOf(resolveTileScene(CHAR, "active_work", BASE, seedM));
    const idleKey = sceneKeyOf(resolveTileScene(CHAR, "idle_coffee", BASE, seedM));
    expect(workKey).not.toBe(idleKey);
    expect(workKey).toBe(SCENE_NONE);
    expect(idleKey).toBe("room3");
  });
});

/*
 * ── MUTATION PROBE (non-vacuity audit — these edits MUST fail the tests) ──────
 * 1. Drop the per-char layer from `resolveSceneId` (skip the `source.characters
 *    [char]?.scenes` check) → "layer 1 wins highest" block fails (per-char id +
 *    none-over-real-scene assertions).
 * 2. Make `"none"` fall through (treat it like unset) → the "STOPS the cascade"
 *    assertions in layers 1+2 fail (active_work would resolve to room3/room5
 *    instead of "none").
 * 3. Drop the dangling defense (return the raw id without `sceneForId`) →
 *    resolveTileScene's dangling test fails (kind would be "scene", not "none").
 * 4. Remove the spriteBaseUri guard → the "absent spriteBaseUri" test fails.
 */
