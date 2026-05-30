/**
 * @vitest-environment jsdom
 *
 * Component tests for the team-setup epic webview (TS-03). Covers the ticket
 * ACs against the merged TS-02 vocabulary:
 *   - AC3: 3 dashboard states (configured / suggest-setup / empty) switch
 *          correctly; empty-state copy EXACT-matches the LOCKED string.
 *   - AC4: suggest-setup card renders + dismisses; character-picker grid shows
 *          merged bundled+user thumbnails.
 *   - AC1/AC2: Manage Team panel edit list (display + role) + wizard
 *          include/exclude → ui:run-setup → preview → confirm; save → ui:save-team.
 *   - AC5: orphan tile renders greyed + confirm-delete → ui:confirm-orphan-delete.
 *   - NIT 1: picker empty-grid opens (not disabled) with Clear reachable.
 *   - NIT 2: success banners de-dupe (single slot, no stacking).
 *
 * Pure jsdom — no live host. The injected postMessage spy captures the wire
 * messages; the EXACT-copy constant is imported (not re-typed).
 */

import { describe, it, expect, vi } from "vitest";
import type {
  CharacterSource,
  ClaudeTeamConfig,
  ScannedAgent,
} from "../../../src/shared/types.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import { renderFull, type RenderContext } from "../../../src/webview/render.js";
import {
  renderNoSetupState,
  NO_ORCHESTRATION_SETUP_COPY,
} from "../../../src/webview/components/emptyState.js";
import { renderSuggestSetupCard } from "../../../src/webview/components/suggestSetupCard.js";
import { renderSetupWizard } from "../../../src/webview/components/setupWizard.js";
import { renderCharacterPicker } from "../../../src/webview/components/characterPicker.js";
import { renderManageTeamPanel } from "../../../src/webview/components/manageTeamPanel.js";
import {
  showSetupBanner,
  clearSetupBanner,
} from "../../../src/webview/components/setupBanner.js";
import {
  monogramFor,
  renderMonogramChip,
} from "../../../src/webview/components/monogramChip.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyTree() {
  return { sessions: [] };
}

function scanned(...names: string[]): ScannedAgent[] {
  return names.map((n) => ({ agentName: n, filePath: `/p/.claude/agents/${n}.md` }));
}

function sources(): CharacterSource[] {
  return [
    {
      id: "ClaudeTeam-M01-Dev",
      label: "felix-male",
      origin: "bundled",
      thumbnailPath: "sprites/ClaudeTeam-M01-Dev/thumb.png",
    },
    {
      id: "ClaudeTeam-F01-Dev",
      label: "maya-female",
      origin: "bundled",
      thumbnailPath: "sprites/ClaudeTeam-F01-Dev/thumb.png",
    },
    {
      id: "custom-a",
      label: "custom-a",
      origin: "user",
      thumbnailPath: "sprites/custom-a/thumb.png",
    },
  ];
}

function config(): ClaudeTeamConfig {
  return {
    version: 1,
    teams: [
      {
        id: "alpha",
        name: "ClaudeTeam Alpha",
        members: [
          {
            id: "felix",
            display: "Felix",
            role: "Host Dev",
            character: "ClaudeTeam-M01-Dev",
            status: "live",
            match: [{ agentType_equals: "felix" }],
          },
          {
            id: "maya",
            display: "Maya",
            role: "",
            character: null,
            status: "live",
            match: [{ agentType_equals: "maya" }],
          },
        ],
      },
    ],
  };
}

function baseCtx(overrides: Partial<RenderContext>): RenderContext {
  const mount = document.createElement("div");
  return {
    mount,
    postMessage: vi.fn(),
    ...overrides,
  } as RenderContext;
}


// ---------------------------------------------------------------------------
// AC3 — three dashboard states + EXACT empty copy
// ---------------------------------------------------------------------------

describe("AC3 — detection-state switch in renderFull", () => {
  it("empty → renders the no-orchestration card with the EXACT locked copy", () => {
    const ctx = baseCtx({ setup: { state: "empty", scanned: [] } });
    renderFull(ctx, emptyTree());
    const card = ctx.mount.querySelector(".ct-no-setup-state");
    expect(card).not.toBeNull();
    const copy = ctx.mount.querySelector(".ct-no-setup-copy");
    expect(copy?.textContent).toBe(
      "This project has no orchestration setup, nothing to show",
    );
    // No setup CTA in the empty state (spec §2.3).
    expect(ctx.mount.querySelector(".ct-suggest-card-setup")).toBeNull();
  });

  it("EXACT copy constant matches the verbatim locked string (no trailing period)", () => {
    expect(NO_ORCHESTRATION_SETUP_COPY).toBe(
      "This project has no orchestration setup, nothing to show",
    );
    expect(NO_ORCHESTRATION_SETUP_COPY.endsWith(".")).toBe(false);
    expect(renderNoSetupState().querySelector(".ct-no-setup-copy")?.textContent).toBe(
      NO_ORCHESTRATION_SETUP_COPY,
    );
  });

  it("suggest-setup → renders the suggest card (not dismissed)", () => {
    const ctx = baseCtx({
      setup: { state: "suggest-setup", scanned: scanned("a", "b", "c") },
    });
    renderFull(ctx, emptyTree());
    expect(ctx.mount.querySelector(".ct-suggest-card")).not.toBeNull();
    expect(ctx.mount.querySelector(".ct-no-setup-state")).toBeNull();
  });

  it("suggest-setup + dismissed → falls through to the normal dashboard", () => {
    const ctx = baseCtx({
      setup: { state: "suggest-setup", scanned: scanned("a", "b") },
      setupSuggestionDismissed: true,
    });
    renderFull(ctx, emptyTree());
    // Card suppressed; the normal empty-session path renders instead.
    expect(ctx.mount.querySelector(".ct-suggest-card")).toBeNull();
  });

  it("configured → falls through to the normal dashboard (no setup card)", () => {
    const ctx = baseCtx({ setup: { state: "configured", scanned: scanned("a") } });
    renderFull(ctx, emptyTree());
    expect(ctx.mount.querySelector(".ct-suggest-card")).toBeNull();
    expect(ctx.mount.querySelector(".ct-no-setup-state")).toBeNull();
  });

  it("no setup field at all → pre-team-setup path (back-compat)", () => {
    const ctx = baseCtx({});
    renderFull(ctx, emptyTree());
    expect(ctx.mount.querySelector(".ct-no-setup-state")).toBeNull();
    expect(ctx.mount.querySelector(".ct-suggest-card")).toBeNull();
  });

  it("managePanelOpen → the Manage Team panel replaces the dashboard body", () => {
    const ctx = baseCtx({
      managePanelOpen: true,
      manageConfig: config(),
      characterSources: sources(),
      teamNameSeed: "ClaudeTeam",
      setup: { state: "configured", scanned: scanned("felix", "maya") },
    });
    renderFull(ctx, emptyTree());
    expect(ctx.mount.querySelector(".ct-manage-panel")).not.toBeNull();
    // Edit layout (config present) → rows, not the wizard.
    expect(ctx.mount.querySelector(".ct-manage-rows")).not.toBeNull();
    expect(ctx.mount.querySelector(".ct-wizard")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC4 — suggest card render + dismiss + count line
// ---------------------------------------------------------------------------

describe("AC4 — suggest-setup card", () => {
  it("count line uses scanned.length (never hardcoded)", () => {
    const post = vi.fn();
    const card = renderSuggestSetupCard({ scannedCount: 6, postMessage: post });
    expect(card.querySelector(".ct-suggest-card-body")?.textContent).toContain(
      "6 agents",
    );
  });

  it("singular agent count reads 'agent'", () => {
    const card = renderSuggestSetupCard({ scannedCount: 1, postMessage: vi.fn() });
    expect(card.querySelector(".ct-suggest-card-body")?.textContent).toContain(
      "1 agent ",
    );
  });

  it("'Set up team' posts ui:open-manage-team", () => {
    const post = vi.fn();
    const card = renderSuggestSetupCard({ scannedCount: 3, postMessage: post });
    card.querySelector<HTMLButtonElement>(".ct-suggest-card-setup")!.click();
    expect(post).toHaveBeenCalledWith({ type: "ui:open-manage-team" });
  });

  it("✕ and 'Not now' both post ui:dismiss-setup-suggestion", () => {
    const post = vi.fn();
    const card = renderSuggestSetupCard({ scannedCount: 3, postMessage: post });
    card.querySelector<HTMLButtonElement>(".ct-suggest-card-dismiss")!.click();
    card.querySelector<HTMLButtonElement>(".ct-suggest-card-notnow")!.click();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(1, { type: "ui:dismiss-setup-suggestion" });
    expect(post).toHaveBeenNthCalledWith(2, { type: "ui:dismiss-setup-suggestion" });
  });
});

// ---------------------------------------------------------------------------
// AC2 — setup wizard
// ---------------------------------------------------------------------------

describe("AC2 — setup wizard", () => {
  it("scan step lists every agent, all checked by default", () => {
    const wiz = renderSetupWizard({
      scanned: scanned("felix", "maya", "iris"),
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    const boxes = wiz.querySelectorAll<HTMLInputElement>(
      ".ct-wizard-agent-checkbox",
    );
    expect(boxes.length).toBe(3);
    for (const b of Array.from(boxes)) expect(b.checked).toBe(true);
    expect(wiz.querySelector(".ct-wizard-count")?.textContent).toBe(
      "3 detected · 3 included",
    );
  });

  it("count line updates + Preview disables at 0 included", () => {
    const wiz = renderSetupWizard({
      scanned: scanned("felix", "maya"),
      teamNameSeed: "X",
      postMessage: vi.fn(),
    });
    const boxes = wiz.querySelectorAll<HTMLInputElement>(
      ".ct-wizard-agent-checkbox",
    );
    boxes[0].checked = false;
    boxes[0].dispatchEvent(new Event("change"));
    expect(wiz.querySelector(".ct-wizard-count")?.textContent).toBe(
      "2 detected · 1 included",
    );
    const preview = wiz.querySelector<HTMLButtonElement>(
      ".ct-wizard-preview-btn",
    )!;
    expect(preview.disabled).toBe(false);
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new Event("change"));
    expect(preview.disabled).toBe(true);
  });

  it("Preview → preview step → Confirm posts ui:run-setup with checked names", () => {
    const post = vi.fn();
    const wiz = renderSetupWizard({
      scanned: scanned("felix", "maya", "iris"),
      teamNameSeed: "ClaudeTeam",
      postMessage: post,
    });
    // Uncheck iris.
    const boxes = wiz.querySelectorAll<HTMLInputElement>(
      ".ct-wizard-agent-checkbox",
    );
    const irisBox = Array.from(boxes).find((b) => b.dataset.agentName === "iris")!;
    irisBox.checked = false;
    irisBox.dispatchEvent(new Event("change"));
    // Go to preview.
    wiz.querySelector<HTMLButtonElement>(".ct-wizard-preview-btn")!.click();
    expect(wiz.querySelector(".ct-wizard-preview-table")).not.toBeNull();
    // Preview shows the included members as monogram rows (text tile).
    const rows = wiz.querySelectorAll(".ct-wizard-preview-row");
    expect(rows.length).toBe(2);
    expect(wiz.querySelector(".ct-wizard-team-line")?.textContent).toBe(
      "Team: ClaudeTeam",
    );
    // Confirm.
    wiz.querySelector<HTMLButtonElement>(".ct-wizard-confirm-btn")!.click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:run-setup",
      payload: { include: ["felix", "maya"] },
    });
  });
});

// ---------------------------------------------------------------------------
// AC1/AC5 — Manage Team panel edit layout + orphan
// ---------------------------------------------------------------------------

describe("AC1 — Manage Team panel edit layout", () => {
  it("renders one editable row per member (display + role inputs)", () => {
    const panel = renderManageTeamPanel({
      config: config(),
      scanned: [],
      characters: sources(),
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    const rows = panel.querySelectorAll(".ct-manage-row");
    expect(rows.length).toBe(2);
    const displays = panel.querySelectorAll<HTMLInputElement>(
      ".ct-manage-input--display",
    );
    expect(displays[0].value).toBe("Felix");
    expect(displays[1].value).toBe("Maya");
  });

  it("Save posts ui:save-team with edited display/role + preserved match/status", () => {
    const post = vi.fn();
    const panel = renderManageTeamPanel({
      config: config(),
      scanned: [],
      characters: sources(),
      teamNameSeed: "ClaudeTeam",
      postMessage: post,
    });
    const mayaRole = panel.querySelectorAll<HTMLInputElement>(
      ".ct-manage-input--role",
    )[1];
    mayaRole.value = "Webview Dev";
    mayaRole.dispatchEvent(new Event("input"));
    panel.querySelector<HTMLButtonElement>(".ct-manage-save-btn")!.click();
    expect(post).toHaveBeenCalledTimes(1);
    const msg = post.mock.calls[0][0] as Extract<
      WebviewMessage,
      { type: "ui:save-team" }
    >;
    expect(msg.type).toBe("ui:save-team");
    const maya = msg.payload.config.teams[0].members[1];
    expect(maya.role).toBe("Webview Dev");
    // Immutable fields preserved verbatim.
    expect(maya.match).toEqual([{ agentType_equals: "maya" }]);
    expect(maya.status).toBe("live");
    expect(maya.id).toBe("maya");
  });

  it("empty display blocks save with an inline error (role MAY be empty)", () => {
    const post = vi.fn();
    const panel = renderManageTeamPanel({
      config: config(),
      scanned: [],
      characters: sources(),
      teamNameSeed: "X",
      postMessage: post,
    });
    const felixDisplay = panel.querySelector<HTMLInputElement>(
      ".ct-manage-input--display",
    )!;
    felixDisplay.value = "   ";
    felixDisplay.dispatchEvent(new Event("input"));
    panel.querySelector<HTMLButtonElement>(".ct-manage-save-btn")!.click();
    expect(post).not.toHaveBeenCalled();
    const err = panel.querySelector<HTMLElement>(".ct-manage-save-error")!;
    expect(err.hidden).toBe(false);
    expect(err.textContent).toBe("Display name required");
  });
});

// ---------------------------------------------------------------------------
// 86ca1tv41 — panel state machine: config gates wizard vs edit layout
//
// This is the exact branch the bug was stuck on: `manageConfig === null` forced
// the wizard forever because the host never posted `roster:loaded`. The fix
// makes the host post a non-null config → the panel reaches the edit layout
// (member rows + reachable character picker). These tests pin BOTH branches so
// a regression that re-strands the panel on the wizard fails here.
// ---------------------------------------------------------------------------

describe("86ca1tv41 — Manage Team panel layout selection by config", () => {
  it("config === null → renders the setup WIZARD, not the edit layout", () => {
    const panel = renderManageTeamPanel({
      config: null,
      scanned: scanned("felix", "maya"),
      characters: sources(),
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    // Wizard present; edit layout absent.
    expect(panel.querySelector(".ct-wizard")).not.toBeNull();
    expect(panel.querySelector(".ct-manage-edit")).toBeNull();
    expect(panel.querySelectorAll(".ct-manage-row").length).toBe(0);
  });

  it("config !== null → renders the EDIT layout (member rows), not the wizard", () => {
    const panel = renderManageTeamPanel({
      config: config(),
      scanned: scanned("felix", "maya"),
      characters: sources(),
      teamNameSeed: "ClaudeTeam",
      spriteBaseUri: "vscode-webview://host/dist/webview",
      postMessage: vi.fn(),
    });
    // Edit layout present; wizard absent.
    expect(panel.querySelector(".ct-manage-edit")).not.toBeNull();
    expect(panel.querySelector(".ct-wizard")).toBeNull();
    // One editable row per member → the picker is reachable from the edit layout.
    expect(panel.querySelectorAll(".ct-manage-row").length).toBe(2);
  });
});

describe("AC5 — orphan tile + confirm-delete + orchestrator-not-a-tile", () => {
  function orphanConfig(): ClaudeTeamConfig {
    const c = config();
    c.teams[0].members.push({
      id: "ghost",
      display: "Ghost",
      role: "",
      character: null,
      status: "orphaned",
      match: [{ agentType_equals: "ghost" }],
    });
    return c;
  }

  it("orphaned member renders greyed with a Delete member button (no editable inputs)", () => {
    const panel = renderManageTeamPanel({
      config: orphanConfig(),
      scanned: [],
      characters: sources(),
      teamNameSeed: "X",
      postMessage: vi.fn(),
    });
    const orphanRow = panel.querySelector(".ct-manage-row--orphaned")!;
    expect(orphanRow).not.toBeNull();
    expect(orphanRow.querySelector(".ct-manage-orphan-badge")?.textContent).toContain(
      "orphaned",
    );
    expect(
      orphanRow.querySelector(".ct-manage-orphan-delete-btn"),
    ).not.toBeNull();
  });

  it("Delete → confirm → posts ui:confirm-orphan-delete; confirm panel starts hidden", () => {
    const post = vi.fn();
    const panel = renderManageTeamPanel({
      config: orphanConfig(),
      scanned: [],
      characters: sources(),
      teamNameSeed: "X",
      postMessage: post,
    });
    const orphanRow = panel.querySelector(".ct-manage-row--orphaned")!;
    const confirm = orphanRow.querySelector<HTMLElement>(
      ".ct-manage-orphan-confirm",
    )!;
    // Starts hidden (the [hidden]-guarded popover).
    expect(confirm.hidden).toBe(true);
    orphanRow
      .querySelector<HTMLButtonElement>(".ct-manage-orphan-delete-btn")!
      .click();
    expect(confirm.hidden).toBe(false);
    confirm
      .querySelector<HTMLButtonElement>(".ct-manage-orphan-confirm-btn")!
      .click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:confirm-orphan-delete",
      payload: { memberId: "ghost" },
    });
  });

  it("orchestrator never appears — the panel only renders config members (none synthesized)", () => {
    const panel = renderManageTeamPanel({
      config: config(),
      scanned: scanned("felix", "maya"),
      characters: sources(),
      teamNameSeed: "X",
      postMessage: vi.fn(),
    });
    // Exactly the 2 config members — no extra "orchestrator"/"main" row.
    const rows = panel.querySelectorAll(".ct-manage-row");
    expect(rows.length).toBe(2);
    const ids = Array.from(rows).map((r) => (r as HTMLElement).dataset.memberId);
    expect(ids).toEqual(["felix", "maya"]);
  });
});

// ---------------------------------------------------------------------------
// AC4 — character picker + NIT 1 empty grid
// ---------------------------------------------------------------------------

describe("AC4 — character picker grid", () => {
  it("renders one cell per source with label + origin badge (merged bundled+user)", () => {
    const picker = renderCharacterPicker({
      memberId: "maya",
      display: "Maya",
      sources: sources(),
      current: null,
      spriteBaseUri: "vscode-webview://x/dist/webview",
      postMessage: vi.fn(),
    });
    const cells = picker.querySelectorAll(".ct-character-cell");
    expect(cells.length).toBe(3);
    const origins = Array.from(
      picker.querySelectorAll(".ct-character-origin"),
    ).map((e) => e.textContent);
    expect(origins).toEqual(["bundled", "bundled", "user"]);
    // Every cell has a text label (no icon-only).
    expect(picker.querySelectorAll(".ct-character-label").length).toBe(3);
  });

  it("selecting a cell posts ui:assign-character with the source id", () => {
    const post = vi.fn();
    const onClose = vi.fn();
    const picker = renderCharacterPicker({
      memberId: "maya",
      display: "Maya",
      sources: sources(),
      current: null,
      postMessage: post,
      onClose,
    });
    picker
      .querySelector<HTMLButtonElement>(
        '.ct-character-cell[data-character-id="custom-a"]',
      )!
      .click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:assign-character",
      payload: { memberId: "maya", character: "custom-a" },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("Clear posts ui:assign-character with character:null (text tile)", () => {
    const post = vi.fn();
    const picker = renderCharacterPicker({
      memberId: "maya",
      display: "Maya",
      sources: sources(),
      current: "custom-a",
      postMessage: post,
    });
    picker.querySelector<HTMLButtonElement>(".ct-character-picker-clear")!.click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:assign-character",
      payload: { memberId: "maya", character: null },
    });
  });

  it("highlights the currently-assigned cell via aria-selected", () => {
    const picker = renderCharacterPicker({
      memberId: "maya",
      display: "Maya",
      sources: sources(),
      current: "ClaudeTeam-F01-Dev",
      postMessage: vi.fn(),
    });
    const selected = picker.querySelector(
      '.ct-character-cell[data-character-id="ClaudeTeam-F01-Dev"]',
    )!;
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.classList.contains("ct-character-cell--selected")).toBe(true);
  });

  // NIT 1 — empty grid behavior (open, not disabled; Clear reachable).
  it("NIT 1: empty sources → picker OPENS with 'No characters available' + Clear still works", () => {
    const post = vi.fn();
    const picker = renderCharacterPicker({
      memberId: "maya",
      display: "Maya",
      sources: [],
      current: "stale-id",
      postMessage: post,
    });
    // Grid shows the empty message; no cells.
    expect(picker.querySelector(".ct-character-cell")).toBeNull();
    expect(picker.querySelector(".ct-character-picker-empty")?.textContent).toBe(
      "No characters available",
    );
    // Clear is present + active (NOT disabled) so a stale assignment can reset.
    const clear = picker.querySelector<HTMLButtonElement>(
      ".ct-character-picker-clear",
    )!;
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(post).toHaveBeenCalledWith({
      type: "ui:assign-character",
      payload: { memberId: "maya", character: null },
    });
  });
});

// ---------------------------------------------------------------------------
// NIT 2 — success banners de-dupe (single slot)
// ---------------------------------------------------------------------------

describe("NIT 2 — setup banner single-slot de-dupe", () => {
  it("a second banner REPLACES the first (no stacking)", () => {
    const slot = document.createElement("div");
    const noSched = (_cb: () => void, _ms: number): number => 0;
    showSetupBanner({
      slot,
      kind: "success",
      message: "Team created",
      schedule: noSched,
    });
    showSetupBanner({
      slot,
      kind: "success",
      message: "Saved",
      schedule: noSched,
    });
    const banners = slot.querySelectorAll(".ct-setup-banner");
    expect(banners.length).toBe(1);
    expect(banners[0].textContent).toBe("Saved");
  });

  it("success auto-dismisses; error persists (role=alert)", () => {
    const slot = document.createElement("div");
    let fired: (() => void) | null = null;
    const sched = (cb: () => void): number => {
      fired = cb;
      return 1;
    };
    showSetupBanner({
      slot,
      kind: "success",
      message: "Saved",
      schedule: sched,
    });
    expect(slot.querySelector(".ct-setup-banner--success")).not.toBeNull();
    fired!();
    expect(slot.querySelector(".ct-setup-banner")).toBeNull();

    showSetupBanner({
      slot,
      kind: "error",
      message: "Couldn't save: disk full",
      schedule: sched,
    });
    const err = slot.querySelector(".ct-setup-banner--error")!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toBe("Couldn't save: disk full");
  });

  it("replacing a banner cancels the prior auto-dismiss timer", () => {
    const slot = document.createElement("div");
    const cancel = vi.fn();
    showSetupBanner({
      slot,
      kind: "success",
      message: "Team created",
      schedule: () => 42,
      cancel,
    });
    showSetupBanner({
      slot,
      kind: "success",
      message: "Saved",
      schedule: () => 43,
      cancel,
    });
    expect(cancel).toHaveBeenCalledWith(42);
  });

  it("clearSetupBanner empties the slot + cancels the timer", () => {
    const slot = document.createElement("div");
    const cancel = vi.fn();
    showSetupBanner({
      slot,
      kind: "success",
      message: "Saved",
      schedule: () => 7,
      cancel,
    });
    clearSetupBanner(slot, cancel);
    expect(slot.querySelector(".ct-setup-banner")).toBeNull();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});

// ---------------------------------------------------------------------------
// Monogram helper
// ---------------------------------------------------------------------------

describe("monogram chip (text-tile fallback)", () => {
  it("two words → first letters of each, uppercased", () => {
    expect(monogramFor("Felix Host")).toBe("FH");
  });
  it("one word → first two letters", () => {
    expect(monogramFor("Maya")).toBe("MA");
    expect(monogramFor("felix")).toBe("FE");
  });
  it("empty → '?' fallback", () => {
    expect(monogramFor("")).toBe("?");
    expect(monogramFor("   ")).toBe("?");
  });
  it("renders an aria-hidden chip (display name carries identity for AT)", () => {
    const chip = renderMonogramChip({ display: "Maya" });
    expect(chip.textContent).toBe("MA");
    expect(chip.getAttribute("aria-hidden")).toBe("true");
  });
});
