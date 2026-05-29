/**
 * @vitest-environment jsdom
 *
 * Component tests for the roster-baseline `"available"` (never-run) tile skin
 * (E-05 / 86ca19uk1, whole-team-display-spec §2.2/§2.3).
 *
 * The visual treatment of `available` lives in dashboard.css (the quiet dot
 * color + the rows-2-4 opacity rule); jsdom does not apply stylesheets, so
 * these tests assert the DOM HOOKS the CSS keys on — `data-state="available"`
 * on the article AND the dot, the literal `available` activity text, the
 * "Available" aria-label — plus AC5 sprite-composition behavior. The actual
 * pixel rendering (quiet blue-grey dot, dim rows) is verified visually in the
 * Self-Test Report manual-reload screenshots; these tests lock the contract
 * the CSS selectors depend on so a future tile refactor can't silently
 * detach the never-run skin.
 *
 * Coverage:
 *   - AC1: available tile carries data-state="available" on article + dot,
 *          so the CSS quiet-dot + dim-rows rules apply; aria-label reads
 *          "Available".
 *   - AC2: the tile consumes the literal "available" activity verbatim (no
 *          tool line, no "tool:?" suppression collision).
 *   - AC5: available + sprite-bound member → sprite box rendered AND the
 *          baseline data-state still present (sprite + baseline compose).
 *          available + sprite-less member → text-only baseline tile, no
 *          <img>, no broken sprite box (no regression to E-04 fallback).
 *
 * Source: team/iris-ux/whole-team-display-spec.md §2.2, §2.3, §3.4
 *         src/webview/components/agentTile.ts
 *         src/webview/styles/dashboard.css (.state-dot[data-state="available"],
 *           .agent-tile[data-state="available"] .tile-row--{role,activity,model})
 */

import { describe, it, expect, vi } from "vitest";
import { renderAgentTile } from "../../../src/webview/components/agentTile.js";
import { createSpriteTracker } from "../../../src/webview/spriteTracker.js";
import type { AgentTile } from "../../../src/shared/types.js";

const BASE = "vscode-webview://abc/dist/webview";

/** A baseline never-run tile as the reducer seeds it (types.ts § available):
 * agentId "", toolUseId null, model "model:?", activity "available". */
function availableTile(overrides: Partial<AgentTile> = {}): AgentTile {
  return {
    memberId: "nora",
    teamId: "claudeteam-alpha",
    display: "Nora",
    role: "Planning Lead",
    activity: "available",
    model: "model:?",
    state: "available",
    agentId: "",
    toolUseId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC1 — the never-run skin's CSS hooks
// ---------------------------------------------------------------------------

describe("available tile — data-state hooks for the never-run skin (AC1)", () => {
  it("stamps data-state=\"available\" on both the article and the dot", () => {
    const el = renderAgentTile({
      tile: availableTile(),
      sessionId: "s1",
      postMessage: vi.fn(),
    });

    // Article-level hook drives the dim-rows rule
    // (.agent-tile[data-state="available"] .tile-row--*).
    expect(el.getAttribute("data-state")).toBe("available");

    // Dot-level hook drives the quiet blue-grey background
    // (.state-dot[data-state="available"]).
    const dot = el.querySelector(".state-dot");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("data-state")).toBe("available");
  });

  it("reads the \"Available\" label on the aria-label and dot title", () => {
    const el = renderAgentTile({
      tile: availableTile(),
      sessionId: "s1",
      postMessage: vi.fn(),
    });

    expect(el.getAttribute("aria-label")).toBe(
      "Nora — Planning Lead — Available",
    );
    const dot = el.querySelector(".state-dot");
    expect(dot?.getAttribute("aria-label")).toBe("Available");
    expect(dot?.getAttribute("title")).toBe("Available");
  });

  it("does NOT pulse / check / member-color (no running-dot custom prop)", () => {
    // available is a static low-key dot — the running-only member-color
    // override must not leak onto it even if a memberColor were present.
    const el = renderAgentTile({
      tile: availableTile({ memberColor: "#5d8aa8" }),
      sessionId: "s1",
      postMessage: vi.fn(),
    });
    expect(el.style.getPropertyValue("--ct-color-running-dot")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// AC2 — literal "available" activity, no tool line
// ---------------------------------------------------------------------------

describe("available tile — activity row (AC2)", () => {
  it("renders the literal muted word \"available\" as the activity (no tool line)", () => {
    const el = renderAgentTile({
      tile: availableTile(),
      sessionId: "s1",
      postMessage: vi.fn(),
    });

    const activity = el.querySelector(".agent-activity");
    expect(activity).not.toBeNull();
    expect(activity?.textContent).toBe("available");
  });

  it("does not collide with the \"tool:?\" sentinel-suppression branch", () => {
    // The tile hides row 3 only for the exact "tool:?" string; "available"
    // must render, not be suppressed.
    const el = renderAgentTile({
      tile: availableTile(),
      sessionId: "s1",
      postMessage: vi.fn(),
    });
    expect(el.querySelector(".tile-row--activity")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC5 — sprite composition (with + without a bound sprite)
// ---------------------------------------------------------------------------

describe("available tile — sprite composition (AC5)", () => {
  it("a sprite-bound available member shows the sprite AND keeps the baseline skin", () => {
    // "maya" is a sprite-bound member in the manifest (E-04). An available
    // Maya must render the idle-pool sprite (E-04 pose mapping) AND still
    // carry the baseline data-state so the never-run skin applies on top.
    const el = renderAgentTile({
      tile: availableTile({ memberId: "maya", display: "Maya" }),
      sessionId: "s1",
      postMessage: vi.fn(),
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
      reducedMotion: true, // static single frame — no timers in the test
    });

    expect(el.dataset.hasSprite).toBe("true");
    expect(el.querySelector("img, canvas, .sprite-box")).not.toBeNull();
    // Baseline skin composes on top of the sprite.
    expect(el.getAttribute("data-state")).toBe("available");
    expect(el.querySelector(".agent-activity")?.textContent).toBe("available");
  });

  it("a sprite-less available member renders a text-only baseline tile (no broken image)", () => {
    // A roster member with no sprite binding must degrade to the text-only
    // baseline tile — no sprite box, no <img>, no data-has-sprite. (Monogram
    // fallback is a separate downstream concern; E-05 must not regress E-04's
    // text-only fallback.)
    const el = renderAgentTile({
      tile: availableTile({ memberId: "no-such-member" }),
      sessionId: "s1",
      postMessage: vi.fn(),
      spriteBaseUri: BASE,
      spriteTracker: createSpriteTracker(),
    });

    expect(el.dataset.hasSprite).toBeUndefined();
    expect(el.querySelector("img")).toBeNull();
    // Still a fully-functional baseline tile.
    expect(el.getAttribute("data-state")).toBe("available");
    expect(el.querySelector(".state-dot")?.getAttribute("data-state")).toBe(
      "available",
    );
    expect(el.querySelector(".agent-activity")?.textContent).toBe("available");
  });
});
