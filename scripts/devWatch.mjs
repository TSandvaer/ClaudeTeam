/**
 * Pure helpers for the dev-watch loop (ticket 86ca5eqy3).
 *
 * Kept in their own side-effect-free module (no node:fs, no node:child_process,
 * no direct-run guard) so the unit test can import them cleanly under vitest —
 * mirrors the devVersion.mjs / build-sprite-manifest.mjs split.
 *
 * The I/O shell (fs.watch wiring + pipeline spawning + Ctrl-C handling) lives in
 * scripts/dev-watch.mjs. This module owns only the two pure decisions that make
 * the watcher correct:
 *   1. createDebouncer — collapse a burst of file events into ONE pipeline run.
 *   2. isWatchedFile   — decide whether a changed path should trigger a rebuild.
 */

/**
 * Build a trailing-edge debouncer. Each `trigger()` (re)starts a timer; the
 * supplied `fn` runs once, `delayMs` after the LAST trigger in a burst. A flood
 * of fs.watch events during a multi-write save therefore collapses into a single
 * pipeline run instead of one run per event.
 *
 * Timer functions are injected (default to the globals) so the unit test can
 * drive them deterministically with vitest fake timers OR hand-rolled stubs.
 *
 * @param {(...args: unknown[]) => void} fn the work to run after the burst settles
 * @param {number} delayMs quiet-window in milliseconds
 * @param {{ setTimeout?: typeof setTimeout, clearTimeout?: typeof clearTimeout }} [timers]
 * @returns {{ trigger: (...args: unknown[]) => void, cancel: () => void, pending: () => boolean }}
 */
export function createDebouncer(fn, delayMs, timers = {}) {
  const set = timers.setTimeout ?? setTimeout;
  const clear = timers.clearTimeout ?? clearTimeout;
  let handle = null;

  function trigger(...args) {
    if (handle !== null) {
      clear(handle);
    }
    handle = set(() => {
      handle = null;
      fn(...args);
    }, delayMs);
  }

  function cancel() {
    if (handle !== null) {
      clear(handle);
      handle = null;
    }
  }

  function pending() {
    return handle !== null;
  }

  return { trigger, cancel, pending };
}

/**
 * Decide whether a changed path under the watched sprite tree should trigger a
 * rebuild. We only care about the two files that feed the baked manifest:
 *   - any character's `animations.json`
 *   - the repo-root `pose-defaults.json`
 * Everything else under assets/sprites (PNG frames, _pixellab_anims rotations,
 * editor swap files) is noise and must NOT trigger a (slow) full repackage.
 *
 * fs.watch delivers paths with the platform separator; this matches on the
 * basename so it is separator-agnostic and works for both the recursive-relative
 * filenames win32 emits and the absolute paths some platforms emit.
 *
 * @param {string | null | undefined} changedPath the path fs.watch reported
 * @returns {boolean}
 */
export function isWatchedFile(changedPath) {
  if (!changedPath) {
    return false;
  }
  // Normalize separators, then take the basename.
  const normalized = String(changedPath).replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return base === "animations.json" || base === "pose-defaults.json";
}
