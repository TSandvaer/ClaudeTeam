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

import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * Delimiters that end the role clause in a persona `.md` `description`
 * (86ca1nvae). Persona files lead with the role then continue into context, e.g.
 *   "Senior Developer #1 (extension host + data layer) on the ClaudeTeam ..."
 *   "QA / Tester on the ClaudeTeam project ..."
 *   "UX Designer on the ClaudeTeam project ..."
 * The earliest occurrence of any of these markers ends the title. " on the " /
 * " on " come before the project-context tail; " (" before a parenthetical;
 * sentence/clause punctuation handles the rest. Ordered longest-first only for
 * readability — the search takes the minimum index across all of them.
 */
const ROLE_CLAUSE_DELIMITERS: readonly string[] = [
  " on the ",
  " on ",
  " (",
  " — ",
  "—",
  ". ",
  "; ",
  ", ",
  ": ",
];

/** Max length of a derived role title — defensive cap for a pathological description. */
const MAX_DERIVED_ROLE_LEN = 60;

/**
 * Derive a short, obviously-overridable role title from a persona `.md`
 * frontmatter `description` (86ca1nvae). Takes the first clause — the substring
 * up to the earliest {@link ROLE_CLAUSE_DELIMITERS} marker — trims it, and caps
 * the length. Returns `""` when `description` is undefined / empty / whitespace,
 * so the caller can treat empty as "no role derived" (role stays OPTIONAL).
 *
 * Examples:
 *   "Senior Developer #1 (extension host...) on the ClaudeTeam ..." → "Senior Developer #1"
 *   "QA / Tester on the ClaudeTeam project ..."                     → "QA / Tester"
 *   "Project Lead on the ClaudeTeam project ..."                    → "Project Lead"
 *   undefined / "" / "   "                                          → ""
 *
 * Pure / cheap. Exported for unit coverage.
 */
export function deriveRoleFromDescription(
  description: string | undefined,
): string {
  if (description === undefined) return "";
  const trimmed = description.trim();
  if (trimmed.length === 0) return "";
  let cut = trimmed.length;
  for (const delim of ROLE_CLAUSE_DELIMITERS) {
    const idx = trimmed.indexOf(delim);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  const title = trimmed.slice(0, cut).trim();
  // Defensive: a description with no delimiter in the first MAX chars (e.g. a
  // single very long clause) gets capped so a fresh role isn't an essay.
  return title.length > MAX_DERIVED_ROLE_LEN
    ? title.slice(0, MAX_DERIVED_ROLE_LEN).trim()
    : title;
}

/**
 * Extract the `description` value from an agent `.md` file's YAML frontmatter
 * (86ca1nvae). Lightweight line-scan rather than a full YAML parse: the persona
 * files write `description:` as a single line (verified against the live
 * corpus), and we only need the one field. Returns `undefined` when there is no
 * frontmatter block or no `description:` key. Strips surrounding single/double
 * quotes from the value.
 *
 * Never throws — a read error / missing file yields `undefined` (the role just
 * stays empty; the scan must not fail because one `.md` couldn't be read).
 *
 * Exported for unit coverage.
 */
export function readAgentDescription(filePath: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  // Frontmatter is a leading `---` ... `---` block. Bail if absent.
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "---") break; // end of frontmatter — no description.
    const m = /^description:\s*(.*)$/.exec(line);
    if (m) {
      let value = m[1]!.trim();
      // Strip a single layer of matching surrounding quotes.
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
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
    const filePath = join(agentsDir, fileName);
    // 86ca1nvae: auto-derive a short role title from the `.md` frontmatter
    // `description`. Absent / empty derivation → omit the field (gen falls
    // back to an empty role). Only stamp a non-empty title.
    const role = deriveRoleFromDescription(readAgentDescription(filePath));
    scanned.push({
      agentName,
      filePath,
      ...(role.length > 0 ? { role } : {}),
    });
  }
  scanned.sort((a, b) => a.agentName.localeCompare(b.agentName));
  return scanned;
}
