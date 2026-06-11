# E4 — Live Playback Tuner UX Spec

**Ticket:** `86ca21882` (E4, child of epic `86ca2182g`) · **Author:** Iris (UX) · **Date:** 2026-06-01
**Reviewer:** Maya (visual) / Felix (spec edges). NOT Sage (no code).
**Gates:** E5 (`86ca21884` — Maya impl + Sage QA).
**Scope flag:** solo-user / experimental — sponsor is the only user. Functional spec over pixel-polish (per ticket OOS). This is a power-user dev aid, NOT a Marketplace surface.

**Amendment history:**
- 2026-06-12 (`86ca5eve1`, Phase 1) — **§12 added: apex-hold (`dwellFrameIndex` + `dwellMs`) field-set amendment.** Un-LOCKs the original three-field set (§10 OOS #3) to include the apex-hold pair, which was already exposed by ticket `86ca2bqe1` and is **shipped on `origin/main`** (verified `git rev-parse origin/main = f1ae6a73cbbca12f80e84cd7af6105e4ecdb382e` this task; `git grep -c "Hold (apex)" = 5`, `dwellFrameIndex` ×21 in `src/webview/components/playbackTuner.ts`). This amendment is **documentation-reconciling, not net-new design** — it brings the E4 spec body into line with the already-shipped apex control so the spec stops contradicting itself (§10 OOS #3 said the apex pair was OOS while its own 2026-06-02 update noted it had been exposed). See §12 for the full apex-hold control-type, apex-shadow-interaction, placement, and persistence-banner spec.

---

## 0. Verified ground truth (read before designing against this spec)

Every line ref below was re-verified by `grep`/Read against `src/webview/sprites/spritePlayer.ts` on `main` at `HEAD = ad4c12b2ae9d0eb5e47148240a847010c2be1800` (E1+E2+E3 already shipped — the backlog's snapshot was pre-merge). **Implementers: trust these refs; they are live, not from the backlog.**

| Concept | Live location | Note |
|---|---|---|
| `FRAME_MS_DEFAULT = 160` | `spritePlayer.ts:55` | default per-frame ms |
| `DWELL_MS_DEFAULT = 400` | `:57` | engine-default final-frame hold |
| `PEAK_DWELL_MS_DEFAULT = 600` | `:61` | engine-default peak-frame hold |
| `type PlaybackMode = "loop" \| "pingpong"` | `:71` | exported (E1) |
| `interface PlaybackOverride` | `:78–126` | fields: `speedMultiplier?`, `dwellFrameIndex?`, `dwellMs?`, `finalDwellMs?`, `playbackMode?`, `startFrame?`, `endFrame?` |
| `resolvePlayback(characterName, animName, source?)` | `:171–192` | **manifest-fed (E2) + 3-layer field cascade (E3).** `source` accepts the baked `GENERATED_SPRITE_MANIFEST` (default) **OR a flat `Record<charName, PlaybackOverrideTable>` injection** |
| `createSpriteBox(props)` | `:315` | engine factory; resolves override at build time `:404–406` |
| `SpriteBoxProps.playbackTable?: Record<string, PlaybackOverrideTable>` | `:243` | **the in-memory override injection point — the live-preview lever** |
| `props.priorFrameIdx / priorDirection / priorPose` + `handle.currentFrame()` | `:265–273`, `:297`, `:546` | re-render position resume (86ca2c4t8) |
| consumers of `createSpriteBox` | `agentTile.ts:272`, `multiAgentPersonaTile.ts:270` | both dashboard tiles |
| build script (json → manifest) | `scripts/build-sprite-manifest.mjs` | emits `src/webview/sprites/generatedManifest.ts` |
| per-char json | `assets/sprites/ClaudeTeam-{M01,F01}-Dev/animations.json` `playback` block | E2 schema |
| pose-defaults json | `assets/sprites/pose-defaults.json` | E3 cascade middle layer |

### 0.1 Reconciliation note — `maya/86ca1fntp-playback-tuning` (ticket "reconcile against" line — SATISFIED)

The orchestrator verified this session (2026-06-01) that the `maya/86ca1fntp-playback-tuning` branch carries **NO tuner UI** — only the superseded `PLAYBACK_OVERRIDES` engine work, which `main` already carries (and which E2 migrated into the manifest, removing the hardcoded map). **There is nothing to reconcile UI-wise.** This spec is greenfield for the tuner surface. The ticket-body "reconcile against any tuner work on that branch" obligation is hereby discharged.

---

## 1. The crux: how live preview works WITHOUT a rebuild

This is the make-or-break the sponsor flagged. State it honestly:

### 1.1 The hard reality

The webview runtime reads the **compiled** `generatedManifest.ts` (baked into the bundle by `build-sprite-manifest.mjs`), **NOT** `animations.json` / `pose-defaults.json` at runtime. So a json write only "takes" on the **next rebuild + reload**. A naive "edit json → see it" loop does not exist and cannot be built without a file-watcher + re-bundle, which is out of scope and slow.

### 1.2 The live-preview mechanism (in-memory override path)

The engine ALREADY exposes the exact seam we need: `createSpriteBox` accepts an optional `playbackTable: Record<charName, PlaybackOverrideTable>` prop (`spritePlayer.ts:243`). When present, the factory resolves the override from THAT injected table instead of the baked manifest (`:404–406`):

```
const override = playbackTable
  ? resolvePlayback(char.character, canonicalName, playbackTable)
  : resolvePlayback(char.character, canonicalName);
```

The flat-table form of `resolvePlayback` (`:178–180`) returns the per-char entry directly, with no pose-default layer — exactly what a single-anim preview needs.

**Therefore the live-preview path is:**

1. The tuner holds the current slider/dropdown values in **webview-local state** (NOT host state) as a `PlaybackOverride` object — call it `draftOverride`.
2. The preview pane renders its sprite via `createSpriteBox({ ...previewProps, playbackTable: { [previewChar]: { [previewAnim]: draftOverride } } })`.
3. On EVERY control change (debounced — §6), the tuner **disposes the current preview `SpriteBoxHandle` and rebuilds the box** with the new `draftOverride`. Result: the live sprite reflects the tweak **instantly, in-memory, with zero rebuild** — because the injected `playbackTable` shadows the baked manifest for that one preview sprite.

This is purely webview-local; the host is not involved in live preview. **No rebuild, no reload, no host round-trip for the visual feedback.** (See §5 for why we rebuild the box rather than mutate the running timer.)

### 1.3 The persistence round-trip (separate from live preview)

Live preview ≠ persistence. The values must ALSO auto-save to json so they survive a real rebuild and apply to the actual dashboard tiles. The save path is a SEPARATE concern:

- The tuner sends a webview→host message (§4) carrying `{ writeTarget, characterFolder?, animName, override }`.
- The host writes the merged `playback` block into the correct json file (`animations.json` per-char, or `pose-defaults.json`).
- **The dashboard tiles do NOT change until the next `npm run build` + reload** (they read the baked manifest). The tuner UI must say this explicitly (§3.6 persistence banner) so the sponsor is never confused about why the live preview moved but the real tiles didn't.

**Summary of the two paths (the sponsor must understand both):**

| Path | Mechanism | Latency | Surface affected |
|---|---|---|---|
| **Live preview** | inject `playbackTable` into `createSpriteBox` | instant (debounced) | the tuner's preview sprite ONLY |
| **Persistence** | host writes json | on save (debounced) | real dashboard tiles, **after next rebuild + reload** |

This honest split is the entire reason E5 is sized L, not S — the in-memory preview path and the json write path are two distinct mechanisms that happen to be driven by the same controls.

---

## 2. Placement — RECOMMENDATION (sponsor reviews at E4 gate)

The sponsor deferred placement to this spec. **Recommendation: a dedicated "Playback Tuner" panel, opened on demand from a command + dashboard title-bar action — NOT embedded inline in the dashboard tile flow, and NOT a separate WebviewView in a new Activity Bar container.**

**Recommended: reuse the existing on-demand panel pattern (mirror Manage Team).**

The dashboard already has the `setup:open-manage-team` pattern (`messages.ts:320`): a `claudeteam.manageTeam` command + title-bar button posts a host→webview message; the webview flips a webview-LOCAL `managePanelOpen` flag and re-renders the panel as a full-dashboard-root overlay. The tuner should clone this exactly:

- New command `claudeteam.openPlaybackTuner` (Command Palette + dashboard title-bar icon).
- New host→webview message `setup:open-playback-tuner` (no payload).
- Webview-local `tunerPanelOpen` flag in `main.ts`; when true, `renderPlaybackTuner(...)` replaces the dashboard root (same as Manage Team).
- Closing the panel returns to the normal dashboard.

**Why this over the alternatives:**

| Option | Verdict | Rationale |
|---|---|---|
| **A — On-demand panel (mirror Manage Team)** ✅ RECOMMENDED | Chosen | Reuses a proven, tested pattern (open-flag + root-swap). No new Activity Bar container, no new WebviewView lifecycle. The tuner is a power-user dev aid used occasionally — it should not consume permanent dashboard real estate. Discoverable via command + title-bar button. |
| **B — Inline in each dashboard tile** ✗ | Rejected | Clutters the calm always-visible dashboard with controls the sponsor touches rarely. Couples tuning to a specific live agent's tile (tuning needs a stable preview sprite, not whichever agent happens to be running). |
| **C — Separate Activity Bar view container** ✗ | Rejected | Heavier: new `viewsContainers` + `views` manifest entries + a second `WebviewViewProvider` + its own boot handshake (`vscode-extension-conventions.md` § fire-and-forget postMessage). Disproportionate for a solo-user experimental aid. |

**Open sponsor question (one):** is on-demand-panel placement acceptable, or does the sponsor want it always-visible alongside the dashboard? Recommendation is on-demand panel. (Flagged in the final report.)

---

## 3. Layout — wireframe + per-control spec

The tuner panel is a single vertical column. Theme-aware (`--vscode-*` tokens; §8). ASCII wireframe:

```
┌───────────────────────────────────────────────────────────┐
│  Playback Tuner                                       [✕]  │  ← header (title + close, mirrors Manage Team)
├───────────────────────────────────────────────────────────┤
│                                                           │
│  Character   [ ClaudeTeam-M01-Dev      ▾ ]                │  ← §3.1 char selector
│  Animation   [ idle_stretch            ▾ ]                │  ← §3.1 anim selector
│                                                           │
│  ┌─────────────────┐                                      │
│  │                 │   Effective values (source):         │  ← §3.5 cascade/source display
│  │   ▓▓▓ live ▓▓▓   │     speed     0.5×   (per-char)      │
│  │   ▓ preview ▓    │     hold      800ms  (pose-default)  │
│  │   ▓▓ sprite ▓▓   │     mode      pingpong (engine def.) │
│  │                 │                                      │
│  └─────────────────┘                                      │
│   68×68 createSpriteBox                                    │
│                                                           │
│  ── Controls ──────────────────────────────────────────   │
│                                                           │
│  Speed        ──────●─────────   0.50×    [reset]          │  ← §3.2 speedMultiplier
│               0.25×        2.0×                            │
│                                                           │
│  Hold (final) ──────●────────   800 ms   [reset]          │  ← §3.3 finalDwellMs
│               0 ms       2000 ms                          │
│                                                           │
│  Mode         ( ) loop   (•) pingpong                     │  ← §3.4 playbackMode
│                                                           │
│  ── Write target ─────────────────────────────────────    │
│  (•) This character (M01-Dev/animations.json)             │  ← §3.7 write-target chooser
│  ( ) All characters (pose-defaults.json)                  │
│                                                           │
│  ┌──────────────────────────────────────────────────┐    │
│  │ ✎ Saved to pose-defaults.json. Rebuild + reload   │    │  ← §3.6 persistence banner
│  │   to apply to the live dashboard tiles.           │    │
│  └──────────────────────────────────────────────────┘    │
└───────────────────────────────────────────────────────────┘
```

### 3.1 Character + animation selectors

Two native `<select>` dropdowns (theme-styled).

- **Character `<select>`** — options = `Object.keys(GENERATED_SPRITE_MANIFEST.characters)` (e.g. `ClaudeTeam-M01-Dev`, `ClaudeTeam-F01-Dev`). Default = first key. The display string IS the folder name (no friendly alias needed — solo-user dev aid; the folder name is the canonical identity the json write targets).
- **Animation `<select>`** — options = `Object.keys(GENERATED_SPRITE_MANIFEST.characters[selectedChar].animations)` for the selected character (canonical names: `idle_coffee`, `idle_stretch`, `active_work`, `active_read`, …). Default = the character's `defaultIdle` if set, else the first anim key. **Re-populated whenever the character changes** (animation sets can differ between characters; an anim valid for M01 may not exist on F01).
  - **Impl delta — `active_work` hidden, with an active-pool exception (86ca4g2fh → 86ca5ftzp).** `active_work` is in `TUNER_HIDDEN_ANIMS` and suppressed from this dropdown (cosmetic — for rich-pool chars it's the non-tunable legacy fallback while the 3 work poses are what's tuned). **Exception (86ca5ftzp):** when `active_work` is ITSELF the character's lone `active_pool` member (the v3 92×92 single-member-pool shape — F02/M01/M03), it is **un-hidden** so it stays selectable. The Active-pool Source's Prev/Next + Cycle-over-room set `selectedAnim` to it; a hidden (unselectable) option would silently desync the Animation dropdown (its `.value` resets to blank). Rule: an anim in `TUNER_HIDDEN_ANIMS` is kept iff it is in the selected char's `activePool` (`selectableAnimNames`, `playbackTuner.ts`). Test: `playbackTunerStepScene.test.ts` § "86ca5ftzp — active pool [active_work]".
- Changing EITHER selector:
  1. Re-seeds `draftOverride` from the **current effective resolved value** for (char, anim) via `resolvePlayback(char, anim)` against the baked manifest (so the sliders open showing the real current state, not zeros). See §3.5.
  2. Rebuilds the preview sprite (§5).

### 3.2 Speed slider → `speedMultiplier`

- Bound field: **`speedMultiplier`** (LOCKED vocabulary).
- Range: `0.25` → `2.0`, step `0.05`. Default thumb position = the resolved effective `speedMultiplier` (engine default `1.0` when unset).
- Display: the numeric value to 2 decimals + `×` (e.g. `0.50×`). Pair the slider with a visible numeric readout (no icon-only — accessibility rule).
- Semantics reminder for the readout tooltip/aria: "fraction of default frame rate; 0.5× = half speed = 2× per-frame ms" (matches `spritePlayer.ts:79–83`).
- `[reset]` affordance clears this field from `draftOverride` (reverts to inherited/engine value; the readout then shows the cascade-resolved value with its source tag).

### 3.3 Hold slider → `finalDwellMs`

- Bound field: **`finalDwellMs`** (LOCKED vocabulary, the NEW E1 field).
- Range: `0` → `2000` ms, step `50`. Default thumb = resolved effective `finalDwellMs` (engine default `DWELL_MS_DEFAULT = 400` when unset).
- Display: integer + ` ms`.
- aria-label: "Final-frame hold before the loop restarts, in milliseconds."
- `[reset]` clears the field from `draftOverride`.
- **Note for the readout:** in `pingpong` mode the engine fires this dwell only on the FORWARD arrival at the window end (`spritePlayer.ts:490`), not on the reverse pass — surface this as helper text so the sponsor isn't surprised the hold "only happens at one end."

### 3.4 Mode control → `playbackMode`

- Bound field: **`playbackMode`** (LOCKED vocabulary).
- Control: a two-option radio group (`loop` / `pingpong`) — NOT a `<select>` (only two values; radios are one-click and self-documenting). Each radio has a visible text label (`loop`, `pingpong`) — no icon-only.
- Discriminator literals are exactly lowercase `"loop"` and `"pingpong"` (LOCKED).
- Default selection = resolved effective `playbackMode` (engine default `"loop"` when unset).
- Selecting `loop` may either set `playbackMode: "loop"` explicitly OR clear the field — **clear it** (omit) so the saved json stays minimal and inherits cleanly; the cascade treats absent == `"loop"`. Document this in the save payload contract (§4).

### 3.5 Cascade / source display (AC3) — effective value + originating layer

Beside the preview, render a small read-only table showing, for EACH of the three fields, the **effective resolved value** AND **which cascade layer it came from**. This is load-bearing: the sponsor must understand why a value is what it is before tweaking it.

The three layers (per `resolvePlayback`, E3, `spritePlayer.ts:140–192` + `spriteManifest.ts:67–85`):

1. **per-char** — `manifest.characters[char].animations[anim].playback.<field>` (highest priority)
2. **pose-default** — `manifest.poseDefaults[anim].<field>` (shared across all chars)
3. **engine default** — the absent-field behavior (`speedMultiplier`→1.0, `finalDwellMs`→400, `playbackMode`→"loop")

For each field, compute the source tag by checking the layers top-down on the BAKED manifest (the live-preview `draftOverride` is excluded from this — the source table reflects what's persisted/baked, the sliders reflect the draft):

| Field | Effective value | Source tag |
|---|---|---|
| speed | resolved number | `per-char` \| `pose-default` \| `engine default` |
| hold | resolved number | (same) |
| mode | resolved literal | (same) |

**Why two surfaces (source table vs slider readout) can differ:** the slider readout = the live DRAFT the sponsor is editing; the source table = what is currently BAKED/persisted. When the sponsor moves a slider, the slider readout updates immediately but the source table only updates after a save lands AND (for the "engine sees it" reality) a rebuild. To keep this honest without confusing, the source table shows the **baked** state and the persistence banner (§3.6) tells the sponsor a save happened but needs a rebuild. (E5 may optionally re-pull the source table after the host save-ack to reflect the new layer; mark that as a nicety, not required.)

**Field-level merge reminder (E3 AC2):** a per-char entry that sets ONLY `speedMultiplier` still inherits `playbackMode`/`finalDwellMs` from the pose-default — so the three source tags can legitimately differ per field for the same anim (speed=per-char, hold=pose-default, mode=engine). The table MUST resolve each field independently, never label the whole anim with one source.

### 3.6 Persistence banner — the honesty surface (load-bearing)

A persistent inline banner below the write-target chooser. After every successful save (host ack), it reads:

> ✎ Saved to `<filename>`. Rebuild + reload to apply to the live dashboard tiles.

Where `<filename>` is `<characterFolder>/animations.json` or `pose-defaults.json` per the write target. Before any save in the session, the banner reads a neutral idle state (e.g. "Adjust a control to tune; changes auto-save."). On a failed save (host ack `ok:false`), it switches to an error state: "Couldn't save: `<error>`" and keeps the draft (mirror the `setup:config-saved` ok:false pattern, `messages.ts:298`).

This banner is the single most important honesty surface in the tuner — it is what prevents the sponsor from thinking "I saved but the dashboard didn't change → it's broken." The live preview moved; the dashboard tiles are baked. Say so, always.

### 3.7 Write-target chooser (AC2)

A two-option radio group choosing where the save lands:

- **(•) This character** → writes to `<selectedCharacterFolder>/animations.json`'s `playback` block for `<selectedAnim>` (the per-char layer).
- **( ) All characters** → writes to `assets/sprites/pose-defaults.json` for `<selectedAnim>` (the pose-default layer, shared across all chars).

**Default = "This character"** (the safer, narrower scope — a pose-default edit changes every character at once and is the heavier hammer).

**Decision rationale surfaced to the sponsor inline** (helper text under the radios): "This character = tune only M01-Dev's idle_stretch. All characters = set the default for every character's idle_stretch (per-char tweaks still override)." This makes the cascade consequence legible at the point of choice.

**Interaction with the cascade:** when the sponsor writes to "All characters" but a per-char override already exists for that (char, anim, field), the per-char value WINS on the dashboard — the live preview for THIS character won't reflect the pose-default change for that field. The tuner should warn inline when this shadowing is in effect: "⚠ This character overrides <field> per-char; the pose-default you're setting won't show for M01-Dev." (Derive from the source table §3.5 — if the field's source tag is `per-char` and the target is "All characters", show the warning.)

---

## 4. Save semantics + host message contract (AC2 / AC3)

Live preview is webview-local (§1.2). Persistence crosses webview→host. New message types (additive, never overload — `messages.ts` rule). E5 author finalizes exact names; proposed shape:

### 4.1 Webview → Host: save a playback override

```
type SavePlaybackOverrideMessage = {
  type: "ui:save-playback-override";
  payload: {
    writeTarget: "per-char" | "pose-default";
    characterFolder?: string;   // required when writeTarget==="per-char"; the manifest char key
    animName: string;           // canonical anim name
    override: {                 // ONLY the set fields — omitted fields are cleared (reset)
      speedMultiplier?: number;
      finalDwellMs?: number;
      playbackMode?: "loop" | "pingpong";
    };
  };
};
```

- **Field-omission == clear.** The payload's `override` carries ONLY fields the sponsor has set away from inherited/default (i.e. the `draftOverride` after `[reset]`s applied). The host MERGES these into the json entry, and a field absent from the payload is REMOVED from the json entry (so `[reset]` actually unsets it, restoring inheritance). Document this clearly — it is the difference between "set to default value" and "clear so it inherits."
- All payload values JSON-safe (no `undefined` values on the wire — omit keys instead; `messages.ts` JSON constraint).

### 4.2 Host → Webview: save ack

Reuse the existing `setup:config-saved` shape semantics, but as a distinct type to avoid coupling to the team-setup flow:

```
type PlaybackOverrideSavedMessage = {
  type: "playback:override-saved";
  payload: { ok: boolean; error?: string };
};
```

- `ok:true` → tuner shows the §3.6 saved banner.
- `ok:false` → tuner shows the error banner, keeps the draft.

### 4.3 Host-side write behavior (for E5 / Felix spec-edge review)

- The host writes `<workspace>/assets/sprites/<characterFolder>/animations.json` (per-char) or `<workspace>/assets/sprites/pose-defaults.json` (pose-default).
- The write is a **structured field-level merge into the existing file**, NOT a whole-file replace: load the current json, set/delete the three playback fields for `animName` under the file's `playback` block (per-char) or top-level keyed block (pose-default), re-serialize, write. Preserve the existing `animations` name→folder map (per-char file) and any other anims' playback entries untouched.
- **This is a NEW host write path** — it is NOT `writeClaudeTeamConfig` (that writes `claudeteam.yaml`). E5 adds a new host module (e.g. `src/extension/sprites/playbackOverrideWriter.ts`) + wires the message handler. Flag to Felix: this is the spec-edge that needs his eyes — the json schema the writer produces MUST match what `build-sprite-manifest.mjs` reads (E2's schema). If E2's per-anim `playback` block shape and the writer diverge, the rebuild silently drops fields (same failure class as the dual-schema `claudeteam.yaml` trap in `roster-matching.md` § "reads through TWO divergent schemas").

> **Felix dependency callout (spec edge):** the EXACT on-disk `playback` block shape in `animations.json` and `pose-defaults.json` is owned by E2/E3 (`build-sprite-manifest.mjs`). The writer in E5 MUST emit byte-compatible json or the build drops the fields. E5's dispatch should either (a) cite the E2 schema doc/code as the contract, or (b) have Felix confirm the writer's output round-trips through the build script. This spec does NOT re-invent the schema — it defers to E2's shipped shape.

---

## 5. Live-preview rendering mechanics (AC3)

### 5.1 Build/dispose cycle, not timer mutation

`createSpriteBox` resolves the override ONCE at box-build time (`spritePlayer.ts:404–419`) and bakes `frameMs` / `finalDwellMs` / `isPingpong` / window into the running `tick()` closure. There is **no public API to mutate a live box's timing.** Therefore the live-preview update on each control change is:

1. `previewHandle.dispose()` (stops the timer, `:532`).
2. Build a fresh box: `createSpriteBox({ char, state, activity, spriteBaseUri, playbackTable: { [char]: { [anim]: draftOverride } }, ...resume })`.
3. Replace the preview DOM node with the new `handle.element`.

### 5.2 Choosing the preview's `state` + `activity` so the right pose plays

The pose the preview shows must be the SELECTED `animName`, not whatever a real agent is doing. Drive `createSpriteBox`'s pose selection deterministically:

- For an `active_*` anim: set `state="running"` and `activity` such that `poseNameForTile` resolves to it (`active_read` needs tool==Read; `active_work` needs tool!=Read — see `posePicker.ts`).
- For an `idle_*` anim: set `state` to a non-running state and thread `priorIdlePick = animName` + `priorWasActive = false` so the idle-stickiness path picks exactly that pool member (`spritePlayer.ts:339–342`) rather than a random one.

E5 author: the cleanest path is a small preview-only helper that, given `(char, animName)`, returns the `{ state, activity, priorIdlePick }` triple that forces `canonicalName === animName`. This avoids fighting the random idle picker. (Functional, jsdom-testable: assert the built box's `handle.pose === animName`.)

### 5.3 Preview position resume — keep it OR reset it deliberately

The engine supports position resume across re-renders (`priorFrameIdx`/`priorDirection`/`priorPose`, `:462–471`). For the tuner preview:

- On a **control change that does NOT change the anim** (speed/hold/mode tweak): **reset to `winStart`** (do NOT thread prior position). Rationale: the sponsor is judging the FEEL of the new timing from a clean loop start; resuming mid-cycle muddies the comparison. Pass `priorPose = undefined` so the new box starts fresh.
- On an **anim/char change**: also fresh (different pose → resume wouldn't fire anyway).

So the tuner preview always restarts the loop on any change. This is the opposite of the dashboard-tile behavior (which resumes to survive poll re-renders) and is intentional — the tuner is a feel-judging surface, not a calm always-on tile.

### 5.4 Reduced-motion

`createSpriteBox` shows frame-0-only under `prefers-reduced-motion: reduce` (`:383`). In the tuner that defeats the purpose (you can't judge timing of a static frame). **Recommendation:** the tuner preview passes `reducedMotion: false` EXPLICITLY (the `reducedMotion` prop override, `:230`) so the preview always animates regardless of the OS setting — the sponsor opened the tuner specifically to watch motion. Document this as a deliberate, scoped exception (the dashboard tiles still honor reduced-motion; only the tuner's own preview overrides it). Flag as a minor sponsor-feel call if the sponsor prefers the tuner honor reduced-motion too.

---

## 6. Debounce semantics (AC3)

Two independent debounce timers — they serve different costs:

| Action | Debounce | Rationale |
|---|---|---|
| **Live-preview rebuild** | **~120 ms** (short) | dispose+rebuild a single 68×68 box is cheap; the sponsor wants near-instant visual feedback while dragging a slider. Short debounce coalesces the rapid `input` events of a drag into ~8 rebuilds/sec — smooth enough, not wasteful. |
| **Host json save** | **~500 ms** (longer) | a file write per slider pixel is wasteful and risks write races. Coalesce to fire ~0.5 s after the sponsor STOPS adjusting. Use the trailing edge (save the settled value, not intermediate ones). |

- Slider `input` events drive the preview (short debounce). The save fires on the trailing edge of the longer debounce after activity stops.
- Mode radio + write-target radio are discrete (not a drag): rebuild preview immediately; save on the same ~500 ms trailing debounce (so a quick mode flip + speed nudge coalesce into one write).
- `[reset]` on a field: immediate preview rebuild + queue a save (it changes the persisted set by clearing a field).
- Implementation note for E5: both debounces are webview-local timers; under `vi.useFakeTimers()` they are jsdom-testable (assert: N rapid `input` events → 1 trailing save message with the final value; assert preview rebuilt with the latest `draftOverride`). This is FUNCTIONAL behavior → Layer-2.5 required, not sponsor-deferred (`testing-strategy.md` § Layer decision rule).

---

## 7. Edge cases + empty states

- **No bundled characters in the manifest** (`Object.keys(characters).length === 0`): tuner renders an empty state — "No sprite characters available to tune." No selectors, no preview. (Defensive; should not happen post-build, mirrors `setup:characters` empty-grid defense.)
- **Selected anim has zero frames** (`animations[anim].frames.length === 0`): preview shows an empty box; `createSpriteBox` already returns a no-op handle (`:366`). The tuner should surface "This animation has no frames" rather than a blank box. Controls stay usable (the values still save) but the persistence banner notes the preview can't render.
- **Single-frame anim**: `createSpriteBox` shows the frame statically with no loop (`:516`). Speed/hold/mode have no visible effect on a 1-frame anim — surface a quiet note "single-frame anim — timing has no visible effect" so the sponsor isn't puzzled. Values still save (harmless).
- **Pingpong on a 1- or 2-frame window**: the engine's `isPingpong && winEnd > winStart` guard (`:499`) falls back to loop for a single-frame window. No tuner-side handling needed; just don't claim pingpong is active when it can't be.
- **`finalDwellMs` on an `active_*` anim**: the engine only applies the final-frame dwell when `!isActive` (`:490`). So setting `finalDwellMs` on `active_work`/`active_read` saves the value but has NO visible effect (active loops run at uniform cadence). Surface a quiet note: "final-frame hold applies to idle poses only" when an active anim is selected.

---

## 8. Design tokens (theme-aware)

All chrome uses `--vscode-*` tokens so the tuner adapts to light/dark automatically (`vscode-extension-conventions.md` § Webview rules — theme variables only; hardcoded hex only for semantic state color, of which the tuner has none).

| Surface | Token |
|---|---|
| Panel background | `--vscode-editor-background` |
| Panel/section text | `--vscode-foreground` |
| Section dividers, borders | `--vscode-panel-border` |
| `<select>` / radio chrome | `--vscode-settings-dropdownBackground` / `--vscode-settings-dropdownBorder`; radios `--vscode-settings-checkboxBackground` |
| Slider track / thumb | `--vscode-scrollbarSlider-background` (track) + `--vscode-button-background` (thumb fill) — or the native `input[type=range]` styled with `--vscode-foreground` accent |
| Numeric readouts | `--vscode-descriptionForeground` (secondary) |
| `[reset]` link | `--vscode-textLink-foreground` |
| Saved banner | text `--vscode-foreground` on `--vscode-editor-inlineHint-background` (subtle) |
| Error banner | `--vscode-inputValidation-errorForeground` on `--vscode-inputValidation-errorBackground` |
| Cascade source tags | `--vscode-badge-background` / `--vscode-badge-foreground` (small chips) |
| Shadowing warning (⚠) | `--vscode-inputValidation-warningForeground` on `--vscode-inputValidation-warningBackground` |

Reuse existing tuner-adjacent CSS classes from `dashboard.css` where they already exist (Manage Team panel chrome). New classes follow the `ct-` prefix convention. **Honor the existing `--ct-*` animation tokens** (`--ct-anim-frame-ms-default`, `--ct-anim-dwell-ms-default`) — the tuner READS the same defaults the engine does; do not re-declare them.

**`[hidden]`-guard reminder (load-bearing — `vscode-extension-conventions.md` § `[hidden]`-toggled flex/grid):** if the tuner panel root or any sub-popover (e.g. the shadowing warning) is toggled via the `hidden` attribute AND its CSS declares `display:flex|grid`, it MUST carry an explicit `.<class>[hidden] { display:none }` guard, or it renders open in real VS Code (jsdom won't catch it). E5's `[hidden]`-guard test is source-derived (scan, don't allowlist).

---

## 9. Accessibility

- Every slider, dropdown, and radio has a visible text label (already in the wireframe) AND an `aria-label` / associated `<label>` — no icon-only controls (Iris hard rule).
- Sliders are native `input[type=range]` (keyboard-operable: arrows step, Home/End to bounds) with `aria-valuemin/max/now/text` (the text form reads "0.50 times" / "800 milliseconds").
- Mode + write-target are native radio groups (keyboard arrow nav within the group, single tab-stop).
- Focus order: char → anim → speed → hold → mode → write-target → close. Logical top-to-bottom.
- The preview sprite `<img>` is `aria-hidden="true"` (decorative; `createSpriteBox` already sets this, `:360`) — the cascade source table (§3.5) is the screen-reader-accessible representation of the timing state.
- Escape closes the panel (mirror Manage Team's close affordance).

---

## 10. Out of scope (for E5 — explicit, per ticket OOS)

E5 (Maya impl) MUST NOT include:

1. **Engine changes** — E1 shipped (`finalDwellMs`, `playbackMode`, window, resume). The tuner CONSUMES the engine; it does not modify `spritePlayer.ts`'s sequencer. (One exception, NOT an engine change: the preview helper §5.2 may live in a new tuner-side module — it calls `createSpriteBox`, doesn't edit it.)
2. **Schema / build-script changes** — E2/E3 shipped the `animations.json` / `pose-defaults.json` `playback` schema + `build-sprite-manifest.mjs` threading + the cascade. The tuner's host writer MUST emit that EXISTING schema, not a new one. No new json fields.
3. **New playback fields** — ~~only `speedMultiplier`, `finalDwellMs`, `playbackMode` are tunable. `dwellFrameIndex`/`dwellMs` (peak dwell) and `startFrame`/`endFrame` (window) are NOT exposed in this tuner~~ **(SUPERSEDED — see below).** The ORIGINAL E5 scope locked the field set to three (`speedMultiplier`, `finalDwellMs`, `playbackMode`); the apex pair and window were initially deferred (per-character frame-index values that require knowing the exact frame sequence). **Update 2026-06-02:** `dwellFrameIndex`/`dwellMs` were exposed (apex hold, `86ca2bqe1`) and `startFrame`/`endFrame` (window) by `86ca2wj6u` — see `team/iris-design/anim-tuner-window-control-spec.md`. **Amendment 2026-06-12 (`86ca5eve1`, §12):** the locked three-field set is formally UN-LOCKed to include the apex-hold pair (`dwellFrameIndex` + `dwellMs`); **§12 is now the canonical spec for those two controls.** This OOS item is retained only as the historical record of the ORIGINAL E5 scope — it does NOT describe the current shipped tuner.
4. **File-watcher / auto-rebuild** — the tuner does NOT trigger `npm run build`. Persistence is "json written; rebuild + reload to apply" (§1.3, §3.6). Auto-rebuild-on-save is a possible future nicety, explicitly deferred.
5. **Pixel-polish / motion-feel tuning of the tuner chrome itself** — solo-user experimental; functional spec over polish (ticket OOS). The preview sprite's feel IS the point, but the panel's own visual refinement is sponsor-post-merge.
6. **Multi-anim batch editing / presets / undo history** — one (char, anim) tuned at a time. No preset library, no undo stack. Out of scope.
7. **Tuning a character not baked into the bundle** — the tuner only lists `GENERATED_SPRITE_MANIFEST.characters`; user-folder characters not in the build are not tunable here.

---

## 11. E5 dispatch-readiness checklist (AC4 — zero clarifying rounds)

E5 (Maya) can implement directly from this spec. The decisions are all made:

- ✅ Placement: on-demand panel mirroring Manage Team (§2) — *pending sponsor ack at E4 gate*.
- ✅ Controls + bound fields: speed→`speedMultiplier`, hold→`finalDwellMs`, mode→`playbackMode` (§3.2–3.4, LOCKED vocab).
- ✅ Char + anim selectors driven by the manifest (§3.1).
- ✅ Live preview = inject `playbackTable` into `createSpriteBox`, dispose+rebuild on change (§1.2, §5).
- ✅ Cascade/source display resolving each field independently (§3.5).
- ✅ Write-target chooser per-char vs pose-default, default per-char (§3.7).
- ✅ Save = new `ui:save-playback-override` message + new host writer emitting E2's existing schema (§4); ack = `playback:override-saved`.
- ✅ Field-omission == clear semantics (§4.1).
- ✅ Debounce: ~120ms preview / ~500ms trailing save (§6).
- ✅ Persistence banner = the honesty surface (§3.6).
- ✅ Edge cases enumerated (§7).
- ✅ Tokens theme-aware (§8); a11y (§9); OOS (§10).
- ✅ Functional behaviors (preview-rebuild-on-change, debounced-save-fires-once, correct-write-target, field-clear) are jsdom Layer-2.5 testable → NOT sponsor-deferred (§6 note; `testing-strategy.md` § Layer decision rule). Only the sprite's visual FEEL is sponsor-post-merge.

**The one open sponsor item** (final report): confirm on-demand-panel placement (§2 recommendation) vs always-visible. Everything else is decided.

---

## 12. Apex-hold (`dwellFrameIndex` + `dwellMs`) — field-set amendment (`86ca5eve1`, 2026-06-12)

This section **un-LOCKs the original three-field set** (§10 OOS #3) to add the **apex-hold pair**: a mid-loop dwell that holds ONE chosen frame (the gesture's peak — e.g. the cup at the lips, the arms-overhead stretch apex) longer than the rest of the loop. Two bound fields:

- **`dwellFrameIndex`** — which frame to hold (the apex).
- **`dwellMs`** — how long to hold it, in ms.

### 12.0 Reconciliation — this is shipped reality, not net-new design

⚠️ **Read before designing against this section.** The apex-hold controls are **already implemented and shipped on `origin/main`** (verified this task: `git rev-parse origin/main = f1ae6a73cbbca12f80e84cd7af6105e4ecdb382e`; `git grep -c "Hold (apex)" origin/main -- src/webview/components/playbackTuner.ts = 5`; `dwellFrameIndex` ×21 in the same file). They were exposed by ticket **`86ca2bqe1`** (the "Hold (apex)" control group) and are window-coupled by **`86ca2wj6u`** (the window control — see `team/iris-design/anim-tuner-window-control-spec.md`).

So this amendment is **documentation-reconciling**, NOT an instruction to build something new. Its purpose: the E4 spec body still described a three-field tuner (and §10 OOS #3 contradicted its own 2026-06-02 update), so a future reader of THIS spec would not know the apex pair is a first-class, shipped tunable. §12 makes the apex-hold design canonical in the E4 spec the same way §1–§9 are canonical for the original three fields. Every control-type / interaction / placement statement below was verified against the live `src/webview/components/playbackTuner.ts` on `f1ae6a73` — they document the shipped behavior; they do not propose a change to it.

(Phase 2 of `86ca5eve1` — Maya's lane — validates the shipped implementation against this written spec and fills any gap. It is NOT a from-scratch build.)

### 12.1 Control types (AC2) — the apex pair

**`dwellMs` — ms numeric slider mirroring `finalDwellMs`.**

A native `input[type=range]` slider, identical idiom + range to the Hold (final) control (§3.3), built via the same `buildSlider` helper:

- Range `0 … 10000` ms, step `50` (mirrors the Hold (final) range — both ms holds share the same dial vocabulary so the sponsor reasons about one "how-long-to-hold" scale). Live constants: `APEX_MS_MIN = 0`, `APEX_MS_MAX = 10000`, `APEX_MS_STEP = 50` (`playbackTuner.ts`).
- Display: integer + ` ms`. aria-text: "<n> milliseconds" (no icon-only — Iris hard rule).
- `[reset]` clears `dwellMs` from `draftOverride` (field-omission == clear, §4.1) and re-seeds from the cascade.
- The ms slider is only **meaningful** once a frame is picked (an index-less `dwellMs` has nothing to hold). It stays usable when no frame is set (the value saves, harmlessly) — the picker's "Off" branch clears BOTH fields together so the json never carries a `dwellMs` with no `dwellFrameIndex`.

**`dwellFrameIndex` — a frame-bounded `<select>` (number-picker), NOT a stepper and NOT a slider-over-frames.**

> **DECISION (AC2): a native `<select>` listing one option per in-window frame (`"Off"`, `frame 0`, `frame 1`, …), bounded to the selected animation's south-frame count.** This matches the shipped `apexFrameSelect` (`playbackTuner.ts`).

Justification (stepper vs number-`<select>` vs slider-over-frames):

| Form | Verdict | Rationale |
|---|---|---|
| **Native `<select>` (frame picker)** ✅ CHOSEN | Chosen | The apex is a *discrete, small-cardinality* choice (south-frame counts are ~4–16; M01 vs F01 differ — `frameCount()` reads `manifest...animations[anim].frames.length`). A `<select>` shows the full enumerable set at once, makes the **`"Off"` (no apex hold) sentinel** a first-class first option (clearing both fields), and is trivially **re-populated per (char, anim)** so an index valid for one anim never dangles on another. It is also the natural twin of the window control's discrete-frame idiom (`86ca2wj6u` §1 consistency note). The sponsor picks "the peak frame" by reading the live preview and choosing its index — a list, not a continuous drag. |
| **Number input / stepper (`±`)** ✗ rejected | — | A bare stepper gives no sense of the valid range and invites out-of-bounds entry (the sponsor would have to know the frame count); it also can't express the `"Off"` sentinel cleanly (0 is a valid frame, not "off"). A clamp-on-blur stepper is more code for less clarity at this cardinality. |
| **Slider over frame indices** ✗ rejected | — | A single-thumb range slider implies a *continuous* quantity; the apex is one discrete frame, and a slider gives no labelled stops (the sponsor can't tell frame 6 from frame 7 by thumb position at 4–16 stops). The ms holds are sliders precisely because ms IS continuous; frame index is not. Reserving the slider idiom for continuous quantities (speed ×, ms) and `<select>` for discrete frame choices keeps the control vocabulary legible. |

**Frame-bounding (load-bearing):** the picker options are **NOT `[0, frameCount)`** — they are bounded to the **active window** `[startFrame … endFrame]` (resolved by `activeWindow()` over the cascade, clamped to the live clip). An apex outside the window is unreachable: the engine arms the apex hold ONLY when `peakIndex` is inside `[winStart, winEnd]`, so an out-of-window apex silently does nothing. The picker therefore offers only in-window frames; a preferred index that falls outside resolves to `"Off"`. This is the apex↔window coupling — fully specified in `anim-tuner-window-control-spec.md` §4.4 (auto-clear + quiet note on narrowing). For a **no-window** anim the window is the full clip `[0, count-1]`, so the picker lists every frame.

> **Note — `N` in the AC2 clamp "0..N-1":** the ticket frames the bound as "frame-bounded integer clamped 0..N-1 (N = selected animation's south frame count)." That is the **no-window** case. When a window is declared, the *effective* bound is the narrower `[startFrame … endFrame] ⊆ [0, N-1]`, not the full `0..N-1`. The picker honors the tighter of the two — see the frame-bounding paragraph above. This is intentional (an apex outside the window never fires) and is the shipped behavior.

### 12.2 Interaction with the existing apex-shadow warning + `refreshShadowWarning` (AC3)

The apex pair participates in the existing cascade machinery exactly like the original three fields. Three interaction cases, each verified against the live `refreshShadowWarning` / cascade code:

**(a) When BOTH apex fields are set (`dwellFrameIndex` + `dwellMs` present in the draft):**
- The cascade source table (§3.5) shows TWO independent rows — **`apex frame`** (effective `frame N` or `none`, + source layer) and **`apex hold`** (effective `<n> ms`, + source layer) — resolved field-independently like every other row (`renderSourceTable` adds both via `addSourceRow`). The two apex fields can legitimately carry *different* source tags (e.g. `dwellFrameIndex` per-char, `dwellMs` pose-default) — never label the pair with one source.
- On save, both ride the `ui:save-playback-override` payload's `override` object (E4 §4.1). The `"Off"` picker branch clears BOTH together, so the json never persists a `dwellMs` with no `dwellFrameIndex`.

**(b) When `dwellFrameIndex` points past the frame range (or past the active window):**
- **Not reachable from the picker** (the `<select>` only offers in-window frames), but a stale/hand-edited json index that falls outside is defended two ways: (1) the picker resolves an out-of-window `preferIndex` to `"Off"` on populate, so the control never *displays* a dangling apex; (2) on a window narrowing that strands a previously-valid apex, the window control **auto-clears** the apex pair and shows the one-shot note *"Apex frame N is outside the new window — apex hold cleared."* (`anim-tuner-window-control-spec.md` §4.4). The engine itself no-ops an out-of-window apex (it arms only inside `[winStart, winEnd]`), so even an un-cleared stale value animates nothing rather than misbehaving — but the tuner clears it so the json stays honest (a persisted out-of-window apex is a latent footgun: it re-fires if the window later re-widens).

**(c) When writing to "All characters" (pose-default) but `speedMultiplier`/`playbackMode`/the apex pair is already per-char (the shadow case):**
- `refreshShadowWarning` (verified live) extends to the apex pair: it pushes **`apex frame`** and/or **`apex hold`** into the shadowed-fields list when their cascade source layer is `per-char` while the write target is `pose-default`. The inline warning then reads *"⚠ `<char>` overrides `<…, apex frame, apex hold>` per-char; the pose-default you set won't show for this character."* — same surface, same `--vscode-inputValidation-warning*` tokens (§8), same derive-from-source-table mechanism as speed/hold/mode. The apex fields are NOT a special case; they shadow exactly like the others.
- `speedMultiplier` or `playbackMode` "shadowing the dwell" (AC3 phrasing): these do not shadow the apex *value* (they are independent cascade fields). What the sponsor must understand is the **engine-application coupling**, surfaced as quiet helper notes (not the shadow warning):
  - **`finalDwellMs` and the apex hold both apply to IDLE poses only.** On an `active_*` anim the engine runs a uniform-cadence loop and applies no final-frame dwell — the apex `dwellMs` likewise has no idle-style beat. The preview note already says *"Final-frame hold applies to idle poses only"* when an active anim is selected (§7). The apex picker stays usable (value saves) but the sponsor is told the hold won't read on an active loop.
  - **`playbackMode: "pingpong"`** fires the *final-frame* hold only on the forward arrival at the window end (§3.3 note); the **apex** hold is independent of mode — it fires whenever the loop reaches `dwellFrameIndex` inside the window, on the forward pass. Surface no extra warning here; the existing §3.3 pingpong note plus the apex helper text *"Pick the apex frame (the gesture's peak — e.g. cup at the lips) to hold it longer mid-loop. Off = no apex hold."* are sufficient.

### 12.3 Panel placement of the 2 controls (AC4)

The apex pair lives in a dedicated **"Hold (apex)" control group** inside the existing `── Controls ──` section, placed **directly below Hold (final) and above Mode** (verified live order: Speed → Hold (final) → Hold (apex) → Mode). The group contains, top-to-bottom: a caption row (`Hold (apex)` + a `[reset]` that clears BOTH fields), the **`Frame` `<select>`** (`dwellFrameIndex`), then the **`Apex hold` ms slider** (`dwellMs`), then the helper line. ASCII (delta to the §3 wireframe — bracketed group is the apex pair):

```
│  ── Window ──────────────────────────────────────────    │  ← 86ca2wj6u, structural, FIRST
│  Frames   0 [────●━━━━━━━●────] 11    5 – 10   [reset]    │
│                                                           │
│  ── Controls ──────────────────────────────────────────  │
│  Speed        ──────●─────────   0.50×    [reset]         │
│  Hold (final) ──────●────────    800 ms   [reset]         │
│ ┌── Hold (apex) ───────────────────────────── [reset] ──┐ │  ← §12 the apex PAIR
│ │  Frame   [ frame 7 ▾ ]   (Off | frame 5 … frame 10)   │ │  ← dwellFrameIndex <select>, window-bounded
│ │  Apex hold ──────●──────   600 ms                     │ │  ← dwellMs slider (mirrors Hold (final))
│ │  "Pick the apex frame (the gesture's peak)…"          │ │  ← helper
│ └───────────────────────────────────────────────────────┘ │
│  Mode         ( ) loop   (•) pingpong                     │
│  ── Write target ──   (•) This character  ( ) All chars   │
│  [ persistence banner ]                                   │
```

**Why below Hold (final), above Mode** (verified shipped order): the two "hold" controls (final-frame + apex) read as a pair — the sponsor tunes *how long the loop pauses* in one visual block — while Mode (loop/pingpong) is a separate structural choice. The window stays FIRST (it defines *which* frames exist; `86ca2wj6u` §2) so the apex picker below it is always re-derived from an already-decided window — the sponsor sets the window, then picks the apex from the in-window frames in reading order.

**Frame-source table row coupling:** the cascade source table (§3.5, beside the preview) gains the two apex rows (`apex frame`, `apex hold`) alongside speed/hold/mode/window — so the explain-surface lists every tunable field, none hidden.

### 12.4 Persistence-banner copy + the live-preview-vs-rebuild honesty (AC4)

**No change to the §3.6 persistence banner is needed for the apex pair — and that is the load-bearing point.** The apex controls persist through the **same** `ui:save-playback-override` round-trip as the original three fields (the window-control spec §5.3 confirms the host writer's `TUNABLE_KEYS` already owns `dwellFrameIndex` + `dwellMs`). So:

- **Live preview** (the apex hold visibly lengthens the chosen frame in the tuner's preview sprite) is webview-local + instant — the draft's apex fields ride `previewOverride()` → injected `playbackTable` → `createSpriteBox`, zero rebuild (§1.2, §5).
- **Persistence** writes the apex fields to json on the debounced save; **the live dashboard tiles do NOT change until the next `npm run build` + reload** — they read the baked manifest (§1.3).

The existing banner copy carries this honestly for every save, apex included:

> ✎ Saved to `<filename>`. Rebuild + reload to apply to the live dashboard tiles.

(where `<filename>` = `<char>/animations.json` per-char or `pose-defaults.json`). **The honesty contract is unchanged:** the preview moved (apex hold visible in the tuner), the real tiles are baked. The dashboard tiles do NOT live-update — that is explicitly out of scope (AC4) and the banner says so. Do NOT add apex-specific banner copy that implies otherwise; the single per-save banner is the one honesty surface and it already tells the truth for the apex pair.

### 12.5 What this amendment does NOT change

- **No engine change.** `spritePlayer.ts` already applies `dwellFrameIndex`/`dwellMs` (peak-frame hold). The tuner consumes it.
- **No schema / build-script change.** `build-sprite-manifest.mjs` + the host writer already own the apex keys (verified via `86ca2wj6u` §0.1's owned-key audit — the apex keys ARE in `TUNABLE_KEYS`; only the *window* keys were the gap that ticket closed).
- **No new message type.** Apex fields ride the existing `ui:save-playback-override` payload's `override` object.
- **No new placement / panel.** On-demand panel mirroring Manage Team (§2) is unchanged.

### 12.6 Phase-2 (Maya) dispatch-readiness checklist (AC4 — zero clarifying rounds)

- ✅ Field set un-LOCKed: `dwellFrameIndex` + `dwellMs` are first-class tunables (§12.1; §10 OOS #3 superseded).
- ✅ Control types: `dwellMs` = ms slider mirroring `finalDwellMs` (0..10000, step 50); `dwellFrameIndex` = window-bounded native `<select>` with an `"Off"` sentinel — DECIDED `<select>` over stepper/slider, justified (§12.1).
- ✅ Apex-shadow interaction: both fields cascade + shadow field-independently via `refreshShadowWarning` (`apex frame` / `apex hold` chips); out-of-window apex auto-cleared + noted; idle-only + pingpong helper notes (§12.2).
- ✅ Placement: dedicated "Hold (apex)" group below Hold (final), above Mode; source-table gains two apex rows (§12.3).
- ✅ Persistence banner: unchanged; the single per-save banner honestly covers the apex pair (live preview moves, tiles baked-until-rebuild); dashboard tiles do NOT live-update (OOS) (§12.4).
- ✅ No engine / schema / message-type / placement change (§12.5).
- ✅ Functional behaviors (apex picker re-bounds to window, "Off" clears both fields, save fires with apex, shadow warning names the apex chips) are jsdom Layer-2.5 testable → NOT sponsor-deferred (`testing-strategy.md` § Layer decision rule). Only the apex hold's visual FEEL (does the pause read as a deliberate beat?) is sponsor-post-merge.

**No open sponsor item for §12** — the apex controls are already shipped + sponsor-validated through `86ca2bqe1`; this amendment only reconciles the written spec to that reality.
