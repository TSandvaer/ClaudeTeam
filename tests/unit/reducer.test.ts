// Reducer unit tests — pure function over hand-built inputs.
//
// Coverage targets (from M1-09 AC7 + Sage test plan §M1-09):
//   1. agent spawned → running → idle → finished state transitions
//   2. agent never matches any roster rule → background bucket
//   3. two sessions with same cwd → materialized separately (not merged)
//   4. session disappears mid-tree (isAlive:false)
//   5. schema drift — all three meta.json variants flow through correctly
//   6. race condition — fresh spawn with no JSONL yet (mtimeMs:0) → running
//   7. finished detection via finishedIds set (parent transcript signal)
//   8. background-chip suppression on zero background agents
//   9. "finished" from parent signal, NOT from child JSONL content
//  10. parse-error agent → background bucket with "(parse error)" agentType
//  11. empty roster → all agents in background
//  12. empty sessions → empty tree
//  13. model unresolved → "model:?" sentinel
//
// Per testing-strategy.md "Layer 1 — Unit": these tests are pure functions,
// no filesystem access. nowMs is injected for deterministic timing assertions.

import { describe, it, expect } from "vitest";
import {
  buildActivity,
  buildAgentTree,
  groupTilesByPersona,
  IDLE_THRESHOLD_MS,
  resolveModelOnParseError,
  type AgentMetaEntry,
  type ActivityMap,
  type FinishedMap,
  type SessionAgentData,
} from "../../src/extension/state/reducer.js";
import type {
  AgentMeta,
  AgentTile,
  CollapsedPersonaGroup,
  RosterTileEntry,
  SessionRecord,
  SubagentActivity,
  Team,
} from "../../src/shared/types.js";
import { isCollapsedPersonaGroup } from "../../src/shared/types.js";

/**
 * Test helper: assert a `RosterTileEntry` is a bare AgentTile (N=1, no
 * wrapper) and return it narrowed. Most pre-M3-10 reducer tests assume N=1
 * per persona — they fail fast if a group wrapper appears unexpectedly.
 */
function expectTile(entry: RosterTileEntry | undefined): AgentTile {
  expect(entry).toBeDefined();
  expect(isCollapsedPersonaGroup(entry!)).toBe(false);
  return entry as AgentTile;
}

/**
 * Test helper: assert a `RosterTileEntry` IS a `CollapsedPersonaGroup`
 * wrapper and return it narrowed. Used by M3-10 grouping tests.
 */
function expectGroup(entry: RosterTileEntry | undefined): CollapsedPersonaGroup {
  expect(entry).toBeDefined();
  expect(isCollapsedPersonaGroup(entry!)).toBe(true);
  return entry as CollapsedPersonaGroup;
}

/**
 * Test helper: predicate "is there a tile with memberId X in this entry
 * list?". Narrows past `CollapsedPersonaGroup` wrappers by descending into
 * `instances`. Used by N=1-per-persona tests that pre-date M3-10 and don't
 * exercise the wrapper branch.
 */
function hasTileForMember(
  entries: readonly RosterTileEntry[],
  memberId: string,
): boolean {
  return entries.some((e) =>
    isCollapsedPersonaGroup(e)
      ? e.instances.some((t) => t.memberId === memberId)
      : e.memberId === memberId,
  );
}

// =============================================================================
// Helpers
// =============================================================================

const NOW_MS = 1_700_000_000_000; // arbitrary fixed epoch for tests

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    pid: 12345,
    sessionId: "aaaabbbb-0000-0000-0000-000000000001",
    cwd: "c:\\Trunk\\PRIVATE\\TestProject",
    version: "2.1.145",
    entrypoint: "claude-vscode",
    startedAt: NOW_MS - 60_000,
    isAlive: true,
    ...overrides,
  };
}

function makeMeta(partial: Partial<AgentMeta> & { agentType: string; description: string }): AgentMeta {
  return {
    schemaVersion: "v2.1.145-persona",
    name: null,
    toolUseId: "toolu_test001",
    ...partial,
  };
}

function makeActivity(partial: Partial<SubagentActivity> = {}): SubagentActivity {
  return {
    model: "claude-opus-4-7",
    lastTool: "Edit",
    lastTimestamp: NOW_MS - 5_000,
    mtimeMs: NOW_MS - 5_000, // fresh (< 10s) → running
    ...partial,
  };
}

function makeAgentEntry(
  agentId: string,
  meta: AgentMeta | null,
  parseError?: string,
): AgentMetaEntry {
  return { agentId, meta, parseError };
}

function makeSessionData(
  sessionId: string,
  agents: AgentMetaEntry[],
  title?: string,
): SessionAgentData {
  return { sessionId, agents, title };
}

const ROSTER_ALPHA: Team[] = [
  {
    id: "alpha",
    name: "ClaudeTeam Alpha",
    members: [
      {
        id: "felix",
        display: "Felix",
        role: "Extension Host Dev",
        match: [
          { name_prefix: "felix-" },
          { agentType_equals: "felix" },
        ],
      },
      {
        id: "maya",
        display: "Maya",
        role: "Webview UI Dev",
        match: [
          { agentType_equals: "maya" },
        ],
      },
    ],
  },
];

// =============================================================================
// Tests
// =============================================================================

describe("buildAgentTree", () => {
  it("returns empty sessions list when sessions is empty", () => {
    const tree = buildAgentTree([], [], new Map(), new Map(), [], NOW_MS);
    expect(tree.sessions).toHaveLength(0);
  });

  it("returns a session with no agents when agentData is empty", () => {
    const session = makeSession();
    const tree = buildAgentTree(
      [session],
      [makeSessionData(session.sessionId, [])],
      new Map(),
      new Map(),
      ROSTER_ALPHA,
      NOW_MS,
    );
    expect(tree.sessions).toHaveLength(1);
    const s = tree.sessions[0]!;
    expect(s.sessionId).toBe(session.sessionId);
    expect(s.teamOrder).toHaveLength(0);
    expect(s.background).toHaveLength(0);
  });

  // ---------------------------------------------------------------- states
  describe("agent state transitions", () => {
    it("fresh spawn (mtimeMs=0, session alive) → running", () => {
      const session = makeSession();
      const agentId = "agent001";
      const meta = makeMeta({ agentType: "felix", description: "Felix M1-09" });
      const activity = makeActivity({ mtimeMs: 0, lastTool: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile).toBeDefined();
      expect(tile!.state).toBe("running");
    });

    it("JSONL mtime < 10s ago → running", () => {
      const session = makeSession();
      const agentId = "agent002";
      const meta = makeMeta({ agentType: "felix", description: "Felix running" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 5_000 }); // 5s old → running
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("running");
      // Activity string should start with "tool:" since lastTool is "Edit"
      expect(tile!.activity).toMatch(/^tool:Edit/);
    });

    it("JSONL mtime >= 10s ago → idle", () => {
      const session = makeSession();
      const agentId = "agent003";
      const meta = makeMeta({ agentType: "felix", description: "Felix idle" });
      const staleMtime = NOW_MS - IDLE_THRESHOLD_MS - 1_000; // 11s old
      const activity = makeActivity({ mtimeMs: staleMtime });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("idle");
      expect(tile!.activity).toMatch(/^idle \d+s$/);
      // Elapsed seconds should be ~11
      const elapsed = parseInt(tile!.activity.replace("idle ", "").replace("s", ""), 10);
      expect(elapsed).toBeGreaterThanOrEqual(11);
    });

    it("agentId in finishedIds → finished (overrides JSONL staleness)", () => {
      const session = makeSession();
      const agentId = "agent004";
      const meta = makeMeta({ agentType: "felix", description: "Felix finished" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 60_000 }); // very stale
      const activities: ActivityMap = new Map([[agentId, activity]]);
      // 86c9yxv94: FinishedMap = Map<agentId, finishedAtMs>. Use a real
      // recent timestamp so the elapsed-time suffix asserts cleanly.
      // finishedAt = NOW_MS - 3000 → "finished 3s".
      const finished: FinishedMap = new Map([[agentId, NOW_MS - 3_000]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        finished,
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("finished");
      // 86c9yxv94 AC2: elapsed-time suffix replaces the bare "finished"
      // string when a finishedAtMs is supplied through `FinishedMap`.
      expect(tile!.activity).toBe("finished 3s");
    });

    it("finished is from finishedIds (parent signal), NOT from JSONL content", () => {
      // This test ensures the reducer does NOT infer finished from JSONL
      // content alone — only from the explicit finishedIds set.
      // An agent with stale JSONL but NOT in finishedIds should be idle.
      const session = makeSession();
      const agentId = "agent005";
      const meta = makeMeta({ agentType: "felix", description: "Felix seemingly done" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 120_000, lastTool: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      // NOT in finishedIds
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(), // empty — parent transcript not scanned here
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      // Should be idle (stale), not finished
      expect(tile!.state).toBe("idle");
    });

    // ----------------------- Obs 13 / 86c9zmp5g ------------------------
    // Background sub-agents' parent JSONL never receives a real tool_result —
    // only the async-launched ack (skipped by readFinishedToolUseIds since
    // PR #82). The reducer must consult `activity.isFinished` (set by the
    // child-JSONL tailer when stop_reason=end_turn) as a parallel finished
    // signal, between the parent-signal check and the JSONL-mtime gate.
    it("activity.isFinished=true → finished even when finishedIds is empty (Obs 13)", () => {
      const session = makeSession();
      const agentId = "agent013a";
      const meta = makeMeta({ agentType: "felix", description: "Felix background completion" });
      // Simulate a background agent's recent flush: mtime is fresh enough
      // that without the isFinished gate the reducer would emit "running"
      // and then flip to "idle" after 10s — never reaching "finished".
      const activity = makeActivity({
        mtimeMs: NOW_MS - 2_000,
        isFinished: true,
      });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(), // EMPTY — parent JSONL had no real tool_result for this background dispatch
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("finished");
      // No finishedAtMs in the map → buildActivity falls back to bare
      // "finished" (the child-JSONL path doesn't carry a parent-authoritative
      // timestamp; the agent's own stop_reason record has its own timestamp
      // but the reducer currently doesn't thread it through — accepted scope,
      // see Obs 13 triage doc Implications §"Fix owner: Felix").
      expect(tile!.activity).toBe("finished");
    });

    it("activity.isFinished=true overrides idle (stale mtime) — Obs 13 prevents stuck-at-idle", () => {
      // The original sponsor-observed Obs 13 symptom: a background agent
      // completed but the dashboard stuck on `idle 162s+` / `idle 279s+`
      // because the reducer only saw a stale mtime. The new gate fixes it.
      const session = makeSession();
      const agentId = "agent013b";
      const meta = makeMeta({ agentType: "felix", description: "Felix stuck-idle pre-fix" });
      const activity = makeActivity({
        mtimeMs: NOW_MS - 300_000, // 5 minutes stale — pre-fix would render "idle 300s"
        isFinished: true,
      });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("finished");
      // Negative path: the pre-fix "idle 300s" rendering must NOT appear.
      expect(tile!.activity).not.toMatch(/^idle /);
    });

    it("activity.isFinished=false → reducer uses the existing running/idle/error path", () => {
      // Negative regression: an explicit false (or missing) must NOT push
      // to finished. The existing mtime-based gate runs as before.
      const session = makeSession();
      const agentId = "agent013c";
      const meta = makeMeta({ agentType: "felix", description: "Felix still running" });
      const activity = makeActivity({
        mtimeMs: NOW_MS - 2_000,
        isFinished: false,
      });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("running");
    });

    it("activity.isFinished undefined (legacy callers / pre-Obs-13 fixtures) → treated as false", () => {
      // The field is optional on SubagentActivity; absence must not crash
      // and must not be interpreted as truthy.
      const session = makeSession();
      const agentId = "agent013d";
      const meta = makeMeta({ agentType: "felix", description: "Felix legacy activity" });
      // Build an activity WITHOUT isFinished — exercises the optional path.
      const activity: SubagentActivity = {
        model: "claude-opus-4-7",
        lastTool: "Edit",
        lastTimestamp: NOW_MS - 5_000,
        mtimeMs: NOW_MS - 5_000,
        // no isFinished key
      };
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      // mtime is fresh — running path wins.
      expect(tile!.state).toBe("running");
    });

    it("finishedIds wins over activity.isFinished (foreground signal is authoritative)", () => {
      // When both signals are present (rare — a foreground completion would
      // also have stop_reason=end_turn in the child JSONL), the parent-side
      // finishedIds carries the authoritative finishedAtMs → its priority
      // is higher so the elapsed-time suffix renders.
      const session = makeSession();
      const agentId = "agent013e";
      const meta = makeMeta({ agentType: "felix", description: "Felix both signals" });
      const activity = makeActivity({
        mtimeMs: NOW_MS - 2_000,
        isFinished: true,
      });
      const activities: ActivityMap = new Map([[agentId, activity]]);
      const finished: FinishedMap = new Map([[agentId, NOW_MS - 4_000]]); // 4s ago

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        finished,
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("finished");
      // The parent signal's elapsed-time wins; bare "finished" would mean
      // the isFinished branch fired (no finishedAtMs threaded through).
      expect(tile!.activity).toBe("finished 4s");
    });
  });

  // ---------------------------------------------------------------- matching
  describe("roster matching", () => {
    it("agent never matches any rule → background bucket", () => {
      const session = makeSession();
      const agentId = "agent006";
      // general-purpose won't match any rule in ROSTER_ALPHA
      const meta = makeMeta({
        agentType: "general-purpose",
        description: "Agent A — data sources",
        schemaVersion: "v2.1.145-general",
        toolUseId: "toolu_bg001",
      });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.background).toHaveLength(1);
      expect(s.background[0]!.agentType).toBe("general-purpose");
      expect(s.teamOrder).toHaveLength(0);
    });

    it("empty roster → all agents in background", () => {
      const session = makeSession();
      const agentId = "agent007";
      const meta = makeMeta({ agentType: "felix", description: "Felix unrostered" });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        [], // empty roster
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.background).toHaveLength(1);
      expect(s.teamOrder).toHaveLength(0);
    });

    it("parse-error agent → background with '(parse error)' agentType", () => {
      const session = makeSession();
      const agentId = "agent008";

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, null, "meta.json is not valid JSON")])],
        new Map(),
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.background).toHaveLength(1);
      expect(s.background[0]!.agentType).toBe("(parse error)");
      expect(s.background[0]!.state).toBe("error");
    });

    it("background-chip suppression when count is 0", () => {
      const session = makeSession();
      const agentId = "agent009";
      const meta = makeMeta({ agentType: "felix", description: "Felix only" });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      expect(tree.sessions[0]!.background).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- multi-session
  describe("multiple sessions", () => {
    it("two sessions with same cwd → materialized separately (not merged)", () => {
      const sharedCwd = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
      const session1 = makeSession({
        pid: 1111,
        sessionId: "aaaabbbb-0000-0000-0000-000000001111",
        cwd: sharedCwd,
      });
      const session2 = makeSession({
        pid: 2222,
        sessionId: "aaaabbbb-0000-0000-0000-000000002222",
        cwd: sharedCwd,
      });
      const agentId1 = "agent010a";
      const agentId2 = "agent010b";
      const meta1 = makeMeta({ agentType: "felix", description: "Felix S1" });
      const meta2 = makeMeta({ agentType: "maya", description: "Maya S2" });
      const activity1 = makeActivity();
      const activity2 = makeActivity({ lastTool: "Read" });
      const activities: ActivityMap = new Map([
        [agentId1, activity1],
        [agentId2, activity2],
      ]);

      const tree = buildAgentTree(
        [session1, session2],
        [
          makeSessionData(session1.sessionId, [makeAgentEntry(agentId1, meta1)]),
          makeSessionData(session2.sessionId, [makeAgentEntry(agentId2, meta2)]),
        ],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      expect(tree.sessions).toHaveLength(2);
      // Each session has its own tile set — they are NOT merged.
      const s1 = tree.sessions[0]!;
      const s2 = tree.sessions[1]!;
      expect(s1.sessionId).toBe(session1.sessionId);
      expect(s2.sessionId).toBe(session2.sessionId);

      // S1 has felix; S2 has maya.
      const s1Tiles = s1.rosterTiles.get("alpha") ?? [];
      const s2Tiles = s2.rosterTiles.get("alpha") ?? [];
      expect(hasTileForMember(s1Tiles, "felix")).toBe(true);
      expect(hasTileForMember(s2Tiles, "maya")).toBe(true);
      // S1 does NOT have maya; S2 does NOT have felix.
      expect(hasTileForMember(s1Tiles, "maya")).toBe(false);
      expect(hasTileForMember(s2Tiles, "felix")).toBe(false);
    });

    it("dead session (isAlive:false) → session renders but tiles still included", () => {
      // Reducer does not suppress tiles for dead sessions; the CLI presenter
      // does (per spec §3 example note on dead sessions). Reducer is
      // presentation-agnostic about isAlive.
      const session = makeSession({ isAlive: false });
      const agentId = "agent011";
      const meta = makeMeta({ agentType: "felix", description: "Felix dead session" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 120_000 });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.isAlive).toBe(false);
      // Tile still exists (presenter decides not to render it for dead sessions).
      const tile = s.rosterTiles.get("alpha")?.[0];
      expect(tile).toBeDefined();
    });
  });

  // ---------------------------------------------------------------- schema drift
  describe("schema drift — all three meta.json variants", () => {
    it("v2.1.119 (old schema, no toolUseId) → matched via agentType_equals", () => {
      const session = makeSession();
      const agentId = "agent012";
      const meta = makeMeta({
        agentType: "felix",
        description: "Felix old schema",
        schemaVersion: "v2.1.119",
        toolUseId: null,
      });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile).toBeDefined();
      expect(tile!.memberId).toBe("felix");
    });

    it("v2.1.145-general (engine type agentType) → background when name is null", () => {
      const session = makeSession();
      const agentId = "agent013";
      const meta = makeMeta({
        agentType: "general-purpose",
        description: "Agent B — schema survey",
        schemaVersion: "v2.1.145-general",
        name: null,
        toolUseId: "toolu_gen001",
      });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.background).toHaveLength(1);
      expect(s.background[0]!.agentType).toBe("general-purpose");
    });

    it("v2.1.145-persona (new-persona variant) → matched via agentType_equals", () => {
      // This is the regression test for the "new-persona variant" bug class.
      // agentType="felix" + toolUseId present should hit agentType_equals:"felix".
      const session = makeSession();
      const agentId = "agent014";
      const meta = makeMeta({
        agentType: "felix",
        description: "Felix M1-09 new-persona",
        schemaVersion: "v2.1.145-persona",
        toolUseId: "toolu_persona001",
      });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile).toBeDefined();
      expect(tile!.memberId).toBe("felix");
      // Confirm it's the persona-named variant flowing through correctly
      expect(tile!.toolUseId).toBe("toolu_persona001");
    });
  });

  // ---------------------------------------------------------------- model
  describe("model resolution", () => {
    it("model:? sentinel when activity has null model", () => {
      const session = makeSession();
      const agentId = "agent015";
      const meta = makeMeta({ agentType: "felix", description: "Felix no model" });
      const activity = makeActivity({ model: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.model).toBe("model:?");
    });

    it("model:? sentinel when no activity entry for agent", () => {
      const session = makeSession();
      const agentId = "agent016";
      const meta = makeMeta({ agentType: "felix", description: "Felix no jsonl" });

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        new Map(), // no activity entry
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.model).toBe("model:?");
    });
  });

  // ---------------------------------------------------------------- mixed roster + background
  describe("mixed rostered + background in same session", () => {
    it("rostered + background agents materialise correctly side by side", () => {
      const session = makeSession();
      const felixId = "agent017a";
      const bgId = "agent017b";
      const felixMeta = makeMeta({ agentType: "felix", description: "Felix" });
      const bgMeta = makeMeta({
        agentType: "Explore",
        description: "Explore map roster",
        schemaVersion: "v2.1.145-general",
        toolUseId: "toolu_exp001",
      });
      const felixActivity = makeActivity();
      const bgActivity = makeActivity({ lastTool: "Bash" });
      const activities: ActivityMap = new Map([
        [felixId, felixActivity],
        [bgId, bgActivity],
      ]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [
          makeAgentEntry(felixId, felixMeta),
          makeAgentEntry(bgId, bgMeta),
        ])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.rosterTiles.get("alpha")).toHaveLength(1);
      expect(s.background).toHaveLength(1);
      expect(s.background[0]!.agentType).toBe("Explore");
    });
  });

  // ---------------------------------------------------------------- AC1 — tool:? sentinel
  describe("buildActivity — tool:? when running with null lastTool (AC1 M1-09-followup)", () => {
    it("running state with lastTool=null → activity is 'tool:?'", () => {
      const session = makeSession();
      const agentId = "agent_ac1a";
      const meta = makeMeta({ agentType: "felix", description: "Felix AC1" });
      // Fresh spawn path: mtimeMs=0 → running; no tool.
      const activity = makeActivity({ mtimeMs: 0, lastTool: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile).toBeDefined();
      expect(tile!.state).toBe("running");
      expect(tile!.activity).toBe("tool:?");
    });

    it("running state with fresh mtime but lastTool=null → activity is 'tool:?'", () => {
      const session = makeSession();
      const agentId = "agent_ac1b";
      const meta = makeMeta({ agentType: "felix", description: "Felix AC1b" });
      // Recent mtime → running; no tool yet (agent is between tool calls).
      const activity = makeActivity({ mtimeMs: NOW_MS - 2_000, lastTool: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("running");
      // Must be "tool:?" not bare "running"
      expect(tile!.activity).toBe("tool:?");
    });

    it("running state with a known lastTool → activity is 'tool:<name>' (not 'tool:?')", () => {
      const session = makeSession();
      const agentId = "agent_ac1c";
      const meta = makeMeta({ agentType: "felix", description: "Felix AC1c" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 2_000, lastTool: "Bash" });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("running");
      expect(tile!.activity).toBe("tool:Bash");
    });
  });

  // ---------------------------------------------------------------- AC3 — no parentToolUseId on tile
  describe("AgentTile shape — no parentToolUseId field (AC2/AC3 M1-09-followup)", () => {
    it("AgentTile does not expose parentToolUseId property", () => {
      const session = makeSession();
      const agentId = "agent_ac3";
      const meta = makeMeta({ agentType: "felix", description: "Felix AC3" });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile).toBeDefined();
      // parentToolUseId was deleted from the type — it must not appear on the output.
      expect(Object.prototype.hasOwnProperty.call(tile, "parentToolUseId")).toBe(false);
    });
  });

  // ---------------------------------------------------------------- AC4 — plural guard (tested at reducer level via background count)
  describe("background count — plural-guard data (AC4 M1-09-followup)", () => {
    it("single background agent is recorded with count 1", () => {
      const session = makeSession();
      const agentId = "agent_ac4a";
      const meta = makeMeta({
        agentType: "general-purpose",
        description: "One bg agent",
        schemaVersion: "v2.1.145-general",
        toolUseId: "toolu_ac4a",
      });
      const activity = makeActivity();
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        [], // empty roster → all go to background
        NOW_MS,
      );

      expect(tree.sessions[0]!.background).toHaveLength(1);
    });

    it("three background agents are recorded with count 3", () => {
      const session = makeSession();
      const agents = [
        { id: "agent_ac4b1", meta: makeMeta({ agentType: "general-purpose", description: "bg1", schemaVersion: "v2.1.145-general" as const, toolUseId: "toolu_b1" }) },
        { id: "agent_ac4b2", meta: makeMeta({ agentType: "general-purpose", description: "bg2", schemaVersion: "v2.1.145-general" as const, toolUseId: "toolu_b2" }) },
        { id: "agent_ac4b3", meta: makeMeta({ agentType: "Explore", description: "bg3", schemaVersion: "v2.1.145-general" as const, toolUseId: "toolu_b3" }) },
      ];
      const activities: ActivityMap = new Map(agents.map(a => [a.id, makeActivity()]));

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, agents.map(a => makeAgentEntry(a.id, a.meta)))],
        activities,
        new Map(),
        [], // empty roster → all go to background
        NOW_MS,
      );

      expect(tree.sessions[0]!.background).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------- session with no agentData entry
  it("session with no matching agentData entry → empty session tree", () => {
    const session = makeSession();
    // Supply a different sessionId in agentData — no match for our session.
    const tree = buildAgentTree(
      [session],
      [makeSessionData("different-session-id", [])],
      new Map(),
      new Map(),
      ROSTER_ALPHA,
      NOW_MS,
    );

    const s = tree.sessions[0]!;
    expect(s.teamOrder).toHaveLength(0);
    expect(s.background).toHaveLength(0);
    expect(s.title).toBe("(no title yet)");
  });

  // ---------------------------------------------------------------- session title
  it("session title propagates from agentData", () => {
    const session = makeSession();
    const tree = buildAgentTree(
      [session],
      [makeSessionData(session.sessionId, [], "ClaudeTeam M1 build session")],
      new Map(),
      new Map(),
      [],
      NOW_MS,
    );

    expect(tree.sessions[0]!.title).toBe("ClaudeTeam M1 build session");
  });

  it("session title defaults to '(no title yet)' when not provided", () => {
    const session = makeSession();
    const tree = buildAgentTree(
      [session],
      [makeSessionData(session.sessionId, [])], // no title
      new Map(),
      new Map(),
      [],
      NOW_MS,
    );

    expect(tree.sessions[0]!.title).toBe("(no title yet)");
  });

  // ---------------------------------------------------------------- NIT #1 — parse-error model fallback (M3-04 follow-up)
  describe("parse-error model fallback (NIT #1 — M3-04 follow-up)", () => {
    // Source: sponsor screenshot 2026-05-24 — Sage tile showed
    //   activity: "error: meta.json parse failed (missing-agentType)"
    //   model:   "model:?"
    // The JSONL was readable (the watcher tails every agent-*.jsonl regardless
    // of meta validity), so the bare `?` was actionable info lost. Brief AC1:
    // when meta.json fails, the agent should show the JSONL-derived model if
    // available, falling back to a clearer placeholder than `?` if not.

    it("background entry uses activity.model when present and meta is null", () => {
      const session = makeSession();
      const agentId = "agent_nit1_a";
      const activity = makeActivity({
        model: "claude-sonnet-4-5",
        mtimeMs: NOW_MS - 5_000,
      });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [
          makeSessionData(session.sessionId, [
            makeAgentEntry(agentId, null, "meta.json parse failed: missing field 'agentType'"),
          ]),
        ],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.background).toHaveLength(1);
      const bg = s.background[0]!;
      expect(bg.agentType).toBe("(parse error)");
      // AC1: real model from JSONL invocation surfaces, NOT "model:?".
      expect(bg.model).toBe("claude-sonnet-4-5");
      expect(bg.model).not.toBe("model:?");
    });

    it("background entry uses 'model:unknown' when meta is null AND no activity entry", () => {
      const session = makeSession();
      const agentId = "agent_nit1_b";

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, null, "meta.json parse failed: missing field 'agentType'")])],
        new Map(), // no activity at all
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const bg = tree.sessions[0]!.background[0]!;
      // AC1: clearer placeholder than bare `?` — distinguishes "meta invalid"
      // from "no assistant message yet" (the other `model:?` cause).
      expect(bg.model).toBe("model:unknown");
      expect(bg.model).not.toBe("model:?");
    });

    it("background entry uses 'model:unknown' when meta is null AND activity.model is null", () => {
      const session = makeSession();
      const agentId = "agent_nit1_c";
      const activity = makeActivity({ model: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, null, "meta.json parse failed: not a JSON object")])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const bg = tree.sessions[0]!.background[0]!;
      expect(bg.model).toBe("model:unknown");
    });

    it("rostered tiles still use the standard resolveModel path (unchanged behavior)", () => {
      // Regression guard: the NIT #1 fix touches ONLY the parse-error branch.
      // A non-parse-error agent with activity.model=null should still resolve
      // to "model:?" via the standard resolveModel helper.
      const session = makeSession();
      const agentId = "agent_nit1_d";
      const meta = makeMeta({ agentType: "felix", description: "Felix no-model" });
      const activity = makeActivity({ model: null });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      // Standard "model:?" — NOT the new "model:unknown" placeholder, because
      // this agent is rostered (meta parsed fine), so the NIT #1 path doesn't apply.
      expect(tile!.model).toBe("model:?");
    });
  });

  // ---------------------------------------------------------------- resolveModelOnParseError direct exercise
  describe("resolveModelOnParseError — direct exercise (NIT #1)", () => {
    it("returns activity.model verbatim when present and non-empty", () => {
      expect(
        resolveModelOnParseError({
          model: "claude-opus-4-7",
          lastTool: "Bash",
          lastTimestamp: NOW_MS,
          mtimeMs: NOW_MS,
        }),
      ).toBe("claude-opus-4-7");
    });

    it("returns 'model:unknown' when activity is undefined", () => {
      expect(resolveModelOnParseError(undefined)).toBe("model:unknown");
    });

    it("returns 'model:unknown' when activity.model is null", () => {
      expect(
        resolveModelOnParseError({
          model: null,
          lastTool: null,
          lastTimestamp: 0,
          mtimeMs: 0,
        }),
      ).toBe("model:unknown");
    });

    it("returns 'model:unknown' when activity.model is an empty string", () => {
      // Defensive — the tailer normalizes to null when no assistant message
      // exists, but pin the behavior anyway so a future tailer regression
      // (empty-string sneak-through) doesn't render a blank model on the tile.
      expect(
        resolveModelOnParseError({
          model: "",
          lastTool: null,
          lastTimestamp: 0,
          mtimeMs: 0,
        }),
      ).toBe("model:unknown");
    });
  });

  // ---------------------------------------------------------------- 86c9yxv94 — buildActivity finished elapsed-time suffix
  describe("buildActivity — finished elapsed-time suffix (86c9yxv94)", () => {
    // Source: ticket 86c9yxv94 ACs 2 + 4. Defect 6a per Bram's triage —
    // `buildActivity("finished", ...)` returned the bare string `"finished"`
    // and the sponsor's V1 dogfood observation #6 ("Bram finished 2s" static
    // for several minutes) shows the freshness signal was missing. The fix
    // routes a finishedAtMs through `FinishedMap` and surfaces elapsed time.

    it("AC4 literal: nowMs=1000, finishedAtMs=0 → 'finished 1s'", () => {
      // The literal AC4 spec from the ticket — pin the math contract.
      // Math: (1000 - 0) / 1000 = 1 second.
      expect(buildActivity("finished", undefined, 1000, 0)).toBe("finished 1s");
    });

    it("elapsed=0 ('just finished') → 'finished 0s' (NOT bare 'finished')", () => {
      // The freshness signal sponsor noticed missing in Obs 6: an agent that
      // just finished should still show "0s" so the user knows it just
      // completed — the bare "finished" string was indistinguishable from
      // "finished hours ago".
      expect(buildActivity("finished", undefined, 5000, 5000)).toBe(
        "finished 0s",
      );
    });

    it("elapsed=120s → 'finished 2m' (humanized at reducer per 86c9zfmhp)", () => {
      // Pre-86c9zfmhp (Obs 11) the reducer emitted raw seconds with the
      // intent that the webview would humanize; in practice the webview
      // appended a parallel second clock (`finished 19289s 3s` — host's
      // since-finish + webview's since-first-seen), so humanization moved
      // to the reducer as the single source of truth. 120s now renders as
      // `2m` via `formatFreshness` — Xs/Xm/Xh/Xd rollovers per the shared
      // helper. CLI presenter inherits the readable form automatically.
      expect(buildActivity("finished", undefined, 125_000, 5_000)).toBe(
        "finished 2m",
      );
    });

    it("elapsed buckets cover Xs / Xm / Xh / Xd rollovers (86c9zfmhp Obs 11)", () => {
      // Pin the humanization contract at the reducer boundary so a
      // regression at the host wouldn't quietly bring back raw seconds at
      // large N. Each row exercises one bucket of `formatFreshness`.
      // Source: src/shared/freshness.ts thresholds.
      expect(buildActivity("finished", undefined, 5_000, 0)).toBe("finished 5s");
      expect(buildActivity("finished", undefined, 90_000, 0)).toBe("finished 1m");
      expect(buildActivity("finished", undefined, 7_200_000, 0)).toBe(
        "finished 2h",
      );
      // 5.4h — the literal sponsor-observed value from the V1 dogfood
      // screenshot (`finished 19289s 3s` → now `finished 5h`).
      expect(buildActivity("finished", undefined, 19_289_000, 0)).toBe(
        "finished 5h",
      );
      // 25h → 1d (day rollover added 86c9zfmhp).
      expect(buildActivity("finished", undefined, 25 * 60 * 60_000, 0)).toBe(
        "finished 1d",
      );
    });

    it("finishedAtMs omitted → bare 'finished' (back-compat)", () => {
      // Legacy callers that don't supply the parameter still get the
      // pre-86c9yxv94 string shape.
      expect(buildActivity("finished", undefined, 1000)).toBe("finished");
    });

    it("finishedAtMs=undefined explicit → bare 'finished' (back-compat)", () => {
      expect(buildActivity("finished", undefined, 1000, undefined)).toBe(
        "finished",
      );
    });

    it("nowMs < finishedAtMs (clock skew) → 'finished 0s' (clamped)", () => {
      // Defensive: if upstream JSONL timestamps are in the future (machine
      // clock skew, NTP correction during a tick), `Math.max(0, ...)` keeps
      // the elapsed display non-negative.
      expect(buildActivity("finished", undefined, 1000, 5000)).toBe(
        "finished 0s",
      );
    });

    it("state='running' ignores finishedAtMs entirely", () => {
      // finishedAtMs only affects the finished branch.
      const activity = makeActivity({ lastTool: "Bash" });
      expect(buildActivity("running", activity, 1000, 0)).toBe("tool:Bash");
    });

    it("state='idle' ignores finishedAtMs entirely", () => {
      const activity = makeActivity({ mtimeMs: 800 });
      expect(buildActivity("idle", activity, 5000, 0)).toMatch(/^idle \d+s$/);
    });

    it("state='error' ignores finishedAtMs entirely", () => {
      expect(buildActivity("error", undefined, 1000, 0)).toBe(
        "error: agent state unavailable",
      );
    });

    // ---------------- buildAgentTree integration: FinishedMap flows through
    it("buildAgentTree: finishedAtMs in FinishedMap renders 'finished Xs' on tile", () => {
      // End-to-end: ensure the timestamp survives from FinishedMap → reducer
      // → tile.activity string. Regression guard for the wire boundary —
      // the value is `.get()`-ed inside the reducer and passed to
      // buildActivity at the call site.
      const session = makeSession();
      const agentId = "agent_xv94_int";
      const meta = makeMeta({ agentType: "felix", description: "Felix finished+ts" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 60_000 });
      const activities: ActivityMap = new Map([[agentId, activity]]);
      // finishedAt = 7s ago.
      const finished: FinishedMap = new Map([[agentId, NOW_MS - 7_000]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        finished,
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("finished");
      expect(tile!.activity).toBe("finished 7s");
    });

    it("buildAgentTree: agentId in finishedIds with value 0 → 'finished <huge>d' (sentinel pass-through, humanized)", () => {
      // Pin the contract: `0` is NOT a sentinel inside buildActivity — the
      // gate is `!== undefined`, not `> 0`. The parser must use `undefined`
      // (i.e. omit the entry from the map) if it wants the bare "finished"
      // fallback. In practice the parser stores `0` for unparseable
      // timestamps; the math then produces a huge elapsed value.
      //
      // Post-86c9zfmhp (Obs 11): humanization moved to the reducer via
      // `formatFreshness`, so the diagnostic shape is now `"finished Nd"`
      // (days, not raw seconds). Still clearly distinguishable from the
      // bare "finished" fallback. The tile-level `finishedAtMs` field is
      // suppressed when the parser sentinel `0` arrives (reducer treats `0`
      // as "missing timestamp" for tooltip purposes) — so no misleading
      // "Finished at 1970-01-01" tooltip surfaces in the webview.
      const session = makeSession();
      const agentId = "agent_xv94_sentinel";
      const meta = makeMeta({ agentType: "felix", description: "Felix sentinel" });
      const activity = makeActivity({ mtimeMs: NOW_MS - 60_000 });
      const activities: ActivityMap = new Map([[agentId, activity]]);
      const finished: FinishedMap = new Map([[agentId, 0]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        finished,
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("finished");
      // Elapsed = NOW_MS - 0 = NOW_MS milliseconds → very large day count.
      // Humanized via formatFreshness; matches the `d` bucket.
      expect(tile!.activity).toMatch(/^finished \d+d$/);
      // Sanity: it's clearly not the bare "finished" string.
      expect(tile!.activity).not.toBe("finished");
      // Suppressed-timestamp contract: sentinel 0 → no tile.finishedAtMs.
      expect(tile!.finishedAtMs).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------- M3-10 — persona-tile collapse
  describe("M3-10 — persona-tile collapse (AC1/AC4/AC5/AC6)", () => {
    // Helper: build N rostered tiles with the same persona under one session.
    // Each spawn gets a unique agentId so they're distinct AgentTile instances.
    function buildSessionDataWithFelixCount(
      sessionId: string,
      count: number,
    ): { data: SessionAgentData; activities: ActivityMap } {
      const agents: AgentMetaEntry[] = [];
      const activities: ActivityMap = new Map();
      for (let i = 0; i < count; i++) {
        const agentId = `felix_${i.toString().padStart(3, "0")}`;
        const meta = makeMeta({
          agentType: "felix",
          description: `Felix dispatch #${i + 1}`,
          toolUseId: `toolu_felix_${i}`,
        });
        agents.push(makeAgentEntry(agentId, meta));
        activities.set(
          agentId,
          makeActivity({ lastTool: i === 0 ? "Edit" : "Bash" }),
        );
      }
      return { data: makeSessionData(sessionId, agents), activities };
    }

    // ---------- AC1 — reducer grouping when N>1 ----------
    it("AC1: N=3 same-persona tiles collapse into one CollapsedPersonaGroup wrapper", () => {
      const session = makeSession();
      const { data, activities } = buildSessionDataWithFelixCount(
        session.sessionId,
        3,
      );

      const tree = buildAgentTree(
        [session],
        [data],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
        // Default options — collapse ON.
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const group = expectGroup(entries[0]);
      expect(group.kind).toBe("collapsed-persona");
      expect(group.personaName).toBe("Felix");
      expect(group.count).toBe(3);
      expect(group.instances).toHaveLength(3);
      // Per-instance shape unchanged. memberId / teamId / role live on the
      // wrapped instances (canonical `CollapsedPersonaGroup` carries only
      // kind / personaName / count / instances).
      for (const inst of group.instances) {
        expect(inst.memberId).toBe("felix");
        expect(inst.display).toBe("Felix");
        expect(inst.state).toBe("running");
        expect(inst.teamId).toBe("alpha");
        expect(inst.role).toBe("Extension Host Dev");
      }
    });

    it("AC3 (N=1): single rostered tile renders as bare AgentTile (no wrapper)", () => {
      const session = makeSession();
      const { data, activities } = buildSessionDataWithFelixCount(
        session.sessionId,
        1,
      );

      const tree = buildAgentTree(
        [session],
        [data],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const tile = expectTile(entries[0]);
      expect(tile.memberId).toBe("felix");
      // Guard: no CollapsedPersonaGroup discriminator on the bare-tile output.
      expect("kind" in tile).toBe(false);
    });

    it("AC4: unrostered (background) agents bypass grouping entirely — even N>1", () => {
      const session = makeSession();
      const agents: AgentMetaEntry[] = [];
      const activities: ActivityMap = new Map();
      for (let i = 0; i < 3; i++) {
        const agentId = `bg_${i}`;
        agents.push(
          makeAgentEntry(
            agentId,
            makeMeta({
              agentType: "general-purpose",
              description: `bg ${i}`,
              schemaVersion: "v2.1.145-general",
              toolUseId: `toolu_bg_${i}`,
            }),
          ),
        );
        activities.set(agentId, makeActivity());
      }

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, agents)],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      // Three background agents — flat list, no group wrapper.
      expect(s.background).toHaveLength(3);
      // No rostered tiles at all → no CollapsedPersonaGroup anywhere.
      expect(s.rosterTiles.size).toBe(0);
    });

    // ---------- AC5 — config flag opt-out ----------
    it("AC5: collapsePersonaTiles=false → N=3 emit as 3 bare AgentTile entries (no wrapper)", () => {
      const session = makeSession();
      const { data, activities } = buildSessionDataWithFelixCount(
        session.sessionId,
        3,
      );

      const tree = buildAgentTree(
        [session],
        [data],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
        { collapsePersonaTiles: false },
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(3);
      // Every entry is a bare AgentTile — no group wrapper.
      for (const entry of entries) {
        const tile = expectTile(entry);
        expect(tile.memberId).toBe("felix");
      }
    });

    it("AC5: collapsePersonaTiles=true (explicit) → N=3 → one group (matches default)", () => {
      const session = makeSession();
      const { data, activities } = buildSessionDataWithFelixCount(
        session.sessionId,
        3,
      );

      const tree = buildAgentTree(
        [session],
        [data],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
        { collapsePersonaTiles: true },
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const group = expectGroup(entries[0]);
      expect(group.count).toBe(3);
    });

    it("AC5: default (no options arg) groups when N>1 — matches package.json default true", () => {
      const session = makeSession();
      const { data, activities } = buildSessionDataWithFelixCount(
        session.sessionId,
        2,
      );

      const tree = buildAgentTree(
        [session],
        [data],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
        // Omit options entirely.
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      expectGroup(entries[0]);
    });

    // ---------- mixed: rostered N>1 + N=1 + background in same session ----------
    it("mixed session: Felix×2 group + Maya×1 bare + 1 background coexist correctly", () => {
      const session = makeSession();
      const agents: AgentMetaEntry[] = [
        makeAgentEntry(
          "felix_a",
          makeMeta({ agentType: "felix", description: "Felix A", toolUseId: "t1" }),
        ),
        makeAgentEntry(
          "felix_b",
          makeMeta({ agentType: "felix", description: "Felix B", toolUseId: "t2" }),
        ),
        makeAgentEntry(
          "maya_a",
          makeMeta({ agentType: "maya", description: "Maya solo", toolUseId: "t3" }),
        ),
        makeAgentEntry(
          "bg_a",
          makeMeta({
            agentType: "general-purpose",
            description: "noise",
            schemaVersion: "v2.1.145-general",
            toolUseId: "t4",
          }),
        ),
      ];
      const activities: ActivityMap = new Map(
        agents.map((a) => [a.agentId, makeActivity()]),
      );

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, agents)],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      const alpha = s.rosterTiles.get("alpha") ?? [];
      // Felix bucket (N=2) → group; Maya bucket (N=1) → bare tile. Order
      // is roster-declaration: felix first (member[0]), maya second.
      expect(alpha).toHaveLength(2);
      const felixGroup = expectGroup(alpha[0]);
      expect(felixGroup.personaName).toBe("Felix");
      expect(felixGroup.instances[0]!.memberId).toBe("felix");
      expect(felixGroup.count).toBe(2);
      const mayaTile = expectTile(alpha[1]);
      expect(mayaTile.memberId).toBe("maya");
      // Background unchanged.
      expect(s.background).toHaveLength(1);
      expect(s.background[0]!.agentType).toBe("general-purpose");
    });

    it("groupTilesByPersona preserves instance order within a group", () => {
      // Direct exercise of the exported helper — pin the order contract:
      // instances[] preserves input order (insertion order from disk read).
      const felixA: AgentTile = {
        memberId: "felix",
        teamId: "alpha",
        display: "Felix",
        role: "Extension Host Dev",
        activity: "tool:Edit",
        model: "claude-opus-4-7",
        state: "running",
        agentId: "felix_first",
        toolUseId: "tu_A",
      };
      const felixB: AgentTile = { ...felixA, agentId: "felix_second", toolUseId: "tu_B" };
      const felixC: AgentTile = { ...felixA, agentId: "felix_third", toolUseId: "tu_C" };

      const out = groupTilesByPersona([felixA, felixB, felixC]);
      expect(out).toHaveLength(1);
      const group = expectGroup(out[0]);
      expect(group.instances.map((i) => i.agentId)).toEqual([
        "felix_first",
        "felix_second",
        "felix_third",
      ]);
    });

    it("groupTilesByPersona: cross-group order = first-occurrence-of-memberId", () => {
      // Pin: Felix appears before Maya in input → Felix group before Maya tile,
      // regardless of how many Maya tiles are interleaved.
      const felix: AgentTile = {
        memberId: "felix",
        teamId: "alpha",
        display: "Felix",
        role: "Extension Host Dev",
        activity: "tool:Edit",
        model: "claude-opus-4-7",
        state: "running",
        agentId: "felix_x",
        toolUseId: "tu_fx",
      };
      const felix2: AgentTile = { ...felix, agentId: "felix_y", toolUseId: "tu_fy" };
      const maya: AgentTile = {
        memberId: "maya",
        teamId: "alpha",
        display: "Maya",
        role: "Webview UI Dev",
        activity: "tool:Read",
        model: "claude-opus-4-7",
        state: "running",
        agentId: "maya_x",
        toolUseId: "tu_mx",
      };
      // Input: felix, maya, felix2 — felix's first occurrence (idx 0) before
      // maya's (idx 1). Output order: felix-group, maya-tile.
      const out = groupTilesByPersona([felix, maya, felix2]);
      expect(out).toHaveLength(2);
      const fg = expectGroup(out[0]);
      expect(fg.personaName).toBe("Felix");
      expect(fg.instances[0]!.memberId).toBe("felix");
      expect(fg.count).toBe(2);
      const mt = expectTile(out[1]);
      expect(mt.memberId).toBe("maya");
    });

    it("groupTilesByPersona: empty input → empty output", () => {
      expect(groupTilesByPersona([])).toEqual([]);
    });

    it("groupTilesByPersona: single tile → bare AgentTile (not wrapped)", () => {
      const tile: AgentTile = {
        memberId: "felix",
        teamId: "alpha",
        display: "Felix",
        role: "Extension Host Dev",
        activity: "tool:Edit",
        model: "claude-opus-4-7",
        state: "running",
        agentId: "only",
        toolUseId: "tu",
      };
      const out = groupTilesByPersona([tile]);
      expect(out).toHaveLength(1);
      // Must be reference-equal — no copy/wrap when N=1.
      expect(out[0]).toBe(tile);
    });

    it("groupTilesByPersona: does NOT mutate the input array or its tiles", () => {
      const a: AgentTile = {
        memberId: "felix", teamId: "alpha", display: "Felix",
        role: "Extension Host Dev", activity: "tool:Edit",
        model: "m", state: "running", agentId: "a", toolUseId: "ta",
      };
      const b: AgentTile = { ...a, agentId: "b", toolUseId: "tb" };
      const input = [a, b];
      const inputCopy = input.slice();
      const aCopy = { ...a };
      groupTilesByPersona(input);
      expect(input).toEqual(inputCopy);
      expect(a).toEqual(aCopy);
    });

    // ---------- AC1 — JSON-safety / round-trip of the wrapper ----------
    it("CollapsedPersonaGroup wrapper round-trips through JSON.stringify cleanly", () => {
      // Per .claude/docs/vscode-extension-conventions.md "JSON-serialization
      // constraint" — wire-shape must survive postMessage's JSON.stringify.
      const session = makeSession();
      const { data, activities } = buildSessionDataWithFelixCount(
        session.sessionId,
        2,
      );

      const tree = buildAgentTree(
        [session],
        [data],
        activities,
        new Map(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const group = expectGroup(
        tree.sessions[0]!.rosterTiles.get("alpha")?.[0],
      );
      const wire = JSON.parse(JSON.stringify(group)) as unknown;
      expect(wire).toEqual(group);
      // Discriminator survives.
      expect((wire as CollapsedPersonaGroup).kind).toBe("collapsed-persona");
      expect((wire as CollapsedPersonaGroup).count).toBe(2);
      expect((wire as CollapsedPersonaGroup).instances).toHaveLength(2);
    });
  });
});
