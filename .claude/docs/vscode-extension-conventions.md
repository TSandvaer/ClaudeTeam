# VS Code Extension Conventions

Patterns for the extension scaffold. Grows over time as Felix and Maya land each milestone — start with the must-haves below.

## Scaffold layout (expected)

```
src/
├── extension/                  # Extension host (Felix)
│   ├── main.ts                 # activation entry point
│   ├── watcher/
│   │   ├── sessionRegistry.ts  # ~/.claude/sessions/*.json poller
│   │   ├── subagentTailer.ts   # subagent JSONL tail
│   │   └── metaJsonLoader.ts   # meta.json reader (handles both schemas)
│   ├── roster/
│   │   ├── loader.ts           # teams.yaml loader (global + project)
│   │   ├── matcher.ts          # apply match rules
│   │   └── schema.ts           # zod/io-ts schema for teams.yaml
│   ├── state/
│   │   └── reducer.ts          # state model + transitions
│   ├── view/
│   │   └── provider.ts         # WebviewViewProvider
│   └── messageBus.ts           # host → webview message dispatch
│
├── webview/                    # Webview UI (Maya)
│   ├── main.tsx                # webview entry (or main.ts for vanilla)
│   ├── components/             # UI components
│   ├── styles/                 # CSS using --vscode-* variables
│   └── messageReceiver.ts      # webview side of the bridge
│
├── shared/
│   ├── messages.ts             # discriminated-union message types
│   └── types.ts                # shared domain types (Agent, Team, Member)
│
tests/
├── fixtures/                   # captured meta.json/jsonl, anonymized
├── unit/                       # vitest
└── integration/                # @vscode/test-electron

package.json                    # extension manifest
tsconfig.json
esbuild.config.mjs              # webview + host bundles
.vscodeignore                   # files excluded from .vsix
```

## Extension manifest essentials

The `package.json` `contributes` block needs (at minimum):

- `views`: register the dashboard under the Activity Bar (or Side Bar, decide at M2).
- `viewsContainers`: a custom container icon (use a codicon initially; Iris ships a custom SVG later).
- `commands`: at least `claudeteam.refresh`, `claudeteam.openRoster`, `claudeteam.openAgentTranscript`.
- `configuration`: `claudeteam.rosterPath` (override), `claudeteam.pollIntervalMs` (default 2000), `claudeteam.showBackgroundCount` (default true).

`activationEvents`:
- `onView:claudeteam.dashboard` (lazy — only activate when the user opens the view).

`engines.vscode`: pin to a current minimum (likely `^1.85.0`). Bram researches the actual minimum we need based on API usage.

**Why `configuration` lists only scalars (no nested-array settings).** VS Code's native Settings UI silently falls back to *"Edit in settings.json"* when a `contributes.configuration` schema declares `type: array` with `items.type: object` containing further nested arrays — the form is never rendered. Verified against the installed Claude Code extension's `claudeCode.environmentVariables` setting (`C:\Users\<user>\.vscode\extensions\anthropic.claude-code-*\package.json`), whose description literally reads *"Prefer setting environment variables in Claude's settings.json."* For ClaudeTeam this is why the roster (a list of teams-of-members with nested `match[]` arrays) is NOT exposed as a `contributes.configuration` entry — instead, the `claudeteam.openRoster` command opens `~/.claudeteam/teams.yaml` in VS Code's native YAML editor. Only scalar/simple settings (`claudeteam.rosterPath`, `claudeteam.pollIntervalMs`, `claudeteam.showBackgroundCount`) go in `configuration`. Source: `team/bram-research/m3-prior-art-2026-05-24.md` (PR #32, merge `7d14976`).

## Webview rules

- **CSP-strict.** No inline scripts. No `eval`. Use nonces if any inline tag is unavoidable.
- **Theme variables only.** `--vscode-foreground`, `--vscode-editor-background`, `--vscode-list-hoverBackground`, etc. Hardcoded hex only for state indicators with semantic color meaning (red=error, green=running, yellow=idle).
- **State minimalism.** State that exists in the host should NOT be mirrored in the webview. The webview is a renderer; it owns ephemeral UI (hover, expansion, scroll), not domain data.
- **Re-render discipline.** A state change in the host should not cause a full re-render in the webview — diff at the message-receiver level.

## Webview boot state — dev-fixture gating

**Rule:** never initialize `currentState` from `FIXTURE_STATE` unconditionally. `FIXTURE_STATE` embeds `FIXTURE_DEAD_SESSION` (real dev-fixture values: `pid=99999`, `cwd=c:\Trunk\PRIVATE\Axelot-tutor`, `shortId=a91f3c20`) — these render in production for the window between webview mount and the first `state:full` arriving from the host.

**Fix pattern** (verified `src/webview/main.ts:155-158`, PR #41 SHA `0fbf028`):

```ts
const isVsCodeMode = typeof acquireVsCodeApi === "function";
let currentState: AgentTree = isVsCodeMode ? FIXTURE_EMPTY_STATE : FIXTURE_STATE;
```

- VS Code mode (`isVsCodeMode` true) → boot with `FIXTURE_EMPTY_STATE` (`sessions: []`) so no tiles render until `state:full` arrives.
- Browser dev mode → boot with `FIXTURE_STATE` so Maya can iterate on layout without a live host.

**Fixture export discipline** (`src/shared/fixtures.ts`): maintain two named exports — `FIXTURE_STATE` (full realistic tree for browser dev / component tests) and `FIXTURE_EMPTY_STATE` (empty sessions array for VS Code boot and empty-state rendering tests). Do not use `FIXTURE_STATE` as the VS Code boot default.

**Diagnostic heuristic:** if production renders tiles with `pid=99999` or `cwd=Axelot-tutor` before real data arrives, the gating predicate is absent or wrong — check `src/webview/main.ts` boot block first, not the host-side filter.

**Test coverage:** `tests/unit/webview/bootBleed.test.ts` (4 jsdom tests, landed PR #41).

## Session label resolution

The session-card title text is the result of a **3-tier priority chain** resolved by the shared pure helper `resolveSessionLabel(rec)` in `src/shared/types.ts`. The webview's `sessionBlock` renders the resolved string in the `.session-title` span; the host wire emits the raw `ai-title` value (and the optional `customTitle`) so the resolver can fire client-side. Vocabulary contract LOCKED per sponsor approval 2026-05-27 (86ca03nww).

```
customTitle > ai-title > workspace-folder fallback (basename of cwd)
```

- **Tier 1 — `customTitle` (sponsor rename)** — wins when defined and non-empty after `.trim()`. Source: `type: "custom-title"` JSONL records (see `data-sources.md` §2 for parser semantics — last-write-wins, key-order tolerant).
- **Tier 2 — `aiTitle` (the existing `SessionTree.title`)** — wins when the `ai-title` JSONL value is non-empty AND not the `(no title yet)` sentinel. Source: `type: "ai-title"` JSONL records (first-occurrence wins).
- **Tier 3 — workspace folder name** — basename of `SessionTree.cwd`, portable across Windows backslash and POSIX forward-slash separators (single helper `workspaceFolderName(cwd)`, exported for direct test coverage). The "always-something" fallback so a session card never renders an empty title.

**The raw `ai-title` value stays on the wire as `SessionTree.title`** for back-compat with the CLI presenter, diagnostic panel, and pre-86ca03nww tests. Only the dashboard webview's `.session-title` span uses the resolver. The resolver is pure (no filesystem, no VS Code API) and safe to call repeatedly during render — its inputs (`title`, `customTitle`, `cwd`) are JSON-safe scalars that survive the host→webview boundary.

**`data-label-source` attribute** on the rendered span reflects which tier resolved (`"custom-title"` / `"ai-title"` / `"workspace-folder"`) — useful for diagnostic panel inspection and visual regression tests.

**gitBranch chip** (`SessionTree.gitBranch`, optional) renders as a small monospaced badge (`.session-git-branch`) next to the title when defined. NOT part of the label-resolution chain — it's a complementary surface, hidden when absent. Source: top-level `gitBranch` field on `attachment` / `user` / `assistant` / `system` JSONL records; last-occurrence wins (see `data-sources.md` §2).

**Test coverage:** `tests/unit/sessionLabel.test.ts` (23 unit tests — resolver priority + `workspaceFolderName` edge cases), `tests/unit/webview/sessionBlock.test.ts` (11 component tests — DOM wiring + chip rendering), `tests/integration/readSessionMetadata.test.ts` (9 new integration tests for parser + wire round-trip).

## Session-tile identity and DEAD prune semantics

**Session-tile identity is (sessionId, pid), not sessionId alone.** The sessions directory (`~/.claude/sessions/`) holds one `{pid}.json` per Claude Code process. When a VS Code window reloads, the old process file may not be immediately cleaned up, so the dashboard can briefly show two (or more) tiles for the same `sessionId` with different PIDs — both correctly marked DEAD. This is the expected audit-trail shape: each tile represents a PID-scoped process snapshot. The tiles disappear on the next poll tick after Claude Code's process cleanup removes the stale file(s) from `sessions/`. No deduplication by `sessionId` is applied.

**DEAD tile pruning is file-driven, not timer-driven.** When a process's `{pid}.json` is removed from `~/.claude/sessions/` (Claude Code cleans up on process exit), the corresponding tile disappears from the dashboard on the next poll tick. The `vscode.workspace.createFileSystemWatcher` on `~/.claude/sessions/*.json` fires an `onDidDelete` event for the deletion, which triggers an immediate out-of-band tick — so DEAD tiles typically vanish within a few seconds of the file being removed, without waiting for the next scheduled interval (default 2000 ms). There is no explicit prune timer; the tile lifecycle is entirely driven by `{pid}.json` presence on disk.

## Message protocol (host ↔ webview)

Every message is a typed object with a `type` discriminator. Source of truth: `src/shared/messages.ts` — both sides import it.

```typescript
// Host → Webview
type HostMessage =
  | { type: "state:full"; payload: DashboardState }
  | { type: "state:delta"; payload: StateDelta }
  | { type: "roster:loaded"; payload: { teams: Team[] } }
  | { type: "roster:error"; payload: { error: string } };

// Webview → Host
type WebviewMessage =
  | { type: "ui:open-transcript"; payload: { sessionId: string; agentId: string } }
  | { type: "ui:open-roster" }
  | { type: "ui:refresh" };
```

Refine the shapes as needed; the rule is: **add a new message type rather than overloading an existing one**. Easier to read, easier to migrate.

**JSON-serialization constraint (non-obvious — validated M2-04, PR #23).** VS Code `webview.postMessage` (host → webview) and `acquireVsCodeApi().postMessage` (webview → host) serialize payloads via **JSON.stringify**, not the browser's structured-clone algorithm. This means `Map`, `Set`, `Date`, `RegExp`, `Function`, `undefined`-valued properties, circular refs, and class instances do NOT survive the round-trip — `Map` arrives as `{}`, `Date` arrives as ISO string, etc. **Rule:** message payload types must be JSON-safe (plain objects, arrays, primitives, ISO date strings if you need dates). If a host-side data structure uses `Map` (e.g. roster tiles keyed by agent id), flatten to a plain object via `Object.fromEntries(map)` on send and rebuild via `new Map(Object.entries(obj))` on receive. M2-04 pattern: `src/extension/messageBus.ts` exports `serializeState(state)` that flattens the host-side `DashboardState` to a `SerializedDashboardState` shape; webview consumers use `Object.entries` on the flattened fields. Apply the same pattern to any new message type whose payload would naturally use a `Map`/`Set`/`Date`.

**`webview.postMessage` is fire-and-forget — NOT buffered (non-obvious — validated PR #72, merge `72626b1`, ticket `86c9z0w56`).** Messages sent from the host to the webview via `webview.postMessage(...)` BEFORE the webview's `window.addEventListener("message", ...)` handler is registered are silently dropped — VS Code does not buffer them for later delivery. The host's `WebviewView.onDidResolveWebview` (`src/extension/view/provider.ts:126-135`) fires synchronously in the same Node.js call stack as the `webview.html` assignment (`provider.ts:113`), which sends the bundle to the Electron renderer asynchronously. Any host-side `postMessage` between those two events arrives at the renderer BEFORE the webview JavaScript IIFE has run and registered its `message` listener (e.g., via `initMessageReceiver` at `src/webview/messageReceiver.ts:119`). Result: silent message loss. **Pattern (load-bearing):** webview-initiated pull — the webview sends `{ type: "ui:refresh" }` to the host as the final statement in `boot()` (after `initMessageReceiver` returns), and the host's `onRefresh` handler pushes current state via the now-listening channel. A host-side push at `onResolved` time (e.g., PR #66's replay) is acceptable as a harmless secondary fast-path only — it may work in some VS Code configurations if postMessage happens to buffer, but cannot be relied on as the primary delivery mechanism. Symptom of getting this wrong: a freshly-resolved webview renders the boot/empty state and never receives the host's initial payload (PR #66's empty-state-on-pane-reopen bug, fully diagnosed in Bram's triage doc at `team/bram-research/86c9yteju-triage-2026-05-26.md` § "Observation 3 — PR #66 follow-up verification").

## Build & package

- **Bundler:** `esbuild` for both host and webview. Speed matters during dev (reload-test loop).
- **Host bundle MUST emit as CJS with `.cjs` extension** — output `dist/extension/main.cjs` (not `.js`). VS Code's extension host runs Node 22+, which raises `ERR_REQUIRE_ESM` if it sees `.js` under any ESM-ambiguous resolution (this project's `package.json` has no `"type"` field; Node 22+ treats sibling `.js` files as ESM when called through `require()`). The `.cjs` extension is the canonical disambiguation. Verify after every build: `node -e "require('./dist/extension/main.cjs')"` exits 0. **`package.json` `main` field must match** the actual extension (`dist/extension/main.cjs`). Webview bundle stays `.js` (IIFE format — runs in browser context, no require() involved). Resolved by `4a41634` (`86c9y9yzu`); source-of-truth comment block lives in `esbuild.config.mjs` next to the host outfile config.
- **Watch mode:** `npm run watch` rebuilds both bundles on file change.
- **Packaging:** `vsce package` produces a `.vsix`. Manifest-touching PRs must include the `vsce package` output in the Self-Test Report (catches malformed `contributes` early). After `vsce package`, optionally re-extract the `.vsix` and verify `node -e "require('./extension/dist/extension/main.cjs')"` exits 0 on Node 22+ — catches packaging-time regressions in the bundle-format chain.
- **Dev-only TS scripts triple-edit pattern:** any new top-level dev-only TS directory (e.g. `scripts/measure-cadence.ts`) requires three coordinated edits — (1) the source file itself, (2) `tsconfig.json` `include` entry so `npm run typecheck` covers it, (3) `.vscodeignore` exclusion so `vsce package` doesn't ship it inside the `.vsix`. Missing any one creates a partial failure: skip (2) and typecheck doesn't enforce it; skip (3) and the `.vsix` balloons with dev tooling that has no business shipping to users. Codified after M4-04 PR #59 (`d9b1b49`) where the gap was caught in the `vsce package --no-yarn` Self-Test step.
- **Pre-commit:** typecheck + lint + unit tests. No `--no-verify`.

## Install and dogfood-verification workflow

When the sponsor or a dev installs a freshly-packaged `.vsix` to dogfood a fix or feature, the workflow MUST start with `git pull --ff-only` and then VERIFY the resulting `HEAD` SHA matches the expected ship-SHA before declaring "the fix works / doesn't work." Building from stale local `main` is the documented failure mode that bit V1 dogfood-verify (2026-05-26, ticket `86c9z0w56`): sponsor built and installed from a 7-PR-behind local `main`, then reported that PR #66's Obs 3 fix didn't work — but PR #66 wasn't in the installed `.vsix` at all. Triage almost dispatched against a phantom regression in code the running extension didn't contain.

**Canonical install / reinstall sequence:**

```bash
git -C <project-root> pull --ff-only origin main
git -C <project-root> rev-parse HEAD      # verify expected SHA before building
cd <project-root>
npm run build
npx vsce package --no-yarn
code --install-extension claudeteam-0.0.1.vsix --force
```

If the working tree carries uncommitted coord-state (`.claude/away-queue.md`, `.claude/decisions-while-away.md`, `team/STATE.md`, `team/log/clickup-pending.md`), wrap the sequence with `git stash push -- <files>` before pull and `git stash pop` after install — and expect a log-only conflict on `team/log/clickup-pending.md`. Recovery for the conflict: `git checkout --ours team/log/clickup-pending.md && git add team/log/clickup-pending.md && git stash drop` (see `.claude/docs/orchestration-overview.md` § Common failure modes for the broader log-only-conflict pattern).

**Symptom-to-check-first rule (dogfood triage):** when a "shipped fix doesn't work" report arrives:

1. `git -C <project-root> rev-parse HEAD` — does local `main` match the expected ship-SHA?
2. `git -C <project-root> fetch origin && git -C <project-root> log --oneline HEAD..origin/main` — is local missing any merged PRs?
3. Only after both checks confirm the installed `.vsix` was built from the expected SHA, classify the report as a real regression and dispatch triage.

The cost of these two `git` calls is one Bash dropdown. The cost of dispatching a triage against code that isn't running is 30–60 min of sub-agent time plus sponsor frustration.

## Testing

- **Unit (`vitest`):** parsers, matchers, reducers — pure functions, no DOM or VS Code API.
- **Component (`vitest` + `@testing-library/...`):** UI components rendered with mocked message-receiver.
- **Integration (`@vscode/test-electron`):** spin up VS Code with the extension loaded, drive via the test harness. Use sparingly — these are slow.
- **Manual reload checklist:** for every UI PR. There's no substitute for actual VS Code reload.

## Activation cost

The extension should activate lazily on `onView:claudeteam.dashboard`. Avoid:
- Loading the roster at module-import time (do it in the activation function).
- Starting the file-watcher before the view is opened.
- Allocating webview HTML before resolveWebviewView fires.

VS Code measures activation time; long activation gets flagged in the Output panel as a warning. Aim for <100ms cold activation.

## Session filter edge cases

**Multi-session / cwd-filter model.** The dashboard scopes session visibility by **cwd match against the current VS Code workspace folder(s)** when `claudeteam.showAllSessionsGlobally: false` (the default). Implementation: `src/extension/watcher/sessionFilter.ts:75-88` (the `filterSessionsToWindow` function). All sessions whose `cwd` (after path normalization — see `normalizePath` at `sessionFilter.ts:150-164`) matches a workspace-folder path are surfaced — **not just "one current session"**. In practice the sponsor usually runs one Claude Code session per project at a time, but if multiple are alive concurrently (e.g. two VS Code windows open on the same project, or a CLI Claude alongside a `claude-vscode` session) the dashboard will show agents from both. Sessions whose process is no longer alive get a dead-session header (no agent tiles rendered — see `src/webview/components/sessionBlock.ts:66-92`). Dead headers self-prune when the underlying `~/.claude/sessions/{pid}.json` file is removed by Claude Code on process exit, per the file-driven prune semantics documented above. **The session-boundary semantics is workspace-cwd, NOT process-PID.** This is the intended product behavior per sponsor's 2026-05-26 clarification during V1 dogfood — the dashboard is scoped to "what's happening in this project," not "this one specific process."

**Window-filter passthrough when no folder is open.** The `claudeteam.showAllSessionsGlobally` setting (default `false`) is intended to scope the dashboard to the current VS Code workspace. However, when VS Code has NO workspace folder open (e.g., a File > Open File window with no folder), the filter passes through all sessions rather than showing an empty dashboard. This is the "don't strand the user" behavior — without a workspace folder, there is no filter signal to interpret. If a sponsor opens the ClaudeTeam pane in a no-folder window and sees sessions from other projects, this is expected behavior, not a filter leak. To restrict visibility in a no-folder window, set `claudeteam.showAllSessionsGlobally: false` and open the desired folder first.

**`showAllSessionsGlobally: true` disables the filter entirely.** When set to `true` (not the default), the dashboard shows all sessions on the machine regardless of the current window's workspace. This is also a valid cause of cross-workspace session visibility if the user has previously enabled the setting.

## Open questions (decide during M2)

- **UI framework:** Decided — **vanilla TypeScript** for M2. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"Webview UI tech recommendation" for the full analysis. React is not recommended at ClaudeTeam's tile count (6 rostered + background chip). Svelte is the upgrade path if vanilla TS proves ergonomically painful at M2-05 scope — NOT React. The webview entry is `src/webview/main.ts` (not `.tsx`).
- **Reactive store inside webview:** Defer until Maya starts M2-05 and encounters the actual re-render surface. A plain `EventEmitter` or hand-rolled observable on the message-receiver is sufficient; no framework store needed at this scale.
- **Filesystem watcher implementation:** Decided — `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (VS Code ≥1.64, within the `^1.85.0` engine floor) for `~/.claude/sessions/*.json` and `~/.claudeteam/*.yaml` (M3 roster). Pair with `setInterval` (2000ms default) for JSONL tailing. Do NOT add chokidar — zero-dep alternative is available. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"File-watcher approach" for the original decision matrix. **Three out-of-workspace caveats validated PR #32 (`7d14976`, `team/bram-research/m3-prior-art-2026-05-24.md`):** (a) **`RelativePattern` is mandatory** — `createFileSystemWatcher("/home/user/.claudeteam/*.yaml")` (plain string) silently fails for paths outside `workspace.workspaceFolders` with no error, just no events; always use `new vscode.RelativePattern(vscode.Uri.file(rosterDir), '*.yaml')`. (b) **Use a glob (`*.yaml`), not the literal filename** — VS Code issue #164925 reports single-filename patterns may not fire reliably (issue closed, fix-version unpinned); filter in the callback. (c) **Polling fallback for unreliability** — pair the watcher with a `setInterval`-driven `fs.statSync(path).mtimeMs` change-detection behind the same reload callback so the two paths stay in sync (chokidar still ruled out).
- **ESM-only implication for M2 webview build target:** The current `package.json` has `"type": "module"` (ESM-only). The extension host bundle is compiled by esbuild to CJS for VS Code compatibility — esbuild handles this. For the webview bundle, vanilla TS with esbuild is ESM-native and works correctly in the VS Code webview context (`vscode-webview://` origin, `enableScripts: true`). **No CommonJS shim is needed for the webview.** The host bundle must target CJS (`--format=cjs` in esbuild) because VS Code's extension host still loads extension entry points as CommonJS modules. The webview bundle can target ESM or IIFE (`--format=iife` is simplest — no module loader in webview context). Do NOT use `--format=esm` for the webview entry — VS Code webviews do not support ES module imports in the injected script tag without an import map. Use `--format=iife` and a single bundled output file. Source: Bram's research `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"VS Code API surface" + Pixel Agents' build pattern (their webview is a single bundled IIFE).
