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

## `[hidden]`-toggled flex/grid popovers need an explicit guard

**Rule:** any webview element whose visibility is toggled via the `hidden` attribute (`el.hidden = true/false`) AND whose CSS rule declares `display: flex | grid` MUST also carry an explicit `.<class>[hidden] { display: none }` guard. An author `display` rule **overrides the UA `[hidden] { display: none }` default** (author beats UA), so `el.hidden = true` has no visual effect — the element renders OPEN.

**Why it ships green:** jsdom (the unit-test DOM) applies **no author CSS**, so `expect(el.hidden).toBe(true)` passes even though the element is visually open in a real browser. Unit tests cannot catch this class; it only surfaces in a live VS Code reload. Hit twice in epic 86ca11187 — remove-confirm panel (PR #120→fix #122) and the show-hidden reveal list (`.ct-hidden-members-list`, fixed in #122 `2921f60`). Guarded popovers on main: `.collapsed-persona-instances[hidden]`, `.chip-detail-list[hidden]`, `.roster-error-chip-details[hidden]`, `.agent-tile-overflow-menu[hidden]`, `.agent-tile-remove-confirm[hidden]`, `.ct-hidden-members-list[hidden]` (see `src/webview/styles/dashboard.css`). Inline/`display:block` elements need no guard — the UA rule works for them.

**Coverage discipline:** the guard test MUST be **source-derived, not a hardcoded allowlist.** Scan `src/webview/components/**` for every `hidden`-toggled class, resolve which ones declare `display:flex|grid` in `dashboard.css`, and assert each has a `[hidden]` guard (`tests/unit/webview/removeMember.test.ts:330` — "guards every hidden-toggled flex/grid popover … derived from source"). A hardcoded selector list silently misses the next new popover (that's exactly why #122's first attempt passed CI while `.ct-hidden-members-list` stayed broken). The derived test must be non-vacuous — stripping any guard makes it fail.

## Re-render-resume discipline: survive the poll tick AND resume on the displayed frame

The dashboard pushes a full `state:full` snapshot every ~2s; `onStateFull → renderFull` can root-swap a component while it has live, in-progress state. Several distinct gotchas surfaced building the playback tuner + sprite tiles — all pass jsdom unit tests and only bite on a live reload (same blind spot as the `[hidden]` gotcha above):

- **Stateful panels must survive `renderFull`.** A component whose state lives only in its own render closure (selection, draft, slider positions, an open/expanded flag) is wiped every poll tick when a fresh instance is swapped in — e.g. the open tuner snapped back to the first character every ~2s. **Fix pattern:** hoist the survivable fields into a single boot-closure **tracker** threaded through `RenderContext` (mirror the Manage Team `pickerOpenTracker`); the fresh component seeds from it on mount and writes back on every change. Reset the tracker on panel open + close so nothing leaks between sessions. Cite: tuner B1, PR #164 (`tunerStateTracker.ts`); the required test must drive a **second** `renderFull` and assert state survival — a single-mount test is vacuous w.r.t. this class.

- **A resume snapshot must report the DISPLAYED state, not the already-advanced next state.** `SpriteBoxHandle.currentFrame()` originally returned the *post-advance* `{frameIdx, direction}` (what `tick()` queued next). A poll re-render landing mid-dwell then re-mounted on the **next** frame — skipping the on-screen frame and dropping its remaining hold (the "slow speed restarts before it finishes" symptom, visible because peak/final dwells of 600–2000ms exceed the 2s poll interval). **Fix pattern:** capture what is actually shown at the *top* of the step (`shownIdx`/`shownDirection`, before advancing) and report *that* for restoration. Cite: `86ca2apxn` #1, PR #165 (main `a8706b8`), `src/webview/sprites/spritePlayer.ts`; the test drives a re-render mid-dwell and asserts the shown frame + remaining hold survive (`spritePlayerWindowed.test.ts`).

- **The baked sprite manifest is a LOAD-TIME snapshot — in-session saves don't update it, so any re-seed reads stale.** `GENERATED_SPRITE_MANIFEST` (`src/webview/sprites/generatedManifest.ts`) is imported once at webview module load. Host-side override saves (`playbackOverrideWriter.ts`) write to `animations.json` on disk and the save-ack carries only `{ok, error}` — it does **not** push the new value back into the webview's in-memory manifest. So any UI that **re-seeds from the manifest** after a save — character switch, animation switch, close+reopen (`readSavedPerCharOverride` / `seedControlsForWriteTarget` / `computeCascadeSource`) — reads the value baked at load, NOT the just-saved one. Symptom: sponsor tuned all M01 anims, switched M01→F01→M01, saw every control "reset" (disk was correct throughout — display-only / near-data-loss). **Fix pattern:** a boot-owned webview-local **live overlay** that records each *confirmed* save (ok ack only) and overlays it field-level (set/clear, mirroring the host `mergePlaybackEntry`) onto the baked manifest; all seed/cascade/window reads go through the overlaid manifest. Cite: `86ca2wrnq`, PR #174 (main `8df4eff`, `src/webview/liveManifestOverlay.ts`). **Test discipline:** save through the *real* save path so the in-memory source updates, THEN re-seed **without re-feeding a fresh manifest** — a test that hands the component a manifest already reflecting the save is vacuous w.r.t. this class (it masks the bug exactly as a rebuild does). **Diagnostic trap:** a `npm run dev:install` "fixes" the symptom because it rebuilds the manifest fresh from disk — so **"works after dev:install" does NOT prove a stale-read bug is environmental.** The real repro is in-session with no rebuild between save and re-seed. (`86ca2vuzr` was wrongly closed "environmental" on a dev:install retest; `86ca2wrnq` is the real fix.) Related: `npm run build` only re-bundles to disk — it does NOT reinstall the running extension; only `npm run dev:install` updates what VS Code serves.

  - ⚠️ **TUNABLE_KEYS parity invariant (greppable — re-seed defect class #213/#214).** The host writer's `TUNABLE_KEYS` (`src/extension/sprites/playbackOverrideWriter.ts`) and the webview live-overlay's `TUNABLE_KEYS` (`src/webview/liveManifestOverlay.ts`) MUST stay **identical AND exhaustive** vs every optional field of `TunablePlaybackOverride` (`playbackOverrideWriter.ts`). They drive the same field-level set/clear merge on two sides of the wire; a key present on one list but missing from the other re-seeds stale for that field. The apex (`dwellFrameIndex`/`dwellMs`, `#213`/`86ca2bqe1`) and window (`startFrame`/`endFrame`, `#214`/`86ca7yumw`) gaps were exactly this — the overlay omitted keys the writer owned, so in-session re-seed dropped them. **When adding a tunable field, edit BOTH arrays + the `TunablePlaybackOverride` interface in the same PR.** (Endorsed Felix PR #214 review; Sage concurred in QA — PR #214 issuecomment-4691233062.) **Exception — `sceneId` is intentionally NOT in either `TUNABLE_KEYS` array (PRs #217/#218):** it rides the same `ui:save-playback-override` wire payload (`src/shared/messages.ts` ~404) but `liveManifestOverlay.ts` (~254-259) splits the mixed payload — `sceneId` → the `scenes`/`sceneDefaults` block, playback keys → the playback block. Adding `sceneId` to either array would mis-route it through the playback merge path. It is the only current exception to the exhaustiveness mandate; document any future same-wire-different-block exception inline here.

- **A re-render must carry the displayed frame's ELAPSED on-screen time forward, or a long hold never advances.** Distinct from the displayed-vs-advanced bullet above (that fixed *which* frame to report; this fixes the frame *clock*). The sprite box is rebuilt on every ~2s poll re-render; the rebuilt box reset its per-frame clock to 0. When the re-render cadence is shorter than the displayed frame's *remaining hold* — a peak/final dwell of 600–2000ms, or a fast out-of-band `onDidDelete` tick under the 320ms slow-frame interval — the box was disposed and re-mounted on the same frame *before its `tick()` timer could fire*, so that frame re-showed forever. Symptom: idle sprite "frozen on one frame"; the **frozen tile set shuffled across reloads** (bram/maya/nora → bram/felix → none) because it's per-*pose* (whichever tile currently sits on a long-hold frame), not per-character — and a fresh `dev:install` "fixes" it only because the tiles re-roll onto short-hold poses (same "works after rebuild ≠ not-a-bug" trap as the manifest bullet). **Fix pattern:** `SpriteBoxHandle.currentFrame()` reports `elapsedMs` (on-screen time via an injectable monotonic clock — `nowMs ?? performance.now() ?? Date.now()`, kept deterministic in tests); the resuming box back-dates its clock so `remainingHold = max(1, hold − carry)` shrinks each poll until it floors to 1ms and the timer fires. Thread `elapsedMs` host-free through `spriteTracker` + every tile caller. Preserves the displayed-frame + mid-dwell behavior above. Cite: `86ca3a7x3`, PR #179 (main `882a99b`, `src/webview/sprites/spritePlayer.ts` + `spriteTracker.ts`). **Test discipline:** drive ticks across the loop boundary under a re-render cadence *shorter* than the frame hold and assert the frame advances; the carry must be mutation-verified non-vacuous (zeroing it fails the advance assertions) — `spritePlayerIdleAdvance.test.ts`.

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

**`npm run build` does NOT reinstall the extension — use `npm run dev:install`.** A second, distinct dogfood trap (hit 2026-06-01, ticket `86ca2vuzr`): `npm run build` = `node esbuild.config.mjs`, which only re-bundles to `dist/` (and regenerates `generatedManifest.ts`). It does NOT package or install. So `npm run build` followed by `Developer: Reload Window` keeps VS Code serving the *previously-installed* `.vsix` — the reload reloads the OLD extension, not your new bundle. `npm run dev:install` (= `dev-package.mjs && dev-install.mjs`, cache-busted `0.0.1-dev.<ts>`) is the one-command path that actually updates what VS Code runs. **Symptom this produced:** sponsor tuned an animation, saved (correctly written to `animations.json` AND baked into `generatedManifest.ts`), ran `npm run build` + reload, and reported "my saved values are gone" in both the tuner and the tile — because the running bundle was the stale pre-save install. The data was never lost. **Triage rule:** before treating a "saved value not reflected after rebuild" report as a code bug, confirm the sponsor ran `npm run dev:install` (not bare `npm run build`) — verify the running bundle is fresh, not just the on-disk sources.

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

## Sprite manifest rendering: per-character render-fit and scene-path semantics

### Per-character render-fit normalization (`render:` block in `animations.json`)

v3 92×92 persona sprites frame the figure as only ~50% of the canvas (≈46–51px figure + ~20–24px transparent bottom margin) versus ~75% for the older 68×68 characters. Because `.sprite-frame` uses `object-fit: contain` on a fixed `--ct-sprite-size` box, `contain` fits the entire canvas — so a v3 figure renders at ~0.7× apparent size and floats high in the tile relative to older chars.

**Fix pattern (PR #203, merged main `8008f2b`):** an optional `render: { scale, offsetY }` block in `assets/sprites/<Char>/animations.json`:

```json
"render": { "scale": 1.5, "offsetY": 4 }
```

- `scale` — CSS scale multiplier; v3 chars seeded at `1.5`.
- `offsetY` — percentage of the box; positive = down/forward; v3 chars seeded at `4`.

This is parsed into `SpriteRenderFit` in `src/webview/sprites/spriteManifest.ts` and applied as a CSS transform on `.sprite-frame` via `:root` tokens `--ct-render-scale` / `--ct-render-offset-y` in `dashboard.css`. **Characters with NO `render` block are a true no-op** (identity scale 1 / offset 0) — existing rendering is byte-identical to before.

`sanitizeRenderFit` in `scripts/build-sprite-manifest.mjs` clamps / drops non-finite values at build time.

**Tuning without a rebuild:** the `:root` tokens in `dashboard.css` can be edited directly for a preview; bake the final values into `animations.json` and re-run `npm run build` to persist.

Test: `tests/unit/webview/spriteRenderFit.test.ts`.

### Scene backgrounds are PATH-referenced, not data-URI baked (PR #204)

Only CHARACTER sprite frames are baked as data URIs into `src/webview/sprites/generatedManifest.ts`. SCENE images (e.g. `assets/sprites/scenes/room3.png`) are stored as a stable relative path (`sprites/scenes/room3.png`) in the manifest — NOT as inline bytes.

**Consequence:** swapping or adding a scene PNG produces **no diff in `generatedManifest.ts`** — this is by design, not a bug. The new bytes reach the runtime via the build's scene-copy step into `dist/webview/sprites/scenes/`. `defaultScene()` resolves the path; `tests/unit/webview/spriteManifest.test.ts:~210` asserts `room3` as the default.

**Practical rule for new scenes:**
1. Swap or add the PNG under `assets/sprites/scenes/`.
2. Run `npm run build` (triggers the scene-copy step).
3. Do NOT expect `generatedManifest.ts` to change — an empty git diff on that file after adding a scene is correct.
4. Do NOT hardcode scene pixel bytes in tests — test against the resolved path string, not the file content.

### Scene-per-pose: 3-layer cascade and resolver (PRs #216-#218)

Each tile resolves its backdrop per character+pose via a **3-layer cascade** (authoritative spec: `team/iris-design/scene-per-pose-spec.md` — NOT auto-preloaded for sub-agents; read it explicitly when touching scenes/tuner/cascade):

1. **Per-character `scenes` block** — `assets/sprites/<Char>/animations.json` → `scenes: { "<animName>": "<sceneId>" }` (highest priority).
2. **Pose-default `scenes` block** — `assets/sprites/pose-defaults.json` → same shape, shared across characters.
3. **Manifest `defaultSceneId`** — the registry floor (`room3`).

**3-state values:** a real scene id (use it), the sentinel `"none"` / `SCENE_NONE` (`src/webview/sprites/spriteManifest.ts:347`, flat card — stops the cascade), or **absent** (inherit the next layer). Resolver: `resolveSceneId` (`spriteManifest.ts:380`); shared paint+crossfade consumer: `src/webview/sprites/sceneBackdrop.ts`.

**Locked sponsor decision (2026-06-12):** `pose-defaults.json` seeds `scenes: { "active_work": "none", "active_read": "none" }` — desk poses carry a baked desk, so the room backdrop would double the furniture; idles inherit `room3`. The PR #217/#218 test updates asserting flat-card on `active_work` are intentional — do NOT "fix" them back to a scene id without a sponsor decision.

**Tuner Scene picker** writes the per-char `scenes` block via the same `ui:save-playback-override` wire — see the `sceneId` exception in the TUNABLE_KEYS parity invariant above.

## Open questions (decide during M2)

- **UI framework:** Decided — **vanilla TypeScript** for M2. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"Webview UI tech recommendation" for the full analysis. React is not recommended at ClaudeTeam's tile count (6 rostered + background chip). Svelte is the upgrade path if vanilla TS proves ergonomically painful at M2-05 scope — NOT React. The webview entry is `src/webview/main.ts` (not `.tsx`).
- **Reactive store inside webview:** Defer until Maya starts M2-05 and encounters the actual re-render surface. A plain `EventEmitter` or hand-rolled observable on the message-receiver is sufficient; no framework store needed at this scale.
- **Filesystem watcher implementation:** Decided — `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (VS Code ≥1.64, within the `^1.85.0` engine floor) for `~/.claude/sessions/*.json` and `~/.claudeteam/*.yaml` (M3 roster). Pair with `setInterval` (2000ms default) for JSONL tailing. Do NOT add chokidar — zero-dep alternative is available. See `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"File-watcher approach" for the original decision matrix. **Three out-of-workspace caveats validated PR #32 (`7d14976`, `team/bram-research/m3-prior-art-2026-05-24.md`):** (a) **`RelativePattern` is mandatory** — `createFileSystemWatcher("/home/user/.claudeteam/*.yaml")` (plain string) silently fails for paths outside `workspace.workspaceFolders` with no error, just no events; always use `new vscode.RelativePattern(vscode.Uri.file(rosterDir), '*.yaml')`. (b) **Use a glob (`*.yaml`), not the literal filename** — VS Code issue #164925 reports single-filename patterns may not fire reliably (issue closed, fix-version unpinned); filter in the callback. (c) **Polling fallback for unreliability** — pair the watcher with a `setInterval`-driven `fs.statSync(path).mtimeMs` change-detection behind the same reload callback so the two paths stay in sync (chokidar still ruled out).
- **ESM-only implication for M2 webview build target:** The current `package.json` has `"type": "module"` (ESM-only). The extension host bundle is compiled by esbuild to CJS for VS Code compatibility — esbuild handles this. For the webview bundle, vanilla TS with esbuild is ESM-native and works correctly in the VS Code webview context (`vscode-webview://` origin, `enableScripts: true`). **No CommonJS shim is needed for the webview.** The host bundle must target CJS (`--format=cjs` in esbuild) because VS Code's extension host still loads extension entry points as CommonJS modules. The webview bundle can target ESM or IIFE (`--format=iife` is simplest — no module loader in webview context). Do NOT use `--format=esm` for the webview entry — VS Code webviews do not support ES module imports in the injected script tag without an import map. Use `--format=iife` and a single bundled output file. Source: Bram's research `team/bram-research/m2-vscode-prior-art-2026-05-23.md` §"VS Code API surface" + Pixel Agents' build pattern (their webview is a single bundled IIFE).
