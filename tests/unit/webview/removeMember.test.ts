/**
 * @vitest-environment jsdom
 *
 * Unit + message-round-trip tests for the webview remove-agent surface
 * (E-07b / EPIC 86ca11187 §7.3):
 *
 *   - Per-tile overflow [⋯] carries a "Remove from roster…" entry, visually +
 *     interactionally DISTINCT from hide (confirm-step gated; --remove class).
 *   - Activating it opens an in-tile confirm panel (NOT a single-click action).
 *   - "Remove" posts `ui:remove-member { teamId, memberId }` (the PAIR, never
 *     the joined key); "Cancel" returns to the menu without posting.
 *   - The remove flow never fires the tile drill-in (ui:open-transcript).
 *   - render.ts: removed members are MASKED out of the "show hidden" reveal
 *     list (set-difference vs removedMemberKeys), so a removed-AND-hidden
 *     member never leaks into the recovery surface.
 *
 * Vocabulary is consumed VERBATIM from the E-07a host contract merged on main
 * (PR #119): `ui:remove-member` (pair payload), `removedMemberKeys:
 * RemovedMemberKey[]` on the wire. No message types redefined here.
 *
 * Source: src/webview/components/agentTile.ts (overflow + confirm)
 *         src/webview/render.ts (show-hidden mask)
 *         src/shared/messages.ts (RemoveMemberMessage — E-07a vocab)
 *         team/iris-ux/whole-team-display-spec.md §7.1, §7.3
 */

import { describe, it, expect, vi } from "vitest";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { renderFull } from "../../../src/webview/render.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import type {
  AgentTile,
  AgentState,
  AgentTree,
  HiddenMemberKey,
  RemovedMemberKey,
} from "../../../src/shared/types.js";

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

function openMenu(el: HTMLElement): void {
  el.querySelector<HTMLButtonElement>(".agent-tile-overflow-btn")!.click();
}

// ===========================================================================
// Remove affordance — distinct from hide, confirm-step gated (spec §7.3)
// ===========================================================================

describe("agentTile remove affordance — ui:remove-member (spec §7.3)", () => {
  it("menu carries a 'Remove from roster…' entry DISTINCT from Hide", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const remove = el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    );
    const hide = el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='hide']",
    );
    expect(remove).not.toBeNull();
    expect(hide).not.toBeNull();
    // Trailing ellipsis signals the confirm step.
    expect(remove!.textContent).toBe("Remove from roster…");
    // Distinct destructive-leaning class so it can't be mistaken for hide.
    expect(remove!.classList.contains("agent-tile-overflow-item--remove")).toBe(
      true,
    );
    expect(hide!.classList.contains("agent-tile-overflow-item--remove")).toBe(
      false,
    );
  });

  it("clicking 'Remove from roster…' opens a confirm panel — it does NOT post immediately", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    openMenu(el);
    const menu = el.querySelector<HTMLElement>(".agent-tile-overflow-menu")!;
    const confirm = el.querySelector<HTMLElement>(".agent-tile-remove-confirm")!;
    expect(confirm.hidden).toBe(true);

    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    )!.click();

    // Confirm panel is now shown, menu hidden, and NOTHING posted yet.
    expect(confirm.hidden).toBe(false);
    expect(menu.hidden).toBe(true);
    expect(posted).toHaveLength(0);
  });

  it("the confirm panel explains remove is yaml-gated + not-even-under-show-hidden", () => {
    const el = renderAgentTile({
      tile: makeTile({ display: "Bram" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    openMenu(el);
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    )!.click();

    const title = el.querySelector(".agent-tile-remove-confirm-title")!;
    const body = el.querySelector(".agent-tile-remove-confirm-body")!;
    expect(title.textContent).toBe("Remove Bram from the roster?");
    expect(body.textContent).toContain("show hidden");
    expect(body.textContent).toContain("teams.yaml");
  });

  it("confirm 'Remove' posts ui:remove-member with the (teamId, memberId) PAIR", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile({ teamId: "claudeteam-alpha", memberId: "felix" }),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    openMenu(el);
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    )!.click();
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-remove-confirm-remove",
    )!.click();

    expect(posted).toEqual([
      {
        type: "ui:remove-member",
        payload: { teamId: "claudeteam-alpha", memberId: "felix" },
      },
    ]);
  });

  it("'Cancel' returns to the menu and posts NOTHING (reversible step)", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    openMenu(el);
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    )!.click();
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-remove-confirm-cancel",
    )!.click();

    const menu = el.querySelector<HTMLElement>(".agent-tile-overflow-menu")!;
    const confirm = el.querySelector<HTMLElement>(".agent-tile-remove-confirm")!;
    expect(menu.hidden).toBe(false);
    expect(confirm.hidden).toBe(true);
    expect(posted).toHaveLength(0);
  });

  it("the remove flow never fires the tile drill-in (ui:open-transcript)", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    openMenu(el);
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    )!.click();
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-remove-confirm-remove",
    )!.click();
    expect(posted.every((m) => m.type !== "ui:open-transcript")).toBe(true);
  });

  it("Escape on the confirm panel closes everything (no post)", () => {
    const posted: WebviewMessage[] = [];
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: (m) => posted.push(m),
    });
    openMenu(el);
    el.querySelector<HTMLButtonElement>(
      ".agent-tile-overflow-item[data-action='remove']",
    )!.click();
    const confirmBtn = el.querySelector<HTMLButtonElement>(
      ".agent-tile-remove-confirm-remove",
    )!;
    confirmBtn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    const menu = el.querySelector<HTMLElement>(".agent-tile-overflow-menu")!;
    const confirm = el.querySelector<HTMLElement>(".agent-tile-remove-confirm")!;
    expect(menu.hidden).toBe(true);
    expect(confirm.hidden).toBe(true);
    expect(posted).toHaveLength(0);
  });
});

describe("agentTile remove affordance renders across every state", () => {
  for (const state of [
    "running",
    "idle",
    "finished",
    "error",
    "available",
  ] as AgentState[]) {
    it(`renders the remove affordance for state="${state}"`, () => {
      const el = renderAgentTile({
        tile: makeTile({ state }),
        sessionId: "sess-1",
        postMessage: vi.fn(),
      });
      expect(
        el.querySelector(".agent-tile-overflow-item[data-action='remove']"),
      ).not.toBeNull();
    });
  }
});

// ===========================================================================
// render.ts — removed members MASKED out of the show-hidden reveal (spec §7.3)
// ===========================================================================

describe("render.ts — removed members masked from show-hidden reveal", () => {
  function makeState(opts: {
    hidden?: HiddenMemberKey[];
    removed?: RemovedMemberKey[];
  }): AgentTree {
    return {
      ...makeStateWithTiles([makeTile()]),
      hiddenMemberKeys: opts.hidden ?? [],
      hiddenMemberCount: (opts.hidden ?? []).length,
      removedMemberKeys: opts.removed ?? [],
      removedMemberCount: (opts.removed ?? []).length,
    } as AgentTree;
  }

  it("a member in BOTH hidden and removed sets does NOT appear in the reveal list", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn(), hiddenMembersExpanded: true },
      makeState({
        hidden: ["claudeteam-alpha:bram"] as HiddenMemberKey[],
        removed: ["claudeteam-alpha:bram"] as RemovedMemberKey[],
      }),
    );
    // The only hidden key is also removed → the chip masks it → no chip at all.
    expect(mount.querySelector(".ct-hidden-members-chip")).toBeNull();
    expect(mount.querySelector(".ct-hidden-member-row")).toBeNull();
  });

  it("masks only the removed members — non-removed hidden members still reveal", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn(), hiddenMembersExpanded: true },
      makeState({
        hidden: [
          "claudeteam-alpha:bram",
          "claudeteam-alpha:nora",
        ] as HiddenMemberKey[],
        removed: ["claudeteam-alpha:bram"] as RemovedMemberKey[],
      }),
    );
    const chip = mount.querySelector<HTMLElement>(".ct-hidden-members-chip")!;
    // Only nora survives the mask.
    expect(chip.dataset.hiddenMemberCount).toBe("1");
    const rows = mount.querySelectorAll(".ct-hidden-member-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-member-id")).toBe("nora");
  });

  it("no removed set → reveal list unchanged (back-compat)", () => {
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn(), hiddenMembersExpanded: true },
      makeState({ hidden: ["claudeteam-alpha:bram"] as HiddenMemberKey[] }),
    );
    expect(mount.querySelector(".ct-hidden-members-chip")).not.toBeNull();
    expect(mount.querySelectorAll(".ct-hidden-member-row")).toHaveLength(1);
  });
});
