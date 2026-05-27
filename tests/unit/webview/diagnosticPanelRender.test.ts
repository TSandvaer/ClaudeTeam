/**
 * @vitest-environment jsdom
 *
 * Component tests for the diagnostic panel renderer
 * (`src/diagnostics/render.ts`, 86c9zn7tm).
 *
 * Coverage:
 *   - Empty boot state — renders the "waiting for first tick" heading
 *     before any payload lands.
 *   - Header — Output-channel verbose chip, tick-count chip, three buttons
 *     (Refresh / Pause / Clear). Pause button label flips with state.
 *   - Tick table — one row per history entry, rendered newest-first.
 *     Hash-skip rows carry the modifier class.
 *   - Transition list — each transition emits a state badge for prev and
 *     next AND the short-id pair.
 *   - State section — per-session card with agent rows; CollapsedPersonaGroup
 *     instances are flattened into the table.
 *   - Roster errors / warnings render as banners.
 *   - State badges carry `data-state="..."` matching the AgentState.
 *
 * Theme assertions: every diagnostic-* class is present (panel.css owns the
 * theme variables); this test layer asserts structure, not computed style.
 */

import { describe, it, expect, vi } from "vitest";

import {
  formatTickTimestamp,
  renderPanel,
  stateBadge,
} from "../../../src/diagnostics/render.js";
import type {
  DiagnosticStateMessage,
  DiagnosticTickHistoryEntry,
  SerializedDashboardState,
  SerializedSessionTree,
} from "../../../src/shared/messages.js";
import type {
  AgentState,
  AgentTile,
  CollapsedPersonaGroup,
} from "../../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeTile(
  agentId: string,
  state: AgentState,
  overrides: Partial<AgentTile> = {},
): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: "tool:Edit src/x.ts",
    model: "claude-opus-4-7",
    state,
    agentId,
    toolUseId: null,
    ...overrides,
  };
}

function makeSession(
  sessionId: string,
  tiles: (AgentTile | CollapsedPersonaGroup)[] = [],
  overrides: Partial<SerializedSessionTree> = {},
): SerializedSessionTree {
  return {
    shortId: sessionId.slice(0, 8),
    sessionId,
    pid: 1234,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "(no title yet)",
    rosterTiles:
      tiles.length > 0 ? { "claudeteam-alpha": tiles } : {},
    teamOrder: tiles.length > 0 ? ["claudeteam-alpha"] : [],
    background: [],
    ...overrides,
  };
}

function makeState(
  sessions: SerializedSessionTree[],
  overrides: Partial<SerializedDashboardState> = {},
): SerializedDashboardState {
  return {
    sessions,
    ...overrides,
  };
}

function makeTick(
  tickNumber: number,
  overrides: Partial<DiagnosticTickHistoryEntry> = {},
): DiagnosticTickHistoryEntry {
  return {
    tickNumber,
    timestampMs: 1700000000000 + tickNumber * 2000,
    durationMs: 5,
    emitted: true,
    transitions: [],
    ...overrides,
  };
}

function makePayload(
  overrides: Partial<DiagnosticStateMessage["payload"]> = {},
): DiagnosticStateMessage["payload"] {
  return {
    ticks: [],
    state: null,
    verbose: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty boot state
// ---------------------------------------------------------------------------

describe("renderPanel — empty boot state", () => {
  it("renders the 'waiting for first tick' message when payload is null", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: null,
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    expect(mount.querySelector(".diagnostic-empty")).not.toBeNull();
    expect(mount.textContent).toContain("Waiting for the first watcher tick");
  });

  it("header buttons still render in the empty state", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: null,
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const buttons = mount.querySelectorAll(".diagnostic-button");
    expect(buttons).toHaveLength(3); // Refresh + Pause + Clear
  });
});

// ---------------------------------------------------------------------------
// Header chips + buttons
// ---------------------------------------------------------------------------

describe("renderPanel — header chips", () => {
  it("verbose ON renders a chip with data-state-like class on", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({ verbose: true }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const chip = mount.querySelector(".diagnostic-chip--on");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("ON");
  });

  it("verbose OFF renders a chip with the off modifier", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({ verbose: false }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const chip = mount.querySelector(".diagnostic-chip--off");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("OFF");
  });

  it("tick-count chip shows 0/1/N grammar correctly", () => {
    for (const n of [0, 1, 5] as const) {
      const mount = document.createElement("div");
      renderPanel({
        mount,
        payload: makePayload({
          ticks: Array.from({ length: n }, (_, i) => makeTick(i + 1)),
        }),
        paused: false,
        onPauseToggle: vi.fn(),
        onClear: vi.fn(),
        onRefresh: vi.fn(),
      });
      const chip = mount.querySelector(".diagnostic-chip--neutral");
      expect(chip!.textContent).toBe(
        `${n} tick${n === 1 ? "" : "s"} in history`,
      );
    }
  });

  it("Pause button label flips to Resume when paused=true", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload(),
      paused: true,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const pauseBtn = Array.from(
      mount.querySelectorAll<HTMLButtonElement>(".diagnostic-button"),
    ).find((b) => b.textContent === "Resume");
    expect(pauseBtn).toBeDefined();
    expect(pauseBtn!.classList.contains("diagnostic-button--paused")).toBe(true);
  });

  it("button clicks invoke their callbacks", () => {
    const mount = document.createElement("div");
    const onPause = vi.fn();
    const onClear = vi.fn();
    const onRefresh = vi.fn();
    renderPanel({
      mount,
      payload: makePayload(),
      paused: false,
      onPauseToggle: onPause,
      onClear,
      onRefresh,
    });
    const buttons = Array.from(
      mount.querySelectorAll<HTMLButtonElement>(".diagnostic-button"),
    );
    const byLabel = (label: string): HTMLButtonElement =>
      buttons.find((b) => b.textContent === label)!;
    byLabel("Refresh").click();
    byLabel("Pause").click();
    byLabel("Clear history").click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tick table
// ---------------------------------------------------------------------------

describe("renderPanel — tick table", () => {
  it("empty ticks renders the empty placeholder, no <tbody> rows", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({ ticks: [] }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const section = mount.querySelector(".diagnostic-section--ticks");
    expect(section).not.toBeNull();
    expect(section!.querySelector(".diagnostic-table-empty")).not.toBeNull();
    expect(section!.querySelector(".diagnostic-tick-row")).toBeNull();
  });

  it("renders one row per tick, newest at the top", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        ticks: [makeTick(1), makeTick(2), makeTick(3)],
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const rows = mount.querySelectorAll(".diagnostic-tick-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.querySelector(".diagnostic-cell--num")!.textContent).toBe("#3");
    expect(rows[2]!.querySelector(".diagnostic-cell--num")!.textContent).toBe("#1");
  });

  it("hash-skip ticks carry the hash-skip modifier class", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        ticks: [
          makeTick(1, { emitted: true }),
          makeTick(2, { emitted: false }),
        ],
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const rows = mount.querySelectorAll(".diagnostic-tick-row");
    // Newest first: tick 2 (skip) at index 0, tick 1 (emitted) at index 1.
    expect(rows[0]!.classList.contains("diagnostic-tick-row--hash-skip")).toBe(true);
    expect(rows[1]!.classList.contains("diagnostic-tick-row--hash-skip")).toBe(false);
  });

  it("renders one transition row with prev / next badges + short ids", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        ticks: [
          makeTick(1, {
            transitions: [
              {
                sessionShortId: "session-",
                agentShortId: "agent-1a",
                sessionId: "session-full",
                agentId: "agent-1a-full",
                prev: "running",
                next: "idle",
              },
            ],
          }),
        ],
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const row = mount.querySelector(".diagnostic-tick-row")!;
    const transitions = row.querySelectorAll(".diagnostic-transition");
    expect(transitions).toHaveLength(1);
    const t = transitions[0]!;
    expect(t.textContent).toContain("session-/agent-1a");
    const badges = t.querySelectorAll(".diagnostic-state-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]!.getAttribute("data-state")).toBe("running");
    expect(badges[1]!.getAttribute("data-state")).toBe("idle");
  });

  it("renders the placeholder cell when a tick has no transitions", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({ ticks: [makeTick(1)] }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const cell = mount.querySelector(".diagnostic-cell--transitions");
    expect(cell!.textContent).toBe("—");
    expect(cell!.classList.contains("diagnostic-cell--empty")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State section — per-session cards
// ---------------------------------------------------------------------------

describe("renderPanel — current state section", () => {
  it("renders the 'no state yet' empty when state is null", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload(),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const section = mount.querySelector(".diagnostic-section--state");
    expect(section!.textContent).toContain("No state recorded yet");
  });

  it("renders 'no live sessions' when state.sessions is empty", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({ state: makeState([]) }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const section = mount.querySelector(".diagnostic-section--state");
    expect(section!.textContent).toContain("No live Claude Code sessions");
  });

  it("renders one card per session with the expected meta + agents table", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        state: makeState([
          makeSession("sessionAbcdef12", [
            makeTile("agent-1", "running"),
            makeTile("agent-2", "finished"),
          ]),
        ]),
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const cards = mount.querySelectorAll(".diagnostic-session");
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.querySelector(".diagnostic-session-shortid")!.textContent).toBe(
      "sessionA",
    );
    const rows = card.querySelectorAll(".diagnostic-agent-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-state")).toBe("running");
    expect(rows[1]!.getAttribute("data-state")).toBe("finished");
  });

  it("flattens CollapsedPersonaGroup instances into the agents table", () => {
    const group: CollapsedPersonaGroup = {
      kind: "collapsed-persona",
      personaName: "Felix",
      count: 3,
      instances: [
        makeTile("agent-1", "running"),
        makeTile("agent-2", "idle"),
        makeTile("agent-3", "finished"),
      ],
    };
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        state: makeState([makeSession("session-A", [group])]),
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const rows = mount.querySelectorAll(".diagnostic-agent-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.getAttribute("data-state")).toBe("running");
    expect(rows[1]!.getAttribute("data-state")).toBe("idle");
    expect(rows[2]!.getAttribute("data-state")).toBe("finished");
  });

  it("dead sessions render the DEAD badge AND the dead modifier class", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        state: makeState([
          makeSession("session-dead", [], { isAlive: false }),
        ]),
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const card = mount.querySelector(".diagnostic-session")!;
    expect(card.classList.contains("diagnostic-session--dead")).toBe(true);
    expect(card.querySelector(".diagnostic-session-dead")!.textContent).toBe(
      "DEAD",
    );
  });

  it("background agents render with a state badge + agentType + description", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        state: makeState([
          makeSession("session-A", [], {
            background: [
              {
                agentType: "general-purpose",
                description: "Investigate boot bleed",
                state: "running",
                model: "claude-sonnet-4-5",
              },
            ],
          }),
        ]),
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const bg = mount.querySelector(".diagnostic-background");
    expect(bg).not.toBeNull();
    expect(bg!.textContent).toContain("1 background agent");
    expect(bg!.textContent).toContain("general-purpose");
    expect(bg!.textContent).toContain("Investigate boot bleed");
    expect(bg!.querySelector(".diagnostic-state-badge[data-state='running']")).not.toBeNull();
  });

  it("roster errors render as an error banner", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        state: makeState([], {
          rosterErrors: ["global roster YAML parse error: <reason>"],
        }),
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    const banner = mount.querySelector(".diagnostic-banner--error");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain("Roster errors");
    expect(banner!.textContent).toContain("global roster YAML parse error");
  });

  it("roster warnings render as a warn banner (distinct from errors)", () => {
    const mount = document.createElement("div");
    renderPanel({
      mount,
      payload: makePayload({
        state: makeState([], {
          rosterWarnings: ["duplicate team id"],
        }),
      }),
      paused: false,
      onPauseToggle: vi.fn(),
      onClear: vi.fn(),
      onRefresh: vi.fn(),
    });
    expect(mount.querySelector(".diagnostic-banner--warn")).not.toBeNull();
    expect(mount.querySelector(".diagnostic-banner--error")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stateBadge + formatTickTimestamp helpers
// ---------------------------------------------------------------------------

describe("stateBadge", () => {
  for (const state of ["running", "idle", "finished", "error"] as const) {
    it(`renders a span with data-state="${state}"`, () => {
      const el = stateBadge(state);
      expect(el.tagName).toBe("SPAN");
      expect(el.getAttribute("data-state")).toBe(state);
      expect(el.textContent).toBe(state);
      expect(el.classList.contains("diagnostic-state-badge")).toBe(true);
    });
  }
});

describe("formatTickTimestamp", () => {
  it("formats epoch ms as HH:MM:SS local time", () => {
    // 1700000000000 = 2023-11-14T22:13:20.000Z — but we're asserting the
    // shape (HH:MM:SS with two-digit padding), not the absolute hour,
    // because jsdom's TZ inherits the host's.
    const result = formatTickTimestamp(1700000000000);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
