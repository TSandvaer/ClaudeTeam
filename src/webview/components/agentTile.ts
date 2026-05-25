/**
 * agentTile — renders one rostered AgentTile per Iris's M2-03 §5 spec.
 *
 * DOM shape (exact, matches §5.2):
 *
 *   <article class="agent-tile" data-state data-agent-id data-session-id
 *            role="button" tabindex="0" aria-label="...">
 *     <div class="tile-row tile-row--primary">
 *       <span class="state-dot" data-state aria-label title></span>
 *       <span class="agent-display">{display}</span>
 *     </div>
 *     <div class="tile-row tile-row--role">
 *       <span class="agent-role">{role}</span>
 *     </div>
 *     <div class="tile-row tile-row--activity">
 *       <span class="agent-activity">{activity}</span>
 *     </div>
 *     <div class="tile-row tile-row--model">
 *       <span class="agent-model">{model}</span>
 *     </div>
 *   </article>
 *
 * Click + Enter/Space dispatch `ui:open-transcript` via the injected
 * `postMessage` function. The dispatch is decoupled from the DOM so tests can
 * inspect the message without faking the VS Code API.
 *
 * Activity text is NOT truncated (D1 — spec §2 divergence): CSS `word-break:
 * break-word` handles overflow. The presenter contract is "render the full
 * string; let CSS wrap."
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §5 (Agent tile)
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC4, AC6
 */

import type { AgentTile, AgentState } from "../../shared/types.js";
import type { OpenTranscriptMessage } from "../../shared/messages.js";
import { formatFreshness } from "../freshness.js";

/** Human-readable label per state — used in aria-label and title tooltip. */
const STATE_LABEL: Record<AgentState, string> = {
  running: "Running",
  idle: "Idle",
  finished: "Finished",
  error: "Error",
};

/** Function the tile uses to dispatch webview → host messages. */
export type PostMessageFn = (msg: OpenTranscriptMessage) => void;

export interface AgentTileProps {
  tile: AgentTile;
  sessionId: string;
  postMessage: PostMessageFn;
  /**
   * Wall-clock epoch ms when the webview FIRST observed this tile in
   * `finished` state. Used only when `tile.state === "finished"` to render
   * a freshness suffix (`finished Xs / Xm / Xh`) parallel to the host-side
   * `idle Xs` convention.
   *
   * The caller (render.ts → main.ts) owns the tracker; this component is a
   * pure renderer. When omitted (or when the tile is not finished), the
   * activity field renders verbatim from `tile.activity` — back-compat with
   * pre-NIT#3 callers and with non-finished states.
   *
   * `nowMs` is also injected so tests don't need to mock `Date.now()`.
   * Defaults to `Date.now()` in production.
   *
   * Source: ClickUp 86c9ybtut (M3-04 NIT #3)
   */
  finishedAtMs?: number;
  /** Current wall-clock ms — defaults to Date.now(). Test injection point. */
  nowMs?: number;
  /**
   * Last-rendered state for this tile (per the webview-local
   * `prevStateTracker`). When defined AND different from `tile.state`, the
   * renderer applies a `data-transition="to-<newState>"` attribute for the
   * `--ct-duration-state-transition` window (cleared via setTimeout at
   * 400ms — covers the longest M4-01 §2.3 transition animation, the
   * `→ error` one-shot flash).
   *
   * `undefined` means "first render of this tile this webview boot" — per
   * M4-01 §2.5 rule 3, first appearance is NOT a transition; we skip the
   * `data-transition` attribute and let the steady-state visual (color
   * dot, pulse on running, fade on idle, check on finished) speak for
   * itself.
   *
   * Source: team/iris-ux/m4-polish-spec.md §2.5 + §2.3 transition matrix
   */
  prevState?: AgentState;
  /**
   * Schedule a one-shot callback for clearing the transition attribute.
   * Defaults to `setTimeout` in production; tests inject a synchronous
   * scheduler (or vitest fake timers) to assert the cleared-state path.
   * Returning an opaque handle keeps the renderer pure of test concerns.
   */
  scheduleClearTransition?: (cb: () => void, ms: number) => void;
}

/**
 * Duration the `data-transition` attribute stays on the article (ms). Sized
 * to cover the longest M4-01 §2.3 animation — the `→ error` one-shot flash
 * at 400ms. Graceful transitions complete sooner (200ms — the
 * `--ct-duration-state-transition` token) but clearing at the longer
 * envelope means a single timeout covers every transition target without
 * per-state branching.
 */
const TRANSITION_CLEAR_MS = 400;

export function renderAgentTile(props: AgentTileProps): HTMLElement {
  const {
    tile,
    sessionId,
    postMessage,
    finishedAtMs,
    nowMs,
    prevState,
    scheduleClearTransition,
  } = props;

  // Compose the activity text — for finished tiles with a tracked first-seen
  // timestamp, suffix with " Xs / Xm / Xh" for freshness visibility (NIT #3).
  // Stale tiles look identical to fresh-finished tiles without this signal —
  // sponsor flagged the gap from the 2026-05-24 screenshot (Iris's tile
  // showed bare "finished" alongside Maya's "idle 14s" / Bram's "idle 47s").
  const activityText =
    tile.state === "finished" && typeof finishedAtMs === "number"
      ? `${tile.activity} ${formatFreshness((nowMs ?? Date.now()) - finishedAtMs)}`
      : tile.activity;

  const article = document.createElement("article");
  article.className = "agent-tile";
  article.dataset.state = tile.state;
  article.dataset.agentId = tile.agentId;
  article.dataset.sessionId = sessionId;
  article.setAttribute("role", "button");
  article.setAttribute("tabindex", "0");
  article.setAttribute(
    "aria-label",
    `${tile.display} — ${tile.role} — ${STATE_LABEL[tile.state]}`,
  );

  // State-transition attribute (M4-01 §2.5).
  //
  // When the prevStateTracker reports a previously-seen state for this tile
  // and it differs from the current state, set `data-transition="to-<state>"`
  // for the animation window. The CSS in dashboard.css selects on this
  // attribute to fire the `→ error` flash + opacity transitions; clearing
  // the attribute at TRANSITION_CLEAR_MS leaves the tile in its steady-state
  // visual.
  //
  // First-render case (prevState === undefined): skip the attribute — per
  // M4-01 §2.5 rule 3, first appearance is NOT a transition.
  //
  // Reduced-motion handling: the CSS `@media (prefers-reduced-motion: reduce)`
  // block elides the animation but the attribute still flips briefly. That's
  // intentional — color/opacity end-states still apply via the same selector,
  // just without the keyframe motion. See dashboard.css.
  if (prevState !== undefined && prevState !== tile.state) {
    article.dataset.transition = `to-${tile.state}`;
    const schedule =
      scheduleClearTransition ??
      ((cb: () => void, ms: number) => {
        setTimeout(cb, ms);
      });
    schedule(() => {
      // Clear ONLY if still pointing at the same transition target — a
      // rapid second transition (running → error → running within 400ms,
      // rare but possible if the host emits back-to-back state updates)
      // would have already overwritten `data-transition` to the newer
      // target; clobbering it here would shorten the second animation.
      if (article.dataset.transition === `to-${tile.state}`) {
        article.dataset.transition = "";
      }
    }, TRANSITION_CLEAR_MS);
  }

  // Row 1 — state dot + display name (primary row).
  const primaryRow = document.createElement("div");
  primaryRow.className = "tile-row tile-row--primary";

  const dot = document.createElement("span");
  dot.className = "state-dot";
  dot.dataset.state = tile.state;
  dot.setAttribute("aria-label", STATE_LABEL[tile.state]);
  dot.setAttribute("title", STATE_LABEL[tile.state]);
  primaryRow.appendChild(dot);

  const displaySpan = document.createElement("span");
  displaySpan.className = "agent-display";
  displaySpan.textContent = tile.display;
  primaryRow.appendChild(displaySpan);

  article.appendChild(primaryRow);

  // Row 2 — role.
  article.appendChild(
    buildRow("tile-row--role", "agent-role", tile.role),
  );

  // Row 3 — activity (no truncation, CSS wraps).
  article.appendChild(
    buildRow("tile-row--activity", "agent-activity", activityText),
  );

  // Row 4 — model.
  article.appendChild(
    buildRow("tile-row--model", "agent-model", tile.model),
  );

  // Click + keyboard handlers — both produce the same message. AC6 of M2-05.
  // tabindex="0" + role="button" makes Enter/Space the expected key activations.
  const fire = (): void => {
    const msg: OpenTranscriptMessage = {
      type: "ui:open-transcript",
      payload: { sessionId, agentId: tile.agentId },
    };
    postMessage(msg);
  };

  article.addEventListener("click", fire);
  article.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fire();
    }
  });

  return article;
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
