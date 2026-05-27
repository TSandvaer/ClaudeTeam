/**
 * Integration tests for the watcher's `onTickComplete` hook (86c9zn7vw).
 *
 * The hook is the plumbing surface between the watcher loop and the
 * diagnostic Output channel — it must fire exactly once per tick, carry
 * a monotonically-increasing tick number, measure end-to-end duration in
 * wall-clock ms, expose the `emitted` flag matching the hash-skip outcome,
 * and supply the produced state for transition diffing.
 *
 * Coverage:
 *   - Hook fires on the initial tick with tickNumber=1.
 *   - Hook fires after subsequent ticks; tickNumber increments.
 *   - `emitted: true` for the first emit; `emitted: false` for a tick
 *     where nothing changed (hash-skip path).
 *   - `durationMs` is a finite non-negative number.
 *   - `state` is the same object reference that `onStateChange` received
 *     (when an emit fired) — so the diagnostic can compute transitions
 *     against the wire shape.
 *   - Hook errors are caught + surfaced via logger.warn (do NOT kill loop).
 *
 * Source: src/extension/watcher/watcherLoop.ts onTickComplete plumbing
 *         ClickUp 86c9zn7vw
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { startWatcher } from "../../src/extension/watcher/watcherLoop.js";
import type { DashboardState } from "../../src/shared/types.js";
import {
  createTempRoot,
  writeRoster,
} from "./helpers/tempdir.js";

const TEST_POLL_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs: number = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

describe("86c9zn7vw: onTickComplete plumbing", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;
  let disposable: { dispose: () => void } | null;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");
    disposable = null;
  });

  afterEach(() => {
    disposable?.dispose();
    disposable = null;
    cleanup();
  });

  it("fires on the first tick with tickNumber=1 and emitted=true", async () => {
    const ticks: Array<{
      tickNumber: number;
      durationMs: number;
      emitted: boolean;
      state: DashboardState;
    }> = [];
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: () => {},
      onTickComplete: (info) => ticks.push(info),
    });
    const ok = await waitFor(() => ticks.length >= 1, 2000);
    expect(ok).toBe(true);
    expect(ticks[0]!.tickNumber).toBe(1);
    expect(ticks[0]!.emitted).toBe(true); // first tick always emits
    expect(Number.isFinite(ticks[0]!.durationMs)).toBe(true);
    expect(ticks[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(ticks[0]!.state).toBeDefined();
    expect(Array.isArray(ticks[0]!.state.sessions)).toBe(true);
  });

  it("tickNumber increments monotonically across consecutive ticks", async () => {
    const ticks: Array<{ tickNumber: number }> = [];
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: () => {},
      onTickComplete: (info) =>
        ticks.push({ tickNumber: info.tickNumber }),
    });
    // Wait for at least 3 ticks (initial + 2 from the interval).
    const ok = await waitFor(() => ticks.length >= 3, 2500);
    expect(ok).toBe(true);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.tickNumber).toBe(ticks[i - 1]!.tickNumber + 1);
    }
  });

  it("emitted=false on hash-skip ticks (same state → no emission)", async () => {
    // Empty tempdir + no roster changes — every tick after the first
    // produces the same hash and hash-skips.
    const ticks: Array<{ emitted: boolean }> = [];
    const emissions: DashboardState[] = [];
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (s) => emissions.push(s),
      onTickComplete: (info) => ticks.push({ emitted: info.emitted }),
    });
    const ok = await waitFor(() => ticks.length >= 3, 2500);
    expect(ok).toBe(true);
    expect(emissions.length).toBe(1); // only the initial tick emitted
    expect(ticks[0]!.emitted).toBe(true);
    expect(ticks[1]!.emitted).toBe(false);
    expect(ticks[2]!.emitted).toBe(false);
  });

  it("state object handed to onTickComplete is the same one onStateChange received", async () => {
    let emittedState: DashboardState | null = null;
    let hookState: DashboardState | null = null;
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: (s) => {
        emittedState = s;
      },
      onTickComplete: (info) => {
        if (hookState === null) hookState = info.state;
      },
    });
    const ok = await waitFor(
      () => emittedState !== null && hookState !== null,
      2000,
    );
    expect(ok).toBe(true);
    expect(hookState).toBe(emittedState); // same reference
  });

  it("onTickComplete that throws is caught + does NOT crash the loop", async () => {
    const warnings: string[] = [];
    let secondTickFired = false;
    disposable = startWatcher({
      claudeHome: root,
      globalRosterPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onStateChange: () => {},
      onTickComplete: (info) => {
        if (info.tickNumber === 1) {
          throw new Error("diagnostic boom");
        }
        if (info.tickNumber >= 2) secondTickFired = true;
      },
      logger: { warn: (m) => warnings.push(m) },
    });
    const ok = await waitFor(() => secondTickFired, 2500);
    expect(ok).toBe(true); // loop survived
    expect(warnings.some((w) => w.includes("onTickComplete handler threw"))).toBe(
      true,
    );
    expect(warnings.some((w) => w.includes("diagnostic boom"))).toBe(true);
  });
});
