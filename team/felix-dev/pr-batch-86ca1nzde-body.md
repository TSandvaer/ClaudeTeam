## Summary

Batch of 3 small host/gen/reducer/test tickets in the same area.

| Ticket | What | Commits/coverage |
|---|---|---|
| `86ca1nzde` | Stamp `tile.character = matchedMember.character` in the reducer (single-agent, baseline, and multi-agent wrapper paths) | `src/extension/state/reducer.ts`; `tests/unit/reducer.test.ts` describe "character projection (86ca1nzde)" (8 tests) |
| `86ca1nvae` | Auto-resolve `Member.role` from the agent `.md` frontmatter `description` at scan/gen | `src/extension/roster/agentScanner.ts`, `claudeTeamConfig.ts`, `setupController.ts`, `src/shared/types.ts`; `tests/unit/teamSetupHost.test.ts` (deriveRoleFromDescription + gen-seeding), `tests/integration/teamSetupFs.test.ts` (scan-derive + edit/delete round-trip) |
| `86ca1nmcz` | Make `mainReplay.test.ts` hermetic by mocking `node:os` `homedir()` → tempExt | `tests/integration/mainReplay.test.ts` |

## 86ca1nzde — stamp tile.character

#136 persisted `Member.character` in the yaml but never stamped `tile.character`, so the webview's `spriteForMember` fell back to the gender binding for every per-member sprite.

- Live single-agent tile (`reducer.ts` ~232 block): stamp `character` when `member.character` is a **non-empty string**.
- Baseline (never-run) tile (~311 block): same stamp — character is independent of liveness, so a never-run member renders its sprite (mirrors how `memberColor` is stamped on baselines).
- Multi-agent `MultiAgentPersonaTile` wrapper (`groupTilesByPersona` ~603 + `rebuildMultiAgentTileFromInstances` ~656): mirror the character onto the wrapper from `identity.character` (one sprite per persona regardless of N). Added `"character"` to the `rebuildMultiAgentTileFromInstances` identity `Pick`.

**`null`/`undefined`/`""` semantics:** the type doc distinguishes `undefined` (→ fall back to gender binding) from `null` (→ explicit text tile). The AC says "unset/empty → existing gender-fall-back preserved", so all three (`null`, `undefined`, `""`) are collapsed to "omit the field → fall-back". `tile.character` is therefore only ever a real CharacterSource id on the wire, never `null`. This matches the legacy roster (never sets the field) and the team-setup config (seeds `null`).

## 86ca1nvae — auto-resolve Member.role from the agent .md

Currently gen seeds `role: ""`. Personas lead their `.md` frontmatter `description` with the role ("Senior Developer #1 ...", "QA / Tester ...", "UX Designer ...", "Project Lead ..."). New behavior:

- `ScannedAgent` now carries optional `role?` (the type-contract test in `teamSetupSchema.test.ts` updated to include it — this is the field the ticket anticipates).
- `deriveRoleFromDescription(description)` — pure helper. Takes the first clause: the substring up to the earliest of `" on the "`, `" on "`, `" ("`, `" — "`, `"—"`, `". "`, `"; "`, `", "`, `": "`; trims; caps at 60 chars defensively. `undefined`/`""`/whitespace → `""`.
- `readAgentDescription(filePath)` — lightweight frontmatter line-scan for the single-line `description:` value (strips one layer of surrounding quotes). Never throws — a read error/missing frontmatter yields `undefined`.
- `scanAgentsFolder` stamps `role` on each `ScannedAgent` (omitted when derivation is empty).
- `generateStarterConfig(included, teamName, roles?)` — new optional `roles: ReadonlyMap<agentName, role>` param. Seeds `role` from the lookup when non-empty; else keeps the lean `""` default. Back-compat: omitting the arg keeps the old empty-role behavior.
- `setupController.runSetup` builds the lookup from `this.scan()`.

**Empty role still validates:** unchanged — `claudeTeamConfigSchema` already uses `role: z.string().default("")`. The "user edit + delete (→ "")" persistence is covered by the existing `serializeConfig` (`role: m.role ?? ""`) + a new round-trip integration test.

This SUPERSEDES the old "fresh scan = role blank" lock (sponsor amendment, DECISIONS.md).

## 86ca1nmcz — hermetic mainReplay.test.ts

**Root cause (Bram-verified, confirmed locally):** `activate()` builds `claudeHome = join(homedir(), ".claude")` (`src/extension/main.ts:197`) from the REAL `homedir()`, NOT from `tempExt`. The design-intent comment ("tempExt has no ~/.claude/sessions/, so listSessions returns []") was false under the current code — the watcher reads the real `~/.claude/sessions/`. On this box (5 live session files in `C:\Users\538252\.claude\sessions\`) the first async tick reads real data and can exceed the 50ms settle window → intermittent false failure.

**Empirical proof of root cause + fix (run locally):** a throwaway probe test exercising `activate()` WITHOUT the `node:os` mock observed `state:full count: 1, sessions: 5` — i.e. 5 real live sessions leaked into the replayed payload. WITH the mock, the payload has `sessions: 0`.

**Fix:** mock `node:os` so `homedir()` returns `tempExt` (preserving real `tmpdir` via `...actual`); set `homedirHolder.value = tempExt` in `beforeEach`. The watcher's first tick then reads an empty `~/.claude/sessions/` deterministically. Added a non-vacuous hermeticity guard: `expect(payload.sessions).toHaveLength(0)` (this assertion would intermittently fail before the fix).

## Verification (local, this machine)

- `npm run typecheck` — clean (`tsc --noEmit`, exit 0).
- `npm run lint` — clean (`eslint .`).
- `npm run test:unit` — 1070 passed, 2 skipped (52 files).
- `npm run test:integration` — 137 passed (11 files), including `mainReplay.test.ts` 3/3.
- `mainReplay.test.ts` post-fix: 246ms (vs 496ms pre-fix — consistent with no longer reading the real machine's live sessions).

## Non-obvious findings (maintain-docs input)

1. `mainReplay.test.ts` (and any test driving `activate()`) reads the REAL `~/.claude` via unmocked `homedir()` — integration tests that build a tempExt for "extension state" do NOT isolate the watcher's session-source unless `node:os.homedir()` is also mocked. The tempExt only backs `context.extensionUri`, not `claudeHome`. Mock `node:os` (preserving `tmpdir`) + a module-level mutable holder set in `beforeEach` is the pattern (factory hoisting forbids capturing the per-test `tempExt` directly).
2. `tile.character` carries `null`-vs-`undefined` semantics on the type (`null` = text tile, `undefined` = gender fall-back), but the reducer only ever emits a real id or omits the field — the webview's "fall back to gender binding" path therefore fires on BOTH legacy rosters (no field) and team-setup members seeded with `character: null`.

## Gate notes

- Webview-smoke: this PR is host-side only (reducer/gen/scanner/test). The tile.character change is consumed by Maya's webview `spriteForMember`; data-plane smoke is the unit/integration coverage (live `state:full` payload now carries `character`). No webview rendering code changed here.
- Extension-manifest: no `package.json` touch.
