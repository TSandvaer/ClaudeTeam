## REVIEW VERDICT: APPROVE

Re-review of the descent-resume delta only (commit `964e497` on top of `a78ca8c`). The window primitive was already APPROVE_WITH_NITS'd earlier; this pass scopes strictly to the new playback-position resume mechanic.

### Resume guard — watertight

- **Exact pose-match + window-clamp (`spritePlayer.ts:512-521`).** Resume fires only when `priorPose === canonicalName` AND `priorFrameIdx` is a finite number; the index is then clamped into the LIVE window via `Math.max(winStart, Math.min(winEnd, Math.trunc(priorFrameIdx)))`. The clamp reads `winStart`/`winEnd` computed at `481-487`, so a window change between renders cannot park the loop out of bounds.
- **Pose change does NOT stale-resume.** A different `canonicalName` (idle→active, or a new idle pick) fails the guard → `frameIdx` stays at `winStart` (`:492`). Pinned by "does NOT resume when the pose changed" (`b.seq[0] === 5`, not 9).
- **Reduced-motion is safe.** The reduced-motion path early-returns at `:432-444` BEFORE the resume block, so resume never runs under `prefers-reduced-motion` — frame 0 / dir 1 always. Correct.

### No regression to the historic loop

- The resume block only mutates `frameIdx`/`direction` when the guard passes; every non-resuming path (first render, pose change, non-finite index) keeps the historic defaults (`winStart`, `direction = 1`). Loop-mode poses never set `direction = -1`, so resuming a non-pingpong pose mid-cycle is transparent continuity, not a behavior change.
- `canonicalName` was HOISTED (`:400`) and its prior inline duplicate removed; the hoisted value is byte-identical to the old `isActive ? name : (idlePick ?? name)` expressions at `box.dataset.pose` and the override-resolve site. Pure refactor.

### Frame math + E1 seed untouched

Confirmed: the window clamp (`481-487`), pingpong advance (`549-561`), `finalDwellMs` (`468-469`), and peak-dwell (`545-547`) blocks are unchanged in the diff. The delta adds only the resume block + handle plumbing (`pose`, `currentFrame()`) + tracker `priorPlayback`.

### Tests non-vacuous (mutation-verified locally)

- Reverted the resume init to unconditional `frameIdx = winStart` → **exactly 2 tests fail** ("resumes the descent across a re-render" and "clamps a stale prior index"), matching the commit's claim. The guard-direction tests ("pose changed → fresh start", "no prior → winStart") correctly still pass under the mutant, pinning both directions.
- `spriteTracker.test.ts` adds `priorPlayback` coverage including a **live-read** assertion (frameIdx mutated post-register, re-read through the closure) — proves the tracker reads position at query time, not a register-time snapshot. This is load-bearing: a snapshot would resume from a stale apex frame.

### CI

Run `26714334631` against head SHA `964e4974acb99926bcb6487abd4caac4b73bcc67` — `conclusion: success`. `typecheck + lint + unit` green. 14/14 local on the two touched suites.

No blockers. The resume mechanic is correctly guarded and the descent fix is sound. (Sponsor does the live visual re-preview separately.)
