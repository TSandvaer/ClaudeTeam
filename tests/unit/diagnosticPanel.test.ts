/**
 * Unit tests for src/extension/diagnostics/panel.ts (86c9zn7tm).
 *
 * Coverage:
 *   - `show()` is idempotent — calling twice reveals the existing panel
 *     rather than allocating a new one.
 *   - The panel subscribes to the diagnostic channel on first `show()` and
 *     disposes the subscription when the panel is closed.
 *   - On every tick the manager posts a `diagnostic:state` message to the
 *     panel containing the wire-shape ticks + serialized DashboardState +
 *     verbose flag.
 *   - "Pause" suppresses pushes; "Resume" restores them AND immediately
 *     pushes a snapshot.
 *   - "Clear" calls the dispatcher's `clearHistory` AND re-posts.
 *   - `ui:diagnostic-refresh` pulls a fresh snapshot.
 *   - The CSP block in the rendered HTML matches the documented format.
 *   - Disposal of the manager closes the panel and unsubscribes.
 *
 * The VS Code webview API is mocked via dependency injection — the panel
 * manager accepts `createPanel` / `extensionUri` overrides so these tests
 * never touch a real VS Code instance.
 */

import { describe, it, expect, vi } from "vitest";

// Mock the `vscode` module — panel.ts transitively imports it via
// `messageBus.ts`. The manager itself only references `vscode.ViewColumn`
// (an enum-like) and `vscode.window.createWebviewPanel` (always overridden
// via the test's `createPanel` injection).
vi.mock("vscode", () => {
  const mockUri = (fsPath: string) => ({
    fsPath,
    toString: () => `file://${fsPath}`,
    joinPath: (...parts: string[]) => mockUri(parts.join("/")),
  });
  return {
    window: {
      createWebviewPanel: vi.fn(),
    },
    Uri: {
      file: (p: string) => mockUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mockUri(`${base.fsPath}/${parts.join("/")}`),
    },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  };
});

import {
  createDiagnosticPanelManager,
  isPanelMessage,
  renderPanelHtml,
  toWireTick,
  DIAGNOSTIC_PANEL_VIEW_TYPE,
  DIAGNOSTIC_PANEL_TITLE,
} from "../../src/extension/diagnostics/panel.js";
import { createDiagnosticChannel } from "../../src/extension/diagnostics/output.js";
import type {
  AgentState,
  AgentTile,
  CollapsedPersonaGroup,
  DashboardState,
  SessionTree,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Fake VS Code webview panel — minimum shape needed by the manager.
// ---------------------------------------------------------------------------

interface FakePanel {
  viewType: string;
  title: string;
  webview: {
    html: string;
    cspSource: string;
    // Use the broader Mock shape so the fake satisfies the
    // `vscode.WebviewPanel` postMessage signature in tests; the manager
    // doesn't care about the return type.
    postMessage: ReturnType<typeof vi.fn>;
    asWebviewUri: (uri: { fsPath: string }) => { toString(): string };
    onDidReceiveMessage(
      handler: (raw: unknown) => void,
    ): { dispose(): void };
  };
  reveal: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  onDidDispose(handler: () => void): { dispose(): void };
  viewColumn?: number;
  // Test instrumentation — drive the message handler / dispose lifecycle.
  _emitMessage(raw: unknown): void;
  _emitDispose(): void;
  _sentMessages: unknown[];
}

function makeFakePanel(): FakePanel {
  let messageHandler: ((raw: unknown) => void) | null = null;
  let disposeHandler: (() => void) | null = null;
  const sent: unknown[] = [];

  const postMessage = vi.fn().mockImplementation((msg: unknown) => {
    sent.push(msg);
    return true;
  });

  const panel: FakePanel = {
    viewType: DIAGNOSTIC_PANEL_VIEW_TYPE,
    title: DIAGNOSTIC_PANEL_TITLE,
    webview: {
      html: "",
      cspSource: "vscode-webview://test-cspsource",
      postMessage,
      asWebviewUri: (uri) => ({
        toString: () => `webview-uri://${uri.fsPath}`,
      }),
      onDidReceiveMessage: (handler) => {
        messageHandler = handler;
        return { dispose: () => {} };
      },
    },
    reveal: vi.fn(),
    dispose: vi.fn(),
    onDidDispose: (handler) => {
      disposeHandler = handler;
      return { dispose: () => {} };
    },
    viewColumn: 1,
    _sentMessages: sent,
    _emitMessage(raw: unknown): void {
      messageHandler?.(raw);
    },
    _emitDispose(): void {
      disposeHandler?.();
    },
  };
  return panel;
}

// ---------------------------------------------------------------------------
// Fake extension URI / output channel (minimum shape for the dispatcher).
// ---------------------------------------------------------------------------

function makeFakeExtensionUri(): { fsPath: string; joinPath(): unknown } {
  return {
    fsPath: "/test/extension",
    joinPath() {
      return { fsPath: "/test/extension/x" };
    },
  };
}

function makeNoOpChannel(): {
  appendLine: ReturnType<typeof vi.fn>;
  dispose(): void;
  name: string;
  append(): void;
  replace(): void;
  clear(): void;
  show(): void;
  hide(): void;
} {
  return {
    appendLine: vi.fn(),
    dispose: () => {},
    name: "noop",
    append: () => {},
    replace: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers — small DashboardState builders, parallel to the dispatch
// tests but inlined to keep the panel tests self-contained.
// ---------------------------------------------------------------------------

function makeTile(agentId: string, state: AgentState): AgentTile {
  return {
    memberId: "felix",
    teamId: "claudeteam-alpha",
    display: "Felix",
    role: "Extension Host Dev",
    activity: state === "running" ? "tool:Edit src/x.ts" : `${state}`,
    model: "claude-opus-4-7",
    state,
    agentId,
    toolUseId: "toolu_test",
  };
}

function makeSession(
  sessionId: string,
  tiles: AgentTile[] = [],
): SessionTree {
  const rosterTiles = new Map<string, (AgentTile | CollapsedPersonaGroup)[]>();
  if (tiles.length > 0) {
    rosterTiles.set("claudeteam-alpha", tiles);
  }
  return {
    shortId: sessionId.slice(0, 8),
    sessionId,
    pid: 1234,
    entrypoint: "claude-vscode",
    version: "2.1.145",
    isAlive: true,
    cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    title: "(no title yet)",
    rosterTiles,
    teamOrder: tiles.length > 0 ? ["claudeteam-alpha"] : [],
    background: [],
  };
}

function makeState(sessions: SessionTree[]): DashboardState {
  return { sessions };
}

// ---------------------------------------------------------------------------
// Wire-shape helpers
// ---------------------------------------------------------------------------

describe("toWireTick — wire-shape conversion", () => {
  it("passes scalars through; transitions array is copied (not aliased)", () => {
    const entry = {
      tickNumber: 42,
      timestampMs: 1700000000000,
      durationMs: 5,
      emitted: true,
      transitions: [
        {
          sessionShortId: "abcdef12",
          agentShortId: "agent-12",
          sessionId: "abcdef12-xxxx",
          agentId: "agent-12345",
          prev: "running" as AgentState,
          next: "idle" as AgentState,
        },
      ],
    };
    const wire = toWireTick(entry);
    expect(wire.tickNumber).toBe(42);
    expect(wire.timestampMs).toBe(1700000000000);
    expect(wire.durationMs).toBe(5);
    expect(wire.emitted).toBe(true);
    expect(wire.transitions).toHaveLength(1);
    expect(wire.transitions[0]).toEqual(entry.transitions[0]);
    expect(wire.transitions).not.toBe(entry.transitions); // fresh array
  });
});

// ---------------------------------------------------------------------------
// HTML rendering — CSP block must be present + locked-down
// ---------------------------------------------------------------------------

describe("renderPanelHtml — CSP + bundle references", () => {
  it("includes a strict CSP scoped to the webview cspSource", () => {
    const fakeUri = makeFakeExtensionUri() as never;
    const html = renderPanelHtml(
      {
        cspSource: "vscode-webview://test-source",
        asWebviewUri: (u: { fsPath: string }) => ({ toString: () => `webview://${u.fsPath}` }),
      } as never,
      fakeUri,
    );
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src vscode-webview://test-source");
    expect(html).toContain("style-src vscode-webview://test-source");
    expect(html).not.toContain("'unsafe-inline'");
    expect(html).not.toContain("'unsafe-eval'");
  });

  it("references the dist/diagnostics bundle + stylesheet (not the dashboard's)", () => {
    const fakeUri = makeFakeExtensionUri() as never;
    const html = renderPanelHtml(
      {
        cspSource: "vscode-webview://test-source",
        asWebviewUri: (u: { fsPath: string }) => ({ toString: () => `webview://${u.fsPath}` }),
      } as never,
      fakeUri,
    );
    // The joinPath fake returns `/test/extension/x` for every call — we
    // assert the HTML contains the joined-uri shape rather than the
    // exact path (the real `joinPath` walks the segments).
    expect(html).toContain("webview://");
    expect(html).toContain('<link rel="stylesheet"');
    expect(html).toContain('<script src=');
  });
});

// ---------------------------------------------------------------------------
// Webview message validation
// ---------------------------------------------------------------------------

describe("isPanelMessage — type guard", () => {
  it("accepts ui:diagnostic-refresh and ui:diagnostic-clear without payload", () => {
    expect(isPanelMessage({ type: "ui:diagnostic-refresh" })).toBe(true);
    expect(isPanelMessage({ type: "ui:diagnostic-clear" })).toBe(true);
  });

  it("accepts ui:diagnostic-pause with a boolean payload.paused", () => {
    expect(
      isPanelMessage({ type: "ui:diagnostic-pause", payload: { paused: true } }),
    ).toBe(true);
    expect(
      isPanelMessage({ type: "ui:diagnostic-pause", payload: { paused: false } }),
    ).toBe(true);
  });

  it("rejects unknown discriminators + malformed payloads", () => {
    expect(isPanelMessage(null)).toBe(false);
    expect(isPanelMessage({})).toBe(false);
    expect(isPanelMessage({ type: "ui:refresh" })).toBe(false); // dashboard message, not panel
    expect(
      isPanelMessage({ type: "ui:diagnostic-pause", payload: {} }),
    ).toBe(false);
    expect(
      isPanelMessage({ type: "ui:diagnostic-pause", payload: { paused: "no" } }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manager lifecycle — show / dispose / subscribe behavior
// ---------------------------------------------------------------------------

describe("DiagnosticPanelManager — lifecycle", () => {
  function setup() {
    const channel = createDiagnosticChannel({
      isVerbose: () => false,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const panel = makeFakePanel();
    const createPanel = vi.fn(() => panel as never);
    const manager = createDiagnosticPanelManager({
      diagnosticChannel: channel,
      isVerbose: () => false,
      createPanel,
      extensionUri: makeFakeExtensionUri() as never,
    });
    return { manager, channel, panel, createPanel };
  }

  it("show() creates a single panel; calling twice reveals the existing one", () => {
    const { manager, createPanel, panel } = setup();
    manager.show();
    manager.show();
    expect(createPanel).toHaveBeenCalledTimes(1);
    expect(panel.reveal).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("isOpen() is false before show, true after show, false after the panel disposes", () => {
    const { manager, panel } = setup();
    expect(manager.isOpen()).toBe(false);
    manager.show();
    expect(manager.isOpen()).toBe(true);
    panel._emitDispose();
    expect(manager.isOpen()).toBe(false);
    manager.dispose();
  });

  it("a fresh show after the panel was closed allocates a new panel", () => {
    const { manager, createPanel, panel } = setup();
    manager.show();
    panel._emitDispose();
    manager.show();
    expect(createPanel).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("dispose() after show() closes the panel + tears down the subscription", () => {
    const { manager, channel, panel } = setup();
    manager.show();
    manager.dispose();
    expect(panel.dispose).toHaveBeenCalledTimes(1);
    // Subsequent ticks should not throw and should not attempt to post.
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalled();
  });

  it("dispose() before show() never allocates a panel", () => {
    const { manager, createPanel } = setup();
    manager.dispose();
    expect(createPanel).not.toHaveBeenCalled();
  });

  it("show() after dispose() throws (manager is single-use post-dispose)", () => {
    const { manager } = setup();
    manager.dispose();
    expect(() => manager.show()).toThrow(/disposed/i);
  });
});

// ---------------------------------------------------------------------------
// Push-on-tick + pause + clear flows
// ---------------------------------------------------------------------------

describe("DiagnosticPanelManager — push / pause / clear flow", () => {
  function setup(isVerbose = false) {
    const channel = createDiagnosticChannel({
      isVerbose: () => isVerbose,
      createOutputChannel: () => makeNoOpChannel() as never,
    });
    const panel = makeFakePanel();
    const manager = createDiagnosticPanelManager({
      diagnosticChannel: channel,
      isVerbose: () => isVerbose,
      createPanel: () => panel as never,
      extensionUri: makeFakeExtensionUri() as never,
    });
    return { manager, channel, panel };
  }

  it("posts a diagnostic:state on every tick after the panel is open", () => {
    const { manager, channel, panel } = setup();
    manager.show();
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([makeSession("session-A", [makeTile("agent-1", "running")])]),
    });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    const msg = panel.webview.postMessage.mock.calls[0]![0] as {
      type: string;
      payload: { ticks: unknown[]; state: unknown };
    };
    expect(msg.type).toBe("diagnostic:state");
    expect(msg.payload.ticks).toHaveLength(1);
    expect(msg.payload.state).not.toBeNull();
    manager.dispose();
  });

  it("pause suppresses pushes; resume sends one catch-up snapshot", () => {
    const { manager, channel, panel } = setup();
    manager.show();
    // First tick lands.
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    // Pause — next tick should NOT push.
    panel._emitMessage({
      type: "ui:diagnostic-pause",
      payload: { paused: true },
    });
    channel.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    // Resume — sends a catch-up snapshot.
    panel._emitMessage({
      type: "ui:diagnostic-pause",
      payload: { paused: false },
    });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("ui:diagnostic-clear empties the ring buffer AND re-posts", () => {
    const { manager, channel, panel } = setup();
    manager.show();
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    channel.recordTick({
      tickNumber: 2,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    panel.webview.postMessage.mockClear();
    panel._emitMessage({ type: "ui:diagnostic-clear" });
    // Re-post landed.
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    const msg = panel.webview.postMessage.mock.calls[0]![0] as {
      payload: { ticks: unknown[] };
    };
    expect(msg.payload.ticks).toHaveLength(0);
    manager.dispose();
  });

  it("ui:diagnostic-refresh sends a fresh snapshot on demand", () => {
    const { manager, channel, panel } = setup();
    manager.show();
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    panel.webview.postMessage.mockClear();
    panel._emitMessage({ type: "ui:diagnostic-refresh" });
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(1);
    const msg = panel.webview.postMessage.mock.calls[0]![0] as {
      type: string;
      payload: { ticks: unknown[] };
    };
    expect(msg.type).toBe("diagnostic:state");
    expect(msg.payload.ticks).toHaveLength(1);
    manager.dispose();
  });

  it("stamps the verbose flag from isVerbose() on every push", () => {
    const { manager, channel, panel } = setup(true);
    manager.show();
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([]),
    });
    const msg = panel.webview.postMessage.mock.calls[0]![0] as {
      payload: { verbose: boolean };
    };
    expect(msg.payload.verbose).toBe(true);
    manager.dispose();
  });

  it("flattens the in-memory DashboardState (Maps) to wire shape (plain objects)", () => {
    const { manager, channel, panel } = setup();
    manager.show();
    channel.recordTick({
      tickNumber: 1,
      durationMs: 1,
      emitted: true,
      state: makeState([
        makeSession("session-A", [makeTile("agent-1", "running")]),
      ]),
    });
    const msg = panel.webview.postMessage.mock.calls[0]![0] as {
      payload: { state: { sessions: { rosterTiles: Record<string, unknown[]> }[] } };
    };
    const session = msg.payload.state.sessions[0]!;
    // rosterTiles arrives as a plain object — `Object.entries` returns keys.
    expect(Object.keys(session.rosterTiles)).toEqual(["claudeteam-alpha"]);
    manager.dispose();
  });
});
