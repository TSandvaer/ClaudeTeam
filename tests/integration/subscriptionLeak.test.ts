/**
 * Integration test for the M2-06 absorbed-NIT-#1 fix: the subscription leak.
 *
 * AC7(e) — `context.subscriptions.length` snapshot before + after 3
 * `resolveWebviewView` cycles. Prior to the fix, the activation flow pushed
 * a fresh disposable onto `context.subscriptions` on every `resolveWebviewView`
 * — VS Code calls that hook again on every "Reload Window", so the
 * subscription stack would grow unbounded across reload cycles.
 *
 * Fix shape: register the cleanup wrapper ONCE during `activate`, and let
 * subsequent `resolveWebviewView` invocations dispose-and-replace the held-
 * out-of-band watcher reference. See `src/extension/main.ts` "Subscription-
 * leak fix" header.
 *
 * Why "integration" rather than "unit" — the test exercises `activate()`
 * end-to-end with a mock VS Code context + provider rebind cycle, which is
 * closer to the integration suite's wiring than to the per-function unit
 * tests.
 *
 * Source: src/extension/main.ts
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC7(e)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// vscode mock — factory is hoisted above imports; can't close over module
// locals. We stash the captured provider on `globalThis` so the test body
// can read it back after activate() runs.
// ---------------------------------------------------------------------------

vi.mock("vscode", () => {
  const mockUri = (fsPath: string) => ({
    fsPath,
    toString: () => `file://${fsPath}`,
    scheme: "file",
  });
  return {
    window: {
      registerWebviewViewProvider: (_viewId: string, provider: unknown) => {
        (globalThis as { __CT_PROVIDER__?: unknown }).__CT_PROVIDER__ = provider;
        return { dispose: () => undefined };
      },
      showErrorMessage: () => undefined,
      showTextDocument: () => undefined,
      showInformationMessage: () => undefined,
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (key: string) => {
          if (key === "pollIntervalMs") return 60_000; // No-op cadence for the test.
          if (key === "rosterPath") return "";
          if (key === "rosterPollIntervalMs") return 0; // Polling fallback OFF.
          return undefined;
        },
      }),
      // M3-01: rosterWatcher requires createFileSystemWatcher. Inert stub —
      // we're not testing watcher firing here, just activation lifecycle.
      createFileSystemWatcher: () => ({
        onDidChange: () => ({ dispose: () => undefined }),
        onDidCreate: () => ({ dispose: () => undefined }),
        onDidDelete: () => ({ dispose: () => undefined }),
        dispose: () => undefined,
      }),
      // M3-03: main.ts wires onDidChangeConfiguration to re-tick the watcher
      // when claudeteam.showAllSessionsGlobally flips. Inert stub here — the
      // leak test doesn't exercise config-change behavior, but the symbol
      // must be present so the activation handler doesn't throw.
      onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    commands: {
      registerCommand: () => ({ dispose: () => undefined }),
    },
    Uri: {
      file: (p: string) => mockUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mockUri(`${base.fsPath}/${parts.join("/")}`),
    },
    // M3-01 surface: activate() now starts a rosterWatcher which uses
    // createFileSystemWatcher + RelativePattern. We stub them as inert
    // (the watcher's directory-missing branch will fire here anyway since
    // the test's home directory probably doesn't have ~/.claudeteam/), but
    // having the symbols present silences the "No 'RelativePattern' export"
    // warning when the directory DOES exist on the test machine.
    RelativePattern: class {
      constructor(
        public readonly base: { fsPath: string } | string,
        public readonly pattern: string,
      ) {}
    },
    WebviewViewResolveContext: {},
    CancellationToken: {},
  };
});

import { activate } from "../../src/extension/main.js";

interface RegisteredProvider {
  resolveWebviewView: (view: unknown, ctx: unknown, token: unknown) => void;
}

function getRegisteredProvider(): RegisteredProvider | null {
  const slot = (globalThis as { __CT_PROVIDER__?: unknown }).__CT_PROVIDER__;
  return (slot as RegisteredProvider | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockContext {
  extensionUri: { fsPath: string };
  subscriptions: Array<{ dispose: () => unknown }>;
}

function makeMockContext(extPath: string): MockContext {
  return {
    extensionUri: { fsPath: extPath },
    subscriptions: [],
  };
}

function makeMockWebviewView() {
  const messageListeners: Array<(raw: unknown) => void> = [];
  return {
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview://test",
      asWebviewUri: (uri: { fsPath: string }) => uri,
      onDidReceiveMessage: (handler: (raw: unknown) => void) => {
        messageListeners.push(handler);
        return { dispose: () => undefined };
      },
      postMessage: vi.fn().mockResolvedValue(true),
    },
  };
}

// ---------------------------------------------------------------------------
// AC7(e): subscription count is bounded across resolve cycles.
// ---------------------------------------------------------------------------

describe("M2-06 AC7(e) — context.subscriptions.length is bounded across 3 resolveWebviewView cycles", () => {
  let tempExt: string;

  beforeEach(() => {
    (globalThis as { __CT_PROVIDER__?: unknown }).__CT_PROVIDER__ = undefined;
    tempExt = mkdtempSync(join(tmpdir(), "ct-m2-06-leak-"));
  });

  it("stays bounded across 3 reload cycles", () => {
    const ctx = makeMockContext(tempExt);

    // Activate the extension. This registers the provider + commands + the
    // cleanup wrapper. activate runs SYNCHRONOUSLY for VS Code; the watcher
    // doesn't start until resolveWebviewView fires.
    activate(ctx as unknown as Parameters<typeof activate>[0]);

    // After activate: subscriptions should hold exactly:
    //   1. cleanup wrapper (registered once)
    //   2. registerWebviewViewProvider's disposable
    //   3-9. seven command registrations (refresh, openRoster,
    //        openAgentTranscript, toggleHideFinished — M5,
    //        openDiagnosticPanel — 86c9zn7tm,
    //        toggleHideIdle — 86c9zq9vm spec 86c9zmyef,
    //        openSettings — 86ca16r2d settings gear)
    // Total expected: 9 entries.
    const afterActivate = ctx.subscriptions.length;
    expect(afterActivate).toBe(9);

    const provider = getRegisteredProvider();
    expect(provider).not.toBeNull();

    // Snapshot length before reload cycles.
    const baseline = ctx.subscriptions.length;

    // Simulate 3 webview reloads — VS Code calls resolveWebviewView on every
    // "Developer: Reload Window" without re-running activate().
    for (let i = 0; i < 3; i++) {
      const view = makeMockWebviewView();
      provider!.resolveWebviewView(view, {}, {});
    }

    // Pre-fix behavior: subscriptions would have grown by +3 (one push per
    // resolveWebviewView). Post-fix: still equal to baseline.
    const afterReloads = ctx.subscriptions.length;
    expect(afterReloads).toBe(baseline);

    // Cleanup — dispose the registered wrapper so the watcher stops.
    for (const d of ctx.subscriptions) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }

    rmSync(tempExt, { recursive: true, force: true });
  });

  it("disposing the registered cleanup wrapper tears down the watcher", () => {
    const ctx = makeMockContext(tempExt);
    activate(ctx as unknown as Parameters<typeof activate>[0]);

    const provider = getRegisteredProvider()!;
    const view = makeMockWebviewView();
    provider.resolveWebviewView(view, {}, {});

    // Dispose every registered subscription — should not throw.
    expect(() => {
      for (const d of ctx.subscriptions) {
        d.dispose();
      }
    }).not.toThrow();

    rmSync(tempExt, { recursive: true, force: true });
  });
});
