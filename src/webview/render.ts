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

import type { AgentTree, StateDelta } from "../shared/types.js";
import type { WebviewMessage } from "../shared/messages.js";
import { renderSessionBlock } from "./components/sessionBlock.js";
import { renderEmptyState } from "./components/emptyState.js";
import {
  renderErrorChip,
  type ErrorChipLevel,
} from "./components/errorChip.js";
import { renderRosterErrorChip } from "./components/rosterErrorChip.js";

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
export function renderFull(ctx: RenderContext, state: AgentTree): void {
  const {
    mount,
    postMessage,
    error,
    rosterErrorDismissedKey,
    onRosterErrorDismiss,
  } = ctx;

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
    for (const session of state.sessions) {
      mount.appendChild(renderSessionBlock({ session, postMessage }));
    }
    // Also show the empty-state line so the user understands "nothing live."
    mount.appendChild(renderEmptyState());
    return;
  }

  for (const session of state.sessions) {
    mount.appendChild(renderSessionBlock({ session, postMessage }));
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
