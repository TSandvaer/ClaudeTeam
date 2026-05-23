# M1 Backlog — Data Spike

Ten tickets. Output: `npm run agent-tree` prints the live agent tree from local files in `~/.claude/`. Validates parsers + roster matcher before any VS Code shell exists.

Each entry is dispatch-ready — the orchestrator can lift any ticket into a brief without further clarification from Nora.

ClickUp IDs are appended once the tickets are created in the board (list `901523520912`).

---

## M1-01 — `chore(repo): bootstrap TypeScript scaffold + CI` — [ClickUp 86c9y5c4g](https://app.clickup.com/t/86c9y5c4g)

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** M
**Priority:** P0 (blocking — everything downstream depends on this)
**Source:** V1-PLAN M1; `.claude/docs/vscode-extension-conventions.md` "Scaffold layout"

### Scope

Stand up the repo's build, test, and CI primitives so every subsequent ticket has a working foundation. NO extension code yet — just the scaffold.

### Acceptance criteria

- AC1: `package.json` exists at repo root with: `typescript`, `vitest`, `esbuild`, `@types/node`, ESLint, Prettier, `@vscode/vsce` as devDependencies; `engines.node >= 20` set.
- AC2: `tsconfig.json` configured for `ES2022` target, `strict: true`, `moduleResolution: "Bundler"`, output to `dist/`.
- AC3: `src/`, `tests/unit/`, `tests/integration/`, `tests/fixtures/` directories exist with a `.gitkeep` in each (so the layout is committed even when empty).
- AC4: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all work and exit 0 on the empty scaffold.
- AC5: `.github/workflows/ci.yml` runs `typecheck + lint + test:unit` on every push and PR targeting `main`. Green on this PR.
- AC6: `vsce --version` runs successfully (smoke check; confirms the toolchain is present for M2+).
- AC7: `.gitignore` covers `node_modules/`, `dist/`, `*.vsix`, OS artifacts.

### Out of scope (OOS)

- No extension manifest (no `contributes`, no `activationEvents`). Empty `package.json` `main` is fine.
- No webview build config. M2 work.
- No source files in `src/` beyond a placeholder if needed to make `tsc` happy.
- No integration-test runner setup (`@vscode/test-electron`). M2 work.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm install
npm run typecheck && npm run lint && npm run test && npm run build
vsce --version   # exits 0 with a version string
```

CI workflow shows green on the PR.

### Files in play

- Owned (Felix writes): `package.json`, `package-lock.json`, `tsconfig.json`, `.eslintrc.cjs` (or `eslint.config.js`), `.prettierrc`, `.github/workflows/ci.yml`, `.gitignore`, `src/.gitkeep`, `tests/unit/.gitkeep`, `tests/integration/.gitkeep`, `tests/fixtures/.gitkeep`, `vitest.config.ts`.
- Read-only references: `.claude/docs/vscode-extension-conventions.md`, `.claude/docs/testing-strategy.md`.

### Conflict rule

If `vsce --version` fails (toolchain missing), STOP and surface — do not work around it. Sponsor confirms vsce install path before M2.

---

## M1-02 — `research(fixtures): capture meta.json + JSONL + sessions samples` — [ClickUp 86c9y5c7v](https://app.clickup.com/t/86c9y5c7v)

**Owner:** Bram
**Peer reviewer:** orchestrator-direct (Bram's research PRs)
**Size:** M
**Priority:** P0 (blocking — Felix's parsers need real fixtures, not invented ones)
**Source:** V1-PLAN M1 schema-handling section; `.claude/docs/data-sources.md`

### Scope

Capture real, anonymized fixtures from a live `~/.claude/` tree for both schema versions. These become `tests/fixtures/` for every parser ticket downstream.

### Acceptance criteria

- AC1: `tests/fixtures/meta-old-schema.json` — captured from a v2.1.119 (or earlier) Claude Code session. Has `agentType` + `description`. No `name` field. Source path documented in the research note.
- AC2: `tests/fixtures/meta-new-schema.json` — captured from a v2.1.145+ session. Has `agentType: "general-purpose"`, `name`, `description`, `toolUseId`. Source path documented.
- AC3: `tests/fixtures/subagent-running.jsonl` — captured from a live subagent transcript. Contains at least one `type: "assistant"` record with a `tool_use` content entry (so Felix can extract activity). User text content is `<redacted>`. ~50 lines max.
- AC4: `tests/fixtures/subagent-finished.jsonl` — captured from a completed subagent. Contains the closing assistant message. User text content is `<redacted>`.
- AC5: `tests/fixtures/subagent-malformed.jsonl` — synthesized: one valid JSON line, one truncated line (no closing brace), one line with invalid JSON. Document the synthesis steps in the research note.
- AC6: `tests/fixtures/session-alive.json` — captured from `~/.claude/sessions/{live-pid}.json`. PID field documented.
- AC7: `tests/fixtures/session-dead-pid.json` — synthesized by copying `session-alive.json` and replacing `pid` with a number guaranteed not to be alive (e.g., `1` or a high random number; document the choice).
- AC8: Research note `team/bram-research/m1-fixtures-<date>.md` documents each fixture's source path, capture date, Claude Code version observed, and redaction steps.
- AC9: Bram explicitly states in the note: "I verified each fixture's source path exists" — with the actual paths listed.

### Out of scope (OOS)

- No `teams.yaml` fixtures (those are M1-08's responsibility — Felix writes them alongside the matcher).
- No parser code. Bram captures and documents; Felix consumes.
- No `meta.json` schema synthesis from scratch. Real captures only. If a schema variant can't be captured live, document the gap in the note.

### Done-when test

```bash
ls tests/fixtures/
# Shows all 7 fixtures + the research-note path
cat team/bram-research/m1-fixtures-<date>.md
# Documents source paths, capture dates, Claude Code versions, redaction steps
```

Note must include a literal "I verified each fixture's source path exists" line with paths.

### Files in play

- Owned (Bram writes): `tests/fixtures/meta-old-schema.json`, `tests/fixtures/meta-new-schema.json`, `tests/fixtures/subagent-running.jsonl`, `tests/fixtures/subagent-finished.jsonl`, `tests/fixtures/subagent-malformed.jsonl`, `tests/fixtures/session-alive.json`, `tests/fixtures/session-dead-pid.json`, `team/bram-research/m1-fixtures-<date>.md`.
- Read-only references: `.claude/docs/data-sources.md`, sponsor's `~/.claude/` tree (paths in data-sources.md).

### Conflict rule

If a v2.1.119 schema sample cannot be found anywhere in the sponsor's `~/.claude/` tree, surface in the note ("only v2.1.145+ schema observed on this machine — old-schema fixture synthesized from documented schema, marked as such"). Do NOT silently synthesize.

### Open question dependencies

If the sponsor has not yet answered the "test fixture sourcing" open question (anonymization scope), default to: redact all user message content (`<redacted>`), include only this project's sessions, document everything redacted.

---

## M1-03 — `spec(cli): M1 CLI output layout + glyph spec` — [ClickUp 86c9y5c8m](https://app.clickup.com/t/86c9y5c8m)

**Owner:** Iris
**Peer reviewer:** Felix (Iris design PR with data-shape implications goes to Felix per cross-pair rule)
**Size:** S
**Priority:** P1
**Source:** V1-PLAN M1; `.claude/docs/architecture-overview.md` (dashboard tile shape)

### Scope

Spec what `npm run agent-tree` prints. Even though M1's output is text, the visual hierarchy informs the dashboard's tile layout in M3. Catch the layout decisions here, once.

### Acceptance criteria

- AC1: `team/iris-ux/m1-cli-output-spec.md` defines: top-level grouping (per session? per team? both?); line format per agent (display name, role, current activity, state); indentation/grouping for parent → child relationships; how the background-noise count is rendered.
- AC2: Spec includes a complete example output covering all four states (`running`, `idle`, `finished`, `error`) and the background-noise chip, populated with realistic example agents.
- AC3: Glyph spec — what state indicator is used per state (e.g., `[●]` running, `[○]` idle, `[✓]` finished, `[!]` error). ASCII-only for CLI (no Unicode glyphs that fail in Windows terminals).
- AC4: Spec calls out at least two ways the CLI output diverges from the eventual dashboard (e.g., "CLI flattens multi-line, dashboard wraps") so Felix doesn't over-engineer.
- AC5: Spec contains a section "What this implies for the dashboard tile" — 3 bullets max — so M3 can re-use the layout language without re-deriving.

### Out of scope (OOS)

- No color spec (CLI runs in user's terminal; colors don't carry through cleanly cross-platform).
- No dashboard tile spec — that's M3.
- No interaction (the CLI is a one-shot print, not interactive).

### Done-when test

`team/iris-ux/m1-cli-output-spec.md` exists and contains: the example output, the glyph table, the divergence notes, and the dashboard-implication bullets.

### Files in play

- Owned (Iris writes): `team/iris-ux/m1-cli-output-spec.md`.
- Read-only references: `.claude/docs/architecture-overview.md`, `.claude/docs/roster-matching.md`, `docs/V1-PLAN.md`.

---

## M1-04 — `test-plan(m1): M1 acceptance test plan` — [ClickUp 86c9y5ca3](https://app.clickup.com/t/86c9y5ca3)

**Owner:** Sage
**Peer reviewer:** Felix (test plan touches host-side surfaces)
**Size:** S
**Priority:** P1
**Source:** `.claude/docs/testing-strategy.md`; this backlog

### Scope

Author the M1 acceptance test plan that the orchestrator uses to gate M1's "complete" status. Plan must map every ticket's ACs to a verification step.

### Acceptance criteria

- AC1: `team/sage-qa/test-plan-m1.md` exists with sections per ticket (M1-01 through M1-10) listing the verification steps Sage runs to sign off the ticket's PR.
- AC2: Plan calls out which tickets need a Self-Test Report (per CLAUDE.md hard rule #3) — at minimum the CLI driver (M1-09) since its output is UX-visible.
- AC3: Plan enumerates the edge-case probes per testing-strategy.md "Layer 1 — Unit" coverage targets (schema drift, empty roster, malformed JSONL, dead PID, race conditions).
- AC4: Plan includes a "M1 milestone done-when" section — the single command that proves M1 is shippable: `npm run agent-tree` produces a printed tree containing at least one rostered agent and the noise-count chip, given a populated `~/.claude/` tree.
- AC5: Plan lists what's NOT tested in M1 (deferred to M2+) so Sage's pass-criteria don't leak into later milestones.

### Out of scope (OOS)

- No actual test code (M1-10 owns integration test code; unit tests live in their respective parser PRs).
- No CI configuration (M1-01's territory).
- No M2/M3/M4 planning.

### Done-when test

`team/sage-qa/test-plan-m1.md` exists. Sage signs off by referencing this plan when QAing later M1 PRs.

### Files in play

- Owned (Sage writes): `team/sage-qa/test-plan-m1.md`.
- Read-only references: `.claude/docs/testing-strategy.md`, this backlog, M1-03 (CLI output spec).

### Dependency

Should wait for M1-03 to land so the CLI's done-when test can cite the spec'd output shape.

---

## M1-05 — `feat(parser): meta.json parser (v2.1.119 + v2.1.145)` — [ClickUp 86c9y5cah](https://app.clickup.com/t/86c9y5cah)

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** M
**Priority:** P0
**Source:** `.claude/docs/data-sources.md` §4; V1-PLAN "Schema handling"

### Scope

Implement the `meta.json` parser that handles both schema versions and surfaces a normalized `AgentMeta` type. Pure function, fully unit-tested.

### Acceptance criteria

- AC1: `src/extension/watcher/metaJsonLoader.ts` exports `parseMeta(raw: unknown): AgentMeta` returning a normalized shape (e.g., `{ schemaVersion: "v2.1.119" | "v2.1.145", agentType: string, name: string | null, description: string, toolUseId: string | null }`).
- AC2: Schema detection follows the documented rule (feature-detect: `name` present → new schema; otherwise old). Documented in code comments referencing `.claude/docs/data-sources.md`.
- AC3: Handles malformed JSON (throws a typed error with the raw input attached) and missing required fields (returns a parse error, never crashes).
- AC4: `src/shared/types.ts` declares the `AgentMeta` type and is imported by the parser. (Shared with M1-08 / M1-09.)
- AC5: Unit tests in `tests/unit/metaJsonLoader.test.ts` cover: v2.1.119 fixture (M1-02), v2.1.145 fixture, malformed JSON, missing `agentType`, missing `description`, schema with `name: null` explicitly, schema with unknown extra fields (forward-compat — should not crash).
- AC6: Tests use the fixtures from `tests/fixtures/meta-old-schema.json` and `tests/fixtures/meta-new-schema.json` (M1-02's outputs).
- AC7: All tests pass: `npm run test -- metaJsonLoader`.

### Out of scope (OOS)

- No file watching (that's the tailer / registry ticket).
- No persona matching (that's M1-08 — `matcher.ts`).
- No state reduction.

### Done-when test

```bash
npm run test -- metaJsonLoader
# All tests green
npm run typecheck
# Clean
```

### Files in play

- Owned (Felix writes): `src/extension/watcher/metaJsonLoader.ts`, `src/shared/types.ts` (new — `AgentMeta` type), `tests/unit/metaJsonLoader.test.ts`.
- Read-only references: `tests/fixtures/meta-old-schema.json`, `tests/fixtures/meta-new-schema.json`, `.claude/docs/data-sources.md`.

### Conflict rule

If the actual fixture shape differs from `.claude/docs/data-sources.md`, update the doc as part of this PR with the actual observed shape — don't silently match disk.

### Dependencies

- M1-01 (scaffold + CI)
- M1-02 (fixtures)

---

## M1-06 — `feat(parser): subagent JSONL tailer + activity extraction` — [ClickUp 86c9y5ccb](https://app.clickup.com/t/86c9y5ccb)

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** M
**Priority:** P0
**Source:** `.claude/docs/data-sources.md` §3; V1-PLAN "Identity & display rules" — activity line

### Scope

Implement the JSONL tailer that reads the last ~100 lines of a subagent transcript and extracts: (a) the resolved model from the first assistant message; (b) the current activity from the last `tool_use` content entry.

### Acceptance criteria

- AC1: `src/extension/watcher/subagentTailer.ts` exports `readActivity(jsonlPath: string): SubagentActivity` returning `{ model: string | null, lastTool: string | null, lastTimestamp: number, mtimeMs: number }`.
- AC2: Reads only the last ~100 lines (use streaming or `fs.read` with a tail window — don't load entire file). Performance acceptance: handles a 50MB JSONL in <100ms.
- AC3: Returns gracefully when: file is missing (`null` activity, no throw); file is empty (`null` activity); file has only metadata records, no assistant content (model null, lastTool null); last assistant message has multiple `tool_use` entries (return the LAST one); last assistant message has only text content (lastTool = null, model still resolved).
- AC4: Handles malformed JSONL line (skip line, continue) — never crashes on a single bad line.
- AC5: `src/shared/types.ts` adds `SubagentActivity` type.
- AC6: Unit tests in `tests/unit/subagentTailer.test.ts` cover: `subagent-running.jsonl` (M1-02 fixture), `subagent-finished.jsonl`, `subagent-malformed.jsonl`, missing file, empty file, file with only text content.
- AC7: All tests pass: `npm run test -- subagentTailer`.

### Out of scope (OOS)

- No file watching / polling (just the read function). Polling logic lives in the file-watcher orchestrator built in M1-09.
- No state reduction.
- No meta.json reading (that's M1-05).

### Done-when test

```bash
npm run test -- subagentTailer
# All tests green
```

### Files in play

- Owned (Felix writes): `src/extension/watcher/subagentTailer.ts`, `src/shared/types.ts` (extend with `SubagentActivity`), `tests/unit/subagentTailer.test.ts`.
- Read-only references: `tests/fixtures/subagent-*.jsonl`, `.claude/docs/data-sources.md`.

### Dependencies

- M1-01, M1-02. Independent of M1-05 — can run parallel.

---

## M1-07 — `feat(parser): sessions/PID registry + liveness` — [ClickUp 86c9y5ccn](https://app.clickup.com/t/86c9y5ccn)

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** S
**Priority:** P0
**Source:** `.claude/docs/data-sources.md` §1, "Liveness inference"

### Scope

Read `~/.claude/sessions/*.json` and report the set of live Claude Code sessions, cross-referenced with OS process liveness.

### Acceptance criteria

- AC1: `src/extension/watcher/sessionRegistry.ts` exports `listSessions(claudeHome: string): SessionRecord[]` returning each session JSON parsed + liveness-checked.
- AC2: Each `SessionRecord` includes: `pid`, `sessionId`, `cwd`, `version`, `entrypoint`, `startedAt`, `isAlive: boolean`.
- AC3: `isAlive` checked by attempting `process.kill(pid, 0)` (does not actually kill; signal 0 = liveness probe). Wrapped in try/catch — errors mean "dead."
- AC4: Handles missing `~/.claude/sessions/` directory (returns `[]`, no throw). Handles malformed session JSON files (skip + log warning, continue).
- AC5: `src/shared/types.ts` adds `SessionRecord` type.
- AC6: Unit tests in `tests/unit/sessionRegistry.test.ts` cover: live PID (using current process's pid as the live one), dead PID (`session-dead-pid.json` fixture), missing directory, malformed JSON file alongside valid ones.
- AC7: All tests pass.

### Out of scope (OOS)

- No polling loop (that's M1-09's responsibility).
- No mapping of sessions → subagent JSONLs (also M1-09).
- No Windows-specific PID quirks beyond what `process.kill(pid, 0)` already gives us. (Note: on Windows, `process.kill(pid, 0)` works the same way per Node docs; verify in tests.)

### Done-when test

```bash
npm run test -- sessionRegistry
# All tests green, including the live-PID one using process.pid
```

### Files in play

- Owned (Felix writes): `src/extension/watcher/sessionRegistry.ts`, `src/shared/types.ts` (extend with `SessionRecord`), `tests/unit/sessionRegistry.test.ts`.
- Read-only references: `tests/fixtures/session-alive.json`, `tests/fixtures/session-dead-pid.json`, `.claude/docs/data-sources.md`.

### Dependencies

- M1-01, M1-02. Independent of M1-05/06 — can run parallel.

---

## M1-08 — `feat(roster): YAML loader + matcher` — [ClickUp 86c9y5cfe](https://app.clickup.com/t/86c9y5cfe)

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** L
**Priority:** P0
**Source:** `.claude/docs/roster-matching.md` (whole doc); V1-PLAN "Roster schema"

### Scope

Implement the `teams.yaml` loader (global + per-project, project overrides) and the matcher (first-match-wins across all four rule types). Pure functions, exhaustive unit tests.

### Acceptance criteria

- AC1: `src/extension/roster/schema.ts` defines the Zod schema for `teams.yaml` (or equivalent type-validation). Schema rejects: missing required fields, unknown match-rule keys, non-string display/id, duplicate member ids within a team.
- AC2: `src/extension/roster/loader.ts` exports `loadRoster(globalPath?: string, projectPath?: string): RosterLoadResult` returning `{ roster: Team[], warnings: string[], errors: string[] }`. Per-project YAML members override global members by `id`; duplicate ids across teams emit a warning, second wins (per docs).
- AC3: `src/extension/roster/matcher.ts` exports `matchAgent(meta: AgentMeta, roster: Team[]): MatchResult` — returns `{ teamId: string, memberId: string }` on first match, `null` on no match. Walks teams in declaration order, then members in declaration order, then `match[]` rules in declaration order.
- AC4: All four rule types supported (`name_prefix`, `name_equals`, `agentType_equals`, `description_contains`). Case sensitivity matches the doc: `description_contains` is case-INSENSITIVE; the others are case-SENSITIVE.
- AC5: Test fixtures: `tests/fixtures/teams-valid.yaml`, `tests/fixtures/teams-invalid.yaml` (intentional YAML parse error), `tests/fixtures/teams-duplicate-ids.yaml`, `tests/fixtures/teams-project-override.yaml`. Felix authors these (NOT Bram — these are synthesized config, not captured state).
- AC6: Unit tests in `tests/unit/matcher.test.ts` cover: each rule type hits + misses; first-match-wins order; both meta.json schemas as inputs; old-schema match via `agentType_equals` and new-schema match via `name_prefix`; no-match returns null.
- AC7: Unit tests in `tests/unit/loader.test.ts` cover: valid YAML, malformed YAML, duplicate-ids warning, project-override semantics, missing global file (still loads project), missing both (returns empty roster + warning).
- AC8: All tests pass: `npm run test -- matcher loader`.

### Out of scope (OOS)

- No file-watching of `teams.yaml` (the M2 work — extension activates a watcher; M1's CLI re-reads on every run).
- No webview wiring.
- No "retroactive re-matching" of historical state (per docs §"What the matcher does NOT do").

### Done-when test

```bash
npm run test -- matcher loader
# All tests green
npm run typecheck
```

### Files in play

- Owned (Felix writes): `src/extension/roster/schema.ts`, `src/extension/roster/loader.ts`, `src/extension/roster/matcher.ts`, `src/shared/types.ts` (extend with `Team`, `Member`, `MatchRule`, `MatchResult`, `RosterLoadResult`), `tests/unit/matcher.test.ts`, `tests/unit/loader.test.ts`, `tests/fixtures/teams-*.yaml` (the four fixtures).
- Read-only references: `.claude/docs/roster-matching.md` (canonical).

### Conflict rule

If `js-yaml` parser behavior surprises you (e.g., a duplicate-id case the doc says emits a warning but the YAML parser fails first), surface it — update either the doc or the implementation to align, in this same PR. Don't ship a divergence.

### Dependencies

- M1-01 (scaffold). Independent of M1-02 (uses self-authored YAML fixtures, not Bram's captures).

---

## M1-09 — `feat(cli): reducer + agent-tree CLI driver` — [ClickUp 86c9y5chc](https://app.clickup.com/t/86c9y5chc)

**Owner:** Felix
**Peer reviewer:** Maya
**Size:** L
**Priority:** P0
**Source:** V1-PLAN M1 output; M1-03 (CLI output spec)

### Scope

Compose M1-05, M1-06, M1-07, M1-08 into a state reducer and a CLI entrypoint. `npm run agent-tree` produces the spec'd output from M1-03 against the live `~/.claude/` tree.

### Acceptance criteria

- AC1: `src/extension/state/reducer.ts` exports `buildAgentTree(sessions, metas, activities, roster) → AgentTree` — pure function composing the inputs into a structured tree (per-session → rostered tiles + background bucket).
- AC2: `src/cli/agentTree.ts` is the CLI entrypoint — reads `~/.claude/` (or `--claude-home <path>` flag), reads roster from `~/.claudeteam/teams.yaml` (or `--roster <path>`), reduces, prints per M1-03's spec.
- AC3: `package.json` `scripts.agent-tree` runs `node dist/cli/agentTree.js`. `npm run build && npm run agent-tree` works end-to-end.
- AC4: Output matches M1-03 spec exactly: per-session grouping, per-rostered-tile line format, background-noise count chip.
- AC5: Handles all states (running / idle / finished) per the docs' liveness-inference rule.
- AC6: Handles empty inputs gracefully: no live sessions ("No live Claude Code sessions."), empty roster (only background bucket shown).
- AC7: Unit tests in `tests/unit/reducer.test.ts` cover the reducer against hand-built input fixtures (no filesystem needed for reducer tests). Covers: agent goes from spawned → running → idle → finished; agent never matches any rule (background bucket); two sessions same cwd; session disappears mid-tree.
- AC8: Self-Test Report on the PR — Felix runs `npm run agent-tree` against the actual `~/.claude/` tree and pastes the output. Shows at least one rostered agent (assumes a roster YAML exists for testing — Felix authors a throwaway `~/.claudeteam/teams.yaml` for the demo, screenshot or paste).

### Out of scope (OOS)

- No VS Code integration (M2).
- No webview message protocol (M2).
- No file-watcher loop (CLI is one-shot — runs, prints, exits). The polling loop is M2+ work.
- No `--watch` flag (could be added later if useful, not in M1).

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run build
npm run agent-tree
# Prints tree matching M1-03 spec
npm run test -- reducer
# All tests green
```

Self-Test Report posted on PR per the testing-strategy.md contract.

### Files in play

- Owned (Felix writes): `src/extension/state/reducer.ts`, `src/cli/agentTree.ts`, `src/shared/types.ts` (extend with `AgentTree`), `tests/unit/reducer.test.ts`, modifications to `package.json` (`scripts.agent-tree`, `bin` entry not required), modifications to `esbuild.config.mjs` or equivalent (CLI build target).
- Read-only references: ALL of M1-05/06/07/08's exports; `team/iris-ux/m1-cli-output-spec.md` (M1-03).

### Conflict rule

If composing the four parser modules surfaces a missing type or a contract mismatch, file a follow-up ticket against the relevant parser PR — do NOT silently edit `src/extension/watcher/*` from this branch.

### Dependencies

- M1-05, M1-06, M1-07, M1-08 (all parsers + matcher must be merged).
- M1-03 (CLI output spec must be merged).

---

## M1-10 — `test(m1): integration tests against fixture filesystem` — [ClickUp 86c9y5cmg](https://app.clickup.com/t/86c9y5cmg)

**Owner:** Sage
**Peer reviewer:** Felix (host-side surface)
**Size:** M
**Priority:** P0
**Source:** `.claude/docs/testing-strategy.md` "Layer 2 — Integration"

### Scope

Author integration tests that spin up a tempdir mimicking `~/.claude/`, populate it with M1-02's fixtures + the roster YAML fixtures from M1-08, and assert the CLI reducer produces the expected `AgentTree`.

### Acceptance criteria

- AC1: `tests/integration/fixtureFs.test.ts` builds a tempdir with the structure: `claude-home/sessions/{pid}.json` + `claude-home/projects/{slug}/{sessionId}.jsonl` + `claude-home/projects/{slug}/{sessionId}/subagents/agent-{aid}.meta.json` + `.jsonl`. Points the registry / tailer / loader at this dir. Asserts the reducer output.
- AC2: Coverage targets per testing-strategy.md "Layer 2":
  - Session appears (tempdir gets a new `{pid}.json` mid-test → next reducer pass shows it).
  - Session disappears (delete the `{pid}.json` → reducer drops it next pass).
  - Subagent spawns (new `meta.json` + `.jsonl` → reducer adds it).
  - Subagent finishes (parent transcript gets the `tool_result` → reducer marks finished).
  - Two sessions sharing the same `cwd` (they materialize as two separate sessions, not merged).
  - Schema drift (one session has v2.1.119 meta files, another has v2.1.145 — matcher hits both correctly per the roster).
  - Race condition: subagent JSONL exists but parent transcript hasn't recorded the `tool_use` yet — reducer treats subagent as running, not orphaned.
- AC3: Tests use real fixtures from M1-02 — no synthesizing inside the test file. If a fixture is missing, the test fails with a clear message ("fixture X required from M1-02 not found").
- AC4: All tests pass: `npm run test:integration`.
- AC5: Sage's findings (any bugs caught in Felix's modules during writing these tests) are filed as follow-up tickets, not silently fixed in this PR.

### Out of scope (OOS)

- No VS Code-level integration tests (`@vscode/test-electron`) — M2's work, since the extension activation surface doesn't exist yet.
- No production code changes — if Sage finds a bug, file a ticket.
- No new fixtures (uses M1-02's outputs + M1-08's roster fixtures).

### Done-when test

```bash
npm run test:integration
# All tests green
```

CI runs integration suite on the PR.

### Files in play

- Owned (Sage writes): `tests/integration/fixtureFs.test.ts`, `tests/integration/helpers/tempdir.ts` (helper to build the fixture filesystem).
- Read-only references: M1-05/06/07/08/09 modules; `tests/fixtures/*` (M1-02 + M1-08 outputs); `.claude/docs/testing-strategy.md`.

### Conflict rule

If you discover a bug in Felix's modules, **file a ticket** — do NOT fix in this PR. The integration tests should be readable as the canonical contract; if they're also patching the implementation, the layer-mix muddies review.

### Dependencies

- M1-09 (CLI driver must be merged so the reducer is available).
- M1-02 (fixtures), M1-08 (roster fixtures).

---

## Cross-references

| Ticket | Depends on | Blocks |
|---|---|---|
| M1-01 | — | M1-05, M1-06, M1-07, M1-08 |
| M1-02 | — | M1-05, M1-06, M1-07, M1-10 |
| M1-03 | — | M1-04, M1-09 |
| M1-04 | M1-03 | — |
| M1-05 | M1-01, M1-02 | M1-09 |
| M1-06 | M1-01, M1-02 | M1-09 |
| M1-07 | M1-01, M1-02 | M1-09 |
| M1-08 | M1-01 | M1-09 |
| M1-09 | M1-05, M1-06, M1-07, M1-08, M1-03 | M1-10 |
| M1-10 | M1-09, M1-02, M1-08 | — |

## Throughput note

Felix owns 6 of 10 M1 tickets. Maya cross-reviews all of them but has no primary M1 work. This is the M1 reality — it's a data-plane spike on Felix's lane. M2 redistributes the load.
