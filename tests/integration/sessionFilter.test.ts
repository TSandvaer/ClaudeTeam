/**
 * Integration tests for window-scoped session filtering (M3-03 AC9).
 *
 * Builds a tempdir fixture with multiple sessions across different cwds,
 * runs the full watcher tick (`runTick`) with mocked workspaceFolders, and
 * asserts the filtered output reflects the M3-03 contract.
 *
 * Per testing-strategy.md Layer 2: real filesystem I/O on a tempdir, no
 * mocks of the parser / matcher / reducer / filter. The VS Code namespace
 * isn't loaded here — we pass workspaceFolders directly as a typed shape
 * (matches the `getWorkspaceFolders` resolver contract used in
 * `src/extension/main.ts`).
 *
 * Source: team/nora-pl/milestone-3-backlog.md § M3-03 AC9.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createTempRoot,
  writeSessionFile,
  writeMetaJson,
  writeSubagentJsonl,
  writeParentJsonl,
  writeRoster,
} from "./helpers/tempdir.js";

import { runTick } from "../../src/extension/watcher/watcherLoop.js";
import { IS_WINDOWS } from "../../src/extension/watcher/sessionFilter.js";

const PID_A = 2_000_011;
const PID_B = 2_000_012;
const PID_C = 2_000_013;
const SESSION_A = "aaaabbbb-0000-0000-0000-00000000a001";
const SESSION_B = "aaaabbbb-0000-0000-0000-00000000a002";
const SESSION_C = "aaaabbbb-0000-0000-0000-00000000a003";

// Use real Windows-style paths on Windows and POSIX-style elsewhere so the
// tempdir → projects-dir slug derivation (cwdToSlug) sees a realistic input
// on each runtime.
const CWD_CLAUDETEAM = IS_WINDOWS
  ? "c:\\Trunk\\PRIVATE\\ClaudeTeam"
  : "/home/runner/work/ClaudeTeam";
const CWD_RANDOMGAME = IS_WINDOWS
  ? "c:\\Trunk\\PRIVATE\\RandomGame"
  : "/home/runner/work/RandomGame";
const CWD_MARIAN = IS_WINDOWS
  ? "c:\\Trunk\\PRIVATE\\MARIAN-TUTOR"
  : "/home/runner/work/MARIAN-TUTOR";

const AGENT_FELIX = "agentfelixintf001";

describe("M3-03 AC9: full watcher tick filters sessions by workspaceFolder", () => {
  let root: string;
  let cleanup: () => void;
  let rosterPath: string;

  beforeEach(() => {
    ({ root, cleanup } = createTempRoot());
    rosterPath = writeRoster(root, "teams-valid.yaml");

    // Three live sessions across three different cwds — mirrors the sponsor's
    // M2-close observation (ClaudeTeam + RandomGame + MARIAN-TUTOR were all
    // visible when only ClaudeTeam was relevant to the current window).
    writeSessionFile(root, {
      pid: PID_A,
      sessionId: SESSION_A,
      cwd: CWD_CLAUDETEAM,
    });
    writeParentJsonl(root, CWD_CLAUDETEAM, SESSION_A, {
      title: "ClaudeTeam session",
    });
    writeMetaJson(
      root,
      CWD_CLAUDETEAM,
      SESSION_A,
      AGENT_FELIX,
      "meta-new-schema-persona.json",
    );
    writeSubagentJsonl(
      root,
      CWD_CLAUDETEAM,
      SESSION_A,
      AGENT_FELIX,
      "subagent-running.jsonl",
    );

    writeSessionFile(root, {
      pid: PID_B,
      sessionId: SESSION_B,
      cwd: CWD_RANDOMGAME,
    });
    writeParentJsonl(root, CWD_RANDOMGAME, SESSION_B, {
      title: "RandomGame session",
    });

    writeSessionFile(root, {
      pid: PID_C,
      sessionId: SESSION_C,
      cwd: CWD_MARIAN,
    });
    writeParentJsonl(root, CWD_MARIAN, SESSION_C, {
      title: "MARIAN-TUTOR session",
    });
  });

  afterEach(() => cleanup());

  it("showAll=true returns all three sessions (passthrough)", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: [{ fsPath: CWD_CLAUDETEAM }],
      showAllSessionsGlobally: true,
    });
    expect(state.sessions).toHaveLength(3);
    expect(state.filterApplied).toBe(false);
  });

  it("showAll=false + matching workspace folder returns only that session", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: [{ fsPath: CWD_CLAUDETEAM }],
      showAllSessionsGlobally: false,
    });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.sessionId).toBe(SESSION_A);
    expect(state.sessions[0]!.cwd).toBe(CWD_CLAUDETEAM);
    expect(state.filterApplied).toBe(true);
  });

  it("showAll=false + multi-root workspace returns matching sessions only", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: [
        { fsPath: CWD_CLAUDETEAM },
        { fsPath: CWD_RANDOMGAME },
      ],
      showAllSessionsGlobally: false,
    });
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.map((s) => s.sessionId).sort()).toEqual(
      [SESSION_A, SESSION_B].sort(),
    );
    expect(state.filterApplied).toBe(true);
  });

  it("showAll=false + no folder open returns all sessions (don't-strand)", async () => {
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: undefined,
      showAllSessionsGlobally: false,
    });
    expect(state.sessions).toHaveLength(3);
    // filterApplied is false — passthrough behavior, no user-visible filter.
    expect(state.filterApplied).toBe(false);
  });

  it("showAll=false + folder matches NO session → filtered-to-empty", async () => {
    const otherCwd = IS_WINDOWS
      ? "c:\\Trunk\\PRIVATE\\Unknown"
      : "/home/runner/work/Unknown";
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: [{ fsPath: otherCwd }],
      showAllSessionsGlobally: false,
    });
    expect(state.sessions).toHaveLength(0);
    // filterApplied is TRUE — webview consumes this to render the
    // "no sessions for this workspace" empty-state (vs globally-empty).
    expect(state.filterApplied).toBe(true);
  });

  it("filterApplied=false when filter ran but didn't reduce count", async () => {
    // Multi-root workspace covering ALL three sessions — filter is logically
    // applied but the user wouldn't see a difference. M3-03 AC7 contract:
    // flag is only true when the count was reduced.
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: [
        { fsPath: CWD_CLAUDETEAM },
        { fsPath: CWD_RANDOMGAME },
        { fsPath: CWD_MARIAN },
      ],
      showAllSessionsGlobally: false,
    });
    expect(state.sessions).toHaveLength(3);
    expect(state.filterApplied).toBe(false);
  });

  it("AC3: filter runs BEFORE roster matching (rostered tile present in filtered session)", async () => {
    // The ClaudeTeam session has a Felix-rostered agent. After filtering to
    // that session only, the roster-matcher output must still include the
    // Felix tile — proving the filter didn't break the downstream pipeline.
    const state = await runTick({
      claudeHome: root,
      globalRosterPath: rosterPath,
      workspaceFolders: [{ fsPath: CWD_CLAUDETEAM }],
      showAllSessionsGlobally: false,
    });
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.teamOrder).toContain("claudeteam-alpha");
  });
});
