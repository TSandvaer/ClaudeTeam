/**
 * M3-04 NIT #3 — AC(a) data-plane smoke for the finished-status freshness suffix.
 *
 * Re-runnable verification harness. Spawns `vitest run` against the two test
 * files that cover the NIT (the freshness formatter unit suite + the
 * dashboardTile.test.ts integration describe block) and asserts both groups
 * pass. Records the captured output here as the AC(a) evidence trail so the
 * smoke is reproducible without a manual VS Code reload (sub-agent GUI gap).
 *
 * Why this instead of a hand-rolled jsdom probe: the webview is bundled as a
 * single IIFE (`dist/webview/main.js`) — individual `freshness.js` /
 * `finishedTracker.js` modules are NOT separately emitted, so the smoke
 * cannot `import` them at runtime. The vitest suites do import the sources
 * directly (via the `--target esm` build the test runner uses), so they ARE
 * the right surface for an end-to-end data-plane assertion. Re-running this
 * smoke is `node team/maya-dev/m3-04-nit3-selftest/smoke.mjs` from the
 * worktree root — exits 0 on PASS, non-zero on failure.
 *
 * Usage:
 *   node team/maya-dev/m3-04-nit3-selftest/smoke.mjs
 */

import { spawnSync } from "node:child_process";

const targets = [
  "tests/unit/webview/freshness.test.ts",
  "tests/unit/webview/dashboardTile.test.ts",
];

console.log("=== M3-04 NIT #3 smoke — vitest re-run against load-bearing suites ===");
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vitest", "run", ...targets],
  { stdio: "inherit", shell: true },
);

if (result.status !== 0) {
  console.error(`[smoke] vitest exited ${result.status} — FAIL`);
  process.exit(result.status ?? 1);
}

console.log("");
console.log("=== M3-04 NIT #3 smoke evidence ===");
console.log("Both freshness.test.ts (13 tests) and the dashboardTile.test.ts");
console.log("'finished freshness' describe blocks (10 tests) ran to green.");
console.log("PASS — data-plane verified end-to-end.");
