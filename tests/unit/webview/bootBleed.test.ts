/**
 * @vitest-environment jsdom
 *
 * Regression coverage for 86c9ybrk0 (AC8) — the "DEAD-session bleed past
 * M3-03 window-scope filter" bug. Root cause: `src/webview/main.ts` used
 * `FIXTURE_STATE` as the boot-time placeholder in BOTH browser-dev and
 * VS Code modes. `FIXTURE_STATE` contains a hardcoded cross-workspace
 * DEAD session (`a91f3c20` / pid=99999 / cwd=Axelot-tutor) which leaked
 * onto the dashboard before the first host `state:full` arrived,
 * defeating the host's already-correct `filterSessionsToWindow` gate.
 *
 * Fix: VS Code mode boots with `FIXTURE_EMPTY_STATE`; browser dev mode
 * preserves `FIXTURE_STATE` for layout iteration (M2-05 AC8 contract).
 *
 * Test strategy: `boot()` self-invokes on module import, so each scenario
 * uses `vi.resetModules()` + a fresh dynamic import. VS Code mode is
 * simulated by defining `globalThis.acquireVsCodeApi` BEFORE the import;
 * browser dev mode is simulated by leaving it undefined.
 *
 * Source: src/webview/main.ts
 *         src/shared/fixtures.ts (FIXTURE_DEAD_SESSION, FIXTURE_EMPTY_STATE)
 *         PR #41 audit body (pipeline trace + root cause)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockVsCodeApi {
  postMessage: (msg: unknown) => void;
  setState: (state: unknown) => void;
  getState: () => unknown;
}

/**
 * Install a stub `acquireVsCodeApi` on globalThis so `main.ts`'s
 * `typeof acquireVsCodeApi === "function"` check sees VS Code mode.
 */
function installVsCodeShim(): MockVsCodeApi {
  const api: MockVsCodeApi = {
    postMessage: vi.fn(),
    setState: vi.fn(),
    getState: vi.fn(() => undefined),
  };
  // `declare function acquireVsCodeApi(): ...` in main.ts resolves against
  // globalThis at runtime. Attach as a callable; jsdom doesn't provide one.
  (globalThis as unknown as { acquireVsCodeApi: () => MockVsCodeApi })
    .acquireVsCodeApi = () => api;
  return api;
}

function uninstallVsCodeShim(): void {
  delete (globalThis as unknown as { acquireVsCodeApi?: unknown })
    .acquireVsCodeApi;
}

function ensureRootMount(): HTMLElement {
  document.body.innerHTML = '<div id="root">ClaudeTeam loading...</div>';
  const root = document.getElementById("root");
  if (!root) throw new Error("test setup: #root missing");
  return root;
}

// ---------------------------------------------------------------------------
// VS Code mode — must NOT render the DEAD-session bleed
// ---------------------------------------------------------------------------

describe("webview boot — VS Code mode (AC8 regression)", () => {
  beforeEach(() => {
    vi.resetModules();
    ensureRootMount();
    installVsCodeShim();
  });

  afterEach(() => {
    uninstallVsCodeShim();
    document.body.innerHTML = "";
  });

  it("does NOT render the FIXTURE_DEAD_SESSION cross-workspace bleed at boot", async () => {
    await import("../../../src/webview/main.js");

    const html = document.body.innerHTML;
    // The exact bleed fingerprints the sponsor screenshotted on 2026-05-24.
    expect(html).not.toContain("a91f3c20");
    expect(html).not.toContain("99999");
    expect(html).not.toContain("Axelot-tutor");
  });

  it("does NOT render any rostered tile at boot (no tiles before first state:full)", async () => {
    await import("../../../src/webview/main.js");

    // Both .agent-tile (rostered) and .session-block (session header) are
    // absent under FIXTURE_EMPTY_STATE — the empty-state path doesn't emit
    // either. Asserting both keeps the test robust to renderer refactors.
    expect(document.querySelectorAll(".agent-tile").length).toBe(0);
    expect(document.querySelectorAll(".session-block").length).toBe(0);
  });

  it("renders the empty-state line so the user knows the dashboard is awake", async () => {
    await import("../../../src/webview/main.js");

    // From `src/webview/components/emptyState.ts` — exact M1-03 §1.7 vocab.
    expect(document.body.textContent).toContain("No live Claude Code sessions.");
  });
});

// ---------------------------------------------------------------------------
// Browser dev mode — FIXTURE_STATE must still render (M2-05 AC8 preserved)
// ---------------------------------------------------------------------------

describe("webview boot — browser dev mode (M2-05 AC8 preserved)", () => {
  beforeEach(() => {
    vi.resetModules();
    ensureRootMount();
    uninstallVsCodeShim(); // explicit: no VS Code API in dev mode
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders FIXTURE_STATE tiles (including the dev-mode DEAD session) when acquireVsCodeApi is undefined", async () => {
    await import("../../../src/webview/main.js");

    // FIXTURE_STATE renders Maya's six personas → at least one rostered tile,
    // and the FIXTURE_DEAD_SESSION header is intentionally visible here for
    // dev-mode layout iteration.
    expect(document.querySelectorAll(".agent-tile").length).toBeGreaterThan(0);
    expect(document.body.innerHTML).toContain("a91f3c20");
  });
});
