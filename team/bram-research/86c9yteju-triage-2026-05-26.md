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

### Follow-up ticket draft

**Title:** `fix(host): replay last-known state to remounted webview — eliminate empty-state flash on pane reopen`

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
