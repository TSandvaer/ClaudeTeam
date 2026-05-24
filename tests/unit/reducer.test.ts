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
  buildAgentTree,
  IDLE_THRESHOLD_MS,
  resolveModelOnParseError,
  type AgentMetaEntry,
  type ActivityMap,
  type FinishedSet,
  type SessionAgentData,
} from "../../src/extension/state/reducer.js";
import type {
  AgentMeta,
  SessionRecord,
  SubagentActivity,
  Team,
} from "../../src/shared/types.js";

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
    const tree = buildAgentTree([], [], new Map(), new Set(), [], NOW_MS);
    expect(tree.sessions).toHaveLength(0);
  });

  it("returns a session with no agents when agentData is empty", () => {
    const session = makeSession();
    const tree = buildAgentTree(
      [session],
      [makeSessionData(session.sessionId, [])],
      new Map(),
      new Set(),
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
      const finished: FinishedSet = new Set([agentId]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        finished,
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
      expect(tile!.state).toBe("finished");
      expect(tile!.activity).toBe("finished");
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
        new Set(), // empty — parent transcript not scanned here
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
      // Should be idle (stale), not finished
      expect(tile!.state).toBe("idle");
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
        new Set(),
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
        new Set(),
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
        new Set(),
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
        new Set(),
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
        new Set(),
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
      expect(s1Tiles.some((t) => t.memberId === "felix")).toBe(true);
      expect(s2Tiles.some((t) => t.memberId === "maya")).toBe(true);
      // S1 does NOT have maya; S2 does NOT have felix.
      expect(s1Tiles.some((t) => t.memberId === "maya")).toBe(false);
      expect(s2Tiles.some((t) => t.memberId === "felix")).toBe(false);
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
        new Set(),
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
        new Set(),
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
        new Set(),
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
      new Set(),
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
      new Set(),
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
      new Set(),
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
        new Set(),
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
        new Set(),
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
        new Set(),
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
        new Set(),
        ROSTER_ALPHA,
        NOW_MS,
      );

      const tile = tree.sessions[0]!.rosterTiles.get("alpha")?.[0];
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
});
