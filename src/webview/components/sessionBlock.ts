/**
 * sessionBlock — one block per SessionTree per Iris's spec §4 + the corrected
 * title hierarchy from whole-team-display-spec.md §5 (86ca18bc2).
 *
 *   <section class="session-block" data-session-id data-alive>
 *     <header class="session-header">
 *       <span class="session-title">{resolved title}</span>     <!-- PRIMARY -->
 *       <span class="session-entrypoint">[{entrypoint}]</span>
 *       <span class="session-git-branch">{branch}</span>        <!-- when present -->
 *       <span class="session-dead-badge">dead</span>            <!-- only when !isAlive -->
 *       <span class="session-id" title="pid={pid}">ⓘ {shortId}</span>  <!-- DEMOTED, trailing -->
 *     </header>
 *     {team cards in teamOrder}
 *     {background chip if background.length > 0}
 *   </section>
 *
 * §5 hierarchy correction (86ca18bc2): the resolved title (from
 * `resolveSessionLabel`: customTitle > aiTitle > workspace-folder) is the
 * dominant header label — first in DOM order, `--ct-color-fg`, weight 600,
 * largest text. The `SESSION {shortId}` element is DEMOTED to a small muted
 * monospace chip at the trailing edge with an info glyph + aria-label
 * "session id" (kept visible per sponsor — UUID is load-bearing for grepping
 * JSONLs/logs, just not dominant). `pid` folds into that chip's tooltip and
 * `cwd` folds into the title's tooltip — both demoted from standalone spans
 * (§5.2). The gitBranch chip + `data-label-source` attribute are unchanged.
 *
 * Dead session treatment (§4): isAlive === false adds `session-block--dead`
 * class. CSS dims via opacity + --vscode-disabledForeground. No team cards or
 * chips render for dead sessions — header alone (with the §5 hierarchy applied
 * at 0.5 opacity), so the sponsor sees which session existed.
 *
 * Empty team suppression: teams with zero tiles in this session are skipped
 * entirely (§6 — no empty cards rendered).
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §4 +
 *         team/iris-ux/whole-team-display-spec.md §5 (86ca18bc2)
 */

import type {
  SessionLabelSource,
  SessionTree,
  WebviewSessionTree,
} from "../../shared/types.js";
import { resolveSessionLabelWithSource } from "../../shared/types.js";
import { renderTeamCard, teamFromId } from "./teamCard.js";
import { renderBackgroundChip } from "./backgroundChip.js";
import type { PostMessageFn } from "./agentTile.js";
import type { FinishedTracker } from "../finishedTracker.js";
import type { PrevStateTracker } from "../prevStateTracker.js";
import type { ExpandedGroupsTracker } from "../expandedGroupsTracker.js";
import type { MenuOpenTracker } from "../menuOpenTracker.js";
import type { SpriteTracker } from "../spriteTracker.js";

/**
 * Tooltip text shown on the `.session-title` span keyed by the resolution
 * source. Kept adjacent to the renderer so a UI-copy change is a one-file
 * edit. Exhaustive on `SessionLabelSource` — TypeScript will surface a
 * missing key if a new source value is added to the union.
 */
const LABEL_SOURCE_TOOLTIPS: Record<SessionLabelSource, string> = {
  "custom-title": "Sponsor rename (custom-title)",
  "ai-title": "AI-generated title (ai-title)",
  "workspace-folder": "Workspace folder name (no title set)",
};

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
   * Optional webview-local overflow-menu open-state tracker (86ca1fjqu BUG 2).
   * Threaded down to teamCard → agentTile / multiAgentPersonaTile so an open
   * "⋯" menu survives the next host-driven `renderFull`.
   */
  menuOpenTracker?: MenuOpenTracker;
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
   * 86ca1ej5c — expand-by-default for multi-agent persona tiles (repurposed
   * `collapsePersonaTiles` flag, spec §6 Q4). Threaded down to teamCard →
   * multiAgentPersonaTile. Optional; defaults to false (collapsed).
   */
  expandPersonaTiles?: boolean;
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
  /** Host-injected sprite base URI — threaded to each team card / tile. */
  spriteBaseUri?: string;
  /** Webview-local sprite playback tracker. */
  spriteTracker?: SpriteTracker;
}

export function renderSessionBlock(props: SessionBlockProps): HTMLElement {
  const {
    session,
    postMessage,
    finishedTracker,
    prevStateTracker,
    expandedGroupsTracker,
    menuOpenTracker,
    autoCollapseUniformClusters,
    expandPersonaTiles,
    hideIdle,
    hiddenIdleCount,
    nowMs,
    spriteBaseUri,
    spriteTracker,
  } = props;

  const block = document.createElement("section");
  block.className = "session-block";
  if (!session.isAlive) {
    block.classList.add("session-block--dead");
  }
  block.dataset.sessionId = session.sessionId;
  block.dataset.alive = String(session.isAlive);

  // ----- Session header (86ca18bc2 corrected hierarchy, spec §5.2) -----
  const header = document.createElement("header");
  header.className = "session-header";

  // PRIMARY label — the resolved title leads the header in DOM order so it
  // is visually dominant (CSS gives it weight 600 + the largest header text).
  //
  // 86ca03nww: resolve display label AND its source in one pass via the
  // shared `resolveSessionLabelWithSource` helper. The helper centralizes
  // the priority chain (customTitle > aiTitle > workspace-folder fallback)
  // and normalization rules (empty/whitespace customTitle, `(no title yet)`
  // sentinel) so the label text and `data-label-source` attribute can never
  // drift apart. Unchanged by 86ca18bc2 — same resolver, same source attr.
  const labelSpan = document.createElement("span");
  labelSpan.className = "session-title";
  const resolved = resolveSessionLabelWithSource({
    title: session.title,
    customTitle: session.customTitle,
    cwd: session.cwd,
  });
  labelSpan.textContent = resolved.label;
  // §5.2: cwd folds into the title tooltip (workspace path is context, not a
  // headline). Compose with the existing label-source tooltip so both facts
  // are one hover away. cwd first (the more useful "where am I" answer),
  // then the resolution-tier note.
  labelSpan.setAttribute(
    "title",
    `${session.cwd}\n${LABEL_SOURCE_TOOLTIPS[resolved.source]}`,
  );
  labelSpan.dataset.labelSource = resolved.source;
  header.appendChild(labelSpan);

  // Entrypoint chip — small muted chip, unchanged (§5.2).
  appendSpan(header, "session-entrypoint", `[${session.entrypoint}]`);

  // 86ca03nww: gitBranch chip — small badge near the title surfacing the
  // active branch at the latest JSONL record. Hidden when the parser found
  // no gitBranch on disk (pre-86ca03nww emitters, sessions whose JSONL has
  // no records carrying the field). Unchanged by 86ca18bc2.
  if (typeof session.gitBranch === "string" && session.gitBranch.length > 0) {
    const branchChip = document.createElement("span");
    branchChip.className = "session-git-branch";
    branchChip.textContent = session.gitBranch;
    branchChip.setAttribute("title", `git branch: ${session.gitBranch}`);
    branchChip.dataset.gitBranch = session.gitBranch;
    header.appendChild(branchChip);
  }

  if (!session.isAlive) {
    const deadBadge = document.createElement("span");
    deadBadge.className = "session-dead-badge";
    deadBadge.textContent = "dead";
    header.appendChild(deadBadge);
  }

  // DEMOTED UUID chip — trailing edge, small muted monospace, info glyph +
  // aria-label "session id" (§5.2). Kept visible (not tooltip-only) because
  // the short id is load-bearing for grepping JSONLs / matching log lines
  // (§5.3, sponsor-resolved). `pid` folds into this chip's tooltip — it's a
  // debugging detail, demoted from a standalone span (§5.2). The glyph is in
  // its own aria-hidden span so screen readers read the aria-label + id text
  // without announcing the decorative "ⓘ".
  const idChip = document.createElement("span");
  idChip.className = "session-id";
  idChip.setAttribute("aria-label", "session id");
  idChip.setAttribute("title", `session id ${session.shortId} · pid=${session.pid}`);
  const idGlyph = document.createElement("span");
  idGlyph.className = "session-id-glyph";
  idGlyph.setAttribute("aria-hidden", "true");
  idGlyph.textContent = "ⓘ";
  idChip.appendChild(idGlyph);
  idChip.appendChild(document.createTextNode(` ${session.shortId}`));
  header.appendChild(idChip);

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
        ...(menuOpenTracker ? { menuOpenTracker } : {}),
        ...(autoCollapseUniformClusters !== undefined
          ? { autoCollapseUniformClusters }
          : {}),
        ...(expandPersonaTiles !== undefined ? { expandPersonaTiles } : {}),
        ...(hideIdle !== undefined ? { hideIdle } : {}),
        ...(hiddenIdleCount !== undefined ? { hiddenIdleCount } : {}),
        ...(nowMs !== undefined ? { nowMs } : {}),
        ...(spriteBaseUri !== undefined ? { spriteBaseUri } : {}),
        ...(spriteTracker ? { spriteTracker } : {}),
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
