/**
 * Unit tests for the webview → host message dispatch path on
 * `ClaudeTeamViewProvider` (M2-06 AC2).
 *
 * Coverage:
 *   - `isWebviewMessage` accepts each typed shape and rejects unknown ones.
 *   - `setMessageHandlers` registers per-type handlers that receive the
 *     correctly-typed message envelope.
 *   - Missing handlers cause the message to be silently dropped (no throw).
 *   - Unknown-shape messages route to `onUnknown` (defensive against future
 *     wire-format additions and VS Code internals on the same channel).
 *
 * Provider construction uses a minimal vscode mock (provider.test.ts pattern).
 *
 * Source: src/extension/view/provider.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC2
 */

import { describe, it, expect, vi } from "vitest";

import {
  ClaudeTeamViewProvider,
  isWebviewMessage,
} from "../../src/extension/view/provider.js";

// ---------------------------------------------------------------------------
// vscode mock
// ---------------------------------------------------------------------------

vi.mock("vscode", () => {
  const mockUri = (fsPath: string) => ({
    fsPath,
    toString: () => `file://${fsPath}`,
  });
  return {
    window: { registerWebviewViewProvider: vi.fn() },
    Uri: {
      file: (p: string) => mockUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mockUri(`${base.fsPath}/${parts.join("/")}`),
    },
    WebviewViewResolveContext: {},
    CancellationToken: {},
  };
});

// ---------------------------------------------------------------------------
// isWebviewMessage type-guard
// ---------------------------------------------------------------------------

describe("isWebviewMessage — type guard", () => {
  it("accepts ui:refresh with no payload", () => {
    expect(isWebviewMessage({ type: "ui:refresh" })).toBe(true);
  });

  it("accepts ui:open-roster with no payload", () => {
    expect(isWebviewMessage({ type: "ui:open-roster" })).toBe(true);
  });

  it("accepts ui:open-transcript with valid payload", () => {
    expect(
      isWebviewMessage({
        type: "ui:open-transcript",
        payload: { sessionId: "s1", agentId: "a1" },
      }),
    ).toBe(true);
  });

  it("rejects ui:open-transcript without payload", () => {
    expect(isWebviewMessage({ type: "ui:open-transcript" })).toBe(false);
  });

  it("rejects ui:open-transcript with wrong payload field types", () => {
    expect(
      isWebviewMessage({
        type: "ui:open-transcript",
        payload: { sessionId: 1, agentId: "a1" },
      }),
    ).toBe(false);
  });

  it("rejects unknown discriminator", () => {
    expect(isWebviewMessage({ type: "vscode:internal" })).toBe(false);
  });

  it("rejects null, undefined, primitives", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage(undefined)).toBe(false);
    expect(isWebviewMessage("ui:refresh")).toBe(false);
    expect(isWebviewMessage(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provider message dispatch
// ---------------------------------------------------------------------------

describe("ClaudeTeamViewProvider._dispatchWebviewMessage — typed dispatch", () => {
  function makeProvider(): ClaudeTeamViewProvider {
    return ClaudeTeamViewProvider.fromExtensionPath("/fake/ext");
  }

  it("routes ui:refresh to onRefresh only", () => {
    const provider = makeProvider();
    const onRefresh = vi.fn();
    const onOpenRoster = vi.fn();
    const onOpenTranscript = vi.fn();

    provider.setMessageHandlers({
      onRefresh,
      onOpenRoster,
      onOpenTranscript,
    });

    provider._dispatchWebviewMessage({ type: "ui:refresh" });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onOpenRoster).not.toHaveBeenCalled();
    expect(onOpenTranscript).not.toHaveBeenCalled();
  });

  it("routes ui:open-roster to onOpenRoster only", () => {
    const provider = makeProvider();
    const onOpenRoster = vi.fn();
    const onRefresh = vi.fn();

    provider.setMessageHandlers({ onOpenRoster, onRefresh });
    provider._dispatchWebviewMessage({ type: "ui:open-roster" });

    expect(onOpenRoster).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("routes ui:open-transcript with full payload", () => {
    const provider = makeProvider();
    const onOpenTranscript = vi.fn();
    provider.setMessageHandlers({ onOpenTranscript });

    const msg = {
      type: "ui:open-transcript" as const,
      payload: { sessionId: "sid-x", agentId: "agt-y" },
    };
    provider._dispatchWebviewMessage(msg);

    expect(onOpenTranscript).toHaveBeenCalledTimes(1);
    expect(onOpenTranscript).toHaveBeenCalledWith(msg);
  });

  it("missing handler → silently drops the typed message (no throw)", () => {
    const provider = makeProvider();
    // No handlers registered at all (default {}).
    expect(() =>
      provider._dispatchWebviewMessage({ type: "ui:refresh" }),
    ).not.toThrow();
  });

  it("unknown-shape message → calls onUnknown", () => {
    const provider = makeProvider();
    const onUnknown = vi.fn();
    const onRefresh = vi.fn();

    provider.setMessageHandlers({ onUnknown, onRefresh });

    const stray = { type: "vscode:internal:noise" };
    provider._dispatchWebviewMessage(stray);

    expect(onUnknown).toHaveBeenCalledTimes(1);
    expect(onUnknown).toHaveBeenCalledWith(stray);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("unknown-shape without onUnknown handler → console.warn fallback (no throw)", () => {
    const provider = makeProvider();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      provider._dispatchWebviewMessage({ type: "ui:fabricated" }),
    ).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("setMessageHandlers replaces prior set (last-write-wins)", () => {
    const provider = makeProvider();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    provider.setMessageHandlers({ onRefresh: firstHandler });
    provider.setMessageHandlers({ onRefresh: secondHandler });

    provider._dispatchWebviewMessage({ type: "ui:refresh" });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });


  // E-06a: hide / show / show-all dispatch
  it("routes ui:hide-member with valid payload to onHideMember only", () => {
    const provider = makeProvider();
    const onHideMember = vi.fn();
    const onShowMember = vi.fn();
    provider.setMessageHandlers({ onHideMember, onShowMember });

    const msg = {
      type: "ui:hide-member" as const,
      payload: { teamId: "claudeteam-alpha", memberId: "felix" },
    };
    provider._dispatchWebviewMessage(msg);

    expect(onHideMember).toHaveBeenCalledTimes(1);
    expect(onHideMember).toHaveBeenCalledWith(msg);
    expect(onShowMember).not.toHaveBeenCalled();
  });

  it("routes ui:show-member with valid payload to onShowMember only", () => {
    const provider = makeProvider();
    const onShowMember = vi.fn();
    const onHideMember = vi.fn();
    provider.setMessageHandlers({ onShowMember, onHideMember });

    const msg = {
      type: "ui:show-member" as const,
      payload: { teamId: "claudeteam-alpha", memberId: "maya" },
    };
    provider._dispatchWebviewMessage(msg);

    expect(onShowMember).toHaveBeenCalledTimes(1);
    expect(onShowMember).toHaveBeenCalledWith(msg);
    expect(onHideMember).not.toHaveBeenCalled();
  });

  it("routes ui:show-all-hidden (no payload) to onShowAllHidden only", () => {
    const provider = makeProvider();
    const onShowAllHidden = vi.fn();
    const onHideMember = vi.fn();
    provider.setMessageHandlers({ onShowAllHidden, onHideMember });

    provider._dispatchWebviewMessage({ type: "ui:show-all-hidden" });

    expect(onShowAllHidden).toHaveBeenCalledTimes(1);
    expect(onHideMember).not.toHaveBeenCalled();
  });

  it("routes ui:remove-member with valid payload to onRemoveMember only (E-07a)", () => {
    const provider = makeProvider();
    const onRemoveMember = vi.fn();
    const onHideMember = vi.fn();
    provider.setMessageHandlers({ onRemoveMember, onHideMember });

    const msg = {
      type: "ui:remove-member" as const,
      payload: { teamId: "claudeteam-alpha", memberId: "felix" },
    };
    provider._dispatchWebviewMessage(msg);

    expect(onRemoveMember).toHaveBeenCalledTimes(1);
    expect(onRemoveMember).toHaveBeenCalledWith(msg);
    expect(onHideMember).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E-06a — hide / show / show-all type-guard coverage
// ---------------------------------------------------------------------------

describe("isWebviewMessage — E-06a hide/show messages", () => {
  it("accepts ui:hide-member with valid {teamId, memberId}", () => {
    expect(
      isWebviewMessage({
        type: "ui:hide-member",
        payload: { teamId: "claudeteam-alpha", memberId: "felix" },
      }),
    ).toBe(true);
  });

  it("accepts ui:show-member with valid {teamId, memberId}", () => {
    expect(
      isWebviewMessage({
        type: "ui:show-member",
        payload: { teamId: "claudeteam-alpha", memberId: "maya" },
      }),
    ).toBe(true);
  });

  it("accepts ui:show-all-hidden with no payload", () => {
    expect(isWebviewMessage({ type: "ui:show-all-hidden" })).toBe(true);
  });

  it("rejects ui:hide-member without payload", () => {
    expect(isWebviewMessage({ type: "ui:hide-member" })).toBe(false);
  });

  it("rejects ui:hide-member with wrong field types", () => {
    expect(
      isWebviewMessage({
        type: "ui:hide-member",
        payload: { teamId: 1, memberId: "felix" },
      }),
    ).toBe(false);
  });

  it("rejects ui:show-member with missing memberId", () => {
    expect(
      isWebviewMessage({
        type: "ui:show-member",
        payload: { teamId: "claudeteam-alpha" },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E-07a — remove-member type-guard coverage
// ---------------------------------------------------------------------------

describe("isWebviewMessage — E-07a remove-member message", () => {
  it("accepts ui:remove-member with valid {teamId, memberId}", () => {
    expect(
      isWebviewMessage({
        type: "ui:remove-member",
        payload: { teamId: "claudeteam-alpha", memberId: "felix" },
      }),
    ).toBe(true);
  });

  it("rejects ui:remove-member without payload", () => {
    expect(isWebviewMessage({ type: "ui:remove-member" })).toBe(false);
  });

  it("rejects ui:remove-member with wrong field types", () => {
    expect(
      isWebviewMessage({
        type: "ui:remove-member",
        payload: { teamId: "claudeteam-alpha", memberId: 7 },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 86ca1gdbp — `ui:set-config` was removed with the global hide-finished /
// hide-idle chips (superseded by whole-team-always-visible + per-member hide).
// The guard must now REJECT it so a stale webview can't drive a dead path.
// ---------------------------------------------------------------------------

describe("isWebviewMessage — ui:set-config removed (86ca1gdbp)", () => {
  it("rejects the removed ui:set-config message (hideFinishedAgents)", () => {
    expect(
      isWebviewMessage({
        type: "ui:set-config",
        payload: { key: "hideFinishedAgents", value: true },
      }),
    ).toBe(false);
  });

  it("rejects the removed ui:set-config message (hideIdleAgents)", () => {
    expect(
      isWebviewMessage({
        type: "ui:set-config",
        payload: { key: "hideIdleAgents", value: false },
      }),
    ).toBe(false);
  });
});
