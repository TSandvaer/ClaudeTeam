/**
 * Shared cwd-to-slug derivation.
 *
 * Maps a project working directory (`SessionRecord.cwd`) to the directory
 * slug used under `~/.claude/projects/`. Verified against on-disk directories
 * in `.claude/docs/data-sources.md` §2 "cwdToSlug rule".
 *
 * Examples (verified against real captures):
 *   c:\Trunk\PRIVATE\ClaudeTeam      → c--Trunk-PRIVATE-ClaudeTeam
 *   C:\Trunk\PRIVATE\Axelot-tutor    → C--Trunk-PRIVATE-Axelot-tutor
 *   c:\Trunk\PRIVATE\MARIAN-TUTOR    → c--Trunk-PRIVATE-MARIAN-TUTOR
 *
 * Rule:
 *   1. Strip the drive colon (e.g. `c:` → `c`).
 *   2. The first path separator after the drive letter becomes `--`.
 *   3. Every subsequent separator becomes `-`.
 *   4. POSIX paths (no drive letter) — replace all `/` with `-`; strip a
 *      leading `-` if any.
 *
 * Extracted from `src/cli/agentTree.ts` + `tests/integration/helpers/tempdir.ts`
 * per M1-09-followup (ClickUp 86c9y6e17) and M2-04 AC5. Both prior copies
 * import from here now; production code has a single source of truth.
 */

/**
 * Derive the project slug from a cwd path.
 *
 * Pure function — no I/O, no exceptions.
 */
export function cwdToSlug(cwd: string): string {
  // Match optional drive letter + colon, then path.
  const driveMatch = cwd.match(/^([a-zA-Z]):(.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1]!;
    const rest = driveMatch[2]!;
    // First separator after drive becomes `--`; subsequent ones become `-`.
    const restNorm = rest.replace(/^[/\\]/, "--").replace(/[/\\]/g, "-");
    return drive + restNorm;
  }
  // POSIX path: replace all `/` with `-`; strip any leading `-`.
  return cwd.replace(/\//g, "-").replace(/^-/, "");
}
