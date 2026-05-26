/**
 * headerChip — M5 hide-finished header chip rendered above session blocks.
 *
 * Sponsor-controlled filter that suppresses `finished`-state agent tiles
 * once an agent's work has terminated. Pairs the VS Code
 * `claudeteam.hideFinishedAgents` config scalar with an in-dashboard toggle
 * so the sponsor can flip the filter without leaving the pane.
 *
 * Spec — team/iris-ux/m5-hide-finished-spec.md §4 (header chip), §5
 * (hidden-count surface), §6 (visual treatment), §7 (vocabulary contract).
 *
 * Mount position (top → bottom — see render.ts §empty-branch + spec §4.1):
 *   1. rosterErrorChip       (M3-04 — when state.rosterErrors non-empty)
 *   2. legacy errorChip      (M2-05 — event-driven)
 *   3. **headerChip**        (M5 — NEW)
 *   4. session blocks        (one per session) — OR emptyState when none
 *
 * The chip ALWAYS renders (both with-sessions and empty branches) so the
 * toggle is discoverable in an otherwise-empty dashboard. See spec §4.6.
 *
 * State table (spec §4.2, label revised per Obs 8 / ticket 86c9zfmgg —
 * label describes the action the click WILL TAKE, not the current state;
 * sponsor verbatim 2026-05-26: *"If i click the 'Hide finished x hidden'
 * button, that should be named 'show finished x hidden'."*):
 *
 *   data-hide-finished | hiddenCount | label rendered            | aria-pressed
 *   -------------------|-------------|---------------------------|--------------
 *   "false"            | 0           | "Hide finished"           | false   (click WILL hide)
 *   "true"             | 0           | "Show finished — none yet"| true    (click WILL show)
 *   "true"             | 1           | "Show finished — 1 hidden"| true    (click WILL show)
 *   "true"             | N>1         | "Show finished — N hidden"| true    (click WILL show)
 *
 * Interaction (spec §4.3):
 *   - Click + Enter + Space on the toggle fire `ui:set-config` with the
 *     toggled value. Optimistic UI flips the chip immediately; the next
 *     `state:full` from the host re-confirms authoritatively.
 *
 * Source: team/iris-ux/m5-hide-finished-spec.md §4, §5, §6, §7
 *         .claude/docs/vscode-extension-conventions.md "Webview rules"
 */

import type { WebviewMessage } from "../../shared/messages.js";

// Em-dash (U+2014) — single source so callers / tests can match exactly.
// Spec §7.3 fixes the label strings verbatim.
const EM_DASH = "—";

export interface HeaderChipProps {
  /** Current filter state (per `state.config?.hideFinishedAgents ?? false`). */
  hideFinished: boolean;
  /**
   * Count of finished tiles hidden this tick (per `state.hiddenFinishedCount
   * ?? 0`). Always 0 when `hideFinished === false` per the host contract
   * (spec §3.2). Webview renders 0 even if the host violates the contract.
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
  const { hideFinished, hiddenCount, postMessage } = props;

  // Outer <aside> — semantically a tangential utility control per spec §4.2.
  // Screen readers can skip via landmark navigation.
  const chip = document.createElement("aside");
  chip.className = "ct-header-chip";
  chip.dataset.hideFinished = String(hideFinished);
  // Stringified for CSS `[data-hidden-count="0"]` selector (spec §6.1).
  chip.dataset.hiddenCount = String(hiddenCount);

  // Inner <button> — carries the chrome + ARIA toggle role.
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ct-header-chip-toggle";
  toggle.setAttribute("aria-pressed", String(hideFinished));
  toggle.title = hideFinished
    ? "Show finished agents"
    : "Hide finished agents";

  // Label — verbal portion. Static "Hide finished" prefix; the count phrase
  // is the count span (separately hidable).
  const label = document.createElement("span");
  label.className = "ct-header-chip-label";
  label.textContent = labelTextForState(hideFinished, hiddenCount);
  toggle.appendChild(label);

  // Count span — kept as a separate element so future expansions (per-state
  // colored badge, etc.) have a hook. Currently always-empty + hidden;
  // the count is embedded in the label text. Reserved for future use per
  // spec §7.2 (`ct-header-chip-count` class). Hidden on render.
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

    // The `SetConfigMessage` member is contributed by Felix's M5-EH PR to
    // the `WebviewMessage` union in `src/shared/messages.ts` (spec §4.5 /
    // §7.1 vocabulary contract). Until that lands the union does NOT
    // include this discriminator, so the cast goes through `unknown` to
    // satisfy the structural overlap check. Post-merge of Felix's PR, the
    // cast can be tightened to a direct typed literal (no `unknown`
    // step) — filed as a tidy follow-up rather than a blocker. The literal
    // shape here matches spec §7.3 verbatim: { type: "ui:set-config",
    // payload: { key: "hideFinishedAgents", value: boolean } }.
    const msg = {
      type: "ui:set-config" as const,
      payload: {
        key: "hideFinishedAgents" as const,
        value: newValue,
      },
    };
    postMessage(msg as unknown as WebviewMessage);

    // Optimistic UI — flip immediately. The next host `state:full` will
    // re-render with the authoritative state from `state.config` (so if
    // the host fails to apply for any reason, the next render restores
    // truth — eventual consistency).
    chip.dataset.hideFinished = String(newValue);
    toggle.setAttribute("aria-pressed", String(newValue));
    toggle.title = newValue ? "Show finished agents" : "Hide finished agents";
    // After optimistic flip the count is unknown locally — let the host
    // re-emit. We do NOT speculatively update label text because the count
    // would lie until the next state:full.
  };

  toggle.addEventListener("click", onActivate);
  // Native <button> already handles Enter + Space — no extra keydown hook
  // needed. (Spec §4.3: "native button semantics give Enter + Space free.")

  return chip;
}

/**
 * Compute the chip's label string from the props. Exported for unit tests
 * so the spec §5.2 / §7.3 label templates can be asserted directly.
 *
 * **Label convention (revised — ticket `86c9zfmgg` / Obs 8):** the label
 * describes the action the click WILL TAKE, not the current state. This
 * matches the sponsor's mental model — "the button names what happens
 * next." When filter is OFF (finished VISIBLE), clicking will hide them →
 * label "Hide finished". When filter is ON (finished HIDDEN), clicking
 * will show them → label "Show finished — N hidden". The count phrase
 * stays on the ON branch (the user wants to know HOW MANY are hidden
 * before deciding to reveal them).
 *
 * Templates (em-dash U+2014):
 *   filter off                  → "Hide finished"
 *   filter on  + 0 hidden       → "Show finished — none yet"
 *   filter on  + 1 hidden       → "Show finished — 1 hidden"
 *   filter on  + N>1 hidden     → "Show finished — N hidden"
 *
 * Edge case (spec §4.2 row 2 — "impossible by §3.2 contract"): when
 * `hideFinished === false` but `hiddenCount > 0`, the host has violated
 * the contract. Render as if N=0 (the off label) per spec guidance.
 */
export function labelTextForState(
  hideFinished: boolean,
  hiddenCount: number,
): string {
  if (!hideFinished) {
    return "Hide finished";
  }
  if (hiddenCount <= 0) {
    return `Show finished ${EM_DASH} none yet`;
  }
  if (hiddenCount === 1) {
    return `Show finished ${EM_DASH} 1 hidden`;
  }
  return `Show finished ${EM_DASH} ${hiddenCount} hidden`;
}
