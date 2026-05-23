/**
 * @vitest-environment jsdom
 *
 * Component tests for the webview tile renderer.
 *
 * Coverage (per M2-05 AC10):
 *   - Each of the four AgentStates renders with the correct state-dot
 *     `data-state` attribute and class.
 *   - The display, role, activity, and model text appear in the DOM.
 *   - Clicking a tile dispatches the `ui:open-transcript` message with the
 *     correct sessionId + agentId payload.
 *   - Keyboard activation (Enter, Space) fires the same handler.
 *   - The background chip toggles expanded/collapsed on header click.
 *   - The empty-state renderer emits the literal "No live Claude Code
 *     sessions." string.
 *   - The error chip renders with the correct level class.
 *
 * Uses jsdom (devDep) — no @testing-library/* dependency needed for these
 * structural assertions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentTile } from "../../../src/shared/types.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { renderBackgroundChip } from "../../../src/webview/components/backgroundChip.js";
import { renderEmptyState } from "../../../src/webview/components/emptyState.js";
import { renderErrorChip } from "../../../src/webview/components/errorChip.js";
import { renderFull } from "../../../src/webview/render.js";
import {
  FIXTURE_EMPTY_STATE,
  FIXTURE_STATE,
} from "../../../src/shared/fixtures.js";

// ---------------------------------------------------------------------------
// Helpers
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
    agentId: "a1d53b4a2db17f2f5",
    toolUseId: "toolu_TEST",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Agent tile — state coverage (AC10)
// ---------------------------------------------------------------------------

describe("renderAgentTile — state coverage", () => {
  for (const state of ["running", "idle", "finished", "error"] as const) {
    it(`renders state="${state}" with the correct state-dot attribute`, () => {
      const tile = makeTile({ state });
      const el = renderAgentTile({
        tile,
        sessionId: "sess-1",
        postMessage: vi.fn(),
      });

      const dot = el.querySelector(".state-dot");
      expect(dot).not.toBeNull();
      expect(dot?.getAttribute("data-state")).toBe(state);

      // The tile's article also carries data-state for CSS scoping.
      expect(el.getAttribute("data-state")).toBe(state);
    });
  }

  it("includes the display, role, activity, and model text", () => {
    const tile = makeTile({
      display: "Maya",
      role: "Webview UI Dev",
      activity: "idle 14s",
      model: "claude-opus-4-7",
    });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });

    expect(el.querySelector(".agent-display")?.textContent).toBe("Maya");
    expect(el.querySelector(".agent-role")?.textContent).toBe("Webview UI Dev");
    expect(el.querySelector(".agent-activity")?.textContent).toBe("idle 14s");
    expect(el.querySelector(".agent-model")?.textContent).toBe(
      "claude-opus-4-7",
    );
  });

  it("sets role=button + tabindex=0 for keyboard navigability", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("tabindex")).toBe("0");
  });

  it("sets an aria-label combining display, role, and state", () => {
    const el = renderAgentTile({
      tile: makeTile({ display: "Felix", role: "Extension Host Dev", state: "error" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.getAttribute("aria-label")).toBe(
      "Felix — Extension Host Dev — Error",
    );
  });
});

// ---------------------------------------------------------------------------
// Agent tile — click + keyboard dispatch (AC6)
// ---------------------------------------------------------------------------

describe("renderAgentTile — interaction", () => {
  it("dispatches ui:open-transcript on click with sessionId + agentId", () => {
    const post = vi.fn<[WebviewMessage], void>();
    const el = renderAgentTile({
      tile: makeTile({ agentId: "agent-XYZ" }),
      sessionId: "sess-ABC",
      postMessage: post,
    });

    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      type: "ui:open-transcript",
      payload: { sessionId: "sess-ABC", agentId: "agent-XYZ" },
    });
  });

  it("dispatches the same message on Enter and Space keydown", () => {
    const post = vi.fn<[WebviewMessage], void>();
    const el = renderAgentTile({
      tile: makeTile({ agentId: "agent-KB" }),
      sessionId: "sess-KB",
      postMessage: post,
    });

    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));

    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) {
      expect(call[0]).toEqual({
        type: "ui:open-transcript",
        payload: { sessionId: "sess-KB", agentId: "agent-KB" },
      });
    }
  });

  it("does not dispatch on unrelated keydown events", () => {
    const post = vi.fn();
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-X",
      postMessage: post,
    });
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Background chip — toggle behavior (AC5)
// ---------------------------------------------------------------------------

describe("renderBackgroundChip", () => {
  it("renders count line and detail list collapsed by default", () => {
    const chip = renderBackgroundChip({
      sessionId: "sess-1",
      agents: [
        {
          agentType: "general-purpose",
          description: "Agent A — data sources",
          state: "running",
          model: "claude-sonnet-4-5",
        },
      ],
    });
    expect(chip.querySelector(".chip-count")?.textContent).toBe(
      "+ 1 background agents",
    );
    expect(chip.dataset.expanded).toBe("false");
    expect(
      chip.querySelector<HTMLUListElement>(".chip-detail-list")?.hidden,
    ).toBe(true);
    expect(
      chip.querySelector(".chip-header")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("toggles expanded state on header click and flips the chevron", () => {
    const chip = renderBackgroundChip({
      sessionId: "sess-1",
      agents: [
        {
          agentType: "Explore",
          description: "Map MARIAN-TUTOR orchestration",
          state: "running",
          model: "claude-sonnet-4-5",
        },
      ],
    });
    const header = chip.querySelector<HTMLButtonElement>(".chip-header");
    const list = chip.querySelector<HTMLUListElement>(".chip-detail-list");
    const chevron = chip.querySelector(".chip-chevron");
    expect(header).not.toBeNull();
    expect(list).not.toBeNull();

    header!.click();
    expect(chip.dataset.expanded).toBe("true");
    expect(list!.hidden).toBe(false);
    expect(header!.getAttribute("aria-expanded")).toBe("true");
    expect(chevron?.textContent).toBe("▼");

    header!.click();
    expect(chip.dataset.expanded).toBe("false");
    expect(list!.hidden).toBe(true);
    expect(header!.getAttribute("aria-expanded")).toBe("false");
    expect(chevron?.textContent).toBe("▶");
  });

  it("renders one li per background agent with type, description, state, model", () => {
    const chip = renderBackgroundChip({
      sessionId: "sess-1",
      agents: [
        {
          agentType: "general-purpose",
          description: "Agent A",
          state: "running",
          model: "claude-sonnet-4-5",
        },
        {
          agentType: "Explore",
          description: "Agent B",
          state: "finished",
          model: "claude-sonnet-4-5",
        },
      ],
    });
    const rows = chip.querySelectorAll(".bg-agent-row");
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector(".bg-agent-type")?.textContent).toBe(
      "general-purpose",
    );
    expect(rows[0].querySelector(".bg-agent-state")?.textContent).toBe(
      "running",
    );
    expect(rows[1].querySelector(".bg-agent-state")?.textContent).toBe(
      "finished",
    );
  });
});

// ---------------------------------------------------------------------------
// Empty state (§3.2)
// ---------------------------------------------------------------------------

describe("renderEmptyState", () => {
  it("emits the canonical 'No live Claude Code sessions.' string", () => {
    const el = renderEmptyState();
    expect(el.textContent).toBe("No live Claude Code sessions.");
    expect(el.className).toBe("empty-state");
  });
});

// ---------------------------------------------------------------------------
// Error chip (§8)
// ---------------------------------------------------------------------------

describe("renderErrorChip", () => {
  it("renders an error-level chip with title and detail", () => {
    const post = vi.fn();
    const el = renderErrorChip({
      level: "error",
      title: "Roster error",
      detail: "YAML parse failed at line 4",
      showOpenRosterButton: true,
      postMessage: post,
    });
    expect(el.classList.contains("error-chip--error")).toBe(true);
    expect(el.querySelector(".error-chip-title")?.textContent).toBe(
      "Roster error",
    );
    expect(el.querySelector(".error-chip-detail")?.textContent).toBe(
      "YAML parse failed at line 4",
    );
    expect(el.getAttribute("role")).toBe("alert");
  });

  it("Open Roster File button dispatches ui:open-roster", () => {
    const post = vi.fn<[WebviewMessage], void>();
    const el = renderErrorChip({
      level: "error",
      title: "Roster error",
      detail: "any",
      showOpenRosterButton: true,
      postMessage: post,
    });
    el
      .querySelector<HTMLButtonElement>(".error-chip-action")!
      .click();
    expect(post).toHaveBeenCalledWith({ type: "ui:open-roster" });
  });

  it("warning-level chip includes a dismiss button that removes the chip", () => {
    const el = renderErrorChip({
      level: "warning",
      title: "Roster warning",
      detail: "Member with no match rules — skipped",
    });
    const host = document.createElement("div");
    host.appendChild(el);
    expect(host.contains(el)).toBe(true);

    el.querySelector<HTMLButtonElement>(".error-chip-dismiss")!.click();
    expect(host.contains(el)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderFull — orchestration (AC3, AC7)
// ---------------------------------------------------------------------------

describe("renderFull", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    mount = document.createElement("div");
    mount.id = "root";
    document.body.appendChild(mount);
  });

  it("renders empty-state string when sessions array is empty", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    expect(mount.querySelector(".empty-state")?.textContent).toBe(
      "No live Claude Code sessions.",
    );
  });

  it("renders one session block per session in the fixture state", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const blocks = mount.querySelectorAll(".session-block");
    expect(blocks.length).toBe(FIXTURE_STATE.sessions.length);
  });

  it("renders one tile per AgentTile in the primary session", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const tiles = mount.querySelectorAll(".agent-tile");
    // Fixture primary session has 6 rostered tiles; dead session has 0.
    expect(tiles.length).toBe(6);
  });

  it("renders the background chip when background.length > 0", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const chips = mount.querySelectorAll(".background-chip");
    expect(chips.length).toBe(1); // primary session only; dead has no chip
  });

  it("dead session block carries the session-block--dead class and no tiles", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const deadBlock = mount.querySelector(".session-block--dead");
    expect(deadBlock).not.toBeNull();
    expect(deadBlock?.querySelectorAll(".agent-tile").length).toBe(0);
    expect(deadBlock?.querySelector(".session-dead-badge")?.textContent).toBe(
      "dead",
    );
  });

  it("clears previous render on subsequent calls (re-render discipline)", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const tilesBefore = mount.querySelectorAll(".agent-tile").length;
    expect(tilesBefore).toBeGreaterThan(0);

    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    expect(mount.querySelectorAll(".agent-tile").length).toBe(0);
    expect(mount.querySelector(".empty-state")).not.toBeNull();
  });

  it("renders an error chip at the top of the mount when error is set", () => {
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        error: {
          level: "error",
          title: "Roster error",
          detail: "YAML invalid",
          showOpenRosterButton: true,
        },
      },
      FIXTURE_STATE,
    );
    const chips = mount.querySelectorAll(".error-chip");
    expect(chips.length).toBe(1);
    // Error chip is the first child of the mount per spec §8.
    expect(mount.firstElementChild?.classList.contains("error-chip")).toBe(
      true,
    );
  });
});
