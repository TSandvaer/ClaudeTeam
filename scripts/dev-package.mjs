/**
 * Dev packaging helper — produces a UNIQUELY-versioned .vsix on every run so
 * `code --install-extension --force` never cache-collides on a repeated version
 * string.
 *
 * Why this exists (ticket 86ca22e5r):
 *   The source-tree package.json `version` is permanently "0.0.1". When a dev
 *   rebuilds + repackages + `code --install-extension <vsix> --force` with the
 *   SAME version string, VS Code can serve cached bits from the prior install
 *   instead of the freshly-built ones — so the dashboard previews an OLD build.
 *   The sponsor hit this 2-3× while iterating on the idle_stretch pingpong
 *   animation (the shipped code at PR #151 was correct; only the cache collided).
 *
 * Approach (AC1 + AC3):
 *   - Compute a unique dev version `<base>-dev.<timestamp>` where <base> is the
 *     source package.json version and <timestamp> is `Date.now()`. A timestamp
 *     (not `git rev-list --count`) is the uniqueness source on purpose: two
 *     consecutive packages with NO new commit must still differ (AC1), and the
 *     commit count is identical across them. Millisecond timestamps differ
 *     between any two runs.
 *   - `<base>-dev.<n>` is a valid semver PRERELEASE that vsce accepts, and it
 *     sorts BELOW the eventual real `<base>` release — so it never shadows a
 *     Marketplace publish (OOS, but kept safe).
 *   - The bumped version is written to package.json ONLY for the duration of the
 *     `vsce package` call, then the original file bytes are restored in a
 *     `finally` block. The source tree is byte-identical before and after, so
 *     `git status` shows no churn (AC3) even if packaging throws.
 *
 * Usage:
 *   npm run dev:package          # build + package with a fresh dev version
 *   node scripts/dev-package.mjs # same
 *
 * The emitted .vsix is `claudeteam-<base>-dev.<timestamp>.vsix`. Install with:
 *   code --install-extension claudeteam-<base>-dev.<timestamp>.vsix --force
 * (The dev:install npm script resolves the newest dev .vsix automatically — see
 *  README "Dev install loop".)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { computeDevVersion } from "./devVersion.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(repoRoot, "package.json");

function main() {
  // 1. Build the bundles (esbuild). vsce does NOT build; it only packages dist/.
  const build = spawnSync(process.execPath, ["esbuild.config.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new Error("[dev-package] build failed; aborting before package");
  }

  // 2. Read + preserve the EXACT original bytes (so restore is byte-identical).
  const originalBytes = readFileSync(pkgPath);
  const pkg = JSON.parse(originalBytes.toString("utf8"));
  const devVersion = computeDevVersion(pkg.version);

  try {
    // 3. Write the bumped manifest, preserving 2-space indent + trailing newline
    //    to match the repo's formatting (kept tidy in case of an aborted run).
    const bumped = { ...pkg, version: devVersion };
    writeFileSync(pkgPath, JSON.stringify(bumped, null, 2) + "\n");

    // 4. Package. vsce reads version from package.json on disk → unique .vsix.
    //    Invoke via `npx vsce` (resolves the local bin cross-platform; same
    //    invocation the dogfood docs already use). `shell: true` lets Windows
    //    resolve the `npx.cmd` shim.
    console.log(`[dev-package] packaging version ${devVersion}`);
    const pack = spawnSync("npx", ["vsce", "package", "--no-yarn"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
    });
    if (pack.status !== 0) {
      throw new Error("[dev-package] vsce package failed");
    }
    console.log(
      `[dev-package] done → claudeteam-${devVersion}.vsix (source package.json restored)`,
    );
  } finally {
    // 5. ALWAYS restore the original bytes — keeps `git status` clean (AC3)
    //    whether packaging succeeded or threw.
    writeFileSync(pkgPath, originalBytes);
  }
}

// Only run main() when executed directly (not when imported by the unit test).
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main();
}
