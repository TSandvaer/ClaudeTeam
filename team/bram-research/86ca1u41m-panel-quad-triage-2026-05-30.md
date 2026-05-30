# Manage Team Panel — Four Bug Triage — 2026-05-30

## Question

Sponsor dogfood on build `8dc156b` (post-#141 `roster:loaded` fix + #142 Manage Team entry-point)
found four functional-interactive bugs in the Manage Team panel edit view that the data-plane tests
missed. Root-cause each, identify the catching interaction test, explain why the data-plane layer
missed all four.

Bugs:
- D (SEVERE) — "Save team" button has no visible effect.
- A — Preview step roles show "—" for all, even when 86ca1nvae auto-derives roles at gen.
- B — Character picker opens then vanishes on the ~2s poll tick.
- C — After picking, the member shows a tiny ARMS-RAISED sprite + source-name text instead
      of a portrait/south-idle frame.

---

## Answer (1–3 sentences each)

**D — "Save team" does NOTHING (visible)**
The `ui:save-team` message IS dispatched and the host DOES write the file. The symptom is a
missing feedback banner: `onSetupConfigSaved` calls `renderFull(buildCtx(), currentState)` to
mount a fresh `.ct-setup-banner-slot` and then appends the "Saved" banner — but `emitDetection()`
(called inside `saveTeam()` BEFORE `configSaved()`) has already queued a `setup:detection` message
that arrives milliseconds later, causing ANOTHER `renderFull` that replaces the entire mount and
wipes the banner slot before it can paint. Visually: nothing happens; functionally: the write
succeeds and the roster reloads on the next tick.

**A — Preview step roles "—"**
The wizard's Step 2 (`buildPreviewStep` in `setupWizard.ts`) renders member rows by iterating
`includedNames()` (a `string[]` of agent names), then hardcodes `roleSpan.textContent = "role: —"`
regardless of the matching `ScannedAgent.role` value. The `generateStarterConfig()` path (86ca1nvae)
correctly seeds roles from a `roles: Map<string, string>` the host builds from `ScannedAgent.role`,
but the preview step never consults those values — it only has the name list, not the full
`ScannedAgent[]` objects. So the preview is cosmetically wrong: it always shows "—" even when the
confirm-and-create config will contain the auto-derived role.

**B — Picker closes on poll re-render**
Identical failure class to the overflow-menu bug fixed in 86ca1fjqu / `menuOpenTracker`. The
character picker's open state lives entirely in local DOM: `pickerHost.firstChild !== null` is the
only open-signal. When `renderFull` fires on a ~2s poll tick while `managePanelOpen === true`,
`renderManageTeamPanel → renderEditLayout` is called fresh, constructing a new `pickerHost` element
(empty, picker gone). There is no persistent tracker — analogous to `expandedGroupsTracker` /
`menuOpenTracker` — that survives the DOM rebuild and re-opens the picker cell.

**C — Arms-raised sprite in picker thumbnail and post-pick display**
`resolveThumbnailPath` (characterSources.ts:120-155) walks `_pixellab_anims/<state>/animations/<slug>/south/frame_*.png`
selecting the first south frame from the ALPHABETICALLY first state directory. For `ClaudeTeam-M01-Dev`
and `ClaudeTeam-F01-Dev`, the alphabetically first state folder is `a_relaxed_tired_upwa` (= the
`idle_stretch` animation in the manifest: "a slow/gentle tired stretching motion the arms reach
upward…"). Frame 0 of that animation is mid-stretch with arms raised. The correct thumbnail would
be `frame_000` of a neutral-stance state such as `holding_a_coffee_cup` (`idle_coffee`) or any of
the standing-relaxed states. For the post-pick `refreshChip` display, `refreshChip` (manageTeamPanel.ts:497-523)
uses `source.thumbnailPath` which carries the same arms-raised path from the `CharacterSource`
already in the picker.

---

## Evidence

### Bug D — Save feedback wiped by interleaved re-render

- `src/extension/setupController.ts:166-175` — `saveTeam()` calls `post.configSaved()` FIRST,
  then `this.emitDetection()`. The order means `setup:config-saved` is queued before
  `setup:detection`. Both messages are fire-and-forget (`void postSetupConfigSaved(...)`); VS Code
  queues them synchronously, so the webview processes them in order.
- `src/webview/main.ts:441-473` — `onSetupConfigSaved` handler: `renderFull(buildCtx(), currentState)`
  at line 454 rebuilds the mount (including a fresh `.ct-setup-banner-slot`), then `bannerSlot()`
  at line 455 finds the slot and calls `showSetupBanner`. Banner IS mounted.
- `src/webview/main.ts:414-426` — `onSetupDetection` handler: calls `renderFull(buildCtx(), currentState)`
  unconditionally. This rebuilds the ENTIRE mount → `.ct-setup-banner-slot` replaced by a new empty
  slot → banner destroyed.
- `src/webview/components/setupBanner.ts:55-78` — `activeTimers` WeakMap: the auto-dismiss timer is
  registered against the OLD slot element, which is now GC'd. Timer fires 4s later into a dead node;
  no visible effect.
- Timing: `setup:config-saved` → (banner shows, not yet painted) → `setup:detection` (same
  microtask queue drain before next paint) → banner wiped. From the browser's perspective, the banner
  may never make it to a frame render at all.
- `src/extension/main.ts:501-503` — `onSaveTeam` handler calls `saveTeam()` then
  `watcherHandle?.forceRefresh()`. The `forceRefresh` queues additional `roster:loaded` + `state:full`
  messages that also each call `renderFull`. These arrive after `setup:detection` and each replace
  the mount again (four total `renderFull` calls for one save click).
- The unit test at `tests/unit/webview/teamSetup.test.ts:333-360` asserts `ui:save-team` is posted
  with the correct payload (PASSES). It does not test that a visible banner survives subsequent
  `renderFull` calls — the banner is a DOM side-effect that the test's spy-only shape cannot catch.

### Bug A — Preview step hardcoded "role: —"

- `src/webview/components/setupWizard.ts:183-207` — `buildPreviewStep()` at lines 184-207:
  `for (const name of includedNames())` iterates string names only.
  Line 199: `roleSpan.textContent = "role: —"` — HARDCODED, never reads `ScannedAgent.role`.
- `src/shared/types.ts:262-280` — `ScannedAgent` interface has `role?: string` at line 280
  (optional; auto-derived from the agent `.md` description by 86ca1nvae).
- `src/extension/roster/claudeTeamConfig.ts:95-123` — `generateStarterConfig(included, teamName, roles)`:
  the `roles` map from `ScannedAgent.role` values seeds `Member.role` when present (line 111:
  `role: derived !== undefined && derived.length > 0 ? derived : ""`).
- `src/extension/setupController.ts:153-163` — `runSetup()` builds the `roles` map from
  `this.scan()` and passes it to `generateStarterConfig`. The role IS auto-derived at create time.
- The wizard RECEIVES the full `ScannedAgent[]` as the `scanned` prop
  (`setupWizard.ts:31-35`, `main.ts:341-342`: `scanned: setup?.scanned ?? []`), but `buildPreviewStep`
  never consults `scanned`. It only has `includedNames()` (string[]) from the closure over `included`
  (the checked-agent Map keyed by `agentName`).
- Fix direction: in `buildPreviewStep`, build a `Map<agentName, ScannedAgent>` from `scanned`, look
  up each name, and display `agent.role || "—"`. The `scanned` array is in scope via closure
  (`renderSetupWizard` props, line 49-52).

### Bug B — Picker open-state lost on re-render

- `src/webview/components/manageTeamPanel.ts:339-378` — `buildCharacterControls()`: picker
  open-state is `pickerHost.firstChild !== null` (line 353). `closePicker` empties `pickerHost`
  (line 344). There is no external persistent tracker.
- `src/webview/render.ts:405-418` — `renderFull` with `managePanelOpen === true` calls
  `mount.replaceChildren()` then `renderManageTeamPanel(...)`. This rebuilds the entire edit layout
  including new `buildCharacterControls()` calls → new `pickerHost` elements (empty).
- `src/webview/menuOpenTracker.ts:1-132` — the `menuOpenTracker` shows the exact pattern needed:
  a per-boot `Map<key, phase>` that `renderFull` prunes each tick and the component reads to
  restore open state. The picker needs an analogous `pickerOpenTracker: Map<memberId, boolean>`
  (or reuse `menuOpenTracker` with a new phase value).
- `src/webview/main.ts:244-257` — `menuOpenTracker` is constructed in `boot()` and passed via
  `buildCtx()` → `renderFull` → component. The picker tracker would follow the same lifecycle.
- Prior art: identical fix class (poll-tick wipe) also fixed for `expandedGroupsTracker`
  (86c9zfmh1, Obs 10) — sponsor symptom verbatim: "closes in 1 second every time."

### Bug C — Arms-raised thumbnail

- `src/extension/characterSources.ts:120-155` — `resolveThumbnailPath(charDir: string)`:
  - Line 126: `states = readdirSync(animsRoot).sort()` — alphabetical sort of state folders.
  - Line 129-154: first `state` in sorted order → first `slug` → `south/` directory → first
    `frame_*.png` (alphabetical, so `frame_000.png`).
- Live on-disk (installed extension `claudeteam.claudeteam-0.0.1`):
  `ls C:/Users/538252/.vscode/extensions/claudeteam.claudeteam-0.0.1/dist/webview/sprites/ClaudeTeam-M01-Dev/_pixellab_anims/`
  → alphabetically first state: `a_relaxed_tired_upwa` (= `idle_stretch` per generatedManifest.ts:62-63).
- `src/webview/sprites/generatedManifest.ts:62-70` — `idle_stretch` folder `a_relaxed_tired_upwa`
  animation slug is `a_slow_stretching_loop_from_the_overhead_stretched` (M01) / `a_gentle_tired_stretching_motion_the_arms_reach_a` (F01). Frame 0 = arms raised mid-stretch.
- `src/webview/sprites/generatedManifest.ts:13-16` — `defaultIdle` for both characters is
  `"idle_coffee"` (folder `holding_a_coffee_cup`). This is the character's canonical neutral-stance
  pose — the RIGHT thumbnail choice.
- Fix direction in `characterSources.ts`: read the character's `animations.json` (which records
  `defaultIdle`), then resolve that animation's `south/frame_000.png` instead of blindly taking
  the alphabetically first state. If `animations.json` is absent or unparseable, fall back to
  current behavior. Alternative: explicitly name the preferred animation state slug (e.g. "prefer
  state directory that matches `defaultIdle` name") — but reading `animations.json` is cleaner and
  already exists in the character folder as the manifest source-of-truth.
- `src/webview/components/manageTeamPanel.ts:497-523` — `refreshChip()` (post-pick chip):
  uses `source.thumbnailPath` which carries the same arms-raised path from `CharacterSource`. Fix
  to `resolveThumbnailPath` automatically fixes `refreshChip` (same source).
- The picker's `buildCell` thumbnail (characterPicker.ts:176-184) also renders `source.thumbnailPath`
  — same fix.

---

## What I did NOT verify

- Whether the banner destruction race (Bug D) always occurs in both the success and error paths,
  or only the success path. The error path does NOT call `renderFull` first (main.ts:460-471), so
  `bannerSlot()` finds the CURRENTLY mounted slot. If `setup:detection` arrives and triggers
  `renderFull` BETWEEN the error ack processing and the banner display, the error path would have
  the same race. Likely yes — same message queue ordering applies.
- Whether a `forceRefresh()` call from `onSaveTeam` (main.ts:503) ever interleaves messages with
  the `configSaved` ack in practice (depends on watcher-loop implementation timing). The
  `emitDetection()` interleave is confirmed by code inspection; the `forceRefresh` interleave is
  additional risk.
- Whether `animations.json` inside a character folder carries the `defaultIdle` key in the same
  format as the manifest (it should — the manifest is generated from it, but I did not read the
  raw `animations.json` on disk to confirm the exact schema).
- The exact frame index (0) is correct as a still thumbnail for `idle_coffee` — verified for
  M01 by inspecting the folder structure, not for F01.
- Whether the picker-open tracker should key by `memberId` alone (sufficient since only one picker
  can be open at a time per row) or by `(sessionId, teamId, memberId)` as `menuOpenTracker` does.
  Since the picker is inside the panel (not per-session-tile), `memberId` alone is likely sufficient.

---

## Why the data-plane tests missed all four

All four bugs are **interaction-sequence failures** — they require simulating time-separated DOM
events in a real browser rendering context, not just asserting message payload shape:

- **Bug D** requires posting `setup:config-saved` AND then immediately posting `setup:detection` in
  the same microtask drain, then asserting the banner is still visible in the next paint frame. The
  unit test at `teamSetup.test.ts:333-360` asserts that the `ui:save-team` message is posted with
  the correct shape — a spy-only assertion that never touches banner DOM.

- **Bug A** requires asserting that the PREVIEW DOM's role span text matches the scanned agent's
  `.role` field. No test currently asserts `roleSpan.textContent !== "role: —"` when a role is
  available. The wizard test coverage (teamSetup.test.ts) covers scan-step checkbox behavior and
  confirm-button message shape, but not the preview-step role value.

- **Bug B** requires opening the picker, then simulating a poll-tick (`renderFull` call from a new
  `state:full` message), then asserting the picker is still open. No test simulates a re-render
  while the picker is open; the picker-open test (if any) would call `pickBtn.click()` and assert
  `pickerHost.firstChild !== null` in the same synchronous frame, never triggering a re-render.

- **Bug C** requires asserting the `img.src` inside the picker cell renders a neutral-stance frame
  (e.g. `idle_coffee/south/frame_000.png`), not an arms-raised frame. The characterSources unit
  tests cover `isValidCharacterDir` and `toWebRootRelative` but not which specific frame
  `resolveThumbnailPath` selects. The picker component test (characterRender.test.ts) uses a
  hardcoded `thumbnailPath: "sprites/.../thumb.png"` fixture — it never runs the real
  `resolveThumbnailPath` logic.

All four gaps are in the **jsdom/happy-dom DOM-level interaction test** layer (Layer 2 component
tests). The data-plane Layer 1 + 2 tests cover the message protocol and file-system state machine
but not the UI interaction sequence + render-cycle survivability of webview-local state.

---

## Catching interaction tests (one per bug)

**D — Save feedback:**
```
jsdom test: mount renderFull({managePanelOpen: true, manageConfig: config()})
→ click .ct-manage-save-btn (postMessage spy captures ui:save-team)
→ simulate onSetupConfigSaved({ ok: true }) handler (call the handler directly)
→ simulate onSetupDetection({ state: "configured", scanned: [] }) handler
→ assert mount.querySelector(".ct-setup-banner") !== null
   AND mount.querySelector(".ct-setup-banner").dataset.kind === "success"
```
This test would FAIL today because the `setup:detection` handler call destroys the slot.
Fix: the banner must be re-applied after detection re-renders, or the detection re-render must not
destroy the slot when a banner is active.

**A — Preview roles:**
```
jsdom test: const scanned = [{ agentName: "felix", filePath: "...", role: "Extension Host Dev" }]
renderSetupWizard({ scanned, teamNameSeed: "T", postMessage: vi.fn() })
→ click .ct-wizard-preview-btn (advances to preview step)
→ assert mount.querySelector(".ct-wizard-preview-role").textContent === "role: Extension Host Dev"
   (NOT "role: —")
```

**B — Picker survives re-render:**
```
jsdom test: const mount = document.createElement("div")
renderFull({ managePanelOpen: true, manageConfig: config(), ... }, emptyTree())
→ click .ct-manage-pick-btn (first member's pick button)
→ assert mount.querySelector(".ct-character-picker") !== null  (picker open)
→ call renderFull({ managePanelOpen: true, manageConfig: config(), ... }, emptyTree())
   (simulate poll-tick re-render)
→ assert mount.querySelector(".ct-character-picker") !== null  (picker STILL open)
```
This would fail today (picker gone after re-render). Fix: tracker restores picker open-state.

**C — Correct thumbnail frame:**
```
unit test (no DOM): const charDir = join(spritesRoot, "ClaudeTeam-M01-Dev")
const path = resolveThumbnailPath(charDir)
assert path contains "holding_a_coffee_cup"   (or whatever defaultIdle folder is)
assert !path.includes("a_relaxed_tired_upwa")  (not the arms-raised state)
```
Fix: `resolveThumbnailPath` reads `animations.json` to find `defaultIdle`, resolves that state's
south frame first.

---

## Implications for ClaudeTeam

- **Bug D (SEVERE):** The save operation IS working (file written, roster reloads). The issue is
  feedback UX only — the banner is destroyed by the post-save detection re-render. Fix: either (a)
  defer the detection re-render until after the banner's auto-dismiss period, or (b) restore the
  banner after any `renderFull` that follows a successful save while `managePanelOpen` is true (e.g.
  a persistent `pendingBanner` state that `buildCtx` carries and `renderFull` re-applies after mount).
  Fix owner: Maya (webview render cycle) with Felix's awareness on the host message ordering.

- **Bug A:** Cosmetic only — the generated config DOES have the correct role; only the preview row
  is wrong. Fix: `setupWizard.ts:buildPreviewStep` looks up the scanned agent by name and displays
  its `.role`. Fix owner: Maya (webview-only change, single function).

- **Bug B:** Same class, same fix pattern as `menuOpenTracker` (86ca1fjqu). Introduce a
  `pickerOpenTracker: Map<memberId, boolean>` in `boot()`, thread through `buildCtx()` and
  `renderFull` → `renderManageTeamPanel` → `renderEditLayout` → `buildCharacterControls`, and
  restore picker open-state on each rebuild. Fix owner: Maya (webview-only).

- **Bug C:** Fix `resolveThumbnailPath` to prefer the `defaultIdle` animation's south frame over
  the alphabetically-first state. This fixes both the picker thumbnail and the post-pick chip
  (`refreshChip` uses the same `CharacterSource.thumbnailPath`). Fix owner: Felix (host-side
  `characterSources.ts`) — the `thumbnailPath` is resolved at host startup in `resolveCharacterSources`.
