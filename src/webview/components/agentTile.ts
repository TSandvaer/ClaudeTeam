/**
 * agentTile — renders one rostered AgentTile per Iris's M2-03 §5 spec.
 *
 * DOM shape (exact, matches §5.2):
 *
 *   <article class="agent-tile" data-state data-agent-id data-session-id
 *            role="button" tabindex="0" aria-label="...">
 *     <div class="tile-row tile-row--primary">
 *       <span class="state-dot" data-state aria-label title></span>
 *       <span class="agent-display">{display}</span>
 *     </div>
 *     <div class="tile-row tile-row--role">
 *       <span class="agent-role">{role}</span>
 *     </div>
 *     <div class="tile-row tile-row--activity">
 *       <span class="agent-activity">{activity}</span>
 *     </div>
 *     <div class="tile-row tile-row--model">
 *       <span class="agent-model">{model}</span>
 *     </div>
 *   </article>
 *
 * Click + Enter/Space dispatch `ui:open-transcript` via the injected
 * `postMessage` function. The dispatch is decoupled from the DOM so tests can
 * inspect the message without faking the VS Code API.
 *
 * Activity text is NOT truncated (D1 — spec §2 divergence): CSS `word-break:
 * break-word` handles overflow. The presenter contract is "render the full
 * string; let CSS wrap."
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §5 (Agent tile)
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC4, AC6
 */

import type { AgentTile, AgentState } from "../../shared/types.js";
import type { OpenTranscriptMessage } from "../../shared/messages.js";
import { formatFreshness } from "../freshness.js";

/** Human-readable label per state — used in aria-label and title tooltip. */
const STATE_LABEL: Record<AgentState, string> = {
  running: "Running",
  idle: "Idle",
  finished: "Finished",
  error: "Error",
};

/** Function the tile uses to dispatch webview → host messages. */
export type PostMessageFn = (msg: OpenTranscriptMessage) => void;

export interface AgentTileProps {
  tile: AgentTile;
  sessionId: string;
  postMessage: PostMessageFn;
  /**
   * Wall-clock epoch ms when the webview FIRST observed this tile in
   * `finished` state. Used only when `tile.state === "finished"` to render
   * a freshness suffix (`finished Xs / Xm / Xh`) parallel to the host-side
   * `idle Xs` convention.
   *
   * The caller (render.ts → main.ts) owns the tracker; this component is a
   * pure renderer. When omitted (or when the tile is not finished), the
   * activity field renders verbatim from `tile.activity` — back-compat with
   * pre-NIT#3 callers and with non-finished states.
   *
   * `nowMs` is also injected so tests don't need to mock `Date.now()`.
   * Defaults to `Date.now()` in production.
   *
   * Source: ClickUp 86c9ybtut (M3-04 NIT #3)
   */
  finishedAtMs?: number;
  /** Current wall-clock ms — defaults to Date.now(). Test injection point. */
  nowMs?: number;
}

export function renderAgentTile(props: AgentTileProps): HTMLElement {
  const { tile, sessionId, postMessage, finishedAtMs, nowMs } = props;

  // Compose the activity text — for finished tiles with a tracked first-seen
  // timestamp, suffix with " Xs / Xm / Xh" for freshness visibility (NIT #3).
  // Stale tiles look identical to fresh-finished tiles without this signal —
  // sponsor flagged the gap from the 2026-05-24 screenshot (Iris's tile
  // showed bare "finished" alongside Maya's "idle 14s" / Bram's "idle 47s").
  const activityText =
    tile.state === "finished" && typeof finishedAtMs === "number"
      ? `${tile.activity} ${formatFreshness((nowMs ?? Date.now()) - finishedAtMs)}`
      : tile.activity;

  const article = document.createElement("article");
  article.className = "agent-tile";
  article.dataset.state = tile.state;
  article.dataset.agentId = tile.agentId;
  article.dataset.sessionId = sessionId;
  article.setAttribute("role", "button");
  article.setAttribute("tabindex", "0");
  article.setAttribute(
    "aria-label",
    `${tile.display} — ${tile.role} — ${STATE_LABEL[tile.state]}`,
  );

  // Row 1 — state dot + display name (primary row).
  const primaryRow = document.createElement("div");
  primaryRow.className = "tile-row tile-row--primary";

  const dot = document.createElement("span");
  dot.className = "state-dot";
  dot.dataset.state = tile.state;
  dot.setAttribute("aria-label", STATE_LABEL[tile.state]);
  dot.setAttribute("title", STATE_LABEL[tile.state]);
  primaryRow.appendChild(dot);

  const displaySpan = document.createElement("span");
  displaySpan.className = "agent-display";
  displaySpan.textContent = tile.display;
  primaryRow.appendChild(displaySpan);

  article.appendChild(primaryRow);

  // Row 2 — role.
  article.appendChild(
    buildRow("tile-row--role", "agent-role", tile.role),
  );

  // Row 3 — activity (no truncation, CSS wraps).
  article.appendChild(
    buildRow("tile-row--activity", "agent-activity", activityText),
  );

  // Row 4 — model.
  article.appendChild(
    buildRow("tile-row--model", "agent-model", tile.model),
  );

  // Click + keyboard handlers — both produce the same message. AC6 of M2-05.
  // tabindex="0" + role="button" makes Enter/Space the expected key activations.
  const fire = (): void => {
    const msg: OpenTranscriptMessage = {
      type: "ui:open-transcript",
      payload: { sessionId, agentId: tile.agentId },
    };
    postMessage(msg);
  };

  article.addEventListener("click", fire);
  article.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fire();
    }
  });

  return article;
}

function buildRow(
  rowClass: string,
  innerClass: string,
  text: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `tile-row ${rowClass}`;
  const span = document.createElement("span");
  span.className = innerClass;
  span.textContent = text;
  row.appendChild(span);
  return row;
}
