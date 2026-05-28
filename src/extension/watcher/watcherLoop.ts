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
import { formatMetaParseError, parseMetaFromString } from "./metaJsonLoader.js";
import { MetaParseError } from "../../shared/types.js";
import {
  filterSessionsToWindow,
  isFilterApplied,
  type WindowFolder,
} from "./sessionFilter.js";
import { loadRoster } from "../roster/loader.js";
import { buildAgentTree } from "../state/reducer.js";
import { applyHideFinishedFilter } from "../state/hideFinishedFilter.js";
import { applyHideIdleFilter } from "../state/hideIdleFilter.js";
import type {
  ActivityMap,
  AgentMetaEntry,
  FinishedMap,
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

  /**
   * Optional resolver for the current VS Code window's workspace folders
   * (M3-03). Read fresh every tick so workspace add/remove events are
   * picked up without restarting the watcher. When omitted or returning
   * undefined/empty, the window-filter falls through to passthrough
   * behavior (don't strand the user).
   */
  getWorkspaceFolders?: () => readonly WindowFolder[] | undefined;

  /**
   * Optional resolver for the `claudeteam.showAllSessionsGlobally` setting
   * (M3-03 AC4/AC5). Read fresh every tick so config changes apply on the
   * next tick without restart. When omitted, treated as `false` (filter ON).
   */
  getShowAllSessionsGlobally?: () => boolean;

  /**
   * Optional resolver for the `claudeteam.collapsePersonaTiles` setting
   * (M3-10 AC5). Read fresh every tick so toggling the setting applies on
   * the next tick without restart. When omitted, treated as `true`
   * (grouping ON — same default as the package.json config schema).
   */
  getCollapsePersonaTiles?: () => boolean;

  /**
   * Optional resolver for the `claudeteam.hideFinishedAgents` setting (M5).
   * Read fresh every tick so toggling the setting applies on the next tick
   * without restart. When omitted, treated as `false` (filter OFF — same
   * default as the package.json config schema).
   */
  getHideFinishedAgents?: () => boolean;

  /**
   * Optional resolver for the `claudeteam.autoCollapseUniformClusters`
   * setting (86c9zmqa8). Read fresh every tick so toggling applies on the
   * next tick without restart. When omitted, treated as `true` (uniform-
   * cluster polish ON — same default as the package.json config schema).
   */
  getAutoCollapseUniformClusters?: () => boolean;

  /**
   * Optional resolver for the `claudeteam.hideIdleAgents` setting
   * (86c9zq9vm / 86ca10anf — running-focused dashboard spec 86c9zmyef).
   * Read fresh every tick so toggling the setting applies on the next tick
   * without restart. When omitted, treated as `false` (filter OFF — V1 ships
   * the whole team always-visible; matches the package.json config schema
   * default).
   */
  getHideIdleAgents?: () => boolean;

  /** Optional logger; defaults to a no-op so silent in production. */
  logger?: { warn: (msg: string) => void };

  /**
   * Optional per-tick completion hook (86c9zn7vw — diagnostic Output channel).
   * Called at the end of every tick AFTER the optional `onStateChange` emit
   * (or after the hash-skip suppression). The hook receives the tick number
   * (sequential, starting at 1), the wall-clock duration in ms, whether the
   * tick actually emitted to the webview, and the produced state (so the
   * diagnostic dispatcher can compute per-agent transitions).
   *
   * Errors thrown from this hook are caught and surfaced via `logger.warn` —
   * a failing diagnostic must NEVER take down the watcher loop.
   *
   * When omitted, the watcher behaves as before — no tick numbering, no
   * duration measurement, no diagnostic hook firing.
   */
  onTickComplete?: (info: {
    tickNumber: number;
    durationMs: number;
    emitted: boolean;
    state: DashboardState;
  }) => void;
}

/** Floor on the poll interval. Anything below this is clamped. */
export const MIN_POLL_MS = 250;

/**
 * Extended disposable returned by `startWatcher` (M2-06 AC5).
 *
 * In addition to standard `dispose()`, exposes:
 *   - `triggerTick()` — fire an immediate out-of-band tick. Hash-skip is
 *     respected (no emission if the state is identical to the prior tick).
 *     Used by FS-watcher event handlers and config-change listeners — the
 *     content may not actually have changed, so hash-skip is the correct
 *     guard.
 *   - `forceRefresh()` (86c9z5hyp) — fire an immediate tick that BYPASSES
 *     hash-skip by clearing `priorStateHash` first. The next tick is
 *     guaranteed to call `onStateChange` regardless of hash equality.
 *     Used by the webview's `ui:refresh` handler to fix the boot-race:
 *     `startWatcher` fires tick-0 BEFORE the webview's IIFE wires
 *     `addEventListener("message", ...)`, so tick-0's `state:full` is
 *     silently dropped — but it sets `priorStateHash`, causing the
 *     subsequent `ui:refresh`-driven tick to hash-skip and the webview to
 *     never receive any state. `forceRefresh` is the explicit "the prior
 *     emission may not have reached anyone — re-send regardless" signal.
 *   - `getLastState()` — the most recently emitted `DashboardState`, or
 *     `null` before the first tick completes. Host uses this to derive
 *     paths from `sessionId` for `ui:open-transcript` without re-reading
 *     disk.
 */
export interface WatcherHandle extends vscode.Disposable {
  /** Fire an immediate tick (hash-skip is respected). */
  triggerTick(): void;
  /**
   * Fire an immediate tick that bypasses hash-skip — the next tick WILL
   * call `onStateChange` even when the state is identical to the prior
   * emission. Used by `ui:refresh` to defeat the boot-time hash-skip race
   * (see 86c9z5hyp / Bram's round-2 triage `86c9z5a3k`).
   */
  forceRefresh(): void;
  /** Most recently emitted state; null before the first emission. */
  getLastState(): DashboardState | null;
}

/**
 * Start the polling watcher loop. Returns a {@link WatcherHandle} that
 * stops the loop and exposes the extras documented on the interface.
 *
 * Behavior:
 *   - Fires one tick immediately (so the webview gets initial state on
 *     resolveWebviewView without waiting for the first interval).
 *   - Schedules a tick every `pollIntervalMs` (clamped to MIN_POLL_MS).
 *   - When `sessionsFsWatcher` is present, also triggers a tick on any
 *     filesystem event (create/change/delete in the sessions/ directory).
 *   - Skips re-emitting state when the new tick produces an identical
 *     shape to the previous tick.
 *   - `triggerTick()` invocations bypass the regular interval but still
 *     respect the hash-skip (no-op emission on unchanged state).
 *
 * Idempotent: calling `dispose()` twice is safe.
 */
export function startWatcher(opts: WatcherOptions): WatcherHandle {
  const pollMs = Math.max(MIN_POLL_MS, opts.pollIntervalMs);
  const logger = opts.logger ?? { warn: () => {} };

  // Prior-state cache — used for the hash-skip in runTick AND surfaced via
  // getLastState() for the host's `ui:open-transcript` slug derivation.
  let priorStateHash: string | null = null;
  let lastState: DashboardState | null = null;
  let stopped = false;
  // 86c9zn7vw: sequential tick counter for the diagnostic Output channel.
  // Increments before each tick attempt so the number in the log matches
  // a real attempt (even ticks that throw produce an `error` log line
  // tagged with that number).
  let tickNumber = 0;

  /**
   * One tick: read disk, reduce, emit if changed.
   * Catches all errors at the boundary — the loop must never crash.
   */
  const tick = async (): Promise<void> => {
    if (stopped) return;
    tickNumber += 1;
    const tickStart = Date.now();
    let emitted = false;
    let stateForHook: DashboardState | null = null;
    try {
      const state = await runTick({
        claudeHome: opts.claudeHome,
        globalRosterPath: opts.globalRosterPath,
        projectRosterPath: opts.projectRosterPath,
        // M3-03: read both resolvers fresh every tick so the user's
        // config toggle / workspace-folder changes apply on the next
        // emission without restarting the watcher.
        workspaceFolders: opts.getWorkspaceFolders?.(),
        showAllSessionsGlobally: opts.getShowAllSessionsGlobally?.() ?? false,
        // M3-10 AC5: same read-fresh-every-tick pattern for the
        // collapse-persona-tiles toggle. Default true (grouping ON)
        // matches package.json config default.
        collapsePersonaTiles: opts.getCollapsePersonaTiles?.() ?? true,
        // M5: read-fresh-every-tick pattern for the hide-finished toggle.
        // Default false (filter OFF) matches package.json config default.
        hideFinishedAgents: opts.getHideFinishedAgents?.() ?? false,
        // 86c9zmqa8: read-fresh-every-tick pattern for the uniform-cluster
        // polish toggle. Default true (auto-collapse ON) matches package.json
        // config default. The flag is webview-only behavior (no host code
        // path changes); it's stamped onto the produced tree so the webview
        // can read it from state.config.
        autoCollapseUniformClusters:
          opts.getAutoCollapseUniformClusters?.() ?? true,
        // 86c9zq9vm / 86ca10anf (spec 86c9zmyef): read-fresh-every-tick
        // pattern for the hide-idle toggle. Default false (filter OFF)
        // matches package.json — V1 ships the whole team always-visible.
        hideIdleAgents: opts.getHideIdleAgents?.() ?? false,
        logger,
      });
      // Always update lastState — even on hash-skip — so host lookups against
      // the most recent reduction see fresh `cwd` values for `ui:open-transcript`.
      lastState = state;
      stateForHook = state;
      const hash = hashState(state);
      if (hash !== priorStateHash) {
        priorStateHash = hash;
        try {
          opts.onStateChange(state);
          emitted = true;
        } catch (err) {
          logger.warn(
            `watcherLoop: onStateChange handler threw: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      logger.warn(`watcherLoop: tick failed: ${(err as Error).message}`);
    }
    // 86c9zn7vw: fire the diagnostic hook AFTER the emit decision. Use
    // `stateForHook` (the state produced this tick) when available, else
    // the prior `lastState` (when runTick threw before assigning), else
    // an empty placeholder so the hook signature stays stable. The hook
    // itself is gated by the diagnostic-verbose config — when the setting
    // is false the hook is a no-op fast path. Errors caught at the
    // boundary so a broken diagnostic CANNOT take down the watcher loop.
    if (opts.onTickComplete) {
      // Partial fallback: only `sessions[]` is consumed by the diagnostic hook
      // (recordTick walks rostered tiles + collapsed-group instances), so
      // omitting filterApplied / rosterErrors / rosterWarnings /
      // hiddenFinishedCount / config is intentional. A future maintainer
      // extending the tick line (e.g. roster-error column) must broaden this
      // empty-state shape before reading those fields.
      const hookState =
        stateForHook ?? lastState ?? { sessions: [] };
      try {
        opts.onTickComplete({
          tickNumber,
          durationMs: Date.now() - tickStart,
          emitted,
          state: hookState,
        });
      } catch (err) {
        logger.warn(
          `watcherLoop: onTickComplete handler threw: ${(err as Error).message}`,
        );
      }
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
    triggerTick: () => {
      void tick();
    },
    forceRefresh: () => {
      // 86c9z5hyp: clear the hash BEFORE firing the tick so the new tick's
      // hash comparison at `if (hash === priorStateHash)` ALWAYS misses
      // (null !== string), guaranteeing `onStateChange` is invoked. Used by
      // `ui:refresh` to defeat the webview boot race where tick-0's
      // `state:full` is dropped (no listener yet) but its hash still primes
      // the skip-cache.
      priorStateHash = null;
      void tick();
    },
    getLastState: () => lastState,
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
  /**
   * Current VS Code window's workspace folders (M3-03). When omitted /
   * empty, the window-filter falls through to passthrough behavior.
   */
  workspaceFolders?: readonly WindowFolder[] | undefined;
  /**
   * Value of `claudeteam.showAllSessionsGlobally` (M3-03). Defaults to
   * `false` (filter ON). When `true`, the filter is a passthrough — all
   * sessions on the machine are visible.
   */
  showAllSessionsGlobally?: boolean;
  /**
   * Value of `claudeteam.collapsePersonaTiles` (M3-10 AC5). Defaults to
   * `true` (grouping ON). When `false`, the reducer emits every tile bare
   * (no CollapsedPersonaGroup wrappers) — same shape as pre-M3-10.
   */
  collapsePersonaTiles?: boolean;
  /**
   * Value of `claudeteam.hideFinishedAgents` (M5). Defaults to `false`
   * (filter OFF — every finished tile remains visible). When `true`, the
   * post-reducer filter suppresses finished tiles and `hiddenFinishedCount`
   * is stamped onto the produced tree.
   */
  hideFinishedAgents?: boolean;
  /**
   * Value of `claudeteam.autoCollapseUniformClusters` (86c9zmqa8). Defaults
   * to `true`. Webview-only behavior — does NOT change the host reducer or
   * filter output; merely stamped onto the produced tree's `config` block so
   * the webview's collapsedPersonaTile renderer can read it from state.
   */
  autoCollapseUniformClusters?: boolean;
  /**
   * Value of `claudeteam.hideIdleAgents` (86c9zq9vm — spec 86c9zmyef).
   * Defaults to `true` (filter ON — V1 default per sponsor Q1; matches
   * package.json config default). When `true`, the post-reducer filter
   * suppresses idle tiles and `hiddenIdleCount` is stamped onto the
   * produced tree.
   */
  hideIdleAgents?: boolean;
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
  const rawSessions = listSessions(opts.claudeHome, {
    warn: (m) => logger.warn(m),
  });

  // M3-03 AC3: window-scoped session filtering runs BEFORE roster matching
  // (matcher's input set is scoped to the current window). Pure filter — see
  // sessionFilter.ts for the don't-strand-the-user semantics when no folder
  // is open or showAll is true.
  const showAll = opts.showAllSessionsGlobally === true;
  const sessions = filterSessionsToWindow(
    rawSessions,
    opts.workspaceFolders,
    showAll,
  );
  const filterApplied = isFilterApplied(
    rawSessions.length,
    sessions.length,
    opts.workspaceFolders,
    showAll,
  );

  const projectsDir = join(opts.claudeHome, "projects");

  const agentData: SessionAgentData[] = [];
  const activities: ActivityMap = new Map();
  const finishedIds: FinishedMap = new Map();

  for (const session of sessions) {
    const slug = cwdToSlug(session.cwd);
    const sessionDir = join(projectsDir, slug, session.sessionId);
    const subagentsDir = join(sessionDir, "subagents");
    const parentJsonlPath = join(
      projectsDir,
      slug,
      `${session.sessionId}.jsonl`,
    );

    // 86c9zfmke: single-pass parent JSONL scan. Previously two independent
    // readFileSync passes (readSessionTitle + readFinishedToolUseIds) on
    // the same multi-MB file. On the live ClaudeTeam orchestrator session
    // the parent JSONL is 5.2MB and the second redundant readFileSync +
    // line-split + JSON.parse measured 15–39ms per tick (warm cache —
    // Bram triage `team/bram-research/86c9yteju-triage-2026-05-26.md`
    // § Segment 3). readSessionMetadata fuses both extractions into one
    // pass — same defensive error-swallowing behavior, same return
    // contracts.
    const {
      title: rawTitle,
      finishedIds: finishedToolUseIds,
      customTitle,
      gitBranch,
    } = readSessionMetadata(parentJsonlPath);
    const title = rawTitle ?? "(no title yet)";

    const agents = collectAgentMetas(subagentsDir);

    for (const agent of agents) {
      if (
        agent.meta?.toolUseId !== undefined &&
        agent.meta?.toolUseId !== null
      ) {
        const finishedAtMs = finishedToolUseIds.get(agent.meta.toolUseId);
        if (finishedAtMs !== undefined) {
          finishedIds.set(agent.agentId, finishedAtMs);
        }
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

    agentData.push({
      sessionId: session.sessionId,
      agents,
      title,
      // 86ca03nww: spread-only-when-defined keeps the SessionAgentData entry
      // (and the resulting SessionTree) back-compat when the parser found
      // no customTitle / gitBranch on disk.
      ...(customTitle !== undefined ? { customTitle } : {}),
      ...(gitBranch !== undefined ? { gitBranch } : {}),
    });
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

  const tree = buildAgentTree(
    sessions,
    agentData,
    activities,
    finishedIds,
    rosterResult.roster,
    Date.now(),
    {
      // M3-10 AC5: default true (grouping ON) when omitted by the caller.
      collapsePersonaTiles: opts.collapsePersonaTiles !== false,
    },
  );
  // M5: post-reducer hide-finished projection. The filter is OFF by default
  // (identity transform — returns the input ref + count 0); when ON, allocates
  // a new tree with finished tiles suppressed and stamps `hiddenFinishedCount`
  // for the chip. Reducer stays presentation-agnostic; this layer owns the
  // filter the same way it owns filterApplied / roster errors. See
  // `src/extension/state/hideFinishedFilter.ts` for the contract.
  const hideFinished = opts.hideFinishedAgents === true;
  const { tree: afterFinished, hiddenFinishedCount } = applyHideFinishedFilter(
    tree,
    hideFinished,
  );
  // 86c9zq9vm / 86ca10anf (spec 86c9zmyef §3 + §9.1): sibling hide-idle
  // projection, applied AFTER hide-finished on its result. `finished` and
  // `idle` are disjoint states so the order is symmetric, but a deterministic
  // sequence (finished → idle) avoids surprise. Default false (V1 ships the
  // whole team always-visible) — matches the `hideFinished === true` default
  // above so absent/undefined → filter OFF (no split-brain with the wire
  // serializer's `=== true` default).
  const hideIdle = opts.hideIdleAgents === true;
  const { tree: filteredTree, hiddenIdleCount } = applyHideIdleFilter(
    afterFinished,
    hideIdle,
  );
  // 86c9zmqa8: webview-only uniform-cluster auto-collapse. Default true when
  // omitted to match the package.json schema default. Stamped onto the
  // produced tree's config block; consumed entirely webview-side.
  const autoCollapseUniformClusters = opts.autoCollapseUniformClusters !== false;

  // M3-03 AC7: stamp the window-filter flag on the produced tree. Reducer
  // is workspace-agnostic — it doesn't know about the filter, just the
  // input set — so the watcher layer owns the flag.
  // M3-04 AC5: stamp the roster errors / warnings on the produced tree so
  // the webview can render the error chip + warning subtype. Verbatim from
  // RosterLoadResult; reducer is roster-error-agnostic, so the watcher
  // layer owns this surfacing too (parallel to filterApplied).
  // M5: stamp hiddenFinishedCount (post-filter count) AND the effective
  // config block so `serializeState` can pass both through to the wire
  // (per spec §3.5 wire-shape contract).
  return {
    ...filteredTree,
    filterApplied,
    rosterErrors: rosterResult.errors,
    rosterWarnings: rosterResult.warnings,
    hiddenFinishedCount,
    // 86c9zq9vm: hide-idle wire surface. Mirrors hiddenFinishedCount + the
    // config-block scalar so the webview can render the "N idle hidden" chip
    // and boot its filter toggle from authoritative state without re-reading
    // VS Code Settings.
    hiddenIdleCount,
    config: {
      hideFinishedAgents: hideFinished,
      // 86c9zmqa8: pass-through scalar; webview-only behavior.
      autoCollapseUniformClusters,
      // 86c9zq9vm: pass-through scalar; webview chip reads to set its initial
      // toggle state without a roundtrip.
      hideIdleAgents: hideIdle,
    },
  };
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
    // 86ca03nww: include the new label-surface fields so a sponsor rename
    // (customTitle change) or branch switch (gitBranch change) triggers a
    // fresh state emission even when no tile changed. Missing → null on
    // the hash so a transition from undefined → "main" is observable.
    customTitle: s.customTitle ?? null,
    gitBranch: s.gitBranch ?? null,
    teamOrder: s.teamOrder,
    rosterTiles: Object.fromEntries(s.rosterTiles),
    background: s.background,
  }));
  // M3-03: include filterApplied in the hash so toggling the global setting
  // (or opening/closing a workspace folder) re-emits state even when the
  // visible session set is unchanged. Webview empty-state messaging depends
  // on this flag, so a state change must propagate.
  // M3-04: include rosterErrors / rosterWarnings — when the user fixes (or
  // breaks) a YAML and the visible tile set is unchanged, the chip must
  // appear/disappear within one tick. Excluding from the hash would skip
  // the emission.
  // M5: include hiddenFinishedCount and the config mirror — when the user
  // toggles `claudeteam.hideFinishedAgents`, the visible tile set changes
  // (or the count chip changes from "0 hidden" to "N hidden"). Excluding
  // these from the hash would skip the emission and the chip would lag.
  return JSON.stringify({
    sessions,
    filterApplied: state.filterApplied === true,
    rosterErrors: state.rosterErrors ?? [],
    rosterWarnings: state.rosterWarnings ?? [],
    hiddenFinishedCount: state.hiddenFinishedCount ?? 0,
    hideFinishedAgents: state.config?.hideFinishedAgents === true,
    // 86c9zmqa8: include the uniform-cluster auto-collapse flag so toggling
    // the VS Code setting re-emits state even when the visible tile set is
    // unchanged. The webview-side render branches off this flag, so missing
    // emissions would leave the dashboard stale.
    autoCollapseUniformClusters:
      state.config?.autoCollapseUniformClusters !== false,
    // 86c9zq9vm: same rationale — when the user toggles hideIdleAgents and
    // the visible tile set happens to be unchanged (e.g. no idle tiles to
    // suppress at the moment), the chip's label / count still needs to
    // update. Including the count + config mirror in the hash ensures
    // emission.
    hiddenIdleCount: state.hiddenIdleCount ?? 0,
    hideIdleAgents: state.config?.hideIdleAgents === true,
  });
}

/**
 * Single-pass parent-JSONL scan that extracts BOTH the session title
 * (`ai-title` record) and the finished `tool_use_id` → `finishedAtMs` map
 * in one `readFileSync` + one line iteration. Replaces the prior pair of
 * independent passes (`readSessionTitle` + `readFinishedToolUseIds`),
 * both of which previously re-read the entire parent JSONL.
 *
 * 86c9zfmke: parent JSONL is multi-MB on long-running orchestrator
 * sessions (5.2MB measured on the live ClaudeTeam session — see
 * `team/bram-research/86c9yteju-triage-2026-05-26.md` § Segment 3).
 * Halving the disk read + JSON.parse work eliminates ~28–39ms of warm-cache
 * tick I/O per live session on the dominant sub-segment.
 *
 * ## Title extraction (formerly `readSessionTitle`)
 *
 * Returns the first non-empty `title` field on a record with
 * `type: "ai-title"`. `null` on miss, malformed, or read error.
 *
 * ## Finished-ids extraction (formerly `readFinishedToolUseIds`)
 *
 * Returns a map of `tool_use_id` → `finishedAtMs` (epoch ms parsed from
 * the record's top-level `timestamp` ISO-8601 field). Per data-sources.md
 * §3, this is the only reliable "finished" signal; the child JSONL never
 * carries it.
 *
 * 86c9yxv94: timestamp flows through `FinishedMap` to `buildActivity` for
 * the `"finished Xs"` elapsed-time suffix. When a record's timestamp is
 * missing or unparseable, the value is `0` — the reducer treats 0 as
 * "no timestamp" and falls back to bare `"finished"`.
 *
 * Obs 9 fix (86c9zc5dd): when an Agent tool_use is dispatched with
 * `run_in_background: true`, Claude Code writes an IMMEDIATE tool_result
 * at spawn time ("Async agent launched successfully...") with the
 * spawning toolUseId. The record carries top-level `toolUseResult.isAsync:
 * true` + `toolUseResult.status: "async_launched"`. We MUST skip these
 * records — they're dispatch acks, not completion signals. For background
 * agents the actual completion is delivered out-of-band (notification
 * to the orchestrator); the parent JSONL never receives a second
 * tool_result for the same toolUseId. Verified against parent JSONL
 * `baf09ef7-...` Bram Round-3 dispatch (toolUseId
 * `toolu_01MMAeiEPr44os17jq9mJ8UY`): exactly two occurrences — the
 * tool_use itself and one async-launched tool_result — no completion
 * record.
 *
 * Foreground (`Agent` without `run_in_background:true`) tool_results
 * do NOT carry a `toolUseResult.isAsync` field; they're real completions
 * and remain in the finished map.
 *
 * ## Custom-title extraction (86ca03nww)
 *
 * Returns the LAST non-empty `customTitle` field on a record with
 * `type: "custom-title"` — sponsor-authored renames append a new record each
 * time, and Claude Code itself uses the most-recent value (extension.js
 * `renameSession` writes `{type,sessionId,customTitle}` then updates the
 * in-memory map, and the parser reads the final value). Functionally
 * equivalent to "scan backward from EOF, first match wins" (NIT 1 from PR #104
 * review) — implemented as last-write-wins to avoid reversing a multi-MB
 * array. Whitespace-only values normalize to undefined so the resolver's
 * priority chain falls through.
 *
 * Key-order tolerance (NIT 2 from PR #104 review): records on disk appear
 * in BOTH `{type,sessionId,customTitle}` and `{type,customTitle,sessionId}`
 * orderings within the same file (verified on session
 * `07e66f5e-7263-4a6d-853b-e66747a38f3a.jsonl`). The parser uses `JSON.parse`
 * + named-field access — NEVER regex on key sequence.
 *
 * ## Git-branch extraction (86ca03nww)
 *
 * Returns the LAST `gitBranch` value found across `attachment`, `user`,
 * `assistant`, `system` records (top-level field — broader than Bram's
 * original `attachment`-only framing per Felix PR #104 NIT 4, verified
 * against ClaudeTeam session 07e66f5e: 620 records carrying the field across
 * the four types). Last-write-wins matches Claude Code's own behavior
 * (extension.js `ba` function: `Y7(K,"gitBranch")||VW(x,"gitBranch")||void 0`
 * reads the most recent occurrence in the JSONL tail).
 *
 * ## Defensive contracts (preserved)
 *
 * - Read error (missing/unreadable file) → `{ title: null, finishedIds:
 *   empty, customTitle: undefined, gitBranch: undefined }`.
 * - JSON.parse failure on a single line → skip that line, keep going.
 * - First valid `ai-title` wins; do NOT short-circuit the scan when found —
 *   we still need the rest of the file for the finished-ids map, customTitle
 *   updates, and gitBranch updates.
 */
function readSessionMetadata(jsonlPath: string): {
  title: string | null;
  finishedIds: Map<string, number>;
  customTitle: string | undefined;
  gitBranch: string | undefined;
} {
  const finishedIds = new Map<string, number>();
  let title: string | null = null;
  let customTitle: string | undefined = undefined;
  let gitBranch: string | undefined = undefined;
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return { title: null, finishedIds, customTitle: undefined, gitBranch: undefined };
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const recType = rec["type"];

    // 86ca03nww: gitBranch is a top-level field on `attachment`, `user`,
    // `assistant`, `system` records (NIT 4 from PR #104 review). Last-write
    // -wins. Check before the type-specific branches because user records
    // also flow into the finished-ids branch below — we want both extractions
    // to coexist on the same record without one short-circuiting the other.
    const gb = rec["gitBranch"];
    if (typeof gb === "string") {
      const trimmed = gb.trim();
      if (trimmed.length > 0) gitBranch = trimmed;
    }

    // Title branch — `type: "ai-title"`. Keep scanning the rest of the
    // file even after a title is found because finished-ids may still
    // appear in later records.
    if (recType === "ai-title" && title === null) {
      const t = rec["title"];
      if (typeof t === "string" && t.length > 0) title = t;
      continue;
    }

    // Custom-title branch — `type: "custom-title"`. Last-write-wins
    // (equivalent to scan-backward-from-EOF-first-match per NIT 1).
    // JSON.parse + named-field access handles BOTH key orders seen on disk
    // (`{type,sessionId,customTitle}` and `{type,customTitle,sessionId}`)
    // per NIT 2.
    if (recType === "custom-title") {
      const ct = rec["customTitle"];
      if (typeof ct === "string") {
        const trimmed = ct.trim();
        if (trimmed.length > 0) customTitle = trimmed;
      }
      continue;
    }

    // Finished-ids branch — `type: "user"` with a `tool_result` content
    // entry. Discriminator (Obs 9): skip records whose top-level
    // `toolUseResult.isAsync === true` (background-dispatch ack).
    if (recType !== "user") continue;
    const tur = rec["toolUseResult"];
    if (
      tur !== null &&
      typeof tur === "object" &&
      !Array.isArray(tur) &&
      (tur as Record<string, unknown>)["isAsync"] === true
    ) {
      continue;
    }
    const msg = rec["message"];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const content = (msg as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) continue;
    const ts = rec["timestamp"];
    const finishedAtMs =
      typeof ts === "string" && Number.isFinite(Date.parse(ts))
        ? Date.parse(ts)
        : 0;
    for (const item of content) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>)["type"] === "tool_result"
      ) {
        const tuid = (item as Record<string, unknown>)["tool_use_id"];
        if (typeof tuid === "string" && !finishedIds.has(tuid)) {
          // First occurrence wins — that's the actual finish time.
          finishedIds.set(tuid, finishedAtMs);
        }
      }
    }
  }
  return { title, finishedIds, customTitle, gitBranch };
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
      // NIT #2 (M3-04 follow-up): route MetaParseError through the human
      // formatter so dashboards show `meta.json parse failed: missing field
      // 'agentType'` instead of the raw `err.message` (terse) or hybrid-case
      // reason enum (e.g. `missing-agentType`). Non-MetaParseError throws
      // (shouldn't happen — parseMetaFromString wraps JSON.parse) still fall
      // through to `err.message` so unexpected errors aren't masked.
      const parseError =
        err instanceof MetaParseError
          ? formatMetaParseError(err)
          : (err as Error).message;
      entries.push({ agentId, meta: null, parseError });
    }
  }
  return entries;
}
