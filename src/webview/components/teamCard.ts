/**
 * teamCard — renders one team card per Iris's M2-03 §6.
 *
 *   <section class="team-card" data-team-id>
 *     <header class="team-header">
 *       <span class="team-name">TEAM {teamName}</span>
 *       <span class="team-count">({count} visible)</span>
 *     </header>
 *     {agent tiles, in roster order}
 *   </section>
 *
 * Teams with zero matched tiles are suppressed by the caller (sessionBlock)
 * per §6 — no empty cards rendered.
 *
 * Label note (2026-05-27, ticket 86c9zfj2g): the chip reads `({N} visible)`
 * — N is the number of `RosterTileEntry` items currently rendered on this
 * team card (post hide-finished filter, this session only). It is NOT the
 * count of members in `teams.yaml`. Sponsor chose `visible` over `rostered`
 * because "rostered" misread as "members declared in the YAML roster" — the
 * chip actually surfaces "how many persona groups are present on screen
 * right now," which the new label expresses directly.
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
import type { PrevStateTracker } from "../prevStateTracker.js";
import type { ExpandedGroupsTracker } from "../expandedGroupsTracker.js";

export interface TeamCardProps {
  /** Team metadata (id + display name from the loaded roster). */
  team: Team;
  /**
   * Tiles already filtered to this team's members, in roster order. Each
   * entry is either a bare `AgentTile` (N=1 / pre-M3-10 back-compat) or a
   * `CollapsedPersonaGroup` wrapper (M3-10 when N>1 dispatches share a
   * persona name). The card counts each entry as "1 visible" regardless of
   * wrapper expansion — a Felix ×4 wrapper still reads as a single tile in
   * the header (matches sponsor's mental model that the persona is the unit
   * of display, not the dispatch). The chip label is `({N} visible)` —
   * N reflects what is currently on screen for this team in this session
   * (after the hide-finished filter), NOT the YAML-declared roster size.
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
  /**
   * Optional webview-local last-rendered-state tracker (M4-05 §2.5).
   * Threaded through to each `renderAgentTile` so state transitions can fire
   * the M4-01 §2.3 transition animations. Same pattern as `finishedTracker`:
   * collapsed-persona wrappers thread it through but only consult it once
   * the wrapper expands (instances aren't in the DOM until then).
   */
  prevStateTracker?: PrevStateTracker;
  /**
   * Optional webview-local expansion-state tracker (Obs 10, 86c9zfmh1).
   * Threaded through to each `renderCollapsedPersonaTile` so user-expanded
   * wrappers survive the next host-driven `renderFull` re-build. Bare
   * tiles ignore it (nothing to expand at the leaf level).
   */
  expandedGroupsTracker?: ExpandedGroupsTracker;
  /**
   * 86c9zmqa8: when true, uniform CollapsedPersonaGroups render auto-
   * collapsed by default + use compact one-line instance rows on expand.
   * Threaded through to `renderCollapsedPersonaTile`. Bare tiles ignore it
   * (no uniform-cluster concept at the leaf level).
   */
  autoCollapseUniformClusters?: boolean;
  /** Current wall-clock ms — defaults to Date.now() inside agentTile. */
  nowMs?: number;
}

export function renderTeamCard(props: TeamCardProps): HTMLElement {
  const {
    team,
    tiles,
    sessionId,
    postMessage,
    finishedTracker,
    prevStateTracker,
    expandedGroupsTracker,
    autoCollapseUniformClusters,
    nowMs,
  } = props;

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
  // persona tile" framing. Label is `visible` (sponsor decision 2026-05-27,
  // ticket 86c9zfj2g) — chip reflects on-screen tile count for this team in
  // this session post-filter, NOT the YAML roster member count.
  countSpan.textContent = `(${tiles.length} visible)`;
  header.appendChild(countSpan);

  card.appendChild(header);

  const now = nowMs ?? Date.now();
  for (const entry of tiles) {
    if (isCollapsedPersonaGroup(entry)) {
      // M3-10 AC2 — collapsed-persona wrapper renders a header tile + lazy
      // instances container. All three trackers forwarded so when the user
      // expands the wrapper, finished instances pick up the freshness
      // suffix AND state transitions trigger their visual treatment exactly
      // as bare tiles do; the expandedGroupsTracker (Obs 10) persists the
      // user's expansion intent across the next host-driven re-render so
      // the wrapper doesn't snap shut every ~2s poll tick. `teamId` is
      // required to compose the expansion-tracker key — it's always
      // available here at the team-card render site.
      card.appendChild(
        renderCollapsedPersonaTile({
          group: entry,
          sessionId,
          teamId: team.id,
          postMessage,
          ...(finishedTracker ? { finishedTracker } : {}),
          ...(prevStateTracker ? { prevStateTracker } : {}),
          ...(expandedGroupsTracker ? { expandedGroupsTracker } : {}),
          ...(autoCollapseUniformClusters !== undefined
            ? { autoCollapseUniformClusters }
            : {}),
          ...(nowMs !== undefined ? { nowMs } : {}),
        }),
      );
      continue;
    }

    // Bare AgentTile — pre-M3-10 / N=1 back-compat path (AC3).
    //
    // For finished tiles, observe (or fetch) the first-seen ms so the suffix
    // anchors to the first tick we saw this completion — not the current
    // render. See finishedTracker.ts for accuracy semantics.
    const finishedAtMs =
      entry.state === "finished" && finishedTracker
        ? finishedTracker.observe(sessionId, entry.agentId, now)
        : undefined;
    // M4-05 §2.5 — read the previous-rendered state BEFORE recording the
    // new one so the renderer sees the prior tick's value; record AFTER
    // appending so the next tick's `previous(...)` returns the value we
    // just rendered. First render on this key returns undefined → renderer
    // skips the transition attribute.
    const prevState = prevStateTracker?.previous(sessionId, entry.agentId);
    card.appendChild(
      renderAgentTile({
        tile: entry,
        sessionId,
        postMessage,
        ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
        ...(prevState !== undefined ? { prevState } : {}),
        nowMs: now,
      }),
    );
    if (prevStateTracker) {
      prevStateTracker.record(sessionId, entry.agentId, entry.state);
    }
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
