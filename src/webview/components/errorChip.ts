/**
 * errorChip — renders the roster/file-watcher error chip per spec §8.
 *
 * Two subtypes:
 *   - error   — uses --vscode-inputValidation-error* variables
 *   - warning — uses --vscode-inputValidation-warning* variables (no Open
 *               Roster button; dismissable via × close)
 *
 * Both subtypes render:
 *   <div class="error-chip error-chip--{level}" role="alert" aria-live="polite">
 *     <span class="error-chip-icon" aria-hidden="true">!</span>
 *     <div class="error-chip-body">
 *       <span class="error-chip-title">{title}</span>
 *       <span class="error-chip-detail">{detail}</span>
 *       {optional <button class="error-chip-action">Open Roster File</button>}
 *     </div>
 *   </div>
 *
 * The "Open Roster File" button dispatches `ui:open-roster`. Warning-level
 * chips include a dismiss × button that hides the chip via ephemeral webview
 * state (no host message — the warning hide is a local UI affordance only).
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §8 (Error UI)
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC11 (Self-Test error UI)
 */

import type {
  OpenRosterMessage,
  WebviewMessage,
} from "../../shared/messages.js";

export type ErrorChipLevel = "error" | "warning";

export interface ErrorChipProps {
  level: ErrorChipLevel;
  title: string;
  detail: string;
  /**
   * When true, renders an "Open Roster File" button that dispatches
   * `ui:open-roster`. Set only for malformed-YAML errors (spec §8.1) — NOT for
   * generic file-watcher errors (§8.2).
   */
  showOpenRosterButton?: boolean;
  /** Webview → host message dispatcher (Open Roster button). */
  postMessage?: (msg: WebviewMessage) => void;
}

export function renderErrorChip(props: ErrorChipProps): HTMLElement {
  const { level, title, detail, showOpenRosterButton, postMessage } = props;

  const chip = document.createElement("div");
  chip.className = `error-chip error-chip--${level}`;
  chip.setAttribute("role", "alert");
  chip.setAttribute("aria-live", "polite");

  const icon = document.createElement("span");
  icon.className = "error-chip-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "!";
  chip.appendChild(icon);

  const body = document.createElement("div");
  body.className = "error-chip-body";

  const titleSpan = document.createElement("span");
  titleSpan.className = "error-chip-title";
  titleSpan.textContent = title;
  body.appendChild(titleSpan);

  const detailSpan = document.createElement("span");
  detailSpan.className = "error-chip-detail";
  detailSpan.textContent = detail;
  body.appendChild(detailSpan);

  if (showOpenRosterButton) {
    const action = document.createElement("button");
    action.type = "button";
    action.className = "error-chip-action";
    action.textContent = "Open Roster File";
    action.addEventListener("click", () => {
      const msg: OpenRosterMessage = { type: "ui:open-roster" };
      postMessage?.(msg);
    });
    body.appendChild(action);
  }

  chip.appendChild(body);

  // Warning chips include a dismiss × button (spec §8.1 "Roster warning").
  // Dismiss is webview-local; no host roundtrip needed.
  if (level === "warning") {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "error-chip-dismiss";
    dismiss.setAttribute("aria-label", "Dismiss warning");
    dismiss.textContent = "×";
    dismiss.addEventListener("click", () => {
      chip.remove();
    });
    chip.appendChild(dismiss);
  }

  return chip;
}
