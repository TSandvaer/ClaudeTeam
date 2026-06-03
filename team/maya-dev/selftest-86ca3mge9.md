## Self-Test Report — 86ca3mge9 (active_work POOL)

PR #190 · HEAD `20b2321`

### Sub-agent GUI gap

Author + reviewer are sub-agents (headless harness, no GUI session). Per `testing-strategy.md` § "Sub-agent GUI gap": the **functional** behavior of this change is fully covered by Layer-1 + Layer-2.5 (jsdom DOM-interaction) tests (below); the **interactive screenshots** (Reload Window, theme toggle, per-state captures) defer to the sponsor's post-merge confirm-no-regression. This PR changes webview pose-selection logic + adds new sprite assets, so a sponsor manual reload is the appropriate visual gate before/after merge.

### AC walkthrough

- **PART A — asset bake (deterministic).** ✅ 102 frames baked (6 anims × 17 south frames, F01 + M01) from PixelLab Backblaze via curl; sponsor's exact recolor applied verbatim (thresholds unchanged). Frames are 68×68 **transparent** PNGs (verified: corner pixel `(0,0,0,0)`, ~70% of pixels transparent → character on transparent bg, NOT composited over room3). Placed under new state-slug folders `{typing,working_cycle,working_focused}_at_a_mouse_desk/animations/<animId>/south/frame_NNN.png`, matching the existing `frame_NNN.png` convention. `animations.json` (both chars) maps `typing`/`work_cycle`/`work_focus` → folders + `active_pool` list + 0.5× playback.
- **PART B — active pool.** ✅ `SpriteCharacter.activePool` baked by the manifest generator (verified in `generatedManifest.ts` — both characters carry `activePool: [typing, work_cycle, work_focus]`). `posePicker.pickActive` + `poseNameForTile` draw the pool for running + tool != Read; `active_work` is the no-pool fallback; `active_read` unchanged. `spritePlayer` picks ONE per active episode with stickiness across the ~2s poll re-render (re-roll only on idle→active). `spriteTracker` + both tile callers thread the pick.
- **Unit / DOM-interaction tests.** ✅ `posePicker.test.ts` (active-pool branch + `pickActive`), `spritePlayer.test.ts` (new describe: pool pick / membership / **episode stickiness** / **re-roll on fresh episode** / read-null-pick / no-pool fallback — each documents its revert failure, non-vacuous), `spriteTracker.test.ts` (`priorActivePick` round-trip).

### Data-plane / functional smoke (load-bearing — sub-agent CAN run)

- `npm test` → **1380 passed, 2 skipped (67 files)**. Full suite green.
- `npm run typecheck` → green (CI `tsc --noEmit` mirror; `activePool` added to `SpriteCharacter` propagated to all fixtures).
- `npm run lint` → clean.
- `npm run build` → green; all 6 new pose folders (102 frames) copied into `dist/webview/sprites/<char>/_pixellab_anims/...` under the `dist/webview` localResourceRoot.

### Side-effect inventory

- Running-tile sprite pose: was always the single `active_work` desk pose; now cycles 3 working poses per active episode (the intended change). `active_read` (tool == Read) and all idle/available/finished/error poses are unchanged.
- `SpriteCharacter` gained a required `activePool` field → all test fixtures updated; the production manifest always sets it (empty list for a char with no `active_pool`).
- `package.json` NOT touched → no `vsce package` manifest gate required.

### Theme-switch probe

- Deferred to sponsor post-merge (sub-agent GUI gap). No CSS changed — sprite frames render in the existing `.sprite-box`/`.sprite-frame` chrome; theme variables untouched. Low visual-regression risk.

### State-coverage

- **Running (tool != Read):** new pool pose — covered functionally by `spriteTile.test.ts` + `multiAgentPersonaTile.test.ts` (rng=0 → `typing`) and `spritePlayer.test.ts` (all three pool members reachable). Screenshot deferred to sponsor.
- **Running (tool == Read):** `active_read` unchanged — covered (`spriteTile.test.ts` desk read-pose assertion still green).
- **Idle / available / finished / error:** idle-pool path unchanged — covered (existing idle tests green).
- **Sponsor reload check (post-merge):** confirm a running tile visibly cycles through the 3 working anims over successive active episodes.
