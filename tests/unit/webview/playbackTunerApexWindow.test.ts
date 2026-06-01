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
