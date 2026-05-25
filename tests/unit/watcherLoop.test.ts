/**
 * Unit tests for watcherLoop pure exports (M4-04 cadence-tuning surface).
 *
 * The integration-side watcher behavior (filesystem mutation → emission)
 * lives in `tests/integration/watcherLoop.test.ts` — that file requires a
 * tempdir + real I/O. THIS file covers only the pure exports we want
 * locked-in as the cadence contract:
 *
 *   - `MIN_POLL_MS` exists and is a sensible floor.
 *   - `hashState` is deterministic + stable across identical inputs.
 *
 * Source: M4-04 dispatch brief (ClickUp 86c9ygck9) + measurement doc at
 * `team/felix-dev/m4-04-cadence-measurement.md`. The package.json default
 * (`claudeteam.pollIntervalMs`) is locked at 2000ms; the integration suite
 * already covers tick-rate behavior end-to-end.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  MIN_POLL_MS,
  hashState,
} from "../../src/extension/watcher/watcherLoop.js";
import type { DashboardState } from "../../src/shared/types.js";

describe("M4-04: watcherLoop cadence contract — MIN_POLL_MS floor", () => {
  it("MIN_POLL_MS is a positive integer (sanity)", () => {
    expect(Number.isInteger(MIN_POLL_MS)).toBe(true);
    expect(MIN_POLL_MS).toBeGreaterThan(0);
  });

  it("MIN_POLL_MS is ≤ the package.json default poll interval (no clamp surprise)", () => {
    // The clamp must never exceed the shipped default — otherwise a user
    // reading package.json's `default: 2000` would be silently overridden
    // by the floor. Read package.json directly for source-of-truth.
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      contributes: {
        configuration: {
          properties: { "claudeteam.pollIntervalMs": { default: number } };
        };
      };
    };
    const def = pkg.contributes.configuration.properties[
      "claudeteam.pollIntervalMs"
    ].default;
    expect(typeof def).toBe("number");
    expect(MIN_POLL_MS).toBeLessThanOrEqual(def);
  });

  it("MIN_POLL_MS is ≥ 250ms (debounce floor sanity)", () => {
    // 250ms is the documented debounce floor — see watcherLoop.ts comment.
    // Going below would race the FS-watcher's coalesced event delivery.
    expect(MIN_POLL_MS).toBeGreaterThanOrEqual(250);
  });
});

describe("M4-04: hashState is stable across identical inputs", () => {
  const emptyState: DashboardState = {
    sessions: [],
    filterApplied: false,
    rosterErrors: [],
    rosterWarnings: [],
  };

  it("equal-shape states produce equal hashes", () => {
    const a = hashState(emptyState);
    const b = hashState({ ...emptyState });
    expect(a).toEqual(b);
  });

  it("filterApplied flip changes the hash (M3-03 invariant)", () => {
    const a = hashState({ ...emptyState, filterApplied: false });
    const b = hashState({ ...emptyState, filterApplied: true });
    expect(a).not.toEqual(b);
  });

  it("rosterErrors addition changes the hash (M3-04 invariant)", () => {
    const a = hashState({ ...emptyState, rosterErrors: [] });
    const b = hashState({
      ...emptyState,
      rosterErrors: ["roster: malformed YAML"],
    });
    expect(a).not.toEqual(b);
  });
});
