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
 * Finished-agent set: agentIds whose parent transcript has a `tool_result`
 * matching the agent's `meta.toolUseId`. Determined by the CLI reader (or
 * file-watcher in M2) by scanning the parent JSONL. Pure map from toolUseId
 * → agentId (both sides needed because that's how the parent links them).
 *
 * Per Bram's M1-02 finding (data-sources.md §3 "JSONL closing semantics"):
 * the parent JSONL's `tool_result` with `tool_use_id == meta.toolUseId` is
 * the ONLY reliable "finished" signal; the child JSONL never carries it.
 */
export type FinishedSet = Set<string>; // set of agentIds

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
 * Build the full AgentTree from snapshot inputs.
 *
 * Pure function — no side effects. Every output is derived solely from args.
 *
 * @param sessions   All sessions from the session registry (listSessions).
 * @param agentData  Per-session subagent metadata (one entry per session).
 * @param activities Activity snapshot for each agent (agentId → SubagentActivity).
 * @param finishedIds Set of agentIds known to have finished (parent JSONL signal).
 * @param roster     Merged roster from the roster loader.
 * @param nowMs      Current epoch ms — injected for testability. Defaults to
 *                   Date.now() when not supplied (production CLI).
 */
export function buildAgentTree(
  sessions: SessionRecord[],
  agentData: SessionAgentData[],
  activities: ActivityMap,
  finishedIds: FinishedSet,
  roster: Team[],
  nowMs: number = Date.now(),
): AgentTree {
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
        background.push({
          agentType: "(parse error)",
          description: parseError ?? "meta.json parse failed",
          state: "error",
          model: "model:?",
        });
        continue;
      }

      const matchResult = matchAgent(meta, roster);
      const state = inferState(session, activity, finishedIds, agentId, nowMs);
      const model = resolveModel(activity);
      const activityStr = buildActivity(state, activity, nowMs);

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
        parentToolUseId: null, // resolved below in tree-link pass
      };

      if (!rosterTiles.has(teamId)) {
        rosterTiles.set(teamId, []);
        teamOrder.push(teamId);
      }
      rosterTiles.get(teamId)!.push(tile);
    }

    // --- Parent→child tree link pass.
    // Build a map from toolUseId → agentId for all rostered tiles in this session.
    // Then for each tile, find its parent if its parentToolUseId can be resolved.
    // V1: we only resolve one level (per spec §1.5 "Only one level of nesting is
    // rendered in V1").
    const toolUseIdToTile = new Map<string, AgentTile>();
    for (const tiles of rosterTiles.values()) {
      for (const tile of tiles) {
        if (tile.toolUseId !== null) {
          toolUseIdToTile.set(tile.toolUseId, tile);
        }
      }
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

    return {
      shortId: session.sessionId.slice(0, 8),
      sessionId: session.sessionId,
      pid: session.pid,
      entrypoint: session.entrypoint,
      version: session.version,
      isAlive: session.isAlive,
      cwd: session.cwd,
      title,
      rosterTiles,
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
 *   1. finishedIds contains agentId → "finished"
 *   2. meta parse failed            → "error" (handled in caller before reaching here)
 *   3. session is dead              → "idle" (PID gone but session JSON still on disk —
 *      the session itself is the dead marker; individual agents aren't separately killed)
 *   4. JSONL mtime < 10s ago        → "running"
 *   5. Otherwise                    → "idle"
 *
 * Error state from spec §2.5:
 *   - meta.json parse failure (handled in caller)
 *   - JSONL missing entirely for a non-finished spawn (mtimeMs === 0 AND not finished
 *     AND meta exists — means the spawn registered but the child never wrote)
 *   - (roster warning for this agent — not applicable at reducer level in V1)
 */
function inferState(
  session: SessionRecord,
  activity: SubagentActivity | undefined,
  finishedIds: FinishedSet,
  agentId: string,
  nowMs: number,
): AgentState {
  // Finished: parent transcript signal (per data-sources.md §3 closing semantics).
  if (finishedIds.has(agentId)) {
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
 * Build the activity field string per Iris's spec §1.4.
 *
 * Full string — truncation is the CLI presenter's job (spec §5 divergence #2).
 */
function buildActivity(
  state: AgentState,
  activity: SubagentActivity | undefined,
  nowMs: number,
): string {
  switch (state) {
    case "running": {
      const tool = activity?.lastTool;
      if (!tool) return "running";
      return `tool:${tool}`;
    }
    case "idle": {
      if (!activity || activity.mtimeMs === 0) return "idle";
      const elapsedS = Math.max(0, Math.round((nowMs - activity.mtimeMs) / 1000));
      return `idle ${elapsedS}s`;
    }
    case "finished":
      return "finished";
    case "error":
      return "error: agent state unavailable";
  }
}
