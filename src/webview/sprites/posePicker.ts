/**
 * posePicker — pure pose-selection logic (AC2 / AC6). No DOM, no timers.
 *
 * Maps a tile's (state, activity) to a canonical animation name, then resolves
 * that name to a concrete `SpriteAnimation` via the character manifest.
 *
 * Pose → state mapping (whole-team-display-spec §3.2):
 *   - running, tool == Read   → active_read
 *   - running, tool != Read   → active_work
 *   - idle / available / finished / error → a random idle-pool member
 *
 * The activity string carries the tool name for running tiles in the form
 * `tool:<name> <arg>` (see AgentTile.activity contract / reducer buildActivity).
 * The `tool:?` sentinel (fresh spawn, no tool_use yet) is treated as non-Read
 * → active_work, matching the dot's running semantics.
 *
 * Source: team/iris-ux/whole-team-display-spec.md §3.2
 *         .claude/docs/persona-pixel-character-animation-prompts.md § Naming convention
 */

import type { AgentState } from "../../shared/types.js";
import type { SpriteAnimation, SpriteCharacter } from "./spriteManifest.js";

export const ACTIVE_READ = "active_read";
export const ACTIVE_WORK = "active_work";

/**
 * Extract the tool name from a running tile's activity string.
 * `"tool:Read src/x.ts"` → `"Read"`; `"tool:?"` → `"?"`; anything not
 * matching the `tool:` prefix → null.
 */
export function toolFromActivity(activity: string): string | null {
  const m = /^tool:(\S+)/.exec(activity);
  return m ? m[1] : null;
}

/**
 * The canonical animation NAME a tile should play, given its state + activity
 * and the idle-pool member already selected for this idle episode.
 *
 * `idlePick` is supplied by the caller (the player owns idle-episode
 * stickiness — see spritePlayer). For running tiles `idlePick` is ignored.
 *
 * Returns the canonical name (e.g. "active_read", "idle_coffee"). The caller
 * resolves it to frames via `resolvePose`.
 */
export function poseNameForTile(
  state: AgentState,
  activity: string,
  idlePick: string | null,
): { name: string; isActive: boolean } {
  if (state === "running") {
    const tool = toolFromActivity(activity);
    const name = tool === "Read" ? ACTIVE_READ : ACTIVE_WORK;
    return { name, isActive: true };
  }
  // idle / available / finished / error → idle-pool loop.
  return { name: idlePick ?? "", isActive: false };
}

/**
 * Resolve a canonical anim name to a concrete `SpriteAnimation` for a
 * character, with graceful fallbacks so the sprite box never renders empty:
 *   1. exact name hit → use it.
 *   2. miss on an active pose → fall back to the default idle (a character
 *      may lack active_read/active_work in an early harvest).
 *   3. miss on an idle name → fall back to default idle, then any anim.
 *   4. character has no anims at all → null (caller falls back to text tile).
 */
export function resolvePose(
  char: SpriteCharacter,
  name: string,
): SpriteAnimation | null {
  const direct = char.animations[name];
  if (direct) {
    return direct;
  }
  if (char.defaultIdle && char.animations[char.defaultIdle]) {
    return char.animations[char.defaultIdle];
  }
  const any = Object.values(char.animations)[0];
  return any ?? null;
}

/**
 * Pick an idle-pool member for a fresh idle episode. Deterministic when a
 * `rng` (0..1) is injected (tests); defaults to Math.random in production.
 * Falls back to defaultIdle, then the first animation name.
 */
export function pickIdle(
  char: SpriteCharacter,
  rng: () => number = Math.random,
): string {
  const pool = char.idlePool.length > 0 ? char.idlePool : Object.keys(char.animations);
  if (pool.length === 0) {
    return char.defaultIdle ?? "";
  }
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx];
}
