/**
 * @vitest-environment jsdom
 *
 * Unit tests for `hydrateState` — webview-side wire-shape rehydration.
 *
 * The host sends `SerializedDashboardState` over `webview.postMessage` (Maps
 * flattened to plain objects, because JSON.stringify drops Map contents to
 * `{}`). The webview must rebuild the Map for `session.rosterTiles.get(...)`
 * to work in the renderer.
 *
 * Coverage:
 *   - Empty state → empty sessions array.
 *   - Each session's rosterTiles is a real Map (not plain object).
 *   - Map preserves the original team→tiles association.
 *   - Non-rosterTiles fields pass through unchanged.
 *
 * Source: src/webview/main.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC1 + AC6
 */

import { describe, it, expect } from "vitest";
import { hydrateState } from "../../../src/webview/main.js";
import type { SerializedDashboardState } from "../../../src/shared/messages.js";
import type { AgentTile } from "../../../src/shared/types.js";

function tile(id: string, teamId = "claudeteam-alpha"): AgentTile {
  return {
    memberId: id,
    teamId,
    display: id,
    role: "test",
    activity: "idle 1s",
    model: "claude-opus-4-7",
    state: "idle",
    agentId: `agent-${id}`,
    toolUseId: null,
  };
}

describe("hydrateState — wire shape → in-memory shape", () => {
  it("empty wire state → empty sessions", () => {
    const wire: SerializedDashboardState = { sessions: [] };
    const out = hydrateState(wire);
    expect(out.sessions).toEqual([]);
  });

  it("rebuilds rosterTiles as a real Map", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "abcdef12",
          sessionId: "abcdef12-0000-0000-0000-000000000001",
          pid: 1,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
          title: "hydrate test",
          rosterTiles: {
            "claudeteam-alpha": [tile("felix"), tile("maya")],
          },
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };

    const out = hydrateState(wire);

    expect(out.sessions).toHaveLength(1);
    const rt = out.sessions[0]!.rosterTiles;
    expect(rt).toBeInstanceOf(Map);
    expect(rt.get("claudeteam-alpha")).toHaveLength(2);
    expect(rt.get("claudeteam-alpha")?.[0]?.memberId).toBe("felix");
    expect(rt.get("claudeteam-alpha")?.[1]?.memberId).toBe("maya");
  });

  it("preserves multi-team groupings as separate Map entries", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "abcdef12",
          sessionId: "abcdef12-0000-0000-0000-000000000002",
          pid: 2,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\X",
          title: "two teams",
          rosterTiles: {
            alpha: [tile("a1", "alpha")],
            beta: [tile("b1", "beta"), tile("b2", "beta")],
          },
          teamOrder: ["alpha", "beta"],
          background: [],
        },
      ],
    };

    const out = hydrateState(wire);
    const rt = out.sessions[0]!.rosterTiles;

    expect(rt.size).toBe(2);
    expect(rt.get("alpha")).toHaveLength(1);
    expect(rt.get("beta")).toHaveLength(2);
  });

  it("preserves non-rosterTiles fields verbatim", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "deadbeef",
          sessionId: "deadbeef-0000-0000-0000-000000000003",
          pid: 99,
          entrypoint: "cli",
          version: "2.1.119",
          isAlive: false,
          cwd: "/posix/path",
          title: "passthrough test",
          rosterTiles: {},
          teamOrder: [],
          background: [
            {
              agentType: "general-purpose",
              description: "noise",
              state: "running",
              model: "claude-sonnet-4-5",
            },
          ],
        },
      ],
    };

    const out = hydrateState(wire);
    const s = out.sessions[0]!;

    expect(s.shortId).toBe("deadbeef");
    expect(s.pid).toBe(99);
    expect(s.entrypoint).toBe("cli");
    expect(s.version).toBe("2.1.119");
    expect(s.isAlive).toBe(false);
    expect(s.cwd).toBe("/posix/path");
    expect(s.title).toBe("passthrough test");
    expect(s.teamOrder).toEqual([]);
    expect(s.background).toHaveLength(1);
    expect(s.background[0]!.agentType).toBe("general-purpose");
  });

  it("empty rosterTiles object → empty Map (size 0)", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "empty000",
          sessionId: "empty000-0000-0000-0000-000000000004",
          pid: 0,
          entrypoint: "cli",
          version: "2.1.145",
          isAlive: true,
          cwd: "/empty",
          title: "empty roster",
          rosterTiles: {},
          teamOrder: [],
          background: [],
        },
      ],
    };

    const out = hydrateState(wire);
    expect(out.sessions[0]!.rosterTiles).toBeInstanceOf(Map);
    expect(out.sessions[0]!.rosterTiles.size).toBe(0);
  });
});
