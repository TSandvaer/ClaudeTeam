/**
 * Layer-3 window-scoped session-filter smoke test (M3-09 AC2).
 *
 * Drives the M3-03 production code path under VS Code's real Electron
 * runtime: seed multiple sessions under a tempdir whose `cwd` values
 * span THREE different workspaces, point runTick at a workspaceFolders
 * list containing only ONE of those workspaces, and assert:
 *
 *   - The returned `state.sessions` contains ONLY the session whose `cwd`
 *     matches the workspace folder.
 *   - `state.filterApplied === true` (the filter actually reduced the set,
 *     not just passed through).
 *
 * What this catches that Layer-1/2 doesn't:
 *   - `filterSessionsToWindow` + `isFilterApplied` + `runTick`'s composition
 *     under the EXACT runtime VS Code's extension host loads — including
 *     the platform-specific path-normalization branches (`IS_WINDOWS`
 *     resolves at module-load via process.platform; under
 *     `@vscode/test-electron` on Windows this is true and the lowercased
 *     case-insensitive compare path runs).
 *   - The Mocha test runs inside the real Electron renderer, so any
 *     packaging-time regression that breaks node:os / node:path
 *     resolution in the extension bundle surfaces here.
 *
 * Pass criteria (per M3-09 AC2):
 *   - `state.sessions.length === 1` (the matched workspace's session only).
 *   - `state.sessions[0].cwd` matches the configured workspace folder
 *     (after normalization).
 *   - `state.filterApplied === true`.
 *
 * Negative-path coverage (per test-plan negative-path requirement):
 *   - SECOND test asserts the don't-strand passthrough — when
 *     `workspaceFolders` is undefined / empty, EVERY seeded session
 *     comes back and `filterApplied === false`. A test that only
 *     asserted the filtered case would silently miss a regression that
 *     made the filter always run regardless of folder presence (the
 *     stranding bug class).
 *   - THIRD test asserts the `showAllSessionsGlobally === true` override
 *     also produces passthrough behavior — separate code branch from
 *     the undefined-folders one, both must work.
 *
 * Webview-DOM limitation (mirrors `webviewSmoke.test.ts` header):
 *   VS Code's Extension API does NOT expose the webview iframe DOM from
 *   the host process. The AC text "filtered set appears in the webview"
 *   translates at this layer to: the production `runTick` returns a
 *   DashboardState whose `sessions` array matches the expected filtered
 *   set. That state is what `messageBus.serializeState(state)` would
 *   then post to the webview via `postMessage` — the wire-shape
 *   serialization is covered by Layer-1 unit tests
 *   (`tests/unit/messageBus.test.ts`).
 *
 * Source: src/extension/watcher/watcherLoop.ts runTick
 *         src/extension/watcher/sessionFilter.ts filterSessionsToWindow + isFilterApplied
 *         team/nora-pl/milestone-3-backlog.md §M3-09 AC2
 *         .claude/docs/testing-strategy.md "Layer 3 — VS Code integration"
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { runTick } from "../../../src/extension/watcher/watcherLoop.js";
import { cwdToSlug } from "../../../src/shared/slug.js";

const EXTENSION_ID = "claudeteam.claudeteam";
const IS_WINDOWS = process.platform === "win32";

// Three workspaces. Only WORKSPACE_A's session should survive when the
// window-filter is wired to WORKSPACE_A.
//
// Use real Windows-style paths on Windows and POSIX-style on others so
// cwdToSlug and the filter's `normalizePath` branch see realistic input
// on each runtime (per the Layer-2 sessionFilter.test.ts convention).
const WORKSPACE_A = IS_WINDOWS
  ? "c:\\Trunk\\PRIVATE\\WindowFilter-A"
  : "/tmp/windowfilter-a";
const WORKSPACE_B = IS_WINDOWS
  ? "c:\\Trunk\\PRIVATE\\WindowFilter-B"
  : "/tmp/windowfilter-b";
const WORKSPACE_C = IS_WINDOWS
  ? "c:\\Trunk\\PRIVATE\\WindowFilter-C"
  : "/tmp/windowfilter-c";

const SESSION_A = "aaaaaaaa-0000-0000-0000-000000000a01";
const SESSION_B = "aaaaaaaa-0000-0000-0000-000000000a02";
const SESSION_C = "aaaaaaaa-0000-0000-0000-000000000a03";
const PID_A = 4_100_001;
const PID_B = 4_100_002;
const PID_C = 4_100_003;

// Minimal valid roster YAML — needed by loadRoster but irrelevant to the
// filter assertions (no agents are seeded that would match it). The
// matcher correctly produces zero rostered tiles either way; the filter
// runs BEFORE the matcher so its behavior is roster-agnostic.
const ROSTER_YAML = `teams:
  - id: window-filter-team
    name: "Window Filter Team"
    members:
      - id: noop
        display: "No-op"
        role: "filler"
        match:
          - agentType_equals: "never-matches-anything"
`;

suite("M3-09 AC2 — Window-scoped session filtering smoke (Layer-3)", () => {
  let tempRoot: string;
  let claudeHome: string;
  let rosterPath: string;

  function writeSession(pid: number, sessionId: string, cwd: string): void {
    const sessionsDir = path.join(claudeHome, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, `${pid}.json`),
      JSON.stringify({
        pid,
        sessionId,
        cwd,
        version: "2.1.145",
        entrypoint: "claude-vscode",
        startedAt: Date.now(),
        procStart: "639151272847822440",
        peerProtocol: 1,
        kind: "interactive",
      }),
      "utf8",
    );

    // Empty subagents directory + empty parent JSONL — the reducer needs
    // the project dir to exist (subagents-discovery does `readdirSync`
    // which silently returns []), and the title-reader gracefully
    // handles an empty file.
    const slug = cwdToSlug(cwd);
    const subagentsDir = path.join(
      claudeHome,
      "projects",
      slug,
      sessionId,
      "subagents",
    );
    fs.mkdirSync(subagentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeHome, "projects", slug, `${sessionId}.jsonl`),
      "",
      "utf8",
    );
  }

  // Normalize for cross-runtime equality (mirrors sessionFilter.ts
  // normalizePath but inlined to avoid a private-symbol import).
  function normalizeForCompare(p: string): string {
    let out = p;
    if (out.length > 1 && (out.endsWith("/") || out.endsWith("\\"))) {
      out = out.slice(0, -1);
    }
    if (IS_WINDOWS) {
      out = out.replace(/\//g, "\\").toLowerCase();
    }
    return out;
  }

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} must exist`);
    if (!ext.isActive) {
      await ext.activate();
    }

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ct-m3-09-winfilter-"));
    claudeHome = path.join(tempRoot, "claude");
    fs.mkdirSync(claudeHome, { recursive: true });

    const rosterDir = path.join(tempRoot, "claudeteam");
    fs.mkdirSync(rosterDir, { recursive: true });
    rosterPath = path.join(rosterDir, "teams.yaml");
    fs.writeFileSync(rosterPath, ROSTER_YAML, "utf8");

    // Three sessions across three different cwds.
    writeSession(PID_A, SESSION_A, WORKSPACE_A);
    writeSession(PID_B, SESSION_B, WORKSPACE_B);
    writeSession(PID_C, SESSION_C, WORKSPACE_C);
  });

  suiteTeardown(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test("filter ON + single workspace folder → ONLY matching session survives, filterApplied=true", async () => {
    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      // M3-03 contract: workspaceFolders is the host's window scope; here
      // we pin to WORKSPACE_A only. Sessions B and C must drop out.
      workspaceFolders: [{ fsPath: WORKSPACE_A }],
      showAllSessionsGlobally: false,
      logger: { warn: () => {} },
    });

    assert.strictEqual(
      state.sessions.length,
      1,
      `Expected exactly 1 session after filtering to WORKSPACE_A; got ` +
        `${state.sessions.length}. Sessions present: ` +
        `${JSON.stringify(state.sessions.map((s) => s.sessionId))}. ` +
        `The filter likely failed to drop sessions B or C; check ` +
        `filterSessionsToWindow's path normalization (case-insensitive on ` +
        `Windows, separator-agnostic, trailing-slash-tolerant).`,
    );
    assert.strictEqual(
      state.sessions[0]!.sessionId,
      SESSION_A,
      `Surviving session should be SESSION_A (${SESSION_A}); got ` +
        `${state.sessions[0]!.sessionId}. The filter matched a different ` +
        `session's cwd against WORKSPACE_A — likely a normalization bug.`,
    );
    // cwd comparison via normalization so the assert isn't case-sensitive
    // on Windows (where session.cwd may carry the OS-supplied casing).
    assert.strictEqual(
      normalizeForCompare(state.sessions[0]!.cwd),
      normalizeForCompare(WORKSPACE_A),
      `Surviving session's cwd should normalize-equal WORKSPACE_A. Got ` +
        `cwd="${state.sessions[0]!.cwd}", expected (normalized) ` +
        `"${normalizeForCompare(WORKSPACE_A)}".`,
    );
    assert.strictEqual(
      state.filterApplied,
      true,
      `Expected filterApplied=true (the filter reduced 3 → 1); got ` +
        `${state.filterApplied}. The flag drives the webview's filtered-empty ` +
        `messaging (M3-04 AC4) — a regression here would surface "no live ` +
        `sessions" instead of the workspace-specific empty hint.`,
    );
  });

  test("NEGATIVE PATH: undefined workspaceFolders → don't-strand passthrough (filterApplied=false)", async () => {
    // M3-03 don't-strand-the-user contract: when no folder is open, the
    // window-scoped filter passes through — the user sees every session
    // (better than being stranded with an empty dashboard and no signal).
    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      // workspaceFolders OMITTED — the production resolver in main.ts
      // returns undefined when vscode.workspace.workspaceFolders is null.
      showAllSessionsGlobally: false,
      logger: { warn: () => {} },
    });

    assert.strictEqual(
      state.sessions.length,
      3,
      `Expected all 3 seeded sessions in passthrough mode; got ` +
        `${state.sessions.length}. A regression here means the filter ran ` +
        `against an empty folder list and dropped sessions — the don't-strand ` +
        `passthrough is broken.`,
    );
    assert.strictEqual(
      state.filterApplied === true,
      false,
      `Expected filterApplied=false in passthrough mode; got ` +
        `${state.filterApplied}. The flag must be false when no filter ran, ` +
        `else the webview shows the filtered-empty messaging spuriously.`,
    );
  });

  test("NEGATIVE PATH: showAllSessionsGlobally=true → passthrough overrides workspaceFolders (filterApplied=false)", async () => {
    // M3-03 AC4: when the user sets `claudeteam.showAllSessionsGlobally`,
    // the filter is a passthrough EVEN IF workspaceFolders is non-empty.
    // Different code branch from the no-folders one; both must work.
    const state = await runTick({
      claudeHome,
      globalRosterPath: rosterPath,
      workspaceFolders: [{ fsPath: WORKSPACE_A }],
      showAllSessionsGlobally: true,
      logger: { warn: () => {} },
    });

    assert.strictEqual(
      state.sessions.length,
      3,
      `Expected all 3 seeded sessions when showAllSessionsGlobally=true; ` +
        `got ${state.sessions.length}. The override branch in ` +
        `filterSessionsToWindow is broken — the filter ran despite the flag.`,
    );
    assert.strictEqual(
      state.filterApplied === true,
      false,
      `Expected filterApplied=false when showAll override is on; got ` +
        `${state.filterApplied}. isFilterApplied must short-circuit on ` +
        `showAll=true before comparing counts.`,
    );
  });
});
