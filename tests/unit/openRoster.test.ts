/**
 * Unit tests for src/extension/commands/openRoster.ts (M3-02).
 *
 * Coverage (AC7):
 *   - Path resolution honors `claudeteam.rosterPath` config override.
 *   - Path resolution falls back to `~/.claudeteam/teams.yaml` when override
 *     is empty / unset.
 *   - Auto-create branch fires when the file is missing — parent directory
 *     created recursively + starter stub written.
 *   - Auto-create does NOT fire when the file exists — no overwrite of a
 *     hand-authored roster.
 *   - The opened-file URI passed to `vscode.window.showTextDocument` is the
 *     resolved roster path.
 *   - Filesystem failure during `ensureStarterRoster` surfaces an error
 *     message and aborts the showTextDocument call.
 *
 * Test isolation: each test runs in a fresh tempdir under `os.tmpdir()` and
 * configures the `claudeteam.rosterPath` override to point inside it, so
 * the user's real `~/.claudeteam/` is never touched.
 *
 * The vscode module is fully mocked (no real VS Code instance is spun up).
 * The `node:fs` module is NOT mocked — the test runs against real disk in
 * the tempdir. Rationale: testing the actual mkdir+writeFile pipeline is
 * cheap (sub-millisecond per test) and exercises the real failure modes
 * (permissions, atomic-replace, encoding) without fixture fragility.
 *
 * Source: src/extension/commands/openRoster.ts
 *         team/nora-pl/milestone-3-backlog.md §M3-02 AC2/AC3/AC4/AC5/AC7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------------
// vscode mock — capture showErrorMessage, showTextDocument, and let each
// test inject the value `claudeteam.rosterPath` resolves to.
// ---------------------------------------------------------------------------

/** Per-test override for the `claudeteam.rosterPath` config get(). */
let rosterPathOverride: string | undefined;

const showErrorMessage = vi.fn();
const showTextDocument = vi.fn();
const registerCommandSpy = vi.fn();

vi.mock("vscode", () => {
  return {
    window: {
      showErrorMessage: (...args: unknown[]) => showErrorMessage(...args),
      showTextDocument: (...args: unknown[]) => showTextDocument(...args),
    },
    workspace: {
      getConfiguration: (section: string) => ({
        get: (key: string) => {
          if (section === "claudeteam" && key === "rosterPath") {
            return rosterPathOverride;
          }
          return undefined;
        },
      }),
    },
    commands: {
      registerCommand: (id: string, handler: () => void) => {
        registerCommandSpy(id, handler);
        return { dispose: vi.fn() };
      },
    },
    Uri: {
      file: (p: string) => ({ fsPath: p, scheme: "file" }),
    },
  };
});

// Import AFTER vi.mock — hoisting guarantees the mock is in place before
// the SUT pulls vscode in.
import {
  STARTER_YAML_STUB,
  ensureStarterRoster,
  openRoster,
  registerOpenRosterCommand,
  resolveGlobalRosterPath,
} from "../../src/extension/commands/openRoster.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tempRoot: string;

beforeEach(() => {
  showErrorMessage.mockReset();
  showTextDocument.mockReset();
  registerCommandSpy.mockReset();
  rosterPathOverride = undefined;
  tempRoot = mkdtempSync(join(tmpdir(), "ct-m3-02-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveGlobalRosterPath — AC2
// ---------------------------------------------------------------------------

describe("resolveGlobalRosterPath — AC2", () => {
  it("returns the config override when claudeteam.rosterPath is non-empty", () => {
    const overridePath = join(tempRoot, "custom", "roster.yaml");
    rosterPathOverride = overridePath;

    expect(resolveGlobalRosterPath()).toBe(overridePath);
  });

  it("falls back to ~/.claudeteam/teams.yaml when override is empty string", () => {
    rosterPathOverride = "";
    const resolved = resolveGlobalRosterPath();
    expect(resolved.endsWith(join(".claudeteam", "teams.yaml"))).toBe(true);
  });

  it("falls back to ~/.claudeteam/teams.yaml when override is undefined", () => {
    rosterPathOverride = undefined;
    const resolved = resolveGlobalRosterPath();
    expect(resolved.endsWith(join(".claudeteam", "teams.yaml"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureStarterRoster — AC3, AC4
// ---------------------------------------------------------------------------

describe("ensureStarterRoster — AC3 (auto-create-when-missing)", () => {
  it("creates the parent directory + starter stub when file is missing", () => {
    const rosterPath = join(tempRoot, "nested", "deeper", "teams.yaml");
    expect(existsSync(rosterPath)).toBe(false);
    expect(existsSync(dirname(rosterPath))).toBe(false);

    const created = ensureStarterRoster(rosterPath);

    expect(created).toBe(true);
    expect(existsSync(rosterPath)).toBe(true);
    const written = readFileSync(rosterPath, "utf8");
    expect(written).toBe(STARTER_YAML_STUB);
  });

  it("writes a starter stub that parses to a valid empty roster (teams: [])", () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    ensureStarterRoster(rosterPath);
    const written = readFileSync(rosterPath, "utf8");
    // AC3: the stub MUST be valid YAML; teams: [] is the minimum legal
    // roster (loader.ts accepts it). The 1-line live YAML at the bottom
    // is the test signal.
    expect(written).toContain("\nteams: []\n");
  });

  it("documents the schema in leading # comments (AC3 schema doc requirement)", () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    ensureStarterRoster(rosterPath);
    const written = readFileSync(rosterPath, "utf8");
    // AC3: starter stub MUST include leading # comments documenting the
    // schema. The exact heading text is load-bearing only insofar as the
    // stub must be self-documenting; assert the key schema tokens are
    // present so a future stub-text refactor that strips them breaks here.
    expect(written).toMatch(/^# ClaudeTeam roster/);
    expect(written).toContain("name_prefix");
    expect(written).toContain("agentType_equals");
    expect(written).toContain("description_contains");
  });

  it("includes the ClaudeTeam personas as a commented worked example (AC4)", () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    ensureStarterRoster(rosterPath);
    const written = readFileSync(rosterPath, "utf8");
    // AC4: starter stub uses Felix/Maya/Nora/Iris/Sage/Bram as a worked
    // example, commented out by default. The personas MUST appear inside
    // a commented block — every line beginning with `# ` — so they are
    // not parsed as live config.
    for (const persona of ["felix", "maya", "nora", "iris", "sage", "bram"]) {
      const re = new RegExp(`#\\s*-\\s*id:\\s*${persona}\\b`);
      expect(written, `persona ${persona} present in commented example`).toMatch(re);
    }
  });
});

describe("ensureStarterRoster — AC3 (no-overwrite-when-exists)", () => {
  it("returns false and does NOT overwrite when the file already exists", () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    const userContent = "teams:\n  - id: hand-authored\n    name: 'mine'\n";
    mkdirSync(dirname(rosterPath), { recursive: true });
    writeFileSync(rosterPath, userContent, "utf8");

    const created = ensureStarterRoster(rosterPath);

    expect(created).toBe(false);
    // Critical assertion: user content is preserved byte-for-byte.
    expect(readFileSync(rosterPath, "utf8")).toBe(userContent);
  });

  it("does NOT call showErrorMessage when file already exists", () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    writeFileSync(rosterPath, "teams: []\n", "utf8");

    ensureStarterRoster(rosterPath);

    expect(showErrorMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// openRoster — full command flow (AC2 + AC5)
// ---------------------------------------------------------------------------

describe("openRoster — AC5 (opens via showTextDocument)", () => {
  it("opens the resolved path via vscode.window.showTextDocument", async () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    rosterPathOverride = rosterPath;

    await openRoster();

    expect(showTextDocument).toHaveBeenCalledTimes(1);
    const uri = showTextDocument.mock.calls[0]![0] as {
      fsPath: string;
      scheme: string;
    };
    expect(uri.fsPath).toBe(rosterPath);
    expect(uri.scheme).toBe("file");
  });

  it("auto-creates the file when missing, then opens it (full AC2+AC3+AC5)", async () => {
    const rosterPath = join(tempRoot, "fresh", "teams.yaml");
    rosterPathOverride = rosterPath;
    expect(existsSync(rosterPath)).toBe(false);

    await openRoster();

    expect(existsSync(rosterPath)).toBe(true);
    expect(showTextDocument).toHaveBeenCalledTimes(1);
    expect(showErrorMessage).not.toHaveBeenCalled();
  });

  it("respects an existing file and opens it without overwriting (AC3 no-overwrite)", async () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    rosterPathOverride = rosterPath;
    const userContent = "teams:\n  - id: hand-authored\n    name: 'mine'\n";
    writeFileSync(rosterPath, userContent, "utf8");

    await openRoster();

    expect(readFileSync(rosterPath, "utf8")).toBe(userContent);
    expect(showTextDocument).toHaveBeenCalledTimes(1);
  });

  it("surfaces showErrorMessage on showTextDocument failure (defensive AC5)", async () => {
    const rosterPath = join(tempRoot, "teams.yaml");
    rosterPathOverride = rosterPath;
    writeFileSync(rosterPath, "teams: []\n", "utf8");
    showTextDocument.mockRejectedValueOnce(new Error("editor-busted"));

    await openRoster();

    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    expect(showErrorMessage.mock.calls[0]![0]).toContain("editor-busted");
  });

  it("aborts showTextDocument when ensureStarterRoster fails", async () => {
    // Point at a path whose parent CANNOT be created — under POSIX, the
    // string `\0` is illegal in path components; under Windows, a path
    // beginning with NUL or containing illegal chars throws. We use a
    // strategy that works cross-platform: pre-create a FILE at the parent
    // location, then point the roster at a child of it — mkdirSync fails
    // because the parent is a file, not a dir.
    const wedgeFile = join(tempRoot, "wedge");
    writeFileSync(wedgeFile, "I am a file, not a directory", "utf8");
    const rosterPath = join(wedgeFile, "teams.yaml");
    rosterPathOverride = rosterPath;

    await openRoster();

    expect(showErrorMessage).toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// registerOpenRosterCommand — registration smoke
// ---------------------------------------------------------------------------

describe("registerOpenRosterCommand — AC1", () => {
  it("registers the `claudeteam.openRoster` command on the context", () => {
    const subs: Array<{ dispose: () => void }> = [];
    const fakeContext = {
      subscriptions: subs,
    } as unknown as import("vscode").ExtensionContext;

    const disposable = registerOpenRosterCommand(fakeContext);

    expect(registerCommandSpy).toHaveBeenCalledTimes(1);
    expect(registerCommandSpy.mock.calls[0]![0]).toBe("claudeteam.openRoster");
    expect(typeof registerCommandSpy.mock.calls[0]![1]).toBe("function");
    // Returned disposable AND pushed onto context.subscriptions for cleanup.
    expect(disposable).toBeDefined();
    expect(subs).toHaveLength(1);
  });
});
