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
