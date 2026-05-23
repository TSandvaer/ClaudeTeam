/**
 * Unit tests for the shared `cwdToSlug` function (M2-04 AC5 / M1-09-followup
 * ClickUp 86c9y6e17).
 *
 * Coverage targets (per `.claude/docs/data-sources.md` §2):
 *   - Verified Windows examples from the docs.
 *   - POSIX path handling.
 *   - Edge cases: empty string, drive-letter-only, mixed separators.
 */

import { describe, it, expect } from "vitest";

import { cwdToSlug } from "../../src/shared/slug.js";

describe("cwdToSlug — Windows paths (verified against on-disk directories)", () => {
  it("c:\\Trunk\\PRIVATE\\ClaudeTeam → c--Trunk-PRIVATE-ClaudeTeam", () => {
    expect(cwdToSlug("c:\\Trunk\\PRIVATE\\ClaudeTeam")).toBe(
      "c--Trunk-PRIVATE-ClaudeTeam",
    );
  });

  it("C:\\Trunk\\PRIVATE\\Axelot-tutor → C--Trunk-PRIVATE-Axelot-tutor (preserves uppercase drive)", () => {
    expect(cwdToSlug("C:\\Trunk\\PRIVATE\\Axelot-tutor")).toBe(
      "C--Trunk-PRIVATE-Axelot-tutor",
    );
  });

  it("c:\\Trunk\\PRIVATE\\MARIAN-TUTOR → c--Trunk-PRIVATE-MARIAN-TUTOR (preserves uppercase folders)", () => {
    expect(cwdToSlug("c:\\Trunk\\PRIVATE\\MARIAN-TUTOR")).toBe(
      "c--Trunk-PRIVATE-MARIAN-TUTOR",
    );
  });

  it("forward slashes after the drive — same rule", () => {
    // VS Code on Windows commonly normalizes to forward slashes; the slug
    // rule must accept both.
    expect(cwdToSlug("c:/Trunk/PRIVATE/ClaudeTeam")).toBe(
      "c--Trunk-PRIVATE-ClaudeTeam",
    );
  });

  it("mixed separators (Windows + forward) — both collapse correctly", () => {
    expect(cwdToSlug("c:\\Trunk/PRIVATE\\ClaudeTeam")).toBe(
      "c--Trunk-PRIVATE-ClaudeTeam",
    );
  });
});

describe("cwdToSlug — POSIX paths", () => {
  it("/home/user/project → home-user-project", () => {
    expect(cwdToSlug("/home/user/project")).toBe("home-user-project");
  });

  it("relative path without leading slash → no change in separators", () => {
    expect(cwdToSlug("some/relative/path")).toBe("some-relative-path");
  });
});

describe("cwdToSlug — edge cases", () => {
  it("empty string → empty string", () => {
    expect(cwdToSlug("")).toBe("");
  });

  it("drive letter only (`c:`) → `c`", () => {
    expect(cwdToSlug("c:")).toBe("c");
  });

  it("drive + single separator (`c:\\`) → `c--`", () => {
    // Captures the corner case where only the first separator is present.
    expect(cwdToSlug("c:\\")).toBe("c--");
  });

  it("nothing to slug → string returned verbatim", () => {
    expect(cwdToSlug("plain")).toBe("plain");
  });
});
