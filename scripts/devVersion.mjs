/**
 * Pure version-stamp helper for the dev packaging flow (ticket 86ca22e5r).
 *
 * Kept in its own side-effect-free module (no node:child_process, no direct-run
 * guard) so the unit test can import it cleanly under vitest. The load-bearing
 * property is AC1: two consecutive packages must produce DIFFERENT version
 * strings so `code --install-extension --force` never cache-collides.
 */

/**
 * Build the unique dev version string from a base semver + a timestamp.
 *
 * A millisecond timestamp (not `git rev-list --count`) is the uniqueness
 * source on purpose: two consecutive packages with NO new commit must still
 * differ (AC1), and the commit count is identical across them.
 *
 * `<base>-dev.<n>` is a valid semver PRERELEASE that vsce accepts, and it sorts
 * BELOW the eventual real `<base>` release — so it never shadows a Marketplace
 * publish.
 *
 * @param {string} baseVersion e.g. "0.0.1"
 * @param {number} now epoch milliseconds (injectable for testing)
 * @returns {string} e.g. "0.0.1-dev.1717000000000"
 */
export function computeDevVersion(baseVersion, now = Date.now()) {
  // Strip any pre-existing prerelease so re-running on an already-dev version
  // (defense-in-depth) doesn't nest tags.
  const base = String(baseVersion).split("-")[0];
  return `${base}-dev.${now}`;
}
