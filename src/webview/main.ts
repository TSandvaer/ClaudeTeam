/**
 * Webview entry point — M2-05 dashboard renderer + message receiver.
 *
 * Boot sequence:
 *   1. Locate the #root mount node.
 *   2. Acquire the VS Code webview API (`acquireVsCodeApi`). If it's
 *      undefined we're running in a plain browser (dev mode) and fall back
 *      to a console-log mock so click handlers + fixture rendering still
 *      work — spec §9 + AC8 "static-fixture mode."
 *   3. Initial render — `FIXTURE_STATE` in browser dev mode (so Maya can
 *      iterate on tile layout without a host); `FIXTURE_EMPTY_STATE` in
 *      VS Code mode so the dashboard shows no tiles until the first host
 *      `state:full` lands. Shipping `FIXTURE_STATE` as the placeholder in
 *      VS Code mode caused the M3-03/86c9ybrk0 "DEAD-session bleed" — the
 *      fixture's hardcoded cross-workspace DEAD session was visible for
 *      hundreds of ms before the first host tick replaced it.
 *   4. Wire `initMessageReceiver` to handle host → webview messages. New
 *      states fully replace the current DOM (AC7 discipline note).
 *
 * CSP rationale (load-bearing): provider.ts injects this file via
 *   <script src="..."></script>
 * with no inline scripts and no `eval`. The bundle is IIFE per esbuild config
 * to satisfy the `script-src 'self'`-equivalent CSP — no ES module imports at
 * runtime, no dynamic import().
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Webview rules"
 *         team/iris-ux/m2-dashboard-tile-spec.md §9
 *         team/nora-pl/milestone-2-backlog.md §M2-05 AC1, AC2, AC8
 */

import { FIXTURE_EMPTY_STATE, FIXTURE_STATE } from "../shared/fixtures.js";
import type {
  RosterTileEntry,
  WebviewAgentTree,
  WebviewSessionTree,
} from "../shared/types.js";
import type {
  SerializedDashboardState,
  SerializedSessionTree,
  WebviewMessage,
} from "../shared/messages.js";
import { initMessageReceiver } from "./messageReceiver.js";
import {
  renderFull,
  type DashboardErrorState,
  type RenderContext,
} from "./render.js";
import { createFinishedTracker } from "./finishedTracker.js";
import { createPrevStateTracker } from "./prevStateTracker.js";

// =============================================================================
// VS Code API shim
// =============================================================================

/**
 * Webview-global function injected by VS Code when running inside the
 * extension host. Returns an object with `postMessage` / `setState` /
 * `getState`. Calling it twice throws — guarded by the single-call pattern in
 * `acquireApi()`.
 *
 * In browser dev mode the symbol is undefined; we substitute a console-logging
 * mock so click handlers and renderer flows still execute.
 */
declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState(): unknown;
};

interface WebviewApi {
  postMessage(msg: WebviewMessage): void;
}

function acquireApi(): WebviewApi {
  if (typeof acquireVsCodeApi === "function") {
    const api = acquireVsCodeApi();
    return {
      postMessage: (msg: WebviewMessage) => api.postMessage(msg),
    };
  }
  // Browser dev fallback — log clicks so Maya can verify shape without VS Code.
  return {
    postMessage: (msg: WebviewMessage) => {
      console.log("[claudeteam:dev] postMessage:", msg);
    },
  };
}

// =============================================================================
// Wire-shape rehydration
// =============================================================================

/**
 * Rehydrate a `SerializedDashboardState` (the JSON-safe wire shape) into the
 * in-memory `WebviewAgentTree` shape the renderer expects.
 *
 * The only field that differs is `sessions[].rosterTiles`:
 *   - on the wire: `Record<string, RosterTileEntry[]>` (plain object; entries
 *     are either bare `AgentTile`s or `CollapsedPersonaGroup` wrappers).
 *   - in memory:   `Map<string, RosterTileEntry[]>` (renderer uses `.get`).
 *
 * All other fields pass through verbatim. Pure function — exported for unit
 * test coverage.
 *
 * Note (M3-10): the host-side `SessionTree.rosterTiles` is still typed as
 * `Map<string, AgentTile[]>` (bare tiles only) — Felix's parallel M3-10 PR
 * widens the host side. Until that lands, the wrapper objects originate only
 * in Felix's reducer output and arrive verbatim through the wire.
 */
export function hydrateState(wire: SerializedDashboardState): WebviewAgentTree {
  return {
    sessions: wire.sessions.map(
      (s: SerializedSessionTree): WebviewSessionTree => ({
        shortId: s.shortId,
        sessionId: s.sessionId,
        pid: s.pid,
        entrypoint: s.entrypoint,
        version: s.version,
        isAlive: s.isAlive,
        cwd: s.cwd,
        title: s.title,
        rosterTiles: new Map<string, RosterTileEntry[]>(
          Object.entries(s.rosterTiles),
        ),
        teamOrder: s.teamOrder,
        background: s.background,
      }),
    ),
    // M3-03 / M3-04 / M5: top-level scalar / string-array / config-mirror
    // fields pass through verbatim. The renderer treats `undefined` as
    // default per the type's contract (false / empty array / 0).
    // Preserving `undefined` rather than coercing keeps the in-memory
    // shape distinguishable from a host that explicitly sent the field.
    ...(wire.filterApplied !== undefined
      ? { filterApplied: wire.filterApplied }
      : {}),
    ...(wire.rosterErrors !== undefined
      ? { rosterErrors: wire.rosterErrors }
      : {}),
    ...(wire.rosterWarnings !== undefined
      ? { rosterWarnings: wire.rosterWarnings }
      : {}),
    // M5 (86c9z5j3r): both fields originate in `applyHideFinishedFilter`
    // and are stamped by the watcher tick onto every serialized state. The
    // renderer's header chip reads them via `readHeaderChipState` in
    // `src/webview/render.ts` — until this hydrator passes them through,
    // the chip falls back to its defaults (off + 0) even when the host
    // sent real values. Wire-shape source of truth: `SerializedDashboardState`
    // fields `hiddenFinishedCount?: number` + `config?: { hideFinishedAgents?: boolean }`
    // in `src/shared/messages.ts`.
    ...(wire.hiddenFinishedCount !== undefined
      ? { hiddenFinishedCount: wire.hiddenFinishedCount }
      : {}),
    ...(wire.config !== undefined ? { config: wire.config } : {}),
  };
}

// =============================================================================
// Boot
// =============================================================================

function boot(): void {
  const mount = document.getElementById("root");
  if (!mount) {
    console.error("[claudeteam] #root element not found");
    return;
  }
  // Clear the static "ClaudeTeam loading…" placeholder from provider.ts.
  mount.replaceChildren();

  const api = acquireApi();
  let currentError: DashboardErrorState | null = null;
  // VS Code mode → start with an empty state so the dashboard renders no
  // tiles until the first host `state:full` arrives. Browser dev mode →
  // start with FIXTURE_STATE so Maya can iterate on layout. See file
  // header for the M3-03/86c9ybrk0 bleed regression this prevents.
  const isVsCodeMode = typeof acquireVsCodeApi === "function";
  // `AgentTree` is structurally assignable to `WebviewAgentTree` because
  // `AgentTile[]` widens to `RosterTileEntry[]` (RosterTileEntry =
  // AgentTile | CollapsedPersonaGroup). The fixtures own pre-M3-10 bare-tile
  // shapes; the post-M3-10 wrappers only arrive from the host wire.
  let currentState: WebviewAgentTree = isVsCodeMode
    ? FIXTURE_EMPTY_STATE
    : FIXTURE_STATE;
  /**
   * M3-04 AC1: most-recently-dismissed roster-error first-message. Tracked
   * here (boot-level closure) so it persists across re-renders WITHOUT
   * leaking into host state. When the FIRST error message changes between
   * ticks, the cached key no longer matches `state.rosterErrors[0]` →
   * chip re-appears next render. Reset to null on any successful
   * `roster:loaded` (the user explicitly recovered).
   */
  let rosterErrorDismissedKey: string | null = null;
  /**
   * M3-04 NIT #3: webview-local first-seen tracker for finished-tile
   * freshness suffixes. Single instance per webview boot — persists across
   * re-renders so the displayed "finished Xs" anchors to the first tick we
   * observed the completion, not to the current render. See
   * `src/webview/finishedTracker.ts` for the lifecycle + accuracy notes.
   */
  const finishedTracker = createFinishedTracker();
  /**
   * M4-05 §2.5: webview-local last-rendered-state tracker for status-state
   * transition detection. Single instance per webview boot — survives
   * across re-renders so the transition flash fires only when the host
   * actually changes a tile's state, not on every re-render. Mirrors
   * finishedTracker's lifecycle.
   */
  const prevStateTracker = createPrevStateTracker();

  // Browser dev mode → render FIXTURE_STATE immediately. VS Code mode →
  // render the empty state until the first `state:full` arrives from the
  // host. Either way the first state:full fully replaces the DOM.
  const buildCtx = (): RenderContext => ({
    mount,
    postMessage: api.postMessage,
    error: currentError,
    rosterErrorDismissedKey,
    onRosterErrorDismiss: (key) => {
      // Persist the dismissal until the first error string changes. The
      // chip removed itself from the DOM already; this stores the key so
      // the NEXT render with the same first-error stays empty.
      rosterErrorDismissedKey = key;
    },
    finishedTracker,
    prevStateTracker,
  });

  renderFull(buildCtx(), currentState);

  initMessageReceiver({
    onStateFull: (msg) => {
      // Rehydrate the wire-shape (rosterTiles: Record<string, AgentTile[]>)
      // back into the in-memory shape the renderer expects
      // (rosterTiles: Map<string, AgentTile[]>). The host flattens Maps to
      // plain objects in `serializeState` because JSON.stringify drops Map
      // contents to `{}` — see `src/shared/messages.ts` SerializedDashboardState.
      currentState = hydrateState(msg.payload);
      // A successful state:full clears any prior watcher-error chip because
      // we just received fresh data — but it does NOT clear a roster YAML
      // error (that requires a roster:loaded). Track which subtype is active.
      if (currentError && currentError.title === "File-watcher error") {
        currentError = null;
      }
      renderFull(buildCtx(), currentState);
    },
    onStateDelta: () => {
      // M2-05 scope (per backlog AC7 footnote): host only emits state:full.
      // If a delta arrives, we conservatively re-render against the last known
      // state so the UI doesn't drift. Real delta-application is M4 work.
      renderFull(buildCtx(), currentState);
    },
    onRosterLoaded: () => {
      // Roster reloaded successfully → clear any roster-error chip.
      currentError = null;
      // M3-04: also clear the dismiss-key so a future error (different
      // first-message OR identical-but-after-recovery) re-appears on its
      // own merit — the user's prior dismissal applied to the prior
      // failure context, not this new run.
      rosterErrorDismissedKey = null;
      renderFull(buildCtx(), currentState);
    },
    onRosterError: (msg) => {
      currentError = {
        level: "error",
        title: "Roster error",
        detail: msg.payload.error,
        showOpenRosterButton: true,
      };
      renderFull(buildCtx(), currentState);
    },
  });

  // 86c9z171k Obs 3 follow-up: pull host state once the message receiver is
  // wired. PR #66's host-side push-based replay fires synchronously inside
  // `_onResolved` BEFORE the webview's `window.addEventListener("message", ...)`
  // is registered (the IIFE has not yet executed in the renderer process). VS
  // Code does NOT buffer postMessage calls — the replayed `state:full` is
  // silently dropped. By sending `ui:refresh` AFTER `initMessageReceiver`
  // returns (listener now wired), the host's `onRefresh` handler calls
  // `watcherHandle?.triggerTick()` which immediately re-emits `state:full` —
  // and that one lands. Idempotent on first-open: `triggerTick` is a hash-
  // skip-aware tick, no-ops if the state hash matches what was just emitted.
  // Source: team/bram-research/86c9yteju-triage-2026-05-26.md § Observation 3
  //         (Pattern A — pull-based: webview sends ui:refresh on boot).
  api.postMessage({ type: "ui:refresh" });
}

// DOM is available immediately because <script> is at end of body. No need
// for DOMContentLoaded — but be defensive in case the script ever moves.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
