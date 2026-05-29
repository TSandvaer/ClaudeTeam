/**
 * Agents-folder drift watcher (TS-02 / team-setup epic, Decision 3 / spec §6).
 *
 * Watches `<workspace>/.claude/agents/*.md` and, on any change/create/delete,
 * debounces, re-scans the folder, and fires `onAgentsChange` with the fresh
 * {@link ScannedAgent}[] PLUS a diff against the previous scan (new agent names,
 * removed agent names). The host uses this to:
 *   - fire a NON-BLOCKING "N new agents found — review" nudge signal (never
 *     auto-mutates `claudeteam.yaml`).
 *   - flip a member to `status: orphaned` when its backing agent file is
 *     removed (via `reconcileOrphans` — the watcher only signals; the host
 *     owns the config write).
 *
 * ## Never auto-mutate (Decision 3 / spec §6)
 *
 * This watcher NEVER writes `claudeteam.yaml` on its own. New agents produce a
 * nudge for the user to review in the Manage Team panel; removed agents produce
 * an orphan signal. The host's handler decides what to write. This is the
 * load-bearing constraint: drift detection is read-only.
 *
 * ## Why RelativePattern + `*.md` glob + polling fallback
 *
 * Identical rationale to `rosterWatcher.ts` (PR #32): a plain-string glob
 * silently drops events for paths outside `workspace.workspaceFolders`;
 * RelativePattern on `Uri.file(agentsDir)` is mandatory. We use `*.md` (not a
 * literal filename — VS Code #164925) and filter persona-agent files in the
 * callback via `scanAgentsFolder`. Polling fallback mirrors the roster watcher
 * for FS-watcher-unreliable environments (WSL, network drives).
 */

import { existsSync, statSync } from "node:fs";

import * as vscode from "vscode";

import { resolveAgentsDir, scanAgentsFolder } from "./agentScanner.js";
import type { ScannedAgent } from "../../shared/types.js";

/** Debounce window — mirrors `rosterWatcher.ROSTER_DEBOUNCE_MS`. */
export const AGENTS_DEBOUNCE_MS = 250;

/** Default poll cadence when the fallback is enabled with a non-positive override. */
export const AGENTS_POLL_FALLBACK_MS = 5000;

/** Minimum legal poll cadence — clamp to the debounce window (mirrors roster watcher). */
const AGENTS_POLL_MIN_MS = 250;

/** Payload handed to `onAgentsChange` after a debounced re-scan. */
export interface AgentsChange {
  /** The full fresh scan result. */
  scanned: ScannedAgent[];
  /** Agent names present now but absent in the previous scan (drift-in / nudge). */
  added: string[];
  /** Agent names present previously but absent now (drift-out / orphan trigger). */
  removed: string[];
}

/** Inputs for {@link startAgentWatcher}. */
export interface AgentWatcherOptions {
  /**
   * Absolute path to the first workspace folder (multi-root = first folder
   * only, ratify default). The watcher resolves `<folder>/.claude/agents` via
   * {@link resolveAgentsDir}. `undefined` when no folder is open → the watcher
   * is a no-op (returns a disposable that does nothing).
   */
  workspaceFolderPath?: string;
  /**
   * Fired AFTER debounce + re-scan, ONLY when the scan diff is non-empty
   * (added or removed agents). Never fired on startup. The host reacts (nudge
   * + orphan reconcile); this watcher never mutates config.
   */
  onAgentsChange: (change: AgentsChange) => void;
  /** Optional poll cadence override (ms). Positive → polling fallback ON. */
  pollIntervalMs?: number;
  /** Optional logger. Defaults to no-op. */
  logger?: { warn: (msg: string) => void; info?: (msg: string) => void };
}

/**
 * Start the agents-folder drift watcher. Returns a disposable tearing down the
 * FileSystemWatcher, debounce timer, and polling fallback. Idempotent.
 *
 * No-op (returns an inert disposable) when no workspace folder is open OR the
 * agents directory does not exist at start — the latter logs once and is picked
 * up on a Reload Window if the user creates it later (mirrors rosterWatcher's
 * directory-missing constraint).
 */
export function startAgentWatcher(
  opts: AgentWatcherOptions,
): vscode.Disposable {
  const logger = opts.logger ?? { warn: () => {}, info: () => {} };
  const inert: vscode.Disposable = { dispose: () => {} };

  if (!opts.workspaceFolderPath) {
    return inert;
  }
  const agentsDir = resolveAgentsDir(opts.workspaceFolderPath);

  // Seed the prior-scan snapshot so the FIRST diff is computed against the
  // startup state (no spurious "added" nudge for agents that existed already).
  let prevNames = new Set<string>(
    scanAgentsFolder(agentsDir).map((a) => a.agentName),
  );

  const disposables: vscode.Disposable[] = [];
  let debounceTimer: NodeJS.Timeout | null = null;
  let pollInterval: NodeJS.Timeout | null = null;
  let lastDirMtime: number | null = safeMtimeMs(agentsDir);
  let disposed = false;

  const scheduleRescan = (): void => {
    if (disposed) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (disposed) return;
      const scanned = scanAgentsFolder(agentsDir);
      const currentNames = new Set(scanned.map((a) => a.agentName));
      const added = [...currentNames].filter((n) => !prevNames.has(n)).sort();
      const removed = [...prevNames].filter((n) => !currentNames.has(n)).sort();
      prevNames = currentNames;
      if (added.length === 0 && removed.length === 0) {
        return; // mtime touched but persona set unchanged — no signal.
      }
      try {
        opts.onAgentsChange({ scanned, added, removed });
      } catch (err) {
        logger.warn(
          `agentWatcher: onAgentsChange handler threw: ${(err as Error).message}`,
        );
      }
    }, AGENTS_DEBOUNCE_MS);
  };

  if (!existsSync(agentsDir)) {
    logger.info?.(
      `agentWatcher: agents directory does not exist yet (${agentsDir}); reload window after creating to pick up the watcher`,
    );
  } else {
    let watcher: vscode.FileSystemWatcher;
    try {
      watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(agentsDir), "*.md"),
      );
    } catch (err) {
      logger.warn(
        `agentWatcher: failed to register watcher for ${agentsDir}: ${(err as Error).message}`,
      );
      return inert;
    }
    const onFsEvent = (): void => scheduleRescan();
    disposables.push(
      watcher.onDidChange(onFsEvent),
      watcher.onDidCreate(onFsEvent),
      watcher.onDidDelete(onFsEvent),
      watcher,
    );
  }

  // Polling fallback — watch the DIRECTORY mtime (changes on add/remove of a
  // child file). A child-content edit doesn't bump the dir mtime, but content
  // edits don't change the persona set, so that's fine for drift detection.
  const requestedPoll = opts.pollIntervalMs ?? 0;
  if (requestedPoll > 0) {
    const pollMs = Math.max(
      AGENTS_POLL_MIN_MS,
      Number.isFinite(requestedPoll) ? requestedPoll : AGENTS_POLL_FALLBACK_MS,
    );
    pollInterval = setInterval(() => {
      if (disposed) return;
      const current = safeMtimeMs(agentsDir);
      if (current !== lastDirMtime) {
        lastDirMtime = current;
        scheduleRescan();
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
          /* best-effort */
        }
      }
      disposables.length = 0;
    },
  };
}

/** mtime in ms, or null on any stat failure. Never throws. */
function safeMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}
