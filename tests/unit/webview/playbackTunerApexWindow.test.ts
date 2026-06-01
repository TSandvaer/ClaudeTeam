/**
 * @vitest-environment jsdom
 *
 * Playback Tuner — apex-frame picker is bounded to the ACTIVE WINDOW (86ca2w1g9).
 *
 * SPONSOR SYMPTOM: on M01 idle_stretch (baked window [5,10]) the apex hold
 * "works for frame 6 and up but not below frame 6" — i.e. apex frames 0–4 (and
 * the confusing turnaround at 5) appeared to do nothing. ROOT CAUSE: the picker
 * offered frames 0..count-1 (the FULL clip), but the loop only renders frames in
 * the window [startFrame, endFrame]; an apex outside the window is never reached,
 * so its dwell silently never fires — with no indication why (the window is not a
 * tuner control). FIX: the picker offers ONLY [startFrame..endFrame] so every
 * selectable apex frame is actually reachable, and the engine arms the apex when
 * it is within [winStart, winEnd] (inclusive — startFrame IS a valid apex).
 *
 * NON-VACUITY (mutation-verified 2026-06-01 against playbackTuner.ts):
 *  - "picker offers only the window frames": FAILS if `populateApexFrames`
 *    reverts to the full-clip `for (i=0; i<count; i++)` loop — frames 0–4 reappear.
 *  - "startFrame is a selectable, working apex (boundary inclusive)": FAILS if
 *    the window bound excludes startFrame (e.g. `i > start`) — frame 5 would be
 *    dropped from the picker.
 *  - "no-window anim offers the full clip": FAILS if the window resolution
 *    wrongly clamps a no-window anim (guards against over-correction).
 *
 * Source: testing-strategy.md § Layer-2.5; team/iris-design/anim-tuner-spec.md §3.
 */

import { describe, it, expect } from "vitest";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";
import { renderPlaybackTuner } from "../../../src/webview/components/playbackTuner.js";

const q = <T extends HTMLElement>(el: ParentNode, sel: string): T =>
  el.querySelector<T>(sel)!;

/**
 * Manifest whose M01 `idle_stretch` carries an 11-frame clip with a baked window
 * [5,10] (the real shipped shape) + a pose-default pingpong. F01 `idle_coffee`
 * has NO window (full-clip picker control case).
 */
function windowedManifest(): GeneratedSpriteManifest {
  return {
    characters: {
      "ClaudeTeam-M01-Dev": {
        character: "ClaudeTeam-M01-Dev",
        defaultIdle: "idle_stretch",
        idlePool: ["idle_stretch"],
        animations: {
          idle_stretch: {
            folder: "stretch",
            frames: Array.from({ length: 11 }, (_, i) => `sprites/m01/stretch/${i}.png`),
            playback: {
              speedMultiplier: 0.5,
              startFrame: 5,
              endFrame: 10,
              playbackMode: "pingpong",
              finalDwellMs: 800,
            },
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
            frames: Array.from({ length: 9 }, (_, i) => `sprites/f01/coffee/${i}.png`),
            playback: { speedMultiplier: 0.5, dwellFrameIndex: 4 },
          },
        },
      },
    },
    poseDefaults: {},
  } as unknown as GeneratedSpriteManifest;
}

function mount() {
  return renderPlaybackTuner({
    manifest: windowedManifest(),
    spriteBaseUri: "vscode-webview://host/dist/webview",
    postMessage: () => undefined,
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
  });
}

describe("apex frame picker is bounded to the active window (86ca2w1g9)", () => {
  it("offers ONLY the window frames [5..10] for M01 idle_stretch — not 0–4", () => {
    const root = mount();
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    const opts = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    // "Off" + frames 5..10 only. Frames 0–4 (outside the window) are NOT offered.
    expect(opts).toEqual(["", "5", "6", "7", "8", "9", "10"]);
    expect(opts).not.toContain("0");
    expect(opts).not.toContain("4");
  });

  it("startFrame (5) IS a selectable apex — the window boundary is inclusive", () => {
    const root = mount();
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    const values = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    expect(values).toContain("5"); // winStart is a valid, reachable apex
    expect(values).toContain("10"); // winEnd is too
  });

  it("a NO-window anim still offers the full clip (over-correction guard)", () => {
    const root = mount();
    // Switch to F01 idle_coffee (9 frames, no startFrame/endFrame).
    const charSel = q<HTMLSelectElement>(root, ".ct-tuner-char-select");
    charSel.value = "ClaudeTeam-F01-Dev";
    charSel.dispatchEvent(new Event("change"));
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    const opts = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    // "Off" + frames 0..8 — the full clip, since no window is declared.
    expect(opts).toEqual(["", "0", "1", "2", "3", "4", "5", "6", "7", "8"]);
  });
});

// ===========================================================================
// 86ca2cg8a gap #2 — an OUT-OF-RANGE baked apex frame index RESETS to "Off"
// on picker re-bind (initial seed + char/anim change).
//
// The apex-window block above asserts the OPTION LIST excludes out-of-window
// frames. This block is the DIRECT, distinct assertion the NIT called out:
// when the CASCADE supplies a `dwellFrameIndex` that lands OUTSIDE the active
// window, `populateApexFrames(preferIndex)` must resolve the picker's selected
// `.value` to "Off" (APEX_FRAME_OFF) — NOT silently leave a stale, unreachable
// frame selected (whose dwell the windowed loop never fires). Covered for both
// an initial-mount seed AND a char-switch re-bind, and for a baked index that
// is BELOW the window start as well as ABOVE the window end.
//
// NON-VACUITY (mutation-verified 2026-06-01 against playbackTuner.ts line ~944):
//  the picker's `.value` assignment is
//    typeof preferIndex === "number" && preferIndex >= start && preferIndex <= end
//      ? String(preferIndex) : APEX_FRAME_OFF
//  Reverting the bound check to `typeof preferIndex === "number" ? String(...)`
//  (i.e. dropping the `>= start && <= end` clamp) makes the picker keep the
//  out-of-window index selected — every assertion below FAILS (the picker would
//  read "2" / "12" instead of "").
// ===========================================================================

/**
 * Manifest where the BAKED apex sits OUTSIDE the active window:
 *  - M01 idle_stretch: 11-frame clip, window [5,10], baked dwellFrameIndex 2
 *    (BELOW winStart 5 → unreachable → must reset to "Off").
 *  - F01 idle_drink: 8-frame clip, window [2,5], baked dwellFrameIndex 7
 *    (ABOVE winEnd 5 → unreachable → must reset to "Off").
 */
function outOfWindowApexManifest(): GeneratedSpriteManifest {
  return {
    characters: {
      "ClaudeTeam-M01-Dev": {
        character: "ClaudeTeam-M01-Dev",
        defaultIdle: "idle_stretch",
        idlePool: ["idle_stretch"],
        animations: {
          idle_stretch: {
            folder: "stretch",
            frames: Array.from({ length: 11 }, (_, i) => `sprites/m01/stretch/${i}.png`),
            playback: {
              startFrame: 5,
              endFrame: 10,
              dwellFrameIndex: 2, // BELOW the window → unreachable
              dwellMs: 1500,
            },
          },
        },
      },
      "ClaudeTeam-F01-Dev": {
        character: "ClaudeTeam-F01-Dev",
        defaultIdle: "idle_drink",
        idlePool: ["idle_drink"],
        animations: {
          idle_drink: {
            folder: "drink",
            frames: Array.from({ length: 8 }, (_, i) => `sprites/f01/drink/${i}.png`),
            playback: {
              startFrame: 2,
              endFrame: 5,
              dwellFrameIndex: 7, // ABOVE the window → unreachable
              dwellMs: 1500,
            },
          },
        },
      },
    },
    poseDefaults: {},
  } as unknown as GeneratedSpriteManifest;
}

function mountOutOfWindow() {
  return renderPlaybackTuner({
    manifest: outOfWindowApexManifest(),
    spriteBaseUri: "vscode-webview://host/dist/webview",
    postMessage: () => undefined,
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
  });
}

describe("out-of-range baked apex frame resets to Off on re-bind (86ca2cg8a gap #2)", () => {
  it("a baked apex BELOW the window resets the picker to Off on initial seed (M01 [5,10], idx 2)", () => {
    const root = mountOutOfWindow();
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    // The unreachable frame 2 is NOT offered, and the picker resolves to "Off".
    const opts = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    expect(opts).not.toContain("2");
    expect(picker.value).toBe("");
  });

  it("a baked apex ABOVE the window resets the picker to Off on a char switch (F01 [2,5], idx 7)", () => {
    const root = mountOutOfWindow();
    const charSel = q<HTMLSelectElement>(root, ".ct-tuner-char-select");
    charSel.value = "ClaudeTeam-F01-Dev";
    charSel.dispatchEvent(new Event("change"));
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    // Window [2,5] → "Off" + 2..5; the unreachable frame 7 is dropped and the
    // picker re-binds to "Off" rather than keeping a stale, unreachable apex.
    const opts = Array.from(picker.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(["", "2", "3", "4", "5"]);
    expect(picker.value).toBe("");
  });
});
