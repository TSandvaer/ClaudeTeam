/**
 * multiAgentPersonaTile — renders a rostered member with N≥2 live agents as
 * ONE persona tile (option A, sponsor GUI-test decision 2026-05-29; spec
 * `team/iris-ux/multiagent-persona-tile-spec.md` §1, §2, §3).
 *
 * SUPERSEDES the M3-10 `CollapsedPersonaGroup` header-tile for ROSTERED
 * members. Where the legacy collapsed tile rendered a bare count-group header
 * (`Felix ×2 ▸ all finished`, different chrome, no persona sprite), this tile
 * renders the SAME chrome as the single/zero-agent `renderAgentTile` — persona
 * sprite, name, role, headline activity, model — plus:
 *
 *   1. a small `×N` count BADGE on the name row that DOUBLES as the expand
 *      toggle (carries the chevron + aria-expanded), and
 *   2. an inline `.persona-instances` region (collapsed by default) listing the
 *      per-instance rows keyed by `agentId`, each drill-in-clickable.
 *
 * DOM shape (extends `whole-team-display-spec` §2.1 + agentTile.ts):
 *
 *   <article class="agent-tile" data-state={aggregateState} data-count={N}
 *            data-member-id role="group" aria-label="...">
 *     {sprite box — pose from aggregateState/headlineActivity}
 *     <div class="tile-row tile-row--primary">
 *       <span class="state-dot" data-state></span>
 *       <span class="agent-display">{display}</span>
 *       <button class="persona-count-badge" aria-expanded aria-controls>
 *         ×{N} <span class="persona-count-chevron">▸</span>
 *       </button>
 *     </div>
 *     <div class="tile-row tile-row--role"><span class="agent-role">…</span></div>
 *     <div class="tile-row tile-row--activity"><span class="agent-activity">{headlineActivity}</span></div>
 *     <div class="tile-row tile-row--model"><span class="agent-model">{headlineModel} · {state·elapsed} (N agents)</span></div>
 *     <div class="persona-instances" id role="list" hidden>
 *       <div class="persona-instance-row" data-agent-id role="button" tabindex>
 *         <span class="state-dot" data-state></span>
 *         <span class="persona-instance-id">{agentId[:8]}</span>
 *         <span class="persona-instance-activity">{activity}</span>
 *       </div>
 *       …
 *     </div>
 *   </article>
 *
 * State minimalism (vscode-extension-conventions § Webview rules):
 *   - The webview does NOT compute the aggregate or re-order instances — the
 *     host emits `aggregateState`, `headlineActivity/Model`, and the
 *     most-active-first `instances[]` (spec §5.1). This renderer skins them.
 *   - Expansion is the ONLY webview-local state — ephemeral UI, keyed by
 *     `memberId` via the shared `expandedGroupsTracker` so a host poll-tick
 *     re-render doesn't snap an open list shut (spec §3.3, Obs 10 pattern).
 *
 * `[hidden]`-guard discipline (vscode-extension-conventions § "[hidden]-toggled
 * flex/grid popovers need an explicit guard"): `.persona-instances` declares
 * `display: flex` and is toggled via `el.hidden`, so dashboard.css MUST carry a
 * `.persona-instances[hidden] { display: none }` guard — author display beats
 * the UA `[hidden]` default, and jsdom can't catch the omission. The
 * source-derived guard test (removeMember.test.ts) covers it once added.
 *
 * Theme variables only — no hardcoded hex. State-dot semantic colors come from
 * the shared `.state-dot[data-state]` rules.
 *
 * Source: team/iris-ux/multiagent-persona-tile-spec.md §1, §2, §3, §5.2, §5.4
 *         src/shared/types.ts MultiAgentPersonaTile (host wire shape, PR #124)
 *         src/webview/components/agentTile.ts (single-tile chrome reused)
 */

import type {
  AgentState,
  AgentTile,
  MultiAgentPersonaTile,
} from "../../shared/types.js";
import type { OpenTranscriptMessage } from "../../shared/messages.js";
import { formatFreshness } from "../../shared/freshness.js";
import { spriteForMember } from "../sprites/spriteManifest.js";
import { createSpriteBox } from "../sprites/spritePlayer.js";
import type { SpriteTracker } from "../spriteTracker.js";
import type { ExpandedGroupsTracker } from "../expandedGroupsTracker.js";
import type { MenuOpenTracker } from "../menuOpenTracker.js";
import type { FinishedTracker } from "../finishedTracker.js";
import { buildOverflowMenu, type PostMessageFn } from "./agentTile.js";

/** Human-readable label per state — mirrors agentTile.ts STATE_LABEL. */
const STATE_LABEL: Record<AgentState, string> = {
  running: "Running",
  idle: "Idle",
  finished: "Finished",
  error: "Error",
  available: "Available",
};

export interface MultiAgentPersonaTileProps {
  /** The host-emitted wrapper (aggregate + headline + instances). */
  tile: MultiAgentPersonaTile;
  /**
   * The session id of the session block this tile renders in. Used only as a
   * fallback for the expansion-tracker key + as the drill-in session when an
   * instance omits its own `sessionId` (back-compat). Per-instance drill-in
   * prefers `instance.sessionId` (spec §3.2 / PR #123 NIT 2 — cross-session
   * instances must open the correct transcript).
   */
  sessionId: string;
  /** Webview → host postMessage fn. */
  postMessage: PostMessageFn;
  /**
   * Expand-by-default flag — the repurposed `claudeteam.collapsePersonaTiles`
   * config (spec §5.3 / §6 Q4). `collapsePersonaTiles === false` →
   * `expandByDefault === true` → the instance list renders expanded on first
   * paint; `true` (the default) → collapsed. The host translates the config
   * scalar; the webview just consumes the boolean. When omitted, defaults to
   * `false` (collapsed) — option A's "one clean tile per member" resting view.
   */
  expandByDefault?: boolean;
  /**
   * Optional webview-local expansion-state tracker (Obs 10, 86c9zfmh1),
   * keyed by `memberId` (spec §3.3). When provided, a user toggle survives
   * the next host poll-tick re-render. When omitted (component tests), the
   * tile starts from `expandByDefault` and clicks don't persist beyond the
   * current DOM.
   */
  expandedGroupsTracker?: ExpandedGroupsTracker;
  /**
   * Webview-local overflow-menu open-state tracker (86ca1fjqu BUG 2). Threaded
   * into the shared `buildOverflowMenu` so the per-member "⋯" menu the user
   * opened survives the next host poll-tick re-render. Keyed by
   * `sessionId:teamId:memberId`. When omitted (component tests) the menu starts
   * closed and clicks don't persist beyond the current DOM. Mirrors the
   * `expandedGroupsTracker` that persists the badge-expand list.
   */
  menuOpenTracker?: MenuOpenTracker;
  /** Team id — composes the expansion-tracker key with sessionId + memberId. */
  teamId?: string;
  /**
   * Host-injected webview-base URI for resolving sprite frame paths. When
   * present AND the member has a bound sprite, the tile renders a 68×68
   * persona pixel character whose pose follows the AGGREGATE state (spec §1.4).
   * Absent → text-only (graceful degrade, no broken image).
   */
  spriteBaseUri?: string;
  /** Webview-local sprite playback tracker (idle stickiness + timer disposal). */
  spriteTracker?: SpriteTracker;
  /**
   * Optional finished-tile tracker — threaded so finished INSTANCE rows pick
   * up an `Xs/Xm/Xh` suffix when the host omits the humanized suffix (the
   * diagnostic no-timestamp case; the host normally supplies it). Consulted
   * lazily on first expand (instances aren't in the DOM until then).
   */
  finishedTracker?: FinishedTracker;
  /** Current wall-clock ms — defaults to Date.now(). Test injection point. */
  nowMs?: number;
  /** Reduced-motion override for the sprite (tests). */
  reducedMotion?: boolean;
  /** Injected RNG for deterministic idle sprite picks (tests). */
  spriteRng?: () => number;
  /** Frame-timer scheduler injection (sprite tests). */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Frame-timer canceller injection (sprite tests). */
  cancelFrame?: (handle: number) => void;
}

/** Collapsed chevron glyph (points right). */
const CHEVRON_COLLAPSED = "▸";
/** Expanded chevron glyph (points down). */
const CHEVRON_EXPANDED = "▾";

/** Length of the short agentId shown on each instance row (spec §3.2). */
const SHORT_ID_LEN = 8;

let nextRegionId = 0;

/**
 * Keys this webview boot has already painted at least once. Lets the
 * `expandByDefault` opt-in apply ONLY on a member's first paint — once seen,
 * the persistent `expandedGroupsTracker` is the single source of truth so a
 * user collapse sticks across poll-tick re-renders (it would otherwise be
 * re-expanded every tick by the default). Cleared implicitly per boot (module
 * state); the tracker's own prune handles teardown. Indistinguishable from the
 * tracker's own "absent vs explicit-false" gap, which is exactly why this side
 * channel exists.
 */
const seededDefaultKeys = new Set<string>();

export function renderMultiAgentPersonaTile(
  props: MultiAgentPersonaTileProps,
): HTMLElement {
  const {
    tile,
    sessionId,
    postMessage,
    expandByDefault,
    expandedGroupsTracker,
    menuOpenTracker,
    teamId,
    spriteBaseUri,
    spriteTracker,
    finishedTracker,
    nowMs,
    reducedMotion,
    spriteRng,
    scheduleFrame,
    cancelFrame,
  } = props;

  const now = nowMs ?? Date.now();
  const count = tile.instances.length;

  // ── Expansion state (webview-local ephemeral, keyed by memberId, §3.3) ────
  // Default-collapsed unless `expandByDefault` (repurposed collapsePersonaTiles
  // flag) is set. A persisted tracker entry — the user's prior intent this
  // webview session — wins over the default so a poll-tick re-render restores
  // the open/closed state (Obs 10). The tracker key generalizes the legacy
  // collapsed-persona key but uses memberId (spec §3.3), matching the key
  // render.ts registers for the prune pass.
  const trackerKey =
    expandedGroupsTracker && teamId !== undefined
      ? expandedGroupsTracker.makeKey(sessionId, teamId, tile.memberId)
      : undefined;
  let initiallyExpanded: boolean;
  if (trackerKey !== undefined && expandedGroupsTracker !== undefined) {
    // First paint of this member this boot → honor the `expandByDefault` opt-in
    // and seed the tracker so the choice persists. Subsequent paints → the
    // tracker is authoritative (a user collapse/expand wins over the default).
    if (!seededDefaultKeys.has(trackerKey)) {
      seededDefaultKeys.add(trackerKey);
      if (expandByDefault === true) {
        expandedGroupsTracker.setExpanded(trackerKey, true);
      }
    }
    initiallyExpanded = expandedGroupsTracker.isExpanded(trackerKey);
  } else {
    // No tracker (component tests) → the default decides each render.
    initiallyExpanded = expandByDefault === true;
  }

  // ── Article (reuse the single-tile chrome) ────────────────────────────────
  const article = document.createElement("article");
  article.className = "agent-tile";
  article.dataset.state = tile.aggregateState;
  // `data-count` is the single render switch (spec §1.2) — its presence marks
  // a multi-agent tile; CSS / tests gate the badge + expand region on it.
  article.dataset.count = String(count);
  article.dataset.memberId = tile.memberId;
  // role="group" (not "button") — the tile body is NOT a single drill-in
  // target here (instance drill-in lives on the rows). The persona name +
  // aggregate state is informational; expansion happens via the badge button.
  article.setAttribute("role", "group");
  article.setAttribute(
    "aria-label",
    `${tile.display} — ${tile.role} — ${STATE_LABEL[tile.aggregateState]} — ${count} agents`,
  );

  // Per-member running color (spec §2.5) — paint the aggregate running dot in
  // the member's color when running. idle/error/finished/available aggregates
  // ignore it (mirrors agentTile.ts). Loader guarantees a 6-digit lowercase
  // hex or undefined.
  if (
    tile.aggregateState === "running" &&
    tile.memberColor !== undefined
  ) {
    article.style.setProperty("--ct-color-running-dot", tile.memberColor);
  }

  // ── Sprite (pose from AGGREGATE state + headline activity, §1.4) ──────────
  // Per-member character (team-setup spec §5.3) drives the wrapper's single
  // persona sprite; `tile.character` (CharacterSource id / null) takes
  // precedence over the legacy gender binding, `undefined` falls back to it.
  const char =
    spriteBaseUri !== undefined
      ? spriteForMember(tile.memberId, tile.character)
      : null;
  if (char && spriteBaseUri !== undefined) {
    article.dataset.hasSprite = "true";
    const handle = createSpriteBox({
      char,
      // One sprite per persona regardless of N — pose follows the aggregate
      // (running → active_*; idle/finished/error/available → idle pool).
      state: tile.aggregateState,
      // Headline activity decides read-vs-work for the running aggregate pose.
      activity: tile.headlineActivity,
      spriteBaseUri,
      ...(spriteTracker
        ? {
            priorIdlePick: spriteTracker.priorIdlePick(
              sessionId,
              tile.memberId,
            ),
            priorWasActive: spriteTracker.priorWasActive(
              sessionId,
              tile.memberId,
            ),
          }
        : {}),
      ...(spriteRng ? { rng: spriteRng } : {}),
      ...(reducedMotion !== undefined ? { reducedMotion } : {}),
      ...(scheduleFrame ? { scheduleFrame } : {}),
      ...(cancelFrame ? { cancelFrame } : {}),
    });
    article.appendChild(handle.element);
    if (spriteTracker) {
      spriteTracker.register(sessionId, tile.memberId, {
        idlePick: handle.idlePick,
        isActive: handle.isActive,
        dispose: handle.dispose,
      });
    }
  }

  // ── Row 1 — state dot + display name + ×N badge ───────────────────────────
  const primaryRow = document.createElement("div");
  primaryRow.className = "tile-row tile-row--primary";

  const dot = document.createElement("span");
  dot.className = "state-dot";
  dot.dataset.state = tile.aggregateState;
  dot.setAttribute("aria-label", STATE_LABEL[tile.aggregateState]);
  dot.setAttribute("title", STATE_LABEL[tile.aggregateState]);
  primaryRow.appendChild(dot);

  const displaySpan = document.createElement("span");
  displaySpan.className = "agent-display";
  displaySpan.textContent = tile.display;
  primaryRow.appendChild(displaySpan);

  // The ×N badge IS the expand toggle (spec §1.3). A real <button> so
  // Enter/Space + focus ring come for free. Carries the chevron, aria-expanded,
  // and aria-controls pointing at the instance-list region.
  const regionId = `persona-instances-${nextRegionId++}`;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "persona-count-badge";
  badge.setAttribute("aria-expanded", String(initiallyExpanded));
  badge.setAttribute("aria-controls", regionId);
  badge.setAttribute(
    "aria-label",
    `${count} agents, ${initiallyExpanded ? "collapse" : "expand"}`,
  );

  const badgeCount = document.createElement("span");
  badgeCount.className = "persona-count-badge-count";
  badgeCount.textContent = `×${count}`;
  badge.appendChild(badgeCount);

  const chevron = document.createElement("span");
  chevron.className = "persona-count-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = initiallyExpanded ? CHEVRON_EXPANDED : CHEVRON_COLLAPSED;
  badge.appendChild(chevron);

  primaryRow.appendChild(badge);
  article.appendChild(primaryRow);

  // ── Row 2 — role ──────────────────────────────────────────────────────────
  article.appendChild(buildRow("tile-row--role", "agent-role", tile.role));

  // ── Row 3 — headline activity (spec §2.4) ─────────────────────────────────
  // Skip the row entirely on the `tool:?` sentinel, matching agentTile.ts
  // (86ca03ym7) — a `?` placeholder reads as noise.
  if (tile.headlineActivity !== "tool:?") {
    const activityRow = document.createElement("div");
    activityRow.className = "tile-row tile-row--activity";
    const activitySpan = document.createElement("span");
    activitySpan.className = "agent-activity";
    activitySpan.textContent = tile.headlineActivity;
    activityRow.appendChild(activitySpan);
    article.appendChild(activityRow);
  }

  // ── Row 4 — model · aggregate state·elapsed + (N agents) count hint ────────
  // The count hint (spec §1.2 row-4) makes multiplicity legible before expand
  // + for SR users skimming row 4. Model omitted on the `model:?` sentinel
  // (86ca1d76j), but the count hint still renders so multiplicity is never
  // lost. The "(N agents)" suffix is muted via the .persona-count-hint class.
  const modelRow = document.createElement("div");
  modelRow.className = "tile-row tile-row--model";
  const modelSpan = document.createElement("span");
  modelSpan.className = "agent-model";
  if (tile.headlineModel !== "model:?") {
    modelSpan.textContent = tile.headlineModel;
  }
  modelRow.appendChild(modelSpan);
  const countHint = document.createElement("span");
  countHint.className = "persona-count-hint";
  countHint.textContent = `(${count} agents)`;
  modelRow.appendChild(countHint);
  article.appendChild(modelRow);

  // ── Overflow affordance ([⋯]) — hide / remove the rostered MEMBER ─────────
  // 86ca1fjqu BUG 1: multi-agent ×N tiles were missing the "⋯" menu single
  // tiles carry, so a multi-agent member (e.g. Felix ×8) could not be hidden or
  // removed. Reuse the EXACT same `buildOverflowMenu` as `renderAgentTile` so
  // the affordance, messages (`ui:hide-member` / `ui:remove-member` for THIS
  // member), and a11y wiring are identical. The menu acts on the whole tile (the
  // rostered member), not a single instance — the (teamId, memberId) PAIR is the
  // member identity. `position: absolute` (dashboard.css) anchors it top-right;
  // the badge button + instance rows stopPropagation their own clicks, and the
  // menu's controls stopPropagation theirs, so the two surfaces never cross-fire.
  // The menuOpenTracker (BUG 2) persists the open phase across poll re-renders.
  article.appendChild(
    buildOverflowMenu({
      teamId: tile.teamId,
      memberId: tile.memberId,
      display: tile.display,
      postMessage,
      sessionId,
      ...(menuOpenTracker ? { menuOpenTracker } : {}),
    }),
  );

  // ── Inline instance list (collapsed by default, §3.1) ─────────────────────
  // `.persona-instances` declares display:flex and toggles via `hidden` — the
  // [hidden] guard in dashboard.css is mandatory (see file header).
  const instancesRegion = document.createElement("div");
  instancesRegion.className = "persona-instances";
  instancesRegion.id = regionId;
  instancesRegion.setAttribute("role", "list");
  instancesRegion.hidden = !initiallyExpanded;
  article.appendChild(instancesRegion);

  let populated = false;

  const populateInstances = (): void => {
    if (populated) return;
    for (const inst of tile.instances) {
      instancesRegion.appendChild(
        renderInstanceRow({
          inst,
          fallbackSessionId: sessionId,
          postMessage,
          ...(finishedTracker ? { finishedTracker } : {}),
          nowMs: now,
        }),
      );
    }
    populated = true;
  };

  const setExpanded = (expanded: boolean): void => {
    badge.setAttribute("aria-expanded", String(expanded));
    badge.setAttribute(
      "aria-label",
      `${count} agents, ${expanded ? "collapse" : "expand"}`,
    );
    chevron.textContent = expanded ? CHEVRON_EXPANDED : CHEVRON_COLLAPSED;
    if (expanded) {
      populateInstances();
    }
    instancesRegion.hidden = !expanded;
    if (trackerKey !== undefined && expandedGroupsTracker !== undefined) {
      expandedGroupsTracker.setExpanded(trackerKey, expanded);
    }
  };

  // When restored / default-expanded, populate eagerly so the DOM matches the
  // open `hidden=false` state set above (idempotent, guarded by `populated`).
  if (initiallyExpanded) {
    populateInstances();
  }

  // Toggle on click; native <button> handles Enter/Space → click. Esc on the
  // badge collapses + keeps focus on the badge (spec §3.3).
  badge.addEventListener("click", (ev: MouseEvent) => {
    ev.stopPropagation();
    setExpanded(instancesRegion.hidden);
  });
  badge.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && !instancesRegion.hidden) {
      ev.preventDefault();
      ev.stopPropagation();
      setExpanded(false);
      badge.focus();
    }
  });

  // Esc anywhere inside the expanded list collapses it and returns focus to
  // the badge (spec §3.3 focus management).
  instancesRegion.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      setExpanded(false);
      badge.focus();
    }
  });

  return article;
}

interface InstanceRowProps {
  inst: AgentTile;
  /** Session id to drill into when the instance omits its own sessionId. */
  fallbackSessionId: string;
  postMessage: PostMessageFn;
  finishedTracker?: FinishedTracker;
  nowMs?: number;
}

/**
 * One compact `.persona-instance-row` — NO sprite (one sprite per persona
 * tile; instance rows are sprite-less per spec §3.2). Row key is the instance
 * `agentId`. Drill-in opens THAT instance's transcript via its own `sessionId`
 * (cross-session instances must open the correct session — spec §3.2 / PR #123
 * NIT 2), falling back to the tile's session id when absent.
 *
 * Instance-row dots stay SEMANTIC — per-member color is NOT applied at the
 * instance level so a failure/idle mix is legible (spec §3.2 / §2.5).
 */
function renderInstanceRow(props: InstanceRowProps): HTMLElement {
  const { inst, fallbackSessionId, postMessage, finishedTracker, nowMs } = props;
  const now = nowMs ?? Date.now();
  const drillSessionId = inst.sessionId ?? fallbackSessionId;

  const row = document.createElement("div");
  row.className = "persona-instance-row";
  row.dataset.agentId = inst.agentId;
  row.dataset.sessionId = drillSessionId;
  row.dataset.state = inst.state;
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute(
    "aria-label",
    `${inst.display} ${shortId(inst.agentId)} — ${STATE_LABEL[inst.state]}`,
  );
  row.setAttribute("title", "Open agent transcript");

  const dot = document.createElement("span");
  dot.className = "state-dot";
  dot.dataset.state = inst.state;
  dot.setAttribute("aria-label", STATE_LABEL[inst.state]);
  dot.setAttribute("title", STATE_LABEL[inst.state]);
  row.appendChild(dot);

  const idSpan = document.createElement("span");
  idSpan.className = "persona-instance-id";
  idSpan.textContent = shortId(inst.agentId);
  idSpan.setAttribute("aria-label", "agent id");
  row.appendChild(idSpan);

  // Activity — finished rows pick up the freshness suffix when the host emits
  // the bare "finished" sentinel and a tracker timestamp is available (mirrors
  // agentTile.ts back-compat path). Normal host path supplies the suffix in
  // `inst.activity`, so this only fires in the no-timestamp diagnostic case.
  const finishedAtMs =
    inst.state === "finished" && finishedTracker
      ? finishedTracker.observe(drillSessionId, inst.agentId, now)
      : undefined;
  const activityText =
    inst.state === "finished" &&
    inst.activity === "finished" &&
    typeof finishedAtMs === "number"
      ? `${inst.activity} ${formatFreshness(now - finishedAtMs)}`
      : inst.activity;
  const activitySpan = document.createElement("span");
  activitySpan.className = "persona-instance-activity";
  activitySpan.textContent = activityText;
  // 86c9zfmhp parity — precise-ISO tooltip on finished rows when the host
  // supplied the wall-clock finish timestamp.
  if (inst.state === "finished" && typeof inst.finishedAtMs === "number") {
    activitySpan.setAttribute(
      "title",
      `Finished at ${new Date(inst.finishedAtMs).toISOString()}`,
    );
  }
  row.appendChild(activitySpan);

  const fire = (): void => {
    const msg: OpenTranscriptMessage = {
      type: "ui:open-transcript",
      payload: { sessionId: drillSessionId, agentId: inst.agentId },
    };
    postMessage(msg);
  };
  row.addEventListener("click", fire);
  row.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      // Don't bubble to the list's Esc handler / collapse — drill-in only.
      fire();
    }
  });

  return row;
}

/** First 8 chars of the agentId (spec §3.2 row identifier). */
function shortId(agentId: string): string {
  return agentId.slice(0, SHORT_ID_LEN);
}

function buildRow(
  rowClass: string,
  innerClass: string,
  text: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = `tile-row ${rowClass}`;
  const span = document.createElement("span");
  span.className = innerClass;
  span.textContent = text;
  row.appendChild(span);
  return row;
}
