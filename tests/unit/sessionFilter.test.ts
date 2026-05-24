/**
 * Unit tests for src/extension/watcher/sessionFilter.ts (M3-03).
 *
 * Pure-function coverage:
 *   - showAll=true passthrough
 *   - showAll=false + matching cwd returns matched only
 *   - showAll=false + no folder open returns input unchanged (don't strand)
 *   - Windows case-insensitivity (drive letter AND path)
 *   - POSIX case-sensitivity
 *   - Trailing-slash normalization
 *   - Slash-direction normalization (Windows only)
 *   - isFilterApplied flag derivation
 *
 * The OS-branched normalizer (`normalizePath` / `IS_WINDOWS`) is exported so
 * each test asserts the branch appropriate for the current runtime. CI runs
 * on both Windows and Ubuntu Layer-3, so the POSIX branch tests are
 * exercised on the Layer-1 Ubuntu run; the Windows branch tests are
 * exercised locally and on a Windows CI runner.
 *
 * Source: team/nora-pl/milestone-3-backlog.md § M3-03 AC1/AC2/AC8.
 */

import { describe, it, expect } from "vitest";

import {
  filterSessionsToWindow,
  isFilterApplied,
  normalizePath,
  IS_WINDOWS,
  type WindowFolder,
} from "../../src/extension/watcher/sessionFilter.js";
import type { SessionRecord } from "../../src/shared/types.js";

function session(cwd: string, sessionId: string): SessionRecord {
  return {
    pid: 1234,
    sessionId,
    cwd,
    version: "2.1.145",
    entrypoint: "claude-vscode",
    startedAt: 0,
    isAlive: true,
  };
}

function folder(fsPath: string): WindowFolder {
  return { fsPath };
}

const ALPHA = "aaaabbbb-0000-0000-0000-00000000aaaa";
const BETA = "aaaabbbb-0000-0000-0000-00000000bbbb";
const GAMMA = "aaaabbbb-0000-0000-0000-00000000cccc";

describe("filterSessionsToWindow — AC1 showAll passthrough", () => {
  it("showAll=true returns the input set unchanged regardless of folders", () => {
    const sessions = [
      session("c:\\Trunk\\PRIVATE\\ClaudeTeam", ALPHA),
      session("c:\\Trunk\\PRIVATE\\Other", BETA),
    ];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam")],
      true,
    );
    expect(got).toEqual(sessions);
    expect(got).toHaveLength(2);
  });

  it("showAll=true returns input unchanged even with undefined folders", () => {
    const sessions = [session("/home/foo", ALPHA)];
    const got = filterSessionsToWindow(sessions, undefined, true);
    expect(got).toEqual(sessions);
  });
});

describe("filterSessionsToWindow — AC1 don't-strand-the-user passthrough", () => {
  it("showAll=false + undefined folders returns input unchanged", () => {
    const sessions = [
      session("c:\\Trunk\\PRIVATE\\ClaudeTeam", ALPHA),
      session("c:\\Trunk\\PRIVATE\\Other", BETA),
    ];
    const got = filterSessionsToWindow(sessions, undefined, false);
    expect(got).toEqual(sessions);
  });

  it("showAll=false + empty folders array returns input unchanged", () => {
    const sessions = [session("c:\\foo", ALPHA)];
    const got = filterSessionsToWindow(sessions, [], false);
    expect(got).toEqual(sessions);
  });
});

describe("filterSessionsToWindow — AC1 matching", () => {
  it("returns only sessions whose cwd matches a workspace folder", () => {
    const sessions = [
      session("c:\\Trunk\\PRIVATE\\ClaudeTeam", ALPHA),
      session("c:\\Trunk\\PRIVATE\\Other", BETA),
      session("c:\\Trunk\\PRIVATE\\RandomGame", GAMMA),
    ];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam")],
      false,
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.sessionId).toBe(ALPHA);
  });

  it("matches across multiple workspace folders (multi-root)", () => {
    const sessions = [
      session("c:\\Trunk\\PRIVATE\\ClaudeTeam", ALPHA),
      session("c:\\Trunk\\PRIVATE\\Other", BETA),
      session("c:\\Trunk\\PRIVATE\\RandomGame", GAMMA),
    ];
    const got = filterSessionsToWindow(
      sessions,
      [
        folder("c:\\Trunk\\PRIVATE\\ClaudeTeam"),
        folder("c:\\Trunk\\PRIVATE\\RandomGame"),
      ],
      false,
    );
    expect(got.map((s) => s.sessionId).sort()).toEqual([ALPHA, GAMMA].sort());
  });

  it("returns empty array when no session matches (filtered-to-empty)", () => {
    const sessions = [session("c:\\foo", ALPHA), session("c:\\bar", BETA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\baz")],
      false,
    );
    expect(got).toEqual([]);
  });
});

describe("filterSessionsToWindow — AC2 path normalization", () => {
  it("trailing slash on the folder does not break matching", () => {
    const sessions = [session("c:\\Trunk\\PRIVATE\\ClaudeTeam", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam\\")],
      false,
    );
    expect(got).toHaveLength(1);
  });

  it("trailing slash on the session cwd does not break matching", () => {
    const sessions = [session("c:\\Trunk\\PRIVATE\\ClaudeTeam\\", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam")],
      false,
    );
    expect(got).toHaveLength(1);
  });

  it("does NOT match subdirectories (V1 simplicity)", () => {
    // Session cwd is INSIDE a workspace folder, but exact-match only.
    const sessions = [
      session("c:\\Trunk\\PRIVATE\\ClaudeTeam\\subdir", ALPHA),
    ];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam")],
      false,
    );
    expect(got).toEqual([]);
  });
});

describe("normalizePath — OS-branched semantics", () => {
  // The whole module is gated on process.platform at import time. We test the
  // currently-running branch explicitly so coverage is honest about which
  // assertions actually fired on a given runner.
  it("strips a single trailing separator (both branches)", () => {
    expect(normalizePath("c:\\Trunk\\PRIVATE\\ClaudeTeam\\")).toBe(
      normalizePath("c:\\Trunk\\PRIVATE\\ClaudeTeam"),
    );
    expect(normalizePath("/home/foo/")).toBe(normalizePath("/home/foo"));
  });

  it("does NOT strip the root separator", () => {
    // `/` and `C:\` are legitimate roots — preserved as-is (length > 1
    // gate in the normalizer). On Windows the forward slash converts to a
    // backslash; on POSIX it stays as-is. Either way the root character
    // is preserved.
    const got = normalizePath("/");
    expect(got.length).toBe(1);
    expect(["/", "\\"]).toContain(got);
  });

  if (IS_WINDOWS) {
    it("Windows: lowercases drive letter and path", () => {
      expect(normalizePath("C:\\Trunk\\PRIVATE\\ClaudeTeam")).toBe(
        "c:\\trunk\\private\\claudeteam",
      );
    });
    it("Windows: forward slashes normalize to backslashes", () => {
      expect(normalizePath("c:/Trunk/PRIVATE/ClaudeTeam")).toBe(
        normalizePath("c:\\Trunk\\PRIVATE\\ClaudeTeam"),
      );
    });
  } else {
    it("POSIX: case-sensitive — does NOT lowercase", () => {
      expect(normalizePath("/Home/Foo")).toBe("/Home/Foo");
      expect(normalizePath("/Home/Foo")).not.toBe("/home/foo");
    });
    it("POSIX: does NOT translate forward slashes", () => {
      // Forward slashes are the ONLY separator on POSIX; nothing to translate.
      expect(normalizePath("/home/foo")).toBe("/home/foo");
    });
  }
});

describe("filterSessionsToWindow — AC2 Windows case-insensitivity", () => {
  // Skipped on POSIX where casing matters.
  const runIf = IS_WINDOWS ? it : it.skip;

  runIf("matches mixed-case drive letter (Windows)", () => {
    const sessions = [session("C:\\Trunk\\PRIVATE\\ClaudeTeam", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam")],
      false,
    );
    expect(got).toHaveLength(1);
  });

  runIf("matches mixed-case path segments (Windows)", () => {
    const sessions = [session("c:\\TRUNK\\private\\ClaudeTeam", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\claudeteam")],
      false,
    );
    expect(got).toHaveLength(1);
  });

  runIf("matches across slash-direction differences (Windows)", () => {
    const sessions = [session("c:/Trunk/PRIVATE/ClaudeTeam", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("c:\\Trunk\\PRIVATE\\ClaudeTeam")],
      false,
    );
    expect(got).toHaveLength(1);
  });
});

describe("filterSessionsToWindow — AC2 POSIX case-sensitivity", () => {
  const runIf = IS_WINDOWS ? it.skip : it;

  runIf("does NOT match different casing on POSIX", () => {
    const sessions = [session("/home/foo/ClaudeTeam", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("/home/foo/claudeteam")],
      false,
    );
    expect(got).toEqual([]);
  });

  runIf("matches exact casing on POSIX", () => {
    const sessions = [session("/home/foo/ClaudeTeam", ALPHA)];
    const got = filterSessionsToWindow(
      sessions,
      [folder("/home/foo/ClaudeTeam")],
      false,
    );
    expect(got).toHaveLength(1);
  });
});

describe("isFilterApplied — AC7 flag derivation", () => {
  it("false when showAll is true", () => {
    expect(isFilterApplied(10, 10, [folder("c:\\x")], true)).toBe(false);
    expect(isFilterApplied(10, 1, [folder("c:\\x")], true)).toBe(false);
  });

  it("false when no folder open (undefined / empty)", () => {
    expect(isFilterApplied(10, 10, undefined, false)).toBe(false);
    expect(isFilterApplied(10, 10, [], false)).toBe(false);
  });

  it("false when filter ran but didn't reduce count", () => {
    // All sessions matched a workspace folder — no user-visible difference.
    expect(isFilterApplied(3, 3, [folder("c:\\x")], false)).toBe(false);
  });

  it("true when filter ran and reduced count", () => {
    expect(isFilterApplied(4, 1, [folder("c:\\x")], false)).toBe(true);
  });

  it("true even when filtered count is 0 (filtered-to-empty case)", () => {
    // This is the case the webview consumes to distinguish from globally-empty.
    expect(isFilterApplied(3, 0, [folder("c:\\x")], false)).toBe(true);
  });
});
