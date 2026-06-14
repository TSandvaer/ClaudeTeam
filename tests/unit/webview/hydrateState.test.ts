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
import { renderFull } from "../../../src/webview/render.js";
import type { SerializedDashboardState } from "../../../src/shared/messages.js";
import type {
  AgentTile,
  AgentTree,
  HiddenMemberKey,
  RemovedMemberKey,
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

// ===========================================================================
// 86ca8mquy — HIDDEN-MEMBER recovery chip, FULL-PATH non-vacuous regression.
//
// THE BUG (Sage-verified, pre-existing on main): `serializeState` (host) puts
// `hiddenMemberKeys` / `removedMemberKeys` + their counts onto the wire, but
// `hydrateState` (webview) DROPPED all four in its top-level spread — they're
// all OPTIONAL on `AgentTree`/`WebviewAgentTree`, so the omission compiled
// green yet the webview always received `undefined` → `readHiddenMemberKeys`
// returned `[]` → `renderHiddenMembersChip` rendered nothing → the
// ".ct-hidden-members-chip" recovery surface never mounted → a hidden member
// was UNRECOVERABLE from the UI.
//
// Why the EXISTING coverage was vacuous (same trap as #222/#223): the chip-
// mount tests in `hideMember.test.ts` (`render.ts — hidden-members chip
// integration`) build an in-memory `AgentTree` with `hiddenMemberKeys` already
// set and feed it STRAIGHT into `renderFull` — bypassing the
// serialize → JSON → hydrate seam where the drop happens. Those tests stay
// green with the bug present.
//
// This block drives the COMPLETE host→webview path through the REAL seam:
//
//   AgentTree (hiddenMemberKeys set)
//     → serializeState   (host: puts the keys on the wire)
//     → JSON round-trip  (the actual postMessage bytes)
//     → hydrateState     (webview: was DROPPING the keys)
//     → renderFull       (reads state.hiddenMemberKeys via readHiddenMemberKeys)
//
// Mutation-verify: revert the `hiddenMemberKeys` spread in `hydrateState`
// (src/webview/main.ts) → the "chip mounts" assertion goes RED (the key is
// stripped at hydration → the chip returns null → never mounts).
// ===========================================================================
describe("86ca8mquy — hidden-member chip end-to-end (serialize → JSON → hydrate → renderFull)", () => {
  /** A rostered tile so the session renders normally alongside the chip. */
  function liveTile(): AgentTile {
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
    };
  }

  /** A live host `AgentTree` carrying a hidden-member set. */
  function hostStateWithHidden(
    hiddenKeys: HiddenMemberKey[],
    removedKeys: RemovedMemberKey[] = [],
  ): AgentTree {
    return {
      sessions: [
        {
          shortId: "sessA001",
          sessionId: "sess-A-0000-0000-0000-000000000001",
          pid: 1234,
          entrypoint: "claude-vscode",
          version: "2.1.145",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
          title: "hidden-member end-to-end",
          rosterTiles: new Map([["claudeteam-alpha", [liveTile()]]]),
          teamOrder: ["claudeteam-alpha"],
          background: [],
        },
      ],
      hiddenMemberCount: hiddenKeys.length,
      hiddenMemberKeys: hiddenKeys,
      removedMemberCount: removedKeys.length,
      removedMemberKeys: removedKeys,
    };
  }

  /** serialize → JSON bytes → hydrate, then renderFull into a fresh mount. */
  function renderThroughWire(host: AgentTree): HTMLElement {
    const wire = JSON.parse(
      JSON.stringify(serializeState(host)),
    ) as SerializedDashboardState;
    const hydrated = hydrateState(wire);
    const mount = document.createElement("div");
    renderFull({ mount, postMessage: vi.fn() }, hydrated);
    return mount;
  }

  it("mounts the .ct-hidden-members-chip when a member is hidden (survives the wire)", () => {
    const mount = renderThroughWire(
      hostStateWithHidden(["claudeteam-alpha:bram"] as HiddenMemberKey[]),
    );
    const chip = mount.querySelector(".ct-hidden-members-chip");
    // The load-bearing assertion: with the hydrate fix the key survives the
    // wire and the recovery chip mounts. Pre-fix the key was stripped at
    // hydration → readHiddenMemberKeys returned [] → chip null → NOT mounted.
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-hidden-member-count")).toBe("1");
  });

  it("does NOT mount the chip when nothing is hidden (no false positive)", () => {
    const mount = renderThroughWire(hostStateWithHidden([]));
    expect(mount.querySelector(".ct-hidden-members-chip")).toBeNull();
  });

  it("removedMemberKeys also survive the wire — a removed-AND-hidden member is masked OUT of the chip", () => {
    // bram is both hidden AND removed; the webview applies the set-difference
    // (readRemovedMemberKeys) so the recovery chip must NOT surface a removed
    // member. This exercises BOTH hiddenMemberKeys and removedMemberKeys
    // surviving hydration — reverting EITHER spread breaks an assertion here:
    //   - drop hiddenMemberKeys → chip is null (count assert fails)
    //   - drop removedMemberKeys → the mask is empty → bram leaks into the chip
    const mount = renderThroughWire(
      hostStateWithHidden(
        [
          "claudeteam-alpha:bram",
          "claudeteam-alpha:nora",
        ] as HiddenMemberKey[],
        ["claudeteam-alpha:bram"] as RemovedMemberKey[],
      ),
    );
    const chip = mount.querySelector(".ct-hidden-members-chip");
    expect(chip).not.toBeNull();
    // Only nora remains after masking bram (the removed one).
    expect(chip?.getAttribute("data-hidden-member-count")).toBe("1");
    const memberIds = Array.from(
      mount.querySelectorAll(".ct-hidden-member-row"),
    ).map((row) => (row as HTMLElement).dataset.memberId);
    expect(memberIds).toContain("nora");
    expect(memberIds).not.toContain("bram");
  });
});

// ===========================================================================
// 86ca8mquy — GUARD: whole-state serialize → JSON → hydrate round-trip property
// test. THE STRUCTURAL PREVENTION (sponsor-approved as a REQUIRED AC).
//
// This is the 3rd instance of the SAME footgun: `hydrateState` copies a
// HARDCODED SUBSET of the state shape, so any OPTIONAL field a future host adds
// to the wire — and forgets to thread through hydration — silently arrives
// `undefined` at the renderer. #222 (title), #223 (customTitle/gitBranch), now
// #86ca8mquy (member-keys) are all this class. A per-field property test makes
// the NEXT dropped field fail CI by construction.
//
// The property: for a maximal `DashboardState` populating EVERY field that
// `serializeState` puts on the `state:full` wire, the round-trip
// `serialize → JSON.parse(JSON.stringify(...)) → hydrate` must PRESERVE every
// field (deep-equal), modulo the two documented, intentional transforms below.
//
// DOCUMENTED EXCLUSIONS (each is an intentional design choice, NOT a drop):
//   1. `sessions[].rosterTiles` — `Map<…>` in memory, `Record<…>` on the wire
//      (JSON.stringify drops Map contents to `{}`; serializeState flattens via
//      Object.fromEntries and hydrateState rebuilds the Map via Object.entries).
//      Asserted via Map↔Map deep-equality (entries compared), NOT raw-equal.
//   2. `roster` (`AgentTree.roster?: Team[]`) — INTENTIONALLY NOT on the
//      `state:full` wire. `serializeState` omits it; the roster rides its own
//      `roster:loaded` message (see SessionTree/AgentTree `roster` docstring +
//      messageBus `postRosterLoaded`). So it is excluded from the round-trip by
//      design — the fixture deliberately does NOT set it, and we assert it is
//      absent on the wire to lock the omission in.
//
// Mutation-verify: remove ANY threaded field from `hydrateState`'s spread (e.g.
// `hiddenMemberKeys`, `filterApplied`, `customTitle`) → the corresponding
// per-field assertion goes RED.
// ===========================================================================
describe("86ca8mquy GUARD — whole-state round-trip preserves every wire field", () => {
  /**
   * A maximal `DashboardState` — every field `serializeState` emits onto the
   * `state:full` wire is populated with a DISTINCT, non-default value so a drop
   * (→ undefined) or a coerce (→ default) is detectable. `roster` is
   * intentionally omitted (excluded per the block header).
   */
  function maximalState(): AgentTree {
    const tileA: AgentTile = {
      memberId: "felix",
      teamId: "claudeteam-alpha",
      display: "Felix",
      role: "Extension Host Dev",
      activity: "tool:Edit src/extension/main.ts",
      model: "claude-opus-4-7",
      state: "running",
      agentId: "a1d53b4a2db17f2f5",
      toolUseId: "toolu_AAA",
    };
    const tileB: AgentTile = {
      memberId: "maya",
      teamId: "claudeteam-alpha",
      display: "Maya",
      role: "Webview UI Dev",
      activity: "idle 3s",
      model: "claude-opus-4-7",
      state: "idle",
      agentId: "b2e64c5b3ec28g3g6",
      toolUseId: null,
    };
    return {
      sessions: [
        {
          shortId: "sessMAX0",
          sessionId: "sessMAX0-1111-2222-3333-444455556666",
          pid: 4242,
          entrypoint: "claude-vscode",
          version: "2.1.177",
          isAlive: true,
          cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
          title: "Resume scene per pose shipped session",
          customTitle: "claude team - live session",
          gitBranch: "maya/86ca8mquy-hydrate-member-keys",
          rosterTiles: new Map([
            ["claudeteam-alpha", [tileA, tileB]],
            ["claudeteam-beta", [{ ...tileA, teamId: "claudeteam-beta" }]],
          ]),
          teamOrder: ["claudeteam-alpha", "claudeteam-beta"],
          background: [
            {
              agentType: "general-purpose",
              description: "noise agent",
              state: "running",
              model: "claude-sonnet-4-5",
            },
          ],
        },
      ],
      filterApplied: true,
      rosterErrors: ["global roster YAML parse error (/x/teams.yaml): bad indent"],
      rosterWarnings: ['duplicate member id "felix" across teams — second wins'],
      hiddenMemberCount: 2,
      hiddenMemberKeys: [
        "claudeteam-alpha:bram",
        "claudeteam-alpha:nora",
      ] as HiddenMemberKey[],
      removedMemberCount: 1,
      removedMemberKeys: ["claudeteam-alpha:sage"] as RemovedMemberKey[],
      config: { autoCollapseUniformClusters: true },
    };
  }

  /** The round-tripped state through the REAL host→webview seam. */
  function roundTrip(host: AgentTree): ReturnType<typeof hydrateState> {
    const wire = JSON.parse(
      JSON.stringify(serializeState(host)),
    ) as SerializedDashboardState;
    return hydrateState(wire);
  }

  it("preserves every top-level wire field (per-field deep-equal)", () => {
    const host = maximalState();
    const out = roundTrip(host);

    expect(out.filterApplied).toBe(host.filterApplied);
    expect(out.rosterErrors).toEqual(host.rosterErrors);
    expect(out.rosterWarnings).toEqual(host.rosterWarnings);
    expect(out.hiddenMemberCount).toBe(host.hiddenMemberCount);
    expect(out.hiddenMemberKeys).toEqual(host.hiddenMemberKeys);
    expect(out.removedMemberCount).toBe(host.removedMemberCount);
    expect(out.removedMemberKeys).toEqual(host.removedMemberKeys);
    expect(out.config).toEqual(host.config);
  });

  it("preserves every per-session field (per-field deep-equal; rosterTiles via Map↔Map)", () => {
    const host = maximalState();
    const out = roundTrip(host);

    expect(out.sessions).toHaveLength(host.sessions.length);
    const hs = host.sessions[0]!;
    const os = out.sessions[0]!;

    // Every scalar / array session field round-trips verbatim.
    expect(os.shortId).toBe(hs.shortId);
    expect(os.sessionId).toBe(hs.sessionId);
    expect(os.pid).toBe(hs.pid);
    expect(os.entrypoint).toBe(hs.entrypoint);
    expect(os.version).toBe(hs.version);
    expect(os.isAlive).toBe(hs.isAlive);
    expect(os.cwd).toBe(hs.cwd);
    expect(os.title).toBe(hs.title);
    expect(os.customTitle).toBe(hs.customTitle);
    expect(os.gitBranch).toBe(hs.gitBranch);
    expect(os.teamOrder).toEqual(hs.teamOrder);
    expect(os.background).toEqual(hs.background);

    // Documented exclusion #1 — rosterTiles is Map↔Record↔Map by design.
    // Assert the Map round-trips with identical entries (NOT raw-equal).
    expect(os.rosterTiles).toBeInstanceOf(Map);
    expect(Array.from(os.rosterTiles.keys())).toEqual(
      Array.from(hs.rosterTiles.keys()),
    );
    for (const [teamId, tiles] of hs.rosterTiles) {
      expect(os.rosterTiles.get(teamId)).toEqual(tiles);
    }
  });

  it("the COMPLETE wire round-trips structurally (whole-shape deep-equal modulo Map transform)", () => {
    // Strongest single assertion: rebuild the expected webview shape from the
    // host state by applying ONLY the documented Map↔Record transform, then
    // deep-equal the entire hydrated tree against it. ANY field dropped by
    // hydrateState's hardcoded subset diverges here → RED. This is the guard
    // that catches the NEXT optional field a future host adds + forgets to
    // thread (the #222/#223/#86ca8mquy footgun) without enumerating fields.
    const host = maximalState();
    const out = roundTrip(host);

    // Expected = host with rosterTiles already a Map (it is) — the hydrated
    // shape is structurally identical to host modulo `roster` (absent here)
    // and the Map transform (which is a no-op when both sides are Maps).
    expect(out).toEqual(host);
  });

  it("documented exclusion #2 — `roster` is NOT on the state:full wire", () => {
    // Lock the intentional omission: even if a host sets `roster`, serializeState
    // must not emit it (it rides `roster:loaded`). A regression that started
    // serializing `roster` onto state:full would surface it on the wire here.
    const host = maximalState();
    host.roster = [
      { id: "claudeteam-alpha", name: "Alpha", members: [] },
    ];
    const wire = JSON.parse(
      JSON.stringify(serializeState(host)),
    ) as SerializedDashboardState & { roster?: unknown };
    expect("roster" in wire).toBe(false);
    // And it stays absent after hydration.
    const out = hydrateState(wire) as ReturnType<typeof hydrateState> & {
      roster?: unknown;
    };
    expect("roster" in out).toBe(false);
  });
});
