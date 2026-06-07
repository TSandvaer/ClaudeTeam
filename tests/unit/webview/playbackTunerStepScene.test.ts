/**
 * @vitest-environment jsdom
 *
 * Feature B — Tuner preview-over-room + step/cycle control (ticket 86ca4atwt §B).
 *
 * Layer-2.5 DOM-interaction (testing-strategy.md): MOUNT the real
 * `renderPlaybackTuner` + `createPreviewController` and DRIVE them through DOM
 * events + an injected frame scheduler. These are FUNCTIONAL behaviors (scene
 * attribute set, Next/Prev move selectedAnim, readout text, cycle auto-advance) —
 * NOT sponsor-deferred (only the room's visual FEEL is, per §B.5).
 *
 * Non-vacuity (each block fails if its fix is reverted):
 *  - "scene wiring": drop the `data-scene-bg` set → the attribute/url assertion
 *    fails; the null-scene / no-base degrade asserts the attribute is ABSENT.
 *  - "step moves selectedAnim": drop onStep's `selectedAnim` write → the anim
 *    dropdown + readout don't move.
 *  - "readout text": wrong format fails the `— i / N` assertion.
 *  - "cycle auto-advance": drop the onLoopComplete→onStep wiring → the pose does
 *    not advance when loops complete with Cycle ON; with Cycle OFF it must hold.
 */

import { describe, it, expect } from "vitest";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";
import { renderPlaybackTuner } from "../../../src/webview/components/playbackTuner.js";
import { createPreviewController } from "../../../src/webview/components/playbackTunerPreview.js";

const M01 = "ClaudeTeam-M01-Dev";
const BASE = "vscode-webview://host/dist/webview";

/** A manifest with a scene registry + an active pool of 3 work poses. */
function sceneManifest(withScene = true): GeneratedSpriteManifest {
  const m: GeneratedSpriteManifest = {
    characters: {
      [M01]: {
        character: M01,
        defaultIdle: "idle_coffee",
        idlePool: ["idle_coffee"],
        activePool: ["work_a", "work_b", "work_c"],
        animations: {
          idle_coffee: { folder: "coffee", frames: ["s/c/0.png", "s/c/1.png"] },
          active_read: { folder: "read", frames: ["s/r/0.png", "s/r/1.png"] },
          work_a: { folder: "wa", frames: ["s/wa/0.png", "s/wa/1.png", "s/wa/2.png"] },
          work_b: { folder: "wb", frames: ["s/wb/0.png", "s/wb/1.png", "s/wb/2.png"] },
          work_c: { folder: "wc", frames: ["s/wc/0.png", "s/wc/1.png", "s/wc/2.png"] },
        },
      },
    } as unknown as GeneratedSpriteManifest["characters"],
  };
  if (withScene) {
    m.scenes = {
      defaultSceneId: "room3",
      byId: { room3: { id: "room3", image: "sprites/scenes/room3.png" } },
    };
  }
  return m;
}

/** A manual frame scheduler the test steps to drive loop completions. */
function frameScheduler() {
  const cbs: Array<() => void> = [];
  const schedule = (cb: () => void): number => {
    cbs.push(cb);
    return cbs.length;
  };
  const step = (): void => {
    const cb = cbs.shift();
    if (cb) cb();
  };
  return { schedule, step };
}

function mountTuner(
  overrides: Partial<Parameters<typeof renderPlaybackTuner>[0]> = {},
) {
  return renderPlaybackTuner({
    manifest: sceneManifest(),
    spriteBaseUri: BASE,
    postMessage: () => undefined,
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
    ...overrides,
  });
}

// ===========================================================================
// B.1 — scene backdrop over the preview
// ===========================================================================

describe("B.1 — preview renders over the shared scene (room behind)", () => {
  it("sets data-scene-bg + --ct-scene-url on the preview box when defaultScene resolves", () => {
    const ctrl = createPreviewController({
      char: sceneManifest().characters[M01],
      animName: "work_a",
      spriteBaseUri: BASE,
      manifest: sceneManifest(),
      draftOverride: {},
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    const box = ctrl.element;
    expect(box.classList.contains("ct-tuner-preview-box")).toBe(true);
    expect(box.dataset.sceneBg).toBe("");
    expect(box.style.getPropertyValue("--ct-scene-url")).toBe(
      `url('${BASE}/sprites/scenes/room3.png')`,
    );
  });

  it("omits the scene attribute when the manifest has NO scene registry (degrade)", () => {
    const ctrl = createPreviewController({
      char: sceneManifest(false).characters[M01],
      animName: "work_a",
      spriteBaseUri: BASE,
      manifest: sceneManifest(false),
      draftOverride: {},
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    expect(ctrl.element.dataset.sceneBg).toBeUndefined();
    expect(ctrl.element.style.getPropertyValue("--ct-scene-url")).toBe("");
  });

  it("omits the scene attribute when spriteBaseUri is absent (browser-dev degrade)", () => {
    const ctrl = createPreviewController({
      char: sceneManifest().characters[M01],
      animName: "work_a",
      manifest: sceneManifest(),
      draftOverride: {},
      scheduleFrame: () => 0,
      cancelFrame: () => undefined,
    });
    expect(ctrl.element.dataset.sceneBg).toBeUndefined();
  });
});

// ===========================================================================
// B.2 — step control: Next/Prev move selectedAnim + readout
// ===========================================================================

describe("B.2 — step control walks the active pool", () => {
  it("renders the step row controls", () => {
    const root = mountTuner();
    expect(root.querySelector(".ct-tuner-step-source")).not.toBeNull();
    expect(root.querySelector(".ct-tuner-step-prev")).not.toBeNull();
    expect(root.querySelector(".ct-tuner-step-next")).not.toBeNull();
    expect(root.querySelector(".ct-tuner-step-readout")).not.toBeNull();
    // Cycle toggle defaults OFF (sponsor gate 3).
    const cycle = root.querySelector<HTMLInputElement>(".ct-tuner-step-cycle")!;
    expect(cycle.checked).toBe(false);
  });

  it("Next moves selectedAnim forward through the active pool + wraps", () => {
    const root = mountTuner();
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const animSelect = root.querySelector<HTMLSelectElement>(".ct-tuner-anim-select")!;
    const readout = root.querySelector<HTMLElement>(".ct-tuner-step-readout")!;

    next.click(); // → work_a (pool[0]) when the dropdown wasn't on a pool member
    const first = animSelect.value;
    expect(["work_a", "work_b", "work_c"]).toContain(first);
    expect(readout.textContent).toMatch(/ — \d+ \/ 3$/);

    // Step Next twice more — values cycle through the pool.
    next.click();
    next.click();
    const seen = new Set([first]);
    // Walk a full loop and assert all three poses are reachable + it wraps.
    const animValues: string[] = [];
    for (let i = 0; i < 3; i++) {
      next.click();
      animValues.push(animSelect.value);
    }
    for (const v of animValues) seen.add(v);
    expect(seen.has("work_a")).toBe(true);
    expect(seen.has("work_b")).toBe(true);
    expect(seen.has("work_c")).toBe(true);
  });

  it("Prev moves backward; readout shows '<anim> — i / N'", () => {
    const root = mountTuner();
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const prev = root.querySelector<HTMLButtonElement>(".ct-tuner-step-prev")!;
    const animSelect = root.querySelector<HTMLSelectElement>(".ct-tuner-anim-select")!;
    const readout = root.querySelector<HTMLElement>(".ct-tuner-step-readout")!;

    next.click(); // work_a (idx 0)
    expect(animSelect.value).toBe("work_a");
    expect(readout.textContent).toBe("work_a — 1 / 3");
    prev.click(); // wraps back to work_c (idx 2)
    expect(animSelect.value).toBe("work_c");
    expect(readout.textContent).toBe("work_c — 3 / 3");
  });

  it("disables Prev/Next + reads 'no active pool' when the pool is empty", () => {
    const m = sceneManifest();
    m.characters[M01].activePool = [];
    const root = mountTuner({ manifest: m });
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const prev = root.querySelector<HTMLButtonElement>(".ct-tuner-step-prev")!;
    const readout = root.querySelector<HTMLElement>(".ct-tuner-step-readout")!;
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(true);
    expect(readout.textContent).toBe("no active pool");
  });

  it("the 'All animations' source steps every anim, not just the pool", () => {
    const root = mountTuner();
    const source = root.querySelector<HTMLSelectElement>(".ct-tuner-step-source")!;
    source.value = "all";
    source.dispatchEvent(new Event("change"));
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const readout = root.querySelector<HTMLElement>(".ct-tuner-step-readout")!;
    next.click();
    // 5 anims total (idle_coffee, active_read, work_a/b/c).
    expect(readout.textContent).toMatch(/ — \d+ \/ 5$/);
  });
});

// ===========================================================================
// 86ca5ftzp — single-member active pool [active_work] (the v3 char shape).
//   active_work is in TUNER_HIDDEN_ANIMS (hidden from the dropdown for rich-pool
//   chars), but when it is ITSELF the lone active_pool member it MUST stay
//   selectable — otherwise the step/cycle controls set the dropdown's value to a
//   non-existent option and it silently desyncs to blank.
//   Non-vacuity: reverting the selectableAnimNames un-hide makes the dropdown
//   option assertion + the post-step `.value === "active_work"` assertion fail.
// ===========================================================================

describe("86ca5ftzp — active pool [active_work] (v3 single-member pool)", () => {
  function oneMemberPoolManifest(): GeneratedSpriteManifest {
    const m = sceneManifest();
    m.characters[M01].activePool = ["active_work"];
    m.characters[M01].animations = {
      idle_coffee: { folder: "coffee", frames: ["s/c/0.png", "s/c/1.png"] },
      active_read: { folder: "read", frames: ["s/r/0.png", "s/r/1.png"] },
      active_work: { folder: "work", frames: ["s/w/0.png", "s/w/1.png", "s/w/2.png"] },
    } as unknown as GeneratedSpriteManifest["characters"][string]["animations"];
    return m;
  }

  it("active_work stays selectable in the Animation dropdown (un-hidden as a pool member)", () => {
    const root = mountTuner({ manifest: oneMemberPoolManifest() });
    const animSelect = root.querySelector<HTMLSelectElement>(".ct-tuner-anim-select")!;
    const opts = Array.from(animSelect.options).map((o) => o.value);
    expect(opts).toContain("active_work");
    // active_read (never a pool member, never hidden) also present.
    expect(opts).toContain("active_read");
  });

  it("Source=Active pool: readout shows active_work (NOT 'no active pool') + Prev/Next enabled", () => {
    const root = mountTuner({ manifest: oneMemberPoolManifest() });
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const prev = root.querySelector<HTMLButtonElement>(".ct-tuner-step-prev")!;
    const animSelect = root.querySelector<HTMLSelectElement>(".ct-tuner-anim-select")!;
    const readout = root.querySelector<HTMLElement>(".ct-tuner-step-readout")!;

    expect(next.disabled).toBe(false);
    expect(prev.disabled).toBe(false);

    next.click(); // steps to the lone member
    // The dropdown value SYNCS to active_work (the desync-to-blank bug the fix
    // prevents) and the readout names it.
    expect(animSelect.value).toBe("active_work");
    expect(readout.textContent).toBe("active_work — 1 / 1");
  });
});

// ===========================================================================
// B.4 — Cycle toggle auto-advances on loop completion (cadence reuse)
// ===========================================================================

describe("B.4 — Cycle toggle auto-advances over the room on loop-complete", () => {
  it("advances selectedAnim when a loop completes with Cycle ON (cadence=1)", () => {
    const fs = frameScheduler();
    const root = mountTuner({
      loopsPerActivePose: 1,
      scheduleFrame: fs.schedule,
      cancelFrame: () => undefined,
    });
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const animSelect = root.querySelector<HTMLSelectElement>(".ct-tuner-anim-select")!;
    const cycle = root.querySelector<HTMLInputElement>(".ct-tuner-step-cycle")!;

    // Land on a known pool pose first.
    next.click();
    const before = animSelect.value;
    expect(["work_a", "work_b", "work_c"]).toContain(before);

    // Turn Cycle ON, then drive the preview's frames to complete a loop. Stale
    // callbacks from disposed boxes (each rebuild queued one) are no-ops on step,
    // so drive several steps to guarantee the LIVE box wraps at least once.
    cycle.checked = true;
    cycle.dispatchEvent(new Event("change"));
    for (let i = 0; i < 8; i++) fs.step();
    // A loop completed at cadence 1 → Cycle advanced to the next pose.
    expect(animSelect.value).not.toBe(before);
  });

  it("holds the pose when Cycle is OFF (no auto-advance)", () => {
    const fs = frameScheduler();
    const root = mountTuner({
      loopsPerActivePose: 1,
      scheduleFrame: fs.schedule,
      cancelFrame: () => undefined,
    });
    const next = root.querySelector<HTMLButtonElement>(".ct-tuner-step-next")!;
    const animSelect = root.querySelector<HTMLSelectElement>(".ct-tuner-anim-select")!;
    next.click();
    const before = animSelect.value;
    // Cycle stays OFF (default). Complete several loops.
    for (let i = 0; i < 6; i++) fs.step();
    expect(animSelect.value).toBe(before); // held — no auto-advance
  });
});
