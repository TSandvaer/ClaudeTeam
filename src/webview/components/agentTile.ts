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
import type {
  OpenTranscriptMessage,
  WebviewMessage,
} from "../../shared/messages.js";
import { formatFreshness } from "../../shared/freshness.js";
import { spriteForMember } from "../sprites/spriteManifest.js";
import { createSpriteBox } from "../sprites/spritePlayer.js";
import type { SpriteTracker } from "../spriteTracker.js";
import type { MenuOpenTracker } from "../menuOpenTracker.js";

/** Human-readable label per state — used in aria-label and title tooltip. */
const STATE_LABEL: Record<AgentState, string> = {
  running: "Running",
  idle: "Idle",
  finished: "Finished",
  error: "Error",
  // Roster-baseline never-run member (86ca18b9p). Label only — the never-run
  // visual treatment (quiet dot, dim rows, sprite) is E-05's scope.
  available: "Available",
};

/**
 * Function the tile uses to dispatch webview → host messages.
 *
 * Widened to the full `WebviewMessage` union (PR #98 NIT #2 — Felix
 * 2026-05-27) so threaded consumers (teamCard's "show idle" row, collapsed
 * persona tiles, future siblings) can post any webview→host message without
 * the `(postMessage as unknown as (m: WebviewMessage) => void)` cast that
 * was needed when this alias was narrowed to `OpenTranscriptMessage`. The
 * tile itself still only posts `OpenTranscriptMessage`; the underlying
 * dispatcher (`acquireVsCodeApi().postMessage` in `src/webview/main.ts`)
 * accepts the full union by construction.
 */
export type PostMessageFn = (msg: WebviewMessage) => void;

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
   * Host-injected webview-base URI for resolving sprite frame paths
   * (`<base>/sprites/<char>/...`). When present AND the member has a bound
   * sprite character (per `spriteForMember`), the tile renders a 68×68
   * persona pixel character at its leading edge. When absent — or when the
   * member has no sprite — the tile renders text-only exactly as before
   * (AC5: graceful degrade, no broken image; monogram skin is E-05's scope).
   *
   * Source: team/iris-ux/whole-team-display-spec.md §3
   */
  spriteBaseUri?: string;
  /**
   * Webview-local sprite playback tracker — owns idle-episode stickiness +
   * frame-timer disposal across the ~2s poll re-renders. Threaded from the
   * boot closure (main.ts), like finishedTracker / prevStateTracker. Required
   * alongside `spriteBaseUri` for the sprite to render; absent → text-only.
   */
  spriteTracker?: SpriteTracker;
  /**
   * Reduced-motion override for tests (AC4). Production reads
   * `matchMedia("(prefers-reduced-motion: reduce)")` inside the player.
   */
  reducedMotion?: boolean;
  /** Injected RNG for deterministic idle picks in tests. */
  spriteRng?: () => number;
  /** Frame-timer scheduler injection (tests). */
  scheduleFrame?: (cb: () => void, ms: number) => number;
  /** Frame-timer canceller injection (tests). */
  cancelFrame?: (handle: number) => void;
  /**
   * Webview-local overflow-menu open-state tracker (86ca1fjqu BUG 2). When
   * provided alongside `teamId` (always present on `tile`), a menu the user
   * opened survives the next host poll-tick re-render — without it, the ~2s
   * `renderFull` rebuild constructs a fresh closed menu and the open menu
   * vanishes mid-interaction. Keyed by `sessionId:teamId:memberId`. When
   * omitted (component tests), the menu starts closed and clicks don't persist
   * beyond the current DOM. Mirrors `expandedGroupsTracker` (Obs 10).
   */
  menuOpenTracker?: MenuOpenTracker;
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
    spriteBaseUri,
    spriteTracker,
    reducedMotion,
    spriteRng,
    scheduleFrame,
    cancelFrame,
    menuOpenTracker,
  } = props;

  // 86c9zfmhp (Obs 11): the host is now the single authority for the
  // humanized `finished Xs/Xm/Xh/Xd` activity string — `tile.activity`
  // arrives pre-humanized from the reducer. The webview must NOT append a
  // parallel second clock from the webview-local `finishedTracker`, which
  // was the V1-dogfood bug shape that surfaced as `"finished 19289s 3s"`
  // (host's wall-clock since-finish + webview's first-seen-since-reload).
  //
  // Back-compat: when the host emits a bare `"finished"` (no suffix — the
  // `finishedAtMs` is missing from the parent JSONL parse), the tracker-
  // sourced `finishedAtMs` prop is still consulted to add an `Xs/Xm/Xh/Xd`
  // suffix so freshness isn't lost in the diagnostic-only no-timestamp
  // case. The host's normal path always supplies the suffix; this branch
  // only fires for tests / fixture scenarios without a parsed timestamp.
  const activityText =
    tile.state === "finished" &&
    tile.activity === "finished" &&
    typeof finishedAtMs === "number"
      ? `${tile.activity} ${formatFreshness((nowMs ?? Date.now()) - finishedAtMs)}`
      : tile.activity;

  // 86c9zfmhp (Obs 11): precise-ISO tooltip on the activity row for
  // finished tiles. The humanized activity text (`finished 5h`) is the
  // primary skim signal; the tooltip surfaces the exact wall-clock time
  // the agent's `tool_result` landed in the parent JSONL — useful for
  // audit-class scenarios where the sponsor needs to correlate dispatch
  // completion with other events. `Date.prototype.toISOString` produces
  // a UTC-anchored string (ends in `Z`); rendering local-time would be
  // more friendly but cross-timezone audit cases benefit from UTC anchor.
  const activityTitle =
    tile.state === "finished" && typeof tile.finishedAtMs === "number"
      ? `Finished at ${new Date(tile.finishedAtMs).toISOString()}`
      : undefined;

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

  // 86c9zqa75 — member-color paint on the running dot (spec 86c9zmyef §2.4).
  // When the matched-roster member supplied a color AND the tile is in the
  // `running` state, paint via an inline `--ct-color-running-dot` custom
  // property; the CSS rule at `.state-dot[data-state="running"]` reads this
  // override with a fallback to the semantic `--ct-color-state-running`
  // token. Idle / finished / error states IGNORE `memberColor` per spec
  // §1.3 — the custom property simply isn't applied so those dots paint
  // from the semantic state tokens unchanged.
  //
  // Setting on the article (not on the `.state-dot` span itself) keeps the
  // override scope at the tile level — same precedent as M3-10 / 86c9zmqa8
  // data-* attributes that gate descendant CSS. Loader normalization
  // guarantees `tile.memberColor` is a 6-digit lowercase hex with leading
  // `#` (or undefined); invalid values are dropped upstream with a roster-
  // warning chip surface — no defensive validation needed at the renderer.
  if (tile.state === "running" && tile.memberColor !== undefined) {
    article.style.setProperty("--ct-color-running-dot", tile.memberColor);
  }
  // M4-03 AC3: drill-in affordance tooltip. Wording locked in M4-01 §3.3
  // ("Open agent transcript") — concrete destination ("agent transcript")
  // beats vague phrasings ("View activity log") and avoids leaking the
  // JSONL implementation detail ("Click to open JSONL"). Length kept
  // short — OS tooltip delays (~500-1000ms) make long tooltips feel laggy.
  article.setAttribute("title", "Open agent transcript");

  // ── Persona pixel-character sprite (whole-team-display-spec §3) ──────────
  // Render a 68×68 sprite at the leading edge ONLY when a base URI is wired
  // AND the member has a bound sprite character with resolvable frames.
  // Otherwise the tile stays text-only (AC5: no sprite box, no broken image —
  // the monogram fallback skin is E-05's scope, not this ticket).
  // Per-member character (team-setup spec §5.3) drives the sprite: prefer the
  // tile's `character` field (a CharacterSource id, or null = text tile) over
  // the legacy gender binding. `undefined` (pre-team-setup roster) falls back
  // to the gender binding inside `spriteForMember`.
  const char =
    spriteBaseUri !== undefined
      ? spriteForMember(tile.memberId, tile.character)
      : null;
  if (char && spriteBaseUri !== undefined) {
    article.dataset.hasSprite = "true";
    const handle = createSpriteBox({
      char,
      state: tile.state,
      activity: tile.activity,
      spriteBaseUri,
      ...(spriteTracker
        ? {
            priorIdlePick: spriteTracker.priorIdlePick(sessionId, tile.memberId),
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
  // 86c9zfmhp (Obs 11): inline the row build so we can attach the precise-
  // ISO tooltip to the inner span when finished + timestamp is known. We
  // intentionally attach the title to the `.agent-activity` span rather than
  // the row wrapper so the tooltip only appears when hovering the text
  // itself — overlapping the row's existing drill-in `title` (on the article)
  // would be confusing.
  //
  // 86ca03ym7 — hide the activity row entirely when the host emits the
  // `"tool:?"` sentinel (running state + null `lastTool` — fresh spawns or
  // between-tool-call moments where the subagent JSONL has no `tool_use`
  // entry yet). Sponsor dogfood observation: `tool: ?` on the dashboard
  // reads as noise rather than information; the tile is more honest with
  // the row absent than with a `?` placeholder. Sponsor decision LOCKED:
  // hide entirely, NOT em-dash, NOT state-aware label.
  //
  // The fix lives in the webview because the wire-shape `tile.activity`
  // remains the host's source of truth (CLI presenter still receives the
  // raw sentinel; only the dashboard renders the visual absence). OOS:
  // changing the reducer's `buildActivity` — the sentinel is load-bearing
  // for non-webview consumers.
  if (activityText !== "tool:?") {
    const activityRow = document.createElement("div");
    activityRow.className = "tile-row tile-row--activity";
    const activitySpan = document.createElement("span");
    activitySpan.className = "agent-activity";
    activitySpan.textContent = activityText;
    if (activityTitle !== undefined) {
      activitySpan.setAttribute("title", activityTitle);
    }
    activityRow.appendChild(activitySpan);
    article.appendChild(activityRow);
  }

  // Row 4 — model.
  //
  // 86ca1d76j (AC4): hide the model row entirely when the host emits the
  // `"model:?"` sentinel (no resolved model — available/never-run baseline
  // members like Iris/Nora/Bram, or a live agent whose first assistant
  // message hasn't landed yet). Sponsor dogfood observation: `model:?` reads
  // as noise rather than information; the tile is more honest with the row
  // absent than with a `?` placeholder. Same treatment + rationale as the
  // `tool:?` activity sentinel above (86ca03ym7). Finished members carry a
  // real model (`claude-opus-4-8`) and render the row unchanged.
  //
  // The wire-shape `tile.model` stays the host's source of truth (CLI
  // presenter / diagnostic panel still receive the raw sentinel); only the
  // dashboard renders the visual absence. OOS: changing `resolveModel`.
  if (tile.model !== "model:?") {
    article.appendChild(
      buildRow("tile-row--model", "agent-model", tile.model),
    );
  }

  // ── Overflow affordance ([⋯]) — hide-agent menu (E-06b / spec §7.1) ──────
  // A trailing kebab button revealed on tile hover OR keyboard focus (CSS
  // gates visibility; the element is always in the DOM for keyboard/AT
  // reachability). Activating it opens a small menu whose only V1 entry is
  // "Hide <display>" (Remove-from-roster is E-07 / OOS; Open-transcript stays
  // the tile-body click). The menu is keyboard-navigable (Enter/Space/Esc)
  // with focus returning to [⋯] on close.
  //
  // Baseline `available` tiles ARE hide-able (AC5 — the primary declutter
  // case: a never-run member the sponsor wants out of the default view), so
  // the affordance renders for every state including "available".
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

  // Click + keyboard handlers — both produce the same message. AC6 of M2-05.
  // tabindex="0" + role="button" makes Enter/Space the expected key activations.
  const fire = (): void => {
    const msg: OpenTranscriptMessage = {
      type: "ui:open-transcript",
      payload: { sessionId, agentId: tile.agentId },
    };
    postMessage(msg);
  };

  // Drill-in fires only when the click did NOT originate inside the overflow
  // menu (the menu's own handlers stopPropagation, but guard defensively so a
  // stray bubble can't open the transcript when the user meant to hide).
  article.addEventListener("click", (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (target && target.closest(".agent-tile-overflow")) {
      return;
    }
    fire();
  });
  article.addEventListener("keydown", (ev: KeyboardEvent) => {
    // Don't hijack Enter/Space when focus is inside the overflow control —
    // the menu's own buttons handle those keys.
    const target = ev.target as HTMLElement | null;
    if (target && target.closest(".agent-tile-overflow")) {
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      fire();
    }
  });

  return article;
}

/**
 * Build the per-tile overflow control ([⋯]) + its hide / remove menu (E-06b
 * hide + E-07b remove / spec §7.1 + §7.3). Returns a wrapper element appended
 * to the tile's primary surface.
 *
 * DOM shape:
 *
 *   <div class="agent-tile-overflow">
 *     <button class="agent-tile-overflow-btn" aria-haspopup="menu"
 *             aria-expanded="false" aria-label="agent actions">⋯</button>
 *     <div class="agent-tile-overflow-menu" role="menu" hidden>
 *       <button class="agent-tile-overflow-item" role="menuitem"
 *               data-action="hide">Hide {display}</button>
 *       <button class="agent-tile-overflow-item agent-tile-overflow-item--remove"
 *               role="menuitem" data-action="remove">Remove from roster…</button>
 *     </div>
 *     <div class="agent-tile-remove-confirm" role="dialog" hidden>
 *       … explanatory copy … [Cancel] [Remove]
 *     </div>
 *   </div>
 *
 * Interaction:
 *   - Click / Enter / Space on [⋯] toggles the menu.
 *   - Esc closes the menu (or the confirm panel) and returns focus to [⋯].
 *   - "Hide {display}" posts `ui:hide-member { teamId, memberId }` (the PAIR,
 *     never the joined key) and closes.
 *   - "Remove from roster…" (trailing … = confirm step, spec §7.3) swaps the
 *     menu for an in-tile confirm panel explaining that remove edits the
 *     roster (member disappears entirely — NOT even under "show hidden") and
 *     returns only via teams.yaml. "Remove" posts
 *     `ui:remove-member { teamId, memberId }`; "Cancel" returns to the menu.
 *   - Both the [⋯] button and every interactive descendant `stopPropagation`
 *     so the tile's drill-in click never fires for menu/confirm interactions.
 *
 * Remove vs. hide are visually + interactionally DISTINCT (spec §7.3 / E-07b):
 * hide is a single-click reversible cull; remove is gated behind the confirm
 * step + carries a destructive-leaning class (`--remove`) so the sponsor can't
 * mistake one for the other.
 *
 * Open-state persistence (86ca1fjqu BUG 2): the menu's open phase (menu vs.
 * confirm vs. closed) lives in `menuOpenTracker` keyed by
 * `sessionId:teamId:memberId` when one is threaded in, so the ~2s poll re-render
 * that rebuilds this DOM restores whatever the user had open instead of snapping
 * it shut. Every open/close/confirm transition writes the tracker; the
 * constructor reads it once to seed the initial phase. Without a tracker
 * (component tests) the menu starts closed and clicks are DOM-local only.
 *
 * Exported (86ca1fjqu BUG 1) so `multiAgentPersonaTile` reuses the IDENTICAL
 * affordance — the menu acts on the rostered MEMBER (the whole tile), posting
 * `ui:hide-member` / `ui:remove-member` for that member, exactly as on a single
 * tile. Sharing the builder guarantees the two tile types can never drift in
 * behavior, messages, or accessibility wiring.
 */
export function buildOverflowMenu(opts: {
  teamId: string;
  memberId: string;
  display: string;
  postMessage: PostMessageFn;
  /** Session id — composes the menu-open tracker key with teamId + memberId. */
  sessionId?: string;
  /** Optional open-state tracker (BUG 2). Survives poll-tick re-renders. */
  menuOpenTracker?: MenuOpenTracker;
}): HTMLElement {
  const { teamId, memberId, display, postMessage, sessionId, menuOpenTracker } =
    opts;

  // Tracker key — only composable when a tracker + sessionId are present. When
  // absent the menu has no cross-render memory (component-test path).
  const trackerKey =
    menuOpenTracker && sessionId !== undefined
      ? menuOpenTracker.makeKey(sessionId, teamId, memberId)
      : undefined;
  const seededPhase =
    trackerKey !== undefined && menuOpenTracker !== undefined
      ? menuOpenTracker.phase(trackerKey)
      : null;
  const recordPhase = (phase: "menu" | "confirm" | null): void => {
    if (trackerKey !== undefined && menuOpenTracker !== undefined) {
      menuOpenTracker.setPhase(trackerKey, phase);
    }
  };

  const wrapper = document.createElement("div");
  wrapper.className = "agent-tile-overflow";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "agent-tile-overflow-btn";
  btn.setAttribute("aria-haspopup", "menu");
  // Seeded from the tracker so a poll-tick re-render restores the open state.
  btn.setAttribute("aria-expanded", String(seededPhase !== null));
  btn.setAttribute("aria-label", "agent actions");
  // Horizontal-ellipsis glyph (U+22EF) — the kebab/more affordance.
  btn.textContent = "⋯";

  const menu = document.createElement("div");
  menu.className = "agent-tile-overflow-menu";
  menu.setAttribute("role", "menu");
  // Seeded open when the user had the menu (not the confirm panel) open at the
  // last tick — BUG 2 persistence.
  menu.hidden = seededPhase !== "menu";

  const hideItem = document.createElement("button");
  hideItem.type = "button";
  hideItem.className = "agent-tile-overflow-item";
  hideItem.setAttribute("role", "menuitem");
  hideItem.dataset.action = "hide";
  hideItem.textContent = `Hide ${display}`;

  // Remove menu entry — trailing ellipsis signals the confirm step (spec §7.3).
  const removeItem = document.createElement("button");
  removeItem.type = "button";
  removeItem.className =
    "agent-tile-overflow-item agent-tile-overflow-item--remove";
  removeItem.setAttribute("role", "menuitem");
  removeItem.dataset.action = "remove";
  removeItem.textContent = "Remove from roster…";

  // ── Confirm panel (in-tile, CSP-strict — no native modal) ───────────────
  // Distinct surface from the menu (spec §7.3 requires a confirm step). Built
  // up-front and toggled, so the focus + key handlers can be wired once.
  const confirm = document.createElement("div");
  confirm.className = "agent-tile-remove-confirm";
  confirm.setAttribute("role", "dialog");
  confirm.setAttribute("aria-label", `Remove ${display} from the roster?`);
  // Seeded open when the user had the confirm panel open at the last tick.
  confirm.hidden = seededPhase !== "confirm";

  const confirmTitle = document.createElement("p");
  confirmTitle.className = "agent-tile-remove-confirm-title";
  confirmTitle.textContent = `Remove ${display} from the roster?`;
  confirm.appendChild(confirmTitle);

  const confirmBody = document.createElement("p");
  confirmBody.className = "agent-tile-remove-confirm-body";
  // Spec §7.3 copy: remove is more permanent than hide; not even under "show
  // hidden"; restore is yaml-gated only.
  confirmBody.textContent =
    `${display} will no longer appear on the dashboard at all — not even ` +
    `under “show hidden”. To bring ${display} back, re-add the member in ` +
    `teams.yaml.`;
  confirm.appendChild(confirmBody);

  const confirmActions = document.createElement("div");
  confirmActions.className = "agent-tile-remove-confirm-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "agent-tile-remove-confirm-cancel";
  cancelBtn.textContent = "Cancel";

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "agent-tile-remove-confirm-remove";
  confirmBtn.dataset.action = "remove-confirm";
  confirmBtn.textContent = "Remove";

  confirmActions.appendChild(cancelBtn);
  confirmActions.appendChild(confirmBtn);
  confirm.appendChild(confirmActions);

  const closeMenu = (returnFocus: boolean): void => {
    menu.hidden = true;
    confirm.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    recordPhase(null);
    if (returnFocus) {
      btn.focus();
    }
  };
  const openMenu = (): void => {
    confirm.hidden = true;
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    recordPhase("menu");
    hideItem.focus();
  };
  // Swap the menu for the confirm panel (the second step of the remove flow).
  const openConfirm = (): void => {
    menu.hidden = true;
    confirm.hidden = false;
    recordPhase("confirm");
    // Focus the safe default (Cancel), not the destructive button — a stray
    // Enter shouldn't remove the member.
    cancelBtn.focus();
  };

  btn.addEventListener("click", (ev: MouseEvent) => {
    ev.stopPropagation();
    if (menu.hidden && confirm.hidden) {
      openMenu();
    } else {
      closeMenu(false);
    }
  });
  btn.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      ev.stopPropagation();
      openMenu();
    } else if (ev.key === "Escape" && (!menu.hidden || !confirm.hidden)) {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
  });

  hideItem.addEventListener("click", (ev: MouseEvent) => {
    ev.stopPropagation();
    const msg: WebviewMessage = {
      type: "ui:hide-member",
      // Payload carries the (teamId, memberId) PAIR — host re-joins via
      // hiddenMemberKey(). The webview never sends the pre-joined key.
      payload: { teamId, memberId },
    };
    postMessage(msg);
    closeMenu(true);
  });
  hideItem.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
    // Enter/Space on a native <button> fire click — no extra handling needed.
  });

  // Remove menu item → open the confirm panel (does NOT post yet).
  removeItem.addEventListener("click", (ev: MouseEvent) => {
    ev.stopPropagation();
    openConfirm();
  });
  removeItem.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
  });

  // Cancel → back to the menu (reversible — nothing posted).
  cancelBtn.addEventListener("click", (ev: MouseEvent) => {
    ev.stopPropagation();
    openMenu();
  });
  cancelBtn.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
  });

  // Confirm Remove → post ui:remove-member with the (teamId, memberId) PAIR.
  confirmBtn.addEventListener("click", (ev: MouseEvent) => {
    ev.stopPropagation();
    const msg: WebviewMessage = {
      type: "ui:remove-member",
      // PAIR, never the joined key — host builds it via removedMemberKey().
      payload: { teamId, memberId },
    };
    postMessage(msg);
    closeMenu(true);
  });
  confirmBtn.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu(true);
    }
  });

  menu.appendChild(hideItem);
  menu.appendChild(removeItem);
  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  wrapper.appendChild(confirm);
  return wrapper;
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
