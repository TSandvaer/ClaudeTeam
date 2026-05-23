import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  __ENGINE_TYPES_FOR_TEST,
  detectSchemaVersion,
  parseMeta,
  parseMetaFromString,
} from "../../src/extension/watcher/metaJsonLoader";
import { MetaParseError } from "../../src/shared/types";

const FIXTURES_DIR = join(__dirname, "..", "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("parseMeta — schema variant 1: v2.1.119 (old)", () => {
  it("parses the synthesized v2.1.119 fixture and tags schemaVersion=v2.1.119", () => {
    const raw = readFixture("meta-old-schema.json");
    const meta = parseMetaFromString(raw);

    expect(meta.schemaVersion).toBe("v2.1.119");
    expect(meta.agentType).toBe("devon");
    expect(meta.description).toBe("Devon reviews Kevin's PR #2");
    expect(meta.name).toBeNull();
    expect(meta.toolUseId).toBeNull();
  });

  it("treats `agentType: <persona-slug>` + absent toolUseId as v2.1.119 even when name is omitted", () => {
    const meta = parseMeta({
      agentType: "kevin",
      description: "Kevin pairs with Devon",
    });

    expect(meta.schemaVersion).toBe("v2.1.119");
    expect(meta.name).toBeNull();
    expect(meta.toolUseId).toBeNull();
  });
});

describe("parseMeta — schema variant 2: v2.1.145 general-purpose", () => {
  it("parses the real-capture v2.1.145-general fixture and tags schemaVersion=v2.1.145-general", () => {
    const raw = readFixture("meta-new-schema.json");
    const meta = parseMetaFromString(raw);

    expect(meta.schemaVersion).toBe("v2.1.145-general");
    expect(meta.agentType).toBe("general-purpose");
    expect(meta.description).toBe("Agent B: limitations & edge cases");
    expect(meta.name).toBeNull();
    expect(meta.toolUseId).toBe("toolu_01DSwxyg6yrTCn8nxkVwoXqt");
  });

  it("treats `agentType: Explore` + toolUseId present as v2.1.145-general", () => {
    const meta = parseMeta({
      agentType: "Explore",
      description: "Map MARIAN-TUTOR orchestration",
      name: null,
      toolUseId: "toolu_TEST_EXPLORE",
    });

    expect(meta.schemaVersion).toBe("v2.1.145-general");
    expect(meta.agentType).toBe("Explore");
    expect(meta.toolUseId).toBe("toolu_TEST_EXPLORE");
    expect(meta.name).toBeNull();
  });

  it("preserves a populated `name` string when one is present (rare but allowed)", () => {
    const meta = parseMeta({
      agentType: "general-purpose",
      description: "Hypothetical name-populated spawn",
      name: "agent-b-edge-cases",
      toolUseId: "toolu_TEST_NAMED",
    });

    expect(meta.schemaVersion).toBe("v2.1.145-general");
    expect(meta.name).toBe("agent-b-edge-cases");
  });

  it("normalizes `name: undefined` (key absent) and `name: null` (key present) identically", () => {
    const absent = parseMeta({
      agentType: "general-purpose",
      description: "name key absent",
      toolUseId: "toolu_X",
    });
    const explicitNull = parseMeta({
      agentType: "general-purpose",
      description: "name key explicitly null",
      name: null,
      toolUseId: "toolu_X",
    });

    expect(absent.name).toBeNull();
    expect(explicitNull.name).toBeNull();
    expect(absent.schemaVersion).toBe(explicitNull.schemaVersion);
  });
});

describe("parseMeta — schema variant 3: v2.1.145 persona-named (previously undocumented)", () => {
  it("parses the persona-named fixture and tags schemaVersion=v2.1.145-persona", () => {
    const raw = readFixture("meta-new-schema-persona.json");
    const meta = parseMetaFromString(raw);

    expect(meta.schemaVersion).toBe("v2.1.145-persona");
    expect(meta.agentType).toBe("felix");
    expect(meta.description).toBe("Felix — M1-01 scaffold + CI");
    expect(meta.name).toBeNull();
    expect(meta.toolUseId).toBe("toolu_01SZsHqGceAQC4Loovg6ion1");
  });

  it("REGRESSION: agentType is a persona slug AND toolUseId is present — must NOT classify as v2.1.119", () => {
    // The bug class this guards: a parser that decides on `name` presence
    // alone (the older two-variant detection rule) would tag this as
    // v2.1.119 because `name` is absent. The correct rule keys on
    // `toolUseId` presence — see data-sources.md §4 lines 141-149.
    const meta = parseMeta({
      agentType: "bram",
      description: "Bram researches Claude Code internals",
      toolUseId: "toolu_PERSONA_VARIANT",
    });

    expect(meta.schemaVersion).toBe("v2.1.145-persona");
    expect(meta.schemaVersion).not.toBe("v2.1.119");
    expect(meta.agentType).toBe("bram");
  });

  it("matcher contract: agentType is preserved verbatim so `agentType_equals: \"felix\"` still hits", () => {
    // roster-matching.md says `agentType_equals` is the rule that matches
    // persona slugs for both variant 1 and variant 3. This test pins the
    // parser-side guarantee that `meta.agentType === "felix"` survives
    // normalization for variant 3.
    const meta = parseMeta({
      agentType: "felix",
      description: "Felix — M1-05 meta parser",
      toolUseId: "toolu_FELIX_M105",
    });

    expect(meta.agentType).toBe("felix");
    expect(meta.schemaVersion).toBe("v2.1.145-persona");
  });
});

describe("parseMeta — malformed and missing-field cases", () => {
  it("throws MetaParseError(not-object) on invalid JSON via parseMetaFromString", () => {
    expect(() => parseMetaFromString("{invalid")).toThrowError(MetaParseError);

    try {
      parseMetaFromString("{invalid");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("not-object");
      // Raw input preserved so the file-watcher can log it.
      expect((err as MetaParseError).raw).toBe("{invalid");
    }
  });

  it("throws MetaParseError(missing-agentType) when `agentType` is absent", () => {
    try {
      parseMeta({ description: "no agentType here" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("missing-agentType");
      expect((err as MetaParseError).raw).toEqual({
        description: "no agentType here",
      });
    }
  });

  it("throws MetaParseError(missing-agentType) when `agentType` is the wrong type", () => {
    try {
      parseMeta({ agentType: 42, description: "wrong type" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("missing-agentType");
    }
  });

  it("throws MetaParseError(missing-description) when `description` is absent", () => {
    try {
      parseMeta({ agentType: "felix" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("missing-description");
    }
  });

  it("throws MetaParseError(not-object) for null, arrays, strings, and numbers", () => {
    for (const bad of [null, [], "a string", 42, true] as const) {
      try {
        parseMeta(bad);
        throw new Error(`should have thrown for ${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(MetaParseError);
        expect((err as MetaParseError).reason).toBe("not-object");
      }
    }
  });

  it("throws MetaParseError(missing-agentType) on an empty object", () => {
    try {
      parseMeta({});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("missing-agentType");
    }
  });

  it("throws MetaParseError(invalid-field-type) when `toolUseId` is present but not a string", () => {
    try {
      parseMeta({
        agentType: "felix",
        description: "bad toolUseId",
        toolUseId: 123,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("invalid-field-type");
    }
  });

  it("throws MetaParseError(invalid-field-type) when `name` is present but not string/null", () => {
    try {
      parseMeta({
        agentType: "general-purpose",
        description: "bad name type",
        name: 123,
        toolUseId: "toolu_X",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MetaParseError);
      expect((err as MetaParseError).reason).toBe("invalid-field-type");
    }
  });
});

describe("parseMeta — forward-compat: unknown extra fields", () => {
  it("tolerates unknown top-level fields without crashing (forward-compat)", () => {
    // If Claude Code adds a new optional field tomorrow we should not
    // crash on existing-version meta.json files — we just ignore the
    // unknown key.
    const meta = parseMeta({
      agentType: "felix",
      description: "future-proof",
      toolUseId: "toolu_FUTURE",
      futureField: "ignore me",
      anotherFutureField: { nested: true },
    });

    expect(meta.schemaVersion).toBe("v2.1.145-persona");
    expect(meta.agentType).toBe("felix");
    // Unknown fields are stripped from the normalized output.
    expect(Object.keys(meta).sort()).toEqual([
      "agentType",
      "description",
      "name",
      "schemaVersion",
      "toolUseId",
    ]);
  });
});

describe("detectSchemaVersion — direct exercise of the rule", () => {
  it("returns v2.1.119 when toolUseId is null regardless of agentType", () => {
    expect(detectSchemaVersion("felix", null)).toBe("v2.1.119");
    expect(detectSchemaVersion("general-purpose", null)).toBe("v2.1.119");
    expect(detectSchemaVersion("Explore", null)).toBe("v2.1.119");
  });

  it("returns v2.1.145-general for known engine types when toolUseId is present", () => {
    expect(detectSchemaVersion("general-purpose", "toolu_x")).toBe(
      "v2.1.145-general",
    );
    expect(detectSchemaVersion("Explore", "toolu_x")).toBe("v2.1.145-general");
    expect(detectSchemaVersion("Plan", "toolu_x")).toBe("v2.1.145-general");
  });

  it("returns v2.1.145-persona for non-engine agentType when toolUseId is present", () => {
    expect(detectSchemaVersion("felix", "toolu_x")).toBe("v2.1.145-persona");
    expect(detectSchemaVersion("bram", "toolu_x")).toBe("v2.1.145-persona");
    expect(detectSchemaVersion("any-future-persona", "toolu_x")).toBe(
      "v2.1.145-persona",
    );
  });

  it("engine-type matching is case-sensitive (matches data-sources.md verbatim)", () => {
    // The docs use literal `general-purpose` and `Explore` (capital E).
    // A lowercase `explore` should NOT match — it would be treated as a
    // persona slug. Pinning this so a future "let's normalize case"
    // refactor surfaces the breakage.
    expect(detectSchemaVersion("explore", "toolu_x")).toBe(
      "v2.1.145-persona",
    );
    expect(detectSchemaVersion("General-Purpose", "toolu_x")).toBe(
      "v2.1.145-persona",
    );
  });
});

describe("engine-type allowlist", () => {
  it("matches the documented set in data-sources.md §4", () => {
    // If this assertion fails because a new engine type was observed on
    // disk, add it to the ENGINE_TYPES set in metaJsonLoader.ts and
    // update data-sources.md §4 in the same PR.
    expect([...__ENGINE_TYPES_FOR_TEST].sort()).toEqual([
      "Explore",
      "Plan",
      "general-purpose",
    ]);
  });
});
