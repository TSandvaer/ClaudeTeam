/**
 * File-watcher polling loop.
 *
 * Wraps M1's one-shot pure functions in a recurring poll → reduce → emit
 * cycle. The host calls `startWatcher` once on activation; the returned
 * `Disposable` stops the loop and cleans up on `deactivate()`.
 *
 * ## Why a hybrid approach (file-system watcher + interval)
 *
 * Per `team/bram-research/m2-vscode-prior-art-2026-05-23.md` § "File-watcher
 * approach":
 *   - `vscode.workspace.createFileSystemWatcher` on `~/.claude/sessions/*.json`
 *     fires fast on session-list changes (zero-dep, lifecycle-integrated).
 *   - JSONL files flush in 2–56 second bursts, so a watcher PER JSONL would
 *     fire repeatedly without new information; a `setInterval` poll is the
 *     correct cadence for activity-line updates.
 *
 * The watcher's role is "kick the loop on session appear/disappear"; the
 * interval's role is "refresh the activity view at the configured cadence."
 * Both end up calling `runTick` — there is no special-case branch per
 * trigger source, the tick is idempotent.
 *
 * ## Why state-hash skip
 *
 * Each tick re-reads disk; most ticks produce the same `DashboardState` as
 * the prior. Re-posting an identical state to the webview burns DOM diff
 * cycles for no reason. The hash-skip compares the JSON-serialized state
 * to the prior tick and short-circuits when equal — a string compare on
 * the wire shape, which is cheap and correct.
 *
 * Source: `team/nora-pl/milestone-2-backlog.md` § M2-04
 *         `.claude/docs/architecture-overview.md` § Two-tier data plane
 */

import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";

import * as vscode from "vscode";

import { listSessions } from "./sessionRegistry.js";
import { readActivity } from "./subagentTailer.js";
import { parseMetaFromString } from "./metaJsonLoader.js";
import { loadRoster } from "../roster/loader.js";
import { buildAgentTree } from "../state/reducer.js";
import type {
  ActivityMap,
  AgentMetaEntry,
  FinishedSet,
  SessionAgentData,
} from "../state/reducer.js";
import { cwdToSlug } from "../../shared/slug.js";
import type { DashboardState } from "../../shared/types.js";

/**
 * Configuration accepted by `startWatcher`. Splitting these out keeps the
 * function unit-testable without a live VS Code instance.
 */
export interface WatcherOptions {
  /** Path to `~/.claude/` (or a tempdir mimicking the layout, for tests). */
  claudeHome: string;

  /**
   * Optional path(s) for the roster YAML.
   *   - `globalRosterPath`  — typically `~/.claudeteam/teams.yaml`.
   *   - `projectRosterPath` — typically `<project>/.claude/teams.yaml`.
   * Both optional; absent ones are treated as "no roster" by `loadRoster`.
   */
  globalRosterPath?: string;
  projectRosterPath?: string;

  /** Poll cadence in milliseconds. Clamped to ≥250ms internally. */
  pollIntervalMs: number;

  /**
   * Called every time the state changes (skipped when the new state is
   * identical to the prior one — see `runTick` hash-skip). Errors thrown
   * from this callback are caught and logged via `logger.warn`; they do
   * NOT stop the loop.
   */
  onStateChange: (state: DashboardState) => void;

  /**
   * Optional VS Code FileSystemWatcher to bolt onto the loop. When provided,
   * the watcher's events trigger an immediate tick (in addition to the
   * regular setInterval cadence). Production callers wire
   * `vscode.workspace.createFileSystemWatcher`; tests omit this.
   *
   * The watcher itself is NOT created by `startWatcher` — the caller owns
   * its lifecycle (so production code can choose the path glob and tests
   * can opt out). `startWatcher` only attaches handlers and returns a
   * disposable that detaches them.
   */
  sessionsFsWatcher?: {
    onDidCreate(handler: () => void): vscode.Disposable;
    onDidChange(handler: () => void): vscode.Disposable;
    onDidDelete(handler: () => void): vscode.Disposable;
  };

  /** Optional logger; defaults to a no-op so silent in production. */
  logger?: { warn: (msg: string) => void };
}

/** Floor on the poll interval. Anything below this is clamped. */
export const MIN_POLL_MS = 250;

/**
 * Start the polling watcher loop. Returns a disposable that stops it.
 *
 * Behavior:
 *   - Fires one tick immediately (so the webview gets initial state on
 *     resolveWebviewView without waiting for the first interval).
 *   - Schedules a tick every `pollIntervalMs` (clamped to MIN_POLL_MS).
 *   - When `sessionsFsWatcher` is present, also triggers a tick on any
 *     filesystem event (create/change/delete in the sessions/ directory).
 *   - Skips re-emitting state when the new tick produces an identical
 *     shape to the previous tick.
 *
 * Idempotent: calling `dispose()` twice is safe.
 */
export function startWatcher(opts: WatcherOptions): vscode.Disposable {
  const pollMs = Math.max(MIN_POLL_MS, opts.pollIntervalMs);
  const logger = opts.logger ?? { warn: () => {} };

  // Prior-state cache — used for the hash-skip in runTick.
  let priorStateHash: string | null = null;
  let stopped = false;

  /**
   * One tick: read disk, reduce, emit if changed.
   * Catches all errors at the boundary — the loop must never crash.
   */
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const state = await runTick({
        claudeHome: opts.claudeHome,
        globalRosterPath: opts.globalRosterPath,
        projectRosterPath: opts.projectRosterPath,
        logger,
      });
      const hash = hashState(state);
      if (hash === priorStateHash) {
        // Nothing changed — skip the webview update.
        return;
      }
      priorStateHash = hash;
      try {
        opts.onStateChange(state);
      } catch (err) {
        logger.warn(
          `watcherLoop: onStateChange handler threw: ${(err as Error).message}`,
        );
      }
    } catch (err) {
      logger.warn(`watcherLoop: tick failed: ${(err as Error).message}`);
    }
  };

  // Fire-and-forget the initial tick. The setInterval will queue the next.
  void tick();

  const intervalHandle = setInterval(() => {
    void tick();
  }, pollMs);

  // Attach FS-watcher handlers (if provided). Each event simply nudges tick();
  // the regular interval still runs in parallel.
  const fsDisposables: vscode.Disposable[] = [];
  if (opts.sessionsFsWatcher) {
    fsDisposables.push(
      opts.sessionsFsWatcher.onDidCreate(() => void tick()),
      opts.sessionsFsWatcher.onDidChange(() => void tick()),
      opts.sessionsFsWatcher.onDidDelete(() => void tick()),
    );
  }

  return {
    dispose: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(intervalHandle);
      for (const d of fsDisposables) {
        try {
          d.dispose();
        } catch {
          /* ignore — best-effort cleanup */
        }
      }
    },
  };
}

// =============================================================================
// One-shot tick — exported for direct test exercise (no interval / watcher).
// =============================================================================

export interface RunTickOptions {
  claudeHome: string;
  globalRosterPath?: string;
  projectRosterPath?: string;
  logger?: { warn: (msg: string) => void };
}

/**
 * One pass over the filesystem → reducer pipeline.
 *
 * Mirrors `collect()` + `buildAgentTree()` from the CLI driver but returns
 * a `DashboardState` (alias of `AgentTree`) directly. Pure with respect to
 * the supplied filesystem inputs — no caching across calls.
 */
export async function runTick(opts: RunTickOptions): Promise<DashboardState> {
  const logger = opts.logger ?? { warn: () => {} };
  const sessions = listSessions(opts.claudeHome, {
    warn: (m) => logger.warn(m),
  });
  const projectsDir = join(opts.claudeHome, "projects");

  const agentData: SessionAgentData[] = [];
  const activities: ActivityMap = new Map();
  const finishedIds: FinishedSet = new Set();

  for (const session of sessions) {
    const slug = cwdToSlug(session.cwd);
    const sessionDir = join(projectsDir, slug, session.sessionId);
    const subagentsDir = join(sessionDir, "subagents");
    const parentJsonlPath = join(
      projectsDir,
      slug,
      `${session.sessionId}.jsonl`,
    );

    const title = readSessionTitle(parentJsonlPath) ?? "(no title yet)";
    const finishedToolUseIds = readFinishedToolUseIds(parentJsonlPath);

    const agents = collectAgentMetas(subagentsDir);

    for (const agent of agents) {
      if (
        agent.meta?.toolUseId !== undefined &&
        agent.meta?.toolUseId !== null &&
        finishedToolUseIds.has(agent.meta.toolUseId)
      ) {
        finishedIds.add(agent.agentId);
      }
    }

    await Promise.all(
      agents.map(async (agent) => {
        const jsonlPath = join(subagentsDir, `agent-${agent.agentId}.jsonl`);
        try {
          const activity = await readActivity(jsonlPath);
          activities.set(agent.agentId, activity);
        } catch (err) {
          // readActivity rethrows non-ENOENT fs errors. Log + treat as
          // missing — the reducer will route the agent to error/idle.
          logger.warn(
            `watcherLoop: readActivity failed for ${agent.agentId}: ${(err as Error).message}`,
          );
        }
      }),
    );

    agentData.push({ sessionId: session.sessionId, agents, title });
  }

  const rosterResult = loadRoster(
    opts.globalRosterPath,
    opts.projectRosterPath,
  );

  // Surface roster issues through the logger; the reducer doesn't need them.
  for (const w of rosterResult.warnings) {
    logger.warn(`watcherLoop: roster warning: ${w}`);
  }
  for (const e of rosterResult.errors) {
    logger.warn(`watcherLoop: roster error: ${e}`);
  }

  return buildAgentTree(
    sessions,
    agentData,
    activities,
    finishedIds,
    rosterResult.roster,
  );
}

// =============================================================================
// Internals — disk readers (mirrors CLI helpers exactly; kept local to avoid
// importing CLI module from the extension host).
// =============================================================================

/**
 * Compute a stable hash of the state for tick-to-tick change detection.
 *
 * Implementation: JSON.stringify with `rosterTiles` flattened to a sorted
 * key list. `Map<string, AgentTile[]>` does NOT round-trip through
 * JSON.stringify directly (Maps serialize to `{}`), so we serialize the
 * map entries explicitly. Tile order within a team is reducer-controlled
 * (roster declaration order), so no sort needed there.
 *
 * Exported for test coverage.
 */
export function hashState(state: DashboardState): string {
  const sessions = state.sessions.map((s) => ({
    sessionId: s.sessionId,
    pid: s.pid,
    isAlive: s.isAlive,
    title: s.title,
    teamOrder: s.teamOrder,
    rosterTiles: Object.fromEntries(s.rosterTiles),
    background: s.background,
  }));
  return JSON.stringify(sessions);
}

/** Read the `ai-title` record from a parent JSONL. Null on miss/error. */
function readSessionTitle(jsonlPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec["type"] === "ai-title") {
        const title = rec["title"];
        if (typeof title === "string" && title.length > 0) return title;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Scan the parent JSONL for tool_result entries that close a subagent spawn.
 * Returns the set of `tool_use_id` strings observed in closed `tool_result`
 * content entries. Per data-sources.md §3, this is the only reliable
 * "finished" signal; the child JSONL never carries it.
 */
function readFinishedToolUseIds(jsonlPath: string): Set<string> {
  const finished = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return finished;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec["type"] !== "user") continue;
      const msg = rec["message"];
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
      const content = (msg as Record<string, unknown>)["content"];
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>)["type"] === "tool_result"
        ) {
          const tuid = (item as Record<string, unknown>)["tool_use_id"];
          if (typeof tuid === "string") finished.add(tuid);
        }
      }
    } catch {
      continue;
    }
  }
  return finished;
}

/**
 * Read `subagentsDir`, parse each `agent-*.meta.json`, return an entry per
 * file (parse failures land as `meta: null` with `parseError` populated).
 * Defensive — directory missing → empty list, no throw.
 */
function collectAgentMetas(subagentsDir: string): AgentMetaEntry[] {
  const entries: AgentMetaEntry[] = [];
  let files: string[];
  try {
    files = readdirSync(subagentsDir);
  } catch {
    return entries;
  }
  for (const f of files.filter((x) => x.endsWith(".meta.json"))) {
    const agentId = f.replace(/\.meta\.json$/, "").replace(/^agent-/, "");
    const metaPath = join(subagentsDir, f);
    let raw: string;
    try {
      raw = readFileSync(metaPath, "utf8");
    } catch (err) {
      entries.push({
        agentId,
        meta: null,
        parseError: `read error: ${(err as Error).message}`,
      });
      continue;
    }
    try {
      const meta = parseMetaFromString(raw);
      entries.push({ agentId, meta });
    } catch (err) {
      entries.push({
        agentId,
        meta: null,
        parseError: (err as Error).message,
      });
    }
  }
  return entries;
}
