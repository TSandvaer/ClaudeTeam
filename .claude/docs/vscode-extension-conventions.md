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

- **UI framework:** React / Svelte / vanilla. Recommendation track: lightest option that supports state-driven re-renders cleanly. Decide based on bundle size and dev ergonomics.
- **Reactive store inside webview:** Zustand / Svelte stores / hand-rolled. Picks itself once the framework is chosen.
- **Filesystem watcher implementation:** Node `fs.watch` (cross-platform but flaky) vs `chokidar` (more reliable, +dep). Bram researches; Felix decides.
