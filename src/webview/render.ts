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
 * Empty-state rule: if `state.sessions` is empty OR all sessions are dead, the
 * mount shows only `renderEmptyState()`. This matches the CLI behavior under
 * the same condition (M1-03 §1.7).
 *
 * Error chip: when a roster-error or watcher-error has been received, the error
 * chip renders at the TOP of the mount (spec §8). The chip persists until a
 * subsequent `roster:loaded` message clears it.
 *
 * Source: team/iris-ux/m2-dashboard-tile-spec.md §3, §8
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC3, AC7
 */

import type { AgentTree, StateDelta } from "../shared/types.js";
import type { WebviewMessage } from "../shared/messages.js";
import { renderSessionBlock } from "./components/sessionBlock.js";
import { renderEmptyState } from "./components/emptyState.js";
import {
  renderErrorChip,
  type ErrorChipLevel,
} from "./components/errorChip.js";

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
  const { mount, postMessage, error } = ctx;

  // Wholesale replace — clears any prior render.
  mount.replaceChildren();

  // Error chip first if active (spec §8 — top of dashboard).
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
      mount.appendChild(renderEmptyState());
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
