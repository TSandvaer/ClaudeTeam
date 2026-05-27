/**
 * Unit tests for src/extension/state/hideIdleFilter.ts (86c9zq9vm — spec 86c9zmyef).
 *
 * Sibling of `hideFinishedFilter.test.ts`. Coverage mirrors the M5 filter's
 * tests for the `idle` state — same invariants, different discriminator.
 *
 *   - Filter off: identity transform — same reference returned, count 0.
 *   - Filter on, no idle tiles: tree unchanged in content, count 0.
 *   - Filter on, bare AgentTile idle: tile dropped, count++.
 *   - Filter on, multiple states in mix: only idle filtered.
 *   - CollapsedPersonaGroup with all-idle instances: wrapper dropped.
 *   - CollapsedPersonaGroup with N>=2 survivors: wrapper kept w/ adjusted count.
 *   - CollapsedPersonaGroup with N=1 survivor: unwrapped to bare AgentTile.
 *   - Empty team after filter: team key + teamOrder entry removed.
 *   - Background agents never filtered.
 *   - hiddenIdleCount sums across sessions.
 *   - Input not mutated.
 *   - Pass-through fields preserved on the tree (filterApplied / rosterErrors /
 *     rosterWarnings).
 *
 * Source: src/extension/state/hideIdleFilter.ts
 *         team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md §3.3
 */

import { describe, it, expect } from "vitest";

import { applyHideIdleFilter } from "../../src/extension/state/hideIdleFilter.js";
import type {
  AgentState,
  AgentTile,
  AgentTree,
  BackgroundAgent,
  CollapsedPersonaGroup,
  RosterTileEntry,
  SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTile(memberId: string, state: AgentState): AgentTile {
  return {
    memberId,
    teamId: "claudeteam-alpha",
    display: memberId,
    role: "test",
    activity: state === "idle" ? "idle 1s" : "tool:Edit foo.ts",
    model: "claude-opus-4-7",
    state,
    agentId: `agent-${memberId}`,
    toolUseId: null,
  };
}

function makeGroup(
  personaName: string,
  states: AgentState[],
): CollapsedPersonaGroup {
  const instances = states.map((s, i) =>
    makeTile(`${personaName.toLowerCase()}-${i}`, s),
  );
  return {
    kind: "collapsed-persona",
    personaName,
    count: instances.length,
    instances,
  };
}

function makeBackground(state: AgentState): BackgroundAgent {
  return {
    agentType: "general-purpose",
    description: "bg agent",
    state,
    model: "claude-sonnet-4-5",
  };
}

function makeSession(
  rosterTiles: Map<string, RosterTileEntry[]>,
  background: BackgroundAgent[] = [],
): SessionTree {
  return {
    shortId: "sid12345",
    sessionId: "sid-12345",
    pid: 1234,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "test",
    rosterTiles,
    teamOrder: Array.from(rosterTiles.keys()),
    background,
  };
}

// ---------------------------------------------------------------------------
// Filter OFF — identity transform
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — filter off (identity transform)", () => {
  it("returns the input tree reference unchanged when hideIdle=false", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "idle"), makeTile("maya", "running")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, false);

    expect(result.tree).toBe(tree);
    expect(result.hiddenIdleCount).toBe(0);
  });

  it("count is 0 even when idle tiles exist", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "idle"), makeTile("maya", "idle")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, false);
    expect(result.hiddenIdleCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter ON — bare AgentTile handling
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — bare AgentTile", () => {
  it("drops idle tiles and counts them", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "idle"),
          makeTile("maya", "running"),
          makeTile("nora", "finished"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(2);
    expect(survivors!.map((s) => (s as AgentTile).memberId).sort()).toEqual([
      "maya",
      "nora",
    ]);
    expect(result.hiddenIdleCount).toBe(1);
  });

  it("keeps non-idle states intact (running / finished / error)", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("a", "running"),
          makeTile("b", "finished"),
          makeTile("c", "error"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toHaveLength(3);
    expect(result.hiddenIdleCount).toBe(0);
  });

  it("count is 0 when no idle tiles exist", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);
    expect(result.hiddenIdleCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter ON — CollapsedPersonaGroup handling
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — CollapsedPersonaGroup", () => {
  it("drops the entire wrapper when all instances are idle", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeGroup("Felix", ["idle", "idle", "idle"])]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toBeUndefined();
    expect(result.tree.sessions[0]!.teamOrder).toEqual([]);
    expect(result.hiddenIdleCount).toBe(3);
  });

  it("rebuilds wrapper with survivors when N>=2 remain", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeGroup("Felix", ["running", "idle", "finished", "idle"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    const grp = survivors![0] as CollapsedPersonaGroup;
    expect(grp.kind).toBe("collapsed-persona");
    expect(grp.personaName).toBe("Felix");
    expect(grp.count).toBe(2);
    expect(grp.instances).toHaveLength(2);
    expect(grp.instances.map((i) => i.state).sort()).toEqual([
      "finished",
      "running",
    ]);
    expect(result.hiddenIdleCount).toBe(2);
  });

  it("unwraps to bare AgentTile when only 1 survivor remains", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeGroup("Felix", ["idle", "idle", "running"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    const entry = survivors![0]!;
    expect("kind" in entry).toBe(false);
    expect((entry as AgentTile).state).toBe("running");
    expect(result.hiddenIdleCount).toBe(2);
  });

  it("keeps wrapper intact when no instances are idle", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeGroup("Felix", ["running", "finished"])]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    const grp = survivors![0] as CollapsedPersonaGroup;
    expect(grp.count).toBe(2);
    expect(result.hiddenIdleCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Empty-team suppression + teamOrder
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — empty-team suppression", () => {
  it("removes team key + teamOrder entry when all tiles drop", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "idle"), makeTile("maya", "idle")],
      ],
      ["team-beta", [makeTile("nora", "running")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    const session = result.tree.sessions[0]!;
    expect(session.rosterTiles.has("claudeteam-alpha")).toBe(false);
    expect(session.rosterTiles.has("team-beta")).toBe(true);
    expect(session.teamOrder).toEqual(["team-beta"]);
    expect(result.hiddenIdleCount).toBe(2);
  });

  it("preserves teamOrder declaration order for surviving teams", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["team-a", [makeTile("a", "running")]],
      ["team-b", [makeTile("b", "idle")]],
      ["team-c", [makeTile("c", "finished")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    expect(result.tree.sessions[0]!.teamOrder).toEqual(["team-a", "team-c"]);
    expect(result.hiddenIdleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Background agents — NEVER filtered (spec §3.3)
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — background agents", () => {
  it("background list passes through unchanged regardless of idle state", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "idle")]],
    ]);
    const background = [
      makeBackground("idle"),
      makeBackground("running"),
      makeBackground("idle"),
    ];
    const tree: AgentTree = { sessions: [makeSession(tiles, background)] };

    const result = applyHideIdleFilter(tree, true);

    // Background untouched — all 3 still present.
    expect(result.tree.sessions[0]!.background).toHaveLength(3);
    // hiddenIdleCount counts ONLY rostered tiles, not background.
    expect(result.hiddenIdleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-session count aggregation
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — multi-session aggregation", () => {
  it("hiddenIdleCount sums across sessions", () => {
    const tilesA = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "idle"), makeTile("maya", "idle")],
      ],
    ]);
    const tilesB = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("nora", "idle"), makeTile("iris", "running")],
      ],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tilesA), makeSession(tilesB)],
    };

    const result = applyHideIdleFilter(tree, true);

    expect(result.hiddenIdleCount).toBe(3);
    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toBeUndefined();
    expect(
      result.tree.sessions[1]!.rosterTiles.get("claudeteam-alpha"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Immutability — input tree not mutated
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — input not mutated", () => {
  it("filter on does not mutate the input tree", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "idle"), makeTile("maya", "running")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    applyHideIdleFilter(tree, true);

    expect(tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")).toHaveLength(
      2,
    );
    expect(tree.sessions[0]!.teamOrder).toEqual(["claudeteam-alpha"]);
  });
});

// ---------------------------------------------------------------------------
// Pass-through fields
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — pass-through fields", () => {
  it("preserves filterApplied / rosterErrors / rosterWarnings on the tree", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running")]],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tiles)],
      filterApplied: true,
      rosterErrors: ["sample error"],
      rosterWarnings: ["sample warning"],
    };

    const result = applyHideIdleFilter(tree, true);

    expect(result.tree.filterApplied).toBe(true);
    expect(result.tree.rosterErrors).toEqual(["sample error"]);
    expect(result.tree.rosterWarnings).toEqual(["sample warning"]);
  });

  it("preserves hiddenFinishedCount when stacked after applyHideFinishedFilter", () => {
    // Composition smoke — when this filter runs on a tree that already
    // carries a hiddenFinishedCount stamped by hideFinishedFilter, the
    // existing count survives the shallow spread.
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "idle")]],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tiles)],
      hiddenFinishedCount: 4,
    };

    const result = applyHideIdleFilter(tree, true);

    expect(result.tree.hiddenFinishedCount).toBe(4);
    expect(result.hiddenIdleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Composition with hideFinishedFilter (M5) — disjoint states
// ---------------------------------------------------------------------------

describe("applyHideIdleFilter — composition with hideFinishedFilter", () => {
  it("only idle is filtered when finished filter ran first leaving idle tiles", () => {
    // After hideFinishedFilter has dropped all finished tiles, hideIdleFilter
    // should pick off the remaining idle entries without touching running.
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "running"),
          makeTile("maya", "idle"),
          makeTile("nora", "idle"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    expect((survivors![0] as AgentTile).memberId).toBe("felix");
    expect(result.hiddenIdleCount).toBe(2);
  });
});
