/**
 * Unit tests for src/extension/state/hideMembersFilter.ts
 * (E-06a / EPIC 86ca11187 §7.2 — reversible hide-agent, HOST portion).
 *
 * Sibling of `hideIdleFilter.test.ts` / `hideFinishedFilter.test.ts`. The
 * predicate differs: suppression is by `(teamId, memberId)` set-membership,
 * INDEPENDENT of tile state.
 *
 *   - Empty set: identity transform — same reference, count 0.
 *   - Non-empty set, bare AgentTile hidden: dropped, count++.
 *   - Hide is state-INDEPENDENT: a hidden running/idle/finished/available tile
 *     is all dropped (the AC distinguishing this filter from the state filters).
 *   - (teamId, memberId) keying: same memberId in two teams is hidden
 *     independently.
 *   - CollapsedPersonaGroup with hidden member: whole wrapper dropped; count =
 *     instances.length.
 *   - CollapsedPersonaGroup mixed memberIds (defensive): only hidden instances
 *     dropped; survivors rebuilt (N=0 drop / N=1 unwrap / N>=2 keep).
 *   - Empty team after filter: team key + teamOrder entry removed.
 *   - Background agents never filtered.
 *   - hiddenMemberCount sums across sessions.
 *   - Input not mutated.
 *   - Pass-through fields preserved.
 *   - **AC4 regression guard**: the filter never ADDS to the set — it is a pure
 *     read; the supplied set is unchanged after the call.
 *
 * Source: src/extension/state/hideMembersFilter.ts
 *         team/iris-ux/whole-team-display-spec.md §7.2 + §11
 */

import { describe, it, expect } from "vitest";

import { applyHideMembersFilter } from "../../src/extension/state/hideMembersFilter.js";
import {
  hiddenMemberKey,
  isCollapsedPersonaGroup,
  type AgentState,
  type AgentTile,
  type AgentTree,
  type BackgroundAgent,
  type CollapsedPersonaGroup,
  type HiddenMemberKey,
  type RosterTileEntry,
  type SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
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

function hiddenSet(...keys: HiddenMemberKey[]): Set<HiddenMemberKey> {
  return new Set(keys);
}

// ---------------------------------------------------------------------------
// Empty set — identity transform
// ---------------------------------------------------------------------------

describe("applyHideMembersFilter — empty set (identity transform)", () => {
  it("returns the input tree reference unchanged when the set is empty", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideMembersFilter(tree, new Set());

    expect(result.tree).toBe(tree);
    expect(result.hiddenMemberCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Bare tile suppression
// ---------------------------------------------------------------------------

describe("applyHideMembersFilter — bare tile suppression", () => {
  it("drops a hidden member's tile and bumps the count", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    const survivors = result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")!;
    expect(survivors).toHaveLength(1);
    expect((survivors[0] as AgentTile).memberId).toBe("maya");
    expect(result.hiddenMemberCount).toBe(1);
  });

  it.each<AgentState>(["running", "idle", "finished", "available", "error"])(
    "suppresses a hidden member regardless of tile state=%s (state-independent)",
    (state) => {
      const tiles = new Map<string, RosterTileEntry[]>([
        ["claudeteam-alpha", [makeTile("felix", state)]],
      ]);
      const tree: AgentTree = { sessions: [makeSession(tiles)] };

      const result = applyHideMembersFilter(
        tree,
        hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
      );

      // team becomes empty → team key + teamOrder removed
      expect(result.tree.sessions[0]!.rosterTiles.has("claudeteam-alpha")).toBe(false);
      expect(result.tree.sessions[0]!.teamOrder).not.toContain("claudeteam-alpha");
      expect(result.hiddenMemberCount).toBe(1);
    },
  );

  it("keys by (teamId, memberId) — same memberId in two teams hidden independently", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["team-a", [makeTile("felix", "running", "team-a")]],
      ["team-b", [makeTile("felix", "running", "team-b")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("team-a", "felix")),
    );

    expect(result.tree.sessions[0]!.rosterTiles.has("team-a")).toBe(false);
    expect(result.tree.sessions[0]!.rosterTiles.get("team-b")).toHaveLength(1);
    expect(result.hiddenMemberCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CollapsedPersonaGroup
// ---------------------------------------------------------------------------

describe("applyHideMembersFilter — CollapsedPersonaGroup", () => {
  it("drops the whole wrapper when its member is hidden; count = instances", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeGroup("Felix", "felix", ["running", "idle", "finished"])],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    expect(result.tree.sessions[0]!.rosterTiles.has("claudeteam-alpha")).toBe(false);
    expect(result.hiddenMemberCount).toBe(3);
  });

  it("defensive: mixed-memberId wrapper drops only hidden instances, rebuilds survivors", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Mixed",
      count: 3,
      instances: [
        makeTile("felix", "running"),
        makeTile("maya", "running"),
        makeTile("sage", "running"),
      ],
    };
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [group]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    const survivors = result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")!;
    expect(survivors).toHaveLength(1);
    const entry = survivors[0]!;
    expect(isCollapsedPersonaGroup(entry)).toBe(true);
    expect((entry as CollapsedPersonaGroup).count).toBe(2);
    expect(result.hiddenMemberCount).toBe(1);
  });

  it("defensive: mixed-memberId wrapper with 1 survivor unwraps to a bare tile", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Mixed",
      count: 2,
      instances: [makeTile("felix", "running"), makeTile("maya", "running")],
    };
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [group]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    const survivors = result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")!;
    expect(survivors).toHaveLength(1);
    expect(isCollapsedPersonaGroup(survivors[0]!)).toBe(false);
    expect((survivors[0] as AgentTile).memberId).toBe("maya");
  });
});

// ---------------------------------------------------------------------------
// Background + count summation + immutability + pass-through
// ---------------------------------------------------------------------------

describe("applyHideMembersFilter — invariants", () => {
  it("never filters background agents", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running")]],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tiles, [makeBackground(), makeBackground()])],
    };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    expect(result.tree.sessions[0]!.background).toHaveLength(2);
  });

  it("sums hiddenMemberCount across sessions", () => {
    const s1 = makeSession(
      new Map([["claudeteam-alpha", [makeTile("felix", "running")]]]),
    );
    const s2 = makeSession(
      new Map([["claudeteam-alpha", [makeTile("felix", "idle")]]]),
    );
    const tree: AgentTree = { sessions: [s1, s2] };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    expect(result.hiddenMemberCount).toBe(2);
  });

  it("does not mutate the input tree", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    // Original tree untouched: felix still present.
    expect(tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")).toHaveLength(2);
  });

  it("preserves pass-through fields on the produced tree", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      ["claudeteam-alpha", [makeTile("felix", "running"), makeTile("maya", "idle")]],
    ]);
    const tree: AgentTree = {
      sessions: [makeSession(tiles)],
      filterApplied: true,
      rosterErrors: ["err"],
      rosterWarnings: ["warn"],
      hiddenFinishedCount: 1,
      hiddenIdleCount: 2,
    };

    const result = applyHideMembersFilter(
      tree,
      hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix")),
    );

    expect(result.tree.filterApplied).toBe(true);
    expect(result.tree.rosterErrors).toEqual(["err"]);
    expect(result.tree.rosterWarnings).toEqual(["warn"]);
    expect(result.tree.hiddenFinishedCount).toBe(1);
    expect(result.tree.hiddenIdleCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC4 — regression guard: NO auto-hide / the filter never adds to the set
// ---------------------------------------------------------------------------

describe("applyHideMembersFilter — AC4 regression guard (no auto-hide)", () => {
  it("never mutates the supplied hidden set (pure read)", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "idle"),
          makeTile("maya", "finished"),
          makeTile("sage", "running"),
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const set = hiddenSet(hiddenMemberKey("claudeteam-alpha", "felix"));
    const sizeBefore = set.size;
    const snapshotBefore = [...set].sort();

    applyHideMembersFilter(tree, set);

    // The set is unchanged — the filter does NOT add idle/finished members to
    // it (that would be auto-hide, which the sponsor REJECTED, DECISIONS §36).
    expect(set.size).toBe(sizeBefore);
    expect([...set].sort()).toEqual(snapshotBefore);
  });

  it("idle and finished tiles whose member is NOT in the set stay visible", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("felix", "idle"), makeTile("maya", "finished")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    // Empty set → nothing hidden, even though tiles are idle/finished. There is
    // no time/inactivity path that would suppress them.
    const result = applyHideMembersFilter(tree, new Set());

    expect(result.tree.sessions[0]!.rosterTiles.get("claudeteam-alpha")).toHaveLength(2);
    expect(result.hiddenMemberCount).toBe(0);
  });
});
