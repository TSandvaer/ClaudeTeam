/**
 * Sessions/PID registry — reads `~/.claude/sessions/*.json` and reports
 * the set of Claude Code sessions known to the local filesystem, each
 * cross-checked against the OS process table via `process.kill(pid, 0)`.
 *
 * Pure-ish: the only side effects are filesystem reads (sync, in-tree)
 * and the liveness probe. No polling, no caching — the caller (file
 * watcher, eventually M1-09's reducer) re-invokes per tick.
 *
 * Schema reference: `.claude/docs/data-sources.md` §1 "Live process registry".
 * Liveness rule:   `.claude/docs/data-sources.md` §"Liveness inference".
 *
 * ## Liveness probe semantics
 *
 * `process.kill(pid, 0)` does NOT actually signal the process — signal 0
 * is documented (Node, POSIX, Win32) as the "check liveness" probe. We
 * map all of its failure modes to `isAlive: false`:
 *
 *   - **ESRCH** (POSIX + Win32) — no such process. Definitively dead.
 *   - **EPERM** (POSIX + Win32) — process exists but the caller lacks
 *     permission to signal it. We treat this as dead for V1; the
 *     mtime-based secondary signal (data-sources.md "Liveness inference"
 *     step 2) will catch the rare false-negative when an actual Claude
 *     Code subagent JSONL keeps flushing. See M1-07 dispatch + Sage's
 *     M1 test plan for the documented gotcha.
 *   - **EINVAL / other** — defensive fallthrough. Treated as dead so we
 *     never surface a "maybe alive" tri-state to the dashboard.
 *
 * Windows behavior cross-check (Node docs, `child_process` page):
 *   > As on POSIX, signal 0 can be used to test for the existence of a
 *   > process. Windows will throw an error if `pid` is used to kill a
 *   > process group.
 * We pass a positive integer PID, never a process-group id; the probe is
 * portable.
 *
 * ## Failure modes the registry handles gracefully
 *
 * 1. `~/.claude/sessions/` directory missing — return `[]`, no throw.
 *    Sponsor may have just installed Claude Code and never opened it.
 * 2. Individual file mid-write (truncated JSON) — skip + warn, continue
 *    with siblings.
 * 3. Individual file with missing required fields — skip + warn, continue.
 * 4. Individual file that vanishes between `readdir` and `readFile` — skip
 *    + warn (ENOENT on the read); continue.
 * 5. PID number in filename does not match `pid` inside JSON — we trust
 *    the JSON `pid` field (used for the liveness probe) and ignore the
 *    filename mismatch silently. The filename is informational.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { SessionRecord } from "../../shared/types";

/**
 * Internal logger shape — kept tiny so callers (CLI, file watcher) can
 * inject a richer logger without us depending on `console` directly.
 * Default: silent (no-op). Tests may pass a capturing logger to assert
 * warning content; production callers wire `console.warn` if desired.
 */
export interface SessionRegistryLogger {
  warn(message: string): void;
}

const SILENT_LOGGER: SessionRegistryLogger = {
  warn: () => {
    /* no-op */
  },
};

/**
 * Read `<claudeHome>/sessions/` and return one `SessionRecord` per
 * well-formed JSON file, each tagged with a live OS-level liveness
 * probe. Order of records matches `readdirSync` order (filesystem-defined
 * — do NOT rely on it for display sorting; sort downstream).
 *
 * @param claudeHome The Claude Code home dir (e.g. `C:\Users\538252\.claude`
 * on Windows or `~/.claude` on POSIX). The function appends `sessions/`
 * internally.
 * @param logger Optional logger for malformed-file warnings. Defaults to
 * a silent no-op so the function is safe to call from hot paths.
 */
export function listSessions(
  claudeHome: string,
  logger: SessionRegistryLogger = SILENT_LOGGER,
): SessionRecord[] {
  const sessionsDir = join(claudeHome, "sessions");

  let entries: string[];
  try {
    entries = readdirSync(sessionsDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      // Expected when Claude Code has never run on this machine, or when
      // `claudeHome` is a fresh tempdir in tests. Quiet return.
      return [];
    }
    // Anything else (EACCES, etc.) is genuinely surprising — warn so the
    // user can diagnose, but still return an empty list rather than crash
    // the watcher tick.
    logger.warn(
      `sessionRegistry: failed to read ${sessionsDir}: ${(err as Error).message}`,
    );
    return [];
  }

  const records: SessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      // Stray files (lock files, OS metadata like .DS_Store) shouldn't be
      // parsed as session JSON. Skip silently.
      continue;
    }
    const fullPath = join(sessionsDir, entry);
    const record = tryParseSessionFile(fullPath, logger);
    if (record !== null) {
      records.push(record);
    }
  }
  return records;
}

/**
 * Read + parse one `{pid}.json` file. Returns `null` on any failure
 * (logged via `logger.warn` with a specific message). Never throws.
 *
 * Exported for direct unit-test coverage of the per-file failure modes
 * without having to stage a whole sessions/ directory.
 */
export function tryParseSessionFile(
  fullPath: string,
  logger: SessionRegistryLogger,
): SessionRecord | null {
  let raw: string;
  try {
    raw = readFileSync(fullPath, "utf-8");
  } catch (err) {
    // File vanished between readdir and readFile, or perm denied.
    // Both are recoverable — log + skip.
    logger.warn(
      `sessionRegistry: failed to read ${fullPath}: ${(err as Error).message}`,
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      `sessionRegistry: ${fullPath} is not valid JSON: ${(err as Error).message}`,
    );
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    logger.warn(
      `sessionRegistry: ${fullPath} top-level value must be an object`,
    );
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  // Field validation — every required field must be the right type. The
  // procStart field (data-sources.md §1) is intentionally not surfaced;
  // we don't consume it.
  const pid = obj["pid"];
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    logger.warn(
      `sessionRegistry: ${fullPath} missing/invalid integer field \`pid\``,
    );
    return null;
  }

  const sessionId = obj["sessionId"];
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    logger.warn(
      `sessionRegistry: ${fullPath} missing/invalid string field \`sessionId\``,
    );
    return null;
  }

  const cwd = obj["cwd"];
  if (typeof cwd !== "string" || cwd.length === 0) {
    logger.warn(
      `sessionRegistry: ${fullPath} missing/invalid string field \`cwd\``,
    );
    return null;
  }

  const version = obj["version"];
  if (typeof version !== "string" || version.length === 0) {
    logger.warn(
      `sessionRegistry: ${fullPath} missing/invalid string field \`version\``,
    );
    return null;
  }

  const entrypoint = obj["entrypoint"];
  if (typeof entrypoint !== "string" || entrypoint.length === 0) {
    logger.warn(
      `sessionRegistry: ${fullPath} missing/invalid string field \`entrypoint\``,
    );
    return null;
  }

  const startedAt = obj["startedAt"];
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) {
    logger.warn(
      `sessionRegistry: ${fullPath} missing/invalid number field \`startedAt\``,
    );
    return null;
  }

  return {
    pid,
    sessionId,
    cwd,
    version,
    entrypoint,
    startedAt,
    isAlive: isPidAlive(pid),
  };
}

/**
 * Probe the OS for whether `pid` corresponds to a running process.
 *
 * `process.kill(pid, 0)` is the canonical Node liveness check (POSIX
 * signal 0 = "do not deliver, just validate"). On Windows the same call
 * delegates to `OpenProcess` semantics and behaves equivalently for a
 * positive PID; see the module docstring for the documented EPERM caveat.
 *
 * Exported for direct unit-test coverage (the test for `process.pid`
 * uses this directly to avoid having to stage a sessions/ directory).
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Any error — ESRCH, EPERM, EINVAL — is treated as dead per the
    // module docstring's "Liveness probe semantics" section. We do not
    // discriminate ESRCH vs EPERM because the dashboard renders the
    // same way for both; the rare EPERM-for-truly-alive case is caught
    // by the secondary mtime signal in the reducer (M1-09).
    return false;
  }
}
