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
import type { GeneratedSpriteManifest } from "../sprites/spriteManifest.js";
import { GENERATED_SPRITE_MANIFEST } from "../sprites/generatedManifest.js";
import { createPreviewController } from "./playbackTunerPreview.js";
import {
  computeCascadeSource,
  type CascadeLayer,
  type CascadeSourceTable,
} from "../sprites/cascadeSource.js";

/** Debounce windows (E4 spec §6). Overridable for tests. */
export const PREVIEW_DEBOUNCE_MS = 120;
export const SAVE_DEBOUNCE_MS = 500;

/** Slider bounds (E4 spec §3.2 / §3.3). */
const SPEED_MIN = 0.25;
const SPEED_MAX = 2.0;
const SPEED_STEP = 0.05;
const HOLD_MIN = 0;
const HOLD_MAX = 2000;
const HOLD_STEP = 50;

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
  /** Debounce timer scheduler (tests). Defaults to window.setTimeout. */
  schedule?: (cb: () => void, ms: number) => number;
  /** Debounce timer canceller (tests). Defaults to window.clearTimeout. */
  cancelTimer?: (handle: number) => void;
  /** Sprite-box frame scheduler injection (tests) — threaded to the preview. */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Sprite-box frame canceller injection (tests). */
  cancelFrame?: (handle: number) => void;
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
    saveAck = null,
    schedule = (cb, ms) => window.setTimeout(cb, ms) as unknown as number,
    cancelTimer = (h) => window.clearTimeout(h),
    scheduleFrame,
    cancelFrame,
  } = props;

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
    return root;
  }

  // ── Selection state ───────────────────────────────────────────────────────
  let selectedChar = charKeys[0];
  let selectedAnim = "";
  // Draft override — ONLY the SET fields (field-omission == clear, §4.1).
  let draftOverride: PlaybackOverride = {};
  // Write target (§3.7) — default "per-char" (narrower, safer scope).
  let writeTarget: "per-char" | "pose-default" = "per-char";

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
    maxLabel: "2000 ms",
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
  const writeTargetCtl = buildWriteTargetControl((t) => {
    writeTarget = t;
    refreshShadowWarning();
    // Changing the target alone does not change the draft; no auto-save until a
    // value changes. (A target flip with no field set has nothing to persist.)
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
  populateAnims();
  onSelectionChange();
  renderBanner();

  return root;

  // ===========================================================================
  // Behavior
  // ===========================================================================

  /** Repopulate the animation <select> for the selected character (§3.1). */
  function populateAnims(): void {
    const char = manifest.characters[selectedChar];
    const animNames = char ? Object.keys(char.animations) : [];
    animSelect.replaceChildren();
    for (const name of animNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      animSelect.appendChild(opt);
    }
    // Default = defaultIdle if present in the set, else first anim.
    const preferred =
      char?.defaultIdle && animNames.includes(char.defaultIdle)
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
    // Re-seed draft to empty — the source table reflects baked state; the
    // sliders open at the cascade-resolved EFFECTIVE values (read below). The
    // draft starts empty (nothing set away from inherited) so a save right after
    // opening clears nothing unexpectedly.
    draftOverride = {};
    const source = computeCascadeSource(selectedChar, selectedAnim, manifest);
    seedSlidersFromSource(source);
    rebuildPreview();
    renderSourceTable(source);
    refreshPreviewNote();
    refreshShadowWarning();
  }

  /** Position the slider thumbs / mode radio at the effective resolved values. */
  function seedSlidersFromSource(source: CascadeSourceTable): void {
    speed.setValue(source.speedMultiplier.value as number);
    hold.setValue(source.finalDwellMs.value as number);
    mode.setValue(source.playbackMode.value as PlaybackMode);
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
      preview.update(selectedAnim, draftOverride);
    }
    refreshPreviewNote();
  }

  /** Post the save message (§4.1). */
  function emitSave(): void {
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
  key: "speedMultiplier" | "finalDwellMs" | "playbackMode",
): PlaybackOverride {
  const copy: PlaybackOverride = { ...o };
  delete copy[key];
  return copy;
}

function formatSpeed(v: number | PlaybackMode): string {
  return typeof v === "number" ? `${v.toFixed(2)}×` : String(v);
}
function formatHold(v: number | PlaybackMode): string {
  return typeof v === "number" ? `${Math.round(v)} ms` : String(v);
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
    input.checked = opt.value === "per-char"; // default per-char (§3.7)
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
