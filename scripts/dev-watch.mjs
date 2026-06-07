/**
 * Dev watch loop — watches the sprite-authoring source for changes and re-runs
 * the existing dev pipeline (dev-package.mjs → dev-install.mjs) so a tuned
 * animation is rebaked + repackaged + reinstalled without manually re-running
 * `npm run dev:install` each time (ticket 86ca5eqy3).
 *
 * Watches (recursive, win32-safe Node built-in fs.watch — NO new dependency):
 *   - assets/sprites/<char>/animations.json   (per-character playback values)
 *   - assets/sprites/pose-defaults.json       (repo-root pose-default table)
 * Both feed the baked GENERATED_SPRITE_MANIFEST via build-sprite-manifest.mjs,
 * so a change to either must rebuild. Other files under the tree (PNG frames,
 * _pixellab_anims rotations, swap files) are ignored by isWatchedFile.
 *
 * Behavior:
 *   - Debounce ~400ms (createDebouncer) so a multi-write save / editor
 *     atomic-replace burst collapses into ONE pipeline run.
 *   - On settle, spawn `node scripts/dev-package.mjs` then, on success,
 *     `node scripts/dev-install.mjs` — the SAME steps `npm run dev:install`
 *     runs, reused as subprocesses (each script has a direct-run guard).
 *   - Log "[dev-watch] rebuilt + reinstalled <file> — reload VS Code" on
 *     success. The watcher CANNOT auto-reload the VS Code window — the dev must
 *     run "Developer: Reload Window" to pick up the fresh install (logged).
 *   - Catch transient ENOENT from a file vanishing mid-save and continue.
 *   - Clean Ctrl-C (SIGINT) exit: close the watcher, cancel any pending run.
 *
 * Usage:
 *   npm run dev:watch
 *   node scripts/dev-watch.mjs
 */

import { watch } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createDebouncer, isWatchedFile } from "./devWatch.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const watchRoot = join(repoRoot, "assets", "sprites");

const DEBOUNCE_MS = 400;

/**
 * Run one pipeline pass: dev-package then dev-install, as subprocesses. Returns
 * true on full success. Any non-zero exit aborts the pass (does not throw — the
 * watcher must stay alive for the next change).
 *
 * @param {string} changedLabel a short label for the change that triggered this
 */
function runPipeline(changedLabel) {
  console.log(`[dev-watch] change detected (${changedLabel}) — rebuilding…`);

  const pkg = spawnSync(process.execPath, ["scripts/dev-package.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (pkg.status !== 0) {
    console.error(
      `[dev-watch] dev-package failed (exit ${pkg.status ?? "?"}) — skipping install; watcher still running`,
    );
    return false;
  }

  const install = spawnSync(process.execPath, ["scripts/dev-install.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (install.status !== 0) {
    console.error(
      `[dev-watch] dev-install failed (exit ${install.status ?? "?"}) — watcher still running`,
    );
    return false;
  }

  console.log(
    `[dev-watch] rebuilt + reinstalled ${changedLabel} — reload VS Code (Developer: Reload Window) to pick up the new build`,
  );
  return true;
}

function main() {
  // The pure decision (debounce window) is shared with the unit test; here we
  // only wire it to the real fs.watch + pipeline.
  const debouncer = createDebouncer((label) => {
    try {
      runPipeline(label);
    } catch (err) {
      // Defensive: a thrown pipeline error must not kill the watcher.
      console.error(
        `[dev-watch] pipeline threw — watcher still running:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }, DEBOUNCE_MS);

  let watcher;
  try {
    watcher = watch(
      watchRoot,
      { recursive: true },
      (_eventType, filename) => {
        // filename can be null on some platforms / event types; when null we
        // cannot tell what changed, so conservatively trigger a rebuild.
        if (filename !== null && !isWatchedFile(filename)) {
          return; // noise (PNG frame, rotation, swap file) — ignore
        }
        const label =
          filename !== null
            ? String(filename).replace(/\\/g, "/")
            : "sprite tree";
        debouncer.trigger(label);
      },
    );
  } catch (err) {
    // ENOENT here means assets/sprites doesn't exist — a hard setup error, not
    // the transient mid-save vanish we tolerate below. Fail loud.
    console.error(
      `[dev-watch] cannot watch ${watchRoot}:`,
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
    return;
  }

  // A file vanishing mid-save surfaces as an ENOENT 'error' event on the
  // watcher; log + continue rather than crash (AC1: tolerate transient ENOENT).
  watcher.on("error", (err) => {
    if (err && err.code === "ENOENT") {
      console.warn(
        `[dev-watch] transient ENOENT (file vanished mid-save) — continuing`,
      );
      return;
    }
    console.error(
      `[dev-watch] watcher error — continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  });

  console.log(
    `[dev-watch] watching ${watchRoot} (animations.json + pose-defaults.json) — Ctrl-C to stop`,
  );
  console.log(
    `[dev-watch] note: cannot auto-reload the VS Code window; reload manually after each rebuild`,
  );

  // Clean Ctrl-C exit: cancel any queued run, close the watcher, exit 0.
  const shutdown = () => {
    console.log(`\n[dev-watch] shutting down…`);
    debouncer.cancel();
    watcher.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only run main() when executed directly (not when imported by a test).
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main();
}
