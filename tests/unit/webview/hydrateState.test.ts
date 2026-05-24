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
    // The hydrator's value type is `RosterTileEntry[]` (M3-10 widened
    // union — bare `AgentTile` or `CollapsedPersonaGroup`). This test
    // wires bare AgentTiles; narrow via cast to access `memberId`.
    const entries = rt.get("claudeteam-alpha")!;
    expect((entries[0] as AgentTile).memberId).toBe("felix");
    expect((entries[1] as AgentTile).memberId).toBe("maya");
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

// ===========================================================================
// M3-09 bonus — back-compat hydrator branches for filterApplied /
// rosterErrors / rosterWarnings. These three top-level fields were added in
// M3-03 (filterApplied) and M3-04 (rosterErrors/rosterWarnings). The hydrator
// conditionally spreads them so the output preserves the host's "field
// present" vs "field absent" intent — older host code that doesn't yet wire
// these fields stays compatible (the renderer treats absence as "false" /
// "empty []"). These tests catch the regression where a future refactor
// flattens the conditional spreads and forces every output to carry a
// concrete value (which would break diff-based optimizations downstream).
//
// Source: src/webview/main.ts hydrateState top-level field branches
//         src/shared/messages.ts SerializedDashboardState field optionality
//         M3-09 PR #39-review gap (1): "hydrateState carrying rosterErrors /
//                                       rosterWarnings / filterApplied"
// ===========================================================================

describe("hydrateState — back-compat top-level field handling (M3-09 NIT)", () => {
  // Minimal wire fixture — no sessions, used to isolate the top-level
  // field assertions from session-rebuild noise.
  const EMPTY_WIRE: SerializedDashboardState = { sessions: [] };

  it("absent filterApplied / rosterErrors / rosterWarnings → absent on output (back-compat)", () => {
    const out = hydrateState(EMPTY_WIRE);
    // Use the `in` operator (not `=== undefined`) to distinguish "key
    // genuinely absent" from "key present with undefined value". The
    // hydrator's conditional spread is meant to produce the former, not
    // the latter — a regression that always sets the key would still pass
    // `=== undefined` but fail this `in` check.
    expect("filterApplied" in out).toBe(false);
    expect("rosterErrors" in out).toBe(false);
    expect("rosterWarnings" in out).toBe(false);
  });

  it("filterApplied=true on wire → filterApplied=true on output", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: true,
    };
    const out = hydrateState(wire);
    expect(out.filterApplied).toBe(true);
  });

  it("filterApplied=false on wire → filterApplied=false on output (preserves the explicit false)", () => {
    // Regression target: an early version of the hydrator collapsed
    // `false` to "absent" via a truthiness check. The explicit `false`
    // distinguishes "host told us no filter ran" from "host didn't
    // include the field" — the renderer's diff logic uses both signals.
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: false,
    };
    const out = hydrateState(wire);
    expect("filterApplied" in out).toBe(true);
    expect(out.filterApplied).toBe(false);
  });

  it("rosterErrors=[] on wire → rosterErrors=[] on output (preserves the explicit empty)", () => {
    // Distinguishing empty-array from absent matters because the chip's
    // dismiss-key reset logic fires on transition between "errors present"
    // and "errors absent" — if hydrator drops `[]` to undefined, the diff
    // shape changes spuriously.
    const wire: SerializedDashboardState = {
      sessions: [],
      rosterErrors: [],
    };
    const out = hydrateState(wire);
    expect("rosterErrors" in out).toBe(true);
    expect(out.rosterErrors).toEqual([]);
  });

  it("rosterErrors with values on wire → preserved verbatim on output", () => {
    const errors = [
      "global roster YAML parse error (/x/teams.yaml): bad indent at line 3",
      "global roster schema error at teams.0.members.0.id: required",
    ];
    const wire: SerializedDashboardState = {
      sessions: [],
      rosterErrors: errors,
    };
    const out = hydrateState(wire);
    expect(out.rosterErrors).toEqual(errors);
    // Identity check: hydrator should pass-through, not deep-clone (no
    // reason to spend the bytes; consumers treat the array as read-only).
    expect(out.rosterErrors).toBe(errors);
  });

  it("rosterWarnings on wire → preserved verbatim on output", () => {
    // Same path as rosterErrors but for the warnings field (separate
    // optional spread in the hydrator). If both fields share a generic
    // helper that drops one of them, this catches the regression.
    const warnings = [
      "global roster file is empty: /x/teams.yaml",
      'duplicate member id "felix" across teams "alpha" and "beta" — second wins by load order',
    ];
    const wire: SerializedDashboardState = {
      sessions: [],
      rosterWarnings: warnings,
    };
    const out = hydrateState(wire);
    expect(out.rosterWarnings).toEqual(warnings);
    expect(out.rosterWarnings).toBe(warnings);
  });

  it("all three top-level fields together → all preserved independently", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: true,
      rosterErrors: ["err A"],
      rosterWarnings: ["warn B"],
    };
    const out = hydrateState(wire);
    expect(out.filterApplied).toBe(true);
    expect(out.rosterErrors).toEqual(["err A"]);
    expect(out.rosterWarnings).toEqual(["warn B"]);
  });
});
