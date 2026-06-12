/**
 * @vitest-environment jsdom
 *
 * Playback Tuner — SCENE PICKER row (scene-per-pose feature 86ca88nvd · Iris spec
 * §1). Layer-2.5 DOM-interaction: MOUNT the real `renderPlaybackTuner` and DRIVE
 * the scene `<select>` through DOM events under fake timers, asserting FUNCTIONAL
 * outcomes (picker contents, live preview backdrop swap, the save payload's
 * `sceneId`, the re-seed-from-overlay across char switches, the effective-source
 * line, the Inherit/None semantics). Per testing-strategy.md § Layer-2.5 these
 * functional behaviors are NOT sponsor-deferred — only the visual dissolve feel is.
 *
 * NON-VACUITY (revert-probe, per block):
 *  - Picker contents: dropping the Inherit/None sentinels or the per-scene-id
 *    options fails the "three options at N=1" assertion.
 *  - Live preview update: reverting `applySceneDraft`'s `preview.setScene` call
 *    fails the "preview backdrop tracks the draft" assertion.
 *  - Save payload: dropping `sceneId` from `emitSave` fails the save assertion.
 *  - Re-seed: reverting the overlay scene routing (PR #216 NIT) OR the
 *    `seedSceneControl` overlay read fails the "char-switch-and-back re-seeds the
 *    saved scene" assertion (the #213/#214 class).
 *  - Inherit falls through: selecting Inherit clears `sceneId` from the save.
 */

import { describe, it, expect, vi } from "vitest";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";
import {
  renderPlaybackTuner,
  getTunerPanelHandle,
  SAVE_DEBOUNCE_MS,
} from "../../../src/webview/components/playbackTuner.js";
import { createTunerStateTracker } from "../../../src/webview/tunerStateTracker.js";
import { createLiveManifestOverlay } from "../../../src/webview/liveManifestOverlay.js";

const BASE = "vscode-webview://host/dist/webview";

/**
 * A manifest with a 2-room scene registry + two characters. M01 ships the
 * desk-clash seed at the pose-default layer (active_work → none) so the cascade
 * + Inherit label exercise the §7 reality. The picker N=1 reality (one real
 * scene) is NOT the registry size — V1 ships one room — so this fixture also
 * exercises a 2-room registry to prove the per-id option loop.
 */
function fixtureManifest(): GeneratedSpriteManifest {
  return {
    characters: {
      "ClaudeTeam-M01-Dev": {
        character: "ClaudeTeam-M01-Dev",
        defaultIdle: "idle_coffee",
        idlePool: ["idle_coffee"],
        activePool: [],
        animations: {
          idle_coffee: {
            folder: "coffee",
            frames: ["sprites/m01/coffee/0.png", "sprites/m01/coffee/1.png"],
          },
        },
      },
      "ClaudeTeam-F01-Dev": {
        character: "ClaudeTeam-F01-Dev",
        defaultIdle: "idle_coffee",
        idlePool: ["idle_coffee"],
        activePool: [],
        animations: {
          idle_coffee: {
            folder: "coffee",
            frames: ["sprites/f01/coffee/0.png", "sprites/f01/coffee/1.png"],
          },
        },
      },
    },
    scenes: {
      defaultSceneId: "room3",
      byId: {
        room3: { id: "room3", image: "sprites/scenes/room3.png" },
        room5: { id: "room5", image: "sprites/scenes/room5.png" },
      },
    },
  } as unknown as GeneratedSpriteManifest;
}

const q = <T extends HTMLElement>(el: ParentNode, sel: string): T =>
  el.querySelector<T>(sel)!;

interface Harness {
  root: HTMLElement;
  posted: WebviewMessage[];
}

function mount(
  overrides: Partial<Parameters<typeof renderPlaybackTuner>[0]> = {},
): Harness {
  const posted: WebviewMessage[] = [];
  const root = renderPlaybackTuner({
    manifest: fixtureManifest(),
    spriteBaseUri: BASE,
    postMessage: (m) => posted.push(m),
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
    ...overrides,
  });
  return { root, posted };
}

function lastSave(posted: WebviewMessage[]) {
  const saves = posted.filter((m) => m.type === "ui:save-playback-override");
  return saves[saves.length - 1] as
    | (Extract<WebviewMessage, { type: "ui:save-playback-override" }> & {
        payload: { override: { sceneId?: string } };
      })
    | undefined;
}

const sceneSelect = (root: HTMLElement): HTMLSelectElement =>
  q<HTMLSelectElement>(root, ".ct-tuner-scene-select");
const preview = (root: HTMLElement): HTMLElement =>
  q<HTMLElement>(root, ".ct-tuner-preview-box");

// ===========================================================================
// §1.2 — the scene <select> renders the LOCKED option set
// ===========================================================================

describe("scene picker — option set + order (§1.2 / §1.4)", () => {
  it("renders Inherit + None + one option per scene id, in that order", () => {
    const { root } = mount();
    const opts = Array.from(sceneSelect(root).options).map((o) => o.value);
    // Inherit sentinel first, None second, then the scene ids.
    expect(opts[0]).toBe("__inherit__");
    expect(opts[1]).toBe("none");
    expect(opts.slice(2)).toEqual(["room3", "room5"]);
  });

  it("the default scene id is annotated `(default)` (§1.2 option 3)", () => {
    const { root } = mount();
    const room3Opt = Array.from(sceneSelect(root).options).find(
      (o) => o.value === "room3",
    )!;
    expect(room3Opt.textContent).toContain("(default)");
  });

  it("defaults to Inherit when no scene override exists (§1.2)", () => {
    const { root } = mount();
    expect(sceneSelect(root).value).toBe("__inherit__");
  });

  it("the Inherit label shows the inherited resolution (§1.2 option 1)", () => {
    const { root } = mount();
    const inheritOpt = sceneSelect(root).options[0];
    // No per-char / pose-default → floor → room3.
    expect(inheritOpt.textContent).toContain("room3");
  });
});

// ===========================================================================
// §1.5 — pick → live preview backdrop update (functional, NOT sponsor-deferred)
// ===========================================================================

describe("scene picker — live preview backdrop tracks the draft (§1.5)", () => {
  it("picking a scene id sets the preview's data-scene-bg + url to that scene", () => {
    const { root } = mount();
    const sel = sceneSelect(root);
    sel.value = "room5";
    sel.dispatchEvent(new Event("change"));
    const box = preview(root);
    expect(box.hasAttribute("data-scene-bg")).toBe(true);
    expect(box.style.getPropertyValue("--ct-scene-url")).toContain(
      "sprites/scenes/room5.png",
    );
  });

  it("picking None removes the preview backdrop (flat card, §1.5)", () => {
    const { root } = mount();
    const sel = sceneSelect(root);
    // First pick a real scene so the box has a backdrop to remove.
    sel.value = "room5";
    sel.dispatchEvent(new Event("change"));
    expect(preview(root).hasAttribute("data-scene-bg")).toBe(true);
    // Now pick None → flat card.
    sel.value = "none";
    sel.dispatchEvent(new Event("change"));
    expect(preview(root).hasAttribute("data-scene-bg")).toBe(false);
  });

  it("a draft change crossfades the preview (data-scene-transition stamped, §3)", () => {
    const { root } = mount();
    const sel = sceneSelect(root);
    // Inherit → room5 is a backdrop CHANGE (room3 → room5) → crossfade.
    sel.value = "room5";
    sel.dispatchEvent(new Event("change"));
    expect(preview(root).getAttribute("data-scene-transition")).toBe("cross");
  });
});

// ===========================================================================
// §5.3 — the scene field rides the save round-trip as `sceneId`
// ===========================================================================

describe("scene picker — save payload carries sceneId (§5.3)", () => {
  it("picking a scene id emits a debounced save with override.sceneId", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const sel = sceneSelect(root);
      sel.value = "room5";
      sel.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      const save = lastSave(posted)!;
      expect(save.payload.override.sceneId).toBe("room5");
      // Default write target = per-char.
      expect(save.payload.writeTarget).toBe("per-char");
      expect(save.payload.characterFolder).toBe("ClaudeTeam-M01-Dev");
    } finally {
      vi.useRealTimers();
    }
  });

  it("picking None emits a save with override.sceneId === \"none\" (§5.2)", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const sel = sceneSelect(root);
      sel.value = "none";
      sel.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      expect(lastSave(posted)!.payload.override.sceneId).toBe("none");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Inherit CLEARS the field — the save omits sceneId (field-omission == clear, §5.3)", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const sel = sceneSelect(root);
      // Set a scene, then reset to Inherit.
      sel.value = "room5";
      sel.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      sel.value = "__inherit__";
      sel.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      const save = lastSave(posted)!;
      expect("sceneId" in save.payload.override).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the [reset] button clears the field → Inherit (§1.2)", () => {
    const { root } = mount();
    const sel = sceneSelect(root);
    sel.value = "room5";
    sel.dispatchEvent(new Event("change"));
    expect(sel.value).toBe("room5");
    q<HTMLButtonElement>(root, ".ct-tuner-scene-reset").click();
    expect(sel.value).toBe("__inherit__");
  });
});

// ===========================================================================
// §1.3 — the effective-source line + shadowing warning
// ===========================================================================

describe("scene picker — effective-source line + shadowing warning (§1.3)", () => {
  it("the source line names the resolved scene + cascade layer", () => {
    const { root } = mount();
    const line = q<HTMLElement>(root, ".ct-tuner-scene-source");
    // No override → floor → room3.
    expect(line.textContent).toContain("Default");
    expect(line.textContent).toContain("room3");
  });

  it("a per-char scene save makes the source line read Per-char (re-seed via overlay)", () => {
    vi.useFakeTimers();
    const overlay = createLiveManifestOverlay();
    try {
      const { root } = mount({ liveOverlay: overlay });
      const sel = sceneSelect(root);
      sel.value = "room5";
      sel.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      // Confirm the save (ok ack) THROUGH THE PANEL — this records the pending save
      // into the overlay AND refreshes the panel's effective manifest, exactly as
      // production does. (Recording into the overlay directly would not refresh the
      // panel's cached manifest — the bug we must NOT reintroduce.)
      getTunerPanelHandle(root)!.applySaveAck({ ok: true });
      // Re-seed (re-select the same anim) → the source line reads Per-char.
      sel.dispatchEvent(new Event("change"));
      const line = q<HTMLElement>(root, ".ct-tuner-scene-source");
      expect(line.textContent).toContain("Per-char");
      expect(line.textContent).toContain("room5");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pose-default target + per-char scene wins → scene shadowing warning fires (§1.3)", () => {
    const overlay = createLiveManifestOverlay();
    // Seed a confirmed per-char scene save in the overlay so the cascade resolves
    // per-char for this (char, anim).
    overlay.record({
      writeTarget: "per-char",
      characterFolder: "ClaudeTeam-M01-Dev",
      animName: "idle_coffee",
      override: { sceneId: "room5" },
    });
    const { root } = mount({ liveOverlay: overlay });
    // Flip the write target to pose-default (All characters).
    const poseDefaultRadio = q<HTMLInputElement>(
      root,
      '.ct-tuner-writetarget-radio[data-target="pose-default"]',
    );
    poseDefaultRadio.checked = true;
    poseDefaultRadio.dispatchEvent(new Event("change"));
    const warn = q<HTMLElement>(root, ".ct-tuner-scene-shadow");
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toContain("scene per-char");
  });
});

// ===========================================================================
// The #213/#214 stale-re-seed class for the SCENE block — the load-bearing fence
// ===========================================================================

describe("scene picker — in-session save re-seeds across char switch (#213/#214 class)", () => {
  it("save scene on M01 → switch to F01 → back to M01 re-seeds the saved scene from the overlay", () => {
    vi.useFakeTimers();
    const overlay = createLiveManifestOverlay();
    try {
      const { root } = mount({ liveOverlay: overlay });
      const charSel = q<HTMLSelectElement>(root, ".ct-tuner-char-select");
      const sel = sceneSelect(root);
      // 1. On M01, pick room5 + save.
      sel.value = "room5";
      sel.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      // 2. Confirm the save via the panel's ok-ack (records into the overlay +
      // refreshes the effective manifest, exactly as production does).
      getTunerPanelHandle(root)!.applySaveAck({ ok: true });
      // 3. Switch to F01.
      charSel.value = "ClaudeTeam-F01-Dev";
      charSel.dispatchEvent(new Event("change"));
      // F01 has no scene override → Inherit.
      expect(sceneSelect(root).value).toBe("__inherit__");
      // 4. Switch back to M01 → the picker re-seeds room5 FROM THE OVERLAY (not the
      // stale baked manifest, which never carried room5). This is the #213/#214
      // class extended to the scene block.
      charSel.value = "ClaudeTeam-M01-Dev";
      charSel.dispatchEvent(new Event("change"));
      expect(sceneSelect(root).value).toBe("room5");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// Poll-tick survivability — the scene draft survives a re-render (B1 class)
// ===========================================================================

describe("scene picker — draft survives the poll-tick re-render (tracker)", () => {
  it("a picked scene survives a fresh renderPlaybackTuner mount via the tracker", () => {
    const tracker = createTunerStateTracker();
    const { root } = mount({ stateTracker: tracker });
    const sel = sceneSelect(root);
    sel.value = "room5";
    sel.dispatchEvent(new Event("change"));
    // Simulate the poll tick: a SECOND mount with the SAME tracker (renderFull
    // root-swaps a fresh tuner each ~2s).
    const root2 = renderPlaybackTuner({
      manifest: fixtureManifest(),
      spriteBaseUri: BASE,
      postMessage: () => undefined,
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
      stateTracker: tracker,
    });
    // The fresh panel restores the picked scene from the tracker.
    expect(sceneSelect(root2).value).toBe("room5");
  });
});
