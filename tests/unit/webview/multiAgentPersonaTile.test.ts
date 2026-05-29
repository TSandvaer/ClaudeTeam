/**
 * @vitest-environment jsdom
 *
 * Component tests for the 86ca1ej5c multi-agent persona tile (option A) — a
 * rostered member with N≥2 live agents renders as ONE persona tile with a `×N`
 * count badge (the expand toggle) + an inline instance list.
 *
 * Coverage map (ticket 86ca1ej5c test ACs):
 *   1. ×N badge renders for N≥2 (and the count switch `data-count`).
 *   2. Expand toggle (the badge) shows/hides the instance rows; aria-expanded +
 *      chevron flip; default collapsed; expand-by-default opt-in.
 *   3. Instance rows are keyed by agentId; drill-in posts the per-instance
 *      sessionId + agentId (cross-session correctness, spec §3.2).
 *   4. Sprite pose follows the AGGREGATE state (running → active_*; idle/
 *      finished → idle pool) — spec §1.4.
 *   5. Single-agent + zero-agent tiles are unaffected (bare AgentTile path).
 *   6. Expansion persistence keyed by memberId across re-renders (Obs 10).
 *
 * Source: team/iris-ux/multiagent-persona-tile-spec.md §1, §2, §3
 *         src/shared/types.ts MultiAgentPersonaTile (host wire shape)
 *         src/webview/components/multiAgentPersonaTile.ts
 *         src/webview/components/teamCard.ts + render.ts
 */

import { describe, it, expect, vi } from "vitest";
import type {
  AgentState,
  AgentTile,
  MultiAgentPersonaTile,
  Team,
  WebviewAgentTree,
} from "../../../src/shared/types.js";
import { renderMultiAgentPersonaTile } from "../../../src/webview/components/multiAgentPersonaTile.js";
import { renderTeamCard } from "../../../src/webview/components/teamCard.js";
import { renderFull } from "../../../src/webview/render.js";
import { createExpandedGroupsTracker } from "../../../src/webview/expandedGroupsTracker.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: "tool:Edit src/extension/reducer.ts",
    model: "claude-opus-4-8",
    state: "running",
    agentId: "a1d53b4a2db17f2f5",
    sessionId: "sess-A",
    toolUseId: "toolu_TEST",
    ...overrides,
  };
}

function makeMultiTile(
  overrides: Partial<MultiAgentPersonaTile> = {},
): MultiAgentPersonaTile {
  const instances = overrides.instances ?? [
    makeInstance({ agentId: "a1d53b4a2db17f2f5", state: "running" }),
    makeInstance({
      agentId: "7b53d0eeXXXXXXXXX",
      state: "finished",
      activity: "finished 4m",
    }),
  ];
  return {
    kind: "multi-agent-persona",
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    aggregateState: "running",
    headlineActivity: "tool:Edit src/extension/reducer.ts",
    headlineModel: "claude-opus-4-8",
    count: instances.length,
    instances,
    ...overrides,
  };
}

function makeTeam(): Team {
  return { id: "claudeteam-alpha", name: "ClaudeTeam Alpha", members: [] };
}

// ---------------------------------------------------------------------------
// AC1 — ×N badge for N≥2
// ---------------------------------------------------------------------------

describe("AC1 — ×N count badge", () => {
  it("renders a ×N badge + data-count switch for N≥2", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.dataset.count).toBe("2");
    const badge = el.querySelector(".persona-count-badge");
    expect(badge).not.toBeNull();
    expect(badge?.querySelector(".persona-count-badge-count")?.textContent).toBe(
      "×2",
    );
  });

  it("renders the ×N for higher counts", () => {
    const instances = [
      makeInstance({ agentId: "a", state: "running" }),
      makeInstance({ agentId: "b", state: "idle" }),
      makeInstance({ agentId: "c", state: "finished" }),
    ];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ instances, count: 3 }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.dataset.count).toBe("3");
    expect(
      el.querySelector(".persona-count-badge-count")?.textContent,
    ).toBe("×3");
  });

  it("renders the headline activity + model + (N agents) hint", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe(
      "tool:Edit src/extension/reducer.ts",
    );
    expect(el.querySelector(".agent-model")?.textContent).toBe(
      "claude-opus-4-8",
    );
    expect(el.querySelector(".persona-count-hint")?.textContent).toBe(
      "(2 agents)",
    );
  });

  it("name + role render the persona identity (one tile, not a count group)", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.classList.contains("agent-tile")).toBe(true);
    expect(el.querySelector(".agent-display")?.textContent).toBe("Felix");
    expect(el.querySelector(".agent-role")?.textContent).toBe(
      "Extension Host Dev",
    );
  });
});

// ---------------------------------------------------------------------------
// AC2 — expand toggle shows/hides rows; chevron + aria-expanded flip
// ---------------------------------------------------------------------------

describe("AC2 — expand toggle", () => {
  it("is collapsed by default (instance list hidden, aria-expanded=false)", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    expect(region.hidden).toBe(true);
    const badge = el.querySelector(".persona-count-badge")!;
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector(".persona-count-chevron")?.textContent).toBe("▸");
  });

  it("clicking the badge expands the list + flips aria + chevron", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const badge = el.querySelector<HTMLButtonElement>(".persona-count-badge")!;
    badge.click();
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    expect(region.hidden).toBe(false);
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector(".persona-count-chevron")?.textContent).toBe("▾");
    // Re-click collapses.
    badge.click();
    expect(region.hidden).toBe(true);
    expect(badge.getAttribute("aria-expanded")).toBe("false");
  });

  it("aria-controls on the badge points at the instance-list region id", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const badge = el.querySelector(".persona-count-badge")!;
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    expect(badge.getAttribute("aria-controls")).toBe(region.id);
    expect(region.id).not.toBe("");
  });

  it("expand-by-default renders the list open on first paint", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
      expandByDefault: true,
    });
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    expect(region.hidden).toBe(false);
    expect(region.querySelectorAll(".persona-instance-row").length).toBe(2);
    expect(
      el.querySelector(".persona-count-badge")?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("Esc inside the open list collapses it", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
      expandByDefault: true,
    });
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    region.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(region.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3 — instance rows keyed by agentId; per-instance drill-in
// ---------------------------------------------------------------------------

describe("AC3 — instance rows keyed by agentId + drill-in", () => {
  it("renders one row per instance, keyed by agentId, short id shown", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
      expandByDefault: true,
    });
    const rows = el.querySelectorAll<HTMLElement>(".persona-instance-row");
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.agentId).toBe("a1d53b4a2db17f2f5");
    expect(rows[1].dataset.agentId).toBe("7b53d0eeXXXXXXXXX");
    // Short id = first 8 chars.
    expect(
      rows[0].querySelector(".persona-instance-id")?.textContent,
    ).toBe("a1d53b4a");
  });

  it("each row carries its own per-instance state dot + activity", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
      expandByDefault: true,
    });
    const rows = el.querySelectorAll<HTMLElement>(".persona-instance-row");
    expect(rows[0].dataset.state).toBe("running");
    expect(rows[1].dataset.state).toBe("finished");
    expect(
      rows[1].querySelector(".persona-instance-activity")?.textContent,
    ).toBe("finished 4m");
  });

  it("drill-in posts the PER-INSTANCE sessionId + agentId (cross-session)", () => {
    const post = vi.fn();
    // Two instances in DIFFERENT sessions — drill-in must address each row's
    // own session, not a single shared render-param session (spec §3.2 / NIT2).
    const instances = [
      makeInstance({ agentId: "aaa11111", sessionId: "sess-X", state: "running" }),
      makeInstance({ agentId: "bbb22222", sessionId: "sess-Y", state: "idle" }),
    ];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ instances, count: 2 }),
      sessionId: "sess-A",
      postMessage: post,
      expandByDefault: true,
    });
    const rows = el.querySelectorAll<HTMLElement>(".persona-instance-row");
    rows[0].click();
    rows[1].click();
    expect(post).toHaveBeenNthCalledWith(1, {
      type: "ui:open-transcript",
      payload: { sessionId: "sess-X", agentId: "aaa11111" },
    });
    expect(post).toHaveBeenNthCalledWith(2, {
      type: "ui:open-transcript",
      payload: { sessionId: "sess-Y", agentId: "bbb22222" },
    });
  });

  it("falls back to the tile sessionId when an instance omits its own", () => {
    const post = vi.fn();
    const instances = [
      makeInstance({ agentId: "ccc33333", state: "running" }),
    ];
    delete (instances[0] as { sessionId?: string }).sessionId;
    instances.push(makeInstance({ agentId: "ddd44444", state: "idle" }));
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ instances, count: 2 }),
      sessionId: "sess-FALLBACK",
      postMessage: post,
      expandByDefault: true,
    });
    el.querySelector<HTMLElement>(".persona-instance-row")!.click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:open-transcript",
      payload: { sessionId: "sess-FALLBACK", agentId: "ccc33333" },
    });
  });

  it("Enter/Space on a row fires drill-in", () => {
    const post = vi.fn();
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: post,
      expandByDefault: true,
    });
    const row = el.querySelector<HTMLElement>(".persona-instance-row")!;
    row.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// AC4 — sprite pose follows the aggregate state
// ---------------------------------------------------------------------------

describe("AC4 — sprite pose follows aggregateState", () => {
  // felix has a bound sprite character in the manifest; spriteBaseUri present
  // → the tile renders a sprite box whose pose derives from aggregate state.
  const SPRITE_BASE = "vscode-resource://base";

  function poseOf(
    aggregateState: AgentState,
    headlineActivity: string,
  ): string | undefined {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ aggregateState, headlineActivity }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
      spriteBaseUri: SPRITE_BASE,
      reducedMotion: true, // static frame 0; deterministic, no timers
      spriteRng: () => 0, // deterministic idle pick
    });
    return el.querySelector<HTMLElement>(".sprite-box")?.dataset.pose;
  }

  it("running aggregate + tool!=Read → active_work pose", () => {
    expect(poseOf("running", "tool:Edit reducer.ts")).toBe("active_work");
  });

  it("running aggregate + tool==Read → active_read pose", () => {
    expect(poseOf("running", "tool:Read src/x.ts")).toBe("active_read");
  });

  it("finished aggregate → an idle-pool pose (not active)", () => {
    const pose = poseOf("finished", "finished");
    expect(pose).toBeDefined();
    expect(pose).not.toBe("active_work");
    expect(pose).not.toBe("active_read");
  });

  it("idle aggregate → an idle-pool pose (not active)", () => {
    const pose = poseOf("idle", "idle 30s");
    expect(pose).toBeDefined();
    expect(pose).not.toBe("active_work");
    expect(pose).not.toBe("active_read");
  });

  it("renders text-only when no spriteBaseUri (graceful degrade)", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.querySelector(".sprite-box")).toBeNull();
    expect(el.dataset.hasSprite).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC4b — aggregate state drives the tile + dot data-state (host-emitted)
// ---------------------------------------------------------------------------

describe("AC4b — aggregateState skins the tile dot", () => {
  for (const s of [
    "running",
    "idle",
    "finished",
    "error",
  ] as AgentState[]) {
    it(`tile + dot carry data-state="${s}" from the aggregate`, () => {
      const el = renderMultiAgentPersonaTile({
        tile: makeMultiTile({ aggregateState: s }),
        sessionId: "sess-A",
        postMessage: vi.fn(),
      });
      expect(el.dataset.state).toBe(s);
      expect(
        el.querySelector<HTMLElement>(".tile-row--primary .state-dot")?.dataset
          .state,
      ).toBe(s);
    });
  }

  it("running aggregate + memberColor paints the running dot override", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ aggregateState: "running", memberColor: "#5d8aa8" }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.style.getPropertyValue("--ct-color-running-dot")).toBe("#5d8aa8");
  });

  it("non-running aggregate ignores memberColor (semantic state color)", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ aggregateState: "idle", memberColor: "#5d8aa8" }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(el.style.getPropertyValue("--ct-color-running-dot")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC4c — error aggregate stays COLLAPSED by default (Felix NIT 1 — LOCKED)
//
// Spec §3.3 Q3 (sponsor decision): an `error` aggregate does NOT auto-expand
// the instance list. The error dot (row 1) + the error-state skin already
// signal the failure; auto-expanding would fight option-A's "one clean tile
// per member" resting view. This is the one explicit regression gap Felix
// flagged at PR #125 review — no prior test pinned the no-auto-expand-on-error
// behavior, so a future change adding `if (aggregateState === "error") expand`
// would have shipped green.
//
// Bug-class assertion (not just the instance): for EVERY non-running aggregate
// the resting tile is collapsed — so an error sibling can never silently pop
// the list open. Plus the cross-check that the error IS still legible while
// collapsed (dot + data-state), proving collapse isn't hiding the signal.
// ---------------------------------------------------------------------------

describe("AC4c — error aggregate stays collapsed by default (Felix NIT 1, LOCKED §3.3 Q3)", () => {
  it("an error-aggregate multi-agent tile is COLLAPSED by default (no auto-expand on error)", () => {
    // One instance errored, the other finished → aggregate is `error`
    // (computeAggregateState: error > finished). The tile must render at rest.
    const instances = [
      makeInstance({ agentId: "errAAAA1", state: "error", activity: "error: spawn failed" }),
      makeInstance({ agentId: "finBBBB2", state: "finished", activity: "finished 3m" }),
    ];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ aggregateState: "error", instances, count: 2 }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
      // NOTE: no expandByDefault — this is the resting render.
    });
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    // The load-bearing assertion: error does NOT pop the list open.
    expect(region.hidden).toBe(true);
    expect(
      el.querySelector(".persona-count-badge")?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(el.querySelector(".persona-count-chevron")?.textContent).toBe("▸");
  });

  it("the error is still LEGIBLE while collapsed (error dot + data-state, no expand needed)", () => {
    const instances = [
      makeInstance({ agentId: "errAAAA1", state: "error", activity: "error: spawn failed" }),
      makeInstance({ agentId: "finBBBB2", state: "finished", activity: "finished 3m" }),
    ];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ aggregateState: "error", instances, count: 2 }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    // Collapse is NOT hiding the signal: the tile + dot read `error` at rest.
    expect(el.dataset.state).toBe("error");
    expect(
      el.querySelector<HTMLElement>(".tile-row--primary .state-dot")?.dataset
        .state,
    ).toBe("error");
  });

  it("bug-class: NO non-running aggregate auto-expands (error/idle/finished/available all collapsed at rest)", () => {
    for (const s of [
      "error",
      "idle",
      "finished",
      "available",
    ] as AgentState[]) {
      const el = renderMultiAgentPersonaTile({
        tile: makeMultiTile({ aggregateState: s }),
        sessionId: "sess-A",
        postMessage: vi.fn(),
      });
      const region = el.querySelector<HTMLElement>(".persona-instances")!;
      expect(
        region.hidden,
        `aggregate="${s}" must render collapsed at rest (no auto-expand) — ` +
          `only an explicit user toggle or expandByDefault opens the list.`,
      ).toBe(true);
    }
  });

  it("an error-aggregate tile DOES still expand on explicit user toggle (error isn't a lock)", () => {
    // Guards the regression test against over-correcting into "error can't
    // expand at all" — the user must still be able to open it to see which
    // instance failed (spec §3.2 drill-in).
    const instances = [
      makeInstance({ agentId: "errAAAA1", state: "error", activity: "error: spawn failed" }),
      makeInstance({ agentId: "finBBBB2", state: "finished", activity: "finished 3m" }),
    ];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ aggregateState: "error", instances, count: 2 }),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const badge = el.querySelector<HTMLButtonElement>(".persona-count-badge")!;
    badge.click();
    const region = el.querySelector<HTMLElement>(".persona-instances")!;
    expect(region.hidden).toBe(false);
    // The errored instance is now visible in the list (most-active-first: error
    // outranks finished, so the error row leads).
    const rows = el.querySelectorAll<HTMLElement>(".persona-instance-row");
    expect(rows[0].dataset.state).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// AC5 — single-agent + zero-agent baseline tiles unaffected
// ---------------------------------------------------------------------------

describe("AC5 — single/zero-agent tiles unaffected", () => {
  it("renderTeamCard routes a bare AgentTile to the single-tile path (no badge)", () => {
    const bare = makeInstance({ state: "running" });
    const card = renderTeamCard({
      team: makeTeam(),
      tiles: [bare],
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    // Single tile renders, no multi-agent chrome.
    expect(card.querySelector(".persona-count-badge")).toBeNull();
    expect(card.querySelector(".persona-instances")).toBeNull();
    const tile = card.querySelector<HTMLElement>(".agent-tile")!;
    expect(tile.dataset.count).toBeUndefined();
    // Bare tile keeps its drill-in role=button (not group).
    expect(tile.getAttribute("role")).toBe("button");
  });

  it("renderTeamCard routes a baseline available tile unchanged (no badge)", () => {
    const baseline = makeInstance({
      state: "available",
      agentId: "",
      model: "model:?",
      activity: "available",
    });
    const card = renderTeamCard({
      team: makeTeam(),
      tiles: [baseline],
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(card.querySelector(".persona-count-badge")).toBeNull();
    const tile = card.querySelector<HTMLElement>(".agent-tile")!;
    expect(tile.dataset.state).toBe("available");
    expect(tile.dataset.count).toBeUndefined();
  });

  it("renderTeamCard routes a MultiAgentPersonaTile to the new renderer", () => {
    const card = renderTeamCard({
      team: makeTeam(),
      tiles: [makeMultiTile()],
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    expect(card.querySelector(".persona-count-badge")).not.toBeNull();
    expect(card.querySelector(".persona-instances")).not.toBeNull();
    // The team-count chip counts a multi-agent wrapper as ONE visible tile.
    expect(card.querySelector(".team-count")?.textContent).toBe("(1 visible)");
  });
});

// ---------------------------------------------------------------------------
// AC6 — expansion persistence keyed by memberId across re-renders
// ---------------------------------------------------------------------------

// Distinct memberIds per test avoid the module-level first-paint seed-set
// (seededDefaultKeys) leaking across tests — production keys are per-member so
// this mirrors real usage where each member is seeded once per boot.
describe("AC6 — expansion persistence keyed by memberId (Obs 10)", () => {
  it("a user-expanded list survives a re-render via the shared tracker", () => {
    const tracker = createExpandedGroupsTracker();
    const tile = makeMultiTile({ memberId: "ac6-survive" });
    const first = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
    });
    // Expand via the badge → tracker records intent keyed by memberId.
    first.querySelector<HTMLButtonElement>(".persona-count-badge")!.click();
    const key = tracker.makeKey("sess-A", "claudeteam-alpha", "ac6-survive");
    expect(tracker.isExpanded(key)).toBe(true);

    // Re-render (poll tick) — fresh DOM should restore the open state.
    const second = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
    });
    expect(
      second.querySelector<HTMLElement>(".persona-instances")!.hidden,
    ).toBe(false);
    expect(
      second.querySelector(".persona-count-badge")?.getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });

  it("expand-by-default opens on first paint then a user collapse sticks", () => {
    const tracker = createExpandedGroupsTracker();
    const tile = makeMultiTile({ memberId: "ac6-default" });
    const key = tracker.makeKey("sess-A", "claudeteam-alpha", "ac6-default");
    // First paint with expandByDefault → seeds the tracker open.
    const first = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
      expandByDefault: true,
    });
    expect(
      first.querySelector<HTMLElement>(".persona-instances")!.hidden,
    ).toBe(false);
    expect(tracker.isExpanded(key)).toBe(true);

    // User collapses → tracker records false.
    first.querySelector<HTMLButtonElement>(".persona-count-badge")!.click();
    expect(tracker.isExpanded(key)).toBe(false);

    // Re-render — the user's collapse wins over the default (not re-opened).
    const second = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
      expandByDefault: true,
    });
    expect(
      second.querySelector<HTMLElement>(".persona-instances")!.hidden,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration via renderFull — wrapper coexists with bare tiles + survives
// the prune walk (render.ts already wires sprite/expansion keys by memberId).
// ---------------------------------------------------------------------------

describe("renderFull integration", () => {
  function makeTree(
    tiles: (AgentTile | MultiAgentPersonaTile)[],
  ): WebviewAgentTree {
    return {
      sessions: [
        {
          shortId: "sessA",
          sessionId: "sess-A",
          pid: 123,
          isAlive: true,
          entrypoint: "claude-vscode",
          cwd: "c:/Trunk/PRIVATE/ClaudeTeam",
          title: "ClaudeTeam",
          rosterTiles: new Map([["claudeteam-alpha", tiles]]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
      rosterErrors: [],
    } as unknown as WebviewAgentTree;
  }

  it("renders a multi-agent tile alongside a bare tile in one team card", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeTree([
        makeMultiTile(),
        makeInstance({
          memberId: "maya",
          display: "Maya",
          agentId: "maya-solo",
          state: "running",
        }),
      ]),
    );
    expect(mount.querySelectorAll(".persona-count-badge").length).toBe(1);
    // 1 multi-agent tile + 1 bare tile = 2 .agent-tile articles.
    expect(mount.querySelectorAll(".agent-tile").length).toBe(2);
  });
});
