// Matcher unit tests — pure function over (AgentMeta, Team[]).
//
// Coverage targets (from M1-08 AC6 + Sage test plan §M1-08):
//   - each rule type hits + misses
//   - first-match-wins across teams + members + rules
//   - both meta.json schemas as inputs (v2.1.119, v2.1.145 generic, v2.1.145 persona)
//   - case sensitivity per docs (description_contains is case-insensitive;
//     others are case-sensitive)
//   - no-match returns null
//   - empty roster returns null

import { describe, it, expect } from "vitest";
import { matchAgent, evalRule } from "../../src/extension/roster/matcher.js";
import type { AgentMeta, Team } from "../../src/shared/types.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function meta(partial: Partial<AgentMeta> & { description: string; agentType: string }): AgentMeta {
  return {
    // Default to v2.1.145-general because the helper's default agentType
    // call-sites use engine types ("general-purpose"). Tests that target
    // the persona variant pass an explicit schemaVersion override.
    schemaVersion: "v2.1.145-general",
    name: null,
    toolUseId: "toolu_test",
    ...partial,
  };
}

const TEAM_ALPHA: Team = {
  id: "alpha",
  name: "Alpha",
  members: [
    {
      id: "felix",
      display: "Felix",
      role: "Extension Host Dev",
      match: [{ name_prefix: "felix-" }, { agentType_equals: "felix" }],
    },
    {
      id: "maya",
      display: "Maya",
      role: "Webview UI Dev",
      match: [{ name_equals: "maya-prod" }, { agentType_equals: "maya" }],
    },
    {
      id: "bram",
      display: "Bram",
      role: "Internals Consultant",
      match: [{ description_contains: "Bram research" }, { agentType_equals: "bram" }],
    },
  ],
};

const TEAM_BETA: Team = {
  id: "beta",
  name: "Beta",
  members: [
    {
      id: "sage",
      display: "Sage",
      role: "QA",
      match: [{ agentType_equals: "sage" }],
    },
  ],
};

const ROSTER: Team[] = [TEAM_ALPHA, TEAM_BETA];

// -----------------------------------------------------------------------------
// evalRule — per rule-type happy paths + misses
// -----------------------------------------------------------------------------

describe("evalRule", () => {
  describe("name_prefix", () => {
    it("hits when name starts with the prefix", () => {
      expect(
        evalRule({ name_prefix: "felix-" }, meta({ agentType: "general-purpose", name: "felix-pr310", description: "x" })),
      ).toBe(true);
    });

    it("misses when name is null", () => {
      expect(
        evalRule({ name_prefix: "felix-" }, meta({ agentType: "general-purpose", name: null, description: "x" })),
      ).toBe(false);
    });

    it("misses when name is undefined", () => {
      expect(
        evalRule({ name_prefix: "felix-" }, meta({ agentType: "general-purpose", name: undefined, description: "x" })),
      ).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(
        evalRule({ name_prefix: "felix-" }, meta({ agentType: "general-purpose", name: "Felix-pr310", description: "x" })),
      ).toBe(false);
    });

    it("misses on no match", () => {
      expect(
        evalRule({ name_prefix: "felix-" }, meta({ agentType: "general-purpose", name: "maya-pr1", description: "x" })),
      ).toBe(false);
    });
  });

  describe("name_equals", () => {
    it("hits on exact match", () => {
      expect(
        evalRule({ name_equals: "maya-prod" }, meta({ agentType: "general-purpose", name: "maya-prod", description: "x" })),
      ).toBe(true);
    });

    it("misses on prefix-only", () => {
      expect(
        evalRule({ name_equals: "maya-prod" }, meta({ agentType: "general-purpose", name: "maya-prod-2", description: "x" })),
      ).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(
        evalRule({ name_equals: "maya-prod" }, meta({ agentType: "general-purpose", name: "Maya-prod", description: "x" })),
      ).toBe(false);
    });

    it("misses when name is null", () => {
      expect(
        evalRule({ name_equals: "felix" }, meta({ agentType: "general-purpose", name: null, description: "x" })),
      ).toBe(false);
    });
  });

  describe("agentType_equals", () => {
    it("hits on exact match (v2.1.119 schema)", () => {
      expect(
        evalRule(
          { agentType_equals: "felix" },
          { schemaVersion: "v2.1.119", agentType: "felix", name: undefined, description: "x", toolUseId: null },
        ),
      ).toBe(true);
    });

    it("hits on new-persona variant (v2.1.145 with persona in agentType + toolUseId)", () => {
      expect(
        evalRule(
          { agentType_equals: "felix" },
          { schemaVersion: "v2.1.145-persona", agentType: "felix", name: null, description: "x", toolUseId: "toolu_abc" },
        ),
      ).toBe(true);
    });

    it("misses on engine type when rule targets persona", () => {
      expect(
        evalRule({ agentType_equals: "felix" }, meta({ agentType: "general-purpose", description: "x" })),
      ).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(
        evalRule({ agentType_equals: "felix" }, meta({ agentType: "Felix", description: "x" })),
      ).toBe(false);
    });
  });

  describe("description_contains", () => {
    it("hits on substring", () => {
      expect(
        evalRule(
          { description_contains: "Bram research" },
          meta({ agentType: "general-purpose", description: "Spawn Bram research subagent" }),
        ),
      ).toBe(true);
    });

    it("is case-INSENSITIVE (the only one that is)", () => {
      expect(
        evalRule(
          { description_contains: "BRAM RESEARCH" },
          meta({ agentType: "general-purpose", description: "bram research subagent" }),
        ),
      ).toBe(true);
      expect(
        evalRule(
          { description_contains: "felix review" },
          meta({ agentType: "general-purpose", description: "Felix Review for PR #310" }),
        ),
      ).toBe(true);
    });

    it("misses when substring not present", () => {
      expect(
        evalRule(
          { description_contains: "Bram research" },
          meta({ agentType: "general-purpose", description: "Spawn Maya UI subagent" }),
        ),
      ).toBe(false);
    });
  });
});

// -----------------------------------------------------------------------------
// matchAgent — integration of evalRule + roster walk
// -----------------------------------------------------------------------------

describe("matchAgent", () => {
  it("returns null on empty roster", () => {
    expect(
      matchAgent(meta({ agentType: "felix", description: "x" }), []),
    ).toBeNull();
  });

  it("returns null when no rule across any team/member hits", () => {
    expect(
      matchAgent(
        meta({ agentType: "general-purpose", description: "irrelevant work" }),
        ROSTER,
      ),
    ).toBeNull();
  });

  // Schema-variant matrix — load-bearing for Bram's M1-11 finding
  describe("schema-variant routing", () => {
    it("matches v2.1.119 old schema via agentType_equals", () => {
      const result = matchAgent(
        { schemaVersion: "v2.1.119", agentType: "felix", name: undefined, description: "old schema", toolUseId: null },
        ROSTER,
      );
      expect(result).toEqual({ teamId: "alpha", memberId: "felix" });
    });

    it("matches v2.1.145 generic schema via name_prefix", () => {
      const result = matchAgent(
        { schemaVersion: "v2.1.145-general", agentType: "general-purpose", name: "felix-pr310", description: "new-generic", toolUseId: "toolu_1" },
        ROSTER,
      );
      expect(result).toEqual({ teamId: "alpha", memberId: "felix" });
    });

    it("matches v2.1.145 new-persona variant via agentType_equals (Bram's third variant)", () => {
      // agentType: "felix" + toolUseId present + no name → undocumented v2.1.145 variant.
      const result = matchAgent(
        { schemaVersion: "v2.1.145-persona", agentType: "felix", name: null, description: "new-persona", toolUseId: "toolu_2" },
        ROSTER,
      );
      expect(result).toEqual({ teamId: "alpha", memberId: "felix" });
    });

    it("does NOT match v2.1.145 generic without a name (background agent)", () => {
      // This is the typical 74%+ case from Bram's research: agentType="general-purpose",
      // name=null. The roster has no rule that would match a nameless general-purpose
      // agent, so this should be background.
      const result = matchAgent(
        { schemaVersion: "v2.1.145-general", agentType: "general-purpose", name: null, description: "background", toolUseId: "toolu_3" },
        ROSTER,
      );
      expect(result).toBeNull();
    });
  });

  describe("resolution order — first-match-wins", () => {
    it("walks teams in declaration order", () => {
      // Roster where both alpha.felix and beta.felix-shadow match the same meta.
      // Alpha is declared first → alpha wins.
      const roster: Team[] = [
        {
          id: "alpha",
          name: "Alpha",
          members: [{ id: "felix", display: "Felix", role: "r", match: [{ agentType_equals: "felix" }] }],
        },
        {
          id: "beta",
          name: "Beta",
          members: [{ id: "felix-shadow", display: "Felix Shadow", role: "r", match: [{ agentType_equals: "felix" }] }],
        },
      ];
      const result = matchAgent(meta({ agentType: "felix", description: "x" }), roster);
      expect(result).toEqual({ teamId: "alpha", memberId: "felix" });
    });

    it("walks members in declaration order within a team", () => {
      const roster: Team[] = [
        {
          id: "alpha",
          name: "Alpha",
          members: [
            { id: "first", display: "First", role: "r", match: [{ agentType_equals: "felix" }] },
            { id: "second", display: "Second", role: "r", match: [{ agentType_equals: "felix" }] },
          ],
        },
      ];
      const result = matchAgent(meta({ agentType: "felix", description: "x" }), roster);
      expect(result).toEqual({ teamId: "alpha", memberId: "first" });
    });

    it("walks rules within a member in declaration order — stops at first hit", () => {
      // Member with two rules: name_prefix THEN agentType_equals. Meta hits both.
      // First rule (name_prefix) must short-circuit — verified indirectly by
      // observing the member is matched (the assertion would be the same either
      // way, but the test exists as a guard against a refactor that returns
      // {ruleIndex: 1} or accidentally evaluates all rules.)
      const roster: Team[] = [
        {
          id: "alpha",
          name: "Alpha",
          members: [
            {
              id: "felix",
              display: "Felix",
              role: "r",
              match: [{ name_prefix: "felix-" }, { agentType_equals: "felix" }],
            },
          ],
        },
      ];
      const m = meta({ agentType: "felix", name: "felix-x", description: "x" });
      const result = matchAgent(m, roster);
      expect(result).toEqual({ teamId: "alpha", memberId: "felix" });
    });

    it("more-specific rules should precede broader rules (sponsor's responsibility, matcher honors order)", () => {
      // Roster has name_prefix "felix-pr" before name_prefix "felix-".
      // Meta name = "felix-pr310" — matches both. First-match-wins → "specific".
      const roster: Team[] = [
        {
          id: "alpha",
          name: "Alpha",
          members: [
            {
              id: "specific",
              display: "Felix PR Reviewer",
              role: "r",
              match: [{ name_prefix: "felix-pr" }],
            },
            {
              id: "broad",
              display: "Felix Catch-all",
              role: "r",
              match: [{ name_prefix: "felix-" }],
            },
          ],
        },
      ];
      const m = meta({ agentType: "general-purpose", name: "felix-pr310", description: "x" });
      const result = matchAgent(m, roster);
      expect(result).toEqual({ teamId: "alpha", memberId: "specific" });
    });
  });

  it("matches description_contains as fallback when name/agentType don't match", () => {
    const result = matchAgent(
      meta({ agentType: "general-purpose", name: null, description: "Spawn Bram research subagent" }),
      ROSTER,
    );
    expect(result).toEqual({ teamId: "alpha", memberId: "bram" });
  });

  it("matches across teams — beta team hit", () => {
    const result = matchAgent(
      meta({ agentType: "sage", description: "x" }),
      ROSTER,
    );
    expect(result).toEqual({ teamId: "beta", memberId: "sage" });
  });
});
