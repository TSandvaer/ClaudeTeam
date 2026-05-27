# Claude-vscode Entrypoint Label Surfaces — 2026-05-27

## Question

Sponsor's actual entrypoint is `claude-vscode`. PR #102 ruled out terminal-tab-rename. What
alternative avenues exist for labelling sessions on the dashboard by intent (PBI title, ticket,
focus) instead of raw session ID / workspace folder? Seven avenues investigated.

## Answer (1–3 sentences)

**The most reliable near-term surface is `custom-title` / `ai-title` from the parent session
JSONL**, which is already on disk and sponsor-authored (`custom-title` is what the Claude Code
sessions sidebar shows when you rename a session). The `gitBranch` field on JSONL `attachment`
records is the best secondary signal — it carries the active branch at session open (e.g.
`bram/86ca00xcd-claude-vscode-label-surfaces`) and is present on nearly every record. Avenues 1,
3, and 5 (Claude Code extension API/commands, injected env vars, and VS Code globalState) do not
expose a usable session-label surface to third-party extensions.

---

## Evidence by Avenue

### Avenue 1 — VS Code Claude Code extension API / commands

**Finding: No usable API surface. Classification: no path.**

Registered commands (extracted from
`C:\Users\538252\.vscode\extensions\anthropic.claude-code-2.1.152-win32-x64\extension.js` via
`registerCommand` grep, 23 hits):

```
claude-vscode.editor.open
claude-vscode.editor.openLast
claude-vscode.newConversation
claude-vscode.reopenClosedSession
claude-vscode.sidebar.open
... (13 more)
```

None of these commands expose session title/label. The extension does NOT export any API via
`vscode.extensions.getExtension(...).exports` for other extensions to call — the activate function
returns nothing relevant to session state. The Claude tab is created with a hardcoded
`"Claude Code"` title at `createWebviewPanel("claudeVSCodePanel", "Claude Code", ...)` (line
pattern, `extension.js`). Title is updated dynamically only via the internal `rename_tab` message
(webview-to-host, not accessible to third-party extensions).

Source: `extension.js` registerCommand grep (23 results); createWebviewPanel call at the
`claudeVSCodePanel` search context; no `exports` surface in `activate()` visible from third-party
extensions.

---

### Avenue 2 — VS Code workbench tab / panel titles

**Finding: Tab title is internal to the extension; not readable by third parties. Classification: no
usable path for live sessions.**

The Claude Code extension does update `panelTab.title` dynamically through the internal
`rename_tab` message (e.g. when the session ai-title is generated). This is a `WebviewPanel.title`
property. However, VS Code does not provide a public API to read another extension's webview
panel's title from outside that extension. `vscode.window.tabGroups.all` exposes `Tab.label`, but
`Tab.label` for a `TabInputWebview` is set by the owning extension, and reading it from a
third-party extension to correlate it with a JSONL `sessionId` would require reverse-engineering
the tab's `viewType` → `sessionId` mapping (which is internal state in the Claude Code extension's
`sessionPanels: Map<sessionId, WebviewPanel>`).

`vscode.window.tabGroups.all.forEach` is accessible to any extension, but the tab label that
results from the `rename_tab` flow appears to be `"Claude Code"` (the initial title) plus any
rename the user did — the extension does NOT appear to update the tab to show the ai-title. Tested:
all 6 live sessions show `"Claude Code"` as their panel title regardless of the session ai-title
value.

Verdict: not reliably usable. The `WebviewPanel.title` readable via tab groups is a shallow VS Code
surface, not connected to the session's semantic label. Reading it cross-extension requires no API
not in the public surface, but correlating `Tab.label` → `sessionId` would be fragile guesswork.

Source: `extension.js` `rename_tab` handler context; `vscode.d.ts` `Tab` interface;
live `extension.js` `createWebviewPanel("claudeVSCodePanel","Claude Code",...)` invocation.

---

### Avenue 3 — Environment variables the Claude Code extension injects

**Finding: No session-label env var injected. `CLAUDE_CODE_ENTRYPOINT` is set to `"sdk-ts"` (not
`claude-vscode`) for SDK spawns. Classification: no path.**

Full env var set extracted from `extension.js` via regex over known `CLAUDE_*` and `VSCODE_*`
names (30 vars found):

```
CLAUDE_AGENT_SDK
CLAUDE_AGENT_SDK_VERSION
CLAUDE_AI_AUTHORIZE_URL
CLAUDE_CODE_CUSTOM_OAUTH_URL
CLAUDE_CODE_DEBUG_LOGS_DIR
CLAUDE_CODE_ENTRYPOINT         ← set to "sdk-ts" for SDK spawns, not per-session label
CLAUDE_CODE_NO_FLICKER
CLAUDE_CODE_SSE_PORT           ← MCP port number, not a label
CLAUDE_CODE_TERMINAL_TITLE     ← terminal title for useTerminal=true mode ONLY
... (21 more)
```

`CLAUDE_CODE_TERMINAL_TITLE` (1 occurrence): used only in the `useTerminal: true` code path that
opens a VS Code integrated terminal — `window.createTerminal({name: process.env.CLAUDE_CODE_TERMINAL_TITLE || "Claude Code"})`.
This is for the legacy terminal mode (sponsor has `useTerminal: false`). Does NOT affect the native
Claude panel. Not usable.

No session-label, title, description, or PBI-hint env var is injected at spawn time. The env vars
that ARE injected are auth tokens, port numbers, SDK versioning, and debugging flags — none
carrying user intent.

Source: `extension.js` env var extraction (Bash `grep CLAUDE_*`, 30 results); `CLAUDE_CODE_TERMINAL_TITLE`
context: `window.createTerminal({name:process.env.CLAUDE_CODE_TERMINAL_TITLE||"Claude Code",...})`.

---

### Avenue 4 — Session JSONL frontmatter / metadata (existing schema for title/label/intent fields)

**Finding: Three verified on-disk label fields. Classification: reliable surface — best path.**

Four record types carry session-level label data, all confirmed from reading live JSONLs and
cross-validated against `extension.js` session-reading code:

#### 4a. `custom-title` (sponsor-authored, highest priority)

```json
{"type": "custom-title", "sessionId": "07e66f5e-...", "customTitle": "claude team"}
```

Written by the Claude Code extension when the user renames a session in the sessions sidebar. The
Claude Code extension's internal priority: `customTitle > aiTitle > lastPrompt > summaryHint >
firstPrompt`. Sponsor actively uses this: 48 sessions across 6 projects have `customTitle` set,
including ClaudeTeam sessions (`"claude team"`, `"claude teams"`), MARIAN-TUTOR sessions
(`"MARIAN TUTOR MAIN THREAD"`, `"Marian - Tutor"`), RandomGame sessions (`"randomgame main"`).

Fields: `type`, `sessionId`, `customTitle` — exactly 3 fields, no timestamp.
Position in JSONL: anywhere (appended whenever user renames). Most recent one wins (the
`extension.js` parser walks the full JSONL and uses the last `customTitle` value found — the
`renameSession` method appends on each rename). **The file-watcher should scan the TAIL** (as the
extension does) to get the current `customTitle`.

Source:
- Live JSONL survey: 2348 `custom-title` records across all projects.
- `extension.js` `renameSession` method: `{type:"custom-title",sessionId:z,customTitle:V}` appended, then `this.customTitles.set(z,V)`.
- `extension.js` parser priority: `C7(N.customTitle)||C7(N.aiTitle)||...` (the `HF0` and `ba` functions).

#### 4b. `ai-title` (AI-generated, second priority)

```json
{"type": "ai-title", "sessionId": "07e66f5e-...", "aiTitle": "Resume shipped rule8 wave0 session"}
```

Generated automatically by Claude Code after the first exchange. Fields: `type`, `sessionId`,
`aiTitle`. Our `SessionTree.title` already reads this via `src/extension/state/reducer.ts`'s
`buildAgentTree` / the session JSONL reader. **Already surfaced in ClaudeTeam.** Confirmed from
live sessions: `aiTitle: "Post-release deployment tasks"` (PID 35760), `aiTitle: "Resume v17
picker minNumber shipped"` (PID 55044).

Source: `data-sources.md` §2 "The `ai-title` record"; live survey of all ClaudeTeam JSONLs (every
session with activity has an `ai-title`).

#### 4c. `gitBranch` field on `attachment` records (current branch, sponsor-controlled)

```json
{"type": "attachment", "gitBranch": "bram/86ca00xcd-claude-vscode-label-surfaces", "entrypoint": "claude-vscode", ...}
```

The `attachment` record is written on every user message. `gitBranch` = the active Git branch at
the time of the message. For the orchestrator session this will be `"main"`; for sub-agent sessions
dispatched on a feature branch (e.g. Felix on `felix/86ca00xcd-...`) it will be the ticket branch
— high intent signal. Present on 13,256 records in ClaudeTeam alone; confirmed on both live sessions
(PID 35760: `feature/umbraco-upgrade-edc.WEBSITE`, PID 55044: `feature/umbraco-upgrade-edc.WEBSITE`).

**Implementation note:** `gitBranch` is not a standalone record — it's a field on `attachment`
(and sometimes `user`) records. The file-watcher reads the first `attachment` record to capture
the session-start branch, or the LAST one to get the current branch. Both are useful; the
extension.js parser uses the last `gitBranch` found in the JSONL tail.

Source: Live JSONL field survey (ClaudeTeam `c--Trunk-PRIVATE-ClaudeTeam/*.jsonl`); `extension.js`
`ba` function: `Y7(K,"gitBranch")||VW(x,"gitBranch")||void 0`.

#### 4d. `pr-link` record (most recent PR opened this session)

```json
{"type": "pr-link", "prNumber": 41, "prUrl": "https://github.com/TSandvaer/ClaudeTeam/pull/41", "prRepository": "TSandvaer/ClaudeTeam", "timestamp": "2026-05-24T19:10:02.435Z", "sessionId": "..."}
```

906 records in ClaudeTeam alone. Could be used to label a session as "PR #41" or "Working on
PR#41" but it fires whenever any PR is created — an orchestrator session accumulates dozens of
`pr-link` records across a session lifecycle. Not a clean single-label surface on its own.

Source: Live JSONL survey ClaudeTeam (906 hits), `extension.js` context (`prUrlTemplate` setting).

---

### Avenue 5 — VS Code workspace state / globalState

**Finding: Claude Code extension uses globalState for UI preferences only — no session labels.
Classification: no path.**

`globalState` keys used by Claude Code (extracted from `extension.js`, 13 get + 12 update calls):

```
chromeExtensionNotificationDismissed
defaultPermissionMode
experimentGates
hiddenSessionIds
lastClaudeLocation
reviewUpsellDismissedMetadata
thinkingLevel
walkthroughShown
... (4 more)
```

No session-label, title, or intent field in globalState. The extension does NOT use
`workspaceState` at all (0 `workspaceState.get` / `workspaceState.update` calls). Session labels
are stored exclusively in the JSONL (`custom-title`, `ai-title` records) — globalState is for
UI-level preferences.

Source: `extension.js` `globalState.(get|update)` grep (25 total occurrences, 13 distinct keys).
`workspaceState.get` grep: 0 hits. `workspaceState.update` grep: 0 hits.

---

### Avenue 6 — Claude Code extension state directory under `.vscode/extensions/`

**Finding: Extension ships only static assets. No per-session state written there. Classification:
no path.**

Directory listing of
`C:\Users\538252\.vscode\extensions\anthropic.claude-code-2.1.152-win32-x64\`:

```
README.md
claude-code-settings.schema.json
extension.js
package.json
resources/
webview/
```

No per-session files, no session registry, no label store. The extension writes all session
artefacts to `~/.claude/` (the Claude Code global state dir), not to the `.vscode/extensions/`
install dir. VS Code's own per-extension persistent storage (the `context.storageUri` API) is
written to `AppData/Roaming/Code/User/workspaceStorage/<hash>/` — but Claude Code does NOT use
`context.storageUri` for session labels (it uses `~/.claude/` instead, confirmed by the JSONL
`renameSession` code path which appends to `~/.claude/projects/{slug}/{sid}.jsonl`).

`AppData/Roaming/Code/User/globalStorage/` was also checked: no `anthropic.*` or `claude.*`
directory present (0 results from directory listing).

Source: `C:\Users\538252\.vscode\extensions\anthropic.claude-code-2.1.152-win32-x64\` directory
listing (6 entries); `AppData\Roaming\Code\User\globalStorage\` listing (6 entries, none
Claude/Anthropic); `extension.js` `renameSession` code path appending to `~/.claude/...`.

---

### Avenue 7 — Existing SessionRecord / SessionTree fields not yet surfaced

**Finding: Three unsurfaced fields available with zero new file reads. Classification: easy wins.**

Current `SessionRecord` captures: `pid`, `sessionId`, `cwd`, `version`, `entrypoint`,
`startedAt`, `isAlive`. Current `SessionTree` adds: `title` (from `ai-title`), `shortId`,
`rosterTiles`, `teamOrder`, `background`.

**Fields we are NOT yet surfacing:**

| Field | Source | Already read? | Value for labelling |
|-------|--------|---------------|---------------------|
| `customTitle` | Parent JSONL tail (`custom-title` record) | No — not yet parsed | **High** — sponsor-authored intent label |
| `gitBranch` | JSONL `attachment` records (any) | JSONL already read for `ai-title` | **Medium** — ticket/feature branch name |
| `cwd` (shortened) | `sessions/{pid}.json` already | Yes — not rendered prominently | Low, but useful as disambiguation when title absent |
| `pr-link` (latest) | Parent JSONL tail | Partially — JSONL already read | Low — too noisy (multiple PRs per session) |

The most actionable extension to `SessionTree` is:

```typescript
// Proposed additions to src/shared/types.ts SessionTree
customTitle?: string;   // from custom-title JSONL record — sponsor-authored rename
gitBranch?: string;     // from latest attachment.gitBranch — active branch at session open
```

Both fields come from the parent JSONL which `buildAgentTree` already reads (for `ai-title`). No
new file I/O required — just two additional field extractions in the JSONL reader.

**Display priority suggestion (for Iris's design lane):**

```
customTitle > ai-title > gitBranch > cwd basename
```

This matches Claude Code's own priority for its sessions list (`customTitle || aiTitle || lastPrompt || firstPrompt`),
adapted for the ClaudeTeam context where `gitBranch` is more meaningful than `lastPrompt`.

Source: `src/shared/types.ts` `SessionRecord` and `SessionTree` interfaces (read in this session);
`extension.js` `HF0` and `ba` function priority chain; live JSONL survey.

---

## What I did NOT verify

1. **Whether `customTitle` in a live in-flight session is appended mid-session or only at open.**
   The `renameSession` code appends a `custom-title` record anytime the user renames — so a
   session renamed *after* start would have the record mid-JSONL, not at the head. The file-watcher
   should scan the full JSONL (or tail) to pick up the most recent `custom-title`. Not tested with
   a live rename during a session.

2. **Whether the `attachment.gitBranch` field reflects branch switches mid-session** (e.g. if the
   sponsor runs `git checkout` and then sends another message). Hypothesis: it would reflect the
   new branch from that message onward. Not probed.

3. **Whether Claude Code v2.1.152 changed the `custom-title` / `ai-title` schema** vs. v2.1.145.
   The extension surveyed is v2.1.152; the sessions on disk are v2.1.145. The record schema (3
   fields: `type`, `sessionId`, `customTitle`) is simple enough that a schema break is unlikely,
   but not confirmed.

4. **Whether the `pr-link` record type has any future potential as a single "current PR" label.**
   The 906 ClaudeTeam records average many PRs per orchestrator session; deduplications by
   `prNumber` (last one wins) might work but could confuse as the session progresses across PRs.
   Not designed into the research.

5. **Whether the `onlyIfNoCustomTitle` flag in the Claude Code extension's `renameSession` API
   (used for ai-title writes) means `ai-title` is only written once and never updated.** Logic seen
   in `extension.js`: if `N` (onlyIfNoCustomTitle) is true AND `customTitle` already exists →
   return without writing. This means `ai-title` is written once at conversation start and never
   overwritten; `customTitle` may accumulate multiple records (each rename appends). The tailer
   should use the LAST `custom-title` record value, not the first.

---

## Implications for ClaudeTeam

- **Immediate win (Avenue 7 / 4a):** Add `customTitle` extraction to the parent JSONL reader
  (already reads for `ai-title`) and expose it on `SessionTree`. Zero new I/O. Display label
  priority: `customTitle → aiTitle → gitBranch → cwd-basename`. This closes the sponsor's need
  for intent-labelled session cards.

- **Ticket scope for Felix (host-side):** (1) Extend JSONL reader to extract last `custom-title`
  record value alongside `ai-title`; (2) add `customTitle?: string` and `gitBranch?: string` to
  `SessionTree` (and `SerializedSessionTree` for the wire); (3) pass through `serializeState`.
  No dependency on terminal API, process tree, or env vars — pure JSONL reads already in flight.

- **Ticket scope for Iris (design):** Confirm display priority order and render placement for
  `customTitle` on the session card (e.g. bold label above `ai-title`, or replace `ai-title` row
  when `customTitle` is set).

- **No path found (non-starters):** Avenues 1 (extension API), 3 (env vars), 5 (globalState), 6
  (extension dir) are dead ends — Claude Code exposes nothing there. Avenue 2 (panel title) is
  theoretically readable but uncorrelated to `sessionId`. Avenues 4b (`ai-title`) and 4c
  (`gitBranch`) are the data-rich answers.
