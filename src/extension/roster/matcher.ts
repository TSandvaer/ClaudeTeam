// Roster matcher — pure function from AgentMeta + roster → MatchResult.
//
// Resolution order (per .claude/docs/roster-matching.md):
//   1. walk teams in declaration order;
//   2. for each team, walk members in declaration order;
//   3. for each member, walk match rules in declaration order;
//   4. first matching rule wins → return { teamId, memberId };
//   5. no rule matches across the entire roster → return null (background).
//
// Case sensitivity:
//   - name_prefix / name_equals / agentType_equals → case-SENSITIVE
//   - description_contains                         → case-INSENSITIVE
//
// The matcher is drift-agnostic — it operates on the normalized AgentMeta
// (see src/shared/types.ts) and does NOT inspect schemaVersion. This means
// the THREE meta.json variants documented in
// team/bram-research/m1-fixtures-2026-05-23.md all route through the same
// rule evaluator. In particular, the "new-persona" variant (v2.1.145 with
// `agentType: "felix"` + `toolUseId` + no `name`) matches a rule like
// `{ agentType_equals: "felix" }` identically to the old v2.1.119 schema.

import type { AgentMeta, MatchRule, MatchResult, Team } from "../../shared/types.js";

/**
 * Evaluate a single match rule against an AgentMeta.
 * Returns true if the rule matches; false otherwise.
 *
 * Rules with empty/missing target fields:
 *   - name_prefix / name_equals against a meta with `name: null | undefined`
 *     → never matches (we don't coerce null to ""; that would let
 *     `name_prefix: ""` accidentally match every nameless agent).
 *   - description_contains against an empty `description` → only matches an
 *     empty rule value (which the schema rejects, so effectively never).
 */
export function evalRule(rule: MatchRule, meta: AgentMeta): boolean {
  if ("name_prefix" in rule) {
    return typeof meta.name === "string" && meta.name.startsWith(rule.name_prefix);
  }
  if ("name_equals" in rule) {
    return typeof meta.name === "string" && meta.name === rule.name_equals;
  }
  if ("agentType_equals" in rule) {
    return meta.agentType === rule.agentType_equals;
  }
  if ("description_contains" in rule) {
    const needle = rule.description_contains.toLowerCase();
    return meta.description.toLowerCase().includes(needle);
  }
  // Exhaustiveness guard — `rule` should be `never` here once the union
  // is exhausted. If a new rule type lands without an evaluator, the type
  // system catches it at compile time.
  const _exhaustive: never = rule;
  return _exhaustive;
}

/**
 * Match an AgentMeta against the loaded roster.
 *
 * @param meta   normalized agent metadata (from meta.json parser, M1-05)
 * @param roster ordered list of teams (from roster loader)
 * @returns MatchResult — `{ teamId, memberId }` on first hit, `null` otherwise
 */
export function matchAgent(meta: AgentMeta, roster: Team[]): MatchResult {
  for (const team of roster) {
    for (const member of team.members) {
      for (const rule of member.match) {
        if (evalRule(rule, meta)) {
          return { teamId: team.id, memberId: member.id };
        }
      }
    }
  }
  return null;
}
