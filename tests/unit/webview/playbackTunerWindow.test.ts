/**
 * @vitest-environment jsdom
 *
 * Playback Tuner — dual-handle frame range slider ("Window" control, 86ca2wj6u).
 *
 * The window control trims the loop to a contiguous frame slice [startFrame,
 * endFrame]. Two overlapped native ranges (left thumb = startFrame, right thumb
 * = endFrame), coupled so start ≤ end (inverted window prevented at the UI). The
 * control writes draftOverride.startFrame/endFrame; the existing previewOverride()
 * + populateApexFrames() + the save path consume them. The host writer was
 * promoted to own startFrame/endFrame (TUNABLE_KEYS) so the value persists.
 *
 * Layer 2.5 (testing-strategy.md): mount the REAL renderPlaybackTuner, drive the
 * thumbs via DOM `input` events, simulate the ~2s poll re-render with the SAME
 * tracker, and assert the functional outcome (draft updates, save payload carries
 * the window keys, apex re-bounds, omit-on-full-clip, survives a poll tick).
 *
 * NON-VACUITY (mutation-verified 2026-06-02 against playbackTuner.ts):
 *  - "drag narrows the window + save carries startFrame/endFrame": FAILS if
 *    onWindowChange drops the `{ ...draftOverride, startFrame, endFrame }` set —
 *    the save payload would omit the window keys.
 *  - "full clip clears the keys": FAILS if the omit-on-full-clip branch is
 *    removed (the payload would carry redundant startFrame:0/endFrame:last).
 *  - "out-of-window apex auto-cleared": FAILS if rebindApexToWindow stops
 *    omitting dwellFrameIndex/dwellMs — a dangling apex would persist.
 *  - "thumbs coupled (start can't pass end)": FAILS if the clamp in onStartInput/
 *    onEndInput is removed — an inverted window would reach the draft.
 *  - "window survives a poll re-render": FAILS if the tracker doesn't carry the
 *    window (it does, via draftOverride) OR seedWindowFromActive isn't called on
 *    the restore path — the thumbs would snap back to full clip.
 *
 * Source: testing-strategy.md § Layer-2.5; team/iris-design/anim-tuner-window-control-spec.md.
 */

import { describe, it, expect } from "vitest";
import type { GeneratedSpriteManifest } from "../../../src/webview/sprites/spriteManifest.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import { renderPlaybackTuner } from "../../../src/webview/components/playbackTuner.js";
import { createTunerStateTracker } from "../../../src/webview/tunerStateTracker.js";

const q = <T extends HTMLElement>(el: ParentNode, sel: string): T =>
  el.querySelector<T>(sel)!;

type SaveMsg = Extract<WebviewMessage, { type: "ui:save-playback-override" }>;

/** The most recent save message posted (target es2022 has no Array.findLast). */
function lastSave(posted: WebviewMessage[]): SaveMsg | undefined {
  const saves = posted.filter((m): m is SaveMsg => m.type === "ui:save-playback-override");
  return saves[saves.length - 1];
}

/** A manifest with two no-window anims (clips of 11 / 8 frames) + an apex. */
function manifest(): GeneratedSpriteManifest {
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
            playback: { speedMultiplier: 0.5 },
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
            frames: Array.from({ length: 8 }, (_, i) => `sprites/f01/coffee/${i}.png`),
            playback: {},
          },
        },
      },
    },
    poseDefaults: {},
  } as unknown as GeneratedSpriteManifest;
}

/** A manifest whose M01 idle_stretch carries a baked apex at frame 7. */
function apexManifest(): GeneratedSpriteManifest {
  const m = manifest();
  (m.characters["ClaudeTeam-M01-Dev"].animations.idle_stretch as unknown as Record<string, unknown>).playback = {
    speedMultiplier: 0.5,
    dwellFrameIndex: 7,
    dwellMs: 1200,
  };
  return m;
}

interface MountOpts {
  manifest?: GeneratedSpriteManifest;
  posted?: WebviewMessage[];
  tracker?: ReturnType<typeof createTunerStateTracker>;
  schedule?: (cb: () => void, ms: number) => number;
  cancelTimer?: (h: number) => void;
}

function mount(opts: MountOpts = {}): HTMLElement {
  const posted = opts.posted ?? [];
  return renderPlaybackTuner({
    manifest: opts.manifest ?? manifest(),
    spriteBaseUri: "vscode-webview://host/dist/webview",
    postMessage: (m) => posted.push(m),
    scheduleFrame: () => 0,
    cancelFrame: () => undefined,
    ...(opts.tracker ? { stateTracker: opts.tracker } : {}),
    ...(opts.schedule ? { schedule: opts.schedule } : {}),
    ...(opts.cancelTimer ? { cancelTimer: opts.cancelTimer } : {}),
  });
}

/** Set a range input to `v` and dispatch the `input` event the control reads. */
function drag(input: HTMLInputElement, v: number): void {
  input.value = String(v);
  input.dispatchEvent(new Event("input"));
}

/**
 * A synchronous scheduler so the debounced save/preview fires immediately. Each
 * `schedule(cb)` runs `cb` right away (the trailing-edge timer collapses to 0ms),
 * so by the time the test reads `posted` the emitSave for that drag has fired.
 * `cancelTimer` is a no-op (the prior cb already ran). The test takes the LAST
 * save, which reflects the final drag's draft.
 */
function syncSchedule(): {
  schedule: (cb: () => void, ms: number) => number;
  cancelTimer: (h: number) => void;
} {
  return {
    schedule: (cb) => {
      cb();
      return 1;
    },
    cancelTimer: () => undefined,
  };
}

describe("Window control renders + seeds to the full clip (86ca2wj6u)", () => {
  it("renders the Window section with both thumbs spanning 0..lastIndex", () => {
    const root = mount();
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    // M01 idle_stretch = 11 frames → lastIndex 10. No window declared → full clip.
    expect(start.max).toBe("10");
    expect(end.max).toBe("10");
    expect(start.value).toBe("0");
    expect(end.value).toBe("10");
    const readout = q<HTMLElement>(root, ".ct-tuner-window-readout");
    expect(readout.textContent).toBe("0 – 10");
    expect(q<HTMLElement>(root, ".ct-tuner-window-fullclip").textContent).toBe("Full clip: 0–10");
  });

  it("seeds a baked window's thumbs on a char/anim switch (clip re-bind, §4.5)", () => {
    const m = manifest();
    (m.characters["ClaudeTeam-M01-Dev"].animations.idle_stretch as unknown as Record<string, unknown>).playback = {
      startFrame: 3,
      endFrame: 7,
    };
    const root = mount({ manifest: m });
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    expect(start.value).toBe("3");
    expect(end.value).toBe("7");
  });
});

describe("dragging a thumb narrows the window + persists window keys (§5.3)", () => {
  it("save payload carries startFrame/endFrame when the window is narrowed", () => {
    const posted: WebviewMessage[] = [];
    const { schedule, cancelTimer } = syncSchedule();
    const root = mount({ posted, schedule, cancelTimer });
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    drag(start, 4);
    drag(end, 9);
    const save = lastSave(posted);
    expect(save).toBeDefined();
    expect(save!.payload.override.startFrame).toBe(4);
    expect(save!.payload.override.endFrame).toBe(9);
    // Per-char write target + char folder carried.
    expect(save!.payload.writeTarget).toBe("per-char");
    expect(save!.payload.characterFolder).toBe("ClaudeTeam-M01-Dev");
  });

  it("dragging BACK to the full clip CLEARS the window keys (omit-on-full-clip §4.3)", () => {
    const posted: WebviewMessage[] = [];
    const { schedule, cancelTimer } = syncSchedule();
    const root = mount({ posted, schedule, cancelTimer });
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    // Narrow, then widen back to the full clip.
    drag(start, 4);
    drag(start, 0);
    drag(end, 10);
    const save = lastSave(posted);
    expect(save).toBeDefined();
    expect(save!.payload.override.startFrame).toBeUndefined();
    expect(save!.payload.override.endFrame).toBeUndefined();
  });

  it("the reset link clears the window keys (full clip)", () => {
    const posted: WebviewMessage[] = [];
    const { schedule, cancelTimer } = syncSchedule();
    const root = mount({ posted, schedule, cancelTimer });
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    drag(start, 5);
    q<HTMLButtonElement>(root, ".ct-tuner-window-reset").click();
    const save = lastSave(posted);
    expect(save!.payload.override.startFrame).toBeUndefined();
    expect(save!.payload.override.endFrame).toBeUndefined();
    // Thumbs re-seeded to full clip.
    expect(start.value).toBe("0");
    expect(q<HTMLInputElement>(root, ".ct-tuner-window-end").value).toBe("10");
  });
});

describe("thumbs are coupled — inverted window prevented at the UI (§4.1)", () => {
  it("the start thumb cannot pass the end thumb", () => {
    const root = mount();
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    drag(end, 5);
    drag(start, 9); // try to drag start past end
    expect(Number(start.value)).toBe(5); // clamped to end
    expect(q<HTMLElement>(root, ".ct-tuner-window-readout").textContent).toBe("5 – 5");
  });

  it("the end thumb cannot drop below the start thumb", () => {
    const root = mount();
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    drag(start, 6);
    drag(end, 2); // try to drag end below start
    expect(Number(end.value)).toBe(6); // clamped to start
  });
});

describe("single-frame window note (§4.2)", () => {
  it("shows the single-frame note when start == end", () => {
    const root = mount();
    const start = q<HTMLInputElement>(root, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    drag(start, 5);
    drag(end, 5);
    const note = q<HTMLElement>(root, ".ct-tuner-window-single-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("Single-frame window");
    expect(note.textContent).toContain("frame 5");
  });
});

describe("apex re-bounds + auto-clears on a window change (§4.4)", () => {
  it("an apex now OUTSIDE the new window is auto-cleared from the draft + payload", () => {
    const posted: WebviewMessage[] = [];
    const { schedule, cancelTimer } = syncSchedule();
    // Baked apex at frame 7; narrow the window to [0,4] so 7 falls outside.
    const root = mount({ manifest: apexManifest(), posted, schedule, cancelTimer });
    // The apex picker seeds to frame 7 (in the full clip).
    const picker = q<HTMLSelectElement>(root, ".ct-tuner-apex-frame");
    expect(picker.value).toBe("7");
    const end = q<HTMLInputElement>(root, ".ct-tuner-window-end");
    drag(end, 4); // window now [0,4], apex 7 is outside
    // The note surfaces + the picker re-binds to Off + the save drops the apex.
    const note = q<HTMLElement>(root, ".ct-tuner-window-apex-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("outside the new window");
    expect(picker.value).toBe("");
    const save = lastSave(posted);
    expect(save!.payload.override.dwellFrameIndex).toBeUndefined();
    expect(save!.payload.override.dwellMs).toBeUndefined();
    // The window itself persisted.
    expect(save!.payload.override.endFrame).toBe(4);
  });

  it("the apex-coupling helper is shown only when a window is declared (§3)", () => {
    const root = mount();
    const help = q<HTMLElement>(root, ".ct-tuner-window-coupling");
    expect(help.hidden).toBe(true); // full clip → hidden
    drag(q<HTMLInputElement>(root, ".ct-tuner-window-start"), 3);
    expect(help.hidden).toBe(false); // narrowed → shown
  });
});

describe("source-table window row (§5.4)", () => {
  it("shows 'full clip' for a no-window anim", () => {
    const root = mount();
    const row = q<HTMLElement>(root, "dd[data-field='window'] .ct-tuner-source-effective");
    expect(row.textContent).toBe("full clip");
    expect(q<HTMLElement>(root, "dd[data-field='window']").dataset.layer).toBe("engine default");
  });

  it("shows the baked window + per-char layer for a windowed anim", () => {
    const m = manifest();
    (m.characters["ClaudeTeam-M01-Dev"].animations.idle_stretch as unknown as Record<string, unknown>).playback = {
      startFrame: 2,
      endFrame: 8,
    };
    const root = mount({ manifest: m });
    const row = q<HTMLElement>(root, "dd[data-field='window'] .ct-tuner-source-effective");
    expect(row.textContent).toBe("2 – 8");
    expect(q<HTMLElement>(root, "dd[data-field='window']").dataset.layer).toBe("per-char");
  });
});

describe("window survives the ~2s poll re-render (poll-tick survivability)", () => {
  it("a narrowed window survives a second renderFull via the tracker", () => {
    const tracker = createTunerStateTracker();
    const posted: WebviewMessage[] = [];
    // First mount: narrow the window, which mirrors the draft into the tracker.
    const first = mount({ tracker, posted });
    drag(q<HTMLInputElement>(first, ".ct-tuner-window-start"), 4);
    drag(q<HTMLInputElement>(first, ".ct-tuner-window-end"), 9);
    // The tracker carries the window in draftOverride.
    expect(tracker.get()?.draftOverride.startFrame).toBe(4);
    expect(tracker.get()?.draftOverride.endFrame).toBe(9);
    // Simulate the poll re-render: a FRESH tuner seeded from the SAME tracker.
    const second = mount({ tracker, posted });
    const start = q<HTMLInputElement>(second, ".ct-tuner-window-start");
    const end = q<HTMLInputElement>(second, ".ct-tuner-window-end");
    expect(start.value).toBe("4");
    expect(end.value).toBe("9");
    expect(q<HTMLElement>(second, ".ct-tuner-window-readout").textContent).toBe("4 – 9");
  });
});
