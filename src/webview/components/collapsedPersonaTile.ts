/**
 * collapsedPersonaTile — renders one CollapsedPersonaGroup as a header tile
 * with an expand/collapse chevron + (when expanded) the list of grouped
 * AgentTile instances rendered via the existing `renderAgentTile` (M3-10
 * AC2).
 *
 * DOM shape:
 *
 *   <section class="collapsed-persona" data-persona-name data-expanded
 *            data-team-id?>
 *     <button class="collapsed-persona-header" type="button"
 *             aria-expanded="false">
 *       <span class="collapsed-persona-chevron">▶</span>
 *       <span class="collapsed-persona-name">{personaName} ×{count}</span>
 *     </button>
 *     <div class="collapsed-persona-instances" hidden>
 *       {one renderAgentTile per instance}
 *     </div>
 *   </section>
 *
 * Interaction (AC2):
 *   - Collapsed by default — `data-expanded="false"`, instances `hidden`.
 *   - Click chevron/header → flip to expanded; instances render and become
 *     visible. Per-tile click handlers continue to fire drill-in messages
 *     unchanged (back-compat with the existing renderAgentTile contract).
 *   - Click again → collapse.
 *
 * Why a section (not an article): one CollapsedPersonaGroup is not a single
 * tile but a grouping of tiles. `article` is reserved for the per-instance
 * AgentTile. The aria semantics flow from the button (`aria-expanded`).
 *
 * Theme variables only — `--vscode-list-hoverBackground`, `--vscode-foreground`,
 * `--vscode-descriptionForeground`. No hardcoded colors.
 *
 * Source: ClickUp 86c9ydug9 (M3-10 persona-tile-collapse) AC2
 *         src/shared/types.ts CollapsedPersonaGroup
 *         src/webview/components/agentTile.ts (per-instance renderer)
 */

import type {
  AgentTile,
  CollapsedPersonaGroup,
} from "../../shared/types.js";
import { renderAgentTile, type PostMessageFn } from "./agentTile.js";
import type { FinishedTracker } from "../finishedTracker.js";

export interface CollapsedPersonaTileProps {
  group: CollapsedPersonaGroup;
  /** Session id passed through to each per-instance tile renderer. */
  sessionId: string;
  /** Webview → host postMessage fn passed through to instances. */
  postMessage: PostMessageFn;
  /**
   * Optional finished-tile tracker, threaded to per-instance tiles. When the
   * wrapper is collapsed the tracker is NOT consulted (the instances aren't
   * in the DOM yet); when expanded each finished instance observes via the
   * tracker exactly as it does in the bare-tile path.
   */
  finishedTracker?: FinishedTracker;
  /** Current wall-clock ms — defaults to Date.now() inside agentTile. */
  nowMs?: number;
}

export function renderCollapsedPersonaTile(
  props: CollapsedPersonaTileProps,
): HTMLElement {
  const { group, sessionId, postMessage, finishedTracker, nowMs } = props;

  const section = document.createElement("section");
  section.className = "collapsed-persona";
  section.dataset.personaName = group.personaName;
  section.dataset.expanded = "false";

  // Header — a real <button> so the keyboard / screen-reader semantics are
  // free (Enter + Space activation, focus ring, role=button).
  const header = document.createElement("button");
  header.type = "button";
  header.className = "collapsed-persona-header";
  header.setAttribute("aria-expanded", "false");
  header.setAttribute(
    "aria-label",
    `${group.personaName} grouped — ${group.count} instances, collapsed`,
  );

  const chevron = document.createElement("span");
  chevron.className = "collapsed-persona-chevron";
  chevron.textContent = "▶";
  chevron.setAttribute("aria-hidden", "true");
  header.appendChild(chevron);

  const nameSpan = document.createElement("span");
  nameSpan.className = "collapsed-persona-name";
  nameSpan.textContent = `${group.personaName} ×${group.count}`;
  header.appendChild(nameSpan);

  section.appendChild(header);

  // Instances container — populated lazily on first expand; once populated
  // it stays in the DOM (toggling `hidden`) so subsequent expand/collapse
  // cycles don't churn the per-instance tile state (e.g. tile :hover).
  const instancesDiv = document.createElement("div");
  instancesDiv.className = "collapsed-persona-instances";
  instancesDiv.hidden = true;
  section.appendChild(instancesDiv);

  let populated = false;

  const populateInstances = (): void => {
    if (populated) return;
    const now = nowMs ?? Date.now();
    for (const tile of group.instances) {
      const finishedAtMs =
        tile.state === "finished" && finishedTracker
          ? finishedTracker.observe(sessionId, tile.agentId, now)
          : undefined;
      instancesDiv.appendChild(
        renderAgentTile({
          tile,
          sessionId,
          postMessage,
          ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
          nowMs: now,
        }),
      );
    }
    populated = true;
  };

  const setExpanded = (expanded: boolean): void => {
    section.dataset.expanded = String(expanded);
    header.setAttribute("aria-expanded", String(expanded));
    header.setAttribute(
      "aria-label",
      `${group.personaName} grouped — ${group.count} instances, ${
        expanded ? "expanded" : "collapsed"
      }`,
    );
    chevron.textContent = expanded ? "▼" : "▶";
    if (expanded) {
      populateInstances();
    }
    instancesDiv.hidden = !expanded;
  };

  header.addEventListener("click", () => {
    setExpanded(section.dataset.expanded !== "true");
  });

  return section;
}

/**
 * Type-narrowing helper used by callers (teamCard) to route per-entry between
 * the collapsed-persona renderer and the bare-tile renderer. The wrapper has
 * a `kind` discriminator; an `AgentTile` does not.
 */
export function isCollapsedPersonaGroup(
  entry: AgentTile | CollapsedPersonaGroup,
): entry is CollapsedPersonaGroup {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry as { kind?: unknown }).kind === "collapsed-persona"
  );
}
