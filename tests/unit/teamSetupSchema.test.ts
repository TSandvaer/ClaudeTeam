// Team-setup epic Pt-1 unit tests — `claudeteam.yaml` zod schema + the LOCKED
// Vocabulary-contract type shapes (src/shared/types.ts + src/shared/messages.ts).
//
// Pt-1 is types/schema/messages ONLY (Pattern A — lands first so Maya's TS-03
// unblocks). These tests are compile-only type assertions + runtime schema
// validation; the host impl (scanner / gen / write / resolution) is Pt-2.
//
// Coverage:
//   - claudeTeamConfigSchema: valid config; version literal; role-optional
//     (lean §7.3); character (id / null / absent); status (live / orphaned /
//     absent); immutable match-key required; duplicate-member-id rejected;
//     malformed rejected (never throws — caller catches).
//   - Type shapes: ClaudeTeamConfig / ScannedAgent / CharacterSource /
//     MemberCharacter / MemberStatus / SetupDetectionState assignability.
//   - Message unions: each new setup:* / ui:* member is assignable to its union.

import { describe, it, expect, expectTypeOf } from "vitest";

import { claudeTeamConfigSchema } from "../../src/extension/roster/schema.js";
import type {
  CharacterSource,
  ClaudeTeamConfig,
  MemberCharacter,
  MemberStatus,
  ScannedAgent,
  SetupDetectionState,
  Team,
} from "../../src/shared/types.js";
import type {
  HostMessage,
  WebviewMessage,
} from "../../src/shared/messages.js";

// -----------------------------------------------------------------------------
// A minimal valid config used as a base for arm/disarm assertions.
// -----------------------------------------------------------------------------

function baseConfig(): unknown {
  return {
    version: 1,
    teams: [
      {
        id: "claudeteam-alpha",
        name: "ClaudeTeam Alpha",
        members: [
          {
            id: "felix",
            display: "Felix",
            role: "Extension Host Dev",
            character: "felix-male",
            status: "live",
            match: [{ agentType_equals: "felix" }],
          },
        ],
      },
    ],
  };
}

describe("claudeTeamConfigSchema — happy path", () => {
  it("accepts a full valid config", () => {
    const r = claudeTeamConfigSchema.safeParse(baseConfig());
    expect(r.success).toBe(true);
  });

  it("accepts a fresh-member shape (blank role, null character, live status)", () => {
    const cfg = {
      version: 1,
      teams: [
        {
          id: "t",
          name: "Team",
          members: [
            {
              id: "maya",
              display: "Maya",
              role: "",
              character: null,
              status: "live",
              match: [{ agentType_equals: "maya" }],
            },
          ],
        },
      ],
    };
    const r = claudeTeamConfigSchema.safeParse(cfg);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.teams[0]!.members[0]!.role).toBe("");
      expect(r.data.teams[0]!.members[0]!.character).toBeNull();
    }
  });

  it("defaults role to empty string when omitted (lean OPTIONAL §7.3)", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    delete cfg.teams[0]!.members[0]!.role;
    const r = claudeTeamConfigSchema.safeParse(cfg);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.teams[0]!.members[0]!.role).toBe("");
  });

  it("accepts a member with character + status absent (back-compat)", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    delete cfg.teams[0]!.members[0]!.character;
    delete cfg.teams[0]!.members[0]!.status;
    const r = claudeTeamConfigSchema.safeParse(cfg);
    expect(r.success).toBe(true);
  });

  it("accepts an orphaned member", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    cfg.teams[0]!.members[0]!.status = "orphaned";
    const r = claudeTeamConfigSchema.safeParse(cfg);
    expect(r.success).toBe(true);
  });

  it("accepts an empty teams array (no team configured yet)", () => {
    const r = claudeTeamConfigSchema.safeParse({ version: 1, teams: [] });
    expect(r.success).toBe(true);
  });
});

describe("claudeTeamConfigSchema — rejections (never throws)", () => {
  it("rejects a wrong version literal", () => {
    const cfg = baseConfig() as { version: number };
    cfg.version = 2;
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects a missing version", () => {
    const cfg = baseConfig() as Record<string, unknown>;
    delete cfg.version;
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects a member with no match rules (immutable key required)", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    cfg.teams[0]!.members[0]!.match = [];
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects an empty display", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    cfg.teams[0]!.members[0]!.display = "";
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects an unknown match-rule key", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    cfg.teams[0]!.members[0]!.match = [{ subagent_type_regex: "felix.*" }];
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects an invalid status enum value", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    cfg.teams[0]!.members[0]!.status = "zombie";
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("rejects duplicate member ids within a single team", () => {
    const cfg = baseConfig() as { teams: { members: Record<string, unknown>[] }[] };
    cfg.teams[0]!.members.push({
      id: "felix",
      display: "Felix Two",
      role: "",
      match: [{ agentType_equals: "felix2" }],
    });
    expect(claudeTeamConfigSchema.safeParse(cfg).success).toBe(false);
  });

  it("returns a result object (does not throw) on garbage input", () => {
    expect(() => claudeTeamConfigSchema.safeParse(42)).not.toThrow();
    expect(claudeTeamConfigSchema.safeParse(42).success).toBe(false);
    expect(claudeTeamConfigSchema.safeParse(null).success).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Type-shape assertions (compile-time). These fail the typecheck if the LOCKED
// vocabulary identifiers drift from the contract.
// -----------------------------------------------------------------------------

describe("Vocabulary-contract type shapes", () => {
  it("MemberCharacter is string | null", () => {
    expectTypeOf<MemberCharacter>().toEqualTypeOf<string | null>();
  });

  it("MemberStatus is the live|orphaned union", () => {
    expectTypeOf<MemberStatus>().toEqualTypeOf<"live" | "orphaned">();
  });

  it("SetupDetectionState is the trichotomy union", () => {
    expectTypeOf<SetupDetectionState>().toEqualTypeOf<
      "suggest-setup" | "empty" | "configured"
    >();
  });

  it("ScannedAgent carries agentName + filePath", () => {
    expectTypeOf<ScannedAgent>().toEqualTypeOf<{
      agentName: string;
      filePath: string;
    }>();
  });

  it("CharacterSource carries id/label/origin/thumbnailPath", () => {
    expectTypeOf<CharacterSource>().toEqualTypeOf<{
      id: string;
      label: string;
      origin: "bundled" | "user";
      thumbnailPath: string;
    }>();
  });

  it("ClaudeTeamConfig is { version: number; teams: Team[] }", () => {
    expectTypeOf<ClaudeTeamConfig>().toEqualTypeOf<{
      version: number;
      teams: Team[];
    }>();
  });

  it("Member.character / Member.status are optional + correctly typed", () => {
    // A Team's member should accept the new optional fields.
    const m: Team["members"][number] = {
      id: "x",
      display: "X",
      role: "",
      match: [{ agentType_equals: "x" }],
      character: null,
      status: "orphaned",
    };
    expect(m.character).toBeNull();
    expect(m.status).toBe("orphaned");
  });
});

// -----------------------------------------------------------------------------
// Message-union assignability — each new member is part of its union and
// discriminable on `type`. These are compile-time + a runtime smoke per type.
// -----------------------------------------------------------------------------

describe("setup:* host → webview messages", () => {
  it("setup:detection assignable to HostMessage", () => {
    const m: HostMessage = {
      type: "setup:detection",
      payload: {
        state: "suggest-setup",
        scanned: [{ agentName: "felix", filePath: "/x/felix.md" }],
      },
    };
    expect(m.type).toBe("setup:detection");
  });

  it("setup:characters assignable to HostMessage", () => {
    const m: HostMessage = {
      type: "setup:characters",
      payload: {
        sources: [
          {
            id: "felix-male",
            label: "felix-male",
            origin: "bundled",
            thumbnailPath: "/x/s.png",
          },
        ],
      },
    };
    expect(m.type).toBe("setup:characters");
  });

  it("setup:config-saved assignable to HostMessage (ok + error variants)", () => {
    const ok: HostMessage = { type: "setup:config-saved", payload: { ok: true } };
    const err: HostMessage = {
      type: "setup:config-saved",
      payload: { ok: false, error: "disk full" },
    };
    expect(ok.type).toBe("setup:config-saved");
    expect(err.payload.ok).toBe(false);
  });
});

describe("ui:* webview → host messages", () => {
  it("ui:open-manage-team assignable to WebviewMessage", () => {
    const m: WebviewMessage = { type: "ui:open-manage-team" };
    expect(m.type).toBe("ui:open-manage-team");
  });

  it("ui:run-setup carries include[]", () => {
    const m: WebviewMessage = {
      type: "ui:run-setup",
      payload: { include: ["felix", "maya"] },
    };
    expect(m.type).toBe("ui:run-setup");
  });

  it("ui:save-team carries a ClaudeTeamConfig", () => {
    const cfg: ClaudeTeamConfig = {
      version: 1,
      teams: [
        {
          id: "t",
          name: "T",
          members: [
            {
              id: "felix",
              display: "Felix",
              role: "",
              match: [{ agentType_equals: "felix" }],
              character: null,
              status: "live",
            },
          ],
        },
      ],
    };
    const m: WebviewMessage = { type: "ui:save-team", payload: { config: cfg } };
    expect(m.type).toBe("ui:save-team");
  });

  it("ui:assign-character carries memberId + character (id | null)", () => {
    const assign: WebviewMessage = {
      type: "ui:assign-character",
      payload: { memberId: "felix", character: "felix-male" },
    };
    const clear: WebviewMessage = {
      type: "ui:assign-character",
      payload: { memberId: "felix", character: null },
    };
    expect(assign.payload.character).toBe("felix-male");
    expect(clear.payload.character).toBeNull();
  });

  it("ui:confirm-orphan-delete carries memberId", () => {
    const m: WebviewMessage = {
      type: "ui:confirm-orphan-delete",
      payload: { memberId: "orphan" },
    };
    expect(m.type).toBe("ui:confirm-orphan-delete");
  });

  it("ui:dismiss-setup-suggestion assignable to WebviewMessage", () => {
    const m: WebviewMessage = { type: "ui:dismiss-setup-suggestion" };
    expect(m.type).toBe("ui:dismiss-setup-suggestion");
  });
});
