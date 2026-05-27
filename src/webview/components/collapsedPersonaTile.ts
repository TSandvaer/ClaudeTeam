/**
 * collapsedPersonaTile — renders one CollapsedPersonaGroup as a header tile
 * with an expand/collapse chevron + (when expanded) the list of grouped
 * AgentTile instances rendered via the existing `renderAgentTile` (M3-10
 * AC2).
 *
 * DOM shape:
 *
 *   <section class="collapsed-persona" data-persona-name data-expanded
 *            data-state>
 *     <button class="collapsed-persona-header" type="button"
 *             aria-expanded="false">
 *       <span class="state-dot" data-state aria-label title></span>
 *       <span class="collapsed-persona-chevron">▶</span>
 *       <span class="collapsed-persona-name">{personaName} ×{N}</span>
 *     </button>
 *     <div class="collapsed-persona-instances" hidden>
 *       {one renderAgentTile per instance}
 *     </div>
 *   </section>
 *
 * Where `{N}` is `group.instances.length` (see "Defensive count read"
 * below). The wrapper does NOT carry `data-team-id` — the teamId is known
 * at the `teamCard.ts` call-site but isn't currently needed inside the
 * wrapper's DOM; if a future feature needs it, thread it through
 * `CollapsedPersonaTileProps` and set `section.dataset.teamId` here.
 *
 * Group state label (ClickUp 86c9yxvah — worst-case-live-instance):
 *   The header renders a state-dot reflecting the group's most-active-first
 *   priority across `group.instances`:
 *       running > idle > finished > error
 *   "Most-active-first" — any live activity should surface even if other
 *   instances have already finished. So a group of [finished, idle, finished]
 *   reads `idle` (one Priya still working), not `finished` (which would
 *   wrongly imply the work is done). See `computeGroupState()` below.
 *
 * Interaction (AC2):
 *   - Collapsed by default — `data-expanded="false"`, instances `hidden`.
 *   - Click chevron/header → flip to expanded; instances render and become
 *     visible. Per-tile click handlers continue to fire drill-in messages
 *     unchanged (back-compat with the existing renderAgentTile contract).
 *   - Click again → collapse.
 *
 * Defensive count read:
 *   The header text and aria-label render `group.instances.length`, NOT
 *   `group.count`. The host-side reducer's invariant is
 *   `group.count === group.instances.length`, but reading from the array
 *   length means a host-side invariant violation surfaces as a wrong
 *   `count` field on the wire (one place) rather than a header that
 *   disagrees with the expanded list (two places, harder to diagnose).
 *   The `count` field stays in the type for the wire format and for
 *   host-side consumers that haven't been refactored yet; removing it is
 *   tracked separately as a post-Felix/Maya unification follow-up.
 *
 * Why a section (not an article): one CollapsedPersonaGroup is not a single
 * tile but a grouping of tiles. `article` is reserved for the per-instance
 * AgentTile. The aria semantics flow from the button (`aria-expanded`).
 *
 * Theme variables only — `--vscode-list-hoverBackground`, `--vscode-foreground`,
 * `--vscode-descriptionForeground`. No hardcoded colors.
 *
 * Source: ClickUp 86c9ydug9 (M3-10 persona-tile-collapse) AC2
 *         src/shared/types.ts CollapsedPersonaGroup
 *         src/webview/components/agentTile.ts (per-instance renderer)
 */

import type {
  AgentState,
  AgentTile,
  CollapsedPersonaGroup,
} from "../../shared/types.js";
import { renderAgentTile, type PostMessageFn } from "./agentTile.js";
import type { FinishedTracker } from "../finishedTracker.js";
import type { PrevStateTracker } from "../prevStateTracker.js";
import type { ExpandedGroupsTracker } from "../expandedGroupsTracker.js";
import { formatFreshness } from "../freshness.js";

/**
 * Human-readable label per state — matches `agentTile.ts STATE_LABEL` so
 * the aria-label vocabulary is consistent across bare tiles and collapsed
 * group headers.
 */
const STATE_LABEL: Record<AgentState, string> = {
  running: "Running",
  idle: "Idle",
  finished: "Finished",
  error: "Error",
};

/**
 * 86c9zmqa8 §8.3 — status-hint label vocabulary for the auto-collapsed
 * uniform-cluster header (Option A.1). Only `idle` and `finished` are
 * uniform-cluster-eligible per `computeIsUniform` below (running excluded
 * because activity-line varies per poll; error excluded because each
 * instance is potentially a separate failure). The `Partial<Record<...>>`
 * shape means a lookup for any state returns `undefined` cleanly when the
 * caller (defensively) tries to compose a hint for a non-eligible state.
 *
 * Source: team/iris-ux/86c9zmqa8-uniform-cluster-spec.md §2.4, §7, §8.3.
 */
export const STATUS_HINT_LABEL: Partial<Record<AgentState, string>> = {
  idle: "all idle",
  finished: "all finished",
};

/**
 * 86c9zmqa8 §3.3 / §8.2 — disambiguator letters for compact rows. Letters
 * read like sibling labels (`[a]`, `[b]`); numbers would read like priority
 * ordering. The display-only labels do NOT replace `data-agent-id` — the
 * real agentId still drives drill-in. Beyond 26 instances (a count never
 * observed in practice), `disambiguatorFor` rolls over to `[aa]`, `[ab]`,
 * etc. — collision impossible because the agentId is the real key.
 */
export const DISAMBIGUATOR_LETTERS = "abcdefghijklmnopqrstuvwxyz";

/**
 * Compose the disambiguator label for a 0-indexed instance position.
 * Mirrors a base-26 numeral system using `DISAMBIGUATOR_LETTERS`. Pure /
 * cheap — exercised by the compact-row tests in
 * `tests/unit/webview/collapsedPersonaTile.test.ts`.
 */
export function disambiguatorFor(index: number): string {
  // Defensive: a negative or non-integer index would be a caller bug; surface
  // as `[?]` rather than throwing — the header text is decorative, not
  // load-bearing for drill-in (agentId is on data-agent-id).
  if (!Number.isInteger(index) || index < 0) return "[?]";
  let n = index;
  let label = "";
  do {
    label = DISAMBIGUATOR_LETTERS[n % 26] + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `[${label}]`;
}

/**
 * 86c9zmqa8 §2.1 — uniform-cluster detection.
 *
 * Returns `true` when ALL of:
 *   1. `instances.length >= 2` (it's already a group — bare tiles unaffected).
 *   2. Every instance shares the same `state`.
 *   3. The shared state is `idle` OR `finished` (not `running`, not `error`).
 *   4. Every instance shares the same `role`.
 *
 * Returns `false` otherwise (mixed states, mixed roles, running/error cluster,
 * size < 2). A cluster that fails the test is "mixed" — the M3-10 expand
 * behavior is correct for it. Activity and model are intentionally NOT in
 * the uniformity test (activity wobbles per poll; model is roster-stable
 * and redundant with role).
 *
 * Pure function over the input array — no DOM, no clock, idempotent. Used
 * both by the initial-render gate (Option A) and the expand-time compact
 * render branch (Option B).
 *
 * Source: team/iris-ux/86c9zmqa8-uniform-cluster-spec.md §1.2 + §2.1.
 */
export function computeIsUniform(instances: AgentTile[]): boolean {
  if (instances.length < 2) return false;
  const first = instances[0]!;
  if (first.state === "running" || first.state === "error") return false;
  for (const t of instances) {
    if (t.state !== first.state) return false;
    if (t.role !== first.role) return false;
  }
  return true;
}

/**
 * Compute the group's display state from its per-instance states with
 * most-active-first priority. The order is `running > idle > finished >
 * error` per ClickUp 86c9yxvah AC1: any `running` instance forces the
 * group label to `running`; otherwise any `idle` forces `idle`; only when
 * ALL instances are `finished` does the group read `finished`; the
 * remaining residual (instances are some mix that contains at least one
 * `error` but no `running`/`idle` and is not all-`finished`) reads
 * `error`.
 *
 * Why "worst-case-live": a Priya×3 group with [finished, idle, finished]
 * has one Priya still working — the user needs to see that live activity,
 * not the dominant `finished`. Aggregating to the most-active state
 * preserves that signal.
 *
 * The function is exported for the AC unit tests (ACs 2/3/4) and is a
 * pure function over `AgentState[]` — no DOM, no clock, idempotent.
 *
 * Empty input: defensive — returns `error` (a group with zero instances
 * should not exist on the wire; the reducer's invariant is `count >= 2`
 * for any wrapper. Surfacing `error` makes the violation visible in the
 * dashboard rather than silently picking `finished`).
 *
 * Source: ClickUp 86c9yxvah (Defect 6b — collapsed-group state label)
 */
export function computeGroupState(instances: AgentTile[]): AgentState {
  if (instances.length === 0) return "error";
  let sawIdle = false;
  let sawError = false;
  let allFinished = true;
  for (const t of instances) {
    if (t.state === "running") return "running";
    if (t.state !== "finished") allFinished = false;
    if (t.state === "idle") sawIdle = true;
    if (t.state === "error") sawError = true;
  }
  if (sawIdle) return "idle";
  if (allFinished) return "finished";
  if (sawError) return "error";
  // Residual — no running/idle, not all finished, no error. The four
  // AgentState values are exhaustive so this branch is unreachable in
  // practice; default to `error` for the same surfacing reason as the
  // empty-input branch above.
  return "error";
}

export interface CollapsedPersonaTileProps {
  group: CollapsedPersonaGroup;
  /** Session id passed through to each per-instance tile renderer. */
  sessionId: string;
  /**
   * Team id owning this wrapper — used (together with sessionId +
   * personaName) to compose the persistence key for the
   * `expandedGroupsTracker`. Optional only for back-compat with older
   * callers / tests that don't thread the tracker.
   */
  teamId?: string;
  /** Webview → host postMessage fn passed through to instances. */
  postMessage: PostMessageFn;
  /**
   * Optional finished-tile tracker, threaded to per-instance tiles. When the
   * wrapper is collapsed the tracker is NOT consulted (the instances aren't
   * in the DOM yet); when expanded each finished instance observes via the
   * tracker exactly as it does in the bare-tile path.
   */
  finishedTracker?: FinishedTracker;
  /**
   * Optional webview-local last-rendered-state tracker (M4-05 §2.5).
   * Threaded through to per-instance tiles. Mirrors `finishedTracker` —
   * when the wrapper is collapsed the tracker is NOT consulted (the
   * instances aren't in the DOM yet); on first expand each instance reads
   * its previous state (undefined → no transition flash on first display)
   * and records the current state.
   */
  prevStateTracker?: PrevStateTracker;
  /**
   * Optional webview-local expansion-state tracker (Obs 10, 86c9zfmh1).
   * When provided, the wrapper:
   *   - reads `isExpanded(key)` once in the constructor to choose the
   *     initial render state — pre-expand if the user previously opened
   *     this same group in this webview session;
   *   - writes back via `setExpanded(key, value)` on every click toggle so
   *     the next host poll-tick re-render restores the user's intent.
   * When omitted (e.g. component tests / pre-Obs-10 callers), the wrapper
   * always starts collapsed and clicks don't persist beyond the current
   * DOM — the pre-Obs-10 behavior, exercised by the existing AC2 tests.
   */
  expandedGroupsTracker?: ExpandedGroupsTracker;
  /**
   * 86c9zmqa8 — uniform-cluster polish toggle. When `true` AND the group
   * satisfies `computeIsUniform`, the wrapper:
   *   - renders auto-collapsed by default regardless of `expandedGroupsTracker`
   *     (Option A — §2.1 / §2.3);
   *   - shows a one-line status hint in the header reading `"all idle"` /
     *   `"all finished"` (Option A.1 — §2.4);
   *   - on manual expand, renders instances as compact one-line rows with
   *     `[a]` / `[b]` / `[c]` disambiguator labels and a single state-dot +
   *     activity span per row (Option B — §3.2).
   * When `false` OR the group is mixed, the wrapper renders per pre-86c9zmqa8
   * (M3-10 + Obs 10) behavior. Optional; default `false` so back-compat
   * callers (component tests, fixture mode) see no behavior change.
   *
   * Source: team/iris-ux/86c9zmqa8-uniform-cluster-spec.md §7 + §8.
   */
  autoCollapseUniformClusters?: boolean;
  /** Current wall-clock ms — defaults to Date.now() inside agentTile. */
  nowMs?: number;
}

export function renderCollapsedPersonaTile(
  props: CollapsedPersonaTileProps,
): HTMLElement {
  const {
    group,
    sessionId,
    teamId,
    postMessage,
    finishedTracker,
    prevStateTracker,
    expandedGroupsTracker,
    autoCollapseUniformClusters,
    nowMs,
  } = props;

  // 86c9zmqa8 §2.1 — compute uniformity ONCE per render. The polish behavior
  // (auto-collapse + status hint + compact rows) is gated by BOTH the
  // sponsor's autoCollapseUniformClusters flag AND the cluster's actual
  // uniformity. Either is sufficient to revert to pre-86c9zmqa8 behavior:
  //   - flag off → full back-compat regardless of uniformity;
  //   - flag on + mixed cluster → still pre-86c9zmqa8 expand behavior.
  const isUniform = computeIsUniform(group.instances);
  const isUniformPolish = autoCollapseUniformClusters === true && isUniform;

  // Obs 10 (86c9zfmh1) — read initial expansion intent from the persistent
  // tracker. Composed key includes sessionId + teamId + personaName so two
  // different teams can host a same-named persona wrapper without sharing
  // expansion state. When the tracker / teamId is absent (back-compat
  // callers), default to collapsed exactly as pre-Obs-10.
  //
  // 86c9zmqa8 §2.3 — when the uniform-cluster polish applies, the
  // expansion-tracker read is short-circuited: uniform clusters always
  // render collapsed by default regardless of prior user intent. The
  // tracker is STILL written to on click below (intent is recorded for
  // diagnostic / replay purposes) — it just doesn't drive the initial
  // render. This is the "click doesn't stick across polls" trade-off the
  // spec calls out explicitly (§2.5 Cons + §2.6 mitigation).
  const trackerKey =
    expandedGroupsTracker && teamId !== undefined
      ? expandedGroupsTracker.makeKey(sessionId, teamId, group.personaName)
      : undefined;
  const initiallyExpanded = isUniformPolish
    ? false
    : trackerKey !== undefined && expandedGroupsTracker !== undefined
      ? expandedGroupsTracker.isExpanded(trackerKey)
      : false;

  const section = document.createElement("section");
  section.className = "collapsed-persona";
  section.dataset.personaName = group.personaName;
  // 86c9zmqa8 §8.2 — `data-uniform` attribute lets CSS gate compact-row
  // styling and any future uniformity-conditional visuals without re-running
  // the JS uniformity check. "true" / "false" string values per spec table.
  section.dataset.uniform = String(isUniformPolish);
  // dataset value is set authoritatively further down via `setExpanded(...)`
  // — initialised here so the attribute is present from the first paint.
  section.dataset.expanded = String(initiallyExpanded);

  // Header — a real <button> so the keyboard / screen-reader semantics are
  // free (Enter + Space activation, focus ring, role=button).
  // Defensive: read count from the array (see file header JSDoc "Defensive
  // count read"). `group.count` is documented to equal `group.instances.length`
  // but reading from the array means a host invariant violation surfaces as a
  // wrong `count` field on the wire, not as a header that disagrees with the
  // expanded list.
  const instanceCount = group.instances.length;

  // Group state label (ClickUp 86c9yxvah) — computed from per-instance
  // states with most-active-first priority (running > idle > finished >
  // error). Mirrored onto BOTH the section dataset (`data-state`) and the
  // state-dot's `data-state` so callers / future CSS can hook in at either
  // level. The state-dot reuses the `.state-dot[data-state="..."]` CSS rules
  // already shipped for `agentTile.ts` (M2 §5.2 + M4-01 §2.2 pulse on
  // running) — no new CSS needed.
  const groupState = computeGroupState(group.instances);
  section.dataset.state = groupState;

  const header = document.createElement("button");
  header.type = "button";
  header.className = "collapsed-persona-header";
  // Obs 10 — initial aria-expanded reflects the restored expansion intent.
  // The same string is recomputed authoritatively in `setExpanded(...)`
  // when populating below, so this initial set is only the first-paint
  // value before populateInstances / setExpanded runs.
  header.setAttribute("aria-expanded", String(initiallyExpanded));
  header.setAttribute(
    "aria-label",
    `${group.personaName} grouped — ${instanceCount} instances, ${STATE_LABEL[groupState]}, ${
      initiallyExpanded ? "expanded" : "collapsed"
    }`,
  );

  // State dot — placed first so the visual scan order matches the per-tile
  // agentTile.ts layout (dot → name). The chevron follows; the persona
  // name + count read last.
  const stateDot = document.createElement("span");
  stateDot.className = "state-dot";
  stateDot.dataset.state = groupState;
  stateDot.setAttribute("aria-label", STATE_LABEL[groupState]);
  stateDot.setAttribute("title", STATE_LABEL[groupState]);
  header.appendChild(stateDot);

  const chevron = document.createElement("span");
  chevron.className = "collapsed-persona-chevron";
  // Obs 10 — initial chevron glyph matches the restored expansion intent
  // (▼ when restored expanded; ▶ when collapsed). setExpanded(...) rewrites
  // it on every toggle.
  chevron.textContent = initiallyExpanded ? "▼" : "▶";
  chevron.setAttribute("aria-hidden", "true");
  header.appendChild(chevron);

  const nameSpan = document.createElement("span");
  nameSpan.className = "collapsed-persona-name";
  nameSpan.textContent = `${group.personaName} ×${instanceCount}`;
  header.appendChild(nameSpan);

  // 86c9zmqa8 §2.4 — status-hint row (Option A.1). Only appended when the
  // uniform-cluster polish applies; the shared state must be in
  // STATUS_HINT_LABEL (idle / finished) — `computeIsUniform` already
  // guarantees this, but the lookup defensively yields `undefined` for
  // non-eligible states so a future widening doesn't surface a label like
  // "all running" accidentally. The hint reads "all idle" / "all finished"
  // per spec §7 sponsor-confirmed wording.
  if (isUniformPolish) {
    const hintLabel = STATUS_HINT_LABEL[groupState];
    if (hintLabel) {
      const hint = document.createElement("span");
      hint.className = "collapsed-persona-status-hint";
      hint.textContent = hintLabel;
      // aria-hidden — the aria-label on the header already conveys the state
      // ("Maya grouped — N instances, Idle, collapsed"), so the hint span is
      // visual-only sugar; avoiding double-announcement keeps the SR output
      // clean.
      hint.setAttribute("aria-hidden", "true");
      header.appendChild(hint);
    }
  }

  section.appendChild(header);

  // Instances container — populated lazily on first expand; once populated
  // it stays in the DOM (toggling `hidden`) so subsequent expand/collapse
  // cycles don't churn the per-instance tile state (e.g. tile :hover).
  //
  // Obs 10 — when the tracker reports the wrapper as previously-expanded,
  // we populate eagerly so the freshly-built DOM matches the restored
  // intent. The lazy-collapsed path remains the default (and is exercised
  // by AC3 / AC2-collapsed tests).
  const instancesDiv = document.createElement("div");
  instancesDiv.className = "collapsed-persona-instances";
  // 86c9zmqa8 §3.2 — mirror data-compact onto the instances container so CSS
  // can target compact-row layout (`.collapsed-persona-instances[data-compact="true"]`)
  // without re-reading the section's data-uniform.
  instancesDiv.dataset.compact = String(isUniformPolish);
  instancesDiv.hidden = !initiallyExpanded;
  section.appendChild(instancesDiv);

  let populated = false;

  const populateInstances = (): void => {
    if (populated) return;
    const now = nowMs ?? Date.now();
    // 86c9zmqa8 §3 — uniform clusters render instances as compact one-line
    // rows (Option B); mixed clusters fall back to the standard 4-row
    // renderAgentTile path (M3-10 baseline). The branch is captured at
    // populate-time off `isUniformPolish` — a host-side state change that
    // turns the cluster mixed between renders forces a full re-render via
    // renderFull (tracker prune walks the new tile set), so the populated
    // flag is correctly invalidated.
    for (let i = 0; i < group.instances.length; i++) {
      const tile = group.instances[i]!;
      const finishedAtMs =
        tile.state === "finished" && finishedTracker
          ? finishedTracker.observe(sessionId, tile.agentId, now)
          : undefined;
      // M4-05 §2.5 — read previous state BEFORE rendering, record AFTER.
      // First time the wrapper expands for this instance, previous is
      // undefined → renderer skips the transition flash (correct: first
      // appearance is not a transition).
      const prevState = prevStateTracker?.previous(sessionId, tile.agentId);

      if (isUniformPolish) {
        // 86c9zmqa8 §3.2 — compact row variant. Single state-dot + display
        // (with `[a]`/`[b]` disambiguator) + activity span. Drill-in click
        // continues to fire `ui:open-transcript` against the real agentId.
        // No role row, no model row — uniform clusters share both, so
        // omitting them is the win (sponsor's verbatim "why do I need to see
        // these repeated names").
        instancesDiv.appendChild(
          renderCompactInstanceRow({
            tile,
            sessionId,
            postMessage,
            disambiguator: disambiguatorFor(i),
            ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
            nowMs: now,
          }),
        );
      } else {
        instancesDiv.appendChild(
          renderAgentTile({
            tile,
            sessionId,
            postMessage,
            ...(finishedAtMs !== undefined ? { finishedAtMs } : {}),
            ...(prevState !== undefined ? { prevState } : {}),
            nowMs: now,
          }),
        );
      }
      if (prevStateTracker) {
        prevStateTracker.record(sessionId, tile.agentId, tile.state);
      }
    }
    populated = true;
  };

  const setExpanded = (expanded: boolean): void => {
    section.dataset.expanded = String(expanded);
    header.setAttribute("aria-expanded", String(expanded));
    header.setAttribute(
      "aria-label",
      `${group.personaName} grouped — ${instanceCount} instances, ${STATE_LABEL[groupState]}, ${
        expanded ? "expanded" : "collapsed"
      }`,
    );
    chevron.textContent = expanded ? "▼" : "▶";
    if (expanded) {
      populateInstances();
    }
    instancesDiv.hidden = !expanded;
    // Obs 10 — persist the user's intent so the next host poll-tick
    // re-render restores this same state. Tracker / key absent (back-compat
    // callers) → no-op, behavior matches pre-Obs-10.
    if (trackerKey !== undefined && expandedGroupsTracker !== undefined) {
      expandedGroupsTracker.setExpanded(trackerKey, expanded);
    }
  };

  // Obs 10 — when restored expanded, populate the instances eagerly so the
  // DOM matches the dataset/hidden state set above. Calling populateInstances
  // here (idempotent guarded by `populated`) parallels what setExpanded does
  // on a click toggle.
  if (initiallyExpanded) {
    populateInstances();
  }

  header.addEventListener("click", () => {
    setExpanded(section.dataset.expanded !== "true");
  });

  return section;
}

/**
 * 86c9zmqa8 §3.2 — compact instance row used inside a uniform-cluster
 * wrapper when expanded. Renders ONE row per instance:
 *
 *   <article class="agent-tile agent-tile--compact" data-agent-id data-session-id
 *            data-state role="button" tabindex="0" aria-label title>
 *     <span class="state-dot" data-state aria-label title></span>
 *     <span class="agent-display">Felix [a]</span>
 *     <span class="agent-activity agent-activity-compact">idle 14s</span>
 *   </article>
 *
 * Layout differences vs `renderAgentTile`:
 *   - single horizontal flex row (no role / model rows);
 *   - display label appended with the disambiguator (`[a]`, `[b]`, …);
 *   - activity carries an extra `agent-activity-compact` class (CSS rule in
 *     dashboard.css) so the compact row can target tighter spacing without
 *     re-styling every `.agent-activity` site.
 *
 * Drill-in contract is preserved verbatim — click + Enter/Space dispatch
 * `ui:open-transcript` with the real `tile.agentId`; the `[a]`/`[b]` label
 * is display-only sugar.
 *
 * Reduced-motion / transition: compact rows are uniform-only and never carry
 * a `data-transition` attribute — the per-poll activity wobble is the only
 * varying signal (and it's small), so flashing the row on every minor change
 * would be visual noise. The standard 4-row tile path (mixed clusters)
 * retains the existing transition behavior.
 */
interface CompactInstanceRowProps {
  tile: AgentTile;
  sessionId: string;
  postMessage: PostMessageFn;
  disambiguator: string;
  finishedAtMs?: number;
  nowMs?: number;
}

function renderCompactInstanceRow(
  props: CompactInstanceRowProps,
): HTMLElement {
  const { tile, sessionId, postMessage, disambiguator, finishedAtMs, nowMs } =
    props;

  const article = document.createElement("article");
  article.className = "agent-tile agent-tile--compact";
  article.dataset.state = tile.state;
  article.dataset.agentId = tile.agentId;
  article.dataset.sessionId = sessionId;
  article.setAttribute("role", "button");
  article.setAttribute("tabindex", "0");
  article.setAttribute(
    "aria-label",
    `${tile.display} ${disambiguator} — ${tile.role} — ${STATE_LABEL[tile.state]}`,
  );
  article.setAttribute("title", "Open agent transcript");

  // State dot (re-uses the shared `.state-dot[data-state]` CSS from agentTile).
  const dot = document.createElement("span");
  dot.className = "state-dot";
  dot.dataset.state = tile.state;
  dot.setAttribute("aria-label", STATE_LABEL[tile.state]);
  dot.setAttribute("title", STATE_LABEL[tile.state]);
  article.appendChild(dot);

  // Display + disambiguator: "Felix [a]" reads as a sibling label, not a
  // priority ordering (per spec §3.3 — "Felix 1" rejected because it reads
  // ordinal).
  const displaySpan = document.createElement("span");
  displaySpan.className = "agent-display";
  displaySpan.textContent = `${tile.display} ${disambiguator}`;
  article.appendChild(displaySpan);

  // Activity — finished-instance freshness suffix matches the standard
  // tile's behavior. `formatFreshness` is the same helper renderAgentTile
  // uses, so "idle 14s" / "finished 12m" come from the same source.
  const activityText =
    tile.state === "finished" && typeof finishedAtMs === "number"
      ? `${tile.activity} ${formatFreshness((nowMs ?? Date.now()) - finishedAtMs)}`
      : tile.activity;
  const activitySpan = document.createElement("span");
  activitySpan.className = "agent-activity agent-activity-compact";
  activitySpan.textContent = activityText;
  article.appendChild(activitySpan);

  // Drill-in handlers — identical contract to bare AgentTile.
  const fire = (): void => {
    postMessage({
      type: "ui:open-transcript",
      payload: { sessionId, agentId: tile.agentId },
    });
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

/**
 * Type-narrowing helper used by callers (teamCard) to route per-entry between
 * the collapsed-persona renderer and the bare-tile renderer. The wrapper has
 * a `kind` discriminator; an `AgentTile` does not.
 */
export function isCollapsedPersonaGroup(
  entry: AgentTile | CollapsedPersonaGroup,
): entry is CollapsedPersonaGroup {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry as { kind?: unknown }).kind === "collapsed-persona"
  );
}
