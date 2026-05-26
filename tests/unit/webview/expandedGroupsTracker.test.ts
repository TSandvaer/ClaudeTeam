/**
 * @vitest-environment jsdom
 *
 * Component tests for Obs 10 — preserve CollapsedPersonaGroup expansion
 * state across re-renders (ClickUp 86c9zfmh1).
 *
 * Coverage map:
 *   - Tracker unit behavior (factory): isExpanded / setExpanded / prune /
 *     makeKey / size lifecycle, including the "user-collapsed wrappers do
 *     not snap back open" invariant.
 *   - Wrapper integration via `renderCollapsedPersonaTile` with the tracker:
 *       (a) the wrapper reads `isExpanded(key)` once in the constructor and
 *           pre-expands its initial DOM when the tracker reports true;
 *       (b) clicks write back via `setExpanded(key, …)` so the next render
 *           sees the user's intent;
 *       (c) the wrapper key is composed from sessionId+teamId+personaName so
 *           per-team and per-session wrappers track independently.
 *   - End-to-end re-render preservation via `renderFull`:
 *       — sponsor's verbatim Obs 10 symptom — expand → poll-tick re-render
 *         → STILL expanded.
 *   - Prune pass — wrappers that disappear between renders drop their
 *     tracker entry so the Set stays bounded.
 *
 * Source: ClickUp 86c9zfmh1 (Obs 10 — expansion-preserve)
 *         src/webview/expandedGroupsTracker.ts
 *         src/webview/components/collapsedPersonaTile.ts
 *         src/webview/render.ts
 */

import { describe, it, expect, vi } from "vitest";
import type {
  AgentTile,
  CollapsedPersonaGroup,
  WebviewAgentTree,
} from "../../../src/shared/types.js";
import { renderCollapsedPersonaTile } from "../../../src/webview/components/collapsedPersonaTile.js";
import { renderFull } from "../../../src/webview/render.js";
import { createExpandedGroupsTracker } from "../../../src/webview/expandedGroupsTracker.js";

// ---------------------------------------------------------------------------
// Fixture helpers — match collapsedPersonaTile.test.ts shape so a future
// reader can compare invariants side-by-side.
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

function makeStateWithGroup(
  group: CollapsedPersonaGroup,
  sessionId: string = "sess-OBS10",
  teamId: string = "claudeteam-alpha",
): WebviewAgentTree {
  return {
    sessions: [
      {
        shortId: "sess0001",
        sessionId,
        pid: 1234,
        entrypoint: "claude-vscode",
        version: "2.1.145",
        isAlive: true,
        cwd: "c:\\test",
        title: "obs10-expansion-preserve",
        rosterTiles: new Map([[teamId, [group]]]),
        teamOrder: [teamId],
        background: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tracker unit behavior
// ---------------------------------------------------------------------------

describe("createExpandedGroupsTracker — factory + lifecycle", () => {
  it("returns false for an unknown key (default-collapsed semantics)", () => {
    const tracker = createExpandedGroupsTracker();
    const key = tracker.makeKey("sess-A", "team-A", "Felix");
    expect(tracker.isExpanded(key)).toBe(false);
    expect(tracker.size()).toBe(0);
  });

  it("setExpanded(true) flips the key to expanded", () => {
    const tracker = createExpandedGroupsTracker();
    const key = tracker.makeKey("sess-A", "team-A", "Felix");
    tracker.setExpanded(key, true);
    expect(tracker.isExpanded(key)).toBe(true);
    expect(tracker.size()).toBe(1);
  });

  it("setExpanded(false) removes the key (collapsed wrappers do not snap open)", () => {
    // Important invariant — a user who collapses a previously-expanded
    // wrapper has explicitly signaled they want it closed. The tracker
    // must REMOVE the entry (not just mark it false) so the next render's
    // default-collapsed branch applies. If we stored false instead, a
    // future "is anything tracked for this key?" probe would be wrong.
    const tracker = createExpandedGroupsTracker();
    const key = tracker.makeKey("sess-A", "team-A", "Felix");
    tracker.setExpanded(key, true);
    tracker.setExpanded(key, false);
    expect(tracker.isExpanded(key)).toBe(false);
    expect(tracker.size()).toBe(0);
  });

  it("keys with different (sessionId, teamId, personaName) tuples are independent", () => {
    // Defensive: the three parts of the key must all contribute. Two
    // sessions hosting a Felix wrapper, or two teams in the same session,
    // must not share expansion state. Otherwise expanding "Felix" in
    // ClaudeTeam Alpha would also expand "Felix" in some other team —
    // surprising and wrong.
    const tracker = createExpandedGroupsTracker();
    const keySessA = tracker.makeKey("sess-A", "team-X", "Felix");
    const keySessB = tracker.makeKey("sess-B", "team-X", "Felix");
    const keyTeamY = tracker.makeKey("sess-A", "team-Y", "Felix");
    tracker.setExpanded(keySessA, true);

    expect(tracker.isExpanded(keySessA)).toBe(true);
    expect(tracker.isExpanded(keySessB)).toBe(false);
    expect(tracker.isExpanded(keyTeamY)).toBe(false);
    expect(tracker.size()).toBe(1);
  });

  it("prune() removes entries not in the provided set", () => {
    const tracker = createExpandedGroupsTracker();
    const keyKeep = tracker.makeKey("sess-A", "team-A", "Felix");
    const keyGone = tracker.makeKey("sess-A", "team-A", "Maya");
    tracker.setExpanded(keyKeep, true);
    tracker.setExpanded(keyGone, true);
    expect(tracker.size()).toBe(2);

    tracker.prune(new Set([keyKeep]));

    expect(tracker.isExpanded(keyKeep)).toBe(true);
    expect(tracker.isExpanded(keyGone)).toBe(false);
    expect(tracker.size()).toBe(1);
  });

  it("prune() with an empty set clears everything", () => {
    // The 'all sessions dead' / 'all teams empty' edge case — every
    // wrapper has disappeared so no current keys are passed. Tracker
    // should fully reset rather than leak.
    const tracker = createExpandedGroupsTracker();
    tracker.setExpanded(tracker.makeKey("sess-A", "team-A", "Felix"), true);
    tracker.setExpanded(tracker.makeKey("sess-A", "team-A", "Maya"), true);

    tracker.prune(new Set());

    expect(tracker.size()).toBe(0);
  });

  it("each createExpandedGroupsTracker() call returns an isolated instance", () => {
    // Defense against accidental module-level shared state — two trackers
    // must not share their Set. (jsdom test isolation also depends on this.)
    const a = createExpandedGroupsTracker();
    const b = createExpandedGroupsTracker();
    a.setExpanded(a.makeKey("sess-A", "team-A", "Felix"), true);
    expect(a.size()).toBe(1);
    expect(b.size()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// renderCollapsedPersonaTile — tracker integration
// ---------------------------------------------------------------------------

describe("renderCollapsedPersonaTile — expandedGroupsTracker integration", () => {
  it("pre-expands the wrapper when tracker reports the key as expanded", () => {
    // The load-bearing behavior: the constructor reads `isExpanded(key)`
    // before building the DOM, and when true initializes the wrapper into
    // the expanded shape — instances populated, chevron ▼, hidden=false,
    // aria-expanded=true.
    const tracker = createExpandedGroupsTracker();
    tracker.setExpanded(
      tracker.makeKey("sess-1", "claudeteam-alpha", "Bram"),
      true,
    );

    const el = renderCollapsedPersonaTile({
      group: makeGroup("Bram", 3),
      sessionId: "sess-1",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
    });

    expect(el.dataset.expanded).toBe("true");
    expect(
      el
        .querySelector<HTMLButtonElement>(".collapsed-persona-header")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(el.querySelector(".collapsed-persona-chevron")?.textContent).toBe(
      "▼",
    );
    const instancesDiv = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    )!;
    expect(instancesDiv.hidden).toBe(false);
    // Eager populate — instances are in the DOM from the first paint,
    // not lazy-on-click as in the unknown/collapsed branch.
    expect(instancesDiv.children.length).toBe(3);
  });

  it("starts collapsed when tracker has no entry for the key (default semantics)", () => {
    // Back-compat sanity check — passing a tracker that does NOT know
    // about this key must NOT change the pre-Obs-10 default-collapsed
    // behavior covered by collapsedPersonaTile.test.ts AC2.
    const tracker = createExpandedGroupsTracker();
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Bram", 2),
      sessionId: "sess-1",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
    });

    expect(el.dataset.expanded).toBe("false");
    expect(el.querySelector(".collapsed-persona-chevron")?.textContent).toBe(
      "▶",
    );
    const instancesDiv = el.querySelector<HTMLDivElement>(
      ".collapsed-persona-instances",
    )!;
    expect(instancesDiv.hidden).toBe(true);
    expect(instancesDiv.children.length).toBe(0);
  });

  it("clicking the header writes back through setExpanded(...)", () => {
    // Persistence on the write side: after one click the tracker should
    // hold the user's intent so the NEXT render constructor reads it back.
    const tracker = createExpandedGroupsTracker();
    const key = tracker.makeKey("sess-1", "claudeteam-alpha", "Bram");

    const el = renderCollapsedPersonaTile({
      group: makeGroup("Bram", 2),
      sessionId: "sess-1",
      teamId: "claudeteam-alpha",
      postMessage: vi.fn(),
      expandedGroupsTracker: tracker,
    });

    expect(tracker.isExpanded(key)).toBe(false);
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    expect(tracker.isExpanded(key)).toBe(true);

    // Collapse again — tracker must remove the entry, not just hold false.
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    expect(tracker.isExpanded(key)).toBe(false);
    expect(tracker.size()).toBe(0);
  });

  it("absent tracker falls back to pre-Obs-10 ephemeral DOM behavior", () => {
    // Back-compat invariant: component tests / fixture-mode callers that
    // omit the tracker (and/or teamId) must continue to see the original
    // default-collapsed-with-no-persistence shape. This is the same path
    // exercised by collapsedPersonaTile.test.ts AC2 — we only verify here
    // that clicking still works locally on the returned element.
    const el = renderCollapsedPersonaTile({
      group: makeGroup("Bram", 2),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      // expandedGroupsTracker omitted, teamId omitted.
    });

    expect(el.dataset.expanded).toBe("false");
    el.querySelector<HTMLButtonElement>(".collapsed-persona-header")!.click();
    expect(el.dataset.expanded).toBe("true");
    // Nothing persists — there's no tracker to consult.
  });
});

// ---------------------------------------------------------------------------
// End-to-end: renderFull preserves expansion across re-renders (the ticket)
// ---------------------------------------------------------------------------

describe("renderFull — Obs 10 expansion preserved across re-render", () => {
  it("expand → identical-state re-render → wrapper is STILL expanded", () => {
    // The Obs 10 sponsor symptom verbatim: clicking expand on a wrapper
    // and seeing it snap shut on the next poll tick. The fix is the
    // expandedGroupsTracker threaded through renderFull → sessionBlock →
    // teamCard → collapsedPersonaTile.
    const mount = document.createElement("div");
    const tracker = createExpandedGroupsTracker();
    const state = makeStateWithGroup(makeGroup("Bram", 3));

    // Initial render → collapsed by default.
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        expandedGroupsTracker: tracker,
      },
      state,
    );

    const header1 = mount.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    expect(
      mount.querySelector<HTMLElement>(".collapsed-persona")!.dataset.expanded,
    ).toBe("false");

    // User clicks expand. Tracker now holds the intent.
    header1.click();
    expect(
      mount.querySelector<HTMLElement>(".collapsed-persona")!.dataset.expanded,
    ).toBe("true");

    // Host poll tick — same state, full re-render (replaceChildren).
    // Without the fix, the wrapper snaps back to data-expanded="false".
    // With the fix, the constructor reads isExpanded(key) from the tracker
    // and rebuilds the wrapper into the expanded shape.
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        expandedGroupsTracker: tracker,
      },
      state,
    );

    const wrapperAfterRerender =
      mount.querySelector<HTMLElement>(".collapsed-persona")!;
    expect(wrapperAfterRerender.dataset.expanded).toBe("true");
    expect(
      wrapperAfterRerender
        .querySelector<HTMLButtonElement>(".collapsed-persona-header")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      wrapperAfterRerender.querySelector(".collapsed-persona-chevron")
        ?.textContent,
    ).toBe("▼");
    // Instances populated eagerly in the rebuilt DOM so the user's view
    // matches the previous render before the tick.
    expect(
      wrapperAfterRerender.querySelectorAll(
        ".collapsed-persona-instances .agent-tile",
      ).length,
    ).toBe(3);
  });

  it("multiple sequential re-renders all preserve the expanded state", () => {
    // Belt-and-suspenders: the sponsor's bug fires "in 1 second" because
    // the next tick collapsed it. Multiple ticks must all see the same
    // restored intent; the tracker entry should not erode as renderFull
    // runs the prune pass on each tick.
    const mount = document.createElement("div");
    const tracker = createExpandedGroupsTracker();
    const state = makeStateWithGroup(makeGroup("Bram", 2));

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();

    // Five consecutive ticks (~10s real-time) — each one must rebuild
    // the wrapper into the expanded shape.
    for (let i = 0; i < 5; i++) {
      renderFull(
        { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
        state,
      );
      const wrapper =
        mount.querySelector<HTMLElement>(".collapsed-persona")!;
      expect(wrapper.dataset.expanded).toBe("true");
    }
    expect(tracker.size()).toBe(1);
  });

  it("user-collapsed wrappers stay collapsed across re-renders (not just expanded ones)", () => {
    // The default-collapsed-by-construction path is also covered, but
    // verify the round-trip: expand → collapse → re-render → still
    // collapsed. The tracker must honor the user's most recent intent,
    // not arbitrarily snap back to expanded.
    const mount = document.createElement("div");
    const tracker = createExpandedGroupsTracker();
    const state = makeStateWithGroup(makeGroup("Bram", 2));

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );
    const header = mount.querySelector<HTMLButtonElement>(
      ".collapsed-persona-header",
    )!;
    header.click(); // expand
    header.click(); // collapse

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );

    const wrapper =
      mount.querySelector<HTMLElement>(".collapsed-persona")!;
    expect(wrapper.dataset.expanded).toBe("false");
    expect(
      wrapper
        .querySelector<HTMLButtonElement>(".collapsed-persona-header")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(tracker.size()).toBe(0);
  });

  it("forceRefresh-equivalent (re-render same state) preserves expansion (acceptance per ticket)", () => {
    // ClickUp 86c9zfmh1 acceptance: "Expansion persists across forceRefresh
    // but not across window reload." The webview models forceRefresh as
    // another renderFull pass with whatever the next state:full carries.
    // Same-state re-render is the cleanest proxy for that condition.
    const mount = document.createElement("div");
    const tracker = createExpandedGroupsTracker();
    const state = makeStateWithGroup(makeGroup("Bram", 4));

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();

    // Simulate forceRefresh: identical state, fresh renderFull.
    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );

    expect(
      mount.querySelector<HTMLElement>(".collapsed-persona")!.dataset.expanded,
    ).toBe("true");
  });

  it("absent tracker preserves the pre-Obs-10 contract (renderFull works unchanged)", () => {
    // Back-compat invariant for component tests that don't construct a
    // tracker. The wrapper still renders, clicks still toggle, but the
    // re-render snap-shut behavior is the pre-Obs-10 default.
    const mount = document.createElement("div");
    const state = makeStateWithGroup(makeGroup("Bram", 2));

    renderFull({ mount, postMessage: vi.fn() }, state);
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();
    expect(
      mount.querySelector<HTMLElement>(".collapsed-persona")!.dataset.expanded,
    ).toBe("true");

    renderFull({ mount, postMessage: vi.fn() }, state);
    // Without a tracker the wrapper resets to its constructor default —
    // collapsed. This is the bug the new tracker fixes; the test pins the
    // legacy behavior so a future regression in the back-compat path
    // surfaces explicitly.
    expect(
      mount.querySelector<HTMLElement>(".collapsed-persona")!.dataset.expanded,
    ).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Prune integration — tracker shrinks as wrappers disappear
// ---------------------------------------------------------------------------

describe("renderFull prune pass — expanded-groups entries are evicted with their wrappers", () => {
  it("removes the tracker entry for a wrapper that disappears between renders", () => {
    // First render has a Felix wrapper; user expands it; second render
    // has only a Maya wrapper. The Felix entry must shed so the Set stays
    // bounded as personas come and go across a long-lived dashboard.
    const mount = document.createElement("div");
    const tracker = createExpandedGroupsTracker();
    const stateA = makeStateWithGroup(makeGroup("Felix", 2));
    const stateB = makeStateWithGroup(makeGroup("Maya", 2));

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      stateA,
    );
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();
    expect(tracker.size()).toBe(1);

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      stateB,
    );
    // Felix's entry pruned; Maya was not expanded so the tracker is empty.
    expect(tracker.size()).toBe(0);
    // Maya's wrapper renders fresh as collapsed (no tracker entry → default).
    expect(
      mount.querySelector<HTMLElement>(".collapsed-persona")!.dataset.expanded,
    ).toBe("false");
  });

  it("does NOT prune a wrapper that survives across renders", () => {
    // Defensive: the prune pass must not drop entries for wrappers that
    // are still present — otherwise expanding any wrapper would snap shut
    // on the very next tick (regressing the whole feature).
    const mount = document.createElement("div");
    const tracker = createExpandedGroupsTracker();
    const state = makeStateWithGroup(makeGroup("Felix", 2));

    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );
    mount
      .querySelector<HTMLButtonElement>(".collapsed-persona-header")!
      .click();
    expect(tracker.size()).toBe(1);

    // Re-render with the SAME state; prune must keep Felix's entry.
    renderFull(
      { mount, postMessage: vi.fn(), expandedGroupsTracker: tracker },
      state,
    );
    expect(tracker.size()).toBe(1);
  });
});
