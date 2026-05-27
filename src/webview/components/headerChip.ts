/**
 * headerChip — header filter chip rendered above session blocks.
 *
 * Sponsor-controlled filter that suppresses agent tiles based on their state.
 * Pairs a VS Code config scalar (`claudeteam.hideFinishedAgents` /
 * `claudeteam.hideIdleAgents`) with an in-dashboard toggle so the sponsor
 * can flip the filter without leaving the pane.
 *
 * Originally introduced in M5 for `hideFinishedAgents`; widened in
 * 86c9zqa75 (spec 86c9zmyef §3) to also render the parallel `hideIdleAgents`
 * chip side-by-side. The two chips share this component with a `kind`
 * discriminator selecting the verbiage + config-key bound to the message.
 *
 * Vocabulary contract (spec 86c9zmyef §7.3 — exact strings):
 *
 *   kind="finished" — label revised per Obs 8 / ticket 86c9zfmgg:
 *     off                    → "Hide finished"             (click WILL hide)
 *     on  + 0 hidden         → "Show finished — none yet"  (click WILL show)
 *     on  + 1 hidden         → "Show finished — 1 hidden"
 *     on  + N>1 hidden       → "Show finished — N hidden"
 *
 *   kind="idle" — labels per spec 86c9zmyef §7.3:
 *     off                    → "Hide idle"
 *     on  + 0 hidden         → "Show idle — none yet"
 *     on  + 1 hidden         → "Show idle — 1 hidden"
 *     on  + N>1 hidden       → "Show idle — N hidden"
 *
 * Click + Enter + Space on the toggle fire `ui:set-config` with the
 * appropriate `key` literal and the toggled value. Optimistic UI flips the
 * chip immediately; the next `state:full` from the host re-confirms.
 *
 * Source: team/iris-ux/m5-hide-finished-spec.md §4, §5, §6, §7
 *         team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md §3, §7
 *         .claude/docs/vscode-extension-conventions.md "Webview rules"
 */

import type { WebviewMessage } from "../../shared/messages.js";

// Em-dash (U+2014) — single source so callers / tests can match exactly.
const EM_DASH = "—";

/**
 * Discriminator selecting the chip's vocabulary + config-key binding.
 * Adding a third filter (e.g. `error`) means extending this union, adding a
 * row to `CHIP_COPY`, and extending `SetConfigMessage.payload.key` host-side.
 */
export type HeaderChipKind = "finished" | "idle";

/**
 * Per-kind static vocabulary. Centralizes the verb (finished / idle), the
 * config-key literal posted to the host, and the data-attribute names so the
 * shared render path doesn't sprinkle string branches.
 *
 * `dataKey` / `dataCountKey` exactly mirror the names the existing M5 tests
 * assert against (`data-hide-finished`, `data-hidden-count`); the `idle`
 * variant uses `data-hide-idle` / `data-hidden-idle-count` per spec 86c9zmyef
 * §7.2.
 */
interface ChipCopy {
  /** State noun used in the label ("finished" / "idle"). */
  noun: string;
  /** Config key literal posted to the host via `ui:set-config`. */
  configKey: "hideFinishedAgents" | "hideIdleAgents";
  /** CSS dataset key for the data attribute (`hideFinished` / `hideIdle`). */
  dataKey: "hideFinished" | "hideIdle";
  /**
   * CSS dataset key for the count attribute (`hiddenCount` /
   * `hiddenIdleCount`). M5's existing chip used `hiddenCount`; the idle
   * variant uses a distinct key per spec 86c9zmyef §7.2 so CSS / DOM-queries
   * can target either chip unambiguously when both render together.
   */
  dataCountKey: "hiddenCount" | "hiddenIdleCount";
}

const CHIP_COPY: Record<HeaderChipKind, ChipCopy> = {
  finished: {
    noun: "finished",
    configKey: "hideFinishedAgents",
    dataKey: "hideFinished",
    dataCountKey: "hiddenCount",
  },
  idle: {
    noun: "idle",
    configKey: "hideIdleAgents",
    dataKey: "hideIdle",
    dataCountKey: "hiddenIdleCount",
  },
};

export interface HeaderChipProps {
  /**
   * Which filter this chip controls. M5 default = `"finished"` for
   * back-compat with pre-86c9zqa75 callers / tests; 86c9zqa75 introduces
   * `"idle"` for the running-focused dashboard spec.
   */
  kind?: HeaderChipKind;
  /** Current filter state (per `state.config?.{configKey} ?? false`). */
  hideFinished: boolean;
  /**
   * Count of tiles hidden this tick (per `state.{countField} ?? 0`). Always 0
   * when `hideFinished === false` per the host contract. Webview renders 0
   * even if the host violates the contract.
   */
  hiddenCount: number;
  /** Webview → host message dispatcher (the chip posts `ui:set-config`). */
  postMessage: (msg: WebviewMessage) => void;
}

/**
 * Render the header chip. Always returns an element — the caller mounts it
 * unconditionally per spec §4.6 (chip is discoverable even when the
 * dashboard is empty).
 */
export function renderHeaderChip(props: HeaderChipProps): HTMLElement {
  const { kind = "finished", hideFinished, hiddenCount, postMessage } = props;
  const copy = CHIP_COPY[kind];

  // Outer <aside> — semantically a tangential utility control. Screen readers
  // can skip via landmark navigation.
  const chip = document.createElement("aside");
  chip.className = "ct-header-chip";
  // Dataset key varies per kind so the two chips (finished + idle) render
  // side-by-side with disambiguable selectors. The `data-hide-finished`
  // attribute is the M5 baseline — kept as-is so existing CSS / tests
  // continue to match. The idle variant uses `data-hide-idle`.
  chip.dataset[copy.dataKey] = String(hideFinished);
  // Stringified for the CSS `[data-hidden-count="0"]` selector (M5 §6.1).
  chip.dataset[copy.dataCountKey] = String(hiddenCount);

  // Inner <button> — carries the chrome + ARIA toggle role.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ct-header-chip-toggle";
  toggle.setAttribute("aria-pressed", String(hideFinished));
  toggle.title = hideFinished
    ? `Show ${copy.noun} agents`
    : `Hide ${copy.noun} agents`;

  // Label — state-toggling text. Describes the action the click WILL TAKE,
  // not the current state (M5 §Obs 8 / 86c9zfmgg; carried over to the idle
  // variant per spec 86c9zmyef §7.3).
  const label = document.createElement("span");
  label.className = "ct-header-chip-label";
  label.textContent = labelTextForState(hideFinished, hiddenCount, kind);
  toggle.appendChild(label);

  // Count span — kept as a separate element for future expansions (per-state
  // colored badge, etc.). Currently always-empty + hidden; the count is
  // embedded in the label text. Reserved per M5 §7.2 (`ct-header-chip-count`).
  const count = document.createElement("span");
  count.className = "ct-header-chip-count";
  count.hidden = true;
  count.textContent = "";
  toggle.appendChild(count);

  chip.appendChild(toggle);

  // -------------------------------------------------------------------------
  // Interaction — click / Enter / Space all post `ui:set-config` with the
  // toggled value. Optimistic UI flips the chip immediately so the user
  // sees instant feedback; the next `state:full` re-confirms.
  // -------------------------------------------------------------------------
  const onActivate = (): void => {
    const newValue = !hideFinished;
    const msg: WebviewMessage = {
      type: "ui:set-config",
      payload: {
        key: copy.configKey,
        value: newValue,
      },
    };
    postMessage(msg);

    // Optimistic UI — flip immediately. The next host `state:full` will
    // re-render with the authoritative state from `state.config` (so if
    // the host fails to apply for any reason, the next render restores
    // truth — eventual consistency).
    chip.dataset[copy.dataKey] = String(newValue);
    toggle.setAttribute("aria-pressed", String(newValue));
    toggle.title = newValue
      ? `Show ${copy.noun} agents`
      : `Hide ${copy.noun} agents`;
    // After optimistic flip the count is unknown locally — let the host
    // re-emit. We do NOT speculatively update label text because the count
    // would lie until the next state:full.
  };

  toggle.addEventListener("click", onActivate);
  // Native <button> already handles Enter + Space — no extra keydown hook
  // needed.

  return chip;
}

/**
 * Compute the chip's label string from the props. Exported for unit tests
 * so the spec §5.2 / §7.3 label templates can be asserted directly.
 *
 * **Label convention (M5 Obs 8 / 86c9zfmgg, carried over to the idle variant
 * per spec 86c9zmyef §7.3):** the label describes the action the click WILL
 * TAKE, not the current state. When filter is OFF (tiles VISIBLE), clicking
 * will hide them → label "Hide <noun>". When filter is ON (tiles HIDDEN),
 * clicking will show them → label "Show <noun> — N hidden". The count
 * phrase stays on the ON branch.
 *
 * Edge case (M5 §4.2 row 2 — "impossible by §3.2 contract"): when
 * `hideFinished === false` but `hiddenCount > 0`, the host has violated
 * the contract. Render as if N=0 (the off label).
 *
 * Back-compat: `kind` defaults to `"finished"` so pre-86c9zqa75 callers /
 * tests that pass two arguments continue to render the M5 vocabulary.
 */
export function labelTextForState(
  hideFinished: boolean,
  hiddenCount: number,
  kind: HeaderChipKind = "finished",
): string {
  const { noun } = CHIP_COPY[kind];
  if (!hideFinished) {
    return `Hide ${noun}`;
  }
  if (hiddenCount <= 0) {
    return `Show ${noun} ${EM_DASH} none yet`;
  }
  if (hiddenCount === 1) {
    return `Show ${noun} ${EM_DASH} 1 hidden`;
  }
  return `Show ${noun} ${EM_DASH} ${hiddenCount} hidden`;
}
