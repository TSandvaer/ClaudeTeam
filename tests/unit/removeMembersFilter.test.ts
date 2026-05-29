/**
 * Unit tests for src/extension/state/removeMembersFilter.ts
 * (E-07a / EPIC 86ca11187 §7.3 — yaml-gated remove-agent, HOST portion).
 *
 * Structural sibling of `hideMembersFilter.test.ts`: the suppression mechanics
 * are identical (drop by `(teamId, memberId)` set-membership, state-independent,
 * prune empty teams, never touch background). The DIFFERENCE between hide and
 * remove is downstream of this filter (remove is also absent from the wire's
 * reveal surface — exercised in the watcherLoop integration test), not in the
 * filter's drop behavior.
 *
 *   - Empty set: identity transform — same reference, count 0.
 *   - Bare AgentTile removed: dropped, count++.
 *   - Remove is state-INDEPENDENT (running/idle/finished/available/error).
 *   - (teamId, memberId) keying: same memberId in two teams removed independently.
 *   - CollapsedPersonaGroup removed: whole wrapper dropped; count = instances.
 *   - Empty team after filter: team key + teamOrder entry removed.
 *   - Background agents never filtered.
 *   - Input not mutated; supplied set never grown (AC4).
 *
 * Source: src/extension/state/removeMembersFilter.ts
 *         team/iris-ux/whole-team-display-spec.md §7.3 + DECISIONS §30
 */

import { describe, it, expect } from "vitest";

import { applyRemoveMembersFilter } from "../../src/extension/state/removeMembersFilter.js";
import {
  removedMemberKey,
  type AgentState,
  type AgentTile,
  type AgentTree,
  type BackgroundAgent,
  type CollapsedPersonaGroup,
  type RemovedMemberKey,
  type RosterTileEntry,
  type SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures (mirror hideMembersFilter.test.ts)
// ---------------------------------------------------------------------------

function makeTile(
  memberId: string,
  state: AgentState,
  teamId = "claudeteam-alpha",
): AgentTile {
  return {
    memberId,
    teamId,
    display: memberId,
    role: "test",
    activity: state === "available" ? "available" : "tool:Edit foo.ts",
    model: state === "available" ? "model:?" : "claude-opus-4-7",
    state,
    agentId: state === "available" ? "" : `agent-${memberId}`,
    toolUseId: null,
  };
}

function makeGroup(
  personaName: string,
  memberId: string,
  states: AgentState[],
  teamId = "claudeteam-alpha",
): CollapsedPersonaGroup {
  const instances = states.map((s) => {
    const t = makeTile(memberId, s, teamId);
    return { ...t, agentId: `agent-${memberId}-${s}` };
  });
  return {
    kind: "collapsed-persona",
    personaName,
    count: instances.length,
    instances,
  };
}

function makeBackground(): BackgroundAgent {
  return {
    agentType: "general-purpose",
    description: "bg agent",
    state: "running",
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

function removedSet(...keys: RemovedMemberKey[]): Set<RemovedMemberKey> {
  return new Set(keys);
}

// ---------------------------------------------------------------------------

describe("applyRemoveMembersFilter — empty set (identity transform)", () => {
  it("returns the input tree reference unchanged when the set is empty", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyRemoveMembersFilter(tree, new Set());

    expect(result.tree).toBe(tree);
    expect(result.removedMemberCount).toBe(0);
  });
});

describe("applyRemoveMembersFilter — bare tile suppression", () => {
  it("drops a removed member's tile and bumps the count", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyRemoveMembersFilter(
      tree,
      removedSet(removedMemberKey("claudeteam-alpha", "felix")),
    );

    const survivors = result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")!;
    expect(survivors).toHaveLength(1);
    expect((survivors[0] as AgentTile).memberId).toBe("maya");
    expect(result.removedMemberCount).toBe(1);
  });

  it.each<AgentState>(["running", "idle", "finished", "available", "error"])(
    "suppresses a removed member regardless of tile state=%s (state-independent)",
    (state) => {
      const tiles = new Map<string, RosterTileEntry[]>([
        ["claudeteam-alpha", [makeTile("felix", state)]],
      ]);
      const tree: AgentTree = { sessions: [makeSession(tiles)] };

      const result = applyRemoveMembersFilter(
        tree,
        removedSet(removedMemberKey("claudeteam-alpha", "felix")),
      );

      // team becomes empty → team key + teamOrder removed
      expect(result.tree.sessions[0]!.rosterTiles.has("claudeteam-alpha")).toBe(
        false,
      );
      expect(result.tree.sessions[0]!.teamOrder).not.toContain("claudeteam-alpha");
      expect(result.removedMemberCount).toBe(1);
    },
  );

  it("keys by (teamId, memberId) — same memberId in two teams removed independently", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["team-a", [makeTile("felix", "running", "team-a")]],
      ["team-b", [makeTile("felix", "running", "team-b")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyRemoveMembersFilter(
      tree,
      removedSet(removedMemberKey("team-a", "felix")),
    );

    expect(result.tree.sessions[0]!.rosterTiles.has("team-a")).toBe(false);
    expect(result.tree.sessions[0]!.rosterTiles.get("team-b")).toHaveLength(1);
    expect(result.removedMemberCount).toBe(1);
  });
});

describe("applyRemoveMembersFilter — CollapsedPersonaGroup", () => {
  it("drops the whole wrapper when its shared member is removed; count = instances", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeGroup("Bram", "bram", ["running", "running", "idle"])]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyRemoveMembersFilter(
      tree,
      removedSet(removedMemberKey("claudeteam-alpha", "bram")),
    );

    expect(result.tree.sessions[0]!.rosterTiles.has("claudeteam-alpha")).toBe(
      false,
    );
    expect(result.removedMemberCount).toBe(3);
  });
});

describe("applyRemoveMembersFilter — background + immutability", () => {
  it("never filters background agents (no member id to remove)", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running")]],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tiles, [makeBackground(), makeBackground()])],
    };

    const result = applyRemoveMembersFilter(
      tree,
      removedSet(removedMemberKey("claudeteam-alpha", "felix")),
    );

    expect(result.tree.sessions[0]!.background).toHaveLength(2);
  });

  it("does not mutate its input tree and never grows the supplied set (AC4)", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };
    const set = removedSet(removedMemberKey("claudeteam-alpha", "felix"));
    const sizeBefore = set.size;

    const result = applyRemoveMembersFilter(tree, set);

    // input untouched
    expect(tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")).toHaveLength(2);
    // result is a fresh tree
    expect(result.tree).not.toBe(tree);
    // set never grown
    expect(set.size).toBe(sizeBefore);
  });

  it("sums removedMemberCount across sessions", () => {
    const t1 = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running")]],
    ]);
    const t2 = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "idle")]],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(t1), makeSession(t2)],
    };

    const result = applyRemoveMembersFilter(
      tree,
      removedSet(removedMemberKey("claudeteam-alpha", "felix")),
    );

    expect(result.removedMemberCount).toBe(2);
  });
});
