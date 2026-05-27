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
import type {
  AgentState,
  AgentTile,
  AgentTree,
} from "../../../src/shared/types.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { renderBackgroundChip } from "../../../src/webview/components/backgroundChip.js";
import { renderEmptyState } from "../../../src/webview/components/emptyState.js";
import { renderErrorChip } from "../../../src/webview/components/errorChip.js";
import { renderFull } from "../../../src/webview/render.js";
import { createPrevStateTracker } from "../../../src/webview/prevStateTracker.js";
import {
  FIXTURE_EMPTY_STATE,
  FIXTURE_STATE,
} from "../../../src/shared/fixtures.js";

// Em-dash (U+2014) — vocabulary contract per spec 86c9zmyef §7.3.
const EM_DASH = "—";

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

  // M4-03 AC3 — drill-in affordance tooltip. Wording locked in M4-01 §3.3.
  it("sets title=\"Open agent transcript\" for drill-in affordance (M4-03 AC3)", () => {
    const el = renderAgentTile({
      tile: makeTile(),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.getAttribute("title")).toBe("Open agent transcript");
  });
});

// ---------------------------------------------------------------------------
// Agent tile — member-color paint (86c9zqa75 / spec 86c9zmyef §2)
// ---------------------------------------------------------------------------

describe("renderAgentTile — member-color paint", () => {
  it("sets inline --ct-color-running-dot when tile is running AND memberColor is defined", () => {
    const el = renderAgentTile({
      tile: makeTile({ state: "running", memberColor: "#5d8aa8" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    // jsdom returns inline style values verbatim. The CSS rule (in
    // dashboard.css) reads this var() with a fallback to
    // --ct-color-state-running — verified visually in the manual reload.
    expect((el as HTMLElement).style.getPropertyValue("--ct-color-running-dot")).toBe(
      "#5d8aa8",
    );
  });

  it("does NOT set the override when memberColor is undefined (back-compat)", () => {
    const el = renderAgentTile({
      tile: makeTile({ state: "running" }),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect((el as HTMLElement).style.getPropertyValue("--ct-color-running-dot")).toBe("");
  });

  for (const state of ["idle", "finished", "error"] as const) {
    it(`does NOT set the override when state="${state}" even if memberColor is defined (spec §1.3)`, () => {
      const el = renderAgentTile({
        tile: makeTile({ state, memberColor: "#5d8aa8" }),
        sessionId: "sess-1",
        postMessage: vi.fn(),
      });
      // Idle / finished / error retain the M4-01 semantic state colors —
      // the running-dot override must not paint on non-running tiles.
      expect(
        (el as HTMLElement).style.getPropertyValue("--ct-color-running-dot"),
      ).toBe("");
    });
  }
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

  // M3-09 NIT — gap (1) from Sage's PR-#39 review: filtered-empty variant
  // had no direct coverage. The generic variant is tested above; this is
  // the M3-04 AC4 split branch.
  it("filtered=true → renders the filtered-empty variant (M3-04 AC4)", () => {
    const el = renderEmptyState({ filtered: true });
    // CSS scoping marker so the renderer can style the filtered variant
    // distinctly (`.empty-state--filtered` modifier per BEM-ish convention).
    expect(el.classList.contains("empty-state")).toBe(true);
    expect(el.classList.contains("empty-state--filtered")).toBe(true);

    // Headline text — sponsor's workspace-specific phrasing.
    const headline = el.querySelector(".empty-state-headline");
    expect(headline?.textContent).toBe(
      "No Claude Code sessions for this workspace.",
    );

    // Guidance line mentions BOTH the `claude` command and the
    // showAllSessionsGlobally setting — both must appear so the user can
    // either run a session here OR flip the global switch.
    const guidance = el.querySelector(".empty-state-guidance");
    expect(guidance?.textContent).toContain("Run ");
    expect(guidance?.textContent).toContain(" in this folder, or enable ");
    expect(guidance?.textContent).toContain(
      "to see sessions from other workspaces.",
    );

    // Both code spans should be rendered with the monospace class so the
    // user sees the literal command + setting name visually distinct from
    // surrounding prose.
    const codeSpans = el.querySelectorAll(".empty-state-code");
    expect(codeSpans.length).toBe(2);
    expect(codeSpans[0]!.textContent).toBe("claude");
    expect(codeSpans[1]!.textContent).toBe(
      "claudeteam.showAllSessionsGlobally",
    );
  });

  it("filtered=false → generic variant (back-compat: explicit false same as omitted)", () => {
    const el = renderEmptyState({ filtered: false });
    expect(el.textContent).toBe("No live Claude Code sessions.");
    expect(el.className).toBe("empty-state");
    expect(el.classList.contains("empty-state--filtered")).toBe(false);
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

  // -------------------------------------------------------------------------
  // M3-09 NIT — gap (3) from Sage's PR-#39 review: renderFull's empty-with-
  // filter branch + chip-above-empty layering invariant had no direct
  // coverage. These tests pin the M3-04 AC4 + M3-04 AC1 layering contract.
  // -------------------------------------------------------------------------

  it("empty sessions + filterApplied=true → renders the FILTERED empty variant", () => {
    // Build a synthetic state matching the M3-03 filtered-to-empty case
    // (window-scoped filter ate every session for this workspace). The
    // renderer must pick the filtered variant, not the generic one.
    renderFull(
      { mount, postMessage: vi.fn() },
      { sessions: [], filterApplied: true },
    );
    const emptyState = mount.querySelector(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(emptyState!.classList.contains("empty-state--filtered")).toBe(
      true,
    );
    // Sanity: the headline text proves the M3-04 AC4 branch fired (the
    // generic variant has neither a headline nor a guidance line).
    expect(
      emptyState!.querySelector(".empty-state-headline")?.textContent,
    ).toBe("No Claude Code sessions for this workspace.");
  });

  it("empty sessions + filterApplied=false → renders the GENERIC empty variant", () => {
    // Negative-path pair for the above — explicit false should NOT pick
    // the filtered variant. A regression that treated the `state.filterApplied
    // === true` predicate as truthy would still pass the filtered test but
    // would fail this one (because filterApplied=false would be coerced
    // to true under loose truthiness).
    renderFull(
      { mount, postMessage: vi.fn() },
      { sessions: [], filterApplied: false },
    );
    const emptyState = mount.querySelector(".empty-state");
    expect(emptyState).not.toBeNull();
    expect(emptyState!.classList.contains("empty-state--filtered")).toBe(
      false,
    );
    expect(emptyState!.textContent).toBe("No live Claude Code sessions.");
  });

  it("rosterErrors non-empty + empty sessions + filterApplied → chip renders ABOVE empty-state", () => {
    // M3-04 layering invariant (render.ts header comment): the roster-error
    // chip is rendered FIRST (above any other content), then the empty
    // state. This catches the regression where a future refactor renders
    // the empty state first and pushes the chip below the fold.
    //
    // The bug class is "chip becomes invisible when the dashboard is
    // empty" — a real risk because the empty-state container often gets
    // styled to fill the viewport, which could hide a chip rendered
    // beneath it.
    renderFull(
      { mount, postMessage: vi.fn() },
      {
        sessions: [],
        filterApplied: true,
        rosterErrors: ["global roster YAML parse error: bad indent at line 3"],
      },
    );

    // The chip must be in the DOM at all.
    const chip = mount.querySelector(".roster-error-chip");
    expect(chip).not.toBeNull();

    // The chip must precede the empty-state in document order (chip is
    // mount's FIRST child, empty-state is SECOND or later).
    const emptyState = mount.querySelector(".empty-state");
    expect(emptyState).not.toBeNull();

    // Use the DOM's compareDocumentPosition to assert chip is BEFORE
    // emptyState. Node.DOCUMENT_POSITION_FOLLOWING (4) on chip's compare
    // result means emptyState follows chip in the tree — exactly what we
    // want.
    const positionMask = chip!.compareDocumentPosition(emptyState!);
    expect(positionMask & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);

    // Also assert the chip is the FIRST mount child specifically — render.ts
    // documents this layering invariant and downstream CSS may depend on
    // it (e.g. top-margin compensation).
    expect(mount.firstElementChild).toBe(chip);

    // And the empty-state should still be the FILTERED variant — the chip
    // doesn't change the filter context.
    expect(emptyState!.classList.contains("empty-state--filtered")).toBe(
      true,
    );
  });

  it("rosterErrors non-empty + populated sessions → chip renders ABOVE session blocks", () => {
    // Parallel invariant for the non-empty case — chip stays at the top
    // regardless of session count. Defends against the bug class where
    // the chip is inserted AFTER the session blocks in the populated
    // path (the empty-path render and the populated-path render are
    // separate code branches in render.ts).
    renderFull(
      { mount, postMessage: vi.fn() },
      {
        ...FIXTURE_STATE,
        rosterErrors: ["YAML parse error: unexpected key 'teemz' at line 1"],
      },
    );

    const chip = mount.querySelector(".roster-error-chip");
    expect(chip).not.toBeNull();
    expect(mount.firstElementChild).toBe(chip);

    // Sanity: session blocks still rendered alongside the chip.
    const sessionBlocks = mount.querySelectorAll(".session-block");
    expect(sessionBlocks.length).toBe(FIXTURE_STATE.sessions.length);

    // And every session block must follow the chip in document order.
    // `Array.from` because the tsconfig's ES2022 lib target gives NodeListOf
    // a `forEach` but not a `[Symbol.iterator]` reachable from `for…of`
    // under strict mode without a downlevel-iteration flag.
    Array.from(sessionBlocks).forEach((block) => {
      const mask = chip!.compareDocumentPosition(block);
      expect(mask & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Agent tile — finished-status freshness suffix (M3-04 NIT #3, ClickUp 86c9ybtut)
//
// The host emits tile.activity === "finished" for finished tiles (no
// timestamp). The webview observes the first tick a tile is seen in
// `finished` state and renders "finished Xs / Xm / Xh" parallel to the
// `idle Xs` convention. Tests verify both the direct renderAgentTile API
// (with explicit finishedAtMs + nowMs injection) and the integration path
// from render.ts → sessionBlock → teamCard → agentTile via the tracker.
// ---------------------------------------------------------------------------

describe("renderAgentTile — finished freshness suffix", () => {
  it("appends Xs suffix when finishedAtMs is supplied (5s ago)", () => {
    const tile = makeTile({ state: "finished", activity: "finished" });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      finishedAtMs: 1_000_000,
      nowMs: 1_005_000, // 5 seconds later
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe(
      "finished 5s",
    );
  });

  it("appends Xm suffix at minute scale (2m ago)", () => {
    const tile = makeTile({ state: "finished", activity: "finished" });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      finishedAtMs: 1_000_000,
      nowMs: 1_000_000 + 2 * 60_000,
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe(
      "finished 2m",
    );
  });

  it("appends Xh suffix at hour scale (4h ago)", () => {
    const tile = makeTile({ state: "finished", activity: "finished" });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      finishedAtMs: 1_000_000,
      nowMs: 1_000_000 + 4 * 60 * 60_000,
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe(
      "finished 4h",
    );
  });

  it("renders bare activity text when finishedAtMs is omitted (back-compat)", () => {
    // Pre-NIT#3 callers and component tests without the tracker should see
    // the unchanged "finished" string — no NaN, no "undefined", no suffix.
    const tile = makeTile({ state: "finished", activity: "finished" });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe("finished");
  });

  it("does NOT append a freshness suffix to non-finished states", () => {
    // finishedAtMs is only meaningful for finished tiles. An idle/running/
    // error tile must render its activity verbatim even if finishedAtMs is
    // accidentally supplied (defensive: the renderer guards on tile.state).
    const tile = makeTile({ state: "idle", activity: "idle 14s" });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      finishedAtMs: 1_000_000,
      nowMs: 1_005_000,
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe("idle 14s");
  });
});

// ---------------------------------------------------------------------------
// Agent tile — Obs 11 (ClickUp 86c9zfmhp) humanized finished elapsed-time
//
// Pre-Obs-11 V1 dogfood showed `finished 19289s 3s` on the finished tile —
// host's raw seconds since `tool_result.timestamp` (~5.4h ago, unreadable) +
// webview's parallel `formatFreshness(now - first-seen)` from a separate
// clock that resets on webview reload. The fix moves humanization to the
// host (single source of truth) and the webview renders verbatim while
// adding a precise-ISO tooltip on the `.agent-activity` span.
// ---------------------------------------------------------------------------

describe("renderAgentTile — Obs 11 humanized finished + ISO tooltip", () => {
  it("renders host-emitted humanized activity verbatim (no double-clock)", () => {
    // Host now emits "finished 5h" directly (humanized via formatFreshness in
    // buildActivity). The webview must NOT append a second clock from the
    // `finishedAtMs`/tracker path — the V1-dogfood bug shape.
    const tile = makeTile({
      state: "finished",
      activity: "finished 5h",
      finishedAtMs: 1_000_000,
    });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      // Tracker-sourced fallback timestamp (should NOT trigger suffix when
      // tile.activity is already humanized).
      finishedAtMs: 999_000,
      nowMs: 1_000_000 + 60_000,
    });
    // The exact V1-dogfood bug shape was "finished 19289s 3s" — two clocks
    // appended. With the Obs 11 fix the rendered text matches host verbatim.
    expect(el.querySelector(".agent-activity")?.textContent).toBe(
      "finished 5h",
    );
  });

  it("attaches precise-ISO tooltip to the activity span when finishedAtMs is on tile", () => {
    const tile = makeTile({
      state: "finished",
      activity: "finished 5h",
      finishedAtMs: 1_700_000_000_000, // 2023-11-14T22:13:20Z (known ISO).
    });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const span = el.querySelector(".agent-activity");
    expect(span?.getAttribute("title")).toBe(
      `Finished at ${new Date(1_700_000_000_000).toISOString()}`,
    );
  });

  it("omits the activity tooltip when finishedAtMs is absent on tile", () => {
    // Diagnostic case — host's parser couldn't parse the timestamp; rather
    // than rendering a misleading "Finished at 1970-01-01T00:00:00Z" tooltip
    // we just leave the title attribute off.
    const tile = makeTile({ state: "finished", activity: "finished" });
    // Explicitly remove finishedAtMs (makeTile default doesn't set it but be
    // safe in case the helper changes).
    delete tile.finishedAtMs;
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const span = el.querySelector(".agent-activity");
    expect(span?.hasAttribute("title")).toBe(false);
  });

  it("omits the activity tooltip on non-finished states even when finishedAtMs is set", () => {
    // Defensive: tooltip is gated on tile.state === "finished", not just on
    // the presence of `tile.finishedAtMs`. A stale `finishedAtMs` on an
    // idle/running tile must not surface a confusing tooltip.
    const tile = makeTile({
      state: "running",
      activity: "tool:Bash",
      finishedAtMs: 1_700_000_000_000,
    });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    const span = el.querySelector(".agent-activity");
    expect(span?.hasAttribute("title")).toBe(false);
  });

  it("back-compat: bare 'finished' from host + tracker-supplied finishedAtMs prop still appends suffix", () => {
    // The tracker fallback fires only when the HOST emits bare "finished"
    // (no humanized suffix already on the string). This preserves the
    // M3-04-era behavior for fixtures / tests where the reducer didn't pass
    // through a finishedAtMs.
    const tile = makeTile({ state: "finished", activity: "finished" });
    const el = renderAgentTile({
      tile,
      sessionId: "sess-1",
      postMessage: vi.fn(),
      finishedAtMs: 1_000_000,
      nowMs: 1_000_000 + 5_000,
    });
    expect(el.querySelector(".agent-activity")?.textContent).toBe(
      "finished 5s",
    );
  });
});

describe("renderFull — finished freshness via finishedTracker (integration)", () => {
  // Build a minimal AgentTree with one finished tile so we can verify the
  // end-to-end thread render → sessionBlock → teamCard → agentTile picks up
  // the freshness suffix from the tracker.
  function makeStateWithFinishedTile(): AgentTree {
    return {
      sessions: [
        {
          shortId: "sess0001",
          sessionId: "sess-FINISHED",
          pid: 1234,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\test",
          title: "Test session",
          rosterTiles: new Map([
            [
              "claudeteam-alpha",
              [
                makeTile({
                  state: "finished",
                  activity: "finished",
                  agentId: "agent-FINISHED",
                }),
              ],
            ],
          ]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };
  }

  it("renders \"finished Xs\" via the tracker on first render", async () => {
    const { createFinishedTracker } = await import(
      "../../../src/webview/finishedTracker.js"
    );
    const tracker = createFinishedTracker();
    const mount = document.createElement("div");
    const t0 = 5_000_000;
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        finishedTracker: tracker,
        nowMs: t0,
      },
      makeStateWithFinishedTile(),
    );
    // First render — tracker records t0; elapsed = 0 → "0s".
    expect(mount.querySelector(".agent-activity")?.textContent).toBe(
      "finished 0s",
    );
    expect(tracker.size()).toBe(1);
  });

  it("anchors the elapsed value to the FIRST observation across re-renders", async () => {
    const { createFinishedTracker } = await import(
      "../../../src/webview/finishedTracker.js"
    );
    const tracker = createFinishedTracker();
    const mount = document.createElement("div");
    const t0 = 5_000_000;
    const state = makeStateWithFinishedTile();
    // First render at t0 — observe.
    renderFull(
      { mount, postMessage: vi.fn(), finishedTracker: tracker, nowMs: t0 },
      state,
    );
    // Second render 30 seconds later — same tile, same agentId; suffix
    // should now be "30s", not "0s". Tracker did NOT re-anchor.
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        finishedTracker: tracker,
        nowMs: t0 + 30_000,
      },
      state,
    );
    expect(mount.querySelector(".agent-activity")?.textContent).toBe(
      "finished 30s",
    );
    // Tracker stayed at 1 entry — no leak from re-rendering the same tile.
    expect(tracker.size()).toBe(1);
  });

  it("prunes tracker entries when the tile transitions out of finished state", async () => {
    const { createFinishedTracker } = await import(
      "../../../src/webview/finishedTracker.js"
    );
    const tracker = createFinishedTracker();
    const mount = document.createElement("div");
    const t0 = 5_000_000;
    // First render: finished tile present.
    renderFull(
      { mount, postMessage: vi.fn(), finishedTracker: tracker, nowMs: t0 },
      makeStateWithFinishedTile(),
    );
    expect(tracker.size()).toBe(1);

    // Second render: same tile is now running. Prune should drop the entry.
    const runningState = makeStateWithFinishedTile();
    runningState.sessions[0]!.rosterTiles.set("claudeteam-alpha", [
      makeTile({
        state: "running",
        activity: "tool:Edit foo.ts",
        agentId: "agent-FINISHED",
      }),
    ]);
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        finishedTracker: tracker,
        nowMs: t0 + 1_000,
      },
      runningState,
    );
    expect(tracker.size()).toBe(0);
    // Activity now reflects the running state — no stale "finished" suffix.
    expect(mount.querySelector(".agent-activity")?.textContent).toBe(
      "tool:Edit foo.ts",
    );
  });

  it("prunes entries for tiles that vanish entirely between renders", async () => {
    const { createFinishedTracker } = await import(
      "../../../src/webview/finishedTracker.js"
    );
    const tracker = createFinishedTracker();
    const mount = document.createElement("div");
    const t0 = 5_000_000;
    renderFull(
      { mount, postMessage: vi.fn(), finishedTracker: tracker, nowMs: t0 },
      makeStateWithFinishedTile(),
    );
    expect(tracker.size()).toBe(1);

    // Empty state — the session disappeared (e.g. claude exited).
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        finishedTracker: tracker,
        nowMs: t0 + 5_000,
      },
      { sessions: [] },
    );
    expect(tracker.size()).toBe(0);
  });

  it("renders bare \"finished\" when no tracker is provided (back-compat)", () => {
    // Component tests that don't wire a tracker should see the unchanged
    // "finished" string. Confirms RenderContext.finishedTracker is optional.
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateWithFinishedTile(),
    );
    expect(mount.querySelector(".agent-activity")?.textContent).toBe(
      "finished",
    );
  });
});

// ---------------------------------------------------------------------------
// Agent tile — M4-05 state visuals + state-transition attribute
// (per team/iris-ux/m4-polish-spec.md §2 / M4-05 backlog AC1, AC2, AC4, AC6)
// ---------------------------------------------------------------------------

describe("renderAgentTile — M4-05 state-transition data attribute (AC2, AC6)", () => {
  function makeTransitionTile(state: AgentState): AgentTile {
    return {
      memberId: "felix",
      teamId: "claudeteam-alpha",
      display: "Felix",
      role: "Extension Host Dev",
      activity: state === "finished" ? "finished" : `tool:Edit foo.ts`,
      model: "claude-opus-4-7",
      state,
      agentId: "agent-T",
      toolUseId: "toolu_T",
    };
  }

  it("first render (prevState undefined) does NOT set data-transition", () => {
    // M4-01 §2.5 rule 3 — first appearance is not a transition.
    const el = renderAgentTile({
      tile: makeTransitionTile("running"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
    });
    expect(el.dataset.transition).toBeUndefined();
  });

  it("same-state re-render does NOT set data-transition", () => {
    // Re-render with identical state should not flash a transition; the
    // tile only telegraphs change at the boundary, not on every render
    // tick.
    const el = renderAgentTile({
      tile: makeTransitionTile("idle"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "idle",
    });
    expect(el.dataset.transition).toBeUndefined();
  });

  it("running → error sets data-transition=\"to-error\" (one-shot flash)", () => {
    // The only M4-01 transition that demands a flash. Renderer applies the
    // attribute synchronously so CSS can fire ct-error-flash; the
    // setTimeout clears it after the animation window.
    const schedule = vi.fn();
    const el = renderAgentTile({
      tile: makeTransitionTile("error"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "running",
      scheduleClearTransition: schedule,
    });
    expect(el.dataset.transition).toBe("to-error");
    // Scheduler was called once with the 400ms clear window.
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]![1]).toBe(400);
  });

  it("running → finished sets data-transition=\"to-finished\"", () => {
    const el = renderAgentTile({
      tile: makeTransitionTile("finished"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "running",
    });
    expect(el.dataset.transition).toBe("to-finished");
  });

  it("idle → running sets data-transition=\"to-running\"", () => {
    const el = renderAgentTile({
      tile: makeTransitionTile("running"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "idle",
    });
    expect(el.dataset.transition).toBe("to-running");
  });

  it("error → idle sets data-transition=\"to-idle\" (recovery)", () => {
    const el = renderAgentTile({
      tile: makeTransitionTile("idle"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "error",
    });
    expect(el.dataset.transition).toBe("to-idle");
  });

  it("scheduled clear callback resets the transition attribute when invoked", () => {
    // Simulates the setTimeout firing 400ms later. Capture the callback
    // and invoke it manually so the test stays synchronous.
    let capturedCb: (() => void) | null = null;
    const schedule = (cb: () => void, _ms: number): void => {
      capturedCb = cb;
    };
    const el = renderAgentTile({
      tile: makeTransitionTile("error"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "running",
      scheduleClearTransition: schedule,
    });
    expect(el.dataset.transition).toBe("to-error");
    // Invoke the scheduled callback — simulates 400ms elapsed.
    expect(capturedCb).not.toBeNull();
    capturedCb!();
    expect(el.dataset.transition).toBe("");
  });

  it("scheduled clear does NOT clobber a fresher transition that overwrote the attribute", () => {
    // If a rapid second transition (error → running within 400ms) has
    // already overwritten data-transition to "to-running", the FIRST
    // setTimeout firing must leave it alone. Defensive: the clear-callback
    // guards on the SAME target value.
    let capturedCb: (() => void) | null = null;
    const schedule = (cb: () => void): void => {
      capturedCb = cb;
    };
    const el = renderAgentTile({
      tile: makeTransitionTile("error"),
      sessionId: "sess-1",
      postMessage: vi.fn(),
      prevState: "running",
      scheduleClearTransition: schedule,
    });
    expect(el.dataset.transition).toBe("to-error");
    // Simulate a fresh transition landing before the timeout fires.
    el.dataset.transition = "to-running";
    capturedCb!();
    // The fresher transition's attribute survives.
    expect(el.dataset.transition).toBe("to-running");
  });
});

describe("renderAgentTile — M4-05 aria-label state reflection (AC4)", () => {
  // M4-01 §2.6 — aria-label must update per state so screen-reader users
  // perceive state changes. Already covered above for `error`; add the
  // remaining states for full coverage.
  const cases: Array<{ state: AgentState; label: string }> = [
    { state: "running", label: "Felix — Extension Host Dev — Running" },
    { state: "idle", label: "Felix — Extension Host Dev — Idle" },
    { state: "finished", label: "Felix — Extension Host Dev — Finished" },
    { state: "error", label: "Felix — Extension Host Dev — Error" },
  ];
  for (const { state, label } of cases) {
    it(`aria-label for state="${state}" reads "${label}"`, () => {
      const el = renderAgentTile({
        tile: {
          memberId: "felix",
          teamId: "claudeteam-alpha",
          display: "Felix",
          role: "Extension Host Dev",
          activity: "x",
          model: "claude-opus-4-7",
          state,
          agentId: "agent-A",
          toolUseId: "toolu_A",
        },
        sessionId: "s",
        postMessage: vi.fn(),
      });
      expect(el.getAttribute("aria-label")).toBe(label);
    });
  }
});

// ---------------------------------------------------------------------------
// renderFull — M4-05 prevStateTracker integration
// (state transitions fire via the tracker thread, not in isolation)
// ---------------------------------------------------------------------------

describe("renderFull — prevStateTracker integration (M4-05 §2.5)", () => {
  function makeStateAt(state: AgentState): AgentTree {
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
          rosterTiles: new Map([
            [
              "claudeteam-alpha",
              [
                {
                  memberId: "felix",
                  teamId: "claudeteam-alpha",
                  display: "Felix",
                  role: "Extension Host Dev",
                  activity: state === "finished" ? "finished" : "x",
                  model: "claude-opus-4-7",
                  state,
                  agentId: "agent-X",
                  toolUseId: "toolu_X",
                } satisfies AgentTile,
              ],
            ],
          ]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };
  }

  it("first render of a tile does NOT set data-transition (tracker empty)", () => {
    const tracker = createPrevStateTracker();
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      makeStateAt("running"),
    );
    const tile = mount.querySelector<HTMLElement>(".agent-tile");
    expect(tile).not.toBeNull();
    expect(tile!.dataset.transition).toBeUndefined();
    // Tracker captured the rendered state.
    expect(tracker.size()).toBe(1);
  });

  it("second render with a CHANGED state fires data-transition", () => {
    const tracker = createPrevStateTracker();
    const mount = document.createElement("div");
    // First render — running.
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      makeStateAt("running"),
    );
    // Second render — same tile, now finished.
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      makeStateAt("finished"),
    );
    const tile = mount.querySelector<HTMLElement>(".agent-tile");
    expect(tile!.dataset.transition).toBe("to-finished");
  });

  it("second render with the SAME state does NOT fire data-transition", () => {
    const tracker = createPrevStateTracker();
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      makeStateAt("idle"),
    );
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      makeStateAt("idle"),
    );
    const tile = mount.querySelector<HTMLElement>(".agent-tile");
    expect(tile!.dataset.transition).toBeUndefined();
  });

  it("tracker prunes entries when a tile vanishes between renders", () => {
    const tracker = createPrevStateTracker();
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      makeStateAt("running"),
    );
    expect(tracker.size()).toBe(1);
    // Tile gone — empty state next render.
    renderFull(
      { mount, postMessage: vi.fn(), prevStateTracker: tracker },
      { sessions: [] },
    );
    expect(tracker.size()).toBe(0);
  });

  it("rendering without a tracker is back-compat (no data-transition ever)", () => {
    // Component tests that don't wire the tracker should never see the
    // transition attribute — renderer skips it when prevState is undefined.
    const mount = document.createElement("div");
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateAt("running"),
    );
    renderFull(
      { mount, postMessage: vi.fn() },
      makeStateAt("error"),
    );
    const tile = mount.querySelector<HTMLElement>(".agent-tile");
    expect(tile!.dataset.transition).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prevStateTracker — unit-level (parallels finishedTracker.test coverage)
// ---------------------------------------------------------------------------

describe("prevStateTracker", () => {
  it("previous() returns undefined for unseen keys", () => {
    const t = createPrevStateTracker();
    expect(t.previous("sess", "agent")).toBeUndefined();
  });

  it("previous() returns the LAST recorded state for a key", () => {
    const t = createPrevStateTracker();
    t.record("sess", "agent", "running");
    expect(t.previous("sess", "agent")).toBe("running");
    t.record("sess", "agent", "idle");
    expect(t.previous("sess", "agent")).toBe("idle");
  });

  it("prune() removes keys not in the current set", () => {
    const t = createPrevStateTracker();
    t.record("sess", "agent-A", "running");
    t.record("sess", "agent-B", "idle");
    expect(t.size()).toBe(2);
    t.prune(new Set(["sess:agent-A" as const]));
    expect(t.size()).toBe(1);
    expect(t.previous("sess", "agent-A")).toBe("running");
    expect(t.previous("sess", "agent-B")).toBeUndefined();
  });

  it("prune() with an empty set clears every entry", () => {
    const t = createPrevStateTracker();
    t.record("sess", "agent-A", "running");
    t.record("sess", "agent-B", "idle");
    t.prune(new Set());
    expect(t.size()).toBe(0);
  });

  it("isolates state per (sessionId, agentId) pair", () => {
    // Two sessions can spawn agents with the same id — they must not
    // collide in the tracker.
    const t = createPrevStateTracker();
    t.record("sess-1", "shared-id", "running");
    t.record("sess-2", "shared-id", "error");
    expect(t.previous("sess-1", "shared-id")).toBe("running");
    expect(t.previous("sess-2", "shared-id")).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Reduced-motion — M4-05 AC3
//
// jsdom does NOT honor `@media (prefers-reduced-motion: reduce)` natively;
// production CSS handles it via media query (asserted manually in the
// Self-Test Report's reduced-motion probe). What we CAN unit-test:
// (a) `matchMedia('(prefers-reduced-motion: reduce)')` is queryable
//     (the production renderer doesn't branch on it — CSS does — so the
//     test verifies the API surface stays available for any future
//     JS-driven motion overrides);
// (b) reduced-motion does NOT remove the `data-transition` attribute —
//     color/opacity END STATES still apply per M4-01 §2.6, only the
//     keyframe motion is elided in CSS.
// ---------------------------------------------------------------------------

describe("M4-05 reduced-motion — JS-side invariants", () => {
  it("data-transition attribute still flips under reduced-motion preference", () => {
    // The renderer is preference-agnostic; CSS handles the motion elision.
    // If a future regression introduced a `if (reducedMotion) skip()` in
    // the renderer, this test would catch it (the attribute would no
    // longer flip, breaking color/opacity end-state delivery).
    const mockMatchMedia = vi
      .fn()
      .mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const origMatchMedia = window.matchMedia;
    window.matchMedia = mockMatchMedia;
    try {
      const el = renderAgentTile({
        tile: {
          memberId: "felix",
          teamId: "claudeteam-alpha",
          display: "Felix",
          role: "Extension Host Dev",
          activity: "x",
          model: "claude-opus-4-7",
          state: "error",
          agentId: "agent-RM",
          toolUseId: "toolu_RM",
        },
        sessionId: "sess-RM",
        postMessage: vi.fn(),
        prevState: "running",
      });
      expect(el.dataset.transition).toBe("to-error");
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });
});

// ---------------------------------------------------------------------------
// Per-team idle-hidden row — 86c9zqa75 / spec 86c9zmyef §3.4 Option A+B
//
// The row appears at the END of a team card when BOTH
// `state.config.hideIdleAgents === true` AND `state.hiddenIdleCount > 0`.
// Clicking the row fires the same `ui:set-config` message as the global
// header chip — passive informational hint, NOT a per-team filter scope.
// ---------------------------------------------------------------------------

describe("per-team idle-hidden row (86c9zqa75)", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    mount = document.createElement("div");
    mount.id = "root";
    document.body.appendChild(mount);
  });

  it("does NOT render when hideIdleAgents=false (filter off)", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 3,
      config: { hideIdleAgents: false },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);
    expect(mount.querySelector(".ct-team-idle-row")).toBeNull();
  });

  it("does NOT render when hiddenIdleCount=0 (nothing to hide)", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 0,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);
    expect(mount.querySelector(".ct-team-idle-row")).toBeNull();
  });

  it("renders one row per team card when hideIdleAgents=true AND count>0", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 2,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);

    const rows = mount.querySelectorAll(".ct-team-idle-row");
    // FIXTURE_STATE has one live team card (the dead session is empty).
    const teamCards = mount.querySelectorAll(".team-card");
    expect(rows.length).toBe(teamCards.length);
  });

  it("row label reads '<N> idle hidden — show' (em-dash U+2014)", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 5,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);

    const row = mount.querySelector(".ct-team-idle-row") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toBe(`5 idle hidden ${EM_DASH} show`);
    expect(row.dataset.hiddenIdleCount).toBe("5");
  });

  it("singular row label reads '1 idle hidden — show' (no plural)", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 1,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);

    const row = mount.querySelector(".ct-team-idle-row") as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toBe(`1 idle hidden ${EM_DASH} show`);
    expect(row.getAttribute("aria-label")).toBe(
      "1 idle agent hidden — click to show",
    );
  });

  it("plural aria-label says 'agents' (count > 1)", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 3,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);

    const row = mount.querySelector(".ct-team-idle-row") as HTMLElement;
    expect(row.getAttribute("aria-label")).toBe(
      "3 idle agents hidden — click to show",
    );
  });

  it("clicking the row posts { ui:set-config, hideIdleAgents: false }", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 2,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage }, state);

    const row = mount.querySelector(".ct-team-idle-row") as HTMLButtonElement;
    row.click();

    expect(postMessage).toHaveBeenCalledWith({
      type: "ui:set-config",
      payload: { key: "hideIdleAgents", value: false },
    });
  });

  it("row sits AFTER the last agent tile inside its team card", () => {
    const state = {
      ...FIXTURE_STATE,
      hiddenIdleCount: 1,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, state);

    const card = mount.querySelector(".team-card") as HTMLElement;
    const lastChild = card.lastElementChild;
    expect(lastChild?.classList.contains("ct-team-idle-row")).toBe(true);
  });
});
