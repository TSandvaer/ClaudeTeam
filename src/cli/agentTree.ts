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
import { parseMetaFromString } from "../extension/watcher/metaJsonLoader.js";
import { loadRoster } from "../extension/roster/loader.js";
import {
  buildAgentTree,
  type ActivityMap,
  type AgentMetaEntry,
  type FinishedSet,
  type SessionAgentData,
} from "../extension/state/reducer.js";
import type { AgentTree, SessionTree, AgentTile, BackgroundAgent } from "../shared/types.js";

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
 * Derive the project slug from a cwd path.
 *
 * Verified against on-disk directories (data-sources.md §2):
 *   "c:\Trunk\PRIVATE\ClaudeTeam" → "c--Trunk-PRIVATE-ClaudeTeam"
 *
 * Rule (observed from real captures):
 *   - Remove the drive colon (e.g. "c:" → "c")
 *   - Replace each backslash or forward slash with "-" (single dash)
 *   - The first separator between drive letter and first component is "--" (double dash)
 *
 * Observed examples:
 *   c:\Trunk\PRIVATE\ClaudeTeam      → c--Trunk-PRIVATE-ClaudeTeam
 *   C:\Trunk\PRIVATE\Axelot-tutor    → C--Trunk-PRIVATE-Axelot-tutor
 *   c:\Trunk\PRIVATE\MARIAN-TUTOR    → c--Trunk-PRIVATE-MARIAN-TUTOR
 *
 * Pattern: drive letter + "--" + rest of path with "\" replaced by "-".
 * The drive colon is dropped; the first backslash becomes "--"; subsequent
 * separators become "-".
 */
function cwdToSlug(cwd: string): string {
  // Match optional drive letter + colon, then path
  const driveMatch = cwd.match(/^([a-zA-Z]):(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1]!;
    const rest = driveMatch[2]!;
    // First separator (the one right after drive+colon) becomes "--"
    // Subsequent separators become "-"
    // rest starts with \ or / — replace that first one with "--", rest with "-"
    const restNorm = rest.replace(/^[/\\]/, "--").replace(/[/\\]/g, "-");
    return drive + restNorm;
  }
  // POSIX path (no drive letter) — just replace all / with -
  return cwd.replace(/\//g, "-").replace(/^-/, "");
}

/**
 * Read the `ai-title` record from a parent JSONL.
 * Returns null when not found or on any read error.
 */
function readSessionTitle(jsonlPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec["type"] === "ai-title") {
        const title = rec["title"];
        if (typeof title === "string" && title.length > 0) return title;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Scan the parent JSONL for `tool_result` entries that close a subagent spawn.
 * A tool_result closing a subagent has `tool_use_id` matching the subagent's
 * `meta.toolUseId`. We collect the toolUseId values of all found results.
 *
 * Per data-sources.md §3 "JSONL closing semantics": the parent JSONL is the
 * ONLY reliable "finished" signal. The child JSONL never carries it.
 *
 * Returns a Set of toolUseIds that have been completed.
 */
function readFinishedToolUseIds(jsonlPath: string): Set<string> {
  const finished = new Set<string>();
  let raw: string;
  try {
    raw = readFileSync(jsonlPath, "utf8");
  } catch {
    return finished;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (rec["type"] !== "user") continue;
      const msg = rec["message"];
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
      const content = (msg as Record<string, unknown>)["content"];
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          (item as Record<string, unknown>)["type"] === "tool_result"
        ) {
          const toolUseId = (item as Record<string, unknown>)["tool_use_id"];
          if (typeof toolUseId === "string") {
            finished.add(toolUseId);
          }
        }
      }
    } catch {
      continue;
    }
  }
  return finished;
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
      entries.push({ agentId, meta: null, parseError: (err as Error).message });
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
  finishedIds: FinishedSet;
}> {
  const sessions = listSessions(claudeHome, { warn: (m) => process.stderr.write(m + "\n") });
  const projectsDir = join(claudeHome, "projects");

  const agentData: SessionAgentData[] = [];
  const allActivities: ActivityMap = new Map();
  const finishedIds: FinishedSet = new Set();

  for (const session of sessions) {
    const slug = cwdToSlug(session.cwd);
    const sessionDir = join(projectsDir, slug, session.sessionId);
    const subagentsDir = join(sessionDir, "subagents");
    const parentJsonlPath = join(projectsDir, slug, `${session.sessionId}.jsonl`);

    // Read title from parent JSONL.
    const title = readSessionTitle(parentJsonlPath) ?? "(no title yet)";

    // Read finished toolUseId set from parent JSONL.
    const finishedToolUseIds = readFinishedToolUseIds(parentJsonlPath);

    // Collect agent metas (sync).
    const agents = collectAgentMetas(subagentsDir);

    // Map toolUseIds → agentIds for the finishedIds set.
    // finishedIds uses agentId as the key (not toolUseId), per reducer contract.
    for (const agent of agents) {
      if (agent.meta?.toolUseId && finishedToolUseIds.has(agent.meta.toolUseId)) {
        finishedIds.add(agent.agentId);
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
 */
function printTree(tree: AgentTree): void {
  const { sessions } = tree;

  if (sessions.length === 0) {
    // Per spec §1.7 empty-state.
    process.stdout.write("No live Claude Code sessions.\n");
    return;
  }

  for (const session of sessions) {
    printSession(session);
    // Blank line between sessions (per spec §3 example).
    process.stdout.write("\n");
  }
}

function printSession(session: SessionTree): void {
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
    const tiles = session.rosterTiles.get(teamId) ?? [];
    if (tiles.length === 0) continue;

    // Team card header — need team display name. We have teamId; look it up
    // from the tiles (all tiles in the same team share teamId, and we have
    // the roster available only via tiles). Use a helper that the presenter
    // receives via closure.
    const teamName = teamNameForId.get(teamId) ?? teamId;
    const bgCount = session.background.length;
    const header = `  TEAM ${teamName}  (${tiles.length} rostered, ${bgCount} background in this session)`;
    process.stdout.write(header + "\n");

    for (const tile of tiles) {
      process.stdout.write(formatTileLine(tile) + "\n");
    }
    process.stdout.write("\n");
  }

  // Background chip.
  if (session.background.length > 0) {
    process.stdout.write(`    + ${session.background.length} background agents (this session)\n`);
    for (const bg of session.background) {
      process.stdout.write(formatBackgroundLine(bg) + "\n");
    }
  }
}

// Team name lookup — populated from the roster before printing.
// Using a module-level map avoids threading the roster all the way into every
// printSession call (the presenter doesn't need the full roster for anything else).
const teamNameForId = new Map<string, string>();

// =============================================================================
// Entry point
// =============================================================================

async function main(): Promise<void> {
  const { claudeHome, rosterPath } = parseArgs(process.argv);

  // Load roster.
  const rosterResult = loadRoster(rosterPath);

  // Populate teamNameForId for the presenter.
  for (const team of rosterResult.roster) {
    teamNameForId.set(team.id, team.name);
  }

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
  const tree = buildAgentTree(sessions, agentData, activities, finishedIds, rosterResult.roster);

  // Print.
  printTree(tree);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[agent-tree error] ${(err as Error).message}\n`);
  process.exit(1);
});
