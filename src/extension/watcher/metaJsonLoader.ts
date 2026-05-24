/**
 * meta.json parser. Pure function — no filesystem access lives here.
 *
 * Handles three on-disk schema variants documented in
 * `.claude/docs/data-sources.md` §4:
 *
 *   1. v2.1.119 (old)        — `agentType` is persona slug, no `name`,
 *                              no `toolUseId`.
 *   2. v2.1.145 general      — `agentType` is engine type string
 *                              (`general-purpose`, `Explore`), `toolUseId`
 *                              present, `name` absent or null.
 *   3. v2.1.145 persona      — `agentType` is persona slug, `toolUseId`
 *                              present, no `name`. Previously undocumented;
 *                              added to docs in PR #9 (Bram, 2026-05-23).
 *
 * Detection rule (data-sources.md §4 "Schema detection rule" lines 141-149,
 * feature-detect — do NOT rely on session version alone):
 *
 *   - `toolUseId` absent                                      → v2.1.119
 *   - `toolUseId` present AND `agentType` is known engine-type → v2.1.145-general
 *   - `toolUseId` present AND `agentType` is NOT engine-type   → v2.1.145-persona
 *
 * Engine-type allowlist comes from the observed values in data-sources.md
 * §4 ("New, May 2026" + variant summary table). `Plan` is documented as
 * possible but not yet observed; included pre-emptively so a future capture
 * of a `Plan` spawn classifies correctly. Anything outside this set is
 * treated as a persona slug.
 */

import type { AgentMeta, AgentMetaSchemaVersion } from "../../shared/types";
import { MetaParseError } from "../../shared/types";

/**
 * Human-readable error format helper (M3-04 NIT #2).
 *
 * Maps a {@link MetaParseError} to a consistent, dashboard-friendly string.
 * The chosen convention is `meta.json parse failed: <human phrase>` — full
 * sentences, no hybrid-case enum codes leaking through. Prior behavior used
 * `err.message` (terse) or the raw `reason` enum literal (hybrid-case, e.g.
 * `missing-agentType`); both surfaces are normalized through this helper.
 *
 * Convention (documented for future parser additions):
 *   - prefix is always `meta.json parse failed: `.
 *   - reason text uses lowercase words separated by spaces.
 *   - field names appear in single quotes (`'agentType'`).
 *
 * When a new {@link MetaParseError} reason is added, extend the switch below
 * AND update `tests/unit/metaJsonLoader.test.ts` to pin the new phrase.
 */
export function formatMetaParseError(err: MetaParseError): string {
  switch (err.reason) {
    case "not-object":
      return "meta.json parse failed: not a JSON object";
    case "missing-agentType":
      return "meta.json parse failed: missing field 'agentType'";
    case "missing-description":
      return "meta.json parse failed: missing field 'description'";
    case "invalid-field-type":
      return "meta.json parse failed: invalid field type";
  }
}

/**
 * Engine-type values for `agentType` in v2.1.145-general meta.json.
 *
 * Observed in real captures (data-sources.md §4):
 *   - `"general-purpose"` — every captured Agent/Task spawn whose `name`
 *     is set or null.
 *   - `"Explore"` — observed in Pixel Agents' tree (not in ClaudeTeam scope
 *     yet, documented in roster-matching.md background-noise example).
 *
 * Listed but not yet observed:
 *   - `"Plan"` — referenced in roster-matching.md "future rule types"; an
 *     observed spawn would land here.
 *
 * Case-sensitive match per the docs.
 */
const ENGINE_TYPES: ReadonlySet<string> = new Set([
  "general-purpose",
  "Explore",
  "Plan",
]);

/**
 * Parse a JSON-decoded meta.json value into a normalized `AgentMeta`.
 *
 * Caller passes the result of `JSON.parse` (or an already-parsed object).
 * For JSON-string input use `parseMetaFromString` below — it wraps the
 * parse step and converts SyntaxError to `MetaParseError`.
 *
 * @throws MetaParseError when the input is not a non-null object, when
 * `agentType` or `description` is missing or not a string, or when an
 * optional field is present but the wrong type.
 */
export function parseMeta(raw: unknown): AgentMeta {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MetaParseError(
      `meta.json must be a JSON object; received ${describeRawType(raw)}`,
      "not-object",
      raw,
    );
  }

  const obj = raw as Record<string, unknown>;

  // agentType — required, must be a string. Same field in all three variants.
  if (typeof obj["agentType"] !== "string") {
    throw new MetaParseError(
      "meta.json missing required string field `agentType`",
      "missing-agentType",
      raw,
    );
  }
  const agentType: string = obj["agentType"];

  // description — required, must be a string. Same field in all three variants.
  if (typeof obj["description"] !== "string") {
    throw new MetaParseError(
      "meta.json missing required string field `description`",
      "missing-description",
      raw,
    );
  }
  const description: string = obj["description"];

  // toolUseId — optional. Presence is the primary schema discriminator
  // (data-sources.md §4 detection rule step 1).
  const toolUseIdRaw = obj["toolUseId"];
  let toolUseId: string | null;
  if (toolUseIdRaw === undefined || toolUseIdRaw === null) {
    toolUseId = null;
  } else if (typeof toolUseIdRaw === "string") {
    toolUseId = toolUseIdRaw;
  } else {
    throw new MetaParseError(
      "meta.json `toolUseId` must be a string when present",
      "invalid-field-type",
      raw,
    );
  }

  // name — optional. Per data-sources.md §4 ("name is absent or explicitly
  // null in every real capture to date"), we normalize undefined and null
  // identically to `null`. A non-null string is preserved verbatim.
  const nameRaw = obj["name"];
  let name: string | null;
  if (nameRaw === undefined || nameRaw === null) {
    name = null;
  } else if (typeof nameRaw === "string") {
    name = nameRaw;
  } else {
    throw new MetaParseError(
      "meta.json `name` must be a string or null when present",
      "invalid-field-type",
      raw,
    );
  }

  const schemaVersion = detectSchemaVersion(agentType, toolUseId);

  return {
    schemaVersion,
    agentType,
    name,
    description,
    toolUseId,
  };
}

/**
 * Convenience wrapper: parse a raw JSON string from disk into `AgentMeta`.
 *
 * JSON syntax errors are converted to `MetaParseError(not-object, ...)` so
 * the caller has a single error type to catch.
 */
export function parseMetaFromString(jsonText: string): AgentMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new MetaParseError(
      `meta.json is not valid JSON: ${(err as Error).message}`,
      "not-object",
      jsonText,
    );
  }
  return parseMeta(parsed);
}

/**
 * Apply the data-sources.md §4 detection rule. Pure logic, exported for
 * unit-test direct exercise.
 *
 *   - `toolUseId === null`                            → v2.1.119
 *   - `toolUseId !== null` AND agentType is engine    → v2.1.145-general
 *   - `toolUseId !== null` AND agentType is persona    → v2.1.145-persona
 */
export function detectSchemaVersion(
  agentType: string,
  toolUseId: string | null,
): AgentMetaSchemaVersion {
  if (toolUseId === null) {
    return "v2.1.119";
  }
  if (ENGINE_TYPES.has(agentType)) {
    return "v2.1.145-general";
  }
  return "v2.1.145-persona";
}

/**
 * Test-only export of the engine-type allowlist.
 *
 * Marked `__` so unit tests can assert the set without intent to use it
 * from production code.
 */
export const __ENGINE_TYPES_FOR_TEST: ReadonlySet<string> = ENGINE_TYPES;

function describeRawType(raw: unknown): string {
  if (raw === null) return "null";
  if (Array.isArray(raw)) return "array";
  return typeof raw;
}
