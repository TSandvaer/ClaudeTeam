/**
 * TS-02 (team-setup epic) — unit tests for the PURE host helpers:
 *   - agentScanner.isPersonaAgentFile (non-persona exclusion)
 *   - detection.computeDetectionState / detectFromScan (trichotomy — AC1)
 *   - claudeTeamConfig.generateStarterConfig / slugifyTeamId / serializeConfig
 *     (starter shape — AC3)
 *   - orphanReconcile.memberBackingAgent / reconcileOrphans / removeMemberById
 *     (drift/orphan — AC6)
 *   - characterSources.resolveCharacterSources dedupe-only logic via a stub root
 *
 * Filesystem-touching paths (scanAgentsFolder, read/write, watchers) are covered
 * by tests/integration/teamSetupFs.test.ts.
 */

import { describe, it, expect } from "vitest";

import {
  isPersonaAgentFile,
  deriveRoleFromDescription,
} from "../../src/extension/roster/agentScanner.js";
import {
  computeDetectionState,
  detectFromScan,
  SUGGEST_SETUP_MIN_AGENTS,
} from "../../src/extension/roster/detection.js";
import {
  generateStarterConfig,
  slugifyTeamId,
  serializeConfig,
  CLAUDE_TEAM_CONFIG_VERSION,
} from "../../src/extension/roster/claudeTeamConfig.js";
import {
  memberBackingAgent,
  reconcileOrphans,
  removeMemberById,
} from "../../src/extension/roster/orphanReconcile.js";
import type {
  ClaudeTeamConfig,
  Member,
  ScannedAgent,
} from "../../src/shared/types.js";

// ---------------------------------------------------------------------------
// agentScanner.isPersonaAgentFile — non-persona exclusion
// ---------------------------------------------------------------------------

describe("isPersonaAgentFile", () => {
  it("accepts lowercase-kebab persona .md files", () => {
    expect(isPersonaAgentFile("felix.md")).toBe(true);
    expect(isPersonaAgentFile("maya.md")).toBe(true);
    expect(isPersonaAgentFile("a-b-c.md")).toBe(true);
  });

  it("rejects uppercase convention docs (TEAM.md)", () => {
    expect(isPersonaAgentFile("TEAM.md")).toBe(false);
    expect(isPersonaAgentFile("Felix.md")).toBe(false);
  });

  it("rejects the dispatch-template and readme by explicit skip-list", () => {
    expect(isPersonaAgentFile("dispatch-template.md")).toBe(false);
    expect(isPersonaAgentFile("README.md")).toBe(false);
    expect(isPersonaAgentFile("readme.md")).toBe(false);
  });

  it("rejects non-.md files and empty stems", () => {
    expect(isPersonaAgentFile("felix.txt")).toBe(false);
    expect(isPersonaAgentFile(".md")).toBe(false);
    expect(isPersonaAgentFile("notes")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detection — trichotomy (AC1)
// ---------------------------------------------------------------------------

describe("computeDetectionState (AC1 trichotomy)", () => {
  it("config present → configured (regardless of agent count)", () => {
    expect(computeDetectionState(true, 0)).toBe("configured");
    expect(computeDetectionState(true, 5)).toBe("configured");
  });

  it(">=2 agents + no config → suggest-setup", () => {
    expect(computeDetectionState(false, 2)).toBe("suggest-setup");
    expect(computeDetectionState(false, 6)).toBe("suggest-setup");
  });

  it("<2 agents + no config → empty", () => {
    expect(computeDetectionState(false, 0)).toBe("empty");
    expect(computeDetectionState(false, 1)).toBe("empty");
  });

  it("threshold constant is 2", () => {
    expect(SUGGEST_SETUP_MIN_AGENTS).toBe(2);
  });

  it("detectFromScan wraps over the scanned array length", () => {
    const two: ScannedAgent[] = [
      { agentName: "felix", filePath: "/x/felix.md" },
      { agentName: "maya", filePath: "/x/maya.md" },
    ];
    expect(detectFromScan(false, two)).toBe("suggest-setup");
    expect(detectFromScan(false, two.slice(0, 1))).toBe("empty");
    expect(detectFromScan(true, [])).toBe("configured");
  });
});

// ---------------------------------------------------------------------------
// claudeTeamConfig — starter gen + serialize (AC3, AC4)
// ---------------------------------------------------------------------------

describe("generateStarterConfig (AC3 fresh-member shape)", () => {
  it("seeds immutable match agentType_equals, display=name, empty role, null char, live status", () => {
    const cfg = generateStarterConfig(["felix", "maya"], "ClaudeTeam");
    expect(cfg.version).toBe(CLAUDE_TEAM_CONFIG_VERSION);
    expect(cfg.teams).toHaveLength(1);
    const [team] = cfg.teams;
    expect(team!.id).toBe("claudeteam");
    expect(team!.name).toBe("ClaudeTeam");
    expect(team!.members).toHaveLength(2);
    const felix = team!.members[0]!;
    expect(felix.id).toBe("felix");
    expect(felix.display).toBe("felix");
    expect(felix.role).toBe("");
    expect(felix.character).toBeNull();
    expect(felix.status).toBe("live");
    expect(felix.match).toEqual([{ agentType_equals: "felix" }]);
  });

  it("de-duplicates a doubled include (first wins)", () => {
    const cfg = generateStarterConfig(["felix", "felix", "maya"]);
    expect(cfg.teams[0]!.members.map((m) => m.id)).toEqual(["felix", "maya"]);
  });

  it("empty include → a team with zero members (valid)", () => {
    const cfg = generateStarterConfig([]);
    expect(cfg.teams[0]!.members).toEqual([]);
  });

  // 86ca1nvae — auto-resolved role seeding from the scanner's derived role map.
  it("seeds member.role from the roles lookup when present + non-empty", () => {
    const roles = new Map<string, string>([
      ["felix", "Senior Developer #1"],
      ["sage", "QA / Tester"],
    ]);
    const cfg = generateStarterConfig(["felix", "sage"], "Demo", roles);
    const [felix, sage] = cfg.teams[0]!.members;
    expect(felix!.role).toBe("Senior Developer #1");
    expect(sage!.role).toBe("QA / Tester");
  });

  it("falls back to empty role when the name has no roles entry", () => {
    const roles = new Map<string, string>([["felix", "Senior Developer #1"]]);
    const cfg = generateStarterConfig(["felix", "maya"], "Demo", roles);
    const [felix, maya] = cfg.teams[0]!.members;
    expect(felix!.role).toBe("Senior Developer #1");
    expect(maya!.role).toBe(""); // no entry → blank (role OPTIONAL)
  });

  it("falls back to empty role for an empty-string roles entry", () => {
    const roles = new Map<string, string>([["felix", ""]]);
    const cfg = generateStarterConfig(["felix"], "Demo", roles);
    expect(cfg.teams[0]!.members[0]!.role).toBe("");
  });

  it("omitting the roles arg keeps the lean empty-role default (back-compat)", () => {
    const cfg = generateStarterConfig(["felix"], "Demo");
    expect(cfg.teams[0]!.members[0]!.role).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 86ca1nvae — deriveRoleFromDescription (first-clause role title from the
// agent `.md` frontmatter `description`).
// ---------------------------------------------------------------------------

describe("deriveRoleFromDescription (86ca1nvae)", () => {
  it("cuts a parenthetical-then-context description at the paren", () => {
    expect(
      deriveRoleFromDescription(
        "Senior Developer #1 (extension host + data layer) on the ClaudeTeam project (a VS Code extension).",
      ),
    ).toBe("Senior Developer #1");
  });

  it("cuts 'X on the <project>' at ' on the '", () => {
    expect(
      deriveRoleFromDescription("QA / Tester on the ClaudeTeam project. Use for test planning."),
    ).toBe("QA / Tester");
    expect(
      deriveRoleFromDescription("UX Designer on the ClaudeTeam project (surfaces agent teams)."),
    ).toBe("UX Designer");
    expect(
      deriveRoleFromDescription("Project Lead on the ClaudeTeam project. Use for planning."),
    ).toBe("Project Lead");
  });

  it("cuts at sentence/clause punctuation when no project tail", () => {
    expect(deriveRoleFromDescription("Backend Engineer. Owns the API.")).toBe(
      "Backend Engineer",
    );
    expect(deriveRoleFromDescription("Reviewer, gate-keeper")).toBe("Reviewer");
  });

  it("returns the whole trimmed string when there is no delimiter", () => {
    expect(deriveRoleFromDescription("  Lead Architect  ")).toBe("Lead Architect");
  });

  it("returns '' for undefined / empty / whitespace (no role derived)", () => {
    expect(deriveRoleFromDescription(undefined)).toBe("");
    expect(deriveRoleFromDescription("")).toBe("");
    expect(deriveRoleFromDescription("   ")).toBe("");
  });

  it("caps a delimiter-less pathological description defensively", () => {
    const long = "x".repeat(120);
    expect(deriveRoleFromDescription(long).length).toBeLessThanOrEqual(60);
  });
});

describe("slugifyTeamId", () => {
  it("kebabs + lowercases + trims", () => {
    expect(slugifyTeamId("ClaudeTeam")).toBe("claudeteam");
    expect(slugifyTeamId("My Cool Project!")).toBe("my-cool-project");
    expect(slugifyTeamId("  spaced  ")).toBe("spaced");
  });

  it("falls back to 'team' for all-symbol / empty input", () => {
    expect(slugifyTeamId("")).toBe("team");
    expect(slugifyTeamId("!!!")).toBe("team");
  });
});

describe("serializeConfig", () => {
  it("emits the panel-owns-the-format header + explicit character/status", () => {
    const cfg = generateStarterConfig(["felix"], "Demo");
    const yamlStr = serializeConfig(cfg);
    expect(yamlStr).toContain("panel-managed");
    expect(yamlStr).toContain("version: 1");
    expect(yamlStr).toContain("agentType_equals: felix");
    expect(yamlStr).toContain("character: null");
    expect(yamlStr).toContain("status: live");
  });

  it("is deterministic — re-serializing identical config is byte-identical", () => {
    const cfg = generateStarterConfig(["felix", "maya"], "Demo");
    expect(serializeConfig(cfg)).toBe(serializeConfig(cfg));
  });
});

// ---------------------------------------------------------------------------
// orphanReconcile — drift/orphan (AC6)
// ---------------------------------------------------------------------------

function member(id: string, agentType: string | null, status?: Member["status"]): Member {
  return {
    id,
    display: id,
    role: "",
    character: null,
    status,
    match: agentType !== null ? [{ agentType_equals: agentType }] : [{ name_prefix: `${id}-` }],
  };
}

function configWith(members: Member[]): ClaudeTeamConfig {
  return { version: 1, teams: [{ id: "t", name: "T", members }] };
}

describe("memberBackingAgent", () => {
  it("returns the first agentType_equals value", () => {
    expect(memberBackingAgent(member("felix", "felix"))).toBe("felix");
  });
  it("returns null when the member has no agentType_equals rule", () => {
    expect(memberBackingAgent(member("x", null))).toBeNull();
  });
});

describe("reconcileOrphans (AC6)", () => {
  it("flips a live member to orphaned when its agent file is gone", () => {
    const cfg = configWith([member("felix", "felix", "live")]);
    const { config, changed } = reconcileOrphans(cfg, new Set(["maya"]));
    expect(changed).toBe(true);
    expect(config.teams[0]!.members[0]!.status).toBe("orphaned");
  });

  it("revives an orphaned member to live when its file returns", () => {
    const cfg = configWith([member("felix", "felix", "orphaned")]);
    const { config, changed } = reconcileOrphans(cfg, new Set(["felix"]));
    expect(changed).toBe(true);
    expect(config.teams[0]!.members[0]!.status).toBe("live");
  });

  it("no-op (same reference) when nothing changes", () => {
    const cfg = configWith([member("felix", "felix", "live")]);
    const res = reconcileOrphans(cfg, new Set(["felix"]));
    expect(res.changed).toBe(false);
    expect(res.config).toBe(cfg);
  });

  it("leaves members with no backing agent untouched (never drift-orphaned)", () => {
    const cfg = configWith([member("custom", null, "live")]);
    const { config, changed } = reconcileOrphans(cfg, new Set());
    expect(changed).toBe(false);
    expect(config.teams[0]!.members[0]!.status).toBe("live");
  });

  it("NON-VACUOUS: removing the absent-check would not flip → test fails", () => {
    // Guard the orphan flip specifically: a present agent must NOT orphan.
    const cfg = configWith([member("felix", "felix", "live")]);
    const { changed } = reconcileOrphans(cfg, new Set(["felix"]));
    expect(changed).toBe(false); // would be true if reconcile orphaned blindly
  });
});

describe("removeMemberById (AC6 — confirm-delete is the only delete path)", () => {
  it("removes the matching member", () => {
    const cfg = configWith([member("felix", "felix"), member("maya", "maya")]);
    const { config, removed } = removeMemberById(cfg, "felix");
    expect(removed).toBe(true);
    expect(config.teams[0]!.members.map((m) => m.id)).toEqual(["maya"]);
  });

  it("no-op (same reference) when the member id is absent", () => {
    const cfg = configWith([member("felix", "felix")]);
    const res = removeMemberById(cfg, "ghost");
    expect(res.removed).toBe(false);
    expect(res.config).toBe(cfg);
  });
});
