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
    nowMs,
  } = props;

  // Obs 10 (86c9zfmh1) — read initial expansion intent from the persistent
  // tracker. Composed key includes sessionId + teamId + personaName so two
  // different teams can host a same-named persona wrapper without sharing
  // expansion state. When the tracker / teamId is absent (back-compat
  // callers), default to collapsed exactly as pre-Obs-10.
  const trackerKey =
    expandedGroupsTracker && teamId !== undefined
      ? expandedGroupsTracker.makeKey(sessionId, teamId, group.personaName)
      : undefined;
  const initiallyExpanded =
    trackerKey !== undefined && expandedGroupsTracker !== undefined
      ? expandedGroupsTracker.isExpanded(trackerKey)
      : false;

  const section = document.createElement("section");
  section.className = "collapsed-persona";
  section.dataset.personaName = group.personaName;
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
  instancesDiv.hidden = !initiallyExpanded;
  section.appendChild(instancesDiv);

  let populated = false;

  const populateInstances = (): void => {
    if (populated) return;
    const now = nowMs ?? Date.now();
    for (const tile of group.instances) {
      const finishedAtMs =
        tile.state === "finished" && finishedTracker
          ? finishedTracker.observe(sessionId, tile.agentId, now)
          : undefined;
      // M4-05 §2.5 — read previous state BEFORE rendering, record AFTER.
      // First time the wrapper expands for this instance, previous is
      // undefined → renderer skips the transition flash (correct: first
      // appearance is not a transition).
      const prevState = prevStateTracker?.previous(sessionId, tile.agentId);
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
