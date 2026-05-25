/**
 * collapsedPersonaTile — renders one CollapsedPersonaGroup as a header tile
 * with an expand/collapse chevron + (when expanded) the list of grouped
 * AgentTile instances rendered via the existing `renderAgentTile` (M3-10
 * AC2).
 *
 * DOM shape:
 *
 *   <section class="collapsed-persona" data-persona-name data-expanded>
 *     <button class="collapsed-persona-header" type="button"
 *             aria-expanded="false">
 *       <span class="collapsed-persona-chevron">▶</span>
 *       <span class="collapsed-persona-name">{personaName} ×{N}</span>
 *     </button>
 *     <div class="collapsed-persona-instances" hidden>
 *       {one renderAgentTile per instance}
 *     </div>
 *   </section>
 *
 * Where `{N}` is `group.instances.length` (see "Defensive count read"
 * below). The wrapper does NOT carry `data-team-id` — the teamId is known
 * at the `teamCard.ts` call-site but isn't currently needed inside the
 * wrapper's DOM; if a future feature needs it, thread it through
 * `CollapsedPersonaTileProps` and set `section.dataset.teamId` here.
 *
 * Interaction (AC2):
 *   - Collapsed by default — `data-expanded="false"`, instances `hidden`.
 *   - Click chevron/header → flip to expanded; instances render and become
 *     visible. Per-tile click handlers continue to fire drill-in messages
 *     unchanged (back-compat with the existing renderAgentTile contract).
 *   - Click again → collapse.
 *
 * Defensive count read:
 *   The header text and aria-label render `group.instances.length`, NOT
 *   `group.count`. The host-side reducer's invariant is
 *   `group.count === group.instances.length`, but reading from the array
 *   length means a host-side invariant violation surfaces as a wrong
 *   `count` field on the wire (one place) rather than a header that
 *   disagrees with the expanded list (two places, harder to diagnose).
 *   The `count` field stays in the type for the wire format and for
 *   host-side consumers that haven't been refactored yet; removing it is
 *   tracked separately as a post-Felix/Maya unification follow-up.
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
import type { PrevStateTracker } from "../prevStateTracker.js";

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
  /**
   * Optional webview-local last-rendered-state tracker (M4-05 §2.5).
   * Threaded through to per-instance tiles. Mirrors `finishedTracker` —
   * when the wrapper is collapsed the tracker is NOT consulted (the
   * instances aren't in the DOM yet); on first expand each instance reads
   * its previous state (undefined → no transition flash on first display)
   * and records the current state.
   */
  prevStateTracker?: PrevStateTracker;
  /** Current wall-clock ms — defaults to Date.now() inside agentTile. */
  nowMs?: number;
}

export function renderCollapsedPersonaTile(
  props: CollapsedPersonaTileProps,
): HTMLElement {
  const {
    group,
    sessionId,
    postMessage,
    finishedTracker,
    prevStateTracker,
    nowMs,
  } = props;

  const section = document.createElement("section");
  section.className = "collapsed-persona";
  section.dataset.personaName = group.personaName;
  section.dataset.expanded = "false";

  // Header — a real <button> so the keyboard / screen-reader semantics are
  // free (Enter + Space activation, focus ring, role=button).
  // Defensive: read count from the array (see file header JSDoc "Defensive
  // count read"). `group.count` is documented to equal `group.instances.length`
  // but reading from the array means a host invariant violation surfaces as a
  // wrong `count` field on the wire, not as a header that disagrees with the
  // expanded list.
  const instanceCount = group.instances.length;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "collapsed-persona-header";
  header.setAttribute("aria-expanded", "false");
  header.setAttribute(
    "aria-label",
    `${group.personaName} grouped — ${instanceCount} instances, collapsed`,
  );

  const chevron = document.createElement("span");
  chevron.className = "collapsed-persona-chevron";
  chevron.textContent = "▶";
  chevron.setAttribute("aria-hidden", "true");
  header.appendChild(chevron);

  const nameSpan = document.createElement("span");
  nameSpan.className = "collapsed-persona-name";
  nameSpan.textContent = `${group.personaName} ×${instanceCount}`;
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
      // M4-05 §2.5 — read previous state BEFORE rendering, record AFTER.
      // First time the wrapper expands for this instance, previous is
      // undefined → renderer skips the transition flash (correct: first
      // appearance is not a transition).
      const prevState = prevStateTracker?.previous(sessionId, tile.agentId);
      instancesDiv.appendChild(
        renderAgentTile({
          tile,
          sessionId,
          postMessage,
          ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
          ...(prevState !== undefined ? { prevState } : {}),
          nowMs: now,
        }),
      );
      if (prevStateTracker) {
        prevStateTracker.record(sessionId, tile.agentId, tile.state);
      }
    }
    populated = true;
  };

  const setExpanded = (expanded: boolean): void => {
    section.dataset.expanded = String(expanded);
    header.setAttribute("aria-expanded", String(expanded));
    header.setAttribute(
      "aria-label",
      `${group.personaName} grouped — ${instanceCount} instances, ${
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
