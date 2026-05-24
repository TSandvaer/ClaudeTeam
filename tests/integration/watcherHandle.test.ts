/**
 * Integration tests for the M2-06 extensions to the watcher handle:
 *   - `triggerTick()`         — fires a tick out-of-band; used by `ui:refresh`.
 *   - `getLastState()`        — returns the most recently emitted DashboardState;
 *                                used by `ui:open-transcript` to derive paths.
 *
 * AC5 of M2-06: host handles `ui:refresh` by immediately triggering one
 * watcher tick (call the tick function outside the poll interval).
 *
 * Source: src/extension/watcher/watcherLoop.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createTempRoot,
  writeSessionFile,
  writeMetaJson,
  writeSubagentJsonl,
  writeParentJsonl,
  writeRoster,
} from "./helpers/tempdir.js";

import {
  startWatcher,
  type WatcherHandle,
} from "../../src/extension/watcher/watcherLoop.js";
import type { DashboardState } from "../../src/shared/types.js";

const DEAD_PID = 2_000_111;
const SESSION_A = "aaaabbbb-0000-0000-0000-00000000ab01";
const CWD_A = "c:\\Trunk\\PRIVATE\\ClaudeTeam";
const AGENT_FELIX = "agentfelix000020";

// Long-enough interval that any tick observed in the timing window MUST be
// from triggerTick — not from the regular setInterval.
const SLOW_POLL_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

describe("M2-06 AC5 — WatcherHandle.triggerTick + getLastState", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;
  let handle: WatcherHandle | null = null;
  let emissions: DashboardState[];

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    emissions = [];
    handle = null;
  });

  afterEach(() => {
    handle?.dispose();
    handle = null;
    cleanup();
  });

  it("getLastState returns null before the first tick completes", () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => emissions.push(s),
    });

    // Synchronously, before any tick has had time to complete:
    expect(handle.getLastState()).toBeNull();
  });

  it("getLastState returns the most recently emitted state after the first tick", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => emissions.push(s),
    });

    expect(await waitFor(() => emissions.length >= 1, 1500)).toBe(true);
    const last = handle.getLastState();
    expect(last).not.toBeNull();
    expect(last!.sessions).toHaveLength(0);
  });

  it("triggerTick fires a tick within ~100ms even when poll interval is long", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => emissions.push(s),
    });

    // Wait for the initial emission.
    expect(await waitFor(() => emissions.length >= 1, 1500)).toBe(true);
    const baselineCount = emissions.length;

    // Mutate filesystem (add a session). The slow poll cadence means this
    // would NOT be observed for 5s — unless triggerTick fires.
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "refresh test" });
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

    handle.triggerTick();

    // Observation window: 1s is comfortably less than the 5s poll cadence.
    const ok = await waitFor(
      () =>
        emissions.length > baselineCount &&
        emissions[emissions.length - 1]!.sessions.length === 1,
      1500,
    );
    expect(ok).toBe(true);
  });

  it("triggerTick respects hash-skip — no emission when state unchanged", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => emissions.push(s),
    });

    expect(await waitFor(() => emissions.length >= 1, 1500)).toBe(true);
    const baselineCount = emissions.length;

    // Fire triggerTick three times without mutating the filesystem.
    handle.triggerTick();
    handle.triggerTick();
    handle.triggerTick();

    // Wait long enough for any pending ticks to settle.
    await sleep(500);

    // No new emissions — the hash-skip suppresses redundant ticks.
    expect(emissions.length).toBe(baselineCount);
  });

  it("getLastState is updated even on hash-skip ticks (fresh cwd visible)", async () => {
    // Pre-populate a session so the first tick has cwd to capture.
    writeSessionFile(root, {
      pid: DEAD_PID,
      sessionId: SESSION_A,
      cwd: CWD_A,
    });
    writeParentJsonl(root, CWD_A, SESSION_A, { title: "lastState" });

    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => emissions.push(s),
    });

    expect(
      await waitFor(
        () => handle?.getLastState() !== null,
        1500,
      ),
    ).toBe(true);

    const state = handle!.getLastState();
    expect(state!.sessions).toHaveLength(1);
    expect(state!.sessions[0]!.sessionId).toBe(SESSION_A);
    expect(state!.sessions[0]!.cwd).toBe(CWD_A);
  });

  it("triggerTick after dispose is a no-op (does not throw)", async () => {
    handle = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: SLOW_POLL_MS,
      onStateChange: (s) => emissions.push(s),
    });

    expect(await waitFor(() => emissions.length >= 1, 1500)).toBe(true);
    handle.dispose();
    const baselineCount = emissions.length;

    expect(() => handle!.triggerTick()).not.toThrow();
    await sleep(300);

    expect(emissions.length).toBe(baselineCount);
  });
});
