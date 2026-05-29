// Zod schema for teams.yaml.
//
// Validates the on-disk YAML structure documented in
// .claude/docs/roster-matching.md. Rejects:
//   - missing required fields
//   - unknown match-rule keys
//   - non-string display/id
//   - duplicate member ids within a SINGLE team (cross-team duplicates are
//     a warning emitted by the loader, not a schema error — different bug class)
//
// Schema-detection rule for match rules: each rule object must have EXACTLY
// ONE recognized key. zod's `discriminatedUnion` is too strict for this
// (it requires a literal discriminator field); we use `union` with a
// custom refine that asserts single-key + recognized-key + string value.

import { z } from "zod";

// Recognized match-rule keys. Adding a new rule type means:
//   1. extend the MatchRule union in src/shared/types.ts
//   2. add the key here
//   3. wire it into matcher.ts's evalRule switch
const MATCH_RULE_KEYS = [
  "name_prefix",
  "name_equals",
  "agentType_equals",
  "description_contains",
] as const;

export const matchRuleSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (obj) => {
      const keys = Object.keys(obj);
      return keys.length === 1;
    },
    { message: "match rule must have exactly one key" },
  )
  .refine(
    (obj) => {
      const key = Object.keys(obj)[0];
      return (MATCH_RULE_KEYS as readonly string[]).includes(key);
    },
    {
      message: `match rule key must be one of: ${MATCH_RULE_KEYS.join(", ")}`,
    },
  )
  .refine(
    (obj) => {
      const value = Object.values(obj)[0];
      return typeof value === "string" && value.length > 0;
    },
    { message: "match rule value must be a non-empty string" },
  );

const memberSchema = z.object({
  id: z.string().min(1),
  display: z.string().min(1),
  role: z.string().min(1),
  color: z.string().optional(),
  match: z.array(matchRuleSchema).min(1),
});

const teamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    members: z.array(memberSchema).min(0),
  })
  .superRefine((team, ctx) => {
    // Reject duplicate member ids WITHIN a single team. Cross-team duplicates
    // are handled by the loader as a warning (second-wins, per docs).
    const seen = new Set<string>();
    for (let i = 0; i < team.members.length; i++) {
      const id = team.members[i]!.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate member id "${id}" within team "${team.id}"`,
          path: ["members", i, "id"],
        });
      }
      seen.add(id);
    }
  });

export const rosterFileSchema = z.object({
  teams: z.array(teamSchema),
});

export type RosterFile = z.infer<typeof rosterFileSchema>;

// =============================================================================
// Team-setup epic — `claudeteam.yaml` schema (TS-02, Decisions 1, 3, 4, 5, 7).
//
// The NEW project-scoped file (`<workspace>/.claude/claudeteam.yaml`) supersedes
// the dropped global `~/.claudeteam/teams.yaml`. A SEPARATE schema (not an
// extension of `rosterFileSchema`) because the shapes diverge meaningfully:
//   - top-level `version` discriminator (currently 1).
//   - `Member.role` MAY be empty (lean OPTIONAL — spec §7.3) — the legacy
//     `memberSchema` requires `role.min(1)`, so the new member schema relaxes it.
//   - `Member.character` (string id | null) — per-member character binding.
//   - `Member.status` ("live" | "orphaned") — drift/orphan lifecycle.
//
// The match-rule schema + duplicate-member-id superRefine are REUSED verbatim
// (same rails — backlog Grounding confirms no matcher/schema rule change needed
// to seed `agentType_equals`). Match keys stay required + non-empty (Decision 4
// immutable seed).
// =============================================================================

const claudeTeamMemberSchema = z.object({
  id: z.string().min(1),
  display: z.string().min(1),
  // Lean OPTIONAL (spec §7.3): a member is valid with an empty role. Empty
  // renders as "—" on the tile. Only `display` is required. Defaults to "" so a
  // generated/normalized member that omits `role` reads back as empty.
  role: z.string().default(""),
  color: z.string().optional(),
  // Per-member character: a CharacterSource id, or null = text tile. Optional
  // for forward/back-compat; absent is treated as null (text tile) by readers.
  character: z.string().min(1).nullable().optional(),
  // Member lifecycle status. Optional; absent → treated as "live" by readers
  // (a roster with no drift tracking has only live members).
  status: z.enum(["live", "orphaned"]).optional(),
  match: z.array(matchRuleSchema).min(1),
});

const claudeTeamTeamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    members: z.array(claudeTeamMemberSchema).min(0),
  })
  .superRefine((team, ctx) => {
    // Reject duplicate member ids WITHIN a single team (mirrors teamSchema).
    const seen = new Set<string>();
    for (let i = 0; i < team.members.length; i++) {
      const id = team.members[i]!.id;
      if (seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate member id "${id}" within team "${team.id}"`,
          path: ["members", i, "id"],
        });
      }
      seen.add(id);
    }
  });

export const claudeTeamConfigSchema = z.object({
  // Schema version literal. Currently only `1` is recognized; bump + branch
  // when the on-disk shape changes (explicit > guessing).
  version: z.literal(1),
  teams: z.array(claudeTeamTeamSchema),
});

/**
 * Validated `claudeteam.yaml` shape. Structurally compatible with the shared
 * `ClaudeTeamConfig` type in `src/shared/types.ts` (Pt-2 gen/read/write uses
 * this schema to validate before handing the typed value across the wire).
 */
export type ClaudeTeamConfigFile = z.infer<typeof claudeTeamConfigSchema>;
