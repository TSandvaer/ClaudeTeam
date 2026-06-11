# Playback Tuner — manual reload checklist (sweep 86ca2ut8w)

Visual / interactive steps the sponsor runs against the **dev build** (rebuild +
`Developer: Reload Window`). These cover what the jsdom Layer-2.5 harness cannot
assert — pixel feel, native `<select>` popup behavior, the actual on-disk json
write, and motion. Each step lists the click and the expected result.

Build first: **`npm run dev:install`** then `Ctrl+Shift+P` →
`Developer: Reload Window`. Open the tuner via the Dashboard title-bar button or
`Command Palette → ClaudeTeam: Open Playback Tuner`.

> ⚠️ Use **`npm run dev:install`**, NOT `npm run build`. `npm run build` only
> re-bundles to disk — it does NOT reinstall the extension VS Code is running, so
> a `Reload Window` keeps serving the previously-installed VSIX with a stale baked
> manifest. (This is exactly the false "my saved values are gone" symptom hit
> 2026-06-01 — the data was fine; the running bundle was stale. `86ca2vuzr`.)

> Real-manifest note (verified this sweep): the first character is
> `ClaudeTeam-F01-Dev`; `poseDefaults` is **absent** in the baked manifest, so
> every per-char value disappears when you flip the write target to
> "All characters". That makes the BUG 1 desync (below) maximally visible.

## A. Open / close / reopen lifecycle

1. Open the tuner. **Expect:** panel replaces the dashboard; first char selected;
   neutral banner "Adjust a control to tune; changes auto-save."
2. Press `Esc`. **Expect:** panel closes, dashboard returns.
3. Reopen. **Expect:** panel opens fresh at first-char defaults — NOT wherever
   you left it (close resets the tracker). Banner neutral again.
4. Click the ✕ button instead of Esc. **Expect:** same clean close.

## B. The native dropdowns survive the ~2s poll (PR #167 / #166 regression area)

5. Open the **Apex hold → Frame** dropdown and hold it open for >2 seconds without
   selecting. **Expect:** the dropdown stays open the whole time — it must NOT
   snap shut on the poll tick. (This was the sponsor's "disappears before I can
   select anything" bug.) Repeat for the **Character** and **Animation** dropdowns.
6. While a dropdown is open, watch a dashboard poll occur (a tile updates behind
   the panel). **Expect:** your in-progress selection is preserved.

## C. Every control drives the live preview

7. Drag **Speed** across its range. **Expect:** the preview sprite visibly speeds
   up / slows down; readout tracks the thumb; "×" formatting.
8. Drag **Hold (final)** up toward 10000ms. **Expect:** the idle pose dwells on
   its final frame for the set duration; readout shows "… ms"; the 10000ms ceiling
   is reachable (PR #165 raised it from 2000).
9. Pick an **Apex hold → Frame**, then drag **Apex hold** ms up. **Expect:** the
   sprite pauses on that chosen mid-loop frame for the set ms (PR #166). Choose
   **Off** → the mid-loop pause disappears.
10. Toggle **Mode** loop ↔ pingpong. **Expect:** the preview's playback direction
    behavior changes accordingly.

## D. BUG 1 repro (MAJOR — confirm fixed) — write-target flip must repaint controls

11. Select **ClaudeTeam-M01-Dev / idle_coffee** (bakes speed 0.5× + apex frame 4).
    **Expect:** Speed reads `0.50×`, Apex frame shows `frame 4`.
12. Click the **"All characters (pose-defaults.json)"** write-target radio.
    - **BUGGY (pre-fix):** the Speed slider STILL reads `0.50×` and the Apex frame
      STILL shows `frame 4`, even though the draft was re-seeded from the (absent)
      pose-default → empty. The preview/summary also do not refresh.
    - **FIXED (expected):** the controls repaint to the re-seeded draft — Speed
      `1.00×` (engine default), Apex frame `Off`, preview rebuilt.
13. After the flip, nudge **Hold** once and let it auto-save; open
    `assets/sprites/pose-defaults.json`.
    - **BUGGY:** only `finalDwellMs` was written; the `0.50×` and `frame 4` you
      still saw on screen were silently dropped.
    - **FIXED:** the saved block matches exactly what the (repainted) controls show.

## E. BUG 2 repro (MINOR — confirm fixed) — stale success banner re-names the file

14. On a character, change a value and let it auto-save. **Expect:** green banner
    "✎ Saved to <char>/animations.json. Rebuild + reload…".
15. WITHOUT making another edit, switch the **Character** dropdown to a different
    character and wait ~2-3 seconds (one poll tick).
    - **BUGGY (pre-fix):** the green banner re-stamps to "✎ Saved to <NEW
      char>/animations.json" — claiming a save that never happened for the new char.
    - **FIXED (expected):** the banner reverts to the neutral hint (or at least
      stops naming the new char's file) until a real save occurs for it.

## F. Save honesty + on-disk verification

16. Make an edit, let it save, then open the target json (`assets/sprites/<char>/
    animations.json` for per-char, `assets/sprites/pose-defaults.json` for All).
    **Expect:** ONLY the tunable keys changed for that anim; `startFrame`/`endFrame`
    window + other anims' blocks + `_note` comments are untouched (field-level merge).
17. `[reset]` a single field, let it save. **Expect:** that field is REMOVED from
    the json block (inherits again); the other saved fields remain.
18. `[reset]` the last remaining field. **Expect:** the whole `playback["<anim>"]`
    key disappears (file stays minimal).
19. Set a value, then reinstall (**`npm run dev:install`**) + reload. **Expect:** the
    dashboard TILE now reflects the saved value (the banner always says a rebuild is
    needed — confirm the tile only changes after the dev:install + reload, never
    before). NOTE: `npm run build` alone is NOT enough — it bundles but does not
    reinstall the running extension (see the ⚠️ note at the top).

## G. Cross-interactions

20. Set both a **Final hold** and an **Apex hold** (frame + ms) on one anim, save.
    **Expect:** both ride one json write; the preview shows the mid-loop apex dwell
    AND the final-frame hold. (jsdom confirmed the payload; confirm the visual feel.)
21. Make rapid edits to speed → hold → mode within ~0.5s, then pause. **Expect:**
    exactly ONE save fires (debounced), carrying the final value of each field.
22. Theme toggle (dark ↔ light) with the panel open. **Expect:** all controls,
    banner, source table, and warning text remain legible; no broken contrast.

## H. Shadow warning

23. Pick a char/anim that has a per-char override, switch write target to
    "All characters". **Expect:** the ⚠ shadow warning appears naming the shadowed
    field(s). Switch back to "This character". **Expect:** warning disappears.

---

# Dashboard-tile sprite PLAYBACK — manual reload checklist (sweep 86ca3bm87)

These cover the **dashboard tile sprites themselves** (NOT the tuner panel) —
the re-render-resume / idle-advance behavior that produced the 5-bug cluster
(speed-cap #172, apex-window #173, manifest-staleness #174, hold-final-on-active
86ca2apxn, idle-freeze-under-poll #179). The jsdom Layer-2.5 harness asserts the
read→thread→write-back resume WIRING and the engine math, but it cannot judge the
on-screen MOTION across real `performance.now()` time. Run these against a fresh
`npm run dev:install` + `Developer: Reload Window` (NOT bare `npm run build` —
that does not reinstall the running extension; see vscode-extension-conventions
§ Install workflow). Watch real persona tiles on the dashboard while a team runs.

> Why a live build matters here: the sprite box's on-screen clock reads
> `performance.now()` in production (the tile does not forward an injectable
> clock), so the freeze-under-poll behavior (#179) is only observable on a real
> reload over real time — the headless test covers the wiring, your eyes cover
> the motion.

## P. Idle pose advances (does NOT freeze) — #179 regression

P1. Let several rostered members go **idle** (no active sub-agents) and watch each
    tile for ~15 s. **Expect:** every idle sprite visibly CYCLES through its frames
    (raise/lower, cup to mouth, etc.) — NONE freezes on a single frame. The freeze
    bug re-rolled which tiles were affected each reload, so reload 2-3× and re-watch
    a different idle pick each time.
P2. While idle sprites are mid-cycle, trigger a burst of dashboard activity (start /
    stop a sub-agent elsewhere) so the **out-of-band file-event poll** fires faster
    than the ~2s scheduled tick. **Expect:** the idle sprites keep advancing — they
    do NOT stick on whatever frame the fast re-render landed on (the exact #179
    repro: poll cadence shorter than the slow 320ms frame hold).

## Q. Dwell feel — peak + final holds read as deliberate, not janky

Q3. Watch a **coffee / snack** idle pose (apex = cup/hand at mouth, frame 4).
    **Expect:** a clear PAUSE at the apex (cup-at-mouth held ~0.6s+) then it
    continues — the hold should read as a deliberate beat, not a stutter or a skip.
Q4. Watch the **M01 idle_stretch** (windowed pingpong [5,10], 800ms apex hold).
    **Expect:** RAISE → HOLD at the top → LOWER → settle, as ONE continuous motion.
    It must NOT snap back to the rest frame mid-raise, and must NOT skip the lower
    (the 86ca2c4t8 + 86ca2apxn symptoms). The full raise+hold+lower spans more than
    one ~2s poll, so confirm it completes across re-renders.
Q5. Watch any tile transition **idle → running → idle**. **Expect:** while running,
    the pose loops at a uniform cadence with NO final-frame dwell (continuous typing/
    reading feel); the dwell only appears on idle poses (hold-final-on-active fix).

## R. Idle-episode stickiness + char-switch persistence

R6. Watch one idle tile across several poll ticks (~10 s). **Expect:** it keeps the
    SAME idle pose for the whole idle episode — it does NOT re-roll coffee→snack→
    phone every 2 s. A new pick is only allowed after a running stint (fresh episode).
R7. If the Manage Team character picker is in play: assign a member a DIFFERENT
    character, Save, and let the dashboard re-render. **Expect:** the tile's sprite
    switches to the new character and KEEPS animating (no freeze, no broken image);
    the new pose cycles normally.
R8. Toggle OS / VS Code **reduced-motion** ON. **Expect:** every sprite shows a
    single static frame (frame 0), no motion. Toggle OFF + reload. **Expect:** motion
    resumes.

## S. Manifest-staleness (#174) — saved tuning shows on the TILE after rebuild

S9. Tune an animation in the tuner, Save, then `npm run dev:install` + reload.
    **Expect:** the dashboard TILE for that character now plays the tuned values
    (speed / dwell / window). The banner always says a rebuild is needed — confirm
    the tile changes only AFTER the dev:install, never reverts to baked on a later
    poll tick. (Bare `npm run build` + reload keeps the OLD install — see the note
    above; that is NOT a bug, it is the wrong reinstall path.)
