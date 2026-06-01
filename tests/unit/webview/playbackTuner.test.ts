/**
 * @vitest-environment jsdom
 *
 * Playback Tuner — Layer-2.5 DOM-interaction harness (E5 86ca2189v, AC4).
 *
 * MOUNTs the real `renderPlaybackTuner` component and DRIVES it through
 * time-separated DOM events (slider input, radio change, [reset] click) under
 * fake timers, then asserts the FUNCTIONAL outcome on the DOM / on captured
 * `postMessage`s. Per testing-strategy.md § Layer-2.5, these functional
 * behaviors are NOT sponsor-deferred — only the sprite's visual FEEL is.
 *
 * Each block is NON-VACUOUS — a mutation probe fails it (the failure mode is
 * noted per block):
 *
 *  - Preview update (AC2): the preview box rebuilds on a control change. Reverting
 *    `onControlChange`'s rebuild-on-discrete / debounced-preview makes the
 *    "preview reflects the draft" assertion fail.
 *  - Debounced save (AC2): N rapid slider inputs coalesce to ONE trailing
 *    `ui:save-playback-override` carrying the FINAL value + correct target.
 *    Reverting the trailing-edge debounce (fire-per-input) fails the "exactly
 *    one save" assertion; sending the wrong target fails the payload assertion.
 *  - Mode change → field set/clear (§3.4): pingpong sets the field; loop CLEARS
 *    it (absent == loop). Reverting the clear (always-set "loop") fails the
 *    "loop omits playbackMode" assertion.
 *  - Cascade source (AC3): the per-field source table renders effective value +
 *    layer tag, resolved INDEPENDENTLY per field.
 *  - Field omission == clear (§4.1): [reset] removes the field from the saved
 *    payload.
 *
 * Source: team/iris-design/anim-tuner-spec.md §3-§6.
 */

import { describe, it, expect, vi } from "vitest";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";
import {
  renderPlaybackTuner,
  PREVIEW_DEBOUNCE_MS,
  SAVE_DEBOUNCE_MS,
} from "../../../src/webview/components/playbackTuner.js";
import { createTunerStateTracker } from "../../../src/webview/tunerStateTracker.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A manifest with two characters; M01 carries a per-char `idle_stretch`
 * playback override (speed 0.5) so the cascade source table is exercised.
 */
function fixtureManifest(): GeneratedSpriteManifest {
  return {
    characters: {
      "ClaudeTeam-M01-Dev": {
        character: "ClaudeTeam-M01-Dev",
        defaultIdle: "idle_stretch",
        idlePool: ["idle_stretch", "idle_coffee"],
        animations: {
          idle_stretch: {
            folder: "stretch",
            frames: ["sprites/m01/stretch/0.png", "sprites/m01/stretch/1.png", "sprites/m01/stretch/2.png"],
            playback: { speedMultiplier: 0.5 },
          },
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
        animations: {
          idle_coffee: {
            folder: "coffee",
            frames: ["sprites/f01/coffee/0.png", "sprites/f01/coffee/1.png"],
          },
        },
      },
    },
    poseDefaults: {
      idle_stretch: { playbackMode: "pingpong", finalDwellMs: 800 },
    },
  } as unknown as GeneratedSpriteManifest;
}

const q = <T extends HTMLElement>(el: ParentNode, sel: string): T =>
  el.querySelector<T>(sel)!;

interface Harness {
  root: HTMLElement;
  posted: WebviewMessage[];
}

/**
 * Mount the tuner with fake timers. The sprite-box frame scheduler is a no-op so
 * the preview builds its DOM without spinning a real animation timer in jsdom.
 */
function mount(
  overrides: Partial<Parameters<typeof renderPlaybackTuner>[0]> = {},
): Harness {
  const posted: WebviewMessage[] = [];
  const root = renderPlaybackTuner({
    manifest: fixtureManifest(),
    spriteBaseUri: "vscode-webview://host/dist/webview",
    postMessage: (m) => posted.push(m),
    // no-op sprite-box scheduler: build frames but never tick.
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
    ...overrides,
  });
  return { root, posted };
}

/** Last save message of the given target, if any. */
function lastSave(posted: WebviewMessage[]) {
  const saves = posted.filter((m) => m.type === "ui:save-playback-override");
  return saves[saves.length - 1] as
    | Extract<WebviewMessage, { type: "ui:save-playback-override" }>
    | undefined;
}

// ===========================================================================
// AC1 — the three controls render + are wired to the manifest
// ===========================================================================

describe("AC1 — controls render", () => {
  it("renders the speed + hold sliders, the mode radios, and write-target radios", () => {
    const { root } = mount();
    expect(root.querySelector(".ct-tuner-speed .ct-tuner-slider")).not.toBeNull();
    expect(root.querySelector(".ct-tuner-hold .ct-tuner-slider")).not.toBeNull();
    expect(root.querySelectorAll(".ct-tuner-mode-radio").length).toBe(2);
    expect(root.querySelectorAll(".ct-tuner-writetarget-radio").length).toBe(2);
  });

  // 86ca2apxn #4 — the Hold (final) slider ceiling was raised 2000 → 10000ms so
  // the sponsor can dial in multi-second cup-down / apex holds. NON-VACUOUS:
  // reverting HOLD_MAX to 2000 fails the `max` assertion AND clamps the 8000ms
  // input back to 2000, failing the readout + save assertions.
  it("Hold (final) slider accepts up to 10000ms (raised from 2000)", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const slider = q<HTMLInputElement>(root, ".ct-tuner-hold .ct-tuner-slider");
      expect(slider.max).toBe("10000");
      // The max-bound label reflects the new ceiling.
      const bounds = q<HTMLElement>(root, ".ct-tuner-hold .ct-tuner-bounds");
      expect(bounds.textContent).toContain("10000 ms");
      // A value above the OLD 2000 ceiling is now accepted (not clamped down).
      slider.value = "8000";
      slider.dispatchEvent(new Event("input"));
      expect(
        q<HTMLElement>(root, ".ct-tuner-hold .ct-tuner-control-readout").textContent,
      ).toBe("8000 ms");
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      const save = lastSave(posted)!;
      expect(save.payload.override.finalDwellMs).toBe(8000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("populates the character + animation selectors from the manifest", () => {
    const { root } = mount();
    const chars = Array.from(
      root.querySelectorAll<HTMLOptionElement>(".ct-tuner-char-select option"),
    ).map((o) => o.value);
    expect(chars).toEqual(["ClaudeTeam-M01-Dev", "ClaudeTeam-F01-Dev"]);
    // M01 default-idle is idle_stretch → it's the selected anim.
    expect(q<HTMLSelectElement>(root, ".ct-tuner-anim-select").value).toBe(
      "idle_stretch",
    );
  });

  // 86ca2bqe1 — the apex-hold group renders a frame-index PICKER (bounded to the
  // anim's frame count + an "Off" option) and an apex-ms SLIDER.
  it("renders the Hold (apex) frame picker + ms slider", () => {
    const { root } = mount();
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    // idle_stretch has 3 frames → "Off" + frame 0/1/2 = 4 options.
    const opts = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(["", "0", "1", "2"]);
    // Picker defaults to "Off" (no apex hold baked on the fixture).
    expect(picker.value).toBe("");
    expect(root.querySelector(".ct-tuner-apex-ms .ct-tuner-slider")).not.toBeNull();
  });

  // 86ca2bqe1 — the picker is BOUNDED to the live anim's frame count and
  // re-derived when the (char, anim) changes (M01 stretch=3 frames, F01 coffee=2).
  it("re-bounds the apex frame picker to the new anim's frame count on char change", () => {
    const { root } = mount();
    const charSel = q<HTMLSelectElement>(root, ".ct-tuner-char-select");
    charSel.value = "ClaudeTeam-F01-Dev";
    charSel.dispatchEvent(new Event("change"));
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    // F01 idle_coffee has 2 frames → "Off" + frame 0/1.
    const opts = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(["", "0", "1"]);
  });

  it("re-populates the animation selector when the character changes", () => {
    const { root } = mount();
    const charSel = q<HTMLSelectElement>(root, ".ct-tuner-char-select");
    charSel.value = "ClaudeTeam-F01-Dev";
    charSel.dispatchEvent(new Event("change"));
    const anims = Array.from(
      root.querySelectorAll<HTMLOptionElement>(".ct-tuner-anim-select option"),
    ).map((o) => o.value);
    // F01 only has idle_coffee.
    expect(anims).toEqual(["idle_coffee"]);
  });

  it("write-target defaults to 'This character' (per-char) — the safer scope", () => {
    const { root } = mount();
    const perChar = q<HTMLInputElement>(
      root,
      ".ct-tuner-writetarget-radio[data-target='per-char']",
    );
    expect(perChar.checked).toBe(true);
  });

  it("empty-state: no bundled characters → 'No sprite characters' message", () => {
    const root = renderPlaybackTuner({
      manifest: { characters: {} } as unknown as GeneratedSpriteManifest,
      postMessage: vi.fn(),
    });
    expect(q<HTMLElement>(root, ".ct-tuner-empty").textContent).toContain(
      "No sprite characters",
    );
  });
});

// ===========================================================================
// AC3 — cascade source table (effective value + layer, field-independent)
// ===========================================================================

describe("AC3 — cascade source table renders effective value + layer per field", () => {
  it("idle_stretch: speed=per-char (0.50×), mode=pose-default (pingpong), hold=pose-default (800 ms)", () => {
    const { root } = mount();
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(".ct-tuner-source-value"),
    );
    const byField = new Map<string, HTMLElement>();
    for (const r of rows) byField.set(r.dataset.field!, r);

    const speed = byField.get("speed")!;
    expect(speed.dataset.layer).toBe("per-char");
    expect(q<HTMLElement>(speed, ".ct-tuner-source-effective").textContent).toBe(
      "0.50×",
    );

    const mode = byField.get("mode")!;
    expect(mode.dataset.layer).toBe("pose-default");
    expect(q<HTMLElement>(mode, ".ct-tuner-source-effective").textContent).toBe(
      "pingpong",
    );

    const hold = byField.get("hold")!;
    // hold inherits the pose-default finalDwellMs (800) — NOT engine 400 — proving
    // field-level inheritance even though speed is per-char.
    expect(hold.dataset.layer).toBe("pose-default");
    expect(q<HTMLElement>(hold, ".ct-tuner-source-effective").textContent).toBe(
      "800 ms",
    );
  });
});

// ===========================================================================
// AC2 — slider drives the live preview within the debounce window
// ===========================================================================

describe("AC2 — preview rebuilds on a control change", () => {
  it("the preview box renders for the selected anim and rebuilds on a mode flip", () => {
    vi.useFakeTimers();
    try {
      const { root } = mount();
      const box = () =>
        root.querySelector<HTMLElement>(".ct-tuner-preview-host .sprite-box");
      expect(box()).not.toBeNull();
      // The forced pose for idle_stretch is the idle pick → dataset.pose.
      expect(box()!.dataset.pose).toBe("idle_stretch");

      // Flip mode to pingpong (discrete → immediate rebuild, no debounce wait).
      const pingpong = q<HTMLInputElement>(
        root,
        ".ct-tuner-mode-radio[data-mode='pingpong']",
      );
      pingpong.checked = true;
      pingpong.dispatchEvent(new Event("change"));
      // A fresh box exists (rebuilt) and still plays idle_stretch.
      expect(box()).not.toBeNull();
      expect(box()!.dataset.pose).toBe("idle_stretch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a slider drag schedules a debounced preview rebuild (short window)", () => {
    vi.useFakeTimers();
    try {
      const { root } = mount();
      const slider = q<HTMLInputElement>(root, ".ct-tuner-speed .ct-tuner-slider");
      slider.value = "1.5";
      slider.dispatchEvent(new Event("input"));
      // The readout updates immediately (synchronous), proving the input wired.
      expect(
        q<HTMLElement>(root, ".ct-tuner-speed .ct-tuner-control-readout")
          .textContent,
      ).toBe("1.50×");
      // Advance the preview debounce so the rebuild fires (no throw).
      vi.advanceTimersByTime(PREVIEW_DEBOUNCE_MS + 1);
      expect(
        root.querySelector(".ct-tuner-preview-host .sprite-box"),
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// AC2 — debounced save fires once with the correct payload + target
// ===========================================================================

describe("AC2 — debounced save → ONE trailing ui:save-playback-override", () => {
  it("N rapid slider inputs coalesce to exactly ONE save with the FINAL value", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const slider = q<HTMLInputElement>(root, ".ct-tuner-speed .ct-tuner-slider");

      for (const v of ["0.6", "0.8", "1.0", "1.2"]) {
        slider.value = v;
        slider.dispatchEvent(new Event("input"));
        vi.advanceTimersByTime(50); // < SAVE_DEBOUNCE_MS each → resets the timer
      }
      // No save yet (still inside the trailing window).
      expect(posted.filter((m) => m.type === "ui:save-playback-override").length).toBe(0);

      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      const saves = posted.filter((m) => m.type === "ui:save-playback-override");
      // Load-bearing: ONE save, the FINAL value. Per-input firing fails this.
      expect(saves.length).toBe(1);
      const save = lastSave(posted)!;
      expect(save.payload.override.speedMultiplier).toBe(1.2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("per-char save carries writeTarget 'per-char' + the selected characterFolder + anim", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const slider = q<HTMLInputElement>(root, ".ct-tuner-hold .ct-tuner-slider");
      slider.value = "1000";
      slider.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      expect(save.payload.writeTarget).toBe("per-char");
      expect(save.payload.characterFolder).toBe("ClaudeTeam-M01-Dev");
      expect(save.payload.animName).toBe("idle_stretch");
      expect(save.payload.override.finalDwellMs).toBe(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("choosing 'All characters' makes the save target pose-default with NO characterFolder", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      // Flip the write target to pose-default.
      const allChars = q<HTMLInputElement>(
        root,
        ".ct-tuner-writetarget-radio[data-target='pose-default']",
      );
      allChars.checked = true;
      allChars.dispatchEvent(new Event("change"));
      // Then change a value to trigger a save.
      const slider = q<HTMLInputElement>(root, ".ct-tuner-speed .ct-tuner-slider");
      slider.value = "1.0";
      slider.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      // Load-bearing: target routed to pose-default, characterFolder omitted.
      expect(save.payload.writeTarget).toBe("pose-default");
      expect(save.payload.characterFolder).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// §3.4 — mode change sets pingpong / CLEARS on loop (absent == loop)
// ===========================================================================

describe("§3.4 — playbackMode set on pingpong, CLEARED on loop", () => {
  it("pingpong → override carries playbackMode:'pingpong'", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const pingpong = q<HTMLInputElement>(
        root,
        ".ct-tuner-mode-radio[data-mode='pingpong']",
      );
      pingpong.checked = true;
      pingpong.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);
      expect(lastSave(posted)!.payload.override.playbackMode).toBe("pingpong");
    } finally {
      vi.useRealTimers();
    }
  });

  it("loop → playbackMode is OMITTED from the saved override (minimal json)", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      // First set pingpong, then back to loop.
      const pingpong = q<HTMLInputElement>(
        root,
        ".ct-tuner-mode-radio[data-mode='pingpong']",
      );
      pingpong.checked = true;
      pingpong.dispatchEvent(new Event("change"));
      const loop = q<HTMLInputElement>(
        root,
        ".ct-tuner-mode-radio[data-mode='loop']",
      );
      loop.checked = true;
      loop.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      // Load-bearing: loop CLEARS the field. Reverting to always-set "loop" fails.
      expect("playbackMode" in save.payload.override).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// §4.1 — field omission == clear ([reset] removes the field from the payload)
// ===========================================================================

describe("§4.1 — [reset] clears a field from the saved override", () => {
  it("setting then [reset]ing speed removes speedMultiplier from the payload", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const slider = q<HTMLInputElement>(root, ".ct-tuner-speed .ct-tuner-slider");
      slider.value = "1.5";
      slider.dispatchEvent(new Event("input"));
      // Now reset the speed field.
      q<HTMLButtonElement>(root, ".ct-tuner-speed .ct-tuner-reset").click();
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      // Load-bearing: the field is cleared, so it's absent (→ inherits on rebuild).
      expect("speedMultiplier" in save.payload.override).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// §3.6 — persistence banner reflects the save ack (honesty surface)
// ===========================================================================

describe("§3.6 — persistence banner", () => {
  it("idle state (no ack) shows the neutral 'auto-save' hint", () => {
    const { root } = mount({ saveAck: null });
    expect(q<HTMLElement>(root, ".ct-tuner-banner-text").textContent).toContain(
      "auto-save",
    );
  });

  it("ok ack → success banner names the per-char file + 'Rebuild + reload'", () => {
    const { root } = mount({ saveAck: { ok: true } });
    const banner = q<HTMLElement>(root, ".ct-tuner-banner");
    expect(banner.dataset.kind).toBe("success");
    expect(q<HTMLElement>(root, ".ct-tuner-banner-text").textContent).toContain(
      "ClaudeTeam-M01-Dev/animations.json",
    );
    expect(q<HTMLElement>(root, ".ct-tuner-banner-text").textContent).toContain(
      "Rebuild + reload",
    );
  });

  it("error ack → error banner surfaces the message", () => {
    const { root } = mount({ saveAck: { ok: false, error: "disk full" } });
    const banner = q<HTMLElement>(root, ".ct-tuner-banner");
    expect(banner.dataset.kind).toBe("error");
    expect(q<HTMLElement>(root, ".ct-tuner-banner-text").textContent).toContain(
      "disk full",
    );
  });
});

// ===========================================================================
// §3.7 — shadowing warning when pose-default target but a per-char field wins
// ===========================================================================

describe("§3.7 — shadowing warning", () => {
  it("warns when targeting pose-default while a per-char field shadows it", () => {
    const { root } = mount();
    // idle_stretch has a per-char speedMultiplier. Switch target to pose-default.
    const allChars = q<HTMLInputElement>(
      root,
      ".ct-tuner-writetarget-radio[data-target='pose-default']",
    );
    allChars.checked = true;
    allChars.dispatchEvent(new Event("change"));
    const warn = q<HTMLElement>(root, ".ct-tuner-shadow-warning");
    expect(warn.hidden).toBe(false);
    expect(warn.textContent).toContain("per-char");
  });

  it("no warning while the per-char target is selected", () => {
    const { root } = mount();
    expect(q<HTMLElement>(root, ".ct-tuner-shadow-warning").hidden).toBe(true);
  });
});

// ===========================================================================
// Close affordance — Escape + ✕ both invoke onClose
// ===========================================================================

describe("close affordance", () => {
  it("Escape closes the panel", () => {
    const onClose = vi.fn();
    const { root } = mount({ onClose });
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the ✕ button closes the panel", () => {
    const onClose = vi.fn();
    const { root } = mount({ onClose });
    q<HTMLButtonElement>(root, ".ct-tuner-close").click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// BLOCKER B1 (86ca2189v) — poll-tick survivability of the open tuner's state
//
// THE LOAD-BEARING test (testing-strategy.md § Layer-2.5 — REQUIRED, non-vacuous).
// The dashboard polls every ~2s; each `state:full` fires `renderFull`, which
// (with tunerPanelOpen===true) ROOT-SWAPS a fresh `renderPlaybackTuner`. Before
// the fix every tick reset selection→first-char, draft→{}, writeTarget→per-char,
// sliders→cascade-defaults, and the post-save banner named the RESET file — so
// the panel was unusable. The fix hoists the four survivable fields
// (selectedChar / selectedAnim / draftOverride / writeTarget) into a webview-
// local `tunerStateTracker` that the boot closure threads through every render;
// the freshly-built tuner SEEDS from it on mount and WRITES BACK on every change.
//
// NON-VACUITY (verified by revert-probe): reverting the B1 fix — i.e. NOT
// seeding the fresh mount from the tracker (`renderPlaybackTuner`'s
// `persistedValid` seed → first-char defaults) — makes EVERY assertion below
// FAIL: the remounted panel reverts to ClaudeTeam-M01-Dev / idle_stretch /
// per-char / empty-draft, and the banner names M01's file instead of F01's.
// (Re-running with the seed deleted: char select reverts to M01, anim to
// idle_stretch, slider readout to the cascade default, draft assertions fail,
// banner names the wrong file.)
// ===========================================================================

/**
 * Simulate the ~2s poll-tick root-swap: `renderFull` builds a FRESH tuner with
 * the SAME tracker instance (mirroring main.ts/render.ts threading the boot-
 * closure tracker through every render). Returns the new root.
 */
function pollTickRemount(
  tracker: ReturnType<typeof createTunerStateTracker>,
  overrides: Partial<Parameters<typeof renderPlaybackTuner>[0]> = {},
): { root: HTMLElement; posted: WebviewMessage[] } {
  const posted: WebviewMessage[] = [];
  const root = renderPlaybackTuner({
    manifest: fixtureManifest(),
    spriteBaseUri: "vscode-webview://host/dist/webview",
    postMessage: (m) => posted.push(m),
    stateTracker: tracker,
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
    ...overrides,
  });
  return { root, posted };
}

describe("B1 (86ca2189v) — open tuner state survives the ~2s poll-tick renderFull", () => {
  it("selection + draft + writeTarget + slider positions ALL survive a poll-tick remount", () => {
    vi.useFakeTimers();
    try {
      const tracker = createTunerStateTracker();

      // First mount with the tracker (the open panel).
      const first = renderPlaybackTuner({
        manifest: fixtureManifest(),
        spriteBaseUri: "vscode-webview://host/dist/webview",
        postMessage: () => undefined,
        stateTracker: tracker,
        scheduleFrame: () => 0,
        cancelFrame: () => undefined,
      });

      // The sponsor tunes: pick F01, set the write target to pose-default,
      // drag speed to 1.5×, drag hold to 1000ms, choose pingpong.
      const charSel = q<HTMLSelectElement>(first, ".ct-tuner-char-select");
      charSel.value = "ClaudeTeam-F01-Dev";
      charSel.dispatchEvent(new Event("change"));

      const poseDefault = q<HTMLInputElement>(
        first,
        ".ct-tuner-writetarget-radio[data-target='pose-default']",
      );
      poseDefault.checked = true;
      poseDefault.dispatchEvent(new Event("change"));

      const speedSlider = q<HTMLInputElement>(
        first,
        ".ct-tuner-speed .ct-tuner-slider",
      );
      speedSlider.value = "1.5";
      speedSlider.dispatchEvent(new Event("input"));

      const holdSlider = q<HTMLInputElement>(
        first,
        ".ct-tuner-hold .ct-tuner-slider",
      );
      holdSlider.value = "1000";
      holdSlider.dispatchEvent(new Event("input"));

      const pingpong = q<HTMLInputElement>(
        first,
        ".ct-tuner-mode-radio[data-mode='pingpong']",
      );
      pingpong.checked = true;
      pingpong.dispatchEvent(new Event("change"));

      // ── The poll tick fires: renderFull root-swaps a fresh tuner. ──
      const { root: second } = pollTickRemount(tracker);

      // Selection survived.
      expect(q<HTMLSelectElement>(second, ".ct-tuner-char-select").value).toBe(
        "ClaudeTeam-F01-Dev",
      );
      expect(q<HTMLSelectElement>(second, ".ct-tuner-anim-select").value).toBe(
        "idle_coffee",
      );

      // Write target survived (the pose-default radio is still checked).
      expect(
        q<HTMLInputElement>(
          second,
          ".ct-tuner-writetarget-radio[data-target='pose-default']",
        ).checked,
      ).toBe(true);

      // Slider positions survived (the readouts reflect the drafted values).
      expect(
        q<HTMLElement>(second, ".ct-tuner-speed .ct-tuner-control-readout")
          .textContent,
      ).toBe("1.50×");
      expect(
        q<HTMLElement>(second, ".ct-tuner-hold .ct-tuner-control-readout")
          .textContent,
      ).toBe("1000 ms");

      // Mode survived (pingpong radio still checked).
      expect(
        q<HTMLInputElement>(
          second,
          ".ct-tuner-mode-radio[data-mode='pingpong']",
        ).checked,
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the restored draft is what the NEXT save emits (draft survives, not just the controls)", () => {
    vi.useFakeTimers();
    try {
      const tracker = createTunerStateTracker();

      const first = renderPlaybackTuner({
        manifest: fixtureManifest(),
        spriteBaseUri: "vscode-webview://host/dist/webview",
        postMessage: () => undefined,
        stateTracker: tracker,
        scheduleFrame: () => 0,
        cancelFrame: () => undefined,
      });
      // Set speed on M01/idle_stretch.
      const speedSlider = q<HTMLInputElement>(
        first,
        ".ct-tuner-speed .ct-tuner-slider",
      );
      speedSlider.value = "1.75";
      speedSlider.dispatchEvent(new Event("input"));

      // Poll tick — fresh tuner.
      const { root: second, posted } = pollTickRemount(tracker);

      // Without touching anything, change hold so a save fires; the save must
      // carry BOTH the restored speed AND the new hold — proving the draft
      // (not just the slider readout) survived into the new closure.
      const holdSlider = q<HTMLInputElement>(
        second,
        ".ct-tuner-hold .ct-tuner-slider",
      );
      holdSlider.value = "500";
      holdSlider.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      expect(save.payload.override.speedMultiplier).toBe(1.75);
      expect(save.payload.override.finalDwellMs).toBe(500);
      // Still targeting M01 per-char (selection survived).
      expect(save.payload.characterFolder).toBe("ClaudeTeam-M01-Dev");
      expect(save.payload.animName).toBe("idle_stretch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("post-save banner names the CORRECT file after the save-ack re-render (B1 symptom 2)", () => {
    const tracker = createTunerStateTracker();

    // First mount: the sponsor selects F01 (per-char target).
    const first = renderPlaybackTuner({
      manifest: fixtureManifest(),
      spriteBaseUri: "vscode-webview://host/dist/webview",
      postMessage: () => undefined,
      stateTracker: tracker,
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    const charSel = q<HTMLSelectElement>(first, ".ct-tuner-char-select");
    charSel.value = "ClaudeTeam-F01-Dev";
    charSel.dispatchEvent(new Event("change"));

    // The save-ack arrives → onPlaybackOverrideSaved fires renderFull, which
    // root-swaps a fresh tuner with saveAck:{ok:true}. The banner filename is
    // computed from the RESTORED selectedChar — so it must name F01, not the
    // reset first-char (M01).
    const { root: second } = pollTickRemount(tracker, {
      saveAck: { ok: true },
    });

    const bannerText = q<HTMLElement>(
      second,
      ".ct-tuner-banner-text",
    ).textContent;
    expect(bannerText).toContain("ClaudeTeam-F01-Dev/animations.json");
    expect(bannerText).not.toContain("ClaudeTeam-M01-Dev/animations.json");
  });

  it("a fresh open (tracker reset) starts at first-char defaults — no stale restore", () => {
    const tracker = createTunerStateTracker();
    // Prior session left F01 selected.
    const first = renderPlaybackTuner({
      manifest: fixtureManifest(),
      spriteBaseUri: "vscode-webview://host/dist/webview",
      postMessage: () => undefined,
      stateTracker: tracker,
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    const charSel = q<HTMLSelectElement>(first, ".ct-tuner-char-select");
    charSel.value = "ClaudeTeam-F01-Dev";
    charSel.dispatchEvent(new Event("change"));

    // Panel close → boot closure resets the tracker. Re-open builds fresh.
    tracker.reset();
    const { root: reopened } = pollTickRemount(tracker);
    expect(
      q<HTMLSelectElement>(reopened, ".ct-tuner-char-select").value,
    ).toBe("ClaudeTeam-M01-Dev");
  });
});

// ===========================================================================
// 86ca2bqe1 — Hold (apex): frame picker + ms slider → dwellFrameIndex/dwellMs
//
// AC1 render is covered above. These cover AC2 (picker + slider drive the save
// with the apex pair on the correct target), AC3 (cascade source rows for the
// two new fields), AC4 (non-vacuous DOM-interaction — a mutation probe fails
// them), and B1 survivability (the apex draft survives a poll-tick remount).
//
// NON-VACUITY notes per block below state the revert that breaks each.
// ===========================================================================

describe("86ca2bqe1 AC2 — apex picker + ms slider drive the saved override", () => {
  it("picking a frame + dragging the ms slider saves dwellFrameIndex + dwellMs", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      // Pick apex frame 1.
      const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
      picker.value = "1";
      picker.dispatchEvent(new Event("change"));
      // Drag the apex ms slider to 2500.
      const slider = q<HTMLInputElement>(root, ".ct-tuner-apex-ms .ct-tuner-slider");
      slider.value = "2500";
      slider.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      // Load-bearing: both apex fields ride on the override with the right target.
      // Reverting the dwellFrameIndex / dwellMs wiring drops them from the payload.
      expect(save.payload.override.dwellFrameIndex).toBe(1);
      expect(save.payload.override.dwellMs).toBe(2500);
      expect(save.payload.writeTarget).toBe("per-char");
      expect(save.payload.characterFolder).toBe("ClaudeTeam-M01-Dev");
      expect(save.payload.animName).toBe("idle_stretch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("choosing 'Off' CLEARS both apex fields from the saved override", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
      // First set an apex hold (frame 2 + ms).
      picker.value = "2";
      picker.dispatchEvent(new Event("change"));
      const slider = q<HTMLInputElement>(root, ".ct-tuner-apex-ms .ct-tuner-slider");
      slider.value = "1500";
      slider.dispatchEvent(new Event("input"));
      // Then turn it Off.
      picker.value = "";
      picker.dispatchEvent(new Event("change"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      // Load-bearing: Off clears BOTH (an index-less dwellMs has nothing to hold).
      // Reverting the Off→clear path leaves a stale dwellFrameIndex/dwellMs.
      expect("dwellFrameIndex" in save.payload.override).toBe(false);
      expect("dwellMs" in save.payload.override).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("apex [reset] clears both fields from the payload", () => {
    vi.useFakeTimers();
    try {
      const { root, posted } = mount();
      const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
      picker.value = "1";
      picker.dispatchEvent(new Event("change"));
      q<HTMLButtonElement>(root, ".ct-tuner-apex-reset").click();
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      expect("dwellFrameIndex" in save.payload.override).toBe(false);
      expect("dwellMs" in save.payload.override).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("picking an apex frame rebuilds the live preview (AC1 — drives preview)", () => {
    vi.useFakeTimers();
    try {
      const { root } = mount();
      const box = () =>
        root.querySelector<HTMLElement>(".ct-tuner-preview-host .sprite-box");
      expect(box()).not.toBeNull();
      const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
      picker.value = "1";
      picker.dispatchEvent(new Event("change"));
      // Discrete change → immediate rebuild; a fresh box still plays the anim.
      expect(box()).not.toBeNull();
      expect(box()!.dataset.pose).toBe("idle_stretch");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("86ca2bqe1 AC3 — apex source-table rows render effective value + layer", () => {
  it("no baked apex → 'apex frame' row shows none (engine default); 'apex hold' shows 600 ms", () => {
    const { root } = mount();
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(".ct-tuner-source-value"),
    );
    const byField = new Map<string, HTMLElement>();
    for (const r of rows) byField.set(r.dataset.field!, r);

    const apexFrame = byField.get("apex frame")!;
    expect(apexFrame.dataset.layer).toBe("engine default");
    expect(
      q<HTMLElement>(apexFrame, ".ct-tuner-source-effective").textContent,
    ).toBe("none");

    const apexHold = byField.get("apex hold")!;
    expect(apexHold.dataset.layer).toBe("engine default");
    expect(
      q<HTMLElement>(apexHold, ".ct-tuner-source-effective").textContent,
    ).toBe("600 ms");
  });

  it("a baked per-char apex pair surfaces value + per-char tag", () => {
    const manifest = fixtureManifest();
    manifest.characters["ClaudeTeam-M01-Dev"].animations.idle_stretch.playback = {
      dwellFrameIndex: 2,
      dwellMs: 2000,
    };
    const { root } = mount({ manifest });
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(".ct-tuner-source-value"),
    );
    const byField = new Map<string, HTMLElement>();
    for (const r of rows) byField.set(r.dataset.field!, r);

    const apexFrame = byField.get("apex frame")!;
    expect(apexFrame.dataset.layer).toBe("per-char");
    expect(
      q<HTMLElement>(apexFrame, ".ct-tuner-source-effective").textContent,
    ).toBe("frame 2");
    const apexHold = byField.get("apex hold")!;
    expect(
      q<HTMLElement>(apexHold, ".ct-tuner-source-effective").textContent,
    ).toBe("2000 ms");
  });
});

describe("86ca2bqe1 B1 — apex draft survives the ~2s poll-tick renderFull", () => {
  it("the picked apex frame + ms survive a poll-tick remount and ride the next save", () => {
    vi.useFakeTimers();
    try {
      const tracker = createTunerStateTracker();
      const first = renderPlaybackTuner({
        manifest: fixtureManifest(),
        spriteBaseUri: "vscode-webview://host/dist/webview",
        postMessage: () => undefined,
        stateTracker: tracker,
        scheduleFrame: () => 0,
        cancelFrame: () => undefined,
      });
      // Tune an apex hold on M01/idle_stretch: frame 2 + 3000 ms.
      const picker = q<HTMLSelectElement>(first, ".ct-tuner-apex-frame");
      picker.value = "2";
      picker.dispatchEvent(new Event("change"));
      const slider = q<HTMLInputElement>(first, ".ct-tuner-apex-ms .ct-tuner-slider");
      slider.value = "3000";
      slider.dispatchEvent(new Event("input"));

      // ── Poll tick: a fresh tuner is built with the SAME tracker. ──
      const { root: second, posted } = pollTickRemount(tracker);

      // The restored picker shows the drafted frame; the ms readout the drafted ms.
      expect(
        q<HTMLSelectElement>(second, ".ct-tuner-apex-frame").value,
      ).toBe("2");
      expect(
        q<HTMLElement>(second, ".ct-tuner-apex-ms .ct-tuner-control-readout")
          .textContent,
      ).toBe("3000 ms");

      // A new save (nudge speed) carries the SURVIVED apex pair — proving the
      // draft (not just the control surface) round-tripped through the tracker.
      // NON-VACUOUS: reverting the tracker carrying dwellFrameIndex/dwellMs (they
      // ride inside draftOverride, which the tracker clones) drops them here.
      const speedSlider = q<HTMLInputElement>(
        second,
        ".ct-tuner-speed .ct-tuner-slider",
      );
      speedSlider.value = "1.25";
      speedSlider.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1);

      const save = lastSave(posted)!;
      expect(save.payload.override.dwellFrameIndex).toBe(2);
      expect(save.payload.override.dwellMs).toBe(3000);
      expect(save.payload.override.speedMultiplier).toBe(1.25);
    } finally {
      vi.useRealTimers();
    }
  });
});
