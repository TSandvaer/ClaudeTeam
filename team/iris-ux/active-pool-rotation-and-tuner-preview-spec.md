# Active-pool rotation + Tuner-preview-over-room — design spec (86ca4atwt)

Two webview features that build on the shipped `active_work` POOL.

- **Feature A** — rotate the active pool IN ORDER while an agent works continuously.
- **Feature B** — render the scene-bg room behind the Playback Tuner preview + add a step/cycle control to walk the pool poses in-context.

**Spec only — no code.** All identifiers below are LOCKED vocabulary for Maya to implement verbatim (per the parallel-shared-concept-vocabulary discipline).

**Code basis verified this task:** branch off `origin/main` `429a4a6` (PR #190, the active_work POOL + episode stickiness). Every file:line ref below was read from the live tree at that SHA.

---

## Feature A — rotate the active pool while working

### A.0 — what ships today (verified, do not re-derive)

`createSpriteBox` ([spritePlayer.ts:399-406](../../src/webview/sprites/spritePlayer.ts#L399-L406)) picks ONE active-pool member per ACTIVE episode and STICKS:

```ts
const freshActiveEpisode = priorWasActive !== true || priorActivePick === undefined;
activePick = freshActiveEpisode ? pickActive(char, rng) : priorActivePick;
```

- `pickActive(char, rng)` ([posePicker.ts:124-134](../../src/webview/sprites/posePicker.ts#L124-L134)) draws a RANDOM member from `char.activePool` ([spriteManifest.ts:62-70](../../src/webview/sprites/spriteManifest.ts#L62-L70)).
- The pick is threaded across the ~2s poll re-render by `spriteTracker.priorActivePick(...)` ([spriteTracker.ts:111-114](../../src/webview/spriteTracker.ts#L111-L114)), so the working anim loops for the whole episode and only re-rolls on idle→active.
- `active_read` (tool == Read) is NEVER pool-drawn and is normalized out of the pick at [spritePlayer.ts:416-418](../../src/webview/sprites/spritePlayer.ts#L416-L418).

**The behavior change:** instead of stick-on-one, while the agent works continuously the tile advances IN ORDER through `activePool` (`activePool[0] → activePool[1] → … → wrap`) on a cadence. idle→active resets to `activePool[0]`.

### A.1 — vocabulary contract (LOCKED — implement these names verbatim)

This feature introduces ONE shared concept (the rotation cursor) that threads through 4 files exactly like `priorActivePick` does today. Names are locked so the threading matches end-to-end.

| Concept | Identifier | Type | Where |
|---|---|---|---|
| Rotation cursor (index into `activePool`) | `activeRotIdx` | `number` | new field, threaded like `priorActivePick` |
| Prior cursor (threaded back on re-render) | `priorActiveRotIdx` | `number \| undefined` | `SpriteBoxProps` |
| Count of completed loops on the current pose this episode | `activeLoopCount` | `number` | internal to `createSpriteBox`; reported on handle |
| Prior loop-count (threaded back on re-render) | `priorActiveLoopCount` | `number \| undefined` | `SpriteBoxProps` |
| Loops-per-pose before advancing (cadence) | `loopsPerActivePose` | `number` | resolved config, default 1 |
| Config setting key | `claudeteam.activePoolLoopsPerPose` | scalar number | `package.json` `contributes.configuration` |
| Per-character override field | `activePoolLoopsPerPose` | `number?` | `animations.json` top-level (NOT per-anim) |
| Handle field — cursor used this render | `activeRotIdx` | `number` | `SpriteBoxHandle` |
| Handle field — loop-count this render | `activeLoopCount` | `number` | `SpriteBoxHandle` |

**Do NOT reuse `priorActivePick` as the rotation carrier.** Keep `priorActivePick`/`activePick` (the NAME of the current pose) AND add `activeRotIdx` (the cursor) — the pose name is what `poseNameForTile` consumes; the cursor is what advances. Deriving the name from the cursor each render keeps both consistent, but both must be threaded so the resume math (A.4) survives the poll tick. (`activePick` stays the value `poseNameForTile` reads; `activeRotIdx` is its index, carried so the NEXT pose is computable without re-searching the pool.)

### A.2 — the advance condition (cadence)

**Sponsor-proposed default (flag for confirm — see Sponsor gates): advance after the current pose's loop completes ONE full cycle** (`loopsPerActivePose = 1`). Concretely: each time the active-pose frame sequence wraps (`frameIdx` returns to `winStart` in loop mode — the same wrap point at [spritePlayer.ts:675](../../src/webview/sprites/spritePlayer.ts#L675)), increment `activeLoopCount`. When `activeLoopCount >= loopsPerActivePose`, advance the cursor:

```
activeRotIdx = (activeRotIdx + 1) % activePool.length
activeLoopCount = 0
```

and the next loop plays `activePool[activeRotIdx]`.

**Cadence resolution order (field-level, mirrors the playback cascade doctrine):**
1. Per-character `animations.json` top-level `activePoolLoopsPerPose` (if set).
2. Config setting `claudeteam.activePoolLoopsPerPose` (default in `package.json`).
3. Engine default `1`.

**Why loops-not-ms.** Cadence is expressed in COMPLETED LOOPS, not wall-ms, because (a) per-frame timing is already tuned per-anim via `speedMultiplier`/dwells, so a loop is the natural "one full beat of this pose" unit, and (b) it composes cleanly with the existing wrap detection — no second timer. A sponsor who wants slower rotation raises `loopsPerActivePose` to 2 or 3.

`loopsPerActivePose <= 0` or non-finite → clamp to `1` (never freeze on one pose, never divide oddly).

### A.3 — composition with the ~2s poll re-render (CRITICAL — this is the stickiness-vs-rotation seam)

The tile is fully re-rendered every ~2s poll tick (full DOM replace). Today's stickiness exists SO the random pick doesn't re-roll every tick. Rotation must NOT reset on every tick either — the cursor + loop-count must SURVIVE the re-render exactly like `priorActivePick` does.

**The seam:** a single active pose's loop may be SHORTER than 2s (so multiple loops complete between two re-renders) OR LONGER (so a re-render lands mid-loop). Both must be handled:

- The cursor (`activeRotIdx`) and loop-count (`activeLoopCount`) are advanced INSIDE the frame `tick()` (driven by frame completion), NOT by the poll tick. The poll tick only THREADS the current values back in via `priorActiveRotIdx` / `priorActiveLoopCount`.
- On re-render, `createSpriteBox` seeds `activeRotIdx`/`activeLoopCount` from `priorActiveRotIdx`/`priorActiveLoopCount` UNLESS it's a fresh active episode (idle→active), in which case both reset to 0.
- This must compose with the EXISTING frame-position resume (`priorFrameIdx`/`priorPose`/`priorElapsedMs`, [spritePlayer.ts:542-572](../../src/webview/sprites/spritePlayer.ts#L542-L572)): the resume re-shows the displayed frame of the CURRENT pose; the rotation cursor advances only when that pose's loop wraps. So a re-render landing mid-loop resumes the same pose at the same frame AND carries the same cursor — no double-advance, no reset.

**Guard against double-counting a wrap across re-renders.** The frame-position resume re-shows the last displayed frame (not the next). If the prior box had JUST wrapped (displayed `winStart` again) and incremented the cursor, the resuming box must not re-increment for the same wrap. Rule: `activeLoopCount` is incremented in `tick()` at the moment `frameIdx` is ADVANCED past `winEnd` back to `winStart` (the existing wrap branch), and the cursor-advance check runs immediately after. Because the resume seeds `activeLoopCount` from the prior value (post-increment), the count is monotonic across the box swap — the wrap is counted exactly once, in the box that performed it.

### A.4 — fresh-active-episode reset (idle→active)

Mirror the existing `freshActiveEpisode` predicate ([spritePlayer.ts:403-404](../../src/webview/sprites/spritePlayer.ts#L403-L404)):

```
freshActiveEpisode = priorWasActive !== true || priorActiveRotIdx === undefined
→ activeRotIdx = 0, activeLoopCount = 0   (start at activePool[0])
otherwise → resume: activeRotIdx = priorActiveRotIdx, activeLoopCount = priorActiveLoopCount ?? 0
```

So every time an agent goes idle and comes back to work, rotation restarts at the FIRST pool member, in order. (Sponsor asked for "in order"; starting at `[0]` on each fresh episode is the deterministic reading — flag if sponsor prefers "resume where the last active episode left off" instead; see Sponsor gates.)

### A.5 — `active_read` interaction

`active_read` (tool == Read) is NOT in `activePool` and never rotates. When the agent is reading, the read pose plays; the cursor/loop-count are frozen (not advanced) and dropped from the threaded pick exactly as `activePick` is normalized to null at [spritePlayer.ts:416-418](../../src/webview/sprites/spritePlayer.ts#L416-L418). On read→work, treat it as a continuation of the SAME active episode (`priorWasActive === true`), so rotation RESUMES at the cursor it was at before the Read (do not reset to `[0]` — a Read is not an idle gap). This requires `priorActiveRotIdx` to survive an `active_read` render: the tracker keeps the last non-read cursor. **Implementation note for Maya:** on an `active_read` render, do NOT overwrite the tracker's `activeRotIdx`/`activeLoopCount` — leave the prior values intact so the next non-read render resumes them. (Symmetric to how `activePick` is dropped but `priorWasActive` stays true.)

### A.6 — single-member pool / empty pool degrade

- `activePool.length === 0` → `pickActive` returns null → falls back to single `active_work` ([posePicker.ts:66](../../src/webview/sprites/posePicker.ts#L66)). No rotation. Unchanged.
- `activePool.length === 1` → cursor wraps `0 → 0`; rotation is a no-op (same pose forever). Correct — nothing to rotate to.

### A.7 — tracker + caller threading (4-file change, mirror the existing pattern)

1. **`SpriteBoxProps`** ([spritePlayer.ts:204-310](../../src/webview/sprites/spritePlayer.ts#L204)) — add `priorActiveRotIdx?: number` + `priorActiveLoopCount?: number` (doc them like `priorActivePick`).
2. **`SpriteBoxHandle`** ([spritePlayer.ts:313-349](../../src/webview/sprites/spritePlayer.ts#L313)) — add `activeRotIdx: number` + `activeLoopCount: number`.
3. **`spriteTracker.ts`** ([spriteTracker.ts:28-101](../../src/webview/spriteTracker.ts#L28)) — `SpriteEntry` gains `activeRotIdx`/`activeLoopCount`; add `priorActiveRotIdx(...)` / `priorActiveLoopCount(...)` readers; `register(...)` stores them.
4. **`agentTile.ts`** ([agentTile.ts:319-366](../../src/webview/components/agentTile.ts#L319)) + **`multiAgentPersonaTile.ts`** ([multiAgentPersonaTile.ts:296-346](../../src/webview/components/multiAgentPersonaTile.ts#L296)) — thread the two new prior values INTO `createSpriteBox` (alongside `priorActivePick`) and register the two new handle fields back. Both callers are byte-identical in this region — apply the same diff to both.

### A.8 — test discipline (per re-render-resume doc, non-vacuous)

The required unit test MUST drive a SECOND `renderFull` (poll-tick re-render) and assert the cursor SURVIVES + advances correctly across it — a single-mount test is vacuous w.r.t. this class (same blind spot the `[hidden]` + stateful-panel gotchas have, per vscode-extension-conventions.md § Re-render-resume). Drive frame `tick()`s with the injected `scheduleFrame` + `nowMs` to:
- complete N loops → assert cursor advanced by N (at `loopsPerActivePose=1`).
- re-render mid-loop → assert SAME pose resumes, cursor unchanged, no double-count on the resumed wrap.
- idle→active → assert cursor resets to 0.
- read→work → assert cursor resumes (not reset).

---

## Feature B — Tuner preview over the room + step control

### B.0 — what ships today (verified)

The tuner preview ([playbackTunerPreview.ts:159-202](../../src/webview/components/playbackTunerPreview.ts#L159)) builds a BARE `.ct-tuner-preview-box` containing only the sprite box — NO scene-bg. The dashboard tile, by contrast, wires the scene at [agentTile.ts:304-317](../../src/webview/components/agentTile.ts#L304): `defaultScene()` → set `data-scene-bg` attribute + `--ct-scene-url` custom prop, painted by [dashboard.css:529-535](../../src/webview/styles/dashboard.css#L529).

### B.1 — render the room behind the preview (reuse the tile's scene render)

Apply the SAME scene wiring to the preview wrapper. LOCKED vocabulary — reuse the EXISTING tile names, do NOT invent preview-specific ones:

- Resolve the scene via `defaultScene(manifest)` ([spriteManifest.ts:246-254](../../src/webview/sprites/spriteManifest.ts#L246)).
- On the `.ct-tuner-preview-box` wrapper element: set `dataset.sceneBg = ""` (attribute `data-scene-bg`) + `style.setProperty("--ct-scene-url", \`url('${sceneBase}/${sceneImage}')\`)` — identical to [agentTile.ts:308-311](../../src/webview/components/agentTile.ts#L308).
- `sceneBase = spriteBaseUri.replace(/\/+$/, "")`, `sceneImage = scene.image.replace(/^\/+/, "")` — same normalization as the tile.
- Degrade: `defaultScene()` returns null (no scene registry) → set NEITHER attribute → the preview keeps today's bare box. Same load-bearing degrade path as §FIRM.3.

**CSS (new — do NOT overload the `.agent-tile[data-scene-bg]` selector; the preview is a different element):** add a parallel rule keyed on `.ct-tuner-preview-box[data-scene-bg]`:

```
.ct-tuner-preview-box[data-scene-bg] {
  background-image: var(--ct-scene-url);
  background-size: cover;
  background-position: center var(--ct-scene-anchor-y);  /* token = `bottom`, dashboard.css:202 — feet on floor */
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
```

The preview wrapper is currently `flex: 0 0 auto` sized to the sprite ([dashboard.css:2275-2278](../../src/webview/styles/dashboard.css#L2275)). The sprite box inside is `--ct-sprite-size` (140-176px clamp). The room paints to the wrapper bounds; because the wrapper hugs the sprite, the room frames the character tightly — matching the dashboard tile's feel. NO scrim/chip needed (the tuner preview carries no meta-label text over the room — labels live OUTSIDE the preview box in the source table + controls).

**`spriteBaseUri` absence (browser dev / no host):** the tuner already guards `spriteBaseUri !== undefined` for frames; gate the scene wiring on the same condition so browser-dev renders the bare box (no broken bg-image). The scene image, like sprite frames, only resolves through the host's `asWebviewUri`.

### B.2 — the step / cycle control

A control near the Animation dropdown that lets the sponsor STEP through the active pool (or any anim set) over the room — reviewing each work pose in-context without a live working agent.

**Vocabulary (LOCKED):**

| Concept | Identifier |
|---|---|
| Container | `.ct-tuner-step` |
| Prev button | `.ct-tuner-step-prev` |
| Next button | `.ct-tuner-step-next` |
| Position readout | `.ct-tuner-step-readout` |
| Cycle (auto-advance) toggle | `.ct-tuner-step-cycle` |
| Step source (which anim list) | `.ct-tuner-step-source` (select: "Active pool" / "All animations") |

**Behavior:**
- The step control drives the SAME `selectedAnim` the Animation dropdown drives — stepping Next/Prev moves `selectedAnim` to the next/previous entry in the step source and fires the existing `onSelectionChange()` path ([playbackTuner.ts:581-584, 696-704](../../src/webview/components/playbackTuner.ts#L696)). So step + dropdown stay in sync (stepping updates the dropdown's `.value`; choosing in the dropdown updates the readout).
- **Step source** default = the selected character's `activePool` (the feature's point: review WORK poses). A second option "All animations" steps every entry in the anim dropdown (so the sponsor can also walk idle poses over the room).
- **Readout** shows `"<animName> — <i+1> / <N>"` (e.g. `active_work — 2 / 3`). Text label, not icon-only (a11y per design discipline).
- **Cycle toggle** (checkbox): when ON, auto-advance to the next pose after that pose completes `loopsPerActivePose` loops over the room — REUSING Feature A's cadence so the tuner previews EXACTLY what the dashboard will do. When OFF (default), the preview holds the current pose and only Prev/Next move it. The cycle toggle drives `selectedAnim` forward on a webview-local timer/loop-count; it does NOT touch persistence.
- Prev/Next wrap (`% N`). Disabled-state: when step source is empty (no active pool) → buttons disabled + readout `"no active pool"`.

**Placement:** the step control sits in a new row DIRECTLY BELOW the existing selectors row (`.ct-tuner-selectors`, [playbackTuner.ts:328-351](../../src/webview/components/playbackTuner.ts#L328)) and ABOVE the preview row — so the sponsor reads top-to-bottom: pick char/anim → step through poses → watch over room → tune. Keeping it a sibling row (not inside the preview) means it survives the same B1 state-tracker persistence the rest of the panel uses ([playbackTuner.ts:831-838](../../src/webview/components/playbackTuner.ts#L831)) without new tracker fields (it only reads/writes `selectedAnim`, already persisted).

### B.3 — ASCII wireframe (tuner panel with room + step control)

```
┌─ Playback Tuner ───────────────────────────────────────────── ✕ ─┐
│                                                                   │
│  ┌─ Character ─────────┐   ┌─ Animation ─────────┐                │  ← .ct-tuner-selectors (existing)
│  │ ClaudeTeam-M01-Dev ▾│   │ active_work        ▾│                │
│  └─────────────────────┘   └─────────────────────┘                │
│                                                                   │
│  ┌─ Step ──────────────────────────────────────────────────────┐ │  ← NEW .ct-tuner-step row
│  │  Source: [ Active pool ▾ ]   ◄ Prev    Next ►                │ │
│  │  active_work — 2 / 3            [✓] Cycle over room          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─ Preview ───────────────┐   ┌─ Effective values ───────────┐  │  ← .ct-tuner-preview-row (existing)
│  │ ░░░░░░░░░░░░░░░░░░░░░░░░ │   │ speed      0.50×  [per-char] │  │
│  │ ░░░  room3 behind  ░░░░░ │   │ hold       400 ms [engine]  │  │
│  │ ░░░░░░  ╔════╗  ░░░░░░░░ │   │ mode       loop   [pose-def]│  │
│  │ ░░░░░░  ║ 🧍 ║  ░░░░░░░░ │   │ apex frame off    [engine]  │  │  ← NEW: sprite over room
│  │ ░░░░░░  ║desk║  ░░░░░░░░ │   │ apex hold  600 ms [engine]  │  │     (.ct-tuner-preview-box
│  │ ▓▓▓▓▓▓▓▓floor▓▓▓▓▓▓▓▓▓▓▓ │   │ window     full   [engine]  │  │      [data-scene-bg])
│  └─────────────────────────┘   └─────────────────────────────┘  │
│                                                                   │
│  ─── Window ───────────────────────────────────────────────────  │  (existing, unchanged below)
│   [ ●━━━━━━━━━━━━━━● ]  full clip                  [reset]        │
│  ─── Controls ──────────────────────────────────────────────────  │
│   Speed   [ ━━━●━━━━━━━━━ ] 0.50×                  [reset]        │
│   Hold    [ ●━━━━━━━━━━━━ ] 400 ms                 [reset]        │
│   …                                                               │
└───────────────────────────────────────────────────────────────────┘

Legend:  ░ = room wall   ▓ = room floor   🧍/desk = sprite (active_work pose)
```

### B.4 — preview pose-forcing already supports this (no new forcing logic)

`derivePreviewPose` ([playbackTunerPreview.ts:72-100](../../src/webview/components/playbackTunerPreview.ts#L72)) already forces ANY anim name into the preview deterministically (`active_*` → running state; else idle-pick). Stepping just changes `selectedAnim` and the existing `rebuildPreview()` ([playbackTuner.ts:1152-1182](../../src/webview/components/playbackTuner.ts#L1152)) re-forces it. The cycle toggle's auto-advance is the ONLY new mechanic — a webview-local loop-count counter on the preview box, mirroring Feature A's wrap-count, that bumps `selectedAnim`. **Reuse Feature A's `loopsPerActivePose` resolution** so the cadence shown in the tuner is the cadence the dashboard ships.

### B.5 — test discipline

- Functional (jsdom, NOT sponsor-deferred per the sub-agent-GUI scope correction): assert `data-scene-bg` + `--ct-scene-url` set on the preview box when `defaultScene()` resolves; assert absent on null-scene; assert Next/Prev move `selectedAnim` through the step source and wrap; assert readout text; assert cycle toggle advances on loop-complete (drive with injected frame scheduler).
- Visual (sponsor post-merge): room renders behind sprite, floor anchored, feet on floor; step control reads cleanly over the panel.

---

## Sponsor gates (orchestrator to confirm — subjective-feel calls, NOT auto-decidable)

1. **Cadence default (`loopsPerActivePose`).** Proposed: `1` (advance after one full loop). Alternative: `2` (slower, calmer rotation — a working agent's tile changes pose every ~2 loops). **Recommendation: 1** — most responsive to "show me the agent is doing varied work"; sponsor can dial up. This is a motion-feel call → sponsor confirms.
2. **Fresh-episode reset point (A.4).** Proposed: idle→active restarts rotation at `activePool[0]` (deterministic, "in order from the top"). Alternative: resume the cursor where the last active episode left off (less repetitive across short idle gaps). **Recommendation: restart at [0]** — matches the literal "in order" ask + is predictable. Sponsor confirms which reading they meant.
3. **Step-control cycle default (B.2).** Proposed: Cycle toggle defaults OFF (sponsor steps manually). Alternative: default ON (auto-walks the pool on open). **Recommendation: OFF** — opening the tuner to inspect ONE pose shouldn't immediately start cycling; the sponsor opts into the walk. Sponsor confirms.

## Out of scope

- No data-model changes to the agent object (Feature A is pure webview render state; no Felix request).
- No new sprite assets / PixelLab work.
- Per-role scenes (still the documented data-only future upgrade; this spec reuses the single shared `defaultScene`).
- Rotation cadence in wall-ms (loops is the chosen unit — see A.2).
- Persisting rotation state to the host (it's ephemeral UI, owned by the webview tracker like idle stickiness).
