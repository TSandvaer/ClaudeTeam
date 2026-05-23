/**
 * @vitest-environment jsdom
 *
 * Unit tests for `initMessageReceiver` — the webview side of the host ↔ webview
 * bridge. The renderer-focused tests in `dashboardTile.test.ts` exercise the
 * renderer once messages have already been routed; these tests pin the routing
 * itself (Felix's PR #24 NIT #1 follow-up — M2-05).
 *
 * Coverage:
 *   - Each typed HostMessage discriminator (`state:full`, `state:delta`,
 *     `roster:loaded`, `roster:error`) routes to the matching handler only.
 *   - Untyped / unknown-shape messages route to `onUnknown` and never invoke
 *     a typed handler. This is the defensive branch against VS Code internals
 *     posting on the same `message` channel.
 *   - The returned Disposable detaches the listener — important for hot-reload
 *     / repeat-init scenarios so handlers don't stack.
 *
 * Source: src/webview/messageReceiver.ts; .claude/docs/vscode-extension-conventions.md
 *         "Message protocol"; team/nora-pl/milestone-2-backlog.md §M2-05 AC1.
 */

import { describe, it, expect, vi } from "vitest";
import { initMessageReceiver } from "../../../src/webview/messageReceiver.js";
import type { HostMessage } from "../../../src/shared/messages.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Post a `MessageEvent` to `window` the same way VS Code's webview channel
 * does — handlers read it off `event.data`.
 */
function postToWindow(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

/** A minimal but valid `state:full` payload — handler routing is the focus. */
const STATE_FULL: HostMessage = {
  type: "state:full",
  payload: { sessions: [] },
};

/** A minimal but valid `state:delta` payload. */
const STATE_DELTA: HostMessage = {
  type: "state:delta",
  payload: { added: [], updated: [], removed: [] },
};

// ---------------------------------------------------------------------------
// Typed dispatch
// ---------------------------------------------------------------------------

describe("initMessageReceiver — typed dispatch", () => {
  it("routes state:full only to onStateFull (no cross-handler leakage)", () => {
    const onStateFull = vi.fn();
    const onStateDelta = vi.fn();
    const onRosterLoaded = vi.fn();
    const onRosterError = vi.fn();
    const onUnknown = vi.fn();

    const handle = initMessageReceiver({
      onStateFull,
      onStateDelta,
      onRosterLoaded,
      onRosterError,
      onUnknown,
    });

    postToWindow(STATE_FULL);

    expect(onStateFull).toHaveBeenCalledTimes(1);
    expect(onStateFull).toHaveBeenCalledWith(STATE_FULL);
    expect(onStateDelta).not.toHaveBeenCalled();
    expect(onRosterLoaded).not.toHaveBeenCalled();
    expect(onRosterError).not.toHaveBeenCalled();
    expect(onUnknown).not.toHaveBeenCalled();

    handle.dispose();
  });

  it("routes state:delta only to onStateDelta", () => {
    const onStateFull = vi.fn();
    const onStateDelta = vi.fn();
    const onUnknown = vi.fn();

    const handle = initMessageReceiver({ onStateFull, onStateDelta, onUnknown });

    postToWindow(STATE_DELTA);

    expect(onStateDelta).toHaveBeenCalledTimes(1);
    expect(onStateDelta).toHaveBeenCalledWith(STATE_DELTA);
    expect(onStateFull).not.toHaveBeenCalled();
    expect(onUnknown).not.toHaveBeenCalled();

    handle.dispose();
  });

  it("routes roster:loaded and roster:error to their own handlers", () => {
    const onRosterLoaded = vi.fn();
    const onRosterError = vi.fn();
    const onUnknown = vi.fn();

    const handle = initMessageReceiver({
      onRosterLoaded,
      onRosterError,
      onUnknown,
    });

    const loaded: HostMessage = {
      type: "roster:loaded",
      payload: { teams: [] },
    };
    const errored: HostMessage = {
      type: "roster:error",
      payload: { error: "yaml: parse failed" },
    };
    postToWindow(loaded);
    postToWindow(errored);

    expect(onRosterLoaded).toHaveBeenCalledTimes(1);
    expect(onRosterLoaded).toHaveBeenCalledWith(loaded);
    expect(onRosterError).toHaveBeenCalledTimes(1);
    expect(onRosterError).toHaveBeenCalledWith(errored);
    expect(onUnknown).not.toHaveBeenCalled();

    handle.dispose();
  });
});

// ---------------------------------------------------------------------------
// Unknown / untyped dispatch
// ---------------------------------------------------------------------------

describe("initMessageReceiver — unknown / untyped messages", () => {
  it("routes an unrecognised type to onUnknown and never to a typed handler", () => {
    const onStateFull = vi.fn();
    const onStateDelta = vi.fn();
    const onRosterLoaded = vi.fn();
    const onRosterError = vi.fn();
    const onUnknown = vi.fn();

    const handle = initMessageReceiver({
      onStateFull,
      onStateDelta,
      onRosterLoaded,
      onRosterError,
      onUnknown,
    });

    // Shape with a `type` field that isn't in the HostMessage discriminator.
    // Simulates VS Code internals (or a future schema we haven't taught the
    // receiver about) posting on the same channel.
    const stray = { type: "vscode:internal:noise", payload: { foo: 1 } };
    postToWindow(stray);

    expect(onUnknown).toHaveBeenCalledTimes(1);
    expect(onUnknown).toHaveBeenCalledWith(stray);
    expect(onStateFull).not.toHaveBeenCalled();
    expect(onStateDelta).not.toHaveBeenCalled();
    expect(onRosterLoaded).not.toHaveBeenCalled();
    expect(onRosterError).not.toHaveBeenCalled();

    handle.dispose();
  });

  it("treats non-object payloads (null, string, undefined) as unknown", () => {
    const onStateFull = vi.fn();
    const onUnknown = vi.fn();

    const handle = initMessageReceiver({ onStateFull, onUnknown });

    postToWindow(null);
    postToWindow("not a message");
    postToWindow(undefined);

    expect(onUnknown).toHaveBeenCalledTimes(3);
    expect(onStateFull).not.toHaveBeenCalled();

    handle.dispose();
  });
});

// ---------------------------------------------------------------------------
// Disposable
// ---------------------------------------------------------------------------

describe("initMessageReceiver — disposable", () => {
  it("stops dispatching after dispose() — no handler stacking on re-init", () => {
    const onStateFull = vi.fn();

    const handle = initMessageReceiver({ onStateFull });
    postToWindow(STATE_FULL);
    expect(onStateFull).toHaveBeenCalledTimes(1);

    handle.dispose();
    postToWindow(STATE_FULL);
    // Still 1 — the listener was removed by dispose().
    expect(onStateFull).toHaveBeenCalledTimes(1);
  });
});
