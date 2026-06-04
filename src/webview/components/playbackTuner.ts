/**
 * playbackTuner — the live Playback Tuner panel (E5 86ca2189v, built to Iris's
 * E4 spec `team/iris-design/anim-tuner-spec.md`).
 *
 * A power-user dev aid (solo-user / experimental) that lets the sponsor tune the
 * three playback fields — `speedMultiplier`, `finalDwellMs`, `playbackMode`
 * (LOCKED vocabulary) — for one (character, animation) at a time, with a LIVE
 * in-memory preview and an auto-save to the correct json file.
 *
 * ## The two paths (E4 spec §1 — the sponsor must understand BOTH)
 *
 *  - **Live preview** (webview-local, instant): every control change rebuilds the
 *    preview `createSpriteBox` with the draft injected as a `playbackTable` —
 *    zero rebuild, zero host round-trip (`playbackTunerPreview.ts`).
 *  - **Persistence** (webview→host json write, takes effect after next rebuild):
 *    a debounced `ui:save-playback-override` writes the json. The dashboard tiles
 *    do NOT change until `npm run build` + reload — the persistence banner (§3.6)
 *    says so explicitly so the sponsor never thinks "I saved but nothing changed
 *    → it's broken."
 *
 * ## Placement (E4 spec §2 — DECIDED 2026-06-01): on-demand panel mirroring
 * Manage Team. Opened by the `claudeteam.openPlaybackTuner` command (title-bar
 * button + Command Palette → `tuner:open-playback-tuner` → webview-local
 * `tunerPanelOpen` flag → this panel replaces the dashboard root).
 *
 * ## Debounce (E4 spec §6): ~120ms preview (cheap dispose+rebuild while
 * dragging) / ~500ms trailing save (one json write per settled value, not per
 * slider pixel). Both webview-local timers — jsdom-testable under fake timers.
 *
 * ## Field-omission == clear (E4 spec §4.1): `draftOverride` carries ONLY fields
 * the sponsor SET away from inherited/default; `[reset]` deletes a field so it
 * inherits again. The save payload's `override` is exactly that draft, and the
 * host removes any field absent from the payload.
 *
 * Theme-aware (E4 spec §8 — `--vscode-*` / `--ct-*` tokens only). A11y (§9):
 * every control has a visible label + aria; Escape closes the panel.
 *
 * Source: team/iris-design/anim-tuner-spec.md (the build contract).
 */

import type { WebviewMessage } from "../../shared/messages.js";
import type { PlaybackMode, PlaybackOverride } from "../sprites/spritePlayer.js";
import {
  DWELL_MS_DEFAULT,
  PEAK_DWELL_MS_DEFAULT,
} from "../sprites/spritePlayer.js";
import type { GeneratedSpriteManifest } from "../sprites/spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "../sprites/generatedManifest.js";
import type { TunerStateTracker } from "../tunerStateTracker.js";
import type { LiveManifestOverlay } from "../liveManifestOverlay.js";
import { createPreviewController } from "./playbackTunerPreview.js";
import {
  computeCascadeSource,
  APEX_FRAME_NONE,
  type CascadeLayer,
  type CascadeSourceTable,
  type FieldSource,
  type FieldValue,
} from "../sprites/cascadeSource.js";

/** Debounce windows (E4 spec §6). Overridable for tests. */
export const PREVIEW_DEBOUNCE_MS = 120;
export const SAVE_DEBOUNCE_MS = 500;

/** Slider bounds (E4 spec §3.2 / §3.3). */
const SPEED_MIN = 0.25;
// Raised 2.0 → 5.0 (86ca2vpj7): the sponsor wants to dial playback past 2× for
// fast-forward review of long idle loops. The engine applies the multiplier as
// `FRAME_MS_DEFAULT / speedMultiplier` with only a `> 0` guard (spritePlayer.ts
// resolveCharSprite), so 5× = 5× faster per-frame, no upper clamp / NaN. Step
// stays 0.05 — 95 stops across 0.25..5.0 keeps fine granularity near 1×.
const SPEED_MAX = 5.0;
const SPEED_STEP = 0.05;
const HOLD_MIN = 0;
// Raised 2000 → 10000 (86ca2apxn #4): the cup-down / apex holds the sponsor
// tunes can want a multi-second beat (F01 idle_coffee shipped finalDwellMs 2000
// already, and the sponsor wanted to push it higher); a 2000 ceiling clamped
// the control below the values they were trying to dial in.
const HOLD_MAX = 10000;
const HOLD_STEP = 50;
// Apex hold (86ca2bqe1). The ms slider mirrors Hold (final)'s 0..10000 range so
// the sponsor can dial a multi-second apex beat (e.g. cup-at-mouth "drinking").
const APEX_MS_MIN = 0;
const APEX_MS_MAX = 10000;
const APEX_MS_STEP = 50;
/** Picker sentinel value for "no apex hold" (clears dwellFrameIndex). */
const APEX_FRAME_OFF = "";

// Engine-default field values (mirror cascadeSource.ts ENGINE_DEFAULTS) — used
// to seed the controls for the pose-default write target, which skips per-char
// (BUG 1 86ca2uytw).
const ENGINE_DEFAULT_SPEED = 1;
const ENGINE_DEFAULT_FINAL_DWELL_MS = DWELL_MS_DEFAULT;
const ENGINE_DEFAULT_DWELL_MS = PEAK_DWELL_MS_DEFAULT;

export interface PlaybackTunerProps {
  /** The baked manifest (default GENERATED_SPRITE_MANIFEST). Tests inject. */
  manifest?: GeneratedSpriteManifest;
  /** Host-injected sprite base URI. Absent → preview renders no frames. */
  spriteBaseUri?: string;
  /**
   * Active-pool rotation cadence (ticket 86ca4atwt §B.2) — loops-per-pose the
   * Cycle toggle uses to auto-advance over the room, REUSING Feature A's cadence so
   * the tuner previews EXACTLY what the dashboard will ship. Resolved by the boot
   * closure from `claudeteam.activePoolLoopsPerPose` (default 2). Absent → 1.
   */
  loopsPerActivePose?: number;
  /** Webview → host dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
  /** Called when the user closes the panel (Escape / ✕). */
  onClose?: () => void;
  /**
   * The most recent host save ack, threaded by main.ts (mirrors the Manage Team
   * `pendingBanner` survival pattern). `null` → neutral idle banner.
   */
  saveAck?: { ok: boolean; error?: string } | null;
  /**
   * BLOCKER B1 (86ca2189v) — webview-local editing-state tracker. The panel's
   * live state (selectedChar / selectedAnim / draftOverride / writeTarget) is
   * SEEDED from this tracker on mount and WRITTEN BACK on every change, so it
   * survives the ~2s poll-tick `renderFull` that root-swaps a fresh tuner.
   * Owned by the boot closure in main.ts. Optional — absent in component tests
   * that mount once (the panel starts at its first-char defaults).
   */
  stateTracker?: TunerStateTracker;
  /**
   * 86ca2wrnq — webview-local store of CONFIRMED in-session saves, overlaid onto
   * the baked `manifest` so the tuner's re-seed (character switch, animation
   * switch, close+reopen) reflects in-session saves WITHOUT a rebuild. The baked
   * manifest is a build-time snapshot the host never updates in-memory on save;
   * this overlay mirrors each confirmed write so a re-seed reads the latest
   * authoritative override, not the stale load-time value. Owned by the boot
   * closure (survives panel close+reopen within a webview boot). Optional —
   * absent in component tests that mount once without a save round-trip.
   */
  liveOverlay?: LiveManifestOverlay;
  /** Debounce timer scheduler (tests). Defaults to window.setTimeout. */
  schedule?: (cb: () => void, ms: number) => number;
  /** Debounce timer canceller (tests). Defaults to window.clearTimeout. */
  cancelTimer?: (handle: number) => void;
  /** Sprite-box frame scheduler injection (tests) — threaded to the preview. */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Sprite-box frame canceller injection (tests). */
  cancelFrame?: (handle: number) => void;
}

/**
 * BLOCKER B2 (86ca2e697) — imperative handle for the LIVE (already-mounted)
 * tuner panel. `renderFull` looks the open panel's root up in this map on a poll
 * tick and, instead of REBUILDING the panel DOM (which tears down any open
 * native `<select>` popup + focus + in-progress interaction — the dropdown that
 * "disappears before I can select anything"), it leaves the panel intact and
 * just pushes the latest save-ack into the banner in-place via `applySaveAck`.
 *
 * Keyed by the root element via a WeakMap so the handle is GC'd with the panel
 * (no DOM-attribute pollution, no leak across panel closes/reopens).
 */
export interface TunerPanelHandle {
  /** Update the persistence banner from a fresh save ack WITHOUT a rebuild. */
  applySaveAck(ack: { ok: boolean; error?: string } | null): void;
}

const PANEL_HANDLES = new WeakMap<HTMLElement, TunerPanelHandle>();

/**
 * Look up the imperative handle for an already-mounted tuner panel root. Returns
 * `undefined` for any element that isn't a live tuner panel (e.g. a stale node).
 * `renderFull` uses this to decide rebuild-vs-update-in-place.
 */
export function getTunerPanelHandle(
  el: HTMLElement | null | undefined,
): TunerPanelHandle | undefined {
  return el ? PANEL_HANDLES.get(el) : undefined;
}

/** Human label for a cascade layer (the source-tag chip text). */
function layerLabel(layer: CascadeLayer): string {
  switch (layer) {
    case "per-char":
      return "per-char";
    case "pose-default":
      return "pose-default";
    case "engine default":
      return "engine default";
  }
}

/**
 * Build the Playback Tuner panel. Returns the root element. The panel owns all
 * its state in this closure (webview-local) — char/anim selection, the draft
 * override, and the two debounce timers.
 */
export function renderPlaybackTuner(props: PlaybackTunerProps): HTMLElement {
  const {
    manifest: bakedManifest = GENERATED_SPRITE_MANIFEST,
    spriteBaseUri,
    loopsPerActivePose,
    postMessage,
    onClose,
    saveAck: initialSaveAck = null,
    stateTracker,
    liveOverlay,
    schedule = (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
    cancelTimer = (h) => window.clearTimeout(h),
    scheduleFrame,
    cancelFrame,
  } = props;

  // 86ca2wrnq: the EFFECTIVE manifest the panel reads for ALL seed / cascade /
  // window computations = the baked manifest with in-session saves overlaid. The
  // baked snapshot is frozen in the bundle and never updated on save, so without
  // the overlay a re-seed (char/anim switch, reopen) reads the stale load-time
  // value. Recomputed via `refreshManifest()` after every confirmed save so a
  // subsequent re-seed reads the just-written override. No overlay (component
  // tests) → equals the baked manifest unchanged.
  let manifest: GeneratedSpriteManifest = liveOverlay
    ? liveOverlay.apply(bakedManifest)
    : bakedManifest;
  function refreshManifest(): void {
    manifest = liveOverlay ? liveOverlay.apply(bakedManifest) : bakedManifest;
  }
  // The override most recently EMITTED (debounced save fired) but not yet
  // confirmed. On an ok-ack we commit it into the live overlay so subsequent
  // re-seeds read it; an error ack discards it (the overlay never diverges from
  // disk). Carries the full save coordinates so the overlay key matches the host.
  let pendingSave: {
    writeTarget: "per-char" | "pose-default";
    characterFolder?: string;
    animName: string;
    override: PlaybackOverride;
  } | null = null;

  // B2 (86ca2e697): the latest save ack is now MUTABLE — `applySaveAck` (the
  // imperative handle below) updates it in-place so the banner reflects a fresh
  // ack WITHOUT the panel being rebuilt (a rebuild would close any open select).
  let saveAck = initialSaveAck;
  // BUG 2 (86ca2uytw — stale-ack re-stamp). The boot closure owns `tunerSaveAck`
  // and re-pushes it through `applySaveAck` on every ~2s poll tick (#167's
  // skip-rebuild path). After a SUCCESSFUL save, a user selection / write-target
  // change moves the banner's (selectedChar, writeTarget) — so the next poll
  // tick's re-push would re-stamp "Saved to <NEW file>" for a file that was
  // never saved. `ackDismissed` latches true on any user selection / target
  // change while a success ack is showing; while latched, `applySaveAck`
  // suppresses an incoming success ack (renders neutral) instead of re-stamping
  // the new file. The panel UN-latches the moment it emits a fresh save
  // (`emitSave`), so the ack for that genuine new save is shown normally.
  let ackDismissed = false;
  // BUG 2 (86ca2uytw): the panel's INITIAL render calls onSelectionChange /
  // renderForRestoredDraft to paint first-state — those must NOT dismiss the
  // build-time ack (a fresh-build-with-ack entry is legitimate, FIX 2 86ca2fvv9).
  // Only USER-driven selection / target changes (the event listeners, fired
  // after construction) dismiss. This latches false once init completes.
  let initializing = true;

  /**
   * BUG 2 (86ca2uytw). A user-driven selection / write-target change means the
   * current success ack no longer describes what the banner now points at —
   * latch it dismissed so a poll-tick re-push of that ack does not re-stamp the
   * new file. A subsequent real save un-latches via `emitSave`. No-op during the
   * panel's initial construction (a build-time ack is legitimate).
   */
  function dismissCurrentAck(): void {
    if (initializing) return;
    if (saveAck?.ok === true) {
      ackDismissed = true;
    }
    saveAck = null;
  }

  const root = document.createElement("section");
  root.className = "ct-tuner-panel";
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Playback Tuner");

  // ── Header (mirrors Manage Team) ──────────────────────────────────────────
  const header = document.createElement("header");
  header.className = "ct-tuner-header";
  const title = document.createElement("h1");
  title.className = "ct-tuner-title";
  title.textContent = "Playback Tuner";
  header.appendChild(title);
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "ct-tuner-close";
  closeBtn.setAttribute("aria-label", "Close Playback Tuner");
  closeBtn.title = "Close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => close());
  header.appendChild(closeBtn);
  root.appendChild(header);

  // ── Empty-state defense (§7): no bundled characters ───────────────────────
  const charKeys = Object.keys(manifest.characters);
  if (charKeys.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ct-tuner-empty";
    empty.textContent = "No sprite characters available to tune.";
    root.appendChild(empty);
    root.addEventListener("keydown", onEscapeClose);
    // B2 (86ca2e697): register a no-op handle so the skip-rebuild logic in
    // `renderFull` treats the empty-state panel uniformly (nothing to update —
    // there are no controls — but the panel is still "live" + must not flicker).
    PANEL_HANDLES.set(root, { applySaveAck: () => undefined });
    return root;
  }

  // ── Selection state ───────────────────────────────────────────────────────
  // B1 (86ca2189v): seed from the persisted tracker so the panel survives the
  // ~2s poll-tick `renderFull` that root-swaps a fresh tuner. A persisted entry
  // is validated against the live manifest (a char/anim that no longer exists
  // falls back to defaults). Absent tracker / no persisted state → first-char
  // defaults, exactly as before.
  const persisted = stateTracker?.get() ?? null;
  const persistedValid =
    persisted !== null &&
    Object.prototype.hasOwnProperty.call(
      manifest.characters,
      persisted.selectedChar,
    );
  let selectedChar = persistedValid ? persisted!.selectedChar : charKeys[0];
  let selectedAnim = "";
  // Draft override — ONLY the SET fields (field-omission == clear, §4.1).
  let draftOverride: PlaybackOverride = persistedValid
    ? { ...persisted!.draftOverride }
    : {};
  // Write target (§3.7) — default "per-char" (narrower, safer scope).
  let writeTarget: "per-char" | "pose-default" = persistedValid
    ? persisted!.writeTarget
    : "per-char";

  // Debounce handles.
  let previewTimer: number | null = null;
  let saveTimer: number | null = null;

  // Active-pool rotation cadence (ticket 86ca4atwt §B.2 / B.4) — the Cycle toggle
  // REUSES Feature A's cadence so the tuner previews EXACTLY the dashboard rotation.
  // Mirrors the engine cascade (spritePlayer.ts): per-character
  // `char.activePoolLoopsPerPose` (layer 1) wins over the threaded
  // `loopsPerActivePose` config (layer 2), clamped >= 1 (layer 3). Resolved per
  // call since `selectedChar` changes as the sponsor switches characters.
  function cycleCadence(): number {
    const perChar = manifest.characters[selectedChar]?.activePoolLoopsPerPose;
    const raw =
      typeof perChar === "number" && Number.isFinite(perChar) && perChar > 0
        ? perChar
        : loopsPerActivePose;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? Math.trunc(raw)
      : 1;
  }
  // Cycle (auto-advance over the room) state — webview-local, ephemeral; drives
  // `selectedAnim` forward on loop-completion. Default OFF (sponsor gate 3). The
  // counter mirrors Feature A's wrap-count on the preview box.
  let cycleOn = false;
  let cycleLoopCount = 0;

  // ── Selectors (§3.1) ──────────────────────────────────────────────────────
  const selectorsRow = document.createElement("div");
  selectorsRow.className = "ct-tuner-selectors";

  const charSelect = document.createElement("select");
  charSelect.className = "ct-tuner-select ct-tuner-char-select";
  charSelect.setAttribute("aria-label", "Character");
  for (const key of charKeys) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    charSelect.appendChild(opt);
  }
  // B1: reflect the (possibly restored) selectedChar in the <select>.
  charSelect.value = selectedChar;
  const charField = labeledField("Character", charSelect);
  selectorsRow.appendChild(charField);

  const animSelect = document.createElement("select");
  animSelect.className = "ct-tuner-select ct-tuner-anim-select";
  animSelect.setAttribute("aria-label", "Animation");
  const animField = labeledField("Animation", animSelect);
  selectorsRow.appendChild(animField);

  root.appendChild(selectorsRow);

  // ── Step / Cycle control (ticket 86ca4atwt §B.2) ──────────────────────────
  // A NEW row DIRECTLY BELOW the selectors and ABOVE the preview, so the sponsor
  // reads top-to-bottom: pick char/anim → step through poses → watch over the room
  // → tune. It drives the SAME `selectedAnim` the Animation dropdown drives (step
  // + dropdown stay in sync), so it needs no new tracker field — it only
  // reads/writes the already-persisted `selectedAnim` (§B.2 placement note).
  const stepRow = document.createElement("div");
  stepRow.className = "ct-tuner-step";

  // Step source: which anim list Prev/Next walk. Default = the selected
  // character's `activePool` (review the WORK poses — the feature's point); the
  // "All animations" option walks every entry in the anim dropdown.
  const stepSourceSelect = document.createElement("select");
  stepSourceSelect.className = "ct-tuner-select ct-tuner-step-source";
  stepSourceSelect.setAttribute("aria-label", "Step source");
  for (const opt of [
    { value: "active-pool", label: "Active pool" },
    { value: "all", label: "All animations" },
  ]) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    stepSourceSelect.appendChild(o);
  }
  const stepSourceField = labeledField("Source", stepSourceSelect);
  stepRow.appendChild(stepSourceField);

  const stepPrevBtn = document.createElement("button");
  stepPrevBtn.type = "button";
  stepPrevBtn.className = "ct-tuner-step-prev";
  stepPrevBtn.textContent = "◄ Prev";
  stepPrevBtn.setAttribute("aria-label", "Previous pose");
  stepPrevBtn.addEventListener("click", () => onStep(-1));
  stepRow.appendChild(stepPrevBtn);

  const stepNextBtn = document.createElement("button");
  stepNextBtn.type = "button";
  stepNextBtn.className = "ct-tuner-step-next";
  stepNextBtn.textContent = "Next ►";
  stepNextBtn.setAttribute("aria-label", "Next pose");
  stepNextBtn.addEventListener("click", () => onStep(1));
  stepRow.appendChild(stepNextBtn);

  const stepReadout = document.createElement("span");
  stepReadout.className = "ct-tuner-step-readout";
  stepReadout.setAttribute("role", "status");
  stepRow.appendChild(stepReadout);

  const cycleLabel = document.createElement("label");
  cycleLabel.className = "ct-tuner-step-cycle-label";
  const cycleCheckbox = document.createElement("input");
  cycleCheckbox.type = "checkbox";
  cycleCheckbox.className = "ct-tuner-step-cycle";
  cycleCheckbox.checked = false; // sponsor gate 3: default OFF
  cycleCheckbox.setAttribute("aria-label", "Cycle over room");
  cycleCheckbox.addEventListener("change", () => onCycleToggle());
  const cycleText = document.createElement("span");
  cycleText.textContent = "Cycle over room";
  cycleLabel.appendChild(cycleCheckbox);
  cycleLabel.appendChild(cycleText);
  stepRow.appendChild(cycleLabel);

  stepSourceSelect.addEventListener("change", () => {
    // Switching the source re-derives the readout against the new list; the
    // current `selectedAnim` may not be in it → the readout shows its position
    // when present, else "1 / N" semantics fall out of stepList()/stepIndex().
    refreshStepReadout();
  });

  root.appendChild(stepRow);

  // ── Preview + cascade source table (§3.5) ─────────────────────────────────
  const previewRow = document.createElement("div");
  previewRow.className = "ct-tuner-preview-row";

  // Preview controller is (re)created when the char/anim changes. Held here.
  const previewHost = document.createElement("div");
  previewHost.className = "ct-tuner-preview-host";
  previewRow.appendChild(previewHost);
  let preview: ReturnType<typeof createPreviewController> | null = null;

  const previewNote = document.createElement("p");
  previewNote.className = "ct-tuner-preview-note";
  previewNote.hidden = true;
  previewRow.appendChild(previewNote);

  const sourceTable = document.createElement("dl");
  sourceTable.className = "ct-tuner-source-table";
  sourceTable.setAttribute("aria-label", "Effective playback values and source");
  previewRow.appendChild(sourceTable);

  root.appendChild(previewRow);

  // ── Window (86ca2wj6u) ────────────────────────────────────────────────────
  // Placed FIRST (before Controls, spec §2): the window is STRUCTURAL — it
  // defines WHICH frames exist for this loop — while Speed/Hold/Mode tune HOW
  // those frames play. Window-first makes the apex↔window coupling read
  // top-to-bottom (set the window, THEN the Hold (apex) picker below offers only
  // in-window frames). The control writes draftOverride.startFrame/endFrame; the
  // existing previewOverride() + populateApexFrames() already consume them.
  root.appendChild(sectionDivider("Window"));
  const windowSlider = buildWindowSlider({
    onChange: (start, end, isDrag) => onWindowChange(start, end, isDrag),
    onReset: () => onWindowReset(),
  });
  root.appendChild(windowSlider.element);
  // §3 coupling helper — pre-explains why the apex picker shrinks when a window
  // narrower than the full clip is active. Visibility tracks windowIsDeclared().
  const windowCouplingHelp = document.createElement("p");
  windowCouplingHelp.className = "ct-tuner-help ct-tuner-window-coupling";
  windowCouplingHelp.textContent =
    "The Hold (apex) frame picker below offers only frames in this window.";
  windowCouplingHelp.hidden = true;
  root.appendChild(windowCouplingHelp);

  // Out-of-window apex note (spec §4.4) — quiet, one-shot per clear.
  const windowApexNote = document.createElement("p");
  windowApexNote.className = "ct-tuner-help ct-tuner-window-apex-note";
  windowApexNote.hidden = true;
  root.appendChild(windowApexNote);

  // ── Controls (§3.2-§3.4) ──────────────────────────────────────────────────
  const controlsDivider = sectionDivider("Controls");
  root.appendChild(controlsDivider);

  // Speed slider → speedMultiplier.
  const speed = buildSlider({
    cls: "ct-tuner-speed",
    label: "Speed",
    min: SPEED_MIN,
    max: SPEED_MAX,
    step: SPEED_STEP,
    format: (v) => `${v.toFixed(2)}×`,
    ariaText: (v) => `${v.toFixed(2)} times`,
    minLabel: "0.25×",
    maxLabel: "5.0×",
    onInput: (v) => {
      draftOverride = { ...draftOverride, speedMultiplier: round2(v) };
      onControlChange(true);
    },
    onReset: () => {
      draftOverride = omitField(draftOverride, "speedMultiplier");
      reseedSpeedFromCascade();
      onControlChange(false);
    },
  });
  root.appendChild(speed.element);

  // Hold slider → finalDwellMs.
  const hold = buildSlider({
    cls: "ct-tuner-hold",
    label: "Hold (final)",
    min: HOLD_MIN,
    max: HOLD_MAX,
    step: HOLD_STEP,
    format: (v) => `${Math.round(v)} ms`,
    ariaText: (v) => `${Math.round(v)} milliseconds`,
    minLabel: "0 ms",
    maxLabel: "10000 ms",
    onInput: (v) => {
      draftOverride = { ...draftOverride, finalDwellMs: Math.round(v) };
      onControlChange(true);
    },
    onReset: () => {
      draftOverride = omitField(draftOverride, "finalDwellMs");
      reseedHoldFromCascade();
      onControlChange(false);
    },
  });
  root.appendChild(hold.element);
  // §3.3 helper: finalDwellMs is idle-only + (in pingpong) forward-end only.
  const holdHelp = document.createElement("p");
  holdHelp.className = "ct-tuner-help";
  holdHelp.textContent =
    "Final-frame hold applies to idle poses; in pingpong it fires only on the forward arrival at the window end.";
  root.appendChild(holdHelp);

  // ── Hold (apex) control group (86ca2bqe1) ─────────────────────────────────
  // A mid-sequence dwell: pause on ONE chosen frame (the gesture apex — e.g. the
  // cup at the lips) for a set ms. Writes the engine's EXISTING `dwellFrameIndex`
  // + `dwellMs` fields (NO engine change — spritePlayer.ts already applies them).
  // The frame-index PICKER is bounded to the live anim's frame count + repopulated
  // on every (char, anim) change; the ms SLIDER mirrors Hold (final)'s 0..10000.
  const apexGroup = document.createElement("div");
  apexGroup.className = "ct-tuner-control ct-tuner-apex";

  const apexLabelRow = document.createElement("div");
  apexLabelRow.className = "ct-tuner-control-labelrow";
  const apexCaption = document.createElement("span");
  apexCaption.className = "ct-tuner-control-caption";
  apexCaption.textContent = "Hold (apex)";
  apexLabelRow.appendChild(apexCaption);
  const apexResetBtn = document.createElement("button");
  apexResetBtn.type = "button";
  apexResetBtn.className = "ct-tuner-reset ct-tuner-apex-reset";
  apexResetBtn.textContent = "reset";
  apexResetBtn.setAttribute("aria-label", "Reset Hold (apex)");
  apexResetBtn.addEventListener("click", () => onApexReset());
  apexLabelRow.appendChild(apexResetBtn);
  apexGroup.appendChild(apexLabelRow);

  // Frame-index picker (bounded to the anim's frame count; "Off" clears it).
  const apexFrameSelect = document.createElement("select");
  apexFrameSelect.className = "ct-tuner-select ct-tuner-apex-frame";
  apexFrameSelect.setAttribute("aria-label", "Apex hold frame");
  const apexFrameField = labeledField("Frame", apexFrameSelect);
  apexFrameField.classList.add("ct-tuner-apex-frame-field");
  apexGroup.appendChild(apexFrameField);
  apexFrameSelect.addEventListener("change", () => onApexFrameChange());

  root.appendChild(apexGroup);

  // Apex ms slider → dwellMs (only meaningful once a frame is picked).
  const apexMs = buildSlider({
    cls: "ct-tuner-apex-ms",
    label: "Apex hold",
    min: APEX_MS_MIN,
    max: APEX_MS_MAX,
    step: APEX_MS_STEP,
    format: (v) => `${Math.round(v)} ms`,
    ariaText: (v) => `${Math.round(v)} milliseconds`,
    minLabel: "0 ms",
    maxLabel: "10000 ms",
    onInput: (v) => {
      draftOverride = { ...draftOverride, dwellMs: Math.round(v) };
      onControlChange(true);
    },
    onReset: () => {
      draftOverride = omitField(draftOverride, "dwellMs");
      reseedApexMsFromCascade();
      onControlChange(false);
    },
  });
  apexGroup.appendChild(apexMs.element);

  const apexHelp = document.createElement("p");
  apexHelp.className = "ct-tuner-help";
  apexHelp.textContent =
    "Pick the apex frame (the gesture's peak — e.g. cup at the lips) to hold it longer mid-loop. Off = no apex hold.";
  root.appendChild(apexHelp);

  // Mode radio → playbackMode.
  const mode = buildModeControl((m) => {
    if (m === "loop") {
      // §3.4: clearing keeps the saved json minimal (absent == loop).
      draftOverride = omitField(draftOverride, "playbackMode");
    } else {
      draftOverride = { ...draftOverride, playbackMode: m };
    }
    onControlChange(false);
  });
  root.appendChild(mode.element);

  // ── Write target (§3.7) ───────────────────────────────────────────────────
  root.appendChild(sectionDivider("Write target"));
  const writeTargetCtl = buildWriteTargetControl(writeTarget, (t) => {
    writeTarget = t;
    // BUG 1 (86ca2uytw — data-loss). FIX 1 (86ca2fvv9) re-seeds `draftOverride`
    // from the new target's saved block (field-omission == clear applies PER
    // FILE), but it did NOT repaint the controls / preview / summary the way
    // onSelectionChange does. Result: the sliders + apex picker + mode kept
    // SHOWING the old per-char values while the draft no longer carried them, so
    // the next single edit saved the (invisible) re-seeded draft and silently
    // dropped every value still on screen. Route the write-target flip through
    // the SAME reseed+repaint helper onSelectionChange uses so the two paths
    // can't diverge again — the controls always reflect the live draft.
    reseedDraftAndRepaint();
    // BUG 2 (86ca2uytw): a target flip moves the banner's filename; dismiss any
    // still-truthy success ack so a poll-tick re-push doesn't re-stamp it.
    dismissCurrentAck();
    renderBanner();
    // Changing the target alone does not change the draft's net effect on disk;
    // no auto-save until a value changes. (A target flip with no field set has
    // nothing to persist.) B1: but it DOES change survivable UI state — mirror it
    // into the tracker so the choice (and the banner filename) survive the next
    // poll tick.
    persist();
  });
  root.appendChild(writeTargetCtl.element);

  // Shadowing warning (§3.7) — flex + [hidden]-toggled → MANDATORY [hidden] guard.
  const shadowWarn = document.createElement("p");
  shadowWarn.className = "ct-tuner-shadow-warning";
  shadowWarn.setAttribute("role", "alert");
  shadowWarn.hidden = true;
  root.appendChild(shadowWarn);

  // ── Persistence banner (§3.6 — the honesty surface) ───────────────────────
  const banner = document.createElement("div");
  banner.className = "ct-tuner-banner";
  banner.setAttribute("role", "status");
  root.appendChild(banner);

  // ── Wiring ────────────────────────────────────────────────────────────────
  charSelect.addEventListener("change", () => {
    selectedChar = charSelect.value;
    populateAnims();
    onSelectionChange();
  });
  animSelect.addEventListener("change", () => {
    selectedAnim = animSelect.value;
    onSelectionChange();
  });

  root.addEventListener("keydown", onEscapeClose);

  // Initial population + render.
  // B1: when restoring from a persisted session, populate the anim list for the
  // restored char + prefer the restored anim, then render the panel reflecting
  // the restored DRAFT (do NOT wipe it as a user-driven selection change would).
  // Fresh open → default-idle selection + empty draft, exactly as before.
  if (persistedValid) {
    populateAnims(persisted!.selectedAnim);
    renderForRestoredDraft();
  } else {
    populateAnims();
    onSelectionChange();
  }
  renderBanner();
  // FIX 2 (86ca2fvv9): if the panel is BUILT with a successful ack already in
  // hand (the rare fresh-build-with-ack entry — production normally routes the
  // ack through the in-place `applySaveAck` handle below), reflect the saved
  // draft in the summary row too, so both entry paths agree.
  if (saveAck?.ok === true) {
    renderSourceTable(computeSourceReflectingSavedDraft());
  }
  // Capture the (seeded or restored) state so the very first poll tick after a
  // fresh open still has something to restore from.
  persist();
  // BUG 2 (86ca2uytw): construction done — subsequent selection / target changes
  // are USER-driven and DO dismiss a stale success ack.
  initializing = false;

  // B2 (86ca2e697): register the imperative handle so `renderFull` can refresh
  // the banner on a poll tick WITHOUT rebuilding (and tearing down) this panel.
  // FIX 2 (86ca2fvv9): a SUCCESSFUL save-ack also refreshes the summary/source
  // row in-place to reflect the just-saved draft — done via THIS imperative
  // handle (NOT a panel rebuild), because #167 made `renderFull` skip rebuilding
  // the open panel on poll ticks (rebuilding would tear down an open dropdown).
  PANEL_HANDLES.set(root, {
    applySaveAck(ack) {
      // 86ca2wrnq: a CONFIRMED write means the on-disk file now carries the
      // emitted override — mirror it into the live overlay so a subsequent
      // re-seed (char/anim switch, reopen) reads it, not the stale baked value.
      // Commit BEFORE the dismiss-suppression branch below so the overlay updates
      // even when the banner is suppressed (the file was still written). An
      // error/idle ack discards the pending save so the overlay never diverges
      // from disk. Recompute `manifest` so any seed after this point sees it.
      if (ack?.ok === true && pendingSave !== null && liveOverlay) {
        liveOverlay.record(pendingSave);
        refreshManifest();
      }
      // The ack resolves the in-flight save either way — drop the pending copy so
      // a later poll-tick re-push of the same ack can't double-record it.
      pendingSave = null;
      // BUG 2 (86ca2uytw): while a user selection / write-target change has
      // dismissed the prior success ack, suppress an incoming success ack — it
      // no longer describes the file the banner now points at, so re-stamping
      // "Saved to <new file>" would lie. A genuine NEW save un-latches
      // `ackDismissed` in `emitSave` before its ack returns, so real saves show.
      if (ackDismissed && ack?.ok === true) {
        saveAck = null;
        renderBanner();
        return;
      }
      saveAck = ack;
      renderBanner();
      // Only a confirmed write updates the summary — an error/idle ack leaves
      // the row reflecting the baked manifest (nothing was persisted).
      if (ack?.ok === true) {
        renderSourceTable(computeSourceReflectingSavedDraft());
      }
    },
  });

  return root;

  // ===========================================================================
  // Behavior
  // ===========================================================================

  /**
   * Repopulate the animation <select> for the selected character (§3.1).
   * `preferAnim` (B1 restore) — when supplied AND present in the char's anim
   * set, select it instead of the default-idle; otherwise fall back to the
   * default-idle / first-anim heuristic.
   */
  function populateAnims(preferAnim?: string): void {
    const char = manifest.characters[selectedChar];
    const animNames = char ? Object.keys(char.animations) : [];
    animSelect.replaceChildren();
    for (const name of animNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      animSelect.appendChild(opt);
    }
    // B1 restore: honor a persisted anim if it still exists. Else default =
    // defaultIdle if present in the set, else first anim.
    const preferred =
      preferAnim && animNames.includes(preferAnim)
        ? preferAnim
        : char?.defaultIdle && animNames.includes(char.defaultIdle)
          ? char.defaultIdle
          : animNames[0] ?? "";
    selectedAnim = preferred;
    animSelect.value = preferred;
  }

  // ── Step / Cycle control (ticket 86ca4atwt §B.2) ──────────────────────────

  /**
   * The ordered anim-name list the step control walks for the current source.
   *   - "active-pool" → the selected character's `activePool` (the WORK poses).
   *   - "all"         → every entry in the Animation dropdown (idle + active).
   * Empty when the character has no active pool (the disabled-state below).
   */
  function stepList(): string[] {
    const char = manifest.characters[selectedChar];
    if (!char) return [];
    if (stepSourceSelect.value === "all") {
      return Object.keys(char.animations);
    }
    // `activePool` may be absent on older / minimal manifests (component-test
    // fixtures predating the active-pool field) — default to empty.
    return [...(char.activePool ?? [])];
  }

  /** Index of `selectedAnim` in the current step list, or -1 when absent. */
  function stepIndex(list: string[]): number {
    return list.indexOf(selectedAnim);
  }

  /**
   * Prev/Next moved the step cursor by `dir` (wrap % N). Moves `selectedAnim` to
   * the next/previous entry in the step source, reflects it in the Animation
   * dropdown's `.value`, and fires the SAME `onSelectionChange()` path the dropdown
   * fires — so step + dropdown stay in sync. No-op when the source is empty.
   */
  function onStep(dir: 1 | -1): void {
    const list = stepList();
    if (list.length === 0) return;
    const cur = stepIndex(list);
    // When the current anim isn't in the list (e.g. an idle anim while source is
    // "active-pool"), start from the first member on a forward step.
    const next =
      cur === -1
        ? dir === 1
          ? 0
          : list.length - 1
        : (cur + dir + list.length) % list.length;
    selectedAnim = list[next];
    animSelect.value = selectedAnim;
    // Stepping resets the cycle loop-count so the new pose gets a full cadence.
    cycleLoopCount = 0;
    onSelectionChange();
  }

  /**
   * Render the step readout — `"<animName> — <i+1> / <N>"` (text label, a11y per
   * design discipline). Disabled state: when the source is empty (no active pool)
   * the Prev/Next buttons disable + the readout reads "no active pool".
   */
  function refreshStepReadout(): void {
    const list = stepList();
    if (list.length === 0) {
      stepPrevBtn.disabled = true;
      stepNextBtn.disabled = true;
      stepReadout.textContent = "no active pool";
      return;
    }
    stepPrevBtn.disabled = false;
    stepNextBtn.disabled = false;
    const idx = stepIndex(list);
    const shown = idx === -1 ? selectedAnim : list[idx];
    const pos = idx === -1 ? 1 : idx + 1;
    stepReadout.textContent = `${shown} — ${pos} / ${list.length}`;
  }

  /** Cycle toggle changed (§B.2). ON → auto-advance on loop-complete; OFF → hold. */
  function onCycleToggle(): void {
    cycleOn = cycleCheckbox.checked;
    cycleLoopCount = 0;
  }

  /**
   * The preview completed one loop (ticket 86ca4atwt §B.4). When Cycle is ON,
   * count it; once the count reaches the SHARED cadence (`cycleCadence` = Feature
   * A's `loopsPerActivePose`), advance the step source forward (Next) so the tuner
   * walks the pool over the room at exactly the dashboard cadence. No-op when Cycle
   * is OFF (the preview just holds the current pose).
   */
  function onPreviewLoopComplete(): void {
    if (!cycleOn) return;
    cycleLoopCount += 1;
    if (cycleLoopCount >= cycleCadence()) {
      cycleLoopCount = 0;
      onStep(1); // advances selectedAnim + rebuilds the preview on the new pose
    }
  }

  /**
   * Char or anim changed (§3.1): re-seed the draft from the current effective
   * resolved value (so the sliders open at the real current state, not zeros),
   * rebuild the preview, refresh the source table + warnings.
   */
  function onSelectionChange(): void {
    reseedDraftAndRepaint();
    // BUG 2 (86ca2uytw): a (char, anim) change moves the banner's filename;
    // dismiss any still-truthy success ack so a poll-tick re-push of that same
    // ack doesn't re-stamp "Saved to <new file>" for an unsaved file.
    dismissCurrentAck();
    renderBanner();
    persist();
  }

  /**
   * BUG 1 (86ca2uytw). The SHARED re-seed + full repaint used by BOTH a (char,
   * anim) change (onSelectionChange) AND a write-target flip (the write-target
   * onChange). Keeping the two paths on this one helper is the structural
   * guarantee they can't diverge again — the write-target path used to re-seed
   * the draft WITHOUT repainting, so the controls showed stale values while the
   * draft was re-seeded → the next edit dropped the visible-but-undrafted
   * values.
   *
   * FIX 1 (86ca2fvv9 — data-loss). Seed the draft with the EXISTING saved
   * override block for this (char, anim) at the CURRENT write target — NOT
   * empty. The save payload is field-omission == clear (§4.1): the host removes
   * any field absent from the payload. So if the draft started empty and the
   * sponsor changed ONE field, the save emitted e.g. `{dwellFrameIndex:8}` and
   * WIPED the pre-existing `speedMultiplier:0.5` from the json. Seeding from the
   * persisted block means a single-field edit carries the untouched saved fields
   * along, so they survive the write.
   */
  function reseedDraftAndRepaint(): void {
    draftOverride = readSavedPerCharOverride(selectedChar, selectedAnim);
    // The CONTROLS (sliders / apex picker / mode) reflect the editable surface
    // for the CURRENT write target — the draft over that target's inheritance
    // chain — so they never lie about what a save will write. The source TABLE
    // (below) still shows the BAKED engine truth (per-char wins), with the
    // shadow-warning explaining when a pose-default edit is masked per-char.
    seedControlsForWriteTarget();
    // 86ca2wj6u — seed the window thumbs from the cascade-resolved active window
    // (clamped to the live clip) + refresh the apex-coupling helper. activeWindow()
    // resolves draft → per-char → pose-default → full clip, so the thumbs reflect
    // the editable surface. Re-binds the clip length so a window from a longer
    // clip doesn't dangle on a shorter anim (spec §4.5).
    seedWindowFromActive();
    refreshWindowCouplingHelp();
    rebuildPreview();
    renderSourceTable(computeCascadeSource(selectedChar, selectedAnim, manifest));
    refreshPreviewNote();
    refreshShadowWarning();
    refreshStepReadout();
  }

  /**
   * BUG 1 (86ca2uytw). Seed the CONTROLS to the draft-effective value for the
   * active write target. Per field: the draft value if set, else the write
   * target's inherited value, else the engine default. For `per-char` the chain
   * is per-char → pose-default → engine (the full baked cascade, so the per-char
   * behavior is unchanged — #168). For `pose-default` the chain SKIPS the
   * per-char layer (pose-default → engine), because a pose-default edit must not
   * be shown as the per-char value it can't actually change — flipping to
   * "All characters" on a char whose per-char block holds 0.5× must show the
   * pose-default/engine default (1.00×), not the masking per-char 0.5×.
   */
  function seedControlsForWriteTarget(): void {
    if (writeTarget === "per-char") {
      seedSlidersFromSource(
        computeCascadeSource(selectedChar, selectedAnim, manifest),
      );
      return;
    }
    // pose-default: draft → pose-default → ENGINE default per field (the
    // per-char layer is deliberately SKIPPED — a pose-default edit can't change
    // a per-char value, so showing the per-char value would mislead).
    const poseDefault = manifest.poseDefaults?.[selectedAnim];
    const speedV =
      draftOverride.speedMultiplier ??
      poseDefault?.speedMultiplier ??
      ENGINE_DEFAULT_SPEED;
    const holdV =
      draftOverride.finalDwellMs ??
      poseDefault?.finalDwellMs ??
      ENGINE_DEFAULT_FINAL_DWELL_MS;
    const modeV: PlaybackMode =
      draftOverride.playbackMode ?? poseDefault?.playbackMode ?? "loop";
    const apexIdx =
      draftOverride.dwellFrameIndex ?? poseDefault?.dwellFrameIndex;
    const apexMsV =
      draftOverride.dwellMs ??
      poseDefault?.dwellMs ??
      ENGINE_DEFAULT_DWELL_MS;
    speed.setValue(speedV);
    hold.setValue(holdV);
    mode.setValue(modeV);
    populateApexFrames(typeof apexIdx === "number" ? apexIdx : undefined);
    apexMs.setValue(apexMsV);
  }

  /**
   * B1 restore-render: rebuild the panel surfaces for the RESTORED draft without
   * wiping it (the user-driven `onSelectionChange` resets the draft; this path
   * does not). Slider thumbs show the drafted values where the user set a field,
   * the cascade-resolved effective value elsewhere — so the panel looks exactly
   * as the user left it before the poll tick.
   */
  function renderForRestoredDraft(): void {
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    seedSlidersFromSource(source);
    // Overlay the restored draft onto the seeded thumbs.
    if (draftOverride.speedMultiplier !== undefined) {
      speed.setValue(draftOverride.speedMultiplier);
    }
    if (draftOverride.finalDwellMs !== undefined) {
      hold.setValue(draftOverride.finalDwellMs);
    }
    // Overlay the restored apex draft (picker + ms) onto the seeded values.
    if (draftOverride.dwellFrameIndex !== undefined) {
      populateApexFrames(draftOverride.dwellFrameIndex);
    }
    if (draftOverride.dwellMs !== undefined) {
      apexMs.setValue(draftOverride.dwellMs);
    }
    mode.setValue(draftOverride.playbackMode ?? (source.playbackMode.value as PlaybackMode));
    // 86ca2wj6u — restore the window thumbs from the resolved active window
    // (activeWindow already reads draftOverride.startFrame/endFrame first) so the
    // panel looks exactly as the user left it before the poll tick.
    seedWindowFromActive();
    refreshWindowCouplingHelp();
    rebuildPreview();
    renderSourceTable(source);
    refreshPreviewNote();
    refreshShadowWarning();
    refreshStepReadout();
  }

  /**
   * B1: mirror the current survivable editing state into the webview-local
   * tracker so the next poll-tick `renderFull` (which root-swaps a fresh tuner)
   * can restore it. No-op when no tracker is threaded (component tests).
   */
  function persist(): void {
    stateTracker?.set({
      selectedChar,
      selectedAnim,
      draftOverride: { ...draftOverride },
      writeTarget,
    });
  }

  /** Position the slider thumbs / mode radio at the effective resolved values. */
  function seedSlidersFromSource(source: CascadeSourceTable): void {
    speed.setValue(source.speedMultiplier.value as number);
    hold.setValue(source.finalDwellMs.value as number);
    mode.setValue(source.playbackMode.value as PlaybackMode);
    seedApexFromSource(source);
  }

  /** Re-read the speed slider position from the cascade after a [reset]. */
  function reseedSpeedFromCascade(): void {
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    speed.setValue(source.speedMultiplier.value as number);
  }
  function reseedHoldFromCascade(): void {
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    hold.setValue(source.finalDwellMs.value as number);
  }
  function reseedApexMsFromCascade(): void {
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    apexMs.setValue(source.dwellMs.value as number);
  }

  /**
   * FIX 1 (86ca2fvv9). Read the EXISTING saved override block for the current
   * (char, anim) from the WRITE TARGET the save will hit, so a single-field edit
   * preserves the other already-saved fields (field-omission == clear, §4.1,
   * applies per file). Per-char → the char's `animations[anim].playback`;
   * pose-default → `poseDefaults[anim]`. Absent block → empty draft (nothing
   * saved yet; a first edit sets exactly one field, which is correct).
   *
   * Returns a fresh copy (never the manifest's own object) so the draft can be
   * mutated freely without aliasing the baked manifest.
   */
  function readSavedPerCharOverride(
    char: string,
    anim: string,
  ): PlaybackOverride {
    const saved =
      writeTarget === "per-char"
        ? manifest.characters[char]?.animations?.[anim]?.playback
        : manifest.poseDefaults?.[anim];
    return saved ? { ...saved } : {};
  }

  /** Frame count of the selected (char, anim) — bounds the apex-frame picker. */
  function frameCount(): number {
    return manifest.characters[selectedChar]?.animations[selectedAnim]?.frames
      .length ?? 0;
  }

  /**
   * The ACTIVE frame window [winStart, winEnd] for the selected (char, anim),
   * resolving the draft's `startFrame`/`endFrame` over the cascade, clamped to
   * the live clip (86ca2w1g9). The engine only ever renders frames inside this
   * window, so the apex picker must offer ONLY these frames — an apex outside the
   * window is unreachable and its dwell never fires (the root cause of "Apex hold
   * frame 0 has no effect" on M01 idle_stretch's [5,10] window). Falls back to the
   * full clip [0, count-1] when no window is declared anywhere.
   */
  function activeWindow(): { start: number; end: number } {
    const count = frameCount();
    const lastIndex = Math.max(0, count - 1);
    if (count === 0) return { start: 0, end: 0 };
    // The cascade-source table exposes speed/hold/mode/apex but NOT the window
    // fields, so resolve those straight off the layers: draft (live) wins, then
    // per-char baked, then pose-default, then the full clip.
    const baked =
      manifest.characters[selectedChar]?.animations?.[selectedAnim]?.playback;
    const poseDefault = manifest.poseDefaults?.[selectedAnim];
    const resolve = (
      field: "startFrame" | "endFrame",
      clipFallback: number,
    ): number => {
      const raw =
        draftOverride[field] ?? baked?.[field] ?? poseDefault?.[field] ?? clipFallback;
      return Math.max(0, Math.min(lastIndex, Math.trunc(raw)));
    };
    let start = resolve("startFrame", 0);
    let end = resolve("endFrame", lastIndex);
    if (start > end) {
      // Inverted window mirrors the engine's fallback to the full clip.
      start = 0;
      end = lastIndex;
    }
    return { start, end };
  }

  /**
   * True when a frame sub-window is declared ANYWHERE in the cascade for the
   * selected (char, anim) — draft (live), per-char baked, or pose-default. A
   * no-window anim returns false so the preview is left full-clip (NIT 1
   * 86ca2w1g9: only WINDOWED anims overlay startFrame/endFrame onto the preview).
   */
  function windowIsDeclared(): boolean {
    const baked =
      manifest.characters[selectedChar]?.animations?.[selectedAnim]?.playback;
    const poseDefault = manifest.poseDefaults?.[selectedAnim];
    const declared = (field: "startFrame" | "endFrame"): boolean =>
      draftOverride[field] !== undefined ||
      baked?.[field] !== undefined ||
      poseDefault?.[field] !== undefined;
    return declared("startFrame") || declared("endFrame");
  }

  /**
   * The override the live preview should animate (NIT 1, 86ca2w1g9). The preview
   * injects this as a flat one-entry `playbackTable`, and the flat-table branch of
   * `resolvePlayback` does NO manifest merge (spritePlayer.ts:178-180) — so the
   * window (`startFrame`/`endFrame`) the picker + shipped tile honor would be lost
   * and the preview would play the FULL clip (0..count-1), making preview ≠ tile.
   * For a WINDOWED anim, overlay the cascade-resolved window from `activeWindow()`
   * so the preview animates only [startFrame..endFrame] — matching both the picker
   * and the shipped tile. No-window anims are passed through unchanged (full clip).
   */
  function previewOverride(): PlaybackOverride {
    if (!windowIsDeclared()) return draftOverride;
    const { start, end } = activeWindow();
    return { ...draftOverride, startFrame: start, endFrame: end };
  }

  /**
   * Repopulate the apex-frame picker for the selected (char, anim): an "Off"
   * option (clears the hold) plus one option per frame index in the ACTIVE
   * WINDOW [winStart, winEnd] (86ca2w1g9 — was [0, count), which let the sponsor
   * pick an apex frame the windowed loop never renders, so the dwell silently did
   * nothing). The picker is re-derived on every selection change because frame
   * counts AND windows differ per anim (M01 vs F01). `preferIndex` (draft /
   * cascade) selects that option when it is inside the window; an out-of-window
   * prefer falls back to "Off".
   */
  function populateApexFrames(preferIndex?: number): void {
    const count = frameCount();
    const { start, end } = activeWindow();
    apexFrameSelect.replaceChildren();
    const off = document.createElement("option");
    off.value = APEX_FRAME_OFF;
    off.textContent = "Off";
    apexFrameSelect.appendChild(off);
    for (let i = start; i <= end && i < count; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `frame ${i}`;
      apexFrameSelect.appendChild(opt);
    }
    apexFrameSelect.value =
      typeof preferIndex === "number" && preferIndex >= start && preferIndex <= end
        ? String(preferIndex)
        : APEX_FRAME_OFF;
  }

  /** Apex-frame picker changed. "Off" clears the pair; a frame sets the index. */
  function onApexFrameChange(): void {
    const raw = apexFrameSelect.value;
    if (raw === APEX_FRAME_OFF) {
      // Off clears BOTH apex fields (an index-less dwellMs has nothing to hold).
      draftOverride = omitField(
        omitField(draftOverride, "dwellFrameIndex"),
        "dwellMs",
      );
    } else {
      draftOverride = {
        ...draftOverride,
        dwellFrameIndex: Number(raw),
      };
    }
    // Discrete change → rebuild preview immediately (not debounced).
    onControlChange(false);
  }

  /**
   * 86ca2wj6u — a window thumb settled. Set the draft's startFrame/endFrame
   * UNLESS the window is the full clip (spec §4.3 omit-on-full-clip: a full-clip
   * window is the absent-field default, so persisting `0..last` is noise that
   * would shadow a pose-default window). After updating the draft, re-bound the
   * apex picker to the new window and auto-clear an apex now outside it (§4.4),
   * then run the standard control-change (preview re-window + debounced save).
   */
  function onWindowChange(start: number, end: number, isDrag: boolean): void {
    const lastIndex = Math.max(0, frameCount() - 1);
    if (start <= 0 && end >= lastIndex) {
      // Dragged back to the full clip → clear both (absent == full clip).
      draftOverride = omitField(omitField(draftOverride, "startFrame"), "endFrame");
    } else {
      draftOverride = { ...draftOverride, startFrame: start, endFrame: end };
    }
    rebindApexToWindow();
    refreshWindowCouplingHelp();
    onControlChange(isDrag);
  }

  /**
   * 86ca2wj6u — [reset] on the Window section clears BOTH window fields so the
   * window inherits (full clip if no layer declares one), re-seeds the thumbs
   * from the cascade-resolved window, re-bounds the apex picker, and queues a
   * save. Mirrors every other control's [reset] (omit → inherit, §4.3).
   */
  function onWindowReset(): void {
    draftOverride = omitField(omitField(draftOverride, "startFrame"), "endFrame");
    seedWindowFromActive();
    rebindApexToWindow();
    refreshWindowCouplingHelp();
    onControlChange(false);
  }

  /**
   * 86ca2wj6u — position the window thumbs at the cascade-resolved active window
   * (clamped to the live clip) WITHOUT firing onChange. Called on mount, char/
   * anim switch, write-target flip, and reset. Re-binds the clip length too so a
   * window from a longer clip doesn't dangle on a shorter anim (spec §4.5).
   */
  function seedWindowFromActive(): void {
    const lastIndex = Math.max(0, frameCount() - 1);
    const { start, end } = activeWindow();
    windowSlider.reseed(lastIndex, start, end);
  }

  /**
   * 86ca2wj6u — keep the apex picker honest on every window change (spec §4.4).
   * Re-derive the picker options from the new window. If the current apex
   * (`dwellFrameIndex`) now falls OUTSIDE [start,end], AUTO-CLEAR it (omit the
   * pair + show a quiet note) rather than leaving a dangling no-op apex on disk
   * — a persisted out-of-window apex is a latent footgun (re-fires if the window
   * later re-widens). `populateApexFrames` already resolves an out-of-window
   * preferIndex to "Off"; we detect that transition to clear the draft + note.
   */
  function rebindApexToWindow(): void {
    const prevApex = draftOverride.dwellFrameIndex;
    const { start, end } = activeWindow();
    const nowOutside =
      typeof prevApex === "number" && (prevApex < start || prevApex > end);
    populateApexFrames(prevApex);
    if (nowOutside) {
      draftOverride = omitField(
        omitField(draftOverride, "dwellFrameIndex"),
        "dwellMs",
      );
      windowApexNote.hidden = false;
      windowApexNote.textContent =
        `Apex frame ${prevApex} is outside the new window — apex hold cleared.`;
    } else {
      windowApexNote.hidden = true;
      windowApexNote.textContent = "";
    }
  }

  /**
   * 86ca2wj6u — show the apex-coupling helper only when a window narrower than
   * the full clip is active (spec §3), so the sponsor sees the cause (window)
   * above the effect (shrunken apex picker) in reading order.
   */
  function refreshWindowCouplingHelp(): void {
    windowCouplingHelp.hidden = !windowIsDeclared();
  }

  /** [reset] on the apex group clears BOTH apex fields + re-seeds from cascade. */
  function onApexReset(): void {
    draftOverride = omitField(
      omitField(draftOverride, "dwellFrameIndex"),
      "dwellMs",
    );
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    seedApexFromSource(source);
    onControlChange(false);
  }

  /**
   * Position the apex frame picker + ms slider at the effective resolved values
   * from the cascade. A `"none"` frame index → the picker shows "Off".
   */
  function seedApexFromSource(source: CascadeSourceTable): void {
    const idx = source.dwellFrameIndex.value;
    populateApexFrames(idx === APEX_FRAME_NONE ? undefined : (idx as number));
    apexMs.setValue(source.dwellMs.value as number);
  }

  /**
   * A control changed. `isDrag` true → slider input (short preview debounce);
   * false → discrete (mode / reset) — rebuild preview immediately. Both queue
   * the longer trailing save.
   */
  function onControlChange(isDrag: boolean): void {
    if (isDrag) {
      schedulePreview();
    } else {
      rebuildPreview();
    }
    scheduleSave();
    refreshShadowWarning();
    // B1: every control change mutated `draftOverride` — mirror it into the
    // tracker so a poll tick mid-drag restores the in-progress draft.
    persist();
  }

  /** Short-debounced preview rebuild (§6 ~120ms). */
  function schedulePreview(): void {
    if (previewTimer !== null) cancelTimer(previewTimer);
    previewTimer = schedule(() => {
      previewTimer = null;
      rebuildPreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  /** Trailing-edge debounced save (§6 ~500ms). */
  function scheduleSave(): void {
    if (saveTimer !== null) cancelTimer(saveTimer);
    saveTimer = schedule(() => {
      saveTimer = null;
      emitSave();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Dispose+rebuild the preview box with the current draft (§5.1). */
  function rebuildPreview(): void {
    const char = manifest.characters[selectedChar];
    if (!char || selectedAnim === "") {
      preview?.dispose();
      preview = null;
      previewHost.replaceChildren();
      return;
    }
    // NIT 1 (86ca2w1g9): overlay the active window so the live preview animates
    // only [startFrame..endFrame] for a windowed anim — matching the picker + the
    // shipped tile (the flat playbackTable form does no manifest merge).
    const overrideForPreview = previewOverride();
    if (preview === null) {
      preview = createPreviewController({
        char,
        animName: selectedAnim,
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        // 86ca4atwt §B.1: the preview paints the shared scene backdrop from the
        // same (overlaid) manifest the panel reads, so the room renders behind the
        // sprite exactly as on the dashboard tile.
        manifest,
        draftOverride: overrideForPreview,
        // 86ca4atwt §B.4: while the Cycle toggle is ON, each completed loop bumps
        // `selectedAnim` forward through the step source — REUSING Feature A's
        // cadence (`cycleCadence`) so the tuner previews exactly the dashboard
        // rotation. The callback fires for any pose (active or idle).
        onLoopComplete: () => onPreviewLoopComplete(),
        ...(scheduleFrame !== undefined ? { scheduleFrame } : {}),
        ...(cancelFrame !== undefined ? { cancelFrame } : {}),
      });
      previewHost.replaceChildren(preview.element);
    } else {
      // 86ca2tu9t: pass the LIVE char so a Character switch rebinds the preview
      // to the new character's sprite. (Previously only `selectedAnim` was
      // passed; the controller reused its construction-time char, so switching to
      // M01 left the preview painting F01.)
      preview.update(char, selectedAnim, overrideForPreview);
    }
    refreshPreviewNote();
  }

  /** Post the save message (§4.1). */
  function emitSave(): void {
    // BUG 2 (86ca2uytw): a genuine save is in flight — clear the dismiss latch
    // so its returning ok-ack is shown (the suppression only guards the STALE
    // ack a selection/target change orphaned, not the next real save).
    ackDismissed = false;
    const payload: Extract<
      WebviewMessage,
      { type: "ui:save-playback-override" }
    >["payload"] = {
      writeTarget,
      animName: selectedAnim,
      override: { ...draftOverride },
      ...(writeTarget === "per-char"
        ? { characterFolder: selectedChar }
        : {}),
    };
    // 86ca2wrnq: remember exactly what we asked the host to write, keyed by the
    // SAME (writeTarget, char, anim) the host writes. On a confirmed ok-ack we
    // commit this into the live overlay so a subsequent re-seed reads it instead
    // of the stale baked value. Captured at emit time so the coordinates can't
    // drift if the user changes selection while the ack is in flight.
    pendingSave = {
      writeTarget,
      ...(writeTarget === "per-char" ? { characterFolder: selectedChar } : {}),
      animName: selectedAnim,
      override: { ...draftOverride },
    };
    postMessage({ type: "ui:save-playback-override", payload });
  }

  /** Render the per-field source table (§3.5, AC3). */
  function renderSourceTable(source: CascadeSourceTable): void {
    sourceTable.replaceChildren();
    addSourceRow(sourceTable, "speed", formatSpeed(source.speedMultiplier.value), source.speedMultiplier.layer);
    addSourceRow(sourceTable, "hold", formatHold(source.finalDwellMs.value), source.finalDwellMs.layer);
    addSourceRow(sourceTable, "mode", String(source.playbackMode.value), source.playbackMode.layer);
    // Apex hold (86ca2bqe1): per-field effective + source, like the others.
    addSourceRow(
      sourceTable,
      "apex frame",
      formatApexFrame(source.dwellFrameIndex.value),
      source.dwellFrameIndex.layer,
    );
    addSourceRow(
      sourceTable,
      "apex hold",
      formatHold(source.dwellMs.value),
      source.dwellMs.layer,
    );
    // 86ca2wj6u (spec §5.4): the window is now tunable + cascades like the
    // others, so surface it in the explain-table. Resolved independently of the
    // 5 other rows (field-level, per cascadeSource doctrine) — draft is excluded
    // here exactly like the other rows (the table reflects the BAKED truth).
    const win = windowSourceRow();
    addSourceRow(sourceTable, "window", win.text, win.layer);
  }

  /**
   * 86ca2wj6u (spec §5.4) — resolve the EFFECTIVE window + its originating layer
   * for the source table, walking the BAKED cascade (per-char → pose-default →
   * full clip = engine default). Excludes the draft (the table reflects baked
   * truth, mirroring computeCascadeSource). Returns a readout like `5 – 10` or
   * `full clip` and the layer tag.
   */
  function windowSourceRow(): { text: string; layer: CascadeLayer } {
    const count = frameCount();
    const lastIndex = Math.max(0, count - 1);
    const baked =
      manifest.characters[selectedChar]?.animations?.[selectedAnim]?.playback;
    const poseDefault = manifest.poseDefaults?.[selectedAnim];
    const declaredPerChar =
      baked?.startFrame !== undefined || baked?.endFrame !== undefined;
    const declaredPose =
      poseDefault?.startFrame !== undefined ||
      poseDefault?.endFrame !== undefined;
    const layer: CascadeLayer = declaredPerChar
      ? "per-char"
      : declaredPose
        ? "pose-default"
        : "engine default";
    const clamp = (v: number): number =>
      Math.max(0, Math.min(lastIndex, Math.trunc(v)));
    const resolve = (
      field: "startFrame" | "endFrame",
      fallback: number,
    ): number => clamp(baked?.[field] ?? poseDefault?.[field] ?? fallback);
    let start = resolve("startFrame", 0);
    let end = resolve("endFrame", lastIndex);
    if (start > end) {
      start = 0;
      end = lastIndex;
    }
    const isFullClip =
      layer === "engine default" || (start <= 0 && end >= lastIndex);
    return { text: isFullClip ? "full clip" : `${start} – ${end}`, layer };
  }

  /**
   * FIX 2 (86ca2fvv9 — summary reflects the saved draft). After a SUCCESSFUL
   * save, overlay the just-saved `draftOverride` onto the baked cascade so the
   * source/summary row shows the saved value (+ source) IMMEDIATELY, instead of
   * the stale baked value until the next `npm run build`. The sponsor read the
   * unchanged baked value as "my save wasn't picked up."
   *
   * The overlay respects the cascade precedence at the WRITE TARGET's layer:
   *   - per-char save → a drafted field becomes `per-char` (wins over all).
   *   - pose-default save → a drafted field becomes `pose-default` ONLY when no
   *     per-char value already shadows it; a per-char value still wins (so the
   *     row keeps showing the per-char effective value, matching the engine).
   *
   * This changes ONLY the summary row. The live dashboard tiles still need a
   * rebuild — the persistence banner keeps saying so (§3.6 unchanged).
   */
  function computeSourceReflectingSavedDraft(): CascadeSourceTable {
    const baked = computeCascadeSource(selectedChar, selectedAnim, manifest);
    const overlayLayer: CascadeLayer =
      writeTarget === "per-char" ? "per-char" : "pose-default";
    const overlay = <V extends FieldValue>(
      field: FieldSource,
      draftValue: V | undefined,
    ): FieldSource => {
      if (draftValue === undefined) return field;
      // pose-default write must not override a field a per-char value already
      // wins (the engine resolves per-char first) — keep the baked per-char row.
      if (overlayLayer === "pose-default" && field.layer === "per-char") {
        return field;
      }
      return { value: draftValue, layer: overlayLayer };
    };
    return {
      speedMultiplier: overlay(baked.speedMultiplier, draftOverride.speedMultiplier),
      finalDwellMs: overlay(baked.finalDwellMs, draftOverride.finalDwellMs),
      playbackMode: overlay(baked.playbackMode, draftOverride.playbackMode),
      dwellFrameIndex: overlay(
        baked.dwellFrameIndex,
        draftOverride.dwellFrameIndex,
      ),
      dwellMs: overlay(baked.dwellMs, draftOverride.dwellMs),
    };
  }

  /**
   * §7 edge-case notes on the preview: zero-frame anim, single-frame anim,
   * finalDwellMs-on-active. A quiet note rather than a blank box.
   */
  function refreshPreviewNote(): void {
    const char = manifest.characters[selectedChar];
    const anim = char?.animations[selectedAnim];
    let note = "";
    if (!anim || anim.frames.length === 0) {
      note = "This animation has no frames — preview can't render.";
    } else if (anim.frames.length === 1) {
      note = "Single-frame anim — timing has no visible effect.";
    } else if (selectedAnim.startsWith("active_")) {
      note = "Final-frame hold applies to idle poses only.";
    }
    if (note === "") {
      previewNote.hidden = true;
      previewNote.textContent = "";
    } else {
      previewNote.hidden = false;
      previewNote.textContent = note;
    }
  }

  /**
   * §3.7 shadowing warning: if the write target is "All characters" (pose-default)
   * but a per-char override already wins for a field, the pose-default won't show
   * for THIS character — warn.
   */
  function refreshShadowWarning(): void {
    if (writeTarget !== "pose-default") {
      shadowWarn.hidden = true;
      return;
    }
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    const shadowed: string[] = [];
    if (source.speedMultiplier.layer === "per-char") shadowed.push("speed");
    if (source.finalDwellMs.layer === "per-char") shadowed.push("hold");
    if (source.playbackMode.layer === "per-char") shadowed.push("mode");
    // 86ca2x6q1 — apex pair (dwellFrameIndex/dwellMs) is shadowable like the
    // others: a per-char apex hold overriding a pose-default write won't show
    // for this character, so name it the same way (source-table labels).
    if (source.dwellFrameIndex.layer === "per-char") shadowed.push("apex frame");
    if (source.dwellMs.layer === "per-char") shadowed.push("apex hold");
    if (shadowed.length === 0) {
      shadowWarn.hidden = true;
      shadowWarn.textContent = "";
      return;
    }
    shadowWarn.hidden = false;
    shadowWarn.textContent =
      `⚠ ${selectedChar} overrides ${shadowed.join(", ")} per-char; ` +
      "the pose-default you set won't show for this character.";
  }

  /** Render the persistence banner from the latest ack (§3.6). */
  function renderBanner(): void {
    banner.replaceChildren();
    let kind: "idle" | "success" | "error" = "idle";
    let text: string;
    if (saveAck === null) {
      text = "Adjust a control to tune; changes auto-save.";
    } else if (saveAck.ok) {
      kind = "success";
      const filename =
        writeTarget === "per-char"
          ? `${selectedChar}/animations.json`
          : "pose-defaults.json";
      text = `✎ Saved to ${filename}. Rebuild + reload to apply to the live dashboard tiles.`;
    } else {
      kind = "error";
      text = `Couldn't save: ${saveAck.error ?? "unknown error"}`;
    }
    banner.dataset.kind = kind;
    banner.className =
      kind === "error"
        ? "ct-tuner-banner ct-tuner-banner--error"
        : kind === "success"
          ? "ct-tuner-banner ct-tuner-banner--success"
          : "ct-tuner-banner";
    banner.setAttribute("role", kind === "error" ? "alert" : "status");
    const span = document.createElement("span");
    span.className = "ct-tuner-banner-text";
    span.textContent = text;
    banner.appendChild(span);
  }

  function onEscapeClose(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  }

  function close(): void {
    if (previewTimer !== null) cancelTimer(previewTimer);
    if (saveTimer !== null) cancelTimer(saveTimer);
    preview?.dispose();
    preview = null;
    onClose?.();
  }
}

// =============================================================================
// Small DOM builders (pure-ish; no panel state)
// =============================================================================

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Return a copy of `o` with `key` removed (field-omission == clear, §4.1). */
function omitField(
  o: PlaybackOverride,
  key:
    | "speedMultiplier"
    | "finalDwellMs"
    | "playbackMode"
    | "dwellFrameIndex"
    | "dwellMs"
    | "startFrame"
    | "endFrame",
): PlaybackOverride {
  const copy: PlaybackOverride = { ...o };
  delete copy[key];
  return copy;
}

function formatSpeed(v: number | PlaybackMode | string): string {
  return typeof v === "number" ? `${v.toFixed(2)}×` : String(v);
}
function formatHold(v: number | PlaybackMode | string): string {
  return typeof v === "number" ? `${Math.round(v)} ms` : String(v);
}
/** Apex-frame readout: a frame index, or "none" (no apex hold) — 86ca2bqe1. */
function formatApexFrame(v: number | PlaybackMode | string): string {
  return typeof v === "number" ? `frame ${v}` : String(v);
}

/** A captioned label wrapping a control (selector). */
function labeledField(caption: string, control: HTMLElement): HTMLElement {
  const label = document.createElement("label");
  label.className = "ct-tuner-field";
  const cap = document.createElement("span");
  cap.className = "ct-tuner-field-caption";
  cap.textContent = caption;
  label.appendChild(cap);
  label.appendChild(control);
  return label;
}

/** A section divider heading (e.g. "Controls", "Write target"). */
function sectionDivider(text: string): HTMLElement {
  const h = document.createElement("h2");
  h.className = "ct-tuner-section";
  h.textContent = text;
  return h;
}

/** Append a `<dt>label</dt><dd>value <chip>source</chip></dd>` source row. */
function addSourceRow(
  table: HTMLElement,
  label: string,
  value: string,
  layer: CascadeLayer,
): void {
  const dt = document.createElement("dt");
  dt.className = "ct-tuner-source-label";
  dt.textContent = label;
  table.appendChild(dt);
  const dd = document.createElement("dd");
  dd.className = "ct-tuner-source-value";
  dd.dataset.field = label;
  dd.dataset.layer = layer;
  const v = document.createElement("span");
  v.className = "ct-tuner-source-effective";
  v.textContent = value;
  dd.appendChild(v);
  const chip = document.createElement("span");
  chip.className = "ct-tuner-source-tag";
  chip.textContent = layerLabel(layer);
  dd.appendChild(chip);
  table.appendChild(dd);
}

interface SliderProps {
  cls: string;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  ariaText: (v: number) => string;
  minLabel: string;
  maxLabel: string;
  onInput: (v: number) => void;
  onReset: () => void;
}

interface SliderHandle {
  element: HTMLElement;
  /** Position the thumb + readout WITHOUT firing onInput (programmatic seed). */
  setValue(v: number): void;
}

/** Build a labeled native range slider with a numeric readout + [reset]. */
function buildSlider(props: SliderProps): SliderHandle {
  const row = document.createElement("div");
  row.className = `ct-tuner-control ${props.cls}`;

  const labelRow = document.createElement("div");
  labelRow.className = "ct-tuner-control-labelrow";
  const caption = document.createElement("span");
  caption.className = "ct-tuner-control-caption";
  caption.textContent = props.label;
  labelRow.appendChild(caption);
  const readout = document.createElement("span");
  readout.className = "ct-tuner-control-readout";
  labelRow.appendChild(readout);
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "ct-tuner-reset";
  resetBtn.textContent = "reset";
  resetBtn.setAttribute("aria-label", `Reset ${props.label}`);
  resetBtn.addEventListener("click", () => props.onReset());
  labelRow.appendChild(resetBtn);
  row.appendChild(labelRow);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "ct-tuner-slider";
  input.min = String(props.min);
  input.max = String(props.max);
  input.step = String(props.step);
  input.setAttribute("aria-label", props.label);

  const apply = (v: number, fireInput: boolean): void => {
    readout.textContent = props.format(v);
    input.setAttribute("aria-valuetext", props.ariaText(v));
    input.value = String(v);
    if (fireInput) props.onInput(v);
  };

  input.addEventListener("input", () => {
    apply(Number(input.value), true);
  });

  const bounds = document.createElement("div");
  bounds.className = "ct-tuner-bounds";
  const minB = document.createElement("span");
  minB.textContent = props.minLabel;
  const maxB = document.createElement("span");
  maxB.textContent = props.maxLabel;
  bounds.appendChild(minB);
  bounds.appendChild(maxB);

  row.appendChild(input);
  row.appendChild(bounds);

  return {
    element: row,
    setValue: (v) => apply(clampNum(v, props.min, props.max), false),
  };
}

function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// =============================================================================
// Dual-handle frame range slider (86ca2wj6u — the "Window" control).
// =============================================================================

interface WindowSliderProps {
  /**
   * Fired whenever EITHER thumb settles on a new value (clamped so start ≤ end).
   * `isDrag` true → continuous slider input (preview-debounce); false → discrete.
   */
  onChange: (start: number, end: number, isDrag: boolean) => void;
  /** Fired when the [reset] link is clicked (clears the window → full clip). */
  onReset: () => void;
}

interface WindowSliderHandle {
  element: HTMLElement;
  /**
   * Re-bind the slider to a new clip length + set both thumbs WITHOUT firing
   * `onChange` (programmatic seed on char/anim switch + reset). `lastIndex` is
   * the clip's last frame (max thumb value); the bounds helper shows `0–N`.
   */
  reseed(lastIndex: number, start: number, end: number): void;
  /** Update the single-frame note visibility WITHOUT a reseed. */
  refreshNote(start: number, end: number): void;
}

/**
 * A two-thumb frame range slider built from two overlapped native
 * `input[type=range]` (native range is single-thumb only — spec §1 tradeoff).
 * The left thumb is `startFrame`, the right thumb is `endFrame`; the thumbs are
 * COUPLED so start can never pass end (spec §4.1 — inverted window prevented at
 * the UI). Both thumbs span `0 … lastIndex`; an out-of-range value is unreachable.
 *
 * The control reports values via `onChange(start, end, isDrag)`. The caller owns
 * the omit-on-full-clip decision (spec §4.3) and the apex re-bound (spec §4.4).
 */
function buildWindowSlider(props: WindowSliderProps): WindowSliderHandle {
  const row = document.createElement("div");
  row.className = "ct-tuner-control ct-tuner-window";

  // Label row: caption "Frames" + the start–end readout + [reset].
  const labelRow = document.createElement("div");
  labelRow.className = "ct-tuner-control-labelrow";
  const caption = document.createElement("span");
  caption.className = "ct-tuner-control-caption";
  caption.textContent = "Frames";
  labelRow.appendChild(caption);
  const readout = document.createElement("span");
  readout.className = "ct-tuner-control-readout ct-tuner-window-readout";
  labelRow.appendChild(readout);
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "ct-tuner-reset ct-tuner-window-reset";
  resetBtn.textContent = "reset";
  resetBtn.setAttribute("aria-label", "Reset to full clip");
  resetBtn.addEventListener("click", () => props.onReset());
  labelRow.appendChild(resetBtn);
  row.appendChild(labelRow);

  // The two overlapped range inputs share a track wrapper.
  const track = document.createElement("div");
  track.className = "ct-tuner-window-track";

  const startInput = document.createElement("input");
  startInput.type = "range";
  startInput.className = "ct-tuner-slider ct-tuner-window-start";
  startInput.setAttribute("aria-label", "Window start frame");

  const endInput = document.createElement("input");
  endInput.type = "range";
  endInput.className = "ct-tuner-slider ct-tuner-window-end";
  endInput.setAttribute("aria-label", "Window end frame");

  track.appendChild(startInput);
  track.appendChild(endInput);
  row.appendChild(track);

  // Bounds + helper text (full-clip range + the coupling/single-frame notes).
  const bounds = document.createElement("div");
  bounds.className = "ct-tuner-bounds ct-tuner-window-bounds";
  const minB = document.createElement("span");
  minB.textContent = "0";
  const maxB = document.createElement("span");
  maxB.className = "ct-tuner-window-max";
  bounds.appendChild(minB);
  bounds.appendChild(maxB);
  row.appendChild(bounds);

  const fullClip = document.createElement("p");
  fullClip.className = "ct-tuner-help ct-tuner-window-fullclip";
  row.appendChild(fullClip);

  const help = document.createElement("p");
  help.className = "ct-tuner-help";
  help.textContent =
    "Trim the loop to a slice of the clip. Frames before the start and after the end are skipped.";
  row.appendChild(help);

  // Single-frame note (spec §4.2) — quiet, shown only when start == end.
  const singleNote = document.createElement("p");
  singleNote.className = "ct-tuner-help ct-tuner-window-single-note";
  singleNote.hidden = true;
  row.appendChild(singleNote);

  let lastIndex = 0;

  /**
   * BUG 1 + BUG 2 (86ca3kz05) — paint the in-window bar.
   *
   * The two overlapped native ranges inherit `accent-color`, which fills each
   * input's track from `min` (0) up to ITS thumb. So the START input filled the
   * 0→start segment with the accent color too — making the out-of-window LEFT
   * segment look IN-window (right-of-end stayed correctly un-filled). Net: the
   * sponsor read the M01 idle_stretch window as `0–10` even though the thumbs +
   * readout + apex picker correctly sat at `5–10` (the per-input accent fill, NOT
   * the data, was wrong). Both bugs share this one cause.
   *
   * Fix: stop relying on the native per-input accent fill (turned off in CSS for
   * the window inputs) and drive ONE custom track fill via two percentages set
   * here. The CSS overlay paints the full track dimmed, then the in-window slice
   * `[start,end]` filled — so BOTH out-of-window segments (left of start AND right
   * of end) render identically dimmed, and the filled bar reads `[start,end]`.
   */
  const paintWindowFill = (start: number, end: number): void => {
    const span = lastIndex > 0 ? lastIndex : 1;
    const startPct = (clampNum(start, 0, lastIndex) / span) * 100;
    const endPct = (clampNum(end, 0, lastIndex) / span) * 100;
    track.style.setProperty("--ct-win-start-pct", `${startPct}%`);
    track.style.setProperty("--ct-win-end-pct", `${endPct}%`);
  };

  const applyReadout = (start: number, end: number): void => {
    readout.textContent = `${start} – ${end}`;
    startInput.setAttribute("aria-valuetext", `frame ${start}`);
    endInput.setAttribute("aria-valuetext", `frame ${end}`);
    paintWindowFill(start, end);
    refreshNote(start, end);
  };

  function refreshNote(start: number, end: number): void {
    if (start === end) {
      singleNote.hidden = false;
      singleNote.textContent =
        `Single-frame window — the loop holds on frame ${start} (timing/mode have no visible effect).`;
    } else {
      singleNote.hidden = true;
      singleNote.textContent = "";
    }
  }

  // Coupling: clamp the moved thumb against its sibling, then report.
  const onStartInput = (): void => {
    let start = Number(startInput.value);
    const end = Number(endInput.value);
    if (start > end) {
      start = end;
      startInput.value = String(start);
    }
    applyReadout(start, end);
    props.onChange(start, end, true);
  };
  const onEndInput = (): void => {
    const start = Number(startInput.value);
    let end = Number(endInput.value);
    if (end < start) {
      end = start;
      endInput.value = String(end);
    }
    applyReadout(start, end);
    props.onChange(start, end, true);
  };
  startInput.addEventListener("input", onStartInput);
  endInput.addEventListener("input", onEndInput);

  return {
    element: row,
    reseed(nextLastIndex, start, end): void {
      lastIndex = Math.max(0, nextLastIndex);
      const s = clampNum(Math.trunc(start), 0, lastIndex);
      const e = clampNum(Math.trunc(end), s, lastIndex);
      startInput.min = "0";
      startInput.max = String(lastIndex);
      startInput.step = "1";
      endInput.min = "0";
      endInput.max = String(lastIndex);
      endInput.step = "1";
      startInput.value = String(s);
      endInput.value = String(e);
      maxB.textContent = String(lastIndex);
      fullClip.textContent = `Full clip: 0–${lastIndex}`;
      applyReadout(s, e);
    },
    refreshNote,
  };
}

interface ModeHandle {
  element: HTMLElement;
  setValue(m: PlaybackMode): void;
}

/** Build the loop/pingpong radio group → playbackMode (§3.4). */
function buildModeControl(onChange: (m: PlaybackMode) => void): ModeHandle {
  const row = document.createElement("div");
  row.className = "ct-tuner-control ct-tuner-mode";
  const caption = document.createElement("span");
  caption.className = "ct-tuner-control-caption";
  caption.textContent = "Mode";
  row.appendChild(caption);

  const group = document.createElement("div");
  group.className = "ct-tuner-radio-group";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Playback mode");

  const radios: Record<PlaybackMode, HTMLInputElement> = {} as Record<
    PlaybackMode,
    HTMLInputElement
  >;
  for (const m of ["loop", "pingpong"] as PlaybackMode[]) {
    const label = document.createElement("label");
    label.className = "ct-tuner-radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "ct-tuner-mode";
    input.value = m;
    input.className = "ct-tuner-mode-radio";
    input.dataset.mode = m;
    input.addEventListener("change", () => {
      if (input.checked) onChange(m);
    });
    radios[m] = input;
    const text = document.createElement("span");
    text.textContent = m;
    label.appendChild(input);
    label.appendChild(text);
    group.appendChild(label);
  }
  row.appendChild(group);

  return {
    element: row,
    setValue: (m) => {
      radios.loop.checked = m === "loop";
      radios.pingpong.checked = m === "pingpong";
    },
  };
}

interface WriteTargetHandle {
  element: HTMLElement;
}

/** Build the per-char / pose-default write-target radio group (§3.7). */
function buildWriteTargetControl(
  initial: "per-char" | "pose-default",
  onChange: (t: "per-char" | "pose-default") => void,
): WriteTargetHandle {
  const row = document.createElement("div");
  row.className = "ct-tuner-control ct-tuner-writetarget";

  const group = document.createElement("div");
  group.className = "ct-tuner-radio-group";
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "Write target");

  const options: { value: "per-char" | "pose-default"; label: string }[] = [
    { value: "per-char", label: "This character (animations.json)" },
    { value: "pose-default", label: "All characters (pose-defaults.json)" },
  ];
  for (const opt of options) {
    const label = document.createElement("label");
    label.className = "ct-tuner-radio";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "ct-tuner-writetarget";
    input.value = opt.value;
    input.className = "ct-tuner-writetarget-radio";
    input.dataset.target = opt.value;
    input.checked = opt.value === initial; // default per-char (§3.7); B1 restores
    input.addEventListener("change", () => {
      if (input.checked) onChange(opt.value);
    });
    const text = document.createElement("span");
    text.textContent = opt.label;
    label.appendChild(input);
    label.appendChild(text);
    group.appendChild(label);
  }
  row.appendChild(group);

  const help = document.createElement("p");
  help.className = "ct-tuner-help";
  help.textContent =
    "This character = tune only this character's anim. All characters = set the default for every character (per-char tweaks still override).";
  row.appendChild(help);

  return { element: row };
}
