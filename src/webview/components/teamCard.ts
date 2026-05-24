/**
 * teamCard — renders one team card per Iris's M2-03 §6.
 *
 *   <section class="team-card" data-team-id>
 *     <header class="team-header">
 *       <span class="team-name">TEAM {teamName}</span>
 *       <span class="team-count">({count} rostered)</span>
 *     </header>
 *     {agent tiles, in roster order}
 *   </section>
 *
 * Teams with zero matched tiles are suppressed by the caller (sessionBlock)
 * per §6 — no empty cards rendered.
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §6
 */

import type { RosterTileEntry, Team } from "../../shared/types.js";
import { renderAgentTile, type PostMessageFn } from "./agentTile.js";
import {
  renderCollapsedPersonaTile,
  isCollapsedPersonaGroup,
} from "./collapsedPersonaTile.js";
import type { FinishedTracker } from "../finishedTracker.js";

export interface TeamCardProps {
  /** Team metadata (id + display name from the loaded roster). */
  team: Team;
  /**
   * Tiles already filtered to this team's members, in roster order. Each
   * entry is either a bare `AgentTile` (N=1 / pre-M3-10 back-compat) or a
   * `CollapsedPersonaGroup` wrapper (M3-10 when N>1 dispatches share a
   * persona name). The card counts each entry as "1 rostered" regardless of
   * wrapper expansion — a Felix ×4 wrapper still reads as a single tile in
   * the header (matches sponsor's mental model that the persona is the unit
   * of display, not the dispatch).
   */
  tiles: RosterTileEntry[];
  /** Session id used to construct drill-in messages on tile clicks. */
  sessionId: string;
  /** Webview → host postMessage fn passed down to tiles. */
  postMessage: PostMessageFn;
  /**
   * Optional webview-local first-seen tracker for finished-tile freshness
   * (M3-04 NIT #3). When provided, finished tiles render
   * `finished Xs / Xm / Xh`; when omitted, finished tiles render the bare
   * `finished` string (back-compat with pre-NIT#3 callers and tests).
   *
   * For collapsed-persona wrappers, the tracker is threaded through but
   * NOT consulted until the wrapper is expanded — collapsed wrappers don't
   * render their instances into the DOM, so `observe` would record entries
   * for tiles that aren't visible. The wrapper's expand handler observes on
   * first expansion.
   */
  finishedTracker?: FinishedTracker;
  /** Current wall-clock ms — defaults to Date.now() inside agentTile. */
  nowMs?: number;
}

export function renderTeamCard(props: TeamCardProps): HTMLElement {
  const { team, tiles, sessionId, postMessage, finishedTracker, nowMs } = props;

  const card = document.createElement("section");
  card.className = "team-card";
  card.dataset.teamId = team.id;

  const header = document.createElement("header");
  header.className = "team-header";

  const nameSpan = document.createElement("span");
  nameSpan.className = "team-name";
  nameSpan.textContent = `TEAM ${team.name}`;
  header.appendChild(nameSpan);

  const countSpan = document.createElement("span");
  countSpan.className = "team-count";
  // Count = number of header tiles (wrappers count as 1; their N>1 is in the
  // wrapper's own "×N" badge). Matches the sponsor's "Felix ×4 reads as one
  // persona tile" framing.
  countSpan.textContent = `(${tiles.length} rostered)`;
  header.appendChild(countSpan);

  card.appendChild(header);

  const now = nowMs ?? Date.now();
  for (const entry of tiles) {
    if (isCollapsedPersonaGroup(entry)) {
      // M3-10 AC2 — collapsed-persona wrapper renders a header tile + lazy
      // instances container. Tracker / nowMs forwarded so when the user
      // expands the wrapper, finished instances pick up the freshness suffix
      // exactly as bare tiles do.
      card.appendChild(
        renderCollapsedPersonaTile({
          group: entry,
          sessionId,
          postMessage,
          ...(finishedTracker ? { finishedTracker } : {}),
          ...(nowMs !== undefined ? { nowMs } : {}),
        }),
      );
      continue;
    }

    // Bare AgentTile — pre-M3-10 / N=1 back-compat path (AC3). Unchanged.
    // For finished tiles, observe (or fetch) the first-seen ms so the suffix
    // anchors to the first tick we saw this completion — not the current
    // render. See finishedTracker.ts for accuracy semantics.
    const finishedAtMs =
      entry.state === "finished" && finishedTracker
        ? finishedTracker.observe(sessionId, entry.agentId, now)
        : undefined;
    card.appendChild(
      renderAgentTile({
        tile: entry,
        sessionId,
        postMessage,
        ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
        nowMs: now,
      }),
    );
  }

  return card;
}

/**
 * Fallback used when the renderer doesn't have full Team metadata (e.g. fixture
 * mode without a roster passed in). Synthesizes a Team from the teamId only —
 * the displayed name will be the id verbatim. Real renders always have the
 * roster, so this fallback is exercised only in dev / static-fixture mode.
 */
export function teamFromId(teamId: string): Team {
  return {
    id: teamId,
    name: teamId,
    members: [],
  };
}
