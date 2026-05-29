/**
 * @vitest-environment jsdom
 *
 * Tests for the per-tile overflow ("⋯") menu fixes (ticket 86ca1fjqu).
 *
 * BUG 1 — overflow menu was ABSENT on multi-agent ×N persona tiles. Single
 *   tiles carried the Hide / Remove menu; multi-agent tiles (Felix ×8) did not,
 *   so the sponsor could not hide/remove a multi-agent member. The fix carries
 *   the IDENTICAL `buildOverflowMenu` into `renderMultiAgentPersonaTile`, acting
 *   on the rostered MEMBER (posting `ui:hide-member` / `ui:remove-member` for the
 *   (teamId, memberId) PAIR).
 *
 * BUG 2 — the menu AUTO-CLOSED instantly. Root cause: the ~2s poll `renderFull`
 *   rebuilds the whole tile DOM; the menu's open state lived only in the DOM
 *   (`menu.hidden`), so each rebuild constructed a fresh closed menu and the
 *   open menu vanished. (NOT a click-away/blur race — there is no document-level
 *   click-away handler anywhere in the webview, and the opening click already
 *   stopPropagation's.) The fix seeds the open phase from a webview-local
 *   `MenuOpenTracker` keyed by `sessionId:teamId:memberId`, mirroring the Obs 10
 *   `expandedGroupsTracker` pattern, so the menu survives the re-render until a
 *   deliberate dismiss (item click / Esc / re-click).
 *
 * AC map (ticket 86ca1fjqu):
 *   AC1 — menu present on ×N tiles + correct (teamId, memberId) messages.
 *   AC2 — menu-open survives a simulated poll re-render (both bare + multi tiles).
 *   AC3 — the opening click does NOT self-close; Esc closes.
 *   AC4 — regression coverage (these tests).
 *
 * Source: src/webview/components/agentTile.ts (shared buildOverflowMenu)
 *         src/webview/components/multiAgentPersonaTile.ts (BUG 1 reuse)
 *         src/webview/menuOpenTracker.ts (BUG 2 persistence)
 */

import { describe, it, expect, vi } from "vitest";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { renderMultiAgentPersonaTile } from "../../../src/webview/components/multiAgentPersonaTile.js";
import { createMenuOpenTracker } from "../../../src/webview/menuOpenTracker.js";
import { renderFull } from "../../../src/webview/render.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import type {
  AgentTile,
  MultiAgentPersonaTile,
  WebviewAgentTree,
} from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixtures
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
    makeInstance({ agentId: "aaaa1111", state: "running" }),
    makeInstance({ agentId: "bbbb2222", state: "finished", activity: "finished 4m" }),
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

const q = <T extends HTMLElement>(el: HTMLElement, sel: string): T =>
  el.querySelector<T>(sel)!;

// ===========================================================================
// AC1 — overflow menu present on multi-agent ×N tiles + correct messages
// ===========================================================================

describe("BUG 1 / AC1 — overflow menu on multi-agent ×N tiles", () => {
  it("renders the [⋯] overflow button + hide/remove items on a multi-agent tile", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const btn = el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("agent actions");
    expect(btn!.getAttribute("aria-haspopup")).toBe("menu");
    expect(
      el.querySelector(".agent-tile-overflow-item[data-action='hide']"),
    ).not.toBeNull();
    expect(
      el.querySelector(".agent-tile-overflow-item[data-action='remove']"),
    ).not.toBeNull();
  });

  it("'Hide {display}' uses the member display name and posts the PAIR", () => {
    const posted: WebviewMessage[] = [];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({
        display: "Maya",
        memberId: "maya",
        teamId: "claudeteam-alpha",
      }),
      sessionId: "sess-A",
      postMessage: (m) => posted.push(m),
    });
    const item = q<HTMLButtonElement>(
      el,
      ".agent-tile-overflow-item[data-action='hide']",
    );
    expect(item.textContent).toBe("Hide Maya");

    q<HTMLButtonElement>(el, ".agent-tile-overflow-btn").click();
    item.click();
    expect(posted).toEqual([
      {
        type: "ui:hide-member",
        payload: { teamId: "claudeteam-alpha", memberId: "maya" },
      },
    ]);
  });

  it("Remove → confirm → Remove posts ui:remove-member with the PAIR", () => {
    const posted: WebviewMessage[] = [];
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile({ memberId: "felix", teamId: "claudeteam-alpha" }),
      sessionId: "sess-A",
      postMessage: (m) => posted.push(m),
    });
    q<HTMLButtonElement>(el, ".agent-tile-overflow-btn").click();
    q<HTMLButtonElement>(
      el,
      ".agent-tile-overflow-item[data-action='remove']",
    ).click();
    // Confirm panel now visible.
    const confirm = q<HTMLElement>(el, ".agent-tile-remove-confirm");
    expect(confirm.hidden).toBe(false);
    q<HTMLButtonElement>(
      el,
      ".agent-tile-remove-confirm-remove",
    ).click();
    expect(posted).toEqual([
      {
        type: "ui:remove-member",
        payload: { teamId: "claudeteam-alpha", memberId: "felix" },
      },
    ]);
  });

  it("clicking the overflow does NOT expand the instance list (badge is separate)", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const region = q<HTMLElement>(el, ".persona-instances");
    expect(region.hidden).toBe(true);
    q<HTMLButtonElement>(el, ".agent-tile-overflow-btn").click();
    // Menu opened, list stayed collapsed (the overflow stopPropagation's so the
    // badge / article handlers don't fire).
    expect(q<HTMLElement>(el, ".agent-tile-overflow-menu").hidden).toBe(false);
    expect(region.hidden).toBe(true);
  });
});

// ===========================================================================
// AC3 — the opening click does NOT self-close the menu; Esc closes
// ===========================================================================

describe("BUG 2 / AC3 — opening click does not self-close; Esc closes", () => {
  it("a single click on [⋯] OPENS the menu and leaves it open (no self-close)", () => {
    const el = renderAgentTile({
      tile: makeInstance(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const btn = q<HTMLButtonElement>(el, ".agent-tile-overflow-btn");
    const menu = q<HTMLElement>(el, ".agent-tile-overflow-menu");
    expect(menu.hidden).toBe(true);
    btn.click();
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("multi-agent: a single [⋯] click opens + stays open", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const menu = q<HTMLElement>(el, ".agent-tile-overflow-menu");
    q<HTMLButtonElement>(el, ".agent-tile-overflow-btn").click();
    expect(menu.hidden).toBe(false);
  });

  it("Esc on the [⋯] button closes the open menu (multi-agent tile)", () => {
    const el = renderMultiAgentPersonaTile({
      tile: makeMultiTile(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const btn = q<HTMLButtonElement>(el, ".agent-tile-overflow-btn");
    const menu = q<HTMLElement>(el, ".agent-tile-overflow-menu");
    btn.click();
    expect(menu.hidden).toBe(false);
    btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(menu.hidden).toBe(true);
  });

  it("re-clicking [⋯] toggles the menu closed (deliberate dismiss)", () => {
    const el = renderAgentTile({
      tile: makeInstance(),
      sessionId: "sess-A",
      postMessage: vi.fn(),
    });
    const btn = q<HTMLButtonElement>(el, ".agent-tile-overflow-btn");
    const menu = q<HTMLElement>(el, ".agent-tile-overflow-menu");
    btn.click();
    expect(menu.hidden).toBe(false);
    btn.click();
    expect(menu.hidden).toBe(true);
  });
});

// ===========================================================================
// AC2 — menu-open survives a simulated poll re-render
// ===========================================================================

describe("BUG 2 / AC2 — open state survives a simulated re-render", () => {
  it("bare tile: an open menu re-renders OPEN via the shared tracker", () => {
    const menuOpenTracker = createMenuOpenTracker();
    const tile = makeInstance({ memberId: "ac2-bare" });

    const first = renderAgentTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    // Open the menu → tracker records the open phase keyed by memberId.
    q<HTMLButtonElement>(first, ".agent-tile-overflow-btn").click();
    const key = menuOpenTracker.makeKey("sess-A", "claudeteam-alpha", "ac2-bare");
    expect(menuOpenTracker.phase(key)).toBe("menu");

    // Simulate the ~2s poll tick: a fresh tile from the SAME tracker.
    const second = renderAgentTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    expect(
      q<HTMLElement>(second, ".agent-tile-overflow-menu").hidden,
    ).toBe(false);
    expect(
      q<HTMLElement>(second, ".agent-tile-overflow-btn").getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });

  it("multi-agent tile: an open menu re-renders OPEN via the shared tracker", () => {
    const menuOpenTracker = createMenuOpenTracker();
    const tile = makeMultiTile({ memberId: "ac2-multi" });

    const first = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    q<HTMLButtonElement>(first, ".agent-tile-overflow-btn").click();
    const key = menuOpenTracker.makeKey(
      "sess-A",
      "claudeteam-alpha",
      "ac2-multi",
    );
    expect(menuOpenTracker.phase(key)).toBe("menu");

    const second = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    expect(
      q<HTMLElement>(second, ".agent-tile-overflow-menu").hidden,
    ).toBe(false);
  });

  it("the remove-CONFIRM panel also survives a re-render (phase='confirm')", () => {
    const menuOpenTracker = createMenuOpenTracker();
    const tile = makeMultiTile({ memberId: "ac2-confirm" });

    const first = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    q<HTMLButtonElement>(first, ".agent-tile-overflow-btn").click();
    q<HTMLButtonElement>(
      first,
      ".agent-tile-overflow-item[data-action='remove']",
    ).click();
    const key = menuOpenTracker.makeKey(
      "sess-A",
      "claudeteam-alpha",
      "ac2-confirm",
    );
    expect(menuOpenTracker.phase(key)).toBe("confirm");

    const second = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    expect(
      q<HTMLElement>(second, ".agent-tile-remove-confirm").hidden,
    ).toBe(false);
    // ...and the menu (the first step) is NOT shown — only the confirm panel.
    expect(
      q<HTMLElement>(second, ".agent-tile-overflow-menu").hidden,
    ).toBe(true);
  });

  it("a user-closed menu STAYS closed across a re-render (no resurrection)", () => {
    const menuOpenTracker = createMenuOpenTracker();
    const tile = makeInstance({ memberId: "ac2-closed" });

    const first = renderAgentTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    const btn1 = q<HTMLButtonElement>(first, ".agent-tile-overflow-btn");
    btn1.click(); // open
    btn1.click(); // close
    const key = menuOpenTracker.makeKey(
      "sess-A",
      "claudeteam-alpha",
      "ac2-closed",
    );
    expect(menuOpenTracker.phase(key)).toBeNull();

    const second = renderAgentTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    expect(
      q<HTMLElement>(second, ".agent-tile-overflow-menu").hidden,
    ).toBe(true);
  });

  it("dismissing via a menu item (Hide) clears the tracker → re-render closed", () => {
    const menuOpenTracker = createMenuOpenTracker();
    const tile = makeMultiTile({ memberId: "ac2-hide-dismiss" });

    const first = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    q<HTMLButtonElement>(first, ".agent-tile-overflow-btn").click();
    q<HTMLButtonElement>(
      first,
      ".agent-tile-overflow-item[data-action='hide']",
    ).click();
    const key = menuOpenTracker.makeKey(
      "sess-A",
      "claudeteam-alpha",
      "ac2-hide-dismiss",
    );
    expect(menuOpenTracker.phase(key)).toBeNull();

    const second = renderMultiAgentPersonaTile({
      tile,
      sessionId: "sess-A",
      postMessage: vi.fn(),
      menuOpenTracker,
    });
    expect(
      q<HTMLElement>(second, ".agent-tile-overflow-menu").hidden,
    ).toBe(true);
  });
});

// ===========================================================================
// menuOpenTracker unit coverage (lifecycle + prune)
// ===========================================================================

describe("menuOpenTracker — lifecycle", () => {
  it("phase() defaults to null for unknown keys", () => {
    const t = createMenuOpenTracker();
    expect(t.phase(t.makeKey("s", "team", "m"))).toBeNull();
  });

  it("setPhase records / clears phases and tracks size", () => {
    const t = createMenuOpenTracker();
    const k = t.makeKey("s", "team", "m");
    t.setPhase(k, "menu");
    expect(t.phase(k)).toBe("menu");
    expect(t.size()).toBe(1);
    t.setPhase(k, "confirm");
    expect(t.phase(k)).toBe("confirm");
    expect(t.size()).toBe(1);
    t.setPhase(k, null);
    expect(t.phase(k)).toBeNull();
    expect(t.size()).toBe(0);
  });

  it("prune() drops keys not in the current set", () => {
    const t = createMenuOpenTracker();
    const keep = t.makeKey("s", "team", "keep");
    const drop = t.makeKey("s", "team", "drop");
    t.setPhase(keep, "menu");
    t.setPhase(drop, "menu");
    t.prune(new Set([keep]));
    expect(t.phase(keep)).toBe("menu");
    expect(t.phase(drop)).toBeNull();
    expect(t.size()).toBe(1);
  });

  it("makeKey composes sessionId:teamId:memberId", () => {
    const t = createMenuOpenTracker();
    expect(t.makeKey("sess-A", "claudeteam-alpha", "felix")).toBe(
      "sess-A:claudeteam-alpha:felix",
    );
  });
});

// ===========================================================================
// renderFull integration — the realistic poll path (the actual bug scenario)
// ===========================================================================

describe("renderFull — open menu survives a full poll re-render (AC2 end-to-end)", () => {
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

  it("a menu opened on a bare tile stays open after a full renderFull tick", () => {
    const mount = document.createElement("div");
    const menuOpenTracker = createMenuOpenTracker();
    const tree = makeTree([makeInstance({ memberId: "felix" })]);

    renderFull({ mount, postMessage: vi.fn(), menuOpenTracker }, tree);
    // Open the menu in the live DOM.
    q<HTMLButtonElement>(mount, ".agent-tile-overflow-btn").click();
    expect(q<HTMLElement>(mount, ".agent-tile-overflow-menu").hidden).toBe(false);

    // Simulate the ~2s poll: same state, same tracker, full re-render.
    renderFull({ mount, postMessage: vi.fn(), menuOpenTracker }, tree);
    expect(q<HTMLElement>(mount, ".agent-tile-overflow-menu").hidden).toBe(false);
  });

  it("a menu opened on a multi-agent tile stays open after a full renderFull tick", () => {
    const mount = document.createElement("div");
    const menuOpenTracker = createMenuOpenTracker();
    const tree = makeTree([makeMultiTile({ memberId: "felix" })]);

    renderFull({ mount, postMessage: vi.fn(), menuOpenTracker }, tree);
    q<HTMLButtonElement>(mount, ".agent-tile-overflow-btn").click();
    expect(q<HTMLElement>(mount, ".agent-tile-overflow-menu").hidden).toBe(false);

    renderFull({ mount, postMessage: vi.fn(), menuOpenTracker }, tree);
    expect(q<HTMLElement>(mount, ".agent-tile-overflow-menu").hidden).toBe(false);
  });

  it("prune drops the entry when the member's tile disappears between ticks", () => {
    const mount = document.createElement("div");
    const menuOpenTracker = createMenuOpenTracker();

    renderFull(
      { mount, postMessage: vi.fn(), menuOpenTracker },
      makeTree([makeInstance({ memberId: "felix" })]),
    );
    q<HTMLButtonElement>(mount, ".agent-tile-overflow-btn").click();
    expect(menuOpenTracker.size()).toBe(1);

    // Next tick: Felix gone (e.g. session ended) → tile absent → prune evicts.
    renderFull(
      { mount, postMessage: vi.fn(), menuOpenTracker },
      makeTree([makeInstance({ memberId: "maya", display: "Maya", agentId: "m1" })]),
    );
    expect(
      menuOpenTracker.phase(
        menuOpenTracker.makeKey("sess-A", "claudeteam-alpha", "felix"),
      ),
    ).toBeNull();
  });
});
