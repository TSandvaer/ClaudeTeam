/**
 * liveManifestOverlay — webview-local store of in-session Playback Tuner saves,
 * applied as a field-level overlay onto the build-time-baked
 * `GENERATED_SPRITE_MANIFEST` (ticket 86ca2wrnq).
 *
 * ## The bug this solves (confirmed root cause)
 *
 *   The tuner seeds its controls — on character switch, animation switch, and
 *   close+reopen — by reading the playback blocks out of `manifest`. That
 *   `manifest` is `GENERATED_SPRITE_MANIFEST`, a snapshot BAKED at build time and
 *   frozen in the webview bundle (imported once at module load). On a save the
 *   host writes the override to disk (`playbackOverrideWriter.ts`) but NOTHING
 *   updates the webview's in-memory manifest. So the re-seed paths
 *   (`readSavedPerCharOverride` / `computeCascadeSource` / `seedControlsForWriteTarget`)
 *   read the LOAD-TIME value, not the in-session save. Symptom (sponsor, verbatim):
 *   "i tuned almost all the M01 animations, then i clicked to see F01 and when I
 *   went back to M01 all the tuning was reset." The data IS safe on disk — only
 *   the control re-seed showed the stale pre-edit/default values, which also
 *   created a near-data-loss risk (re-tuning while a stale value showed could
 *   write the stale value back over the good on-disk value).
 *
 * ## The fix
 *
 *   Mirror every CONFIRMED in-session save into this store, keyed by the same
 *   `(writeTarget, char, anim)` the host writes. `apply(baked)` produces an
 *   EFFECTIVE manifest = the baked manifest with each recorded override merged
 *   into its `playback["<anim>"]` block, using the SAME field-level
 *   set-present / clear-absent merge the host's `mergePlaybackEntry` performs —
 *   so the overlay is byte-equivalent to what a rebuild would load from disk.
 *   The tuner reads the EFFECTIVE manifest for all its seed/cascade/window
 *   computations, so a re-seed reflects the in-session save without a rebuild.
 *
 *   Records only on a CONFIRMED ok-ack (the panel stashes the emitted payload and
 *   commits it here when `playback:override-saved {ok:true}` returns). An error
 *   ack records nothing, so the overlay never diverges from disk.
 *
 * ## Field-level merge semantics (must mirror the host writer)
 *
 *   The host (`mergePlaybackEntry`) treats the FULL tunable-key set as
 *   field-omission == clear: a key PRESENT in the override is set, a key ABSENT
 *   (among the tunable keys — which since 86ca2wj6u INCLUDE the window pair
 *   `startFrame`/`endFrame`) is DELETED from the entry; any field NOT in the
 *   tunable set is PRESERVED. This store applies the identical rule, so the
 *   overlaid block matches the on-disk block exactly. If the merged block has no
 *   fields the `playback["<anim>"]` key is dropped (matches the host removing an
 *   empty entry).
 *
 * ## Persistence scope (mirrors tunerStateTracker)
 *
 *   - Survives poll-tick `renderFull` (the panel is re-seeded from the effective
 *     manifest on every rebuild).
 *   - Survives character / animation switch + panel close+reopen WITHIN the same
 *     webview boot (the store is owned by the boot closure, not the panel) — this
 *     is the load-bearing scope the bug needed.
 *   - Does NOT survive a webview reload — but a reload also re-imports the bundle,
 *     and a real `npm run build` bakes the saved values into the manifest, so a
 *     reload-after-build reads the persisted values from the fresh manifest. A
 *     reload WITHOUT a rebuild loses the overlay, which is acceptable (the data is
 *     still on disk; the next build picks it up). This matches the existing
 *     "rebuild + reload to apply to the live tiles" banner contract — the overlay
 *     only short-circuits the TUNER's own re-seed, never the dashboard tiles.
 *
 * Pure data + pure accessors; no DOM, no VS Code API (unit-testable).
 *
 * Source: ClickUp 86ca2wrnq; mirrors host `playbackOverrideWriter.mergePlaybackEntry`.
 */

import type {
  GeneratedSpriteManifest,
  SpriteAnimation,
  SpriteCharacter,
} from "./sprites/spriteManifest.js";
import type { PlaybackOverride } from "./sprites/spritePlayer.js";
import type { WebviewMessage } from "../shared/messages.js";

/**
 * The save-message override payload as it lands on the wire — playback keys PLUS
 * the optional scene field `sceneId` (86ca88nvd §5.3). Derived from main's
 * `messages.ts` `ui:save-playback-override` payload (Felix's wire half, 86ca88p0a)
 * so the store records the REAL `sceneId` field rather than a local
 * `PlaybackOverride & { sceneId?: string }` intersection. Shapes byte-identical
 * (Felix's #218 review) — pure single-source-of-truth swap, no behavior change.
 */
type SaveOverridePayload = Extract<
  WebviewMessage,
  { type: "ui:save-playback-override" }
>["payload"]["override"];

/**
 * The tunable fields the tuner owns — MUST stay byte-identical to the host
 * writer's `TUNABLE_KEYS` (`src/extension/sprites/playbackOverrideWriter.ts`).
 *
 * The window pair `startFrame`/`endFrame` became tuner-owned (86ca2wj6u) on the
 * HOST writer but was NOT propagated here — so the overlay treated the window as
 * a non-tunable OOS field (preserved untouched) while the host sets-it-present /
 * clears-it-absent and writes it to disk. The two merges DIVERGED: a confirmed
 * in-session window save never landed on the effective manifest, so a re-seed
 * (`activeWindow` → `seedWindowFromActive`, char/anim switch, close+reopen) read
 * the stale LOAD-TIME baked window instead of the just-saved one — the exact
 * stale-manifest re-seed class this overlay exists to prevent (86ca7yumw). The
 * window pair is field-level merged identically to the other tunable keys: set
 * when present, CLEAR when absent (mirrors `mergePlaybackEntry`).
 */
const TUNABLE_KEYS = [
  "speedMultiplier",
  "finalDwellMs",
  "playbackMode",
  "dwellFrameIndex",
  "dwellMs",
  // 86ca7yumw — window pair, tuner-owned since 86ca2wj6u on the host writer.
  "startFrame",
  "endFrame",
] as const;

/** A single confirmed save the store remembers. */
export interface RecordedSave {
  writeTarget: "per-char" | "pose-default";
  /** Manifest char key — REQUIRED when writeTarget === "per-char". */
  characterFolder?: string;
  animName: string;
  /**
   * Only the SET fields (field-omission == clear) — exactly the emitted draft.
   * MIXED PAYLOAD (scene-per-pose 86ca88nvd, PR #216 NIT): the override may carry
   * BOTH playback keys AND the scene field `sceneId`. `apply` ROUTES them to
   * SEPARATE on-disk-mirrored blocks — playback keys → `playback["<anim>"]`,
   * `sceneId` → the `scenes["<anim>"]` (per-char) / `sceneDefaults["<anim>"]`
   * (pose-default) block — exactly as the host writer splits them. `sceneId`
   * value = a scene id OR the `"none"` sentinel; ABSENT = clear (inherit). So an
   * in-session scene save re-seeds correctly without a rebuild (the #213/#214
   * stale-re-seed class extended to the scene block). Typed from the real wire
   * payload (`SaveOverridePayload`) now that Felix's `sceneId` field is on main.
   */
  override: SaveOverridePayload;
}

/** Public surface of the store — single instance per webview boot. */
export interface LiveManifestOverlay {
  /**
   * Record a CONFIRMED in-session save. The override is cloned on write so a
   * later mutation of the caller's draft can't leak in. A later save for the
   * same `(writeTarget, char, anim)` REPLACES the prior record (last write wins,
   * matching the file on disk).
   */
  record(save: RecordedSave): void;

  /**
   * Produce the EFFECTIVE manifest = `baked` with every recorded save merged
   * into its `playback["<anim>"]` block (field-level set/clear). Returns a fresh
   * shallow-rebuilt manifest; `baked` is never mutated. When nothing has been
   * recorded the returned manifest is value-equivalent to `baked`.
   */
  apply(baked: GeneratedSpriteManifest): GeneratedSpriteManifest;

  /** Clear all recorded saves (panel reset / fresh open is NOT a reset — see note). */
  reset(): void;
}

/** Stable composite key for a recorded save. */
function keyOf(save: {
  writeTarget: "per-char" | "pose-default";
  characterFolder?: string;
  animName: string;
}): string {
  return save.writeTarget === "per-char"
    ? `per-char ${save.characterFolder ?? ""} ${save.animName}`
    : `pose-default ${save.animName}`;
}

/**
 * Field-level merge of `override` into an existing playback block, mirroring the
 * host's `mergePlaybackEntry`: tunable key present → set, tunable key absent →
 * delete (the window pair `startFrame`/`endFrame` is now in the tunable set, so
 * it follows the same set/clear rule — 86ca7yumw); any field outside the tunable
 * set is preserved. Returns the merged block, or `undefined` when empty after
 * merge (caller drops the whole `playback[anim]`).
 */
function mergeBlock(
  existing: PlaybackOverride | undefined,
  override: PlaybackOverride,
): PlaybackOverride | undefined {
  const out: PlaybackOverride = { ...(existing ?? {}) };
  for (const key of TUNABLE_KEYS) {
    if (override[key] !== undefined) {
      // Index access is sound — both objects share the PlaybackOverride shape.
      (out as Record<string, unknown>)[key] = override[key];
    } else {
      delete (out as Record<string, unknown>)[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Field-level merge of the scene field (`sceneId`) into an existing scene block,
 * mirroring the host writer's `scenes`/`sceneDefaults` set/clear (scene-per-pose
 * 86ca88nvd, PR #216 mixed-payload NIT). Unlike the playback block (an OBJECT of
 * many tunable keys), the scene block holds ONE value per anim: a scene id OR the
 * `"none"` sentinel. So the merge is: `sceneId` PRESENT → set `block[anim]`;
 * `sceneId` ABSENT (the save didn't set it) → DELETE `block[anim]` (clear →
 * inherit). Returns the next block (a fresh object), or `undefined` when it has
 * no entries left (caller drops the whole block to preserve absent-vs-empty).
 */
function mergeSceneBlock(
  existing: Record<string, string> | undefined,
  animName: string,
  sceneId: string | undefined,
): Record<string, string> | undefined {
  const out: Record<string, string> = { ...(existing ?? {}) };
  if (sceneId !== undefined) {
    out[animName] = sceneId;
  } else {
    delete out[animName];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Factory — returns an isolated overlay instance. Pure (no shared state). */
export function createLiveManifestOverlay(): LiveManifestOverlay {
  const saves = new Map<string, RecordedSave>();

  return {
    record(save: RecordedSave): void {
      saves.set(keyOf(save), {
        writeTarget: save.writeTarget,
        ...(save.characterFolder !== undefined
          ? { characterFolder: save.characterFolder }
          : {}),
        animName: save.animName,
        override: { ...save.override },
      });
    },

    apply(baked: GeneratedSpriteManifest): GeneratedSpriteManifest {
      if (saves.size === 0) return baked;

      // Clone the layers we may touch. We rebuild only the characters / anims /
      // poseDefaults / sceneDefaults entries that a recorded save lands on;
      // everything else is re-referenced unchanged (cheap — a few entries/session).
      const characters: Record<string, SpriteCharacter> = {
        ...baked.characters,
      };
      const poseDefaults: Record<string, PlaybackOverride> = {
        ...(baked.poseDefaults ?? {}),
      };
      // Scene pose-default block (86ca88nvd) — the pose-default scene layer the
      // tuner re-seeds from. Mirrors the poseDefaults clone.
      const sceneDefaults: Record<string, string> = {
        ...(baked.sceneDefaults ?? {}),
      };
      let touchedPoseDefaults = false;
      let touchedSceneDefaults = false;

      for (const save of saves.values()) {
        // MIXED-PAYLOAD ROUTING (86ca88nvd, PR #216 NIT): split the override into
        // its playback keys (→ playback block) and the scene field (→ scenes /
        // sceneDefaults block). The two never share a block — `sceneId` is NOT a
        // TUNABLE_KEY (it lives in a separate on-disk block), so `mergeBlock` (which
        // walks TUNABLE_KEYS) ignores it and the playback merge is unaffected.
        const sceneId = save.override.sceneId;
        if (save.writeTarget === "per-char") {
          const charKey = save.characterFolder ?? "";
          const char = characters[charKey];
          // Only overlay a char the baked manifest actually has — a save for an
          // unknown char can't be re-seeded into a control that has no option for
          // it, so dropping it here keeps the overlay consistent with what the
          // panel can render. (In practice the panel only saves for a known char.)
          if (!char) continue;
          // ── Playback keys → animations[anim].playback ──
          const anim = char.animations[save.animName];
          let nextChar: SpriteCharacter = char;
          if (anim) {
            const merged = mergeBlock(anim.playback, save.override);
            const nextAnim: SpriteAnimation = { ...anim };
            if (merged === undefined) {
              delete nextAnim.playback;
            } else {
              nextAnim.playback = merged;
            }
            nextChar = {
              ...nextChar,
              animations: {
                ...nextChar.animations,
                [save.animName]: nextAnim,
              },
            };
          }
          // ── Scene field → char.scenes[anim] (3-state set/clear) ──
          const mergedScenes = mergeSceneBlock(
            nextChar.scenes,
            save.animName,
            sceneId,
          );
          if (mergedScenes === undefined) {
            const { scenes: _drop, ...rest } = nextChar;
            void _drop;
            nextChar = rest;
          } else {
            nextChar = { ...nextChar, scenes: mergedScenes };
          }
          characters[charKey] = nextChar;
        } else {
          // ── pose-default: playback keys → poseDefaults[anim] ──
          const merged = mergeBlock(poseDefaults[save.animName], save.override);
          if (merged === undefined) {
            delete poseDefaults[save.animName];
          } else {
            poseDefaults[save.animName] = merged;
          }
          touchedPoseDefaults = true;
          // ── pose-default: scene field → sceneDefaults[anim] ──
          const mergedScene = mergeSceneBlock(
            sceneDefaults,
            save.animName,
            sceneId,
          );
          // mergeSceneBlock returns the WHOLE block (or undefined when empty);
          // re-assign the cloned block contents in place.
          for (const k of Object.keys(sceneDefaults)) delete sceneDefaults[k];
          if (mergedScene !== undefined) {
            Object.assign(sceneDefaults, mergedScene);
          }
          touchedSceneDefaults = true;
        }
      }

      return {
        characters,
        // Carry forward the SCENE REGISTRY (`scenes: SpriteScenes`) untouched —
        // it is the available-rooms registry the picker + cascade read, NOT a
        // tunable layer. The overlay never writes it, so a save must not DROP it
        // (86ca88nvd — the overlaid manifest is the panel's sole manifest view).
        ...(baked.scenes !== undefined ? { scenes: baked.scenes } : {}),
        // Preserve "absent" vs "{}" semantics: only attach poseDefaults when the
        // baked manifest had one OR a pose-default save touched it.
        ...(baked.poseDefaults !== undefined || touchedPoseDefaults
          ? { poseDefaults }
          : {}),
        // Same absent-vs-present preservation for the scene pose-default block:
        // attach when the baked manifest had a sceneDefaults block OR a
        // pose-default scene save touched it (a save that cleared the only entry
        // still attaches an empty block, mirroring the host writer leaving `{}`).
        ...(baked.sceneDefaults !== undefined || touchedSceneDefaults
          ? { sceneDefaults }
          : {}),
      };
    },

    reset(): void {
      saves.clear();
    },
  };
}
