/**
 * Window-scoped session filter (M3-03).
 *
 * Pure function — given a list of SessionRecords and the current VS Code
 * window's workspace folder paths, returns only the sessions whose `cwd`
 * matches one of those folders. Default behavior changes from "show every
 * Claude Code session on the machine" to "show only sessions relevant to
 * this window."
 *
 * The matcher is intentionally narrow for V1:
 *   - Exact folder match only — no subdirectory matching (sponsor will
 *     surface real-world miss cases if any).
 *   - Trailing-slash normalization (one folder ends with `/`, another
 *     doesn't — both should match the same session cwd).
 *   - Drive-letter casing normalized on Windows (`c:\...` vs `C:\...`).
 *   - Path-separator normalization (forward vs back slash) on Windows so
 *     a workspace folder reported as `c:/Trunk/...` still matches a session
 *     `cwd` reported as `c:\Trunk\...`. On POSIX no separator translation
 *     applies (forward slash is the only separator).
 *   - POSIX is case-sensitive (path equality is byte-exact after slash
 *     normalization). Windows is case-insensitive (Win32 filesystem rule).
 *
 * Don't-strand-the-user behavior (AC1):
 *   - `showAll === true` → return input unchanged.
 *   - `showAll === false` + workspaceFolders empty/undefined → return input
 *     unchanged. Rationale: the user has no filter signal to interpret
 *     (no folder open ⇒ "this window has no scope"); filtering to zero
 *     would leave them looking at an empty dashboard with no way to see
 *     anything without toggling a setting they may not know exists.
 *   - `showAll === false` + workspaceFolders non-empty + no session matches
 *     → return an empty list. This is the "filtered-to-empty" case the
 *     webview surfaces via `DashboardState.filterApplied === true` +
 *     `sessions.length === 0`.
 *
 * Source: team/nora-pl/milestone-3-backlog.md § M3-03 AC1/AC2;
 *         .claude/docs/data-sources.md §1 (SessionRecord.cwd shape).
 */

import type { SessionRecord } from "../../shared/types.js";

/**
 * Minimal workspace-folder shape consumed by the filter. We accept just the
 * `fsPath` string rather than `vscode.WorkspaceFolder` so:
 *   - the function is unit-testable without mocking the VS Code namespace; and
 *   - callers (production wiring in `main.ts`) can derive `fsPath` from
 *     `vscode.workspace.workspaceFolders` directly.
 *
 * `readonly` so callers can pass the live `workspaceFolders` array without
 * a defensive copy.
 */
export interface WindowFolder {
  /** Absolute filesystem path, equivalent to `vscode.WorkspaceFolder.uri.fsPath`. */
  fsPath: string;
}

/**
 * Filter sessions to the current VS Code window's workspace.
 *
 * Pure — no side effects. Returns the original array reference unchanged when
 * the showAll passthrough or empty-folders passthrough fires; allocates a new
 * filtered array otherwise.
 *
 * @param sessions          All sessions discovered by `listSessions`.
 * @param workspaceFolders  Current VS Code workspace folders (may be undefined
 *                          when running with no folder open).
 * @param showAll           Value of `claudeteam.showAllSessionsGlobally`.
 *                          When true, filter is a passthrough.
 */
export function filterSessionsToWindow(
  sessions: readonly SessionRecord[],
  workspaceFolders: readonly WindowFolder[] | undefined,
  showAll: boolean,
): SessionRecord[] {
  // AC1: showAll → passthrough.
  if (showAll) {
    return sessions.slice();
  }

  // AC1: no folder open → passthrough (don't strand the user).
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return sessions.slice();
  }

  const normalizedFolders = workspaceFolders.map((f) => normalizePath(f.fsPath));
  return sessions.filter((session) => {
    const cwd = normalizePath(session.cwd);
    return normalizedFolders.includes(cwd);
  });
}

/**
 * Decide whether the filter actually reduced the visible session count.
 *
 * Pure — answers "did the window filter eliminate at least one session?",
 * used to populate `DashboardState.filterApplied`. The flag distinguishes
 * "filtered to empty" (true — show the per-workspace empty messaging) from
 * "globally empty" (false — show the no-sessions-anywhere messaging) in
 * the webview. See M3-03 AC6/AC7.
 *
 * Returns `false` when:
 *   - showAll is true (no filter logic ran); OR
 *   - no workspace folder is open (don't-strand-the-user passthrough); OR
 *   - the filter ran but didn't remove anything (every session matched a
 *     workspace folder, so the user wouldn't see a difference).
 */
export function isFilterApplied(
  unfilteredCount: number,
  filteredCount: number,
  workspaceFolders: readonly WindowFolder[] | undefined,
  showAll: boolean,
): boolean {
  if (showAll) return false;
  if (!workspaceFolders || workspaceFolders.length === 0) return false;
  return filteredCount < unfilteredCount;
}

// =============================================================================
// Internals — path normalization.
// =============================================================================

/**
 * `true` when running on Windows. Resolved at module-load via `process.platform`.
 * Exported for tests that need to assert the OS-specific branch behavior.
 */
export const IS_WINDOWS = process.platform === "win32";

/**
 * Normalize a filesystem path for equality comparison.
 *
 * Operations applied (in order):
 *   1. Strip a trailing path separator (forward or back slash) if present —
 *      `c:\foo\` and `c:\foo` should compare equal.
 *   2. On Windows ONLY: convert all forward slashes to backslashes (so
 *      `c:/foo` matches `c:\foo`), and lowercase the whole string (Win32
 *      filesystem semantics are case-insensitive — both the drive letter
 *      AND the rest of the path). On POSIX, do neither (case-sensitive,
 *      forward-slash-only).
 *
 * NOT applied:
 *   - `..` / `.` resolution. We assume both sides supply absolute paths
 *     already (VS Code's `WorkspaceFolder.uri.fsPath` is absolute; the
 *     session JSON's `cwd` is captured from `process.cwd()` which is
 *     absolute). If the assumption breaks, the filter will produce a miss
 *     rather than a wrong-folder match — a safe failure mode.
 *   - UNC path normalization. Not observed in real captures; revisit when
 *     sponsor surfaces a UNC workspace.
 *
 * Exported for direct unit-test coverage.
 */
export function normalizePath(p: string): string {
  // Strip trailing separator (but never strip the entire string — `/` and
  // `C:\` are legitimate root paths).
  let out = p;
  if (out.length > 1 && (out.endsWith("/") || out.endsWith("\\"))) {
    out = out.slice(0, -1);
  }
  if (IS_WINDOWS) {
    // Convert forward slashes to backslashes so cross-source paths match.
    out = out.replace(/\//g, "\\");
    // Case-insensitive: lowercase the whole string.
    out = out.toLowerCase();
  }
  return out;
}
