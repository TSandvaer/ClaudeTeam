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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

// ===========================================================================
// 86ca1d76j REGRESSION — default-collapsed state on INITIAL render
//
// Bug class (sponsor GUI test 2026-05-29): every tile's confirm panel rendered
// OPEN on initial load — Cancel/Remove visible without any click. Root cause:
// the `.agent-tile-remove-confirm` / `.agent-tile-overflow-menu` CSS rules set
// `display: flex` (an author-stylesheet rule) which OVERRIDES the UA
// `[hidden] { display: none }` default, so `confirm.hidden = true` in the DOM
// had no visual effect. The pre-existing tests only checked POST-click
// behavior + the `.hidden` *property* (always true in the DOM) — neither
// catches an author-CSS rule that defeats the attribute. These two assertion
// styles together catch the CLASS:
//   (1) JS-level: at INITIAL render (no click), the affordance is present but
//       the menu + confirm are `hidden` — guards against a future JS default
//       regression.
//   (2) CSS-level: dashboard.css carries an explicit `[hidden] { display:none }`
//       guard for EVERY flex/grid-display popover affordance — guards against
//       the actual shipped bug (a flex container without the guard).
// ===========================================================================

describe("86ca1d76j — confirm panel + menu are COLLAPSED on initial render", () => {
  it("initial render shows the Remove affordance but NOT the confirm panel", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    // The Remove affordance (kebab + menu entry) is present in the DOM…
    expect(
      el.querySelector(".agent-tile-overflow-btn"),
    ).not.toBeNull();
    expect(
      el.querySelector(".agent-tile-overflow-item[data-action='remove']"),
    ).not.toBeNull();
    // …but BOTH popovers are hidden — nothing is opened without a click.
    const menu = el.querySelector<HTMLElement>(".agent-tile-overflow-menu")!;
    const confirm = el.querySelector<HTMLElement>(".agent-tile-remove-confirm")!;
    expect(menu.hidden).toBe(true);
    expect(confirm.hidden).toBe(true);
  });

  it("dashboard.css guards every flex popover affordance with a [hidden] override", () => {
    // Read the actual stylesheet that ships in the bundle. jsdom does not apply
    // author CSS, so the only way to assert the fix at unit level is to verify
    // the source rule exists. The bug was the ABSENCE of these two guards.
    const here = dirname(fileURLToPath(import.meta.url));
    const cssPath = join(
      here,
      "..",
      "..",
      "..",
      "src",
      "webview",
      "styles",
      "dashboard.css",
    );
    const css = readFileSync(cssPath, "utf8");

    // Strip comments + collapse whitespace so the assertions are formatting-
    // tolerant (a reformat of the rule body shouldn't break the test).
    const normalized = css
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ");

    // Every popover that uses `display: flex|grid|block` to lay out its content
    // MUST pair with a `[hidden] { display: none }` override, or the `hidden`
    // attribute is silently defeated (the shipped bug).
    for (const sel of [
      ".agent-tile-remove-confirm",
      ".agent-tile-overflow-menu",
    ]) {
      const guard = new RegExp(
        `\\${sel}\\[hidden\\]\\s*\\{\\s*display:\\s*none`,
      );
      expect(
        guard.test(normalized),
        `${sel}[hidden] { display: none } guard missing in dashboard.css`,
      ).toBe(true);
    }
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
// 86ca1d76j AC4 — `model:?` sentinel renders no model row (clean placeholder)
//
// Available / never-run members (Iris/Nora/Bram in the sponsor screenshot)
// carry `model: "model:?"` from the reducer baseline. The raw `model:?` reads
// as noise on the tile; hide the row entirely (same treatment as the `tool:?`
// activity sentinel). Finished members carry a real model and render unchanged.
// ===========================================================================

describe("86ca1d76j AC4 — model row omitted for the model:? sentinel", () => {
  it("omits the model row when tile.model is the 'model:?' sentinel", () => {
    const el = renderAgentTile({
      tile: makeTile({ state: "available", model: "model:?" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.querySelector(".tile-row--model")).toBeNull();
    expect(el.querySelector(".agent-model")).toBeNull();
    // No `?` placeholder leaks anywhere in the tile text.
    expect(el.textContent).not.toContain("model:?");
  });

  it("renders the model row normally for a resolved model (finished member)", () => {
    const el = renderAgentTile({
      tile: makeTile({ state: "finished", model: "claude-opus-4-8" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const modelSpan = el.querySelector<HTMLElement>(".agent-model");
    expect(modelSpan).not.toBeNull();
    expect(modelSpan!.textContent).toBe("claude-opus-4-8");
  });
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
