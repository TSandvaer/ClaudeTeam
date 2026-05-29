/**
 * Unit tests for src/extension/state/hideFinishedFilter.ts (M5-EH).
 *
 * Coverage (per spec §3.2 / §3.4 invariants):
 *   - Filter off: identity transform — same reference returned, count 0.
 *   - Filter on, no finished tiles: tree unchanged in content, count 0.
 *   - Filter on, bare AgentTile finished: tile dropped, count++.
 *   - Filter on, multiple finished states in mix: only finished filtered.
 *   - CollapsedPersonaGroup with all-finished instances: wrapper dropped.
 *   - CollapsedPersonaGroup with N>=2 survivors: wrapper kept w/ adjusted count.
 *   - CollapsedPersonaGroup with N=1 survivor: unwrapped to bare AgentTile.
 *   - Empty team after filter: team key + teamOrder entry removed.
 *   - Background agents never filtered.
 *   - hiddenFinishedCount sums across sessions.
 *   - Input not mutated.
 *
 * Source: src/extension/state/hideFinishedFilter.ts
 *         team/iris-ux/m5-hide-finished-spec.md §3 + §7.1
 */

import { describe, it, expect } from "vitest";

import { applyHideFinishedFilter } from "../../src/extension/state/hideFinishedFilter.js";
import type {
  AgentState,
  AgentTile,
  AgentTree,
  BackgroundAgent,
  CollapsedPersonaGroup,
  MultiAgentPersonaTile,
  RosterTileEntry,
  SessionTree,
} from "../../src/shared/types.js";
import {
  computeAggregateState,
  isMultiAgentPersonaTile,
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
    activity: state === "finished" ? "finished" : "idle 1s",
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

/**
 * 86ca1dtr5 — build a MultiAgentPersonaTile (the wrapper the reducer now emits
 * for rostered N≥2). One memberId shared across instances; aggregate/headline
 * derived to match what the reducer would produce.
 */
function makeMultiAgentGroup(
  memberId: string,
  states: AgentState[],
): MultiAgentPersonaTile {
  const instances = states.map((s, i) => {
    const t = makeTile(memberId, s);
    return { ...t, agentId: `agent-${memberId}-${i}` };
  });
  const aggregateState = computeAggregateState(instances);
  const headline =
    instances.find((i) => i.state === aggregateState) ?? instances[0]!;
  return {
    kind: "multi-agent-persona",
    memberId,
    teamId: "claudeteam-alpha",
    display: memberId,
    role: "test",
    aggregateState,
    headlineActivity: headline.activity,
    headlineModel: headline.model,
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

describe("applyHideFinishedFilter — filter off (identity transform)", () => {
  it("returns the input tree reference unchanged when hideFinished=false", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "finished"), makeTile("maya", "running")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, false);

    // Referential identity (spec §3.4 invariant 1).
    expect(result.tree).toBe(tree);
    expect(result.hiddenFinishedCount).toBe(0);
  });

  it("count is 0 even when finished tiles exist", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "finished"), makeTile("maya", "finished")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, false);
    expect(result.hiddenFinishedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter ON — bare AgentTile handling
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — bare AgentTile", () => {
  it("drops finished tiles and counts them", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "finished"),
          makeTile("maya", "running"),
          makeTile("nora", "idle"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(2);
    expect(survivors!.map((s) => (s as AgentTile).memberId).sort()).toEqual([
      "maya",
      "nora",
    ]);
    expect(result.hiddenFinishedCount).toBe(1);
  });

  it("keeps non-finished states intact (running / idle / error)", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("a", "running"),
          makeTile("b", "idle"),
          makeTile("c", "error"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toHaveLength(3);
    expect(result.hiddenFinishedCount).toBe(0);
  });

  it("count is 0 when no finished tiles exist", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);
    expect(result.hiddenFinishedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter ON — CollapsedPersonaGroup handling
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — CollapsedPersonaGroup", () => {
  it("drops the entire wrapper when all instances are finished", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeGroup("Felix", ["finished", "finished", "finished"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    // Team key removed (empty team after filter).
    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toBeUndefined();
    expect(result.tree.sessions[0]!.teamOrder).toEqual([]);
    expect(result.hiddenFinishedCount).toBe(3);
  });

  it("rebuilds wrapper with survivors when N>=2 remain", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeGroup("Felix", ["running", "finished", "idle", "finished"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

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
      "idle",
      "running",
    ]);
    expect(result.hiddenFinishedCount).toBe(2);
  });

  it("unwraps to bare AgentTile when only 1 survivor remains", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeGroup("Felix", ["finished", "finished", "running"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    // Unwrapped — no `kind` field on a bare AgentTile.
    const entry = survivors![0]!;
    expect("kind" in entry).toBe(false);
    expect((entry as AgentTile).state).toBe("running");
    expect(result.hiddenFinishedCount).toBe(2);
  });

  it("keeps wrapper intact when no instances are finished", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeGroup("Felix", ["running", "idle"])]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    const grp = survivors![0] as CollapsedPersonaGroup;
    expect(grp.count).toBe(2);
    expect(result.hiddenFinishedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Filter ON — MultiAgentPersonaTile handling (86ca1dtr5). The same rebuild
// helper backs hideIdle / hideMembers / removeMembers, so this describe is the
// representative coverage for the shared `rebuildMultiAgentTileFromInstances`.
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — MultiAgentPersonaTile (86ca1dtr5)", () => {
  it("drops the whole wrapper when all instances are finished", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeMultiAgentGroup("felix", ["finished", "finished"])]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    // Whole team empties → team key removed.
    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toBeUndefined();
    expect(result.hiddenFinishedCount).toBe(2);
  });

  it("unwraps to a bare AgentTile when exactly one survivor remains", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeMultiAgentGroup("felix", ["finished", "running"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    const entry = survivors![0]!;
    expect("kind" in entry).toBe(false);
    expect((entry as AgentTile).state).toBe("running");
    expect(result.hiddenFinishedCount).toBe(1);
  });

  it("keeps the wrapper with recomputed aggregate/count when ≥2 survive", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeMultiAgentGroup("felix", ["finished", "running", "idle"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    const grp = survivors![0]!;
    expect(isMultiAgentPersonaTile(grp)).toBe(true);
    const wrapper = grp as MultiAgentPersonaTile;
    expect(wrapper.count).toBe(2);
    expect(wrapper.instances).toHaveLength(2);
    // Aggregate recomputed over survivors (running + idle) → running.
    expect(wrapper.aggregateState).toBe("running");
    expect(result.hiddenFinishedCount).toBe(1);
  });

  it("keeps wrapper intact when no instances are finished", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeMultiAgentGroup("felix", ["running", "idle"])]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const survivors = result.tree.sessions[0]!.rosterTiles.get(
      "claudeteam-alpha",
    );
    expect(survivors).toHaveLength(1);
    expect(isMultiAgentPersonaTile(survivors![0]!)).toBe(true);
    expect((survivors![0] as MultiAgentPersonaTile).count).toBe(2);
    expect(result.hiddenFinishedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Empty-team suppression + teamOrder
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — empty-team suppression", () => {
  it("removes team key + teamOrder entry when all tiles drop", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "finished"), makeTile("maya", "finished")],
      ],
      ["team-beta", [makeTile("nora", "running")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    const session = result.tree.sessions[0]!;
    expect(session.rosterTiles.has("claudeteam-alpha")).toBe(false);
    expect(session.rosterTiles.has("team-beta")).toBe(true);
    expect(session.teamOrder).toEqual(["team-beta"]);
    expect(result.hiddenFinishedCount).toBe(2);
  });

  it("preserves teamOrder declaration order for surviving teams", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["team-a", [makeTile("a", "running")]],
      ["team-b", [makeTile("b", "finished")]],
      ["team-c", [makeTile("c", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    expect(result.tree.sessions[0]!.teamOrder).toEqual(["team-a", "team-c"]);
    expect(result.hiddenFinishedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Background agents — NEVER filtered (spec §3.2)
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — background agents", () => {
  it("background list passes through unchanged regardless of finished state", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "finished")]],
    ]);
    const background = [
      makeBackground("finished"),
      makeBackground("running"),
      makeBackground("finished"),
    ];
    const tree: AgentTree = { sessions: [makeSession(tiles, background)] };

    const result = applyHideFinishedFilter(tree, true);

    // Background untouched — all 3 still present.
    expect(result.tree.sessions[0]!.background).toHaveLength(3);
    // hiddenFinishedCount counts ONLY rostered tiles, not background.
    expect(result.hiddenFinishedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Multi-session count aggregation
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — multi-session aggregation", () => {
  it("hiddenFinishedCount sums across sessions", () => {
    const tilesA = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "finished"), makeTile("maya", "finished")],
      ],
    ]);
    const tilesB = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("nora", "finished"), makeTile("iris", "running")],
      ],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tilesA), makeSession(tilesB)],
    };

    const result = applyHideFinishedFilter(tree, true);

    expect(result.hiddenFinishedCount).toBe(3);
    // Session A: all dropped → empty team.
    expect(
      result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha"),
    ).toBeUndefined();
    // Session B: 1 survivor.
    expect(
      result.tree.sessions[1]!.rosterTiles.get("claudeteam-alpha"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Immutability — input tree not mutated
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — input not mutated", () => {
  it("filter on does not mutate the input tree", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "finished"),
          makeTile("maya", "running"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    applyHideFinishedFilter(tree, true);

    // Original still has 2 tiles (would be 1 if mutated).
    expect(tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")).toHaveLength(
      2,
    );
    expect(tree.sessions[0]!.teamOrder).toEqual(["claudeteam-alpha"]);
  });
});

// ---------------------------------------------------------------------------
// Pass-through fields
// ---------------------------------------------------------------------------

describe("applyHideFinishedFilter — pass-through fields", () => {
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

    const result = applyHideFinishedFilter(tree, true);

    expect(result.tree.filterApplied).toBe(true);
    expect(result.tree.rosterErrors).toEqual(["sample error"]);
    expect(result.tree.rosterWarnings).toEqual(["sample warning"]);
  });
});
