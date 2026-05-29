/**
 * Unit tests for src/extension/commands/openSettings.ts (86ca16r2d).
 *
 * Coverage:
 *   - `openSettings` invokes `workbench.action.openSettings` with the
 *     `@ext:claudeteam.claudeteam` filter query.
 *   - `SETTINGS_QUERY` matches the LIVE package.json `publisher` + `name`
 *     (anti-fabrication guard — fails loudly if either field changes so the
 *     gear can never silently open an unfiltered Settings pane).
 *   - `registerOpenSettingsCommand` registers the command + pushes the
 *     disposable onto `context.subscriptions`.
 *   - Command failure surfaces `showErrorMessage` and never throws.
 *   - package.json manifest shape: the command is declared with `$(gear)`
 *     and the `view/title` menu targets the real Dashboard view id in the
 *     `navigation` group.
 *
 * The vscode module is fully mocked (no real VS Code instance). package.json
 * is read from disk for the manifest-shape assertions — the contribution
 * shape is the contract VS Code consumes, so the test pins the real file.
 *
 * Source: src/extension/commands/openSettings.ts
 *         package.json contributes.commands / contributes.menus
 *         ClickUp 86ca16r2d
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// vscode mock — capture executeCommand, showErrorMessage, registerCommand.
// ---------------------------------------------------------------------------

const executeCommand = vi.fn();
const showErrorMessage = vi.fn();
const registerCommandSpy = vi.fn();

vi.mock("vscode", () => {
  return {
    window: {
      showErrorMessage: (...args: unknown[]) => showErrorMessage(...args),
    },
    commands: {
      executeCommand: (...args: unknown[]) => executeCommand(...args),
      registerCommand: (id: string, handler: () => void) => {
        registerCommandSpy(id, handler);
        return { dispose: vi.fn() };
      },
    },
  };
});

// Import AFTER vi.mock — hoisting guarantees the mock is in place.
import {
  SETTINGS_QUERY,
  openSettings,
  registerOpenSettingsCommand,
} from "../../src/extension/commands/openSettings.js";

beforeEach(() => {
  executeCommand.mockReset();
  showErrorMessage.mockReset();
  registerCommandSpy.mockReset();
});

// ---------------------------------------------------------------------------
// Live package.json — used for the manifest-shape + anti-fabrication tests.
// ---------------------------------------------------------------------------

const PKG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "package.json",
);
const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8")) as {
  publisher: string;
  name: string;
  contributes: {
    commands: Array<{ command: string; title: string; icon?: string }>;
    menus?: Record<
      string,
      Array<{ command: string; when?: string; group?: string }>
    >;
    views: Record<string, Array<{ id: string }>>;
  };
};

// ---------------------------------------------------------------------------
// SETTINGS_QUERY — anti-fabrication guard
// ---------------------------------------------------------------------------

describe("SETTINGS_QUERY — anti-fabrication", () => {
  it("matches the live package.json publisher + name", () => {
    // If publisher or name ever changes, the @ext: filter silently stops
    // scoping the Settings pane to ClaudeTeam. Pin it to the live manifest.
    expect(SETTINGS_QUERY).toBe(`@ext:${pkg.publisher}.${pkg.name}`);
  });

  it("is the documented @ext:claudeteam.claudeteam value", () => {
    expect(SETTINGS_QUERY).toBe("@ext:claudeteam.claudeteam");
  });
});

// ---------------------------------------------------------------------------
// openSettings — command flow
// ---------------------------------------------------------------------------

describe("openSettings — opens filtered native Settings", () => {
  it("invokes workbench.action.openSettings with the filter query", async () => {
    await openSettings();

    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand.mock.calls[0]![0]).toBe(
      "workbench.action.openSettings",
    );
    expect(executeCommand.mock.calls[0]![1]).toBe(SETTINGS_QUERY);
  });

  it("surfaces showErrorMessage on executeCommand failure and does not throw", async () => {
    executeCommand.mockRejectedValueOnce(new Error("settings-busted"));

    await expect(openSettings()).resolves.toBeUndefined();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain("settings-busted");
  });
});

// ---------------------------------------------------------------------------
// registerOpenSettingsCommand — registration smoke
// ---------------------------------------------------------------------------

describe("registerOpenSettingsCommand", () => {
  it("registers `claudeteam.openSettings` and pushes the disposable", () => {
    const subs: Array<{ dispose: () => void }> = [];
    const fakeContext = {
      subscriptions: subs,
    } as unknown as import("vscode").ExtensionContext;

    const disposable = registerOpenSettingsCommand(fakeContext);

    expect(registerCommandSpy).toHaveBeenCalledTimes(1);
    expect(registerCommandSpy.mock.calls[0]![0]).toBe("claudeteam.openSettings");
    expect(typeof registerCommandSpy.mock.calls[0]![1]).toBe("function");
    expect(disposable).toBeDefined();
    expect(subs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// package.json manifest shape — the contract VS Code consumes
// ---------------------------------------------------------------------------

describe("package.json manifest — openSettings contribution", () => {
  it("declares the claudeteam.openSettings command with a $(gear) icon", () => {
    const cmd = pkg.contributes.commands.find(
      (c) => c.command === "claudeteam.openSettings",
    );
    expect(cmd, "claudeteam.openSettings must be in contributes.commands").toBeDefined();
    expect(cmd!.title).toBe("ClaudeTeam: Open Settings");
    expect(cmd!.icon).toBe("$(gear)");
  });

  it("adds a view/title menu entry targeting the real Dashboard view id", () => {
    const viewTitle = pkg.contributes.menus?.["view/title"];
    expect(viewTitle, "contributes.menus must declare view/title").toBeDefined();

    const entry = viewTitle!.find(
      (m) => m.command === "claudeteam.openSettings",
    );
    expect(entry, "view/title must include the openSettings command").toBeDefined();
    expect(entry!.group).toBe("navigation");

    // The `when` clause must reference an actual contributed view id —
    // a typo here means the gear never appears. Derive the real id from
    // contributes.views (anti-fabrication: don't hard-code the literal).
    const dashboardView = Object.values(pkg.contributes.views)
      .flat()
      .find((v) => v.id === "claudeteam.dashboard");
    expect(dashboardView, "claudeteam.dashboard must be a contributed view").toBeDefined();
    expect(entry!.when).toBe(`view == ${dashboardView!.id}`);
  });
});
