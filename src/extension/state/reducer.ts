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
import { formatFreshness } from "../../shared/freshness.js";
import { computeAggregateState } from "../../shared/types.js";
import type {
  AgentMeta,
  AgentState,
  AgentTile,
  AgentTree,
  BackgroundAgent,
  MultiAgentPersonaTile,
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
  /**
   * Optional sponsor-authored rename from the `custom-title` JSONL record
   * (86ca03nww). The host parser scans backward from EOF and picks the FIRST
   * match (i.e. the most recent customTitle write). Absent when no rename
   * has ever been performed on this session. Empty / whitespace-only values
   * are normalized to undefined by the parser.
   */
  customTitle?: string;
  /**
   * Optional active git branch (86ca03nww). The host parser walks the JSONL
   * forward and keeps the LAST occurrence of a top-level `gitBranch` field
   * across `attachment` / `user` / `assistant` / `system` records. Absent
   * when no record in the file carries the field.
   */
  gitBranch?: string;
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
    // 86ca03nww: pass-through projections of the two new label-surface
    // fields. The parser normalizes empty / whitespace-only values to
    // undefined; we only omit the field when truly absent so the wire shape
    // stays back-compat (pre-86ca03nww SessionTrees have neither field).
    const customTitle = data?.customTitle;
    const gitBranch = data?.gitBranch;

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
        // 86ca1dtr5: stamp the owning sessionId onto every rostered tile so a
        // MultiAgentPersonaTile instance running in a different session than
        // the rendering session block can still drill into the correct
        // transcript (resolves PR #123 NIT 2). Single-tile path is unaffected
        // — the tile renders inside its own session block, so the value
        // coincides with the block's sessionId.
        sessionId: session.sessionId,
        toolUseId: meta.toolUseId,
        // 86c9zfmhp (Obs 11): expose the host-authoritative finish timestamp
        // so the webview can build a precise-ISO tooltip on the activity row.
        // Only carried for finished tiles with a parsed timestamp; omitted
        // (undefined) otherwise so back-compat consumers see an absent field.
        // `0` is treated as "missing" here even though `buildActivity`'s gate
        // is `!== undefined` — a `0` epoch ms is the parser sentinel for an
        // unparseable timestamp; surfacing it as a tooltip would render
        // "Finished at 1970-01-01T00:00:00Z" which is misleading.
        ...(finishedAtMs !== undefined && finishedAtMs > 0
          ? { finishedAtMs }
          : {}),
        // 86c9zq9vm (spec 86c9zmyef §2.2): stamp the roster-supplied member
        // color onto the tile so the webview can paint the running-state dot.
        // The loader already validates + normalizes `member.color` to 6-digit
        // lowercase hex (or drops invalid entries to `undefined` with a
        // warning) — this layer is a pure projection, no further check.
        // Absent on tiles whose matched member has no `color` set, preserving
        // the pre-86c9zq9vm wire shape for sponsors who haven't opted in.
        ...(member.color !== undefined ? { memberColor: member.color } : {}),
      };

      if (!rosterTiles.has(teamId)) {
        rosterTiles.set(teamId, []);
        teamOrder.push(teamId);
      }
      rosterTiles.get(teamId)!.push(tile);
    }

    // -----------------------------------------------------------------------
    // Baseline-tile seed (EPIC 86ca11187 / 86ca18b9p — whole-team-always-visible).
    //
    // Every `teams.yaml` member ALWAYS gets a tile. The detected-agent loop
    // above only minted tiles for members with a live/matched agent this
    // session; members who never ran (Iris/Nora/Bram on a Felix-only session)
    // had no tile at all. Seed a baseline `available` tile for each roster
    // member that has ZERO detected tiles in its team.
    //
    // AC2 (overlay wins, no dup per memberId): we seed ONLY for members
    // absent from `detectedMemberIds`. A detected agent's tile (any of
    // running/idle/finished/error, and N>1 collapses are detected) takes
    // precedence — the baseline is the fallback, never an addition on top of
    // a live tile. Seeding happens BEFORE the sort + M3-10 grouping passes so
    // baseline tiles interleave in roster member-declaration order (AC6) and
    // flow through the existing render path (minimal/placeholder per OOS —
    // E-05 re-skins the `available` visual).
    //
    // Scope note: baseline tiles live INSIDE each surfaced session block's
    // team card (the EXISTING placement). A session-less "roster baseline"
    // block for the zero-live-sessions case is sponsor open question Q1
    // (spec §10) and OUT OF SCOPE here.
    //
    // The set of memberIds with a detected tile, per teamId.
    const detectedMemberIds = new Map<string, Set<string>>();
    for (const [teamId, tiles] of rosterTiles) {
      detectedMemberIds.set(teamId, new Set(tiles.map((t) => t.memberId)));
    }
    for (const team of roster) {
      const detected = detectedMemberIds.get(team.id) ?? new Set<string>();
      for (const member of team.members) {
        if (detected.has(member.id)) {
          continue; // live tile already exists — overlay wins (AC2).
        }
        const baselineTile: AgentTile = {
          memberId: member.id,
          teamId: team.id,
          display: member.display,
          role: member.role,
          activity: buildActivity("available", undefined, nowMs),
          // No live agent ⇒ no resolved model. Use the existing "model:?"
          // sentinel (same as an unresolved live tile) — the `available`
          // state, not the model string, carries the never-run semantics.
          model: "model:?",
          state: "available",
          // No agent id / toolUseId for a never-run member — synthetic empty
          // string keeps the field non-undefined for the wire shape; the
          // `available` state is the signal there is no underlying agent.
          agentId: "",
          toolUseId: null,
          // Member color is independent of liveness — carry it through so
          // E-05 can paint the leading-edge identity even on a baseline tile.
          ...(member.color !== undefined ? { memberColor: member.color } : {}),
        };
        if (!rosterTiles.has(team.id)) {
          rosterTiles.set(team.id, []);
          teamOrder.push(team.id);
        }
        rosterTiles.get(team.id)!.push(baselineTile);
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

    // 86ca1dtr5 (option A, supersedes M3-10 grouping for rostered members):
    // per-team, group N≥2 same-memberId tiles into a `MultiAgentPersonaTile`
    // wrapper carrying the full member identity + aggregate state + headline +
    // ordered instances. N=1 tiles are emitted bare (unchanged shape). When
    // `collapsePersonaTiles=false`, the wrapper step is skipped entirely and
    // the output is identical to pre-M3-10 (every entry is a bare AgentTile).
    // See `MultiAgentPersonaTile` / `RosterTileEntry` in shared/types.ts.
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
      // 86ca03nww: spread-only-when-defined keeps the pre-86ca03nww wire
      // shape intact when neither field is present (e.g. CLI driver session
      // with no rename + no recorded gitBranch — the SessionTree carries
      // exactly the M3 shape, no extra keys).
      ...(customTitle !== undefined ? { customTitle } : {}),
      ...(gitBranch !== undefined ? { gitBranch } : {}),
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
 * Idle threshold in ms. A subagent is idle when the session PID is alive but
 * the JSONL mtime is stale beyond this window.
 *
 * Set to 60s (sponsor decision 2026-05-29, ticket 86ca168j9; root-cause by Bram).
 * RATIONALE: the only liveness signal is the sub-agent JSONL file mtime, and
 * Claude Code flushes the JSONL only when a tool call completes — NOT during
 * text generation. Measured generation gaps of 20s–202s therefore exceed the
 * old 10s cutoff, so an actively-generating agent flickered to "idle" between
 * tool calls. A 60s debounce absorbs the common generation gaps (the 20s–45s
 * band) while still surfacing genuinely-stalled agents.
 *
 * KNOWN LIMITATION (deferred to M5): the rare 200s+ single-generation outlier
 * still exceeds 60s and will read "idle" mid-generation. It is unfixable with
 * mtime alone — it needs the M5 hooks liveness tap (PreToolUse / generation
 * events). No "generating" sub-state is introduced here.
 *
 * Exported for test assertions.
 */
export const IDLE_THRESHOLD_MS = 60_000;

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
 *   5. JSONL mtime < IDLE_THRESHOLD_MS ago   → "running"
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
 * 86ca1dtr5 (option A — supersedes M3-10 grouping for rostered members):
 * collapse N≥2 same-persona tiles into a `MultiAgentPersonaTile` wrapper.
 *
 * Walks `tiles` in their existing order (already sorted by roster member
 * declaration order — see `rosterTiles.sort` above), groups (consecutive and
 * non-consecutive) entries with the same `memberId`, and emits:
 *   - bare `AgentTile`                          when count for that memberId is 1
 *   - `MultiAgentPersonaTile { instances, ... }` when count for that memberId is >= 2
 *
 * Each wrapper carries the FULL member identity (memberId/teamId/display/role/
 * memberColor — taken from the bucket's first tile, which is invariant across
 * the bucket since all share one memberId), the aggregate state
 * (`computeAggregateState`, §2.1 precedence running > error > idle > finished >
 * available), the headline instance's activity + model (§2.4), the count, and
 * the instances ordered most-active-first (§3.2).
 *
 * Order semantics:
 *   - Within a wrapper, `instances` are ordered MOST-ACTIVE-FIRST
 *     (running → error → idle → finished → available) with ties broken by
 *     `agentId` lexical order (deterministic, flicker-free across ticks). This
 *     replaces M3-10's "preserve input order" — option A wants the headline
 *     (winning-tier) instance to lead the expanded list (§3.2).
 *   - Across wrappers, position is determined by the FIRST occurrence of each
 *     memberId in the input — keeps the roster-declaration-order sort stable.
 *
 * Headline instance (§2.4): the most-recently-active instance within the
 * winning tier — for finished, the one with the largest `finishedAtMs`; for
 * other tiers, ordering already places the lexically-first agentId of the
 * winning tier first, which is the deterministic tie-break. The headline's
 * activity + model drive rows 3/4 of the rendered tile.
 *
 * Pure function. Does NOT mutate the input array or its tiles.
 *
 * Exported for direct unit-test coverage.
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

  // Second pass: emit bare AgentTile for singletons, MultiAgentPersonaTile
  // for N>=2.
  const out: RosterTileEntry[] = [];
  for (const memberId of firstSeenOrder) {
    const bucket = buckets.get(memberId)!;
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }
    // Order instances most-active-first (snapshot — do not mutate the bucket).
    const ordered = bucket.slice().sort(compareInstancesMostActiveFirst);
    const aggregateState = computeAggregateState(ordered);
    const headline = pickHeadlineInstance(ordered, aggregateState);
    // Member identity is invariant across the bucket (all share one memberId);
    // read it from the first tile.
    const identity = bucket[0]!;
    const wrapper: MultiAgentPersonaTile = {
      kind: "multi-agent-persona",
      memberId: identity.memberId,
      teamId: identity.teamId,
      display: identity.display,
      role: identity.role,
      aggregateState,
      headlineActivity: headline.activity,
      headlineModel: headline.model,
      count: ordered.length,
      instances: ordered,
      ...(identity.memberColor !== undefined
        ? { memberColor: identity.memberColor }
        : {}),
    };
    out.push(wrapper);
  }
  return out;
}

/**
 * Rebuild a `RosterTileEntry` for a rostered member from a (possibly trimmed)
 * instance set — the shared helper the post-reducer filters
 * (`hideFinishedFilter`, `hideIdleFilter`, `hideMembersFilter`,
 * `removeMembersFilter`) use after dropping instances from a
 * `MultiAgentPersonaTile`.
 *
 * Re-derives the aggregate state, headline activity/model, count, and
 * most-active-first ordering from the surviving instances so the wrapper stays
 * internally consistent (the §5.4 invariant `count === instances.length` and
 * `aggregateState === computeAggregateState(instances)` must hold on the wire).
 *
 *   - 0 survivors  → `null` (caller drops the entry).
 *   - 1 survivor   → bare `AgentTile` (matches the reducer's N=1 shape — a
 *                    rostered member with one live instance is NOT a wrapper).
 *   - N≥2 survivors → a fresh `MultiAgentPersonaTile` with recomputed
 *                    aggregate/headline/count/order, carrying forward the
 *                    member identity from the trimmed wrapper.
 *
 * Pure — does not mutate `survivors` (sorts a snapshot). Exported for filter
 * reuse + direct test coverage.
 */
export function rebuildMultiAgentTileFromInstances(
  identity: Pick<
    MultiAgentPersonaTile,
    "memberId" | "teamId" | "display" | "role" | "memberColor"
  >,
  survivors: AgentTile[],
): RosterTileEntry | null {
  if (survivors.length === 0) return null;
  if (survivors.length === 1) return survivors[0]!;
  const ordered = survivors.slice().sort(compareInstancesMostActiveFirst);
  const aggregateState = computeAggregateState(ordered);
  const headline = pickHeadlineInstance(ordered, aggregateState);
  return {
    kind: "multi-agent-persona",
    memberId: identity.memberId,
    teamId: identity.teamId,
    display: identity.display,
    role: identity.role,
    aggregateState,
    headlineActivity: headline.activity,
    headlineModel: headline.model,
    count: ordered.length,
    instances: ordered,
    ...(identity.memberColor !== undefined
      ? { memberColor: identity.memberColor }
      : {}),
  };
}

/**
 * Rank for the most-active-first instance ordering (lower = more active).
 * `available` is the floor (in practice unreachable inside a live instance
 * list, but ranked for totality). Mirrors the `computeAggregateState`
 * precedence tiers.
 */
const INSTANCE_STATE_RANK: Record<AgentState, number> = {
  running: 0,
  error: 1,
  idle: 2,
  finished: 3,
  available: 4,
};

/**
 * Comparator for ordering instances most-active-first (§3.2). Primary key is
 * the state rank (running → error → idle → finished → available); ties broken
 * by `agentId` lexical order so the ordering is deterministic and stable
 * across ticks (no flicker). Pure / total.
 */
function compareInstancesMostActiveFirst(a: AgentTile, b: AgentTile): number {
  const ra = INSTANCE_STATE_RANK[a.state];
  const rb = INSTANCE_STATE_RANK[b.state];
  if (ra !== rb) return ra - rb;
  return a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0;
}

/**
 * Pick the headline instance (§2.4) — the most-recently-active instance within
 * the winning aggregate tier. For `finished`, "most recent" is the largest
 * `finishedAtMs` (the last to complete). For all other tiers, the `ordered`
 * array (already most-active-first with agentId tie-break) places the winning
 * tier's lexically-first instance at the front, so the first instance whose
 * state matches the aggregate IS the headline.
 *
 * `ordered` is assumed non-empty (N≥2 wrapper invariant). Pure.
 */
function pickHeadlineInstance(
  ordered: AgentTile[],
  aggregateState: AgentState,
): AgentTile {
  const tierMatches = ordered.filter((t) => t.state === aggregateState);
  if (tierMatches.length === 0) {
    // Defensive: aggregate didn't match any instance (only reachable if the
    // aggregate is `available` with no available instances). Fall back to the
    // first ordered instance so the headline is always defined.
    return ordered[0]!;
  }
  if (aggregateState === "finished") {
    // Last-to-finish leads — largest finishedAtMs. Ties / missing timestamps
    // fall back to the existing most-active-first ordering (agentId lexical).
    return tierMatches.reduce((best, cur) => {
      const bestMs = best.finishedAtMs ?? -Infinity;
      const curMs = cur.finishedAtMs ?? -Infinity;
      return curMs > bestMs ? cur : best;
    });
  }
  // running / error / idle: the first tier-matching instance in the
  // most-active-first ordering is the deterministic headline.
  return tierMatches[0]!;
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
      // 86c9zfmhp (Obs 11): the suffix is now humanized via the shared
      // `formatFreshness` helper — produces "Xs / Xm / Xh / Xd" instead of
      // raw seconds. The pre-Obs-11 behavior surfaced `"finished 19289s"`
      // for an agent finished 5.4h ago (sponsor V1 dogfood screenshot);
      // raw seconds at large N are unreadable at a glance. Humanizing at
      // the reducer (rather than the webview) means the CLI presenter
      // inherits the readability fix automatically, and the host stays
      // the single source of truth for the activity string — eliminating
      // the parallel-clock UX bug the webview introduced when it appended
      // its own `formatFreshness(now - first-seen)` suffix on top of the
      // host's raw seconds.
      //
      // The gate is `!== undefined`, not `> 0`, because elapsed=0 ("just
      // finished") is a meaningful display — bare `"finished"` would hide
      // the freshness signal sponsor noticed missing in V1 dogfood Obs 6.
      // Production JSONL timestamps are always parseable ISO-8601 strings
      // written by Claude Code; the unparseable-timestamp edge case
      // (parser returns 0 sentinel) would render `"finished <large>d"`
      // (since the elapsed is huge), which is acceptable for an
      // irrecoverable diagnostic case.
      if (finishedAtMs !== undefined) {
        return `finished ${formatFreshness(nowMs - finishedAtMs)}`;
      }
      return "finished";
    }
    case "error":
      return "error: agent state unavailable";
    case "available":
      // Roster-baseline never-run member (86ca18b9p). No tool line, no
      // elapsed — the literal muted word per spec §2.2. E-05 renders the
      // visual; the host emits the activity string.
      return "available";
  }
}
