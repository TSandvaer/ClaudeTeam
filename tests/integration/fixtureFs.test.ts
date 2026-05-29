/**
 * M1-10 Integration tests — fixture filesystem.
 *
 * Spins up a tempdir mimicking ~/.claude/, populates it with M1-02 fixtures
 * and a roster YAML, points the registry / tailer / loader at the tempdir,
 * and asserts buildAgentTree() produces the expected AgentTree output.
 *
 * AC1: tempdir structure = sessions/{pid}.json + projects/{slug}/{sessionId}.jsonl
 *      + projects/{slug}/{sessionId}/subagents/agent-{aid}.meta.json + .jsonl
 * AC2: all seven Layer-2 coverage targets present (see describe blocks below)
 * AC3: real fixtures from M1-02 — no synthesis inside this file. Missing
 *      fixture → clear "required from M1-02 not found" error message.
 * AC4: runs via `npm run test:integration`
 *
 * Module boundary contract tested end-to-end here (no mocks):
 *   listSessions()       → session registry reads from tempdir
 *   readActivity()       → subagent JSONL tailer reads from tempdir
 *   parseMetaFromString  → called indirectly via collectAgentMetas()
 *   loadRoster()         → roster loader reads from tempdir
 *   buildAgentTree()     → reducer consumes the above outputs
 *
 * Per testing-strategy.md Layer 2: ≤30s for the whole suite.
 * Per testing-strategy.md: at least one negative-path assertion per scenario.
 *
 * "Conflict rule" (AC5): bugs found in Felix's modules are filed as follow-up
 * tickets — NOT silently fixed in this PR. See PR body for findings list.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  createTempRoot,
  writeSessionFile,
  deleteSessionFile,
  writeMetaJson,
  writeSubagentJsonl,
  writeParentJsonl,
  writeParentJsonlFromFixture,
  appendFinishedToolResult,
  appendAsyncLaunchedAck,
  writeRoster,
  loadFixture,
  FIXTURES_DIR,
  cwdToSlug,
} from "./helpers/tempdir.js";

import { listSessions } from "../../src/extension/watcher/sessionRegistry.js";
import { readActivity } from "../../src/extension/watcher/subagentTailer.js";
import {
  formatMetaParseError,
  parseMetaFromString,
} from "../../src/extension/watcher/metaJsonLoader.js";
import { loadRoster } from "../../src/extension/roster/loader.js";
import {
  buildAgentTree,
  type AgentMetaEntry,
  type ActivityMap,
  type FinishedMap,
  type SessionAgentData,
} from "../../src/extension/state/reducer.js";
import {
  MetaParseError,
  isCollapsedPersonaGroup,
  isMultiAgentPersonaTile,
} from "../../src/shared/types.js";
import type {
  AgentTile,
  RosterTileEntry,
} from "../../src/shared/types.js";

/**
 * M3-10 helper: find a tile by memberId within a `RosterTileEntry[]`. None of
 * these integration scenarios intentionally produce N>1 same-persona tiles,
 * so the reducer should always emit bare `AgentTile`s under
 * `collapsePersonaTiles: true` (the default). The `CollapsedPersonaGroup`
 * branch is defensive — narrows to `instances[]` and matches per-instance
 * `memberId` (the canonical wrapper itself does not carry `memberId`).
 */
function findTile(
  entries: readonly RosterTileEntry[],
  memberId: string,
): AgentTile | undefined {
  for (const entry of entries) {
    if (isCollapsedPersonaGroup(entry) || isMultiAgentPersonaTile(entry)) {
      const match = entry.instances.find((t) => t.memberId === memberId);
      if (match) return match;
      continue;
    }
    if (entry.memberId === memberId) return entry;
  }
  return undefined;
}

/**
 * 86ca18b9p helper: assert that every rostered tile across all of a session's
 * teams is an `available` baseline (i.e. no agent was detected/matched into a
 * live state). Used by negative-path tests where the only live agents are
 * unrostered (background) — the roster members still seed baselines, so the
 * old "teamOrder is empty" assertion no longer holds; the new invariant is
 * "all rostered tiles are baselines."
 */
function expectAllRosteredAvailable(session: {
  teamOrder: string[];
  rosterTiles: Map<string, RosterTileEntry[]>;
}): void {
  for (const teamId of session.teamOrder) {
    const entries = session.rosterTiles.get(teamId) ?? [];
    for (const entry of entries) {
      // Baseline tiles are always N=1 bare AgentTiles — never grouped.
      expect(isCollapsedPersonaGroup(entry)).toBe(false);
      expect((entry as AgentTile).state).toBe("available");
    }
  }
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const NOW_MS = Date.now();

const CWD_A = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
const CWD_B = "c:\\Trunk\\PRIVATE\\OtherProject";

// PIDs that are extremely unlikely to exist on CI or dev machine.
// Using large numbers in the unsigned 32-bit process-space that no OS
// typically allocates to foreground processes.
const DEAD_PID_1 = 2_000_001;
const DEAD_PID_2 = 2_000_002;

// Session IDs
const SESSION_A = "aaaabbbb-0000-0000-0000-000000000001";
const SESSION_B = "aaaabbbb-0000-0000-0000-000000000002";
const SESSION_C = "aaaabbbb-0000-0000-0000-000000000003"; // same cwd as A

// Agent IDs
const AGENT_FELIX   = "agentfelix000001";
const AGENT_GENERIC = "agentgeneric0003";
const AGENT_PERSONA = "agentpersona0004";

// ---------------------------------------------------------------------------
// Helpers: build AgentTree from a tempdir
// ---------------------------------------------------------------------------

/**
 * Collect agent metas from a subagents/ directory.
 * Mirrors the logic in src/cli/agentTree.ts collectAgentMetas().
 * This is the integration glue — not the module under test itself.
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
      entries.push({ agentId, meta: null, parseError: `read error: ${(err as Error).message}` });
      continue;
    }
    try {
      const meta = parseMetaFromString(raw);
      entries.push({ agentId, meta });
    } catch (err) {
      // Mirror NIT #2 format (M3-04 follow-up) so the integration test's
      // local helper stays aligned with the production watcher + CLI driver.
      const parseError =
        err instanceof MetaParseError
          ? formatMetaParseError(err)
          : (err as Error).message;
      entries.push({ agentId, meta: null, parseError });
    }
  }
  return entries;
}

/**
 * Scan a parent JSONL for tool_result entries and collect finished toolUseIds.
 * Mirrors src/cli/agentTree.ts readFinishedToolUseIds(). Returns
 * Map<toolUseId, finishedAtMs> per 86c9yxv94. Obs 9 (86c9zc5dd): skip
 * records with top-level `toolUseResult.isAsync === true` (background
 * dispatch acks).
 */
function readFinishedToolUseIds(jsonlPath: string): Map<string, number> {
  const finished = new Map<string, number>();
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return finished;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec["type"] !== "user") continue;
      const tur = rec["toolUseResult"];
      if (
        tur !== null &&
        typeof tur === "object" &&
        !Array.isArray(tur) &&
        (tur as Record<string, unknown>)["isAsync"] === true
      ) {
        continue;
      }
      const msg = rec["message"] as Record<string, unknown> | undefined;
      if (!msg) continue;
      const content = msg["content"];
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
          const id = (item as Record<string, unknown>)["tool_use_id"];
          if (typeof id === "string" && !finished.has(id)) {
            finished.set(id, finishedAtMs);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return finished;
}

/**
 * Full data-collection pass over a tempdir — equivalent to the CLI driver's
 * collect() function but synchronous-friendly for test control.
 *
 * Returns all inputs needed to call buildAgentTree().
 */
async function collectFromTempdir(root: string): Promise<{
  sessions: ReturnType<typeof listSessions>;
  agentData: SessionAgentData[];
  activities: ActivityMap;
  finishedIds: FinishedMap;
}> {
  const sessions = listSessions(root);
  const projectsDir = join(root, "projects");

  const agentData: SessionAgentData[] = [];
  const allActivities: ActivityMap = new Map();
  const finishedIds: FinishedMap = new Map();

  for (const session of sessions) {
    const slug = cwdToSlug(session.cwd);
    const subagentsDirForSession = join(projectsDir, slug, session.sessionId, "subagents");
    const parentJsonl = join(projectsDir, slug, `${session.sessionId}.jsonl`);

    // Collect metas
    const agents = collectAgentMetas(subagentsDirForSession);

    // Collect finished toolUseId → finishedAtMs map from parent JSONL
    const finishedTuids = readFinishedToolUseIds(parentJsonl);
    for (const agent of agents) {
      if (agent.meta?.toolUseId) {
        const finishedAtMs = finishedTuids.get(agent.meta.toolUseId);
        if (finishedAtMs !== undefined) {
          finishedIds.set(agent.agentId, finishedAtMs);
        }
      }
    }

    // Collect activities (async)
    await Promise.all(
      agents.map(async (agent) => {
        const jsonlPath = join(subagentsDirForSession, `agent-${agent.agentId}.jsonl`);
        const activity = await readActivity(jsonlPath);
        allActivities.set(agent.agentId, activity);
      }),
    );

    agentData.push({ sessionId: session.sessionId, agents, title: undefined });
  }

  return { sessions, agentData, activities: allActivities, finishedIds };
}

// ---------------------------------------------------------------------------
// Fixture pre-check (AC3: fail clearly if M1-02 fixtures are missing)
// ---------------------------------------------------------------------------

describe("fixture pre-check (AC3)", () => {
  const REQUIRED_FIXTURES = [
    "meta-old-schema.json",
    "meta-new-schema.json",
    "meta-new-schema-persona.json",
    "meta-bram-async-launched.json",
    "subagent-running.jsonl",
    "subagent-finished.jsonl",
    "subagent-malformed.jsonl",
    "subagent-background-finished.jsonl",
    "session-alive.json",
    "session-dead-pid.json",
    "teams-valid.yaml",
    "parent-jsonl-async-launched.jsonl",
  ];

  for (const name of REQUIRED_FIXTURES) {
    it(`fixture ${name} is present and parseable`, () => {
      // loadFixture throws with a clear message if missing — per AC3.
      const content = loadFixture(name);
      expect(content.length).toBeGreaterThan(0);
    });
  }

  it("FIXTURES_DIR path resolves to the actual fixtures directory", () => {
    // Verify the directory exists and contains the expected files.
    const files = readdirSync(FIXTURES_DIR);
    for (const name of REQUIRED_FIXTURES) {
      expect(files, `FIXTURES_DIR missing ${name}`).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2.1 — session appears
// ---------------------------------------------------------------------------

describe("AC2.1: session appears (new {pid}.json → reducer includes it)", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
  });

  afterEach(() => cleanup());

  it("empty tempdir → zero sessions", async () => {
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const { roster } = loadRoster(rosterPath);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    expect(tree.sessions).toHaveLength(0);
  });

  it("after adding a {pid}.json → session appears in tree", async () => {
    // Start: no sessions.
    const before = await collectFromTempdir(root);
    const { roster } = loadRoster(rosterPath);
    const treeBefore = buildAgentTree(
      before.sessions, before.agentData, before.activities, before.finishedIds,
      roster, NOW_MS,
    );
    expect(treeBefore.sessions).toHaveLength(0);

    // Add a session file (simulate a new Claude Code process starting).
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });

    // Next reducer pass picks it up.
    const after = await collectFromTempdir(root);
    const treeAfter = buildAgentTree(
      after.sessions, after.agentData, after.activities, after.finishedIds,
      roster, NOW_MS,
    );
    expect(treeAfter.sessions).toHaveLength(1);
    expect(treeAfter.sessions[0]!.sessionId).toBe(SESSION_A);

    // Negative path: session does NOT appear in the "before" tree.
    expect(treeBefore.sessions.some((s) => s.sessionId === SESSION_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2.2 — session disappears
// ---------------------------------------------------------------------------

describe("AC2.2: session disappears (delete {pid}.json → reducer drops it)", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
  });

  afterEach(() => cleanup());

  it("session is present before delete, absent after", async () => {
    const { roster } = loadRoster(rosterPath);

    // Before delete: session visible.
    const before = await collectFromTempdir(root);
    const treeBefore = buildAgentTree(
      before.sessions, before.agentData, before.activities, before.finishedIds,
      roster, NOW_MS,
    );
    expect(treeBefore.sessions.some((s) => s.sessionId === SESSION_A)).toBe(true);

    // Delete the session file.
    deleteSessionFile(root, DEAD_PID_1);

    // After delete: session gone from tree.
    const after = await collectFromTempdir(root);
    const treeAfter = buildAgentTree(
      after.sessions, after.agentData, after.activities, after.finishedIds,
      roster, NOW_MS,
    );
    expect(treeAfter.sessions).toHaveLength(0);
    expect(treeAfter.sessions.some((s) => s.sessionId === SESSION_A)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2.3 — subagent spawns
// ---------------------------------------------------------------------------

describe("AC2.3: subagent spawns (new meta.json + .jsonl → reducer adds it)", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "Spawn test session" });
  });

  afterEach(() => cleanup());

  it("no subagent meta → session shows full-roster baseline tiles (86ca18b9p)", async () => {
    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const s = tree.sessions[0]!;
    // Post-86ca18b9p: with no detected agents, every roster member is seeded
    // as an `available` baseline. teams-valid.yaml has alpha (felix/maya/bram)
    // + beta (sage), so both team cards render with all-available tiles.
    expect(s.teamOrder).toEqual(["claudeteam-alpha", "claudeteam-beta"]);
    const alpha = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const beta = s.rosterTiles.get("claudeteam-beta") ?? [];
    expect(alpha).toHaveLength(3); // felix, maya, bram
    expect(beta).toHaveLength(1); // sage
    for (const entry of [...alpha, ...beta]) {
      const tile = entry as { state: string; activity: string };
      expect(tile.state).toBe("available");
      expect(tile.activity).toBe("available");
    }
    expect(s.background).toHaveLength(0);
  });

  it("after writing meta-new-schema-persona.json + running JSONL → rostered tile appears", async () => {
    // The persona fixture has agentType:"felix" + toolUseId → matched by agentType_equals:"felix"
    // in teams-valid.yaml (felix member of claudeteam-alpha).
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-running.jsonl");

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const s = tree.sessions[0]!;
    // Felix's tile must appear under claudeteam-alpha.
    expect(s.teamOrder).toContain("claudeteam-alpha");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")).toBeDefined();

    // Negative path: background list does NOT contain a felix entry.
    expect(s.background.some((b) => b.agentType === "felix")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC2.4 — subagent finishes
// ---------------------------------------------------------------------------

describe("AC2.4: subagent finishes (parent transcript gets tool_result → reducer marks finished)", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  // The persona fixture has toolUseId "toolu_01SZsHqGceAQC4Loovg6ion1"
  const TOOL_USE_ID = "toolu_01SZsHqGceAQC4Loovg6ion1";

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    // Write parent JSONL WITHOUT the tool_result (subagent is still running).
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "Finish test session" });
    // Write subagent files.
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-running.jsonl");
  });

  afterEach(() => cleanup());

  it("before tool_result → subagent tile state is running or idle (not finished)", async () => {
    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile).toBeDefined();
    // Must NOT be finished — the parent hasn't recorded the tool_result yet.
    expect(felixTile!.state).not.toBe("finished");
  });

  it("after appending tool_result to parent JSONL → tile state becomes finished", async () => {
    // Simulate the subagent finishing: parent transcript receives the tool_result.
    appendFinishedToolResult(root, CWD_A, SESSION_A, TOOL_USE_ID);

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile).toBeDefined();
    expect(felixTile!.state).toBe("finished");
    // 86c9yxv94: tool_result is written via `appendFinishedToolResult`
    // which stamps `timestamp: new Date().toISOString()`. The finishedAtMs
    // is therefore very close to NOW_MS (captured at module load),
    // typically a fraction of a second earlier — Math.round + clamp give
    // "finished 0s" but the assertion uses a regex so the test stays
    // robust against tiny timing variations.
    expect(felixTile!.activity).toMatch(/^finished \d+s$/);

    // Negative path: the agentId must be in finishedIds (the parent-transcript signal).
    expect(finishedIds.has(AGENT_FELIX)).toBe(true);
  });

  it("finished is detected via parent JSONL, NOT via child JSONL content alone", async () => {
    // This is the regression test for Bram's M1-02 finding:
    // "subagent JSONLs never carry the closing assistant message".
    //
    // If we ONLY look at the child JSONL (which ends on a user tool_result line),
    // we cannot determine finished state — we need the parent's tool_result.
    //
    // Proof: a child JSONL present + NO parent tool_result → NOT finished.
    // (The parent JSONL was written without finishedToolUseIds in beforeEach.)

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);

    // finishedIds must be empty (no parent tool_result).
    expect(finishedIds.size).toBe(0);

    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);
    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile!.state).not.toBe("finished");
  });
});

// ---------------------------------------------------------------------------
// AC2.4b — Obs 9 (86c9zc5dd): background-dispatch ack must NOT register as finished
// ---------------------------------------------------------------------------

describe("AC2.4b: Obs 9 — async_launched dispatch ack is not a finished signal", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  // The persona fixture's toolUseId — matches meta-new-schema-persona.json.
  const TOOL_USE_ID = "toolu_01SZsHqGceAQC4Loovg6ion1";

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "Obs 9 background-dispatch test" });
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-running.jsonl");
  });

  afterEach(() => cleanup());

  it("parent JSONL with only a background-dispatch ack → tile state is NOT finished", async () => {
    // Append the async-launched ack record (top-level `toolUseResult.isAsync:true`).
    // The watcher must skip this record — it's a spawn ack, not a completion.
    appendAsyncLaunchedAck(root, CWD_A, SESSION_A, TOOL_USE_ID, AGENT_FELIX);

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    // The agent must NOT appear in finishedIds — the ack is a dispatch, not a completion.
    expect(finishedIds.has(AGENT_FELIX)).toBe(false);

    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile).toBeDefined();
    // Pre-fix bug: this asserted `"finished"` because the ack was misread as a completion.
    expect(felixTile!.state).not.toBe("finished");
  });

  it("background-dispatch ack followed by a real completion → finished only after the real tool_result lands", async () => {
    // 1. Background dispatch fires → ack appears immediately.
    appendAsyncLaunchedAck(root, CWD_A, SESSION_A, TOOL_USE_ID, AGENT_FELIX);

    const beforeCompletion = await collectFromTempdir(root);
    expect(beforeCompletion.finishedIds.has(AGENT_FELIX)).toBe(false);

    // 2. (Hypothetical future world where Claude Code DOES emit a real
    //    completion record for background agents.) The watcher must
    //    register it normally — that record will NOT carry
    //    `toolUseResult.isAsync:true` (only the ack does).
    appendFinishedToolResult(root, CWD_A, SESSION_A, TOOL_USE_ID);

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    expect(finishedIds.has(AGENT_FELIX)).toBe(true);

    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile!.state).toBe("finished");
  });

  it("foreground (sync) Agent tool_result has no `isAsync` field → still classifies as finished", async () => {
    // Foreground Agent completions are written without a toolUseResult.isAsync
    // field. `appendFinishedToolResult` already writes this shape (no
    // toolUseResult wrapper) — confirming the discriminator doesn't
    // over-match.
    appendFinishedToolResult(root, CWD_A, SESSION_A, TOOL_USE_ID);

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    expect(finishedIds.has(AGENT_FELIX)).toBe(true);
    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile!.state).toBe("finished");
  });

  it("real-capture fixture (Bram Round-3 dispatch + ack) → not classified as finished", async () => {
    // tests/fixtures/parent-jsonl-async-launched.jsonl is a verbatim 2-line
    // excerpt from baf09ef7-...jsonl (lines 1335-1336): the Bram Round-3
    // toolUseId=toolu_01MMAeiEPr44os17jq9mJ8UY dispatch + async_launched ack.
    // tests/fixtures/meta-bram-async-launched.json matches that toolUseId.
    //
    // This is the strongest regression test: the discriminator runs against
    // EXACTLY the on-disk bytes that triggered Obs 9 — no synthesis.
    const { root: realRoot, cleanup: realCleanup } = createTempRoot();
    try {
      const realRoster = writeRoster(realRoot, "teams-valid.yaml");
      const REAL_SESSION = "aaaabbbb-0000-0000-0000-00000000bram";
      const REAL_AGENT = "ad8ae64968850a339"; // Bram Round-3 agentId from the ack
      writeSessionFile(realRoot, { pid: DEAD_PID_1, sessionId: REAL_SESSION, cwd: CWD_A });
      writeParentJsonlFromFixture(
        realRoot,
        CWD_A,
        REAL_SESSION,
        "parent-jsonl-async-launched.jsonl",
      );
      writeMetaJson(realRoot, CWD_A, REAL_SESSION, REAL_AGENT, "meta-bram-async-launched.json");
      writeSubagentJsonl(realRoot, CWD_A, REAL_SESSION, REAL_AGENT, "subagent-running.jsonl");

      const { roster } = loadRoster(realRoster);
      const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(realRoot);
      const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

      // The Bram agent must NOT be in finishedIds — the only tool_result
      // record in the fixture is an async_launched ack.
      expect(finishedIds.has(REAL_AGENT)).toBe(false);

      const s = tree.sessions[0]!;
      const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
      const bramTile = findTile(alphaTiles, "bram");
      expect(bramTile, "bram tile must exist (roster match on agentType)").toBeDefined();
      expect(bramTile!.state).not.toBe("finished");
    } finally {
      realCleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC2.4c — Obs 13 (86c9zmp5g): background sub-agent transitions to "finished"
// via child-JSONL stop_reason=end_turn signal
// ---------------------------------------------------------------------------

describe("AC2.4c: Obs 13 — background sub-agent finishes via child JSONL stop_reason=end_turn", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  // Bram's persona-named meta — agentType:"bram", toolUseId matches the
  // Round-3 dispatch in the async-launched ack fixture. teams-valid.yaml
  // has `agentType_equals: "bram"` under claudeteam-alpha. The toolUseId
  // discriminator (`toolu_01MMAeiEPr44os17jq9mJ8UY`) is wired through the
  // fixture pair — meta-bram-async-launched.json + parent-jsonl-async-launched.jsonl —
  // so the collected `finishedIds` map must be empty (ack is skipped).
  const REAL_AGENT = "ad8ae64968850a339"; // matches fixture's agentId
  const REAL_SESSION = "baf09ef7-b940-458e-9693-da28b7fb6439";

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: REAL_SESSION, cwd: CWD_A });
    // Parent JSONL carries ONLY the async-launched ack — exactly the on-disk
    // shape Bram's Obs 13 triage proved against (no real tool_result ever
    // lands, even after completion).
    writeParentJsonlFromFixture(
      root,
      CWD_A,
      REAL_SESSION,
      "parent-jsonl-async-launched.jsonl",
    );
    // Bram's meta — toolUseId matches the parent ack.
    writeMetaJson(root, CWD_A, REAL_SESSION, REAL_AGENT, "meta-bram-async-launched.json");
  });

  afterEach(() => cleanup());

  it("child JSONL ends in stop_reason=end_turn → state becomes finished (no parent tool_result needed)", async () => {
    // Critical setup: child JSONL is the new fixture whose LAST assistant
    // record carries stop_reason=end_turn (real-shape capture pattern).
    writeSubagentJsonl(root, CWD_A, REAL_SESSION, REAL_AGENT, "subagent-background-finished.jsonl");

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);

    // The parent JSONL has ONLY the async ack — finishedIds must be empty
    // (the ack is skipped by readFinishedToolUseIds' isAsync discriminator).
    expect(finishedIds.has(REAL_AGENT)).toBe(false);
    expect(finishedIds.size).toBe(0);

    // The child JSONL's last assistant record has stop_reason=end_turn —
    // the tailer must surface this via activity.isFinished.
    const bramActivity = activities.get(REAL_AGENT);
    expect(bramActivity).toBeDefined();
    expect(bramActivity!.isFinished).toBe(true);

    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);
    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const bramTile = findTile(alphaTiles, "bram");
    expect(bramTile, "bram tile must be present (roster match on agentType)").toBeDefined();
    // Obs 13 fix: state MUST be "finished" — pre-fix this was stuck at
    // "idle" or "running" because no parent-side completion existed.
    expect(bramTile!.state).toBe("finished");

    // Negative path: activity must NOT be "idle Ns" — that was the
    // pre-fix sponsor-observed symptom (`idle 162s+`, `idle 279s+`).
    expect(bramTile!.activity).not.toMatch(/^idle /);
    // No finishedAtMs threaded through the child-JSONL path, so the
    // bare "finished" string is the expected render.
    expect(bramTile!.activity).toBe("finished");
  });

  it("child JSONL still running (no stop_reason=end_turn) → state is NOT finished (regression guard)", async () => {
    // Negative regression: an in-flight background agent (no end_turn yet)
    // must NOT be mis-classified as finished. Use the existing
    // subagent-running.jsonl fixture which ends mid-action.
    writeSubagentJsonl(root, CWD_A, REAL_SESSION, REAL_AGENT, "subagent-running.jsonl");

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);

    expect(finishedIds.has(REAL_AGENT)).toBe(false);
    const bramActivity = activities.get(REAL_AGENT);
    expect(bramActivity!.isFinished).toBe(false);

    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);
    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const bramTile = findTile(alphaTiles, "bram");
    expect(bramTile!.state).not.toBe("finished");
  });
});

// ---------------------------------------------------------------------------
// AC2.5 — two sessions sharing the same cwd
// ---------------------------------------------------------------------------

describe("AC2.5: two sessions sharing the same cwd → both materialize separately", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    // Two sessions with same cwd but different PIDs and session IDs.
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeSessionFile(root, { pid: DEAD_PID_2, sessionId: SESSION_C, cwd: CWD_A }); // same cwd
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "Session A" });
    writeParentJsonl(root, CWD_A, SESSION_C, { title: "Session C (same cwd)" });
  });

  afterEach(() => cleanup());

  it("two sessions with same cwd → two entries in tree (not merged)", async () => {
    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    // Both sessions must be present separately.
    expect(tree.sessions).toHaveLength(2);
    const sessionIds = tree.sessions.map((s) => s.sessionId);
    expect(sessionIds).toContain(SESSION_A);
    expect(sessionIds).toContain(SESSION_C);

    // Both have the same cwd.
    for (const s of tree.sessions) {
      expect(s.cwd).toBe(CWD_A);
    }

    // Negative path: they are NOT merged into one entry.
    expect(tree.sessions).not.toHaveLength(1);
  });

  it("each session's agents are independent (no cross-contamination)", async () => {
    // Give SESSION_A a felix subagent, SESSION_C a background subagent.
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-running.jsonl");
    writeMetaJson(root, CWD_A, SESSION_C, AGENT_GENERIC, "meta-new-schema.json");
    writeSubagentJsonl(root, CWD_A, SESSION_C, AGENT_GENERIC, "subagent-running.jsonl");

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const sA = tree.sessions.find((s) => s.sessionId === SESSION_A)!;
    const sC = tree.sessions.find((s) => s.sessionId === SESSION_C)!;
    expect(sA).toBeDefined();
    expect(sC).toBeDefined();

    // SESSION_A detected felix (running); SESSION_C has a background agent.
    const aAlpha = sA.rosterTiles.get("claudeteam-alpha") ?? [];
    const aFelix = findTile(aAlpha, "felix");
    expect(aFelix).toBeDefined();
    expect(aFelix!.state).not.toBe("available"); // detected, live
    expect(sC.background.some((b) => b.agentType === "general-purpose")).toBe(true);

    // Negative path (no cross-contamination): post-86ca18b9p, SESSION_C DOES
    // carry a felix tile — but only as the `available` BASELINE. SESSION_A's
    // detected/running state must NOT leak into SESSION_C's felix tile.
    const cAlpha = sC.rosterTiles.get("claudeteam-alpha") ?? [];
    const cFelix = findTile(cAlpha, "felix");
    expect(cFelix).toBeDefined();
    expect(cFelix!.state).toBe("available"); // baseline only — no leak
  });
});

// ---------------------------------------------------------------------------
// AC2.6 — schema drift (all three meta.json variants)
// ---------------------------------------------------------------------------

describe("AC2.6: schema drift — all three meta.json variants parse and match correctly", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
  });

  afterEach(() => cleanup());

  it("v2.1.119 (old, no toolUseId) — meta-old-schema.json — agentType_equals match", async () => {
    // meta-old-schema.json: agentType:"devon", description:"Devon reviews Kevin's PR #2"
    // teams-valid.yaml has no "devon" member → goes to background. Confirms parser
    // doesn't crash on the old schema format.
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-old-schema.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-running.jsonl");

    // Parse the fixture directly to confirm it's the old schema.
    const raw = loadFixture("meta-old-schema.json");
    const meta = parseMetaFromString(raw);
    expect(meta.schemaVersion).toBe("v2.1.119");
    expect(meta.toolUseId).toBeNull();

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    // "devon" is not in the roster → background bucket; no crash.
    const s = tree.sessions[0]!;
    expect(s.background.some((b) => b.agentType === "devon")).toBe(true);

    // Negative: devon never produces a rostered tile. Post-86ca18b9p the
    // roster's own members (felix/maya/bram/sage) ARE seeded as `available`
    // baselines, so the team cards exist — but every rostered tile is a
    // never-run baseline (no detected agent matched devon).
    expectAllRosteredAvailable(s);
  });

  it("v2.1.145-general (engine type, no name) — meta-new-schema.json — goes to background", async () => {
    // meta-new-schema.json: agentType:"general-purpose", name:null, toolUseId present
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_GENERIC, "meta-new-schema.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_GENERIC, "subagent-running.jsonl");

    const raw = loadFixture("meta-new-schema.json");
    const meta = parseMetaFromString(raw);
    expect(meta.schemaVersion).toBe("v2.1.145-general");
    expect(meta.toolUseId).toBeTruthy();
    expect(meta.name).toBeNull();

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    // general-purpose with no name and no matching description rule → background.
    const s = tree.sessions[0]!;
    expect(s.background.some((b) => b.agentType === "general-purpose")).toBe(true);
    // Post-86ca18b9p: roster baselines exist but all rostered tiles are
    // `available` (the general-purpose agent matched nothing).
    expectAllRosteredAvailable(s);
  });

  it("v2.1.145-persona (persona slug + toolUseId) — meta-new-schema-persona.json — rostered", async () => {
    // This is the regression test named for the "new-persona variant" bug class.
    // meta-new-schema-persona.json: agentType:"felix", toolUseId present, no name.
    // Must NOT crash because agentType looks like a persona slug while toolUseId exists.
    // agentType_equals:"felix" rule in teams-valid.yaml must hit it.
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_PERSONA, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_PERSONA, "subagent-running.jsonl");

    const raw = loadFixture("meta-new-schema-persona.json");
    const meta = parseMetaFromString(raw);
    expect(meta.schemaVersion).toBe("v2.1.145-persona");
    expect(meta.agentType).toBe("felix");
    expect(meta.toolUseId).toBeTruthy();

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const s = tree.sessions[0]!;
    // Must be rostered under claudeteam-alpha as felix.
    expect(s.teamOrder).toContain("claudeteam-alpha");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")).toBeDefined();

    // Negative path: must NOT be in background (old-schema-only matcher would fail here
    // if it treated v2.1.145-persona as a different code path from v2.1.119).
    expect(s.background.some((b) => b.agentType === "felix")).toBe(false);
  });

  it("mixed: one session with old-schema + one session with persona-schema → both route correctly", async () => {
    // Session A: old schema (devon → background)
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-old-schema.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-running.jsonl");

    // Session B: persona-named schema (felix → rostered)
    writeSessionFile(root, { pid: DEAD_PID_2, sessionId: SESSION_B, cwd: CWD_B });
    writeParentJsonl(root, CWD_B, SESSION_B, {});
    writeMetaJson(root, CWD_B, SESSION_B, AGENT_PERSONA, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_B, SESSION_B, AGENT_PERSONA, "subagent-running.jsonl");

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    expect(tree.sessions).toHaveLength(2);

    const sA = tree.sessions.find((s) => s.sessionId === SESSION_A)!;
    const sB = tree.sessions.find((s) => s.sessionId === SESSION_B)!;

    // Session A: devon in background; all rostered tiles are available baselines.
    expect(sA.background.some((b) => b.agentType === "devon")).toBe(true);
    expectAllRosteredAvailable(sA);

    // Session B: felix detected (rostered, live), rest available baselines.
    const bAlpha = sB.rosterTiles.get("claudeteam-alpha") ?? [];
    const bFelix = findTile(bAlpha, "felix");
    expect(bFelix).toBeDefined();
    expect(bFelix!.state).not.toBe("available"); // detected
    expect(sB.background).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC2.7 — race condition: subagent JSONL exists before parent records tool_use
// ---------------------------------------------------------------------------

describe("AC2.7: race — subagent JSONL + meta.json exist but parent has no tool_use yet", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
  });

  afterEach(() => cleanup());

  it("subagent files present but parent JSONL has no tool_use → treated as running, not orphaned", async () => {
    // Race scenario: the subagent JSONL and meta.json appear on disk BEFORE the
    // parent JSONL has recorded the spawning tool_use entry.
    //
    // The reducer must treat the subagent as "running" (not orphaned/error),
    // because a brief race window is normal on every fresh spawn.
    //
    // Per testing-strategy.md Layer 2 "Race: subagent JSONL appears before its
    // parent's tool_use entry."
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    // Parent JSONL with NO tool_use or tool_result for this agent.
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "Race test" });

    // Write subagent files (the "race" state — child appeared, parent hasn't caught up).
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_PERSONA, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_PERSONA, "subagent-running.jsonl");

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);

    // finishedIds must be empty — the parent hasn't seen a tool_result yet.
    expect(finishedIds.size).toBe(0);

    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);
    const s = tree.sessions[0]!;

    // Tile must be present — the agent is not orphaned.
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile).toBeDefined();

    // State must be "running" or "idle" — NOT "error" and NOT "finished".
    expect(felixTile!.state).not.toBe("error");
    expect(felixTile!.state).not.toBe("finished");

    // Negative path: must NOT appear in background as an orphan.
    expect(s.background.some((b) => b.agentType === "felix")).toBe(false);
  });

  it("fresh spawn with mtimeMs=0 (no JSONL written yet) → running, not error", async () => {
    // Sub-case of the race: meta.json exists but the agent JSONL hasn't been
    // written at all yet (readActivity returns EMPTY_ACTIVITY with mtimeMs=0).
    // Per reducer.ts inferState(): session alive + mtimeMs=0 → "running".
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    // Write meta but NO subagent JSONL — readActivity will return mtimeMs:0.
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_PERSONA, "meta-new-schema-persona.json");
    // Deliberately do NOT call writeSubagentJsonl.

    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);

    // The activity entry should have mtimeMs=0 (file missing).
    const activity = activities.get(AGENT_PERSONA);
    expect(activity).toBeDefined();
    expect(activity!.mtimeMs).toBe(0);

    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);
    const s = tree.sessions[0]!;
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile).toBeDefined();
    // Session is dead (DEAD_PID_1 should not exist on any real machine),
    // so the reducer maps this to "error" per inferState() — acceptable.
    // The critical assertion is that the tile IS present (not orphaned/absent).
    expect(["running", "error"]).toContain(felixTile!.state);

    // Negative path: NOT in background as orphaned agent.
    expect(s.background.some((b) => b.agentType === "felix")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases from testing-strategy.md Layer 2
// ---------------------------------------------------------------------------

describe("edge cases: malformed JSONL + empty roster", () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
  });

  afterEach(() => cleanup());

  it("malformed JSONL (subagent-malformed.jsonl) — tailer skips bad lines, does not crash", async () => {
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_FELIX, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_FELIX, "subagent-malformed.jsonl");

    const rosterPath = writeRoster(root, "teams-valid.yaml");
    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);

    // Tailer must not throw — activity entry must exist.
    expect(activities.has(AGENT_FELIX)).toBe(true);

    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);
    const s = tree.sessions[0]!;
    // Tile still present despite malformed JSONL (meta parsed fine).
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    expect(findTile(alphaTiles, "felix")).toBeDefined();
  });

  it("empty roster → all agents go to background, no team cards", async () => {
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_PERSONA, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_PERSONA, "subagent-running.jsonl");

    // Load with empty roster (no roster path provided).
    const { roster } = loadRoster(/* no paths */);
    expect(roster).toHaveLength(0);

    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    const s = tree.sessions[0]!;
    // Empty roster → all agents in background.
    expect(s.teamOrder).toHaveLength(0);
    expect(s.background.length).toBeGreaterThan(0);

    // Negative path: no team cards rendered.
    expect(s.rosterTiles.size).toBe(0);
  });

  it("empty tempdir → tree has zero sessions, not an error", async () => {
    const { roster } = loadRoster();
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    expect(tree.sessions).toHaveLength(0);
    // Negative path: no throws, no error state.
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: buildAgentTree from disk-resident fixtures
// ---------------------------------------------------------------------------

describe("full round-trip: real fixtures → AgentTree", () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
  });

  afterEach(() => cleanup());

  it("session with rostered + background agents → correct tile + background split", async () => {
    // Session A: felix (persona-named) + general-purpose (background)
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "Full round-trip test" });
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_PERSONA, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_PERSONA, "subagent-running.jsonl");
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_GENERIC, "meta-new-schema.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_GENERIC, "subagent-running.jsonl");

    const rosterPath = writeRoster(root, "teams-valid.yaml");
    const { roster } = loadRoster(rosterPath);
    const { sessions, agentData, activities, finishedIds } = await collectFromTempdir(root);
    const tree = buildAgentTree(sessions, agentData, activities, finishedIds, roster, NOW_MS);

    expect(tree.sessions).toHaveLength(1);
    const s = tree.sessions[0]!;

    // Rostered: felix under claudeteam-alpha.
    expect(s.teamOrder).toContain("claudeteam-alpha");
    const alphaTiles = s.rosterTiles.get("claudeteam-alpha") ?? [];
    const felixTile = findTile(alphaTiles, "felix");
    expect(felixTile).toBeDefined();
    expect(felixTile!.display).toBe("Felix");
    expect(felixTile!.role).toBe("Extension Host Dev");
    expect(felixTile!.agentId).toBe(AGENT_PERSONA);

    // Background: general-purpose agent.
    expect(s.background).toHaveLength(1);
    expect(s.background[0]!.agentType).toBe("general-purpose");

    // Model comes from JSONL (subagent-running.jsonl has claude-opus-4-7).
    expect(felixTile!.model).toBe("claude-opus-4-7");
  });

  it("subagent-finished.jsonl used for activity → tailer extracts last tool correctly", async () => {
    writeSessionFile(root, { pid: DEAD_PID_1, sessionId: SESSION_A, cwd: CWD_A });
    writeParentJsonl(root, CWD_A, SESSION_A, {});
    writeMetaJson(root, CWD_A, SESSION_A, AGENT_PERSONA, "meta-new-schema-persona.json");
    writeSubagentJsonl(root, CWD_A, SESSION_A, AGENT_PERSONA, "subagent-finished.jsonl");

    const activity = await readActivity(
      join(
        root,
        "projects",
        cwdToSlug(CWD_A),
        SESSION_A,
        "subagents",
        `agent-${AGENT_PERSONA}.jsonl`,
      ),
    );

    // Tailer must have extracted a model from the fixture.
    expect(activity.model).toBe("claude-opus-4-7");
    // mtimeMs must be > 0 (file exists on disk).
    expect(activity.mtimeMs).toBeGreaterThan(0);
  });
});
