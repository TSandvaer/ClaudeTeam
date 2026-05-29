/**
 * Unit tests for the RemovedMemberKey helpers in src/shared/types.ts
 * (E-07a / EPIC 86ca11187 §7.3).
 *
 *   - removedMemberKey joins (teamId, memberId) with ':'.
 *   - parseRemovedMemberKey round-trips + splits on the FIRST ':' only.
 *   - parseRemovedMemberKey returns null on a malformed (separator-less) key.
 *
 * Source: src/shared/types.ts
 */

import { describe, it, expect } from "vitest";

import {
  removedMemberKey,
  parseRemovedMemberKey,
} from "../../src/shared/types.js";

describe("removedMemberKey / parseRemovedMemberKey", () => {
  it("joins teamId + memberId with a colon", () => {
    expect(removedMemberKey("claudeteam-alpha", "felix")).toBe(
      "claudeteam-alpha:felix",
    );
  });

  it("round-trips a kebab-case pair", () => {
    const key = removedMemberKey("claudeteam-alpha", "felix");
    expect(parseRemovedMemberKey(key)).toEqual({
      teamId: "claudeteam-alpha",
      memberId: "felix",
    });
  });

  it("splits on the FIRST colon only", () => {
    expect(parseRemovedMemberKey("team-a:weird:member")).toEqual({
      teamId: "team-a",
      memberId: "weird:member",
    });
  });

  it("returns null for a malformed key with no separator", () => {
    expect(parseRemovedMemberKey("no-separator-here")).toBeNull();
  });
});
