/**
 * Integration tests for the file-watcher polling loop (M2-04).
 *
 * Spins up a tempdir mimicking ~/.claude/, points `startWatcher` at it via a
 * short poll interval, mutates files, and asserts that the `onStateChange`
 * callback fires with the expected updated state within the timing budget
 * specified in AC8 (≤4 seconds).
 *
 * Per testing-strategy.md Layer 2: real filesystem I/O on a tempdir, no
 * mocks of the parser / matcher / reducer. Vscode-side bits (`startWatcher`'s
 * `sessionsFsWatcher` option) are exercised via the bare-interval code path
 * — the FS-watcher integration is covered separately in the @vscode/test-
 * electron suite (M2-08).
 *
 * AC8 (M2-04): integration test mutates a file, asserts onStateChange fires
 * within 4 seconds with the updated state. Uses existing tempdir helper.
 *
 * Source contracts:
 *   - M2-04 AC1-AC4 (watcherLoop shape, intervals, disposal, state diffing).
 *   - testing-strategy.md "Layer 2 — Integration / fixture filesystem".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createTempRoot,
  writeSessionFile,
  deleteSessionFile,
  writeMetaJson,
  writeSubagentJsonl,
  writeParentJsonl,
  appendFinishedToolResult,
  writeRoster,
} from "./helpers/tempdir.js";

import {
  startWatcher,
  runTick,
  hashState,
  MIN_POLL_MS,
} from "../../src/extension/watcher/watcherLoop.js";
import type { DashboardState } from "../../src/shared/types.js";
import {
  isCollapsedPersonaGroup,
  isMultiAgentPersonaTile,
} from "../../src/shared/types.js";

/**
 * Read the representative state from any RosterTileEntry — bare tile, M3-10
 * CollapsedPersonaGroup, or 86ca1dtr5 MultiAgentPersonaTile. For wrappers,
 * returns the first instance's state (these tests assert single-agent paths,
 * so a wrapper would be the first instance's state anyway).
 */
function entryRepresentativeState(
  entry:
    | import("../../src/shared/types.js").RosterTileEntry
    | undefined,
): string | undefined {
  if (entry === undefined) return undefined;
  if (isMultiAgentPersonaTile(entry)) return entry.instances[0]?.state;
  if (isCollapsedPersonaGroup(entry)) return entry.instances[0]?.state;
  return entry.state;
}

const DEAD_PID = 2_000_010;
const SESSION_A = "aaaabbbb-0000-0000-0000-00000000aa01";
const SESSION_B = "aaaabbbb-0000-0000-0000-00000000aa02";
const CWD_A = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
const AGENT_FELIX = "agentfelix000010";

// Faster poll interval for the test — keeps the suite under the 4s/test
// budget while still exercising the loop's tick-and-emit behavior.
const TEST_POLL_MS = 300;

/**
 * Wait until predicate returns true OR timeout elapses.
 * Resolves with `true` on success, `false` on timeout.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs: number = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// AC8 — file mutation triggers onStateChange within 4 seconds.
// ---------------------------------------------------------------------------

describe("M2-04 AC8: file mutation triggers onStateChange within 4 seconds", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;
  let disposable: { dispose: () => void } | null;
  let emissions: DashboardState[];

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    emissions = [];
    disposable = null;
  });

  afterEach(() => {
    disposable?.dispose();
    disposable = null;
    cleanup();
  });

  it("emits initial state immediately on start (empty tempdir)", async () => {
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (state) => {
        emissions.push(state);
      },
    });

    // Initial tick fires asynchronously; wait for it.
    const got = await waitFor(() => emissions.length >= 1, 1500);
    expect(got).toBe(true);
    expect(emissions[0]!.sessions).toHaveLength(0);
  });

  it("adding a session file triggers a new onStateChange within 4 seconds", async () => {
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (state) => {
        emissions.push(state);
      },
    });

    // Wait for the empty initial emission.
    expect(await waitFor(() => emissions.length >= 1, 1500)).toBe(true);
    const baselineCount = emissions.length;

    // Mutate the filesystem — add a session.
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "AC8 test" });
    writeMetaJson(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "meta-new-schema-persona.json",
    );
    writeSubagentJsonl(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "subagent-running.jsonl",
    );

    // The next tick must pick up the new session and emit.
    const ok = await waitFor(
      () =>
        emissions.length > baselineCount &&
        emissions[emissions.length - 1]!.sessions.length === 1,
      4000,
    );
    expect(ok).toBe(true);

    const latest = emissions[emissions.length - 1]!;
    expect(latest.sessions).toHaveLength(1);
    expect(latest.sessions[0]!.sessionId).toBe(SESSION_A);
    // Felix tile is rostered.
    expect(latest.sessions[0]!.teamOrder).toContain("claudeteam-alpha");
  });

  it("deleting a session file triggers an emission removing it (≤4s)", async () => {
    // Pre-populate a session.
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "delete-test" });

    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (state) => {
        emissions.push(state);
      },
    });

    // First emission should already contain the session.
    expect(
      await waitFor(
        () => emissions.length >= 1 && emissions[0]!.sessions.length === 1,
        1500,
      ),
    ).toBe(true);
    const baselineCount = emissions.length;

    // Delete it.
    deleteSessionFile(root, DEAD_PID);

    // Wait for next emission with zero sessions.
    const ok = await waitFor(
      () =>
        emissions.length > baselineCount &&
        emissions[emissions.length - 1]!.sessions.length === 0,
      4000,
    );
    expect(ok).toBe(true);
  });

  it("subagent finish (parent gets tool_result) triggers state transition (≤4s)", async () => {
    // Tool-use id from the persona fixture.
    const TOOL_USE_ID = "toolu_01SZsHqGceAQC4Loovg6ion1";

    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "finish-test" });
    writeMetaJson(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "meta-new-schema-persona.json",
    );
    writeSubagentJsonl(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "subagent-running.jsonl",
    );

    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (state) => {
        emissions.push(state);
      },
    });

    // Initial emission — felix tile present, not finished.
    // M3-10: rosterTiles is `RosterTileEntry[]`; in this scenario N=1 per
    // persona so every entry is a bare AgentTile — narrow with a runtime
    // guard against the CollapsedPersonaGroup branch.
    expect(
      await waitFor(
        () => {
          if (emissions.length < 1) return false;
          const entry = emissions[0]!.sessions[0]?.rosterTiles.get(
            "claudeteam-alpha",
          )?.[0];
          if (entry === undefined) return false;
          const state = entryRepresentativeState(entry);
          return (state ?? "missing") !== "finished";
        },
        2000,
      ),
    ).toBe(true);
    const baselineCount = emissions.length;

    // Append tool_result — subagent finishes.
    appendFinishedToolResult(root, CWD_A, SESSION_A, TOOL_USE_ID);

    const ok = await waitFor(() => {
      if (emissions.length <= baselineCount) return false;
      const latest = emissions[emissions.length - 1]!;
      const entry = latest.sessions[0]?.rosterTiles
        .get("claudeteam-alpha")?.[0];
      if (entry === undefined) return false;
      const state = entryRepresentativeState(entry);
      return state === "finished";
    }, 4000);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State-hash skip — identical ticks do NOT re-emit.
// ---------------------------------------------------------------------------

describe("M2-04 AC3/AC4: hash-skip — identical ticks do not re-emit", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;
  let disposable: { dispose: () => void } | null;
  let emissions: DashboardState[];

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    emissions = [];
    disposable = null;
  });

  afterEach(() => {
    disposable?.dispose();
    disposable = null;
    cleanup();
  });

  it("multiple ticks with no filesystem change → only one emission", async () => {
    // Pre-populate one session.
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "skip-test" });

    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (state) => {
        emissions.push(state);
      },
    });

    // Wait long enough for multiple poll cycles.
    await sleep(TEST_POLL_MS * 4);

    // Expectation: exactly ONE emission, because the tempdir hasn't changed
    // after the initial tick. The hash-skip suppresses redundant ticks.
    expect(emissions.length).toBe(1);
    expect(emissions[0]!.sessions).toHaveLength(1);
  });

  it("dispose() stops further ticks", async () => {
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (state) => {
        emissions.push(state);
      },
    });

    // Wait for initial emission.
    expect(await waitFor(() => emissions.length >= 1, 1500)).toBe(true);

    // Dispose, then mutate the filesystem. No further emission should fire.
    disposable.dispose();
    const countAtDispose = emissions.length;

    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_B,
      cwd: CWD_A,
    });

    // Wait for what would be multiple ticks if the loop were still running.
    await sleep(TEST_POLL_MS * 4);

    expect(emissions.length).toBe(countAtDispose);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers — runTick() + hashState() exercised directly.
// ---------------------------------------------------------------------------

describe("M2-04 AC1/AC3: runTick + hashState pure helpers", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
  });

  afterEach(() => cleanup());

  it("runTick on empty tempdir returns zero sessions", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });
    expect(state.sessions).toHaveLength(0);
  });

  it("runTick after writing session + agent → state reflects the agent", async () => {
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "runtick" });
    writeMetaJson(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "meta-new-schema-persona.json",
    );
    writeSubagentJsonl(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "subagent-running.jsonl",
    );

    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });
    expect(state.sessions).toHaveLength(1);
    const sessionTree = state.sessions[0]!;
    expect(sessionTree.sessionId).toBe(SESSION_A);
    expect(sessionTree.teamOrder).toContain("claudeteam-alpha");
  });

  it("hashState returns equal strings for equal states, distinct for changed", async () => {
    // Empty state hash.
    const empty = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });
    const emptyHash = hashState(empty);

    // Add a session — should change the hash.
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "hash-test" });

    const populated = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });
    const populatedHash = hashState(populated);

    expect(emptyHash).not.toEqual(populatedHash);

    // Another tick with no further mutation — same hash.
    const populatedAgain = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });
    expect(hashState(populatedAgain)).toEqual(populatedHash);
  });

  it("clamps poll interval to MIN_POLL_MS when supplied lower value", async () => {
    // The clamp is enforced inside startWatcher; this test verifies the
    // exported constant + that startWatcher with sub-floor pollIntervalMs
    // does not throw, and still emits within a reasonable time.
    expect(MIN_POLL_MS).toBeGreaterThan(0);

    const emissions: DashboardState[] = [];
    const disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: 1, // Below the floor.
      onStateChange: (s) => emissions.push(s),
    });
    try {
      expect(await waitFor(() => emissions.length >= 1, 2000)).toBe(true);
    } finally {
      disposable.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// E-06a (EPIC 86ca11187 §7.2) — runTick applies the hidden-member filter
// ---------------------------------------------------------------------------

describe("E-06a: runTick applies persisted hidden-member filter", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  // teams-valid.yaml roster ids used below.
  const TEAM_ALPHA = "claudeteam-alpha";

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "hide-members-test" });
    // A live (running) Felix agent. The other roster members (maya/bram/sage)
    // are seeded as baseline `available` tiles by the reducer.
    writeMetaJson(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "meta-new-schema-persona.json",
    );
    writeSubagentJsonl(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "subagent-running.jsonl",
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("empty hidden set (omitted): every roster tile visible; count 0; keys []", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    expect(alpha).toBeDefined();
    // felix (running) + maya + bram baselines all present.
    const memberIds = alpha!.map((e) =>
      isCollapsedPersonaGroup(e) ? e.personaName : e.memberId,
    );
    expect(memberIds).toContain("felix");
    expect(state.hiddenMemberCount).toBe(0);
    expect(state.hiddenMemberKeys).toEqual([]);
  });

  it("hides a RUNNING detected member (felix): tile dropped; count 1; keys carry the key", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: new Set([`${TEAM_ALPHA}:felix`] as const),
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    const felixPresent = (alpha ?? []).some(
      (e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix",
    );
    expect(felixPresent).toBe(false);
    expect(state.hiddenMemberCount).toBe(1);
    expect(state.hiddenMemberKeys).toEqual([`${TEAM_ALPHA}:felix`]);
  });

  it("hides a baseline AVAILABLE member (maya): never-run tile is hide-able too (primary declutter case)", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: new Set([`${TEAM_ALPHA}:maya`] as const),
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    const mayaPresent = (alpha ?? []).some(
      (e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya",
    );
    expect(mayaPresent).toBe(false);
    // felix (running) still present — only maya hidden.
    const felixPresent = (alpha ?? []).some(
      (e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix",
    );
    expect(felixPresent).toBe(true);
    expect(state.hiddenMemberCount).toBe(1);
    expect(state.hiddenMemberKeys).toEqual([`${TEAM_ALPHA}:maya`]);
  });

  it("hiddenMemberKeys carries the FULL persisted set even for a key with no tile this session", async () => {
    // Hide a key that doesn't correspond to any tile in this session's roster
    // (different team scope). The count of tiles-suppressed-this-tick is 0, but
    // the wire still carries the full persisted set for E-06b's "show hidden"
    // recovery surface.
    const ghostKey = "some-other-team:ghost";
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: new Set([ghostKey] as const),
    });

    expect(state.hiddenMemberCount).toBe(0);
    expect(state.hiddenMemberKeys).toEqual([ghostKey]);
  });
});

// ---------------------------------------------------------------------------
// E-07a (EPIC 86ca11187 §7.3) — runTick applies the removed-member filter
// ---------------------------------------------------------------------------

describe("E-07a: runTick applies persisted removed-member filter", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  const TEAM_ALPHA = "claudeteam-alpha";

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "remove-members-test" });
    // A live (running) Felix agent; maya/bram seeded as baseline tiles.
    writeMetaJson(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "meta-new-schema-persona.json",
    );
    writeSubagentJsonl(
      root,
      CWD_A,
      SESSION_A,
      AGENT_FELIX,
      "subagent-running.jsonl",
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("empty removed set (omitted): every roster tile visible; count 0; keys []", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    expect(alpha).toBeDefined();
    expect(state.removedMemberCount).toBe(0);
    expect(state.removedMemberKeys).toEqual([]);
  });

  it("removes a RUNNING detected member (felix): tile dropped; count 1; keys carry the key", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      removedMemberKeys: new Set([`${TEAM_ALPHA}:felix`] as const),
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    const felixPresent = (alpha ?? []).some(
      (e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix",
    );
    expect(felixPresent).toBe(false);
    expect(state.removedMemberCount).toBe(1);
    expect(state.removedMemberKeys).toEqual([`${TEAM_ALPHA}:felix`]);
  });

  it("removes a baseline AVAILABLE member (maya): never-run tile is removable too", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      removedMemberKeys: new Set([`${TEAM_ALPHA}:maya`] as const),
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    const mayaPresent = (alpha ?? []).some(
      (e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya",
    );
    expect(mayaPresent).toBe(false);
    expect(state.removedMemberCount).toBe(1);
    expect(state.removedMemberKeys).toEqual([`${TEAM_ALPHA}:maya`]);
  });

  it("AC1: removed member is suppressed BEYOND show-hidden — its key is on removedMemberKeys (not hiddenMemberKeys)", async () => {
    // maya is BOTH hidden AND removed. The remove filter suppresses her tile
    // from the default tree the same way hide does — but the distinguishing
    // wire signal is that her key appears on `removedMemberKeys`, NOT just
    // `hiddenMemberKeys`. E-06b's "show hidden" reveal renders from
    // `hiddenMemberKeys`; E-07b reads `removedMemberKeys` to ensure a removed
    // member is never offered for reveal/unhide (suppressed beyond show-hidden).
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      hiddenMemberKeys: new Set([`${TEAM_ALPHA}:maya`] as const),
      removedMemberKeys: new Set([`${TEAM_ALPHA}:maya`] as const),
    });

    const alpha = state.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    const mayaPresent = (alpha ?? []).some(
      (e) => !isCollapsedPersonaGroup(e) && e.memberId === "maya",
    );
    expect(mayaPresent).toBe(false);
    // The wire carries maya on BOTH surfaces; E-07b uses removedMemberKeys to
    // mask her from the show-hidden recovery list that hiddenMemberKeys feeds.
    expect(state.removedMemberKeys).toEqual([`${TEAM_ALPHA}:maya`]);
    expect(state.hiddenMemberKeys).toEqual([`${TEAM_ALPHA}:maya`]);
  });

  it("removedMemberKeys carries the FULL persisted set even for a key with no tile this session", async () => {
    const ghostKey = "some-other-team:ghost";
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      removedMemberKeys: new Set([ghostKey] as const),
    });

    expect(state.removedMemberCount).toBe(0);
    expect(state.removedMemberKeys).toEqual([ghostKey]);
  });

  it("a re-emit after the key is gone (yaml-gated reinstate simulated) restores the tile", async () => {
    // Simulate the post-reconcile state: the removed-member set no longer
    // carries felix (the store's reconcile cleared it on yaml re-add). runTick
    // with an empty removed set must show felix again — proving the filter is a
    // pure projection of the set, so the reinstate path's clearing of the
    // record is sufficient to bring the tile back on the next tick.
    const removed = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      removedMemberKeys: new Set([`${TEAM_ALPHA}:felix`] as const),
    });
    const removedAlpha = removed.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    expect(
      (removedAlpha ?? []).some(
        (e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix",
      ),
    ).toBe(false);

    const restored = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      removedMemberKeys: new Set([] as const),
    });
    const restoredAlpha = restored.sessions[0]?.rosterTiles.get(TEAM_ALPHA);
    expect(
      (restoredAlpha ?? []).some(
        (e) => !isCollapsedPersonaGroup(e) && e.memberId === "felix",
      ),
    ).toBe(true);
    expect(restored.removedMemberCount).toBe(0);
    expect(restored.removedMemberKeys).toEqual([]);
  });
});
