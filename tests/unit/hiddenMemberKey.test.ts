/**
 * Unit tests for the HiddenMemberKey helpers in src/shared/types.ts
 * (E-06a / EPIC 86ca11187 §7.2).
 *
 *   - hiddenMemberKey joins (teamId, memberId) with ':'.
 *   - parseHiddenMemberKey round-trips.
 *   - parseHiddenMemberKey splits on the FIRST ':' only.
 *   - parseHiddenMemberKey returns null on a malformed (separator-less) key.
 *
 * Source: src/shared/types.ts
 */

import { describe, it, expect } from "vitest";

import {
  hiddenMemberKey,
  parseHiddenMemberKey,
} from "../../src/shared/types.js";

describe("hiddenMemberKey / parseHiddenMemberKey", () => {
  it("joins teamId + memberId with a colon", () => {
    expect(hiddenMemberKey("claudeteam-alpha", "felix")).toBe(
      "claudeteam-alpha:felix",
    );
  });

  it("round-trips a kebab-case pair", () => {
    const key = hiddenMemberKey("claudeteam-alpha", "felix");
    expect(parseHiddenMemberKey(key)).toEqual({
      teamId: "claudeteam-alpha",
      memberId: "felix",
    });
  });

  it("splits on the FIRST colon only (robust to a memberId containing ':')", () => {
    // Defensive: kebab ids never contain ':' today, but the split must be
    // first-colon so a future id convention with a ':' doesn't corrupt teamId.
    expect(parseHiddenMemberKey("team-a:weird:member")).toEqual({
      teamId: "team-a",
      memberId: "weird:member",
    });
  });

  it("returns null for a malformed key with no separator", () => {
    expect(parseHiddenMemberKey("no-separator-here")).toBeNull();
  });
});
