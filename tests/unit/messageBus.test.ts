/**
 * Unit tests for src/extension/messageBus.ts (M2-06).
 *
 * Coverage:
 *   - `serializeState` flattens every session's rosterTiles Map to a plain
 *     object keyed by teamId.
 *   - `serializeState` preserves all other SessionTree fields verbatim.
 *   - `serializeState` round-trips through JSON.stringify (proves the wire
 *     shape is actually JSON-safe — the failure mode `serializeState` exists
 *     to prevent).
 *   - `postState` builds the `state:full` message and calls webview.postMessage
 *     with the serialized payload.
 *   - `postState` catches a synchronous postMessage error (disposed webview)
 *     and returns a resolved Promise<false> rather than throwing.
 *
 * Source: src/extension/messageBus.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC1
 */

import { describe, it, expect, vi } from "vitest";

import { serializeState, postState } from "../../src/extension/messageBus.js";
import type {
  AgentTile,
  AgentTree,
  SessionTree,
} from "../../src/shared/types.js";

// Mock vscode — messageBus only imports `vscode.Webview` as a type, so the
// surface needed at runtime is essentially nothing. A shim keeps the resolver
// from blowing up if a future change pulls in a runtime reference.
vi.mock("vscode", () => ({}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTile(id: string, teamId = "claudeteam-alpha"): AgentTile {
  return {
    memberId: id,
    teamId,
    display: id,
    role: "test",
    activity: "idle 1s",
    model: "claude-opus-4-7",
    state: "idle",
    agentId: `agent${id}`,
    toolUseId: null,
  };
}

function makeSession(
  sessionId: string,
  tiles: Map<string, AgentTile[]>,
): SessionTree {
  return {
    shortId: sessionId.slice(0, 8),
    sessionId,
    pid: 12345,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "test session",
    rosterTiles: tiles,
    teamOrder: Array.from(tiles.keys()),
    background: [],
  };
}

// ---------------------------------------------------------------------------
// serializeState
// ---------------------------------------------------------------------------

describe("serializeState — Map → Record conversion", () => {
  it("flattens rosterTiles from Map<string, AgentTile[]> to Record<string, AgentTile[]>", () => {
    const tiles = new Map<string, AgentTile[]>([
      ["claudeteam-alpha", [makeTile("felix")]],
    ]);
    const state: AgentTree = { sessions: [makeSession("sid-1", tiles)] };

    const serialized = serializeState(state);

    const out = serialized.sessions[0]!.rosterTiles;
    // Plain object — typeof is "object" and instanceof Map is false.
    expect(out).not.toBeInstanceOf(Map);
    expect(typeof out).toBe("object");
    expect(Object.keys(out)).toEqual(["claudeteam-alpha"]);
    expect(out["claudeteam-alpha"]?.[0]?.memberId).toBe("felix");
  });

  it("preserves multi-team tile groupings", () => {
    const tiles = new Map<string, AgentTile[]>([
      ["alpha", [makeTile("a1", "alpha"), makeTile("a2", "alpha")]],
      ["beta", [makeTile("b1", "beta")]],
    ]);
    const state: AgentTree = { sessions: [makeSession("sid-multi", tiles)] };

    const serialized = serializeState(state);
    const rt = serialized.sessions[0]!.rosterTiles;

    expect(Object.keys(rt).sort()).toEqual(["alpha", "beta"]);
    expect(rt["alpha"]).toHaveLength(2);
    expect(rt["beta"]).toHaveLength(1);
  });

  it("preserves all non-rosterTiles fields verbatim", () => {
    const tiles = new Map<string, AgentTile[]>();
    const session = makeSession("sid-fields", tiles);
    const state: AgentTree = { sessions: [session] };

    const serialized = serializeState(state);
    const out = serialized.sessions[0]!;

    expect(out.shortId).toBe(session.shortId);
    expect(out.sessionId).toBe(session.sessionId);
    expect(out.pid).toBe(session.pid);
    expect(out.entrypoint).toBe(session.entrypoint);
    expect(out.version).toBe(session.version);
    expect(out.isAlive).toBe(session.isAlive);
    expect(out.cwd).toBe(session.cwd);
    expect(out.title).toBe(session.title);
    expect(out.teamOrder).toEqual(session.teamOrder);
    expect(out.background).toEqual(session.background);
  });

  it("empty state → empty sessions[]", () => {
    const serialized = serializeState({ sessions: [] });
    expect(serialized.sessions).toEqual([]);
  });

  it("serialized state round-trips through JSON.stringify without losing tiles", () => {
    // This is the failure mode `serializeState` exists to prevent.
    // Without the Map → Record conversion, JSON.stringify(map) emits "{}" and
    // the webview receives an empty roster — tiles silently vanish on the wire.
    const tiles = new Map<string, AgentTile[]>([
      ["claudeteam-alpha", [makeTile("felix"), makeTile("maya")]],
    ]);
    const state: AgentTree = { sessions: [makeSession("sid-rt", tiles)] };

    const serialized = serializeState(state);
    const wire = JSON.parse(JSON.stringify(serialized));

    expect(wire.sessions[0].rosterTiles["claudeteam-alpha"]).toHaveLength(2);
    expect(wire.sessions[0].rosterTiles["claudeteam-alpha"][0].memberId).toBe(
      "felix",
    );
  });
});

// ---------------------------------------------------------------------------
// postState
// ---------------------------------------------------------------------------

describe("postState — webview dispatch", () => {
  function mockWebview() {
    return {
      postMessage: vi.fn().mockResolvedValue(true),
    } as unknown as { postMessage: ReturnType<typeof vi.fn> };
  }

  it("wraps the serialized state in a state:full envelope", async () => {
    const wv = mockWebview();
    const tiles = new Map<string, AgentTile[]>([
      ["claudeteam-alpha", [makeTile("felix")]],
    ]);
    const state: AgentTree = { sessions: [makeSession("sid-ps", tiles)] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postState(wv as any, state);

    expect(wv.postMessage).toHaveBeenCalledTimes(1);
    const sent = wv.postMessage.mock.calls[0]![0];
    expect(sent.type).toBe("state:full");
    expect(sent.payload.sessions).toHaveLength(1);
    expect(sent.payload.sessions[0].rosterTiles["claudeteam-alpha"]?.length).toBe(
      1,
    );
  });

  it("returns the postMessage promise resolution", async () => {
    const wv = mockWebview();
    wv.postMessage.mockResolvedValueOnce(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await postState(wv as any, { sessions: [] });
    expect(ok).toBe(true);
  });

  it("catches synchronous postMessage errors (disposed webview) and returns false", async () => {
    const wv = {
      postMessage: vi.fn(() => {
        throw new Error("webview disposed");
      }),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await postState(wv as any, { sessions: [] });

    expect(ok).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
