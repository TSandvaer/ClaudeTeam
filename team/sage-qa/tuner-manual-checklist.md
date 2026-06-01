# Playback Tuner — manual reload checklist (sweep 86ca2ut8w)

Visual / interactive steps the sponsor runs against the **dev build** (rebuild +
`Developer: Reload Window`). These cover what the jsdom Layer-2.5 harness cannot
assert — pixel feel, native `<select>` popup behavior, the actual on-disk json
write, and motion. Each step lists the click and the expected result.

Build first: `npm run build` (or `npm run dev:install`) then `Ctrl+Shift+P` →
`Developer: Reload Window`. Open the tuner via the Dashboard title-bar button or
`Command Palette → ClaudeTeam: Open Playback Tuner`.

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
19. Set a value, then rebuild (`npm run build`) + reload. **Expect:** the dashboard
    TILE now reflects the saved value (the banner always says a rebuild is needed —
    confirm the tile only changes after the rebuild, never before).

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
