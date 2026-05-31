/**
 * Dev install helper — resolves the newest `claudeteam-*-dev.*.vsix` in the
 * repo root and installs it via `code --install-extension <vsix> --force`.
 *
 * Pairs with scripts/dev-package.mjs (ticket 86ca22e5r). Because each package
 * run emits a uniquely-versioned .vsix (`claudeteam-0.0.1-dev.<timestamp>.vsix`),
 * this picks the most recent one by the embedded timestamp so a stale .vsix is
 * never installed by accident.
 *
 * Usage:
 *   npm run dev:install   # package (fresh version) THEN install the newest
 *   node scripts/dev-install.mjs   # install only (assumes a dev .vsix exists)
 */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Match claudeteam-<base>-dev.<timestamp>.vsix and sort by the timestamp.
const DEV_VSIX = /^claudeteam-.*-dev\.(\d+)\.vsix$/;

function newestDevVsix() {
  const candidates = readdirSync(repoRoot)
    .map((name) => {
      const m = DEV_VSIX.exec(name);
      return m ? { name, ts: Number(m[1]) } : null;
    })
    .filter((x) => x !== null)
    .sort((a, b) => b.ts - a.ts);
  return candidates.length > 0 ? candidates[0].name : null;
}

const vsix = newestDevVsix();
if (!vsix) {
  console.error(
    "[dev-install] no claudeteam-*-dev.*.vsix found — run `npm run dev:package` first",
  );
  process.exit(1);
}

console.log(`[dev-install] installing ${vsix}`);
const res = spawnSync(
  "code",
  ["--install-extension", join(repoRoot, vsix), "--force"],
  { cwd: repoRoot, stdio: "inherit", shell: true },
);
process.exit(res.status ?? 1);
