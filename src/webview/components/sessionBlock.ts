/**
 * sessionBlock — one block per SessionTree per Iris's spec §4.
 *
 *   <section class="session-block" data-session-id data-alive>
 *     <header class="session-header">
 *       <span class="session-id">SESSION {shortId}</span>
 *       <span class="session-entrypoint">[{entrypoint}]</span>
 *       <span class="session-pid">pid={pid}</span>
 *       <span class="session-cwd" title="{cwd}">{cwd}</span>
 *       <span class="session-title">{title}</span>
 *       <span class="session-dead-badge">dead</span>   <!-- only when !isAlive -->
 *     </header>
 *     {team cards in teamOrder}
 *     {background chip if background.length > 0}
 *   </section>
 *
 * Dead session treatment (§4): isAlive === false adds `session-block--dead`
 * class. CSS dims via opacity + --vscode-disabledForeground. No team cards or
 * chips render for dead sessions — header alone, so the sponsor sees the
 * session existed.
 *
 * Empty team suppression: teams with zero tiles in this session are skipped
 * entirely (§6 — no empty cards rendered).
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §4
 */

import type { SessionTree, WebviewSessionTree } from "../../shared/types.js";
import { renderTeamCard, teamFromId } from "./teamCard.js";
import { renderBackgroundChip } from "./backgroundChip.js";
import type { PostMessageFn } from "./agentTile.js";
import type { FinishedTracker } from "../finishedTracker.js";
import type { PrevStateTracker } from "../prevStateTracker.js";
import type { ExpandedGroupsTracker } from "../expandedGroupsTracker.js";

export interface SessionBlockProps {
  /**
   * Either the pre-M3-10 host shape (`SessionTree`, bare `AgentTile[]` per
   * team) or the post-hydration webview shape (`WebviewSessionTree`,
   * `RosterTileEntry[]` per team — permits `CollapsedPersonaGroup` wrappers).
   * `renderTeamCard` already accepts the wider entry-array type, so both
   * shapes flow through unchanged.
   */
  session: SessionTree | WebviewSessionTree;
  postMessage: PostMessageFn;
  /**
   * Optional webview-local first-seen tracker for finished-tile freshness
   * (M3-04 NIT #3). Threaded down to teamCard → agentTile.
   */
  finishedTracker?: FinishedTracker;
  /**
   * Optional webview-local last-rendered-state tracker (M4-05 §2.5).
   * Threaded down to teamCard → agentTile so per-tile state transitions
   * can fire the `data-transition="to-<state>"` attribute / animation.
   */
  prevStateTracker?: PrevStateTracker;
  /**
   * Optional webview-local expansion-state tracker (Obs 10, 86c9zfmh1).
   * Threaded down to teamCard → collapsedPersonaTile so user-expanded
   * persona wrappers survive the next host-driven `renderFull`.
   */
  expandedGroupsTracker?: ExpandedGroupsTracker;
  /**
   * 86c9zmqa8: when true (the renderFull default — see render.ts), uniform
   * CollapsedPersonaGroups (same persona, same state, all idle/finished)
   * render auto-collapsed by default and use compact one-line instance rows
   * when expanded. Threaded down to teamCard → collapsedPersonaTile. When
   * false, every wrapper renders per pre-86c9zmqa8 (M3-10 + Obs 10) behavior.
   * Optional — when omitted, treated as false (back-compat with sessionBlock
   * component tests authored before the polish).
   */
  autoCollapseUniformClusters?: boolean;
  /**
   * 86c9zqa75 — mirror of `state.config?.hideIdleAgents` threaded down to
   * teamCard so each team can decide whether to render the per-team "N idle
   * hidden — show" passive informational row. Optional / defaults to false
   * for back-compat with pre-86c9zqa75 component tests.
   */
  hideIdle?: boolean;
  /**
   * 86c9zqa75 — mirror of `state.hiddenIdleCount` threaded down to teamCard
   * for the per-team row label. Global (across all teams + sessions) per
   * Felix's Pt 1 wire shape; per-team breakdown is V1 limitation flagged in
   * the PR body. Defaults to 0; the row only renders when count > 0 AND
   * `hideIdle === true`.
   */
  hiddenIdleCount?: number;
  /** Current wall-clock ms — defaults to Date.now() downstream. */
  nowMs?: number;
}

export function renderSessionBlock(props: SessionBlockProps): HTMLElement {
  const {
    session,
    postMessage,
    finishedTracker,
    prevStateTracker,
    expandedGroupsTracker,
    autoCollapseUniformClusters,
    hideIdle,
    hiddenIdleCount,
    nowMs,
  } = props;

  const block = document.createElement("section");
  block.className = "session-block";
  if (!session.isAlive) {
    block.classList.add("session-block--dead");
  }
  block.dataset.sessionId = session.sessionId;
  block.dataset.alive = String(session.isAlive);

  // ----- Session header -----
  const header = document.createElement("header");
  header.className = "session-header";

  appendSpan(header, "session-id", `SESSION ${session.shortId}`);
  appendSpan(header, "session-entrypoint", `[${session.entrypoint}]`);
  appendSpan(header, "session-pid", `pid=${session.pid}`);

  const cwdSpan = document.createElement("span");
  cwdSpan.className = "session-cwd";
  cwdSpan.setAttribute("title", session.cwd);
  cwdSpan.textContent = session.cwd;
  header.appendChild(cwdSpan);

  appendSpan(header, "session-title", session.title);

  if (!session.isAlive) {
    const deadBadge = document.createElement("span");
    deadBadge.className = "session-dead-badge";
    deadBadge.textContent = "dead";
    header.appendChild(deadBadge);
  }

  block.appendChild(header);

  // Dead session: header only, no tiles / chips render.
  if (!session.isAlive) {
    return block;
  }

  // ----- Team cards (only teams with >= 1 matched tile) -----
  for (const teamId of session.teamOrder) {
    const tiles = session.rosterTiles.get(teamId) ?? [];
    if (tiles.length === 0) continue;
    block.appendChild(
      renderTeamCard({
        team: teamFromId(teamId),
        tiles,
        sessionId: session.sessionId,
        postMessage,
        ...(finishedTracker ? { finishedTracker } : {}),
        ...(prevStateTracker ? { prevStateTracker } : {}),
        ...(expandedGroupsTracker ? { expandedGroupsTracker } : {}),
        ...(autoCollapseUniformClusters !== undefined
          ? { autoCollapseUniformClusters }
          : {}),
        ...(hideIdle !== undefined ? { hideIdle } : {}),
        ...(hiddenIdleCount !== undefined ? { hiddenIdleCount } : {}),
        ...(nowMs !== undefined ? { nowMs } : {}),
      }),
    );
  }

  // ----- Background chip (only when >= 1 background agent) -----
  if (session.background.length > 0) {
    block.appendChild(
      renderBackgroundChip({
        sessionId: session.sessionId,
        agents: session.background,
      }),
    );
  }

  return block;
}

function appendSpan(
  parent: HTMLElement,
  className: string,
  text: string,
): void {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  parent.appendChild(span);
}
