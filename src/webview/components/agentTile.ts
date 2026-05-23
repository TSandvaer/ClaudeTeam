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
}

export function renderAgentTile(props: AgentTileProps): HTMLElement {
  const { tile, sessionId, postMessage } = props;

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
    buildRow("tile-row--activity", "agent-activity", tile.activity),
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
