# Tuner — Playback-window (startFrame/endFrame) editable control — UX Spec

**Ticket:** `86ca2wj6u` — "Tuner: expose the playback window (startFrame/endFrame) as editable controls." · **Author:** Iris (UX) · **Date:** 2026-06-02
**Reviewer:** Maya (visual / spec edges).
**Extends:** `team/iris-design/anim-tuner-spec.md` (the E4 tuner spec). That spec is the source of truth for the panel shell, placement, save round-trip, debounce, tokens, a11y. **This spec adds ONE new control group** (the playback window) and is otherwise a delta against it. Read E4 §1 (two-path live-preview/persistence model), §3.5 (cascade source table), §3.7 (write target), §6 (debounce) first — they apply unchanged to the window control.

**Scope flag:** solo-user / experimental — sponsor is the only user. Functional spec over pixel-polish, same as E4. NOT a Marketplace surface.

---

## 0. Verified ground truth (re-verified THIS task against live files on `origin/main`)

`HEAD = 2e6eb8372732da07da9a689b17f8893c3450e779` (verified `git log -1 origin/main`). Every ref below was read/grep'd against the live file this task — trust them.

| Concept | Live location | Note |
|---|---|---|
| `PlaybackOverride.startFrame? / endFrame?` | `src/webview/sprites/spritePlayer.ts:118`, `:125` | already on the engine override type (E1-refine 86ca21876) |
| Engine window clamp + inverted-window fallback | `spritePlayer.ts:467–473` | `winStart/winEnd` clamped to `[0,lastIndex]`; **`winStart > winEnd` → falls back to FULL clip** |
| Engine starts at `winStart` | `:478` | first frame shown is the window's lower bound |
| Prior-frame clamp into live window | `:508` | a re-render's resumed index is clamped into `[winStart,winEnd]` |
| Apex armed only INSIDE the window | `:566–577` | an apex outside `[winStart,winEnd]` is correctly NOT armed — this is the apex↔window coupling |
| `finalDwellMs` fires on FORWARD arrival at `winEnd` | `:608` | windowing the apex to `endFrame` lands the hold on the window end |
| Loop wraps `winEnd → winStart` (not → 0) | `:633–636` | windowed loop |
| Pingpong turnaround AT `winStart`/`winEnd` | `:625–629` | window endpoints are the bounce points |
| Tuner `activeWindow()` — cascade-resolves the window | `src/webview/components/playbackTuner.ts:859–885` | draft → per-char baked → pose-default → full-clip; mirrors the engine's inverted-window fallback (`:879–883`) |
| Tuner `windowIsDeclared()` | `:893–902` | true when any layer sets `startFrame`/`endFrame` |
| Tuner `previewOverride()` overlays window onto preview | `:914–918` | so the live preview windows like the shipped tile (NIT 1 86ca2w1g9) |
| Tuner `populateApexFrames()` bounds the apex picker to the window | `:930–948` | apex options = `[start..end]` only |
| `draftOverride` lifecycle + `emitSave()` sends `override:{...draftOverride}` whole | `:314–317`, `:1060–1087` | **the window fields ride this payload automatically once set on `draftOverride`** |
| `frameCount()` = `manifest...animations[anim].frames.length` | `:844–848` | frames is `string[]` (`spriteManifest.ts:42`) |
| `seedControlsForWriteTarget()` / `reseedDraftAndRepaint()` | `:696–753` | the seed+repaint path every control plugs into |
| Build script accepts window fields | `scripts/build-sprite-manifest.mjs:150–157`, `sanitizePlayback :196–230` | `startFrame`/`endFrame` ARE recognized + validated (finite number → passed through) → **survive the rebuild into the manifest** |

### 0.1 THE LOAD-BEARING GAP — the host writer does NOT persist window fields yet

The brief says "engine + apex-rebound + preview-rewindow are ALREADY wired (PR #173)." **Verified true for the READ/preview path — but NOT for the WRITE/persist path.** The host writer's owned-key set excludes the window:

- `src/extension/sprites/playbackOverrideWriter.ts:54–68` — `TunablePlaybackOverride` has `speedMultiplier? / finalDwellMs? / playbackMode? / dwellFrameIndex? / dwellMs?` only. **No `startFrame` / `endFrame`.**
- `:86–94` — `TUNABLE_KEYS = ["speedMultiplier","finalDwellMs","playbackMode","dwellFrameIndex","dwellMs"]`. **No window keys.**
- `mergePlaybackEntry` (`:110–123`) iterates ONLY `TUNABLE_KEYS` to set/clear; non-tunable keys are merely PRESERVED from the existing on-disk entry (the `{ ...existing }` spread `:114`). The doc comment `:37–39` + `:102–103` states this explicitly: window fields are "PRESERVED if already present … out of tuner scope (§10)."

**Consequence (verified by reading the merge loop):** if the tuner sends a NEW `startFrame`/`endFrame` in the `override` payload today, the writer **silently drops it** — it is neither in `TUNABLE_KEYS` (so never set) nor already on disk (so nothing to preserve). The live preview would move (webview-local), the json would NOT change, and the dashboard tile would never reflect it. This is the SAME failure class as E4 §4.3's dual-schema warning (writer shape must match what the sponsor expects to persist).

**Therefore this ticket has a mandatory host spec-edge (Maya/Felix — see §6):** `startFrame`/`endFrame` must be PROMOTED to tuner-owned tunable keys. Build script + engine already accept them; only the writer's owned-key set is the missing link. This is NOT an engine change and NOT a build-script change — it is widening the writer's owned-key list (and the matching `TunablePlaybackOverride` interface) by two fields, plus the webview wire type `SavePlaybackOverrideMessage.payload.override`.

---

## 1. Control form — RECOMMENDATION: dual-handle frame range slider

**Recommended: a single dual-handle (two-thumb) frame range slider** spanning `0 … lastIndex`, the left thumb = `startFrame`, the right thumb = `endFrame`. NOT two separate Start/End dropdowns.

| Option | Verdict | Rationale |
|---|---|---|
| **A — dual-handle range slider** ✅ RECOMMENDED | Chosen | The window is fundamentally a *contiguous span* over the frame strip; a two-thumb slider makes the span spatial and direct — the sponsor sees "I'm keeping the middle third of the clip" as a filled bar, drags either end, and watches the preview re-window live. It also makes the apex-coupling legible: the apex picker offers exactly the frames *under the filled bar*. A non-technical sponsor reasons about "trim the clip to this part," not about two independent integers. |
| **B — two Start/End `<select>` dropdowns** ✗ | Rejected | Requires the sponsor to mentally hold two numbers and the ordering constraint (start ≤ end), and gives no visual sense of *which slice* of the loop survives. It does sidestep the inverted-window case (you can't pick start>end if the End dropdown is filtered to ≥ start) — but at the cost of the spatial intuition that is the whole point for a non-technical user. |

**Consistency note (existing tuner controls).** The tuner today uses three control idioms (verified live): **native single-thumb `input[type=range]` sliders** for Speed (`speedMultiplier`) and the two Hold ms values (`finalDwellMs`, apex `dwellMs`) via `buildSlider` (`playbackTuner.ts:1359`); a **two-radio group** for Mode (`buildModeControl`); and a **native `<select>`** for the apex *frame* picker (`apexFrameSelect`, `:456`). So the tuner already mixes range-sliders (continuous ms/×) with a `<select>` (discrete frame index). The window control is discrete-frame like the apex picker — but it is a *range of two coupled frames*, which neither a single-thumb slider nor a single `<select>` expresses. A dual-handle range slider is the natural extension: it keeps the "drag-to-feel" idiom of the existing ms sliders while expressing the discrete contiguous span.

**Tradeoff to flag for the sponsor (the ONE design decision — see final report):** a true two-thumb range slider is not a native HTML element (native `input[type=range]` is single-thumb). Maya must build it from two overlapped native ranges (or two stacked thumbs on one track) — modest extra build vs. the trivially-native two-dropdowns Option B. For a solo-user dev aid, the spatial clarity is worth the build cost — **but if the sponsor would rather Maya ship faster, two Start/End dropdowns (Option B) are the lower-effort fallback and still fully functional.** This is a feel-vs-effort call only the sponsor should make; everything else in this spec is form-agnostic (the bound fields, edge handling, save semantics are identical either way).

---

## 2. Placement in the existing control stack

The current stack order (verified live, top→bottom in `playbackTuner.ts`):

```
Character / Animation selectors          (:327–351)
Preview + cascade source table           (:353–373)
── Controls ──                           (:375–377)
  Speed slider           → speedMultiplier    (:380)
  Hold (final) slider    → finalDwellMs        (:403)
  Hold (apex): Frame <select> + ms slider → dwellFrameIndex / dwellMs   (:437–492)
  Mode radios            → playbackMode         (:496)
── Write target ──        per-char / pose-default  (:508)
  shadowing warning                              (:535)
── persistence banner ──                         (:542)
```

**Recommended placement: a new `── Window ──` section ABOVE the `── Controls ──` divider** — i.e. directly after the cascade source table and before Speed. Insert at `playbackTuner.ts:375` (just before `sectionDivider("Controls")`).

**Why above Speed/Hold/Mode, not beside the apex picker:**

- The window is **structural** — it defines *which frames exist for this loop* — whereas Speed/Hold/Mode tune *how those frames play*. Putting the window first matches the mental model "first pick the slice, then tune its timing."
- It makes the **apex↔window coupling** read top-to-bottom: the sponsor sets the window, THEN the Hold (apex) frame picker below it offers only the in-window frames (`populateApexFrames` already enforces this, `:930–948`). If the window were placed *below* the apex picker, the sponsor would pick an apex frame, then narrow the window above it and watch their apex selection silently reset to "Off" — confusing. Window-first means the apex picker is always re-derived from an already-decided window.
- It keeps the existing Speed/Hold/Mode block visually intact (no reflow of the established controls).

ASCII (delta to E4 §3 wireframe — new section bracketed):

```
│  Character   [ ClaudeTeam-M01-Dev      ▾ ]                │
│  Animation   [ idle_stretch            ▾ ]                │
│  ┌─────────────┐   Effective values (source):            │
│  │  live       │     speed  0.5×  (per-char)              │
│  │  preview    │     hold   800ms (pose-default)          │
│  │  sprite     │     mode   pingpong (engine def.)        │
│  └─────────────┘     window 5–10  (per-char)   ← §4.4 NEW row
│                                                           │
│  ── Window ──────────────────────────────────────────    │  ← NEW, placed FIRST
│  Frames   0 [────●━━━━━━━●────] 11    5 – 10   [reset]    │  ← dual-handle range
│           full clip: 0–11                                 │  ← helper: full range
│  ⤺ Reset to full clip                                     │  ← §4.3 reset affordance
│                                                           │
│  ── Controls ──────────────────────────────────────────  │
│  Speed        ──────●─────────   0.50×    [reset]         │
│  Hold (final) ──────●────────    800 ms   [reset]         │
│  Hold (apex)  Frame [ frame 7 ▾ ]  ──●──  600 ms [reset]  │  ← picker bounded to 5–10
│  Mode         ( ) loop   (•) pingpong                     │
│  ── Write target ──   (•) This character  ( ) All chars   │
│  [ persistence banner ]                                   │
```

---

## 3. Labels & affordance (non-technical user)

- **Section caption:** `Window` (matches the one-word section captions `Controls` / `Write target`). The control's field label is **`Frames`** with the two endpoint values shown as a range readout `<start> – <end>` (e.g. `5 – 10`).
- **Avoid the word "frame index"** in the primary label — for a non-technical sponsor the readout `5 – 10` plus the helper line below carries the meaning. Use a one-line helper under the slider: **"Trim the loop to a slice of the clip. Frames before the start and after the end are skipped."**
- **Reading alongside the Apex (Hold (apex)) picker:** add a coupling note in the Window helper text when a window narrower than the full clip is active: **"The Hold (apex) frame picker below offers only frames in this window."** This pre-explains why the apex options shrink — the sponsor sees the cause (window) above the effect (apex picker) in reading order. (Derive the condition from `windowIsDeclared()` / `activeWindow()` vs full-clip; `playbackTuner.ts:859–902`.)
- **aria:** the range control exposes two thumbs; each thumb is a native `input[type=range]` with `aria-label` "Window start frame" / "Window end frame" and `aria-valuemin/max/now/text` (the text form reads "frame 5" / "frame 10"). The numeric `5 – 10` readout is the visible, screen-reader-redundant representation — no icon-only (Iris hard rule). If Option B (two dropdowns) is taken instead, each `<select>` carries `aria-label` "Window start frame" / "Window end frame".

**LOCKED vocabulary** (the identifier names Maya/Felix implement against):
- Bound webview fields: **`startFrame`** and **`endFrame`** (already on `PlaybackOverride`, `spritePlayer.ts:118/:125` — do NOT invent new names).
- New host owned keys: **`startFrame`**, **`endFrame`** added to `TUNABLE_KEYS` + `TunablePlaybackOverride` (`playbackOverrideWriter.ts`).
- New webview control CSS class: **`ct-tuner-window`** (mirrors `ct-tuner-speed` / `ct-tuner-apex`). Range thumbs: `ct-tuner-window-start` / `ct-tuner-window-end`. Reset link: `ct-tuner-window-reset`.
- Reuse the existing **`omitField`** helper (`playbackTuner.ts`, used by every other reset) to clear `startFrame`/`endFrame` from `draftOverride`.
- Save message: **NO new message type** — the window fields ride the existing `ui:save-playback-override` payload's `override` object (E4 §4.1). Only the payload's `override` TYPE gains the two optional fields.

---

## 4. Edge handling

### 4.1 Inverted window (start > end)

**Prevent at the UI; the engine already defends.** The two thumbs are coupled so the start thumb cannot pass the end thumb and vice-versa:

- Dragging the start thumb clamps it to `≤ endFrame` (and never below 0).
- Dragging the end thumb clamps it to `≥ startFrame` (and never above `lastIndex`).

This makes start>end unreachable in the UI. As defense-in-depth, the engine and `activeWindow()` BOTH already fall back to the full clip on an inverted window (`spritePlayer.ts:469–473`, `playbackTuner.ts:879–883`) — so even a stale/corrupt json never animates nothing. Do NOT rely on that fallback as the primary guard; clamp the thumbs.

(If Option B / two dropdowns is taken: filter the End dropdown options to `≥ currentStart` and the Start dropdown to `≤ currentEnd`, re-filtered on each change — same coupling, different idiom.)

### 4.2 Single-frame window (start == end)

**Allowed.** A one-frame window is legitimate (freeze on a single frame). The engine handles it: the pingpong turnaround guard `isPingpong && winEnd > winStart` (`spritePlayer.ts:625`) falls back to a static hold when `winEnd === winStart`, and the loop branch `frameIdx === winEnd ? winStart : …` (`:636`) stays put. **Surface a quiet note** when start == end: "Single-frame window — the loop holds on frame N (timing/mode have no visible effect)." Same idiom as E4 §7's single-frame-anim note. Values still save (harmless).

### 4.3 Reset-to-full-clip affordance

Two reset affordances, both clearing the window from `draftOverride` (NOT setting `0`/`lastIndex` explicitly — clearing lets the field inherit per E4 §4.1 field-omission==clear):

1. **A `[reset]` link** at the end of the Window section's label row (mirrors every other control's `[reset]`, e.g. `apexResetBtn :446–451`). Clears BOTH `startFrame` and `endFrame` via `omitField(omitField(draftOverride,"startFrame"),"endFrame")`, re-seeds the thumbs from the cascade-resolved window (or full-clip if no layer declares one), rebuilds the preview, queues a save.
2. **A visible "full clip: 0–N" helper** under the slider showing the un-windowed range, so the sponsor always knows the bounds reset returns to.

**Clear semantics (load-bearing, mirrors E4 §3.4 mode):** the window control is "set" only when the sponsor has moved it away from the full clip. When both thumbs sit at `0` and `lastIndex` (the full clip), **clear both fields** (omit) rather than persisting `startFrame:0, endFrame:lastIndex` — a full-clip window is the absent-field default, so persisting it is noise. On `[reset]`, on dragging back to full-clip, OR when neither thumb has moved: omit both. This keeps the json lean and the cascade clean (an explicit `0..last` would shadow a pose-default window for no reason).

### 4.4 Previously-set apex frame falling OUTSIDE a newly-narrowed window

**This is the most important edge — the window and apex are coupled.** When the sponsor narrows the window such that the current apex (`dwellFrameIndex`) is no longer in `[startFrame, endFrame]`:

- The engine already NO-OPs the out-of-window apex (`spritePlayer.ts:566–577` — apex armed only when `peakIndex >= winStart && peakIndex <= winEnd`). So an out-of-window apex silently does nothing — the exact "Apex hold frame 0 has no effect" footgun PR #173 fixed for the *picker bounding*.
- **The window control MUST keep the apex picker honest on every window change.** After the window thumbs settle (debounced, §5), call the existing `populateApexFrames(draftOverride.dwellFrameIndex)` (`:930`) — it already re-derives the picker options from `activeWindow()` and falls back to "Off" when the preferred index is out of window (`:944–947`). **The decision: if the current apex falls out of the new window, AUTO-CLEAR the apex** (set picker to "Off" + `omitField` `dwellFrameIndex`/`dwellMs` from `draftOverride`, mirroring `onApexFrameChange`'s Off branch `:953–959`) rather than leaving a dangling no-op apex on disk. Surface a quiet one-time note: **"Apex frame N is outside the new window — apex hold cleared."** Rationale: a silently-ignored apex value persisted in json is a latent footgun (it re-fires if the window later re-widens to include it, surprising the sponsor); clearing it makes the cause-and-effect explicit and the json honest.
- **Reading-order reinforcement:** because the Window section sits ABOVE the apex picker (§2), the sponsor narrows the window first and sees the apex picker below it shrink/reset — the spatial order matches the causal order.

### 4.5 Window wider than the clip / stale index

`activeWindow()` and the engine both `clamp` to `[0, lastIndex]` (`playbackTuner.ts:875`, `spritePlayer.ts:467–468`). The thumbs are inherently bounded to `0..lastIndex` (the slider max IS `lastIndex`), so an out-of-range value is unreachable in the UI. On char/anim switch the frame count changes — re-seed the thumbs from the new `activeWindow()` (clamped) so a window from a longer clip doesn't dangle. This already happens via `reseedDraftAndRepaint` (§5).

---

## 5. Live behavior + write-back/reset semantics

### 5.1 Live preview re-windows on change — ALREADY WIRED (confirm, don't rebuild)

The preview already overlays the cascade-resolved window via `previewOverride()` (`playbackTuner.ts:914–918`) before injecting into `createSpriteBox`. **What changes:** today `previewOverride` reads the window from the cascade (baked + draft). Because the window control writes `draftOverride.startFrame`/`endFrame` *live*, `previewOverride()` will pick them up unchanged — `draftOverride[field]` is already the first term in `activeWindow`'s `resolve()` (`:874`). So **dragging a window thumb → `draftOverride` updates → preview re-windows on the next debounced rebuild, with NO new preview plumbing.** The window control plugs into the EXISTING preview path; verify `previewOverride()` reflects the live draft (it does, by reading `draftOverride` first), don't re-wire it.

Per E4 §5.3, the preview restarts the loop from `winStart` on a window change (a control change that doesn't change the anim → fresh start, so the sponsor judges the new window's feel from a clean loop start). Confirm the window-change path threads `priorPose = undefined` like the other control changes.

### 5.2 Apex picker re-bounds on change — ALREADY WIRED (confirm)

`populateApexFrames` is already window-aware (`:930–948`, reads `activeWindow()`). On every settled window change, call it (preserving the current apex index as the `preferIndex`, which auto-falls-back to Off if now out of window — §4.4). No new bounding logic; just invoke the existing function from the window control's change handler.

### 5.3 Write-back semantics (the ONE genuinely new wiring)

The window fields persist via the EXISTING save path with the field-omission==clear contract (E4 §4.1):

- **Setting** a window → `draftOverride = { ...draftOverride, startFrame, endFrame }`; the debounced `emitSave()` (`:1060`) sends `override: { ...draftOverride }` whole — the window rides along. (`pendingSave`/live-overlay machinery `:1081–1087` records it for re-seed, same as every other field.)
- **Clearing** (reset, or dragged back to full clip — §4.3) → `omitField` both; the payload omits them; the host writer DELETES them from the json entry → inherit.
- **The host writer MUST own the window keys** (§0.1 gap) or the set is silently dropped. With `startFrame`/`endFrame` added to `TUNABLE_KEYS`, `mergePlaybackEntry` (`:110–123`) sets them when present and clears when absent — identical to the other five fields. **No new host module, no new message type** — only the owned-key list + the two interface widenings.
- **Persistence banner unchanged (E4 §3.6):** the window save lands in json but the dashboard tile reflects it only after `npm run build` + reload. The banner already says so for every save; the window is no exception. Do NOT imply the tile re-windows live.

### 5.4 Cascade source-table row for the window (§4.4 wireframe row) — DECISION

The cascade source table (`computeCascadeSource`, `cascadeSource.ts:143`) currently surfaces 5 fields (speed/hold/mode/apex-frame/apex-ms) and explicitly NOT the window (`playbackTuner.ts:863` comment). **Recommendation: ADD a `window` row** showing the effective `start–end` (or "full clip") and its source layer.

- **Why:** the source table is the "why is this value what it is" surface (E4 §3.5). The window is now tunable and cascades exactly like the others (per-char → pose-default → engine/full-clip) — `activeWindow()` already resolves it. Omitting it from the table leaves the one structural field invisible in the explain-surface, which is inconsistent now that it's editable.
- **How (minimal):** extend `CascadeSourceTable` with a `window` field (effective `{start,end}` + layer, or a sentinel for full-clip) computed the same way `activeWindow()` does, and add one `addSourceRow` call in `renderSourceTable` (`:1091–1108`). The "full clip" case shows source `engine default`. **This is a small, field-independent addition** — it does not change the existing 5 rows.
- **Felix/Maya note:** keep `computeCascadeSource` pure and field-level (per `cascadeSource.ts` doctrine §19-26) — resolve the window independently of the other fields. The shadowing warning (E4 §3.7) extends naturally: when writing pose-default but a per-char window exists, the per-char window wins on the tile — warn, same as the other fields.

---

## 6. Out of scope + dispatch-readiness (zero clarifying rounds for Maya)

**OOS:**
1. **Engine changes** — the engine already reads `startFrame`/`endFrame`, clamps, and couples the apex. The tuner CONSUMES it. No `spritePlayer.ts` sequencer edits.
2. **Build-script changes** — `sanitizePlayback` already validates window fields (`build-sprite-manifest.mjs:150–157`). No json-schema or build edits.
3. **New message type** — window rides the existing `ui:save-playback-override` payload. Only the payload's `override` TYPE gains `startFrame?`/`endFrame?`.
4. **File-watcher / auto-rebuild** — unchanged from E4 §10; window persist is "json written; rebuild + reload to apply."
5. **Per-direction or per-frame-timing windows** — one contiguous `[start,end]` window per (char, anim). No multi-window, no gaps.

**The ONE mandatory host spec-edge (Maya owns; Felix may peer the host shape):** promote `startFrame`/`endFrame` to tuner-owned in `playbackOverrideWriter.ts` — add to `TUNABLE_KEYS` (`:87–94`) AND `TunablePlaybackOverride` (`:54–68`) AND the webview `SavePlaybackOverrideMessage.payload.override` type. Without this, window saves are silently dropped (§0.1). This is the spec edge that, if missed, ships a control that *looks* like it works (preview moves) but never persists — the exact E4 §4.3 dual-shape trap.

**Dispatch-readiness checklist:**
- ✅ Form: dual-handle frame range slider (§1) — *pending sponsor ack vs two-dropdowns fallback; the ONE open call.*
- ✅ Placement: new `── Window ──` section FIRST, before `── Controls ──` (`playbackTuner.ts:375`) (§2).
- ✅ Labels: `Window` / `Frames` / `start–end` readout + coupling helper (§3); LOCKED vocab `startFrame`/`endFrame`, `ct-tuner-window*`.
- ✅ Edges: inverted prevented by thumb-clamp + engine fallback (§4.1); single-frame allowed + noted (§4.2); reset-to-full-clip via `[reset]` + omit-on-full-clip (§4.3); out-of-window apex auto-cleared with note (§4.4).
- ✅ Live preview re-windows via existing `previewOverride()` — confirm not rebuild (§5.1); apex re-bounds via existing `populateApexFrames` (§5.2).
- ✅ Write-back: existing save path + field-omission==clear; host owned-key widening is the lone new wiring (§5.3, §6).
- ✅ Source-table `window` row added (§5.4).
- ✅ Functional behaviors (thumb-clamp, out-of-window-apex-clear, omit-on-full-clip, save-fires-with-window, preview-re-windows) are jsdom Layer-2.5 testable → NOT sponsor-deferred (`testing-strategy.md` § Layer decision rule). Only the dual-handle slider's visual FEEL is sponsor-post-merge.

**The one open sponsor item (final report):** dual-handle range slider (recommended, more spatial/intuitive, modest extra build) vs. two Start/End dropdowns (trivially native, lower effort). Everything else is decided.
