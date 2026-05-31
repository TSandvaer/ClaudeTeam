/**
 * Type declarations for devVersion.mjs (ticket 86ca22e5r).
 * Mirrors the sibling pattern build-sprite-manifest.d.mts uses for its .mjs.
 */

/**
 * Build the unique dev version string from a base semver + a timestamp.
 *
 * @param baseVersion e.g. "0.0.1"
 * @param now epoch milliseconds (defaults to Date.now())
 * @returns e.g. "0.0.1-dev.1717000000000"
 */
export function computeDevVersion(baseVersion: string, now?: number): string;
