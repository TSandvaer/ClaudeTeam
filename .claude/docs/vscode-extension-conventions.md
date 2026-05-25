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

## Build & package

- **Bundler:** `esbuild` for both host and webview. Speed matters during dev (reload-test loop).
- **Host bundle MUST emit as CJS with `.cjs` extension** — output `dist/extension/main.cjs` (not `.js`). VS Code's extension host runs Node 22+, which raises `ERR_REQUIRE_ESM` if it sees `.js` under any ESM-ambiguous resolution (this project's `package.json` has no `"type"` field; Node 22+ treats sibling `.js` files as ESM when called through `require()`). The `.cjs` extension is the canonical disambiguation. Verify after every build: `node -e "require('./dist/extension/main.cjs')"` exits 0. **`package.json` `main` field must match** the actual extension (`dist/extension/main.cjs`). Webview bundle stays `.js` (IIFE format — runs in browser context, no require() involved). Resolved by `4a41634` (`86c9y9yzu`); source-of-truth comment block lives in `esbuild.config.mjs` next to the host outfile config.
- **Watch mode:** `npm run watch` rebuilds both bundles on file change.
- **Packaging:** `vsce package` produces a `.vsix`. Manifest-touching PRs must include the `vsce package` output in the Self-Test Report (catches malformed `contributes` early). After `vsce package`, optionally re-extract the `.vsix` and verify `node -e "require('./extension/dist/extension/main.cjs')"` exits 0 on Node 22+ — catches packaging-time regressions in the bundle-format chain.
- **Dev-only TS scripts triple-edit pattern:** any new top-level dev-only TS directory (e.g. `scripts/measure-cadence.ts`) requires three coordinated edits — (1) the source file itself, (2) `tsconfig.json` `include` entry so `npm run typecheck` covers it, (3) `.vscodeignore` exclusion so `vsce package` doesn't ship it inside the `.vsix`. Missing any one creates a partial failure: skip (2) and typecheck doesn't enforce it; skip (3) and the `.vsix` balloons with dev tooling that has no business shipping to users. Codified after M4-04 PR #59 (`d9b1b49`) where the gap was caught in the `vsce package --no-yarn` Self-Test step.
- **Pre-commit:** typecheck + lint + unit tests. No `--no-verify`.

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

## Open questions (decide during M2)

- **UI framework:** Decided — **vanilla TypeScript** for M2. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"Webview UI tech recommendation" for the full analysis. React is not recommended at ClaudeTeam's tile count (6 rostered + background chip). Svelte is the upgrade path if vanilla TS proves ergonomically painful at M2-05 scope — NOT React. The webview entry is `src/webview/main.ts` (not `.tsx`).
- **Reactive store inside webview:** Defer until Maya starts M2-05 and encounters the actual re-render surface. A plain `EventEmitter` or hand-rolled observable on the message-receiver is sufficient; no framework store needed at this scale.
- **Filesystem watcher implementation:** Decided — `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (VS Code ≥1.64, within the `^1.85.0` engine floor) for `~/.claude/sessions/*.json` and `~/.claudeteam/*.yaml` (M3 roster). Pair with `setInterval` (2000ms default) for JSONL tailing. Do NOT add chokidar — zero-dep alternative is available. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"File-watcher approach" for the original decision matrix. **Three out-of-workspace caveats validated PR #32 (`7d14976`, `team/bram-research/m3-prior-art-2026-05-24.md`):** (a) **`RelativePattern` is mandatory** — `createFileSystemWatcher("/home/user/.claudeteam/*.yaml")` (plain string) silently fails for paths outside `workspace.workspaceFolders` with no error, just no events; always use `new vscode.RelativePattern(vscode.Uri.file(rosterDir), '*.yaml')`. (b) **Use a glob (`*.yaml`), not the literal filename** — VS Code issue #164925 reports single-filename patterns may not fire reliably (issue closed, fix-version unpinned); filter in the callback. (c) **Polling fallback for unreliability** — pair the watcher with a `setInterval`-driven `fs.statSync(path).mtimeMs` change-detection behind the same reload callback so the two paths stay in sync (chokidar still ruled out).
- **ESM-only implication for M2 webview build target:** The current `package.json` has `"type": "module"` (ESM-only). The extension host bundle is compiled by esbuild to CJS for VS Code compatibility — esbuild handles this. For the webview bundle, vanilla TS with esbuild is ESM-native and works correctly in the VS Code webview context (`vscode-webview://` origin, `enableScripts: true`). **No CommonJS shim is needed for the webview.** The host bundle must target CJS (`--format=cjs` in esbuild) because VS Code's extension host still loads extension entry points as CommonJS modules. The webview bundle can target ESM or IIFE (`--format=iife` is simplest — no module loader in webview context). Do NOT use `--format=esm` for the webview entry — VS Code webviews do not support ES module imports in the injected script tag without an import map. Use `--format=iife` and a single bundled output file. Source: Bram's research `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"VS Code API surface" + Pixel Agents' build pattern (their webview is a single bundled IIFE).
