/**
 * cascadeSource — per-field effective-value + originating-layer resolution for
 * the Playback Tuner's source table (E5 86ca2189v / E4 spec §3.5, AC3).
 *
 * The tuner must show, for EACH of the three tunable fields (`speedMultiplier`,
 * `finalDwellMs`, `playbackMode`), the EFFECTIVE resolved value AND which cascade
 * layer it came from. This is load-bearing: the sponsor must understand why a
 * value is what it is before tweaking it.
 *
 * The 3-layer cascade (per `resolvePlayback`, E3):
 *   1. per-char      — `manifest.characters[char].animations[anim].playback.<field>` (wins)
 *   2. pose-default  — `manifest.poseDefaults[anim].<field>` (shared across chars)
 *   3. engine default — the absent-field behavior (speed→1.0, finalDwell→400, mode→"loop")
 *
 * **Field-level (not whole-object):** each field is resolved INDEPENDENTLY — a
 * per-char entry that sets only `speedMultiplier` still inherits `playbackMode` /
 * `finalDwellMs` from the pose-default. The three source tags can legitimately
 * differ per field for the same anim (E4 spec §3.5 field-level merge reminder).
 *
 * This reflects what is BAKED/persisted — the live-preview `draftOverride` is
 * deliberately EXCLUDED here (the slider readout reflects the draft; the source
 * table reflects the baked manifest — E4 spec §3.5 "two surfaces").
 *
 * Pure — no DOM, no VS Code API. Unit-testable.
 *
 * Source: team/iris-design/anim-tuner-spec.md §3.5
 */

import {
  DWELL_MS_DEFAULT,
  type PlaybackMode,
} from "./spritePlayer.js";
import type { GeneratedSpriteManifest } from "./spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "./generatedManifest.js";

/** Which cascade layer an effective field value originated from. */
export type CascadeLayer = "per-char" | "pose-default" | "engine default";

/** The three tunable fields the tuner surfaces (LOCKED vocabulary). */
export type TunableField = "speedMultiplier" | "finalDwellMs" | "playbackMode";

/** One field's effective value + originating layer. */
export interface FieldSource {
  /** The resolved effective value (number for speed/hold, literal for mode). */
  value: number | PlaybackMode;
  /** Which layer supplied it. */
  layer: CascadeLayer;
}

/** Per-field source breakdown for one (char, anim). */
export interface CascadeSourceTable {
  speedMultiplier: FieldSource;
  finalDwellMs: FieldSource;
  playbackMode: FieldSource;
}

/** Engine-default values (the absent-field behavior — mirrors spritePlayer). */
const ENGINE_DEFAULTS = {
  speedMultiplier: 1,
  finalDwellMs: DWELL_MS_DEFAULT,
  playbackMode: "loop" as PlaybackMode,
};

/**
 * Resolve ONE field's effective value + layer by walking the cascade top-down on
 * the BAKED manifest: per-char wins, else pose-default, else engine default.
 *
 * `perChar` / `poseDefault` are the raw field VALUES (already extracted from the
 * manifest blocks). A value of `undefined` means the layer doesn't set the field.
 */
function resolveField<T extends number | PlaybackMode>(
  perChar: T | undefined,
  poseDefault: T | undefined,
  engineDefault: T,
): FieldSource {
  if (perChar !== undefined) {
    return { value: perChar, layer: "per-char" };
  }
  if (poseDefault !== undefined) {
    return { value: poseDefault, layer: "pose-default" };
  }
  return { value: engineDefault, layer: "engine default" };
}

/**
 * Compute the per-field source table for (character, anim) against the baked
 * manifest. Each field resolved independently (E4 spec §3.5).
 *
 * @param characterFolder manifest char key (e.g. "ClaudeTeam-M01-Dev").
 * @param animName        canonical anim name (e.g. "idle_stretch").
 * @param manifest        the baked manifest (default = GENERATED_SPRITE_MANIFEST).
 */
export function computeCascadeSource(
  characterFolder: string,
  animName: string,
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): CascadeSourceTable {
  const perChar =
    manifest.characters[characterFolder]?.animations?.[animName]?.playback;
  const poseDefault = manifest.poseDefaults?.[animName];

  return {
    speedMultiplier: resolveField(
      perChar?.speedMultiplier,
      poseDefault?.speedMultiplier,
      ENGINE_DEFAULTS.speedMultiplier,
    ),
    finalDwellMs: resolveField(
      perChar?.finalDwellMs,
      poseDefault?.finalDwellMs,
      ENGINE_DEFAULTS.finalDwellMs,
    ),
    playbackMode: resolveField(
      perChar?.playbackMode,
      poseDefault?.playbackMode,
      ENGINE_DEFAULTS.playbackMode,
    ),
  };
}
