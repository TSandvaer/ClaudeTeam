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

import type { AgentTile, Team } from "../../shared/types.js";
import { renderAgentTile, type PostMessageFn } from "./agentTile.js";

export interface TeamCardProps {
  /** Team metadata (id + display name from the loaded roster). */
  team: Team;
  /** Tiles already filtered to this team's members, in roster order. */
  tiles: AgentTile[];
  /** Session id used to construct drill-in messages on tile clicks. */
  sessionId: string;
  /** Webview → host postMessage fn passed down to tiles. */
  postMessage: PostMessageFn;
}

export function renderTeamCard(props: TeamCardProps): HTMLElement {
  const { team, tiles, sessionId, postMessage } = props;

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
  countSpan.textContent = `(${tiles.length} rostered)`;
  header.appendChild(countSpan);

  card.appendChild(header);

  for (const tile of tiles) {
    card.appendChild(renderAgentTile({ tile, sessionId, postMessage }));
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
