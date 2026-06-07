/**
 * Unit coverage for the dev-watch pure helpers (ticket 86ca5eqy3).
 *
 * The watcher's correctness rests on two pure decisions, both tested here:
 *   1. createDebouncer — a burst of fs.watch events must collapse into ONE
 *      pipeline run, fired only after the quiet window elapses.
 *   2. isWatchedFile  — only animations.json / pose-defaults.json trigger a
 *      rebuild; PNG frames, rotations, and swap files are ignored.
 *
 * The fs.watch wiring + subprocess spawning lives in dev-watch.mjs (I/O shell);
 * it is integration-tested manually via the Self-Test Report (a real save →
 * rebuild → reload) since spawning vsce/code in a unit test is out of scope.
 *
 * Non-vacuity:
 *   - The debounce coalescing test asserts fn fires ONCE for three triggers; if
 *     the debouncer were removed (fire-per-event), it would fire 3×.
 *   - The trailing-edge test asserts fn has NOT fired before the window elapses;
 *     a leading-edge or no-op implementation fails it.
 *   - isWatchedFile tests assert BOTH positive (the two real files) and negative
 *     (PNG, rotation, swap) — flipping the predicate fails them.
 */
import { describe, it, expect, vi } from "vitest";

import { createDebouncer, isWatchedFile } from "../../scripts/devWatch.mjs";

describe("createDebouncer", () => {
  it("coalesces a burst of triggers into a single run after the window", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = createDebouncer(fn, 400);

      d.trigger("a");
      d.trigger("b");
      d.trigger("c");

      // Mid-burst: nothing has fired yet.
      vi.advanceTimersByTime(399);
      expect(fn).not.toHaveBeenCalled();

      // Quiet window elapses → exactly one run, with the LAST args.
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("c");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is trailing-edge: each trigger resets the timer", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = createDebouncer(fn, 400);

      d.trigger();
      vi.advanceTimersByTime(300);
      d.trigger(); // resets the 400ms window
      vi.advanceTimersByTime(300);
      // 600ms total elapsed, but only 300ms since the last trigger → no fire yet.
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100); // now 400ms since last trigger
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancel() prevents a pending run from firing (clean Ctrl-C path)", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = createDebouncer(fn, 400);

      d.trigger();
      expect(d.pending()).toBe(true);
      d.cancel();
      expect(d.pending()).toBe(false);

      vi.advanceTimersByTime(1000);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a second burst after a run fires again", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const d = createDebouncer(fn, 400);

      d.trigger();
      vi.advanceTimersByTime(400);
      expect(fn).toHaveBeenCalledTimes(1);

      d.trigger();
      vi.advanceTimersByTime(400);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isWatchedFile", () => {
  it("matches a per-character animations.json (win32 backslash path)", () => {
    expect(
      isWatchedFile("ClaudeTeam-M01-Dev\\animations.json"),
    ).toBe(true);
  });

  it("matches a per-character animations.json (posix path)", () => {
    expect(isWatchedFile("ClaudeTeam-F02-Dev/animations.json")).toBe(true);
  });

  it("matches the repo-root pose-defaults.json", () => {
    expect(isWatchedFile("pose-defaults.json")).toBe(true);
    expect(isWatchedFile("assets/sprites/pose-defaults.json")).toBe(true);
  });

  it("ignores PNG frames", () => {
    expect(
      isWatchedFile("ClaudeTeam-M01-Dev/idle/frame_000.png"),
    ).toBe(false);
  });

  it("ignores _pixellab_anims rotations + arbitrary json that is not the two", () => {
    expect(
      isWatchedFile("ClaudeTeam-M01-Dev/_pixellab_anims/rotations.json"),
    ).toBe(false);
    expect(isWatchedFile("ClaudeTeam-M01-Dev/manifest.json")).toBe(false);
  });

  it("ignores editor swap / temp files", () => {
    expect(isWatchedFile("animations.json.swp")).toBe(false);
    expect(isWatchedFile(".animations.json.tmp")).toBe(false);
  });

  it("returns false for null/undefined/empty (filename can be null on some platforms)", () => {
    expect(isWatchedFile(null)).toBe(false);
    expect(isWatchedFile(undefined)).toBe(false);
    expect(isWatchedFile("")).toBe(false);
  });
});
