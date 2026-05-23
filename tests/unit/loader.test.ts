// Loader unit tests — reads + validates + merges teams.yaml.
//
// Coverage targets (from M1-08 AC7 + Sage test plan §M1-08):
//   - valid YAML loads
//   - malformed YAML returns error, never throws
//   - duplicate-ids warning, second-wins
//   - project-override semantics (member-level)
//   - missing global file (still loads project)
//   - missing both files (returns empty roster + warning)
//   - schema rejects unknown match-rule keys / missing required fields

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRoster } from "../../src/extension/roster/loader.js";

const FIXTURES = join(__dirname, "..", "fixtures");

// -----------------------------------------------------------------------------
// Tempdir helpers — for synthesized YAML cases that don't have static fixtures
// -----------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "roster-loader-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const path = join(tempDir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("loadRoster", () => {
  describe("happy path — valid file fixture", () => {
    it("loads teams-valid.yaml with no errors", () => {
      const result = loadRoster(join(FIXTURES, "teams-valid.yaml"));
      expect(result.errors).toEqual([]);
      expect(result.roster).toHaveLength(2);
      expect(result.roster[0]!.id).toBe("claudeteam-alpha");
      expect(result.roster[0]!.members).toHaveLength(3);
      expect(result.roster[1]!.id).toBe("claudeteam-beta");
    });

    it("preserves member match-rule order in declaration order", () => {
      const result = loadRoster(join(FIXTURES, "teams-valid.yaml"));
      const felix = result.roster[0]!.members[0]!;
      expect(felix.id).toBe("felix");
      expect(felix.match[0]).toEqual({ name_prefix: "felix-" });
      expect(felix.match[1]).toEqual({ agentType_equals: "felix" });
    });
  });

  describe("malformed YAML fixture", () => {
    it("returns error, does not throw", () => {
      const result = loadRoster(join(FIXTURES, "teams-invalid.yaml"));
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/YAML parse error/);
      expect(result.roster).toEqual([]);
    });
  });

  describe("schema rejections", () => {
    it("rejects unknown match-rule key", () => {
      const path = writeTemp(
        "bad-rule.yaml",
        `teams:
  - id: a
    name: A
    members:
      - id: x
        display: X
        role: r
        match:
          - subagent_type_regex: "x"
`,
      );
      const result = loadRoster(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("|")).toMatch(/match rule key must be one of/);
      expect(result.roster).toEqual([]);
    });

    it("rejects match rule with multiple keys", () => {
      const path = writeTemp(
        "multi-key.yaml",
        `teams:
  - id: a
    name: A
    members:
      - id: x
        display: X
        role: r
        match:
          - name_prefix: "x"
            agentType_equals: "y"
`,
      );
      const result = loadRoster(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("|")).toMatch(/match rule must have exactly one key/);
    });

    it("rejects missing required field (member.display)", () => {
      const path = writeTemp(
        "missing-display.yaml",
        `teams:
  - id: a
    name: A
    members:
      - id: x
        role: r
        match:
          - agentType_equals: "x"
`,
      );
      const result = loadRoster(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("|")).toMatch(/display/);
    });

    it("rejects duplicate member ids WITHIN a single team (schema-level)", () => {
      const path = writeTemp(
        "intra-team-dup.yaml",
        `teams:
  - id: a
    name: A
    members:
      - id: felix
        display: One
        role: r
        match:
          - agentType_equals: "felix"
      - id: felix
        display: Two
        role: r
        match:
          - agentType_equals: "felix2"
`,
      );
      const result = loadRoster(path);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join("|")).toMatch(/duplicate member id "felix"/);
    });

    it("rejects member with empty match[] array", () => {
      const path = writeTemp(
        "no-rules.yaml",
        `teams:
  - id: a
    name: A
    members:
      - id: x
        display: X
        role: r
        match: []
`,
      );
      const result = loadRoster(path);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("cross-team duplicate ids", () => {
    it("emits warning and surfaces both teams", () => {
      const result = loadRoster(join(FIXTURES, "teams-duplicate-ids.yaml"));
      expect(result.errors).toEqual([]);
      expect(result.warnings.join("|")).toMatch(/duplicate member id "felix"/);
      expect(result.roster).toHaveLength(2);
      // First occurrence wins for matcher purposes (declaration order).
      expect(result.roster[0]!.members[0]!.id).toBe("felix");
      expect(result.roster[0]!.members[0]!.display).toBe("Felix (Alpha)");
      expect(result.roster[1]!.members[0]!.display).toBe("Felix (Beta)");
    });
  });

  describe("missing files", () => {
    it("returns empty roster + warning when both paths are undefined", () => {
      const result = loadRoster();
      expect(result.errors).toEqual([]);
      expect(result.warnings.join("|")).toMatch(/no roster paths provided/);
      expect(result.roster).toEqual([]);
    });

    it("returns empty roster + warning when global path is missing on disk", () => {
      const result = loadRoster(join(tempDir, "nonexistent.yaml"));
      expect(result.errors).toEqual([]);
      expect(result.warnings.join("|")).toMatch(/global roster file not found/);
      expect(result.roster).toEqual([]);
    });

    it("loads project only when global is missing (no error)", () => {
      const projectPath = writeTemp(
        "project.yaml",
        `teams:
  - id: project-only
    name: Project Only
    members:
      - id: nora
        display: Nora
        role: r
        match:
          - agentType_equals: "nora"
`,
      );
      const result = loadRoster(join(tempDir, "absent-global.yaml"), projectPath);
      expect(result.errors).toEqual([]);
      expect(result.roster).toHaveLength(1);
      expect(result.roster[0]!.id).toBe("project-only");
    });

    it("treats undefined global as no-op (no warning, no error)", () => {
      const projectPath = writeTemp(
        "project.yaml",
        `teams:
  - id: project-only
    name: Project Only
    members:
      - id: nora
        display: Nora
        role: r
        match:
          - agentType_equals: "nora"
`,
      );
      const result = loadRoster(undefined, projectPath);
      // No global path passed at all → no "not found" warning for global.
      expect(result.warnings.filter((w) => w.includes("global"))).toEqual([]);
      expect(result.roster).toHaveLength(1);
    });
  });

  describe("project-override semantics", () => {
    it("project members override global members by id; global-only members preserved; project-only members appended; project-only teams appended", () => {
      const result = loadRoster(
        join(FIXTURES, "teams-valid.yaml"),
        join(FIXTURES, "teams-project-override.yaml"),
      );

      // No schema errors expected.
      expect(result.errors).toEqual([]);

      // Two teams in global (alpha, beta); one project-only team (gamma) → 3 total.
      expect(result.roster).toHaveLength(3);

      const alpha = result.roster.find((t) => t.id === "claudeteam-alpha")!;
      expect(alpha).toBeDefined();

      // Alpha members:
      //   1. felix (from project — replaces global felix)
      //   2. maya  (from global — not overridden)
      //   3. bram  (from global — not overridden)
      //   4. iris  (from project — project-only, appended at end of alpha.members)
      expect(alpha.members.map((m) => m.id)).toEqual(["felix", "maya", "bram", "iris"]);

      const felix = alpha.members[0]!;
      expect(felix.display).toBe("Felix (project)");
      expect(felix.role).toBe("Extension Host Dev (project rules)");
      expect(felix.match).toEqual([{ name_prefix: "felix-pr" }]);

      // Team name was also overridden by project ("ClaudeTeam Alpha (project)").
      expect(alpha.name).toBe("ClaudeTeam Alpha (project)");

      // Beta unchanged.
      const beta = result.roster.find((t) => t.id === "claudeteam-beta")!;
      expect(beta.members.map((m) => m.id)).toEqual(["sage"]);

      // Gamma is project-only, appended last.
      expect(result.roster[2]!.id).toBe("claudeteam-gamma");
    });
  });

  describe("empty file", () => {
    it("treats empty file as empty roster + warning, not error", () => {
      const path = writeTemp("empty.yaml", "");
      const result = loadRoster(path);
      expect(result.errors).toEqual([]);
      expect(result.warnings.join("|")).toMatch(/empty/);
      expect(result.roster).toEqual([]);
    });

    it("treats file with `teams: []` as empty roster (no warning, no error)", () => {
      const path = writeTemp("empty-teams.yaml", "teams: []\n");
      const result = loadRoster(path);
      expect(result.errors).toEqual([]);
      expect(result.roster).toEqual([]);
    });
  });
});
