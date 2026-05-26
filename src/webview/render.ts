/**
 * render — top-level dashboard renderer.
 *
 * Owns the DOM mount: takes an AgentTree, builds the session blocks, replaces
 * the contents of `#root`. AC3 of M2-05.
 *
 * Re-render discipline (AC7):
 *   - `renderFull(state)`     — replace mount contents wholesale. Called on
 *                               `state:full` messages and on init.
 *   - `applyDelta(state, d)`  — at M2-05 this is a no-op fallback that triggers
 *                               a full re-render against an already-known state.
 *                               Live delta application is M4 optimization per
 *                               spec OQ §2 / backlog M2-05 AC7 footnote — the
 *                               webview doesn't invent a delta strategy ahead
 *                               of the host wiring delta emission.
 *
 * Empty-state rule (M2-05 + M3-04 AC4): if `state.sessions` is empty OR all
 * sessions are dead, the mount shows only `renderEmptyState()`. M3-04 splits
 * the empty branch by `state.filterApplied`:
 *   - filterApplied === true → the filtered-empty variant ("No Claude Code
 *     sessions for this workspace. Run `claude` in this folder, or enable
 *     `claudeteam.showAllSessionsGlobally`...").
 *   - otherwise              → the M2-05 generic variant ("No live Claude
 *     Code sessions.").
 *
 * Error chip layering (top → bottom of the mount):
 *   1. `rosterErrorChip`     — M3-04 data-driven roster errors (from
 *                              `state.rosterErrors`). Persists across ticks
 *                              until either the user dismisses (×) OR the
 *                              first error message changes.
 *   2. legacy `errorChip`    — M2-05 event-driven chip from
 *                              `roster:error` / file-watcher events.
 *                              Preserved for back-compat with M2-05's
 *                              dispatch pattern.
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §3, §8
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC3, AC7
 *         team/nora-pl/milestone-3-backlog.md §M3-04 AC1-5
 */

import type {
  AgentTree,
  StateDelta,
  WebviewAgentTree,
} from "../shared/types.js";
import type { WebviewMessage } from "../shared/messages.js";
import { renderSessionBlock } from "./components/sessionBlock.js";
import { renderEmptyState } from "./components/emptyState.js";
import {
  renderErrorChip,
  type ErrorChipLevel,
} from "./components/errorChip.js";
import { renderRosterErrorChip } from "./components/rosterErrorChip.js";
import { renderHeaderChip } from "./components/headerChip.js";
import { isCollapsedPersonaGroup } from "./components/collapsedPersonaTile.js";
import type { FinishedTracker } from "./finishedTracker.js";
import type { PrevStateTracker } from "./prevStateTracker.js";
import type {
  ExpandedGroupKey,
  ExpandedGroupsTracker,
} from "./expandedGroupsTracker.js";

/** Persistent error state stored on the dashboard. */
export interface DashboardErrorState {
  level: ErrorChipLevel;
  title: string;
  detail: string;
  showOpenRosterButton: boolean;
}

export interface RenderContext {
  /** Mount node — typically document.getElementById("root"). */
  mount: HTMLElement;
  /** Webview → host postMessage dispatcher. */
  postMessage: (msg: WebviewMessage) => void;
  /** Current error state, if any. Set externally before calling renderFull. */
  error?: DashboardErrorState | null;
  /**
   * M3-04 AC1: most-recently-dismissed roster-error first-message. When
   * non-null AND equal to `state.rosterErrors[0]`, the roster-error chip
   * is suppressed for this render. When the first error changes, the
   * cached key no longer matches and the chip re-appears.
   *
   * The caller (`main.ts`) owns this state and threads it through every
   * render; the chip's `onDismiss` callback writes back via
   * `onRosterErrorDismiss`.
   */
  rosterErrorDismissedKey?: string | null;
  /**
   * M3-04 AC1: callback invoked when the user clicks × on the roster-error
   * chip. The caller stores the passed key so the next render with the same
   * first-error short-circuits.
   */
  onRosterErrorDismiss?: (key: string) => void;
  /**
   * M3-04 NIT #3: webview-local first-seen tracker for finished-tile
   * freshness suffixes. Owned by the boot closure in `main.ts`; threaded
   * through every renderFull so it survives across re-renders. Optional —
   * when absent (e.g. component tests, fixture mode without state churn)
   * finished tiles render the bare `finished` string.
   *
   * Source: ClickUp 86c9ybtut
   */
  finishedTracker?: FinishedTracker;
  /**
   * Current wall-clock ms — defaults to `Date.now()` downstream. Test
   * injection point for deterministic freshness-suffix assertions.
   */
  nowMs?: number;
  /**
   * Webview-local last-rendered-state tracker (M4-05 §2.5). Threaded down
   * to every `renderAgentTile` so it can compare the new state against the
   * last-rendered state and apply `data-transition="to-<state>"` when they
   * differ. Owned by the boot closure in `main.ts`; survives across
   * re-renders so the transition flash only fires on actual host-side
   * state changes, not on every re-render of the same state.
   *
   * Optional — when omitted (e.g. component tests, fixture mode without
   * state churn) tiles render without transition tracking; this is the
   * back-compat path because `renderAgentTile`'s `prevState` prop is
   * optional and the renderer skips the `data-transition` attribute when
   * absent.
   *
   * Source: team/iris-ux/m4-polish-spec.md §2.5
   */
  prevStateTracker?: PrevStateTracker;
  /**
   * Webview-local expansion-state tracker (Obs 10, ClickUp 86c9zfmh1).
   * Threaded down to every `renderCollapsedPersonaTile` so user-expanded
   * persona wrappers survive the next host-driven re-render. Owned by the
   * boot closure in `main.ts`; the prune pass below evicts entries whose
   * wrappers no longer exist (e.g. a team disappears, a session goes dead).
   *
   * Optional — when omitted (component tests) wrappers always start
   * collapsed and clicks don't persist beyond the current DOM, matching
   * pre-Obs-10 behavior.
   */
  expandedGroupsTracker?: ExpandedGroupsTracker;
}

/**
 * Full-replace render. Tears down current children, rebuilds from state.
 *
 * AC7 discipline note: a `state:full` message triggers this. A `state:delta`
 * is currently routed here via `applyDelta` because the host doesn't yet emit
 * deltas (M2 only emits state:full). When the host wires deltas in M4, this
 * function can be augmented with per-tile DOM patching; for now wholesale
 * replacement keeps the render layer simple and correct.
 */
/**
 * The renderer accepts either the pre-M3-10 narrow `AgentTree` shape (bare
 * `AgentTile[]` per team — produced by the host reducer before Felix's M3-10
 * widening lands) or the post-hydration `WebviewAgentTree` shape (per-entry
 * `RosterTileEntry[]` permitting `CollapsedPersonaGroup` wrappers). The
 * narrowing helper (`isCollapsedPersonaGroup`) routes per entry; both inputs
 * are valid at the type boundary because `AgentTile[]` is assignable to
 * `RosterTileEntry[]`.
 */
export type RenderableState = AgentTree | WebviewAgentTree;

/**
 * Extract the M5 hide-finished header-chip inputs from the rendered state.
 *
 * The two fields (`hiddenFinishedCount`, `config.hideFinishedAgents`) are
 * declared by Felix's M5-EH PR on `AgentTree` / `SerializedDashboardState`
 * (spec §3.5 + §7.1 vocabulary contract). Until that PR lands on this
 * branch, the typed `AgentTree` shape does NOT include those fields and a
 * direct `state.hiddenFinishedCount` read would not typecheck. Read via a
 * cast through `Record<string, unknown>` so this code compiles in either
 * order: pre-Felix-merge (fields absent → defaults apply), post-Felix-merge
 * (fields present → consumed). Defensive `??` falls back to spec defaults
 * (off + 0) per spec §3.5 contract.
 *
 * Source: team/iris-ux/m5-hide-finished-spec.md §3.5 + §7.1
 */
function readHeaderChipState(state: RenderableState): {
  hideFinished: boolean;
  hiddenCount: number;
} {
  const bag = state as unknown as {
    hiddenFinishedCount?: unknown;
    config?: { hideFinishedAgents?: unknown };
  };
  const hideFinished =
    typeof bag.config?.hideFinishedAgents === "boolean"
      ? bag.config.hideFinishedAgents
      : false;
  const hiddenCount =
    typeof bag.hiddenFinishedCount === "number" && bag.hiddenFinishedCount > 0
      ? bag.hiddenFinishedCount
      : 0;
  return { hideFinished, hiddenCount };
}

export function renderFull(ctx: RenderContext, state: RenderableState): void {
  const {
    mount,
    postMessage,
    error,
    rosterErrorDismissedKey,
    onRosterErrorDismiss,
    finishedTracker,
    nowMs,
    prevStateTracker,
    expandedGroupsTracker,
  } = ctx;

  // Prune the finished-, prev-state-, and expanded-groups-trackers BEFORE
  // the render pass — any tile no longer present (or, for finishedTracker,
  // no longer in `finished` state) sheds its tracker entry. Without
  // pruning, a long-running dashboard slowly leaks entries for every agent
  // / group that ever existed. See finishedTracker.ts §lifecycle,
  // prevStateTracker.ts §lifecycle, expandedGroupsTracker.ts §lifecycle.
  //
  // M3-10: rosterTiles values are now `(AgentTile | CollapsedPersonaGroup)[]`.
  // We descend into CollapsedPersonaGroup.instances so tiles inside a
  // collapsed wrapper still keep their tracker entries (otherwise expanding
  // a wrapper would re-anchor every finished instance to "now", and prevState
  // would flash a spurious transition the first time the wrapper expands).
  //
  // Obs 10: the expanded-groups tracker is keyed at the WRAPPER level
  // (sessionId:teamId:personaName), so we register a key for each wrapper
  // we see — bare-tile entries do not contribute. The teamId is the
  // rosterTiles Map key.
  //
  // Single pass — all three trackers prune off the same walk to keep the
  // per-tick cost down.
  if (finishedTracker || prevStateTracker || expandedGroupsTracker) {
    const currentFinishedKeys = new Set<`${string}:${string}`>();
    const currentAllKeys = new Set<`${string}:${string}`>();
    const currentGroupKeys = new Set<ExpandedGroupKey>();
    for (const session of state.sessions) {
      if (!session.isAlive) continue;
      for (const [teamId, entries] of session.rosterTiles.entries()) {
        for (const entry of entries) {
          // Wrapper case — walk instances so tiles inside a collapsed
          // wrapper still keep their tracker entries, AND register the
          // wrapper's own key for the expansion tracker.
          if (isCollapsedPersonaGroup(entry)) {
            if (expandedGroupsTracker) {
              currentGroupKeys.add(
                expandedGroupsTracker.makeKey(
                  session.sessionId,
                  teamId,
                  entry.personaName,
                ),
              );
            }
            for (const inst of entry.instances) {
              const key: `${string}:${string}` = `${session.sessionId}:${inst.agentId}`;
              currentAllKeys.add(key);
              if (inst.state === "finished") {
                currentFinishedKeys.add(key);
              }
            }
            continue;
          }
          // Bare AgentTile case — unchanged from pre-M3-10.
          const key: `${string}:${string}` = `${session.sessionId}:${entry.agentId}`;
          currentAllKeys.add(key);
          if (entry.state === "finished") {
            currentFinishedKeys.add(key);
          }
        }
      }
    }
    if (finishedTracker) {
      finishedTracker.prune(currentFinishedKeys);
    }
    if (prevStateTracker) {
      prevStateTracker.prune(currentAllKeys);
    }
    if (expandedGroupsTracker) {
      expandedGroupsTracker.prune(currentGroupKeys);
    }
  }

  // Wholesale replace — clears any prior render.
  mount.replaceChildren();

  // M3-04 AC1 — roster-error chip from state.rosterErrors. Rendered FIRST
  // (above any other chips) because a roster failure dominates everything
  // else the user is looking at. `renderRosterErrorChip` returns null when
  // there are no errors OR when the user has dismissed the current first-
  // error key — both paths leave the chip absent from the mount.
  const rosterErrors = state.rosterErrors ?? [];
  if (rosterErrors.length > 0) {
    const chip = renderRosterErrorChip({
      errors: rosterErrors,
      dismissedKey: rosterErrorDismissedKey ?? null,
      postMessage,
      ...(onRosterErrorDismiss ? { onDismiss: onRosterErrorDismiss } : {}),
    });
    if (chip) {
      mount.appendChild(chip);
    }
  }

  // Legacy event-driven error chip (M2-05). Kept for back-compat with the
  // `roster:error` / file-watcher event dispatch pattern. The two chips
  // can co-exist for one render cycle (file-watcher chip + roster-YAML
  // chip) — the user sees both surfaces stacked, which is correct.
  if (error) {
    mount.appendChild(
      renderErrorChip({
        level: error.level,
        title: error.title,
        detail: error.detail,
        ...(error.showOpenRosterButton ? { showOpenRosterButton: true } : {}),
        postMessage,
      }),
    );
  }

  // M5 hide-finished header chip — position 3 (spec §4.1). ALWAYS rendered
  // (with-sessions branch AND empty-state branch per spec §4.6) so the
  // toggle is discoverable even when the dashboard is empty.
  const { hideFinished, hiddenCount } = readHeaderChipState(state);
  mount.appendChild(
    renderHeaderChip({
      hideFinished,
      hiddenCount,
      postMessage,
    }),
  );

  const hasLiveSession = state.sessions.some((s) => s.isAlive);
  if (state.sessions.length === 0 || !hasLiveSession) {
    // Empty state — but still render dead-session headers if any exist so the
    // sponsor can see them. Spec §3.2 + §4 dead-session treatment.
    if (state.sessions.length === 0) {
      // M3-04 AC4: filter-aware empty variant. Only the truly-empty branch
      // gets the variant flag — if dead sessions are present the user has
      // enough signal already; we don't double up.
      mount.appendChild(
        renderEmptyState({ filtered: state.filterApplied === true }),
      );
      return;
    }
    // All-dead case — still render the dead session blocks (header only).
    // Dead sessions render no tiles per sessionBlock.ts §dead treatment, so
    // the tracker is not threaded into this branch — there are no tiles to
    // observe.
    for (const session of state.sessions) {
      mount.appendChild(renderSessionBlock({ session, postMessage }));
    }
    // Also show the empty-state line so the user understands "nothing live."
    mount.appendChild(renderEmptyState());
    return;
  }

  for (const session of state.sessions) {
    mount.appendChild(
      renderSessionBlock({
        session,
        postMessage,
        ...(finishedTracker ? { finishedTracker } : {}),
        ...(prevStateTracker ? { prevStateTracker } : {}),
        ...(expandedGroupsTracker ? { expandedGroupsTracker } : {}),
        ...(nowMs !== undefined ? { nowMs } : {}),
      }),
    );
  }
}

/**
 * Apply a state delta to the current render.
 *
 * M2-05 scope (per spec OQ §2): the host does NOT emit deltas yet, so this
 * function exists for type-completeness and to log incoming deltas without
 * mis-applying them. When the host wires delta emission in M4, this function
 * will be replaced with per-tile DOM patching; until then, callers should
 * follow a delta with the next `state:full` to refresh.
 */
export function applyDelta(_state: AgentTree, _delta: StateDelta): void {
  // Intentional no-op. M4 work — see render.ts module docstring.
}
