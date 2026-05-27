/**
 * Diagnostic Output channel — verbose per-tick state-delta logging (86c9zn7vw).
 *
 * When the `claudeteam.diagnostic.verbose` setting is true, this module
 * emits one log line per watcher tick (timestamp + duration + state-change
 * flag) plus per-agent state-transition lines when the reducer's `inferState`
 * returns a different state than the prior tick, plus roster reload events
 * and error events. When the setting is false, every emit call is a no-op
 * fast-path (so production overhead is ~zero).
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
 * Source: ClickUp 86c9zn7vw + project doc §
 *         `.claude/docs/vscode-extension-conventions.md` (Output channel
 *         conventions are extension-host concerns — webview owns no part).
 */

import type * as vscode from "vscode";

import type { AgentState, DashboardState } from "../../shared/types.js";
import { isCollapsedPersonaGroup } from "../../shared/types.js";

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
 * Diagnostic dispatcher returned from `createDiagnosticChannel`.
 *
 * All `record*` methods are no-ops when verbose mode is off — the fast
 * path is `isVerbose() === false → return immediately`, no channel
 * allocated, no string formatting performed. This is important: even an
 * unused diagnostic channel that allocates strings per tick would cost
 * real GC pressure on the production hot path.
 */
export interface DiagnosticChannel extends vscode.Disposable {
  /**
   * Called by the watcher at the end of every tick. Emits the tick line
   * and any per-agent state transitions vs the previously-recorded state.
   * No-op when verbose is off — but the prior-state tracker is also NOT
   * updated, so flipping verbose from off to on starts fresh (no
   * misleading "transition from undefined → running" lines on the first
   * verbose tick).
   */
  recordTick(diag: TickDiagnostics): void;

  /**
   * Called by the watcher when the roster YAML hot-reloads (M3-01
   * rosterWatcher's `onRosterChange`). One line per reload.
   */
  recordRosterReload(diag: RosterReloadDiagnostics): void;

  /**
   * Called by the watcher's catch-all error path. One line per error.
   */
  recordError(message: string): void;
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
  const prevState = new Map<string, AgentState>();
  let disposed = false;

  const ensureChannel = (): vscode.OutputChannel => {
    if (channel === null) {
      channel = opts.createOutputChannel(DIAGNOSTIC_CHANNEL_NAME);
    }
    return channel;
  };

  return {
    recordTick(diag: TickDiagnostics): void {
      if (disposed) return;
      if (!opts.isVerbose()) {
        // Fast-path: do NOT update prevState while verbose is off — when
        // the user toggles back on, transitions should be relative to the
        // first verbose tick, not stale entries from a prior verbose
        // session. This matches the webview prevStateTracker contract:
        // first observation is not a transition.
        return;
      }
      const ch = ensureChannel();
      ch.appendLine(formatTickLine(diag));

      // Walk every rostered tile + each instance in collapsed groups + every
      // background agent slot. Background agents have no agentId in the
      // tile shape, so transitions for them are skipped (they're collapsed
      // into the noise counter on the webview side anyway).
      const seenKeys = new Set<string>();
      for (const session of diag.state.sessions) {
        for (const [, entries] of session.rosterTiles) {
          for (const entry of entries) {
            if (isCollapsedPersonaGroup(entry)) {
              for (const tile of entry.instances) {
                emitTransitionIfChanged(
                  ch,
                  prevState,
                  seenKeys,
                  session.sessionId,
                  tile.agentId,
                  tile.state,
                );
              }
            } else {
              emitTransitionIfChanged(
                ch,
                prevState,
                seenKeys,
                session.sessionId,
                entry.agentId,
                entry.state,
              );
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

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Dispose the channel only if we actually allocated one — never
      // create a channel on the dispose path.
      channel?.dispose();
      channel = null;
      prevState.clear();
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

/**
 * Emit a transition line when the agent's state differs from the prior
 * tick's recorded state. Updates `prevState` to the new state regardless,
 * so the next tick's diff is against this one. First observation (no prior
 * entry) is NOT emitted as a transition — matches the webview
 * prevStateTracker contract.
 */
function emitTransitionIfChanged(
  channel: vscode.OutputChannel,
  prevState: Map<string, AgentState>,
  seenKeys: Set<string>,
  sessionId: string,
  agentId: string,
  newState: AgentState,
): void {
  const key = `${sessionId}:${agentId}`;
  seenKeys.add(key);
  const prev = prevState.get(key);
  if (prev !== undefined && prev !== newState) {
    channel.appendLine(formatTransitionLine(sessionId, agentId, prev, newState));
  }
  prevState.set(key, newState);
}
