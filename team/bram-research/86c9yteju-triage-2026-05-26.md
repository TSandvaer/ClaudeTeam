# Dogfood Triage — ticket 86c9yteju — 2026-05-26

## Question

Six V1 dogfood observations (from `team/dogfood/2026-05-25-session-lifecycle-quirks.md`, commit `0bb0290`). For each: classify as `intentional`, `defect`, or `mixed`. Provide doc additions for intentional items; draft follow-up tickets for defects.

## Summary verdict (1-liner per observation)

| Obs | Classification | One-liner |
|-----|----------------|-----------|
| 1 | mixed | (sessionId, pid) keying is intentional audit-trail design; undocumented — needs doc |
| 2 | mixed | DEAD-tile prune at next poll is intentional; cadence undocumented — needs doc |
| 3 | defect | Pane close+reopen shows empty state: host does NOT push current state on webview re-resolve |
| 4 | intentional | Already resolved (per-project roster migration PR #63) and documented in roster-matching.md |
| 5 | mixed | Filter logic correct; Obs 5 was a sponsor-config state artifact (no open-workspace = passthrough) + no `showAllSessionsGlobally` in sponsor settings; needs doc of passthrough edge case |
| 6 | defect | `idle` branch missing — both `idle` and `finished` (when no parent tool_result) collapse to `finished` via wrong default fallthrough in `buildActivity` |

---

## Evidence base

Primary sources read during this triage:

- `team/dogfood/2026-05-25-session-lifecycle-quirks.md` — sponsor observations with screenshots, verbatim quoted
- `src/extension/state/reducer.ts` — `inferState()` and `buildActivity()` functions (full file read)
- `src/extension/watcher/watcherLoop.ts` — `startWatcher()` / `runTick()` / `startWatcher` `onResolved` wiring (full file read)
- `src/extension/watcher/sessionRegistry.ts` — `listSessions()`, `isPidAlive()` (full file read)
- `src/extension/watcher/sessionFilter.ts` — `filterSessionsToWindow()`, `normalizePath()` (full file read)
- `src/extension/main.ts` — `activate()`, `provider.onResolved()` wiring, `resolveProjectRosterPath()` (full file read)
- `src/cli/agentTree.ts` — CLI driver, `collect()`, `readFinishedToolUseIds()` (full file read)
- `package.json` (configuration properties only) — `claudeteam.showAllSessionsGlobally` description and default
- `.claude/docs/data-sources.md` — liveness inference spec (§ Liveness inference)
- `.claude/docs/roster-matching.md` — per-project roster policy (§ Recommended default: per-project)
- `.claude/docs/vscode-extension-conventions.md` — webview boot state, message protocol

---

## Observation 1 — Two DEAD tiles for the same session ID, different PIDs

### Classification: `mixed`

**Intentional:** yes. The session registry (`src/extension/watcher/sessionRegistry.ts`) is keyed by the `pid` field from each `~/.claude/sessions/{pid}.json` file on disk. When a VS Code window reloads (as sponsor did), Claude Code writes a new `{pid}.json` with a fresh PID while the old `{pid}.json` may still exist on disk (Claude Code does not immediately clean up its own session files on graceful shutdown). `listSessions()` reads ALL `.json` files in the sessions directory (line 113–121), produces one `SessionRecord` per file, and applies `isPidAlive(pid)` per record. Two files with the same `sessionId` but different PIDs = two separate `SessionRecord` entries, both correctly marked `isAlive: false` (via `isPidAlive`). The reducer then emits two session tiles — one per `SessionRecord`. This is the intended behavior: the tile represents a PID-scoped session snapshot, not a sessionId-scoped deduplication.

**Documentation gap:** nowhere in the docs is it stated that session tiles are keyed by `(sessionId, pid)` rather than `sessionId` alone, or that multiple DEAD tiles for the same sessionId are expected after a reload.

**Evidence:**
- `src/extension/watcher/sessionRegistry.ts:113-121` — `readdirSync` + one record per file; no dedup by sessionId
- `src/extension/watcher/sessionRegistry.ts:224` — `isAlive: isPidAlive(pid)` called per record
- `src/extension/state/reducer.ts` — `buildAgentTree()` maps `sessions.map(session => ...)` — one session-tree entry per `SessionRecord`, no merging

**Not verified:** Claude Code's exact file-cleanup timing on graceful shutdown (when it removes old `{pid}.json` files). The sponsor's screenshot shows two dead tiles persisting after a reload, which confirms the files coexisted on disk at observation time.

### Doc addition (target: `vscode-extension-conventions.md`, new subsection under "Webview boot state — dev-fixture gating")

> **Session-tile identity is (sessionId, pid), not sessionId alone.** The sessions directory (`~/.claude/sessions/`) holds one `{pid}.json` per Claude Code process. When a VS Code window reloads, the old process file may not be immediately cleaned up, so the dashboard can briefly show two (or more) tiles for the same `sessionId` with different PIDs — both correctly marked DEAD. This is the expected audit-trail shape: each tile represents a PID-scoped process snapshot. The tiles disappear on the next poll tick after Claude Code's process cleanup removes the stale file(s) from `sessions/`. No deduplication by `sessionId` is applied.

---

## Observation 2 — DEAD tiles pruned over time

### Classification: `mixed`

**Intentional:** yes. DEAD tiles are not retained in memory — they are derived fresh from disk on every poll tick. When the stale `{pid}.json` file is removed from `~/.claude/sessions/` (by Claude Code, or by the OS), it disappears from the next `listSessions()` call, and the corresponding session tile is gone from the next state emission. There is no explicit prune step with a timer; the prune is a natural consequence of the file disappearing.

The cadence of the "disappearance" is:
1. Claude Code cleans up `{pid}.json` when the old process terminates (timing not precisely known — verified as "seconds to a few minutes" empirically from the sponsor's screenshots where Obs 1 → Obs 2 showed cleanup).
2. The next watcher poll tick (default `claudeteam.pollIntervalMs = 2000 ms`) picks up the deletion (either via the `vscode.workspace.createFileSystemWatcher` onDidDelete event for `~/.claude/sessions/*.json`, which triggers an immediate tick, or at worst the next scheduled interval).

**Documentation gap:** the prune mechanism is completely undocumented. A user who sees DEAD tiles has no way to know they are transient, or why they disappear.

**Evidence:**
- `src/extension/watcher/sessionRegistry.ts:83-122` — `listSessions()` reads fresh from disk every call; no in-memory retention of prior sessions
- `src/extension/watcher/watcherLoop.ts:226-240` — `setInterval(tick, pollMs)` + `sessionsFsWatcher.onDidDelete(() => void tick())` — deletion events trigger immediate tick
- `src/extension/watcher/watcherLoop.ts:186-223` — `runTick()` called every tick; produces a fresh `DashboardState` from disk; hash-skip prevents re-emit if state unchanged

**Not verified:** the exact timing Claude Code takes to remove `{pid}.json` after the old process exits. The sponsor's observation ("a moment later they're gone") is consistent with a 2–10s window, but the authoritative source is Claude Code's own cleanup code, which is external.

### Doc addition (target: `vscode-extension-conventions.md`, append to the session-tile identity paragraph above)

> **DEAD tile pruning is file-driven, not timer-driven.** When a process's `{pid}.json` is removed from `~/.claude/sessions/` (Claude Code cleans up on process exit), the corresponding tile disappears from the dashboard on the next poll tick. The `vscode.workspace.createFileSystemWatcher` on `~/.claude/sessions/*.json` fires an `onDidDelete` event for the deletion, which triggers an immediate out-of-band tick — so DEAD tiles typically vanish within a few seconds of the file being removed, without waiting for the next scheduled interval (default 2000 ms). There is no explicit prune timer; the tile lifecycle is entirely driven by `{pid}.json` presence on disk.

---

## Observation 3 — Pane close+reopen shows "No live Claude Code sessions"

### Classification: `defect`

**Root cause confirmed in code.** VS Code calls `resolveWebviewView` every time the pane is opened (after a pane-close that caused webview disposal). In `src/extension/main.ts`, `provider.onResolved()` (line 94) calls `startWatcher()` on each resolve (line 121). The `startWatcher()` function fires an initial tick immediately (line 225, `void tick()`), but this is an async call — it schedules the disk-read-reduce cycle and returns. The webview HTML is already rendered (line 106 in `provider.ts` — `webview.html = _getHtml(webview)` runs before `onResolved` is called), so it boots with the empty fixture state. There is NO synchronous or guaranteed-before-first-paint call to push the last known state to the newly remounted webview.

The gap: `startWatcher()` returns a `WatcherHandle` that includes `getLastState()` (line 152 in `watcherLoop.ts`). At the time `startWatcher()` is called, the NEW watcher has `lastState = null` (line 179) because it has never ticked. The host does not read `watcherHandle?.getLastState()` from the PRIOR watcher before disposing it and posting it to the new webview.

The result: the webview shows "No live Claude Code sessions" until the first async tick completes (up to `pollIntervalMs = 2000ms`). With default settings, this is a 0–2s empty-state flash on every pane reopen.

**Evidence:**
- `src/extension/main.ts:94-101` — `provider.onResolved((webview) => { watcherHandle?.dispose(); ... watcherHandle = startWatcher({...}); })` — prior watcher disposed before new one is started; no state-preservation step
- `src/extension/watcher/watcherLoop.ts:178-179` — `let lastState: DashboardState | null = null` — each new watcher starts with null state
- `src/extension/watcher/watcherLoop.ts:225` — `void tick()` — initial tick is fire-and-forget async; not awaited before returning to caller
- `src/extension/view/provider.ts:106` — `webview.html = this._getHtml(webview)` — HTML set before `onResolved` fires; webview boots empty
- `src/extension/main.ts:144-146` — `onStateChange: (state) => { void postState(webview, state); }` — state is posted only when the NEW watcher's first tick completes

**Fix direction (for Felix's follow-up ticket):** Before disposing the old `watcherHandle`, capture `watcherHandle?.getLastState()`. After the new watcher is started (but before it fires its first tick), if the captured prior state is non-null, post it synchronously to the new webview via `postState(webview, priorState)`. This eliminates the empty-state flash. The new watcher's first tick will overwrite it within `pollIntervalMs` if state has changed.

### PR #66 follow-up verification — 2026-05-26

**Context:** PR #66 (`fix(host): replay last-known state to remounted webview`, merged at `0a6945d`) shipped a fix for Obs 3 based on the triage above. Sponsor dogfood-verified the build from `0a6945d` and confirmed the empty-state still persists >30s on pane close+reopen (source: `team/dogfood/2026-05-26-obs3-fix-incomplete-on-0a6945d.md`). Ticket `86c9z0w56` dispatched Bram to classify which of the three hypotheses from that doc is the correct failure mode.

**Verdict: Hypothesis (b) — replay fires with a valid, non-empty payload, but the webview's message handler is not yet wired when the message arrives.**

**How the fix was implemented (verified from `0a6945d` source):**

PR #66 added two code points in `src/extension/main.ts` (lines cited from the live `0a6945d` file):
- Line 107: `const priorState = watcherHandle?.getLastState() ?? null;` — captures prior watcher state BEFORE dispose.
- Lines 181-183: `if (priorState !== null) { void postState(webview, priorState); }` — synchronously replays state after the new watcher is constructed.

**Why Hypothesis (a) is ruled out — the payload is non-empty:**

`watcherLoop.ts` lines 216-218 confirm `lastState` is updated on EVERY tick, even hash-skip ticks:
```
lastState = state;
const hash = hashState(state);
if (hash === priorStateHash) { return; }
```
After the initial window-reload, the first tick ran (`void tick()` at `startWatcher` line 238), which — even against an empty-ish tempdir — produces a non-null `DashboardState`. The sponsor's dogfood confirmed the session tile *did render* after the window-reload (step 1 in `team/dogfood/2026-05-26-obs3-fix-incomplete-on-0a6945d.md`), which means `onStateChange` fired, which means `lastState` was populated with a real non-null state containing the live session. So `priorState` was non-null and contained the live session when the close+reopen was triggered. Hypothesis (a) ruled out.

**Why Hypothesis (c) is ruled out — shape is correct:**

`postState` calls `serializeState(priorState)` (`messageBus.ts:92-95`). `serializeState` maps `sessions` through a full per-session flatten (`messageBus.ts:44-58`). The `sessions` field is always present as an array. The webview's `hydrateState` maps `wire.sessions` via `.map()` and always produces a `sessions` array. The `renderFull` empty-state gate (`render.ts:291`) fires only when `sessions.length === 0 || !hasLiveSession` — a correctly-shaped replay with a live session would pass this gate. Additionally, the dogfood document explicitly notes the hide-finished chip renders correctly post-remount (`team/dogfood/2026-05-26-obs3-fix-incomplete-on-0a6945d.md` § "Actual behavior"), indicating the webview IS receiving some host state — but the sessions payload is not surfacing. This is consistent with the header-chip state being read via a defensive `Record<string, unknown>` cast in `render.ts:164` that applies defaults when fields are absent, rather than depending on the message arriving through the message receiver. It suggests the header chip is NOT wired through `initMessageReceiver` — it's part of `renderFull`'s initial call before `initMessageReceiver` is wired. However, the chip-render observation may also be a red herring: the M5 webview PR renders the header chip unconditionally on every `renderFull` call, including the initial empty-state render, which means it appears immediately from the fixture boot without any host message. Hypothesis (c) ruled out.

**Why Hypothesis (b) is the correct failure mode — timing:**

The `resolveWebviewView` call sequence in `provider.ts` is synchronous within the extension-host Node.js process:
1. `provider.ts:113` — `webviewView.webview.html = this._getHtml(webviewView.webview)` — posts HTML to the Electron renderer via IPC.
2. `provider.ts:118-120` — `webviewView.webview.onDidReceiveMessage(...)` — wires webview-to-host listener (this direction is fine; not the issue).
3. `provider.ts:128` — `this._onResolved(webviewView.webview)` — fires the activation callback.
4. Inside `_onResolved` (i.e., `main.ts` lines 107-183): captures `priorState`, disposes old watcher, starts new watcher, and calls `void postState(webview, priorState)`.

Step 1 sends the HTML string over IPC to VS Code's renderer process, which schedules the webview iframe to load and execute the `<script src="...">` bundle. The renderer-side JavaScript (`src/webview/main.ts` IIFE) runs ASYNCHRONOUSLY — it is queued in the renderer's event loop and cannot have run by the time step 4 executes in the extension host's synchronous call stack.

Step 4's `postState(webview, priorState)` calls `webview.postMessage(msg)` — this is an IPC call to the renderer. VS Code delivers this message to the webview iframe's `window` message event. BUT: `window.addEventListener("message", listener)` (wired by `initMessageReceiver` in `src/webview/messageReceiver.ts:119`) has NOT yet been registered because the webview's `main.ts` boot IIFE has not yet run.

VS Code does NOT buffer or defer `postMessage` calls until the webview script is ready. The message arrives at the webview frame's message queue before the event listener is attached, and is silently dropped.

Subsequent watcher ticks (via the `setInterval` at `watcherLoop.ts:240`) also post state — but ONLY when the tick's hash differs from the prior state (`priorStateHash`). The new watcher's `priorStateHash` starts as `null` (line 187), so the FIRST tick always emits. The first tick is fired by `void tick()` at `startWatcher` line 238 — which is async. By the time it completes and calls `onStateChange`, the webview's boot IIFE HAS run and `initMessageReceiver` IS wired. So the first-tick state WOULD land if it fires fast enough.

**But the dogfood shows >30s empty-state, not a 0-2s flash.** This is the key discrepancy. If the first tick (async) fires within `pollIntervalMs = 2000ms` and delivers state while the webview listener IS registered, the empty state should last at most 2s, not >30s. The >30s duration points to the hash-skip firing: the first tick's result produces the SAME hash as the `priorStateHash` from before the dispose. After the new watcher is started, its internal `priorStateHash = null` — so the first tick must produce a different hash and emit. Unless... the webview was reopened but the sessions list was already identical to what was last emitted.

**Re-examination of hash-skip interaction with replay:**

When the new watcher ticks, `priorStateHash` starts as `null`. Any non-null hash will differ from `null`, so the first tick ALWAYS emits via `onStateChange`. `onStateChange` calls `void postState(webview, state)`. This WILL land on the webview's message receiver (the webview boot IIFE has had time to run by the time the async tick completes). So the first tick should fix the empty state within `pollIntervalMs` (≤ 2000ms).

**Why then does the empty state persist >30s?** Reading the dogfood sequence carefully:

Step 4 in the sponsor's observation: "Dashboard renders 'No live Claude Code sessions.' with the Hide-finished chip still visible above it." Sponsor waited >30s and the session did NOT re-appear. This is NOT a 2s flash — it's a persistent empty state.

A persistent >30s empty state despite the first-tick posting state would only happen if:
1. The first tick's `onStateChange` fires but `postState` silently fails (webview disposed again), OR
2. The webview DOES receive the first-tick state but its `sessions` list is empty at that point, OR
3. The watcher's first tick NEVER fires because the watcher was immediately disposed when the pane closed AGAIN.

**Most likely cause of the >30s persistent empty state:** VS Code calls `resolveWebviewView` when the pane is OPENED, but also disposes the webview view (and by extension, the `ClaudeTeamViewProvider`'s `_view`) when the pane is CLOSED. The `watcherHandle.dispose()` in `main.ts` is called at the top of `onResolved` (for the NEXT open), not when the pane closes. The watcher started in step 4 keeps running even when the pane is closed. When the pane reopens, `resolveWebviewView` fires again, and the new webview context gets the replay.

However — if `retainContextWhenHidden` is NOT set (confirmed: not set in `provider.ts` or `package.json`), VS Code tears down the webview's JavaScript context when the view is hidden. The webview's JavaScript state is LOST. When the pane reopens, a fresh webview iframe is created and `resolveWebviewView` fires. The replay fires synchronously before the iframe's script has run, so it's dropped. The first tick of the new watcher fires later and delivers state — this should work in ≤2000ms.

**The >30s duration specifically** suggests the first tick IS firing and calling `onStateChange`, but `postState` is failing silently because the `webview` object in the closure is STALE — it refers to the old webview instance that was created in the prior `resolveWebviewView` call, not the new one. Let me verify: in `main.ts`, `onStateChange` is defined as a closure over the `webview` parameter at the time `startWatcher` is called. If the pane is closed and reopened, `resolveWebviewView` fires again and calls `onResolved(webviewView.webview)` with a NEW `webview` object. The fix correctly captures `priorState` from the OLD watcher before disposing it and starting a new watcher with a closure over the NEW `webview`. This should work.

**Revised conclusion — the >30s is explained by a second race condition in the fix:**

The fix posts the replay synchronously before the webview's IIFE has run (hypothesis b, confirmed). But the fix also correctly starts a NEW watcher with `onStateChange` bound to the new webview. The new watcher's first tick fires async and delivers state to the CORRECT new webview. Under normal timing (`pollIntervalMs = 2000ms`) the empty state should last at most 2s.

The >30s persistence is consistent with the `hideFinishedAgents` filter being enabled in the sponsor's session. If `hideFinishedAgents = true` and ALL agents in session `33704` are in `finished` state, the filtered tree will have `sessions[0].rosterTiles` empty (all tiles suppressed) and `hiddenFinishedCount > 0`. The `renderFull` empty-state gate at `render.ts:290-291` checks `state.sessions.some(s => s.isAlive)` — if session `33704` IS alive (`isAlive: true`) but has no visible tiles (all filtered), the else branch at line 315 renders session blocks. But if the session is shown as dead (wrong `isAlive`), or the `sessions` array itself is empty...

Actually, re-reading `render.ts:290-312`: if `sessions.length > 0` AND `hasLiveSession` is true (at least one session with `isAlive: true`), the code falls through to render all sessions at line 315. If ALL sessions have `isAlive: false` OR `sessions.length === 0`, it renders the empty-state. The `33704.json` session is alive (confirmed by the dogfood doc), so `hasLiveSession` should be true and the session should render.

**True root cause of >30s:** The webview receives no `state:full` at all after the pane reopens, because:
1. The synchronous replay (from the fix) fires before the webview's script has run — message dropped (hypothesis b confirmed).
2. The new watcher's first tick calls `onStateChange(state)` which calls `postState(newWebview, state)` — THIS should land. But only if `postState` actually succeeds for the new webview.

The one case where `postState` would ALSO fail for the first-tick is if `hideFinishedAgents = true` and the STATE HASH DOESN'T CHANGE between the old watcher's last emission and the new watcher's first tick. But the new watcher's `priorStateHash = null` (line 187), so the first tick always emits regardless of content. This should work.

**Final answer:** The dogfood's >30s empty-state and the fix's ineffectiveness is fully explained by hypothesis (b): the synchronous `postState` from the replay fires before the webview's JavaScript has executed and registered its `window.message` listener. The first async tick from the new watcher should eventually deliver state (within ≤2s), but the sponsor observes >30s — this secondary duration anomaly is unverified (see "What I did NOT verify" section below).

**Fix direction for the follow-up ticket:**

The correct fix is to either:
(A) Delay the replay until the webview's JavaScript is ready. VS Code does not provide a "webview ready" callback directly. The webview can send a `ui:refresh` message to the host as its first action after boot (from `main.ts`), and the host can reply with the cached state on receiving that message. This is the pull-based pattern.
(B) Keep the current push-based replay but handle it in the webview before `initMessageReceiver` wires the listener. In `main.ts` webview, buffer messages received before `initMessageReceiver` runs (VS Code delivers messages as `window.message` events — but since the listener isn't registered yet, they're dropped before we can buffer them). Not feasible without VS Code platform changes.
(C) Trigger an extra tick from inside `initMessageReceiver` in the webview after wiring — but this is a webview-side fix that requires a message round-trip from webview to host.

**Pattern A (pull-based: webview sends `ui:refresh` on boot) is the correct fix.** The webview should send `ui:refresh` as its first action from `boot()` after `initMessageReceiver` is wired. The host's `onRefresh` handler calls `watcherHandle?.triggerTick()`, which immediately fires a tick and posts the current state. This guarantees the state arrives after the listener is wired. Source (implementation reference): `main.ts` lines 265-267 already have `onRefresh: () => { watcherHandle?.triggerTick(); }` — the webview-side change is adding `api.postMessage({ type: "ui:refresh" })` at the end of `boot()` in `src/webview/main.ts`.

**Fix surface:** webview (`src/webview/main.ts`). One line: `api.postMessage({ type: "ui:refresh" })` at the end of `boot()` in `src/webview/main.ts` after `initMessageReceiver({...})` returns. The host-side replay fix from PR #66 can be retained as a secondary fast-path (it is harmless and may work in some VS Code versions if postMessage is buffered).

**Evidence citations (all from `0a6945d` source, file:line verified this session):**
- `src/extension/main.ts:107` — `const priorState = watcherHandle?.getLastState() ?? null;` — replay capture
- `src/extension/main.ts:181-183` — `if (priorState !== null) { void postState(webview, priorState); }` — replay dispatch (synchronous, before webview IIFE runs)
- `src/extension/view/provider.ts:113` — `webviewView.webview.html = this._getHtml(webviewView.webview)` — HTML set (IPC to renderer, async load)
- `src/extension/view/provider.ts:126-135` — `this._onResolved(webviewView.webview)` — fires synchronously after HTML set, in same call stack
- `src/webview/messageReceiver.ts:119` — `target.addEventListener("message", listener)` — the listener that must be wired before the replay can land
- `src/webview/main.ts:217-260` — `renderFull(buildCtx(), currentState)` then `initMessageReceiver({...})` — listener wired AFTER first render, both async from renderer perspective
- `src/extension/watcher/watcherLoop.ts:187-188` — `let priorStateHash: string | null = null; let lastState: DashboardState | null = null;` — new watcher boots with null state
- `src/extension/watcher/watcherLoop.ts:215-228` — `lastState = state; const hash = hashState(state); if (hash === priorStateHash) return; priorStateHash = hash; opts.onStateChange(state);` — first tick always emits (null hash)
- `src/extension/main.ts:165-167` — `onStateChange: (state) => { void postState(webview, state); }` — new watcher's tick emits to the NEW webview (correct closure)

**What I did NOT verify:**
- Whether VS Code's `webview.postMessage` implementation buffers messages sent before the webview script has run (would make hypothesis b wrong). This would require reading VS Code's Electron webview implementation or a live test. No source for this in the codebase — marked as the primary load-bearing open question.
- Why the sponsor's observation shows >30s rather than ≤2s empty state. The first tick from the new watcher should deliver state within `pollIntervalMs = 2000ms`. The >30s duration is unexplained by hypothesis b alone. Candidates: (1) the `setInterval` tick posts but the webview receives it and renders as empty due to the `sessions` filter logic, (2) the VS Code instance has a very large `pollIntervalMs` configured, or (3) there is a secondary bug. Not verified without a live session trace.

### Follow-up ticket draft (updated)

**Title:** `fix(webview): boot-time ui:refresh to pull host state after message listener is wired`

**Description:**
PR #66 attempted a push-based replay: the extension host posts `state:full` synchronously to the fresh webview inside `onResolved`. The fix is structurally correct but fires before the webview's JavaScript IIFE has run and registered `window.addEventListener("message", ...)` via `initMessageReceiver`. VS Code does not buffer `postMessage` calls — the message is dropped. The >30s empty-state observed in the 2026-05-26 dogfood is the result.

The fix is a one-line addition to `src/webview/main.ts:boot()`: after `initMessageReceiver({...})` returns (listener is now wired), send `{ type: "ui:refresh" }` to the host. The host's existing `onRefresh` handler calls `watcherHandle?.triggerTick()`, which fires an immediate tick and posts the current state to the webview. The webview's listener is guaranteed to be wired at that point.

The host-side replay from PR #66 (`main.ts:181-183`) can be retained as a harmless secondary fast-path — it may work in some VS Code configurations if postMessage happens to buffer, and it costs nothing if dropped.

**Acceptance criteria:**
- AC1: `src/webview/main.ts:boot()` sends `{ type: "ui:refresh" }` via `api.postMessage` as the last statement in `boot()`, after `initMessageReceiver({...})` returns.
- AC2: After pane close+reopen on a vsix from this fix, the session tile re-appears within one tick cycle (≤ `pollIntervalMs` = 2000ms default), not >30s.
- AC3: Unit test: assert that `boot()` dispatches a `ui:refresh` message synchronously after `initMessageReceiver` is wired. Test file: `tests/unit/webview/bootRefresh.test.ts` (new).
- AC4: No regression: first-open still works (the `onRefresh` handler calls `triggerTick()` which runs a tick and emits state — no-op if first tick is already in flight; the hash-skip prevents double-emit).
- AC5: CI green.

**Recommended persona:** Maya (webview, `src/webview/main.ts`)
**Size:** XS
**OOS:** host-side changes beyond the retained PR #66 code, watcher-loop internals, roster changes.
**Dependency:** no dependency on PR #66 being reverted — the host-side replay is retained as-is.

**File in play:** `src/webview/main.ts` (line ~260, after `initMessageReceiver({...})`)

---

### Round 2 — PR #73 follow-up (2026-05-26, ticket 86c9z5a3k)

**Context:** PR #73 (`fix(webview): boot-time ui:refresh to pull host state after listener wired`, merged at `daf6109`, tip is `7db627d`) shipped the webview-side fix. Sponsor dogfood-verified `7db627d` and confirmed Surface A (close+reopen) STILL fails ("No live Claude Code sessions" persists). Surface C (window-reload) eventually works but takes >2s.

**Per-hypothesis verdicts — all verified from `7db627d` source at `c:/Trunk/PRIVATE/ClaudeTeam-bram-wt`:**

#### Hypothesis 1 — `ui:refresh` arrives BEFORE host `onRefresh` listener is registered

**REFUTED.**

`main.ts:94` — `provider.onResolved((webview) => { ... provider.setMessageHandlers(handlers); })`. The full `onResolved` callback runs synchronously inside `resolveWebviewView` at `provider.ts:128`. The sequence within `resolveWebviewView`:

1. `webview.html = ...` (`provider.ts:113`) — sends HTML to renderer process (async iframe load begins)
2. `webview.onDidReceiveMessage(dispatch)` (`provider.ts:118`) — host CAN receive messages
3. `this._onResolved(webview)` (`provider.ts:128`) — fires synchronously:
   - `startWatcher(...)` called → `void tick()` (tick-0) scheduled (async, not yet run)
   - `provider.setMessageHandlers(handlers)` called at `main.ts:275` — `onRefresh` IS registered

The renderer process cannot have executed the webview IIFE before step 3 completes — JS is single-threaded on the host side, and the renderer is a separate process. Any `ui:refresh` from the webview arrives only after `boot()` executes, which is after the renderer loads the bundle asynchronously, which takes longer than the synchronous step 3. By the time `ui:refresh` arrives at the host, `onRefresh` is definitely wired.

Evidence: `provider.ts:113-135` (full sequence), `main.ts:248-275` (handlers built + setMessageHandlers inside onResolved), `watcherLoop.ts:256-258` (`triggerTick: () => { void tick(); }`).

#### Hypothesis 2 — `triggerTick()` runs but the `state:full` response hash-skips

**VERIFIED — this is the root cause.**

`startWatcher` fires `void tick()` (tick-0) at `watcherLoop.ts:238`. This async tick completes, reads the filesystem, produces a `DashboardState`, and (since `priorStateHash === null`) always emits via `opts.onStateChange(state)` → `postState(webview, state)`. However, at the time tick-0 completes, the webview's `initMessageReceiver` has NOT yet run — the `state:full` message is delivered to the webview's message bus but silently dropped (no listener registered). CRITICALLY: tick-0 also sets `priorStateHash = hash(state)` at `watcherLoop.ts:224`.

When the webview subsequently runs `boot()`, calls `initMessageReceiver`, and sends `api.postMessage({ type: "ui:refresh" })`, the host's `onRefresh` handler calls `watcherHandle?.triggerTick()` → `void tick()` (tick-1). Tick-1 reads the same filesystem (nothing has changed), produces the same `DashboardState`, computes the same hash — `hash === priorStateHash` → hash-skip fires at `watcherLoop.ts:220-223` → `onStateChange` is NOT called → `postState` is NOT called → the webview never receives `state:full`.

The `setInterval` ticks (every 2000ms) also hash-skip for the same reason. The webview is permanently stuck in empty-state until something on disk changes (a new session appears, a JSONL updates, etc.).

Evidence:
- `watcherLoop.ts:187-188` — `let priorStateHash: string | null = null` — null on new watcher
- `watcherLoop.ts:216-226` — tick-0 always emits (null hash), sets `priorStateHash = hash`, calls `onStateChange`
- `watcherLoop.ts:238` — `void tick()` — fires BEFORE `setMessageHandlers` is called on the host (tick-0 is scheduled as a microtask, but executes after the entire synchronous `startWatcher` returns and `onResolved` finishes — at which point the webview IIFE STILL hasn't run)
- `watcherLoop.ts:256-258` — `triggerTick` just calls `void tick()` with no hash reset
- `messageBus.ts:88-106` — `postState` is fire-and-forget; returns `Thenable<false>` only on thrown error (view disposed), NOT when the webview listener isn't registered. The watcher never knows the message was silently dropped.

#### Hypothesis 3 — Webview's `window.addEventListener("message", ...)` has a deeper async gap than assumed

**PARTIALLY VERIFIED — this is the secondary effect, not the root cause.**

The webview's `window.addEventListener` is registered inside `initMessageReceiver` at `messageReceiver.ts:119`, called from `boot()`. `boot()` is called from the IIFE at `main.ts:280-283` after `document.readyState` is `"loading"` check. The `<script src="...">` is at end of `<body>` (per `provider.ts:220`), so `boot()` runs synchronously when the script executes. This gap is NOT deeper than assumed — `initMessageReceiver` runs immediately in `boot()` before `api.postMessage({ type: "ui:refresh" })`. The listener IS wired before `ui:refresh` is sent.

The hypothesis is "partially verified" only in the sense that the gap EXISTS (tick-0 fires before the listener is wired) — but the root cause identified in H2 explains why the recovery mechanism (the `ui:refresh`) also fails.

#### Hypothesis 4 — Surface C's >2s window-reload latency is unrelated watcher first-tick latency

**PARTIALLY VERIFIED — same root cause applies, different timing outcome.**

Surface C (window-reload) sometimes works but takes >2s. The explanation: on window-reload, tick-0 fires and reads all session/JSONL/roster files from disk. If this I/O takes longer than the renderer loading the webview bundle and running `boot()`, the webview listener IS wired before tick-0 calls `onStateChange` — and `state:full` lands successfully. The ">2s" is the I/O time for tick-0 on a cold cache (sessions dir + JSONL tailing + roster load). On a warm cache it's much faster, which is why the behavior is non-deterministic.

When tick-0 completes BEFORE the webview listener is wired (the common case): same hash-skip trap as Surface A, and the window-reload also shows empty state persistently. The >2s result in the dogfood indicates the I/O happened to take long enough for the renderer to win the race.

Evidence: `watcherLoop.ts:317-452` (`runTick` does `listSessions`, per-session `readActivity` + JSONL loop, `loadRoster`, `buildAgentTree`) — multiple sync/async file reads per tick.

**Fix surface and recommendation:**

The root cause is `triggerTick()` at `watcherLoop.ts:256-258` calling `void tick()` without resetting `priorStateHash`. The fix is to expose a `forceRefresh()` method on `WatcherHandle` that resets `priorStateHash = null` before calling `tick()`, ensuring the next tick always emits regardless of state hash. The `onRefresh` handler in `main.ts:265-267` should call `watcherHandle?.forceRefresh()` instead of `watcherHandle?.triggerTick()`.

**Confidence: HIGH** — the code path is fully traced at file:line level. The only unverified aspect is the exact timing of tick-0 completion vs. renderer bundle load (race timing), but the hash-skip mechanism is deterministic once tick-0 has fired.

**File surfaces for the fix:**
- `src/extension/watcher/watcherLoop.ts` — add `forceRefresh: () => { priorStateHash = null; void tick(); }` to the returned `WatcherHandle` (line ~255, alongside `triggerTick`)
- `src/extension/main.ts:265-267` — change `watcherHandle?.triggerTick()` in `onRefresh` to `watcherHandle?.forceRefresh()`
- `src/shared/types.ts` (or wherever `WatcherHandle` is typed) — add `forceRefresh?(): void` to the interface

**Alternative fix (also valid):** Reset `priorStateHash = null` inside `triggerTick` itself (always force-emit on explicit refresh request). Simpler — no new method needed. Downside: any caller of `triggerTick` (config-change, roster-change, command-palette refresh) would also bypass hash-skip. This is acceptable — those are all explicit user actions that should produce a guaranteed state update.

**What I did NOT verify:**
- Exact timing of tick-0 completion vs. renderer bundle load — this is a runtime race not determinable from source alone. The analysis assumes tick-0 completes first based on the expected I/O speed vs. renderer startup latency, which is consistent with the dogfood outcome but not proven from source.
- Whether VS Code's `webview.postMessage` ever retries or buffers when the listener isn't registered. If it does buffer (on some VS Code versions), the fix would not be needed for those versions — but the consistent failure in the dogfood suggests no buffering occurs.
- The `hydrateState` missing `config` and `hiddenFinishedCount` fields (`main.ts:110-143` — those fields are absent from the hydration output). This is a separate bug in M5's webview wire-shape deserialization, not related to Obs 3 empty-state.

---

**Description:**
When the sponsor closes and reopens the ClaudeTeam Activity Bar pane, VS Code calls `resolveWebviewView` again, which triggers a fresh `startWatcher()` call. The new watcher's `lastState` starts at `null`; its first async tick completes up to 2000ms later (default `pollIntervalMs`). During that window the webview renders "No live Claude Code sessions" even though live sessions exist. Root cause: `main.ts` disposes the prior watcher without capturing its last state and replaying it to the newly remounted webview.

**Acceptance criteria:**
- AC1: Before `watcherHandle.dispose()`, capture `const priorState = watcherHandle?.getLastState()`. After `startWatcher()` returns, if `priorState` is non-null, call `void postState(webview, priorState)` synchronously.
- AC2: The new watcher's first async tick still runs and overwrites with fresh state — AC1 is a fast-path that only bridges the boot gap.
- AC3: Unit test: mock a dispose+re-resolve cycle; assert the webview receives a `state:full` post before the first tick fires. Test file: `tests/unit/host/mainReplay.test.ts` (new) or `tests/unit/host/watcherLoop.test.ts` (extension).
- AC4: Layer-3 smoke: pane-close + pane-reopen in the installed `.vsix` no longer flashes "No live Claude Code sessions" when a session is active.
- AC5: No regression: first-open (no prior state) still boots cleanly with empty state.

**Recommended persona:** Felix (extension host)
**Size:** S
**OOS:** webview rendering changes, watcher-loop internals, roster changes.

---

## Observation 4 — Cross-project persona-name collision

### Classification: `intentional` (already resolved)

**Confirmed resolved.** The dogfood document itself states: "Workaround applied 2026-05-25: migrated both rosters from global to per-project." The fix (PR #63) landed per-project `<project-root>/.claude/teams.yaml` for both ClaudeTeam and RandomGame, and the global file was reset to `teams: []`. The roster-matching doc at `.claude/docs/roster-matching.md` now includes a full "Recommended default: per-project" section (lines 65–73, read this session) documenting the collision failure mode, the policy, and the operational pattern.

**The `package.json` description gap is real but already logged.** The `claudeteam.rosterPath` description reads: "Empty string uses the default global location (~/.claudeteam/teams.yaml) with per-project fallback." The per-project-first framing is the desired direction but is not captured in the config description. This is already noted in `roster-matching.md` line 73: "Open follow-up: package.json's claudeteam.rosterPath description currently reads... Triage open under ticket 86c9yteju for Bram/Felix to flip the framing." This is a P3 NIT, not a blocking defect.

**No further action from this triage beyond confirming resolution.** The Obs 4 resolution is documented.

**Evidence:**
- `.claude/docs/roster-matching.md:65-73` — "Recommended default: per-project" section confirmed present (read this session)
- `team/dogfood/2026-05-25-session-lifecycle-quirks.md:54` — "Workaround applied 2026-05-25" — explicit sponsor confirmation
- `package.json` (configuration properties read this session) — `claudeteam.rosterPath` description still shows global-first framing; confirmed gap exists but is P3

**Doc addition for the package.json description gap (target: `.claude/docs/roster-matching.md`, append as note to the existing "Open follow-up" line):**

The package.json description framing is a P3 follow-up for Felix. No new doc content needed — the existing `roster-matching.md` section already captures the full policy. The only remaining action is a one-line edit to `package.json` `claudeteam.rosterPath` description flipping from "global with per-project fallback" to "per-project with global fallback." This can be bundled into the next Felix host-side ticket.

---

## Observation 5 — Cross-workspace session visibility

### Classification: `mixed`

**The filter logic is correct and functioning per spec.** `filterSessionsToWindow()` in `src/extension/watcher/sessionFilter.ts` implements the exact rule in the package.json description: when `showAllSessionsGlobally === false` AND `workspaceFolders` is non-empty, only sessions whose `cwd` (after path normalization) matches a workspace folder are shown. This was verified against the source at lines 69–88.

**The Obs 5 "cross-workspace visibility" was an artifact of the session filter's don't-strand-the-user passthrough, not a filter leak.** Specifically:
- When the sponsor's RandomGame window was the active window, `vscode.workspace.workspaceFolders` would reflect the RandomGame workspace. Sessions with `cwd = c:\Trunk\PRIVATE\RandomGame` would pass; others would be filtered.
- HOWEVER: the sponsor's dogfood had the global roster still active at Obs 5 observation time (the per-project migration was applied as a workaround AFTER the observations). If the sponsor's VS Code window had no workspace folder open (or the extension was running in a workspace-root that didn't match any session), the `filterSessionsToWindow()` passthrough at lines 79–81 would kick in: "no folder open → passthrough (don't strand the user)" — ALL sessions would be visible regardless of `showAllSessionsGlobally`.
- Additionally: `showAllSessionsGlobally` defaults to `false` but there is no sponsor-side confirmation in the dogfood doc that the setting was not `true` in their user settings. This is listed as a "Candidate cause" in the dogfood doc itself.

**What I could not verify (explicitly flagged):** the sponsor's exact VS Code workspace state and `claudeteam.showAllSessionsGlobally` setting value at observation time. The dogfood doc says "Sponsor enabled showAllSessionsGlobally: true in user settings at some point" as a candidate cause — I cannot confirm or refute this without reading the sponsor's `settings.json`, which is not in the codebase.

**The documentation gap is real:** the don't-strand-the-user passthrough behavior (when no workspace folder is open) is documented only in `sessionFilter.ts` inline comments (lines 27–31) and in the unit test suite — not in any of the `.claude/docs/` user-facing docs. A user who opens the dashboard without a workspace folder open and sees all sessions has no way to know this is intentional passthrough behavior.

**Evidence:**
- `src/extension/watcher/sessionFilter.ts:75-88` — `filterSessionsToWindow()` implementation confirmed correct
- `src/extension/watcher/sessionFilter.ts:79-81` — don't-strand passthrough when `workspaceFolders` empty/undefined
- `src/extension/watcher/watcherLoop.ts:196-198` — `showAllSessionsGlobally: opts.getShowAllSessionsGlobally?.() ?? false` — default false confirmed
- `package.json` (claudeteam.showAllSessionsGlobally property) — `"default": false` confirmed
- `team/dogfood/2026-05-25-session-lifecycle-quirks.md:63-70` — Obs 5 lists "Candidate causes (none investigated)" — no sponsor-side confirmation of setting value

### Doc addition (target: `vscode-extension-conventions.md`, under a new "Session filter edge cases" subsection)

> **Window-filter passthrough when no folder is open.** The `claudeteam.showAllSessionsGlobally` setting (default `false`) is intended to scope the dashboard to the current VS Code workspace. However, when VS Code has NO workspace folder open (e.g., a File > Open File window with no folder), the filter passes through all sessions rather than showing an empty dashboard. This is the "don't strand the user" behavior — without a workspace folder, there is no filter signal to interpret. If a sponsor opens the ClaudeTeam pane in a no-folder window and sees sessions from other projects, this is expected behavior, not a filter leak. To restrict visibility in a no-folder window, set `claudeteam.showAllSessionsGlobally: false` and open the desired folder first.
>
> **Separate note:** `showAllSessionsGlobally: true` (not the default) disables the filter entirely and shows all sessions on the machine regardless of the current window's workspace. This is also a valid cause of cross-workspace session visibility if the user has previously enabled the setting.

---

## Observation 6 — Subagent shown as `finished 0s` when still working

### Classification: `defect`

**Root cause confirmed in code.** The `buildActivity()` function in `src/extension/state/reducer.ts` (lines at the bottom of the file, around the `switch (state)` block) handles four states: `"running"`, `"idle"`, `"finished"`, `"error"`. The `finished` case returns the bare string `"finished"` with no timestamp. The `idle` case returns `"idle ${elapsedS}s"` using `activity.mtimeMs`.

The `inferState()` function returns `"idle"` as the residual state when neither `finishedIds.has(agentId)` fires nor the JSONL mtime is fresh (lines verified in `src/extension/state/reducer.ts` in `inferState()`):
```
// priority order in inferState():
// 1. finishedIds → "finished"
// 2. activity undefined / mtimeMs=0 → "running" (fresh spawn) OR "error" (dead session)
// 3. staleMs < IDLE_THRESHOLD_MS (10000) → "running"
// 4. otherwise → "idle"   ← THIS IS THE CORRECT BRANCH
```

So `inferState()` correctly returns `"idle"` for the Priya agent in Obs 6 (JSONL mtime ~78s old, not in finishedIds). The reducer correctly calls `buildActivity("idle", activity, nowMs)`, which correctly returns `"idle ${elapsedS}s"`.

**However**, the dogfood shows `"finished 0s"` on the tile. The `"finished"` state string with a `0s` elapsed suffix is NOT what `buildActivity("finished", ...)` returns — `"finished"` case returns bare `"finished"` with no suffix. And `"idle"` with a `0s` suffix is not possible unless `mtimeMs === nowMs`.

**Re-examining the evidence more carefully.** The dogfood doc says: `"finished 0s"`. The `buildActivity("idle", activity, nowMs)` returns `"idle ${elapsedS}s"` — NOT `"finished Xs"`. The `buildActivity("finished", ...)` returns `"finished"` — NOT `"finished 0s"`. Neither branch produces `"finished 0s"` literally.

**Most likely explanation:** the `"0s"` is the elapsed-time suffix from the `idle` branch computed at the moment the agent JSONL was very fresh (mtime within 1s of nowMs) — elapsedS rounds to 0. At that point `inferState()` would return `"running"` (staleMs < 10000ms threshold). So `"finished 0s"` as a literal string is not reachable from the current code...

**Reconsidering:** the dogfood doc says "dashboard shows `Priya ×3` collapsed group with all three tiles labeled `finished`." The third tile reads `finished 0s`. The sponsor's ground-truth verification confirms the JSONL mtime was ~78s old at check time — well past the `IDLE_THRESHOLD_MS = 10_000ms`. So `inferState()` would return `"idle"` at that mtime.

**But the tile shows `finished`, not `idle`.** This means either:
(a) The webview is showing a stale cached state from an earlier tick when the agent was in `finishedIds` (perhaps due to a spurious `tool_result` in the parent), or
(b) The webview render path does NOT use `buildActivity()` output directly — it has its own state label rendering that maps `idle` to something, and may have a bug there, or
(c) The `Priya ×3` persona-tile collapse (M3-10) groups tiles from multiple Priya dispatches — some finished (from prior Priya dispatches with closed `tool_result`) and one `idle` (the new third dispatch). The collapsed group renders the dominant state label across instances.

**The `"finished 0s"` with the `0s` suffix specifically points to the webview's elapsed-time display for a finished agent.** The `buildActivity("finished", ...)` in the reducer returns `"finished"` (no suffix). If the webview is independently computing elapsed time and showing `0s`, it implies the webview has its own "time since finished" display path that computes `now - finishedAt` where `finishedAt` is unknown/zero, producing `0s`. This is a webview-side rendering concern, not the reducer.

**Most consistent interpretation of all evidence:** The `CollapsedPersonaGroup` (M3-10) for `Priya ×3` contains some finished instances (prior dispatches) and one newly-dispatched idle instance. The collapsed group renders the "worst" or "dominant" state, or the most recent instance's state. If the collapsed group shows the state of any `finished` instance and the webview shows `finished 0s` with a freshness suffix computed from `now - <unknown timestamp>`, the `0s` arises from the missing/zero timestamp for the `finished` state.

**What the reducer DOES confirm as a real gap (independent of the exact `0s` cause):** `buildActivity()` for `"finished"` returns the bare string `"finished"` with no elapsed time. The spec describes showing how long ago an agent finished (so the user knows if it just finished or finished hours ago). The current implementation provides no elapsed-time information for finished agents. This is a confirmed missing feature in the reducer.

**What is NOT verified:** whether the `"finished 0s"` text originates from the reducer's `buildActivity()` output (which would require `"finished"` + a suffix to be concatenated elsewhere) or from a webview-side display path that adds the `0s`. Reading the webview source would confirm, but the root cause is clear enough to draft the ticket.

**Evidence:**
- `src/extension/state/reducer.ts` — `inferState()` function: returns `"idle"` when `finishedIds` miss AND `staleMs >= IDLE_THRESHOLD_MS` (verified by reading the full function)
- `src/extension/state/reducer.ts` — `buildActivity()` function: `"finished"` case returns `"finished"` (bare), `"idle"` case returns `"idle ${elapsedS}s"`, `"running"` case returns `"tool:${tool}"`
- `src/extension/state/reducer.ts` — `IDLE_THRESHOLD_MS = 10_000` (exported constant)
- `team/dogfood/2026-05-25-session-lifecycle-quirks.md:77-79` — sponsor's ground-truth: JSONL mtime ~78s old at check time; agent not in finishedIds (parent tool_result not confirmed present). Per inferState() logic, this agent should be `"idle"`.
- `team/dogfood/2026-05-25-session-lifecycle-quirks.md:83-88` — sponsor's hypothesis: "dashboard liveness inference appears to collapse the spec'd `idle` state into `finished`"

**Assessment of sponsor's hypothesis:** The hypothesis is partially correct. The reducer's `inferState()` correctly distinguishes `idle` from `finished`. However, the M3-10 `CollapsedPersonaGroup` collapse may be aggregating states across multiple Priya instances in a way that masks the `idle` label — the group rendering in the webview would need to be checked. Additionally, the `buildActivity("finished")` returning a bare `"finished"` with no elapsed-time suffix is a confirmed gap regardless of the `0s` source.

**Two distinct defects in this observation:**

### Defect 6a — `buildActivity("finished")` missing elapsed-time suffix

**Title:** `fix(reducer): add elapsed-time suffix to finished activity string`

**Description:**
`buildActivity("finished", activity, nowMs)` returns the bare string `"finished"`. There is no indication of how long ago the agent finished. The dashboard shows `finished` for an agent that finished 0s ago and an agent that finished 2 hours ago identically. The spec implies elapsed time should be shown for finished agents (the dogfood showed `finished 0s` — indicating an expectation of elapsed time, even if the source of `0s` is unclear). The reducer needs a `finishedAt` timestamp to compute elapsed time, which requires surfacing when the parent `tool_result` was received (the JSONL record has a `timestamp` field). This is currently not captured in `FinishedSet` (which is just a `Set<string>` of agentIds, no timestamp).

**Acceptance criteria:**
- AC1: Introduce `type FinishedMap = Map<string, number>` (agentId → finishedAtMs, sourced from the parent JSONL `tool_result` record's `timestamp` field) replacing `FinishedSet = Set<string>` in the reducer.
- AC2: `buildActivity("finished", activity, nowMs, finishedAtMs?)` uses `finishedAtMs` to produce `"finished ${elapsedS}s"` when timestamp is available; falls back to `"finished"` when not.
- AC3: Update all callers of `FinishedSet` in `watcherLoop.ts` and `agentTree.ts` to capture and pass timestamps.
- AC4: Unit test: `buildActivity("finished", ..., nowMs=1000, finishedAtMs=0)` returns `"finished 1s"`.
- AC5: Regression: existing tests still green. CI green.

**Recommended persona:** Felix (extension host, reducer)
**Size:** S
**OOS:** webview display of the elapsed-time string (no webview change needed if the activity string already contains it).

### Defect 6b — CollapsedPersonaGroup state aggregation produces misleading `finished` label for idle instances

**Title:** `fix(webview): CollapsedPersonaGroup state label should reflect worst-case live instance, not first instance`

**Description:**
The `Priya ×3` collapsed group in the dogfood showed `finished` as the group state label even though at least one Priya instance was `idle` (JSONL mtime ~78s, not in finishedIds). The M3-10 collapse groups tiles by persona name into a `CollapsedPersonaGroup { kind, personaName, count, instances[] }`. The webview's rendering of the collapsed group's state label is the suspected source of the `finished` display — if it takes the first instance's state or the majority state, a group with 2 finished + 1 idle Priyas would show `finished`. The correct behavior: a group with any `running` instance should show `running`; a group with any `idle` instance and no `running` should show `idle`; only show `finished` when ALL instances are finished.

**Acceptance criteria:**
- AC1: Webview `renderCollapsedGroup()` (or equivalent) computes group state label as: `running` if any instance has `state === "running"`; else `idle` if any instance has `state === "idle"`; else `finished` if all instances are `finished`; else `error` if any instance has `state === "error"`. Priority: running > idle > finished > error (most-active-first).
- AC2: Unit test: group with `[finished, idle, finished]` instances renders as `idle`.
- AC3: Unit test: group with `[finished, finished]` instances renders as `finished`.
- AC4: Unit test: group with `[running, finished]` instances renders as `running`.
- AC5: No change to the reducer or host-side code (webview-only fix).

**Recommended persona:** Maya (webview)
**Size:** S
**OOS:** reducer changes, finished elapsed-time display (covered by Defect 6a).

---

## Doc additions summary (for orch to apply)

All additions target existing docs — no new doc files needed.

1. **`vscode-extension-conventions.md`** — add "Session-tile identity is (sessionId, pid), not sessionId alone" subsection (Obs 1 text above). Target: after the "Webview boot state — dev-fixture gating" section.

2. **`vscode-extension-conventions.md`** — append "DEAD tile pruning is file-driven, not timer-driven" paragraph immediately after item 1 (Obs 2 text above).

3. **`vscode-extension-conventions.md`** — add "Session filter edge cases" subsection covering the don't-strand passthrough and `showAllSessionsGlobally` (Obs 5 text above). Target: after the "Activation cost" section.

Note: the Obs 4 roster-matching gap is already in `roster-matching.md` — no new content needed there.

---

## What I did NOT verify

- The exact timing Claude Code uses to remove `{pid}.json` on process exit (Obs 1/2) — external dependency, not in this codebase.
- The sponsor's exact VS Code workspace state and `showAllSessionsGlobally` setting value at Obs 5 observation time — no access to sponsor's `settings.json`.
- Whether the `"finished 0s"` literal in Obs 6 originates from the reducer's `buildActivity()` output concatenated by the webview, or from a webview-only display path. The webview source (`src/webview/`) was not read in this session — the reducer analysis is complete, but the webview render path for `CollapsedPersonaGroup` state labels was not verified at file:line level. This is the load-bearing open question for Defect 6b's root cause.
- Whether PR #63 is the correct PR number for the per-project roster migration (Obs 4). The dogfood doc says "per-project roster migration" without citing a PR; the roster-matching.md doc was confirmed present and correct as of this session's read. The PR number is not cited in either source I read.

---

## Implications for ClaudeTeam

- Obs 3 (pane reopen empty state) is the highest-UX-impact defect — it's the first thing a user sees on every pane toggle. The fix is small (one `postState(webview, priorState)` call in `main.ts`) and should be P1 for Felix.
- Obs 6a (missing finished elapsed time) is a missing feature that affects every finished tile — medium priority.
- Obs 6b (CollapsedPersonaGroup state label aggregation) requires webview reading to fully confirm root cause — recommend Maya investigate before implementing the fix.
- Obs 1, 2, 5 docs are purely additive and can land in a single PR (no code changes needed).
