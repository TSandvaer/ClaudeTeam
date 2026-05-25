/**
 * M4-04 cadence measurement harness.
 *
 * Runs `runTick` against the live `~/.claude/` directory N times back-to-back
 * (or at the configured cadence), measures wall-clock duration via
 * `performance.now()`, and reports p50 / p95 / max + hash-skip rate.
 *
 * Usage:
 *   node out/scripts/measure-cadence.mjs [--iterations N] [--cadence-ms MS]
 *                                        [--label STRING]
 *
 * Default: 200 iterations, no inter-tick sleep (back-to-back to measure
 * `runTick` cost alone), label `default`. When `--cadence-ms` is supplied,
 * the harness sleeps between ticks to simulate the production poll cadence.
 *
 * Source: M4-04 dispatch brief 2026-05-25 (ClickUp 86c9ygck9).
 */

import { performance } from "node:perf_hooks";
import { homedir } from "node:os";
import { join } from "node:path";

import { runTick, hashState } from "../src/extension/watcher/watcherLoop.js";

interface CliArgs {
  iterations: number;
  cadenceMs: number;
  label: string;
  rosterPath: string;
  claudeHome: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  let iterations = 200;
  let cadenceMs = 0;
  let label = "default";
  let rosterPath = join(homedir(), ".claudeteam", "teams.yaml");
  let claudeHome = join(homedir(), ".claude");

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--iterations" && i + 1 < args.length) {
      iterations = Number.parseInt(args[++i]!, 10);
    } else if (a === "--cadence-ms" && i + 1 < args.length) {
      cadenceMs = Number.parseInt(args[++i]!, 10);
    } else if (a === "--label" && i + 1 < args.length) {
      label = args[++i]!;
    } else if (a === "--roster" && i + 1 < args.length) {
      rosterPath = args[++i]!;
    } else if (a === "--claude-home" && i + 1 < args.length) {
      claudeHome = args[++i]!;
    }
  }
  return { iterations, cadenceMs, label, rosterPath, claudeHome };
}

function percentile(sortedAsc: number[], pct: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor(sortedAsc.length * pct)),
  );
  return sortedAsc[idx]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const { iterations, cadenceMs, label, rosterPath, claudeHome } = args;

  process.stderr.write(
    `[measure-cadence] label=${label} iterations=${iterations} cadenceMs=${cadenceMs} ` +
      `claudeHome=${claudeHome} roster=${rosterPath}\n`,
  );

  // Warm-up: one tick to stabilize node-side caching (filesystem cold-read
  // dominates the first call). Discarded from stats.
  await runTick({ claudeHome, globalRosterPath: rosterPath });

  const durations: number[] = [];
  const hashes: string[] = [];
  let lastHash: string | null = null;
  let skipCount = 0;
  let sessionCount = 0;
  let agentCount = 0;

  const wallStart = performance.now();
  // Force a GC pre-loop so heapBefore is a stable baseline (requires --expose-gc).
  if (typeof global.gc === "function") global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const heapSamples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const state = await runTick({ claudeHome, globalRosterPath: rosterPath });
    const dur = performance.now() - start;
    durations.push(dur);

    const h = hashState(state);
    hashes.push(h);
    if (h === lastHash) skipCount++;
    lastHash = h;

    if (i === iterations - 1) {
      sessionCount = state.sessions.length;
      agentCount = state.sessions.reduce(
        (acc, s) =>
          acc +
          Array.from(s.rosterTiles.values()).reduce(
            (a, b) => a + b.length,
            0,
          ) +
          s.background.length,
        0,
      );
    }

    // Sample heap every 10 iterations for trend analysis (after the tick,
    // before the cadence sleep). When --expose-gc is active, force a GC
    // before sampling so we see the steady-state heap, not transient garbage.
    if (i % 10 === 9) {
      if (typeof global.gc === "function") global.gc();
      heapSamples.push(process.memoryUsage().heapUsed);
    }

    if (cadenceMs > 0 && i < iterations - 1) {
      const remaining = cadenceMs - dur;
      if (remaining > 0) await sleep(remaining);
    }
  }

  const wallElapsedMs = performance.now() - wallStart;
  if (typeof global.gc === "function") global.gc();
  const heapAfter = process.memoryUsage().heapUsed;

  const sorted = [...durations].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const max = sorted[sorted.length - 1] ?? Number.NaN;
  const min = sorted[0] ?? Number.NaN;
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const skipRate = skipCount / (iterations - 1); // skip computed N-1 pairs

  const report = {
    label,
    iterations,
    cadenceMs,
    claudeHome,
    sessionCount,
    agentCount,
    runTickMs: {
      min: round(min, 3),
      p50: round(p50, 3),
      p95: round(p95, 3),
      p99: round(p99, 3),
      max: round(max, 3),
      mean: round(mean, 3),
    },
    hashSkipRate: round(skipRate, 4),
    wallElapsedMs: round(wallElapsedMs, 1),
    heapBeforeMB: round(heapBefore / 1024 / 1024, 2),
    heapAfterMB: round(heapAfter / 1024 / 1024, 2),
    heapDeltaMB: round((heapAfter - heapBefore) / 1024 / 1024, 2),
    heapSamplesMB: heapSamples.map((s) => round(s / 1024 / 1024, 2)),
    gcAvailable: typeof global.gc === "function",
  };

  // Machine-readable line on stdout for easy parsing / aggregation.
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

function round(n: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

main().catch((err) => {
  process.stderr.write(`[measure-cadence] FATAL: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
