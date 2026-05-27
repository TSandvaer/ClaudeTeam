// Roster loader — reads teams.yaml from global + per-project locations,
// validates with Zod, merges (project overrides global by member id), and
// returns a RosterLoadResult with warnings + errors. NEVER throws — every
// failure mode lands in the result.
//
// Per-project override semantics (per .claude/docs/roster-matching.md):
//   - Both files have a `teams[]` list. Merge happens at the MEMBER level
//     within matching teams (by `team.id`).
//   - Global team with id X + project team with id X → MEMBERS from project
//     override MEMBERS from global by `member.id`. Project-only teams are
//     appended at the end of the merged list. Global-only teams stay intact.
//   - Cross-team duplicate member ids → warning, second-wins by load order
//     (matches the documented "Same id in two teams" rule in roster-matching.md
//     § "Loader edge cases").
//
// Error vs warning policy:
//   - Errors  → the file (or one of them) failed to parse / validate. The
//                returned roster may still be partially populated (e.g. the
//                global loaded but the project failed → roster is the global).
//   - Warnings → recoverable degradations (missing file, member with no
//                match rules skipped, duplicate id second-wins, etc.).
//
// I/O: synchronous fs reads. V1 calls this on every CLI invocation; M2 will
// add a file-watcher around it, but the loader itself stays sync (a watcher
// debounces; the loader is the one-shot reader).

import { existsSync, readFileSync } from "node:fs";
import yaml from "js-yaml";

import { rosterFileSchema } from "./schema.js";
import type { MatchRule, Member, RosterLoadResult, Team } from "../../shared/types.js";

interface ParseFileResult {
  teams: Team[] | null;
  warnings: string[];
  errors: string[];
}

/**
 * Validate and normalize a raw `member.color` value from YAML (spec 86c9zmyef §2.6).
 *
 * Rules:
 *   - Absent / `undefined`            → `undefined` (no warning).
 *   - 6-digit hex with leading `#`    → lowercased pass-through (`"#5d8aa8"`).
 *   - 3-digit hex with leading `#`    → expanded to 6-digit lowercase
 *                                       (`"#5da"` → `"#55ddaa"` per sponsor Q4).
 *   - Anything else                   → `undefined` + a warning string pushed
 *                                       onto the caller's warnings list.
 *
 * `#` is mandatory — sponsor-supplied colors without a leading `#` (e.g.
 * `"5d8aa8"`, `"reddish"`, `"rgb(...)"`) are rejected and the field is
 * dropped. The webview default semantic running color paints in their place.
 *
 * Pure function. Exported for unit-test coverage.
 */
export function normalizeMemberColor(
  raw: string | undefined,
  context: { teamId: string; memberId: string },
  warnings: string[],
): string | undefined {
  if (raw === undefined) return undefined;

  // 6-digit hex: #RRGGBB (case-insensitive). Lowercased pass-through.
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }

  // 3-digit hex: #RGB → expand to #RRGGBB (sponsor Q4, accept + normalize).
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1]!;
    const g = raw[2]!;
    const b = raw[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  // Invalid — drop with warning. Verbatim raw value preserved for the
  // sponsor to spot the typo without re-reading the YAML.
  warnings.push(
    `team "${context.teamId}" member "${context.memberId}": invalid color "${raw}" — expected 6-digit hex with leading '#' (e.g. "#5d8aa8") or 3-digit hex (e.g. "#5da"). Falling back to default running color.`,
  );
  return undefined;
}

/**
 * Parse a single teams.yaml file. Missing file → warning + empty result;
 * malformed YAML → error + empty result; schema rejection → error + empty.
 */
function parseFile(path: string | undefined, label: "global" | "project"): ParseFileResult {
  const result: ParseFileResult = { teams: null, warnings: [], errors: [] };

  if (!path) {
    return result;
  }

  if (!existsSync(path)) {
    result.warnings.push(`${label} roster file not found: ${path}`);
    return result;
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    result.errors.push(`${label} roster read error (${path}): ${(err as Error).message}`);
    return result;
  }

  let parsed: unknown;
  try {
    // js-yaml.load returns `unknown` (any in older types). We immediately
    // pass it through Zod validation, so the unknown narrows safely.
    parsed = yaml.load(raw);
  } catch (err) {
    result.errors.push(`${label} roster YAML parse error (${path}): ${(err as Error).message}`);
    return result;
  }

  // Treat null/empty file as empty roster (not an error).
  if (parsed === null || parsed === undefined) {
    result.warnings.push(`${label} roster file is empty: ${path}`);
    result.teams = [];
    return result;
  }

  const validated = rosterFileSchema.safeParse(parsed);
  if (!validated.success) {
    // Zod's error.issues has path + message — collapse to a single string per issue
    // for surfaceability in the dashboard error chip.
    for (const issue of validated.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      result.errors.push(`${label} roster schema error at ${where}: ${issue.message}`);
    }
    return result;
  }

  // Validate that members each have at least one match rule (already enforced
  // by schema.ts via `.min(1)`, but if we ever relax to allow zero we'd emit
  // a warning here and skip the member instead of crashing). Schema-level
  // .min(1) is the source of truth in V1.
  //
  // Narrowing: the Zod schema models match rules as Record<string, unknown>
  // with runtime refines for single-key + recognized-key + string value.
  // The refines guarantee the shape conforms to the MatchRule union, but
  // Zod's type inference doesn't carry the refinement into the static type.
  // We narrow with `as` here because the runtime invariant is enforced above.
  result.teams = validated.data.teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    members: t.members.map(
      (m): Member => ({
        id: m.id,
        display: m.display,
        role: m.role,
        // 86c9zq9vm (spec 86c9zmyef §2.6): validate + normalize the
        // sponsor-supplied color to 6-digit lowercase hex with `#`. 3-digit
        // shorthand expands; invalid formats drop the field and push a
        // warning onto this file's warnings list (surfaced by the loader's
        // RosterLoadResult and the M3-04 chip).
        color: normalizeMemberColor(
          m.color,
          { teamId: t.id, memberId: m.id },
          result.warnings,
        ),
        match: m.match as unknown as MatchRule[],
      }),
    ),
  }));
  return result;
}

/**
 * Merge project members into the global roster by team.id then member.id.
 * Project members override global members of the same id within the same team.
 * Project-only teams are appended; global-only teams stay intact.
 * Cross-team duplicate member ids (NOT within a single team — that's a schema
 * error) trigger a warning, second-wins.
 */
function mergeRosters(
  globalTeams: Team[],
  projectTeams: Team[],
): { merged: Team[]; warnings: string[] } {
  const warnings: string[] = [];
  const merged: Team[] = [];
  const projectById = new Map(projectTeams.map((t) => [t.id, t]));
  const consumedProjectIds = new Set<string>();

  // Process global teams first, overlaying project members by id.
  for (const gTeam of globalTeams) {
    const pTeam = projectById.get(gTeam.id);
    if (!pTeam) {
      merged.push(gTeam);
      continue;
    }
    consumedProjectIds.add(gTeam.id);

    // Override members from project; preserve global member declaration order
    // for those NOT overridden; append project-only members at the end.
    const pMembersById = new Map(pTeam.members.map((m) => [m.id, m]));
    const consumedPMemberIds = new Set<string>();
    const overlaidMembers: Member[] = [];

    for (const gMember of gTeam.members) {
      const pMember = pMembersById.get(gMember.id);
      if (pMember) {
        overlaidMembers.push(pMember);
        consumedPMemberIds.add(gMember.id);
      } else {
        overlaidMembers.push(gMember);
      }
    }

    // Append project-only members.
    for (const pMember of pTeam.members) {
      if (!consumedPMemberIds.has(pMember.id)) {
        overlaidMembers.push(pMember);
      }
    }

    merged.push({
      id: gTeam.id,
      name: pTeam.name,
      description: pTeam.description ?? gTeam.description,
      members: overlaidMembers,
    });
  }

  // Append project-only teams (not in global) — declaration order from project.
  for (const pTeam of projectTeams) {
    if (!consumedProjectIds.has(pTeam.id)) {
      merged.push(pTeam);
    }
  }

  // Cross-team duplicate member ids → warning, second-wins by load order.
  // Per the doc: "the second one wins by load order, and a warning is logged."
  // Note: the matcher walks in declaration order and returns on first match,
  // so in practice the FIRST occurrence wins for matching. The "second-wins"
  // language in the doc refers to the conceptual id-mapping table — we emit
  // a warning so the sponsor knows their roster is ambiguous.
  const memberIdToTeam = new Map<string, string>();
  for (const team of merged) {
    for (const member of team.members) {
      const prevTeam = memberIdToTeam.get(member.id);
      if (prevTeam !== undefined && prevTeam !== team.id) {
        warnings.push(
          `duplicate member id "${member.id}" across teams "${prevTeam}" and "${team.id}" — second wins by load order`,
        );
      } else if (prevTeam === undefined) {
        memberIdToTeam.set(member.id, team.id);
      }
    }
  }

  return { merged, warnings };
}

/**
 * Load and merge the global + per-project roster YAML.
 *
 * @param globalPath  optional path to ~/.claudeteam/teams.yaml (or override)
 * @param projectPath optional path to <project>/.claude/teams.yaml
 * @returns RosterLoadResult with merged roster, accumulated warnings, errors.
 *
 * Both args optional → returns `{ roster: [], warnings: ["no roster paths provided"], errors: [] }`.
 * Only one provided → loads that one; the other is treated as absent (no warning).
 */
export function loadRoster(
  globalPath?: string,
  projectPath?: string,
): RosterLoadResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!globalPath && !projectPath) {
    warnings.push("no roster paths provided");
    return { roster: [], warnings, errors };
  }

  const globalResult = parseFile(globalPath, "global");
  warnings.push(...globalResult.warnings);
  errors.push(...globalResult.errors);

  const projectResult = parseFile(projectPath, "project");
  warnings.push(...projectResult.warnings);
  errors.push(...projectResult.errors);

  const globalTeams = globalResult.teams ?? [];
  const projectTeams = projectResult.teams ?? [];

  const { merged, warnings: mergeWarnings } = mergeRosters(globalTeams, projectTeams);
  warnings.push(...mergeWarnings);

  return { roster: merged, warnings, errors };
}
