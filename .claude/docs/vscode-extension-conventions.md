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

## Webview rules

- **CSP-strict.** No inline scripts. No `eval`. Use nonces if any inline tag is unavoidable.
- **Theme variables only.** `--vscode-foreground`, `--vscode-editor-background`, `--vscode-list-hoverBackground`, etc. Hardcoded hex only for state indicators with semantic color meaning (red=error, green=running, yellow=idle).
- **State minimalism.** State that exists in the host should NOT be mirrored in the webview. The webview is a renderer; it owns ephemeral UI (hover, expansion, scroll), not domain data.
- **Re-render discipline.** A state change in the host should not cause a full re-render in the webview — diff at the message-receiver level.

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

## Build & package

- **Bundler:** `esbuild` for both host and webview. Speed matters during dev (reload-test loop).
- **Watch mode:** `npm run watch` rebuilds both bundles on file change.
- **Packaging:** `vsce package` produces a `.vsix`. Manifest-touching PRs must include the `vsce package` output in the Self-Test Report (catches malformed `contributes` early).
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
- **Filesystem watcher implementation:** Decided — `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (VS Code ≥1.64, within the `^1.85.0` engine floor) for `~/.claude/sessions/*.json`. Pair with `setInterval` (2000ms default) for JSONL tailing. Do NOT add chokidar — zero-dep alternative is available. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"File-watcher approach" for the decision matrix.
- **ESM-only implication for M2 webview build target:** The current `package.json` has `"type": "module"` (ESM-only). The extension host bundle is compiled by esbuild to CJS for VS Code compatibility — esbuild handles this. For the webview bundle, vanilla TS with esbuild is ESM-native and works correctly in the VS Code webview context (`vscode-webview://` origin, `enableScripts: true`). **No CommonJS shim is needed for the webview.** The host bundle must target CJS (`--format=cjs` in esbuild) because VS Code's extension host still loads extension entry points as CommonJS modules. The webview bundle can target ESM or IIFE (`--format=iife` is simplest — no module loader in webview context). Do NOT use `--format=esm` for the webview entry — VS Code webviews do not support ES module imports in the injected script tag without an import map. Use `--format=iife` and a single bundled output file. Source: Bram's research `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"VS Code API surface" + Pixel Agents' build pattern (their webview is a single bundled IIFE).
