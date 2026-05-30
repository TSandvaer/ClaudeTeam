/**
 * Unit tests for src/extension/commands/manageTeam.ts (86ca1u0nf).
 *
 * Coverage:
 *   - `manageTeam` reveals the view, then (view already resolved) emits setup
 *     data + posts the open-panel message immediately.
 *   - `manageTeam` defers the emit+post one macrotask when the view is NOT yet
 *     resolved at call time (fire-and-forget postMessage caveat) — and the
 *     deferred calls fire after the view resolves.
 *   - `manageTeam` surfaces showErrorMessage on revealView failure and never
 *     throws.
 *   - `registerManageTeamCommand` registers `claudeteam.manageTeam`, pushes the
 *     disposable, and invokes depsFactory PER INVOCATION (not at registration).
 *   - package.json manifest shape: the command is declared with $(organization)
 *     and the view/title menu targets the real Dashboard view id in the
 *     navigation group, alongside (before) the gear.
 *
 * The vscode module is fully mocked. package.json is read from disk for the
 * manifest-shape assertions (the contribution shape is the contract VS Code
 * consumes).
 *
 * Source: src/extension/commands/manageTeam.ts
 *         package.json contributes.commands / contributes.menus
 *         ClickUp 86ca1u0nf
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// vscode mock — capture showErrorMessage + registerCommand.
// ---------------------------------------------------------------------------

const showErrorMessage = vi.fn();
const registerCommandSpy = vi.fn();

vi.mock("vscode", () => {
  return {
    window: {
      showErrorMessage: (...args: unknown[]) => showErrorMessage(...args),
    },
    commands: {
      registerCommand: (id: string, handler: () => void) => {
        registerCommandSpy(id, handler);
        return { dispose: vi.fn() };
      },
      executeCommand: vi.fn(),
    },
  };
});

import {
  manageTeam,
  registerManageTeamCommand,
  type ManageTeamCommandDeps,
} from "../../src/extension/commands/manageTeam.js";

beforeEach(() => {
  showErrorMessage.mockReset();
  registerCommandSpy.mockReset();
});

// ---------------------------------------------------------------------------
// manageTeam — command flow
// ---------------------------------------------------------------------------

describe("manageTeam — view already resolved", () => {
  it("reveals, then emits setup + posts open-panel immediately", async () => {
    const order: string[] = [];
    const deps: ManageTeamCommandDeps = {
      revealView: async () => {
        order.push("reveal");
      },
      getWebview: () => ({}) as unknown as import("vscode").Webview,
      emitSetup: () => order.push("emit"),
      postOpenPanel: () => order.push("post"),
    };

    await manageTeam(deps);

    // reveal must happen before emit/post; emit before post (panel renders
    // against fresh detection/character data, then the open flag flips).
    expect(order).toEqual(["reveal", "emit", "post"]);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });
});

describe("manageTeam — view NOT yet resolved (deferred)", () => {
  it("defers emit+post one macrotask; they fire after the view resolves", async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const emit = vi.fn();
      const post = vi.fn();
      const deps: ManageTeamCommandDeps = {
        revealView: async () => {
          // Revealing triggers resolveWebviewView in production; model that by
          // flipping `resolved` so the later getWebview() (inside deferral)
          // would see a webview. The synchronous getWebview() at decision time
          // still returns undefined → deferral path taken.
          resolved = true;
        },
        getWebview: () =>
          resolved
            ? ({}) as unknown as import("vscode").Webview
            : undefined,
        emitSetup: emit,
        postOpenPanel: post,
      };

      // At the moment manageTeam reads getWebview() (right after awaiting
      // revealView), `resolved` is already true — so to actually exercise the
      // deferral branch we need getWebview to be undefined at decision time.
      // Use a one-shot: undefined on the FIRST call (decision), defined after.
      let calls = 0;
      deps.getWebview = () => {
        calls += 1;
        return calls === 1
          ? undefined
          : ({}) as unknown as import("vscode").Webview;
      };

      const p = manageTeam(deps);
      await p; // awaits revealView; schedules the setTimeout(0)

      // Not yet fired — still pending in the macrotask queue.
      expect(emit).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();

      await vi.runAllTimersAsync();

      expect(emit).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(1);
      expect(showErrorMessage).not.toHaveBeenCalled();
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("manageTeam — error handling", () => {
  it("surfaces showErrorMessage on revealView failure and does not throw", async () => {
    const deps: ManageTeamCommandDeps = {
      revealView: async () => {
        throw new Error("reveal-busted");
      },
      getWebview: () => undefined,
      emitSetup: vi.fn(),
      postOpenPanel: vi.fn(),
    };

    await expect(manageTeam(deps)).resolves.toBeUndefined();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain("reveal-busted");
  });
});

// ---------------------------------------------------------------------------
// registerManageTeamCommand — registration smoke
// ---------------------------------------------------------------------------

describe("registerManageTeamCommand", () => {
  it("registers `claudeteam.manageTeam` and pushes the disposable", () => {
    const subs: Array<{ dispose: () => void }> = [];
    const fakeContext = {
      subscriptions: subs,
    } as unknown as import("vscode").ExtensionContext;

    const factory = vi.fn<[], ManageTeamCommandDeps>(() => ({
      revealView: async () => undefined,
      getWebview: () => undefined,
      emitSetup: vi.fn(),
      postOpenPanel: vi.fn(),
    }));

    const disposable = registerManageTeamCommand(fakeContext, factory);

    expect(registerCommandSpy).toHaveBeenCalledTimes(1);
    expect(registerCommandSpy.mock.calls[0]![0]).toBe("claudeteam.manageTeam");
    expect(typeof registerCommandSpy.mock.calls[0]![1]).toBe("function");
    expect(disposable).toBeDefined();
    expect(subs).toHaveLength(1);
    // depsFactory must NOT be called at registration time (only per invocation,
    // so the command closes over the CURRENT webview after each resolve).
    expect(factory).not.toHaveBeenCalled();

    // Invoke the registered handler → factory fires exactly once.
    const handler = registerCommandSpy.mock.calls[0]![1] as () => void;
    handler();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// package.json manifest shape — the contract VS Code consumes
// ---------------------------------------------------------------------------

const PKG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
  contributes: {
    commands: Array<{ command: string; title: string; icon?: string }>;
    menus?: Record<
      string,
      Array<{ command: string; when?: string; group?: string }>
    >;
    views: Record<string, Array<{ id: string }>>;
  };
};

describe("package.json manifest — manageTeam contribution", () => {
  it("declares the claudeteam.manageTeam command with a $(organization) icon", () => {
    const cmd = pkg.contributes.commands.find(
      (c) => c.command === "claudeteam.manageTeam",
    );
    expect(
      cmd,
      "claudeteam.manageTeam must be in contributes.commands",
    ).toBeDefined();
    expect(cmd!.title).toBe("ClaudeTeam: Manage Team");
    expect(cmd!.icon).toBe("$(organization)");
  });

  it("adds a view/title menu entry targeting the real Dashboard view id", () => {
    const viewTitle = pkg.contributes.menus?.["view/title"];
    expect(
      viewTitle,
      "contributes.menus must declare view/title",
    ).toBeDefined();

    const entry = viewTitle!.find(
      (m) => m.command === "claudeteam.manageTeam",
    );
    expect(
      entry,
      "view/title must include the manageTeam command",
    ).toBeDefined();
    expect(entry!.group).toBe("navigation@1");

    // The `when` clause must reference an actual contributed view id (a typo
    // means the button never appears). Derive the real id from
    // contributes.views (anti-fabrication: don't hard-code the literal).
    const dashboardView = Object.values(pkg.contributes.views)
      .flat()
      .find((v) => v.id === "claudeteam.dashboard");
    expect(
      dashboardView,
      "claudeteam.dashboard must be a contributed view",
    ).toBeDefined();
    expect(entry!.when).toBe(`view == ${dashboardView!.id}`);
  });

  it("keeps the gear (openSettings) in view/title alongside manageTeam", () => {
    // AC4: gear still opens Settings (unchanged). The manage button is added
    // NEXT TO it, not replacing it.
    const viewTitle = pkg.contributes.menus?.["view/title"] ?? [];
    const gear = viewTitle.find((m) => m.command === "claudeteam.openSettings");
    expect(gear, "openSettings gear must remain in view/title").toBeDefined();
    // Gear stays in the bare `navigation` group (AC4: unchanged). manageTeam
    // carries an explicit `@1` order so it sorts BEFORE the unordered gear
    // within the navigation group (VS Code: ordered items precede unordered).
    expect(gear!.group).toBe("navigation");
    const manage = viewTitle.find((m) => m.command === "claudeteam.manageTeam");
    expect(manage!.group).toBe("navigation@1");
  });
});
