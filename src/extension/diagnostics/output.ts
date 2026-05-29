/**
 * Diagnostic Output channel — verbose per-tick state-delta logging (86c9zn7vw)
 * + tick history surface consumed by the diagnostic panel (86c9zn7tm).
 *
 * When the `claudeteam.diagnostic.verbose` setting is true, this module
 * emits one log line per watcher tick (timestamp + duration + state-change
 * flag) plus per-agent state-transition lines when the reducer's `inferState`
 * returns a different state than the prior tick, plus roster reload events
 * and error events. When the setting is false, every emit call is a no-op
 * fast-path for the Output channel (so production overhead is ~zero).
 *
 * **Tick history (86c9zn7tm).** Independent of the verbose gate, the
 * dispatcher maintains a small ring buffer of the most recent ticks (default
 * 50) for the live diagnostic panel. Buffer entries are cheap structs (no
 * I/O, no string formatting) so capturing them is safe in all sessions —
 * opening the panel mid-session shows recent history immediately. The
 * verbose gate ONLY governs Output-channel writes; the ring buffer and
 * subscriber notifications fire regardless.
 *
 * Lifecycle:
 *   - `createDiagnosticChannel(opts)` constructs the dispatcher. The
 *     underlying `vscode.window.createOutputChannel` is allocated LAZILY on
 *     the first verbose emit — when the setting is false from boot to
 *     deactivate, no channel is allocated. Once allocated, the channel
 *     persists for the extension's lifetime (channels are not disposable
 *     mid-session without losing the user's scrollback).
 *   - The setting is read fresh per emit via the `isVerbose` callback —
 *     toggling `claudeteam.diagnostic.verbose` at runtime takes effect on
 *     the next watcher tick without a Reload Window.
 *
 * Output channel name: "Claude Team — Diagnostics" (visible verbatim in the
 * Output dropdown under Settings > Output Channel).
 *
 * Format conventions (all lines prefixed with an ISO-8601 timestamp):
 *   - tick:        `[<ISO>] tick #<N> took <ms>ms — emitted=<bool>`
 *   - transition:  `[<ISO>] transition session=<sid8> agent=<aid8> <prev> → <next>`
 *   - roster:      `[<ISO>] roster reloaded — teams=<N> errors=<N> warnings=<N>`
 *   - error:       `[<ISO>] error: <message>`
 *
 * The `sid8` / `aid8` short-id format matches the existing CLI/dashboard
 * shortId convention (first 8 chars). The transition arrow uses `→` for
 * scannability — the Output channel is monospace and renders it cleanly.
 *
 * Source: ClickUp 86c9zn7vw + 86c9zn7tm + project doc §
 *         `.claude/docs/vscode-extension-conventions.md` (Output channel
 *         conventions are extension-host concerns — webview owns no part).
 */

import type * as vscode from "vscode";

import type { AgentState, DashboardState } from "../../shared/types.js";
import {
  isCollapsedPersonaGroup,
  isMultiAgentPersonaTile,
} from "../../shared/types.js";

/** Constant channel name — also referenced in the package.json description. */
export const DIAGNOSTIC_CHANNEL_NAME = "Claude Team — Diagnostics";

/**
 * Inputs supplied per tick. The watcher computes these and hands them to
 * `recordTick` regardless of whether verbose mode is on — the gate is
 * inside `emit*` calls, not at the watcher boundary. This keeps the
 * watcher's hot path simple and lets us add more diagnostic surfaces
 * without re-plumbing the watcher.
 */
export interface TickDiagnostics {
  /** Sequential tick counter (starts at 1 on watcher start). */
  tickNumber: number;
  /** Wall-clock ms the tick took, end-to-end. */
  durationMs: number;
  /** Whether the tick emitted to the webview (false on hash-skip). */
  emitted: boolean;
  /** State emitted (or kept) this tick — used for per-agent transition diff. */
  state: DashboardState;
}

/**
 * Result of a roster reload event. The watcher loop already logs these via
 * its `logger.warn`; the diagnostic channel surfaces them in a uniform
 * timeline so a user can correlate roster changes with tick behavior.
 */
export interface RosterReloadDiagnostics {
  teamsCount: number;
  errorsCount: number;
  warningsCount: number;
}

/**
 * One transition observed during a tick. Used by `TickHistoryEntry.transitions`
 * to give the diagnostic panel structured per-tick deltas without re-deriving
 * them webview-side. JSON-safe — survives the host↔webview wire.
 *
 * Source: 86c9zn7tm.
 */
export interface TickTransition {
  /** First 8 chars of sessionId — matches the Output-channel format. */
  sessionShortId: string;
  /** First 8 chars of agentId — matches the Output-channel format. */
  agentShortId: string;
  /** Full sessionId for drill-in lookups (not rendered in compact view). */
  sessionId: string;
  /** Full agentId for drill-in lookups. */
  agentId: string;
  prev: AgentState;
  next: AgentState;
}

/**
 * One ring-buffer entry per tick. The panel renders these as a tick-history
 * table; the buffer is capped at `TICK_HISTORY_LIMIT` (default 50) so memory
 * stays bounded for long-running sessions. Older entries fall off the front.
 *
 * Captured for EVERY tick regardless of the verbose Output-channel gate —
 * the cost is a small object + an array of transition records, far below the
 * existing per-tick work (roster reload, JSONL parse, etc.). When the panel
 * is not open, nothing reads the buffer; opening the panel mid-session
 * surfaces recent history immediately.
 *
 * Source: 86c9zn7tm.
 */
export interface TickHistoryEntry {
  tickNumber: number;
  /** Wall-clock epoch ms when the tick was recorded. */
  timestampMs: number;
  /** End-to-end wall-clock duration of the tick in ms. */
  durationMs: number;
  /** Whether the tick emitted state to the webview (false = hash-skip). */
  emitted: boolean;
  /**
   * State transitions observed this tick (prev → next). Empty array when no
   * tile's state changed. Recording all transitions lets the panel filter /
   * highlight them without a second pass over DashboardState diffs.
   */
  transitions: TickTransition[];
}

/**
 * Default cap on the tick ring buffer. ~50 entries covers ~100s at the
 * 2000ms default poll cadence — enough to spot a pattern, small enough that
 * memory pressure is negligible. The panel's "Clear history" button resets
 * the buffer to empty; opening the panel does NOT reset.
 */
export const TICK_HISTORY_LIMIT = 50;

/**
 * Snapshot of recent diagnostic state — used by the panel to render the
 * tick-history table and the current state breakdown together.
 *
 * `state` is the most recently observed DashboardState; null only before
 * the first tick has been recorded. Producers should pass the same
 * `DashboardState` ref the watcher already produced — no copy needed.
 */
export interface DiagnosticSnapshot {
  ticks: TickHistoryEntry[];
  state: DashboardState | null;
}

/**
 * Listener invoked after every tick is recorded — gives the panel a push
 * channel so it doesn't have to poll `getSnapshot()`. Errors thrown from
 * the listener are caught by the dispatcher's outer guard.
 *
 * Listeners fire AFTER the ring buffer is updated, so `getSnapshot()`
 * called from inside the listener returns the just-recorded entry as the
 * last element of `ticks`.
 */
export type DiagnosticTickListener = (entry: TickHistoryEntry) => void;

/**
 * Diagnostic dispatcher returned from `createDiagnosticChannel`.
 *
 * The `recordRosterReload` / `recordError` methods are no-ops when verbose
 * mode is off — the fast path is `isVerbose() === false → return
 * immediately`, no channel allocated, no string formatting performed.
 *
 * `recordTick` ALWAYS updates the ring buffer + fires subscribers
 * (regardless of verbose), but only writes to the Output channel when
 * verbose is on. The buffer is the panel's data source; verbose is the
 * Output-channel-only gate.
 */
export interface DiagnosticChannel extends vscode.Disposable {
  /**
   * Called by the watcher at the end of every tick. Updates the ring
   * buffer + fires subscribers unconditionally. When verbose is on, also
   * emits the tick line and any per-agent state transitions vs the
   * previously-recorded state to the Output channel.
   *
   * Per-agent prev-state tracking persists across verbose toggles so the
   * panel sees real transitions even when verbose is off — the Output-
   * channel "first verbose tick is a clean slate" behavior is preserved
   * for log-readability via a separate verbose-only emit guard.
   */
  recordTick(diag: TickDiagnostics): void;

  /**
   * Called by the watcher when the roster YAML hot-reloads (M3-01
   * rosterWatcher's `onRosterChange`). Output channel line emitted only
   * when verbose. Panel listeners (if attached) are notified separately
   * via the next tick's ring-buffer entry — roster reloads do not produce
   * a standalone history entry in V1 (they appear implicitly via the
   * roster-state diff in the next state snapshot).
   */
  recordRosterReload(diag: RosterReloadDiagnostics): void;

  /**
   * Called by the watcher's catch-all error path. Output channel line
   * emitted only when verbose. Errors also surface in the watcher's own
   * `logger.warn` chain — the diagnostic channel is a secondary surface
   * for verbose-mode timeline correlation.
   */
  recordError(message: string): void;

  /**
   * Return a snapshot of the most recent N ticks plus the most-recently
   * recorded DashboardState. Used by the diagnostic panel on open (to
   * populate immediately) and on explicit "Refresh" clicks. Pure — does
   * not mutate dispatcher state.
   *
   * The returned `ticks` array is a fresh slice — callers may mutate it
   * without affecting future calls.
   *
   * Source: 86c9zn7tm.
   */
  getSnapshot(): DiagnosticSnapshot;

  /**
   * Subscribe to per-tick notifications. The listener fires after the
   * ring buffer is updated. Returns a disposable that removes the
   * subscription; multi-subscribe is supported (no de-dup, listeners
   * fire in registration order).
   *
   * Source: 86c9zn7tm.
   */
  subscribe(listener: DiagnosticTickListener): vscode.Disposable;

  /**
   * Clear the ring buffer — used by the panel's "Clear history" button.
   * Does NOT clear the Output channel scrollback (that's a VS Code-side
   * action on the channel itself). Subscribers are NOT notified of the
   * clear; the next `recordTick` will fire as normal against the empty
   * buffer.
   *
   * Source: 86c9zn7tm.
   */
  clearHistory(): void;
}

/**
 * Construction options. Both fields are read every emit — the channel is
 * a thin presentational layer over the watcher's existing event stream.
 */
export interface CreateDiagnosticChannelOptions {
  /**
   * Resolver for `claudeteam.diagnostic.verbose`. Read fresh per emit so
   * toggling the setting at runtime takes effect on the next watcher tick.
   * When omitted, defaults to `false` (verbose off — tests that don't
   * supply a value want the no-op path).
   */
  isVerbose: () => boolean;
  /**
   * Factory for the underlying VS Code Output channel. Injection point
   * lets tests substitute a fake that captures lines for assertion. In
   * production this is `vscode.window.createOutputChannel`.
   */
  createOutputChannel: (name: string) => vscode.OutputChannel;
}

/**
 * Construct a diagnostic dispatcher. The Output channel is NOT created
 * eagerly — it is allocated on the first `record*` call that observes
 * `isVerbose() === true`. When verbose stays false for the entire session,
 * no channel ever appears in the user's Output dropdown.
 *
 * Idempotent disposal — calling `dispose()` twice is safe (the second
 * call is a no-op).
 */
export function createDiagnosticChannel(
  opts: CreateDiagnosticChannelOptions,
): DiagnosticChannel {
  let channel: vscode.OutputChannel | null = null;
  // Tracks the LAST-RECORDED state per (sessionId, agentId). Mirrors the
  // webview's prevStateTracker pattern but lives in the extension host,
  // bound to the diagnostic channel lifecycle. Pruned per tick: any key
  // not present in the current state is dropped so the map doesn't grow
  // unboundedly across long sessions as agents come and go.
  //
  // 86c9zn7tm: prevState is now updated EVERY tick (regardless of verbose)
  // because the diagnostic panel consumes transitions from the ring buffer.
  // Verbose-mode Output-channel cleanliness is preserved via a separate
  // `verbosePrimed` flag — the FIRST verbose-on tick after a verbose-off
  // period skips Output-channel transition emission so the user doesn't
  // see a confusing cascade of `undefined → running` lines.
  const prevState = new Map<string, AgentState>();
  // Ring buffer of the most recent ticks (capped at TICK_HISTORY_LIMIT). Old
  // entries fall off the front via `shift()`. Capturing every tick is cheap
  // — see `TickHistoryEntry` doc comment.
  const ticks: TickHistoryEntry[] = [];
  // Most-recently-recorded DashboardState. Held by reference (no copy) —
  // the watcher's runTick already produces a fresh tree each tick, so
  // referencing it here cannot leak stale data across ticks.
  let lastState: DashboardState | null = null;
  // Per-tick subscribers (panel manager). Errors caught at notify time.
  const listeners = new Set<DiagnosticTickListener>();
  // 86c9zn7tm: true once the verbose Output channel has emitted at least
  // one tick. The FIRST verbose-on tick (after a verbose-off period) sets
  // this true but does NOT emit transitions — they would all be
  // `prev !== undefined` (because prevState is now always populated) and
  // produce a confusing cascade against the prior session's frame of
  // reference. Toggling verbose OFF flips this back to false.
  let verbosePrimed = false;
  let disposed = false;

  const ensureChannel = (): vscode.OutputChannel => {
    if (channel === null) {
      channel = opts.createOutputChannel(DIAGNOSTIC_CHANNEL_NAME);
    }
    return channel;
  };

  /**
   * Collect this tick's transitions and update prevState. Always runs (the
   * panel needs structured transitions in the ring buffer regardless of
   * verbose). Returns the transitions in their observed (walk) order.
   */
  const collectTransitions = (state: DashboardState): TickTransition[] => {
    const collected: TickTransition[] = [];
    const seenKeys = new Set<string>();

    const visit = (sessionId: string, agentId: string, newState: AgentState): void => {
      const key = `${sessionId}:${agentId}`;
      seenKeys.add(key);
      const prev = prevState.get(key);
      if (prev !== undefined && prev !== newState) {
        collected.push({
          sessionShortId: sessionId.slice(0, 8),
          agentShortId: agentId.slice(0, 8),
          sessionId,
          agentId,
          prev,
          next: newState,
        });
      }
      prevState.set(key, newState);
    };

    for (const session of state.sessions) {
      for (const [, entries] of session.rosterTiles) {
        for (const entry of entries) {
          if (
            isCollapsedPersonaGroup(entry) ||
            isMultiAgentPersonaTile(entry)
          ) {
            for (const tile of entry.instances) {
              visit(session.sessionId, tile.agentId, tile.state);
            }
          } else {
            visit(session.sessionId, entry.agentId, entry.state);
          }
        }
      }
    }
    // Prune: any key not observed in this tick is gone (agent finished
    // and was filtered, session ended, etc.). Drop so prevState doesn't
    // accumulate over long sessions.
    for (const key of prevState.keys()) {
      if (!seenKeys.has(key)) {
        prevState.delete(key);
      }
    }
    return collected;
  };

  return {
    recordTick(diag: TickDiagnostics): void {
      if (disposed) return;
      const verbose = opts.isVerbose();

      // 86c9zn7tm: ALWAYS collect transitions + update ring buffer + notify
      // subscribers (the panel is independent of the verbose gate). The
      // verbose gate only controls Output-channel writes below.
      const transitions = collectTransitions(diag.state);
      lastState = diag.state;
      const entry: TickHistoryEntry = {
        tickNumber: diag.tickNumber,
        timestampMs: Date.now(),
        durationMs: diag.durationMs,
        emitted: diag.emitted,
        transitions,
      };
      ticks.push(entry);
      while (ticks.length > TICK_HISTORY_LIMIT) {
        ticks.shift();
      }
      // Notify subscribers. A throwing listener must NOT take down the
      // dispatcher (same defense-in-depth as the watcher's onTickComplete
      // catch). The dispatcher logs nothing here — listeners are panel-
      // owned; the panel's own logger handles surfacing.
      for (const listener of listeners) {
        try {
          listener(entry);
        } catch {
          /* swallow — listener errors are isolated per-listener */
        }
      }

      if (!verbose) {
        // Verbose just flipped off (or has been off): mark unprimed so the
        // next verbose-on tick can apply the "clean slate" suppression.
        verbosePrimed = false;
        return;
      }

      const ch = ensureChannel();
      ch.appendLine(formatTickLine(diag));

      if (!verbosePrimed) {
        // FIRST verbose tick after a verbose-off period — emit the tick
        // line but suppress transitions. The panel still has them in the
        // ring buffer; the Output channel intentionally elides them so
        // the user's log doesn't show a confusing cascade.
        verbosePrimed = true;
        return;
      }

      for (const t of transitions) {
        // The Output channel uses the same `→` arrow formatting that
        // `formatTransitionLine` produces — we go through the helper so the
        // format stays unified with the unit-test contract.
        ch.appendLine(
          formatTransitionLine(t.sessionId, t.agentId, t.prev, t.next),
        );
      }
    },

    recordRosterReload(diag: RosterReloadDiagnostics): void {
      if (disposed) return;
      if (!opts.isVerbose()) return;
      const ch = ensureChannel();
      ch.appendLine(formatRosterReloadLine(diag));
    },

    recordError(message: string): void {
      if (disposed) return;
      if (!opts.isVerbose()) return;
      const ch = ensureChannel();
      ch.appendLine(formatErrorLine(message));
    },

    getSnapshot(): DiagnosticSnapshot {
      // Defensive copy of the ticks array — callers may mutate without
      // affecting future calls. `state` is held by reference (the
      // DashboardState is itself immutable per-tick).
      return { ticks: ticks.slice(), state: lastState };
    },

    subscribe(listener: DiagnosticTickListener): vscode.Disposable {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },

    clearHistory(): void {
      ticks.length = 0;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Dispose the channel only if we actually allocated one — never
      // create a channel on the dispose path.
      channel?.dispose();
      channel = null;
      prevState.clear();
      ticks.length = 0;
      listeners.clear();
      lastState = null;
    },
  };
}

// =============================================================================
// Line formatters — exported for unit-test coverage.
// =============================================================================

/**
 * Format the per-tick summary line.
 *
 * `[<ISO>] tick #<N> took <ms>ms — emitted=<bool>`
 *
 * `tickNumber` is the sequential counter from the watcher loop; `durationMs`
 * is the wall-clock end-to-end time (including disk reads + reduce + hash
 * compare); `emitted` is true when the tick produced a `state:full` message
 * to the webview, false when hash-skip suppressed it.
 *
 * Exported for direct unit coverage — the format is part of the diagnostic
 * contract and we want a regression test if it changes.
 */
export function formatTickLine(diag: TickDiagnostics): string {
  return `[${nowIso()}] tick #${diag.tickNumber} took ${diag.durationMs}ms — emitted=${diag.emitted}`;
}

/**
 * Format a per-agent state-transition line.
 *
 * `[<ISO>] transition session=<sid8> agent=<aid8> <prev> → <next>`
 *
 * `sid8` and `aid8` are the first 8 chars of the respective UUIDs — same
 * truncation used by `SessionTree.shortId`. The arrow uses Unicode `→`
 * for readability in the Output channel monospace font.
 *
 * Exported for unit coverage.
 */
export function formatTransitionLine(
  sessionId: string,
  agentId: string,
  prev: AgentState,
  next: AgentState,
): string {
  return `[${nowIso()}] transition session=${sessionId.slice(0, 8)} agent=${agentId.slice(0, 8)} ${prev} → ${next}`;
}

/**
 * Format a roster-reload event line.
 *
 * `[<ISO>] roster reloaded — teams=<N> errors=<N> warnings=<N>`
 *
 * Exported for unit coverage.
 */
export function formatRosterReloadLine(diag: RosterReloadDiagnostics): string {
  return `[${nowIso()}] roster reloaded — teams=${diag.teamsCount} errors=${diag.errorsCount} warnings=${diag.warningsCount}`;
}

/**
 * Format a watcher error-event line.
 *
 * `[<ISO>] error: <message>`
 *
 * Exported for unit coverage.
 */
export function formatErrorLine(message: string): string {
  return `[${nowIso()}] error: ${message}`;
}

// =============================================================================
// Internals
// =============================================================================

/** Current wall-clock as ISO-8601 string — used for every line prefix. */
function nowIso(): string {
  return new Date().toISOString();
}
