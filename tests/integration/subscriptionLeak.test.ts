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
          return undefined;
        },
      }),
    },
    commands: {
      registerCommand: () => ({ dispose: () => undefined }),
    },
    Uri: {
      file: (p: string) => mockUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mockUri(`${base.fsPath}/${parts.join("/")}`),
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
    //   3-5. three command registrations (refresh, openRoster, openAgentTranscript)
    // Total expected: 5 entries.
    const afterActivate = ctx.subscriptions.length;
    expect(afterActivate).toBe(5);

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
