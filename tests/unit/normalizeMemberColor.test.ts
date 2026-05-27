/**
 * Unit tests for `normalizeMemberColor` from src/extension/roster/loader.ts
 * (86c9zq9vm — spec 86c9zmyef §2.6).
 *
 * Coverage:
 *   - absent → undefined, no warning
 *   - 6-digit hex lowercase → preserved
 *   - 6-digit hex uppercase → lowercased
 *   - 3-digit hex → expanded to 6-digit lowercase (sponsor Q4)
 *   - invalid (no `#`, named color, rgb(), 8-digit hex) → undefined + warning
 *   - warning carries team + member id + raw value verbatim
 *   - end-to-end via loadRoster: valid/invalid member.color in YAML
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadRoster,
  normalizeMemberColor,
} from "../../src/extension/roster/loader.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "color-norm-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

const CTX = { teamId: "t1", memberId: "m1" };

describe("normalizeMemberColor — absent / undefined", () => {
  it("returns undefined when raw is undefined, no warning emitted", () => {
    const warnings: string[] = [];
    const result = normalizeMemberColor(undefined, CTX, warnings);
    expect(result).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("normalizeMemberColor — 6-digit hex", () => {
  it("preserves lowercase 6-digit hex", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#5d8aa8", CTX, warnings)).toBe("#5d8aa8");
    expect(warnings).toEqual([]);
  });

  it("lowercases mixed-case 6-digit hex", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#5D8aA8", CTX, warnings)).toBe("#5d8aa8");
    expect(warnings).toEqual([]);
  });

  it("lowercases uppercase 6-digit hex", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#FFAA00", CTX, warnings)).toBe("#ffaa00");
    expect(warnings).toEqual([]);
  });
});

describe("normalizeMemberColor — 3-digit hex shorthand (sponsor Q4)", () => {
  it("expands #5da → #55ddaa", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#5da", CTX, warnings)).toBe("#55ddaa");
    expect(warnings).toEqual([]);
  });

  it("expands #ABC → #aabbcc (lowercases as it expands)", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#ABC", CTX, warnings)).toBe("#aabbcc");
    expect(warnings).toEqual([]);
  });

  it("expands #f0a → #ff00aa", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#f0a", CTX, warnings)).toBe("#ff00aa");
    expect(warnings).toEqual([]);
  });
});

describe("normalizeMemberColor — invalid formats", () => {
  it("drops named color string, pushes warning", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("reddish", CTX, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/invalid color "reddish"/);
    expect(warnings[0]).toMatch(/team "t1"/);
    expect(warnings[0]).toMatch(/member "m1"/);
  });

  it("drops rgb() function syntax", () => {
    const warnings: string[] = [];
    expect(
      normalizeMemberColor("rgb(0,0,0)", CTX, warnings),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/invalid color "rgb\(0,0,0\)"/);
  });

  it("drops 6-digit hex missing the leading '#'", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("5d8aa8", CTX, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/invalid color "5d8aa8"/);
  });

  it("drops 8-digit hex (#RRGGBBAA not supported in V1)", () => {
    const warnings: string[] = [];
    expect(
      normalizeMemberColor("#5d8aa8ff", CTX, warnings),
    ).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("drops empty string", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("", CTX, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("drops 4-digit and 5-digit hex (off-by-one)", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#abcd", CTX, warnings)).toBeUndefined();
    expect(normalizeMemberColor("#abcde", CTX, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(2);
  });

  it("drops non-hex characters in 6-digit slot", () => {
    const warnings: string[] = [];
    expect(normalizeMemberColor("#ZZZZZZ", CTX, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("warning includes team + member context for sponsor diagnosis", () => {
    const warnings: string[] = [];
    normalizeMemberColor(
      "bad",
      { teamId: "claudeteam-alpha", memberId: "felix" },
      warnings,
    );
    expect(warnings[0]).toMatch(/team "claudeteam-alpha"/);
    expect(warnings[0]).toMatch(/member "felix"/);
    expect(warnings[0]).toMatch(/"bad"/);
  });
});

describe("loadRoster — color validation end-to-end", () => {
  it("loads a roster with valid 6-digit hex color preserved", () => {
    const path = writeTemp(
      "valid-color.yaml",
      `teams:
  - id: claudeteam-alpha
    name: ClaudeTeam Alpha
    members:
      - id: felix
        display: Felix
        role: Dev
        color: "#5D8AA8"
        match:
          - agentType_equals: felix
`,
    );
    const result = loadRoster(path);
    expect(result.errors).toEqual([]);
    expect(result.roster[0]!.members[0]!.color).toBe("#5d8aa8");
  });

  it("expands 3-digit hex shorthand end-to-end (#5da → #55ddaa)", () => {
    const path = writeTemp(
      "shorthand-color.yaml",
      `teams:
  - id: t
    name: T
    members:
      - id: a
        display: A
        role: R
        color: "#5da"
        match:
          - agentType_equals: a
`,
    );
    const result = loadRoster(path);
    expect(result.errors).toEqual([]);
    expect(result.roster[0]!.members[0]!.color).toBe("#55ddaa");
    // No warning for valid shorthand expansion.
    expect(
      result.warnings.find((w) => w.includes("invalid color")),
    ).toBeUndefined();
  });

  it("drops invalid color + emits a roster warning the chip can render", () => {
    const path = writeTemp(
      "invalid-color.yaml",
      `teams:
  - id: claudeteam-alpha
    name: A
    members:
      - id: felix
        display: Felix
        role: Dev
        color: "reddish"
        match:
          - agentType_equals: felix
`,
    );
    const result = loadRoster(path);
    expect(result.errors).toEqual([]);
    expect(result.roster[0]!.members[0]!.color).toBeUndefined();
    expect(
      result.warnings.some(
        (w) =>
          w.includes("invalid color") &&
          w.includes('"reddish"') &&
          w.includes("felix"),
      ),
    ).toBe(true);
  });

  it("absent color produces no warning", () => {
    const path = writeTemp(
      "no-color.yaml",
      `teams:
  - id: t
    name: T
    members:
      - id: a
        display: A
        role: R
        match:
          - agentType_equals: a
`,
    );
    const result = loadRoster(path);
    expect(result.errors).toEqual([]);
    expect(result.roster[0]!.members[0]!.color).toBeUndefined();
    expect(
      result.warnings.find((w) => w.includes("invalid color")),
    ).toBeUndefined();
  });
});
