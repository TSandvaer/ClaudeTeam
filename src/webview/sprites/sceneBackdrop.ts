/**
 * sceneBackdrop — the SHARED scene-resolution + paint + crossfade helper for the
 * scene-per-pose feature (86ca88nvd). One place owns the 3-layer cascade lookup,
 * the `data-scene-bg` / `--ct-scene-url` LOCKED render vocabulary, and the
 * pose→pose cross-dissolve so the dashboard tiles (`agentTile.ts`,
 * `multiAgentPersonaTile.ts`) and the tuner preview (`playbackTunerPreview.ts`)
 * can't drift apart on the resolution or the paint.
 *
 * Pure DOM + pure data (no VS Code API, no timers) — jsdom-unit-testable.
 *
 * ## Resolution (spec §2.1 / §6 — the architected call-site upgrade)
 *
 *   V1 painted EVERY sprite tile with `defaultScene()` (always the floor). This
 *   feature replaces that single call with `resolveSceneId(char, pose)` at the
 *   SAME call sites: the call site upgrades from "always the default" to "the
 *   cascade-resolved scene", whose FLOOR is still `defaultSceneId`. So:
 *     - `resolveSceneId` → a scene id present in `byId` → paint `sceneForId(id).image`.
 *     - `resolveSceneId` → `"none"` (explicit flat card)  → OMIT (flat card).
 *     - `resolveSceneId` → an id NOT in `byId` (dangling) → `sceneForId` null → OMIT.
 *     - `resolveSceneId` → `null` (no registry)           → OMIT (V1 degrade).
 *   `"none"` and "no registry" both land on the SAME omit-`data-scene-bg` render —
 *   no new render branch (spec §2.1 / §4).
 *
 * ## Crossfade (spec §3 — 200ms ease-in-out opacity cross-dissolve)
 *
 *   The dashboard tile is REBUILT every ~2s poll tick, so the crossfade can't be
 *   a within-one-tile-lifetime animation — it is driven by THREADING the prior
 *   pose's resolved scene id into the next render (exactly like the sprite player
 *   threads the prior frame). On mount, if the newly-resolved scene DIFFERS from
 *   the prior, the helper stamps `data-scene-transition` on the element; the CSS
 *   runs the dissolve from that attribute (the same idiom as the existing
 *   state-transition `data-transition`). When prior === new, NO attribute is set
 *   → no needless flicker (spec §3.1 "no change" row). All four directions
 *   (A→B, scene→none, none→scene) flip the attribute; the CSS opacity transition
 *   is the visual. Reduced-motion = hard cut (CSS @media), so the helper always
 *   stamps the attribute and lets CSS decide whether to animate.
 *
 * Source: team/iris-design/scene-per-pose-spec.md §2, §3, §6.
 */

import {
  resolveSceneId,
  sceneForId,
  SCENE_NONE,
  type GeneratedSpriteManifest,
} from "./spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "./generatedManifest.js";

/** Attribute the helper stamps on a tile/preview when a scene resolved + paints. */
export const SCENE_BG_ATTR = "data-scene-bg";
/** Attribute the helper stamps for the pose→pose cross-dissolve (CSS-driven). */
export const SCENE_TRANSITION_ATTR = "data-scene-transition";

/**
 * The resolved scene for a (character, pose) — the cascade outcome reduced to
 * what the paint needs. `kind`:
 *   - `"scene"` → a real backdrop resolved; `id` + `url` (base-prefixed) carry it.
 *   - `"none"`  → the cascade resolved to the explicit `"none"` sentinel OR a
 *                 dangling id OR no registry → flat card (OMIT the attribute).
 *   `id` is the cascade-resolved scene id (carried even when `kind === "none"`
 *   only for the explicit-`"none"` case, where it equals the `"none"` sentinel)
 *   — but callers should treat `kind` as the paint decision. For the crossfade
 *   diff, `sceneKeyOf(resolved)` gives a stable per-render key (the id, or the
 *   literal `"none"`/`""` for the flat-card cases).
 */
export interface ResolvedTileScene {
  kind: "scene" | "none";
  /** The resolved scene id when `kind === "scene"`; `"none"` for explicit-none;
   *  `""` for dangling-id / no-registry (both render flat, but distinct from
   *  explicit-none for diagnostics). */
  id: string;
  /** The base-prefixed `url('…')` for `--ct-scene-url` when `kind === "scene"`. */
  url?: string;
}

/**
 * Resolve the scene a tile/preview should paint for `(characterName, animName)`,
 * building the `--ct-scene-url` value when a real scene resolves. `spriteBaseUri`
 * prefixes the dist-relative image path EXACTLY like sprite frames (so the scene
 * image resolves through the host's `asWebviewUri`); when it is absent / empty
 * the scene cannot resolve to a real image → flat card (browser-dev parity with
 * the sprite frames). The `manifest` defaults to the baked one; tuner + tests
 * inject the overlaid/mocked manifest.
 */
export function resolveTileScene(
  characterName: string,
  animName: string,
  spriteBaseUri: string | undefined,
  manifest: GeneratedSpriteManifest = GENERATED_SPRITE_MANIFEST,
): ResolvedTileScene {
  const resolved = resolveSceneId(characterName, animName, manifest);
  // Explicit "none" sentinel → flat card (stop the cascade; spec §2.1).
  if (resolved === SCENE_NONE) {
    return { kind: "none", id: SCENE_NONE };
  }
  // null (no registry) → flat card (V1 degrade).
  if (resolved === null) {
    return { kind: "none", id: "" };
  }
  // A scene id — but it may be dangling (stale overlay names an unknown id).
  // `sceneForId` null-coalesces an unknown id → treat as flat card (spec §4
  // runtime-dangling row). Also requires a base URI to build a real url.
  const scene = sceneForId(resolved, manifest);
  if (scene === null || spriteBaseUri === undefined || spriteBaseUri === "") {
    return { kind: "none", id: "" };
  }
  const sceneBase = spriteBaseUri.replace(/\/+$/, "");
  const sceneImage = scene.image.replace(/^\/+/, "");
  return {
    kind: "scene",
    id: resolved,
    url: `url('${sceneBase}/${sceneImage}')`,
  };
}

/**
 * Stable per-render key for a resolved scene, used by the crossfade diff: the
 * scene id when a real scene paints, `"none"` for the explicit-none flat card,
 * `""` for the dangling/no-registry flat card. Threaded as `priorSceneKey` into
 * the next render so the helper can decide whether the backdrop CHANGED.
 */
export function sceneKeyOf(resolved: ResolvedTileScene): string {
  return resolved.kind === "scene" ? resolved.id : resolved.id || "";
}

/**
 * Paint the resolved scene onto `el` (a sprite-bearing tile or the preview box),
 * setting the LOCKED render vocabulary (`data-scene-bg` + `--ct-scene-url`) when
 * a real scene resolved, and OMITTING both for the flat-card cases. Returns
 * whether a scene actually painted (drives the per-label chip marker on tiles).
 *
 * Crossfade (spec §3): when `priorSceneKey` is supplied AND differs from the
 * newly-resolved key, stamp `data-scene-transition="cross"` so the CSS runs the
 * 200ms ease-in-out opacity cross-dissolve (`--ct-scene-crossfade-ms` /
 * `--ct-scene-crossfade-ease`). Equal keys → no attribute (no flicker on a pose
 * toggle that didn't change the backdrop). First render (`priorSceneKey`
 * undefined) → no transition (first appearance is not a change, mirroring the
 * state-transition first-render rule). Reduced-motion is honored in CSS (hard
 * cut), so the helper always stamps + lets CSS gate the motion.
 */
export function paintSceneBackdrop(
  el: HTMLElement,
  resolved: ResolvedTileScene,
  opts: { priorSceneKey?: string } = {},
): boolean {
  let painted = false;
  if (resolved.kind === "scene" && resolved.url !== undefined) {
    el.setAttribute(SCENE_BG_ATTR, "");
    el.style.setProperty("--ct-scene-url", resolved.url);
    painted = true;
  } else {
    // Flat card — OMIT both (the existing omit-data-scene-bg degrade path). Never
    // leave a stale attribute/url behind (defensive — fresh tiles have neither).
    el.removeAttribute(SCENE_BG_ATTR);
    el.style.removeProperty("--ct-scene-url");
  }

  // Crossfade: a pose→pose change where the resolved backdrop differs cross-
  // dissolves (spec §3.1). Compare the stable per-render keys; equal → no
  // transition (don't animate a backdrop that didn't change). First render
  // (no prior) → no transition.
  const { priorSceneKey } = opts;
  if (priorSceneKey !== undefined && priorSceneKey !== sceneKeyOf(resolved)) {
    el.setAttribute(SCENE_TRANSITION_ATTR, "cross");
  }
  return painted;
}
