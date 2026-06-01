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
const SPEED_MAX = 2.0;
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
    manifest = GENERATED_SPRITE_MANIFEST,
    spriteBaseUri,
    postMessage,
    onClose,
    saveAck: initialSaveAck = null,
    stateTracker,
    schedule = (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
    cancelTimer = (h) => window.clearTimeout(h),
    scheduleFrame,
    cancelFrame,
  } = props;

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
    maxLabel: "2.0×",
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
    rebuildPreview();
    renderSourceTable(computeCascadeSource(selectedChar, selectedAnim, manifest));
    refreshPreviewNote();
    refreshShadowWarning();
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
    rebuildPreview();
    renderSourceTable(source);
    refreshPreviewNote();
    refreshShadowWarning();
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
   * Repopulate the apex-frame picker for the selected (char, anim): an "Off"
   * option (clears the hold) plus one option per frame index in [0, count). The
   * picker is re-derived on every selection change because frame counts differ
   * per anim (M01 vs F01) — a stale index must never exceed the live count.
   * `preferIndex` (draft / cascade) selects that option if still in range.
   */
  function populateApexFrames(preferIndex?: number): void {
    const count = frameCount();
    apexFrameSelect.replaceChildren();
    const off = document.createElement("option");
    off.value = APEX_FRAME_OFF;
    off.textContent = "Off";
    apexFrameSelect.appendChild(off);
    for (let i = 0; i < count; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `frame ${i}`;
      apexFrameSelect.appendChild(opt);
    }
    apexFrameSelect.value =
      typeof preferIndex === "number" && preferIndex >= 0 && preferIndex < count
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
    if (preview === null) {
      preview = createPreviewController({
        char,
        animName: selectedAnim,
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        draftOverride,
        ...(scheduleFrame !== undefined ? { scheduleFrame } : {}),
        ...(cancelFrame !== undefined ? { cancelFrame } : {}),
      });
      previewHost.replaceChildren(preview.element);
    } else {
      // 86ca2tu9t: pass the LIVE char so a Character switch rebinds the preview
      // to the new character's sprite. (Previously only `selectedAnim` was
      // passed; the controller reused its construction-time char, so switching to
      // M01 left the preview painting F01.)
      preview.update(char, selectedAnim, draftOverride);
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
    | "dwellMs",
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
