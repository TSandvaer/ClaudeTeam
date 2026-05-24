/**
 * @vitest-environment jsdom
 *
 * Unit tests for `renderRosterErrorChip` — M3-04 roster-error chip
 * data-driven from `DashboardState.rosterErrors`.
 *
 * Coverage (per M3-04 AC8):
 *   - 0 errors                → chip suppressed (null returned).
 *   - 1 error                 → chip renders; summary is the error verbatim;
 *                                no "(+N more)" suffix.
 *   - 3 errors                → chip renders; summary has "(+2 more)" suffix;
 *                                details panel lists all 3 errors when expanded.
 *   - Dismissed state         → caller passes `dismissedKey === errors[0]` →
 *                                chip suppressed.
 *   - Re-show after change    → after dismissal, when `errors[0]` changes
 *                                AND caller no longer passes the matching
 *                                key, the chip renders again.
 *   - Edit Roster button      → click dispatches `ui:open-roster` (AC3).
 *   - Click body              → toggles details panel `hidden` attribute (AC2).
 *
 * Source: src/webview/components/rosterErrorChip.ts
 *         team/nora-pl/milestone-3-backlog.md § M3-04 AC1, AC2, AC3, AC8
 *         .claude/docs/roster-matching.md § Loader edge cases
 */

import { describe, it, expect, vi } from "vitest";
import { renderRosterErrorChip } from "../../../src/webview/components/rosterErrorChip.js";
import type { WebviewMessage } from "../../../src/shared/messages.js";

// ---------------------------------------------------------------------------
// Render with 0 / 1 / 3 errors (AC8)
// ---------------------------------------------------------------------------

describe("renderRosterErrorChip — error-count coverage", () => {
  it("returns null when errors is empty (chip suppressed)", () => {
    const chip = renderRosterErrorChip({ errors: [] });
    expect(chip).toBeNull();
  });

  it("renders with 1 error — summary is verbatim, no '+N more' suffix", () => {
    const chip = renderRosterErrorChip({
      errors: ["global roster YAML parse error: bad indent at line 3"],
    });
    expect(chip).not.toBeNull();

    const summary = chip!.querySelector(".roster-error-chip-summary");
    expect(summary?.textContent).toBe(
      "global roster YAML parse error: bad indent at line 3",
    );
    // No "(+N more)" suffix — verify by checking the exact string.
    expect(summary?.textContent).not.toContain("more");
  });

  it("renders with 3 errors — summary has '(+2 more)' suffix and details list all 3", () => {
    const errors = [
      "global roster schema error at teams.0.id: required",
      "global roster schema error at teams.1.members.0.match: required",
      "duplicate member id \"felix\" across teams \"alpha\" and \"beta\"",
    ];
    const chip = renderRosterErrorChip({ errors });
    expect(chip).not.toBeNull();

    const summary = chip!.querySelector(".roster-error-chip-summary");
    expect(summary?.textContent).toBe(`${errors[0]} (+2 more)`);

    // Details panel contains every error verbatim, even when hidden.
    const details = chip!.querySelector(".roster-error-chip-details");
    expect(details).not.toBeNull();
    const items = chip!.querySelectorAll(".roster-error-chip-detail-item");
    expect(items.length).toBe(3);
    expect(items[0]!.textContent).toBe(errors[0]);
    expect(items[1]!.textContent).toBe(errors[1]);
    expect(items[2]!.textContent).toBe(errors[2]);

    // Details start hidden — user expands by clicking the body.
    expect((details as HTMLElement).hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dismiss / re-show on first-error change (AC1)
// ---------------------------------------------------------------------------

describe("renderRosterErrorChip — dismiss / re-show lifecycle", () => {
  it("suppresses chip when dismissedKey === errors[0] (post-dismiss render)", () => {
    const errors = ["YAML parse: bad indent at line 3"];
    const chip = renderRosterErrorChip({
      errors,
      dismissedKey: errors[0]!, // user previously dismissed this exact error
    });
    expect(chip).toBeNull();
  });

  it("re-shows chip when errors[0] changes after dismissal", () => {
    // First render: user dismisses the chip.
    const firstErrors = ["YAML parse: bad indent at line 3"];
    const dismissed = renderRosterErrorChip({
      errors: firstErrors,
      dismissedKey: firstErrors[0]!,
    });
    expect(dismissed).toBeNull();

    // Second render: roster YAML changed, new first-error string. Caller is
    // STILL holding the old dismissed key (it hasn't been notified of any
    // new dismissal). The chip MUST re-render because the cached key no
    // longer matches the current first-error.
    const secondErrors = ["YAML parse: unknown key 'teemz' at line 1"];
    const reshown = renderRosterErrorChip({
      errors: secondErrors,
      dismissedKey: firstErrors[0]!, // stale key from prior dismissal
    });
    expect(reshown).not.toBeNull();
    expect(reshown!.querySelector(".roster-error-chip-summary")?.textContent).toBe(
      secondErrors[0],
    );
  });

  it("does not suppress when dismissedKey is null / undefined", () => {
    const chip1 = renderRosterErrorChip({
      errors: ["any error"],
      dismissedKey: null,
    });
    expect(chip1).not.toBeNull();

    const chip2 = renderRosterErrorChip({ errors: ["any error"] });
    expect(chip2).not.toBeNull();
  });

  it("invokes onDismiss(firstError) when × is clicked, then removes chip from DOM", () => {
    const onDismiss = vi.fn();
    const errors = ["YAML parse: bad indent at line 3"];
    const chip = renderRosterErrorChip({ errors, onDismiss });
    expect(chip).not.toBeNull();

    // Mount so .remove() exercises the parent-detachment path.
    document.body.appendChild(chip!);

    const dismissBtn = chip!.querySelector(
      ".roster-error-chip-dismiss",
    ) as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    dismissBtn.click();

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(errors[0]);
    // Chip removed itself from its parent.
    expect(chip!.parentNode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edit Roster button + details toggle (AC2 / AC3)
// ---------------------------------------------------------------------------

describe("renderRosterErrorChip — interactions", () => {
  it("dispatches { type: 'ui:open-roster' } when Edit Roster is clicked", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderRosterErrorChip({
      errors: ["any error"],
      postMessage,
    });
    expect(chip).not.toBeNull();

    const editBtn = chip!.querySelector(
      ".roster-error-chip-action",
    ) as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    editBtn.click();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "ui:open-roster" });
  });

  it("clicking the body toggles the details panel hidden state", () => {
    const chip = renderRosterErrorChip({
      errors: ["e1", "e2", "e3"],
    });
    expect(chip).not.toBeNull();

    const body = chip!.querySelector(
      ".roster-error-chip-body",
    ) as HTMLElement;
    const details = chip!.querySelector(
      ".roster-error-chip-details",
    ) as HTMLElement;
    expect(details.hidden).toBe(true);
    expect(body.getAttribute("aria-expanded")).toBe("false");

    body.click();
    expect(details.hidden).toBe(false);
    expect(body.getAttribute("aria-expanded")).toBe("true");
    expect(chip!.dataset.expanded).toBe("true");

    body.click();
    expect(details.hidden).toBe(true);
    expect(body.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking Edit Roster does NOT toggle the details panel (stopPropagation)", () => {
    const postMessage = vi.fn<[WebviewMessage], void>();
    const chip = renderRosterErrorChip({
      errors: ["only-error"],
      postMessage,
    });
    expect(chip).not.toBeNull();

    const editBtn = chip!.querySelector(
      ".roster-error-chip-action",
    ) as HTMLButtonElement;
    const details = chip!.querySelector(
      ".roster-error-chip-details",
    ) as HTMLElement;
    expect(details.hidden).toBe(true);

    editBtn.click();
    // Edit Roster dispatched, details panel stayed hidden.
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(details.hidden).toBe(true);
  });

  it("Enter / Space on the body toggles details (keyboard accessibility)", () => {
    const chip = renderRosterErrorChip({ errors: ["e1", "e2"] });
    expect(chip).not.toBeNull();
    const body = chip!.querySelector(
      ".roster-error-chip-body",
    ) as HTMLElement;
    const details = chip!.querySelector(
      ".roster-error-chip-details",
    ) as HTMLElement;

    body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(details.hidden).toBe(false);

    body.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true }),
    );
    expect(details.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Theme-variable / semantic-color smoke
// ---------------------------------------------------------------------------

describe("renderRosterErrorChip — styling smoke", () => {
  it("carries the semantic-error class (.error-chip--error) for theme variables", () => {
    const chip = renderRosterErrorChip({ errors: ["e"] });
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains("error-chip")).toBe(true);
    expect(chip!.classList.contains("error-chip--error")).toBe(true);
    expect(chip!.classList.contains("roster-error-chip")).toBe(true);
  });

  it("sets ARIA attributes for screen-reader announcement", () => {
    const chip = renderRosterErrorChip({ errors: ["e"] });
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("role")).toBe("alert");
    expect(chip!.getAttribute("aria-live")).toBe("polite");
  });
});
