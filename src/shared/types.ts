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

// =============================================================================
// Subagent activity — output of the JSONL tailer (M1-06).
// See .claude/docs/data-sources.md §3 (Subagent transcript) for source shape.
// =============================================================================

/**
 * Snapshot of "what is this subagent currently doing" derived from tailing
 * its JSONL. Pure projection — no liveness / finished inference here; that's
 * the reducer's job (M1-09) which cross-references the parent transcript.
 *
 * Field semantics (per M1-06 AC1):
 *   - model:         resolved model from the FIRST assistant message in the
 *                    file (e.g. "claude-opus-4-7"). Null when no assistant
 *                    message has been written yet (fresh spawn, metadata-only
 *                    JSONL, missing/empty file).
 *   - lastTool:      tool name from the LAST `tool_use` content entry in the
 *                    LAST `type: "assistant"` record (e.g. "Bash", "Read",
 *                    "Edit"). Null when the last assistant message has only
 *                    text content, or no assistant message exists yet.
 *                    NOTE: per Bram's M1-11 finding, a subagent JSONL NEVER
 *                    contains a closing assistant message — the file's last
 *                    record is always a `type: "user"` tool_result. The
 *                    "last assistant" we look at is the most recent one
 *                    walking backwards from the tail, which represents
 *                    whatever the agent was last doing.
 *   - lastTimestamp: epoch ms parsed from the LAST `type: "assistant"`
 *                    record's `timestamp` (ISO-8601 string). 0 sentinel when
 *                    no assistant record found OR timestamp is missing/
 *                    unparseable.
 *   - mtimeMs:       fs.stat mtime of the JSONL file. 0 sentinel when the
 *                    file is missing.
 */
export interface SubagentActivity {
  model: string | null;
  lastTool: string | null;
  lastTimestamp: number;
  mtimeMs: number;
}

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

// =============================================================================
// Session registry types — live Claude Code processes read from
// `~/.claude/sessions/{pid}.json`. See .claude/docs/data-sources.md §1
// for the on-disk schema + §"Liveness inference" for the liveness rule.
// =============================================================================

/**
 * One live (or recently-live) Claude Code session, as derived from a
 * `~/.claude/sessions/{pid}.json` file plus an OS-level liveness probe.
 *
 * The reducer joins these records to per-session subagent state. The
 * polling loop (M1-09+) re-reads the directory on every tick — there is
 * no incremental update; rebuild from disk each pass.
 *
 * `isAlive` reflects the result of `process.kill(pid, 0)` at the moment
 * `listSessions` ran. It is NOT cached; the next `listSessions` call
 * re-probes. See `sessionRegistry.ts` for the exact try/catch shape.
 */
export interface SessionRecord {
  /** OS PID. Matches the source filename (`{pid}.json`). */
  pid: number;
  /** UUID; used to find the project transcript under `projects/{slug}/`. */
  sessionId: string;
  /** Project working directory. Maps to the project slug under `projects/`. */
  cwd: string;
  /** Claude Code version string from the session JSON (e.g. "2.1.145"). */
  version: string;
  /** Entry surface (`claude-vscode` vs `cli`). Informational. */
  entrypoint: string;
  /** Unix ms timestamp when the session JSON recorded start. */
  startedAt: number;
  /**
   * Result of the liveness probe. `true` when `process.kill(pid, 0)`
   * succeeded; `false` when it threw (ESRCH = no such process; EPERM =
   * process exists but cannot be signaled — for V1 we accept the
   * EPERM-as-dead simplification per data-sources.md "Liveness inference"
   * cross-reference to JSONL mtime as the secondary signal).
   */
  isAlive: boolean;
}

// =============================================================================
// Reducer output types — M1-09 AgentTree.
// Field names match Iris's M1-03 spec §6 Glossary exactly so M3 inherits
// without renaming (iris-ux/m1-cli-output-spec.md §6).
// =============================================================================

/**
 * Agent state (liveness inference per data-sources.md "Liveness inference").
 *
 *   running  — session alive + JSONL mtime < 10s old
 *   idle     — session alive + JSONL mtime >= 10s old (but not finished/error)
 *   finished — parent transcript has tool_result matching meta.toolUseId
 *   error    — meta parse failed, JSONL missing for a non-finished spawn, or
 *              roster matcher emitted a warning for this agent
 */
export type AgentState = "running" | "idle" | "finished" | "error";

/**
 * One rostered agent tile — the unit of display in the CLI / dashboard.
 * Field names match Iris's §6 Glossary.
 */
export interface AgentTile {
  /** Stable member id from the roster (e.g. "felix"). */
  memberId: string;
  /** Stable team id from the roster (e.g. "claudeteam-alpha"). */
  teamId: string;
  /** Display name from roster member.display (e.g. "Felix"). */
  display: string;
  /** Role label from roster member.role (e.g. "Extension Host Dev"). */
  role: string;
  /**
   * Rendered activity string (30-char max in CLI presenter).
   * Full string here — truncation is the presenter's job (spec §5 divergence #2).
   *   running  → "tool:<toolName> <firstArg>"
   *   idle     → "idle <Ns>"
   *   finished → "finished"
   *   error    → "error: <reason>"
   */
  activity: string;
  /**
   * Resolved model string (e.g. "claude-opus-4-7").
   * "model:?" sentinel when unresolved (no assistant message in JSONL yet).
   */
  model: string;
  /** Liveness state. */
  state: AgentState;
  /** Agent id (e.g. "a735226d3ddaa543b"). Used for parent→child linking. */
  agentId: string;
  /**
   * toolUseId from meta.json — used for parent→child tree linkage.
   * null on v2.1.119 schema (no toolUseId).
   */
  toolUseId: string | null;
}

/**
 * A background (unrostered) agent collapsed into the noise chip.
 * Per spec §1.6 — always shown (count always visible, details always printed
 * in CLI, collapsible in dashboard M3).
 */
export interface BackgroundAgent {
  /** meta.agentType — the engine type string (e.g. "general-purpose", "Explore"). */
  agentType: string;
  /**
   * meta.description — truncated to 35 chars with ".." in the CLI presenter.
   * Full string stored here.
   */
  description: string;
  /** Liveness state (same inference as rostered tiles, but shown as literal word). */
  state: AgentState;
  /** Resolved model or "model:?" sentinel. */
  model: string;
}

/**
 * One session's slice of the agent tree — one entry per live SessionRecord.
 */
export interface SessionTree {
  /** First 8 chars of sessionId UUID (used in CLI header). */
  shortId: string;
  /** Full session UUID. */
  sessionId: string;
  /** OS PID. */
  pid: number;
  /** Entry surface. */
  entrypoint: string;
  /** Claude Code version string. */
  version: string;
  /** Whether the OS process is alive. */
  isAlive: boolean;
  /** Project working directory. */
  cwd: string;
  /**
   * Session title from the `ai-title` JSONL record.
   * "(no title yet)" when no ai-title record found.
   */
  title: string;
  /**
   * Rostered tiles grouped by team.
   * Key = teamId; value = ordered list of AgentTiles for that team.
   */
  rosterTiles: Map<string, AgentTile[]>;
  /**
   * Ordered list of teams in roster declaration order (for stable output).
   * Only teams with >= 1 matched tile in this session are included.
   */
  teamOrder: string[];
  /** Background (unrostered) agents for this session. */
  background: BackgroundAgent[];
}

/**
 * The full agent tree produced by `buildAgentTree`. Pure data — no filesystem
 * access inside the reducer; callers supply the inputs.
 */
export interface AgentTree {
  /** One entry per SessionRecord, in the order supplied. */
  sessions: SessionTree[];
}
