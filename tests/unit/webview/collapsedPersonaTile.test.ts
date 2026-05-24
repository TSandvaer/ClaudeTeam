/**
 * @vitest-environment jsdom
 *
 * Component tests for the M3-10 persona-tile-collapse webview surface.
 *
 * Coverage map (ClickUp 86c9ydug9 ACs owned by Maya):
 *   - AC2 (collapsed render) — header tile shows `<persona-name> ×N`,
 *     collapsed by default, expand toggle reveals an instance per
 *     `group.instances`, chevron flips, aria-expanded toggles.
 *   - AC3 (N=1 back-compat) — when the wire delivers a bare AgentTile (no
 *     wrapper), `renderTeamCard` routes straight to `renderAgentTile` and
 *     no `.collapsed-persona` wrapper appears in the DOM.
 *   - Integration via `renderFull` — wrapper + bare tiles co-exist in the
 *     same team's tile list and render in the supplied order.
 *   - End-to-end hydration — a wrapper survives `serializeState` →
 *     JSON.stringify → JSON.parse → `hydrateState` so the M3-10 wire shape
 *     is JSON-safe (Felix's host-side reducer is the producer; we receive).
 *   - Finished-tracker interaction — instances inside an expanded wrapper
 *     pick up the freshness suffix exactly as bare tiles do.
 *
 * Source: ClickUp 86c9ydug9
 *         src/shared/types.ts CollapsedPersonaGroup / RosterTileEntry
 *         src/webview/components/collapsedPersonaTile.ts
 *         src/webview/components/teamCard.ts
 *         src/webview/render.ts
 */

import { describe, it, expect, vi } from "vitest";
import type {
  AgentTile,
  AgentTree,
  CollapsedPersonaGroup,
  Team,
  WebviewAgentTree,
} from "../../../src/shared/types.js";
import {
  renderCollapsedPersonaTile,
  isCollapsedPersonaGroup,
} from "../../../src/webview/components/collapsedPersonaTile.js";
import { renderTeamCard } from "../../../src/webview/components/teamCard.js";
import { renderFull } from "../../../src/webview/render.js";
import { createFinishedTracker } from "../../../src/webview/finishedTracker.js";
import { hydrateState } from "../../../src/webview/main.js";
import { serializeState } from "../../../src/extension/messageBus.js";

// Mock vscode — serializeState only touches our own types at runtime, but
// importing messageBus pulls vscode through the resolver. Shim suffices.
vi.mock("vscode", () => ({}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeTile(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: "tool:Edit src/extension/main.ts",
    model: "claude-opus-4-7",
    state: "running",
    agentId: "agent-default",
    toolUseId: "toolu_TEST",
    ...overrides,
  };
}

function makeGroup(
  personaName: string,
  count: number,
  perInstance: Partial<AgentTile> = {},
): CollapsedPersonaGroup {
  const instances: AgentTile[] = [];
  for (let i = 0; i < count; i++) {
    instances.push(
      makeTile({
        ...perInstance,
        display: personaName,
        agentId: `agent-${personaName.toLowerCase()}-${i}`,
      }),
    );
  }
  return {
    kind: "collapsed-persona",
    personaName,
    count,
    instances,
  };
}

const TEAM_ALPHA: Team = {
  id: "claudeteam-alpha",
  name: "ClaudeTeam Alpha",
  members: [],
};

// ---------------------------------------------------------------------------
// isCollapsedPersonaGroup — type-guard discipline
// ---------------------------------------------------------------------------

describe("isCollapsedPersonaGroup — type-guard discipline", () => {
  it("returns true for a CollapsedPersonaGroup", () => {
    const g = makeGroup("Felix", 3);
    expect(isCollapsedPersonaGroup(g)).toBe(true);
  });

  it("returns false for a bare AgentTile (no `kind` field)", () => {
    const t = makeTile();
    expect(isCollapsedPersonaGroup(t)).toBe(false);
  });

  it("returns false for objects with a different kind discriminator", () => {
    // Defensive: the discriminator value must match "collapsed-persona"
    // exactly. A future type added to RosterTileEntry with a different
    // `kind` should NOT be routed through this branch.
    const otherKind = { kind: "some-other-kind" } as unknown as AgentTile;
    expect(isCollapsedPersonaGroup(otherKind)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderCollapsedPersonaTile — AC2 collapsed render + expand interaction
// ---------------------------------------------------------------------------

describe("renderCollapsedPersonaTile — AC2 collapsed render", () => {
  it("renders a header tile with `<personaName> ×<count>` text", () => {
    const group = makeGroup("Felix", 4);
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.classList.contains("collapsed-persona")).toBe(true);
    expect(el.dataset.personaName).toBe("Felix");
    expect(el.querySelector(".collapsed-persona-name")?.textContent).toBe(
      "Felix ×4",
    );
  });

  it("starts collapsed: aria-expanded=false, chevron ▶, instances hidden", () => {
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Maya", 2),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    );
    const chevron = el.querySelector(".collapsed-persona-chevron");
    const instances = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    );
    expect(header).not.toBeNull();
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(chevron?.textContent).toBe("▶");
    expect(instances?.hidden).toBe(true);
    expect(el.dataset.expanded).toBe("false");
  });

  it("does NOT render any per-instance tile while collapsed", () => {
    // Lazy-rendering invariant: agentTile is heavy (4 rows + handlers).
    // Pre-creating them for a collapsed wrapper would defeat the point of
    // the collapse — the user collapsed because they didn't want to see
    // the instances. Verify the instances container is empty pre-expand.
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Felix", 5),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const instances = el.querySelector(".collapsed-persona-instances");
    expect(instances?.children.length).toBe(0);
  });

  it("expands on header click: aria-expanded=true, chevron ▼, instances visible", () => {
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Felix", 3),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    header.click();

    const chevron = el.querySelector(".collapsed-persona-chevron");
    const instances = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    )!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(chevron?.textContent).toBe("▼");
    expect(instances.hidden).toBe(false);
    expect(el.dataset.expanded).toBe("true");
  });

  it("renders one .agent-tile per instance on first expansion", () => {
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Felix", 4),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    header.click();

    const tiles = el.querySelectorAll(".collapsed-persona-instances .agent-tile");
    expect(tiles.length).toBe(4);
  });

  it("collapses back on second click without re-rendering the instances", () => {
    // Stability invariant: expand → collapse → expand should NOT churn the
    // per-instance DOM. We keep the children in place and toggle `hidden`
    // so per-tile state (e.g. :focus on a child) survives the cycle.
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Felix", 2),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    const instances = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    )!;

    header.click(); // expand
    const firstTile = instances.children[0];
    expect(firstTile).toBeDefined();

    header.click(); // collapse
    expect(instances.hidden).toBe(true);
    // Children remain in the DOM, just hidden.
    expect(instances.children.length).toBe(2);
    expect(instances.children[0]).toBe(firstTile);

    header.click(); // expand again
    expect(instances.hidden).toBe(false);
    // Still the same DOM nodes — no re-render.
    expect(instances.children[0]).toBe(firstTile);
  });

  it("per-instance tile click dispatches ui:open-transcript with the instance's agentId", () => {
    // Drill-in must still work after expansion — the wrapper is purely
    // visual, the underlying agentTile drill-in contract is unchanged.
    const post = vi.fn();
    const group = makeGroup("Felix", 2);
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-PRESS",
      postMessage: post,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();

    const tiles = el.querySelectorAll<HTMLElement>(".agent-tile");
    expect(tiles.length).toBe(2);
    tiles[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(post).toHaveBeenCalledWith({
      type: "ui:open-transcript",
      payload: { sessionId: "sess-PRESS", agentId: "agent-felix-0" },
    });
  });
});

// ---------------------------------------------------------------------------
// renderTeamCard routing — AC3 N=1 back-compat + wrapper routing
// ---------------------------------------------------------------------------

describe("renderTeamCard — wrapper / bare-tile routing", () => {
  it("AC3 — N=1 bare AgentTile renders as a plain .agent-tile (no wrapper)", () => {
    const card = renderTeamCard({
      team: TEAM_ALPHA,
      tiles: [makeTile({ agentId: "agent-solo" })],
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    // The bare-tile path was the entire pre-M3-10 behavior — verifying no
    // wrapper at all guards against the regression where every tile gets
    // wrapped "just in case".
    expect(card.querySelector(".collapsed-persona")).toBeNull();
    expect(card.querySelectorAll(".agent-tile").length).toBe(1);
  });

  it("CollapsedPersonaGroup with N>1 renders a wrapper (one per group)", () => {
    const card = renderTeamCard({
      team: TEAM_ALPHA,
      tiles: [makeGroup("Felix", 3)],
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const wrappers = card.querySelectorAll(".collapsed-persona");
    expect(wrappers.length).toBe(1);
    // Collapsed by default → no instance tiles in the DOM yet.
    expect(card.querySelectorAll(".agent-tile").length).toBe(0);
  });

  it("mixed: bare tile + wrapper in the same team's tile list renders both, in order", () => {
    // Sponsor's mental model: a team can have one rostered persona present
    // exactly once (rendered as a bare tile) AND another persona present
    // multiple times (rendered as a wrapper) — both belong on the team
    // card in roster order.
    const bare = makeTile({
      display: "Iris",
      memberId: "iris",
      agentId: "agent-iris-solo",
    });
    const group = makeGroup("Felix", 2);

    const card = renderTeamCard({
      team: TEAM_ALPHA,
      tiles: [bare, group],
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });

    // Bare tile + wrapper both present.
    expect(card.querySelectorAll(".agent-tile").length).toBe(1);
    expect(card.querySelectorAll(".collapsed-persona").length).toBe(1);

    // Order: bare tile (Iris) FIRST, wrapper (Felix) SECOND.
    const childTags = Array.from(card.children).map((c) => c.className);
    // Header is `.team-header`, then the entries in order.
    expect(childTags).toEqual([
      "team-header",
      "agent-tile",
      "collapsed-persona",
    ]);
  });

  it("team-count header counts each entry as 1 (wrappers don't multiply the count)", () => {
    // The sponsor framed Felix ×4 as a single persona tile in the header
    // count — the ×4 lives inside the wrapper. The team-count is the
    // number of header entries, not the sum of dispatch instances.
    const card = renderTeamCard({
      team: TEAM_ALPHA,
      tiles: [makeGroup("Felix", 4), makeTile({ memberId: "maya" })],
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(card.querySelector(".team-count")?.textContent).toBe(
      "(2 rostered)",
    );
  });
});

// ---------------------------------------------------------------------------
// renderFull — wrapper survives the full render pipeline
// ---------------------------------------------------------------------------

describe("renderFull — wrapper integration", () => {
  function makeStateWithWrapper(): WebviewAgentTree {
    return {
      sessions: [
        {
          shortId: "sess0001",
          sessionId: "sess-WRAPPED",
          pid: 1234,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\test",
          title: "wrapper integration",
          rosterTiles: new Map([
            [
              "claudeteam-alpha",
              [
                makeGroup("Felix", 3),
                makeTile({ memberId: "maya", display: "Maya" }),
              ],
            ],
          ]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };
  }

  it("renders a session block containing a wrapper + a bare tile", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateWithWrapper(),
    );
    expect(mount.querySelectorAll(".session-block").length).toBe(1);
    expect(mount.querySelectorAll(".collapsed-persona").length).toBe(1);
    // Pre-expand: the wrapper contributes zero .agent-tile nodes; only the
    // bare-tile (Maya) is visible at tile level.
    expect(mount.querySelectorAll(".agent-tile").length).toBe(1);
  });

  it("expanded wrapper inside renderFull shows all instances", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateWithWrapper(),
    );
    const header = mount.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    header.click();
    // 3 from the wrapper + 1 bare Maya = 4 visible .agent-tile nodes.
    expect(mount.querySelectorAll(".agent-tile").length).toBe(4);
  });

  it("re-render preserves rosterTiles iteration order with a wrapper present", () => {
    // The renderer must walk session.teamOrder and per-team entry order
    // identically regardless of whether the entry is bare or a wrapper.
    // A regression that special-cased wrappers in a separate pass would
    // reorder them relative to bare tiles.
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateWithWrapper(),
    );
    const teamCard = mount.querySelector(".team-card")!;
    // Header child is first; tile entries follow in the order supplied.
    // We supplied [wrapper, bare] — the DOM should match.
    const entryClassNames = Array.from(teamCard.children)
      .slice(1) // skip .team-header
      .map((c) => c.className);
    expect(entryClassNames).toEqual([
      "collapsed-persona",
      "agent-tile",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Wire shape — wrapper survives serializeState → JSON round-trip → hydrate
// ---------------------------------------------------------------------------

describe("CollapsedPersonaGroup wire-shape round-trip", () => {
  it("hydrateState reconstructs a wrapper from a JSON-stringified host state", () => {
    // Builds a host-side AgentTree whose rosterTiles Map already contains a
    // wrapper (Felix's M3-10 host PR is the producer; this test takes the
    // wire-shape role of "what the webview receives").
    //
    // Cast: host SessionTree types rosterTiles as Map<string, AgentTile[]>
    // pre-Felix-merge. The webview-bound hydrator widens to
    // RosterTileEntry[]; using `as any` on the Map cast keeps this test
    // forward-compatible with the post-Felix unified type without a
    // dependency on his PR landing first.
    const hostState: AgentTree = {
      sessions: [
        {
          shortId: "sess0001",
          sessionId: "sess-WIRE",
          pid: 1234,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\test",
          title: "wire round-trip",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rosterTiles: new Map<string, any>([
            ["claudeteam-alpha", [makeGroup("Felix", 3)]],
          ]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };

    // Boundary trip: host serializeState → JSON → JSON.parse → hydrate.
    const wire = serializeState(hostState);
    const wireJson = JSON.parse(JSON.stringify(wire));
    const out = hydrateState(wireJson);

    const entries = out.sessions[0]!.rosterTiles.get("claudeteam-alpha");
    expect(entries).toHaveLength(1);
    const entry = entries![0];
    expect(isCollapsedPersonaGroup(entry!)).toBe(true);

    // Cast after the type guard for property access.
    const wrapper = entry as CollapsedPersonaGroup;
    expect(wrapper.personaName).toBe("Felix");
    expect(wrapper.count).toBe(3);
    expect(wrapper.instances).toHaveLength(3);
    // Bare-tile fields survive verbatim within the wrapper.
    expect(wrapper.instances[0]!.display).toBe("Felix");
    expect(wrapper.instances[0]!.agentId).toBe("agent-felix-0");
  });

  it("hydrateState passes a bare AgentTile through unchanged (N=1 back-compat)", () => {
    // N=1 must remain the pre-M3-10 wire shape — verified end-to-end via
    // the same round-trip, asserting the receiver sees NO wrapper.
    const hostState: AgentTree = {
      sessions: [
        {
          shortId: "sess0002",
          sessionId: "sess-BARE",
          pid: 5678,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\test",
          title: "bare wire shape",
          rosterTiles: new Map([
            ["claudeteam-alpha", [makeTile({ agentId: "agent-solo" })]],
          ]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };

    const wire = serializeState(hostState);
    const wireJson = JSON.parse(JSON.stringify(wire));
    const out = hydrateState(wireJson);

    const entries = out.sessions[0]!.rosterTiles.get("claudeteam-alpha");
    expect(entries).toHaveLength(1);
    expect(isCollapsedPersonaGroup(entries![0]!)).toBe(false);
    expect((entries![0] as AgentTile).agentId).toBe("agent-solo");
  });
});

// ---------------------------------------------------------------------------
// Finished-tracker interaction inside an expanded wrapper
// ---------------------------------------------------------------------------

describe("CollapsedPersonaGroup — finished-tracker integration", () => {
  it("expanded wrapper picks up the freshness suffix for finished instances", () => {
    // The wrapper passes the finishedTracker + nowMs through to each
    // expanded instance; finished tiles should render `finished Xs`
    // matching the bare-tile path.
    const tracker = createFinishedTracker();
    const t0 = 5_000_000;
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({
          state: "finished",
          activity: "finished",
          agentId: "agent-felix-A",
        }),
        makeTile({
          state: "running",
          activity: "tool:Read foo.ts",
          agentId: "agent-felix-B",
        }),
      ],
    };

    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-FRESH",
      postMessage: vi.fn(),
      finishedTracker: tracker,
      nowMs: t0,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();

    const tiles = el.querySelectorAll(".agent-tile");
    expect(tiles.length).toBe(2);
    // First tile (finished) — tracker recorded t0, elapsed = 0 → "finished 0s".
    expect(tiles[0]!.querySelector(".agent-activity")?.textContent).toBe(
      "finished 0s",
    );
    // Second tile (running) — unchanged activity, no freshness suffix.
    expect(tiles[1]!.querySelector(".agent-activity")?.textContent).toBe(
      "tool:Read foo.ts",
    );
    // Tracker now holds one entry (the finished instance).
    expect(tracker.size()).toBe(1);
  });

  it("renderFull's prune pass walks wrapper instances (finished entries are NOT pruned)", () => {
    // The render.ts prune pass must descend into wrappers — otherwise the
    // tracker would clear entries for finished instances inside a collapsed
    // wrapper on every tick, and expanding later would re-anchor them to
    // "finished 0s" instead of preserving the original first-seen time.
    const tracker = createFinishedTracker();
    const mount = document.createElement("div");
    const t0 = 5_000_000;

    const stateWithWrapper: WebviewAgentTree = {
      sessions: [
        {
          shortId: "sess0003",
          sessionId: "sess-PRUNE",
          pid: 9999,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\test",
          title: "prune-walks-instances",
          rosterTiles: new Map([
            [
              "claudeteam-alpha",
              [
                {
                  kind: "collapsed-persona",
                  personaName: "Felix",
                  count: 1,
                  instances: [
                    makeTile({
                      state: "finished",
                      activity: "finished",
                      agentId: "agent-INSIDE-WRAPPER",
                    }),
                  ],
                } as CollapsedPersonaGroup,
              ],
            ],
          ]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };

    // First render: expand, observe finished tile, tracker holds 1.
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        finishedTracker: tracker,
        nowMs: t0,
      },
      stateWithWrapper,
    );
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();
    expect(tracker.size()).toBe(1);

    // Second render at t0+30s: re-render the SAME state. The prune pass
    // walks wrapper.instances — the finished tile is still present, so
    // its tracker entry survives.
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        finishedTracker: tracker,
        nowMs: t0 + 30_000,
      },
      stateWithWrapper,
    );
    expect(tracker.size()).toBe(1);

    // Expand the freshly-rendered wrapper — first-seen should anchor at t0,
    // so the suffix at t0+30s reads "finished 30s", NOT "finished 0s".
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();
    const tile = mount.querySelector(".agent-tile");
    expect(tile?.querySelector(".agent-activity")?.textContent).toBe(
      "finished 30s",
    );
  });
});
