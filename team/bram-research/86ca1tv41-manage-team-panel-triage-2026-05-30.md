# Manage Team Panel Triage — 2026-05-30

## Question

Two symptoms observed in the Manage Team panel / setup wizard on installed build `9e2329a` (2026-05-30 dogfood). The dashboard works perfectly (all 6 members render with auto-resolved roles and pixel characters). Bugs are confined to the Manage Team panel:

1. **Character picker is EMPTY** — the picker grid shows no characters to select, even though the same bundled characters render fine on dashboard tiles.
2. **Roles absent in the Manage Team panel** — auto-resolved roles from `claudeteam.yaml` do not appear in the panel; the wizard's first step shows agents by name/file only.

## Answer (1–3 sentences)

**Symptom 1** is a misidentification: the EDIT layout with its character picker is NEVER rendered, so the picker is structurally absent rather than rendered-but-empty. The root cause is Symptom 2's bug: `roster:loaded` is never emitted by the extension host, so the webview's `manageConfig` is always `null`, which forces the wizard layout even when a `claudeteam.yaml` exists.

**Symptom 2** root cause: the `roster:loaded` host-to-webview message type is defined in `src/shared/messages.ts` and consumed in `src/webview/main.ts:onRosterLoaded`, but the extension host (`src/extension/messageBus.ts`) **never posts this message**. The teams loaded from `claudeteam.yaml` reach the reducer/dashboard tiles through the `state:full` path, but the `manageConfig` variable in the webview is only ever set via `onRosterLoaded` — which is a dead code path. Result: `manageConfig` stays `null` permanently, the panel always shows the wizard (first-run flow), and the edit layout with character picker is unreachable.

## Evidence

### Symptom 2 — `roster:loaded` never emitted

- `src/shared/messages.ts:181-183` — `RosterLoadedMessage` type defined (`type: "roster:loaded"`, payload `{ teams: Team[] }`).
- `src/webview/main.ts:300-303` — `manageConfig` variable declared, comment: _"Parsed config for the panel's edit layout. Synthesized from `roster:loaded` teams"_.
- `src/webview/main.ts:385-402` — `onRosterLoaded` handler sets `manageConfig = { version: 1, teams: msg.payload.teams }` when teams are non-empty, `null` otherwise. This is the ONLY write path to `manageConfig`.
- `src/extension/messageBus.ts` (entire file) — `grep -n "roster:loaded\|RosterLoadedMessage\|postRosterLoaded"` returns ZERO hits. The host exports `postState`, `postSetupCharacters`, `postSetupDetection`, `postSetupConfigSaved` only. There is no `postRosterLoaded` function.
- Bash verification: `grep -rn "roster:loaded\|RosterLoadedMessage\|postRosterLoaded" src/extension/` → no output. The extension host directory has no reference to posting this message type.
- `src/webview/main.ts:119` — `managePanelOpen` starts `false`; `manageConfig` stays `null` for the session lifetime since `onRosterLoaded` never fires.
- `src/webview/components/manageTeamPanel.ts:119-128` — when `config === null`, `renderManageTeamPanel` renders `renderSetupWizard` and returns early. The edit layout (with `renderEditLayout`) is never reached.

### Symptom 1 — Character picker structural absence (consequence of Symptom 2)

- `src/webview/render.ts:405-418` — when `managePanelOpen === true`, calls `renderManageTeamPanel({ config: manageConfig ?? null, ... })`. Since `manageConfig` is always `null`, `config: null` is always passed.
- `src/webview/components/manageTeamPanel.ts:154` — `renderEditLayout` (which contains `buildCharacterControls` → `renderCharacterPicker`) is only called when `config !== null` (line 131).
- `src/webview/components/characterPicker.ts:60-149` — `renderCharacterPicker` is sound: it renders a grid when `sources.length > 0`, "No characters available" otherwise. But it is never instantiated in the current flow.
- Bundled characters ARE present and valid: `ls /c/Users/538252/.vscode/extensions/claudeteam.claudeteam-0.0.1/dist/webview/sprites/` → `ClaudeTeam-F01-Dev` + `ClaudeTeam-M01-Dev`. Both contain `animations.json` + `_pixellab_anims/` (required by `isValidCharacterDir` at `src/extension/characterSources.ts:77-86`). South frames exist under `_pixellab_anims/.../south/frame_*.png` (confirmed 3 sample paths). So `resolveCharacterSources` WOULD return 2 sources if called with the edit layout; this is not a packaging gap.
- `src/extension/main.ts:397-402` — `onRefresh` calls `setupController.emitCharacters()` which populates `characterSources` in the webview. The sources are available, but the edit layout that would render the picker is unreachable.

### The sponsor's "clicked Cancel and team appeared" observation

- `src/webview/components/setupWizard.ts:147-151` — Cancel button calls `onCancel?.()` which maps to `onClose` in `renderManageTeamPanel`, which in `main.ts` sets `managePanelOpen = false` and calls `rerender()`. The dashboard renders normally, showing the correctly-wired tiles. The tiles use `tile.character` and `GENERATED_SPRITE_MANIFEST` (not the character-picker path), so they work fine regardless of the missing `roster:loaded`.
- The wizard step 2 (Preview) shows `"character: not set"` and `"role: —"` per `src/webview/components/setupWizard.ts:193-204`. There is no character picker in the wizard. The sponsor's report of "character picker empty" correctly describes the wizard's "character: not set" row.
- The wizard step 1 only shows `agent.agentName` and `basename(agent.filePath)` — roles from `ScannedAgent.role` are NOT displayed in the scan list (per `setupWizard.ts:112-139`). The preview step also renders `"role: —"` (hardcoded blank, not from `ScannedAgent.role`). So auto-resolved roles are structurally absent from wizard output even though `ScannedAgent.role` carries them (per `src/shared/types.ts:280`).

### Wizard running on an existing config

- When `claudeteam.yaml` exists, `setup:detection` sends state `"configured"` (via `src/extension/roster/detection.ts` + `setupController.ts:104-107`). The webview's `onSetupDetection` handler sets `setupDetection.state = "configured"` and re-renders.
- `src/webview/render.ts:421-441` — `"configured"` state falls through to the normal dashboard. The Manage Team panel is opened separately via `ui:open-manage-team`.
- On `ui:open-manage-team` → `managePanelOpen = true` → `renderManageTeamPanel({ config: manageConfig ?? null, ... })` → since `manageConfig === null` → wizard renders. The wizard's `scanned` comes from `setupDetection.scanned` (correctly populated). So the wizard shows the 6 agents scanned from `.claude/agents/`, which the sponsor sees, and can proceed through or Cancel.

## What I did NOT verify

- Whether the wizard's "Confirm & create" path (`ui:run-setup`) then causes `roster:loaded` to fire (via the watcher's next tick emitting `state:full` which includes roster data). Unverified — would need to trace the `runSetup` → `emitDetection` → `forceRefresh` → watcher-tick → `onStateChange` path to see if `roster:loaded` is posted anywhere in the tick code. Hypothesis: it is NOT posted there either, based on the grep returning zero hits, but the tick code (`watcherLoop.ts`) should be traced by the fix author.
- Whether the wizard DOES populate `manageConfig` after "Confirm & create" completes (via `setup:config-saved` ack + follow-up detection reemit). The `onSetupConfigSaved` handler re-renders but doesn't set `manageConfig`. Verdict: even after wizard completion, `manageConfig` stays `null` until `roster:loaded` is sent — which never happens.
- The exact UX the sponsor experienced — whether they completed the wizard or hit Cancel on step 1 or step 2.
- Thumbnail path correctness in the edit layout (separate secondary concern): `resolveThumbnailPath` in `characterSources.ts:94-129` returns an ABSOLUTE filesystem path; the picker's `img.src` construction at `characterPicker.ts:179` prepends `spriteBaseUri` (a `vscode-webview://` URI) to the stripped absolute path, which would produce a broken URL. This SECONDARY bug would cause thumbnails to fail even if the edit layout were reached. Labels would still render; the picker would not be functionally empty. Labeling this as "predicted symptom — verify before patching."

## Implications for ClaudeTeam

- **Fix owner: Felix (host-side)** — the host must emit `roster:loaded` after each successful roster load in the watcher tick. Looking at `watcherLoop.ts` line 561, `loadRoster` is called there; the result should be posted via a new `postRosterLoaded(webview, result.roster)` in `messageBus.ts`. Felix's lane is extension host data plane.
- **Secondary thumbnail fix owner: Maya (webview-side)** — `resolveThumbnailPath` returns an absolute path; the picker should either (a) store paths relative to `dist/webview/` (matching the sprite manifest convention) or (b) convert the absolute path to a relative path before storing in `CharacterSource.thumbnailPath`. This is a separate ticket from the `roster:loaded` gap.
- The wizard DOES correctly display scanned agents (step 1) with the `role` field available on `ScannedAgent` — but the wizard UI does NOT surface those roles in either the scan list or the preview. Whether to show auto-resolved roles in the wizard preview is a UX call for Iris; the sponsor saw "role: —" which was confusing but not a bug per the current spec.
- The "roles absent in Manage Team panel" symptom (Symptom 2) is a real bug (not design) — when the panel serves the edit layout (post-fix), role fields come from `Member.role` which IS populated from `claudeteam.yaml` via the existing roster-load path. The sponsor would see roles once the edit layout is reachable.
