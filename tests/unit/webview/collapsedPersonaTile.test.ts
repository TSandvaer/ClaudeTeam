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
  computeGroupState,
  computeIsUniform,
  disambiguatorFor,
  STATUS_HINT_LABEL,
} from "../../../src/webview/components/collapsedPersonaTile.js";
import { createExpandedGroupsTracker } from "../../../src/webview/expandedGroupsTracker.js";
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
// computeGroupState — ClickUp 86c9yxvah (Defect 6b)
//   ACs 1-4: priority running > idle > finished > error; only all-finished
//   groups render as `finished`; running dominates everything.
// ---------------------------------------------------------------------------

describe("computeGroupState — worst-case-live-instance priority (86c9yxvah)", () => {
  it("AC2: [finished, idle, finished] → idle", () => {
    // Dogfood Priya×3 scenario verbatim — the failure mode that triggered
    // the ticket. A user looking at a collapsed Priya×3 tile reading
    // `finished` would think all the Priya dispatches are done; the truth
    // is one is still working (mtime-stale → idle) and that signal is the
    // load-bearing one. Group must surface `idle` so the user knows live
    // work is in flight.
    const instances: AgentTile[] = [
      makeTile({ state: "finished", agentId: "p-0" }),
      makeTile({ state: "idle", agentId: "p-1" }),
      makeTile({ state: "finished", agentId: "p-2" }),
    ];
    expect(computeGroupState(instances)).toBe("idle");
  });

  it("AC3: [finished, finished] → finished", () => {
    // Only when ALL instances are finished does the group read finished.
    // Two-instance all-finished case — the most common "wrap-up" shape.
    const instances: AgentTile[] = [
      makeTile({ state: "finished", agentId: "f-0" }),
      makeTile({ state: "finished", agentId: "f-1" }),
    ];
    expect(computeGroupState(instances)).toBe("finished");
  });

  it("AC4: [running, finished] → running", () => {
    // running always wins — even one live tool-using instance forces the
    // group label to `running`. The user reading the dashboard at a glance
    // must see the live activity.
    const instances: AgentTile[] = [
      makeTile({ state: "running", agentId: "r-0" }),
      makeTile({ state: "finished", agentId: "f-0" }),
    ];
    expect(computeGroupState(instances)).toBe("running");
  });

  it("running beats every other state regardless of position", () => {
    // Defensive: the implementation must not depend on instance order.
    // Place `running` LAST — same outcome.
    const instances: AgentTile[] = [
      makeTile({ state: "finished", agentId: "f-0" }),
      makeTile({ state: "idle", agentId: "i-0" }),
      makeTile({ state: "error", agentId: "e-0" }),
      makeTile({ state: "running", agentId: "r-0" }),
    ];
    expect(computeGroupState(instances)).toBe("running");
  });

  it("idle beats finished when at least one idle is present", () => {
    // Symmetric to the [finished, idle, finished] case with the idle at
    // the head of the array — exercises the order-independence claim.
    const instances: AgentTile[] = [
      makeTile({ state: "idle", agentId: "i-0" }),
      makeTile({ state: "finished", agentId: "f-0" }),
      makeTile({ state: "finished", agentId: "f-1" }),
    ];
    expect(computeGroupState(instances)).toBe("idle");
  });

  it("error surfaces only when no running/idle AND not all finished", () => {
    // Per the AC text — `error` is the residual after running/idle/
    // all-finished are ruled out. [finished, error] = "not all finished,
    // no live activity, has error" → error.
    const instances: AgentTile[] = [
      makeTile({ state: "finished", agentId: "f-0" }),
      makeTile({ state: "error", agentId: "e-0" }),
    ];
    expect(computeGroupState(instances)).toBe("error");
  });

  it("running takes priority over error (live activity dominates)", () => {
    // An error mixed with a running instance — the group label is
    // `running` because most-active-first means a live process beats a
    // dead one for at-a-glance readout. The error is still surfaced
    // when the user expands the group (each instance keeps its own
    // state-dot via renderAgentTile).
    const instances: AgentTile[] = [
      makeTile({ state: "running", agentId: "r-0" }),
      makeTile({ state: "error", agentId: "e-0" }),
    ];
    expect(computeGroupState(instances)).toBe("running");
  });

  it("empty instances → error (defensive — should not happen on the wire)", () => {
    // Reducer invariant: a wrapper has count >= 2. Zero-instance input is
    // a host-side bug; we surface as `error` rather than silently picking
    // `finished` because `finished` would imply "work is done" — and an
    // empty group is more likely to be a host bug than completed work.
    expect(computeGroupState([])).toBe("error");
  });
});

describe("renderCollapsedPersonaTile — group state-dot rendering (86c9yxvah)", () => {
  it("state-dot mirrors the computed group state", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Priya",
      count: 3,
      instances: [
        makeTile({ state: "finished", agentId: "p-0" }),
        makeTile({ state: "idle", agentId: "p-1" }),
        makeTile({ state: "finished", agentId: "p-2" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const dot = el.querySelector<HTMLSpanElement>(
      ".collapsed-persona-header .state-dot",
    );
    expect(dot).not.toBeNull();
    expect(dot?.dataset.state).toBe("idle");
    expect(dot?.getAttribute("aria-label")).toBe("Idle");
    expect(dot?.getAttribute("title")).toBe("Idle");
    // Section also carries the group state for CSS hooks.
    expect(el.dataset.state).toBe("idle");
  });

  it("running group renders a running state-dot (sponsor's at-a-glance read)", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({ state: "running", agentId: "f-0" }),
        makeTile({ state: "finished", agentId: "f-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.dataset.state).toBe("running");
    expect(
      el
        .querySelector<HTMLSpanElement>(
          ".collapsed-persona-header .state-dot",
        )
        ?.dataset.state,
    ).toBe("running");
  });

  it("aria-label includes the state segment in collapsed AND expanded modes", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Maya",
      count: 2,
      instances: [
        makeTile({ state: "finished", agentId: "m-0" }),
        makeTile({ state: "finished", agentId: "m-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    expect(header.getAttribute("aria-label")).toBe(
      "Maya grouped — 2 instances, Finished, collapsed",
    );
    header.click();
    expect(header.getAttribute("aria-label")).toBe(
      "Maya grouped — 2 instances, Finished, expanded",
    );
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

  it("renders header text from `instances.length`, NOT from `group.count` (defensive)", () => {
    // PR #47 NIT (ClickUp 86c9yee3g): the wrapper carries two redundant
    // fields, `group.count` and `group.instances.length`, with a host-side
    // invariant that they're equal. The webview defends against an
    // invariant violation by reading the array length — the header tile
    // and the expanded list then can never disagree visually (a host bug
    // surfaces as one wrong `count` field on the wire, not as a mismatch
    // between two render sites).
    const tampered: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      // Deliberately wrong: host claims 99 but only 3 instances are present.
      count: 99,
      instances: [
        makeTile({ agentId: "felix-0", display: "Felix" }),
        makeTile({ agentId: "felix-1", display: "Felix" }),
        makeTile({ agentId: "felix-2", display: "Felix" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group: tampered,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    // Header shows the array length, not the wire-supplied `count`.
    expect(el.querySelector(".collapsed-persona-name")?.textContent).toBe(
      "Felix ×3",
    );
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    );
    // Default makeTile returns state: "running" → aria-label state segment
    // reflects the computed group state (most-active-first priority).
    expect(header?.getAttribute("aria-label")).toBe(
      "Felix grouped — 3 instances, Running, collapsed",
    );
    // Expanding renders 3 tiles, not 99 — the lazy populate walks the array.
    header!.click();
    expect(
      el.querySelectorAll(".collapsed-persona-instances .agent-tile").length,
    ).toBe(3);
    // Aria-label also reflects the array length after the expand toggle.
    expect(header?.getAttribute("aria-label")).toBe(
      "Felix grouped — 3 instances, Running, expanded",
    );
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
      "(2 visible)",
    );
  });

  // ---------------------------------------------------------------------------
  // 86c9zfj2g — chip-label rename `rostered` → `visible`
  //
  // The label reflects what is currently on-screen for this team in this
  // session (i.e. tiles.length after any host-side hide-finished projection),
  // NOT the YAML-declared roster member count. These two snapshots pin the
  // label across the two states the sponsor sees most often:
  //   - filter OFF — every matched persona is in `tiles[]`.
  //   - filter ON  — finished personas have been dropped upstream; the
  //                  surviving subset is what arrives.
  // The component is filter-agnostic; the host has already projected. We just
  // confirm the label renders `({tiles.length} visible)` in both shapes.
  // ---------------------------------------------------------------------------

  it("chip label reads `({N} visible)` with the filter OFF (all rostered tiles present)", () => {
    // Filter OFF — host sends all 3 matched personas, one bare tile each.
    const card = renderTeamCard({
      team: TEAM_ALPHA,
      tiles: [
        makeTile({ memberId: "felix", display: "Felix", agentId: "a-felix" }),
        makeTile({ memberId: "maya", display: "Maya", agentId: "a-maya" }),
        makeTile({ memberId: "bram", display: "Bram", agentId: "a-bram" }),
      ],
      sessionId: "sess-filter-off",
      postMessage: vi.fn(),
    });
    expect(card.querySelector(".team-count")?.textContent).toBe("(3 visible)");
    // Regression guard — the old `rostered` label must NOT come back.
    expect(card.querySelector(".team-count")?.textContent).not.toContain(
      "rostered",
    );
  });

  it("chip label reads `({N} visible)` with the filter ON (subset reaches the card)", () => {
    // Filter ON — host's hideFinishedFilter dropped Felix + Bram (all
    // instances finished); only Maya survives. The card sees exactly the
    // surviving subset; the label reflects on-screen count, not YAML size.
    const card = renderTeamCard({
      team: TEAM_ALPHA,
      tiles: [
        makeTile({ memberId: "maya", display: "Maya", agentId: "a-maya" }),
      ],
      sessionId: "sess-filter-on",
      postMessage: vi.fn(),
    });
    expect(card.querySelector(".team-count")?.textContent).toBe("(1 visible)");
    expect(card.querySelector(".team-count")?.textContent).not.toContain(
      "rostered",
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

// ===========================================================================
// 86c9zmqa8 — uniform-cluster polish (Iris spec §8.4 grep-discoverable names)
// ===========================================================================

describe("computeIsUniform — true for all-idle same-role", () => {
  it("returns true for [idle, idle, idle] same role", () => {
    // The canonical uniform-cluster shape: ≥2 instances, all `idle`, all
    // sharing the same role string. This is the case sponsor 2026-05-27
    // flagged — "why do i need to see al these repeadet names under each
    // name?" — and is the load-bearing branch for the polish behavior.
    const instances: AgentTile[] = [
      makeTile({ state: "idle", role: "Extension Host Dev", agentId: "f-0" }),
      makeTile({ state: "idle", role: "Extension Host Dev", agentId: "f-1" }),
      makeTile({ state: "idle", role: "Extension Host Dev", agentId: "f-2" }),
    ];
    expect(computeIsUniform(instances)).toBe(true);
  });

  it("returns true for [finished, finished] same role (2-instance all-finished)", () => {
    // Symmetric to the idle case — `finished` is the second uniform-eligible
    // state per spec §1.2 (running / error excluded). A 2-instance all-
    // finished cluster is the minimum-size uniform group and must still
    // qualify.
    const instances: AgentTile[] = [
      makeTile({ state: "finished", role: "Webview UI Dev", agentId: "m-0" }),
      makeTile({ state: "finished", role: "Webview UI Dev", agentId: "m-1" }),
    ];
    expect(computeIsUniform(instances)).toBe(true);
  });
});

describe("computeIsUniform — false on size <2", () => {
  it("returns false for a single-instance array", () => {
    // The wrapper itself wouldn't exist for N=1 (reducer's invariant is N≥2),
    // but `computeIsUniform` is a pure helper that may be called against any
    // AgentTile[]. The size guard prevents a false-positive "uniform" verdict
    // on a synthetic single-tile input.
    expect(computeIsUniform([makeTile({ state: "idle" })])).toBe(false);
  });

  it("returns false for an empty array (defensive)", () => {
    // Mirrors `computeGroupState`'s empty-array defensive branch — the
    // function must not crash on an unexpected input shape. Same surfacing
    // rationale: a host-side bug delivering 0 instances should NOT silently
    // collapse to "uniform = true" and skip the per-instance render path.
    expect(computeIsUniform([])).toBe(false);
  });
});

describe("computeIsUniform — false on running state", () => {
  it("returns false for [running, running] (excluded by spec §1.2)", () => {
    // Running is excluded because the activity line varies per poll
    // (tool:Edit src/...) — the rows are NOT visually repeated even if every
    // other field matches. Sponsor likely DOES want to drill in on a running
    // cluster to see what each instance is doing, so the polish must NOT
    // suppress it.
    const instances: AgentTile[] = [
      makeTile({ state: "running", role: "Webview UI Dev", agentId: "m-0" }),
      makeTile({ state: "running", role: "Webview UI Dev", agentId: "m-1" }),
    ];
    expect(computeIsUniform(instances)).toBe(false);
  });
});

describe("computeIsUniform — false on error state", () => {
  it("returns false for [error, error] (excluded — errors are load-bearing)", () => {
    // Errors are load-bearing alerts. Even if every instance shares the same
    // error reason, each is potentially a separate failure to investigate.
    // Auto-collapsing visibility on an error cluster is the wrong call.
    const instances: AgentTile[] = [
      makeTile({ state: "error", role: "Researcher", agentId: "b-0" }),
      makeTile({ state: "error", role: "Researcher", agentId: "b-1" }),
    ];
    expect(computeIsUniform(instances)).toBe(false);
  });
});

describe("computeIsUniform — false on mixed states", () => {
  it("returns false for [idle, finished]", () => {
    // Even though both states are individually uniform-eligible, the cluster
    // is mixed — one finished, one still parked-but-not-done — and the
    // user's question is "what's the state of these?", which the per-
    // instance rows answer. Polish does NOT apply.
    const instances: AgentTile[] = [
      makeTile({ state: "idle", role: "Researcher", agentId: "b-0" }),
      makeTile({ state: "finished", role: "Researcher", agentId: "b-1" }),
    ];
    expect(computeIsUniform(instances)).toBe(false);
  });

  it("returns false for [idle, idle, finished] (3-instance mixed)", () => {
    // A 3-instance mostly-uniform cluster still fails uniformity because of
    // the one outlier. There is no "majority rules" — the polish requires
    // strict equality across all instances.
    const instances: AgentTile[] = [
      makeTile({ state: "idle", role: "Researcher", agentId: "b-0" }),
      makeTile({ state: "idle", role: "Researcher", agentId: "b-1" }),
      makeTile({ state: "finished", role: "Researcher", agentId: "b-2" }),
    ];
    expect(computeIsUniform(instances)).toBe(false);
  });
});

describe("computeIsUniform — false on mixed roles", () => {
  it("returns false when two instances share state but differ on role", () => {
    // V1 roster-derived guarantee: every instance of a persona has the same
    // `role` (the role comes from roster.member.role). This case is more
    // forward-compat — if the role is ever derived from a per-spawn field,
    // the polish must respect role variance. Verifies the rule is checked,
    // not just trusted from the roster guarantee.
    const instances: AgentTile[] = [
      makeTile({ state: "idle", role: "Reviewer", agentId: "x-0" }),
      makeTile({ state: "idle", role: "Implementer", agentId: "x-1" }),
    ];
    expect(computeIsUniform(instances)).toBe(false);
  });
});

describe("disambiguatorFor — bracketed-letter strategy (spec §3.3)", () => {
  it("returns '[a]' / '[b]' / '[c]' / '[d]' for indices 0-3", () => {
    expect(disambiguatorFor(0)).toBe("[a]");
    expect(disambiguatorFor(1)).toBe("[b]");
    expect(disambiguatorFor(2)).toBe("[c]");
    expect(disambiguatorFor(3)).toBe("[d]");
  });

  it("rolls over to '[aa]' / '[ab]' beyond 26 (spec §3.3)", () => {
    // The spec allows beyond-26 by base-26 rollover. We've never seen >26
    // instances in practice, but the function must not blow up if the host
    // delivers a 27-instance cluster.
    expect(disambiguatorFor(25)).toBe("[z]");
    expect(disambiguatorFor(26)).toBe("[aa]");
    expect(disambiguatorFor(27)).toBe("[ab]");
  });

  it("returns '[?]' for invalid indices (defensive)", () => {
    // Negative / non-integer indices are caller bugs. The header text is
    // display-only — surface visually as `[?]` rather than throwing, because
    // the agentId on data-agent-id is the real drill-in key.
    expect(disambiguatorFor(-1)).toBe("[?]");
    expect(disambiguatorFor(1.5)).toBe("[?]");
  });
});

describe("STATUS_HINT_LABEL — sponsor-confirmed wording (spec §7 / §8.3)", () => {
  it("idle cluster → 'all idle'", () => {
    expect(STATUS_HINT_LABEL.idle).toBe("all idle");
  });

  it("finished cluster → 'all finished'", () => {
    expect(STATUS_HINT_LABEL.finished).toBe("all finished");
  });

  it("running / error are deliberately absent (uniform-cluster ineligible)", () => {
    // The map is `Partial<Record<AgentState, string>>` — running and error
    // have NO entry. If a future hand-edit added one, the renderer would
    // surface labels for clusters that aren't uniform-eligible per
    // `computeIsUniform`, leaking a label like "all running" into the
    // header. Guard against that drift here.
    expect(STATUS_HINT_LABEL.running).toBeUndefined();
    expect(STATUS_HINT_LABEL.error).toBeUndefined();
  });
});

describe("uniform cluster — auto-collapsed regardless of tracker", () => {
  it("starts collapsed even when the expansion tracker says expanded", () => {
    // Spec §2.3 — the uniformity gate fires BEFORE the tracker read.
    // Pre-populate the tracker as expanded for this cluster key, then assert
    // the rendered wrapper opens collapsed anyway.
    const tracker = createExpandedGroupsTracker();
    const trackerKey = tracker.makeKey("sess-UNI", "claudeteam-alpha", "Felix");
    tracker.setExpanded(trackerKey, true);

    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 4,
      instances: [
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "u-0" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "u-1" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "u-2" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "u-3" }),
      ],
    };

    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-UNI",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
      autoCollapseUniformClusters: true,
    });

    // Despite the tracker saying expanded, the uniform cluster opens collapsed.
    expect(el.dataset.expanded).toBe("false");
    expect(el.dataset.uniform).toBe("true");
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // Instance container hidden — no compact rows in DOM yet.
    const instancesDiv = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    )!;
    expect(instancesDiv.hidden).toBe(true);
    expect(instancesDiv.children.length).toBe(0);
  });

  it("renders the status-hint row in the header (Option A.1, 'all idle')", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 3,
      instances: [
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "h-0" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "h-1" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "h-2" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      autoCollapseUniformClusters: true,
    });
    const hint = el.querySelector(".collapsed-persona-status-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe("all idle");
    expect(hint?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders the status-hint row as 'all finished' for a finished cluster", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Maya",
      count: 2,
      instances: [
        makeTile({ state: "finished", role: "Webview UI Dev", agentId: "f-0" }),
        makeTile({ state: "finished", role: "Webview UI Dev", agentId: "f-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      autoCollapseUniformClusters: true,
    });
    expect(el.querySelector(".collapsed-persona-status-hint")?.textContent).toBe(
      "all finished",
    );
  });
});

describe("uniform cluster — manual click still expands", () => {
  it("expands on header click and writes 'true' to the tracker", () => {
    // The user CAN still get at the per-instance data — click expands per
    // spec §2.3. The tracker is written (intent is recorded for diagnostic /
    // replay purposes) — it just doesn't drive the NEXT render's initial
    // state because the uniformity gate short-circuits the tracker read.
    const tracker = createExpandedGroupsTracker();
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "u-0" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "u-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-UNI",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
      autoCollapseUniformClusters: true,
    });
    const header = el.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    header.click();
    expect(el.dataset.expanded).toBe("true");
    expect(
      tracker.isExpanded(
        tracker.makeKey("sess-UNI", "claudeteam-alpha", "Felix"),
      ),
    ).toBe(true);
  });
});

describe("uniform cluster — compact rows render with disambiguator", () => {
  it("expands to N compact rows with [a]/[b]/[c] labels and one row per instance", () => {
    // Spec §3.2 — the compact row is `<article class="agent-tile agent-tile--compact">`
    // with state-dot + display+disambiguator + activity. Verify the
    // expanded DOM matches.
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 3,
      instances: [
        makeTile({
          state: "idle",
          role: "Extension Host Dev",
          agentId: "c-0",
          activity: "idle 14s",
        }),
        makeTile({
          state: "idle",
          role: "Extension Host Dev",
          agentId: "c-1",
          activity: "idle 16s",
        }),
        makeTile({
          state: "idle",
          role: "Extension Host Dev",
          agentId: "c-2",
          activity: "idle 15s",
        }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-COMPACT",
      postMessage: vi.fn(),
      autoCollapseUniformClusters: true,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();

    const instancesDiv = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    )!;
    expect(instancesDiv.dataset.compact).toBe("true");

    const rows = el.querySelectorAll<HTMLElement>(".agent-tile--compact");
    expect(rows.length).toBe(3);

    // First row: 'Felix [a]' + 'idle 14s' + agentId 'c-0'.
    expect(rows[0]!.dataset.agentId).toBe("c-0");
    expect(rows[0]!.querySelector(".agent-display")?.textContent).toBe(
      "Felix [a]",
    );
    expect(rows[0]!.querySelector(".agent-activity")?.textContent).toBe(
      "idle 14s",
    );
    // Activity span carries BOTH classes (standard .agent-activity for theming
    // + .agent-activity-compact for layout).
    expect(
      rows[0]!
        .querySelector(".agent-activity")
        ?.classList.contains("agent-activity-compact"),
    ).toBe(true);

    // Second / third rows: disambiguator b / c.
    expect(rows[1]!.querySelector(".agent-display")?.textContent).toBe(
      "Felix [b]",
    );
    expect(rows[2]!.querySelector(".agent-display")?.textContent).toBe(
      "Felix [c]",
    );

    // No role row, no model row — compact omits them (uniform).
    expect(rows[0]!.querySelector(".tile-row--role")).toBeNull();
    expect(rows[0]!.querySelector(".tile-row--model")).toBeNull();
  });

  it("compact row click dispatches ui:open-transcript with the real agentId (not the letter)", () => {
    // Spec §3.3 — the `[a]` / `[b]` labels are display-only sugar. The real
    // agentId stays on data-agent-id and is what flies on the postMessage.
    const post = vi.fn();
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({
          state: "idle",
          role: "Extension Host Dev",
          agentId: "REAL-ID-0",
        }),
        makeTile({
          state: "idle",
          role: "Extension Host Dev",
          agentId: "REAL-ID-1",
        }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-CLICK",
      postMessage: post,
      autoCollapseUniformClusters: true,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    const rows = el.querySelectorAll<HTMLElement>(".agent-tile--compact");
    rows[1]!.click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:open-transcript",
      payload: { sessionId: "sess-CLICK", agentId: "REAL-ID-1" },
    });
  });

  it("compact row Enter/Space key activation fires drill-in (keyboard accessibility)", () => {
    const post = vi.fn();
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "k-0" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "k-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-K",
      postMessage: post,
      autoCollapseUniformClusters: true,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    const rows = el.querySelectorAll<HTMLElement>(".agent-tile--compact");
    // Enter key.
    rows[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(post).toHaveBeenCalledWith({
      type: "ui:open-transcript",
      payload: { sessionId: "sess-K", agentId: "k-0" },
    });
  });
});

describe("mixed cluster — expand respects tracker as before", () => {
  it("mixed cluster: initial-expanded state still follows the tracker", () => {
    // Spec §6 comparison matrix — Option A's auto-collapse fires ONLY for
    // uniform clusters. A mixed cluster respects the tracker exactly as in
    // pre-86c9zmqa8 (Obs 10) behavior.
    const tracker = createExpandedGroupsTracker();
    const trackerKey = tracker.makeKey(
      "sess-MIX",
      "claudeteam-alpha",
      "Felix",
    );
    tracker.setExpanded(trackerKey, true);

    // Mixed: one running + one idle.
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({
          state: "running",
          role: "Extension Host Dev",
          agentId: "m-0",
        }),
        makeTile({
          state: "idle",
          role: "Extension Host Dev",
          agentId: "m-1",
        }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-MIX",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
      autoCollapseUniformClusters: true,
    });
    // Mixed cluster → tracker drives initial state → opens expanded.
    expect(el.dataset.expanded).toBe("true");
    expect(el.dataset.uniform).toBe("false");
  });
});

describe("mixed cluster — compact-row treatment NOT applied", () => {
  it("expands to standard 4-row agent-tile (no compact variant)", () => {
    // Even on click, a mixed cluster renders standard tiles. The
    // `agent-tile--compact` modifier is absent; the per-tile DOM matches the
    // pre-86c9zmqa8 baseline.
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({ state: "running", agentId: "x-0" }),
        makeTile({ state: "idle", agentId: "x-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      autoCollapseUniformClusters: true,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    const tiles = el.querySelectorAll<HTMLElement>(".agent-tile");
    expect(tiles.length).toBe(2);
    // Standard tile — 4 rows present.
    expect(tiles[0]!.querySelectorAll(".tile-row").length).toBe(4);
    // Not the compact variant.
    expect(tiles[0]!.classList.contains("agent-tile--compact")).toBe(false);
    // No status hint for a mixed cluster.
    expect(el.querySelector(".collapsed-persona-status-hint")).toBeNull();
    expect(el.dataset.uniform).toBe("false");
  });
});

describe("claudeteam.autoCollapseUniformClusters=false → uniform cluster behaves as M3-10 baseline", () => {
  it("uniform cluster with flag OFF respects the tracker + renders standard tiles", () => {
    // Spec §8.4 grep-discoverable test name. When the sponsor turns off the
    // setting, the uniform-cluster polish disappears entirely — uniform
    // clusters behave exactly like M3-10 + Obs 10 did before.
    const tracker = createExpandedGroupsTracker();
    const trackerKey = tracker.makeKey(
      "sess-OFF",
      "claudeteam-alpha",
      "Felix",
    );
    tracker.setExpanded(trackerKey, true);

    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 3,
      instances: [
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "o-0" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "o-1" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "o-2" }),
      ],
    };

    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-OFF",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
      autoCollapseUniformClusters: false, // FLAG OFF
    });

    // No polish: data-uniform="false" because the renderer gates the polish
    // visually on isUniformPolish (flag AND uniformity), not on uniformity
    // alone.
    expect(el.dataset.uniform).toBe("false");
    // Tracker says expanded → wrapper opens expanded (M3-10 baseline).
    expect(el.dataset.expanded).toBe("true");
    // No status-hint row.
    expect(el.querySelector(".collapsed-persona-status-hint")).toBeNull();
    // Expanded children are STANDARD 4-row tiles, not compact rows.
    const tiles = el.querySelectorAll<HTMLElement>(".agent-tile");
    expect(tiles.length).toBe(3);
    expect(tiles[0]!.classList.contains("agent-tile--compact")).toBe(false);
    expect(tiles[0]!.querySelectorAll(".tile-row").length).toBe(4);
  });

  it("uniform cluster with flag undefined (default) behaves as M3-10 baseline (back-compat)", () => {
    // The renderCollapsedPersonaTile prop is optional; older callers (M3-10
    // / pre-86c9zmqa8 component tests) omit it entirely. Verify back-compat
    // — when the prop is undefined, the polish does NOT apply.
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 2,
      instances: [
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "b-0" }),
        makeTile({ state: "idle", role: "Extension Host Dev", agentId: "b-1" }),
      ],
    };
    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-BC",
      postMessage: vi.fn(),
      // autoCollapseUniformClusters intentionally OMITTED.
    });
    expect(el.dataset.uniform).toBe("false");
    expect(el.querySelector(".collapsed-persona-status-hint")).toBeNull();
  });
});

describe("uniform cluster — compact row freshness suffix for finished instances", () => {
  it("compact rows pick up 'finished Xs' freshness via the finishedTracker", () => {
    // The compact-row path must integrate with `formatFreshness` the same way
    // `renderAgentTile` does. Verify a finished uniform cluster expanded at
    // t0 picks up "finished 0s" — `createFinishedTracker` is the same helper
    // the earlier wrapper-integration test uses (imported at file top).
    const tracker = createFinishedTracker();
    const t0 = 8_000_000;

    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Sage",
      count: 2,
      instances: [
        makeTile({
          state: "finished",
          role: "QA Engineer",
          agentId: "qa-0",
          activity: "finished",
        }),
        makeTile({
          state: "finished",
          role: "QA Engineer",
          agentId: "qa-1",
          activity: "finished",
        }),
      ],
    };

    const el = renderCollapsedPersonaTile({
      group,
      sessionId: "sess-FRESH",
      postMessage: vi.fn(),
      finishedTracker: tracker,
      autoCollapseUniformClusters: true,
      nowMs: t0,
    });
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    const rows = el.querySelectorAll<HTMLElement>(".agent-tile--compact");
    // First-seen at t0 → elapsed = 0 → "finished 0s".
    expect(rows[0]!.querySelector(".agent-activity")?.textContent).toBe(
      "finished 0s",
    );
    expect(rows[1]!.querySelector(".agent-activity")?.textContent).toBe(
      "finished 0s",
    );
    // Tracker now holds two entries (one per finished compact instance).
    expect(tracker.size()).toBe(2);
  });
});
