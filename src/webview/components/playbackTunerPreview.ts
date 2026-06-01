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
import type { SpriteCharacter } from "../sprites/spriteManifest.js";
import {
  createSpriteBox,
  type PlaybackOverride,
  type SpriteBoxHandle,
} from "../sprites/spritePlayer.js";
import { ACTIVE_READ } from "../sprites/posePicker.js";

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
  /** The current draft override (the live slider/dropdown values). */
  draftOverride: PlaybackOverride;
  /** Timer scheduler injection (tests — deterministic stepping). */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Timer canceller injection (tests). */
  cancelFrame?: (handle: number) => void;
  /** RNG injection (tests). Unused for forced poses but threaded for parity. */
  rng?: () => number;
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
  /** The canonical pose name the current box is playing (for tests / a11y). */
  pose(): string;
  /** Whether the current box rendered a sprite (false when no frames / no base). */
  hasSprite(): boolean;
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
  const { spriteBaseUri, scheduleFrame, cancelFrame, rng } = props;

  const wrapper = document.createElement("div");
  wrapper.className = "ct-tuner-preview-box";

  let handle: SpriteBoxHandle | null = null;
  let currentPose = "";
  let currentHasSprite = false;

  const build = (
    char: SpriteCharacter,
    animName: string,
    draftOverride: PlaybackOverride,
  ): void => {
    // Dispose the running box first (§5.1 step 1) — stops its timer.
    handle?.dispose();
    wrapper.replaceChildren();

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
    });
    currentPose = handle.pose;
    // A sprite "rendered" when the box resolved frames — the engine stamps
    // `box.dataset.pose` only AFTER the no-frames defensive early-return, so its
    // presence is the reliable has-frames signal (spritePlayer.ts:380).
    currentHasSprite = handle.element.dataset.pose !== undefined;
    wrapper.appendChild(handle.element);
  };

  build(props.char, props.animName, props.draftOverride);

  return {
    element: wrapper,
    update: (char, animName, draftOverride) =>
      build(char, animName, draftOverride),
    pose: () => currentPose,
    hasSprite: () => currentHasSprite,
    dispose: () => {
      handle?.dispose();
      handle = null;
    },
  };
}
