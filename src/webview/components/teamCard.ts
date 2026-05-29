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
import type { WebviewMessage } from "../../shared/messages.js";
import { renderAgentTile, type PostMessageFn } from "./agentTile.js";
import {
  renderCollapsedPersonaTile,
  isCollapsedPersonaGroup,
} from "./collapsedPersonaTile.js";
import type { FinishedTracker } from "../finishedTracker.js";
import type { PrevStateTracker } from "../prevStateTracker.js";
import type { ExpandedGroupsTracker } from "../expandedGroupsTracker.js";
import type { SpriteTracker } from "../spriteTracker.js";

// Em-dash (U+2014) — matches headerChip vocabulary contract per spec
// 86c9zmyef §7.3.
const EM_DASH = "—";

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
  /**
   * 86c9zqa75 — when true AND `hiddenIdleCount > 0`, the team card renders
   * a per-team "N idle hidden — show" passive row at the END of its tile
   * list (spec 86c9zmyef §3.4 Option A+B). The row's click fires the same
   * `ui:set-config` message as the global header chip — it is informational
   * sugar, not a per-team filter scope. When false / count==0, the row is
   * suppressed (no idle tiles hidden means no row to render).
   */
  hideIdle?: boolean;
  /**
   * 86c9zqa75 — global count of idle tiles hidden this tick (from Felix's
   * Pt 1 wire shape). The per-team row label embeds this number. V1
   * limitation: count is global, not per-team — for multi-team rosters the
   * same N appears in every team's row. V1 dogfood roster has one team so
   * the discrepancy doesn't surface; multi-team breakdown is post-V1.
   */
  hiddenIdleCount?: number;
  /** Current wall-clock ms — defaults to Date.now() inside agentTile. */
  nowMs?: number;
  /**
   * Host-injected webview-base URI for resolving sprite frame paths. Threaded
   * down to each bare `renderAgentTile` so rostered members with a bound
   * sprite character render their persona pixel character. Absent → text-only
   * tiles (AC5). Collapsed-persona wrapper instances do not yet render sprites
   * (the wrapper is a count badge until expanded; sprites on expanded
   * instances are deferred — flagged in the PR body).
   */
  spriteBaseUri?: string;
  /** Webview-local sprite playback tracker (idle stickiness + timer disposal). */
  spriteTracker?: SpriteTracker;
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
    hideIdle,
    hiddenIdleCount,
    nowMs,
    spriteBaseUri,
    spriteTracker,
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
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        ...(spriteTracker ? { spriteTracker } : {}),
        nowMs: now,
      }),
    );
    if (prevStateTracker) {
      prevStateTracker.record(sessionId, entry.agentId, entry.state);
    }
  }

  // 86c9zqa75 — per-team idle-hidden hint row (spec 86c9zmyef §3.4
  // Option A+B). Appended AFTER all tiles so it visually closes the team
  // card. Click fires the SAME `ui:set-config` message as the global
  // header chip (passive informational hint — no per-team filter scope).
  //
  // Render conditions:
  //   1. The global filter must be on (`hideIdle === true`); the row
  //      makes no sense when idle tiles are already visible.
  //   2. The global `hiddenIdleCount` must be > 0; rendering "0 idle
  //      hidden — show" reads as a bug.
  // V1 limitation: the count is global across all teams in all sessions —
  // for multi-team rosters the same N appears in each team's row. V1
  // dogfood roster has one team so the discrepancy doesn't surface;
  // multi-team per-team-breakdown is flagged in the PR body as post-V1.
  if (hideIdle === true && (hiddenIdleCount ?? 0) > 0) {
    card.appendChild(renderTeamIdleRow(hiddenIdleCount ?? 0, postMessage));
  }

  return card;
}

/**
 * 86c9zqa75 — per-team "N idle hidden — show" passive informational row.
 *
 * Renders as a `<button>` so native Enter + Space activation comes for
 * free. The click posts `ui:set-config` with the SAME key as the global
 * header chip — the row is informational sugar, NOT a per-team filter
 * scope (per spec 86c9zmyef §3.4 Option A+B). Label vocabulary mirrors the
 * spec §7.3 templates verbatim:
 *
 *   N === 1 → "1 idle hidden — show"
 *   N >  1 → "<N> idle hidden — show"
 *
 * Em-dash (U+2014) matches the header-chip vocabulary contract.
 *
 * Exported indirectly — only used by `renderTeamCard` above. Keeping it
 * unexported reduces the public API surface; if tests want to assert the
 * row in isolation they query for `.ct-team-idle-row` post-`renderTeamCard`.
 */
function renderTeamIdleRow(
  count: number,
  postMessage: PostMessageFn,
): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "ct-team-idle-row";
  // Dataset count exposes the rendered N for CSS selectors / DOM queries
  // (e.g. tests asserting "row appears with the right number").
  row.dataset.hiddenIdleCount = String(count);
  // aria-label restates the count + the action so screen readers don't
  // need to parse the em-dash punctuation.
  row.setAttribute(
    "aria-label",
    `${count} idle agent${count === 1 ? "" : "s"} hidden — click to show`,
  );

  const labelText =
    count === 1
      ? `1 idle hidden ${EM_DASH} show`
      : `${count} idle hidden ${EM_DASH} show`;
  row.textContent = labelText;

  row.addEventListener("click", () => {
    // Fire the same message the global chip fires — flipping the global
    // filter off so all idle tiles reappear. The row itself doesn't
    // re-render here; the next host `state:full` (which the host emits
    // after `vscode.workspace.getConfiguration().update`) drives the
    // re-render with the new tiles visible and the row absent.
    const msg: WebviewMessage = {
      type: "ui:set-config",
      payload: {
        key: "hideIdleAgents",
        value: false,
      },
    };
    // PostMessageFn now types as `(msg: WebviewMessage) => void` (PR #98
    // NIT #2 — Felix 2026-05-27), so `ui:set-config` passes without a cast.
    postMessage(msg);
  });

  return row;
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
