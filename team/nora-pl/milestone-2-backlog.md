# M2 Backlog — Extension Scaffold

Nine tickets. Output: a VS Code extension installable as a `.vsix` that opens an Activity Bar webview showing a hardcoded (static-fixture) version of the M1 agent tree. Validates the extension scaffold, webview message protocol, and file-watcher loop before any live-data wiring exists.

Each entry is dispatch-ready — the orchestrator can lift any ticket into a brief without further clarification from Nora.

ClickUp IDs are appended once the orchestrator creates tickets in list `901523520912` after sponsor approves M2 scope.

---

## M2/M3 scope-overlap note (AC9 — sponsor decision pending)

**Situation:** V1-PLAN's milestone table lists roster config ("Load `teams.yaml`, apply matchers, render named tiles vs background bucket") under M3. However, the roster loader and matcher shipped in M1 (M1-08, commit `6c0edae`). The matcher is already live on `main`.

**Consequence:** M2's "hardcoded webview" milestone can either:

- **Option A (recommended) — absorb named-tile rendering into M2.** Since the matcher is already available, "hardcoded" can mean "uses fixture data run through the real matcher against a seeded test roster" rather than "literally hardcoded strings." This collapses the M2/M3 boundary for the matching surface and lets M3 focus on roster-config UI, live YAML watching, and interactive drill-in. **This is the recommended path** — it is lower-risk than shipping a webview that ignores the matcher and then ripping it out in M3.

- **Option B — pure hardcoded strings in M2, save matcher wiring for M3.** Keeps M2 minimal (no matcher call in the webview render path) but adds a guaranteed rework in M3 and means two sequential PRs touch the same render layer.

**This decision is queued for sponsor.** The backlog is written for Option A (recommended). If sponsor chooses Option B, M2-05 (dashboard tile) and M2-06 (extension integration) need their scope narrowed. Orchestrator should surface this choice before dispatching M2-05 and M2-06.

Decision draft: "Accept Option A — M2 absorbs named-tile rendering using the already-merged matcher, freeing M3 to focus on roster-config UI and live YAML watch. M3 milestone is renamed to 'Roster config + live refresh' to reflect the reduced scope."

---

## M2-01 — `feat(scaffold): VS Code extension manifest + build pipeline`

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** M
**Priority:** P0 (blocking — everything downstream requires a packageable extension)
**Source:** V1-PLAN "VS Code shell" + "M2 Extension scaffold"; `.claude/docs/vscode-extension-conventions.md` "Extension manifest essentials" + "Build & package"

### Scope

Wire the repo's existing TypeScript scaffold (M1-01) into a valid VS Code extension: add `main`, `contributes`, `activationEvents`, `engines.vscode` to `package.json`; add an esbuild config that produces both a host bundle and a (placeholder) webview bundle; confirm `vsce package` produces a valid `.vsix`. No live data, no message protocol — just a packageable extension with an empty webview placeholder.

### Acceptance criteria

- AC1: `package.json` gains `main: "dist/extension/main.js"`, `engines.vscode: "^1.85.0"` (or the minimum Bram's M2-02 prior-art research recommends — Felix waits for M2-02 to land before finalizing this field), `publisher: "claudeteam"`, `displayName`, `version: "0.0.1"`.
- AC2: `contributes.views` registers `claudeteam.dashboard` under a custom `viewsContainers` entry in the Activity Bar with a codicon placeholder (Iris's custom SVG is M4 work).
- AC3: `contributes.commands` includes at minimum: `claudeteam.refresh`, `claudeteam.openRoster`, `claudeteam.openAgentTranscript`.
- AC4: `contributes.configuration` includes: `claudeteam.rosterPath` (default `""`), `claudeteam.pollIntervalMs` (default `2000`), `claudeteam.showBackgroundCount` (default `true`).
- AC5: `activationEvents: ["onView:claudeteam.dashboard"]` — lazy activation only.
- AC6: `esbuild.config.mjs` (or equivalent) builds two bundles — `dist/extension/main.js` (CommonJS, external `vscode`) and `dist/webview/main.js` (IIFE, no external). `npm run build` exits 0.
- AC7: `src/extension/main.ts` exports `activate(context)` and `deactivate()`. `activate` registers the `WebviewViewProvider` (implementation is a stub at this ticket — provider renders an HTML page saying "ClaudeTeam loading…"). `deactivate` is a no-op.
- AC8: `src/extension/view/provider.ts` exports a class implementing `vscode.WebviewViewProvider`. `resolveWebviewView` sets a valid CSP (nonce-based, no inline scripts) and injects the webview bundle script tag. At this point the webview page body can be static HTML.
- AC9: `npm run build && vsce package --no-yarn` exits 0 and produces `claudeteam-0.0.1.vsix`. Felix pastes `vsce package` stdout in the Self-Test Report (extension-manifest gate per CLAUDE.md hard rule #4).
- AC10: `npm run watch` starts both host and webview esbuild watchers in parallel.
- AC11: CI workflow `ci.yml` gains a `vsce package --no-yarn` step on PRs targeting `main` (dry-run — does not publish; confirms the manifest is always packageable).
- AC12: Unit tests pass: `npm run typecheck && npm run test:unit`.

### Out of scope (OOS)

- No file-watcher wiring (M2-04's work).
- No message protocol (M2-05's work).
- No live data in the webview — static placeholder HTML only.
- No integration test runner setup (`@vscode/test-electron`) — M2-08's work.
- No custom SVG icon (M4).
- No `vsce publish` (not shipping to marketplace in V1).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run build
vsce package --no-yarn
# Exits 0; claudeteam-0.0.1.vsix produced
ls claudeteam-0.0.1.vsix
# File exists
npm run typecheck && npm run test:unit
# All tests pass
```

Self-Test Report on the PR must include `vsce package` stdout.

### Files in play

- Owned (Felix writes): `package.json` (add `main`, `engines`, `publisher`, `contributes`, `activationEvents`, `version`, `displayName`), `esbuild.config.mjs`, `src/extension/main.ts`, `src/extension/view/provider.ts`, `src/extension/messageBus.ts` (empty stub), `.vscodeignore`.
- Modified: `.github/workflows/ci.yml` (add vsce package step).
- Read-only references: `.claude/docs/vscode-extension-conventions.md`, `team/bram-research/m2-vscode-api-<date>.md` (M2-02 output — wait for it before finalizing `engines.vscode`).

### Conflict rule

If `engines.vscode` must be set before M2-02 lands (CI gates it), use `"^1.85.0"` as a conservative placeholder and note the pending update in the PR body. Do NOT block the PR on M2-02.

### Dependencies

- M1-01 (scaffold — already merged).
- M2-02 (Bram prior-art — informs `engines.vscode` minimum; see Conflict rule if M2-02 isn't yet merged).

---

## M2-02 — `research(vscode-api): VS Code Extension API prior-art + webview tech pick`

**Owner:** Bram
**Peer reviewer:** orchestrator-direct
**Size:** M
**Priority:** P0 (parallel with M2-01; informs M2-01's `engines.vscode` + M2-05's tile tech choice)
**Source:** M1 retro § Next-session backlog item 5; `.claude/docs/vscode-extension-conventions.md` "Open questions"

### Scope

Research the VS Code Extension API surfaces relevant to M2: `WebviewViewProvider` vs `WebviewPanel`, file-system watcher options (`vscode.workspace.createFileSystemWatcher` vs chokidar vs Node `fs.watch`), minimum VS Code engine version needed, and prior-art comparison (Pixel Agents extension internals as accessible, third-party Claude Code trackers if any exist). Deliver a research note the team can cite when making M2 tech picks.

### Acceptance criteria

- AC1: `team/bram-research/m2-vscode-api-<date>.md` exists with sections: (a) WebviewViewProvider vs WebviewPanel — which to use for an Activity Bar view and why; (b) File-system watcher comparison (chokidar vs `vscode.workspace.createFileSystemWatcher` vs Node `fs.watch`) with verdict for M2-04; (c) minimum `engines.vscode` version required for `WebviewViewProvider` + `createFileSystemWatcher` + `contributes.viewsContainers`; (d) Webview UI framework pick recommendation (React vs Svelte vs vanilla) — bundle size, dev ergonomics, re-render complexity at M2's scale.
- AC2: For each factual claim, Bram cites the source (VS Code docs URL, Pixel Agents source path, or "observed on disk at <path>"). No ungrounded claims.
- AC3: Pixel Agents interop section — Bram confirms the Pixel Agents extension's hook port (expected: 55271 per `.claude/docs/data-sources.md` "Pixel Agents coexistence"); confirms ClaudeTeam's planned port does NOT collide. Cites the actual server.json or hook registration observed.
- AC4: Prior-art section — lists any VS Code extensions or open-source tools that tail Claude Code transcripts, with a one-line verdict on whether any of them are worth forking vs building from scratch.
- AC5: Verdict section — a bulleted "Recommended decisions" block covering: (1) Activity Bar view type (WebviewViewProvider), (2) file-watcher choice with rationale, (3) minimum `engines.vscode` version, (4) webview UI framework. These become Felix and Maya's defaults for M2-01, M2-04, M2-05 unless sponsor overrides.
- AC6: Research note explicitly states "I verified each cited path exists" with the actual paths listed (same discipline as M1-02 AC9 — prevents downstream fabrication).

### Out of scope (OOS)

- No implementation code.
- No M3/M4 research — focus on what M2 needs to decide right now.
- No Pixel Agents feature comparison beyond port and hook registration (not trying to replace it).

### Done-when test

```bash
ls team/bram-research/m2-vscode-api-*.md
# File exists
# Note contains: WebviewViewProvider verdict, file-watcher verdict, engines.vscode minimum, framework pick, verified-paths statement
```

### Files in play

- Owned (Bram writes): `team/bram-research/m2-vscode-api-<date>.md`.
- Read-only references: `.claude/docs/vscode-extension-conventions.md`, `.claude/docs/data-sources.md` (Pixel Agents section), VS Code Extension API docs (web fetch), Pixel Agents extension source if accessible at `~/.vscode/extensions/pixel-agents-*` or equivalent.

### Conflict rule

If `WebviewViewProvider` is unavailable below a certain VS Code version, document the exact version gate and flag it — do not assume `^1.85.0` is always safe.

### Dependencies

- None. Zero-dep; can fire on Day 1 in parallel with M2-01, M2-03, M2-05.

---

## M2-03 — `spec(ux): M2 dashboard tile spec — webview layout + interaction`

**Owner:** Iris
**Peer reviewer:** Maya (visual) or Felix (data-shape edges)
**Size:** M
**Priority:** P0 (parallel with M2-01/02; Maya can't build the tile until the spec lands)
**Source:** `team/iris-ux/m1-cli-output-spec.md` §4 + §5 (divergences); V1-PLAN "VS Code shell"; `.claude/docs/vscode-extension-conventions.md` "Webview rules"

### Scope

Author `team/iris-ux/m2-dashboard-tile-spec.md` — the visual and interaction spec for the M2 webview dashboard. This inherits M1-03's vocabulary (`display`/`role`/`activity`/`model`/`state`, glyph-table states, background-chip structure) and specifies the divergences introduced by the webview context: wrapping vs truncation, click-to-drill interaction, background-chip collapsed state, VS Code theme variables, and error UI. Iris does NOT implement — she specs. Maya implements against this spec in M2-05.

### Acceptance criteria

- AC1: `team/iris-ux/m2-dashboard-tile-spec.md` exists with sections covering at minimum: (a) tile layout (how `display`/`role`/`activity`/`model`/`state` map to webview DOM elements); (b) state indicators — the four states from M1-03 §2 rendered as visual elements (colors use `--vscode-*` variables, not hardcoded hex, except the four semantic state colors which use hardcoded hex per `.claude/docs/vscode-extension-conventions.md`); (c) background-chip — collapsed vs expanded states, trigger (click), count always visible per M1-03 §4 bullet 3; (d) click-to-drill — clicking a rostered agent tile sends `{ type: "ui:open-transcript", payload: { sessionId, agentId } }` to the host per the message protocol in `src/shared/messages.ts`; (e) error UI — what renders when roster YAML is malformed or the file-watcher errors (per `roster-matching.md` "Loader edge cases"); (f) empty state — "No live Claude Code sessions" UI when the watcher returns an empty session list.
- AC2: Spec calls out explicitly where the CLI spec (M1-03) vocabulary is reused unchanged vs where the dashboard diverges. Minimum three divergences documented (per M1-03 §5: wrap vs truncate, click-to-drill, background-chip-collapsed state).
- AC3: Spec includes annotated wireframe sketches (ASCII-art or text-diagram format — not full-fidelity mockups; M4 is for polish). Each sketch is labeled with which theme variables apply.
- AC4: Spec identifies all CSS custom properties needed: at minimum `--vscode-foreground`, `--vscode-editor-background`, `--vscode-list-hoverBackground`, `--vscode-descriptionForeground`, and the semantic state hex values. Document each with its intended usage.
- AC5: Spec explicitly states the tile interaction contract — which elements are clickable, what message type they emit, and what the host is expected to do (open transcript, open roster, trigger refresh).
- AC6: Spec's "Dashboard-tile done-when" section lists the observable behaviors Maya's Self-Test Report must document: tile renders with correct field layout, state indicator updates on next poll, background chip collapses/expands on click, drill-in opens JSONL in VS Code editor, theme-switch leaves no broken styling.

### Out of scope (OOS)

- No animation, transitions, or motion (M4).
- No custom SVG icon for the Activity Bar container (M4).
- No in-webview transcript rendering (V1 uses VS Code's native JSONL viewer via drill-in).
- No roster-config editor UI (M3).
- No color palette beyond the `--vscode-*` variables + the four semantic state hex values.

### Done-when test

`team/iris-ux/m2-dashboard-tile-spec.md` exists and contains: ASCII wireframe, theme-variable list, interaction contract table, divergence list (min 3), error-UI spec, empty-state spec, done-when checklist for Maya's Self-Test Report.

### Files in play

- Owned (Iris writes): `team/iris-ux/m2-dashboard-tile-spec.md`.
- Read-only references: `team/iris-ux/m1-cli-output-spec.md` (inherited vocabulary), `.claude/docs/vscode-extension-conventions.md` ("Webview rules", "Message protocol"), `.claude/docs/roster-matching.md` ("Loader edge cases"), `src/shared/messages.ts` (existing message type shapes — read after M2-01 lands or use the types already specified in the conventions doc).

### Conflict rule

If `src/shared/messages.ts` doesn't exist yet when Iris starts (M2-01 hasn't landed), Iris uses the types documented in `.claude/docs/vscode-extension-conventions.md` "Message protocol" section as the authoritative shape and notes in the spec "pending M2-01 merge — types may be refined." Do not stall on M2-01.

### Dependencies

- M1-03 (CLI spec — already merged; Iris reads it as her inheritance baseline).
- M2-02 (Bram's framework verdict informs the HTML/CSS approach Iris specifies; can soft-depend — Iris writes the spec framework-agnostic and notes "see M2-02 for framework choice").
- M2-01 (message types in `src/shared/messages.ts`; see Conflict rule — can proceed without it).

---

## M2-04 — `feat(watcher): file-watcher polling loop (M1 data plane → live state)`

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** L
**Priority:** P1 (depends on M2-01; unblocks M2-06)
**Source:** V1-PLAN "Two-tier data plane" §1; `.claude/docs/architecture-overview.md`; AC5 of the M2 scoped contract

### Scope

Wrap M1's one-shot pure functions (`sessionRegistry`, `subagentTailer`, `metaJsonLoader`, `matcher`, `reducer`) in a polling loop that continuously produces updated `DashboardState`. The loop is owned by the extension host; it starts when `activate()` fires and the webview view resolves, and stops on `deactivate()`. This is the architectural seam between M1 (one-shot CLI) and M2 (live webview). Also extracts `cwdToSlug` into `src/shared/slug.ts` (M1-09-followup `86c9y6e17`).

### Acceptance criteria

- AC1: `src/extension/watcher/watcherLoop.ts` exports `startWatcher(context: vscode.ExtensionContext, claudeHome: string, onStateChange: (s: DashboardState) => void): Disposable`. The disposable stops the loop and cleans up on deactivation.
- AC2: Poll interval is read from `vscode.workspace.getConfiguration("claudeteam").get("pollIntervalMs")` (default 2000ms). The loop uses `setInterval` internally; the interval is cleared on dispose.
- AC3: On each tick: calls `listSessions(claudeHome)`, materialises agent tree by reading `meta.json` + tailing JSONL per session, runs the roster matcher, reduces to `DashboardState`, calls `onStateChange` if the state hash differs from the previous tick (skip re-render if nothing changed).
- AC4: State diff strategy — compute a shallow hash (e.g. `JSON.stringify(state)` length + spot-check a key field) sufficient to avoid redundant webview updates. An exact equality check is acceptable at M2 scale. Document the chosen approach in a code comment.
- AC5: `cwdToSlug` logic extracted to `src/shared/slug.ts` and exported. `src/cli/agentTree.ts` and `tests/integration/helpers/tempdir.ts` updated to import from the shared module (resolving M1-09-followup `86c9y6e17`).
- AC6: `src/extension/main.ts` calls `startWatcher` in `activate`, passing a callback that posts the state to the webview via `messageBus`.
- AC7: File-watcher uses the implementation recommended by Bram's M2-02 research note (either `vscode.workspace.createFileSystemWatcher`, chokidar, or Node `fs.watch`). If M2-02 hasn't landed yet, default to `setInterval`-based polling only (no native file events) and note "TODO: adopt file-event watcher per M2-02 findings."
- AC8: Integration test in `tests/integration/watcherLoop.test.ts` — builds a tempdir fixture, starts the watcher, mutates a file, asserts `onStateChange` fires within 4 seconds with the updated state. Uses existing tempdir helper from M1-10.
- AC9: All tests pass: `npm run typecheck && npm run test:unit && npm run test:integration`.

### Out of scope (OOS)

- No webview rendering (M2-05/M2-06 wires it in).
- No hook tap (post-V1 tier).
- No `vscode.workspace.createFileSystemWatcher` for `teams.yaml` — M3 work (YAML live-reload).
- No `--watch` mode for the CLI (CLI remains one-shot).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test:integration -- watcherLoop
# All tests green; onStateChange fires within 4s of file mutation
npm run typecheck
# Clean
```

### Files in play

- Owned (Felix writes): `src/extension/watcher/watcherLoop.ts`, `src/shared/slug.ts` (new — extracted from M1-09), `tests/integration/watcherLoop.test.ts`.
- Modified: `src/extension/main.ts` (wire watcher start/stop), `src/cli/agentTree.ts` (import slug from shared), `tests/integration/helpers/tempdir.ts` (import slug from shared), `src/shared/types.ts` (add `DashboardState` if not already defined).
- Read-only references: `.claude/docs/architecture-overview.md`, `.claude/docs/vscode-extension-conventions.md`, `team/bram-research/m2-vscode-api-<date>.md` (watcher choice), M1-05 through M1-09 module exports.

### Conflict rule

If `cwdToSlug` extraction causes a type or path mismatch with existing integration tests, fix it in this PR — this IS the M1-09-followup ticket `86c9y6e17`. Do NOT create a separate PR for the slug extraction; it is in-scope here.

### Dependencies

- M2-01 (extension scaffold — `main.ts` + `messageBus.ts` stubs must exist to wire into).
- M1-05 through M1-09 (all parsers + reducer — already merged).
- M2-02 (Bram's watcher recommendation; soft dependency per AC7).

---

## M2-05 — `feat(webview): dashboard tile renderer + message receiver`

**Owner:** Maya
**Peer reviewer:** Felix
**Size:** L
**Priority:** P1 (depends on M2-01 and M2-03; can start once M2-01's stub provider + M2-03's spec land)
**Source:** M2-03 (Iris's dashboard tile spec); `.claude/docs/vscode-extension-conventions.md` "Webview rules" + "Message protocol"; AC6 of the M2 scoped contract

### Scope

Implement the webview renderer: `src/webview/main.tsx` (or `.ts` for vanilla), component(s) that render a `DashboardState` into the tile layout per Iris's M2-03 spec, and `src/webview/messageReceiver.ts` that handles the host → webview `state:full` and `state:delta` messages. Also implement the webview → host message sends for `ui:open-transcript`, `ui:open-roster`, and `ui:refresh`. This PR is the webview half of the message bridge. The UI framework used is whichever Bram's M2-02 research recommends; if M2-02 is not yet merged, Maya coordinates with Felix to pick (vanilla TS is the safe default if research is inconclusive).

### Acceptance criteria

- AC1: `src/webview/messageReceiver.ts` exports `initMessageReceiver()` — calls `window.addEventListener("message", handler)`, dispatches incoming `HostMessage` objects to registered handlers.
- AC2: `src/webview/main.tsx` (or `.ts`) registers a handler for `state:full` and `state:delta`; on receipt, re-renders the dashboard.
- AC3: The dashboard renders: (a) one session block per `DashboardState.sessions` entry; (b) one team card per matched team within the session; (c) one tile per rostered agent with all five fields per Iris's spec (state indicator, display, role, activity, model); (d) background-noise chip with count + collapsed detail list; (e) empty state ("No live Claude Code sessions") when sessions array is empty.
- AC4: State indicators use the four semantic hex colors for `running` / `idle` / `finished` / `error` (document exact hex in code comment; align with Iris's spec AC4). All other colors use `--vscode-*` CSS variables.
- AC5: Background-chip expand/collapse works: click the chip → detail list toggles. Chip count is always visible (never hidden).
- AC6: Click on a rostered agent tile sends `{ type: "ui:open-transcript", payload: { sessionId, agentId } }` via `acquireVsCodeApi().postMessage(...)`.
- AC7: Re-render discipline: a new `state:full` message triggers a full DOM update; a `state:delta` message patches only the changed agent tiles. Diff at the message-receiver level (do not full-re-render on every tick).
- AC8: `src/webview/main.tsx` supports **static-fixture mode** — if the runtime `acquireVsCodeApi` is unavailable (running in a plain browser for dev), the webview renders from a hardcoded fixture `DashboardState` exported from `src/shared/fixtures.ts`. This lets Maya develop the tile layout without a running VS Code instance. The fixture must include at least one rostered agent in each state (`running`, `idle`, `finished`, `error`) and a background chip.
- AC9: `src/shared/fixtures.ts` (new) exports `FIXTURE_STATE: DashboardState` — a realistic hardcoded state with the ClaudeTeam roster populated with all six personas. Felix's reducer field names (`display`, `role`, `activity`, `model`, `state`) used verbatim (per M1-03 §6 glossary).
- AC10: Component tests in `tests/unit/webview/dashboardTile.test.ts` — render the tile component with each of the four states using a testing library; assert state indicator color class, display text, and activity text are present.
- AC11: Self-Test Report on the PR — Maya runs the full Layer-3 manual reload checklist from `.claude/docs/testing-strategy.md` "Manual reload checklist" and posts screenshots. Required: tile renders with all four states, background chip collapses/expands, theme switch (dark/light) leaves no broken styling, empty-state renders, error-UI renders.
- AC12: All tests pass: `npm run typecheck && npm run test:unit`.

### Out of scope (OOS)

- No live data wiring — the webview is triggered by fixture data at this ticket. Live data flows in M2-06.
- No drill-in handler on the host side (M2-06 wires `ui:open-transcript` handling).
- No roster-config editor UI (M3).
- No animations (M4).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-maya-wt
npm run build
# dist/webview/main.js produced
npm run typecheck && npm run test:unit
# All tests pass
```

Self-Test Report posted on PR with screenshots for each AC.

### Files in play

- Owned (Maya writes): `src/webview/main.tsx` (or `.ts`), `src/webview/messageReceiver.ts`, `src/webview/components/` (tile, session-block, background-chip components), `src/webview/styles/dashboard.css`, `src/shared/fixtures.ts`, `tests/unit/webview/dashboardTile.test.ts`.
- Read-only references: `team/iris-ux/m2-dashboard-tile-spec.md` (M2-03), `src/shared/messages.ts`, `src/shared/types.ts`, `.claude/docs/vscode-extension-conventions.md`.

### Conflict rule

If Iris's M2-03 spec is ambiguous about a visual detail (e.g., exact tile padding, chip expand animation), make a judgment call, document it in the PR body as "deviation from spec — reason: <X>", and file a follow-up note for Iris's M3 review pass. Do NOT stall on an Iris response.

### Dependencies

- M2-01 (provides the provider stub + `src/shared/messages.ts` skeleton — Maya can start on the renderer once the message types exist).
- M2-03 (Iris's tile spec — Maya should not implement against an unspecced visual layout).
- M2-02 (framework choice; if not landed, coordinate with Felix to pick; vanilla TS is the fallback).

---

## M2-06 — `feat(host): extension host ↔ webview message bridge integration`

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** M
**Priority:** P1 (depends on M2-04 + M2-05; integration ticket that connects the two halves)
**Source:** `.claude/docs/architecture-overview.md` "Process boundaries"; `.claude/docs/vscode-extension-conventions.md` "Message protocol"; AC6 of the M2 scoped contract

### Scope

Wire the extension host's file-watcher loop (M2-04) output to the webview renderer (M2-05) via `messageBus.ts`. Implement the host-side handlers for `ui:open-transcript`, `ui:open-roster`, and `ui:refresh` webview → host messages. After this PR, the extension shows live agent-tree data in the webview instead of the hardcoded fixture. This is the integration ticket; it touches both surfaces but adds minimal new logic.

### Acceptance criteria

- AC1: `src/extension/messageBus.ts` implements `postState(webview: vscode.Webview, state: DashboardState): void` — serializes state to `{ type: "state:full", payload: state }` and calls `webview.postMessage(...)`.
- AC2: `src/extension/view/provider.ts` `resolveWebviewView` hook registers a listener for `WebviewView.onDidReceiveMessage` and dispatches `WebviewMessage` objects to the appropriate host handler.
- AC3: Host handles `ui:open-transcript` by calling `vscode.window.showTextDocument(vscode.Uri.file(<jsonlPath>))`. The JSONL path is derived from `sessionId` + `agentId` per the slug convention in `src/shared/slug.ts`. If the file doesn't exist, show a `vscode.window.showErrorMessage(...)` — do not throw.
- AC4: Host handles `ui:open-roster` by calling `vscode.window.showTextDocument` on the resolved roster YAML path (global or project, whichever was loaded).
- AC5: Host handles `ui:refresh` by immediately triggering one watcher tick (call the tick function outside the poll interval).
- AC6: `src/extension/main.ts` wires: `startWatcher` → `postState` → webview on each state change. The watcher callback is registered in `resolveWebviewView`, not at activation time, so that the watcher only runs when the view is visible.
- AC7: Self-Test Report on the PR — Felix runs the manual reload checklist from `.claude/docs/testing-strategy.md` and posts evidence for: (a) live agent tiles appear after a few seconds with real `~/.claude/` data; (b) clicking a tile opens the correct JSONL file; (c) `ui:refresh` button triggers an immediate update; (d) Output channel shows no errors during a 30-second run.
- AC8: All tests pass: `npm run typecheck && npm run test:unit && npm run test:integration`.

### Out of scope (OOS)

- No `state:delta` partial-update optimization at this ticket — `state:full` on every tick is acceptable at M2. Delta is M4 optimization.
- No roster live-reload (YAML file watch triggers a re-read of `teams.yaml`) — M3 work.
- No error chip in the webview for file-watcher failures — M3 UX work.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run build
# Install vsix in VS Code manually:
# Extensions → Install from VSIX → claudeteam-0.0.1.vsix
# Open the Activity Bar → ClaudeTeam icon
# Agent tiles appear within ~5 seconds with live data from ~/.claude/
npm run typecheck && npm run test:unit && npm run test:integration
# All pass
```

Self-Test Report on the PR with screenshots of live tile data.

### Files in play

- Owned (Felix writes): `src/extension/messageBus.ts` (implement), `src/extension/view/provider.ts` (wire message listener + watcher callback).
- Modified: `src/extension/main.ts` (pass watcher callback through provider).
- Read-only references: `src/shared/messages.ts`, `src/shared/types.ts`, `src/shared/slug.ts`, `.claude/docs/vscode-extension-conventions.md`.

### Conflict rule

If `ui:open-transcript` path construction doesn't match the on-disk layout for a real session (slug derivation differs from what `cwdToSlug` produces), update `src/shared/slug.ts` in this PR. The slug is the canonical source of truth; don't add a second derivation path.

### Dependencies

- M2-04 (watcher loop must be merged — provides `startWatcher` and `DashboardState`).
- M2-05 (webview renderer must be merged — provides the webview end of the bridge).

---

## M2-07 — `test-plan(m2): M2 acceptance test plan + webview-smoke gate spec`

**Owner:** Sage
**Peer reviewer:** Felix
**Size:** S
**Priority:** P1 (parallel with M2-01/02/03; Sage authors this before QA is needed)
**Source:** `.claude/docs/testing-strategy.md`; CLAUDE.md hard rules #3 and #4; this backlog

### Scope

Author the M2 acceptance test plan that maps each M2 ticket's ACs to verification steps. The plan must specify how the webview-smoke gate (CLAUDE.md hard rule #3) is enforced on each M2 PR, and must define the Layer-3 `@vscode/test-electron` test coverage targets for M2-08.

### Acceptance criteria

- AC1: `team/sage-qa/test-plan-m2.md` exists with sections per ticket (M2-01 through M2-09) listing the verification steps Sage runs to sign off the ticket's PR.
- AC2: Webview-smoke gate section — specifies exactly which M2 tickets require the Self-Test Report (CLAUDE.md hard rule #3). At minimum: M2-01 (manifest gate), M2-05 (webview renderer), M2-06 (live integration). Extension-manifest gate (hard rule #4) applies to M2-01.
- AC3: Layer-3 coverage targets — the plan lists the `@vscode/test-electron` test cases M2-08 must implement: (a) activation lifecycle (event fires, view registers, no Output channel errors); (b) webview reload smoke (post-reload, dashboard renders with fixture state); (c) drill-in (click agent tile → JSONL opens in editor); (d) theme switch (dark/light → no broken styling).
- AC4: Self-Test Report checklist — the plan names the exact screenshot coverage Maya and Felix must provide per `.claude/docs/testing-strategy.md` "Self-Test Report contract". Sage's REQUEST CHANGES triggers are listed explicitly.
- AC5: Plan includes "M2 milestone done-when" — the compound check that proves M2 is shippable: extension installs from `.vsix`, Activity Bar icon appears, dashboard shows live agent tiles within 5 seconds, drill-in works, no errors in Output channel during a 30s run.
- AC6: Plan lists what is NOT tested in M2 (deferred to M3+): roster live-reload, `state:delta` partial updates, error-chip UI, custom SVG icon, animation.

### Out of scope (OOS)

- No test code (M2-08 owns implementation).
- No CI configuration changes.
- No M3/M4 test planning.

### Done-when test

`team/sage-qa/test-plan-m2.md` exists. Sage signs off M2 PRs by referencing this plan.

### Files in play

- Owned (Sage writes): `team/sage-qa/test-plan-m2.md`.
- Read-only references: `.claude/docs/testing-strategy.md`, CLAUDE.md (hard rules #3 and #4), this backlog, `team/iris-ux/m2-dashboard-tile-spec.md` (M2-03 — read after it lands).

### Conflict rule

If M2-03 hasn't landed when Sage starts, write the test plan with a placeholder "tile spec pending M2-03 — update AC coverage once spec lands." Do not block on M2-03.

### Dependencies

- M1-04 (M1 test plan — already merged; Sage uses it as structure template).
- M2-03 (Iris's tile spec; soft dependency per Conflict rule).

---

## M2-08 — `test(m2): Layer-3 VS Code integration tests (@vscode/test-electron)`

**Owner:** Sage
**Peer reviewer:** Felix
**Size:** M
**Priority:** P2 (depends on M2-06; all M2 code must be merged before integration tests can run)
**Source:** `.claude/docs/testing-strategy.md` "Layer 3"; M2-07 (Sage's test plan); CLAUDE.md hard rule #2

### Scope

Implement the `@vscode/test-electron` integration tests covering the four Layer-3 targets from M2-07's test plan. This PR wires the integration test runner into the repo (`tests/vscode-integration/` directory + the runner entry point) and implements the four test cases. Tests run on CI for PRs targeting `main`.

### Acceptance criteria

- AC1: `@vscode/test-electron` and related test runner packages added to `devDependencies`. `npm run test:vscode` runs the integration suite (downloads a test VS Code instance on first run — documented in PR body). CI `ci.yml` gains a `test:vscode` step that runs on PRs to `main`.
- AC2: `tests/vscode-integration/suite/activation.test.ts` — confirms the extension activates without errors: opens a VS Code window with the extension, opens the ClaudeTeam Activity Bar view, asserts no error messages appear in the Output channel within 5 seconds.
- AC3: `tests/vscode-integration/suite/webviewSmoke.test.ts` — confirms the dashboard renders after a `Reload Window` command: sends the reload command via VS Code API, waits for the view to re-register, asserts the webview HTML contains at least the tile container element (presence check, not content check — content is live data dependent).
- AC4: `tests/vscode-integration/suite/drillIn.test.ts` — confirms drill-in: posts a `ui:open-transcript` message to the extension with a fixture JSONL path; asserts `vscode.workspace.textDocuments` includes a document at that path.
- AC5: `tests/vscode-integration/suite/themeSwitch.test.ts` — confirms no broken styling: programmatically toggles VS Code theme between dark and light (via configuration update); asserts the webview iframe is still accessible (no crash).
- AC6: All four test suites green: `npm run test:vscode`.
- AC7: Sage posts findings of any bugs surfaced in Felix/Maya's modules as follow-up tickets (same discipline as M1-10 AC5 — do not fix production code in this PR).

### Out of scope (OOS)

- No Layer-1 or Layer-2 test changes (those are Felix's and Sage's M2-04 territory).
- No production code changes.
- No CI infrastructure changes beyond adding the `test:vscode` step.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-sage-wt
npm run test:vscode
# All four suites green
```

CI run shows `test:vscode` green on the PR.

### Files in play

- Owned (Sage writes): `tests/vscode-integration/suite/activation.test.ts`, `tests/vscode-integration/suite/webviewSmoke.test.ts`, `tests/vscode-integration/suite/drillIn.test.ts`, `tests/vscode-integration/suite/themeSwitch.test.ts`, `tests/vscode-integration/index.ts` (runner entry), `tests/vscode-integration/runTests.ts` (runner bootstrap).
- Modified: `package.json` (add devDependencies + `test:vscode` script), `.github/workflows/ci.yml` (add `test:vscode` CI step).
- Read-only references: `.claude/docs/testing-strategy.md`, `team/sage-qa/test-plan-m2.md` (M2-07), M2-06 merged output.

### Dependencies

- M2-06 (all integration pieces must be merged — Sage needs the full extension to test against).
- M2-07 (Sage's M2 test plan defines the four coverage targets).

---

## M2-09 — `chore(m1-followup): dispatch-template tightening + APPROVE_WITH_NITS elevation`

**Owner:** Nora
**Peer reviewer:** orchestrator-direct
**Size:** S
**Priority:** P2 (housekeeping; non-blocking for M2 code work)
**Source:** M1 retro § Durable lessons — "APPROVE_WITH_NITS verdict"; M1 retro § Patterns — "APPROVE_WITH_NITS is a load-bearing distinct verdict"

### Scope

Author the dispatch-template update that elevates `APPROVE_WITH_NITS` to an explicitly enumerated peer-review verdict alongside `APPROVE` and `REQUEST_CHANGES`. Update `agents/dispatch-template.md` (if it exists) or the equivalent template reference the orchestrator uses. Also update `.claude/docs/orchestration-overview.md` § PR & merge protocol to enumerate all three verdicts. This resolves the M1 retro action item flagged under "Durable lessons promoted."

### Acceptance criteria

- AC1: The cross-review verdict enumeration in `agents/dispatch-template.md` (or equivalent) explicitly lists: `APPROVE`, `APPROVE_WITH_NITS`, `REQUEST_CHANGES` with one-line definitions each. `APPROVE_WITH_NITS` definition: "PR ships as-is; NITs are filed as follow-up tickets before the next milestone close, not blocking this merge."
- AC2: `.claude/docs/orchestration-overview.md` § "PR & merge protocol" step 4 ("Peer-reviewer reviews") adds the three-verdict enumeration.
- AC3: No other process-docs changes (this is a narrow, targeted update — not a broad doc sweep).
- AC4: PR diff is ≤20 lines total — if it's larger, the scope has drifted; Nora should split.

### Out of scope (OOS)

- No changes to test plans or backlog files.
- No ClickUp-related updates.
- No retro authoring.

### Done-when test

```bash
grep -n "APPROVE_WITH_NITS" agents/dispatch-template.md
# Finds the definition line
grep -n "APPROVE_WITH_NITS" .claude/docs/orchestration-overview.md
# Finds the enumeration in PR & merge protocol
```

### Files in play

- Owned (Nora writes): `agents/dispatch-template.md` (if it exists at this path — verify before editing; if it doesn't exist, create it as a brief file with only the verdict enumeration block), `.claude/docs/orchestration-overview.md` (add verdict enumeration to § PR & merge protocol step 4).
- Read-only references: M1 retro `.claude/retros/retro-2026-05-23-m1-close.md` § Durable lessons.

### Conflict rule

If `agents/dispatch-template.md` does not exist at the expected path, do NOT invent a path. Check `agents/` directory content first; if absent, create the file with minimal content (the verdict enumeration block only) and note in the PR body that the file was created new.

### Dependencies

- None. Zero-dep; fires any time.

---

## Cross-references

| Ticket | Depends on | Blocks |
|---|---|---|
| M2-01 | M1-01 (merged) | M2-04, M2-05 (provides stubs + message types) |
| M2-02 | — | M2-01 (engines.vscode), M2-04 (watcher choice), M2-05 (framework pick) |
| M2-03 | M1-03 (merged) | M2-05 (tile spec), M2-07 (test plan AC coverage) |
| M2-04 | M2-01, M1-05–09 (merged) | M2-06 |
| M2-05 | M2-01, M2-03 | M2-06 |
| M2-06 | M2-04, M2-05 | M2-08 |
| M2-07 | M1-04 (merged) | M2-08 |
| M2-08 | M2-06, M2-07 | — |
| M2-09 | — | — |

---

## Throughput note

**Wave 0 (Day 1, zero-dependency — fire in parallel on first tick):**

- M2-01 — Felix: extension manifest + build pipeline (P0)
- M2-02 — Bram: VS Code API prior-art research (P0)
- M2-03 — Iris: dashboard tile spec (P0)
- M2-07 — Sage: M2 test plan (P1; non-blocking for code, ships parallel)
- M2-09 — Nora: dispatch-template tightening (P2; housekeeping, ships parallel)

**Wave 1 (after M2-01 + M2-03 merge — fire in parallel):**

- M2-04 — Felix: file-watcher loop (P1)
- M2-05 — Maya: webview renderer (P1)

**Wave 2 (after M2-04 + M2-05 merge):**

- M2-06 — Felix: extension host ↔ webview integration (P1)

**Wave 3 (after M2-06 + M2-07 merge):**

- M2-08 — Sage: Layer-3 VS Code integration tests (P2)

Expected parallelism peak: 5 agents in Wave 0 (M2-01 / M2-02 / M2-03 / M2-07 / M2-09). Load distribution improvement over M1: Felix owns 3 tickets (M2-01/04/06), Maya owns 1 (M2-05), Iris owns 1 (M2-03), Sage owns 2 (M2-07/08), Bram owns 1 (M2-02), Nora owns 1 (M2-09). M2 redistributes the M1 Felix-heavy load.

**M2 scope-overlap decision pending (see top of file):** if sponsor chooses Option B (pure hardcoded strings), M2-05 and M2-06 scope narrows. The orchestrator should surface this choice to sponsor before dispatching Wave 1.
