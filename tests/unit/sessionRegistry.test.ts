import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isPidAlive,
  listSessions,
  tryParseSessionFile,
  type SessionRegistryLogger,
} from "../../src/extension/watcher/sessionRegistry";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

/**
 * Build a capturing logger so tests can assert the warning text for the
 * malformed-input branches. Resets each `it` block.
 */
function captureLogger(): {
  logger: SessionRegistryLogger;
  warnings: string[];
} {
  const warnings: string[] = [];
  return {
    logger: { warn: (m: string) => warnings.push(m) },
    warnings,
  };
}

/**
 * Stage a fresh tempdir resembling `~/.claude/`. Each test gets its own
 * so leftover files from one test cannot contaminate another. Returns
 * the path + a cleanup function.
 */
function stageClaudeHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "claudeteam-sessreg-"));
  return {
    home,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/**
 * Pick a PID that is virtually certain to NOT correspond to a running
 * process on either Windows or POSIX. We use 2_147_483_646 (2^31 - 2) —
 * within the int32 PID range some OSes still impose, but far above the
 * range any sane scheduler hands out. `process.kill(this, 0)` raises
 * ESRCH on every common platform. We avoid PID 1 here because on POSIX
 * it's the init/launchd process (alive but typically EPERM); the
 * session-dead-pid.json fixture uses PID 1 deliberately to exercise the
 * "EPERM-as-dead" branch documented in the module.
 */
const DEFINITELY_DEAD_PID = 2_147_483_646;

// =============================================================================
// isPidAlive — direct probes
// =============================================================================

describe("isPidAlive", () => {
  it("returns true for process.pid (the test runner itself)", () => {
    // The test runner is alive by definition — if this fails the whole
    // assumption underlying the live-PID test in AC6 is broken.
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("returns false for a PID that does not exist (ESRCH branch)", () => {
    // 2^31-2 PID is not in use on any platform we test on.
    expect(isPidAlive(DEFINITELY_DEAD_PID)).toBe(false);
  });

  it("returns false for PID 1 (init/System Idle — EPERM-as-dead branch)", () => {
    // PID 1 on Windows = System Idle Process (cannot be signaled by a
    // user-mode process → EPERM); on POSIX = init/launchd (also EPERM
    // for non-root). Either way `isPidAlive` should report false because
    // we treat EPERM as dead for V1 per the module's "Liveness probe
    // semantics" docstring + Sage's M1 test plan §M1-07 edge-case probes.
    expect(isPidAlive(1)).toBe(false);
  });
});

// =============================================================================
// tryParseSessionFile — per-file branches (no sessions/ dir staging needed)
// =============================================================================

describe("tryParseSessionFile", () => {
  it("returns a populated SessionRecord for a well-formed file (live PID)", () => {
    // Build a temp session file pointing at process.pid so isAlive
    // exercises the success path. Real on-disk fixtures have a static
    // PID that would be dead at test time — we synthesize here.
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);
      const filePath = join(sessionsDir, `${process.pid}.json`);
      writeFileSync(
        filePath,
        JSON.stringify({
          pid: process.pid,
          sessionId: "live-process-test",
          cwd: "c:\\test\\cwd",
          startedAt: Date.now(),
          version: "2.1.145",
          entrypoint: "claude-vscode",
        }),
      );

      const { logger, warnings } = captureLogger();
      const rec = tryParseSessionFile(filePath, logger);

      expect(rec).not.toBeNull();
      expect(rec).toEqual({
        pid: process.pid,
        sessionId: "live-process-test",
        cwd: "c:\\test\\cwd",
        version: "2.1.145",
        entrypoint: "claude-vscode",
        startedAt: expect.any(Number),
        isAlive: true,
      });
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("returns isAlive=false for the session-dead-pid.json fixture", () => {
    // Fixture has pid: 1. process.kill(1, 0) raises EPERM on both Windows
    // and Linux CI — we map both to isAlive=false. This is the regression
    // test for the dead-PID branch.
    const { logger, warnings } = captureLogger();
    const rec = tryParseSessionFile(
      join(FIXTURES_DIR, "session-dead-pid.json"),
      logger,
    );

    expect(rec).not.toBeNull();
    expect(rec!.pid).toBe(1);
    expect(rec!.sessionId).toBe("5652d46e-3d14-4411-aaee-590dbfde210b");
    expect(rec!.version).toBe("2.1.145");
    expect(rec!.entrypoint).toBe("claude-vscode");
    expect(rec!.isAlive).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("returns isAlive=true | false depending on PID liveness for session-alive.json fixture", () => {
    // The fixture's PID (121044) may or may not be alive at test time.
    // We assert the record parses correctly and isAlive is a boolean.
    // Liveness for THIS specific PID is non-deterministic — the live-PID
    // branch is covered by the process.pid test above.
    const { logger } = captureLogger();
    const rec = tryParseSessionFile(
      join(FIXTURES_DIR, "session-alive.json"),
      logger,
    );

    expect(rec).not.toBeNull();
    expect(rec!.pid).toBe(121044);
    expect(typeof rec!.isAlive).toBe("boolean");
  });

  it("returns null + warns when JSON is malformed", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);
      const badFile = join(sessionsDir, "999.json");
      writeFileSync(badFile, "{ not valid json");

      const { logger, warnings } = captureLogger();
      const rec = tryParseSessionFile(badFile, logger);

      expect(rec).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("returns null + warns when top-level JSON is not an object", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);
      const badFile = join(sessionsDir, "888.json");
      writeFileSync(badFile, JSON.stringify(["arrays", "are", "not", "ok"]));

      const { logger, warnings } = captureLogger();
      const rec = tryParseSessionFile(badFile, logger);

      expect(rec).toBeNull();
      expect(warnings[0]).toMatch(/must be an object/);
    } finally {
      cleanup();
    }
  });

  it("returns null + warns when required field is missing (pid)", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);
      const badFile = join(sessionsDir, "777.json");
      writeFileSync(
        badFile,
        JSON.stringify({
          sessionId: "no-pid-here",
          cwd: "c:\\x",
          startedAt: 1,
          version: "2.1.145",
          entrypoint: "cli",
        }),
      );

      const { logger, warnings } = captureLogger();
      const rec = tryParseSessionFile(badFile, logger);

      expect(rec).toBeNull();
      expect(warnings[0]).toMatch(/`pid`/);
    } finally {
      cleanup();
    }
  });

  it("returns null + warns when pid is not an integer", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);
      const badFile = join(sessionsDir, "666.json");
      writeFileSync(
        badFile,
        JSON.stringify({
          pid: "not a number",
          sessionId: "s",
          cwd: "c",
          startedAt: 1,
          version: "v",
          entrypoint: "e",
        }),
      );

      const { logger, warnings } = captureLogger();
      const rec = tryParseSessionFile(badFile, logger);

      expect(rec).toBeNull();
      expect(warnings[0]).toMatch(/`pid`/);
    } finally {
      cleanup();
    }
  });

  it("returns null + warns when sessionId is empty string", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);
      const badFile = join(sessionsDir, "555.json");
      writeFileSync(
        badFile,
        JSON.stringify({
          pid: 123,
          sessionId: "",
          cwd: "c",
          startedAt: 1,
          version: "v",
          entrypoint: "e",
        }),
      );

      const { logger, warnings } = captureLogger();
      const rec = tryParseSessionFile(badFile, logger);

      expect(rec).toBeNull();
      expect(warnings[0]).toMatch(/`sessionId`/);
    } finally {
      cleanup();
    }
  });

  it("returns null + warns when the file does not exist on disk (vanished mid-tick)", () => {
    const { logger, warnings } = captureLogger();
    const rec = tryParseSessionFile(
      join(FIXTURES_DIR, "this-file-does-not-exist.json"),
      logger,
    );

    expect(rec).toBeNull();
    expect(warnings[0]).toMatch(/failed to read/);
  });
});

// =============================================================================
// listSessions — directory-level branches (AC1, AC4)
// =============================================================================

describe("listSessions", () => {
  it("returns [] when ~/.claude/sessions/ does not exist (AC4)", () => {
    const { home, cleanup } = stageClaudeHome();
    // Note: we intentionally do NOT create a `sessions/` subdir.
    try {
      const { logger, warnings } = captureLogger();
      const records = listSessions(home, logger);

      expect(records).toEqual([]);
      // ENOENT is the expected branch — must NOT warn. Sponsor on a fresh
      // machine should see silence, not noise.
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("returns [] when claudeHome itself does not exist", () => {
    const nonExistent = join(tmpdir(), "definitely-not-a-real-claude-home-xyz");
    const { logger, warnings } = captureLogger();
    const records = listSessions(nonExistent, logger);

    expect(records).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("returns one SessionRecord per well-formed file, isAlive cross-checked", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);

      // File 1: pointing at process.pid → isAlive:true
      writeFileSync(
        join(sessionsDir, `${process.pid}.json`),
        JSON.stringify({
          pid: process.pid,
          sessionId: "live-1",
          cwd: "c:\\live",
          startedAt: 1,
          version: "2.1.145",
          entrypoint: "claude-vscode",
        }),
      );
      // File 2: copied dead-PID fixture → isAlive:false
      copyFileSync(
        join(FIXTURES_DIR, "session-dead-pid.json"),
        join(sessionsDir, "1.json"),
      );

      const { logger, warnings } = captureLogger();
      const records = listSessions(home, logger);

      expect(records).toHaveLength(2);
      const live = records.find((r) => r.pid === process.pid);
      const dead = records.find((r) => r.pid === 1);
      expect(live?.isAlive).toBe(true);
      expect(dead?.isAlive).toBe(false);
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("skips malformed JSON files but keeps valid ones (AC4 + AC6 mixed-set)", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);

      // Valid file pointing at process.pid (live).
      writeFileSync(
        join(sessionsDir, `${process.pid}.json`),
        JSON.stringify({
          pid: process.pid,
          sessionId: "valid-sibling",
          cwd: "c:\\v",
          startedAt: 1,
          version: "2.1.145",
          entrypoint: "claude-vscode",
        }),
      );

      // Malformed JSON sibling.
      writeFileSync(join(sessionsDir, "broken.json"), "{ syntax error");

      // Valid-JSON-but-missing-required-field sibling.
      writeFileSync(
        join(sessionsDir, "incomplete.json"),
        JSON.stringify({ pid: 555 /* missing everything else */ }),
      );

      const { logger, warnings } = captureLogger();
      const records = listSessions(home, logger);

      expect(records).toHaveLength(1);
      expect(records[0]!.sessionId).toBe("valid-sibling");
      // Two warnings expected — one per skipped file.
      expect(warnings).toHaveLength(2);
      expect(warnings.some((w) => /broken\.json/.test(w))).toBe(true);
      expect(warnings.some((w) => /incomplete\.json/.test(w))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("ignores non-.json entries (lock files, OS metadata)", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      const sessionsDir = join(home, "sessions");
      mkdirSync(sessionsDir);

      // Stray non-JSON files that should NOT trigger warnings.
      writeFileSync(join(sessionsDir, ".DS_Store"), "binary garbage");
      writeFileSync(join(sessionsDir, "lockfile.lock"), "");
      writeFileSync(join(sessionsDir, "README"), "some readme");

      const { logger, warnings } = captureLogger();
      const records = listSessions(home, logger);

      expect(records).toEqual([]);
      // Stray files are skipped silently — no warning noise.
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("returns [] when sessions/ exists but is empty", () => {
    const { home, cleanup } = stageClaudeHome();
    try {
      mkdirSync(join(home, "sessions"));
      const { logger, warnings } = captureLogger();
      const records = listSessions(home, logger);
      expect(records).toEqual([]);
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("uses the default silent logger when none is passed (no console pollution)", () => {
    // This test asserts the signature: listSessions(home) without a
    // logger arg must not throw and must produce sensible results.
    const { home, cleanup } = stageClaudeHome();
    try {
      mkdirSync(join(home, "sessions"));
      writeFileSync(join(home, "sessions", "bad.json"), "{ not json");
      // No logger passed — function should be silent + return [].
      const records = listSessions(home);
      expect(records).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
