/**
 * `claudeteam.yaml` gen / read / write (TS-02 / team-setup epic,
 * Decisions 3, 4, 5).
 *
 * The NEW project-scoped roster file (`<workspace>/.claude/claudeteam.yaml`)
 * SUPERSEDES the dropped global `~/.claudeteam/teams.yaml`. The Manage Team
 * panel OWNS the format: this module performs a STRUCTURED, NORMALIZED write
 * (NOT a comment-preserving round-trip — Decision 5 / spec §4.3). Manual edits
 * to the file may be overwritten on the next panel save; that's the intended
 * contract surfaced in the panel's bottom hint.
 *
 * Three responsibilities:
 *   1. `generateStarterConfig(included)` — fresh {@link ClaudeTeamConfig} from
 *      the wizard-selected agent names (spec §3.2 fresh-member shape).
 *   2. `readClaudeTeamConfig(path)`      — read + validate via the zod schema;
 *      never throws (returns a discriminated result).
 *   3. `writeClaudeTeamConfig(path, cfg)` — normalized structured write
 *      (creates the parent `.claude/` dir if needed).
 *
 * Pure helpers (`generateStarterConfig`, `slugifyTeamId`, `serializeConfig`)
 * are exported for unit coverage; the I/O helpers are integration-tested
 * against a tempdir.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import yaml from "js-yaml";

import { claudeTeamConfigSchema } from "./schema.js";
import type {
  ClaudeTeamConfig,
  Member,
  Team,
} from "../../shared/types.js";

/** The current `claudeteam.yaml` schema version literal (matches the zod schema). */
export const CLAUDE_TEAM_CONFIG_VERSION = 1 as const;

/**
 * Header comment written at the top of every normalized `claudeteam.yaml`. Sets
 * the panel-owns-the-format expectation in the file itself (mirrors the panel's
 * bottom hint, spec §4.3). NOT round-tripped on read — re-emitted on every
 * write so it always reflects the current policy.
 */
const FILE_HEADER = `# claudeteam.yaml — project-scoped, panel-managed.
# Do NOT hand-edit while the Manage Team panel is open; the panel normalizes
# this file on save (structured write — comments below the header and manual
# formatting are not preserved). Use ClaudeTeam's "Manage Team" panel to edit.
`;

/**
 * Derive a stable kebab team id from a workspace folder name. Lowercases,
 * replaces any run of non-alphanumeric chars with a single `-`, trims leading/
 * trailing `-`. Empty / all-symbol input falls back to `"team"` so the id is
 * always a valid non-empty kebab string (schema requires `.min(1)`).
 *
 * Pure / cheap. Exported for unit coverage.
 */
export function slugifyTeamId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "team";
}

/**
 * Build a fresh, normalized starter {@link ClaudeTeamConfig} from the wizard's
 * included agent names (spec §3.2). Each included agent becomes a member with:
 *   - `id`        = the agent name (kebab, stable — equals the file stem).
 *   - `display`   = the agent name (seed; user renames in the panel).
 *   - `role`      = auto-derived from the agent `.md` `description` when a role
 *                   is supplied in `roles` (86ca1nvae); else `""` (lean OPTIONAL
 *                   — spec §7.3; renders "—"). User-overridable in the panel.
 *   - `character` = `null` (text-tile fallback until the user picks one).
 *   - `status`    = `"live"`.
 *   - `match`     = `[{ agentType_equals: <agentName> }]` (IMMUTABLE seed —
 *                   Decision 4; VERIFIED to match live agents, AC2).
 *
 * The single team's `name` seeds from `teamName` (the workspace folder name,
 * passed by the host); its `id` is `slugifyTeamId(teamName)`. Duplicate
 * `included` names are de-duplicated (first occurrence wins) so the schema's
 * within-team unique-id refine never trips on a doubled selection.
 *
 * @param included list of `ScannedAgent.agentName`s the user kept checked.
 * @param teamName seed for the team display name (default `"My Team"`).
 * @param roles    optional agentName → derived-role lookup (86ca1nvae). When a
 *                 name has a non-empty entry, the member seeds with that role;
 *                 absent / empty falls back to `""`. The host builds this from
 *                 the scanner's {@link ScannedAgent.role}.
 *
 * Pure function — no filesystem. Exported for unit coverage.
 */
export function generateStarterConfig(
  included: string[],
  teamName = "My Team",
  roles?: ReadonlyMap<string, string>,
): ClaudeTeamConfig {
  const seen = new Set<string>();
  const members: Member[] = [];
  for (const agentName of included) {
    if (seen.has(agentName)) continue;
    seen.add(agentName);
    const derived = roles?.get(agentName);
    members.push({
      id: agentName,
      display: agentName,
      // 86ca1nvae: seed the auto-derived role when present + non-empty; else
      // keep the lean empty default (role is OPTIONAL and user-overridable).
      role: derived !== undefined && derived.length > 0 ? derived : "",
      character: null,
      status: "live",
      match: [{ agentType_equals: agentName }],
    });
  }
  const team: Team = {
    id: slugifyTeamId(teamName),
    name: teamName,
    members,
  };
  return { version: CLAUDE_TEAM_CONFIG_VERSION, teams: [team] };
}

/**
 * Normalize a {@link ClaudeTeamConfig} into the canonical on-disk plain-object
 * shape, then serialize to YAML with the header comment prepended. The
 * normalization is deterministic (stable key order via the explicit object
 * construction below) so re-saving an unchanged config produces byte-identical
 * output — important for the "did the file actually change" diffing the drift
 * watcher and tests rely on.
 *
 * `character` / `status` are written explicitly (even when `null` / `"live"`)
 * so the file is self-describing and a re-read validates without falling back
 * on reader defaults. Optional `color` is included only when present.
 *
 * Pure function. Exported for unit coverage.
 */
export function serializeConfig(config: ClaudeTeamConfig): string {
  const normalized = {
    version: config.version,
    teams: config.teams.map((team) => ({
      id: team.id,
      name: team.name,
      ...(team.description !== undefined
        ? { description: team.description }
        : {}),
      members: team.members.map((m) => ({
        id: m.id,
        display: m.display,
        role: m.role ?? "",
        ...(m.color !== undefined ? { color: m.color } : {}),
        // character: explicit null when unassigned (text tile). Normalize
        // absent → null so the on-disk shape is always present + explicit.
        character: m.character ?? null,
        // status: default live when absent (a roster with no drift tracking).
        status: m.status ?? "live",
        match: m.match,
      })),
    })),
  };
  const body = yaml.dump(normalized, {
    // Stable, readable output: 2-space indent, no line wrapping of long values,
    // and keep insertion order (we already built the object in canonical order).
    indent: 2,
    lineWidth: -1,
    sortKeys: false,
  });
  return `${FILE_HEADER}${body}`;
}

/** Result of {@link readClaudeTeamConfig}. Never throws — every failure here. */
export type ReadConfigResult =
  | { ok: true; config: ClaudeTeamConfig }
  | { ok: false; error: string };

/**
 * Read + validate `claudeteam.yaml` at `path`. NEVER throws.
 *
 *   - file missing            → `{ ok: false, error: "<path> not found" }`.
 *   - read error              → `{ ok: false, error }`.
 *   - YAML parse error        → `{ ok: false, error }`.
 *   - schema validation fail  → `{ ok: false, error }` (first issue, with path).
 *   - empty/null file         → `{ ok: false, error }` (a config must have a
 *                               version; an empty file is not a valid config —
 *                               distinct from the legacy roster's empty-roster
 *                               tolerance, because detection treats absence vs
 *                               malformed differently).
 *   - valid                   → `{ ok: true, config }`.
 *
 * The returned `config` is the zod-validated value widened to the shared
 * {@link ClaudeTeamConfig} type — structurally compatible (the schema is the
 * runtime guard; the type is the compile-time contract).
 */
export function readClaudeTeamConfig(path: string): ReadConfigResult {
  if (!existsSync(path)) {
    return { ok: false, error: `claudeteam.yaml not found: ${path}` };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    return {
      ok: false,
      error: `claudeteam.yaml read error (${path}): ${(err as Error).message}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    return {
      ok: false,
      error: `claudeteam.yaml YAML parse error (${path}): ${(err as Error).message}`,
    };
  }
  if (parsed === null || parsed === undefined) {
    return { ok: false, error: `claudeteam.yaml is empty: ${path}` };
  }
  const validated = claudeTeamConfigSchema.safeParse(parsed);
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const where =
      issue && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    const message = issue?.message ?? "invalid config";
    return {
      ok: false,
      error: `claudeteam.yaml schema error at ${where}: ${message}`,
    };
  }
  // zod's MatchRule inference is Record<string, unknown> (the single-key refine
  // doesn't narrow statically); widen to the shared type — the runtime invariant
  // is enforced by the schema refines (mirrors loader.ts's documented narrowing).
  return { ok: true, config: validated.data as unknown as ClaudeTeamConfig };
}

/** Result of {@link writeClaudeTeamConfig}. Mirrors the `setup:config-saved` ack. */
export type WriteConfigResult = { ok: true } | { ok: false; error: string };

/**
 * Normalized structured write of `config` to `path` (Decision 5 / spec §4.3).
 * Creates the parent `.claude/` directory recursively if missing. NEVER throws
 * — filesystem failures surface as `{ ok: false, error }` so the caller can ack
 * `setup:config-saved { ok: false }` and the webview keeps the user's edits.
 *
 * NOT comment-preserving: the file is fully re-serialized from `config` via
 * {@link serializeConfig}. The panel owns the format.
 */
export function writeClaudeTeamConfig(
  path: string,
  config: ClaudeTeamConfig,
): WriteConfigResult {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, serializeConfig(config), { encoding: "utf8" });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `claudeteam.yaml write error (${path}): ${(err as Error).message}`,
    };
  }
}

/** Result of {@link clearClaudeTeamConfig}. Mirrors the `setup:config-saved` ack. */
export type ClearConfigResult = { ok: true } | { ok: false; error: string };

/**
 * Remove the `claudeteam.yaml` at `path` (86ca1u0rw — "Reset team setup").
 * IDEMPOTENT: an already-absent file is treated as a SUCCESS (`rmSync` with
 * `force: true` does not throw on ENOENT) — the post-condition the caller wants
 * ("no config exists") holds either way. NEVER throws — a real filesystem
 * failure (e.g. EPERM / EBUSY on a locked file) surfaces as `{ ok: false,
 * error }` so the caller can ack `setup:config-saved { ok: false }` and leave
 * the panel where it is.
 *
 * After this returns ok, `existsSync(path)` is false, the roster watcher's
 * next `loadRoster` yields an empty roster (→ empty `roster:loaded` → the
 * Manage Team panel's `manageConfig` becomes null → wizard layout), and the
 * detection state flips off `configured`.
 */
export function clearClaudeTeamConfig(path: string): ClearConfigResult {
  try {
    rmSync(path, { force: true });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `claudeteam.yaml clear error (${path}): ${(err as Error).message}`,
    };
  }
}
