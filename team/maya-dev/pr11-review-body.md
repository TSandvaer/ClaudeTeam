# Review — PR #11 (M1-05 meta.json parser, 3 variants)

**Verdict: APPROVE.**

Reviewer: Maya. PR head `felix/m1-05-meta-parser` @ `3110b41`. Reviewed against `team/nora-pl/milestone-1-backlog.md` §M1-05 and `.claude/docs/data-sources.md` §4.

## Local reproduction of Felix's claims

Ran in `c:/Trunk/PRIVATE/ClaudeTeam-maya-wt` on a fresh `gh pr` fetch of `refs/pull/11/head` (couldn't `gh pr checkout` because branch is live in Felix's worktree — used a local review branch).

| Claim | Reproduced |
|---|---|
| `npm run test -- metaJsonLoader` → 23 passed | ✅ 23/23 in 7ms |
| `npm run test` (full suite) → 67 passed across 3 files | ✅ 67/67 (matcher 28, metaJsonLoader 23, loader 16) |
| `npm run test -- matcher` → 28 passed after type widening | ✅ 28/28 in 4ms |
| `npm run typecheck` clean | ✅ exit 0 |
| `npm run lint` clean | ✅ exit 0 |

CI on the PR is also green (run `26332026432` — `typecheck + lint + unit` SUCCESS).

## AC walkthrough (M1-05 §AC1–AC7)

- **AC1 — `parseMeta(raw: unknown): AgentMeta` returns the normalized shape.** ✅ `src/extension/watcher/metaJsonLoader.ts:65`. Returns `{ schemaVersion, agentType, name, description, toolUseId }`.
- **AC2 — Schema detection follows the documented rule.** ✅ `detectSchemaVersion()` at `metaJsonLoader.ts:168`. Implements `data-sources.md` §4 lines 141-149 verbatim:
  - `toolUseId === null` → `v2.1.119` (line 172).
  - `toolUseId !== null` + agentType in ENGINE_TYPES → `v2.1.145-general` (line 175).
  - otherwise → `v2.1.145-persona` (line 178).
  Code comments cite `data-sources.md` (`metaJsonLoader.ts:16`).
- **AC3 — Malformed JSON + missing-required-field handling.** ✅ Every failure mode produces a typed `MetaParseError` with `raw` preserved on the error, never crashes. Covered: malformed JSON via `parseMetaFromString` (`metaJsonLoader.test.ts:145`), missing `agentType` (`:158`), missing `description` (`:181`), non-object input matrix (`:191`), empty object (`:203`), wrong-type optional fields (`:213`, `:227`).
- **AC4 — `AgentMeta` declared in `src/shared/types.ts`.** ✅ `src/shared/types.ts:42`. Schema-version widening from 2-tag to 3-tag union (`types.ts:29-32`) preserves M1-08's runtime behavior — matcher is `schemaVersion`-agnostic by design (`matcher.ts:14-20`). Re-ran all 28 matcher tests post-widening — green.
- **AC5 — Unit tests cover variants + edge cases.** ✅ 23 tests covering all three Bram variants + malformed + missing fields + `name: null` explicit + forward-compat + non-object inputs + direct `detectSchemaVersion` exercise + engine-type allowlist lock.
- **AC6 — Uses Bram's M1-02 fixtures + new persona fixture.** ✅ Reads `meta-old-schema.json` (`:20`), `meta-new-schema.json` (`:44`), and the new `meta-new-schema-persona.json` (`:101`). The new fixture is byte-identical to the data-sources.md §4 lines 127-132 example.
- **AC7 — `npm run test -- metaJsonLoader` passes.** ✅ 23/23 reproduced locally.

## Schema-drift correctness (Sage's cross-cutting "load-bearing" §)

Per Sage's test plan §"Schema-drift handling" — three variants must all parse without crash, all be reachable by the matcher, and a regression test named for the bug class must exist.

| Variant | Parsed | Matcher reaches | Regression-named |
|---|---|---|---|
| v2.1.119 | ✅ `:20` | ✅ matcher.test.ts:136 | n/a (well-understood) |
| v2.1.145-general | ✅ `:44` | ✅ matcher.test.ts:233 | n/a |
| v2.1.145-persona | ✅ `:101` | ✅ matcher.test.ts:241 | ✅ metaJsonLoader.test.ts:112 (`REGRESSION: agentType is a persona slug AND toolUseId is present — must NOT classify as v2.1.119`) |

The regression-test wording explicitly names the bug class — a future refactor that decides on `name` presence alone (the older 2-variant rule) would fail this test by name.

## Forward-compat angles called out in the brief

- **AgentMeta widening vs M1-08 matcher** — confirmed `matcher.ts:14-20` documents `schemaVersion`-agnostic by design. The widening is purely a diagnostic tag bump. Only matcher-test literals changed (`matcher.test.ts:140, 149, 227, 235, 244, 255`); no assertion logic moved.
- **Identity extraction for variant 3 (future M1-09)** — `meta.agentType` is preserved verbatim. Per `data-sources.md` §5 the resolver for variant 3 uses `agentType` directly as the persona slug. Tests at `metaJsonLoader.test.ts:128` (matcher contract) and `matcher.test.ts:241` pin this.
- **M1-06 tailer alignment** — M1-06 returns its own `SubagentActivity` shape (model + lastTool); doesn't reach into AgentMeta. No conflict.

## Non-blocking observations (drain-mode nits — APPROVE-as-is)

1. **`AgentMeta.name: string | null | undefined` triple-state.** Felix self-flagged this in finding #3 — kept for backward-compat with M1-08 matcher tests using `name: undefined`. Tightening to `string | null` is a one-PR follow-up and not blocking. The parser already normalizes to `null` at runtime — the broader interface type is only test-shaped.
2. **`Plan` engine-type pre-emptive include.** Felix added `"Plan"` to `ENGINE_TYPES` even though no `Plan` capture exists yet (finding #4). Reasonable defensive call; if `Plan` turns out NOT to be an engine type after observation, it's a 1-line edit + 1 test update. Not blocking.
3. **`describeRawType("a string")` returns `"string"`** — minor: the error message reads `received string` which is correct but a touch terse. Not worth a re-spin.

No webview surface touched in this PR, so no Self-Test Report applicable (per Sage's test plan §M1-05 — "pure parser, not UX-visible. CI test green is sufficient evidence").

APPROVE.
