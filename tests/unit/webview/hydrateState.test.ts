/**
 * @vitest-environment jsdom
 *
 * Unit tests for `hydrateState` — webview-side wire-shape rehydration.
 *
 * The host sends `SerializedDashboardState` over `webview.postMessage` (Maps
 * flattened to plain objects, because JSON.stringify drops Map contents to
 * `{}`). The webview must rebuild the Map for `session.rosterTiles.get(...)`
 * to work in the renderer.
 *
 * Coverage:
 *   - Empty state → empty sessions array.
 *   - Each session's rosterTiles is a real Map (not plain object).
 *   - Map preserves the original team→tiles association.
 *   - Non-rosterTiles fields pass through unchanged.
 *
 * Source: src/webview/main.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC1 + AC6
 */

import { describe, it, expect, vi } from "vitest";
import { hydrateState } from "../../../src/webview/main.js";
import { serializeState } from "../../../src/extension/messageBus.js";
import { renderSessionBlock } from "../../../src/webview/components/sessionBlock.js";
import type { SerializedDashboardState } from "../../../src/shared/messages.js";
import type {
  AgentTile,
  AgentTree,
  SessionTree,
} from "../../../src/shared/types.js";

// messageBus imports `vscode` (as a type only at the serializeState surface);
// shim it so the module resolves under vitest/jsdom (mirrors messageBus.test.ts).
vi.mock("vscode", () => ({}));

function tile(id: string, teamId = "claudeteam-alpha"): AgentTile {
  return {
    memberId: id,
    teamId,
    display: id,
    role: "test",
    activity: "idle 1s",
    model: "claude-opus-4-7",
    state: "idle",
    agentId: `agent-${id}`,
    toolUseId: null,
  };
}

describe("hydrateState — wire shape → in-memory shape", () => {
  it("empty wire state → empty sessions", () => {
    const wire: SerializedDashboardState = { sessions: [] };
    const out = hydrateState(wire);
    expect(out.sessions).toEqual([]);
  });

  it("rebuilds rosterTiles as a real Map", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "abcdef12",
          sessionId: "abcdef12-0000-0000-0000-000000000001",
          pid: 1,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
          title: "hydrate test",
          rosterTiles: {
            "claudeteam-alpha": [tile("felix"), tile("maya")],
          },
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
    };

    const out = hydrateState(wire);

    expect(out.sessions).toHaveLength(1);
    const rt = out.sessions[0]!.rosterTiles;
    expect(rt).toBeInstanceOf(Map);
    expect(rt.get("claudeteam-alpha")).toHaveLength(2);
    // The hydrator's value type is `RosterTileEntry[]` (M3-10 widened
    // union — bare `AgentTile` or `CollapsedPersonaGroup`). This test
    // wires bare AgentTiles; narrow via cast to access `memberId`.
    const entries = rt.get("claudeteam-alpha")!;
    expect((entries[0] as AgentTile).memberId).toBe("felix");
    expect((entries[1] as AgentTile).memberId).toBe("maya");
  });

  it("preserves multi-team groupings as separate Map entries", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "abcdef12",
          sessionId: "abcdef12-0000-0000-0000-000000000002",
          pid: 2,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\X",
          title: "two teams",
          rosterTiles: {
            alpha: [tile("a1", "alpha")],
            beta: [tile("b1", "beta"), tile("b2", "beta")],
          },
          teamOrder: ["alpha", "beta"],
          background: [],
        },
      ],
    };

    const out = hydrateState(wire);
    const rt = out.sessions[0]!.rosterTiles;

    expect(rt.size).toBe(2);
    expect(rt.get("alpha")).toHaveLength(1);
    expect(rt.get("beta")).toHaveLength(2);
  });

  it("preserves non-rosterTiles fields verbatim", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "deadbeef",
          sessionId: "deadbeef-0000-0000-0000-000000000003",
          pid: 99,
          entrypoint: "cli",
          version: "2.1.119",
          isAlive: false,
          cwd: "/posix/path",
          title: "passthrough test",
          rosterTiles: {},
          teamOrder: [],
          background: [
            {
              agentType: "general-purpose",
              description: "noise",
              state: "running",
              model: "claude-sonnet-4-5",
            },
          ],
        },
      ],
    };

    const out = hydrateState(wire);
    const s = out.sessions[0]!;

    expect(s.shortId).toBe("deadbeef");
    expect(s.pid).toBe(99);
    expect(s.entrypoint).toBe("cli");
    expect(s.version).toBe("2.1.119");
    expect(s.isAlive).toBe(false);
    expect(s.cwd).toBe("/posix/path");
    expect(s.title).toBe("passthrough test");
    expect(s.teamOrder).toEqual([]);
    expect(s.background).toHaveLength(1);
    expect(s.background[0]!.agentType).toBe("general-purpose");
  });

  // 86ca8mj84 — the LIVE SESSION TITLE bug, webview half. `hydrateState`
  // previously copied a hardcoded session field subset that OMITTED
  // `customTitle` + `gitBranch` — so even after the host serializes them onto
  // the wire, the webview re-stripped them here and the session-header resolver
  // fell through to the cwd-basename (`ClaudeTeam`). These tests FAIL against
  // the pre-fix hydrator (the fields are absent on the WebviewSessionTree) and
  // pass after.
  it("carries customTitle + gitBranch from the wire into WebviewSessionTree (86ca8mj84)", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "c023bfef",
          sessionId: "c023bfef-3ddb-4e7b-83f9-e8f35be0a385",
          pid: 25404,
          entrypoint: "claude-vscode",
          version: "2.1.177",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
          title: "Resume scene per pose shipped session",
          customTitle: "claude team - live session",
          gitBranch: "main",
          rosterTiles: {},
          teamOrder: [],
          background: [],
        },
      ],
    };
    const out = hydrateState(wire);
    const s = out.sessions[0]!;
    expect(s.customTitle).toBe("claude team - live session");
    expect(s.gitBranch).toBe("main");
  });

  it("absent customTitle / gitBranch on wire stay absent on WebviewSessionTree (back-compat)", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "abcdef12",
          sessionId: "abcdef12-0000-0000-0000-000000000099",
          pid: 7,
          entrypoint: "cli",
          version: "2.1.119",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
          title: "(no title yet)",
          rosterTiles: {},
          teamOrder: [],
          background: [],
        },
      ],
    };
    const out = hydrateState(wire);
    const s = out.sessions[0]!;
    // `in` (not `=== undefined`) so a regression that always sets the key with
    // `undefined` would still be caught.
    expect("customTitle" in s).toBe(false);
    expect("gitBranch" in s).toBe(false);
  });

  it("empty rosterTiles object → empty Map (size 0)", () => {
    const wire: SerializedDashboardState = {
      sessions: [
        {
          shortId: "empty000",
          sessionId: "empty000-0000-0000-0000-000000000004",
          pid: 0,
          entrypoint: "cli",
          version: "2.1.145",
          isAlive: true,
          cwd: "/empty",
          title: "empty roster",
          rosterTiles: {},
          teamOrder: [],
          background: [],
        },
      ],
    };

    const out = hydrateState(wire);
    expect(out.sessions[0]!.rosterTiles).toBeInstanceOf(Map);
    expect(out.sessions[0]!.rosterTiles.size).toBe(0);
  });
});

// ===========================================================================
// M3-09 bonus — back-compat hydrator branches for filterApplied /
// rosterErrors / rosterWarnings. These three top-level fields were added in
// M3-03 (filterApplied) and M3-04 (rosterErrors/rosterWarnings). The hydrator
// conditionally spreads them so the output preserves the host's "field
// present" vs "field absent" intent — older host code that doesn't yet wire
// these fields stays compatible (the renderer treats absence as "false" /
// "empty []"). These tests catch the regression where a future refactor
// flattens the conditional spreads and forces every output to carry a
// concrete value (which would break diff-based optimizations downstream).
//
// Source: src/webview/main.ts hydrateState top-level field branches
//         src/shared/messages.ts SerializedDashboardState field optionality
//         M3-09 PR #39-review gap (1): "hydrateState carrying rosterErrors /
//                                       rosterWarnings / filterApplied"
// ===========================================================================

describe("hydrateState — back-compat top-level field handling (M3-09 NIT)", () => {
  // Minimal wire fixture — no sessions, used to isolate the top-level
  // field assertions from session-rebuild noise.
  const EMPTY_WIRE: SerializedDashboardState = { sessions: [] };

  it("absent filterApplied / rosterErrors / rosterWarnings → absent on output (back-compat)", () => {
    const out = hydrateState(EMPTY_WIRE);
    // Use the `in` operator (not `=== undefined`) to distinguish "key
    // genuinely absent" from "key present with undefined value". The
    // hydrator's conditional spread is meant to produce the former, not
    // the latter — a regression that always sets the key would still pass
    // `=== undefined` but fail this `in` check.
    expect("filterApplied" in out).toBe(false);
    expect("rosterErrors" in out).toBe(false);
    expect("rosterWarnings" in out).toBe(false);
  });

  it("filterApplied=true on wire → filterApplied=true on output", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: true,
    };
    const out = hydrateState(wire);
    expect(out.filterApplied).toBe(true);
  });

  it("filterApplied=false on wire → filterApplied=false on output (preserves the explicit false)", () => {
    // Regression target: an early version of the hydrator collapsed
    // `false` to "absent" via a truthiness check. The explicit `false`
    // distinguishes "host told us no filter ran" from "host didn't
    // include the field" — the renderer's diff logic uses both signals.
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: false,
    };
    const out = hydrateState(wire);
    expect("filterApplied" in out).toBe(true);
    expect(out.filterApplied).toBe(false);
  });

  it("rosterErrors=[] on wire → rosterErrors=[] on output (preserves the explicit empty)", () => {
    // Distinguishing empty-array from absent matters because the chip's
    // dismiss-key reset logic fires on transition between "errors present"
    // and "errors absent" — if hydrator drops `[]` to undefined, the diff
    // shape changes spuriously.
    const wire: SerializedDashboardState = {
      sessions: [],
      rosterErrors: [],
    };
    const out = hydrateState(wire);
    expect("rosterErrors" in out).toBe(true);
    expect(out.rosterErrors).toEqual([]);
  });

  it("rosterErrors with values on wire → preserved verbatim on output", () => {
    const errors = [
      "global roster YAML parse error (/x/teams.yaml): bad indent at line 3",
      "global roster schema error at teams.0.members.0.id: required",
    ];
    const wire: SerializedDashboardState = {
      sessions: [],
      rosterErrors: errors,
    };
    const out = hydrateState(wire);
    expect(out.rosterErrors).toEqual(errors);
    // Identity check: hydrator should pass-through, not deep-clone (no
    // reason to spend the bytes; consumers treat the array as read-only).
    expect(out.rosterErrors).toBe(errors);
  });

  it("rosterWarnings on wire → preserved verbatim on output", () => {
    // Same path as rosterErrors but for the warnings field (separate
    // optional spread in the hydrator). If both fields share a generic
    // helper that drops one of them, this catches the regression.
    const warnings = [
      "global roster file is empty: /x/teams.yaml",
      'duplicate member id "felix" across teams "alpha" and "beta" — second wins by load order',
    ];
    const wire: SerializedDashboardState = {
      sessions: [],
      rosterWarnings: warnings,
    };
    const out = hydrateState(wire);
    expect(out.rosterWarnings).toEqual(warnings);
    expect(out.rosterWarnings).toBe(warnings);
  });

  it("all three top-level fields together → all preserved independently", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: true,
      rosterErrors: ["err A"],
      rosterWarnings: ["warn B"],
    };
    const out = hydrateState(wire);
    expect(out.filterApplied).toBe(true);
    expect(out.rosterErrors).toEqual(["err A"]);
    expect(out.rosterWarnings).toEqual(["warn B"]);
  });
});

// ===========================================================================
// config-block passthrough. The global hide-finished / hide-idle wire fields
// (`hiddenFinishedCount` / `hiddenIdleCount` / `config.hide*Agents`) were
// removed by 86ca1gdbp (chips superseded by whole-team-always-visible +
// per-member hide). The surviving config scalar is
// `config.autoCollapseUniformClusters`, which the hydrator threads verbatim.
//
// Source: src/webview/main.ts hydrateState config spread branch
//         src/shared/messages.ts SerializedDashboardState config block
// ===========================================================================

describe("hydrateState — config block handling", () => {
  const EMPTY_WIRE: SerializedDashboardState = { sessions: [] };

  it("absent config → absent on output (back-compat)", () => {
    const out = hydrateState(EMPTY_WIRE);
    expect("config" in out).toBe(false);
  });

  it("config.autoCollapseUniformClusters=true on wire → preserved on output", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      config: { autoCollapseUniformClusters: true },
    };
    const out = hydrateState(wire);
    expect(out.config?.autoCollapseUniformClusters).toBe(true);
  });

  it("config.autoCollapseUniformClusters=false on wire → preserved (explicit false)", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      config: { autoCollapseUniformClusters: false },
    };
    const out = hydrateState(wire);
    expect(out.config?.autoCollapseUniformClusters).toBe(false);
  });

  it("config object passed by reference (no deep clone)", () => {
    const config = { autoCollapseUniformClusters: true };
    const wire: SerializedDashboardState = { sessions: [], config };
    const out = hydrateState(wire);
    expect(out.config).toBe(config);
  });

  it("config composes with M3-09 top-level fields (back-compat surface)", () => {
    const wire: SerializedDashboardState = {
      sessions: [],
      filterApplied: true,
      rosterErrors: ["err A"],
      rosterWarnings: ["warn B"],
      config: { autoCollapseUniformClusters: true },
    };
    const out = hydrateState(wire);
    expect(out.filterApplied).toBe(true);
    expect(out.rosterErrors).toEqual(["err A"]);
    expect(out.rosterWarnings).toEqual(["warn B"]);
    expect(out.config?.autoCollapseUniformClusters).toBe(true);
  });
});

// ===========================================================================
// 86ca8mj84 — FULL-PATH LIVE SESSION TITLE test.
//
// This is the catch #222 missed: instead of constructing a SessionTree with
// customTitle already set and feeding it straight into renderSessionBlock
// (which only exercises the resolver, never the wire), this drives the COMPLETE
// host→webview path:
//
//   SessionTree (customTitle set)
//     → serializeState   (host: was dropping customTitle)
//     → JSON round-trip  (the actual postMessage bytes)
//     → hydrateState     (webview: was dropping customTitle)
//     → renderSessionBlock  (reads session.customTitle via resolveSessionLabel)
//
// The three candidate strings are deliberately all distinct so the assertion
// distinguishes the resolver from the cwd-basename fallback:
//   - customTitle      = "claude team - live session"   (Tier 1 — must win)
//   - aiTitle (title)  = "Resume scene per pose shipped" (Tier 2)
//   - cwd-basename      = "ClaudeTeam"                    (Tier 3 — the BUG value)
//
// Reverting ANY of the three production fixes (serialize-drop, hydrate-drop, or
// the aiTitle parse key) re-breaks the "live title" cases here, so the block is
// non-vacuous w.r.t. the full pipeline.
// ===========================================================================
describe("86ca8mj84 — live session title end-to-end (serialize → hydrate → render)", () => {
  function hostSession(overrides: Partial<SessionTree> = {}): SessionTree {
    return {
      shortId: "c023bfef",
      sessionId: "c023bfef-3ddb-4e7b-83f9-e8f35be0a385",
      pid: 25404,
      entrypoint: "claude-vscode",
      version: "2.1.177",
      isAlive: true,
      cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam", // basename → "ClaudeTeam"
      title: "Resume scene per pose shipped session",
      rosterTiles: new Map(),
      teamOrder: [],
      background: [],
      ...overrides,
    };
  }

  /** Drive the full host→webview wire and return the rendered header text. */
  function renderThroughWire(session: SessionTree): {
    title: string | null | undefined;
    source: string | null | undefined;
  } {
    const hostState: AgentTree = { sessions: [session] };
    // Host serialize → real postMessage bytes → webview hydrate.
    const wire = JSON.parse(
      JSON.stringify(serializeState(hostState)),
    ) as SerializedDashboardState;
    const hydrated = hydrateState(wire);
    const block = renderSessionBlock({
      session: hydrated.sessions[0]!,
      postMessage: vi.fn(),
    });
    const span = block.querySelector(".session-title");
    return {
      title: span?.textContent,
      source: span?.getAttribute("data-label-source"),
    };
  }

  it("customTitle survives the wire and is the resolved header label (NOT the cwd-basename)", () => {
    const out = renderThroughWire(
      hostSession({ customTitle: "claude team - live session" }),
    );
    expect(out.title).toBe("claude team - live session");
    expect(out.title).not.toBe("ClaudeTeam");
    expect(out.source).toBe("custom-title");
  });

  it("no customTitle → aiTitle survives the wire and is the header label (NOT the cwd-basename)", () => {
    // customTitle absent → resolver falls to Tier 2 (aiTitle = the `title`
    // field). This proves `title` reaches the wire too (it always did) and
    // that the fallback ordering is correct end-to-end.
    const out = renderThroughWire(hostSession());
    expect(out.title).toBe("Resume scene per pose shipped session");
    expect(out.title).not.toBe("ClaudeTeam");
    expect(out.source).toBe("ai-title");
  });

  it("no customTitle AND no aiTitle → cwd-basename fallback (never blank)", () => {
    const out = renderThroughWire(hostSession({ title: "(no title yet)" }));
    expect(out.title).toBe("ClaudeTeam");
    expect(out.source).toBe("workspace-folder");
  });

  it("LIVE-UPDATE on rename: a new custom-title on the next state push updates the header — no reload", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      // Tick 1 — sponsor's first rename.
      const wire1 = JSON.parse(
        JSON.stringify(
          serializeState({
            sessions: [hostSession({ customTitle: "claude team" })],
          }),
        ),
      ) as SerializedDashboardState;
      mount.replaceChildren(
        renderSessionBlock({
          session: hydrateState(wire1).sessions[0]!,
          postMessage: vi.fn(),
        }),
      );
      expect(mount.querySelector(".session-title")?.textContent).toBe(
        "claude team",
      );

      // Tick 2 — sponsor renames again; a fresh state:full arrives. The
      // dashboard rebuilds the session block (renderFull does
      // `mount.replaceChildren()` every poll). Header must reflect the new
      // value with NO webview reload.
      const wire2 = JSON.parse(
        JSON.stringify(
          serializeState({
            sessions: [
              hostSession({ customTitle: "claude team - live session  1" }),
            ],
          }),
        ),
      ) as SerializedDashboardState;
      mount.replaceChildren(
        renderSessionBlock({
          session: hydrateState(wire2).sessions[0]!,
          postMessage: vi.fn(),
        }),
      );
      expect(mount.querySelector(".session-title")?.textContent).toBe(
        "claude team - live session  1",
      );
      expect(
        mount.querySelector(".session-title")?.getAttribute("data-label-source"),
      ).toBe("custom-title");
    } finally {
      mount.remove();
    }
  });
});
