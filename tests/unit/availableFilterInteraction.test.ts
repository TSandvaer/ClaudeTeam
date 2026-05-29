/**
 * Filter-interaction regression for the roster-baseline `"available"` state
 * (E-05 / 86ca19uk1, whole-team-display-spec §2 + §1 of EPIC 86ca11187).
 *
 * AC3 (load-bearing): `hideIdleAgents` / `hideFinishedAgents` must NOT hide
 * baseline `available` tiles. The whole-team-always-visible thesis depends on
 * a never-run member still rendering even when the sponsor has flipped the
 * idle/finished filters — that was the exact failure the epic exists to fix
 * (spec §1.1: flipping hideIdle + hideFinished still hid never-run members
 * because no tile was minted; now a baseline tile IS minted and the filters
 * must leave it alone).
 *
 * The filters already drop ONLY their exact discriminator state
 * (`state === "idle"` / `state === "finished"`), so `available` survives by
 * construction. This file locks that behavior against future edits to either
 * filter's predicate — a regression here would silently re-break the epic.
 *
 * Source: src/extension/state/hideIdleFilter.ts (predicate `state === "idle"`)
 *         src/extension/state/hideFinishedFilter.ts (predicate `state === "finished"`)
 *         .claude/docs/architecture-overview.md § "`available` — the
 *           roster-baseline state" (Filter interaction, load-bearing)
 */

import { describe, it, expect } from "vitest";

import { applyHideIdleFilter } from "../../src/extension/state/hideIdleFilter.js";
import { applyHideFinishedFilter } from "../../src/extension/state/hideFinishedFilter.js";
import type {
  AgentState,
  AgentTile,
  AgentTree,
  RosterTileEntry,
  SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures (mirror hideIdleFilter.test.ts / hideFinishedFilter.test.ts shape)
// ---------------------------------------------------------------------------

function makeTile(memberId: string, state: AgentState): AgentTile {
  return {
    memberId,
    teamId: "claudeteam-alpha",
    display: memberId,
    role: "test",
    // The reducer seeds baseline tiles with the literal "available" activity
    // (types.ts § available); other states get a representative line.
    activity:
      state === "available"
        ? "available"
        : state === "idle"
          ? "idle 1s"
          : "tool:Edit foo.ts",
    model: "model:?",
    state,
    agentId: state === "available" ? "" : `agent-${memberId}`,
    toolUseId: null,
  };
}

function makeSession(rosterTiles: Map<string, RosterTileEntry[]>): SessionTree {
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
    background: [],
  };
}

function survivorsOf(tree: AgentTree): string[] {
  return (tree.sessions[0]!.rosterTiles.get("claudeteam-alpha") ?? [])
    .map((e) => (e as AgentTile).memberId)
    .sort();
}

// ---------------------------------------------------------------------------
// AC3 — hide-idle does NOT drop available
// ---------------------------------------------------------------------------

describe("available baseline survives hide-idle filter (AC3)", () => {
  it("keeps available tiles when hideIdle=true; drops only idle", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "idle"), // dropped
          makeTile("nora", "available"), // kept
          makeTile("iris", "available"), // kept
          makeTile("maya", "running"), // kept
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    expect(survivorsOf(result.tree)).toEqual(["iris", "maya", "nora"]);
    // The available tiles must NOT contribute to the idle count.
    expect(result.hiddenIdleCount).toBe(1);
  });

  it("never-run-only team card survives an all-idle-elsewhere hide-idle pass", () => {
    // A team whose only tiles are available baselines must NOT disappear when
    // hide-idle is on (spec §2.4: Nora/Iris/Bram render even though never run).
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("nora", "available"), makeTile("bram", "available")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideIdleFilter(tree, true);

    expect(survivorsOf(result.tree)).toEqual(["bram", "nora"]);
    expect(result.hiddenIdleCount).toBe(0);
    // Team key + order preserved — the card does not vanish for "going empty".
    expect(result.tree.sessions[0]!.rosterTiles.has("claudeteam-alpha")).toBe(
      true,
    );
    expect(result.tree.sessions[0]!.teamOrder).toContain("claudeteam-alpha");
  });
});

// ---------------------------------------------------------------------------
// AC3 — hide-finished does NOT drop available
// ---------------------------------------------------------------------------

describe("available baseline survives hide-finished filter (AC3)", () => {
  it("keeps available tiles when hideFinished=true; drops only finished", () => {
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("sage", "finished"), // dropped
          makeTile("nora", "available"), // kept
          makeTile("bram", "available"), // kept
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    expect(survivorsOf(result.tree)).toEqual(["bram", "nora"]);
    expect(result.hiddenFinishedCount).toBe(1);
  });

  it("a team whose only live tile was finished-and-hidden still renders its available baselines", () => {
    // Spec §1.1 / architecture-overview.md: a team card whose only live tile
    // was finished-and-hidden still renders its remaining available baselines
    // instead of disappearing for going empty.
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [makeTile("sage", "finished"), makeTile("iris", "available")],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    const result = applyHideFinishedFilter(tree, true);

    expect(survivorsOf(result.tree)).toEqual(["iris"]);
    expect(result.tree.sessions[0]!.rosterTiles.has("claudeteam-alpha")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// AC3 — both filters composed (the sponsor's real scenario from spec §1.1)
// ---------------------------------------------------------------------------

describe("available baseline survives BOTH filters composed (AC3)", () => {
  it("hideFinished then hideIdle leaves available + running intact", () => {
    // Reproduces the spec §1.1 sponsor scenario: flip hideIdle AND
    // hideFinished; never-run members must still appear.
    const tiles = new Map<string, RosterTileEntry[]>([
      [
        "claudeteam-alpha",
        [
          makeTile("felix", "running"), // kept
          makeTile("maya", "idle"), // dropped by hide-idle
          makeTile("sage", "finished"), // dropped by hide-finished
          makeTile("nora", "available"), // kept (the epic payoff)
          makeTile("iris", "available"), // kept
          makeTile("bram", "available"), // kept
        ],
      ],
    ]);
    const tree: AgentTree = { sessions: [makeSession(tiles)] };

    // Apply finished first then idle (the documented composition order).
    const afterFinished = applyHideFinishedFilter(tree, true);
    const afterBoth = applyHideIdleFilter(afterFinished.tree, true);

    expect(survivorsOf(afterBoth.tree)).toEqual([
      "bram",
      "felix",
      "iris",
      "nora",
    ]);
    expect(afterFinished.hiddenFinishedCount).toBe(1);
    expect(afterBoth.hiddenIdleCount).toBe(1);
  });
});
