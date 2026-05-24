/**
 * `claudeteam.openRoster` command (M3-02).
 *
 * Resolves the global roster path (config override or `~/.claudeteam/teams.yaml`),
 * auto-creates the parent directory + a starter YAML stub if the file is
 * missing, and opens the file in VS Code's native editor via
 * `vscode.window.showTextDocument`.
 *
 * ## Rationale (PR #32 §Q1 verdict)
 *
 * VS Code's native Settings UI silently degrades to "Edit in settings.json"
 * for any `contributes.configuration` property whose schema is an
 * `array<object>` with further nested arrays — our roster (`teams[].members[]`
 * with nested `match[]` arrays) falls squarely into that bucket. The
 * canonical roster-edit surface for ClaudeTeam is therefore the user's own
 * YAML editor in VS Code, NOT a custom webview form. See
 * `.claude/docs/vscode-extension-conventions.md` §"Extension manifest
 * essentials" (the "Why `configuration` lists only scalars" paragraph) for
 * the full reasoning and the cited Claude Code extension prior art.
 *
 * Paired with M3-01's live YAML hot-reload watcher: the user invokes
 * `ClaudeTeam: Open Roster`, edits the file, saves, and the dashboard tiles
 * update within ~1s with no `Reload Window` required.
 *
 * ## NIT #3 absorption (Maya's M3-01 peer-review)
 *
 * M3-01's `rosterWatcher.registerDirWatcher` performs an
 * `existsSync(dir)` → `createFileSystemWatcher(...)` pair with no atomic
 * guard against the directory being deleted between the two calls. Maya's
 * review (PR #35 comment 4528643161 NIT #3) flagged the race. The fix
 * adopted by this command is upstream: auto-create `~/.claudeteam/` AND
 * a starter `teams.yaml` when the user invokes `openRoster`. After that
 * point the directory is on disk, the watcher's existsSync→createWatcher
 * pair sees a stable directory, and the race cannot fire in normal use.
 *
 * The race is not eliminated in adversarial conditions (the user deletes
 * `~/.claudeteam/` while VS Code is running) — but that path already
 * requires a Reload Window per M3-01's documented behavior. NIT #3 is
 * closed.
 *
 * ## Auto-create behavior (AC3 / AC4)
 *
 * When the resolved roster path does NOT exist:
 *   1. `fs.mkdirSync(dirname(path), { recursive: true })` creates the
 *      parent directory tree.
 *   2. A starter YAML stub is written. The stub is valid YAML
 *      (`teams: []` is the minimum legal roster — `loader.ts` accepts it).
 *   3. The stub includes leading `#` comments documenting the schema
 *      from `.claude/docs/roster-matching.md` §"Roster YAML schema" plus
 *      a commented-out ClaudeTeam personas worked example
 *      (Felix / Maya / Nora / Iris / Sage / Bram). User uncomments to
 *      enable. Rationale: dogfooding our own roster, sponsor immediately
 *      sees what a real config looks like.
 *
 * When the file already exists: no write. The file is opened unchanged.
 * (Sponsor's hand-authored roster is never clobbered.)
 *
 * ## Per-project rosters (OOS for this PR)
 *
 * Per-project rosters at `<workspace>/.claude/teams.yaml` are NOT auto-
 * created by this command. The sponsor creates per-project rosters
 * manually when they want a project-scoped override. AC4 in the backlog
 * explicitly scopes auto-create to the global path only.
 *
 * Source: team/nora-pl/milestone-3-backlog.md §M3-02
 *         team/bram-research/m3-prior-art-2026-05-24.md §Q1
 *         .claude/docs/roster-matching.md §"Roster YAML schema"
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import * as vscode from "vscode";

/**
 * The starter YAML stub written when no roster file exists at the resolved
 * path. The stub is exported for the test suite to verify the contents on
 * auto-create.
 *
 * Layout discipline:
 *   - Top block: header comment + 1-line "what this file is".
 *   - Middle block: schema documentation (cribbed from
 *     `.claude/docs/roster-matching.md` §"Roster YAML schema").
 *   - Bottom block: commented-out ClaudeTeam personas example. Users
 *     uncomment a member to enable that roster entry.
 *   - Trailing live YAML: `teams: []` — valid empty roster. The loader
 *     accepts this; the dashboard renders the background-agents chip only
 *     until the user uncomments at least one member.
 */
export const STARTER_YAML_STUB = `# ClaudeTeam roster
# ============================================================================
# Sponsor-curated list of named team agents. Edit this file in your editor;
# ClaudeTeam's dashboard auto-reloads within ~1 second of save (no Reload
# Window required).
#
# Schema (full reference: .claude/docs/roster-matching.md):
# ----------------------------------------------------------------------------
# teams:
#   - id: <kebab-case>             # stable internal id
#     name: "<display>"            # name shown on the team card
#     description: "<optional>"
#     members:
#       - id: <kebab-case>         # stable internal id
#         display: "<display>"     # name shown on the tile
#         role: "<role>"           # optional descriptor under the name
#         color: "#5d8aa8"         # optional; falls back to a generated color
#         match:                   # FIRST match wins (top-down)
#           - name_prefix: "<str>"        # meta.json.name starts with
#           - name_equals: "<str>"        # meta.json.name equals exactly
#           - agentType_equals: "<str>"   # meta.json.agentType equals exactly
#           - description_contains: "<s>" # case-insensitive substring of description
#
# Worked example below: the ClaudeTeam team itself (Felix / Maya / Nora /
# Iris / Sage / Bram). Uncomment lines to enable. Add additional teams as
# new entries at the top level.
# ----------------------------------------------------------------------------
#
# teams:
#   - id: claudeteam
#     name: "ClaudeTeam"
#     description: "ClaudeTeam build team"
#     members:
#       - id: felix
#         display: "Felix"
#         role: "Extension Host Dev"
#         color: "#5d8aa8"
#         match:
#           - name_prefix: "felix-"
#           - agentType_equals: "felix"
#       - id: maya
#         display: "Maya"
#         role: "Webview UI Dev"
#         color: "#9caf88"
#         match:
#           - name_prefix: "maya-"
#           - agentType_equals: "maya"
#       - id: nora
#         display: "Nora"
#         role: "Tickets / PM"
#         color: "#c5a572"
#         match:
#           - name_prefix: "nora-"
#           - agentType_equals: "nora"
#       - id: iris
#         display: "Iris"
#         role: "UX / Design"
#         color: "#b48ead"
#         match:
#           - name_prefix: "iris-"
#           - agentType_equals: "iris"
#       - id: sage
#         display: "Sage"
#         role: "QA / Test"
#         color: "#88a2b4"
#         match:
#           - name_prefix: "sage-"
#           - agentType_equals: "sage"
#       - id: bram
#         display: "Bram"
#         role: "Research"
#         color: "#a3b88c"
#         match:
#           - name_prefix: "bram-"
#           - agentType_equals: "bram"

teams: []
`;

/**
 * Resolve the global roster path from config (`claudeteam.rosterPath` if
 * non-empty) or fall back to the documented default
 * `~/.claudeteam/teams.yaml`. Exported for unit tests so they can pin the
 * resolution logic without going through the full command registration.
 *
 * Always returns an absolute path — `path.join(homedir(), ...)` and an
 * explicitly-supplied override (which the user is expected to provide
 * absolute) are both fine. We do NOT attempt path canonicalization here;
 * the value flows verbatim to `fs.mkdirSync` and `vscode.Uri.file`.
 */
export function resolveGlobalRosterPath(): string {
  const override = vscode.workspace
    .getConfiguration("claudeteam")
    .get<string>("rosterPath");
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  return join(homedir(), ".claudeteam", "teams.yaml");
}

/**
 * Ensure the resolved roster file exists. If missing, recursively create
 * the parent directory AND write {@link STARTER_YAML_STUB}. No-op when the
 * file already exists (existing rosters are NEVER overwritten).
 *
 * Returns `true` when a file was created (test signal); `false` when the
 * file already existed (the more common path after first invocation).
 *
 * On filesystem failure (read-only directory, permission denied), surfaces
 * an `vscode.window.showErrorMessage` and re-throws so the caller can
 * abort the showTextDocument step. Crash containment is the caller's
 * responsibility.
 *
 * Exported for unit tests.
 */
export function ensureStarterRoster(rosterPath: string): boolean {
  if (existsSync(rosterPath)) {
    return false;
  }
  const dir = dirname(rosterPath);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(rosterPath, STARTER_YAML_STUB, { encoding: "utf8" });
    return true;
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: failed to create roster file at ${rosterPath}: ${(err as Error).message}`,
    );
    throw err;
  }
}

/**
 * Run the `claudeteam.openRoster` command: resolve the path, auto-create
 * if missing, open in editor. Surfaces failures via
 * `vscode.window.showErrorMessage` and NEVER throws — the command palette
 * should not surface a stack trace to the user.
 *
 * Exported for the webview `ui:open-roster` handler in `main.ts` and for
 * unit tests.
 */
export async function openRoster(): Promise<void> {
  const rosterPath = resolveGlobalRosterPath();

  try {
    ensureStarterRoster(rosterPath);
  } catch {
    // ensureStarterRoster already surfaced the error message. Bail out
    // before attempting to open a file we know doesn't exist.
    return;
  }

  try {
    await vscode.window.showTextDocument(vscode.Uri.file(rosterPath));
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: failed to open roster file ${rosterPath}: ${(err as Error).message}`,
    );
  }
}

/**
 * Register the `claudeteam.openRoster` command on the extension context.
 * Pushes the resulting `Disposable` onto `context.subscriptions` for
 * cleanup on deactivate.
 *
 * Returns the `Disposable` so callers (and tests) can hold a reference
 * without going through `context.subscriptions`.
 */
export function registerOpenRosterCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand(
    "claudeteam.openRoster",
    () => {
      void openRoster();
    },
  );
  context.subscriptions.push(disposable);
  return disposable;
}
