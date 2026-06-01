/**
 * tunerStateTracker — webview-local persistence of the Playback Tuner's live
 * editing state across panel re-renders (ticket 86ca2189v, BLOCKER B1).
 *
 * The problem this solves
 *
 *   While the Playback Tuner panel is open (`tunerPanelOpen === true`),
 *   `renderFull` rebuilds the ENTIRE panel DOM on every host `state:full` tick
 *   (~2s default poll — `claudeteam.pollIntervalMs`). The tuner holds ALL its
 *   editing state — `selectedChar` / `selectedAnim` / `draftOverride` /
 *   `writeTarget` — in its OWN closure (`playbackTuner.ts`), and `render.ts`
 *   root-swaps a FRESH `renderPlaybackTuner` on each tick. So the panel snapped
 *   back to first-char / default-anim / empty-draft / per-char every ~2s — the
 *   dashboard polls continuously, so the tuner was unusable as shipped.
 *
 *   This is the SAME poll-tick-survivability bug class as the character picker
 *   (86ca1u41m / `pickerOpenTracker`), the overflow menu (86ca1fjqu /
 *   `menuOpenTracker`), and the badge-expand snap-shut (Obs 10 /
 *   `expandedGroupsTracker`). The fix is the same shape: hoist the survivable
 *   state into a single webview-local tracker owned by the boot closure, thread
 *   it through `RenderContext`, seed the freshly-built component FROM it on
 *   mount, and write back to it on every state change.
 *
 *   Why this also fixes the wrong-file banner (B1 symptom 2): the persistence
 *   banner's filename is computed from `selectedChar` + `writeTarget`
 *   (`playbackTuner.ts` renderBanner). When those lived only in the reset
 *   closure, the post-save ack re-render named the RESET (char,target), not the
 *   one actually saved. Persisting them through this tracker makes the banner
 *   name the correct file.
 *
 * What is persisted — exactly the four fields the panel cannot re-derive:
 *   - selectedChar / selectedAnim — the (char, anim) the user is tuning.
 *   - draftOverride — the SET fields (field-omission == clear, §4.1).
 *   - writeTarget — per-char vs pose-default (§3.7).
 *
 * Everything else (slider thumb positions, the live preview box, the source
 * table, the shadow warning) is DERIVED from those four via
 * `computeCascadeSource` + the draft, so re-seeding the four restores the whole
 * panel deterministically. `draftOverride` is cloned on read/write so the
 * tracker can never be mutated by a stale closure reference.
 *
 * Persistence scope (identical to pickerOpenTracker / menuOpenTracker):
 *   - Survives poll-tick `renderFull` (the load-bearing case).
 *   - Does NOT survive webview reload (a coarse user action — re-open starts
 *     fresh at first-char). Note: the boot closure resets the tracker on panel
 *     CLOSE too (a deliberate user action) so a fresh open is clean.
 *   - Does NOT survive across VS Code sessions (transient interaction, not
 *     config — no `vscode.setState`).
 *
 * Why ephemeral here (not in the host wire shape): in-progress tuning is a
 * webview UI concern, not domain state — the host should not know which
 * (char, anim) the user is mid-edit on. Only the committed save is sent to the
 * host (`.claude/docs/vscode-extension-conventions.md` § "Webview rules" —
 * state minimalism).
 *
 * Source: ClickUp 86ca2189v (B1 — tuner loses all state on poll tick); pattern
 *         parallels pickerOpenTracker.ts (86ca1u41m).
 */

import type { PlaybackOverride } from "./sprites/spritePlayer.js";

/** The survivable editing state of the open tuner. */
export interface TunerSessionState {
  selectedChar: string;
  selectedAnim: string;
  /** Draft override — ONLY the SET fields (field-omission == clear, §4.1). */
  draftOverride: PlaybackOverride;
  writeTarget: "per-char" | "pose-default";
}

/** Public surface of the tracker — single instance per webview boot. */
export interface TunerStateTracker {
  /**
   * The persisted editing state, or `null` if nothing has been captured yet
   * (first open in this webview boot, or after a `reset()`). The returned
   * `draftOverride` is a defensive CLONE — mutating it does not affect the
   * tracker.
   */
  get(): TunerSessionState | null;

  /**
   * Persist the current editing state. `draftOverride` is cloned on write so a
   * later mutation of the caller's draft object can't leak into the tracker.
   */
  set(state: TunerSessionState): void;

  /**
   * Clear the persisted state (panel close / webview reset). After this, the
   * next render seeds the panel from its own defaults (first-char).
   */
  reset(): void;
}

/** Factory — returns an isolated tracker instance. Pure (no shared state). */
export function createTunerStateTracker(): TunerStateTracker {
  let state: TunerSessionState | null = null;

  return {
    get(): TunerSessionState | null {
      if (state === null) return null;
      return {
        selectedChar: state.selectedChar,
        selectedAnim: state.selectedAnim,
        draftOverride: { ...state.draftOverride },
        writeTarget: state.writeTarget,
      };
    },

    set(next: TunerSessionState): void {
      state = {
        selectedChar: next.selectedChar,
        selectedAnim: next.selectedAnim,
        draftOverride: { ...next.draftOverride },
        writeTarget: next.writeTarget,
      };
    },

    reset(): void {
      state = null;
    },
  };
}
