/**
 * Unit tests for the freshness formatter (M3-04 NIT #3 — finished-status
 * freshness timestamp). Verifies the Xs/Xm/Xh rollover thresholds and edge
 * cases the dispatch brief calls out (5s, 30s, 2m, 1h, 4h).
 *
 * Source: ClickUp 86c9ybtut AC1
 *         src/webview/freshness.ts
 */

import { describe, it, expect } from "vitest";
import { formatFreshness } from "../../../src/webview/freshness.js";

describe("formatFreshness", () => {
  // ----- Brief-mandated deltas -----------------------------------------------

  it("formats 5s as \"5s\"", () => {
    expect(formatFreshness(5_000)).toBe("5s");
  });

  it("formats 30s as \"30s\"", () => {
    expect(formatFreshness(30_000)).toBe("30s");
  });

  it("formats 2m as \"2m\"", () => {
    expect(formatFreshness(2 * 60_000)).toBe("2m");
  });

  it("formats 1h as \"1h\"", () => {
    expect(formatFreshness(60 * 60_000)).toBe("1h");
  });

  it("formats 4h as \"4h\"", () => {
    expect(formatFreshness(4 * 60 * 60_000)).toBe("4h");
  });

  // ----- Boundary behavior ---------------------------------------------------

  it("formats 0ms as \"0s\"", () => {
    expect(formatFreshness(0)).toBe("0s");
  });

  it("rounds sub-second values to the nearest second", () => {
    // 499 ms rounds down to 0s; 500ms rounds to 1s (half-up).
    expect(formatFreshness(499)).toBe("0s");
    expect(formatFreshness(500)).toBe("1s");
    expect(formatFreshness(1_499)).toBe("1s");
    expect(formatFreshness(1_500)).toBe("2s");
  });

  it("renders the last second before the minute rollover as \"Xs\"", () => {
    // 59.999s is still seconds; 60.000s flips to "1m".
    expect(formatFreshness(59_999)).toBe("60s"); // rounds to 60s, still under 60_000 ms threshold
    expect(formatFreshness(60_000)).toBe("1m");
  });

  it("floors minutes (no rounding up)", () => {
    // 119_999 ms (1m 59.999s) → "1m", not "2m".
    expect(formatFreshness(119_999)).toBe("1m");
    expect(formatFreshness(120_000)).toBe("2m");
  });

  it("renders the last minute before the hour rollover as \"Xm\"", () => {
    // 3_599_999 ms (59m 59.999s) → "59m"; 3_600_000 → "1h".
    expect(formatFreshness(3_599_999)).toBe("59m");
    expect(formatFreshness(3_600_000)).toBe("1h");
  });

  it("floors hours (no rounding up)", () => {
    // 7_199_999 ms (1h 59m 59.999s) → "1h", not "2h".
    expect(formatFreshness(7_199_999)).toBe("1h");
    expect(formatFreshness(7_200_000)).toBe("2h");
  });

  it("handles large hour values without overflow", () => {
    // 24h sanity check.
    expect(formatFreshness(24 * 60 * 60_000)).toBe("24h");
  });

  // ----- Defensive behavior --------------------------------------------------

  it("clamps negative inputs to \"0s\" (clock skew defense)", () => {
    // finishedAtMs > nowMs can happen across clock skew / NTP adjustment.
    // Surfacing "-3s" would alarm users; clamping is the gentler default.
    expect(formatFreshness(-1)).toBe("0s");
    expect(formatFreshness(-60_000)).toBe("0s");
    expect(formatFreshness(-3_600_000)).toBe("0s");
  });
});
