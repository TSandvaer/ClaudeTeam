# M3 Backlog — Roster Config + Live Refresh

Sponsor-confirmed M3 scope: interactive roster configuration, live YAML watching at `~/.claudeteam/teams.yaml`, drill-in polish, plus a tranche of M2-retro-surfaced orch/test discipline items and one new sponsor requirement (window-scoped session filtering).

**Output:** an extension that (1) ships a settable, hot-reloadable roster without a VS Code window restart; (2) filters its session view to the current VS Code window's workspace by default; (3) tightens the orch/test discipline gaps M2 surfaced; (4) extends Layer-3 coverage to the new M3 surfaces.

Each entry is dispatch-ready — the orchestrator can lift any ticket into a brief without further clarification from Nora.

ClickUp IDs are appended once the orchestrator creates tickets in list `901523520912` at dispatch time. Tickets marked **orch-direct chore** do NOT need a ClickUp ticket per project convention; the rest do.

**Prior-art basis:** Bram's PR #32 (`research(m3): prior-art on settings-UI patterns + global FS watching`, branch `bram/m3-prior-art`) — referenced from M3-01 and M3-02 once merged at `team/bram-research/m3-prior-art-2026-05-24.md`. PR #32 is in peer-review at the same tick as this backlog; reference resolves on merge.

---

## Out-of-repo follow-ups (filed elsewhere — listed here for visibility, NOT M3 work)

- **Port "Sub-agent GUI gap" reframe + `mcp__clickup__update_task` allow-rule to `create-orchestration-project` skill template.** Cross-project pattern; file against the skill's `port-improvements` mode, not in this repo. Tracked in M2-close retro § Durable lessons; Nora flags to orchestrator at next sponsor-touch point.

---

## M3-01 — `feat(roster): live YAML watch + hot-reload at `~/.claudeteam/teams.yaml``

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** L
**Priority:** P0 (anchor ticket of the milestone — every other roster-UX ticket assumes live reload works)
**Source:** V1-PLAN M3 ("Live polish"); `.claude/docs/roster-matching.md` §"Config locations"; M2-close retro § Next-session backlog item 1; PR #32 (Bram's prior-art) Q2 verdict
**ClickUp:** yes (create at dispatch)

### Scope

Wire `vscode.workspace.createFileSystemWatcher` on the **global** roster path `~/.claudeteam/teams.yaml` and the **per-project** path `<workspace>/.claude/teams.yaml`. On any change/create/delete event, re-load and re-merge the roster, re-run the matcher against the current live state, and post a fresh `state:full` (or matcher-scoped delta) to the webview. The user edits YAML in their editor → dashboard tiles update within ~1s, no `Reload Window` required.

Today the loader runs once at activation and never re-reads. This ticket makes the roster a live input alongside the file-watcher's session/agent data.

### Acceptance criteria

- AC1: `src/extension/roster/rosterWatcher.ts` (new) exports `startRosterWatcher(context, globalPath, projectPath, onRosterChange): Disposable`. The disposable disposes both VS Code FileSystemWatchers and clears any debounce timer.
- AC2: Implementation uses `vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(rosterDir), '*.yaml'))` per PR #32's verdict — NOT a plain string glob (silently drops out-of-workspace events post-1.64) and NOT the literal filename (issue #164925 may suppress events on some builds). One watcher per directory (global dir + project `.claude/` dir).
- AC3: Debounce: events arriving within 250ms of each other coalesce to one `onRosterChange` call (editors often emit save+modify in quick succession). Document the chosen debounce window in a code comment.
- AC4: On reload, `loadRoster` is called fresh; the `RosterLoadResult` (`roster`, `warnings`, `errors`) is handed to `onRosterChange`. Errors do NOT throw — the previous valid roster stays in effect AND the error is surfaced (see M3-04 for the error-chip UI ticket).
- AC5: `src/extension/main.ts` wires `startRosterWatcher` alongside the existing session watcher. On roster change, the next watcher tick uses the new roster; matcher output is regenerated and posted to the webview.
- AC6: Behavior when global file does not exist: watcher still registers on the directory; creating the file later fires the create event and loads it. Behavior when global directory does not exist: log once at startup, do not error — only re-register the watcher when/if the user creates the directory (acceptable to require a Reload Window for first-create-of-directory case; document this in the PR).
- AC7: Behavior when per-project `.claude/teams.yaml` is absent: identical to AC6 — watcher on the directory, no project overrides until file appears.
- AC8: Fallback: if `createFileSystemWatcher` proves unreliable (Bram's PR #32 §Q2 flags potential edge cases), there is a feature-flagged poll fallback path: a `setInterval` (5000ms, configurable via `claudeteam.rosterPollIntervalMs`) calling `statSync(rosterPath).mtimeMs` and triggering reload on mtime change. Flag default OFF; document the toggle in code + PR body.
- AC9: Integration test in `tests/integration/rosterWatcher.test.ts` — builds a tempdir with a roster YAML, starts the watcher, mutates the YAML, asserts `onRosterChange` fires within 2 seconds with the new roster. Covers also: create-after-watcher-starts, delete (reverts to no-overrides), malformed YAML (errors surfaced, previous roster retained).
- AC10: All tests pass: `npm run typecheck && npm run test:unit && npm run test:integration`.

### Out of scope (OOS)

- Error-chip rendering in the webview (M3-04).
- Settings-UI form for editing roster (decided NOT to build — see M3-02 commands-only approach).
- Migrating the existing one-shot `loadRoster` calls in the CLI (`src/cli/agentTree.ts`) — CLI remains one-shot.
- Layer-3 test coverage for the hot-reload surface (M3-09).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test:integration -- rosterWatcher
# Tests green; onRosterChange fires within 2s of YAML mutation
# Manual: install vsix, edit ~/.claudeteam/teams.yaml, observe dashboard updates within 1-2s without Reload Window
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO — this PR touches host-side roster wiring; webview render path is unchanged (state:full message shape unchanged).
- **Extension-manifest gate:** NO — `package.json` `contributes` unchanged.
- **Sub-agent GUI gap applies:** the AC(a) data-plane smoke is the live `onRosterChange` firing observed in the integration test + a manual reload-and-edit cycle in the Self-Test Report. Screenshot ACs deferred to sponsor post-merge per the documented pattern.

### Files in play

- Owned (Felix writes): `src/extension/roster/rosterWatcher.ts` (new), `tests/integration/rosterWatcher.test.ts` (new).
- Modified: `src/extension/main.ts` (wire roster watcher start/stop alongside session watcher), `src/extension/state/` reducer or watcherLoop integration as needed to apply the new roster on next matcher pass, `package.json` (add `claudeteam.rosterPollIntervalMs` to `contributes.configuration` IF AC8 fallback is wired with a user-facing toggle).
- Read-only references: `.claude/docs/roster-matching.md`, `.claude/docs/architecture-overview.md`, `team/bram-research/m3-prior-art-2026-05-24.md` (PR #32 — read after merge).

### Conflict rule

If `package.json` `contributes.configuration` IS modified to add `rosterPollIntervalMs`, that triggers the extension-manifest gate — switch to YES, include `vsce package --no-yarn` stdout in the Self-Test Report. If AC8's fallback is purely internal (no user-facing setting), the manifest stays untouched.

### Dependencies

- PR #32 (Bram's M3 prior-art) — informs AC2 and AC8. Soft dep: Felix can author against the verdicts already documented in PR #32's body if the merge hasn't landed.

---

## M3-02 — `feat(roster): `claudeteam.openRoster` command + auto-create starter YAML`

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** S
**Priority:** P0 (paired with M3-01 — together they deliver "edit roster, see changes" UX)
**Source:** PR #32 (Bram's prior-art) Q1 verdict — "use the openRoster command, do NOT map to `contributes.configuration`"; `.claude/docs/vscode-extension-conventions.md` "Extension manifest essentials"; M2-close retro § Next-session backlog item 1
**ClickUp:** yes (create at dispatch)

### Scope

Implement the `claudeteam.openRoster` command (already declared in `package.json` since M2-01 but never wired). The command:
1. Resolves the roster path (configured `claudeteam.rosterPath`, else `~/.claudeteam/teams.yaml`).
2. If the file does NOT exist, creates the parent directory + writes a starter YAML stub (commented template with the schema from `.claude/docs/roster-matching.md`).
3. Opens the file in VS Code's native YAML editor via `vscode.window.showTextDocument`.

This is the explicit "no custom webview form" decision from PR #32 §Q1: the canonical roster edit surface is the user's own YAML editing in VS Code, with M3-01 providing the live-reload feedback loop.

**Absorbs NIT #3 from M3-01 peer-review:** auto-create the global roster directory (`~/.claudeteam/`) + a starter `teams.yaml` if missing, when the user invokes `claudeteam.openRoster`. This eliminates the `registerDirWatcher` `existsSync`→`createFileSystemWatcher` race documented in Maya's M3-01 review (PR #35 comment 4528643161). AC2 + AC3 below already cover this — the absorption is recorded here for cross-reference traceability.

### Acceptance criteria

- AC1: `src/extension/commands/openRoster.ts` (new) exports `registerOpenRosterCommand(context): Disposable` and is registered in `activate()`.
- AC2: Resolves roster path via `vscode.workspace.getConfiguration("claudeteam").get<string>("rosterPath")` if non-empty, else `path.join(os.homedir(), ".claudeteam", "teams.yaml")`.
- AC3: If the file does not exist, creates the parent dir recursively (`fs.mkdirSync(dir, {recursive: true})`) and writes a starter stub. The starter stub MUST be valid YAML that parses cleanly (empty roster is acceptable: `teams: []`) and includes leading `#` comments documenting the schema. Source the schema-doc comments from `.claude/docs/roster-matching.md` §"Roster YAML schema".
- AC4: Starter stub uses the ClaudeTeam personas (Felix / Maya / Nora / Iris / Sage / Bram) as a worked example, commented out by default — user uncomments to enable. Rationale: dogfooding our own roster.
- AC5: Opens the resolved file via `vscode.window.showTextDocument(vscode.Uri.file(resolvedPath))`. On open failure (filesystem error after create), surface `vscode.window.showErrorMessage` — do not crash.
- AC6: A "Edit Roster" button / link in the webview empty-state UI sends `{ type: "ui:open-roster" }` to the host, which invokes this command. (Webview button surface is M3-04 — this AC ensures the host handler is in place when M3-04 lands.)
- AC7: Unit test in `tests/unit/openRoster.test.ts` — mocks `fs` + `vscode.window.showTextDocument`, asserts: path resolution honors configured override; auto-create branch fires when file is missing; auto-create does NOT fire when file exists (no overwrite).
- AC8: All tests pass.

### Out of scope (OOS)

- Webview-side button (M3-04 owns the empty-state and error-chip surfaces).
- Live reload of the roster after the user saves (M3-01 owns the watcher).
- Schema validation surfacing in the editor (no language-server work — user gets normal YAML syntax highlighting + our Zod validation surfaces via M3-04's error chip).
- Per-project roster auto-create — only the global path auto-creates; per-project is user-initiated by them creating `.claude/teams.yaml` manually.

### Done-when test

```bash
# In VS Code with extension installed:
# Command Palette → "ClaudeTeam: Open Roster"
# If ~/.claudeteam/teams.yaml does not exist:
#   - parent dir is created
#   - file is created with starter stub
#   - file opens in editor
# If file exists:
#   - file opens in editor unchanged
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO — command is host-side; webview interaction binds at M3-04.
- **Extension-manifest gate:** NO — `claudeteam.openRoster` already declared in M2-01's manifest. This PR adds the implementation, not the contribution.

### Files in play

- Owned (Felix writes): `src/extension/commands/openRoster.ts` (new), `tests/unit/openRoster.test.ts` (new).
- Modified: `src/extension/main.ts` (register the command in activate), `src/extension/view/provider.ts` (host-side handler for `ui:open-roster` if not already present — verify before adding).
- Read-only references: `.claude/docs/roster-matching.md` (starter stub schema source), PR #32 verdict.

### Dependencies

- M3-01 (so that after the user edits + saves, the changes hot-reload — without M3-01, the open-roster command is half a UX). Soft dependency: M3-02 can ship before M3-01 if needed; the UX value compounds when both are present.

---

## M3-03 — `feat(host): window-scoped session filtering (workspaceFolder cwd match)`

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** M
**Priority:** P0 (NEW sponsor requirement this session — user-visible scope correction)
**Source:** Sponsor directive 2026-05-24 — dashboard currently shows ALL sessions globally; should show only sessions matching the current VS Code window's `vscode.workspace.workspaceFolders` by default
**ClickUp:** yes (create at dispatch)

### Scope

Filter the `DashboardState.sessions` array to include only sessions whose `cwd` matches one of the current VS Code window's `workspaceFolders[].uri.fsPath`. Default behavior changes from "show every Claude Code session on the machine" to "show only sessions relevant to this window."

Add a `claudeteam.showAllSessionsGlobally` configuration setting (default `false`) for users who want the pre-M3 global view. **Whether to ship the toggle in this ticket or defer it is an implementation-time judgment call** — the AC permits either, see AC4.

This addresses the sponsor's observation that during M2 close, the dashboard surfaced RandomGame + MARIAN-TUTOR + 2× ClaudeTeam sessions when only the ClaudeTeam session in the current window was relevant.

### Acceptance criteria

- AC1: `src/extension/watcher/sessionFilter.ts` (new) exports `filterSessionsToWindow(sessions: SessionRecord[], workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined, showAll: boolean): SessionRecord[]`. Pure function. When `showAll` is true, returns input unchanged. When `showAll` is false AND `workspaceFolders` is non-empty, returns only sessions where `session.cwd` matches (case-insensitive on Windows, case-sensitive on POSIX) at least one workspace folder's `fsPath`. When `workspaceFolders` is empty/undefined (no folder open), returns input unchanged (don't filter to nothing — user has no signal to interpret).
- AC2: Path-match semantics: a session's `cwd` matches a workspace folder if `session.cwd` equals the folder's `fsPath` after normalizing trailing slashes AND drive-letter casing (Windows). Does NOT match on subdirectories — only exact folder match (V1 simplicity; refine if sponsor flags real-world miss cases).
- AC3: `src/extension/watcher/watcherLoop.ts` calls `filterSessionsToWindow` on its tick output BEFORE roster matching is applied — keeps the matcher's input set scoped to the current window.
- AC4: `package.json` `contributes.configuration` adds `claudeteam.showAllSessionsGlobally` (boolean, default `false`, description: "Show Claude Code sessions from all workspaces, not just the current VS Code window."). Setting is read each tick via `vscode.workspace.getConfiguration("claudeteam").get<boolean>("showAllSessionsGlobally")`. **If implementation discovers a complication (e.g., a worker passes the setting at construction time and would require restart-to-apply), the toggle MAY be deferred to a M3 follow-up ticket** — document the deferral in the PR body and file the follow-up.
- AC5: When the user changes `showAllSessionsGlobally`, the next watcher tick applies the new value (no Reload Window required). `vscode.workspace.onDidChangeConfiguration` fires the host to re-tick if needed.
- AC6: Empty-state messaging when filtered list is empty: webview shows "No Claude Code sessions for this workspace. Run `claude` in this folder, or enable `claudeteam.showAllSessionsGlobally` to see sessions from other workspaces." (Maya implements the empty-state text in M3-04; this AC ensures the state shape distinguishes "filtered-to-empty" from "globally-empty" via a `filterApplied: boolean` flag on the state shape.)
- AC7: `src/shared/types.ts` / `src/shared/messages.ts` — `DashboardState` (and the serialized variant) gains a `filterApplied: boolean` field (true when the global setting is false AND a workspace folder is open AND filtering reduced the session count). Message protocol updates apply through serializer per the JSON-serialization constraint documented in `.claude/docs/vscode-extension-conventions.md`.
- AC8: Unit tests in `tests/unit/sessionFilter.test.ts` cover: showAll=true returns input unchanged; showAll=false + matching cwd returns matched only; showAll=false + no folder open returns input unchanged (rationale: don't strand the user); Windows case-insensitivity; POSIX case-sensitivity; trailing-slash normalization.
- AC9: Integration test in `tests/integration/sessionFilter.test.ts` — builds tempdir fixture with multiple sessions across different cwds; runs the full watcher tick with a mocked workspaceFolders set; asserts filtered output.
- AC10: All tests pass.

### Out of scope (OOS)

- A per-session opt-in/opt-out UI (just the global toggle).
- Subdirectory matching (V1 simplicity; refine post-M3 if needed).
- Multi-root workspace edge cases beyond "match any folder in the workspaceFolders array" — sponsor will surface if real-world hit.
- Migrating the CLI driver (`src/cli/agentTree.ts`) — CLI remains global-view (no workspace context in a CLI run).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test -- sessionFilter
npm run test:integration -- sessionFilter
# Manual: open a VS Code window in ClaudeTeam folder while RandomGame/MARIAN-TUTOR sessions are also live on the machine.
# Dashboard shows only the ClaudeTeam session.
# Toggle claudeteam.showAllSessionsGlobally to true; dashboard shows all sessions on next tick.
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** YES — `DashboardState` shape changes (adds `filterApplied`) — webview's tile renderer + empty-state must consume the new field correctly. AC(a) live data-plane smoke required; AC(b-d) interactive screenshots deferred to sponsor per sub-agent GUI gap.
- **Extension-manifest gate:** YES — `package.json` `contributes.configuration` adds `claudeteam.showAllSessionsGlobally`. Include `vsce package --no-yarn` stdout in Self-Test Report.

### Files in play

- Owned (Felix writes): `src/extension/watcher/sessionFilter.ts` (new), `tests/unit/sessionFilter.test.ts` (new), `tests/integration/sessionFilter.test.ts` (new).
- Modified: `src/extension/watcher/watcherLoop.ts`, `src/extension/main.ts` (pass workspaceFolders + read showAll setting; wire onDidChangeConfiguration), `src/shared/types.ts` (`filterApplied` field on `DashboardState`), `src/shared/messages.ts` (serialized variant), `src/extension/messageBus.ts` (serializer update if needed), `package.json` (`contributes.configuration` addition).
- Read-only references: `.claude/docs/architecture-overview.md`, `.claude/docs/vscode-extension-conventions.md` (JSON-serialization constraint).

### Conflict rule

If `DashboardState` shape change collides with M3-04's webview renderer changes, the field addition (this PR) is the canonical source — M3-04 consumes it. Coordinate so M3-03 lands first or both PRs land in the same dispatch wave with explicit shared-shape note in both PR bodies.

### Dependencies

- M2-06 (host↔webview integration) — already merged.
- Pairs naturally with M3-04 (which renders the new `filterApplied` empty-state). M3-04 can ship first using a "filter is hardcoded false" stub and refactor when M3-03 lands, or both ship in the same wave.

---

## M3-04 — `feat(webview): roster-error chip + filtered-empty state + open-roster button`

**Owner:** Maya
**Peer reviewer:** Felix
**Size:** M
**Priority:** P1 (depends on M3-01 + M3-03 for state shape; the visible UX for the M3 milestone surfaces here)
**Source:** M2-close retro § Next-session backlog item 1(c) drill-in polish; `.claude/docs/roster-matching.md` "Loader edge cases"; PR #32 verdict (error-chip is the M3 surface for roster validation failures); M3-03 AC6 (filtered-empty messaging)
**ClickUp:** yes (create at dispatch)

### Scope

Webview UX polish for the M3 surfaces:
1. **Roster-error chip:** when `RosterLoadResult.errors` is non-empty (Zod validation failure, YAML parse error, duplicate-id collision), render a persistent error chip at the top of the dashboard with the error message + a "Edit Roster" action button.
2. **Filtered-empty state:** when `DashboardState.filterApplied` is true AND sessions.length is 0, render the messaging from M3-03 AC6 ("No Claude Code sessions for this workspace…" with a setting link / call-to-action).
3. **Open-roster button surface:** the "Edit Roster" button (used by both error-chip and the existing empty-state) sends `{ type: "ui:open-roster" }` per the existing message protocol — the host handler M3-02 ships consumes it.
4. **Drill-in polish:** verify the M2-06 drill-in (click tile → open JSONL) still works after the state-shape changes; minor UX tightening per Iris's spec edges (no new spec — adopt M2-03 visual language).

### Acceptance criteria

- AC1: `src/webview/components/rosterErrorChip.ts` (new) renders a chip at the top of the dashboard when `DashboardState.rosterErrors` (new field — see AC5) is non-empty. Chip uses the semantic `error` hex color (per M2-05 / Iris's M2-03 spec). Chip is dismissible per-session (clicking × hides it until the next error message changes) but reappears if a NEW error arrives.
- AC2: Error chip displays the first error verbatim + "(+N more)" if multiple errors. Clicking the chip body opens a small details panel listing all errors.
- AC3: "Edit Roster" button inside the error chip sends `{ type: "ui:open-roster" }` to the host (existing message type, no protocol change here).
- AC4: Filtered-empty state — when `state.sessions.length === 0 && state.filterApplied === true`, render the text from M3-03 AC6 in place of the existing "No live Claude Code sessions." text. Link "Show all sessions" surfaces the setting (or sends `ui:open-settings` if such a message is wired; if not, render as plain text instruction — do NOT block on adding a new message type for this ticket).
- AC5: `DashboardState` (and serialized variant) gains `rosterErrors: string[]` and `rosterWarnings: string[]` fields. Host populates from `RosterLoadResult` per tick. Webview consumes per AC1/AC2.
- AC6: Drill-in regression test — manual reload, click a rostered tile, verify the JSONL opens. Self-Test Report cites the click + the opened file path.
- AC7: Theme-switch probe — dark theme + light theme screenshots of: error chip, filtered-empty state, drill-in. Use the AC(a) live data-plane smoke pattern + sponsor post-merge confirm-no-regression for AC(b-d) interactive screenshots per the sub-agent GUI gap reframe.
- AC8: Component tests in `tests/unit/webview/rosterErrorChip.test.ts` — render chip with 0 errors (hidden), 1 error (visible, no "+N more"), 3 errors (visible with "+2 more"), dismissed state, re-show after error message change.
- AC9: All tests pass.

### Out of scope (OOS)

- New animations / transitions (M4).
- Settings-UI form for editing roster (decided NOT to build per PR #32 §Q1).
- Per-error remediation hints beyond the raw error message (the YAML editor + JSON-schema hints if added later are sufficient).
- Custom SVG icon for the error chip (use a codicon, e.g. `codicon-warning`).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-maya-wt
npm run typecheck && npm run test:unit
# Manual: install vsix
#   1. Edit ~/.claudeteam/teams.yaml to malformed YAML, save → error chip appears
#   2. Restore valid YAML, save → chip disappears
#   3. Click "Edit Roster" → roster opens in editor
#   4. With no Claude Code sessions in current workspace, dashboard shows filtered-empty state
```

Self-Test Report posted with AC(a) data-plane smoke + AC(b-d) sponsor post-merge deferral note per the sub-agent GUI gap pattern.

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** YES — webview rendering changes (new chip component, new empty-state text, state-shape consumers). AC(a) data-plane smoke required; AC(b-d) screenshots deferred to sponsor post-merge per sub-agent GUI gap.
- **Extension-manifest gate:** NO — no `package.json` `contributes` changes.

### Files in play

- Owned (Maya writes): `src/webview/components/rosterErrorChip.ts` (new), modifications to `src/webview/components/` empty-state component, `src/webview/styles/dashboard.css` (chip styling), `tests/unit/webview/rosterErrorChip.test.ts` (new).
- Modified: `src/shared/types.ts` / `src/shared/messages.ts` (`rosterErrors` + `rosterWarnings` fields — coordinate with M3-01 if Felix has already started adding fields), `src/extension/messageBus.ts` (serializer pass-through), `src/extension/main.ts` or watcher integration (host populates rosterErrors per tick from `loadRoster` result).
- Read-only references: `team/iris-ux/m2-dashboard-tile-spec.md` (visual language), `.claude/docs/roster-matching.md` ("Loader edge cases").

### Conflict rule

If `DashboardState` field additions conflict with M3-03's `filterApplied` addition, coordinate via PR-body cross-reference: whichever lands first owns the field-merge; the second PR adapts to the merged shape. Shape additions are append-only — never re-shape existing fields without a coordinated PR pair.

### Dependencies

- M3-01 (provides the `RosterLoadResult` stream that populates `rosterErrors`).
- M3-02 (host-side handler for `ui:open-roster` — chip button needs it).
- M3-03 (provides `filterApplied` flag — webview consumes it for the filtered-empty state).

---

## M3-05 — `chore(orch-logs): switch `clickup-pending.md` ENTRY-NNN IDs to timestamp-based`

**Owner:** Nora
**Peer reviewer:** orchestrator-direct (this is a coordination-doc-only chore)
**Size:** S
**Priority:** P1 (recurring failure mode — hit 4× in M2; prevention overdue per M2-close retro)
**Source:** M2-close retro § Next-session backlog item 2; sponsor-authorized in dispatch brief
**ClickUp:** NO — orch-direct chore class

### Scope

Replace the sequential `ENTRY-NNN:` scheme in `team/log/clickup-pending.md` with timestamp-based IDs (`ENTRY-2026-05-24T08:30:00Z`) to eliminate parallel-dispatch collisions. Update `.claude/agents/dispatch-template.md` ENTRY-pick instruction to specify the new format. Existing historical IDs remain as-is (leave-as-historical scheme); new scheme starts at the next entry.

### Acceptance criteria

- AC1: `.claude/agents/dispatch-template.md` (locate exact path — verify before editing) — the "Status-flip queue (sub-agent dispatch fallback)" instruction block updates to specify: "Use `ENTRY-<ISO-8601-UTC-timestamp>:` as the line prefix, where the timestamp is captured at the moment the persona writes the entry (e.g., `ENTRY-2026-05-24T08:30:00Z:`). DO NOT use sequential numeric IDs — they collide under parallel dispatch."
- AC2: `team/log/clickup-pending.md` — append a one-line note above the existing entries (inside the existing fenced block or as a markdown comment above it) marking the switchover: "Entries above use legacy sequential ENTRY-NNN; entries below use timestamp-based ENTRY-<ISO-8601>." NO migration of existing IDs (sponsor leave-as-historical decision).
- AC3: `.claude/docs/orchestration-overview.md` § Common failure modes bullet 10 ("ENTRY-number collision in clickup-pending.md") updated to reflect the prevention is now applied — replace "Prevention TBD" with "Prevention applied 2026-05-24: timestamp-based IDs per `.claude/agents/dispatch-template.md` § Status-flip queue. Legacy sequential IDs in entries dated before 2026-05-24 remain as historical."
- AC4: PR diff is ≤30 lines total. If it grows beyond that, scope has drifted.

### Out of scope (OOS)

- Migrating existing `ENTRY-NNN:` entries to timestamp format (sponsor's explicit leave-as-historical call).
- Any tooling/script for ID generation (manual ISO-8601 stamp is fine).
- Changes to ClickUp itself.

### Done-when test

```bash
grep -n "ENTRY-2026" .claude/agents/dispatch-template.md
# Finds the new format example in the instruction block
grep -n "Prevention applied" .claude/docs/orchestration-overview.md
# Finds the updated failure-mode bullet
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO.
- **Extension-manifest gate:** NO.

### Files in play

- Owned (Nora writes): `.claude/agents/dispatch-template.md` (verify exact path), `.claude/docs/orchestration-overview.md` (failure-mode bullet 10 update).
- Modified: `team/log/clickup-pending.md` (one-line switchover note only — NO migration).

### Dependencies

- None. Zero-dep; fires any time.

---

## M3-06 — `chore(test-discipline): test-plan executor mapping requirement`

**Owner:** Nora
**Peer reviewer:** orchestrator-direct (or Sage if Sage's test-plan dispatch template is the artifact being edited — see Files in play)
**Size:** S
**Priority:** P1 (prevents another M2-07-style "test plan without executor check"; carry-over discipline gap)
**Source:** M2-close retro § Anti-patterns "Authoring test plans without checking who can execute them"; § Next-session backlog item 4
**ClickUp:** NO — orch-direct chore class

### Scope

Update the dispatch contract / template that Sage uses when authoring test plans to require each manual-verification AC to map to an explicit executor role + runtime capability (human / sub-agent / Layer-3-automated). Flag any AC with no executor in the in-loop roster.

If the test-plan dispatch template lives in `team/nora-pl/dispatch-contracts/`, Nora updates it. If it lives in `.claude/agents/` or as a Sage-owned file in `team/sage-qa/`, Nora drafts the update and the dispatch brief points Sage at it (this is a meta-change to her contract). **Verify file location before editing**.

### Acceptance criteria

- AC1: The test-plan-authoring dispatch template (location TBD per Files in play) gains a new mandatory section: "Executor mapping table. For each manual-verification AC in the test plan, list: (a) the role that executes it (Felix / Maya / Sage / sponsor / Layer-3-automated); (b) the runtime capability required (CLI / sub-agent process / VS Code window + screenshot capability / `@vscode/test-electron`). Any AC with executor = `sponsor` that is also marked pre-merge-blocking must be flagged for review at backlog-authoring time — sponsor is not a pre-merge gate by default."
- AC2: The template includes an explicit anti-pattern callout citing M2-07 by ticket id: "M2-07's webview-smoke gate AC was authored for 'Maya or PR author' execution; both were sub-agents with no GUI runtime, surfacing at dispatch time. Map executors at authoring time, not at dispatch."
- AC3: PR diff is ≤25 lines total.

### Out of scope (OOS)

- Retroactively updating M2-07 (already merged; M3-09 inherits the lesson).
- Adding the same discipline to non-test-plan dispatch templates (separate ticket if needed).
- Building automation to verify executor mapping (manual discipline only).

### Done-when test

```bash
grep -rn "Executor mapping" team/nora-pl/dispatch-contracts/ .claude/agents/
# Finds the new section in the appropriate template
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO.
- **Extension-manifest gate:** NO.

### Files in play

- Owned (Nora writes): test-plan-authoring dispatch template (path TBD — Nora verifies first; candidate locations: `team/nora-pl/dispatch-contracts/test-plan.md`, `.claude/agents/dispatch-template.md` § "Test plan authoring", or `team/sage-qa/test-plan-template.md`). If no template file exists, Nora creates one at `team/nora-pl/dispatch-contracts/test-plan-authoring.md` with the executor-mapping section as its primary content.
- Read-only references: `.claude/retros/retro-2026-05-24-m2-close.md` § Anti-patterns.

### Dependencies

- None.

---

## M3-07 — `docs(testing): install-path validation discipline at first-shipping PR`

**Owner:** Nora
**Peer reviewer:** orchestrator-direct
**Size:** S
**Priority:** P1 (would have caught the M2-01 CJS shim bug at PR #22 review instead of PR #29 Layer-3)
**Source:** M2-close retro § Next-session backlog item 5; § Anti-patterns "Chain of deferred manual validations"
**ClickUp:** NO — orch-direct chore class

### Scope

Add a bounding rule to `.claude/docs/testing-strategy.md` § "Placeholder-PR screenshot exception" stating that even when the visible UI defers to a downstream PR, the install path (the `.vsix` activating successfully on the target Node/VS Code matrix) is load-bearing at the FIRST shipping PR. The exception releases the screenshot ACs, NOT the install-validation AC.

### Acceptance criteria

- AC1: `.claude/docs/testing-strategy.md` § "Placeholder-PR screenshot exception" gains a new subsection: "Install-path validation discipline." Content: even when visible-UI screenshots defer to a downstream PR per the placeholder exception, the `.vsix` install + activation on the project's target Node version (currently Node 22+) is load-bearing pre-merge for the FIRST shipping PR. A sponsor (or GUI-capable agent if any) manually performs: (1) `vsce package --no-yarn`, (2) `code --install-extension <vsix>`, (3) opens the Activity Bar entry, (4) confirms zero ERR_REQUIRE_ESM / activation errors in the Output channel within 5 seconds. Failure here blocks merge.
- AC2: New subsection explicitly cites M2-01 → M2-08 (PR #29) → CJS shim incident as the originating evidence: "The Node 22+ ERR_REQUIRE_ESM activation failure was latent from M2-01's `.vsix` and only surfaced at M2-08's Layer-3 tests three tickets later, because the placeholder exception masked the install-validation gap. The install path is the load-bearing test."
- AC3: New subsection clarifies the interaction with the sub-agent GUI gap: when the PR author and reviewer are both sub-agents, the install-path validation is the ONE pre-merge gate that requires a GUI-capable executor (sponsor or a future GUI-capable agent). Surface this at dispatch time, not at merge time.
- AC4: PR diff is ≤40 lines total.

### Out of scope (OOS)

- Changes to the sub-agent GUI gap reframe itself (M2-close retro already documented).
- Automation for `.vsix` install testing (Layer-3 covers parts of this; manual install validation is still required for the first shipping PR per the discipline being codified).
- Retroactive application to M2-01 (already merged).

### Done-when test

```bash
grep -n "Install-path validation discipline" .claude/docs/testing-strategy.md
# Finds the new subsection
grep -n "ERR_REQUIRE_ESM" .claude/docs/testing-strategy.md
# Finds the M2-01 → M2-08 cited evidence
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO.
- **Extension-manifest gate:** NO.

### Files in play

- Owned (Nora writes): `.claude/docs/testing-strategy.md`.

### Dependencies

- None.

---

## M3-08 — `docs(orch): main-thread merge-narration tightening`

**Owner:** Nora
**Peer reviewer:** orchestrator-direct
**Size:** S
**Priority:** P2 (housekeeping; non-blocking but saves 10-20 lines per auto-merge × 10+ per milestone)
**Source:** M2-close retro § What went poorly "Orchestrator narration in main thread is still a context-bloat surface"; § Next-session backlog item 6; memory `feedback_session_bloat_distinct_from_project_bloat`
**ClickUp:** NO — orch-direct chore class

### Scope

Update `.claude/docs/orchestration-overview.md` § PR & merge protocol (or add a new "Main-thread narration discipline" subsection) to codify: after an auto-merge, the orchestrator posts a one-line acknowledgment to the main thread ("PR #N auto-merged — decision logged"). Detailed rationale, foundation, alternative, reversibility live in `.claude/decisions-while-away.md`. Do NOT duplicate the audit content in the main conversation.

Same discipline applies to dispatch-brief authoring (already followed in M2 per the retro). This codifies the merge-decision discipline.

### Acceptance criteria

- AC1: `.claude/docs/orchestration-overview.md` gains a new subsection (or extends an existing one) titled "Main-thread narration discipline." Content: dispatch briefs are terse and point at the backlog / log file for detail; merge-decision posts follow the same pattern — one-line acknowledgment in main thread, full rationale in `decisions-while-away.md`.
- AC2: New subsection explicitly references the M2-close retro's "10-20 lines per auto-merge × 10+ per milestone" cost framing as the motivation.
- AC3: PR diff is ≤30 lines total.

### Out of scope (OOS)

- Refactoring the existing `decisions-while-away.md` schema.
- Changes to dispatch-template.md (the dispatch-brief discipline is already followed).
- Tooling / automation.

### Done-when test

```bash
grep -n "Main-thread narration discipline" .claude/docs/orchestration-overview.md
# Finds the new subsection
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO.
- **Extension-manifest gate:** NO.

### Files in play

- Owned (Nora writes): `.claude/docs/orchestration-overview.md`.

### Dependencies

- None.

---

## M3-09 — `test(m3): Layer-3 expansion — YAML hot-reload + window-filter + roster-error chip`

**Owner:** Sage
**Peer reviewer:** Felix (host-side surface) or Maya (webview surface — Sage picks the more-relevant reviewer per the PR's primary touch)
**Size:** M
**Priority:** P2 (depends on M3-01 + M3-03 + M3-04; all M3 implementation must be merged before Layer-3 coverage extends)
**Source:** M2-close retro § Next-session backlog item 7; M2-08's PR #29 set up the Layer-3 pipeline that this ticket extends
**ClickUp:** yes (create at dispatch)

### Scope

Extend the `@vscode/test-electron` Layer-3 suite (`tests/vscode-integration/`) with three new test cases covering the M3 surfaces:
1. **YAML hot-reload smoke** (M3-01): write a roster YAML to a tempdir, wire `claudeteam.rosterPath` to that path via test config, mutate the YAML mid-test, assert the next watcher tick reflects the new roster in the webview HTML (presence-check on a roster member id).
2. **Window-scoped filtering smoke** (M3-03): spin up the test VS Code instance with a single workspace folder; simulate sessions whose `cwd` matches and doesn't match the folder; assert the filtered set appears in the webview and the `filterApplied` flag is true.
3. **Roster-error chip smoke** (M3-04): write malformed YAML to the roster path; assert the webview HTML contains the error-chip element after the next tick.

Test plan executor-mapping discipline (M3-06) applies to this PR's ACs.

### Acceptance criteria

- AC1: `tests/vscode-integration/suite/rosterHotReload.test.ts` — implements the YAML hot-reload smoke per scope #1. Uses tempdir + config override. Asserts presence of a roster member id in the webview HTML before AND after mutation, with the mutation changing the visible id.
- AC2: `tests/vscode-integration/suite/windowFilter.test.ts` — implements the window-scoped filtering smoke per scope #2. Asserts the `filterApplied` flag is true in the webview state and the filtered session count matches expected.
- AC3: `tests/vscode-integration/suite/rosterErrorChip.test.ts` — implements the error-chip smoke per scope #3. Writes malformed YAML; asserts webview HTML contains the chip element (e.g., a known data-testid or class).
- AC4: All three test suites green on CI: `npm run test:vscode`.
- AC5: Sage posts findings of any bugs surfaced in Felix/Maya's M3 modules as follow-up tickets (M2-08 AC7 discipline — do not fix production code in this PR).
- AC6: Executor-mapping table in the test plan section of the PR body lists each AC's executor: AC1-3 are all Layer-3-automated (`@vscode/test-electron` headless via xvfb on Ubuntu CI per M2-08's pipeline).

### Out of scope (OOS)

- Layer-1 or Layer-2 test changes (those live in M3-01/03/04 PRs).
- New CI infrastructure beyond extending the existing `test:vscode` step from M2-08.
- Coverage of the M3-02 `openRoster` command (host-side command can be unit-tested cheaply in Layer-1; Layer-3 coverage adds little).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-sage-wt
npm run test:vscode
# All three new suites green; existing M2-08 suites still green
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO — this PR adds Layer-3 tests (the tests themselves ARE the webview-smoke verification for M3 surfaces). No production rendering changes here.
- **Extension-manifest gate:** NO.

### Files in play

- Owned (Sage writes): `tests/vscode-integration/suite/rosterHotReload.test.ts` (new), `tests/vscode-integration/suite/windowFilter.test.ts` (new), `tests/vscode-integration/suite/rosterErrorChip.test.ts` (new).
- Read-only references: `.claude/docs/testing-strategy.md`, M2-08 PR #29 (existing suite structure), M3-01 / M3-03 / M3-04 merged code.

### Dependencies

- M3-01, M3-03, M3-04 (all implementation must be merged so Sage has the surfaces to test).
- M2-08 (provides the Layer-3 pipeline).

---

## Cross-references

| Ticket | Depends on | Blocks |
|---|---|---|
| M3-01 | PR #32 (Bram, soft) | M3-04, M3-09 |
| M3-02 | M3-01 (soft) | M3-04 (button surface) |
| M3-03 | M2-06 (merged) | M3-04 (filtered-empty state shape), M3-09 |
| M3-04 | M3-01, M3-02, M3-03 | M3-09 |
| M3-05 | — | — |
| M3-06 | — | M3-09 (executor-mapping applies to its test plan) |
| M3-07 | — | — |
| M3-08 | — | — |
| M3-09 | M3-01, M3-03, M3-04 | — |

---

## Throughput / wave plan

**Wave 0 (Day 1, zero-dependency or PR-#32-soft-dep — fire in parallel on first tick):**

- **M3-01** — Felix: live YAML watch + hot-reload (P0, L) — soft-dep on PR #32 verdict; Felix can author against PR #32's body if merge hasn't landed
- **M3-03** — Felix: window-scoped session filtering (P0, M) — independent of M3-01; can fire same tick
- **M3-05** — Nora: ENTRY-NNN → timestamp switchover (P1, S, orch-direct chore)
- **M3-06** — Nora: test-plan executor mapping discipline (P1, S, orch-direct chore)
- **M3-07** — Nora: install-path validation discipline (P1, S, orch-direct chore)
- **M3-08** — Nora: main-thread merge-narration tightening (P2, S, orch-direct chore)

Felix in two parallel lanes (M3-01 + M3-03) is the highest-load profile of the wave; Nora ships four S-sized orch-direct chores in parallel. Total Wave 0 parallelism: 5-6 agents (Felix×2 + Nora×4 batched, or Nora staggers her chores if context-load is a concern — orchestrator's call at dispatch time).

**Wave 1 (after M3-01 + M3-02 + M3-03 merge):**

- **M3-02** — Felix: openRoster command + starter YAML (P0, S) — can fire in Wave 0 if Felix has bandwidth, but pairs naturally with M3-01 in Wave 1
- **M3-04** — Maya: webview error chip + filtered-empty state + open-roster button (P1, M) — depends on M3-01 (rosterErrors state) + M3-02 (host handler) + M3-03 (filterApplied state)

**Wave 2 (after M3-04 merge):**

- **M3-09** — Sage: Layer-3 expansion (P2, M) — covers all three M3 surfaces from Wave 0/1

**Expected parallelism peak:** Wave 0 with 5-6 agents in flight. Load distribution: Felix owns 3 tickets (M3-01/02/03), Maya owns 1 (M3-04), Sage owns 1 (M3-09), Nora owns 4 orch-direct chores (M3-05/06/07/08). M3 is Felix-heavy on implementation; Nora batches the orch discipline tickets.

---

## Tickets requiring ClickUp creation at dispatch time

- M3-01, M3-02, M3-03, M3-04, M3-09 (5 tickets — code or test work)

## Tickets that are orch-direct chore class (no ClickUp ticket)

- M3-05, M3-06, M3-07, M3-08 (4 tickets — coordination-doc / testing-doc updates)

---

## Webview-smoke gate ticket roll-up

- **M3-03** — YES (state-shape change consumed by renderer)
- **M3-04** — YES (renderer changes)
- (All others — NO)

## Extension-manifest gate ticket roll-up

- **M3-03** — YES (adds `claudeteam.showAllSessionsGlobally` to `contributes.configuration`)
- **M3-01** — CONDITIONAL (only if AC8 fallback wires a user-facing `rosterPollIntervalMs` setting)
- (All others — NO)

## Cross-review pairing roll-up

- Felix authors: M3-01, M3-02, M3-03 → Maya reviews
- Maya authors: M3-04 → Felix reviews
- Sage authors: M3-09 → Felix or Maya reviews per primary touch surface
- Nora authors: M3-05, M3-06, M3-07, M3-08 → orchestrator-direct

---

## M3 milestone done-when

Compound check that proves M3 is shippable:

1. User runs Command Palette → "ClaudeTeam: Open Roster" → file is created at `~/.claudeteam/teams.yaml` with starter YAML stub, opens in editor.
2. User edits the YAML, saves → dashboard updates within ~2s without `Reload Window`.
3. User introduces a YAML syntax error, saves → error chip appears in dashboard with the parser message + "Edit Roster" button.
4. With `claudeteam.showAllSessionsGlobally = false` (default) and a workspace folder open, dashboard shows only sessions whose `cwd` matches the workspace folder. Toggling the setting to `true` shows all sessions on next tick.
5. Drill-in (click rostered tile → JSONL opens) still works post-M3.
6. Layer-3 suite green: M3-09's three new test cases pass alongside M2-08's four cases (7 Layer-3 tests total).
