/**
 * computeAggregateState unit tests (86ca1dtr5 — multi-agent persona tile host).
 *
 * Pins the LOCKED aggregate-state precedence (sponsor decision — running wins
 * over error):
 *
 *   running  >  error  >  idle  >  finished  >  available
 *
 * Source: team/iris-ux/multiagent-persona-tile-spec.md §2.1 + §2.2 worked
 * examples (incl. the running-beats-error case).
 */

import { describe, it, expect } from "vitest";
import {
  computeAggregateState,
  type AgentState,
  type AgentTile,
} from "../../src/shared/types.js";

/**
 * Minimal AgentTile factory — only `state` and `agentId` matter for the
 * aggregate (the rest are filled to satisfy the type). Each call gets a unique
 * agentId so ordering / identity stays distinct.
 */
let _seq = 0;
function tileWith(state: AgentState): AgentTile {
  _seq += 1;
  return {
    memberId: "felix",
    teamId: "alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: state,
    model: "claude-opus-4-7",
    state,
    agentId: `agent-${_seq}`,
    toolUseId: null,
  };
}

function states(...ss: AgentState[]): AgentTile[] {
  return ss.map(tileWith);
}

describe("computeAggregateState — LOCKED precedence (86ca1dtr5)", () => {
  // ---- single-tier homogeneous inputs ----
  it("all running → running", () => {
    expect(computeAggregateState(states("running", "running"))).toBe("running");
  });
  it("all error → error", () => {
    expect(computeAggregateState(states("error", "error"))).toBe("error");
  });
  it("all idle → idle", () => {
    expect(computeAggregateState(states("idle", "idle"))).toBe("idle");
  });
  it("all finished → finished (the only all-finished case)", () => {
    expect(computeAggregateState(states("finished", "finished"))).toBe(
      "finished",
    );
  });
  it("all available → available (the floor)", () => {
    expect(computeAggregateState(states("available", "available"))).toBe(
      "available",
    );
  });

  // ---- the load-bearing precedence cases (spec §2.2 worked examples) ----
  it("[running, finished] → running (one still working)", () => {
    expect(computeAggregateState(states("running", "finished"))).toBe(
      "running",
    );
  });

  it("[running, error] → running (RUNNING BEATS ERROR — sponsor decision)", () => {
    expect(computeAggregateState(states("running", "error"))).toBe("running");
    // Order-independent — error first must still yield running.
    expect(computeAggregateState(states("error", "running"))).toBe("running");
  });

  it("[error, finished] → error (no running; error is the loudest remaining)", () => {
    expect(computeAggregateState(states("error", "finished"))).toBe("error");
  });

  it("[error, idle] → error (error outranks idle)", () => {
    expect(computeAggregateState(states("error", "idle"))).toBe("error");
    expect(computeAggregateState(states("idle", "error"))).toBe("error");
  });

  it("[idle, finished] → idle (one alive-but-quiet; not all done)", () => {
    expect(computeAggregateState(states("idle", "finished"))).toBe("idle");
  });

  it("[finished, finished, running] → running (any-running wins regardless of count)", () => {
    expect(
      computeAggregateState(states("finished", "finished", "running")),
    ).toBe("running");
  });

  it("[error, idle, finished] → error (full mid-stack: error highest present)", () => {
    expect(
      computeAggregateState(states("error", "idle", "finished")),
    ).toBe("error");
  });

  it("[idle, finished, available] → idle (available does not outrank idle)", () => {
    expect(
      computeAggregateState(states("idle", "finished", "available")),
    ).toBe("idle");
  });

  it("[finished, available] → finished (available is the floor, below finished)", () => {
    expect(computeAggregateState(states("finished", "available"))).toBe(
      "finished",
    );
  });

  // ---- totality / defensive ----
  it("empty input → available (the floor; reducer invariant prevents this)", () => {
    expect(computeAggregateState([])).toBe("available");
  });

  it("single instance returns its own state (each tier)", () => {
    expect(computeAggregateState(states("running"))).toBe("running");
    expect(computeAggregateState(states("error"))).toBe("error");
    expect(computeAggregateState(states("idle"))).toBe("idle");
    expect(computeAggregateState(states("finished"))).toBe("finished");
    expect(computeAggregateState(states("available"))).toBe("available");
  });

  it("does not mutate the input array", () => {
    const input = states("running", "error", "idle");
    const copy = input.slice();
    computeAggregateState(input);
    expect(input).toEqual(copy);
  });
});
