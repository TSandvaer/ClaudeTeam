/**
 * State reducer — pure function that composes session registry, agent meta,
 * JSONL activity, and roster data into an AgentTree.
 *
 * No filesystem reads inside this function. Callers supply all inputs.
 * Source contracts:
 *   - data-sources.md §"Liveness inference" — idle threshold (10s)
 *   - iris-ux/m1-cli-output-spec.md §1.4 — activity field format
 *   - iris-ux/m1-cli-output-spec.md §1.5 — parent→child tree
 *   - iris-ux/m1-cli-output-spec.md §2.5 — error state conditions
 *   - data-sources.md §3 JSONL closing semantics — finished detected from
 *     parent transcript tool_result, NOT from child JSONL content
 *   - roster-matching.md — first-match-wins, background bucket
 *
 * AC1 of M1-09 (ClickUp 86c9y5chc): exports `buildAgentTree`.
 */

import { matchAgent } from "../roster/matcher.js";
import type {
  AgentMeta,
  AgentState,
  AgentTile,
  AgentTree,
  BackgroundAgent,
  CollapsedPersonaGroup,
  RosterTileEntry,
  SessionRecord,
  SessionTree,
  SubagentActivity,
  Team,
} from "../../shared/types.js";

/** Subagent metadata including the agent id (path-derived) and the meta. */
export interface AgentMetaEntry {
  /** Agent id (e.g. "a735226d3ddaa543b"). */
  agentId: string;
  /** Parsed meta.json. Null when parsing failed — agent goes to error state. */
  meta: AgentMeta | null;
  /** Short error reason when meta is null. */
  parseError?: string;
}

/**
 * Activity snapshot keyed by agentId. Includes the mtime so the reducer can
 * infer idle vs running without knowing the current time explicitly (caller
 * supplies `nowMs`).
 */
export type ActivityMap = Map<string, SubagentActivity>;

/**
 * Finished-agent map: agentId → finishedAtMs (epoch ms parsed from the
 * parent JSONL `tool_result` record's top-level `timestamp` field). Determined
 * by the CLI reader (or file-watcher in M2) by scanning the parent JSONL.
 *
 * Per Bram's M1-02 finding (data-sources.md §3 "JSONL closing semantics"):
 * the parent JSONL's `tool_result` with `tool_use_id == meta.toolUseId` is
 * the ONLY reliable "finished" signal; the child JSONL never carries it.
 *
 * The map shape replaced the prior `FinishedSet = Set<string>` (ticket
 * 86c9yxv94) to carry the finish timestamp through to `buildActivity` so
 * "finished Xs" elapsed-time suffix can be rendered. Membership semantics
 * are preserved via `.has(agentId)` — the value is the timestamp, not a
 * sentinel. A timestamp of `0` is acceptable (e.g. unparseable JSONL
 * timestamp); `buildActivity` falls back to bare `"finished"` when the
 * timestamp is 0 OR omitted.
 */
export type FinishedMap = Map<string, number>; // agentId → finishedAtMs

/**
 * Per-session subagent inputs. One entry per live SessionRecord.
 */
export interface SessionAgentData {
  sessionId: string;
  /** All agents for this session (including parse-failed ones). */
  agents: AgentMetaEntry[];
  /** Optional human-readable session title from the `ai-title` JSONL record. */
  title?: string;
}

/**
 * Optional behavior knobs passed through `buildAgentTree`.
 *
 * Kept as a single options object so we can add future toggles without
 * pushing more positional parameters down the call chain. All fields are
 * optional with documented defaults — callers that don't care omit the
 * object entirely.
 */
export interface BuildAgentTreeOptions {
  /**
   * M3-10 AC5: when `true` (default), N>1 rostered tiles that share the
   * same matched-roster persona are collapsed into a single
   * `CollapsedPersonaGroup` wrapper. When `false`, every tile is emitted
   * bare (no wrapper) — output is identical to pre-M3-10 behavior.
   *
   * Bound to the VS Code config `claudeteam.collapsePersonaTiles`. Read
   * fresh by the watcher every tick (M3-03 pattern) so toggling the
   * setting applies on the next tick without a watcher restart.
   */
  collapsePersonaTiles?: boolean;
}

/**
 * Build the full AgentTree from snapshot inputs.
 *
 * Pure function — no side effects. Every output is derived solely from args.
 *
 * @param sessions   All sessions from the session registry (listSessions).
 * @param agentData  Per-session subagent metadata (one entry per session).
 * @param activities Activity snapshot for each agent (agentId → SubagentActivity).
 * @param finishedIds Map of agentIds known to have finished (parent JSONL signal)
 *                    → epoch ms of the parent `tool_result` record's
 *                    `timestamp` field. Use `.has(agentId)` for membership;
 *                    the value flows into `buildActivity` for elapsed-time.
 * @param roster     Merged roster from the roster loader.
 * @param nowMs      Current epoch ms — injected for testability. Defaults to
 *                   Date.now() when not supplied (production CLI).
 * @param options    Behavior knobs (see {@link BuildAgentTreeOptions}).
 */
export function buildAgentTree(
  sessions: SessionRecord[],
  agentData: SessionAgentData[],
  activities: ActivityMap,
  finishedIds: FinishedMap,
  roster: Team[],
  nowMs: number = Date.now(),
  options: BuildAgentTreeOptions = {},
): AgentTree {
  // Default: grouping ON. Matches VS Code config default (true) and gives
  // back-compat callers (CLI driver, older tests with no options arg) the
  // M3-10 collapse behavior by default.
  const collapsePersonaTiles = options.collapsePersonaTiles !== false;
  const agentDataBySession = new Map<string, SessionAgentData>(
    agentData.map((d) => [d.sessionId, d]),
  );

  const sessionTrees: SessionTree[] = sessions.map((session) => {
    const data = agentDataBySession.get(session.sessionId);
    const agents = data?.agents ?? [];
    const title = data?.title ?? "(no title yet)";

    // Build tile + background lists.
    const rosterTiles = new Map<string, AgentTile[]>();
    const teamOrder: string[] = [];
    const background: BackgroundAgent[] = [];

    for (const agentEntry of agents) {
      const { agentId, meta, parseError } = agentEntry;
      const activity = activities.get(agentId);

      // --- Parse-error agents go to error tile if we can still match them,
      // otherwise they go to background with agentType "(parse error)".
      if (meta === null) {
        // No meta to match against — can't determine team. Put in background
        // with a synthetic agentType to surface the error.
        //
        // NIT #1 (M3-04 follow-up): when the JSONL is readable (activity
        // present + activity.model resolved), surface the JSONL-derived model
        // even though meta.json is unparseable. Falls back to a clearer
        // placeholder than bare `?` when no JSONL model is available, so a
        // dashboard reader can distinguish "model unknown because meta.json is
        // invalid" from "model unresolved because no assistant message yet".
        background.push({
          agentType: "(parse error)",
          description: parseError ?? "meta.json parse failed",
          state: "error",
          model: resolveModelOnParseError(activity),
        });
        continue;
      }

      const matchResult = matchAgent(meta, roster);
      const state = inferState(session, activity, finishedIds, agentId, nowMs);
      const model = resolveModel(activity);
      // Pass finishedAtMs so buildActivity can render "finished Xs" elapsed
      // time. .get() returns undefined when the agent isn't finished — the
      // signature accepts undefined and falls back to bare "finished".
      const finishedAtMs = finishedIds.get(agentId);
      const activityStr = buildActivity(state, activity, nowMs, finishedAtMs);

      if (matchResult === null) {
        // Background agent.
        background.push({
          agentType: meta.agentType,
          description: meta.description,
          state,
          model,
        });
        continue;
      }

      // Rostered tile.
      const { teamId, memberId } = matchResult;

      // Find the team + member from the roster.
      const team = roster.find((t) => t.id === teamId);
      const member = team?.members.find((m) => m.id === memberId);
      if (!team || !member) {
        // Defensive: matchAgent returned a team/member that isn't in roster.
        // Treat as background.
        background.push({
          agentType: meta.agentType,
          description: meta.description,
          state,
          model,
        });
        continue;
      }

      const tile: AgentTile = {
        memberId,
        teamId,
        display: member.display,
        role: member.role,
        activity: activityStr,
        model,
        state,
        agentId,
        toolUseId: meta.toolUseId,
      };

      if (!rosterTiles.has(teamId)) {
        rosterTiles.set(teamId, []);
        teamOrder.push(teamId);
      }
      rosterTiles.get(teamId)!.push(tile);
    }

    // Sort tiles within each team in roster member-declaration order.
    for (const [teamId, tiles] of rosterTiles) {
      const team = roster.find((t) => t.id === teamId);
      if (!team) continue;
      const memberOrder = new Map<string, number>(
        team.members.map((m, i) => [m.id, i]),
      );
      tiles.sort((a, b) => (memberOrder.get(a.memberId) ?? 999) - (memberOrder.get(b.memberId) ?? 999));
    }

    // Maintain teamOrder in roster declaration order.
    teamOrder.sort((a, b) => {
      const ai = roster.findIndex((t) => t.id === a);
      const bi = roster.findIndex((t) => t.id === b);
      return ai - bi;
    });

    // M3-10: persona-tile collapse. Per-team, group N>1 same-memberId tiles
    // into a `CollapsedPersonaGroup` wrapper. N=1 tiles are emitted bare
    // (unchanged shape). When `collapsePersonaTiles=false`, the wrapper step
    // is skipped entirely and the output is identical to pre-M3-10 (every
    // entry is a bare AgentTile). See `CollapsedPersonaGroup` /
    // `RosterTileEntry` in shared/types.ts.
    const rosterTilesWithGroups: Map<string, RosterTileEntry[]> = new Map();
    for (const [teamId, tiles] of rosterTiles) {
      rosterTilesWithGroups.set(
        teamId,
        collapsePersonaTiles ? groupTilesByPersona(tiles) : (tiles as RosterTileEntry[]),
      );
    }

    return {
      shortId: session.sessionId.slice(0, 8),
      sessionId: session.sessionId,
      pid: session.pid,
      entrypoint: session.entrypoint,
      version: session.version,
      isAlive: session.isAlive,
      cwd: session.cwd,
      title,
      rosterTiles: rosterTilesWithGroups,
      teamOrder,
      background,
    };
  });

  return { sessions: sessionTrees };
}

// =============================================================================
// Internals
// =============================================================================

/**
 * Idle threshold in ms. Per data-sources.md "Liveness inference":
 * a subagent is idle when the session PID is alive but the JSONL mtime is
 * stale > 10s. This constant is exported for test assertions.
 */
export const IDLE_THRESHOLD_MS = 10_000;

/**
 * Infer the agent's liveness state.
 *
 * Priority (highest first):
 *   1. finishedIds contains agentId          → "finished" (parent-JSONL signal,
 *      authoritative for foreground / synchronous Agent completions)
 *   2. activity.isFinished === true          → "finished" (Obs 13 / 86c9zmp5g —
 *      child-JSONL `stop_reason === "end_turn"` signal; required for
 *      background dispatches whose parent JSONL never receives a real
 *      tool_result, only an async-launched ack already skipped by
 *      `readFinishedToolUseIds` since PR #82)
 *   3. meta parse failed                     → "error" (handled in caller
 *      before reaching here)
 *   4. session is dead                       → "idle" (PID gone but session
 *      JSON still on disk — the session itself is the dead marker;
 *      individual agents aren't separately killed)
 *   5. JSONL mtime < 10s ago                 → "running"
 *   6. Otherwise                             → "idle"
 *
 * The Obs 13 check sits between the parent-signal check and the
 * JSONL-mtime check intentionally:
 *   - Above mtime → completed background agents transition to "finished"
 *     even when their final flush is very recent (would otherwise flicker
 *     as "running" for ~10s post-completion before going idle forever).
 *   - Below finishedIds → foreground completions still win, preserving
 *     the elapsed-time `finishedAtMs` precision from the parent JSONL's
 *     authoritative timestamp.
 *
 * Error state from spec §2.5:
 *   - meta.json parse failure (handled in caller)
 *   - JSONL missing entirely for a non-finished spawn (mtimeMs === 0 AND
 *     not finished AND meta exists — means the spawn registered but the
 *     child never wrote)
 *   - (roster warning for this agent — not applicable at reducer level in V1)
 */
function inferState(
  session: SessionRecord,
  activity: SubagentActivity | undefined,
  finishedIds: FinishedMap,
  agentId: string,
  nowMs: number,
): AgentState {
  // Finished: parent transcript signal (per data-sources.md §3 closing semantics).
  // This wins over the child-JSONL signal so foreground completions keep
  // their authoritative `finishedAtMs` from the parent's tool_result timestamp.
  if (finishedIds.has(agentId)) {
    return "finished";
  }

  // Obs 13 (86c9zmp5g): child-JSONL closing signal. Background dispatches
  // never reach finishedIds (parent JSONL writes only the async-launched
  // ack), so `activity.isFinished === true` is the ONLY available
  // completion signal. Checked BEFORE the JSONL-mtime running/idle gate so
  // a freshly-completed background agent doesn't briefly flicker as
  // "running" before going stale and getting stuck at "idle" forever.
  if (activity?.isFinished === true) {
    return "finished";
  }

  // No activity record at all — JSONL is missing.
  if (activity === undefined || activity.mtimeMs === 0) {
    // Per spec §2.5: JSONL missing for a non-finished spawn → error.
    // Exception: if this is a very fresh spawn (no JSONL yet), treat as running.
    // In V1 we collapse "spawned-but-no-JSONL-yet" into "running" per spec §2.3.
    // Distinguish: if meta.toolUseId is present and the session is alive, it's a
    // fresh spawn → "running". If session is dead, it's probably abandoned → "error".
    if (!session.isAlive) {
      return "error";
    }
    // Fresh spawn: session alive, JSONL not yet written.
    return "running";
  }

  const staleMs = nowMs - activity.mtimeMs;
  if (staleMs < IDLE_THRESHOLD_MS) {
    return "running";
  }
  return "idle";
}

/**
 * Resolve the display model string.
 * Returns "model:?" when activity is missing or model is null.
 */
function resolveModel(activity: SubagentActivity | undefined): string {
  if (!activity || activity.model === null) return "model:?";
  return activity.model;
}

/**
 * Resolve the display model for an agent whose meta.json failed to parse.
 *
 * The JSONL is read independently of meta.json (the watcher tails every
 * `agent-*.jsonl` regardless of meta validity), so `activity.model` is often
 * populated even when meta is null. Prefer that real value over the bare
 * `model:?` sentinel — the sponsor's screenshot showed `model:?` on a Sage
 * tile where the JSONL was readable, which was actionable information lost.
 *
 * Distinct placeholder when no model is available: `model:unknown` is
 * unambiguous about the cause (meta.json invalid, not "no assistant message
 * yet") and pairs with the parse-error description that's already in the
 * tile. See NIT #1 in M3-04 follow-up dispatch.
 *
 * Exported for direct test coverage (AC1 of NIT #1).
 */
export function resolveModelOnParseError(
  activity: SubagentActivity | undefined,
): string {
  if (activity && typeof activity.model === "string" && activity.model.length > 0) {
    return activity.model;
  }
  return "model:unknown";
}

/**
 * M3-10 AC1: collapse N>1 same-persona tiles into a `CollapsedPersonaGroup`
 * wrapper.
 *
 * Walks `tiles` in their existing order (already sorted by roster member
 * declaration order — see `rosterTiles.sort` above), groups consecutive
 * (and non-consecutive) entries with the same `memberId`, and emits:
 *   - bare `AgentTile`                       when count for that memberId is 1
 *   - `CollapsedPersonaGroup { instances }`  when count for that memberId is >= 2
 *
 * Order semantics:
 *   - Within a group, `instances` preserves the original input order
 *     (insertion order — typically agentId order from the disk read).
 *   - Across groups, position is determined by the FIRST occurrence of
 *     each memberId in the input. This keeps the roster-declaration-
 *     order sort stable: Felix-group appears before Maya-group iff
 *     Felix's first tile came before Maya's first tile in the input.
 *
 * Pure function. Does NOT mutate the input array or its tiles.
 *
 * Exported for direct unit-test coverage (AC6).
 */
export function groupTilesByPersona(
  tiles: AgentTile[],
): RosterTileEntry[] {
  // First pass: bucket by memberId; record first-occurrence index for
  // stable cross-group ordering.
  const buckets = new Map<string, AgentTile[]>();
  const firstSeenOrder: string[] = [];
  for (const tile of tiles) {
    let bucket = buckets.get(tile.memberId);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(tile.memberId, bucket);
      firstSeenOrder.push(tile.memberId);
    }
    bucket.push(tile);
  }

  // Second pass: emit bare AgentTile for singletons, CollapsedPersonaGroup
  // for N>=2. The canonical wrapper carries only `kind`, `personaName`,
  // `count`, `instances` — `memberId`/`teamId`/`role` are recoverable from
  // `instances[0]` if the renderer needs them.
  const out: RosterTileEntry[] = [];
  for (const memberId of firstSeenOrder) {
    const bucket = buckets.get(memberId)!;
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }
    const first = bucket[0]!;
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: first.display,
      count: bucket.length,
      // Snapshot the array (do not alias the bucket — defense-in-depth
      // against downstream mutators).
      instances: bucket.slice(),
    };
    out.push(group);
  }
  return out;
}

/**
 * Build the activity field string per Iris's spec §1.4.
 *
 * Full string — truncation is the CLI presenter's job (spec §5 divergence #2).
 *
 * @param finishedAtMs Optional epoch ms of when the agent finished (sourced
 *                     from the parent JSONL `tool_result` record's top-level
 *                     `timestamp` field). When supplied AND state is
 *                     "finished" AND non-zero, the output is
 *                     `"finished ${elapsedS}s"`. Otherwise the bare
 *                     `"finished"` string is returned — back-compat with
 *                     pre-86c9yxv94 callers that only carried agentId
 *                     membership.
 *
 * Exported for direct unit-test coverage (AC4 of ticket 86c9yxv94).
 */
export function buildActivity(
  state: AgentState,
  activity: SubagentActivity | undefined,
  nowMs: number,
  finishedAtMs?: number,
): string {
  switch (state) {
    case "running": {
      const tool = activity?.lastTool;
      // AC1 (M1-09-followup): when lastTool is null/undefined, return "tool:?"
      // per spec §1.4 — "If both empty → just `tool:<tool-name>`" implies the
      // tool name itself must not be omitted; "?" surfaces the unknown cleanly.
      if (!tool) return "tool:?";
      return `tool:${tool}`;
    }
    case "idle": {
      if (!activity || activity.mtimeMs === 0) return "idle";
      const elapsedS = Math.max(0, Math.round((nowMs - activity.mtimeMs) / 1000));
      return `idle ${elapsedS}s`;
    }
    case "finished": {
      // 86c9yxv94 AC2: when finishedAtMs is supplied, suffix the elapsed
      // time so the user can distinguish "just finished" from "finished
      // 20 min ago". When the caller omits the parameter (legacy callers,
      // tests that don't supply it), fall back to bare "finished" —
      // preserves back-compat.
      //
      // The gate is `!== undefined`, not `> 0`, because elapsed=0 ("just
      // finished") is a meaningful display — bare `"finished"` would hide
      // the freshness signal sponsor noticed missing in V1 dogfood Obs 6.
      // Production JSONL timestamps are always parseable ISO-8601 strings
      // written by Claude Code; the unparseable-timestamp edge case
      // (parser returns 0 sentinel) would render `"finished <huge>s"`
      // which is acceptable for an irrecoverable diagnostic case.
      if (finishedAtMs !== undefined) {
        const elapsedS = Math.max(0, Math.round((nowMs - finishedAtMs) / 1000));
        return `finished ${elapsedS}s`;
      }
      return "finished";
    }
    case "error":
      return "error: agent state unavailable";
  }
}
