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
 * current json, set/delete the three tunable playback fields (`speedMultiplier`,
 * `finalDwellMs`, `playbackMode`) for `animName` under the file's `playback`
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
 * ## Schema compatibility (Felix spec-edge — E4 spec §4.3)
 *
 * The shape this writer emits MUST round-trip through `scripts/build-sprite-
 * manifest.mjs`, which reads the SAME schema (E2): per-char `animations.json`
 * has a top-level `playback` block keyed by canonical anim name; `pose-defaults.
 * json` has a top-level `playback` block keyed by anim name. The build script's
 * `sanitizePlayback` validates `speedMultiplier`/`finalDwellMs` as finite numbers
 * and `playbackMode` as `"loop"|"pingpong"` — this writer emits exactly those
 * three fields with those types, so a written value survives the rebuild verbatim.
 * This writer does NOT touch the other playback fields the build script also
 * understands (`dwellFrameIndex`/`dwellMs`/`startFrame`/`endFrame`) — they are
 * out of scope for the tuner (§10) and are PRESERVED if already present, since
 * the merge is per-field on the three tunable keys only.
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

/** The three tunable fields the tuner persists (LOCKED vocabulary). */
export interface TunablePlaybackOverride {
  speedMultiplier?: number;
  finalDwellMs?: number;
  playbackMode?: "loop" | "pingpong";
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

/** The three keys this writer owns (it never touches other playback fields). */
const TUNABLE_KEYS = ["speedMultiplier", "finalDwellMs", "playbackMode"] as const;

/**
 * Merge the override into an existing per-anim playback entry (field-level).
 *
 *   - A field PRESENT in `override` → set on the entry.
 *   - A field ABSENT from `override` (among the three tunable keys) → DELETED
 *     from the entry (clear → inherit).
 *   - Any OTHER field already on the entry (e.g. `dwellFrameIndex`, window) →
 *     preserved untouched (out of tuner scope, §10).
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

  // Re-serialize with 2-space indent + trailing newline (matches the committed
  // json style). The merge preserved every other key in document order.
  try {
    writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`, { encoding: "utf8" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `write error (${path}): ${(err as Error).message}` };
  }
}
