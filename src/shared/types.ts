// Shared domain types across extension host and webview.
//
// AgentMeta covers all THREE meta.json variants observed on disk
// (see .claude/docs/data-sources.md + team/bram-research/m1-fixtures-2026-05-23.md):
//
//   variant       | agentType        | name        | toolUseId | Claude Code version
//   --------------|------------------|-------------|-----------|--------------------
//   v2.1.119      | persona slug     | absent      | absent    | 2.1.119 era
//   new-generic   | engine type      | usually null| present   | 2.1.145+
//   new-persona   | persona slug     | absent/null | present   | 2.1.145+ (undocumented in docs/data-sources.md
//                                                                until M1-11 Bram doc PR lands)
//
// Sized as a discriminated-ish shape: `schemaVersion` records which path
// the parser detected; the matcher does NOT depend on it (matchAgent is
// purely field-driven). Downstream consumers (reducer / CLI) may use
// `schemaVersion` for diagnostics.

/**
 * Detected meta.json schema family. v2.1.119 if `toolUseId` is absent;
 * v2.1.145 otherwise. The "new-persona" sub-variant is a v2.1.145 file
 * whose `agentType` is a persona slug instead of an engine type — the
 * matcher routes it identically to v2.1.119 (via `agentType_equals`).
 */
export type AgentMetaSchemaVersion = "v2.1.119" | "v2.1.145";

/**
 * Normalized agent metadata, drift-agnostic. The matcher accepts this
 * shape — never raw on-disk JSON. Parsers normalize before passing.
 */
export interface AgentMeta {
  /** Detected schema family — diagnostic only, NOT used by the matcher. */
  schemaVersion: AgentMetaSchemaVersion;
  /** Engine type ("general-purpose", "Explore") OR persona slug ("felix") depending on variant. */
  agentType: string;
  /** Persona name when populated. Absent → undefined; explicit `null` on disk → null. Mostly absent (~74%+ in practice). */
  name: string | null | undefined;
  /** Free-text description supplied at spawn time. */
  description: string;
  /** Parent transcript's `tool_use.id` linking parent → child. Absent only on v2.1.119. */
  toolUseId: string | null;
}

// =============================================================================
// Roster types — sponsor-curated team config loaded from teams.yaml.
// See .claude/docs/roster-matching.md (canonical) for the schema rationale.
// =============================================================================

/**
 * Match rule against an AgentMeta. Each rule is an object with exactly ONE key.
 * The matcher walks rules in declaration order; first hit wins. New rule types
 * can be added in a backward-compatible way — keep the union small.
 *
 * Case sensitivity (per .claude/docs/roster-matching.md):
 *   - name_prefix          → case-SENSITIVE
 *   - name_equals          → case-SENSITIVE
 *   - agentType_equals     → case-SENSITIVE
 *   - description_contains → case-INSENSITIVE
 */
export type MatchRule =
  | { name_prefix: string }
  | { name_equals: string }
  | { agentType_equals: string }
  | { description_contains: string };

/** One member of a team — maps a person/role to a list of match rules. */
export interface Member {
  /** Stable internal id (kebab-case). Used for project-override merge by id. */
  id: string;
  /** Display name shown on the dashboard tile / CLI row. */
  display: string;
  /** Free-text role label. */
  role: string;
  /** Optional hex color for the tile. Webview falls back to generated color when absent. */
  color?: string;
  /** Ordered list of match rules. First hit (per agent meta) wins. */
  match: MatchRule[];
}

/** A team groups members. The dashboard renders one card per team. */
export interface Team {
  /** Stable internal id (kebab-case). */
  id: string;
  /** Display name on the team card. */
  name: string;
  /** Optional team description. */
  description?: string;
  /** Ordered list of members. Matcher walks members in declaration order. */
  members: Member[];
}

/** Result of matching one AgentMeta against the loaded roster. */
export type MatchResult =
  | { teamId: string; memberId: string }
  | null;

/**
 * Result of loading the roster. The loader never throws — every error case
 * surfaces in `errors` and `warnings`; the caller decides whether to render
 * an error chip or fall back to empty roster.
 */
export interface RosterLoadResult {
  roster: Team[];
  warnings: string[];
  errors: string[];
}
