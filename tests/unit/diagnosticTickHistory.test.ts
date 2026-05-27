/**
 * Unit tests for the tick-history surface exposed by
 * `createDiagnosticChannel` (86c9zn7tm).
 *
 * Separate from `diagnosticChannel.test.ts` (Felix's Output-channel coverage)
 * so the ring-buffer / subscriber / snapshot contracts have a dedicated home —
 * the existing file is already 600+ lines.
 *
 * Coverage:
 *   - Every tick lands in the ring buffer (regardless of verbose).
 *   - Buffer caps at `TICK_HISTORY_LIMIT`; oldest entries fall off the front.
 *   - `subscribe(listener)` fires after each tick; multi-subscribe supported.
 *   - Listener disposal removes the subscription cleanly.
 *   - Throwing listener does not take down the dispatcher (defense-in-depth).
 *   - `getSnapshot()` returns a fresh array slice (mutation-safe).
 *   - `getSnapshot().state` reflects the most recent DashboardState.
 *   - `clearHistory()` empties the buffer without disposing the channel.
 *   - Transitions are captured even when verbose is off (panel data plane is
 *     independent of the Output-channel gate).
 */

import { describe, it, expect, vi } from "vitest";

import {
  TICK_HISTORY_LIMIT,
  createDiagnosticChannel,
} from "../../src/extension/diagnostics/output.js";
import type {
  AgentState,
  AgentTile,
  DashboardState,
  SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeTile(agentId: string, state: AgentState): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: state,
    model: "claude-opus-4-7",
    state,
    agentId,
    toolUseId: null,
  };
}

function makeSession(sessionId: string, tiles: AgentTile[]): SessionTree {
  const rosterTiles = new Map<string, AgentTile[]>();
  if (tiles.length > 0) rosterTiles.set("claudeteam-alpha", tiles);
  return {
    shortId: sessionId.slice(0, 8),
    sessionId,
    pid: 1234,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "(no title yet)",
    rosterTiles,
    teamOrder: tiles.length > 0 ? ["claudeteam-alpha"] : [],
    background: [],
  };
}

function makeState(sessions: SessionTree[]): DashboardState {
  return { sessions };
}

function makeNoOpChannel() {
  return {
    appendLine: vi.fn(),
    dispose: () => {},
    name: "noop",
    append: () => {},
    replace: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
  };
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

describe("DiagnosticChannel — tick ring buffer (86c9zn7tm)", () => {
  it("captures every tick even with verbose OFF", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    for (let i = 1; i <= 5; i++) {
      dispatcher.recordTick({
        tickNumber: i,
        durationMs: i,
        emitted: true,
        state: makeState([]),
      });
    }
    const snap = dispatcher.getSnapshot();
    expect(snap.ticks).toHaveLength(5);
    expect(snap.ticks.map((t) => t.tickNumber)).toEqual([1, 2, 3, 4, 5]);
    dispatcher.dispose();
  });

  it(`caps at TICK_HISTORY_LIMIT (${TICK_HISTORY_LIMIT}) — oldest entries fall off`, () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const total = TICK_HISTORY_LIMIT + 7;
    for (let i = 1; i <= total; i++) {
      dispatcher.recordTick({
        tickNumber: i,
        durationMs: 1,
        emitted: true,
        state: makeState([]),
      });
    }
    const snap = dispatcher.getSnapshot();
    expect(snap.ticks).toHaveLength(TICK_HISTORY_LIMIT);
    // Newest at the tail (append-order); the test asserts the first kept
    // tick is `total - TICK_HISTORY_LIMIT + 1`.
    expect(snap.ticks[0]!.tickNumber).toBe(total - TICK_HISTORY_LIMIT + 1);
    expect(snap.ticks[snap.ticks.length - 1]!.tickNumber).toBe(total);
    dispatcher.dispose();
  });

  it("captures transitions even with verbose OFF (panel data plane independent of log gate)", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([makeSession("session-A", [makeTile("agent-1", "running")])]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([makeSession("session-A", [makeTile("agent-1", "idle")])]),
    });
    const snap = dispatcher.getSnapshot();
    expect(snap.ticks).toHaveLength(2);
    // First observation: no transition.
    expect(snap.ticks[0]!.transitions).toEqual([]);
    // Second tick: one transition running → idle.
    expect(snap.ticks[1]!.transitions).toHaveLength(1);
    expect(snap.ticks[1]!.transitions[0]!.prev).toBe("running");
    expect(snap.ticks[1]!.transitions[0]!.next).toBe("idle");
    dispatcher.dispose();
  });

  it("getSnapshot returns a fresh array slice — caller mutation does not affect future calls", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    const snap1 = dispatcher.getSnapshot();
    snap1.ticks.length = 0; // caller mutates their copy
    const snap2 = dispatcher.getSnapshot();
    expect(snap2.ticks).toHaveLength(1);
    dispatcher.dispose();
  });

  it("getSnapshot.state reflects the most recent state", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    expect(dispatcher.getSnapshot().state).toBeNull();
    const stateA = makeState([
      makeSession("session-A", [makeTile("agent-1", "running")]),
    ]);
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: stateA,
    });
    expect(dispatcher.getSnapshot().state).toBe(stateA);
    const stateB = makeState([]);
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: stateB,
    });
    expect(dispatcher.getSnapshot().state).toBe(stateB);
    dispatcher.dispose();
  });

  it("clearHistory empties the buffer; subsequent ticks repopulate", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(dispatcher.getSnapshot().ticks).toHaveLength(1);
    dispatcher.clearHistory();
    expect(dispatcher.getSnapshot().ticks).toHaveLength(0);
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(dispatcher.getSnapshot().ticks).toHaveLength(1);
    expect(dispatcher.getSnapshot().ticks[0]!.tickNumber).toBe(2);
    dispatcher.dispose();
  });
});

// ---------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------

describe("DiagnosticChannel — subscribe (86c9zn7tm)", () => {
  it("fires the listener once per recorded tick", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const listener = vi.fn();
    dispatcher.subscribe(listener);
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]![0].tickNumber).toBe(1);
    expect(listener.mock.calls[1]![0].tickNumber).toBe(2);
    dispatcher.dispose();
  });

  it("supports multiple subscribers (fire in registration order)", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const order: string[] = [];
    dispatcher.subscribe(() => order.push("A"));
    dispatcher.subscribe(() => order.push("B"));
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(order).toEqual(["A", "B"]);
    dispatcher.dispose();
  });

  it("disposing a listener stops it from firing on further ticks", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const listener = vi.fn();
    const sub = dispatcher.subscribe(listener);
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    sub.dispose();
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(listener).toHaveBeenCalledTimes(1);
    dispatcher.dispose();
  });

  it("a throwing listener does not block other listeners or take down the dispatcher", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const good = vi.fn();
    dispatcher.subscribe(() => {
      throw new Error("listener boom");
    });
    dispatcher.subscribe(good);
    expect(() =>
      dispatcher.recordTick({
        tickNumber: 1,
        durationMs: 1,
        emitted: true,
        state: makeState([]),
      }),
    ).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    dispatcher.dispose();
  });

  it("dispose clears subscribers — late ticks (no-op) do not invoke them", () => {
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const listener = vi.fn();
    dispatcher.subscribe(listener);
    dispatcher.dispose();
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
