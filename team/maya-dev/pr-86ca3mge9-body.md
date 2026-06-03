## What changed

Ship the sponsor-approved working animations as a per-character **active_work POOL** the dashboard randomly cycles through while an agent is actively working (running + tool != Read), mirroring the existing idle pool.

A running tile no longer always plays the single `active_work` desk pose — it now picks ONE of three working anims per active episode and loops it: **typing**, **work_cycle**, **work_focus**, each baked on a new grounded "mouse" desk pose.

### PART A — asset bake (deterministic)

- Downloaded the 17 south frames (i=0..16) of each of the 6 approved anims (typing / work_cycle / work_focus × F01 + M01) from PixelLab Backblaze via **curl** (urllib gets HTTP 403).
- Applied the sponsor's **EXACT** recolor verbatim — thresholds unchanged (PINK→WOOD swap + the per-character DARK shirt recolor in the `27<=x<=41, 46<=y<=63` box). F01 DARK `(48,45,55)`, M01 DARK `(40,33,40)`.
- Saved as 68×68 **transparent** `frame_NNN.png` (renamed from PixelLab's `0.png`) under new state-slug folders — `typing_at_a_mouse_desk` / `working_cycle_at_a_mouse_desk` / `working_focused_at_a_mouse_desk`. **NOT** composited over room3 (scene-bg is a separate layer; corner pixels are fully transparent, ~70% of pixels transparent).
- `animations.json` (F01 + M01): mapped `typing`/`work_cycle`/`work_focus` → their folders, added an `active_pool` list, and added `0.5×` playback entries mirroring `active_work`.

### PART B — active pool

- **`SpriteCharacter.activePool`** surfaced on the manifest; the build script (`scripts/build-sprite-manifest.mjs`) filters it to frame-resolved anims exactly like `idlePool`. Manifest rebaked.
- **`posePicker.ts`** — new `pickActive()` (mirror of `pickIdle`); `poseNameForTile` draws the active pool for running + tool != Read. `active_work` remains the no-pool fallback. `active_read` (tool == Read) is unchanged and never pool-drawn.
- **`spritePlayer.ts`** — ONE active pick per ACTIVE episode with stickiness across the ~2s poll re-render; re-rolls only on a fresh active episode (idle→active), mirroring the idle-episode path. The handle exposes `activePick` (nulled out for `active_read` / no-pool so a read episode never threads a working pick).
- **`spriteTracker.ts`** + both tile callers (`agentTile.ts`, `multiAgentPersonaTile.ts`) thread `priorActivePick` in and register `activePick`.

## Out of scope (per ticket)

- **`active_read` re-gen** — it still references the OLD desk pose (`sitting_at_a_desk_fa`). The two active poses (read on the old desk vs. work on the new mouse desk) will visibly differ when an agent toggles Read↔work. Noted as a follow-up; NOT fixed here.
- Per-role rooms; deleting obsolete PixelLab scratch states.

## Tests

- `posePicker.test.ts` — `pickActive` deterministic-under-rng + membership invariant + empty-pool→null; `poseNameForTile` active-pool branch (pool pick / fallback / `tool:?` sentinel / Read-ignores-pick / idle-ignores-pick).
- `spritePlayer.test.ts` — new describe block: running renders a pool member (deterministic rng), membership invariant, **stickiness within an episode**, **re-roll on fresh active episode**, `active_read` reports a null pick, no-pool→`active_work` fallback. Each documents its revert failure mode (non-vacuous).
- `spriteTracker.test.ts` — `priorActivePick` round-trip + null→undefined.
- Updated `spriteTile.test.ts` + `multiAgentPersonaTile.test.ts` running-pose assertions to the new pool behavior (rng=0 → `typing`).

## Reviewer / QA

Reviewer **Felix**; then Sage QA. Webview smoke = hard gate (see Self-Test Report comment).
