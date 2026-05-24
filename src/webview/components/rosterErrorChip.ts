/**
 * rosterErrorChip — M3-04 roster-error chip rendered at the top of the
 * dashboard when `DashboardState.rosterErrors` is non-empty.
 *
 * Distinct from `errorChip.ts` (M2-05 generic chip): this chip is data-driven
 * from the periodic state stream rather than an event-fired one-shot, so its
 * lifecycle ("dismiss until the error message changes") is tied to the AgentTree
 * payload — not to a `roster:error` MessageEvent that arrives once and is gone.
 *
 * AC1 — render when `rosterErrors` is non-empty. Uses the same
 *   `--vscode-inputValidation-error*` palette as M2-05's chip (semantic-error
 *   per Iris's M2-03 spec §8.3). The codicon used for the icon is the same
 *   `!`-in-circle glyph; per M3-04 OOS we do NOT add a new codicon font.
 *
 * AC1 — per-session dismissible. Clicking × hides the chip until the FIRST
 *   error message string changes. The caller threads a stable string key
 *   (the chip body) into `lastDismissedFor` so subsequent renders with the
 *   same key short-circuit. When the chip body changes (e.g. user adds a
 *   new error), the dismissed-state is cleared because the dismiss-key no
 *   longer matches.
 *
 * AC2 — first error verbatim + " (+N more)" suffix if `errors.length > 1`.
 *   Clicking the chip body toggles a details panel listing every error.
 *   The toggle is webview-local state (no host roundtrip) tracked on the
 *   chip element via the `data-expanded` attribute, parallel to the
 *   `backgroundChip` toggle pattern (M2-05).
 *
 * AC3 — "Edit Roster" button dispatches `{ type: "ui:open-roster" }`. The
 *   host handler (M3-02) opens / auto-creates `~/.claudeteam/teams.yaml`.
 *
 * Source: team/nora-pl/milestone-3-backlog.md § M3-04 AC1-3, AC5
 *         team/iris-ux/m2-dashboard-tile-spec.md § 8 (Error UI)
 *         .claude/docs/roster-matching.md § Loader edge cases
 */

import type {
  OpenRosterMessage,
  WebviewMessage,
} from "../../shared/messages.js";

export interface RosterErrorChipProps {
  /**
   * Loader errors verbatim. Must be non-empty for the chip to render — the
   * caller (`render.ts`) is responsible for skipping the chip when the
   * array is empty. (We DO render `null` when empty here as a safety net,
   * but the caller should short-circuit so the layout doesn't allocate.)
   */
  errors: string[];
  /**
   * Stable key tracking the most recently dismissed error message. When
   * the renderer passes `dismissedKey === firstError`, the chip suppresses
   * itself; on the next render where the first error differs, the chip
   * re-appears.
   *
   * The render context owns this state (defined in `render.ts` /
   * `main.ts` — webview-local ephemeral state); the chip only consumes
   * + reports it via `onDismiss(key)`.
   */
  dismissedKey?: string | null;
  /** Webview → host message dispatcher (Edit Roster button). */
  postMessage?: (msg: WebviewMessage) => void;
  /**
   * Called when the user clicks ×. Caller stores the passed `key` so
   * subsequent renders with the same first-error short-circuit. The key
   * passed is always the FIRST error message (the chip's user-visible
   * identity); when the first error changes, the cached key no longer
   * matches → chip re-appears (AC1 re-show-on-change).
   */
  onDismiss?: (key: string) => void;
}

/**
 * Render the roster-error chip, or null when there are no errors OR when
 * the user has already dismissed the current first-error key.
 *
 * Returns null on the suppress path so callers can chain
 * `if (el) mount.appendChild(el)` without conditional logic in the caller.
 */
export function renderRosterErrorChip(
  props: RosterErrorChipProps,
): HTMLElement | null {
  const { errors, dismissedKey, postMessage, onDismiss } = props;

  if (errors.length === 0) {
    return null;
  }

  const firstError = errors[0]!;

  // AC1 re-show-on-change: dismissed only when the cached key matches the
  // CURRENT first error. Any change to the first error message clears the
  // suppress and the chip renders again.
  if (dismissedKey !== null && dismissedKey !== undefined && dismissedKey === firstError) {
    return null;
  }

  // The chip uses the same theme variables as the M2-05 generic chip
  // (`error-chip--error` class) — semantic-error palette per Iris's M2-03
  // spec §8.3. The `roster-error-chip` class lets CSS scope toggle/details
  // styling without touching the generic chip.
  const chip = document.createElement("div");
  chip.className = "error-chip error-chip--error roster-error-chip";
  chip.setAttribute("role", "alert");
  chip.setAttribute("aria-live", "polite");
  chip.dataset.expanded = "false";

  // Icon — reuse the M2-05 `!`-in-circle glyph for visual parity. M3-04 OOS:
  // no new codicon font — the chip body comment in errorChip.ts notes we
  // could swap to `codicon-warning`, but doing so here would force loading
  // the codicon font into the webview's CSP which currently denies it.
  const icon = document.createElement("span");
  icon.className = "error-chip-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  chip.appendChild(icon);

  // The chip body holds the click-to-expand surface, title, summary line,
  // optional details panel, and the Edit Roster button.
  const body = document.createElement("div");
  body.className = "error-chip-body roster-error-chip-body";
  body.setAttribute("role", "button");
  body.setAttribute("tabindex", "0");
  body.setAttribute("aria-expanded", "false");
  body.setAttribute(
    "aria-label",
    errors.length === 1
      ? "Roster error — click to expand details"
      : `Roster error — ${errors.length} total, click to expand details`,
  );

  const title = document.createElement("span");
  title.className = "error-chip-title";
  title.textContent = "Roster error";
  body.appendChild(title);

  // Summary — first error verbatim + "(+N more)" when multiple.
  const summary = document.createElement("span");
  summary.className = "error-chip-detail roster-error-chip-summary";
  if (errors.length === 1) {
    summary.textContent = firstError;
  } else {
    summary.textContent = `${firstError} (+${errors.length - 1} more)`;
  }
  body.appendChild(summary);

  // Details panel — always built (cheap; one <ul>), hidden until toggled.
  // Listing all errors here so the click-to-expand AC2 surface is in the
  // DOM at render-time (tests can query for it).
  const details = document.createElement("ul");
  details.className = "roster-error-chip-details";
  details.setAttribute("aria-label", "All roster errors");
  details.hidden = true;
  for (const err of errors) {
    const li = document.createElement("li");
    li.className = "roster-error-chip-detail-item";
    li.textContent = err;
    details.appendChild(li);
  }
  body.appendChild(details);

  // Edit Roster button — dispatches `ui:open-roster` to the host (M3-02
  // handler auto-creates / opens the file). Placed below the details
  // panel so clicking the panel area doesn't accidentally fire the button.
  const action = document.createElement("button");
  action.type = "button";
  action.className = "error-chip-action roster-error-chip-action";
  action.textContent = "Edit Roster";
  action.setAttribute("aria-label", "Open the roster file in the editor");
  action.addEventListener("click", (e) => {
    // Stop propagation so clicking the button doesn't also toggle the
    // details panel via the body's click handler below.
    e.stopPropagation();
    const msg: OpenRosterMessage = { type: "ui:open-roster" };
    postMessage?.(msg);
  });
  body.appendChild(action);

  // AC2 — clicking the body toggles the details panel. The handler is
  // attached to the body (not the chip) so the dismiss × button (a chip-
  // level sibling) doesn't trigger the toggle.
  const toggleDetails = (): void => {
    const willExpand = details.hidden;
    details.hidden = !willExpand;
    body.setAttribute("aria-expanded", String(willExpand));
    chip.dataset.expanded = String(willExpand);
  };
  body.addEventListener("click", (e) => {
    // If the click originated on the Edit Roster button, the button's own
    // handler already ran and called stopPropagation — guard belt-and-
    // suspenders against any future inner control whose click should NOT
    // toggle the details panel.
    const target = e.target as HTMLElement | null;
    if (target && target.classList.contains("roster-error-chip-action")) {
      return;
    }
    toggleDetails();
  });
  body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleDetails();
    }
  });

  chip.appendChild(body);

  // AC1 — × dismiss button. Per-session ephemeral state; the renderer is
  // responsible for storing the dismissed key. When the FIRST error
  // message changes, the cached key no longer matches and the chip
  // re-appears next render.
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "error-chip-dismiss roster-error-chip-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss roster error chip");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", (e) => {
    // Don't bubble into the body — that would toggle the details panel
    // immediately before removal, which flashes briefly to the user.
    e.stopPropagation();
    onDismiss?.(firstError);
    chip.remove();
  });
  chip.appendChild(dismiss);

  return chip;
}
