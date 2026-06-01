## REVIEW VERDICT: APPROVE_WITH_NITS

Re-review (Maya) of the delta since my prior APPROVE: the new `startFrame?`/`endFrame?` window primitive + the rebase/pin-revert (`104fda2`). Verified on tip `a78ca8c`. CI green (`typecheck + lint + unit` SUCCESS).

### Window primitive — additive / backward-compatible ✅
- **Absent window = byte-identical historic loop.** `winStart` defaults to `0`, `winEnd` to `lastIndex` (`spritePlayer.ts:427-428`); the loop-mode advance `frameIdx === winEnd ? winStart : frameIdx + 1` reduces to the historic `=== lastIndex ? 0 : +1` with no edge off-by-one. Covered by the explicit byte-identical regressions: `idle_hips` `0,1,2,0,1,2` (`spritePlayer.test.ts:519`) + `loop + no window` `[0,1,2,3,0,1,2,3,0,1]` and absent-playbackMode (`spritePlayerWindowed.test.ts:159,164`).
- **Bounds clamped sanely, degenerate windows don't crash.** `clamp` truncs into `[0,lastIndex]` (`:426`); inverted `winStart > winEnd` → full-clip fallback (`:429-433`); single-frame window (`winEnd === winStart`) is gated out of the pingpong branch by `winEnd > winStart` (`:468`) and stays put in the loop branch — no crash, no spin-to-undefined.

### pingpong + finalDwell key off the WINDOW ends ✅
- Turnaround flips direction at `winEnd`/`winStart`, not raw clip ends (`:472-473`); the dwell gate is `frameIdx === winEnd && !isActive && direction === 1` (`:459`) so the hold fires on the FORWARD apex arrival only (Bram's reverse-pass gotcha respected).
- M01 seed `{startFrame:5,endFrame:10,playbackMode:"pingpong",finalDwellMs:800}` traces to `5,6,7,8,9,10,9,8,7,6,5,6` — raise(5→10) → HOLD@10 (apex, +800ms) → lower(10→5) → restart, never escaping `[5,10]`. Asserted verbatim in `spritePlayerWindowed.test.ts:113` + the mid-clip `[3,7]` apex probe at `:126`.

### Pin revert ✅
- `104fda2` reverts the TEMP pin `34cf3ad`; `posePicker.ts` is NOT in the diff vs main; `pickIdle` is restored to real pool selection (`posePicker.ts:90-100`). M01 `idle_stretch` SEED present at `spritePlayer.ts:219-225`; F01 kept as plain held loop (sponsor-approved).

### Tests non-vacuous ✅
- Mutation-verified non-vacuity documented in both files; covers window-vs-no-window, pingpong-within-window, dwell-at-window-end, generic full-clip + 2-frame pingpong.

### NITs (non-blocking — follow-up ticket, not a merge gate)
1. **No dedicated test for the inverted-window fallback** (`winStart > winEnd` → full clip, `:429-433`). The branch is correct and won't crash, but it's untested — a 1-assert case (`{startFrame:8,endFrame:3}` plays the full clip) would harden the "stale/inverted override can't break the loop" claim.
2. **No dedicated single-frame-window test** (`winStart === winEnd` → stays put). Also correct + safe, also untested.

Both are defensive-branch coverage gaps; behavior is right today. Approving — please fold the two cases into the E2 ticket (or a small chore follow-up).
