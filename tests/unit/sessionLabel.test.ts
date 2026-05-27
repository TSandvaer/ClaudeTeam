/**
 * Unit tests for the shared `resolveSessionLabel` + `workspaceFolderName`
 * helpers introduced by 86ca03nww (session-card label + gitBranch chip).
 *
 * Coverage:
 *   - Priority chain: customTitle > aiTitle > workspace-folder fallback
 *   - Whitespace + empty normalization (customTitle, aiTitle)
 *   - `(no title yet)` sentinel treated as ai-title absent
 *   - workspaceFolderName: Windows backslash, POSIX forward-slash, mixed,
 *     trailing-separator stripping, empty / drive-only / single-segment paths
 *
 * Source: `team/bram-research/86ca00xcd-claude-vscode-label-surfaces-2026-05-27.md`
 *         §"Display priority suggestion"; ticket 86ca03nww vocabulary contract.
 */

import { describe, it, expect } from "vitest";

import {
  NO_AI_TITLE_SENTINEL,
  resolveSessionLabel,
  resolveSessionLabelWithSource,
  workspaceFolderName,
} from "../../src/shared/types.js";

describe("resolveSessionLabel — priority chain (86ca03nww)", () => {
  it("Tier 1 wins: customTitle defined → use it (above aiTitle, above fallback)", () => {
    expect(
      resolveSessionLabel({
        title: "AI-generated title",
        customTitle: "claude team",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("claude team");
  });

  it("Tier 1 fall-through: empty customTitle → falls to aiTitle", () => {
    expect(
      resolveSessionLabel({
        title: "ai-title",
        customTitle: "",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("ai-title");
  });

  it("Tier 1 fall-through: whitespace-only customTitle → falls to aiTitle", () => {
    expect(
      resolveSessionLabel({
        title: "ai-title",
        customTitle: "   \t  ",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("ai-title");
  });

  it("Tier 1 trims surrounding whitespace before returning", () => {
    expect(
      resolveSessionLabel({
        title: "ai-title",
        customTitle: "  claude team  ",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("claude team");
  });

  it("Tier 2 wins when customTitle is undefined", () => {
    expect(
      resolveSessionLabel({
        title: "AI-generated title",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("AI-generated title");
  });

  it("Tier 2 fall-through: '(no title yet)' sentinel → falls to workspace folder", () => {
    expect(
      resolveSessionLabel({
        title: NO_AI_TITLE_SENTINEL,
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("ClaudeTeam");
  });

  it("Tier 2 fall-through: empty title → falls to workspace folder", () => {
    expect(
      resolveSessionLabel({
        title: "",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("ClaudeTeam");
  });

  it("Tier 2 fall-through: whitespace-only title → falls to workspace folder", () => {
    expect(
      resolveSessionLabel({
        title: "   ",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toBe("ClaudeTeam");
  });

  it("Tier 3: both customTitle and aiTitle absent → workspace folder", () => {
    expect(
      resolveSessionLabel({
        title: NO_AI_TITLE_SENTINEL,
        cwd: "/home/user/projects/marian-tutor",
      }),
    ).toBe("marian-tutor");
  });

  it("Tier 3 + empty cwd → empty string (no crash)", () => {
    expect(
      resolveSessionLabel({
        title: NO_AI_TITLE_SENTINEL,
        cwd: "",
      }),
    ).toBe("");
  });

  it("does NOT mutate inputs (pure projection)", () => {
    const input = {
      title: "ai-title",
      customTitle: "  claude team  ",
      cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
    };
    const snapshot = { ...input };
    resolveSessionLabel(input);
    expect(input).toEqual(snapshot);
  });
});

describe("resolveSessionLabelWithSource — source dispatch (86ca049xf)", () => {
  // One source-of-truth test asserting label + source per tier so the
  // webview's `data-label-source` decoration and tooltip can never drift
  // from the resolved label string. Both come from the same call now —
  // the test pins the contract.
  it("emits the resolved label AND source per tier (3 cases + fall-through)", () => {
    // Tier 1: customTitle wins → source is "custom-title".
    expect(
      resolveSessionLabelWithSource({
        title: "AI-generated title",
        customTitle: "claude team",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toEqual({ label: "claude team", source: "custom-title" });

    // Tier 2: aiTitle wins when customTitle absent → source is "ai-title".
    expect(
      resolveSessionLabelWithSource({
        title: "AI-generated title",
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toEqual({ label: "AI-generated title", source: "ai-title" });

    // Tier 3: both absent → source is "workspace-folder".
    expect(
      resolveSessionLabelWithSource({
        title: NO_AI_TITLE_SENTINEL,
        cwd: "c:\\Trunk\\PRIVATE\\ClaudeTeam",
      }),
    ).toEqual({ label: "ClaudeTeam", source: "workspace-folder" });

    // Fall-through: whitespace customTitle + sentinel aiTitle → workspace.
    expect(
      resolveSessionLabelWithSource({
        title: NO_AI_TITLE_SENTINEL,
        customTitle: "   ",
        cwd: "/home/user/projects/marian-tutor",
      }),
    ).toEqual({ label: "marian-tutor", source: "workspace-folder" });
  });
});

describe("workspaceFolderName — basename extraction (86ca03nww)", () => {
  it("Windows backslash path → last segment", () => {
    expect(workspaceFolderName("c:\\Trunk\\PRIVATE\\ClaudeTeam")).toBe(
      "ClaudeTeam",
    );
  });

  it("preserves casing", () => {
    expect(workspaceFolderName("C:\\Trunk\\PRIVATE\\MARIAN-TUTOR")).toBe(
      "MARIAN-TUTOR",
    );
  });

  it("POSIX forward-slash path → last segment", () => {
    expect(workspaceFolderName("/home/user/projects/randomgame")).toBe(
      "randomgame",
    );
  });

  it("mixed separators (Windows + forward) → last segment", () => {
    expect(workspaceFolderName("c:\\Trunk/PRIVATE\\ClaudeTeam")).toBe(
      "ClaudeTeam",
    );
  });

  it("trailing backslash stripped before extraction", () => {
    expect(workspaceFolderName("c:\\Trunk\\PRIVATE\\ClaudeTeam\\")).toBe(
      "ClaudeTeam",
    );
  });

  it("trailing forward-slash stripped before extraction", () => {
    expect(workspaceFolderName("/home/user/projects/randomgame/")).toBe(
      "randomgame",
    );
  });

  it("multiple trailing separators stripped", () => {
    expect(workspaceFolderName("c:\\Trunk\\ClaudeTeam\\\\//")).toBe(
      "ClaudeTeam",
    );
  });

  it("no separator at all → the entire string", () => {
    expect(workspaceFolderName("ClaudeTeam")).toBe("ClaudeTeam");
  });

  it("empty string → empty string", () => {
    expect(workspaceFolderName("")).toBe("");
  });

  it("whitespace-only string → empty string", () => {
    expect(workspaceFolderName("   ")).toBe("");
  });

  it("only-separators → empty string", () => {
    expect(workspaceFolderName("\\\\//")).toBe("");
  });

  it("non-string defensively → empty string", () => {
    // Defensive: production callers always pass strings, but the helper
    // should not throw on a runtime-type violation.
    expect(workspaceFolderName(undefined as unknown as string)).toBe("");
  });
});
