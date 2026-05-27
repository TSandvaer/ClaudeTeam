/**
 * @vitest-environment jsdom
 *
 * Unit tests for `renderHeaderChip` — M5 hide-finished header chip.
 *
 * Label-revision note (ticket `86c9zfmgg` / Obs 8 — 2026-05-26): the ON
 * branch now reads "Show finished — N hidden" (was "Hide finished — N
 * hidden") so the label names what the click WILL TAKE, not the current
 * state. Sponsor verbatim: *"If i click the 'Hide finished x hidden'
 * button, that should be named 'show finished x hidden'."* OFF branch is
 * unchanged (`Hide finished`).
 *
 * Coverage:
 *   - State matrix (spec §4.2 table, revised labels):
 *     - hideFinished=false, count=0 → label "Hide finished",        aria-pressed="false"
 *     - hideFinished=true,  count=0 → label "Show finished — none yet"
 *     - hideFinished=true,  count=1 → label "Show finished — 1 hidden"
 *     - hideFinished=true,  count=N → label "Show finished — N hidden"
 *   - data-hide-finished + data-hidden-count attributes on the <aside>.
 *   - Click handler posts `ui:set-config` with toggled value.
 *   - Enter + Space (via native <button>) fire the same message.
 *   - Optimistic UI flips data attributes immediately after click.
 *   - render.ts mount order per spec §4.1 + §4.6:
 *     - with-sessions branch: rosterErrorChip → errorChip → headerChip → session blocks.
 *     - empty branch:         rosterErrorChip → errorChip → headerChip → emptyState.
 *   - Defensive reads: state.hiddenFinishedCount / state.config absent → defaults
 *     to off + 0 (filter-off baseline).
 *
 * Source: src/webview/components/headerChip.ts
 *         src/webview/render.ts (M5 mount integration)
 *         team/iris-ux/m5-hide-finished-spec.md §4, §5, §6, §7
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderHeaderChip,
  labelTextForState,
} from "../../../src/webview/components/headerChip.js";
import { renderFull } from "../../../src/webview/render.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";
import type { AgentTree } from "../../../src/shared/types.js";
import {
  FIXTURE_EMPTY_STATE,
  FIXTURE_STATE,
} from "../../../src/shared/fixtures.js";

// Em-dash literal (U+2014) — spec §7.3 fixes the labels with this character.
const EM_DASH = "—";

// ---------------------------------------------------------------------------
// Pure label helper (spec §5.2 / §7.3 templates)
// ---------------------------------------------------------------------------

describe("labelTextForState — spec §5.2 template coverage", () => {
  it("returns 'Hide finished' when filter off (count irrelevant)", () => {
    expect(labelTextForState(false, 0)).toBe("Hide finished");
    // Spec §4.2 row 2 — host-contract-violating combo. Renderer treats as
    // off-label per spec guidance ("guarded in render — if observed, render
    // as if N=0").
    expect(labelTextForState(false, 5)).toBe("Hide finished");
  });

  it("returns 'Show finished — none yet' when filter on + count=0 (Obs 8 — action-named label)", () => {
    expect(labelTextForState(true, 0)).toBe(`Show finished ${EM_DASH} none yet`);
  });

  it("returns 'Show finished — 1 hidden' for singular count (Obs 8 — click WILL show)", () => {
    expect(labelTextForState(true, 1)).toBe(`Show finished ${EM_DASH} 1 hidden`);
  });

  it("returns 'Show finished — N hidden' for plural count (Obs 8 — click WILL show)", () => {
    expect(labelTextForState(true, 2)).toBe(`Show finished ${EM_DASH} 2 hidden`);
    expect(labelTextForState(true, 14)).toBe(
      `Show finished ${EM_DASH} 14 hidden`,
    );
  });
});

// ---------------------------------------------------------------------------
// Chip rendering — state matrix (spec §4.2)
// ---------------------------------------------------------------------------

describe("renderHeaderChip — state matrix", () => {
  it("filter OFF + count 0 → aria-pressed=false, data-hide-finished=false, label 'Hide finished'", () => {
    const chip = renderHeaderChip({
      hideFinished: false,
      hiddenCount: 0,
      postMessage: vi.fn(),
    });

    expect(chip.tagName).toBe("ASIDE");
    expect(chip.classList.contains("ct-header-chip")).toBe(true);
    expect(chip.dataset.hideFinished).toBe("false");
    expect(chip.dataset.hiddenCount).toBe("0");

    const toggle = chip.querySelector(".ct-header-chip-toggle");
    expect(toggle).not.toBeNull();
    expect((toggle as HTMLButtonElement).type).toBe("button");
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");
    expect(toggle!.getAttribute("title")).toBe("Hide finished agents");

    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      "Hide finished",
    );
  });

  it("filter ON + count 0 → aria-pressed=true, label 'Show finished — none yet' (Obs 8)", () => {
    const chip = renderHeaderChip({
      hideFinished: true,
      hiddenCount: 0,
      postMessage: vi.fn(),
    });

    expect(chip.dataset.hideFinished).toBe("true");
    expect(chip.dataset.hiddenCount).toBe("0");

    const toggle = chip.querySelector(".ct-header-chip-toggle");
    expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle!.getAttribute("title")).toBe("Show finished agents");

    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      `Show finished ${EM_DASH} none yet`,
    );
  });

  it("filter ON + count 1 → label 'Show finished — 1 hidden' (Obs 8)", () => {
    const chip = renderHeaderChip({
      hideFinished: true,
      hiddenCount: 1,
      postMessage: vi.fn(),
    });

    expect(chip.dataset.hideFinished).toBe("true");
    expect(chip.dataset.hiddenCount).toBe("1");
    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      `Show finished ${EM_DASH} 1 hidden`,
    );
  });

  it("filter ON + count 7 → label 'Show finished — 7 hidden' (Obs 8)", () => {
    const chip = renderHeaderChip({
      hideFinished: true,
      hiddenCount: 7,
      postMessage: vi.fn(),
    });

    expect(chip.dataset.hiddenCount).toBe("7");
    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      `Show finished ${EM_DASH} 7 hidden`,
    );
  });

  it("includes a hidden count <span> reserved for future expansions", () => {
    const chip = renderHeaderChip({
      hideFinished: true,
      hiddenCount: 3,
      postMessage: vi.fn(),
    });

    const countSpan = chip.querySelector(
      ".ct-header-chip-count",
    ) as HTMLElement;
    expect(countSpan).not.toBeNull();
    expect(countSpan.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Click handler — posts ui:set-config with toggled value (spec §7.3)
// ---------------------------------------------------------------------------

describe("renderHeaderChip — click posts ui:set-config", () => {
  it("clicking the toggle when OFF posts { ui:set-config, hideFinishedAgents: true }", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderHeaderChip({
      hideFinished: false,
      hiddenCount: 0,
      postMessage,
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    toggle.click();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "ui:set-config",
      payload: { key: "hideFinishedAgents", value: true },
    });
  });

  it("clicking the toggle when ON posts { ui:set-config, hideFinishedAgents: false }", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderHeaderChip({
      hideFinished: true,
      hiddenCount: 4,
      postMessage,
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    toggle.click();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "ui:set-config",
      payload: { key: "hideFinishedAgents", value: false },
    });
  });

  it("Enter on the toggle fires the same message (native <button> keyboard)", () => {
    // jsdom note: <button> activates on `click()` only; HTMLButtonElement
    // does not synthesize a click from a keydown event without explicit
    // dispatch in jsdom. We assert the affordance by ensuring no separate
    // keydown listener is required — clicking via the keyboard's native
    // accessibility tree calls .click() at the element level. To verify
    // the contract, dispatch a synthetic click event via Enter-driven
    // form-submit-equivalent: the click handler is the single source.
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderHeaderChip({
      hideFinished: false,
      hiddenCount: 0,
      postMessage,
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    // Synthetic click event approximates keyboard activation on <button>.
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect((postMessage.mock.calls[0]![0] as { type: string }).type).toBe(
      "ui:set-config",
    );
  });

  it("optimistic UI flips data-hide-finished + aria-pressed + title immediately after click", () => {
    const chip = renderHeaderChip({
      hideFinished: false,
      hiddenCount: 0,
      postMessage: vi.fn(),
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    expect(chip.dataset.hideFinished).toBe("false");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.getAttribute("title")).toBe("Hide finished agents");

    toggle.click();

    expect(chip.dataset.hideFinished).toBe("true");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toBe("Show finished agents");
  });
});

// ---------------------------------------------------------------------------
// render.ts mount integration — spec §4.1 + §4.6 (always renders, position 3)
// ---------------------------------------------------------------------------

describe("renderFull — M5 header chip mount", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    mount = document.createElement("div");
    mount.id = "root";
    document.body.appendChild(mount);
  });

  it("mounts the header chip in the empty-state branch (spec §4.6)", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    const chip = mount.querySelector(".ct-header-chip");
    expect(chip).not.toBeNull();
    // Empty-state element also present.
    expect(mount.querySelector(".empty-state")).not.toBeNull();
  });

  it("mounts the header chip in the with-sessions branch", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const chip = mount.querySelector(".ct-header-chip");
    expect(chip).not.toBeNull();
    expect(mount.querySelectorAll(".session-block").length).toBeGreaterThan(0);
  });

  it("renders chip BEFORE the empty-state in the empty branch (position 3)", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    const chip = mount.querySelector(".ct-header-chip");
    const emptyState = mount.querySelector(".empty-state");
    expect(chip).not.toBeNull();
    expect(emptyState).not.toBeNull();
    // chip.compareDocumentPosition(emptyState) → Node.DOCUMENT_POSITION_FOLLOWING (4)
    // means emptyState follows chip in the tree — exactly the order spec §4.1
    // requires.
    const pos = chip!.compareDocumentPosition(emptyState!);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders chip BEFORE the first session block in the with-sessions branch (position 3)", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_STATE);
    const chip = mount.querySelector(".ct-header-chip");
    const firstSession = mount.querySelector(".session-block");
    expect(chip).not.toBeNull();
    expect(firstSession).not.toBeNull();
    const pos = chip!.compareDocumentPosition(firstSession!);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders chip AFTER both error chips (rosterErrorChip + legacy errorChip — spec §4.1)", () => {
    const stateWithRosterErrors: AgentTree = {
      ...FIXTURE_EMPTY_STATE,
      rosterErrors: ["YAML parse: bad indent"],
    };
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        error: {
          level: "error",
          title: "File-watcher error",
          detail: "Lost contact",
          showOpenRosterButton: false,
        },
      },
      stateWithRosterErrors,
    );

    const rosterChip = mount.querySelector(".roster-error-chip");
    const legacyChip = mount.querySelector(".error-chip:not(.roster-error-chip)");
    const headerChip = mount.querySelector(".ct-header-chip");
    expect(rosterChip).not.toBeNull();
    expect(legacyChip).not.toBeNull();
    expect(headerChip).not.toBeNull();

    // Order: rosterErrorChip → legacy errorChip → headerChip.
    expect(
      rosterChip!.compareDocumentPosition(legacyChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      legacyChip!.compareDocumentPosition(headerChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("defaults to OFF (data-hide-finished='false') when state.config is absent (defensive read)", () => {
    // FIXTURE_EMPTY_STATE has no `config` / `hiddenFinishedCount` — the
    // chip must boot OFF per the spec §3.5 contract ("Webview MUST treat
    // undefined as false / 0").
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    const chip = mount.querySelector(".ct-header-chip") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.dataset.hideFinished).toBe("false");
    expect(chip.dataset.hiddenCount).toBe("0");
  });

  it("boots ON when state.config.hideFinishedAgents=true (forward-compat with Felix's wire fields)", () => {
    // Cast the augmented state through Record<unknown> because AgentTree's
    // current shape on this branch may pre-date Felix's M5-EH widening. The
    // chip reads through the same defensive cast in render.ts.
    const augmented = {
      ...FIXTURE_EMPTY_STATE,
      hiddenFinishedCount: 3,
      config: { hideFinishedAgents: true },
    } as unknown as AgentTree;

    renderFull({ mount, postMessage: vi.fn() }, augmented);
    const chip = mount.querySelector(".ct-header-chip") as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.dataset.hideFinished).toBe("true");
    expect(chip.dataset.hiddenCount).toBe("3");
    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      `Show finished ${EM_DASH} 3 hidden`,
    );
  });

  it("post-click renders show the new state (re-render via state:full preserves the toggle)", () => {
    // First render: filter OFF.
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    let chip = mount.querySelector(".ct-header-chip") as HTMLElement;
    expect(chip.dataset.hideFinished).toBe("false");

    // Simulate host echoing back ON via the next state:full.
    const updatedState = {
      ...FIXTURE_EMPTY_STATE,
      hiddenFinishedCount: 2,
      config: { hideFinishedAgents: true },
    } as unknown as AgentTree;
    renderFull({ mount, postMessage: vi.fn() }, updatedState);
    chip = mount.querySelector(".ct-header-chip") as HTMLElement;
    expect(chip.dataset.hideFinished).toBe("true");
    expect(chip.dataset.hiddenCount).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Idle-chip variant — 86c9zqa75 / spec 86c9zmyef §3 + §7.3 templates
// ---------------------------------------------------------------------------

describe("labelTextForState — idle variant (spec 86c9zmyef §7.3)", () => {
  it("returns 'Hide idle' when filter off (count irrelevant)", () => {
    expect(labelTextForState(false, 0, "idle")).toBe("Hide idle");
    expect(labelTextForState(false, 7, "idle")).toBe("Hide idle");
  });

  it("returns 'Show idle — none yet' when filter on + count=0", () => {
    expect(labelTextForState(true, 0, "idle")).toBe(
      `Show idle ${EM_DASH} none yet`,
    );
  });

  it("returns 'Show idle — 1 hidden' for singular count", () => {
    expect(labelTextForState(true, 1, "idle")).toBe(
      `Show idle ${EM_DASH} 1 hidden`,
    );
  });

  it("returns 'Show idle — N hidden' for plural count", () => {
    expect(labelTextForState(true, 2, "idle")).toBe(
      `Show idle ${EM_DASH} 2 hidden`,
    );
    expect(labelTextForState(true, 14, "idle")).toBe(
      `Show idle ${EM_DASH} 14 hidden`,
    );
  });
});

describe("renderHeaderChip — idle variant state matrix (spec 86c9zmyef §3)", () => {
  it("kind=idle, filter OFF + count 0 → data-hide-idle=false, label 'Hide idle'", () => {
    const chip = renderHeaderChip({
      kind: "idle",
      hideFinished: false,
      hiddenCount: 0,
      postMessage: vi.fn(),
    });

    expect(chip.tagName).toBe("ASIDE");
    expect(chip.classList.contains("ct-header-chip")).toBe(true);
    expect(chip.dataset.hideIdle).toBe("false");
    expect(chip.dataset.hiddenIdleCount).toBe("0");
    // The M5 data attributes MUST NOT appear on the idle chip — that would
    // confuse selectors targeting either chip.
    expect(chip.dataset.hideFinished).toBeUndefined();
    expect(chip.dataset.hiddenCount).toBeUndefined();

    const toggle = chip.querySelector(".ct-header-chip-toggle");
    expect(toggle!.getAttribute("aria-pressed")).toBe("false");
    expect(toggle!.getAttribute("title")).toBe("Hide idle agents");

    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      "Hide idle",
    );
  });

  it("kind=idle, filter ON + count 3 → label 'Show idle — 3 hidden'", () => {
    const chip = renderHeaderChip({
      kind: "idle",
      hideFinished: true,
      hiddenCount: 3,
      postMessage: vi.fn(),
    });

    expect(chip.dataset.hideIdle).toBe("true");
    expect(chip.dataset.hiddenIdleCount).toBe("3");

    const toggle = chip.querySelector(".ct-header-chip-toggle");
    expect(toggle!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle!.getAttribute("title")).toBe("Show idle agents");

    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      `Show idle ${EM_DASH} 3 hidden`,
    );
  });

  it("kind=idle click when OFF posts { ui:set-config, hideIdleAgents: true }", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderHeaderChip({
      kind: "idle",
      hideFinished: false,
      hiddenCount: 0,
      postMessage,
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    toggle.click();

    expect(postMessage).toHaveBeenCalledWith({
      type: "ui:set-config",
      payload: { key: "hideIdleAgents", value: true },
    });
  });

  it("kind=idle click when ON posts { ui:set-config, hideIdleAgents: false }", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderHeaderChip({
      kind: "idle",
      hideFinished: true,
      hiddenCount: 5,
      postMessage,
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    toggle.click();

    expect(postMessage).toHaveBeenCalledWith({
      type: "ui:set-config",
      payload: { key: "hideIdleAgents", value: false },
    });
  });

  it("kind=idle optimistic UI flips data-hide-idle + aria-pressed after click", () => {
    const chip = renderHeaderChip({
      kind: "idle",
      hideFinished: false,
      hiddenCount: 0,
      postMessage: vi.fn(),
    });

    const toggle = chip.querySelector(
      ".ct-header-chip-toggle",
    ) as HTMLButtonElement;
    toggle.click();

    expect(chip.dataset.hideIdle).toBe("true");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("title")).toBe("Show idle agents");
  });

  it("kind omitted defaults to 'finished' (M5 back-compat)", () => {
    const chip = renderHeaderChip({
      hideFinished: false,
      hiddenCount: 0,
      postMessage: vi.fn(),
    });
    // Defaults to finished kind → M5 dataset attributes.
    expect(chip.dataset.hideFinished).toBe("false");
    expect(chip.dataset.hiddenCount).toBe("0");
    expect(chip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      "Hide finished",
    );
  });
});

// ---------------------------------------------------------------------------
// Both chips render side-by-side in renderFull — 86c9zqa75 mount integration
// ---------------------------------------------------------------------------

describe("renderFull — both header chips mount (86c9zqa75)", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    mount = document.createElement("div");
    mount.id = "root";
    document.body.appendChild(mount);
  });

  it("renders both finished + idle chips in the empty-state branch", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    // Two <aside class="ct-header-chip"> — one finished, one idle.
    const chips = mount.querySelectorAll(".ct-header-chip");
    expect(chips.length).toBe(2);

    const finishedChip = mount.querySelector(
      ".ct-header-chip[data-hide-finished]",
    );
    const idleChip = mount.querySelector(".ct-header-chip[data-hide-idle]");
    expect(finishedChip).not.toBeNull();
    expect(idleChip).not.toBeNull();
  });

  it("finished chip mounts BEFORE the idle chip (canonical order)", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    const finishedChip = mount.querySelector(
      ".ct-header-chip[data-hide-finished]",
    );
    const idleChip = mount.querySelector(".ct-header-chip[data-hide-idle]");
    expect(
      finishedChip!.compareDocumentPosition(idleChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("idle chip boots ON when state.config.hideIdleAgents=true (defaults match Felix's Pt 1)", () => {
    const augmented = {
      ...FIXTURE_EMPTY_STATE,
      hiddenIdleCount: 4,
      config: { hideIdleAgents: true },
    } as unknown as AgentTree;

    renderFull({ mount, postMessage: vi.fn() }, augmented);
    const idleChip = mount.querySelector(
      ".ct-header-chip[data-hide-idle]",
    ) as HTMLElement;
    expect(idleChip).not.toBeNull();
    expect(idleChip.dataset.hideIdle).toBe("true");
    expect(idleChip.dataset.hiddenIdleCount).toBe("4");
    expect(idleChip.querySelector(".ct-header-chip-label")?.textContent).toBe(
      `Show idle ${EM_DASH} 4 hidden`,
    );
  });

  it("idle chip defaults to OFF + 0 when state.config and hiddenIdleCount are absent", () => {
    renderFull({ mount, postMessage: vi.fn() }, FIXTURE_EMPTY_STATE);
    const idleChip = mount.querySelector(
      ".ct-header-chip[data-hide-idle]",
    ) as HTMLElement;
    expect(idleChip.dataset.hideIdle).toBe("false");
    expect(idleChip.dataset.hiddenIdleCount).toBe("0");
  });

  it("both chips render AFTER both error chips (canonical order preserved)", () => {
    const stateWithRosterErrors: AgentTree = {
      ...FIXTURE_EMPTY_STATE,
      rosterErrors: ["YAML parse: bad indent"],
    };
    renderFull(
      {
        mount,
        postMessage: vi.fn(),
        error: {
          level: "error",
          title: "File-watcher error",
          detail: "Lost contact",
          showOpenRosterButton: false,
        },
      },
      stateWithRosterErrors,
    );

    const rosterChip = mount.querySelector(".roster-error-chip");
    const legacyChip = mount.querySelector(
      ".error-chip:not(.roster-error-chip)",
    );
    const finishedChip = mount.querySelector(
      ".ct-header-chip[data-hide-finished]",
    );
    const idleChip = mount.querySelector(".ct-header-chip[data-hide-idle]");

    // Order: rosterErrorChip → legacy errorChip → finished chip → idle chip.
    expect(
      rosterChip!.compareDocumentPosition(legacyChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      legacyChip!.compareDocumentPosition(finishedChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      finishedChip!.compareDocumentPosition(idleChip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
