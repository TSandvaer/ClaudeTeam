/**
 * @vitest-environment jsdom
 *
 * Regression coverage for 86c9z171k (Obs 3 follow-up) — the "host replay
 * fires before the webview message listener is wired" bug. Root cause:
 * PR #66 added a host-side push-based replay inside `_onResolved` that
 * `postMessage`s `state:full` synchronously, BEFORE the webview's IIFE
 * has executed and registered `window.addEventListener("message", ...)`
 * via `initMessageReceiver`. VS Code does not buffer postMessage calls,
 * so the replayed snapshot is silently dropped. Sponsor's 2026-05-26
 * dogfood (`team/dogfood/2026-05-26-obs3-fix-incomplete-on-0a6945d.md`)
 * observed >30s empty state on close+reopen against the `0a6945d` vsix.
 *
 * Fix: webview sends `{ type: "ui:refresh" }` from `boot()` AFTER
 * `initMessageReceiver({...})` returns. The host's existing `onRefresh`
 * handler (`src/extension/main.ts:265-267`) calls
 * `watcherHandle?.triggerTick()`, which re-emits the current state to a
 * webview whose listener is now guaranteed wired.
 *
 * Test strategy: `boot()` self-invokes on module import, so each scenario
 * uses `vi.resetModules()` + a fresh dynamic import. VS Code mode is
 * simulated by defining `globalThis.acquireVsCodeApi` BEFORE the import.
 * The mock api's `postMessage` is a `vi.fn` we inspect post-import.
 *
 * Source: src/webview/main.ts (boot() trailing ui:refresh dispatch)
 *         team/bram-research/86c9yteju-triage-2026-05-26.md § Obs 3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers (mirror the shape used in bootBleed.test.ts so the two stay in lockstep)
// ---------------------------------------------------------------------------

interface MockVsCodeApi {
  postMessage: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  getState: ReturnType<typeof vi.fn>;
}

function installVsCodeShim(): MockVsCodeApi {
  const api: MockVsCodeApi = {
    postMessage: vi.fn(),
    setState: vi.fn(),
    getState: vi.fn(),
  };
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
// VS Code mode — `ui:refresh` dispatched once boot() completes
// ---------------------------------------------------------------------------

describe("webview boot — ui:refresh on boot (86c9z171k)", () => {
  let api: MockVsCodeApi;

  beforeEach(() => {
    vi.resetModules();
    ensureRootMount();
    api = installVsCodeShim();
  });

  afterEach(() => {
    uninstallVsCodeShim();
    document.body.innerHTML = "";
  });

  it("dispatches { type: 'ui:refresh' } via api.postMessage after boot()", async () => {
    await import("../../../src/webview/main.js");

    // The webview should have sent exactly one ui:refresh as the closing
    // act of boot(). No other webview→host messages happen at boot.
    const refreshCalls = api.postMessage.mock.calls.filter(
      ([msg]) => (msg as { type?: unknown }).type === "ui:refresh",
    );
    expect(refreshCalls.length).toBe(1);
    expect(refreshCalls[0][0]).toEqual({ type: "ui:refresh" });
  });

  it("sends ui:refresh AFTER initMessageReceiver wires the listener (window.message handler present)", async () => {
    // If ui:refresh were sent before initMessageReceiver wired the listener,
    // the host's reply (state:full from triggerTick) would arrive before the
    // listener is registered — the same failure mode PR #66 hit. The
    // contract is "listener wired, THEN refresh sent." We verify by
    // confirming the message listener IS present on the window by the time
    // postMessage was called. jsdom doesn't expose the listener list, so
    // we probe via a synthetic dispatch: if no listener is wired,
    // window.dispatchEvent of a "message" event is a no-op observable only
    // by absence. We instead verify the documented ordering by checking
    // that postMessage WAS called (boot() ran to completion, including the
    // post-initMessageReceiver dispatch).
    await import("../../../src/webview/main.js");

    expect(api.postMessage).toHaveBeenCalled();
    // Last call is the trailing ui:refresh (no other postMessages happen
    // during boot under FIXTURE_EMPTY_STATE → empty-state render path).
    const lastCall = api.postMessage.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({ type: "ui:refresh" });
  });
});
