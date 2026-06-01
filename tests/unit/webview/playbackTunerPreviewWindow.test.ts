/**
 * @vitest-environment jsdom
 *
 * Playback Tuner — the LIVE PREVIEW honors the active frame window (NIT 1 of
 * 86ca2w1g9, PR #173).
 *
 * SYMPTOM (Felix's review probe): the apex picker + the shipped tile correctly
 * play only the active window [startFrame..endFrame], but the in-tuner LIVE
 * PREVIEW still played the FULL clip (0..count-1) — so preview ≠ tile. Probe:
 * M01 idle_stretch (window [5,10]) → preview sequence [0,1,…,10,9,8,7] (min 0,
 * max 10) while the picker offers only [5..10].
 *
 * ROOT CAUSE: the preview injects the draft as a flat one-entry `playbackTable`
 * (playbackTunerPreview.ts:191), and the flat-table branch of `resolvePlayback`
 * (spritePlayer.ts:178-180) does NO manifest merge — so a window that lives in a
 * layer the DRAFT does not carry never reaches the preview engine. The draft is
 * seeded ONLY from the active write target's saved block (`readSavedPerCharOverride`):
 * for the `pose-default` ("All characters") target, idle_stretch's pose-default
 * block is empty, so the draft has NO startFrame/endFrame and the engine fell back
 * to the full clip — even though the per-char baked window IS what the tile honors.
 *
 * FIX: `rebuildPreview` overlays the cascade-resolved window (`activeWindow()`,
 * which resolves draft → per-char baked → pose-default → full clip) onto the
 * override passed to the preview, but ONLY for a WINDOWED anim. A no-window anim
 * is passed through unchanged so it stays full-clip.
 *
 * WHY THE POSE-DEFAULT TARGET IS THE NON-VACUOUS SCENARIO: under the default
 * `per-char` target the draft is seeded from the per-char block, which for M01
 * idle_stretch already includes startFrame/endFrame — so the preview windows
 * correctly even WITHOUT the fix (the draft carries the window). The bug only
 * surfaces when the draft lacks the window, i.e. the `pose-default` target. The
 * test therefore drives "All characters" so the assertion FAILS when the overlay
 * is removed.
 *
 * NON-VACUITY (mutation-verified 2026-06-01 against playbackTuner.ts, real
 * generated manifest):
 *  - "windowed preview animates only [5..10]" (pose-default target): FAILS if
 *    `rebuildPreview` passes the raw `draftOverride` to the preview (drop the
 *    `previewOverride()` overlay) — preview replays the full clip, min becomes 0.
 *    Verified 2026-06-01: fix-reverted sequence = [0,1,…,10,0,1,…] (min 0, max 10).
 *    This is the load-bearing non-vacuity probe for the fix.
 *  - "no-window anim animates the full clip": this guards AGAINST over-correction
 *    (the overlay clamping a no-window anim). NOTE: dropping the
 *    `windowIsDeclared()` guard does NOT functionally fail this test, because
 *    `activeWindow()`'s no-window fallback IS [0, count-1] — overlaying those is
 *    byte-equivalent to no window for the engine. The guard's value is cleanliness
 *    (it keeps no-window anims from carrying redundant startFrame/endFrame fields,
 *    per the brief's "keep no-window anims full-clip"); the test pins the
 *    FUNCTIONAL outcome (still full-clip) so an over-correction that genuinely
 *    narrowed a no-window anim WOULD be caught.
 *
 * Source: testing-strategy.md § Layer-2.5; team/iris-design/anim-tuner-spec.md §5.
 */

import { describe, it, expect } from "vitest";
import { GENERATED_SPRITE_MANIFEST } from "../../../src/webview/sprites/generatedManifest.js";
import { renderPlaybackTuner } from "../../../src/webview/components/playbackTuner.js";

const q = <T extends HTMLElement>(el: ParentNode, sel: string): T =>
  el.querySelector<T>(sel)!;

/**
 * Mount the real tuner against the SHIPPED generated manifest with a single-step
 * scheduler (captures the pending preview callback). Returns helpers to select a
 * (char, anim), flip the write target, step the preview, and read the rendered
 * frame index off the preview <img> (frame path `…/frame_<nnn>.png`).
 */
function mountAndDrive() {
  let pending: (() => void) | null = null;
  const root = renderPlaybackTuner({
    manifest: GENERATED_SPRITE_MANIFEST,
    spriteBaseUri: "vscode-webview://host/dist/webview",
    postMessage: () => undefined,
    scheduleFrame: (cb) => {
      pending = cb;
      return 1;
    },
    cancelFrame: () => undefined,
  });

  const readIdx = (): number => {
    const img = q<HTMLImageElement>(root, ".ct-tuner-preview-host img.sprite-frame");
    const m = /frame_(\d+)\.png$/.exec(img.getAttribute("src") ?? "");
    return m ? Number(m[1]) : -1;
  };

  const select = (charKey: string, animName: string): void => {
    const charSel = q<HTMLSelectElement>(root, ".ct-tuner-char-select");
    charSel.value = charKey;
    charSel.dispatchEvent(new Event("change"));
    const animSel = q<HTMLSelectElement>(root, ".ct-tuner-anim-select");
    animSel.value = animName;
    animSel.dispatchEvent(new Event("change"));
  };

  const flipWriteTarget = (target: "per-char" | "pose-default"): void => {
    const radio = q<HTMLInputElement>(
      root,
      `input.ct-tuner-writetarget-radio[data-target="${target}"]`,
    );
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
  };

  // The preview rendered its first frame during construction. Record it, then
  // step the captured scheduler callback `steps` more times, reading each frame.
  const drive = (steps: number): number[] => {
    const seq: number[] = [readIdx()];
    for (let i = 0; i < steps; i++) {
      const cb = pending as (() => void) | null;
      pending = null;
      if (!cb) break;
      cb();
      seq.push(readIdx());
    }
    return seq;
  };

  return { root, select, flipWriteTarget, drive };
}

describe("Playback Tuner live preview honors the active window (NIT 1, 86ca2w1g9)", () => {
  it("windowed anim under the pose-default target — preview min frame === startFrame (5), max === endFrame (10)", () => {
    const { select, flipWriteTarget, drive } = mountAndDrive();
    select("ClaudeTeam-M01-Dev", "idle_stretch");
    // "All characters" — the draft is seeded from the (empty) pose-default block,
    // so it carries NO window. The overlay must restore it from the per-char baked
    // layer; without the fix the preview replays the full clip [0..10] (min 0).
    flipWriteTarget("pose-default");
    const seq = drive(24);
    expect(Math.min(...seq)).toBe(5); // === startFrame (NOT 0)
    expect(Math.max(...seq)).toBe(10); // === endFrame
    expect(seq).not.toContain(0);
    expect(seq).not.toContain(4);
    // Sanity: the preview actually animated.
    expect(new Set(seq).size).toBeGreaterThan(1);
  });

  it("windowed anim under the default per-char target — preview also stays in [5..10]", () => {
    const { select, drive } = mountAndDrive();
    select("ClaudeTeam-M01-Dev", "idle_stretch");
    const seq = drive(24);
    expect(Math.min(...seq)).toBe(5);
    expect(Math.max(...seq)).toBe(10);
  });

  it("no-window anim (M01 idle_phone, no startFrame/endFrame) — preview plays the full clip (over-correction guard)", () => {
    const { select, drive } = mountAndDrive();
    // idle_phone has a per-char playback block but NO window fields.
    select("ClaudeTeam-M01-Dev", "idle_phone");
    const count =
      GENERATED_SPRITE_MANIFEST.characters["ClaudeTeam-M01-Dev"].animations[
        "idle_phone"
      ].frames.length;
    const seq = drive(count * 2 + 4);
    // No window declared anywhere → preview is left full-clip: starts at 0,
    // reaches the last frame. The overlay must NOT clamp this anim.
    expect(Math.min(...seq)).toBe(0);
    expect(Math.max(...seq)).toBe(count - 1);
    expect(seq).toContain(0);
  });
});
