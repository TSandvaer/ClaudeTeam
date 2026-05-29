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
  /**
   * Per-member pixel-character binding (team-setup epic, Decision 7 — LOCKED
   * `MemberCharacter`). A character id referencing a {@link CharacterSource},
   * or `null` for the text-tile (monogram) fallback. Replaces the hardcoded
   * gender→character binding.
   *
   * Optional + back-compat: ABSENT on the legacy global `teams.yaml` roster and
   * pre-team-setup `Member` records; absence is treated identically to `null`
   * (text tile). Present (incl. explicit `null`) only on the new project-scoped
   * `claudeteam.yaml` ({@link ClaudeTeamConfig}). JSON-safe scalar.
   */
  character?: MemberCharacter;
  /**
   * Member lifecycle status (team-setup epic, Decision 3 — LOCKED
   * `MemberStatus`). `"live"` when the backing `.claude/agents/<name>.md` file
   * exists; `"orphaned"` when removed-but-kept (greyed, non-live) until the
   * user confirms deletion.
   *
   * Optional + back-compat: ABSENT on the legacy roster + pre-team-setup
   * records; absence is treated as `"live"` (the only sensible default for a
   * roster that has no drift/orphan tracking). Present only on the new
   * `claudeteam.yaml` ({@link ClaudeTeamConfig}). JSON-safe scalar.
   */
  status?: MemberStatus;
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
// Team-setup epic types (TS-02 / EPIC team-setup, LOCKED Vocabulary contract).
// See team/nora-pl/team-setup-epic-backlog.md § "Vocabulary contract" +
// team/iris-ux/team-setup-spec.md. These types model the project-scoped,
// panel-managed `claudeteam.yaml` file (which SUPERSEDES the dropped global
// `~/.claudeteam/teams.yaml`), the agents-folder scanner output, the per-member
// character binding, the discoverable-character list, and the detection
// trichotomy the dashboard switches on.
//
// LOCKED identifiers (Felix + Maya MUST use verbatim): ClaudeTeamConfig,
// ScannedAgent, MemberCharacter, CharacterSource, MemberStatus,
// SetupDetectionState. Pt-1 (TS-02) authors them; Pt-2 (host impl) + TS-03
// (Maya webview) consume them.
// =============================================================================

/**
 * Per-member character binding (Vocabulary contract: `MemberCharacter`).
 *
 * Stored on `Member.character` (see the extended `Member` interface below).
 * The value is a character id referencing a {@link CharacterSource} entry, or
 * `null` when no character is assigned → the member renders as a **text tile**
 * (monogram chip per the whole-team-display fallback). Replaces the previous
 * hardcoded gender→character binding (Decision 7; supersedes memory
 * `project_persona_character_gender_binding`).
 *
 * Modeled as a named type alias (not just `string | null` inline) so the
 * Vocabulary-contract identifier is greppable and the webview's picker /
 * tile-render path can refer to it by name. JSON-safe scalar — survives the
 * host↔webview boundary.
 */
export type MemberCharacter = string | null;

/**
 * Member lifecycle status (Vocabulary contract: `MemberStatus`).
 *
 *   live     — the member's backing `.claude/agents/<name>.md` file exists.
 *   orphaned — the agent file was removed but the member is KEPT in
 *              `claudeteam.yaml` (greyed, non-live tile) until the user
 *              confirms deletion via `ui:confirm-orphan-delete`. NOT
 *              auto-deleted (Decision 3 / spec §6.1).
 *
 * The host flips `live → orphaned` on the file-watch drift path (Pt-2); the
 * webview renders the orphaned treatment. An orphaned member can never go
 * `running` — it has no agent to match.
 */
export type MemberStatus = "live" | "orphaned";

/**
 * The detection trichotomy the host computes per project and the webview
 * switches the entire dashboard root on (Vocabulary contract:
 * `SetupDetectionState`; Decision 2 / spec §2).
 *
 * Host-side precedence (computed in Pt-2, restated from the backlog):
 *   - `claudeteam.yaml` present                       → "configured"
 *   - else ≥2 scanned agents in `.claude/agents/`     → "suggest-setup"
 *   - else (<2 agents)                                → "empty"
 *
 *   configured    — normal dashboard (session blocks, team cards, tiles).
 *   suggest-setup — ≥2 agents detected but no config yet; the dashboard shows
 *                   the dismissible "Orchestration detected" setup card.
 *   empty         — fewer than 2 agents; the dashboard shows the centered
 *                   empty-state card with the LOCKED copy "This project has no
 *                   orchestration setup, nothing to show".
 */
export type SetupDetectionState = "suggest-setup" | "empty" | "configured";

/**
 * One entry produced by the agents-folder scanner (Vocabulary contract:
 * `ScannedAgent`; Decision 2 / spec §3.1). One per `.claude/agents/*.md` file.
 *
 * `agentName` is the filename STEM (e.g. `felix.md` → `"felix"`) — VERIFIED
 * against the live capture corpus to equal the runtime `meta.agentType` for
 * persona-dispatched sub-agents (TS-02 AC2; see the PR body for the evidence).
 * This is why the starter config can seed `match: [{ agentType_equals:
 * agentName }]` and have it match live agents without a separate mapping.
 *
 * `filePath` is the absolute (or workspace-relative — host's call, documented
 * in Pt-2) path to the `.md` file, used by the wizard row for disambiguation
 * (basename shown muted) and by the drift watcher to detect removal.
 *
 * The orchestrator (main session) has NO agent file, so it never appears in
 * `ScannedAgent[]` — orchestrator-not-a-tile holds by construction (Decision 6
 * / spec §6.2), no filter needed.
 *
 * JSON-safe — carried in the `setup:detection` payload.
 */
export interface ScannedAgent {
  /** Filename stem of the `.claude/agents/<name>.md` file (e.g. "felix"). */
  agentName: string;
  /** Path to the agent `.md` file (for disambiguation + drift detection). */
  filePath: string;
}

/**
 * One discoverable character for the picker grid (Vocabulary contract:
 * `CharacterSource`; Decision 7 / spec §5). The host's `resolveCharacterSources()`
 * (Pt-2) merges bundled (`dist/`-baked) + optional user-folder characters into
 * `CharacterSource[]`, deduped by `id` (bundled wins on collision — documented
 * in the Pt-2 PR body). The picker renders the merged list; the origin badge
 * distinguishes shipped vs user-supplied.
 *
 *   id            — stable character id; also the value stored in
 *                   `Member.character` ({@link MemberCharacter}).
 *   label         — human-readable label shown under the thumbnail.
 *   origin        — "bundled" (ships in the `.vsix` via `dist/`) or "user"
 *                   (discovered at runtime from the user-character folder).
 *   thumbnailPath — path to the picker thumbnail; ratify-on-return proposal is
 *                   the south rotation frame (spec §7.1). Host-resolved.
 *
 * JSON-safe — carried in the `setup:characters` payload.
 */
export interface CharacterSource {
  /** Stable character id (referenced by `Member.character`). */
  id: string;
  /** Human-readable label shown under the picker thumbnail. */
  label: string;
  /** Whether the character ships in the bundle or comes from the user folder. */
  origin: "bundled" | "user";
  /** Path to the picker thumbnail image (south rotation frame, ratify default). */
  thumbnailPath: string;
}

/**
 * The parsed top-level shape of the new project-scoped `claudeteam.yaml`
 * (Vocabulary contract: `ClaudeTeamConfig`; Decisions 1, 3, 5).
 *
 * **Naming decision (documented in the TS-02 PR body for Maya + Sage):**
 * introduced as a NEW named type `ClaudeTeamConfig` rather than extending the
 * existing `RosterFile` (`{ teams: Team[] }`, no version). Rationale: the new
 * file carries a `version` discriminator and per-member `character` / `status`
 * fields that the legacy global `teams.yaml` shape never had; a distinct type
 * lets the loader branch cleanly during the migration window and keeps
 * `RosterFile` stable for any transitional read path. `ClaudeTeamConfig.teams`
 * reuses the existing `Team` type, whose `Member` now carries the optional
 * `character` / `status` fields (additive — back-compat with the legacy roster).
 *
 * Shape:
 *   version — schema version literal (currently `1`). Lets the reader reject /
 *             migrate future shapes explicitly rather than guessing.
 *   teams   — same `Team[]` as the roster; members seed
 *             `match: [{ agentType_equals: <agentName> }]` (immutable,
 *             Decision 4), `display` = agentName, empty `role`, `character` null,
 *             `status: "live"` on generation (spec §3.2 fresh-member shape).
 *
 * JSON-safe — carried in the `ui:save-team` payload (webview → host).
 */
export interface ClaudeTeamConfig {
  /** Schema version of the `claudeteam.yaml` file. Currently `1`. */
  version: number;
  /** Teams (reusing the roster `Team` type). */
  teams: Team[];
}

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
   * Owning session UUID for this agent instance. Optional + back-compat —
   * pre-86ca1dtr5 emitters and the baseline (`available`) tile omit it; the
   * single-tile render path falls back to the session-block's sessionId (the
   * tile is rendered inside its own session block, so they coincide).
   *
   * Load-bearing for `MultiAgentPersonaTile.instances`: a rostered member can
   * run N≥2 agents that span DIFFERENT sessions (e.g. two VS Code windows on
   * the same project surface under one team card). Carrying per-instance
   * sessionId on the tile lets the webview drill into the CORRECT session per
   * instance row — resolves PR #123 NIT 2, where a single render-param
   * sessionId opened the wrong transcript for a cross-session instance.
   *
   * JSON-safe scalar — survives the `serializeState` host↔webview round-trip.
   */
  sessionId?: string;
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
 * Multi-agent persona tile — the rostered-member N≥2 wire shape (option A,
 * sponsor GUI-test decision 2026-05-29, ClickUp 86ca1d7er / host 86ca1dtr5).
 *
 * SUPERSEDES `CollapsedPersonaGroup` FOR ROSTERED MEMBERS. Where M3-10 emitted
 * a bare header-tile wrapper (`personaName` + `count` + `instances`, different
 * chrome, "most-active-first" group state with NO error tier), option A renders
 * a rostered member with N≥2 live agents as ONE full persona tile — identical
 * chrome to the single/zero-agent tile — with a `×N` badge + expand affordance.
 * The wrapper therefore carries the FULL member identity (same fields as a
 * single `AgentTile`) plus the aggregate + headline + instance list.
 *
 * Discriminator: `kind: "multi-agent-persona"`. A bare `AgentTile` has no
 * `kind` field; `CollapsedPersonaGroup` (retained for any non-rostered legacy
 * path) carries `kind: "collapsed-persona"`. The three are mutually
 * discriminable on the `kind` field's presence + value.
 *
 * Instance shape — each entry in `instances` is a full `AgentTile` carrying
 * BOTH `agentId` (the per-instance row key — unique per spawn) AND its own
 * `sessionId` (resolves the cross-session drill-in bug from PR #123 NIT 2:
 * with a single render-param sessionId, drill-in into an instance running in a
 * different session opened the wrong transcript. Carrying per-instance
 * sessionId on the tile lets the webview address the correct session per row).
 *
 * The host reducer (`buildAgentTree`) is the single authority for the aggregate
 * state (`computeAggregateState`, §2.1), the headline fields (the §2.4 headline
 * instance's activity + model), and the instance ordering (most-active-first).
 * The webview renders what the host emits — it does NOT recompute the aggregate
 * or re-order (`architecture-overview`: host state is not duplicated webview-side).
 *
 * Source: team/iris-ux/multiagent-persona-tile-spec.md §1, §2, §5.1, §5.4.
 */
export interface MultiAgentPersonaTile {
  /** Discriminator — present only on this wrapper. */
  kind: "multi-agent-persona";
  /** Stable member id from the roster (e.g. "felix"). */
  memberId: string;
  /** Stable team id from the roster (e.g. "claudeteam-alpha"). */
  teamId: string;
  /** Display name from roster member.display (e.g. "Felix"). */
  display: string;
  /** Role label from roster member.role (e.g. "Extension Host Dev"). */
  role: string;
  /**
   * Aggregate liveness state computed from the per-instance states via
   * `computeAggregateState` (§2.1 precedence running > error > idle >
   * finished > available). The tile's single state dot + sprite pose key
   * off this value.
   */
  aggregateState: AgentState;
  /**
   * Headline activity string — the §2.4 headline instance's `activity`
   * (e.g. "tool:Edit reducer.ts"). One representative line so row 3 stays
   * single-line and skimmable; NOT a merge of all instances' tools.
   */
  headlineActivity: string;
  /**
   * Headline model string — the §2.4 headline instance's `model`
   * (e.g. "claude-opus-4-7" or the "model:?" sentinel).
   */
  headlineModel: string;
  /** Number of live instances; invariant `count === instances.length`. */
  count: number;
  /**
   * The per-instance tiles, ordered most-active-first (running → error →
   * idle → finished → available) with ties broken by `agentId` lexical
   * order for stable, flicker-free ordering across ticks. Each instance is
   * a full `AgentTile` carrying its own `agentId` + `sessionId` + state +
   * activity + finishedAtMs.
   */
  instances: AgentTile[];
  /**
   * Optional 6-digit lowercase hex color from the matched roster
   * `Member.color`. Painted on the RUNNING-aggregate state dot (overriding
   * the semantic token); idle/error/finished/available aggregates ignore it.
   * Mirrors `AgentTile.memberColor`. Absent when the member has no color set.
   */
  memberColor?: string;
}

/**
 * Entry in a team's tile list: a bare `AgentTile` (N=1 / baseline), a
 * `MultiAgentPersonaTile` wrapper (rostered N≥2 — option A, 86ca1d7er), or a
 * legacy `CollapsedPersonaGroup` wrapper (M3-10, retained for back-compat with
 * any non-rostered grouping path + transitional webview consumers; NOT emitted
 * by the reducer for rostered members anymore).
 */
export type RosterTileEntry =
  | AgentTile
  | MultiAgentPersonaTile
  | CollapsedPersonaGroup;

/**
 * Type-narrowing helper: is this entry a `MultiAgentPersonaTile` wrapper
 * (rostered N≥2, option A)? Discriminates on `kind === "multi-agent-persona"`.
 *
 * Pure / cheap — safe to call repeatedly during render or per-tick. Host-side
 * callers (reducer, filters, CLI flattener, diagnostics, integration tests)
 * AND the webview tile router import this from here (single source of truth,
 * no mirrored copy — per the M3-10 dual-copy lesson).
 *
 * LOCKED identifier per spec §5.4 vocabulary contract.
 */
export function isMultiAgentPersonaTile(
  entry: RosterTileEntry,
): entry is MultiAgentPersonaTile {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    (entry as { kind?: unknown }).kind === "multi-agent-persona"
  );
}

/**
 * Type-narrowing helper: discriminate a `RosterTileEntry` as a legacy
 * `CollapsedPersonaGroup` wrapper. The wrapper carries the
 * `kind: "collapsed-persona"` discriminator; bare `AgentTile`s have no
 * `kind` field, and `MultiAgentPersonaTile` carries a different `kind` value,
 * so the value check disambiguates all three.
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
 * Aggregate-state helper (LOCKED identifier per spec §5.4). Computes the
 * single headline state for a `MultiAgentPersonaTile` from its per-instance
 * states. Pure function over the instance array — no DOM, no clock,
 * idempotent. Host emit path + unit tests import from here.
 *
 * **LOCKED precedence (sponsor decision — running wins over error):**
 *
 *   running  >  error  >  idle  >  finished  >  available
 *
 * Evaluate top-down; the first tier with ≥1 matching instance is the aggregate.
 *   - `running` if ANY instance is running (the member is actively working —
 *     the headline the sponsor most wants to see, per option A's "one active
 *     presence" framing; a running sibling means the work isn't dead even if
 *     another instance errored).
 *   - else `error` if ANY instance errored (a call to action that must not hide
 *     behind a quiet idle/finished sibling — louder than idle/finished, quieter
 *     than running).
 *   - else `idle` if ANY instance is idle (alive-but-quiet; not "all done").
 *   - else `finished` if ALL remaining instances are finished (the only
 *     all-finished case — bottom of the "alive" tiers).
 *   - else `available` — the floor (no live instances at all; in practice
 *     unreachable when N≥2 since instances counts live agents, but defined for
 *     totality).
 *
 * Empty input: returns `available` (the floor). A `MultiAgentPersonaTile`
 * should never carry zero instances on the wire (reducer invariant: count≥2),
 * but `available` is the safe totality value rather than throwing.
 *
 * Differs from the retired M3-10 `computeGroupState` (`running > idle >
 * finished`, NO error tier) by INSERTING `error` between `running` and `idle`
 * (spec §2.3).
 *
 * Source: team/iris-ux/multiagent-persona-tile-spec.md §2.1, §5.4.
 */
export function computeAggregateState(instances: AgentTile[]): AgentState {
  let sawError = false;
  let sawIdle = false;
  let sawFinished = false;
  for (const inst of instances) {
    switch (inst.state) {
      case "running":
        // Highest tier — short-circuit, nothing outranks running.
        return "running";
      case "error":
        sawError = true;
        break;
      case "idle":
        sawIdle = true;
        break;
      case "finished":
        sawFinished = true;
        break;
      // "available" instances are not counted toward any tier — they are the
      // absence of a live agent and fall through to the floor.
    }
  }
  if (sawError) return "error";
  if (sawIdle) return "idle";
  if (sawFinished) return "finished";
  return "available";
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
   * (bare `AgentTile` for N=1 per-persona, `MultiAgentPersonaTile` wrapper for
   * rostered N≥2 — 86ca1dtr5, supersedes the M3-10 `CollapsedPersonaGroup`
   * which is retained in the union only for legacy / non-rostered paths).
   *
   * Consumers MUST discriminate via the `kind` field (`isMultiAgentPersonaTile`
   * / `isCollapsedPersonaGroup` type guards). Back-compat with pre-M3-10
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
   * Count of rostered agent tiles suppressed this tick because their
   * `(teamId, memberId)` is in the user's persisted hidden-member set
   * (E-06a / EPIC 86ca11187 §7.2 — reversible hide-agent). Used by the
   * webview header chip to render "N hidden — show". Optional for back-compat
   * with consumers that don't supply or read it; absent → treated as 0. See
   * `src/extension/state/hideMembersFilter.ts` for the producer.
   *
   * This count is driven by an explicit, persisted user action — it does NOT
   * change as agents transition between running/idle/finished. There is NO
   * auto-hide-by-time path that feeds this count (sponsor REJECTED auto-hide,
   * DECISIONS §36 — guarded by a regression test).
   */
  hiddenMemberCount?: number;
  /**
   * The persisted hidden-member set in effect this tick, as `HiddenMemberKey`
   * strings (`` `${teamId}:${memberId}` ``). E-06b (webview) renders the
   * "show hidden" recovery surface + per-member unhide affordance from this
   * list. Plain `string[]` — JSON-safe across the host↔webview boundary (a
   * `Set` would serialize to `{}`; see the wire-shape constraint in
   * `.claude/docs/vscode-extension-conventions.md`). Optional for back-compat;
   * absent → webview treats as empty array. Carries ALL hidden keys (even ones
   * whose member has no live tile this session) so the webview's "show hidden"
   * list is complete. Source: `src/extension/state/hideMembersFilter.ts`.
   */
  hiddenMemberKeys?: HiddenMemberKey[];
  /**
   * Count of rostered agent tiles suppressed this tick because their
   * `(teamId, memberId)` is in the user's persisted REMOVED-member set
   * (E-07a / EPIC 86ca11187 §7.3 — yaml-gated remove-agent). Diagnostic
   * tick-local count (parallel to `hiddenMemberCount`). Optional for
   * back-compat; absent → treated as 0. See
   * `src/extension/state/removeMembersFilter.ts` for the producer.
   *
   * UNLIKE hide, a removed member does NOT surface under "show hidden" — it is
   * suppressed from BOTH the default tree and the hidden-reveal set. There is
   * no in-UI un-remove; restore is yaml-gated (re-add to teams.yaml → the
   * reconcile path clears the removal record on the next roster reload).
   */
  removedMemberCount?: number;
  /**
   * The persisted removed-member set in effect this tick, as `RemovedMemberKey`
   * strings (`` `${teamId}:${memberId}` ``). E-07b (webview) consumes this to
   * know which members were explicitly removed (so it never offers an unhide /
   * show affordance for them). Plain `string[]` — JSON-safe (a `Set` would
   * serialize to `{}`). Optional for back-compat; absent → webview treats as
   * empty array. Source: `src/extension/state/removeMembersFilter.ts`.
   */
  removedMemberKeys?: RemovedMemberKey[];
  /**
   * Mirror of `claudeteam.*` config scalars relevant to the webview's
   * rendering (M5). The watcher reads these once per tick and stamps them
   * onto the produced tree so `serializeState` can pass through to the wire
   * without re-reading config. Optional for back-compat with the CLI driver
   * and older tests; absent → webview treats each field as `false`.
   * See `team/iris-ux/m5-hide-finished-spec.md` §3.5 Field B.
   */
  config?: {
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
  };
}

// =============================================================================
// Hidden-member set (E-06a / EPIC 86ca11187 §7.2 — reversible hide-agent).
// =============================================================================

/**
 * Stable key identifying ONE rostered member for the hide-agent feature.
 *
 * Composed from `teamId` + `memberId` (NOT `memberId` alone) because two teams
 * can declare a member with the same `id` (the roster loader already tolerates
 * cross-team id collisions — see `roster-matching.md` § Loader edge cases). A
 * member is identified for hide purposes by the (team, member) pair so hiding
 * "Felix on team A" never silently hides "Felix on team B".
 *
 * **String form:** `` `${teamId}:${memberId}` `` — JSON-safe primitive. Built /
 * parsed via `hiddenMemberKey()` / `parseHiddenMemberKey()` so the separator
 * convention lives in exactly one place. The set persists as a `string[]` in
 * VS Code `workspaceState` (host) and travels to the webview as a `string[]`
 * (`SerializedDashboardState.hiddenMemberKeys`) — never as a `Set` (Sets do not
 * round-trip JSON.stringify, per the wire-shape constraint in
 * `.claude/docs/vscode-extension-conventions.md`).
 *
 * Hide is intentionally NOT keyed by `agentId` / `sessionId` — it is a view
 * preference scoped to a roster member, applying wherever that member would
 * render across sessions (spec §7.2 "Scope"). A re-dispatched member keeps the
 * same (teamId, memberId), so the hide survives new agent ids.
 */
export type HiddenMemberKey = `${string}:${string}`;

/**
 * Build the canonical `HiddenMemberKey` string from a (teamId, memberId) pair.
 *
 * The separator is `:` — `teamId` and `memberId` are kebab-case roster ids
 * (`roster-matching.md` § schema), so a literal `:` never appears inside
 * either component and the split is unambiguous. Pure / cheap.
 */
export function hiddenMemberKey(
  teamId: string,
  memberId: string,
): HiddenMemberKey {
  return `${teamId}:${memberId}`;
}

/**
 * Parse a `HiddenMemberKey` back into its `teamId` / `memberId` components.
 * Splits on the FIRST `:` only (defensive — even though kebab-case ids never
 * contain `:`, splitting on the first separator is robust if a future id
 * convention does). Returns `null` when the string has no separator (malformed
 * key — caller decides whether to skip it).
 *
 * Pure / cheap. Exported for the webview's unhide affordance (E-06b) and tests.
 */
export function parseHiddenMemberKey(
  key: string,
): { teamId: string; memberId: string } | null {
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  return { teamId: key.slice(0, idx), memberId: key.slice(idx + 1) };
}

// =============================================================================
// Removed-member set (E-07a / EPIC 86ca11187 §7.3 — yaml-gated remove-agent).
// =============================================================================

/**
 * Stable key identifying ONE rostered member for the remove-agent feature.
 *
 * Same `` `${teamId}:${memberId}` `` shape as {@link HiddenMemberKey} — and for
 * the same reason (two teams may declare the same `member.id`, so a member is
 * identified for removal by the (team, member) PAIR). Built / parsed via
 * `removedMemberKey()` / `parseRemovedMemberKey()`. Persists as a `string[]` in
 * VS Code `workspaceState` (host) and travels to the webview as a `string[]`
 * (`SerializedDashboardState.removedMemberKeys`) — never as a `Set`.
 *
 * ## How remove differs from hide (the load-bearing distinction)
 *
 * Hide ({@link HiddenMemberKey}) is REVERSIBLE in-UI: a hidden member is
 * suppressed from the DEFAULT tree but resurfaces under the "show hidden"
 * recovery surface, and one click un-hides it.
 *
 * Remove is MORE PERMANENT (DECISIONS §30 / spec §7.3): a removed member is
 * suppressed from BOTH the default tree AND the hidden-reveal set — it does not
 * appear anywhere on the dashboard. There is deliberately NO in-UI un-remove
 * (no `ui:un-remove-member` message). Restore is YAML-gated only: re-adding the
 * member block to `teams.yaml` brings the tile back on the next roster reload,
 * via the reconcile path in `RemovedMembersStore.reconcile()` — see that store's
 * doc for the absent→present arm/reinstate semantics.
 *
 * A removed key is distinct in name (`RemovedMemberKey` vs `HiddenMemberKey`) so
 * the type system keeps the two sets from being accidentally crossed, even
 * though the runtime string shape is identical.
 */
export type RemovedMemberKey = `${string}:${string}`;

/**
 * Build the canonical `RemovedMemberKey` string from a (teamId, memberId) pair.
 * Mirror of {@link hiddenMemberKey}; the separator is `:`. Pure / cheap.
 */
export function removedMemberKey(
  teamId: string,
  memberId: string,
): RemovedMemberKey {
  return `${teamId}:${memberId}`;
}

/**
 * Parse a `RemovedMemberKey` back into its `teamId` / `memberId` components.
 * Splits on the FIRST `:` only (defensive — mirror of
 * {@link parseHiddenMemberKey}). Returns `null` on a separator-less key.
 *
 * Pure / cheap. Exported for the reconcile path and tests.
 */
export function parseRemovedMemberKey(
  key: string,
): { teamId: string; memberId: string } | null {
  const idx = key.indexOf(":");
  if (idx < 0) return null;
  return { teamId: key.slice(0, idx), memberId: key.slice(idx + 1) };
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
