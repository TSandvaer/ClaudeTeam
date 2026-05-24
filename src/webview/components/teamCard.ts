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
import type { FinishedTracker } from "../finishedTracker.js";

export interface TeamCardProps {
  /** Team metadata (id + display name from the loaded roster). */
  team: Team;
  /** Tiles already filtered to this team's members, in roster order. */
  tiles: AgentTile[];
  /** Session id used to construct drill-in messages on tile clicks. */
  sessionId: string;
  /** Webview → host postMessage fn passed down to tiles. */
  postMessage: PostMessageFn;
  /**
   * Optional webview-local first-seen tracker for finished-tile freshness
   * (M3-04 NIT #3). When provided, finished tiles render
   * `finished Xs / Xm / Xh`; when omitted, finished tiles render the bare
   * `finished` string (back-compat with pre-NIT#3 callers and tests).
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
  countSpan.textContent = `(${tiles.length} rostered)`;
  header.appendChild(countSpan);

  card.appendChild(header);

  const now = nowMs ?? Date.now();
  for (const tile of tiles) {
    // For finished tiles, observe (or fetch) the first-seen ms so the suffix
    // anchors to the first tick we saw this completion — not the current
    // render. See finishedTracker.ts for accuracy semantics.
    const finishedAtMs =
      tile.state === "finished" && finishedTracker
        ? finishedTracker.observe(sessionId, tile.agentId, now)
        : undefined;
    card.appendChild(
      renderAgentTile({
        tile,
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
