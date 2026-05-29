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
  /**
   * Optional 6-digit lowercase hex color with leading `#` (e.g. `"#5d8aa8"`).
   *
   * Webview paints the RUNNING-state dot in this color when present (overrides
   * the semantic `--ct-color-state-running` token). Idle / finished / error
   * states IGNORE this field — they retain the M4-01 semantic state colors.
   *
   * Loader normalization (per `src/extension/roster/loader.ts`):
   *   - 6-digit hex (`"#5d8aa8"`) → preserved (lowercased).
   *   - 3-digit hex (`"#5da"`)    → expanded to 6-digit lowercase (`"#55ddaa"`).
   *   - Invalid format             → dropped to `undefined` + a warning entry
   *                                  on `RosterLoadResult.warnings`.
   *
   * When absent the webview falls back to the default semantic running color
   * (NO auto-generation in V1 — sponsor-curated only per spec §2.3 Option A).
   *
   * Source: `team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md` §2.
   */
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
 * its JSONL. Pure projection — no liveness inference here; that's the
 * reducer's job (M1-09). The reducer cross-references the parent transcript
 * (foreground tool_result) AND consults `isFinished` here (background
 * completion signal, Obs 13).
 *
 * Field semantics (per M1-06 AC1, extended by Obs 13 / 86c9zmp5g):
 *   - model:         resolved model from the FIRST assistant message in the
 *                    file (e.g. "claude-opus-4-7"). Null when no assistant
 *                    message has been written yet (fresh spawn, metadata-only
 *                    JSONL, missing/empty file).
 *   - lastTool:      tool name from the LAST `tool_use` content entry in the
 *                    LAST `type: "assistant"` record (e.g. "Bash", "Read",
 *                    "Edit"). Null when the last assistant message has only
 *                    text content, or no assistant message exists yet.
 *                    The "last assistant" is the most recent one walking
 *                    backwards from the tail, representing whatever the
 *                    agent was last doing.
 *   - lastTimestamp: epoch ms parsed from the LAST `type: "assistant"`
 *                    record's `timestamp` (ISO-8601 string). 0 sentinel when
 *                    no assistant record found OR timestamp is missing/
 *                    unparseable.
 *   - mtimeMs:       fs.stat mtime of the JSONL file. 0 sentinel when the
 *                    file is missing.
 *   - isFinished:    true when the LAST `type: "assistant"` record has
 *                    `message.stop_reason === "end_turn"` — Bram's Obs 13
 *                    triage proved completed (background) sub-agents end
 *                    their own JSONL on this record. The reducer treats
 *                    this as a finished signal for background dispatches
 *                    whose parent JSONL never receives a real tool_result.
 *                    Optional for back-compat with callers / fixtures that
 *                    pre-date the field — absent → treated as false.
 *                    Verified on Claude Code v2.1.145 only (see
 *                    `subagentTailer.ts` design note #4 caveat).
 */
export interface SubagentActivity {
  model: string | null;
  lastTool: string | null;
  lastTimestamp: number;
  mtimeMs: number;
  /**
   * Obs 13 (86c9zmp5g): set true when the last assistant record in the
   * sub-agent JSONL has `stop_reason === "end_turn"`. Background sub-agents'
   * own JSONL is the only available completion signal because the parent
   * JSONL never receives a real `tool_result` for background dispatches —
   * only an `isAsync` ack (skipped by `readFinishedToolUseIds` since PR #82).
   * Verified on Claude Code v2.1.145; pre-v2.1.145 behavior not confirmed.
   */
  isFinished?: boolean;
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
 *   running   — session alive + JSONL mtime < 10s old
 *   idle      — session alive + JSONL mtime >= 10s old (but not finished/error)
 *   finished  — parent transcript has tool_result matching meta.toolUseId
 *   error     — meta parse failed, JSONL missing for a non-finished spawn, or
 *               roster matcher emitted a warning for this agent
 *   available — roster-baseline state: a `teams.yaml` member that has NO
 *               detected/matched agent this session ("never-run"). Seeded by
 *               the reducer's baseline pass (EPIC 86ca11187 / 86ca18b9p) so
 *               every roster member always has a tile; live detection overlays
 *               one of the four states above. NOT inferred from filesystem —
 *               it is the absence of any live agent for that member.
 *               Consumed verbatim by E-05 (webview never-run treatment) and
 *               the CLI presenter glyph. Distinct from `idle` (which means
 *               "alive but quiet") — `available` means "no live agent at all".
 */
export type AgentState =
  | "running"
  | "idle"
  | "finished"
  | "error"
  | "available";

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
   *   finished → "finished" (no elapsed) or "finished Xs/Xm/Xh/Xd"
   *              (humanized elapsed-since-`tool_result.timestamp` suffix per
   *              86c9yxv94 → 86c9zfmhp — reducer's `buildActivity` calls
   *              `formatFreshness` when `FinishedMap` carries a `finishedAtMs`
   *              for the agentId; bare "finished" remains the fallback when
   *              timestamp is absent. Pre-86c9zfmhp the host emitted raw
   *              seconds `"finished 19289s"`; humanization moved to the host
   *              so the webview no longer appends a parallel second clock.)
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
  /**
   * Epoch ms when this agent finished (parent JSONL `tool_result.timestamp`).
   * Populated on finished tiles when the parser successfully extracted the
   * timestamp; absent otherwise. JSON-safe primitive — survives the
   * `serializeState` round-trip across the host↔webview boundary.
   *
   * Used by the webview tile renderer to:
   *   (a) build the precise-ISO tooltip on the activity row
   *       (`title="Finished at 2026-05-26T16:42:08Z"`).
   *   (b) reconcile webview-local first-seen tracking with host-authoritative
   *       wall-clock truth across webview reloads — host-supplied wins.
   *
   * Added 86c9zfmhp (Obs 11) — the humanized `tile.activity` (`finished 5h`)
   * is the primary skim signal; the tooltip exposes precise time-of-completion
   * for the audit case.
   */
  finishedAtMs?: number;
  /**
   * Optional 6-digit lowercase hex color string from the matched roster
   * `Member.color` (e.g. `"#5d8aa8"`). When defined, the webview paints the
   * RUNNING-state dot in this color (overriding the semantic
   * `--ct-color-state-running` token); idle / finished / error states IGNORE
   * this field — they retain the M4-01 semantic state colors.
   *
   * Optional + back-compat — pre-86c9zq9vm wire emitters omit the field;
   * webview defaults to the current semantic-color behavior. Absence is the
   * "no personalization" signal — there is NO auto-generation fallback in V1
   * (sponsor-curated only per spec §2.3 Option A).
   *
   * Format guarantees (enforced upstream by the roster loader — see
   * `src/extension/roster/loader.ts`): 6-digit lowercase hex with leading `#`.
   * 3-digit shorthand is expanded by the loader; invalid formats are dropped
   * with a `RosterLoadResult.warnings` entry, never reach the wire.
   *
   * Source: `team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md` §2.2.
   */
  memberColor?: string;
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
 * Wrapper that collapses N>1 rostered tiles sharing the same matched-roster
 * persona name into a single header tile with an expand/collapse affordance
 * (M3-10). The host-side reducer emits a `CollapsedPersonaGroup` in the
 * `rosterTiles[teamId]` slot when the configured collapse rule fires; when the
 * count is 1, the slot stays as a bare `AgentTile` (no wrapper — full back-
 * compat).
 *
 * Discriminator: `kind: "collapsed-persona"`. AgentTile has no `kind` field —
 * the absence is the discriminator on the unwrapped side. Renderer routes via
 * a `"kind" in entry` check.
 *
 * The wrapper does NOT change the per-instance AgentTile shape. The webview
 * reuses `renderAgentTile` to render each entry in `instances` when expanded.
 *
 * Source: ClickUp 86c9ydug9 (M3-10 persona-tile-collapse)
 */
export interface CollapsedPersonaGroup {
  /** Discriminator — present only on the wrapper. */
  kind: "collapsed-persona";
  /**
   * Matched-roster persona display name (e.g. "Felix"). Rendered in the
   * header as `<personaName> ×<count>`.
   */
  personaName: string;
  /** Number of grouped instances; equals `instances.length`. */
  count: number;
  /**
   * The per-dispatch tiles being grouped. Renderer reuses `renderAgentTile`
   * for each entry when the wrapper is expanded.
   */
  instances: AgentTile[];
}

/**
 * Entry in a team's tile list: either a bare AgentTile (the existing
 * pre-M3-10 shape, used when N=1 and back-compat with all older host code)
 * or a CollapsedPersonaGroup wrapper (M3-10, when N>1).
 */
export type RosterTileEntry = AgentTile | CollapsedPersonaGroup;

/**
 * Type-narrowing helper: discriminate a `RosterTileEntry` between a bare
 * `AgentTile` and a `CollapsedPersonaGroup` wrapper. The wrapper carries the
 * `kind: "collapsed-persona"` discriminator; bare `AgentTile`s have no
 * `kind` field, so the absence is the discriminator on the unwrapped side.
 *
 * Pure / cheap — safe to call repeatedly during render or per-tick.
 * Mirrors the webview-side guard in
 * `src/webview/components/collapsedPersonaTile.ts` (kept in sync — both
 * variants check the same shape). Host-side callers (reducer, CLI flattener,
 * integration tests) import from here.
 */
export function isCollapsedPersonaGroup(
  entry: RosterTileEntry,
): entry is CollapsedPersonaGroup {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry as { kind?: unknown }).kind === "collapsed-persona"
  );
}

/**
 * One session's slice of the agent tree — one entry per live SessionRecord.
 *
 * `rosterTiles` is typed as `Map<string, RosterTileEntry[]>` — the host-side
 * reducer (`buildAgentTree`) emits bare `AgentTile`s for N=1 per-persona and
 * `CollapsedPersonaGroup` wrappers for N>=2 (M3-10), controlled by the
 * `claudeteam.collapsePersonaTiles` config flag (default true). When the
 * flag is false, only bare `AgentTile`s are emitted (no wrappers) — full
 * back-compat with pre-M3-10 callers.
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
   *
   * Pre-86ca03nww: the only label surface on the session card. Post-86ca03nww:
   * one of three resolved by `resolveSessionLabel` (priority:
   * `customTitle > aiTitle > workspace-folder fallback`). `title` is the raw
   * `ai-title` value and remains on the wire for back-compat (CLI presenter,
   * older tests, diagnostic panel); the webview uses `resolveSessionLabel` to
   * pick the display label.
   */
  title: string;
  /**
   * Sponsor-authored session rename from the `custom-title` JSONL record
   * (86ca03nww). Highest-priority label surface — `resolveSessionLabel`
   * returns this when defined and non-empty.
   *
   * Source: `~/.claude/projects/{slug}/{sessionId}.jsonl` `type: "custom-title"`
   * records (schema: `{type, sessionId, customTitle}`). The parser scans
   * backward from EOF and picks the FIRST match — Claude Code itself uses
   * the LAST `customTitle` written, and EOF-first-backward is the cheap way
   * to converge on that.
   *
   * Absent when the sponsor has never renamed the session. Empty / whitespace-
   * only values are normalized to undefined by the parser so the resolver's
   * priority chain falls through to `aiTitle`.
   */
  customTitle?: string;
  /**
   * Active git branch at the time of the latest user/assistant/system/attachment
   * record in the session JSONL (86ca03nww). Used as a small chip near the
   * title on the session card — high signal for ticket / feature branch context.
   *
   * Source: top-level `gitBranch` field on `attachment`, `user`, `assistant`,
   * `system` records in the session JSONL (per Felix's PR #104 review NIT 4,
   * verified against ClaudeTeam session 07e66f5e — 620 records carrying the
   * field across the four types). The parser picks the LAST occurrence
   * encountered when scanning forward, matching Claude Code's own behavior
   * (extension.js `ba` function takes the last `gitBranch` in the JSONL tail).
   *
   * Absent when the JSONL has no records carrying the field. NOT used in the
   * label resolution chain — this is a complementary display surface (chip),
   * not a fallback for the title text.
   */
  gitBranch?: string;
  /**
   * Rostered tiles grouped by team.
   * Key = teamId; value = ordered list of `RosterTileEntry` entries
   * (bare `AgentTile` for N=1 per-persona, `CollapsedPersonaGroup` wrapper
   * for N>=2 — see M3-10).
   *
   * Consumers MUST discriminate via the `kind` field (or
   * `isCollapsedPersonaGroup` type guard). Back-compat with pre-M3-10
   * callers holds when `claudeteam.collapsePersonaTiles` is false or every
   * persona has N=1 (no wrappers emitted).
   */
  rosterTiles: Map<string, RosterTileEntry[]>;
  /**
   * Ordered list of teams in roster declaration order (for stable output).
   * Only teams with >= 1 matched tile in this session are included.
   */
  teamOrder: string[];
  /** Background (unrostered) agents for this session. */
  background: BackgroundAgent[];
}

/**
 * Post-hydration session shape used by the webview (M3-10). Currently
 * structurally identical to `SessionTree` — both already type `rosterTiles`
 * as `Map<string, RosterTileEntry[]>` since the host-side reducer emits
 * wrappers directly. Retained as a distinct named type for webview-side
 * code clarity and to avoid churn in webview imports; collapsing the alias
 * is filed as deferred cleanup (see `WebviewAgentTree` doc).
 *
 * Hydrator (`src/webview/main.ts` → `hydrateState`) consumes the wire shape
 * (`SerializedSessionTree`) and produces this webview-side shape.
 */
export interface WebviewSessionTree extends Omit<SessionTree, "rosterTiles"> {
  rosterTiles: Map<string, RosterTileEntry[]>;
}

/**
 * The full agent tree produced by `buildAgentTree`. Pure data — no filesystem
 * access inside the reducer; callers supply the inputs.
 *
 * `filterApplied` (M3-03): true when the window-scoped session filter ran AND
 * removed at least one session from the unfiltered set. The webview consumes
 * this to distinguish "filtered to empty for this workspace" from "globally
 * empty" — the former gets a per-workspace empty-state message and a hint
 * about the `claudeteam.showAllSessionsGlobally` setting; the latter gets the
 * generic empty-state. Optional for back-compat with consumers (CLI driver,
 * older tests) that don't supply or read it; absent → treated as false.
 *
 * `rosterErrors` / `rosterWarnings` (M3-04): mirror the `RosterLoadResult`
 * surface for the most recent roster reload. The webview renders the roster
 * error chip from `rosterErrors` (first message verbatim + "(+N more)";
 * click body for full list + Edit Roster button). Strings are passed
 * verbatim from the loader (e.g. `global roster YAML parse error (...):
 * ...`). Both optional for back-compat with the CLI driver and pre-M3-04
 * tests that don't supply or read them; absent → treated as empty array.
 * Plain `string[]` — JSON-safe across the host↔webview boundary per
 * `.claude/docs/vscode-extension-conventions.md` § "JSON-serialization
 * constraint".
 */
export interface AgentTree {
  /** One entry per SessionRecord, in the order supplied. */
  sessions: SessionTree[];
  /**
   * True when `filterSessionsToWindow` removed ≥1 session this tick.
   * False / absent when no filter ran (showAll on, or no workspace folder
   * open) OR the filter ran but didn't reduce the count.
   * See `src/extension/watcher/sessionFilter.ts` § isFilterApplied.
   */
  filterApplied?: boolean;
  /**
   * Roster load errors from the most recent tick's `loadRoster` call
   * (M3-04). Non-empty → render the error chip. Verbatim from the loader.
   */
  rosterErrors?: string[];
  /**
   * Roster load warnings from the most recent tick (M3-04). Non-empty →
   * render the warning chip subtype. Verbatim from the loader.
   */
  rosterWarnings?: string[];
  /**
   * Count of rostered agent tiles suppressed this tick because their state
   * was "finished" AND `claudeteam.hideFinishedAgents === true` (M5). Used
   * by the webview header chip to render "N finished hidden". Optional for
   * back-compat with pre-M5 consumers (CLI driver, older tests); absent →
   * treated as 0. See `src/extension/state/hideFinishedFilter.ts` for the
   * producer.
   */
  hiddenFinishedCount?: number;
  /**
   * Count of rostered agent tiles suppressed this tick because their state
   * was "idle" AND `claudeteam.hideIdleAgents === true` (spec 86c9zmyef).
   * Used by the webview header chip + per-team row to render
   * "N idle hidden — show". Optional for back-compat with pre-86c9zq9vm
   * consumers (CLI driver, older tests); absent → treated as 0. See
   * `src/extension/state/hideIdleFilter.ts` for the producer.
   */
  hiddenIdleCount?: number;
  /**
   * Mirror of `claudeteam.*` config scalars relevant to the webview's
   * rendering (M5). The watcher reads these once per tick and stamps them
   * onto the produced tree so `serializeState` can pass through to the wire
   * without re-reading config. Optional for back-compat with the CLI driver
   * and older tests; absent → webview treats each field as `false`.
   * See `team/iris-ux/m5-hide-finished-spec.md` §3.5 Field B.
   */
  config?: {
    hideFinishedAgents?: boolean;
    /**
     * Mirror of `claudeteam.autoCollapseUniformClusters` (uniform-cluster
     * polish ticket 86c9zmqa8). When true, a CollapsedPersonaGroup whose
     * instances are all-same-state + all-same-role (and the shared state is
     * not running/error) renders auto-collapsed by default and, when manually
     * expanded, lays its instances out as compact single-row tiles. Optional
     * for back-compat with pre-86c9zmqa8 consumers; absent → webview treats
     * as `false` (uniform-cluster polish OFF).
     *
     * Source: team/iris-ux/86c9zmqa8-uniform-cluster-spec.md §8.1.
     */
    autoCollapseUniformClusters?: boolean;
    /**
     * Mirror of `claudeteam.hideIdleAgents` (spec 86c9zmyef). When true
     * (V1 default — sponsor-confirmed Q1), the post-reducer filter
     * suppresses idle tiles and the webview header chip renders
     * "N idle hidden — show". Optional for back-compat with pre-86c9zq9vm
     * consumers; absent → webview treats as `false`.
     *
     * Source: team/iris-ux/86c9zmyef-running-focused-dashboard-spec.md §3.
     */
    hideIdleAgents?: boolean;
  };
}

/**
 * Canonical dashboard state shape exchanged across the extension host →
 * webview boundary. `DashboardState` is an alias of `AgentTree` — same shape,
 * different name for the webview-facing surface.
 *
 * Rationale (M2-04 resolution of M2-03 open question §11.1):
 *   - The reducer (`buildAgentTree`) produces `AgentTree`.
 *   - Iris's M2-03 spec uses `DashboardState` for the webview message payload.
 *   - Aliasing keeps the reducer's existing return type stable while giving
 *     downstream consumers (Maya's M2-05 webview, the message protocol) a
 *     name that reads correctly in dashboard context.
 *
 * Both names refer to the same object. New code in the webview / message
 * protocol SHOULD use `DashboardState`; new code in the reducer / CLI MAY
 * continue to use `AgentTree`. There is no schema difference.
 */
export type DashboardState = AgentTree;

/**
 * Post-hydration agent-tree shape used by the webview (M3-10). Currently
 * structurally identical to `AgentTree` — the host-side reducer now emits
 * `RosterTileEntry[]` directly (M3-10 host PR), so `WebviewAgentTree` /
 * `WebviewSessionTree` are no-op widenings. Retained as distinct named
 * types for webview-side code clarity; collapsing them into `AgentTree`
 * directly is deferred cleanup (no functional change — drop and re-point
 * webview imports in a follow-up NIT PR).
 */
export interface WebviewAgentTree extends Omit<AgentTree, "sessions"> {
  sessions: WebviewSessionTree[];
}

// =============================================================================
// State delta — host → webview partial update.
// Type defined in M2-04; delta COMPUTATION is M2-06+ work (M2 ships state:full
// only; M4 delta optimization computes the diff). Maya's M2-05 renders
// against the type but does not need a real delta producer at M2 scope.
// =============================================================================

/**
 * Compact key for a tile in a session.
 *
 * Used by `StateDelta.removed` to identify tiles that vanished between
 * ticks. The string form is `sessionId + ":" + agentId` — both required
 * because two sessions can spawn agents with overlapping ids (rare in V1
 * but possible).
 */
export type TileKey = `${string}:${string}`;

/**
 * Minimum-viable shape for partial updates. The host computes a delta
 * between two consecutive `DashboardState` snapshots and posts only the
 * changes; the webview applies them to its rendered DOM without re-rendering
 * unchanged tiles.
 *
 * Field semantics:
 *   - `added`    : tiles present in the new state but not the previous one.
 *   - `updated`  : tiles present in both, with at least one field changed
 *                  (state, activity, model, role, display). The full tile
 *                  is sent — the receiver does not need to diff sub-fields.
 *   - `removed`  : `TileKey`s present in the previous state but absent now.
 *
 * Background-agent deltas are NOT carried in V1 — background tile renderings
 * recompute from the count + collapsed list on every tick. If the live
 * background list churns at high frequency we revisit in M4.
 *
 * NOTE (M2 scope): the host only sends `state:full` at M2. This type exists
 * so Maya's M2-05 webview can typecheck the message receiver against it.
 * Delta computation is deferred to M2-06 follow-up / M4 optimization.
 */
export interface StateDelta {
  /** Tiles newly appearing. `agentId` is the tile's owner key within `sessionId`. */
  added: Array<{ sessionId: string; tile: AgentTile }>;
  /** Tiles where ≥1 field changed. Full tile sent — no sub-field diff. */
  updated: Array<{ sessionId: string; tile: AgentTile }>;
  /** Tiles that disappeared. Identified by `sessionId:agentId`. */
  removed: TileKey[];
}

// =============================================================================
// Session-label resolution (86ca03nww)
// =============================================================================

/**
 * Subset of `SessionTree` the resolver actually reads. Accepts the host-side
 * `SessionTree`, the webview-side `WebviewSessionTree`, AND fixture / test
 * shapes that only carry the three label-relevant fields — keeps the helper
 * usable in unit tests without constructing a full tree.
 */
export interface SessionLabelInputs {
  /** Raw `ai-title` JSONL value, or `"(no title yet)"` sentinel. */
  title: string;
  /** Sponsor rename from `custom-title` JSONL record. Absent → fall through. */
  customTitle?: string | undefined;
  /** Project working directory; basename feeds the workspace-folder fallback. */
  cwd: string;
}

/**
 * Sentinel value `SessionTree.title` carries when no `ai-title` record was
 * found in the parent JSONL (see `readSessionMetadata`). Exported so the
 * resolver and any future consumer can treat it as "ai-title absent" without
 * hard-coding the literal.
 */
export const NO_AI_TITLE_SENTINEL = "(no title yet)" as const;

/**
 * Which tier of the priority chain resolved the label. Used by the webview's
 * `data-label-source` attribute + tooltip so a glance hints WHY a given title
 * is showing.
 */
export type SessionLabelSource =
  | "custom-title"
  | "ai-title"
  | "workspace-folder";

/**
 * Resolution result: the rendered label string PLUS the tier that produced it.
 * Returned by `resolveSessionLabelWithSource`; callers that only need the
 * string can keep using `resolveSessionLabel` (thin back-compat wrapper).
 */
export interface SessionLabelResolution {
  label: string;
  source: SessionLabelSource;
}

/**
 * Resolve the session card's display label PLUS which tier produced it, per
 * the locked vocabulary contract (sponsor 2-question approval 2026-05-27):
 *
 *   customTitle > aiTitle > workspace-folder fallback (basename of cwd)
 *
 * Empty / whitespace-only `customTitle` falls through. The `aiTitle` tier
 * fires when `title` is a non-empty string AND not the `(no title yet)`
 * sentinel. The workspace-folder fallback returns the basename of `cwd` —
 * portable across `\` (Windows) and `/` (POSIX) separators; empty string when
 * `cwd` itself is empty/whitespace (defensive — Claude Code session files
 * always carry a non-empty `cwd` in practice).
 *
 * This is the single source of truth for tier dispatch. `resolveSessionLabel`
 * delegates here; the webview's `sessionBlock` calls this directly so the
 * label string AND the `data-label-source` attribute / tooltip are derived
 * from one pass (no risk of the label saying one tier and the attribute
 * saying another).
 *
 * Pure function; no filesystem reads, no VS Code API.
 *
 * Source: `team/bram-research/86ca00xcd-claude-vscode-label-surfaces-2026-05-27.md`
 *         §"Display priority suggestion"; `.claude/docs/vscode-extension-conventions.md`
 *         §"Session label resolution".
 */
export function resolveSessionLabelWithSource(
  rec: SessionLabelInputs,
): SessionLabelResolution {
  // Tier 1: sponsor-authored `customTitle`.
  if (typeof rec.customTitle === "string") {
    const t = rec.customTitle.trim();
    if (t.length > 0) return { label: t, source: "custom-title" };
  }
  // Tier 2: AI-generated `aiTitle` (the existing `title` field). Treat the
  // sentinel `(no title yet)` as "absent" so it does NOT win over the
  // workspace-folder fallback.
  if (typeof rec.title === "string") {
    const t = rec.title.trim();
    if (t.length > 0 && t !== NO_AI_TITLE_SENTINEL) {
      return { label: t, source: "ai-title" };
    }
  }
  // Tier 3: workspace-folder fallback — basename of cwd.
  return { label: workspaceFolderName(rec.cwd), source: "workspace-folder" };
}

/**
 * Thin wrapper returning just the resolved label string. Kept for
 * back-compat with callers that don't need the source tier (CLI presenter,
 * diagnostic panel, older tests). New callers that need both should use
 * `resolveSessionLabelWithSource` directly.
 */
export function resolveSessionLabel(rec: SessionLabelInputs): string {
  return resolveSessionLabelWithSource(rec).label;
}

/**
 * Extract the workspace folder name (basename) from a `cwd` path. Portable
 * across Windows backslash and POSIX forward-slash separators since the
 * sponsor's machine runs Windows but `cwd` values from Claude Code carry
 * either form (e.g. `c:\Trunk\PRIVATE\ClaudeTeam`, `c:/Trunk/PRIVATE/ClaudeTeam`).
 *
 * Returns `""` when `cwd` is empty / whitespace-only / consists entirely of
 * trailing separators — defensive; production session files always carry a
 * real path.
 *
 * Exported for direct unit-test coverage. Not intended for general path
 * manipulation — for that, use `node:path`.
 */
export function workspaceFolderName(cwd: string): string {
  if (typeof cwd !== "string") return "";
  // Strip trailing separators (e.g. `c:\\foo\\` → `c:\\foo`) so the basename
  // is the last non-empty segment.
  let s = cwd;
  while (s.length > 0 && (s.endsWith("\\") || s.endsWith("/"))) {
    s = s.slice(0, -1);
  }
  if (s.trim().length === 0) return "";
  // Split on either separator and take the last non-empty segment.
  const idxBack = s.lastIndexOf("\\");
  const idxFwd = s.lastIndexOf("/");
  const idx = Math.max(idxBack, idxFwd);
  if (idx < 0) return s; // no separator — the entire string is the name
  return s.slice(idx + 1);
}
