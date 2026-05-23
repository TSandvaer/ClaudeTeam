/**
 * Shared domain types for the extension host and webview.
 *
 * This file is the single source of truth for cross-process types. Both
 * `src/extension/**` (extension host) and `src/webview/**` (webview) import
 * from here. Keep it free of runtime dependencies on either side.
 *
 * AgentMeta covers all THREE meta.json variants observed on disk
 * (see .claude/docs/data-sources.md §4 + team/bram-research/m1-fixtures-2026-05-23.md):
 *
 *   variant       | agentType        | name        | toolUseId | Claude Code version
 *   --------------|------------------|-------------|-----------|--------------------
 *   v2.1.119      | persona slug     | absent      | absent    | 2.1.119 era
 *   new-generic   | engine type      | usually null| present   | 2.1.145+
 *   new-persona   | persona slug     | absent/null | present   | 2.1.145+
 *
 * `schemaVersion` records which path the parser detected; the matcher
 * does NOT depend on it (matchAgent is purely field-driven). Downstream
 * consumers (reducer / CLI) may use `schemaVersion` for diagnostics.
 */

/**
 * Detected meta.json schema variant. The v2.1.145 schema is split into two
 * sub-tags because the on-disk shape diverges meaningfully (engine-type
 * `agentType` vs persona-slug `agentType`) even though `toolUseId` is
 * present in both. See `.claude/docs/data-sources.md` §4 "Schema detection
 * rule" lines 141-149.
 */
export type AgentMetaSchemaVersion =
  | "v2.1.119"
  | "v2.1.145-general"
  | "v2.1.145-persona";

/**
 * Normalized agent metadata, drift-agnostic. The matcher accepts this
 * shape — never raw on-disk JSON. Parsers normalize before passing.
 *
 * `name` is typed as `string | null | undefined` so test/fixture authors
 * can use `undefined` to mean "key absent" without ceremony. The parser
 * (parseMeta) normalizes both `undefined` and on-disk `null` to `null`.
 */
export interface AgentMeta {
  /** Detected schema variant — diagnostic only, NOT used by the matcher. */
  schemaVersion: AgentMetaSchemaVersion;
  /** Engine type ("general-purpose", "Explore") OR persona slug ("felix") depending on variant. */
  agentType: string;
  /** Persona name when populated. Absent → undefined; explicit `null` on disk → null. Mostly absent. */
  name: string | null | undefined;
  /** Free-text description supplied at spawn time. */
  description: string;
  /** Parent transcript's `tool_use.id` linking parent → child. Absent only on v2.1.119. */
  toolUseId: string | null;
}

/**
 * Typed error thrown by `parseMeta` when the input cannot be normalized.
 *
 * The raw input is preserved on the `raw` field so the caller (file
 * watcher) can log it for postmortem. This is a parse-time failure —
 * callers should catch and skip the offending meta.json, not crash.
 */
export class MetaParseError extends Error {
  override readonly name = "MetaParseError";
  readonly raw: unknown;
  readonly reason:
    | "not-object"
    | "missing-agentType"
    | "missing-description"
    | "invalid-field-type";

  constructor(
    message: string,
    reason: MetaParseError["reason"],
    raw: unknown,
  ) {
    super(message);
    this.reason = reason;
    this.raw = raw;
  }
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
