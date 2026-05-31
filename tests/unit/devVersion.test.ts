/**
 * Unit coverage for the dev-package version stamp (ticket 86ca22e5r).
 *
 * The load-bearing property is AC1: two consecutive `npm run dev:package`
 * runs must yield DIFFERENT version strings so VS Code never cache-collides on
 * a repeated `code --install-extension --force`. `computeDevVersion` is the
 * pure function behind that property — these tests pin it.
 *
 * Non-vacuity: the AC1 test passes two DIFFERENT `now` values and asserts
 * inequality. If `computeDevVersion` dropped the timestamp (the bug this whole
 * ticket fixes — a constant version), that test fails.
 */
import { describe, it, expect } from "vitest";

import { computeDevVersion } from "../../scripts/devVersion.mjs";

// Real semver prerelease validator (the exact shape we emit:
// MAJOR.MINOR.PATCH-dev.<digits>). Anchored so trailing junk fails.
const SEMVER_DEV = /^\d+\.\d+\.\d+-dev\.\d+$/;

describe("computeDevVersion", () => {
  it("preserves the base version and appends a -dev.<timestamp> prerelease", () => {
    expect(computeDevVersion("0.0.1", 1717000000000)).toBe(
      "0.0.1-dev.1717000000000",
    );
    expect(computeDevVersion("1.2.3", 42)).toBe("1.2.3-dev.42");
  });

  it("emits a valid semver prerelease string vsce accepts", () => {
    expect(computeDevVersion("0.0.1", Date.now())).toMatch(SEMVER_DEV);
  });

  it("AC1: two consecutive builds at different timestamps differ", () => {
    const first = computeDevVersion("0.0.1", 1717000000000);
    const second = computeDevVersion("0.0.1", 1717000000001);
    expect(first).not.toBe(second);
  });

  it("strips a pre-existing prerelease so the -dev tag never nests", () => {
    // Defense-in-depth: running against an already-dev version must not produce
    // "0.0.1-dev.1-dev.2".
    expect(computeDevVersion("0.0.1-dev.111", 222)).toBe("0.0.1-dev.222");
  });

  it("the dev prerelease sorts below the plain base release (Marketplace-safe)", () => {
    // A prerelease is always ordered before its release in semver, so a
    // published 0.0.1 would supersede any 0.0.1-dev.<n>. Assert the textual
    // invariant the ordering relies on: the dev string starts with "<base>-".
    const dev = computeDevVersion("0.0.1", 1717000000000);
    expect(dev.startsWith("0.0.1-")).toBe(true);
  });
});
