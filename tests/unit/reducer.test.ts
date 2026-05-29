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
  MultiAgentPersonaTile,
  RosterTileEntry,
  SessionRecord,
  SubagentActivity,
  Team,
} from "../../src/shared/types.js";
import {
  isCollapsedPersonaGroup,
  isMultiAgentPersonaTile,
} from "../../src/shared/types.js";

/**
 * Test helper: is this entry any wrapper (legacy CollapsedPersonaGroup or
 * 86ca1dtr5 MultiAgentPersonaTile)? Both carry `instances: AgentTile[]`.
 */
function isAnyWrapper(entry: RosterTileEntry): boolean {
  return isCollapsedPersonaGroup(entry) || isMultiAgentPersonaTile(entry);
}

/**
 * Test helper: assert a `RosterTileEntry` is a bare AgentTile (N=1, no
 * wrapper) and return it narrowed. Most pre-M3-10 reducer tests assume N=1
 * per persona — they fail fast if a wrapper appears unexpectedly.
 */
function expectTile(entry: RosterTileEntry | undefined): AgentTile {
  expect(entry).toBeDefined();
  expect(isAnyWrapper(entry!)).toBe(false);
  return entry as AgentTile;
}

/**
 * Test helper: assert a `RosterTileEntry` IS a `MultiAgentPersonaTile`
 * wrapper (86ca1dtr5 — supersedes the M3-10 CollapsedPersonaGroup for rostered
 * members) and return it narrowed. Used by the N≥2 grouping tests.
 */
function expectGroup(
  entry: RosterTileEntry | undefined,
): MultiAgentPersonaTile {
  expect(entry).toBeDefined();
  expect(isMultiAgentPersonaTile(entry!)).toBe(true);
  return entry as MultiAgentPersonaTile;
}

/**
 * Test helper: predicate "is there a tile with memberId X in this entry
 * list?". Narrows past any wrapper by descending into `instances` (for
 * MultiAgentPersonaTile the wrapper also carries `memberId` directly, but
 * descending covers both wrapper kinds uniformly).
 */
function hasTileForMember(
  entries: readonly RosterTileEntry[],
  memberId: string,
): boolean {
  return entries.some((e) =>
    isCollapsedPersonaGroup(e) || isMultiAgentPersonaTile(e)
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

/**
 * Felix-only roster — used by M3-10 grouping tests that assert exact tile
 * counts for a single persona. With ROSTER_ALPHA (felix + maya) the
 * 86ca18b9p baseline pass would seed an extra `available` maya tile that
 * pollutes the count assertions; a single-member roster keeps the M3-10
 * grouping behavior isolated (AC4 regression-guard: grouping logic is
 * unchanged; only the surrounding roster differs).
 */
const ROSTER_FELIX_ONLY: Team[] = [
  {
    id: "alpha",
    name: "ClaudeTeam Alpha",
    members: [
      {
        id: "felix",
        display: "Felix",
        role: "Extension Host Dev",
        match: [{ agentType_equals: "felix" }],
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

  it("returns a session with full-roster baseline tiles when agentData is empty (86ca18b9p)", () => {
    // Post-86ca18b9p: a session with zero detected agents no longer produces
    // an empty tree — every roster member is seeded as an `available`
    // baseline tile. ROSTER_ALPHA has felix + maya, so both appear available.
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
    // Team card now present (seeded), tiles all available.
    expect(s.teamOrder).toEqual(["alpha"]);
    const tiles = s.rosterTiles.get("alpha") ?? [];
    expect(tiles).toHaveLength(2);
    expect(hasTileForMember(tiles, "felix")).toBe(true);
    expect(hasTileForMember(tiles, "maya")).toBe(true);
    for (const entry of tiles) {
      const tile = expectTile(entry);
      expect(tile.state).toBe("available");
      expect(tile.activity).toBe("available");
      expect(tile.agentId).toBe("");
    }
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

    it("JSONL mtime < IDLE_THRESHOLD_MS ago → running", () => {
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

    it("JSONL mtime >= IDLE_THRESHOLD_MS ago → idle", () => {
      const session = makeSession();
      const agentId = "agent003";
      const meta = makeMeta({ agentType: "felix", description: "Felix idle" });
      const staleMtime = NOW_MS - IDLE_THRESHOLD_MS - 1_000; // 61s old (just past the 60s threshold)
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
      // Elapsed seconds derive from the threshold; with the 60s value this is ~61.
      const expectedElapsed = Math.round((IDLE_THRESHOLD_MS + 1_000) / 1000);
      const elapsed = parseInt(tile!.activity.replace("idle ", "").replace("s", ""), 10);
      expect(elapsed).toBeGreaterThanOrEqual(expectedElapsed);
    });

    // ----------------------- 86ca168j9 (idle debounce) -----------------------
    // Bug class: Claude Code flushes the sub-agent JSONL only on tool-call
    // completion, NOT during text generation. Measured generation gaps of
    // 20s–202s exceeded the OLD 10s cutoff, so an actively-generating agent
    // flickered to "idle" between tool calls. Sponsor raised IDLE_THRESHOLD_MS
    // to 60s so common generation gaps (the 20s–45s band) stay "running".
    it("~35s stale gap classifies running (would have been idle under the old 10s cutoff)", () => {
      const session = makeSession();
      const agentId = "agent168j9";
      const meta = makeMeta({ agentType: "felix", description: "Felix mid-generation gap" });
      // 35s gap: a representative text-generation pause between tool calls.
      // < 60s (new threshold) → running; was > 10s (old threshold) → idle.
      const activity = makeActivity({ mtimeMs: NOW_MS - 35_000 });
      const activities: ActivityMap = new Map([[agentId, activity]]);

      // Guard: this test only proves the regression is fixed if the gap sits
      // strictly between the old (10s) and new (60s) thresholds.
      expect(35_000).toBeGreaterThan(10_000);
      expect(35_000).toBeLessThan(IDLE_THRESHOLD_MS);

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
      // Negative path: the pre-fix "idle 35s" rendering must NOT appear.
      expect(tile!.activity).not.toMatch(/^idle /);
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
      // Post-86ca18b9p: an unmatched agent still buckets to background, but
      // the roster's felix + maya are now seeded as available baseline tiles,
      // so the team card is present (NOT empty as in the detected-only model).
      expect(s.teamOrder).toEqual(["alpha"]);
      const tiles = s.rosterTiles.get("alpha") ?? [];
      expect(tiles).toHaveLength(2);
      for (const entry of tiles) {
        expect(expectTile(entry).state).toBe("available");
      }
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

      // S1 detected felix; S2 detected maya. Post-86ca18b9p both sessions
      // ALSO carry a baseline `available` tile for the un-detected member
      // (S1 has available maya; S2 has available felix). The non-merge
      // guarantee is now expressed as "the DETECTED state lives only in the
      // session that detected it" — S1's felix is live, S2's felix is only
      // the baseline (and vice versa for maya).
      const s1Tiles = s1.rosterTiles.get("alpha") ?? [];
      const s2Tiles = s2.rosterTiles.get("alpha") ?? [];
      const findTile = (tiles: RosterTileEntry[], memberId: string): AgentTile => {
        const entry = tiles.find((e) =>
          !isCollapsedPersonaGroup(e) && e.memberId === memberId,
        );
        return expectTile(entry);
      };
      // S1: felix detected (not available), maya baseline (available).
      expect(findTile(s1Tiles, "felix").state).not.toBe("available");
      expect(findTile(s1Tiles, "maya").state).toBe("available");
      // S2: maya detected (not available), felix baseline (available).
      expect(findTile(s2Tiles, "maya").state).not.toBe("available");
      expect(findTile(s2Tiles, "felix").state).toBe("available");
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
      // Post-86ca18b9p: felix detected (running) + maya baseline (available)
      // → 2 rostered tiles. The unrostered Explore agent still buckets to
      // background (unchanged — §1.3 of the spec).
      const tiles = s.rosterTiles.get("alpha") ?? [];
      expect(tiles).toHaveLength(2);
      const felixTile = expectTile(
        tiles.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix"),
      );
      const mayaTile = expectTile(
        tiles.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya"),
      );
      expect(felixTile.state).not.toBe("available"); // detected
      expect(mayaTile.state).toBe("available"); // baseline
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
  it("session with no matching agentData entry → baseline-only roster tree (86ca18b9p)", () => {
    const session = makeSession();
    // Supply a different sessionId in agentData — no detected agents for our
    // session. Post-86ca18b9p the roster baseline still seeds available tiles.
    const tree = buildAgentTree(
      [session],
      [makeSessionData("different-session-id", [])],
      new Map(),
      new Map(),
      ROSTER_ALPHA,
      NOW_MS,
    );

    const s = tree.sessions[0]!;
    expect(s.teamOrder).toEqual(["alpha"]);
    const tiles = s.rosterTiles.get("alpha") ?? [];
    expect(tiles).toHaveLength(2);
    for (const entry of tiles) {
      expect(expectTile(entry).state).toBe("available");
    }
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

  // ---------------------------------------------------------------- 86ca03nww
  describe("customTitle + gitBranch projection (86ca03nww)", () => {
    it("customTitle from agentData lands on SessionTree", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [{ sessionId: session.sessionId, agents: [], customTitle: "claude team" }],
        new Map(),
        new Map(),
        [],
        NOW_MS,
      );
      expect(tree.sessions[0]!.customTitle).toBe("claude team");
    });

    it("gitBranch from agentData lands on SessionTree", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [{ sessionId: session.sessionId, agents: [], gitBranch: "felix/86ca03nww-x" }],
        new Map(),
        new Map(),
        [],
        NOW_MS,
      );
      expect(tree.sessions[0]!.gitBranch).toBe("felix/86ca03nww-x");
    });

    it("both fields absent → SessionTree omits them (back-compat wire shape)", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [])],
        new Map(),
        new Map(),
        [],
        NOW_MS,
      );
      // Use Object.prototype.hasOwnProperty so the assertion fails if a future
      // refactor accidentally emits `customTitle: undefined` (which would
      // pollute the wire shape — see spread-only-when-defined pattern in
      // reducer.ts).
      const s = tree.sessions[0]!;
      expect(Object.prototype.hasOwnProperty.call(s, "customTitle")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(s, "gitBranch")).toBe(false);
    });

    it("both fields populated → SessionTree carries both verbatim", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [
          {
            sessionId: session.sessionId,
            agents: [],
            title: "AI-generated",
            customTitle: "Sponsor rename",
            gitBranch: "main",
          },
        ],
        new Map(),
        new Map(),
        [],
        NOW_MS,
      );
      const s = tree.sessions[0]!;
      expect(s.title).toBe("AI-generated");
      expect(s.customTitle).toBe("Sponsor rename");
      expect(s.gitBranch).toBe("main");
    });
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
    it("AC1: N=3 same-persona tiles collapse into one MultiAgentPersonaTile wrapper (86ca1dtr5)", () => {
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
        ROSTER_FELIX_ONLY,
        NOW_MS,
        // Default options — collapse ON.
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const group = expectGroup(entries[0]);
      expect(group.kind).toBe("multi-agent-persona");
      // 86ca1dtr5: the wrapper carries the FULL member identity at top-level
      // (option A — it's a full persona tile, not a bare header).
      expect(group.memberId).toBe("felix");
      expect(group.teamId).toBe("alpha");
      expect(group.display).toBe("Felix");
      expect(group.role).toBe("Extension Host Dev");
      expect(group.count).toBe(3);
      expect(group.instances).toHaveLength(3);
      // All three running → aggregate is running; headline activity/model
      // come from the headline (first running) instance.
      expect(group.aggregateState).toBe("running");
      expect(group.headlineActivity).toBe(group.instances[0]!.activity);
      expect(group.headlineModel).toBe(group.instances[0]!.model);
      // Per-instance shape unchanged.
      for (const inst of group.instances) {
        expect(inst.memberId).toBe("felix");
        expect(inst.display).toBe("Felix");
        expect(inst.state).toBe("running");
        expect(inst.teamId).toBe("alpha");
        expect(inst.role).toBe("Extension Host Dev");
        // 86ca1dtr5: each instance carries its own sessionId.
        expect(inst.sessionId).toBe(session.sessionId);
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
        ROSTER_FELIX_ONLY,
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
        ROSTER_FELIX_ONLY,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      // Three background agents — flat list, no group wrapper.
      expect(s.background).toHaveLength(3);
      // Post-86ca18b9p: the roster's felix is seeded as an available baseline
      // tile (AC4 regression-guard — grouping still bypasses background; the
      // only rostered entry is the bare baseline, never a CollapsedPersonaGroup).
      const entries = s.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const baseline = expectTile(entries[0]);
      expect(baseline.memberId).toBe("felix");
      expect(baseline.state).toBe("available");
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
        ROSTER_FELIX_ONLY,
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
        ROSTER_FELIX_ONLY,
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
        ROSTER_FELIX_ONLY,
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
      expect(felixGroup.display).toBe("Felix");
      expect(felixGroup.memberId).toBe("felix");
      expect(felixGroup.instances[0]!.memberId).toBe("felix");
      expect(felixGroup.count).toBe(2);
      const mayaTile = expectTile(alpha[1]);
      expect(mayaTile.memberId).toBe("maya");
      // Background unchanged.
      expect(s.background).toHaveLength(1);
      expect(s.background[0]!.agentType).toBe("general-purpose");
    });

    it("groupTilesByPersona orders instances most-active-first, ties by agentId (86ca1dtr5)", () => {
      // Direct exercise of the exported helper — pin the order contract:
      // instances[] are ordered most-active-first (running → error → idle →
      // finished → available); ties broken by agentId lexical order. Here all
      // three are running, so they sort by agentId: first < second < third.
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
      expect(fg.display).toBe("Felix");
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
    it("MultiAgentPersonaTile wrapper round-trips through JSON.stringify cleanly", () => {
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
      expect((wire as MultiAgentPersonaTile).kind).toBe("multi-agent-persona");
      expect((wire as MultiAgentPersonaTile).count).toBe(2);
      expect((wire as MultiAgentPersonaTile).instances).toHaveLength(2);
      expect((wire as MultiAgentPersonaTile).aggregateState).toBe("running");
    });
  });

  // ---------------------------------------------------------------- 86ca1dtr5 — multi-agent persona tile (host aggregate + headline + instance list)
  describe("86ca1dtr5 — multi-agent persona tile emit", () => {
    // Two felix agents in one session with controllable states. agent "felix-a"
    // is the lexically-first id; "felix-b" second. State is driven by activity
    // mtime (fresh → running, stale → idle) and finishedIds membership.
    const ROSTER_FELIX: Team[] = [
      {
        id: "alpha",
        name: "ClaudeTeam Alpha",
        members: [
          {
            id: "felix",
            display: "Felix",
            role: "Extension Host Dev",
            color: "#5d8aa8",
            match: [{ agentType_equals: "felix" }],
          },
        ],
      },
    ];

    function felixMeta(n: number): AgentMeta {
      return makeMeta({
        agentType: "felix",
        description: `Felix #${n}`,
        toolUseId: `toolu_felix_${n}`,
      });
    }

    /** Build a 2-felix-instance tree with explicit per-agent activity + finished. */
    function buildTwoFelix(opts: {
      aActivity?: SubagentActivity;
      bActivity?: SubagentActivity;
      finished?: FinishedMap;
    }) {
      const session = makeSession();
      const agents: AgentMetaEntry[] = [
        makeAgentEntry("felix-a", felixMeta(1)),
        makeAgentEntry("felix-b", felixMeta(2)),
      ];
      const activities: ActivityMap = new Map();
      if (opts.aActivity) activities.set("felix-a", opts.aActivity);
      if (opts.bActivity) activities.set("felix-b", opts.bActivity);
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, agents)],
        activities,
        opts.finished ?? new Map(),
        ROSTER_FELIX,
        NOW_MS,
      );
      return { tree, sessionId: session.sessionId };
    }

    const FRESH = (): SubagentActivity =>
      makeActivity({ mtimeMs: NOW_MS - 2_000, lastTool: "Edit" }); // running
    const STALE = (): SubagentActivity =>
      makeActivity({ mtimeMs: NOW_MS - IDLE_THRESHOLD_MS - 5_000, lastTool: "Read" }); // idle

    it("emits ONE MultiAgentPersonaTile per rostered member with N≥2 live agents", () => {
      const { tree } = buildTwoFelix({ aActivity: FRESH(), bActivity: FRESH() });
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const group = expectGroup(entries[0]);
      expect(group.kind).toBe("multi-agent-persona");
      expect(group.count).toBe(2);
      expect(group.instances).toHaveLength(2);
      // memberColor projected onto the wrapper (running aggregate uses it).
      expect(group.memberColor).toBe("#5d8aa8");
    });

    it("aggregate running when one instance running, one finished", () => {
      const finished: FinishedMap = new Map([["felix-b", NOW_MS - 3_000]]);
      const { tree } = buildTwoFelix({
        aActivity: FRESH(),
        bActivity: makeActivity({ mtimeMs: NOW_MS - 1_000 }),
        finished,
      });
      const group = expectGroup(
        tree.sessions[0]!.rosterTiles.get("alpha")?.[0],
      );
      expect(group.aggregateState).toBe("running");
      // Headline = the running instance (felix-a). Its activity drives row 3.
      const runningInst = group.instances.find((i) => i.state === "running")!;
      expect(group.headlineActivity).toBe(runningInst.activity);
      expect(group.headlineModel).toBe(runningInst.model);
    });

    it("aggregate idle when one instance idle, one finished (idle outranks finished)", () => {
      const finished: FinishedMap = new Map([["felix-b", NOW_MS - 3_000]]);
      const { tree } = buildTwoFelix({
        aActivity: STALE(),
        bActivity: makeActivity({ mtimeMs: NOW_MS - 1_000 }),
        finished,
      });
      const group = expectGroup(
        tree.sessions[0]!.rosterTiles.get("alpha")?.[0],
      );
      expect(group.aggregateState).toBe("idle");
    });

    it("aggregate finished when both instances finished; headline = last-to-finish", () => {
      const finished: FinishedMap = new Map([
        ["felix-a", NOW_MS - 9_000],
        ["felix-b", NOW_MS - 2_000], // later finish → headline
      ]);
      const { tree } = buildTwoFelix({
        aActivity: makeActivity({ mtimeMs: NOW_MS - 9_000 }),
        bActivity: makeActivity({ mtimeMs: NOW_MS - 2_000 }),
        finished,
      });
      const group = expectGroup(
        tree.sessions[0]!.rosterTiles.get("alpha")?.[0],
      );
      expect(group.aggregateState).toBe("finished");
      // Headline = felix-b (largest finishedAtMs).
      const headlineInst = group.instances.find(
        (i) => i.activity === group.headlineActivity,
      )!;
      expect(headlineInst.agentId).toBe("felix-b");
    });

    it("instances ordered most-active-first: running leads finished", () => {
      const finished: FinishedMap = new Map([["felix-a", NOW_MS - 3_000]]);
      const { tree } = buildTwoFelix({
        aActivity: makeActivity({ mtimeMs: NOW_MS - 3_000 }), // finished (in finishedIds)
        bActivity: FRESH(), // running
        finished,
      });
      const group = expectGroup(
        tree.sessions[0]!.rosterTiles.get("alpha")?.[0],
      );
      // felix-b is running → must lead; felix-a finished → trails, despite
      // lexical order putting felix-a first.
      expect(group.instances[0]!.state).toBe("running");
      expect(group.instances[0]!.agentId).toBe("felix-b");
      expect(group.instances[1]!.state).toBe("finished");
    });

    it("every instance carries its own sessionId (cross-session drill-in support)", () => {
      const { tree, sessionId } = buildTwoFelix({
        aActivity: FRESH(),
        bActivity: FRESH(),
      });
      const group = expectGroup(
        tree.sessions[0]!.rosterTiles.get("alpha")?.[0],
      );
      for (const inst of group.instances) {
        expect(inst.sessionId).toBe(sessionId);
      }
    });

    it("single-agent path unaffected: N=1 → bare AgentTile (no wrapper)", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [
          makeSessionData(session.sessionId, [
            makeAgentEntry("felix-solo", felixMeta(1)),
          ]),
        ],
        new Map([["felix-solo", FRESH()]]),
        new Map(),
        ROSTER_FELIX,
        NOW_MS,
      );
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const tile = expectTile(entries[0]);
      expect(tile.memberId).toBe("felix");
      expect("kind" in tile).toBe(false);
      expect(tile.sessionId).toBe(session.sessionId);
    });

    it("zero-agent path unaffected: never-run member → available baseline (no wrapper)", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [])],
        new Map(),
        new Map(),
        ROSTER_FELIX,
        NOW_MS,
      );
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(entries).toHaveLength(1);
      const tile = expectTile(entries[0]);
      expect(tile.state).toBe("available");
      expect("kind" in tile).toBe(false);
    });
  });

  // =========================================================================
  // 86c9zq9vm (spec 86c9zmyef §2.2) — memberColor projection from roster onto
  // AgentTile. The reducer is a pure projector — it copies the
  // already-validated `Member.color` (loader-normalized) onto the tile when
  // present, and omits the field when absent.
  // =========================================================================
  describe("memberColor projection (86c9zq9vm — spec 86c9zmyef)", () => {
    const ROSTER_WITH_COLORS: Team[] = [
      {
        id: "alpha",
        name: "ClaudeTeam Alpha",
        members: [
          {
            id: "felix",
            display: "Felix",
            role: "Extension Host Dev",
            color: "#5d8aa8",
            match: [{ agentType_equals: "felix" }],
          },
          {
            id: "maya",
            display: "Maya",
            role: "Webview UI Dev",
            // No color — projection must omit the field on the tile.
            match: [{ agentType_equals: "maya" }],
          },
        ],
      },
    ];

    it("stamps memberColor on the tile when roster member.color is set", () => {
      const session = makeSession();
      const agentId = "agent-felix-01";
      const meta = makeMeta({
        agentType: "felix",
        description: "Felix host plumb",
      });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_COLORS,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.memberId).toBe("felix");
      expect(tile!.memberColor).toBe("#5d8aa8");
    });

    it("omits memberColor (undefined) when roster member.color is absent", () => {
      const session = makeSession();
      const agentId = "agent-maya-01";
      const meta = makeMeta({
        agentType: "maya",
        description: "Maya webview",
      });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_COLORS,
        NOW_MS,
      );

      // Post-86ca18b9p: felix (with color) is seeded as an available baseline
      // and sorts first by member-declaration order, so fetch maya by id
      // rather than positionally.
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const tile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya"),
      );
      expect(tile!.memberId).toBe("maya");
      // maya is the DETECTED tile (not the baseline) — color omitted because
      // the roster member has no color set.
      expect(tile!.state).not.toBe("available");
      expect(tile!.memberColor).toBeUndefined();
      // Absent in JSON shape — `"memberColor"` key not present at all.
      expect(Object.prototype.hasOwnProperty.call(tile, "memberColor")).toBe(
        false,
      );
    });

    it("memberColor survives JSON.stringify (wire-shape safe)", () => {
      const session = makeSession();
      const agentId = "agent-felix-02";
      const meta = makeMeta({
        agentType: "felix",
        description: "Felix runtime",
      });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_COLORS,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      const wire = JSON.parse(JSON.stringify(tile)) as { memberColor?: string };
      expect(wire.memberColor).toBe("#5d8aa8");
    });

    it("works regardless of liveness state — idle tiles also carry the color", () => {
      const session = makeSession();
      const agentId = "agent-felix-03";
      const meta = makeMeta({
        agentType: "felix",
        description: "Felix idle",
      });
      // Stale mtime → idle. Stamp memberColor regardless — webview decides
      // whether to paint the dot in this color (running-only per spec §1.3).
      const activities: ActivityMap = new Map([
        [agentId, makeActivity({ mtimeMs: NOW_MS - 60_000 })],
      ]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_COLORS,
        NOW_MS,
      );

      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.state).toBe("idle");
      expect(tile!.memberColor).toBe("#5d8aa8");
    });
  });

  // =========================================================================
  // 86ca1nzde — character projection from roster Member.character onto the
  // tile (single-agent, baseline, and multi-agent wrapper paths). The reducer
  // is a pure projector: it stamps a NON-EMPTY character id onto the tile and
  // omits the field for `null` / `undefined` / "" so the webview's gender
  // fall-back is preserved. #136 persisted `Member.character` but never
  // stamped `tile.character`; this fixes that gap.
  // =========================================================================
  describe("character projection (86ca1nzde)", () => {
    const ROSTER_WITH_CHARS: Team[] = [
      {
        id: "alpha",
        name: "ClaudeTeam Alpha",
        members: [
          {
            id: "felix",
            display: "Felix",
            role: "Extension Host Dev",
            character: "knight-m01",
            match: [{ agentType_equals: "felix" }],
          },
          {
            id: "maya",
            display: "Maya",
            role: "Webview UI Dev",
            // character null → explicit "fall back" (text-tile per type doc);
            // the AC collapses null to the gender fall-back (field omitted).
            character: null,
            match: [{ agentType_equals: "maya" }],
          },
          {
            id: "bram",
            display: "Bram",
            role: "Research",
            // No character key at all → undefined → fall back, field omitted.
            match: [{ agentType_equals: "bram" }],
          },
        ],
      },
    ];

    it("stamps character on a live tile when member.character is a non-empty id", () => {
      const session = makeSession();
      const agentId = "agent-felix-01";
      const meta = makeMeta({ agentType: "felix", description: "Felix host" });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_CHARS,
        NOW_MS,
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const tile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix"),
      );
      expect(tile!.character).toBe("knight-m01");
    });

    it("omits character when member.character is null (fall-back preserved)", () => {
      const session = makeSession();
      const agentId = "agent-maya-01";
      const meta = makeMeta({ agentType: "maya", description: "Maya webview" });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_CHARS,
        NOW_MS,
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const tile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya"),
      );
      expect(tile!.state).not.toBe("available");
      expect(tile!.character).toBeUndefined();
      // Field truly absent from the wire shape (not just undefined-valued).
      expect(Object.prototype.hasOwnProperty.call(tile, "character")).toBe(
        false,
      );
    });

    it("omits character when member.character key is absent (fall-back preserved)", () => {
      const session = makeSession();
      const agentId = "agent-bram-01";
      const meta = makeMeta({ agentType: "bram", description: "Bram research" });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_WITH_CHARS,
        NOW_MS,
      );

      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const tile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "bram"),
      );
      expect(tile!.character).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(tile, "character")).toBe(
        false,
      );
    });

    it("omits character for an empty-string id (treated as fall-back)", () => {
      const roster: Team[] = [
        {
          id: "alpha",
          name: "Alpha",
          members: [
            {
              id: "felix",
              display: "Felix",
              role: "Host",
              character: "",
              match: [{ agentType_equals: "felix" }],
            },
          ],
        },
      ];
      const session = makeSession();
      const agentId = "agent-felix-empty";
      const meta = makeMeta({ agentType: "felix", description: "Felix" });
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        new Map([[agentId, makeActivity()]]),
        new Map(),
        roster,
        NOW_MS,
      );
      const tile = expectTile(tree.sessions[0]!.rosterTiles.get("alpha")?.[0]);
      expect(tile!.character).toBeUndefined();
    });

    it("stamps character on a never-run baseline tile", () => {
      const session = makeSession();
      // No detected agents → felix is seeded as an `available` baseline.
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [])],
        new Map(),
        new Map(),
        ROSTER_WITH_CHARS,
        NOW_MS,
      );
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const tile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix"),
      );
      expect(tile!.state).toBe("available");
      expect(tile!.character).toBe("knight-m01");
      // maya baseline (null) omits the field.
      const mayaTile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya"),
      );
      expect(mayaTile!.character).toBeUndefined();
    });

    it("mirrors character onto a MultiAgentPersonaTile wrapper (N≥2)", () => {
      const session = makeSession();
      const agents: AgentMetaEntry[] = [
        makeAgentEntry(
          "felix-a",
          makeMeta({ agentType: "felix", description: "Felix #1", toolUseId: "t1" }),
        ),
        makeAgentEntry(
          "felix-b",
          makeMeta({ agentType: "felix", description: "Felix #2", toolUseId: "t2" }),
        ),
      ];
      const activities: ActivityMap = new Map([
        ["felix-a", makeActivity()],
        ["felix-b", makeActivity()],
      ]);
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, agents)],
        activities,
        new Map(),
        ROSTER_WITH_CHARS,
        NOW_MS,
      );
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const group = expectGroup(
        entries.find((e) => isMultiAgentPersonaTile(e) && e.memberId === "felix"),
      );
      expect(group.count).toBe(2);
      expect(group.character).toBe("knight-m01");
      // Each instance also carries the stamped character.
      for (const inst of group.instances) {
        expect(inst.character).toBe("knight-m01");
      }
    });

    it("character survives JSON.stringify (wire-shape safe)", () => {
      const session = makeSession();
      const agentId = "agent-felix-wire";
      const meta = makeMeta({ agentType: "felix", description: "Felix" });
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        new Map([[agentId, makeActivity()]]),
        new Map(),
        ROSTER_WITH_CHARS,
        NOW_MS,
      );
      const entries = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      const tile = expectTile(
        entries.find((e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix"),
      );
      const wire = JSON.parse(JSON.stringify(tile)) as { character?: string };
      expect(wire.character).toBe("knight-m01");
    });
  });

  // =========================================================================
  // 86ca18b9p — roster-baseline tile seeding (EPIC 86ca11187).
  //
  // Every teams.yaml member ALWAYS gets a tile; un-detected members are
  // seeded as `available` baselines; detected agents overlay their live state
  // and win the slot (no dup per memberId). AC6: all-baseline / partial /
  // overlay / empty-roster / member-order.
  // =========================================================================
  describe("baseline-tile seeding (86ca18b9p)", () => {
    // Three-member, two-team roster to exercise member-order + multi-team.
    const ROSTER_MULTI: Team[] = [
      {
        id: "alpha",
        name: "ClaudeTeam Alpha",
        members: [
          { id: "felix", display: "Felix", role: "Host Dev", match: [{ agentType_equals: "felix" }] },
          { id: "maya", display: "Maya", role: "Webview Dev", match: [{ agentType_equals: "maya" }] },
          { id: "bram", display: "Bram", role: "Research", match: [{ agentType_equals: "bram" }] },
        ],
      },
      {
        id: "beta",
        name: "ClaudeTeam Beta",
        members: [
          { id: "sage", display: "Sage", role: "QA", match: [{ agentType_equals: "sage" }] },
        ],
      },
    ];

    function tilesFor(team: string, session = 0) {
      return (entry: ReturnType<typeof buildAgentTree>) =>
        entry.sessions[session]!.rosterTiles.get(team) ?? [];
    }

    it("buildActivity('available') → literal 'available' (no tool line, no elapsed)", () => {
      expect(buildActivity("available", undefined, NOW_MS)).toBe("available");
      // Even if an activity object is somehow passed, available ignores it.
      expect(buildActivity("available", makeActivity(), NOW_MS)).toBe("available");
    });

    it("AC6 all-baseline: zero detected agents → every roster member seeded available", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [])],
        new Map(),
        new Map(),
        ROSTER_MULTI,
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.teamOrder).toEqual(["alpha", "beta"]);
      const alpha = tilesFor("alpha")(tree);
      const beta = tilesFor("beta")(tree);
      expect(alpha.map((e) => expectTile(e).memberId)).toEqual(["felix", "maya", "bram"]);
      expect(beta.map((e) => expectTile(e).memberId)).toEqual(["sage"]);
      for (const entry of [...alpha, ...beta]) {
        const tile = expectTile(entry);
        expect(tile.state).toBe("available");
        expect(tile.activity).toBe("available");
        expect(tile.model).toBe("model:?");
        expect(tile.agentId).toBe("");
        expect(tile.toolUseId).toBeNull();
      }
    });

    it("AC6 partial: one detected member + two baselines in the same team", () => {
      const session = makeSession();
      const agentId = "agent-maya-live";
      const meta = makeMeta({ agentType: "maya", description: "Maya live" });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_MULTI,
        NOW_MS,
      );

      const alpha = tilesFor("alpha")(tree);
      // Member-declaration order preserved even with one overlay (AC6 order).
      expect(alpha.map((e) => expectTile(e).memberId)).toEqual(["felix", "maya", "bram"]);
      const byId = (id: string) =>
        expectTile(alpha.find((e) => expectTile(e).memberId === id));
      expect(byId("felix").state).toBe("available"); // baseline
      expect(byId("maya").state).toBe("running"); // detected overlay
      expect(byId("maya").agentId).toBe(agentId);
      expect(byId("bram").state).toBe("available"); // baseline
      // Sage (beta) still seeded available.
      expect(expectTile(tilesFor("beta")(tree)[0]).state).toBe("available");
    });

    it("AC6 overlay: detected agent wins the slot — no duplicate baseline per memberId", () => {
      const session = makeSession();
      const agentId = "agent-felix-live";
      const meta = makeMeta({ agentType: "felix", description: "Felix live" });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [makeAgentEntry(agentId, meta)])],
        activities,
        new Map(),
        ROSTER_MULTI,
        NOW_MS,
      );

      const alpha = tilesFor("alpha")(tree);
      // Exactly one felix tile — the detected one, not a baseline + a live dup.
      const felixTiles = alpha.filter((e) => expectTile(e).memberId === "felix");
      expect(felixTiles).toHaveLength(1);
      expect(expectTile(felixTiles[0]).state).toBe("running");
      expect(expectTile(felixTiles[0]).agentId).toBe(agentId);
      // Total alpha tiles = 3 (felix live + maya/bram baselines), not 4.
      expect(alpha).toHaveLength(3);
    });

    it("AC6 overlay (N>1 collapsed): multi-agent-persona group is NOT shadowed by a baseline", () => {
      // When a member has N>1 detected tiles (MultiAgentPersonaTile), the
      // baseline pass must still treat that member as detected → no baseline.
      const session = makeSession();
      const agents: AgentMetaEntry[] = [
        makeAgentEntry("felix-a", makeMeta({ agentType: "felix", description: "A", toolUseId: "t1" })),
        makeAgentEntry("felix-b", makeMeta({ agentType: "felix", description: "B", toolUseId: "t2" })),
      ];
      const activities: ActivityMap = new Map([
        ["felix-a", makeActivity()],
        ["felix-b", makeActivity({ lastTool: "Bash" })],
      ]);

      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, agents)],
        activities,
        new Map(),
        ROSTER_MULTI,
        NOW_MS,
      );

      const alpha = tilesFor("alpha")(tree);
      // felix → one MultiAgentPersonaTile (count 2); maya + bram baselines.
      const felixGroup = expectGroup(alpha[0]);
      expect(felixGroup.display).toBe("Felix");
      expect(felixGroup.count).toBe(2);
      // No bare felix baseline tile alongside the group.
      const bareFelix = alpha.filter(
        (e) => !isAnyWrapper(e) && (e as AgentTile).memberId === "felix",
      );
      expect(bareFelix).toHaveLength(0);
      // maya + bram still seeded available.
      expect(hasTileForMember(alpha, "maya")).toBe(true);
      expect(hasTileForMember(alpha, "bram")).toBe(true);
    });

    it("AC6 empty roster: no baseline tiles seeded (nothing to seed)", () => {
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [])],
        new Map(),
        new Map(),
        [], // empty roster
        NOW_MS,
      );

      const s = tree.sessions[0]!;
      expect(s.teamOrder).toHaveLength(0);
      expect(s.rosterTiles.size).toBe(0);
      expect(s.background).toHaveLength(0);
    });

    it("AC6 member-order: baseline tiles sort in roster member-declaration order", () => {
      // Reverse the declared order in the roster to prove the reducer sorts
      // by declaration index, not by insertion/seed order.
      const rosterReversed: Team[] = [
        {
          id: "alpha",
          name: "Alpha",
          members: [
            { id: "zeta", display: "Zeta", role: "R", match: [{ agentType_equals: "zeta" }] },
            { id: "alpha-m", display: "AlphaM", role: "R", match: [{ agentType_equals: "alpha-m" }] },
            { id: "mid", display: "Mid", role: "R", match: [{ agentType_equals: "mid" }] },
          ],
        },
      ];
      const session = makeSession();
      const tree = buildAgentTree(
        [session],
        [makeSessionData(session.sessionId, [])],
        new Map(),
        new Map(),
        rosterReversed,
        NOW_MS,
      );

      const alpha = tree.sessions[0]!.rosterTiles.get("alpha") ?? [];
      expect(alpha.map((e) => expectTile(e).memberId)).toEqual(["zeta", "alpha-m", "mid"]);
    });

    it("AC6 multi-session: each session seeds its own independent baseline set", () => {
      const s1 = makeSession({ pid: 1, sessionId: "11111111-0000-0000-0000-000000000001" });
      const s2 = makeSession({ pid: 2, sessionId: "22222222-0000-0000-0000-000000000002" });
      // s1 detects felix; s2 detects nothing.
      const agentId = "felix-s1";
      const meta = makeMeta({ agentType: "felix", description: "Felix S1" });
      const activities: ActivityMap = new Map([[agentId, makeActivity()]]);

      const tree = buildAgentTree(
        [s1, s2],
        [
          makeSessionData(s1.sessionId, [makeAgentEntry(agentId, meta)]),
          makeSessionData(s2.sessionId, []),
        ],
        activities,
        new Map(),
        ROSTER_MULTI,
        NOW_MS,
      );

      const a1 = tilesFor("alpha", 0)(tree);
      const a2 = tilesFor("alpha", 1)(tree);
      // s1: felix detected, maya/bram baseline.
      const f1 = expectTile(a1.find((e) => expectTile(e).memberId === "felix"));
      expect(f1.state).toBe("running");
      // s2: felix baseline (independent — s1's detection doesn't leak).
      const f2 = expectTile(a2.find((e) => expectTile(e).memberId === "felix"));
      expect(f2.state).toBe("available");
    });
  });
});
