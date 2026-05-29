/**
 * @vitest-environment jsdom
 *
 * Unit + message-round-trip tests for the webview hide-agent surface
 * (E-06b / EPIC 86ca11187 §7.2):
 *
 *   - Per-tile overflow affordance ([⋯]) → "Hide {display}" posts
 *     `ui:hide-member { teamId, memberId }` (the PAIR, never the joined key).
 *   - "N hidden agents [show]" recovery chip: count, expand/collapse, reveal
 *     list rendering, per-member [unhide] posts `ui:show-member`, [Show all]
 *     posts `ui:show-all-hidden`.
 *   - Reveal-list display-name resolution via MemberDirectory (cache hit →
 *     friendly name + role; cache miss → raw memberId fallback).
 *   - render.ts integration: chip mounts when hiddenMemberKeys non-empty,
 *     absent when empty; memberDirectory observes tiles each tick.
 *
 * Vocabulary is consumed VERBATIM from the E-06a host contract merged on main
 * (PR #115): `ui:hide-member` / `ui:show-member` (pair payload) /
 * `ui:show-all-hidden` (no payload); `hiddenMemberKeys: HiddenMemberKey[]`.
 *
 * Source: src/webview/components/agentTile.ts (overflow menu)
 *         src/webview/components/hiddenMembersChip.ts
 *         src/webview/memberDirectory.ts
 *         src/webview/render.ts (mount integration)
 *         team/iris-ux/whole-team-display-spec.md §7.1, §7.2
 */

import { describe, it, expect, vi } from "vitest";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import {
  renderHiddenMembersChip,
  toggleLabel,
} from "../../../src/webview/components/hiddenMembersChip.js";
import { MemberDirectory } from "../../../src/webview/memberDirectory.js";
import { renderFull } from "../../../src/webview/render.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import type {
  AgentTile,
  AgentState,
  AgentTree,
  HiddenMemberKey,
} from "../../../src/shared/types.js";

const EM_DASH = "—";

function makeTile(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: "tool:Edit src/extension/main.ts",
    model: "claude-opus-4-7",
    state: "running",
    agentId: "a1d53b4a2db17f2f5",
    toolUseId: "toolu_TEST",
    ...overrides,
  };
}

function makeStateWithTiles(tiles: AgentTile[]): AgentTree {
  return {
    sessions: [
      {
        shortId: "sessA001",
        sessionId: "sess-A",
        pid: 1234,
        entrypoint: "claude-vscode",
        version: "2.1.145",
        isAlive: true,
        cwd: "c:\\test",
        title: "Test session",
        rosterTiles: new Map([["claudeteam-alpha", tiles]]),
        teamOrder: ["claudeteam-alpha"],
        background: [],
      },
    ],
  };
}

// ===========================================================================
// Per-tile overflow affordance ([⋯]) → ui:hide-member
// ===========================================================================

describe("agentTile overflow affordance — hide-member (spec §7.1)", () => {
  it("renders the [⋯] overflow button with aria-label 'agent actions'", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const btn = el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn");
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("aria-label")).toBe("agent actions");
    expect(btn!.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn!.getAttribute("aria-expanded")).toBe("false");
  });

  it("menu is hidden at rest and opens on [⋯] click", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const btn = el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn")!;
    const menu = el.querySelector<HTMLElement>(".agent-tile-overflow-menu")!;
    expect(menu.hidden).toBe(true);

    btn.click();
    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("'Hide {display}' menu item text uses the tile's display name", () => {
    const el = renderAgentTile({
      tile: makeTile({ display: "Maya" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const item = el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='hide']",
    )!;
    expect(item.textContent).toBe("Hide Maya");
    expect(item.getAttribute("role")).toBe("menuitem");
  });

  it("clicking 'Hide' posts ui:hide-member with the (teamId, memberId) PAIR", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile({ teamId: "claudeteam-alpha", memberId: "felix" }),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    const btn = el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn")!;
    btn.click();
    const item = el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='hide']",
    )!;
    item.click();

    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      type: "ui:hide-member",
      payload: { teamId: "claudeteam-alpha", memberId: "felix" },
    });
  });

  it("clicking 'Hide' does NOT fire the tile drill-in (ui:open-transcript)", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn")!.click();
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='hide']",
    )!.click();

    expect(posted.every((m) => m.type !== "ui:open-transcript")).toBe(true);
  });

  it("clicking the tile body still fires drill-in (overflow does not block it)", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile({ agentId: "agent-X" }),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    // Click a non-overflow part of the tile.
    el.querySelector<HTMLElement>(".agent-display")!.click();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      type: "ui:open-transcript",
      payload: { sessionId: "sess-1", agentId: "agent-X" },
    });
  });

  it("AC5 — baseline 'available' members are hide-able (overflow renders)", () => {
    const el = renderAgentTile({
      tile: makeTile({ state: "available", agentId: "", toolUseId: null }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const item = el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='hide']",
    );
    expect(item).not.toBeNull();
    expect(item!.textContent).toBe("Hide Felix");
  });

  it("Escape on the open menu closes it", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const btn = el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn")!;
    const menu = el.querySelector<HTMLElement>(".agent-tile-overflow-menu")!;
    btn.click();
    expect(menu.hidden).toBe(false);
    btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(menu.hidden).toBe(true);
  });
});

// ===========================================================================
// toggleLabel pure helper
// ===========================================================================

describe("hiddenMembersChip toggleLabel — spec §7.2 templates", () => {
  it("collapsed → 'N hidden agents — show'", () => {
    expect(toggleLabel(1, false)).toBe(`1 hidden agent ${EM_DASH} show`);
    expect(toggleLabel(2, false)).toBe(`2 hidden agents ${EM_DASH} show`);
  });
  it("expanded → 'N hidden agents — hide'", () => {
    expect(toggleLabel(1, true)).toBe(`1 hidden agent ${EM_DASH} hide`);
    expect(toggleLabel(3, true)).toBe(`3 hidden agents ${EM_DASH} hide`);
  });
});

// ===========================================================================
// Hidden-members reveal chip
// ===========================================================================

describe("renderHiddenMembersChip — reveal + unhide (spec §7.2)", () => {
  it("returns null when nothing is hidden", () => {
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: [],
      postMessage: vi.fn(),
    });
    expect(chip).toBeNull();
  });

  it("renders the count chip with the hidden count", () => {
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: [
        "claudeteam-alpha:bram",
        "claudeteam-alpha:nora",
      ] as HiddenMemberKey[],
      postMessage: vi.fn(),
    })!;
    expect(chip.dataset.hiddenMemberCount).toBe("2");
    const toggle = chip.querySelector(".ct-hidden-members-toggle")!;
    expect(toggle.textContent).toBe(`2 hidden agents ${EM_DASH} show`);
  });

  it("list is hidden when collapsed, visible when expanded", () => {
    const collapsed = renderHiddenMembersChip({
      hiddenMemberKeys: ["claudeteam-alpha:bram"] as HiddenMemberKey[],
      expanded: false,
      postMessage: vi.fn(),
    })!;
    expect(
      collapsed.querySelector<HTMLElement>(".ct-hidden-members-list")!.hidden,
    ).toBe(true);

    const expanded = renderHiddenMembersChip({
      hiddenMemberKeys: ["claudeteam-alpha:bram"] as HiddenMemberKey[],
      expanded: true,
      postMessage: vi.fn(),
    })!;
    expect(
      expanded.querySelector<HTMLElement>(".ct-hidden-members-list")!.hidden,
    ).toBe(false);
  });

  it("toggle click invokes onToggle with the next expansion state", () => {
    const onToggle = vi.fn();
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: ["claudeteam-alpha:bram"] as HiddenMemberKey[],
      expanded: false,
      onToggle,
      postMessage: vi.fn(),
    })!;
    chip.querySelector<HTMLButtonElement>(".ct-hidden-members-toggle")!.click();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("resolves display + role via resolveMember (cache hit)", () => {
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: ["claudeteam-alpha:bram"] as HiddenMemberKey[],
      expanded: true,
      resolveMember: (teamId, memberId) =>
        teamId === "claudeteam-alpha" && memberId === "bram"
          ? { display: "Bram", role: "Research" }
          : null,
      postMessage: vi.fn(),
    })!;
    const row = chip.querySelector<HTMLElement>(".ct-hidden-member-row")!;
    expect(row.querySelector(".ct-hidden-member-name")!.textContent).toBe(
      "Bram (hidden)",
    );
    expect(row.querySelector(".ct-hidden-member-role")!.textContent).toBe(
      "Research",
    );
  });

  it("falls back to raw memberId when resolveMember misses", () => {
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: ["claudeteam-alpha:ghost"] as HiddenMemberKey[],
      expanded: true,
      resolveMember: () => null,
      postMessage: vi.fn(),
    })!;
    const row = chip.querySelector<HTMLElement>(".ct-hidden-member-row")!;
    expect(row.querySelector(".ct-hidden-member-name")!.textContent).toBe(
      "ghost (hidden)",
    );
    // No role span when role is unknown.
    expect(row.querySelector(".ct-hidden-member-role")).toBeNull();
  });

  it("per-member unhide posts ui:show-member with the (teamId, memberId) PAIR", () => {
    const posted: WebviewMessage[] = [];
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: ["claudeteam-alpha:bram"] as HiddenMemberKey[],
      expanded: true,
      postMessage: (m) => posted.push(m),
    })!;
    chip
      .querySelector<HTMLButtonElement>(".ct-hidden-member-unhide")!
      .click();
    expect(posted).toEqual([
      {
        type: "ui:show-member",
        payload: { teamId: "claudeteam-alpha", memberId: "bram" },
      },
    ]);
  });

  it("'Show all' posts ui:show-all-hidden (no payload)", () => {
    const posted: WebviewMessage[] = [];
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: [
        "claudeteam-alpha:bram",
        "claudeteam-alpha:nora",
      ] as HiddenMemberKey[],
      expanded: true,
      postMessage: (m) => posted.push(m),
    })!;
    chip
      .querySelector<HTMLButtonElement>(".ct-hidden-members-show-all")!
      .click();
    expect(posted).toEqual([{ type: "ui:show-all-hidden" }]);
  });

  it("row carries data-team-id / data-member-id for the unhide payload", () => {
    const chip = renderHiddenMembersChip({
      hiddenMemberKeys: ["team-x:member-y"] as HiddenMemberKey[],
      expanded: true,
      postMessage: vi.fn(),
    })!;
    const row = chip.querySelector<HTMLElement>(".ct-hidden-member-row")!;
    expect(row.dataset.teamId).toBe("team-x");
    expect(row.dataset.memberId).toBe("member-y");
  });
});

// ===========================================================================
// MemberDirectory — display/role resolution across ticks
// ===========================================================================

describe("MemberDirectory — observe + resolve", () => {
  it("records display/role from observed tiles and resolves them", () => {
    const dir = new MemberDirectory();
    dir.observeState(
      makeStateWithTiles([
        makeTile({ memberId: "bram", display: "Bram", role: "Research" }),
      ]),
    );
    expect(dir.resolve("claudeteam-alpha", "bram")).toEqual({
      display: "Bram",
      role: "Research",
    });
  });

  it("returns null for an unobserved member", () => {
    const dir = new MemberDirectory();
    expect(dir.resolve("claudeteam-alpha", "never-seen")).toBeNull();
  });

  it("retains metadata after the member's tile disappears (append-only)", () => {
    const dir = new MemberDirectory();
    // Tick 1 — Bram visible.
    dir.observeState(
      makeStateWithTiles([
        makeTile({ memberId: "bram", display: "Bram", role: "Research" }),
      ]),
    );
    // Tick 2 — Bram gone from the tree (e.g. hidden by the host filter).
    dir.observeState(makeStateWithTiles([makeTile()]));
    // Directory still knows Bram — the reveal list can name him.
    expect(dir.resolve("claudeteam-alpha", "bram")).toEqual({
      display: "Bram",
      role: "Research",
    });
  });
});

// ===========================================================================
// render.ts integration — chip mount + directory observation
// ===========================================================================

describe("render.ts — hidden-members chip integration", () => {
  function makeStateWithHidden(
    keys: HiddenMemberKey[],
    tiles: AgentTile[] = [makeTile()],
  ): AgentTree {
    return {
      ...makeStateWithTiles(tiles),
      hiddenMemberKeys: keys,
      hiddenMemberCount: keys.length,
    } as AgentTree;
  }

  it("mounts the hidden-members chip when hiddenMemberKeys is non-empty", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateWithHidden(["claudeteam-alpha:bram"] as HiddenMemberKey[]),
    );
    expect(mount.querySelector(".ct-hidden-members-chip")).not.toBeNull();
  });

  it("does NOT mount the chip when no members are hidden", () => {
    const mount = document.createElement("div");
    renderFull({ mount, postMessage: vi.fn() }, makeStateWithTiles([makeTile()]));
    expect(mount.querySelector(".ct-hidden-members-chip")).toBeNull();
  });

  it("reveal list resolves names via the threaded MemberDirectory", () => {
    const mount = document.createElement("div");
    const memberDirectory = new MemberDirectory();
    // Tick 1 — Bram visible so the directory caches him.
    renderFull(
      { mount, postMessage: vi.fn(), memberDirectory },
      makeStateWithTiles([
        makeTile(),
        makeTile({ memberId: "bram", display: "Bram", role: "Research" }),
      ]),
    );
    // Tick 2 — Bram now hidden (absent from tree, present in hiddenMemberKeys).
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        memberDirectory,
        hiddenMembersExpanded: true,
      },
      makeStateWithHidden(["claudeteam-alpha:bram"] as HiddenMemberKey[], [
        makeTile(),
      ]),
    );
    const name = mount.querySelector(".ct-hidden-member-name");
    expect(name?.textContent).toBe("Bram (hidden)");
  });

  it("hide→reveal→unhide round-trip posts the right messages in order", () => {
    const posted: WebviewMessage[] = [];
    const postMessage = (m: WebviewMessage): void => {
      posted.push(m);
    };
    const memberDirectory = new MemberDirectory();
    const mount = document.createElement("div");

    // 1. Render with Bram visible → hide via the tile overflow.
    renderFull(
      { mount, postMessage, memberDirectory },
      makeStateWithTiles([
        makeTile({ memberId: "bram", display: "Bram", role: "Research" }),
      ]),
    );
    const bramTile = mount.querySelector<HTMLElement>(
      ".agent-tile[data-state]",
    )!;
    bramTile
      .querySelector<HTMLButtonElement>(".agent-tile-overflow-btn")!
      .click();
    bramTile
      .querySelector<HTMLButtonElement>(
        ".agent-tile-overflow-item[data-action='hide']",
      )!
      .click();
    expect(posted[0]).toEqual({
      type: "ui:hide-member",
      payload: { teamId: "claudeteam-alpha", memberId: "bram" },
    });

    // 2. Host re-emits with Bram hidden → reveal chip renders → unhide.
    renderFull(
      {
        mount,
        postMessage,
        memberDirectory,
        hiddenMembersExpanded: true,
      },
      makeStateWithHidden(["claudeteam-alpha:bram"] as HiddenMemberKey[], []),
    );
    mount
      .querySelector<HTMLButtonElement>(".ct-hidden-member-unhide")!
      .click();
    expect(posted[1]).toEqual({
      type: "ui:show-member",
      payload: { teamId: "claudeteam-alpha", memberId: "bram" },
    });
  });
});

// ---------------------------------------------------------------------------
// State coverage — overflow renders for every state literal
// ---------------------------------------------------------------------------

describe("agentTile overflow renders across every state", () => {
  for (const state of [
    "running",
    "idle",
    "finished",
    "error",
    "available",
  ] as AgentState[]) {
    it(`renders the hide affordance for state="${state}"`, () => {
      const el = renderAgentTile({
        tile: makeTile({ state }),
        sessionId: "sess-1",
        postMessage: vi.fn(),
      });
      expect(el.querySelector(".agent-tile-overflow-btn")).not.toBeNull();
    });
  }
});
