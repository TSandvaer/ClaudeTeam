#!/usr/bin/env node
/**
 * CLI entrypoint for the ClaudeTeam agent-tree command.
 *
 * Usage:
 *   node dist/cli/agentTree.js [--claude-home <path>] [--roster <path>]
 *
 * Reads the live ~/.claude/ tree (or the path supplied via --claude-home),
 * loads the roster (default: ~/.claudeteam/teams.yaml or --roster override),
 * reduces via buildAgentTree, and prints per the M1-03 spec.
 *
 * Exit codes:
 *   0 — always (empty state, parse errors, missing roster are all soft faults
 *       that print gracefully — per spec §1.7 and §5 divergence #5).
 *
 * AC2 of M1-09 (ClickUp 86c9y5chc): this file is the CLI entrypoint.
 * AC3 of M1-09: package.json scripts.agent-tree runs `node dist/cli/agentTree.js`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readActivity } from "../extension/watcher/subagentTailer.js";
import { listSessions } from "../extension/watcher/sessionRegistry.js";
import {
  formatMetaParseError,
  parseMetaFromString,
} from "../extension/watcher/metaJsonLoader.js";
import { loadRoster } from "../extension/roster/loader.js";
import { MetaParseError } from "../shared/types.js";
import { cwdToSlug } from "../shared/slug.js";
import {
  buildAgentTree,
  type ActivityMap,
  type AgentMetaEntry,
  type FinishedMap,
  type SessionAgentData,
} from "../extension/state/reducer.js";
import type { AgentTree, SessionTree, AgentTile, BackgroundAgent, Team } from "../shared/types.js";
import { isCollapsedPersonaGroup } from "../shared/types.js";

// =============================================================================
// CLI argument parsing
// =============================================================================

function parseArgs(argv: string[]): { claudeHome: string; rosterPath: string } {
  const args = argv.slice(2);
  let claudeHome = join(homedir(), ".claude");
  let rosterPath = join(homedir(), ".claudeteam", "teams.yaml");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--claude-home" && i + 1 < args.length) {
      claudeHome = args[++i]!;
    } else if (args[i] === "--roster" && i + 1 < args.length) {
      rosterPath = args[++i]!;
    }
  }
  return { claudeHome, rosterPath };
}

// =============================================================================
// Filesystem readers
// =============================================================================

/**
 * Single-pass parent-JSONL scan that extracts BOTH the session title
 * (`ai-title` record) and the finished `tool_use_id` → `finishedAtMs` map
 * in one `readFileSync` + one line iteration.
 *
 * 86c9zfmke: dedup of the previously separate `readSessionTitle` +
 * `readFinishedToolUseIds` passes — halves the disk read + JSON.parse
 * work per session per tick. Mirrors `readSessionMetadata` in
 * `src/extension/watcher/watcherLoop.ts`; both copies kept intentionally
 * identical (host vs CLI driver) per the same convention as
 * `collectAgentMetas`.
 *
 * ## Title (formerly `readSessionTitle`)
 *
 * Returns the first non-empty `title` field on a record with
 * `type: "ai-title"`. `null` on miss, malformed, or read error.
 *
 * ## Finished-ids (formerly `readFinishedToolUseIds`)
 *
 * Returns a map of `tool_use_id` → `finishedAtMs` (epoch ms parsed from
 * the record's top-level `timestamp` ISO-8601 field). Per data-sources.md
 * §3 the parent JSONL is the ONLY reliable "finished" signal; the child
 * JSONL never carries it.
 *
 * 86c9yxv94: timestamp flows through to `buildActivity` for the
 * `"finished Xs"` elapsed-time suffix; `0` sentinel when unparseable
 * (reducer falls back to bare `"finished"`).
 *
 * Obs 9 fix (86c9zc5dd): skip records whose top-level
 * `toolUseResult.isAsync === true` — those are background-dispatch
 * acknowledgments, not completion signals. See watcherLoop.ts copy for
 * full rationale + verified evidence.
 *
 * Defensive contracts: read error → `{ title: null, finishedIds: empty }`;
 * single-line JSON.parse failure → skip that line.
 */
function readSessionMetadata(jsonlPath: string): {
  title: string | null;
  finishedIds: Map<string, number>;
} {
  const finishedIds = new Map<string, number>();
  let title: string | null = null;
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return { title: null, finishedIds };
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const recType = rec["type"];

    // Title branch.
    if (recType === "ai-title" && title === null) {
      const t = rec["title"];
      if (typeof t === "string" && t.length > 0) title = t;
      continue;
    }

    // Finished-ids branch.
    if (recType !== "user") continue;
    // Obs 9: skip background-dispatch acknowledgments.
    const tur = rec["toolUseResult"];
    if (
      tur !== null &&
      typeof tur === "object" &&
      !Array.isArray(tur) &&
      (tur as Record<string, unknown>)["isAsync"] === true
    ) {
      continue;
    }
    const msg = rec["message"];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const content = (msg as Record<string, unknown>)["content"];
    if (!Array.isArray(content)) continue;
    const ts = rec["timestamp"];
    const finishedAtMs =
      typeof ts === "string" && Number.isFinite(Date.parse(ts))
        ? Date.parse(ts)
        : 0;
    for (const item of content) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>)["type"] === "tool_result"
      ) {
        const toolUseId = (item as Record<string, unknown>)["tool_use_id"];
        if (typeof toolUseId === "string" && !finishedIds.has(toolUseId)) {
          // First occurrence wins — that's when the subagent actually finished.
          finishedIds.set(toolUseId, finishedAtMs);
        }
      }
    }
  }
  return { title, finishedIds };
}

/**
 * Collect all subagent data for one session.
 * Reads meta.json for each agent, records parse errors gracefully.
 * Returns AgentMetaEntry[] (no filesystem calls for JSONL — those are async
 * and handled separately in collectActivities).
 */
function collectAgentMetas(subagentsDir: string): AgentMetaEntry[] {
  const entries: AgentMetaEntry[] = [];
  let files: string[];
  try {
    files = readdirSync(subagentsDir);
  } catch {
    return entries;
  }

  const metaFiles = files.filter((f) => f.endsWith(".meta.json"));
  for (const metaFile of metaFiles) {
    // agent-<id>.meta.json → agentId = <id>
    const agentId = metaFile.replace(/\.meta\.json$/, "").replace(/^agent-/, "");
    const metaPath = join(subagentsDir, metaFile);
    let raw: string;
    try {
      raw = readFileSync(metaPath, "utf8");
    } catch (err) {
      entries.push({ agentId, meta: null, parseError: `read error: ${(err as Error).message}` });
      continue;
    }
    try {
      const meta = parseMetaFromString(raw);
      entries.push({ agentId, meta });
    } catch (err) {
      // NIT #2 (M3-04 follow-up): format MetaParseError consistently with the
      // host watcher (collectAgentMetas in watcherLoop.ts). Non-MetaParseError
      // errors still fall through to `err.message` for diagnostic visibility.
      const parseError =
        err instanceof MetaParseError
          ? formatMetaParseError(err)
          : (err as Error).message;
      entries.push({ agentId, meta: null, parseError });
    }
  }
  return entries;
}

/**
 * Async: collect SubagentActivity for each agentId in a session.
 * Returns an ActivityMap (agentId → SubagentActivity).
 */
async function collectActivities(
  subagentsDir: string,
  agentIds: string[],
): Promise<ActivityMap> {
  const map: ActivityMap = new Map();
  await Promise.all(
    agentIds.map(async (agentId) => {
      const jsonlPath = join(subagentsDir, `agent-${agentId}.jsonl`);
      const activity = await readActivity(jsonlPath);
      map.set(agentId, activity);
    }),
  );
  return map;
}

// =============================================================================
// Main data collection
// =============================================================================

async function collect(claudeHome: string): Promise<{
  sessions: ReturnType<typeof listSessions>;
  agentData: SessionAgentData[];
  activities: ActivityMap;
  finishedIds: FinishedMap;
}> {
  const sessions = listSessions(claudeHome, { warn: (m) => process.stderr.write(m + "\n") });
  const projectsDir = join(claudeHome, "projects");

  const agentData: SessionAgentData[] = [];
  const allActivities: ActivityMap = new Map();
  const finishedIds: FinishedMap = new Map();

  for (const session of sessions) {
    const slug = cwdToSlug(session.cwd);
    const sessionDir = join(projectsDir, slug, session.sessionId);
    const subagentsDir = join(sessionDir, "subagents");
    const parentJsonlPath = join(projectsDir, slug, `${session.sessionId}.jsonl`);

    // 86c9zfmke: single-pass parent JSONL scan — fuses former
    // readSessionTitle + readFinishedToolUseIds into one read + one
    // line-iteration. See readSessionMetadata above.
    const { title: rawTitle, finishedIds: finishedToolUseIds } =
      readSessionMetadata(parentJsonlPath);
    const title = rawTitle ?? "(no title yet)";

    // Collect agent metas (sync).
    const agents = collectAgentMetas(subagentsDir);

    // Map toolUseIds → agentIds for the finishedIds map (keyed by agentId
    // per reducer contract; value = finishedAtMs sourced from the
    // tool_result record's timestamp).
    for (const agent of agents) {
      if (agent.meta?.toolUseId) {
        const finishedAtMs = finishedToolUseIds.get(agent.meta.toolUseId);
        if (finishedAtMs !== undefined) {
          finishedIds.set(agent.agentId, finishedAtMs);
        }
      }
    }

    // Collect activities (async).
    const sessionActivities = await collectActivities(
      subagentsDir,
      agents.map((a) => a.agentId),
    );
    for (const [agentId, activity] of sessionActivities) {
      allActivities.set(agentId, activity);
    }

    agentData.push({ sessionId: session.sessionId, agents, title });
  }

  return { sessions, agentData, activities: allActivities, finishedIds };
}

// =============================================================================
// Presenter — formats the AgentTree per the M1-03 spec
// =============================================================================

/** State glyph table per spec §2.1. Width is always 3 chars: [X]. */
function stateGlyph(state: "running" | "idle" | "finished" | "error"): string {
  switch (state) {
    case "running": return "[>]";
    case "idle":    return "[.]";
    case "finished":return "[v]";
    case "error":   return "[!]";
  }
}

/**
 * Pad or truncate a string to exactly `width` characters.
 * Truncation appends ".." (replacing the last 2 chars of the allowed width).
 * Padding with spaces on the RIGHT (left-aligned text).
 */
function pad(s: string, width: number): string {
  if (s.length > width) {
    return s.slice(0, width - 2) + "..";
  }
  return s.padEnd(width, " ");
}

/**
 * Format a single agent tile line per spec §1.4:
 *   [<state>] <display-7>  <role-15>  <activity-30>  <model>
 *
 * Two-space gaps between fields (per spec §1.4 "Two-space gap between fields").
 * Indent is 4 spaces under the team card (2 session + 2 team).
 */
function formatTileLine(tile: AgentTile, prefix: string = "    "): string {
  const glyph = stateGlyph(tile.state);
  const display = pad(tile.display, 7);
  const role = pad(tile.role, 15);
  const activity = pad(tile.activity, 30);
  const model = tile.model;
  return `${prefix}${glyph}  ${display}  ${role}  ${activity}  ${model}`;
}

/**
 * Format a background agent detail line per spec §1.6:
 *   <agentType-15>  "<description-35>"  <state>  <model>
 *
 * 8-space indent under the chip (4 session + 4 chip).
 */
function formatBackgroundLine(bg: BackgroundAgent): string {
  const agentType = pad(bg.agentType, 15);
  const desc = bg.description.length > 35
    ? bg.description.slice(0, 33) + ".."
    : bg.description;
  return `        - ${agentType}  "${desc}"  ${bg.state}  ${bg.model}`;
}

/**
 * Print the tree per the M1-03 spec §3.
 * Writes directly to stdout.
 *
 * AC3 (M1-09-followup): teamNameForId is built locally here and passed as a
 * parameter to printSession — no module-level mutable state. This keeps the
 * presenter reentrant and safe for M2's webview reuse of this module.
 */
function printTree(tree: AgentTree, roster: Team[]): void {
  const { sessions } = tree;

  if (sessions.length === 0) {
    // Per spec §1.7 empty-state.
    process.stdout.write("No live Claude Code sessions.\n");
    return;
  }

  // Build the team name lookup from the roster (passed in — no module-level state).
  const teamNameForId = new Map<string, string>(
    roster.map((t) => [t.id, t.name]),
  );

  for (const session of sessions) {
    printSession(session, teamNameForId);
    // Blank line between sessions (per spec §3 example).
    process.stdout.write("\n");
  }
}

function printSession(session: SessionTree, teamNameForId: Map<string, string>): void {
  const stateStr = session.isAlive ? "alive" : "dead";
  const header = `SESSION ${session.shortId}  [${session.entrypoint}]  pid=${session.pid}  v${session.version}  state=${stateStr}`;
  process.stdout.write(header + "\n");
  process.stdout.write(`  cwd:   ${session.cwd}\n`);
  process.stdout.write(`  title: ${session.title}\n`);

  // Dead sessions: per spec §3 example, no team cards, no background chip.
  // (session marked dead note + the note line)
  if (!session.isAlive) {
    process.stdout.write(`  (session marked dead; PID ${session.pid} no longer alive)\n`);
    return;
  }

  // Per spec §1.7 "sessions exist but roster missing/empty":
  const hasAnyTeam = session.teamOrder.length > 0;
  const hasAnyBackground = session.background.length > 0;

  if (!hasAnyTeam && !hasAnyBackground) {
    process.stdout.write(`  (no rostered teams matched; roster missing or empty)\n`);
    return;
  }

  if (!hasAnyTeam) {
    process.stdout.write(`  (no rostered teams matched; roster missing or empty)\n`);
  }

  // Print team cards.
  for (const teamId of session.teamOrder) {
    const entries = session.rosterTiles.get(teamId) ?? [];
    if (entries.length === 0) continue;

    // M3-10: flatten any CollapsedPersonaGroup wrappers back to per-spawn
    // AgentTile rows for the CLI. The CLI is a per-spawn inspection tool; the
    // dashboard (webview) is where the persona-name collapse is visually
    // useful. CLI also invokes buildAgentTree with `{ collapsePersonaTiles:
    // false }` below, so wrappers are not produced in practice — this flatten
    // is defense in depth for the type contract.
    const tiles: AgentTile[] = entries.flatMap((e) =>
      isCollapsedPersonaGroup(e) ? e.instances : [e],
    );

    const teamName = teamNameForId.get(teamId) ?? teamId;
    const bgCount = session.background.length;
    const teamHeader = `  TEAM ${teamName}  (${tiles.length} rostered, ${bgCount} background in this session)`;
    process.stdout.write(teamHeader + "\n");

    for (const tile of tiles) {
      process.stdout.write(formatTileLine(tile) + "\n");
    }
    process.stdout.write("\n");
  }

  // Background chip — AC4: singular vs plural guard.
  if (session.background.length > 0) {
    const count = session.background.length;
    const agentWord = count === 1 ? "agent" : "agents";
    process.stdout.write(`    + ${count} background ${agentWord} (this session)\n`);
    for (const bg of session.background) {
      process.stdout.write(formatBackgroundLine(bg) + "\n");
    }
  }
}

// =============================================================================
// Entry point
// =============================================================================

async function main(): Promise<void> {
  const { claudeHome, rosterPath } = parseArgs(process.argv);

  // Load roster.
  const rosterResult = loadRoster(rosterPath);

  // Emit roster warnings/errors to stderr (soft — still runs).
  for (const w of rosterResult.warnings) {
    process.stderr.write(`[roster warning] ${w}\n`);
  }
  for (const e of rosterResult.errors) {
    process.stderr.write(`[roster error] ${e}\n`);
  }

  // Collect filesystem data.
  const { sessions, agentData, activities, finishedIds } = await collect(claudeHome);

  // Check empty: no session files at all.
  if (sessions.length === 0) {
    process.stdout.write("No live Claude Code sessions.\n");
    process.exit(0);
  }

  // Build tree.
  // M3-10: CLI keeps per-spawn rows (one line per dispatch). The dashboard
  // is the surface where persona collapse is useful — `collapsePersonaTiles:
  // false` here disables wrapping so the CLI's row count stays predictable
  // (and matches `formatTileLine` semantics).
  const tree = buildAgentTree(
    sessions,
    agentData,
    activities,
    finishedIds,
    rosterResult.roster,
    Date.now(),
    { collapsePersonaTiles: false },
  );

  // Print.
  printTree(tree, rosterResult.roster);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[agent-tree error] ${(err as Error).message}\n`);
  process.exit(1);
});
