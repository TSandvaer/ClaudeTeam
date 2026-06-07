/**
 * Type declarations for devWatch.mjs (ticket 86ca5eqy3).
 * Mirrors the sibling pattern devVersion.d.mts / build-sprite-manifest.d.mts
 * use for their .mjs. allowJs is OFF, so `npm run typecheck` (the CI gate)
 * resolves imports of devWatch.mjs through THIS file — keep the shapes in sync
 * with the .mjs or typecheck fails (see testing-strategy.md § .d.mts shadow rule).
 */

/** Trailing-edge debouncer handle returned by createDebouncer. */
export interface Debouncer {
  /** (Re)start the quiet-window timer; fn runs once after the burst settles. */
  trigger: (...args: unknown[]) => void;
  /** Cancel a pending run (e.g. on Ctrl-C). */
  cancel: () => void;
  /** True while a run is queued and not yet fired. */
  pending: () => boolean;
}

/** Injectable timer functions (default to the globals). */
export interface DebounceTimers {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/**
 * Build a trailing-edge debouncer: fn runs once, delayMs after the LAST trigger.
 */
export function createDebouncer(
  fn: (...args: unknown[]) => void,
  delayMs: number,
  timers?: DebounceTimers,
): Debouncer;

/**
 * True only for the two manifest-feeding files: any `animations.json` or the
 * repo-root `pose-defaults.json`. Separator-agnostic (matches on basename).
 */
export function isWatchedFile(changedPath: string | null | undefined): boolean;
