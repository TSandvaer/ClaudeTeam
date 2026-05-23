# M1 Acceptance Test Plan

The orchestrator uses this document to gate M1's "complete" status. Each section maps a ticket's acceptance criteria to the concrete verification steps Sage runs before signing off the PR. The final section defines the single-command **M1 milestone done-when** check.

- **Ticket:** [ClickUp 86c9y5ca3](https://app.clickup.com/t/86c9y5ca3) — `test-plan(m1): M1 acceptance test plan`
- **Owner:** Sage
- **Peer reviewer:** Felix (host-side surfaces)
- **Source docs:**
  - `.claude/docs/testing-strategy.md` (canonical — Layer 1 / Layer 2 / Layer 3 mapping)
  - `team/nora-pl/milestone-1-backlog.md` (M1-01 through M1-10 AC source)
  - `team/iris-ux/m1-cli-output-spec.md` (CLI output target for M1-09)
  - `team/bram-research/m1-fixtures-2026-05-23.md` (real fixture inventory + schema findings)

## How to read this document

For every M1 ticket I list:

1. **Sign-off checklist** — line items I tick before approving the PR.
2. **Edge-case probes** — the specific failure modes I exercise against the PR's tests / fixtures / output. These map directly to testing-strategy.md "Layer 1 — Unit" coverage targets.
3. **Self-Test Report required?** — per CLAUDE.md hard rule #3 (UX-visible PRs).
4. **Verification commands** — exact shell commands run against the worktree.

The QA contract from `testing-strategy.md` "Sage's QA contract" governs every decision: REQUEST CHANGES on missing Self-Test Report / missing AC walkthrough / missing regression test / unhandled schema drift; APPROVE when ACs met with cite-able evidence + bug-class coverage.

---

## M1-01 — `chore(repo): bootstrap TypeScript scaffold + CI` (Felix)

### Sign-off checklist
- [ ] `package.json` declares all required devDeps (`typescript`, `vitest`, `esbuild`, `@types/node`, ESLint, Prettier, `@vscode/vsce`) and `engines.node >= 20`.
- [ ] `tsconfig.json` has `target: ES2022`, `strict: true`, `moduleResolution: "Bundler"`, output to `dist/`.
- [ ] Directories present with `.gitkeep` (committable empty state): `src/`, `tests/unit/`, `tests/integration/`, `tests/fixtures/`.
- [ ] All four scripts exit 0 on the empty scaffold: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- [ ] `.github/workflows/ci.yml` runs `typecheck + lint + test:unit` on `push` and `pull_request` targeting `main`. CI green on the PR (cite run-id URL).
- [ ] `vsce --version` exits 0 (toolchain smoke).
- [ ] `.gitignore` covers `node_modules/`, `dist/`, `*.vsix`, OS artifacts.

### Edge-case probes
- **Clean clone reproducibility:** `rm -rf node_modules && npm ci && npm run typecheck && npm run lint && npm run test && npm run build` exits 0 end-to-end.
- **OS-artifact ignore:** create a `Thumbs.db` / `.DS_Store` locally and confirm `git status` doesn't surface it.
- **Strict-mode bite:** add a one-line `let x: any = 1;` somewhere ephemeral and confirm `npm run lint` flags it (then revert) — proves strict + lint are actually wired, not just declared.
- **`vsce package --no-yarn` smoke** (hard rule #4 — extension-manifest gate): runs without crashing even on the empty manifest. Failure here would block M2.

### Self-Test Report required?
**Not strictly UX-visible** (no extension code yet), but the PR should still cite the green CI run-id URL and the four script exit codes. No screenshots needed.

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm ci
npm run typecheck && npm run lint && npm run test && npm run build
vsce --version
gh pr checks <pr-number>   # CI green
```

---

## M1-02 — `research(fixtures): capture meta.json + JSONL + sessions samples` (Bram)

### Sign-off checklist
- [ ] All seven fixtures present under `tests/fixtures/`: `meta-old-schema.json`, `meta-new-schema.json`, `subagent-running.jsonl`, `subagent-finished.jsonl`, `subagent-malformed.jsonl`, `session-alive.json`, `session-dead-pid.json`.
- [ ] Research note `team/bram-research/m1-fixtures-<date>.md` documents each fixture's source path, capture date, Claude Code version, redaction steps.
- [ ] Note contains the literal sentence "I verified each fixture's source path exists" with paths.
- [ ] Synthesized fixtures explicitly flagged as such (per Bram's note for `meta-old-schema.json`, `subagent-malformed.jsonl`, `session-dead-pid.json`).
- [ ] Redaction: every user-text content field is `<redacted>`; tool_result content from file-read operations is redacted; tool_result content from Bash/Write is retained (not user text).

### Edge-case probes
- **Fixture parse smoke:** `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/meta-old-schema.json'))"` succeeds for every JSON fixture; for JSONL, every non-malformed line in `subagent-running.jsonl` and `subagent-finished.jsonl` parses (the malformed fixture is allowed to fail by design).
- **Malformed fixture has all three failure modes** per AC5: (1) one structurally valid line, (2) one truncated line (no closing brace — simulates mid-write flush interrupt), (3) one line of plain text that's not JSON at all. Confirm the file contains exactly these three classes.
- **Old-schema fixture's documented gap:** Bram's note says no v2.1.119 was found on this machine; the fixture is synthesized from the doc example. Confirm the note's "synthesized" flag is unambiguous so downstream parsers (M1-05) test the right branch.
- **Bram's two doc-update follow-ups** (load-bearing for M1-05 and M1-09 — see "Schema-drift handling" section below):
  1. **Third v2.1.145 variant** — `agentType=personaName + toolUseId, no name`. This is undocumented in `.claude/docs/data-sources.md` and the M1-05 parser must handle it. If the doc isn't updated in this PR, I file a follow-up ticket.
  2. **Subagent JSONLs never carry the closing assistant message** — the real "finished" signal is `tool_result` in the parent JSONL. The synthesized line 7 of `subagent-finished.jsonl` exists solely to exercise the `stop_reason: "end_turn"` parser branch — this must be flagged in the note so Felix doesn't build a false "look for assistant end_turn in child JSONL" detector.

### Self-Test Report required?
**No** — research PR. The note IS the report. Bram's "I verified each fixture's source path exists" line plus the per-fixture evidence block stands in.

### Verification commands
```bash
ls c:/Trunk/PRIVATE/ClaudeTeam-bram-wt/tests/fixtures/   # 7 files present
cat c:/Trunk/PRIVATE/ClaudeTeam-bram-wt/team/bram-research/m1-fixtures-*.md
node -e "['meta-old-schema.json','meta-new-schema.json','session-alive.json','session-dead-pid.json'].forEach(f => JSON.parse(require('fs').readFileSync('tests/fixtures/'+f)))"
```

---

## M1-03 — `spec(cli): M1 CLI output layout + glyph spec` (Iris)

### Sign-off checklist
- [ ] `team/iris-ux/m1-cli-output-spec.md` exists with: top-level grouping rule, per-line format, indentation, background-noise count rendering, complete example output covering all four states + background chip, glyph table (ASCII-only).
- [ ] Glyph table is ASCII-only — no Unicode characters that would mis-render in cmd.exe / PowerShell.
- [ ] At least two CLI ↔ dashboard divergences called out (so Felix doesn't over-engineer).
- [ ] "What this implies for the dashboard tile" section is exactly three bullets max.
- [ ] Example output includes all four states (`running`, `idle`, `finished`, `error`) AND the background chip.

### Edge-case probes
- **Cross-terminal ASCII safety:** every glyph in the table is in the ASCII printable range `0x20`–`0x7E`. Verify by `grep -P "[^\x20-\x7E]"` against the spec — zero matches expected.
- **Width-locked state column:** spec mandates 3-char fixed-width `[X]` form. Confirm every state in the table fits exactly 3 chars (no 4-char states sneaking in).
- **Two-sessions-same-cwd rendering:** spec's example output should show two sessions with overlapping `cwd` to demonstrate that the renderer materializes them separately (this is a known M1-10 integration-test scenario; the spec must support it visually).
- **Empty-state copy:** spec defines `No live Claude Code sessions.` (verbatim) and the "missing/empty roster" fallback. Both must be quotable strings the CLI driver (M1-09) can match against.

### Self-Test Report required?
**No** — design spec only.

### Verification commands
```bash
cat team/iris-ux/m1-cli-output-spec.md
grep -P "[^\x20-\x7E]" team/iris-ux/m1-cli-output-spec.md   # zero hits in glyph table
```

---

## M1-04 — `test-plan(m1): M1 acceptance test plan` (Sage — THIS DOCUMENT)

Self-attestation only — peer-reviewer (Felix) confirms the plan is complete and the M1 done-when command is executable.

### Sign-off checklist (for Felix as reviewer)
- [ ] Sections present for M1-01 through M1-10.
- [ ] Each section lists concrete verification commands, not just prose.
- [ ] Schema-drift / empty-roster / malformed-JSONL / dead-PID / race-condition probes are enumerated per testing-strategy.md "Layer 1 — Unit" coverage targets.
- [ ] "M1 milestone done-when" section defines the single command that proves M1 shippable.
- [ ] "Not tested in M1 (deferred)" section is present and complete.

### Self-Test Report required?
**No** — this is the test plan itself, not a tested artifact.

---

## M1-05 — `feat(parser): meta.json parser (v2.1.119 + v2.1.145)` (Felix)

### Sign-off checklist
- [ ] `src/extension/watcher/metaJsonLoader.ts` exports `parseMeta(raw: unknown): AgentMeta` returning the normalized shape (`schemaVersion`, `agentType`, `name`, `description`, `toolUseId`).
- [ ] Schema detection follows the feature-detect rule (presence of `name` OR `toolUseId` triggers v2.1.145 path; absence falls to old).
- [ ] Code comments cite `.claude/docs/data-sources.md` for schema detection.
- [ ] `src/shared/types.ts` exports `AgentMeta`.
- [ ] Tests cover: both Bram-supplied fixtures, malformed JSON, missing `agentType`, missing `description`, explicit `name: null`, unknown extra fields (forward-compat).
- [ ] `npm run test -- metaJsonLoader` green.
- [ ] `npm run typecheck` clean.

### Edge-case probes (Layer 1 — Unit)
- **Schema drift (load-bearing per CLAUDE.md hard rule #3 spirit):**
  - v2.1.119 input (no `name`, no `toolUseId`) → `schemaVersion: "v2.1.119"`, `agentType` holds persona.
  - v2.1.145 generic input (`agentType: "general-purpose"`, no `name`, has `toolUseId`) → `schemaVersion: "v2.1.145"`, persona unresolved by parser (matcher's job).
  - **v2.1.145 persona variant (Bram's M1-02 finding — undocumented third variant): `agentType: "felix"`, no `name`, has `toolUseId` → must parse cleanly. The matcher then uses `agentType_equals: "felix"` to route it.** This is a regression-test bug class — the parser must NOT crash because `agentType` looks "old-schema-ish" while `toolUseId` exists.
- **Malformed JSON:** `{invalid` → typed parse error with the raw input attached. Does not crash.
- **Missing required field (`agentType`):** typed error, not a crash, raw input preserved.
- **`name: null` explicit:** parser handles both `name: undefined` (key absent) and `name: null` (key present, value null) — Bram's note flags this as a real on-disk case.
- **Forward-compat:** an unknown `customField: "value"` does NOT crash the parser; it's tolerated.
- **Empty object `{}`:** typed error, not a crash.
- **Non-object input (`null`, `[]`, `"string"`, `42`):** typed error, not a crash.

### Self-Test Report required?
**No** — pure parser, not UX-visible. CI test green is sufficient evidence.

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test -- metaJsonLoader
npm run typecheck
```

---

## M1-06 — `feat(parser): subagent JSONL tailer + activity extraction` (Felix)

### Sign-off checklist
- [ ] `src/extension/watcher/subagentTailer.ts` exports `readActivity(jsonlPath): SubagentActivity` returning `{ model, lastTool, lastTimestamp, mtimeMs }`.
- [ ] Reads only the last ~100 lines (streaming / tail-window — confirmed via test on a generated large file).
- [ ] Handles all gap conditions per AC3: missing file, empty file, metadata-only file, multiple tool_use in last assistant (returns LAST), text-only last assistant.
- [ ] Malformed JSONL line is skipped, not crashed.
- [ ] `src/shared/types.ts` extended with `SubagentActivity`.
- [ ] Tests cover all three Bram fixtures (`subagent-running.jsonl`, `subagent-finished.jsonl`, `subagent-malformed.jsonl`) plus missing-file + empty-file + text-only.
- [ ] `npm run test -- subagentTailer` green.

### Edge-case probes (Layer 1 — Unit)
- **Malformed JSONL (Bram's M1-02 fixture — load-bearing):** valid line + truncated line + plain-text line. Parser skips lines 2 and 3 without throwing. `lastTool` reflects only the valid record's content.
- **Empty file:** `model: null`, `lastTool: null`, `lastTimestamp: 0` (or equivalent sentinel). No crash.
- **Missing file:** same shape as empty (`null` activity). Documented behavior, not exception.
- **No-trailing-newline (partial flush):** JSONL whose last line is mid-write — `{"type":"assist` no newline. Tailer treats as malformed, skips.
- **Bram's M1-02 finding (load-bearing):** **subagent JSONLs never carry the closing assistant message in real captures.** The "finished" detection from JSONL alone is unreliable — the real signal is parent transcript's `tool_result` matching `toolUseId`. Felix's tailer should NOT claim "finished" from a child JSONL's content; that derived state belongs in the reducer (M1-09) using the parent JSONL.
- **Performance:** 50MB JSONL handled in <100ms (per AC2). Test with a synthesized large file in CI, not the fixture set.
- **Multiple tool_use in last assistant:** returns the LAST one, not the first. Regression: if a refactor returns first or "any", this catches it.
- **Race condition (per testing-strategy.md):** file exists but mtime is 0 / future-timestamped — handled gracefully (no negative `idle Ns` rendering).

### Self-Test Report required?
**No** — pure parser.

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test -- subagentTailer
```

---

## M1-07 — `feat(parser): sessions/PID registry + liveness` (Felix)

### Sign-off checklist
- [ ] `src/extension/watcher/sessionRegistry.ts` exports `listSessions(claudeHome): SessionRecord[]`.
- [ ] Each `SessionRecord` includes `pid`, `sessionId`, `cwd`, `version`, `entrypoint`, `startedAt`, `isAlive`.
- [ ] `isAlive` uses `process.kill(pid, 0)` wrapped in try/catch.
- [ ] Missing `~/.claude/sessions/` returns `[]` (no throw); malformed session JSON skipped with warning.
- [ ] `src/shared/types.ts` extended with `SessionRecord`.
- [ ] Tests use `process.pid` for the live case and `session-dead-pid.json` (PID 1) for the dead case.
- [ ] `npm run test -- sessionRegistry` green.

### Edge-case probes (Layer 1 — Unit)
- **Dead PID detection (Bram's PID 1 fixture):** `process.kill(1, 0)` on Windows fails with `EPERM`, which the wrapper interprets as "dead." Test asserts `isAlive: false` for PID 1.
- **Live PID:** `process.pid` (the test runner itself) → `isAlive: true`.
- **Missing directory:** `~/.claude/sessions/` does not exist → returns `[]`. No exception.
- **Malformed session JSON alongside valid:** drop a `{not-valid}.json` next to a valid one in tempdir — registry returns the valid record only, logs a warning for the malformed.
- **EPERM ambiguity (Windows):** PID 4 (System) is alive but `process.kill(4, 0)` raises `EPERM`. **This is a known gotcha** — EPERM does NOT necessarily mean dead; it means "exists but cannot signal." For V1 we accept this (per data-sources.md liveness rule cross-references the JSONL mtime as the secondary signal), but I file a follow-up ticket if Felix's test interprets EPERM as `isAlive: false` without comment. The test fixture (PID 1) is the legitimate dead case because it's the System Idle Process, which `process.kill(1, 0)` rejects.
- **Cross-platform note:** the test asserts behavior on Windows specifically (the dev environment is `win32`). CI may be Linux — the test should either skip the dead-PID assertion on non-Windows or use a portable invalid PID.

### Self-Test Report required?
**No** — pure parser.

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test -- sessionRegistry
```

---

## M1-08 — `feat(roster): YAML loader + matcher` (Felix)

### Sign-off checklist
- [ ] `src/extension/roster/schema.ts` defines Zod (or equivalent) schema for `teams.yaml`. Rejects: missing required fields, unknown match-rule keys, non-string display/id, duplicate member ids within a team.
- [ ] `src/extension/roster/loader.ts` exports `loadRoster(globalPath?, projectPath?): RosterLoadResult` with `{ roster, warnings, errors }`. Project override semantics per docs (project wins by `id`).
- [ ] `src/extension/roster/matcher.ts` exports `matchAgent(meta, roster): MatchResult`. First-match-wins. Walks teams → members → rules in declaration order.
- [ ] All four rule types implemented: `name_prefix`, `name_equals`, `agentType_equals`, `description_contains`. `description_contains` is case-INSENSITIVE; the other three are case-SENSITIVE.
- [ ] Felix-authored YAML fixtures present: `teams-valid.yaml`, `teams-invalid.yaml`, `teams-duplicate-ids.yaml`, `teams-project-override.yaml`.
- [ ] `tests/unit/matcher.test.ts` + `tests/unit/loader.test.ts` exhaustive.
- [ ] `npm run test -- matcher loader` green.

### Edge-case probes (Layer 1 — Unit)
- **Empty roster:** loader returns `{ roster: [], warnings: ["roster missing"], errors: [] }`. Matcher with empty roster returns `null` for every input (everything is background).
- **Malformed YAML:** loader returns `{ roster: [], warnings: [], errors: ["YAML parse error: ..."] }`. Does NOT throw — error is in the result.
- **Duplicate member ids across teams:** warning emitted, second-wins per docs. Regression test on the load order.
- **Same id within a single team:** schema-level rejection. Different bug class from cross-team duplicates.
- **Member with no `match` rules:** warning + skip that member. Loader does NOT crash the whole roster.
- **Project-override semantics:** global has `felix` with `agentType_equals: "felix"`; project has `felix` with `name_prefix: "felix-pr"`. Effective roster has the project's rules for `felix`, global's rules dropped for that id only. Global members not overridden stay intact.
- **Missing global file (only project provided):** still loads project, no error.
- **Missing both files:** returns empty roster + warning, no error.
- **Match rule precedence (first-match-wins):** team A member X rule 0 matches AND team B member Y rule 0 also matches → tagged as A.X (first one wins). Critical regression — a refactor to "highest-specificity wins" would break this and the test catches it.
- **Schema variants from M1-05:**
  - Old schema (no `toolUseId`): `agentType_equals: "felix"` against `{agentType: "felix"}` → hits.
  - New-generic (Bram fixture `meta-new-schema.json`): `name_prefix: "felix-"` against `{agentType: "general-purpose", name: null}` → MISS (name is null). Currently a background agent.
  - **New-persona variant (Bram's third variant — load-bearing regression test):** `agentType_equals: "felix"` against `{agentType: "felix", toolUseId: "...", name: null}` → HIT. Same code path as old-schema.
- **`description_contains` case-INSENSITIVE:** rule `description_contains: "felix review"` matches a meta with `description: "Felix Review for PR #310"`. The other three rule types are case-SENSITIVE — verify a `name_prefix: "felix-"` does NOT match `name: "Felix-pr310"` (capital F).

### Self-Test Report required?
**No** — pure parser + config loader.

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run test -- matcher loader
npm run typecheck
```

---

## M1-09 — `feat(cli): reducer + agent-tree CLI driver` (Felix)

This is **the** UX-visible M1 deliverable. Self-Test Report **required** (per CLAUDE.md hard rule #3 — CLI output is what the sponsor sees).

### Sign-off checklist
- [ ] `src/extension/state/reducer.ts` exports `buildAgentTree(sessions, metas, activities, roster) → AgentTree` — pure function, no filesystem access.
- [ ] `src/cli/agentTree.ts` is the CLI entrypoint. Reads `~/.claude/` (or `--claude-home <path>`), reads roster (`~/.claudeteam/teams.yaml` or `--roster <path>`), reduces, prints per M1-03.
- [ ] `package.json` `scripts.agent-tree` runs `node dist/cli/agentTree.js`. `npm run build && npm run agent-tree` works end-to-end.
- [ ] Output structurally matches `team/iris-ux/m1-cli-output-spec.md` Section 3 exactly: per-session grouping, session header line shape, team card header, agent tile line (3-char state glyph, padded fields), background chip with `+ N background agents` + detail list, two-space indentation.
- [ ] All four states (`running` / `idle` / `finished` / `error`) renderable per docs liveness inference.
- [ ] Empty-state outputs match spec verbatim: `No live Claude Code sessions.` when no sessions; `(no rostered teams matched; roster missing or empty)` when sessions exist but roster doesn't match.
- [ ] `tests/unit/reducer.test.ts` covers reducer with hand-built inputs: agent state transitions, background bucket, two sessions same cwd, session disappears mid-tree.
- [ ] `npm run test -- reducer` green.

### Edge-case probes (Layer 1 — Unit + Layer 3 — Manual)
- **Empty roster + populated `~/.claude/`:** CLI prints session headers, team cards suppressed, every agent in background chip. Matches spec Section 1.7.
- **No live sessions:** `No live Claude Code sessions.` exact string. Exit code 0.
- **Two sessions sharing cwd:** rendered separately (not merged). This is also an M1-10 integration test, but the reducer-unit test covers the in-memory case.
- **Dead session in registry:** `state=dead` header rendered in lower-emphasis form; no team cards, no background chip per spec.
- **Schema drift (Bram's three variants):** reducer composes meta parser (M1-05) + matcher (M1-08); all three variants flow through. Felix should include a reducer test where one session is v2.1.119 schema and another is v2.1.145 — both produce valid `AgentTile`s.
- **Race condition (per testing-strategy.md):** subagent JSONL exists but parent transcript hasn't recorded the `tool_use` yet. Reducer treats subagent as `running`, not orphaned. Critical regression: if the reducer requires parent `tool_use` to render a subagent, every fresh spawn would briefly invisibility-blink in the CLI.
- **Activity field truncation:** spec says `..` truncation at 30 chars. Test a long path like `tool:Edit src/extension/watcher/sessionRegistry.ts` and confirm it truncates to exactly 30 chars with `..` suffix.
- **Model unresolved (`model:?`):** when subagent JSONL has no assistant message yet, the model column renders `model:?`. Tested against an empty-fixture session.
- **`finished` state from parent transcript:** reducer detects `finished` from parent JSONL's `tool_result` matching `toolUseId`, NOT from the child JSONL. This is Bram's M1-02 finding made operational — write the test so a future refactor that "looks for end_turn in child JSONL" fails.
- **Background-chip suppression on zero:** if count = 0, no `+ 0 background agents` line is printed. Regression for the suppression branch.

### Self-Test Report required?
**YES — hard rule #3.** Required before requesting Sage's QA. Felix must:
1. **AC walkthrough.** Run `npm run agent-tree` against the actual `~/.claude/` tree with a throwaway `~/.claudeteam/teams.yaml` containing at least one matching member. Paste the output in the PR comment. The output must contain at least one rostered agent tile AND the noise-count chip.
2. **Side-effect inventory.** List every file the CLI reads. (Should be: `~/.claude/sessions/*.json`, `~/.claude/projects/**/meta.json`, `~/.claude/projects/**/*.jsonl`, `~/.claudeteam/teams.yaml`, `<project>/.claude/teams.yaml`.) No writes.
3. **State-coverage.** Show output capturing at least one agent in each of `running`, `idle`, `finished`. Error state may be hard to capture live — synthesizable via a malformed-meta fixture in tempdir, document the synthesis.
4. **Failure-mode probes (per testing-strategy.md "Failure-mode probes"):**
   - Missing session file: `--claude-home <empty-tempdir>` → `No live Claude Code sessions.`
   - Malformed JSONL: insert one bad line in a subagent JSONL and confirm CLI still renders (tailer skip-and-continue working end-to-end).
   - Schema mismatch: point at a meta.json with `agentType: "felix"` + `toolUseId: "..."` (Bram's third variant) and confirm matcher routes it correctly.
   - Empty roster: `--roster /tmp/empty.yaml` → all agents in background chip, no team cards.

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run build
npm run agent-tree   # Live run; Felix pastes output in Self-Test Report
npm run test -- reducer
```

---

## M1-10 — `test(m1): integration tests against fixture filesystem` (Sage — peer-reviewed by Felix)

### Sign-off checklist (Felix as reviewer)
- [ ] `tests/integration/fixtureFs.test.ts` builds a tempdir mimicking `~/.claude/` (`sessions/`, `projects/{slug}/{sessionId}.jsonl`, `projects/{slug}/{sessionId}/subagents/agent-{aid}.meta.json` + `.jsonl`).
- [ ] All seven Layer-2 coverage targets present per testing-strategy.md: session appears, session disappears, subagent spawns, subagent finishes, two sessions same cwd, schema drift, race condition (subagent JSONL exists but parent hasn't logged tool_use yet).
- [ ] Tests use real fixtures from M1-02 — no synthesis inside the test file. Missing-fixture failure is clear-messaged.
- [ ] Any bugs caught during writing tests are filed as follow-up tickets per the conflict rule — NOT silently fixed in this PR.
- [ ] `npm run test:integration` green on CI.

### Edge-case probes (Layer 2 — Integration)
- **Schema drift (load-bearing, all THREE Bram variants):** one session in tempdir uses `meta-old-schema.json` (no `toolUseId`); another uses the captured `meta-new-schema.json` (generic `agentType: "general-purpose"`); a third synthesizes the third variant in tempdir (`agentType: "felix"`, `toolUseId: "..."`, no `name`). Matcher hits the right roster member for each.
- **Race:** create the subagent JSONL + meta.json in tempdir BEFORE adding the corresponding `tool_use` entry to the parent JSONL. Reducer pass: subagent is `running`, not orphaned, not crashed.
- **Two sessions same cwd:** two `{pid}.json` files in `sessions/` with identical `cwd` but different `sessionId`. Reducer materializes both — does NOT merge.
- **Subagent finishes mid-test:** start with subagent running (no `tool_result` in parent), then append the `tool_result` with matching `toolUseId` to the parent JSONL → reducer marks the child `finished`.
- **Session disappears:** delete the `{pid}.json` mid-test → reducer drops the session and its children on next pass.
- **Subagent spawns mid-test:** add a new `meta.json` + `.jsonl` in tempdir → reducer picks it up.
- **Empty tempdir:** reducer returns empty tree; CLI driver prints empty-state line.

### Self-Test Report required?
**No** — integration test PR, not UX. CI green is the evidence. Sage authoring this still abides by the QA contract: peer-reviewer Felix confirms no production code is touched in the PR (conflict rule).

### Verification commands
```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-sage-wt
npm run test:integration
gh pr checks <pr-number>
```

---

## Schema-drift handling (cross-cutting — load-bearing)

Bram's M1-02 fixtures research surfaced **three** v2.1.145 schema variants on disk, not two as documented in `.claude/docs/data-sources.md`. Every parser / matcher / reducer ticket downstream must handle all three:

| Variant | `agentType` | `name` | `toolUseId` | Detection rule |
|---|---|---|---|---|
| Old (v2.1.119) | persona | absent | absent | no `toolUseId` |
| New-generic (v2.1.145) | engine type (`general-purpose`, `Explore`) | usually absent | present | `agentType` is a known engine type AND `toolUseId` present |
| New-persona (v2.1.145) — UNDOCUMENTED | persona | absent | present | `agentType` is a persona name AND `toolUseId` present |

**Test invariants for any parser/matcher PR:**
1. All three variants parse without crash.
2. All three are reachable by the matcher (`agentType_equals: "felix"` hits both old and new-persona variants).
3. The reducer treats all three identically once normalized.
4. A regression test exists named for "new-persona variant" specifically (not just "schema drift") so the bug class is named.

If the data-sources.md doc has NOT been updated to document the third variant by the time M1-05's PR opens, Sage files a follow-up ticket (do not block M1-05 — the parser implementation can ship; the doc gap is Bram's open follow-up).

---

## M1 milestone done-when

This is the **single command sequence** that proves M1 is shippable. The orchestrator runs this against a freshly-cloned `main` after every M1-XX merge; M1 is "complete" when it passes end-to-end.

```bash
# From a fresh clone or up-to-date worktree
cd c:/Trunk/PRIVATE/ClaudeTeam
npm ci
npm run typecheck
npm run lint
npm run test               # Layer 1 — unit tests (parsers, matcher, reducer)
npm run test:integration   # Layer 2 — fixture filesystem
npm run build

# Throwaway roster for the demo — copies one of the test fixtures into the global path,
# or use the `--roster` flag to point at tests/fixtures/teams-valid.yaml directly.
npm run agent-tree -- --roster tests/fixtures/teams-valid.yaml
```

**Pass criteria:**
1. Every `npm` command exits 0.
2. CI is green on the most recent PR merged into `main`.
3. `npm run agent-tree` produces a printed tree containing:
   - **At least one rostered agent tile** (a line beginning with `[>]`, `[.]`, `[v]`, or `[!]` under a `TEAM ...` header).
   - **The background-noise count chip** (a line matching `+ N background agents \(this session\)` with N > 0, OR a clear "no rostered teams matched" fallback when the live `~/.claude/` tree contains no agents at all).
4. Output structurally matches `team/iris-ux/m1-cli-output-spec.md` Section 3 (session header, indentation, glyph widths).

**Acceptance evidence captured by the orchestrator:**
- Paste of the `npm run agent-tree` output into the M1-complete decision log entry.
- Cite-able CI run-id URL for the last green M1 PR.
- Each M1-XX ClickUp ticket flipped to `complete`.

If the user's `~/.claude/` tree happens to contain zero live sessions at the moment the orchestrator runs the done-when check, fall back to the M1-10 integration tempdir: it builds a synthetic `~/.claude/` with known rostered + background agents and asserts the reducer output. A green `npm run test:integration` is the dispositive shippable signal.

---

## What is NOT tested in M1 (deferred to M2+)

Sage's M1 pass-criteria do NOT include any of the following — they are explicitly out of scope for the M1 acceptance gate. A PR that adds them is welcome but does not block M1.

1. **VS Code extension activation lifecycle.** `@vscode/test-electron` Layer 3 tests, `onView:claudeteam.dashboard` activation, manifest contributions, view container registration. M2 work (M2-01 et seq).
2. **Webview rendering.** No HTML, no CSS, no React/Svelte component tests in M1. The whole webview/ tree is M2-M3 territory.
3. **Webview ↔ host message bus.** `src/shared/messages.ts`, host-side dispatch, webview-side receiver — none exist yet in M1. Maya's lane.
4. **Theme-switch probes.** `--vscode-*` variable handling, dark/light render parity — M3 (Maya + Iris).
5. **Manual VS Code reload checklist.** No dashboard to reload in M1. `Ctrl+Shift+P → Developer: Reload Window` smoke is M2+.
6. **`vsce package` content correctness.** M1-01 verifies `vsce --version` exits 0 (toolchain present); actual `.vsix` content validation is M2's extension-manifest gate.
7. **File-watcher polling loop.** The CLI is one-shot in M1 (per Iris's spec divergence #1). Polling at ~2s cadence is M2 work (file-watcher tier of the architecture).
8. **Hook-tap tier (post-V1).** Sub-second updates via `SubagentStart`/`SubagentStop`/`PreToolUse` hooks landing on a dedicated local port. Not in V1 at all — M5+ work per architecture overview.
9. **Cross-machine state correlation.** Out of V1 scope entirely.
10. **Drill-in to subagent transcript.** Clicking a tile to open the JSONL — M3 work, depends on webview + VS Code API.
11. **Performance/load testing of the watcher under high session counts.** M1 covers the 50MB-JSONL probe for the tailer; concurrent-session load is M2+.
12. **Color output in CLI.** Explicit OOS per M1-03 spec Section 2.4. ANSI color is post-M1.
13. **Pixel Agents coexistence.** No port-sharing tests in M1 — irrelevant until the hook-tap tier (M5+).
14. **`teams.yaml` file-watcher.** M1-08 loads on every invocation (CLI is one-shot). Live reload on YAML change is M2 work.

---

## Sage's QA workflow during M1 (operational note)

For every M1-XX PR opened, Sage:

1. Reads the PR diff + Self-Test Report (if required per the table above).
2. Runs the ticket's "Verification commands" against the author's worktree (or a fresh clone of the PR branch).
3. Spot-checks at least one edge-case probe from this plan (chosen for the bug class most likely to regress).
4. **REQUEST CHANGES** if: Self-Test Report missing where required, AC walkthrough not present, regression test not named for this bug class, schema-drift coverage missing for a parser PR, manual reload screenshot missing for an eventual UI PR, or no negative-path assertion in the test suite.
5. **APPROVE** when: all ACs met with cite-able evidence (file:line, screenshot, run-id URL), tests cover the bug class not just the instance, Self-Test Report complete where required.
6. Posts approval via `gh pr review --approve` (or `gh pr comment` with `APPROVE` if shared-identity blocks the review API per orchestration-overview.md).

**Drain-mode preference:** err toward approving non-critical nits. Reserve REQUEST CHANGES for failed AC, missing Self-Test Report, regression risk, or contract violations — per testing-strategy.md "Sage's QA contract."

---

## Non-obvious considerations (for maintain-docs)

These are decisions I almost made differently — surfacing so the docs can absorb them.

1. **I almost wrote separate "schema-drift" probes per parser ticket.** Decided to centralize into a cross-cutting section because Bram's third variant is one bug class that touches M1-05, M1-08, M1-09, and M1-10 identically. Treating it as four independent test cases would fragment the regression name; one named "new-persona variant" bug class across all four PRs makes the regression traceable.
2. **I almost required Self-Test Reports on M1-05 / M1-06 / M1-07 / M1-08.** Decided against because hard rule #3 specifically targets webview rendering + extension-host message-passing — pure parsers don't reach that surface. CLAUDE.md hard rule #3 is the right gate; M1-09 is the first M1 ticket where it bites. Over-applying the rule cheapens it.
3. **I almost defined the "M1 done-when" as `npm run agent-tree` succeeding against the live user tree.** Decided to add the M1-10 integration tempdir fallback because the live tree's contents are non-deterministic (could be no sessions / no rostered matches at the moment of acceptance) — the integration suite is the deterministic dispositive signal.
4. **I almost made the EPERM-on-PID-4 gotcha a blocking edge-case probe for M1-07.** Decided to demote to a "file follow-up ticket" because the docs explicitly cross-reference JSONL mtime as the secondary liveness signal — single-source EPERM ambiguity is acceptable for V1, and forcing Felix to disambiguate every Windows PID quirk in M1 over-engineers the scope.
5. **I almost required `npm run agent-tree --json` machine-readable output as part of M1-09.** Iris's spec is text-only and one-shot per the divergence list (Section 5); the JSON-output form would be a M2+ extension once the webview consumes the reducer directly. Adding it now muddies the divergence boundary.
6. **The "race: subagent JSONL exists before parent tool_use" probe nearly went under M1-06.** Belongs in M1-09 (reducer) and M1-10 (integration) because the tailer (M1-06) doesn't know about the parent transcript. The bug class is "reducer treats orphan JSONL as running, not error" — a reducer-level invariant.
