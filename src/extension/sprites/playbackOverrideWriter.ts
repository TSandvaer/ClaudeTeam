/**
 * playbackOverrideWriter — host-side structured json writer for the Playback
 * Tuner (E5 86ca2189v / E4 spec §4.3).
 *
 * Persists a `ui:save-playback-override` into the correct json file:
 *   - `writeTarget: "per-char"`     → `<workspace>/assets/sprites/<char>/animations.json`
 *                                     `playback["<anim>"]` block.
 *   - `writeTarget: "pose-default"` → `<workspace>/assets/sprites/pose-defaults.json`
 *                                     `playback["<anim>"]` block.
 *
 * ## Field-level structured merge (NOT whole-file replace) — load-bearing
 *
 * The write is a structured FIELD-LEVEL merge into the EXISTING file: load the
 * current json, set/delete the tunable playback fields (`speedMultiplier`,
 * `finalDwellMs`, `playbackMode`, and — 86ca2bqe1 — the apex-hold pair
 * `dwellFrameIndex`/`dwellMs`) for `animName` under the file's `playback`
 * block, re-serialize, write. Everything else — the `animations` name→folder map,
 * other anims' playback entries, the `_note` / `_playback_note` comments, the
 * `idle_pool`, etc. — is preserved untouched.
 *
 * **Field-omission == clear (§4.1):** the `override` payload carries ONLY fields
 * the sponsor SET. A field ABSENT from the payload is REMOVED from the json
 * entry (so `[reset]` truly unsets it, restoring inheritance). If the resulting
 * entry is empty (no fields), the entire `playback["<anim>"]` key is removed so
 * the file stays minimal.
 *
 * ## Scene block (scene-per-pose feature, 86ca88nvd — Iris spec §5.1/§5.4)
 *
 * The same `override` payload also carries an optional `sceneId` (a scene id or
 * the literal `"none"`). It lands in a SEPARATE top-level `scenes` block (sibling
 * of `playback`, NOT inside it — §5.1), keyed by anim name, with one string value
 * per anim. Same field-omission == clear semantic: present → set, absent →
 * DELETE the `scenes["<anim>"]` key (→ inherit / cascade fall-through). The block
 * is created lazily and dropped when empty, so a file with no scene overrides is
 * byte-identical to today. The webview overlay (`liveManifestOverlay.ts`) MUST
 * mirror this set/clear exactly (the §5.4 PARITY INVARIANT — the #213/#214
 * stale-re-seed defect class).
 *
 * ## Schema compatibility (Felix spec-edge — E4 spec §4.3)
 *
 * The shape this writer emits MUST round-trip through `scripts/build-sprite-
 * manifest.mjs`, which reads the SAME schema (E2): per-char `animations.json`
 * has a top-level `playback` block keyed by canonical anim name; `pose-defaults.
 * json` has a top-level `playback` block keyed by anim name. The build script's
 * `sanitizePlayback` validates the numeric fields (`speedMultiplier`/
 * `finalDwellMs`/`dwellFrameIndex`/`dwellMs`) as finite numbers and
 * `playbackMode` as `"loop"|"pingpong"` — this writer emits exactly those
 * tunable fields with those types, so a written value survives the rebuild
 * verbatim. The window fields (`startFrame`/`endFrame`) are NOW tuner-owned too
 * (86ca2wj6u): the playback-window control writes them through the SAME
 * field-level merge as the other tunable keys. `sanitizePlayback` already
 * validates them (finite number → passed through), so they round-trip the
 * rebuild verbatim.
 *
 * NEVER throws — every failure (no workspace, malformed existing json, fs error)
 * surfaces as `{ ok: false, error }` so the caller acks `playback:override-saved
 * { ok: false }` and the tuner keeps the draft.
 *
 * Pure helpers (`mergePlaybackEntry`) are exported for unit coverage; the I/O
 * wrapper is integration-tested against a tempdir.
 *
 * Source: team/iris-design/anim-tuner-spec.md §4.3.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The tunable fields the tuner persists (LOCKED vocabulary). */
export interface TunablePlaybackOverride {
  speedMultiplier?: number;
  finalDwellMs?: number;
  playbackMode?: "loop" | "pingpong";
  /**
   * Apex-hold frame index (86ca2bqe1 — "Hold (apex)"). Now tuner-owned: a
   * field-level merge sets it when present and CLEARS it when absent, exactly
   * like the other tunable keys. The engine already applies it (spritePlayer.ts
   * `dwellFrameIndex`); no engine change.
   */
  dwellFrameIndex?: number;
  /** Apex-hold duration in ms (86ca2bqe1). Tuner-owned alongside dwellFrameIndex. */
  dwellMs?: number;
  /**
   * Inclusive lower bound of the playback window (86ca2wj6u — "Window" control).
   * Now tuner-owned: the dual-handle range slider writes it through the same
   * field-level merge as the other tunable keys (set when present, CLEAR when
   * absent). The engine already applies it (spritePlayer.ts `startFrame`); the
   * build script already validates it. Absent → full clip (inherits / start 0).
   */
  startFrame?: number;
  /**
   * Inclusive upper bound of the playback window (86ca2wj6u). Tuner-owned
   * alongside `startFrame`. Absent → full clip (inherits / last frame).
   */
  endFrame?: number;
  /**
   * Tile backdrop SCENE for this pose (scene-per-pose feature, 86ca88nvd — Iris
   * spec §5.3 LOCKED). A scene id (e.g. `"room3"`) OR the literal lowercase
   * string `"none"` (the flat-card STOP sentinel, §2.1 / §5.2). Absent → clear
   * (inherit — the writer DELETES the `scenes["<anim>"]` key).
   *
   * **This field is NOT a playback field — it does NOT join `TUNABLE_KEYS`.** It
   * lives in a SEPARATE on-disk `scenes` block (sibling of `playback`, §5.1), so
   * the writer routes it through a dedicated scene write path (`mergeSceneEntry`)
   * rather than `mergePlaybackEntry`. Keeping it out of `TUNABLE_KEYS` is
   * load-bearing: a scene id is a STRING, not a number/mode literal, and lives in
   * a different block — adding it to `TUNABLE_KEYS` would write it into the
   * `playback` block where the build script's `sanitizePlayback` would drop it.
   */
  sceneId?: string;
}

/** Args for a save. */
export interface SavePlaybackOverrideArgs {
  /** First workspace folder fsPath. `undefined` → no project (error). */
  workspaceFolderPath?: string;
  writeTarget: "per-char" | "pose-default";
  /** Manifest char key — REQUIRED when writeTarget === "per-char". */
  characterFolder?: string;
  /** Canonical anim name (the playback-block key). */
  animName: string;
  /** Only the SET fields (field-omission == clear). */
  override: TunablePlaybackOverride;
}

/** Result mirrors the `playback:override-saved` ack. NEVER throws. */
export type WritePlaybackResult = { ok: true } | { ok: false; error: string };

/** The keys this writer owns (it never touches other playback fields). */
const TUNABLE_KEYS = [
  "speedMultiplier",
  "finalDwellMs",
  "playbackMode",
  // 86ca2bqe1 — apex hold is now tuner-owned (set/clear field-level merge).
  "dwellFrameIndex",
  "dwellMs",
  // 86ca2wj6u — the playback window is now tuner-owned (set/clear field-level
  // merge), via the dual-handle range slider. Without these in the owned set the
  // writer would silently DROP a newly-set window (neither set nor preserved),
  // so the control would preview-move but never persist (spec §0.1 gap).
  "startFrame",
  "endFrame",
] as const;

/**
 * Merge the override into an existing per-anim playback entry (field-level).
 *
 *   - A field PRESENT in `override` → set on the entry.
 *   - A field ABSENT from `override` (among the tunable keys — now including the
 *     window `startFrame`/`endFrame`, 86ca2wj6u) → DELETED from the entry
 *     (clear → inherit / full clip).
 *   - Any OTHER field already on the entry not in TUNABLE_KEYS → preserved
 *     untouched (out of tuner scope).
 *
 * Returns the merged entry, or `null` when the entry is empty after merge (the
 * caller then removes the whole `playback["<anim>"]` key so the file stays lean).
 *
 * Pure. Exported for unit coverage.
 */
export function mergePlaybackEntry(
  existing: Record<string, unknown> | undefined,
  override: TunablePlaybackOverride,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const key of TUNABLE_KEYS) {
    if (override[key] !== undefined) {
      out[key] = override[key];
    } else {
      delete out[key];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Resolve the per-anim SCENE value for the `scenes` block from the override
 * (scene-per-pose feature, 86ca88nvd — spec §5.4). The scene cascade is a
 * SEPARATE on-disk block from `playback`, with a SINGLE value (`sceneId`) per
 * anim, so the "merge" is a plain set/clear of one string — not a field-level
 * object spread like `mergePlaybackEntry`.
 *
 *   - `sceneId` PRESENT in `override` (a scene id or the literal `"none"`) → the
 *     value to set at `scenes["<anim>"]`.
 *   - `sceneId` ABSENT → `null`, signalling the caller to DELETE the
 *     `scenes["<anim>"]` key (clear → inherit). Field-omission == clear, the SAME
 *     semantic as every playback field (spec §5.3).
 *
 * Mirrors `mergePlaybackEntry`'s set/clear contract so the host write + the
 * webview overlay stay in lockstep (the §5.4 PARITY INVARIANT, the #213/#214
 * stale-re-seed defect class). Pure. Exported for unit coverage.
 *
 * @returns the scene-id string to set, or `null` to clear the key.
 */
export function mergeSceneEntry(
  override: TunablePlaybackOverride,
): string | null {
  return override.sceneId !== undefined ? override.sceneId : null;
}

/**
 * Resolve the target json path for a save.
 *   - per-char     → `<workspace>/assets/sprites/<char>/animations.json`
 *   - pose-default → `<workspace>/assets/sprites/pose-defaults.json`
 */
export function resolvePlaybackTargetPath(
  workspaceFolderPath: string,
  writeTarget: "per-char" | "pose-default",
  characterFolder?: string,
): string {
  if (writeTarget === "pose-default") {
    return join(workspaceFolderPath, "assets", "sprites", "pose-defaults.json");
  }
  return join(
    workspaceFolderPath,
    "assets",
    "sprites",
    characterFolder ?? "",
    "animations.json",
  );
}

/**
 * Persist a playback override (E4 spec §4.3). Structured field-level merge into
 * the existing file; never a whole-file replace. NEVER throws.
 */
export function savePlaybackOverride(
  args: SavePlaybackOverrideArgs,
): WritePlaybackResult {
  const { workspaceFolderPath, writeTarget, characterFolder, animName, override } =
    args;

  if (!workspaceFolderPath) {
    return { ok: false, error: "no workspace folder open" };
  }
  if (writeTarget === "per-char" && (!characterFolder || characterFolder.length === 0)) {
    return { ok: false, error: "per-char write requires a characterFolder" };
  }
  if (!animName || animName.length === 0) {
    return { ok: false, error: "animName is required" };
  }

  const path = resolvePlaybackTargetPath(
    workspaceFolderPath,
    writeTarget,
    characterFolder,
  );
  if (!existsSync(path)) {
    return { ok: false, error: `target json not found: ${path}` };
  }

  // Load the existing json (preserve everything but the merged playback entry).
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return { ok: false, error: `read error (${path}): ${(err as Error).message}` };
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse error (${path}): ${(err as Error).message}`,
    };
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { ok: false, error: `target json is not an object: ${path}` };
  }

  const root = doc as Record<string, unknown>;
  // The `playback` block is a sibling of `animations` (per-char) / top-level
  // (pose-defaults) — same key in both schemas. Create it if absent.
  const playbackRaw = root.playback;
  const playback: Record<string, unknown> =
    typeof playbackRaw === "object" && playbackRaw !== null && !Array.isArray(playbackRaw)
      ? { ...(playbackRaw as Record<string, unknown>) }
      : {};

  const existingEntry =
    typeof playback[animName] === "object" &&
    playback[animName] !== null &&
    !Array.isArray(playback[animName])
      ? (playback[animName] as Record<string, unknown>)
      : undefined;

  const merged = mergePlaybackEntry(existingEntry, override);
  if (merged === null) {
    // Empty after merge → drop the whole anim key (stay minimal).
    delete playback[animName];
  } else {
    playback[animName] = merged;
  }
  root.playback = playback;

  // Scene block (scene-per-pose feature, 86ca88nvd — spec §5.1/§5.4). A SEPARATE
  // top-level `scenes` block (sibling of `playback`) keyed by anim name, holding
  // a single scene-id string (or the literal `"none"`) per anim. Field-omission
  // == clear: an absent `sceneId` DELETES the anim's scene key (→ inherit), set
  // when present. The block is created lazily and dropped when it empties, so a
  // file with no scene overrides stays byte-identical to today (no `scenes` key).
  const scenesRaw = root.scenes;
  const scenes: Record<string, unknown> =
    typeof scenesRaw === "object" && scenesRaw !== null && !Array.isArray(scenesRaw)
      ? { ...(scenesRaw as Record<string, unknown>) }
      : {};
  const sceneValue = mergeSceneEntry(override);
  if (sceneValue === null) {
    delete scenes[animName];
  } else {
    scenes[animName] = sceneValue;
  }
  if (Object.keys(scenes).length > 0) {
    root.scenes = scenes;
  } else {
    // No scene entries left → drop the whole block so the file stays minimal and
    // byte-identical to a never-had-a-scene file.
    delete root.scenes;
  }

  // Re-serialize with 2-space indent + trailing newline (matches the committed
  // json style). The merge preserved every other key in document order.
  try {
    writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, { encoding: "utf8" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `write error (${path}): ${(err as Error).message}` };
  }
}
