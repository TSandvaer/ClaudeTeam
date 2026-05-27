/**
 * Unit tests for src/extension/diagnostics/output.ts (86c9zn7vw).
 *
 * Coverage:
 *   - Line formatters produce the documented shape (regression-locked).
 *   - Verbose off → all `record*` calls are no-ops (no channel allocated,
 *     no lines emitted).
 *   - Verbose on → tick line is emitted on every call.
 *   - Transition lines fire ONLY when the agent's state differs from
 *     the prior recorded state. First observation is NOT a transition.
 *   - Walking covers CollapsedPersonaGroup `instances` as well as bare
 *     AgentTiles.
 *   - prevState pruning removes entries whose tile is no longer present.
 *   - Roster reload + error events emit only when verbose.
 *   - Dispose is idempotent; channel is disposed only if allocated.
 *
 * The Output channel is dependency-injected via `createOutputChannel` so
 * tests can capture lines without a real VS Code instance.
 *
 * Source: src/extension/diagnostics/output.ts
 *         ClickUp 86c9zn7vw
 */

import { describe, it, expect, vi } from "vitest";

import {
  DIAGNOSTIC_CHANNEL_NAME,
  createDiagnosticChannel,
  formatErrorLine,
  formatRosterReloadLine,
  formatTickLine,
  formatTransitionLine,
  type DiagnosticChannel,
} from "../../src/extension/diagnostics/output.js";
import type {
  AgentState,
  AgentTile,
  CollapsedPersonaGroup,
  DashboardState,
  SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fake Output channel — captures appended lines for assertion.
// ---------------------------------------------------------------------------

interface FakeOutputChannel {
  name: string;
  lines: string[];
  appendCalls: number;
  disposeCalls: number;
  appendLine(line: string): void;
  append(): void;
  replace(): void;
  clear(): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

function makeFakeChannel(name: string): FakeOutputChannel {
  return {
    name,
    lines: [],
    appendCalls: 0,
    disposeCalls: 0,
    appendLine(line: string) {
      this.lines.push(line);
      this.appendCalls += 1;
    },
    append() {},
    replace() {},
    clear() {
      this.lines = [];
    },
    show() {},
    hide() {},
    dispose() {
      this.disposeCalls += 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTile(agentId: string, state: AgentState): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: state === "running" ? "tool:Edit" : "idle 5s",
    model: "claude-opus-4-7",
    state,
    agentId,
    toolUseId: null,
  };
}

function makeSession(
  sessionId: string,
  tiles: AgentTile[],
  groups: CollapsedPersonaGroup[] = [],
): SessionTree {
  const rosterTiles = new Map<
    string,
    (AgentTile | CollapsedPersonaGroup)[]
  >();
  const entries: (AgentTile | CollapsedPersonaGroup)[] = [];
  for (const t of tiles) entries.push(t);
  for (const g of groups) entries.push(g);
  if (entries.length > 0) {
    rosterTiles.set("claudeteam-alpha", entries);
  }
  return {
    shortId: sessionId.slice(0, 8),
    sessionId,
    pid: 12345,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "Test session",
    rosterTiles,
    teamOrder: entries.length > 0 ? ["claudeteam-alpha"] : [],
    background: [],
  };
}

function makeState(sessions: SessionTree[]): DashboardState {
  return { sessions };
}

// ---------------------------------------------------------------------------
// Line-formatter tests — lock the shape so a typo in the diagnostic format
// fails CI rather than silently shipping.
// ---------------------------------------------------------------------------

describe("86c9zn7vw: line formatters produce the documented shape", () => {
  it("formatTickLine — `tick #N took Xms — emitted=<bool>`", () => {
    const line = formatTickLine({
      tickNumber: 42,
      durationMs: 17,
      emitted: true,
      state: makeState([]),
    });
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] tick #42 took 17ms — emitted=true$/,
    );
  });

  it("formatTickLine — emitted=false rendered when hash-skip suppresses emission", () => {
    const line = formatTickLine({
      tickNumber: 1,
      durationMs: 3,
      emitted: false,
      state: makeState([]),
    });
    expect(line).toContain("emitted=false");
  });

  it("formatTransitionLine — `transition session=<sid8> agent=<aid8> <prev> → <next>`", () => {
    const line = formatTransitionLine(
      "abcdef1234567890",
      "fedcba9876543210",
      "running",
      "finished",
    );
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] transition session=abcdef12 agent=fedcba98 running → finished$/,
    );
  });

  it("formatRosterReloadLine — `roster reloaded — teams=N errors=N warnings=N`", () => {
    const line = formatRosterReloadLine({
      teamsCount: 2,
      errorsCount: 0,
      warningsCount: 1,
    });
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] roster reloaded — teams=2 errors=0 warnings=1$/,
    );
  });

  it("formatErrorLine — `error: <message>`", () => {
    const line = formatErrorLine("readActivity failed: ENOENT");
    expect(line).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] error: readActivity failed: ENOENT$/,
    );
  });
});

// ---------------------------------------------------------------------------
// Channel-name + lazy-allocation tests
// ---------------------------------------------------------------------------

describe("86c9zn7vw: lazy channel allocation", () => {
  it("verbose off — never allocates the underlying OutputChannel", () => {
    const factory = vi.fn(makeFakeChannel);
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: factory,
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 2,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 2,
      emitted: false,
      state: makeState([]),
    });
    dispatcher.recordRosterReload({
      teamsCount: 1,
      errorsCount: 0,
      warningsCount: 0,
    });
    dispatcher.recordError("boom");
    expect(factory).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it("verbose on — allocates the channel ONCE on the first emit, name is the documented constant", () => {
    const factory = vi.fn(makeFakeChannel);
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: factory,
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 2,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 2,
      emitted: true,
      state: makeState([]),
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(DIAGNOSTIC_CHANNEL_NAME);
    expect(DIAGNOSTIC_CHANNEL_NAME).toBe("Claude Team — Diagnostics");
    dispatcher.dispose();
  });
});

// ---------------------------------------------------------------------------
// Verbose-gate tests — recordTick emits the tick line only when verbose.
// ---------------------------------------------------------------------------

describe("86c9zn7vw: recordTick verbose gating", () => {
  it("verbose off — recordTick emits no lines", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 5,
      emitted: true,
      state: makeState([]),
    });
    expect(captured).toBeNull();
    dispatcher.dispose();
  });

  it("verbose on — every tick produces exactly one tick line", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 5,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 7,
      emitted: false,
      state: makeState([]),
    });
    expect(captured).not.toBeNull();
    const ch = captured as unknown as FakeOutputChannel;
    expect(ch.lines.length).toBe(2);
    expect(ch.lines[0]).toContain("tick #1 took 5ms — emitted=true");
    expect(ch.lines[1]).toContain("tick #2 took 7ms — emitted=false");
    dispatcher.dispose();
  });

  it("verbose toggled mid-session — flipping off→on does NOT replay history (first verbose tick has no transitions)", () => {
    let isVerbose = false;
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => isVerbose,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    // Verbose off: tick with one running tile. No prevState updates.
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 5,
      emitted: true,
      state: makeState([makeSession("session-A", [makeTile("agent-1", "running")])]),
    });
    expect(captured).toBeNull();
    // Verbose on: same tile transitions to idle. Because verbose was off
    // for tick 1, no prior state was recorded — so this tick produces ONLY
    // the tick line, no transition line.
    isVerbose = true;
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 6,
      emitted: true,
      state: makeState([makeSession("session-A", [makeTile("agent-1", "idle")])]),
    });
    const ch = captured as unknown as FakeOutputChannel;
    expect(ch.lines.length).toBe(1);
    expect(ch.lines[0]).toContain("tick #2");
    expect(ch.lines.filter((l) => l.includes("transition"))).toEqual([]);
    dispatcher.dispose();
  });
});

// ---------------------------------------------------------------------------
// State-transition tests — the load-bearing AC for this ticket.
// ---------------------------------------------------------------------------

describe("86c9zn7vw: per-agent state-transition lines", () => {
  function emitAndCapture(states: AgentState[]): string[] {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    for (let i = 0; i < states.length; i++) {
      dispatcher.recordTick({
        tickNumber: i + 1,
        durationMs: 1,
        emitted: true,
        state: makeState([
          makeSession("session-A", [makeTile("agent-1", states[i]!)]),
        ]),
      });
    }
    const ch = captured as unknown as FakeOutputChannel | null;
    const lines = ch?.lines ?? [];
    dispatcher.dispose();
    return lines.filter((l) => l.includes("transition"));
  }

  it("first observation of an agent emits NO transition line", () => {
    const transitions = emitAndCapture(["running"]);
    expect(transitions).toEqual([]);
  });

  it("same-state next tick emits NO transition line", () => {
    const transitions = emitAndCapture(["running", "running"]);
    expect(transitions).toEqual([]);
  });

  it("running → idle emits one transition line", () => {
    const transitions = emitAndCapture(["running", "idle"]);
    expect(transitions.length).toBe(1);
    expect(transitions[0]).toContain("running → idle");
  });

  it("running → idle → finished emits two transition lines", () => {
    const transitions = emitAndCapture(["running", "idle", "finished"]);
    expect(transitions.length).toBe(2);
    expect(transitions[0]).toContain("running → idle");
    expect(transitions[1]).toContain("idle → finished");
  });

  it("transition line includes sessionId+agentId short-ids", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([
        makeSession("abcdefgh-1234-5678-90ab-cdef12345678", [
          // Production agentIds are raw UUIDs — `collectAgentMetas` strips the
          // `agent-` filename prefix before stamping the field (watcherLoop.ts
          // ~:812). Use UUID-shape here so the short-id slice mirrors prod.
          makeTile("fedcba98-7654-3210-abcd-ef1234567890", "running"),
        ]),
      ]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([
        makeSession("abcdefgh-1234-5678-90ab-cdef12345678", [
          makeTile("fedcba98-7654-3210-abcd-ef1234567890", "finished"),
        ]),
      ]),
    });
    const ch = captured as unknown as FakeOutputChannel;
    const t = ch.lines.find((l) => l.includes("transition"))!;
    expect(t).toContain("session=abcdefgh");
    expect(t).toContain("agent=fedcba98");
    expect(t).toContain("running → finished");
    dispatcher.dispose();
  });

  it("walks CollapsedPersonaGroup instances", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    const groupRunning: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [makeTile("agent-1", "running"), makeTile("agent-2", "running")],
    };
    const groupMixed: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [makeTile("agent-1", "finished"), makeTile("agent-2", "idle")],
    };
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([makeSession("session-A", [], [groupRunning])]),
    });
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([makeSession("session-A", [], [groupMixed])]),
    });
    const ch = captured as unknown as FakeOutputChannel;
    const transitions = ch.lines.filter((l) => l.includes("transition"));
    expect(transitions.length).toBe(2);
    expect(transitions.find((l) => l.includes("agent=agent-1"))).toContain(
      "running → finished",
    );
    expect(transitions.find((l) => l.includes("agent=agent-2"))).toContain(
      "running → idle",
    );
    dispatcher.dispose();
  });

  it("prunes prevState when tiles disappear (no spurious transitions on later re-emit)", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    // Tick 1: agent-1 running.
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([
        makeSession("session-A", [makeTile("agent-1", "running")]),
      ]),
    });
    // Tick 2: agent-1 disappears. (no transition emitted — agent gone)
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([makeSession("session-A", [])]),
    });
    // Tick 3: agent-1 reappears running. Because the pruner cleared the
    // prior entry, this counts as a FIRST observation — no transition.
    dispatcher.recordTick({
      tickNumber: 3,
      durationMs: 1,
      emitted: true,
      state: makeState([
        makeSession("session-A", [makeTile("agent-1", "running")]),
      ]),
    });
    const ch = captured as unknown as FakeOutputChannel;
    const transitions = ch.lines.filter((l) => l.includes("transition"));
    expect(transitions).toEqual([]);
    dispatcher.dispose();
  });
});

// ---------------------------------------------------------------------------
// recordRosterReload + recordError verbose-gate
// ---------------------------------------------------------------------------

describe("86c9zn7vw: recordRosterReload + recordError verbose gating", () => {
  it("verbose off — neither call allocates a channel", () => {
    const factory = vi.fn(makeFakeChannel);
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: factory,
    });
    dispatcher.recordRosterReload({
      teamsCount: 1,
      errorsCount: 0,
      warningsCount: 0,
    });
    dispatcher.recordError("boom");
    expect(factory).not.toHaveBeenCalled();
    dispatcher.dispose();
  });

  it("verbose on — both emit one line each", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordRosterReload({
      teamsCount: 2,
      errorsCount: 1,
      warningsCount: 0,
    });
    dispatcher.recordError("readActivity failed: ENOENT");
    const ch = captured as unknown as FakeOutputChannel;
    expect(ch.lines.length).toBe(2);
    expect(ch.lines[0]).toContain("roster reloaded — teams=2 errors=1 warnings=0");
    expect(ch.lines[1]).toContain("error: readActivity failed: ENOENT");
    dispatcher.dispose();
  });
});

// ---------------------------------------------------------------------------
// Dispose semantics
// ---------------------------------------------------------------------------

describe("86c9zn7vw: dispose semantics", () => {
  it("dispose without ever emitting — does NOT allocate or dispose a channel", () => {
    const factory = vi.fn(makeFakeChannel);
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: factory,
    });
    dispatcher.dispose();
    expect(factory).not.toHaveBeenCalled();
  });

  it("dispose after emit — disposes the allocated channel exactly once", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.dispose();
    const ch = captured as unknown as FakeOutputChannel;
    expect(ch.disposeCalls).toBe(1);
  });

  it("dispose is idempotent (no-op on second call)", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.dispose();
    dispatcher.dispose();
    const ch = captured as unknown as FakeOutputChannel;
    expect(ch.disposeCalls).toBe(1);
  });

  it("emits after dispose — no-op (channel disposed, no further appends)", () => {
    let captured: FakeOutputChannel | null = null;
    const dispatcher: DiagnosticChannel = createDiagnosticChannel({
      isVerbose: () => true,
      createOutputChannel: (n) => {
        captured = makeFakeChannel(n);
        return captured;
      },
    });
    dispatcher.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.dispose();
    dispatcher.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    dispatcher.recordError("late error");
    const ch = captured as unknown as FakeOutputChannel;
    expect(ch.lines.length).toBe(1); // only the pre-dispose tick line
  });
});
