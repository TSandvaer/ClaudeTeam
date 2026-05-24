/**
 * Roster watcher — live YAML hot-reload (M3-01).
 *
 * Wraps `vscode.workspace.createFileSystemWatcher` to watch the global
 * (`~/.claudeteam/teams.yaml`) and per-project (`<workspace>/.claude/teams.yaml`)
 * roster paths. On any change/create/delete event, debounces (250ms), re-runs
 * `loadRoster`, and hands the `RosterLoadResult` to the supplied callback.
 *
 * The user's edit → dashboard tile update flow is:
 *
 *     edit YAML in editor   →  fs change event  →  rosterWatcher debounces
 *     →  loadRoster()       →  onRosterChange callback fires
 *     →  host triggers a watcher tick           →  matcher re-runs against
 *     →  state:full posted to webview            new roster
 *
 * Errors do NOT throw. Parse / validation failures land in
 * `RosterLoadResult.errors`; the caller decides what to surface (M3-04 renders
 * the error chip from this list). The PREVIOUS valid roster stays in effect
 * because the matcher pulls from whatever `loadRoster` returns most recently —
 * we never hand a "bad" roster back, we hand a result whose `.roster` may be
 * empty alongside `.errors` populated.
 *
 * ## Why `RelativePattern` + `*.yaml` glob (non-negotiable, see PR #32)
 *
 * Three out-of-workspace caveats validated in `team/bram-research/m3-prior-art-2026-05-24.md`:
 *
 *   (a) **`RelativePattern` is mandatory.** A plain string glob like
 *       `createFileSystemWatcher("/home/.../*.yaml")` silently drops every
 *       event for paths outside `vscode.workspace.workspaceFolders` since
 *       VS Code 1.64. The fix is to base the pattern on a `Uri.file(dir)`.
 *   (b) **Use a glob (`*.yaml`), not the literal filename.** VS Code issue
 *       #164925 reports single-filename patterns may not fire reliably on
 *       all builds (issue closed, fix-version unpinned). Filter by `fsPath`
 *       inside the event handler instead.
 *   (c) **One watcher per directory** — global dir + project `.claude/` dir.
 *       Combining into a recursive `**` pattern triggers a separate
 *       double-fire bug (#163352) on some builds.
 *
 * ## Why a 250ms debounce
 *
 * Most YAML editors emit two events on save in quick succession (e.g. VS Code
 * itself: a `change` from the write-through buffer, then a `change` from the
 * mtime touch). Atomic-replace editors (vim's `:w`) produce `delete + create`.
 * 250ms is enough to coalesce those bursts into a single reload, but tight
 * enough that the user perceives "saved → tile updates" as instant. The
 * window is documented inline below — adjust at the constant if you change it.
 *
 * ## Empty-state behavior (AC6, AC7)
 *
 * - **File missing, directory present:** watcher registers on the directory;
 *   a later `onDidCreate` for the file fires a reload. No error logged at
 *   startup — `loadRoster` already records "file not found" as a warning.
 *
 * - **Directory missing:** we cannot create a FileSystemWatcher on a
 *   nonexistent base URI (VS Code throws synchronously). We log once at
 *   startup and skip that watcher. If the user later creates the directory,
 *   a Reload Window picks it up — documented as a known constraint in the
 *   M3-01 PR body.
 *
 * ## Polling fallback (AC8)
 *
 * Feature-flagged via the `claudeteam.rosterPollIntervalMs` setting (default
 * `0`, meaning OFF). When set to a positive value, an additional
 * `setInterval` calls `fs.statSync(path).mtimeMs` on each known roster path
 * and triggers a reload if the mtime has changed. The VS Code watcher stays
 * active in parallel — the poll is belt-and-suspenders for environments
 * where the FS watcher is unreliable (some WSL paths, network drives, etc.).
 */

import { existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

import * as vscode from "vscode";

import { loadRoster } from "./loader.js";
import type { RosterLoadResult } from "../../shared/types.js";

/**
 * Debounce window. Coalesces events arriving within this many ms into a
 * single reload. Tuned for the editor-double-event pattern; do not set
 * below ~100ms (atomic-replace `delete + create` is then split into two
 * reloads in some terminals) or above ~500ms (user perceives lag).
 */
export const ROSTER_DEBOUNCE_MS = 250;

/**
 * Default poll cadence when `claudeteam.rosterPollIntervalMs` is enabled but
 * a non-positive override is supplied. The brief specifies 5000ms.
 */
export const ROSTER_POLL_FALLBACK_MS = 5000;

/**
 * Minimum legal poll cadence — clamped to avoid pathologically tight loops.
 * Set to match the debounce window: any tighter than this and the polling
 * loop fires within a single debounce reset cycle, which is wasted CPU
 * (the next poll will see the same mtime + reset the same debounce). A
 * `fs.statSync` call every 250ms is well within acceptable overhead for
 * the fallback path (this is the FALLBACK; the primary path is VS Code's
 * FileSystemWatcher which has no polling at all).
 */
const ROSTER_POLL_MIN_MS = 250;

/**
 * Inputs for {@link startRosterWatcher}. Split into a plain options object
 * so unit / integration tests can construct it without a VS Code instance —
 * the test harness mocks `vscode` via vitest's module resolution.
 */
export interface RosterWatcherOptions {
  /**
   * Absolute path to the global roster file (typically
   * `~/.claudeteam/teams.yaml`). May be `undefined` when the user has not
   * configured one — the watcher then only watches the project path.
   */
  globalPath?: string;

  /**
   * Absolute path to the per-project roster file (typically
   * `<workspace>/.claude/teams.yaml`). `undefined` when no workspace folder
   * is open.
   */
  projectPath?: string;

  /**
   * Fired AFTER debounce, AFTER a fresh `loadRoster` call. Receives the
   * full `RosterLoadResult` (roster + warnings + errors). Errors do NOT
   * cause this callback to be skipped — the caller decides whether to
   * surface them (error chip via M3-04) or fall back to the previous
   * valid roster (matcher's responsibility — see `watcherLoop.ts`).
   */
  onRosterChange: (result: RosterLoadResult) => void;

  /**
   * Optional poll cadence override (ms). When positive, enables the
   * polling-fallback path described above. `0` / undefined / negative →
   * fallback OFF. The user-facing setting `claudeteam.rosterPollIntervalMs`
   * threads through here from `activate()`.
   */
  pollIntervalMs?: number;

  /**
   * Optional logger. Defaults to a no-op so production stays silent.
   * Integration tests inject one to assert empty-directory log lines fired.
   */
  logger?: { warn: (msg: string) => void; info?: (msg: string) => void };
}

/**
 * Start the live roster watcher. Returns a {@link vscode.Disposable} that
 * tears down BOTH FileSystemWatchers, clears the debounce timer, and stops
 * the optional polling fallback. Idempotent — calling `dispose()` twice
 * is safe.
 *
 * Behavior:
 *   - On startup: does NOT fire `onRosterChange` (the caller already has
 *     the initial roster from its activation-time `loadRoster` call). The
 *     watcher's job is to react to CHANGES after that point.
 *   - On change / create / delete in the watched directory: debounces 250ms,
 *     filters events to the configured roster path(s), calls `loadRoster`
 *     against the SAME global+project pair every time, fires the callback.
 *   - On directory-missing at start: logs once at `logger.info` level,
 *     skips watcher registration for that path. A Reload Window after the
 *     user creates the directory picks it up (documented constraint).
 */
export function startRosterWatcher(
  opts: RosterWatcherOptions,
): vscode.Disposable {
  const logger = opts.logger ?? {
    warn: () => {},
    info: () => {},
  };

  /**
   * Set of fs paths whose changes should trigger a reload. Populated below
   * from the configured paths; the FS-event handler filters event URIs
   * against this set so we ignore unrelated YAML files in the same dir.
   */
  const watchedPaths = new Set<string>();
  if (opts.globalPath) watchedPaths.add(normalizePath(opts.globalPath));
  if (opts.projectPath) watchedPaths.add(normalizePath(opts.projectPath));

  const disposables: vscode.Disposable[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;
  let pollInterval: NodeJS.Timeout | null = null;
  /** Snapshot of mtimes per watched path; used by the polling fallback. */
  const lastMtimes = new Map<string, number>();
  let disposed = false;

  /**
   * Schedule (or extend) the debounced reload. Multiple events arriving
   * within ROSTER_DEBOUNCE_MS coalesce to one `onRosterChange`.
   */
  const scheduleReload = (): void => {
    if (disposed) return;
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (disposed) return;
      try {
        const result = loadRoster(opts.globalPath, opts.projectPath);
        // Update mtime snapshots so the polling fallback (if active) doesn't
        // re-fire on the same change that already came through via fs events.
        for (const p of watchedPaths) {
          const m = safeMtimeMs(p);
          if (m !== null) lastMtimes.set(p, m);
        }
        try {
          opts.onRosterChange(result);
        } catch (err) {
          logger.warn(
            `rosterWatcher: onRosterChange handler threw: ${(err as Error).message}`,
          );
        }
      } catch (err) {
        // loadRoster is supposed to never throw, but defense in depth: if
        // it does, we surface the failure as a synthesized error result so
        // the caller can still react (M3-04's chip) instead of going dark.
        logger.warn(
          `rosterWatcher: loadRoster threw unexpectedly: ${(err as Error).message}`,
        );
        try {
          opts.onRosterChange({
            roster: [],
            warnings: [],
            errors: [
              `roster reload failed (unexpected): ${(err as Error).message}`,
            ],
          });
        } catch {
          /* ignore — handler already crashed once */
        }
      }
    }, ROSTER_DEBOUNCE_MS);
  };

  /**
   * Event handler for fs watcher callbacks. Filters by configured roster
   * paths (we use a `*.yaml` glob so unrelated YAML files in the same dir
   * also trigger events; ignore them).
   */
  const onFsEvent = (uri: vscode.Uri): void => {
    if (!watchedPaths.has(normalizePath(uri.fsPath))) return;
    scheduleReload();
  };

  // -------------------------------------------------------------------------
  // Register one FileSystemWatcher per directory (global + project).
  // -------------------------------------------------------------------------

  const registerDirWatcher = (rosterPath: string | undefined, label: string): void => {
    if (!rosterPath) return;
    const dir = dirname(rosterPath);
    if (!existsSync(dir)) {
      // AC6: do NOT error; log once at startup. Reload Window is required
      // to pick up the directory if the user creates it later — call this
      // out in the PR body so the user knows.
      logger.info?.(
        `rosterWatcher: ${label} roster directory does not exist yet (${dir}); reload window after creating to pick up the watcher`,
      );
      return;
    }
    let watcher: vscode.FileSystemWatcher;
    try {
      watcher = vscode.workspace.createFileSystemWatcher(
        // Per Bram's PR #32 verdict + roster-matching.md "Watcher implementation note":
        //   RelativePattern + Uri.file(dir) is the ONLY shape that fires for
        //   paths outside vscode.workspace.workspaceFolders. Plain glob strings
        //   silently drop out-of-workspace events post-1.64. Literal filename
        //   may not fire on some builds (issue #164925); filter in handler.
        new vscode.RelativePattern(vscode.Uri.file(dir), "*.yaml"),
      );
    } catch (err) {
      // Should not happen for an existsSync-true dir, but defense in depth.
      logger.warn(
        `rosterWatcher: failed to register watcher for ${dir}: ${(err as Error).message}`,
      );
      return;
    }
    disposables.push(
      watcher.onDidChange(onFsEvent),
      watcher.onDidCreate(onFsEvent),
      watcher.onDidDelete(onFsEvent),
      watcher,
    );
  };

  registerDirWatcher(opts.globalPath, "global");
  registerDirWatcher(opts.projectPath, "project");

  // -------------------------------------------------------------------------
  // Polling fallback (AC8) — feature-flagged via opts.pollIntervalMs.
  // -------------------------------------------------------------------------

  const requestedPoll = opts.pollIntervalMs ?? 0;
  if (requestedPoll > 0) {
    const pollMs = Math.max(
      ROSTER_POLL_MIN_MS,
      Number.isFinite(requestedPoll) ? requestedPoll : ROSTER_POLL_FALLBACK_MS,
    );
    // Seed lastMtimes so the FIRST poll doesn't fire a spurious "changed"
    // event for files that existed before the watcher started.
    for (const p of watchedPaths) {
      const m = safeMtimeMs(p);
      if (m !== null) lastMtimes.set(p, m);
    }
    pollInterval = setInterval(() => {
      if (disposed) return;
      for (const p of watchedPaths) {
        const current = safeMtimeMs(p);
        const prev = lastMtimes.get(p);
        if (current === null) {
          // File vanished — if we had a prev mtime, that's a delete event.
          if (prev !== undefined) {
            lastMtimes.delete(p);
            scheduleReload();
          }
          continue;
        }
        if (prev === undefined || current !== prev) {
          // File created or mtime changed since last poll.
          lastMtimes.set(p, current);
          scheduleReload();
        }
      }
    }, pollMs);
  }

  return {
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* best-effort cleanup — never let dispose throw */
        }
      }
      disposables.length = 0;
    },
  };
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Normalize a filesystem path for cross-platform equality checks.
 *
 * Windows: vscode.Uri.file lowercases the drive letter and uses forward
 * slashes (`/`). Our configured `globalPath` comes from `path.join(homedir,
 * ...)` which produces backslashes and the OS-supplied drive casing. We need
 * the two to compare equal in the FS-event filter.
 *
 * Strategy: lowercase + replace backslashes with forward slashes. Adequate
 * for V1 — full Win32 canonicalization (UNC paths, 8.3 short names, etc.)
 * is out of scope.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Return the mtime in ms for a path, or `null` if the file does not exist
 * or stat fails for any reason. Used by the polling fallback.
 *
 * Defensive: NEVER throws — the polling loop must keep running across
 * transient fs errors (network drives, files vanishing mid-read).
 */
function safeMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
