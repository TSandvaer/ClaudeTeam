/**
 * Integration tests for the roster YAML hot-reload watcher (M3-01).
 *
 * Builds a tempdir with a real roster YAML, starts `startRosterWatcher`
 * against the tempdir paths, mutates the YAML through ordinary filesystem
 * operations, and asserts that `onRosterChange` fires within the AC9 budget
 * (2 seconds) with a fresh `RosterLoadResult`.
 *
 * ## Why this test drives change-detection through the POLLING FALLBACK
 *
 * `startRosterWatcher` registers two paths of change-detection:
 *   (a) `vscode.workspace.createFileSystemWatcher` (the production path).
 *   (b) `setInterval` + `fs.statSync(...).mtimeMs` (the AC8 fallback).
 *
 * Real VS Code's FileSystemWatcher cannot be exercised inside vitest — the
 * `vscode` module is mocked away (see the `vi.mock("vscode", ...)` block
 * below). Path (a) is covered end-to-end by the M3-09 Layer-3
 * `@vscode/test-electron` suite, which spins up a real VS Code instance.
 *
 * In this Layer-2 suite we wire the watcher with `pollIntervalMs: 200`,
 * which exercises path (b). Both paths funnel into the same debounce +
 * `loadRoster` + `onRosterChange` pipeline, so this test still covers:
 *   - debounce coalescing
 *   - empty-directory log behavior
 *   - create-after-watcher-starts detection
 *   - delete-after-watcher-starts detection
 *   - malformed-YAML surfacing through `RosterLoadResult.errors`
 *   - mutation → reload latency under the AC9 budget
 *
 * ## Mock surface
 *
 * `createFileSystemWatcher` is stubbed to return an inert disposable that
 * never fires events — the polling path is the sole driver. This keeps the
 * mock honest: anything the production code does ON the FileSystemWatcher
 * is exercised, but we don't pretend to simulate VS Code's debounce /
 * coalescing behavior (which would couple the test to internals).
 *
 * Source: team/nora-pl/milestone-3-backlog.md §M3-01 AC9
 *         .claude/docs/testing-strategy.md Layer 2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  unlinkSync,
  mkdtempSync,
  existsSync,
  utimesSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// vscode mock — minimal surface for `createFileSystemWatcher` + `RelativePattern`.
// The mock's FileSystemWatcher is inert; change-detection runs via the polling
// fallback. See the suite header for rationale.
// ---------------------------------------------------------------------------

const fsWatcherFactoryCalls: Array<{ baseFsPath: string; pattern: string }> = [];

vi.mock("vscode", () => {
  const Uri = {
    file: (p: string) => ({ fsPath: p, scheme: "file" }),
  };
  class RelativePattern {
    constructor(
      public readonly base: { fsPath: string } | string,
      public readonly pattern: string,
    ) {}
  }
  return {
    Uri,
    RelativePattern,
    workspace: {
      createFileSystemWatcher: (rp: RelativePattern) => {
        const base = typeof rp.base === "string" ? rp.base : rp.base.fsPath;
        fsWatcherFactoryCalls.push({ baseFsPath: base, pattern: rp.pattern });
        return {
          onDidChange: () => ({ dispose: () => undefined }),
          onDidCreate: () => ({ dispose: () => undefined }),
          onDidDelete: () => ({ dispose: () => undefined }),
          dispose: () => undefined,
        };
      },
    },
  };
});

import { startRosterWatcher } from "../../src/extension/roster/rosterWatcher.js";
import type { RosterLoadResult } from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// Test fixtures (inlined — simple YAML; the full loader-shape fixtures live
// under tests/fixtures/ and are exercised by the loader unit tests).
// ---------------------------------------------------------------------------

const VALID_ROSTER_A = `teams:
  - id: claudeteam-alpha
    name: "ClaudeTeam Alpha"
    members:
      - id: felix
        display: "Felix"
        role: "Extension Host Dev"
        match:
          - agentType_equals: "felix"
`;

const VALID_ROSTER_B = `teams:
  - id: claudeteam-alpha
    name: "ClaudeTeam Alpha"
    members:
      - id: felix
        display: "Felix"
        role: "Extension Host Dev"
        match:
          - agentType_equals: "felix"
      - id: maya
        display: "Maya"
        role: "Webview UI Dev"
        match:
          - agentType_equals: "maya"
`;

const MALFORMED_ROSTER = `teams:
  - id: claudeteam-broken
    name: "ClaudeTeam Broken
    members:
      - id: felix
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// TEST_POLL_MS is the value we PASS to startRosterWatcher; the watcher
// internally clamps to ROSTER_POLL_MIN_MS (250ms — matches the debounce
// window). Using 250ms here exercises the tightest production-permissible
// poll cadence; the AC9 budget (2s) gives plenty of headroom for slow CI
// runners (worst case: 250ms poll + 250ms debounce + filesystem mtime
// granularity).
const TEST_POLL_MS = 250;
const RELOAD_BUDGET_MS = 2000; // AC9: must fire within 2 seconds.

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  pollMs: number = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(pollMs);
  }
  return predicate();
}

/**
 * Bump the mtime of a file to a monotonically-increasing future timestamp.
 *
 * Some filesystems (ext4 + Windows NTFS in some configurations) have
 * mtimes that are less precise than `Date.now()`, so rewriting the same
 * content within the same OS tick can produce identical mtimes which the
 * polling fallback would miss. We use a module-scoped counter to guarantee
 * each call yields a strictly-larger mtime than the previous one, which
 * eliminates the FS-precision-induced flake — verified on Ubuntu CI where
 * 3 rapid `Date.now()` calls were collapsing to the same second.
 */
let mtimeCounterSec = 0;
function bumpMtime(path: string): void {
  // Start ~5 minutes in the future on first call, then add 1 second per
  // call. Future-dating avoids colliding with the file's actual creation
  // time during the test's prior writeFileSync calls.
  if (mtimeCounterSec === 0) {
    mtimeCounterSec = Math.floor(Date.now() / 1000) + 300;
  } else {
    mtimeCounterSec += 1;
  }
  utimesSync(path, mtimeCounterSec, mtimeCounterSec);
}

interface Harness {
  rootDir: string;
  rosterPath: string;
  emissions: RosterLoadResult[];
  disposable: { dispose: () => void };
  cleanup: () => void;
}

/**
 * Stand up a tempdir + write a roster YAML + start the watcher with the
 * polling fallback active. Caller mutates the YAML and waits for emissions.
 */
function startHarness(initialYaml: string | null): Harness {
  fsWatcherFactoryCalls.length = 0;
  const rootDir = mkdtempSync(join(tmpdir(), "ct-m3-01-rw-"));
  const rosterDir = join(rootDir, ".claudeteam");
  mkdirSync(rosterDir, { recursive: true });
  const rosterPath = join(rosterDir, "teams.yaml");
  if (initialYaml !== null) {
    writeFileSync(rosterPath, initialYaml, "utf8");
  }

  const emissions: RosterLoadResult[] = [];
  const disposable = startRosterWatcher({
    globalPath: rosterPath,
    pollIntervalMs: TEST_POLL_MS,
    onRosterChange: (result) => {
      emissions.push(result);
    },
  });

  return {
    rootDir,
    rosterPath,
    emissions,
    disposable,
    cleanup: () => {
      try {
        disposable.dispose();
      } catch {
        /* ignore */
      }
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// AC2 — registers a vscode FileSystemWatcher per directory with RelativePattern.
// ---------------------------------------------------------------------------

describe("M3-01 AC2: FileSystemWatcher registration", () => {
  let harness: Harness | null = null;

  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  it("registers a RelativePattern-based watcher for the global roster directory", () => {
    harness = startHarness(VALID_ROSTER_A);
    expect(fsWatcherFactoryCalls).toHaveLength(1);
    expect(fsWatcherFactoryCalls[0]!.pattern).toBe("*.yaml");
    // Base must be the *directory*, not the file — that's what
    // vscode.RelativePattern(Uri.file(dir), '*.yaml') means in production
    // and is the load-bearing fix vs a plain glob string.
    expect(fsWatcherFactoryCalls[0]!.baseFsPath.toLowerCase()).toBe(
      join(harness.rootDir, ".claudeteam").toLowerCase(),
    );
  });

  it("registers one watcher per existing directory (global + project)", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "ct-m3-01-rw-"));
    const globalDir = join(rootDir, ".claudeteam");
    const projectDir = join(rootDir, "project", ".claude");
    mkdirSync(globalDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    const globalPath = join(globalDir, "teams.yaml");
    const projectPath = join(projectDir, "teams.yaml");
    writeFileSync(globalPath, VALID_ROSTER_A, "utf8");
    writeFileSync(projectPath, VALID_ROSTER_A, "utf8");
    fsWatcherFactoryCalls.length = 0;

    const disposable = startRosterWatcher({
      globalPath,
      projectPath,
      onRosterChange: () => undefined,
    });

    expect(fsWatcherFactoryCalls).toHaveLength(2);
    const patterns = fsWatcherFactoryCalls.map((c) => c.pattern);
    expect(patterns.every((p) => p === "*.yaml")).toBe(true);
    const bases = fsWatcherFactoryCalls.map((c) => c.baseFsPath.toLowerCase());
    expect(bases).toContain(globalDir.toLowerCase());
    expect(bases).toContain(projectDir.toLowerCase());

    disposable.dispose();
    rmSync(rootDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// AC6 — directory-missing logs once, does not error or register a watcher.
// ---------------------------------------------------------------------------

describe("M3-01 AC6/AC7: empty-state semantics", () => {
  it("logs once and skips watcher registration when global directory does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "ct-m3-01-rw-"));
    const missingDir = join(root, "does-not-exist");
    const missingPath = join(missingDir, "teams.yaml");
    fsWatcherFactoryCalls.length = 0;
    const infoLogs: string[] = [];
    const warnLogs: string[] = [];

    const disposable = startRosterWatcher({
      globalPath: missingPath,
      onRosterChange: () => undefined,
      logger: {
        info: (m) => infoLogs.push(m),
        warn: (m) => warnLogs.push(m),
      },
    });

    expect(fsWatcherFactoryCalls).toHaveLength(0);
    expect(warnLogs).toEqual([]);
    expect(infoLogs).toHaveLength(1);
    expect(infoLogs[0]).toContain("global roster directory does not exist");

    disposable.dispose();
    rmSync(root, { recursive: true, force: true });
  });

  it("does not throw when both paths are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "ct-m3-01-rw-"));
    const missingGlobal = join(root, "missing1", "teams.yaml");
    const missingProject = join(root, "missing2", "teams.yaml");

    expect(() => {
      const disposable = startRosterWatcher({
        globalPath: missingGlobal,
        projectPath: missingProject,
        onRosterChange: () => undefined,
      });
      disposable.dispose();
    }).not.toThrow();

    rmSync(root, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// AC9 — mutation triggers onRosterChange within 2s with the new roster.
// ---------------------------------------------------------------------------

describe("M3-01 AC9: hot-reload on YAML mutation", () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    // No-op — each test creates its own harness so they can assert on
    // pre-vs-post-mutation emission counts cleanly.
  });

  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  it("fires onRosterChange within 2s of YAML content change", async () => {
    harness = startHarness(VALID_ROSTER_A);

    // Roster watcher does NOT emit on startup (caller already loaded the
    // initial roster at activation). Confirm baseline.
    expect(harness.emissions).toHaveLength(0);

    const start = Date.now();
    writeFileSync(harness.rosterPath, VALID_ROSTER_B, "utf8");
    bumpMtime(harness.rosterPath);

    const gotEmission = await waitFor(
      () => harness!.emissions.length >= 1,
      RELOAD_BUDGET_MS,
    );
    const elapsed = Date.now() - start;

    expect(gotEmission).toBe(true);
    expect(elapsed).toBeLessThan(RELOAD_BUDGET_MS);

    const result = harness.emissions[0]!;
    expect(result.errors).toEqual([]);
    expect(result.roster).toHaveLength(1);
    expect(result.roster[0]!.members).toHaveLength(2);
    expect(result.roster[0]!.members.map((m) => m.id)).toEqual(["felix", "maya"]);
  });

  it("fires onRosterChange on create-after-watcher-starts", async () => {
    // Start with NO file in the directory. The dir exists, the file doesn't.
    const rootDir = mkdtempSync(join(tmpdir(), "ct-m3-01-rw-"));
    const rosterDir = join(rootDir, ".claudeteam");
    mkdirSync(rosterDir, { recursive: true });
    const rosterPath = join(rosterDir, "teams.yaml");

    const emissions: RosterLoadResult[] = [];
    const disposable = startRosterWatcher({
      globalPath: rosterPath,
      pollIntervalMs: TEST_POLL_MS,
      onRosterChange: (result) => emissions.push(result),
    });

    writeFileSync(rosterPath, VALID_ROSTER_A, "utf8");
    bumpMtime(rosterPath);

    const gotEmission = await waitFor(
      () => emissions.length >= 1,
      RELOAD_BUDGET_MS,
    );
    expect(gotEmission).toBe(true);
    expect(emissions[0]!.errors).toEqual([]);
    expect(emissions[0]!.roster).toHaveLength(1);

    disposable.dispose();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("fires onRosterChange on delete (and roster reflects absence)", async () => {
    harness = startHarness(VALID_ROSTER_A);

    unlinkSync(harness.rosterPath);

    const gotEmission = await waitFor(
      () => harness!.emissions.length >= 1,
      RELOAD_BUDGET_MS,
    );
    expect(gotEmission).toBe(true);

    // Loader marks missing file as a warning, not an error; roster goes empty.
    const result = harness.emissions[0]!;
    expect(result.errors).toEqual([]);
    expect(result.roster).toEqual([]);
    expect(result.warnings.some((w) => w.includes("not found"))).toBe(true);
  });

  it("surfaces malformed YAML via result.errors without throwing", async () => {
    harness = startHarness(VALID_ROSTER_A);

    writeFileSync(harness.rosterPath, MALFORMED_ROSTER, "utf8");
    bumpMtime(harness.rosterPath);

    const gotEmission = await waitFor(
      () => harness!.emissions.length >= 1,
      RELOAD_BUDGET_MS,
    );
    expect(gotEmission).toBe(true);

    const result = harness.emissions[0]!;
    expect(result.errors.length).toBeGreaterThan(0);
    // The previous valid roster is the caller's responsibility to retain;
    // the watcher itself surfaces the parse error in `errors` and an empty
    // roster in `roster`. The matcher / runTick caller decides whether to
    // fall back to a cached prior roster (M3-04 chip drives the UX).
    expect(result.roster).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC3 — debounce coalesces rapid events into a single reload.
// ---------------------------------------------------------------------------

describe("M3-01 AC3: debounce coalescing", () => {
  let harness: Harness | null = null;

  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  it("coalesces multiple rapid mutations within the debounce window into one emission", async () => {
    harness = startHarness(VALID_ROSTER_A);

    // Fire several mutations in quick succession. Under the polling
    // fallback path, each poll that observes a new mtime calls
    // scheduleReload(), which RESETS the 250ms debounce. So we expect
    // the debounce to coalesce all of these into ONE emission once the
    // mtime stabilizes — verified via the final-content assertion below.
    writeFileSync(harness.rosterPath, VALID_ROSTER_B, "utf8");
    bumpMtime(harness.rosterPath);
    await sleep(50);
    writeFileSync(harness.rosterPath, VALID_ROSTER_A, "utf8");
    bumpMtime(harness.rosterPath);
    await sleep(50);
    writeFileSync(harness.rosterPath, VALID_ROSTER_B, "utf8");
    bumpMtime(harness.rosterPath);

    // Wait for emission, then wait an extra full poll cycle + debounce
    // window to confirm no additional emission slips through after the
    // first one (which would falsify "coalesced to ONE").
    const got = await waitFor(
      () => harness!.emissions.length >= 1,
      RELOAD_BUDGET_MS,
    );
    expect(got).toBe(true);
    await sleep(TEST_POLL_MS + 400);

    // Exactly one emission; final content should be VALID_ROSTER_B (the
    // last write before the debounce fired).
    expect(harness.emissions).toHaveLength(1);
    expect(harness.emissions[0]!.roster[0]!.members.map((m) => m.id)).toEqual([
      "felix",
      "maya",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Disposal — dispose() stops polling + clears the debounce timer.
// ---------------------------------------------------------------------------

describe("M3-01 disposable contract", () => {
  it("dispose() halts further onRosterChange emissions", async () => {
    const harness = startHarness(VALID_ROSTER_A);
    harness.disposable.dispose();
    // Reset emissions in case any landed prior to dispose (shouldn't on
    // first-tick — there's no startup emission — but defense in depth).
    harness.emissions.length = 0;

    writeFileSync(harness.rosterPath, VALID_ROSTER_B, "utf8");
    bumpMtime(harness.rosterPath);

    // Wait a full poll cycle + debounce + buffer; if dispose() worked
    // there will be NO emission within that window.
    await sleep(TEST_POLL_MS + 500);
    expect(harness.emissions).toHaveLength(0);

    try {
      rmSync(harness.rootDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("dispose() is idempotent", () => {
    const harness = startHarness(VALID_ROSTER_A);
    expect(() => {
      harness.disposable.dispose();
      harness.disposable.dispose();
    }).not.toThrow();
    try {
      rmSync(harness.rootDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});

// ---------------------------------------------------------------------------
// Sanity check — `statSync` works on the fixture we're going to mtime-poll.
// Catches platform-level test-setup bugs that would otherwise produce
// misleading "watcher didn't fire" failures.
// ---------------------------------------------------------------------------

describe("test-environment sanity", () => {
  it("can statSync a file created in tempdir (mtime polling pre-flight)", () => {
    const root = mkdtempSync(join(tmpdir(), "ct-m3-01-sanity-"));
    const path = join(root, "x.yaml");
    writeFileSync(path, "teams: []\n", "utf8");
    expect(existsSync(path)).toBe(true);
    const m = statSync(path).mtimeMs;
    expect(typeof m).toBe("number");
    expect(m).toBeGreaterThan(0);
    rmSync(root, { recursive: true, force: true });
  });
});
