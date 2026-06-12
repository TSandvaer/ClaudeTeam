/**
 * playbackTunerPreview — the live-preview mechanics for the Playback Tuner
 * (E5 86ca2189v / E4 spec §5).
 *
 * Two jobs:
 *
 *  1. **Pose forcing (§5.2).** Given `(character, animName)`, return the
 *     `{ state, activity, priorIdlePick, priorWasActive }` quadruple that forces
 *     `createSpriteBox` to resolve `canonicalName === animName` — deterministic,
 *     no fighting the random idle picker:
 *       - `active_*` anim → `state="running"` + an `activity` whose tool drives
 *         `poseNameForTile` to the right active pose (`active_read` needs
 *         tool==Read; anything else → `active_work`).
 *       - `idle_*`   anim → a non-running state + `priorIdlePick = animName`
 *         (+ `priorWasActive = false`) so the idle-stickiness path picks exactly
 *         that pool member rather than a random one (spritePlayer.ts:339-342).
 *
 *  2. **Build/dispose cycle (§5.1, §5.3).** `createPreviewController` owns the
 *     preview DOM node + the current `SpriteBoxHandle`. On every control change
 *     the controller DISPOSES the running box and REBUILDS a fresh one with the
 *     new `draftOverride` injected as a one-entry `playbackTable` — the live
 *     sprite reflects the tweak instantly, in-memory, with zero rebuild/reload
 *     (the injected table shadows the baked manifest for this one preview sprite).
 *     The preview always restarts the loop at `winStart` on any change (§5.3 —
 *     `priorPose = undefined`, fresh) because the tuner is a feel-judging
 *     surface, NOT a calm always-on tile.
 *
 *  3. **Reduced-motion override (§5.4 — DECIDED 2026-06-01, settled).** The
 *     preview passes `reducedMotion: false` EXPLICITLY so it ALWAYS animates,
 *     regardless of the OS / VS Code `prefers-reduced-motion` setting — the
 *     sponsor opened the tuner specifically to watch motion. Scoped to the
 *     tuner's own preview only; the dashboard tiles still honor reduced-motion.
 *
 * The override resolution uses the flat-table form of `resolvePlayback` (no
 * pose-default layer) so the preview reflects exactly the `draftOverride` the
 * sponsor is editing.
 *
 * Functional + jsdom-testable: assert `controller.pose() === animName`, assert
 * the box rebuilds on `update`, assert the injected override drives the frame
 * timing. Per testing-strategy.md § Layer-2.5, NOT sponsor-deferred.
 *
 * Source: team/iris-design/anim-tuner-spec.md §5
 */

import type { AgentState } from "../../shared/types.js";
import type {
  GeneratedSpriteManifest,
  SpriteCharacter,
} from "../sprites/spriteManifest.js";
import { SCENE_NONE } from "../sprites/spriteManifest.js";
import {
  resolveTileScene,
  paintSceneBackdrop,
  sceneKeyOf,
  type ResolvedTileScene,
} from "../sprites/sceneBackdrop.js";
import { GENERATED_SPRITE_MANIFEST } from "../sprites/generatedManifest.js";
import {
  createSpriteBox,
  type PlaybackOverride,
  type SpriteBoxHandle,
} from "../sprites/spritePlayer.js";
import { ACTIVE_READ } from "../sprites/posePicker.js";

/**
 * The draft scene value the tuner picker holds (scene-per-pose 86ca88nvd, spec
 * §1.5). Drives the preview backdrop INDEPENDENTLY of the playback draft:
 *   - a scene id string → paint that scene (the explicit per-target choice).
 *   - the `"none"` sentinel → flat card (no backdrop here).
 *   - `undefined` (Inherit) → resolve through the cascade (`resolveSceneId`) and
 *     paint the inherited scene (or flat card if it resolves to none).
 */
export type DraftSceneId = string | undefined;

/** The pose-forcing inputs to `createSpriteBox` for a given (char, anim). */
export interface PreviewPoseInputs {
  state: AgentState;
  activity: string;
  priorIdlePick?: string;
  priorWasActive: boolean;
}

/**
 * Derive the `createSpriteBox` inputs that force the preview to play exactly
 * `animName` for `char` (§5.2). Pure — no DOM. Exported for unit coverage.
 *
 * `active_read` resolves only when the activity's tool is exactly `Read`;
 * any other active anim (`active_work`, or any non-`active_read` name treated as
 * active) resolves under a non-Read tool. An `idle_*` (or any other) name is
 * threaded as the idle pick under a non-running state so the stickiness path
 * selects it deterministically.
 */
export function derivePreviewPose(
  char: SpriteCharacter,
  animName: string,
): PreviewPoseInputs {
  // An anim is "active" for pose-forcing purposes when its name is one of the
  // active poses. Everything else is treated as an idle pool member.
  const isActiveName = animName.startsWith("active_");
  if (isActiveName) {
    // active_read needs tool==Read; active_work (and anything else active) needs
    // a non-Read tool. `tool:<name>` is the reducer's activity contract.
    const activity =
      animName === ACTIVE_READ ? "tool:Read preview" : "tool:Edit preview";
    return {
      state: "running",
      activity,
      priorWasActive: true,
    };
  }
  // Idle pool member — thread it as the prior idle pick under a non-running
  // state. priorWasActive=false + a defined priorIdlePick === animName makes the
  // stickiness path keep THIS pick (not a fresh roll) per spritePlayer:339-342.
  void char; // char is part of the signature for symmetry / future pose rules
  return {
    state: "idle",
    activity: "idle preview",
    priorIdlePick: animName,
    priorWasActive: false,
  };
}

/** Inputs to build/rebuild the preview box. */
export interface PreviewControllerProps {
  /** The sprite character to preview. */
  char: SpriteCharacter;
  /** Canonical anim name to force. */
  animName: string;
  /** Host-injected sprite base URI. Absent in browser-dev → no frames render. */
  spriteBaseUri?: string;
  /**
   * The manifest the scene backdrop resolves from (ticket 86ca4atwt §B.1). The
   * preview paints the SAME shared `defaultScene` the dashboard tile does (Iris
   * spec §B.1) behind the sprite. Defaults to the baked manifest; tests inject a
   * scene-less manifest to exercise the degrade path (no `data-scene-bg`). Absent
   * → the baked `GENERATED_SPRITE_MANIFEST`.
   */
  manifest?: GeneratedSpriteManifest;
  /** The current draft override (the live slider/dropdown values). */
  draftOverride: PlaybackOverride;
  /**
   * The current DRAFT SCENE value (scene-per-pose 86ca88nvd, spec §1.5). Drives
   * the preview backdrop live from the picker draft (a scene id → that backdrop;
   * `"none"` → flat card; `undefined` = Inherit → cascade-resolve). Absent → the
   * inherited cascade scene (Inherit), so a tuner that never sets the picker
   * matches the dashboard tile's resolved backdrop.
   */
  draftSceneId?: DraftSceneId;
  /** Timer scheduler injection (tests — deterministic stepping). */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Timer canceller injection (tests). */
  cancelFrame?: (handle: number) => void;
  /** RNG injection (tests). Unused for forced poses but threaded for parity. */
  rng?: () => number;
  /**
   * Fired once per completed loop of the previewed pose (ticket 86ca4atwt §B.4).
   * The tuner's Cycle toggle uses it to auto-advance through the step source over
   * the room on Feature A's cadence. Absent → no callback (manual stepping only).
   */
  onLoopComplete?: () => void;
}

/** Handle the tuner uses to drive the preview. */
export interface PreviewController {
  /** The stable container element the tuner mounts into its layout. */
  element: HTMLElement;
  /**
   * Rebuild the preview with a new `(char, animName, draftOverride)` — disposes
   * the running box and builds a fresh one (§5.1). Always restarts at winStart
   * (§5.3, fresh — no position resume). Pass the same `char`/`animName` to
   * re-apply a timing tweak, a new `animName` to switch poses, or a NEW `char`
   * to switch characters.
   *
   * `char` is a REQUIRED update input (86ca2tu9t): a Character switch must rebind
   * the preview to the new character's sprite. Before this, the controller closed
   * over the construction-time `char` and an `update` ignored it — so switching
   * the Character dropdown to M01 left the preview painting F01 (the open-bug).
   */
  update(
    char: SpriteCharacter,
    animName: string,
    draftOverride: PlaybackOverride,
  ): void;
  /**
   * Re-paint ONLY the backdrop from a new draft scene value (scene-per-pose
   * 86ca88nvd, spec §1.5) WITHOUT rebuilding the sprite box — the backdrop swaps
   * the moment the picker changes, crossfading (spec §1.5 / §3) when the resolved
   * backdrop differs. `animName` is the pose the backdrop's Inherit-cascade
   * resolves against (the current selected anim). Pass `undefined` for Inherit.
   */
  setScene(draftSceneId: DraftSceneId, animName: string): void;
  /** The canonical pose name the current box is playing (for tests / a11y). */
  pose(): string;
  /** Whether the current box rendered a sprite (false when no frames / no base). */
  hasSprite(): boolean;
  /**
   * The resolved backdrop KEY the preview currently paints (scene id, or `"none"`
   * / `""` for the flat-card cases). For tests + the tuner's effective-source
   * line cross-check.
   */
  sceneKey(): string;
  /** Stop the running timer + tear down (call when the panel closes). */
  dispose(): void;
}

/**
 * Build a preview controller. The returned `element` is a stable wrapper the
 * tuner places in its layout; the actual sprite box lives inside and is
 * disposed+replaced on every `update`.
 */
export function createPreviewController(
  props: PreviewControllerProps,
): PreviewController {
  const { spriteBaseUri, scheduleFrame, cancelFrame, rng, onLoopComplete } =
    props;
  const manifest = props.manifest ?? GENERATED_SPRITE_MANIFEST;

  const wrapper = document.createElement("div");
  wrapper.className = "ct-tuner-preview-box";

  // ── Scene backdrop over the preview (scene-per-pose 86ca88nvd · spec §1.5) ──
  // The preview paints the backdrop the sponsor is choosing, IN CONTEXT behind
  // the sprite, using the SAME `paintSceneBackdrop` helper + LOCKED vocabulary
  // (`data-scene-bg` + `--ct-scene-url`) the dashboard tile uses. Unlike the
  // dashboard tile (which always cascade-resolves), the preview tracks the picker
  // DRAFT (§1.5): a scene id → that backdrop; `"none"` → flat card; `undefined`
  // (Inherit) → cascade-resolve through `resolveSceneId`. A draft change crossfades
  // (the §3 cross-dissolve) so the sponsor previews the transition feel, not just
  // the end state. The tracked `currentSceneKey` is the prior key for that diff.
  let currentSceneKey: string | undefined;

  /**
   * Resolve the preview backdrop for a draft scene value + anim (§1.5). For an
   * explicit scene id / `"none"` the draft answers directly; for Inherit
   * (`undefined`) it cascade-resolves via `resolveTileScene`. Returns the same
   * `ResolvedTileScene` shape `paintSceneBackdrop` consumes.
   */
  const resolveDraftScene = (
    draftSceneId: DraftSceneId,
    animName: string,
    char: SpriteCharacter,
  ): ResolvedTileScene => {
    if (draftSceneId === SCENE_NONE) {
      // Explicit None → flat card (no backdrop here).
      return { kind: "none", id: SCENE_NONE };
    }
    if (draftSceneId !== undefined) {
      // An explicit scene id — resolve it as if it were the per-char layer value.
      // `resolveTileScene` validates against the registry (dangling → flat) +
      // builds the base-prefixed url. We borrow it by overlaying the id onto a
      // synthetic per-char block so the SAME validation/url path runs.
      return resolveTileScene(char.character, animName, spriteBaseUri, {
        ...manifest,
        characters: {
          ...manifest.characters,
          [char.character]: {
            ...manifest.characters[char.character],
            scenes: {
              ...manifest.characters[char.character]?.scenes,
              [animName]: draftSceneId,
            },
          },
        },
      } as GeneratedSpriteManifest);
    }
    // Inherit → cascade-resolve from the real manifest for this (char, anim).
    return resolveTileScene(char.character, animName, spriteBaseUri, manifest);
  };

  /**
   * Paint the backdrop for the draft + anim onto the wrapper, crossfading from
   * the prior key. Updates `currentSceneKey` so the next paint diffs against it.
   */
  const repaintScene = (
    draftSceneId: DraftSceneId,
    animName: string,
    char: SpriteCharacter,
  ): void => {
    const resolved = resolveDraftScene(draftSceneId, animName, char);
    paintSceneBackdrop(wrapper, resolved, {
      // §5.4: the tuner preview ALWAYS animates (reduced-motion overridden in
      // CSS for this selector), so the crossfade always reads on a draft change.
      ...(currentSceneKey !== undefined ? { priorSceneKey: currentSceneKey } : {}),
    });
    currentSceneKey = sceneKeyOf(resolved);
  };

  let handle: SpriteBoxHandle | null = null;
  let currentPose = "";
  let currentHasSprite = false;
  // The current char key the preview is bound to — so `setScene` (which does NOT
  // pass a char) can re-resolve the backdrop for the live character selection.
  let currentCharKey = props.char.character;
  // The draft scene the preview is currently showing (Inherit when undefined) —
  // remembered so a sprite rebuild (`build`) keeps the chosen backdrop, and a
  // `setScene` picker change diffs/crossfades against the live value.
  let currentDraftSceneId: DraftSceneId = props.draftSceneId;

  const build = (
    char: SpriteCharacter,
    animName: string,
    draftOverride: PlaybackOverride,
  ): void => {
    // Dispose the running box first (§5.1 step 1) — stops its timer.
    handle?.dispose();
    // The scene paint lives on the WRAPPER (attribute + custom prop), so
    // `replaceChildren` (which clears the sprite <img>) leaves it intact — but
    // re-resolve + repaint AFTER so a pose change that changes the inherited
    // backdrop crossfades. The picker draft is preserved (`currentDraftSceneId`).
    wrapper.replaceChildren();
    currentCharKey = char.character;

    const pose = derivePreviewPose(char, animName);
    handle = createSpriteBox({
      char,
      state: pose.state,
      activity: pose.activity,
      ...(spriteBaseUri !== undefined ? { spriteBaseUri } : { spriteBaseUri: "" }),
      ...(pose.priorIdlePick !== undefined
        ? { priorIdlePick: pose.priorIdlePick }
        : {}),
      priorWasActive: pose.priorWasActive,
      // §5.4 (DECIDED): the preview ALWAYS animates — ignore reduced-motion.
      reducedMotion: false,
      // §5.3: fresh start every change — do NOT thread prior position.
      // (priorPose omitted → starts at winStart.)
      // Inject the draft as a one-entry flat playbackTable so the engine
      // resolves THIS override instead of the baked manifest (§1.2 live lever).
      playbackTable: { [char.character]: { [animName]: draftOverride } },
      ...(scheduleFrame !== undefined ? { scheduleFrame } : {}),
      ...(cancelFrame !== undefined ? { cancelFrame } : {}),
      ...(rng !== undefined ? { rng } : {}),
      ...(onLoopComplete !== undefined ? { onLoopComplete } : {}),
    });
    currentPose = handle.pose;
    // A sprite "rendered" when the box resolved frames — the engine stamps
    // `box.dataset.pose` only AFTER the no-frames defensive early-return, so its
    // presence is the reliable has-frames signal (spritePlayer.ts:380).
    currentHasSprite = handle.element.dataset.pose !== undefined;
    wrapper.appendChild(handle.element);
    // Repaint the backdrop for the (possibly new) pose under the current draft —
    // Inherit re-resolves the cascade for the new anim, an explicit pick stays.
    repaintScene(currentDraftSceneId, animName, char);
  };

  build(props.char, props.animName, props.draftOverride);

  return {
    element: wrapper,
    update: (char, animName, draftOverride) =>
      build(char, animName, draftOverride),
    setScene: (draftSceneId, animName) => {
      currentDraftSceneId = draftSceneId;
      // Backdrop-only: do NOT rebuild the sprite box (a picker change must not
      // restart the loop). The crossfade fires when the resolved key differs.
      const char = manifest.characters[currentCharKey];
      if (char) repaintScene(draftSceneId, animName, char);
    },
    pose: () => currentPose,
    hasSprite: () => currentHasSprite,
    sceneKey: () => currentSceneKey ?? "",
    dispose: () => {
      handle?.dispose();
      handle = null;
    },
  };
}
