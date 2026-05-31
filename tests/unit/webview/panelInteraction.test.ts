/**
 * @vitest-environment jsdom
 *
 * Manage Team panel — DOM-interaction harness (ticket 86ca1u4ef) + the three
 * webview fixes (ticket 86ca1u41m). These tests MOUNT the real webview
 * components and DRIVE them through time-separated DOM events / simulated poll
 * re-renders — the interaction layer Bram's triage
 * (team/bram-research/86ca1u41m-panel-quad-triage-2026-05-30.md § "Why the
 * data-plane tests missed all four") identified as the missing coverage class.
 *
 * Each describe block is NON-VACUOUS: it fails if the corresponding fix is
 * reverted. The "reverted" failure mode is noted per block.
 *
 *   Bug A — preview roles "—" → render the auto-derived `ScannedAgent.role`.
 *           Reverting to `roleSpan.textContent = "role: —"` fails the A block.
 *   Bug B — picker vanishes on the poll re-render → survives via
 *           `pickerOpenTracker`. Reverting the tracker (or its restore-on-
 *           rebuild line) fails the B block.
 *   Bug D — "Save team" banner wiped by the interleaved `setup:detection`
 *           re-render → survives via the persisted `pendingBanner` that
 *           `renderFull` re-applies. Reverting to the imperative one-shot
 *           `showSetupBanner` fails the D block.
 *
 * Source: src/webview/components/setupWizard.ts (A)
 *         src/webview/pickerOpenTracker.ts + manageTeamPanel.ts (B)
 *         src/webview/render.ts + main.ts pendingBanner (D)
 */

import { describe, it, expect, vi } from "vitest";
import type {
  CharacterSource,
  ClaudeTeamConfig,
  ScannedAgent,
} from "../../../src/shared/types.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import { renderSetupWizard } from "../../../src/webview/components/setupWizard.js";
import {
  renderFull,
  type RenderableState,
  type RenderContext,
} from "../../../src/webview/render.js";
import { createPickerOpenTracker } from "../../../src/webview/pickerOpenTracker.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function scannedAgent(overrides: Partial<ScannedAgent> = {}): ScannedAgent {
  return {
    agentName: "felix",
    filePath: ".claude/agents/felix.md",
    role: "Extension Host Dev",
    ...overrides,
  };
}

function configWithMembers(): ClaudeTeamConfig {
  return {
    version: 1,
    teams: [
      {
        id: "claudeteam-alpha",
        name: "ClaudeTeam Alpha",
        members: [
          {
            id: "felix",
            display: "Felix",
            role: "Extension Host Dev",
            match: [{ name_prefix: "felix-" }],
            character: null,
            status: "live",
          },
          {
            id: "maya",
            display: "Maya",
            role: "Webview UI Dev",
            match: [{ name_prefix: "maya-" }],
            character: null,
            status: "live",
          },
        ],
      },
    ],
  };
}

function characterSources(): CharacterSource[] {
  return [
    {
      id: "ClaudeTeam-M01-Dev",
      label: "Dev (M01)",
      origin: "bundled",
      thumbnailPath: "sprites/ClaudeTeam-M01-Dev/thumb.png",
    },
    {
      id: "ClaudeTeam-F01-Dev",
      label: "Dev (F01)",
      origin: "bundled",
      thumbnailPath: "sprites/ClaudeTeam-F01-Dev/thumb.png",
    },
  ];
}

/**
 * Minimal RenderableState with no live sessions — the Manage Team panel branch
 * in `renderFull` short-circuits before the session walk, so an empty tree is
 * enough to drive the panel.
 */
function emptyTree(): RenderableState {
  return { sessions: [], rosterErrors: [] } as unknown as RenderableState;
}

const q = <T extends HTMLElement>(el: ParentNode, sel: string): T =>
  el.querySelector<T>(sel)!;

// ===========================================================================
// Bug A — preview step renders the scanned role text (NOT "—")
// ===========================================================================

describe("Bug A (86ca1u41m) — preview step renders the auto-derived role", () => {
  function advanceToPreview(root: HTMLElement): void {
    q<HTMLButtonElement>(root, ".ct-wizard-preview-btn").click();
  }

  it("renders 'role: <ScannedAgent.role>' for a member with a derived role", () => {
    const root = renderSetupWizard({
      scanned: [
        scannedAgent({ agentName: "felix", role: "Extension Host Dev" }),
      ],
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    advanceToPreview(root);

    const roleSpan = q<HTMLElement>(root, ".ct-wizard-preview-role");
    // This is the load-bearing assertion: reverting the fix (hardcoded
    // "role: —") makes this FAIL.
    expect(roleSpan.textContent).toBe("role: Extension Host Dev");
    expect(roleSpan.textContent).not.toBe("role: —");
  });

  it("maps each included member to its OWN scanned role (no cross-contamination)", () => {
    const root = renderSetupWizard({
      scanned: [
        scannedAgent({ agentName: "felix", role: "Extension Host Dev" }),
        scannedAgent({ agentName: "maya", role: "Webview UI Dev" }),
      ],
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    advanceToPreview(root);

    const roles = Array.from(
      root.querySelectorAll<HTMLElement>(".ct-wizard-preview-role"),
    ).map((s) => s.textContent);
    expect(roles).toEqual(["role: Extension Host Dev", "role: Webview UI Dev"]);
  });

  it("falls back to '—' only when ScannedAgent.role is absent / empty", () => {
    const root = renderSetupWizard({
      scanned: [
        scannedAgent({ agentName: "felix", role: undefined }),
        scannedAgent({ agentName: "maya", role: "" }),
      ],
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    advanceToPreview(root);

    const roles = Array.from(
      root.querySelectorAll<HTMLElement>(".ct-wizard-preview-role"),
    ).map((s) => s.textContent);
    expect(roles).toEqual(["role: —", "role: —"]);
  });

  it("excluded members are not previewed; only included keep their role", () => {
    const root = renderSetupWizard({
      scanned: [
        scannedAgent({ agentName: "felix", role: "Extension Host Dev" }),
        scannedAgent({ agentName: "maya", role: "Webview UI Dev" }),
      ],
      teamNameSeed: "ClaudeTeam",
      postMessage: vi.fn(),
    });
    // Uncheck felix on the scan step before advancing. jsdom toggles `checked`
    // on .click() but does not always fire the `change` event the wizard listens
    // for, so dispatch it explicitly (the listener reads the live `checked`).
    const felixCb = q<HTMLInputElement>(
      root,
      ".ct-wizard-agent-checkbox[data-agent-name='felix']",
    );
    felixCb.click();
    felixCb.dispatchEvent(new Event("change"));
    advanceToPreview(root);

    const roles = Array.from(
      root.querySelectorAll<HTMLElement>(".ct-wizard-preview-role"),
    ).map((s) => s.textContent);
    expect(roles).toEqual(["role: Webview UI Dev"]);
  });
});

// ===========================================================================
// Bug B — picker survives a simulated renderFull poll re-render; closes on
//         deliberate dismiss (select / clear / Esc / ✕)
// ===========================================================================

describe("Bug B (86ca1u41m) — picker survives the poll re-render", () => {
  function ctx(
    mount: HTMLElement,
    pickerOpenTracker = createPickerOpenTracker(),
    postMessage: (m: WebviewMessage) => void = vi.fn(),
  ): RenderContext {
    return {
      mount,
      postMessage,
      managePanelOpen: true,
      manageConfig: configWithMembers(),
      characterSources: characterSources(),
      teamNameSeed: "ClaudeTeam",
      spriteBaseUri: "vscode-webview://host",
      pickerOpenTracker,
    };
  }

  it("an open picker is STILL open after a full renderFull re-render", () => {
    const mount = document.createElement("div");
    const tracker = createPickerOpenTracker();

    renderFull(ctx(mount, tracker), emptyTree());
    // Open the first member's picker.
    const pickBtns = mount.querySelectorAll<HTMLButtonElement>(
      ".ct-manage-pick-btn",
    );
    pickBtns[0].click();
    expect(mount.querySelector(".ct-character-picker")).not.toBeNull();
    expect(tracker.isOpen("felix")).toBe(true);

    // Simulate the ~2s poll tick — same tracker, full rebuild of the panel.
    renderFull(ctx(mount, tracker), emptyTree());

    // Load-bearing: reverting the tracker / restore-on-rebuild makes this FAIL.
    expect(mount.querySelector(".ct-character-picker")).not.toBeNull();
    expect(
      q<HTMLButtonElement>(mount, ".ct-manage-pick-btn").getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
  });

  it("only the member whose picker was opened re-opens (not every row)", () => {
    const mount = document.createElement("div");
    const tracker = createPickerOpenTracker();

    renderFull(ctx(mount, tracker), emptyTree());
    // Open the SECOND member (maya) only.
    const pickBtns = mount.querySelectorAll<HTMLButtonElement>(
      ".ct-manage-pick-btn",
    );
    pickBtns[1].click();
    expect(tracker.isOpen("maya")).toBe(true);
    expect(tracker.isOpen("felix")).toBe(false);

    renderFull(ctx(mount, tracker), emptyTree());
    // Exactly one picker open across the whole panel.
    expect(mount.querySelectorAll(".ct-character-picker").length).toBe(1);
    // It belongs to maya's row.
    const mayaRow = q<HTMLElement>(mount, "[data-member-id='maya']");
    expect(mayaRow.querySelector(".ct-character-picker")).not.toBeNull();
  });

  it("selecting a character closes the picker AND it stays closed across re-render", () => {
    const mount = document.createElement("div");
    const tracker = createPickerOpenTracker();
    const posted: WebviewMessage[] = [];

    renderFull(ctx(mount, tracker, (m) => posted.push(m)), emptyTree());
    q<HTMLButtonElement>(mount, ".ct-manage-pick-btn").click();
    expect(mount.querySelector(".ct-character-picker")).not.toBeNull();

    // Pick the first character cell → posts ui:assign-character + onClose.
    q<HTMLButtonElement>(mount, ".ct-character-cell").click();
    expect(tracker.isOpen("felix")).toBe(false);
    expect(mount.querySelector(".ct-character-picker")).toBeNull();
    expect(posted.some((m) => m.type === "ui:assign-character")).toBe(true);

    // A re-render must NOT resurrect the picker (deliberate dismiss sticks).
    renderFull(ctx(mount, tracker, (m) => posted.push(m)), emptyTree());
    expect(mount.querySelector(".ct-character-picker")).toBeNull();
  });

  it("Esc closes the picker and it stays closed across re-render", () => {
    const mount = document.createElement("div");
    const tracker = createPickerOpenTracker();

    renderFull(ctx(mount, tracker), emptyTree());
    q<HTMLButtonElement>(mount, ".ct-manage-pick-btn").click();
    const picker = q<HTMLElement>(mount, ".ct-character-picker");
    picker.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(tracker.isOpen("felix")).toBe(false);
    expect(mount.querySelector(".ct-character-picker")).toBeNull();

    renderFull(ctx(mount, tracker), emptyTree());
    expect(mount.querySelector(".ct-character-picker")).toBeNull();
  });

  it("re-clicking the pick button toggles closed (deliberate dismiss)", () => {
    const mount = document.createElement("div");
    const tracker = createPickerOpenTracker();

    renderFull(ctx(mount, tracker), emptyTree());
    const btn = q<HTMLButtonElement>(mount, ".ct-manage-pick-btn");
    btn.click(); // open
    expect(mount.querySelector(".ct-character-picker")).not.toBeNull();
    q<HTMLButtonElement>(mount, ".ct-manage-pick-btn").click(); // close
    expect(tracker.isOpen("felix")).toBe(false);
    expect(mount.querySelector(".ct-character-picker")).toBeNull();
  });

  it("prune drops a member's open entry when it leaves the config between ticks", () => {
    const mount = document.createElement("div");
    const tracker = createPickerOpenTracker();

    renderFull(ctx(mount, tracker), emptyTree());
    q<HTMLButtonElement>(mount, ".ct-manage-pick-btn").click(); // felix open
    expect(tracker.isOpen("felix")).toBe(true);

    // Next tick: a config WITHOUT felix → prune evicts the stale entry.
    const onlyMaya: ClaudeTeamConfig = {
      version: 1,
      teams: [
        {
          id: "claudeteam-alpha",
          name: "ClaudeTeam Alpha",
          members: configWithMembers().teams[0].members.filter(
            (m) => m.id === "maya",
          ),
        },
      ],
    };
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        managePanelOpen: true,
        manageConfig: onlyMaya,
        characterSources: characterSources(),
        teamNameSeed: "ClaudeTeam",
        spriteBaseUri: "vscode-webview://host",
        pickerOpenTracker: tracker,
      },
      emptyTree(),
    );
    expect(tracker.isOpen("felix")).toBe(false);
  });
});

// ===========================================================================
// Bug D — Save banner survives the immediately-following setup:detection
//         re-render (the SEVERE "Save looks dead" symptom)
// ===========================================================================

describe("Bug D (86ca1u41m) — save banner survives the detection re-render", () => {
  /**
   * Drive the panel through the real BUG-D sequence at the render layer: the
   * boot closure sets `pendingBanner` on the save ack, then `renderFull` runs
   * for the ack AND again for the interleaved `setup:detection`. We model the
   * boot closure's `pendingBanner` as a mutable local and re-build the ctx each
   * render (exactly what `main.ts buildCtx()` does).
   */
  function makeCtx(
    mount: HTMLElement,
    pending: { kind: "success" | "error"; message: string } | null,
    onDismiss: () => void,
  ): RenderContext {
    return {
      mount,
      postMessage: vi.fn(),
      managePanelOpen: true,
      manageConfig: configWithMembers(),
      characterSources: characterSources(),
      teamNameSeed: "ClaudeTeam",
      spriteBaseUri: "vscode-webview://host",
      pendingBanner: pending,
      onPendingBannerDismiss: onDismiss,
    };
  }

  it("a 'Saved' banner is present AFTER a following setup:detection renderFull", () => {
    const mount = document.createElement("div");
    let pending: { kind: "success" | "error"; message: string } | null = null;
    const clear = (): void => {
      pending = null;
    };

    // 1. Panel open, no banner yet.
    renderFull(makeCtx(mount, pending, clear), emptyTree());
    expect(mount.querySelector(".ct-setup-banner")).toBeNull();

    // 2. Save ack → boot closure sets pendingBanner + re-renders.
    pending = { kind: "success", message: "Saved" };
    renderFull(makeCtx(mount, pending, clear), emptyTree());
    let banner = mount.querySelector<HTMLElement>(".ct-setup-banner");
    expect(banner).not.toBeNull();
    expect(banner!.dataset.kind).toBe("success");
    expect(q<HTMLElement>(mount, ".ct-setup-banner-text").textContent).toBe(
      "Saved",
    );

    // 3. The interleaved setup:detection re-render — THIS is what wiped the
    //    banner before the fix. With pendingBanner persisted, it re-applies.
    renderFull(makeCtx(mount, pending, clear), emptyTree());
    banner = mount.querySelector<HTMLElement>(".ct-setup-banner");
    // Load-bearing: reverting to the imperative one-shot showSetupBanner makes
    // this FAIL (the banner is gone after the detection re-render).
    expect(banner).not.toBeNull();
    expect(banner!.dataset.kind).toBe("success");
    expect(q<HTMLElement>(mount, ".ct-setup-banner-text").textContent).toBe(
      "Saved",
    );
  });

  it("the error banner ('Couldn't save') also survives the detection re-render", () => {
    const mount = document.createElement("div");
    let pending: { kind: "success" | "error"; message: string } | null = {
      kind: "error",
      message: "Couldn't save: disk full",
    };
    const clear = (): void => {
      pending = null;
    };

    renderFull(makeCtx(mount, pending, clear), emptyTree());
    // Interleaved detection re-render.
    renderFull(makeCtx(mount, pending, clear), emptyTree());
    const banner = mount.querySelector<HTMLElement>(".ct-setup-banner");
    expect(banner).not.toBeNull();
    expect(banner!.dataset.kind).toBe("error");
    expect(q<HTMLElement>(mount, ".ct-setup-banner-text").textContent).toBe(
      "Couldn't save: disk full",
    );
  });

  it("a null pendingBanner renders no banner (clean panel after dismiss)", () => {
    const mount = document.createElement("div");
    renderFull(
      makeCtx(mount, null, () => undefined),
      emptyTree(),
    );
    expect(mount.querySelector(".ct-setup-banner")).toBeNull();
    // The slot itself still exists (the panel always mounts it).
    expect(mount.querySelector(".ct-setup-banner-slot")).not.toBeNull();
  });

  it("the success banner auto-dismiss fires onPendingBannerDismiss exactly once", () => {
    vi.useFakeTimers();
    try {
      const mount = document.createElement("div");
      const onDismiss = vi.fn();
      const pending = { kind: "success" as const, message: "Saved" };

      renderFull(makeCtx(mount, pending, onDismiss), emptyTree());
      expect(mount.querySelector(".ct-setup-banner")).not.toBeNull();

      // Advance past the 4s auto-dismiss window.
      vi.advanceTimersByTime(4001);
      expect(mount.querySelector(".ct-setup-banner")).toBeNull();
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
