/**
 * Agents-folder scanner (TS-02 / team-setup epic, Decision 2 / spec §3.1).
 *
 * Reads `<workspace>/.claude/agents/*.md` and produces one {@link ScannedAgent}
 * per persona agent file. The scan result drives:
 *   - the detection trichotomy (≥2 agents → suggest-setup; <2 → empty) — see
 *     `detection.ts`.
 *   - the setup wizard's include/exclude list (spec §3.1).
 *   - the drift watcher's removal detection (`agentWatcher.ts`).
 *
 * ## `agentName` == `meta.agentType` (AC2 — VERIFIED)
 *
 * The `agentName` is the filename STEM (`felix.md` → `"felix"`). This was
 * VERIFIED against live captures on 2026-05-29: every persona-dispatched
 * sub-agent's `meta.json` carries `agentType` equal to the agent-file stem
 * (e.g. `{"agentType":"felix",...}` ← `felix.md`; `{"agentType":"sage",...}` ←
 * `sage.md`). The per-dispatch slug lives in the `name` field
 * (`"felix-pr121"`), NOT `agentType`. This is WHY the starter config can seed
 * `match: [{ agentType_equals: agentName }]` and have it match live agents
 * with no separate mapping (backlog Grounding + Decision 4). See the PR body
 * for the full evidence dump.
 *
 * ## Non-persona file exclusion
 *
 * `.claude/agents/` also holds NON-agent markdown (`TEAM.md`,
 * `dispatch-template.md`) — convention docs the orchestrator authored, NOT
 * dispatchable personas. These are EXCLUDED by the {@link isPersonaAgentFile}
 * filter so they never enter `ScannedAgent[]` (and thus never become roster
 * members). The rule: a persona agent file is a lowercase-kebab `.md` filename
 * whose stem contains no uppercase letters. `TEAM.md` (uppercase) and
 * `dispatch-template.md` (template, but lowercase) are handled by an explicit
 * skip-list PLUS the uppercase heuristic. Documented + tested so adding a new
 * non-persona doc to the folder doesn't silently roster it.
 *
 * ## Orchestrator-not-a-tile (Decision 6 / spec §6.2)
 *
 * The orchestrator (main Claude Code session) has NO agent file under
 * `.claude/agents/`, so it never appears in `ScannedAgent[]` — the
 * orchestrator-not-a-tile constraint holds by construction, no filter needed.
 *
 * I/O: synchronous `fs` reads (mirrors the loader). Never throws — a missing
 * folder / read error yields an empty list (the empty-state path is valid).
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import type { ScannedAgent } from "../../shared/types.js";

/**
 * Filenames under `.claude/agents/` that are convention docs, NOT dispatchable
 * personas. Excluded from the scan regardless of casing. Kept as an explicit
 * list (in addition to the uppercase heuristic) so a lowercase template file
 * like `dispatch-template.md` is reliably skipped.
 */
const NON_PERSONA_FILES: ReadonlySet<string> = new Set([
  "team.md",
  "dispatch-template.md",
  "readme.md",
]);

/**
 * Is `fileName` (e.g. `"felix.md"`) a dispatchable persona agent file?
 *
 * A persona agent file:
 *   - ends in `.md` (case-insensitive),
 *   - has a non-empty stem,
 *   - is NOT in {@link NON_PERSONA_FILES},
 *   - has a stem with NO uppercase letters (orchestration docs like `TEAM.md`
 *     are conventionally UPPERCASE; persona slugs are lowercase-kebab and equal
 *     the runtime `meta.agentType`, which is always lowercase).
 *
 * Pure / cheap. Exported for unit coverage.
 */
export function isPersonaAgentFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".md")) return false;
  const stem = fileName.slice(0, fileName.length - ".md".length);
  if (stem.length === 0) return false;
  if (NON_PERSONA_FILES.has(lower)) return false;
  // Persona slugs are lowercase-kebab (they equal the lowercase runtime
  // `meta.agentType`). An uppercase letter in the stem flags a convention doc.
  if (stem !== stem.toLowerCase()) return false;
  return true;
}

/**
 * Resolve the agents-folder path for a workspace folder. The host passes the
 * first workspace folder's fsPath (multi-root = first folder only, ratify
 * default — spec §7.4). Returns `<workspaceFolder>/.claude/agents`.
 *
 * Exported so the drift watcher (`agentWatcher.ts`) and `main.ts` agree on the
 * exact path with no duplicated `join` logic.
 */
export function resolveAgentsDir(workspaceFolderPath: string): string {
  return join(workspaceFolderPath, ".claude", "agents");
}

/**
 * Scan `<agentsDir>/*.md` → `ScannedAgent[]`, excluding non-persona docs.
 *
 * @param agentsDir absolute path to the `.claude/agents` directory (resolve via
 *                  {@link resolveAgentsDir}).
 * @returns one {@link ScannedAgent} per persona `.md` file, sorted by
 *          `agentName` for stable output. Empty array when the folder is
 *          absent or unreadable (NOT an error — the empty-state path is valid).
 *
 * `filePath` is the ABSOLUTE path to the `.md` file (the host's call,
 * documented here per the type's `filePath` doc). The wizard shows the
 * basename muted; the drift watcher uses the path for removal detection.
 */
export function scanAgentsFolder(agentsDir: string): ScannedAgent[] {
  if (!existsSync(agentsDir)) {
    return [];
  }
  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    // Folder vanished mid-read or permission denied — treat as no agents.
    return [];
  }
  const scanned: ScannedAgent[] = [];
  for (const fileName of entries) {
    if (!isPersonaAgentFile(fileName)) continue;
    const agentName = fileName.slice(0, fileName.length - ".md".length);
    scanned.push({ agentName, filePath: join(agentsDir, fileName) });
  }
  scanned.sort((a, b) => a.agentName.localeCompare(b.agentName));
  return scanned;
}
