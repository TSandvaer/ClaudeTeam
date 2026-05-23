/**
 * backgroundChip — collapsible chip listing unrostered agents per spec §7.
 *
 * Collapsed (default):
 *   <div class="background-chip" data-session-id data-expanded="false">
 *     <button class="chip-header" aria-expanded="false" aria-controls="bg-list-{sid}">
 *       <span class="chip-count">+ {N} background agents</span>
 *       <span class="chip-chevron" aria-hidden="true">▶</span>
 *     </button>
 *     <ul class="chip-detail-list" id="bg-list-{sid}" hidden>...</ul>
 *   </div>
 *
 * Toggle:
 *   - Click on chip-header → flip data-expanded, flip aria-expanded, flip
 *     chevron glyph, add/remove the `hidden` attribute on the detail list.
 *   - No animation (M4 scope).
 *
 * Suppression: callers must NOT invoke this for empty background lists. The
 * chip renders the count always — if the count is 0, the chip itself shouldn't
 * appear (per spec §7.3 suppression rule).
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §7
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC5
 */

import type { BackgroundAgent } from "../../shared/types.js";

export interface BackgroundChipProps {
  sessionId: string;
  agents: BackgroundAgent[];
}

export function renderBackgroundChip(props: BackgroundChipProps): HTMLElement {
  const { sessionId, agents } = props;

  const chip = document.createElement("div");
  chip.className = "background-chip";
  chip.dataset.sessionId = sessionId;
  chip.dataset.expanded = "false";

  const listId = `bg-list-${sessionId}`;

  const headerBtn = document.createElement("button");
  headerBtn.className = "chip-header";
  headerBtn.type = "button";
  headerBtn.setAttribute("aria-expanded", "false");
  headerBtn.setAttribute("aria-controls", listId);

  const countSpan = document.createElement("span");
  countSpan.className = "chip-count";
  countSpan.textContent = `+ ${agents.length} background agents`;
  headerBtn.appendChild(countSpan);

  const chevron = document.createElement("span");
  chevron.className = "chip-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "▶";
  headerBtn.appendChild(chevron);

  chip.appendChild(headerBtn);

  // Detail list — collapsed by default. `hidden` attribute is removed on
  // expand; CSS does not animate.
  const list = document.createElement("ul");
  list.className = "chip-detail-list";
  list.id = listId;
  list.hidden = true;

  for (const agent of agents) {
    const li = document.createElement("li");
    li.className = "bg-agent-row";

    const typeSpan = document.createElement("span");
    typeSpan.className = "bg-agent-type";
    typeSpan.textContent = agent.agentType;

    const descSpan = document.createElement("span");
    descSpan.className = "bg-agent-description";
    descSpan.textContent = `"${agent.description}"`;

    const stateSpan = document.createElement("span");
    stateSpan.className = "bg-agent-state";
    stateSpan.textContent = agent.state;

    const modelSpan = document.createElement("span");
    modelSpan.className = "bg-agent-model";
    modelSpan.textContent = agent.model;

    li.appendChild(typeSpan);
    li.appendChild(descSpan);
    li.appendChild(stateSpan);
    li.appendChild(modelSpan);
    list.appendChild(li);
  }

  chip.appendChild(list);

  // Toggle handler — webview-local UI state per spec §7.3 (no host message).
  headerBtn.addEventListener("click", () => {
    const expanded = chip.dataset.expanded === "true";
    const next = !expanded;
    chip.dataset.expanded = String(next);
    headerBtn.setAttribute("aria-expanded", String(next));
    chevron.textContent = next ? "▼" : "▶";
    list.hidden = !next;
  });

  return chip;
}
