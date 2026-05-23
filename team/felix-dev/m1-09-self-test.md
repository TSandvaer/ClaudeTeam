## Self-Test Report — M1-09 feat(cli): reducer + agent-tree CLI driver

### Verification method

Local `npm run build && npm run agent-tree` against the sponsor's actual `~/.claude/` tree.
Throwaway `~/.claudeteam/teams.yaml` authored per `.claude/agents/TEAM.md` canonical roster
(Nora/Iris/Felix/Maya/Sage/Bram with `agentType_equals` + `name_prefix` rules).

### AC walkthrough

**AC1: `src/extension/state/reducer.ts` exports `buildAgentTree` — pure function, no fs.**
`src/extension/state/reducer.ts:60` — `export function buildAgentTree(sessions, agentData, activities, finishedIds, roster, nowMs)`. All inputs injected; no `fs`, `path`, or Node builtins imported. Typecheck clean.

**AC2: `src/cli/agentTree.ts` is the CLI entrypoint with `--claude-home` and `--roster` flags.**
File exists at `src/cli/agentTree.ts`. Both flags work (confirmed in empty-state and empty-roster probes below).

**AC3: `package.json` `scripts.agent-tree` runs `node dist/cli/agentTree.js`. `npm run build && npm run agent-tree` exits 0.**
```
> claudeteam@0.0.1 build
  dist\cli\agentTree.js      643.8kb
Done in 40ms
```
`npm run agent-tree` exits 0 (confirmed below).

**AC4: Output matches M1-03 spec — per-session grouping, team card header, agent tile line, background chip.**
See "Live run output" below. Session `13c45c5f` shows:
- Session header: `SESSION 13c45c5f  [claude-vscode]  pid=37760  v2.1.145  state=alive`
- cwd + title lines (2-space indent)
- `  TEAM ClaudeTeam Alpha  (1 rostered, 0 background in this session)`
- `    [>]  Felix    Extension Hos..  tool:Bash                       claude-sonnet-4-6`
- Background chip with 6 agents in MARIAN-TUTOR session

**AC5: All four states (`running`/`idle`/`finished`/`error`) renderable.**
- `running` — Felix tile in session 13c45c5f (JSONL mtime < 10s, active Bash tool)
- `idle` — devon/drew/tess in RandomGame session (JSONL stale > 10s)
- `finished` — general-purpose agents in MARIAN-TUTOR session
- `error` — synthesized via parse-error agent entry in unit test (reducer.test.ts:218 — `(parse error)` agentType, `error` state). Hard to capture live without injecting a malformed meta.json.

**AC6: Handles empty inputs gracefully.**
- No sessions: `node dist/cli/agentTree.js --claude-home tests/fixtures/nonexistent` → `No live Claude Code sessions.` (exit 0)
- Empty roster: `node dist/cli/agentTree.js --roster tests/fixtures/nonexistent.yaml` → session headers + "no rostered teams matched" + background chip. No crash.

**AC7: `tests/unit/reducer.test.ts` covers all required scenarios.**
22 tests:
- agent spawned → running → idle → finished (via finishedIds) state transitions (4 tests)
- finished detected from finishedIds, NOT from JSONL content (1 test — regression for Bram's M1-02 finding)
- agent never matches → background bucket (1 test)
- empty roster → all background (1 test)
- parse-error agent → background with `(parse error)` agentType (1 test)
- background-chip count=0 suppression (1 test)
- two sessions same cwd → materialized separately (1 test)
- dead session (isAlive:false) (1 test)
- all three schema variants (v2.1.119, v2.1.145-general, v2.1.145-persona) (3 tests)
- model:? sentinel — null model (1 test), no activity entry (1 test)
- mixed rostered + background (1 test)
- session with no agentData match → empty (1 test)
- title propagation (2 tests)

`npm run test -- reducer` → 22 passed, 0 failed.
Full suite: `npm run test` → 121 passed (99 pre-existing + 22 new), 0 failed.

**AC8: Self-Test Report with live `npm run agent-tree` output.**
See "Live run output" below. At least one rostered tile (`[>] Felix`) shown under a TEAM header. Background chip shown with 6 agents.

### Live run output (with throwaway `~/.claudeteam/teams.yaml`)

```
SESSION f5ed91c4  [claude-vscode]  pid=126660  v2.1.145  state=alive
  cwd:   c:\Trunk\PRIVATE\MARIAN-TUTOR
  title: (no title yet)
  (no rostered teams matched; roster missing or empty)
    + 6 background agents (this session)
        - general-purpose  "Kyle spec-author rec — Q4/Q6"  finished  claude-opus-4-7
        - general-purpose  "Devon A7 letter-sounds bake"  finished  claude-opus-4-7
        - general-purpose  "Dave pedagogy rec — Q4/Q6"  finished  claude-opus-4-7
        - general-purpose  "Kyle amend letter-sounds §7"  finished  claude-opus-4-7
        - general-purpose  "Kevin A3 letter-names bake"  finished  claude-opus-4-7
        - general-purpose  "Devon cross-review of PR #333"  finished  claude-opus-4-7

SESSION 449a92dc  [claude-vscode]  pid=25524  v2.1.145  state=alive
  cwd:   c:\Trunk\PRIVATE\MARIAN-TUTOR
  title: (no title yet)
  (no rostered teams matched; roster missing or empty)

SESSION 13c45c5f  [claude-vscode]  pid=37760  v2.1.145  state=alive
  cwd:   c:\Trunk\PRIVATE\ClaudeTeam
  title: (no title yet)
  TEAM ClaudeTeam Alpha  (1 rostered, 0 background in this session)
    [>]  Felix    Extension Hos..  tool:Bash                       claude-sonnet-4-6


SESSION 71357a1b  [claude-vscode]  pid=40828  v2.1.140  state=alive
  cwd:   c:\Trunk\PRIVATE\RandomGame
  title: (no title yet)
  (no rostered teams matched; roster missing or empty)
    + 3 background agents (this session)
        - devon            "Devon: W2-T4 world_seed save-writ.."  idle  claude-opus-4-7
        - drew             "Drew: docstring fix derive_zone_s.."  idle  claude-opus-4-7
        - tess             "Tess: QA review PR #342"  idle  claude-opus-4-7
```

Notes:
- `13c45c5f` is the current Claude Code session running this dispatch (me, Felix, running `tool:Bash` at time of capture). Confirms real `agentType: "felix"` persona-named variant flows through correctly.
- MARIAN-TUTOR sessions show 6 `finished` background agents + 1 empty session (session 449a92dc has no subagents in its directory).
- RandomGame session shows 3 `idle` agents (devon/drew/tess — persona slugs, not in ClaudeTeam roster).
- `title: (no title yet)` for all sessions — the current sessions don't have an `ai-title` record in their JSONL (common for ongoing sessions where the title hasn't been generated yet).

### Empty-state probe (AC6)

```
$ node dist/cli/agentTree.js --claude-home tests/fixtures/nonexistent
No live Claude Code sessions.
```
Exit 0. Verbatim match per spec §1.7.

### Empty-roster probe (AC6)

```
$ node dist/cli/agentTree.js --roster tests/fixtures/nonexistent.yaml
[roster warning] global roster file not found: .../nonexistent.yaml
SESSION 13c45c5f  ...
  (no rostered teams matched; roster missing or empty)
    + 1 background agents (this session)
        - felix            "M1-09 reducer + agent-tree CLI"  running  claude-sonnet-4-6
...
```
All agents fall to background; no team cards; no crash.

### Side-effect inventory

Files the CLI reads (no writes):
- `~/.claude/sessions/*.json` — session registry
- `~/.claude/projects/{slug}/{sessionId}.jsonl` — for `ai-title` and `tool_result` (finished detection)
- `~/.claude/projects/{slug}/{sessionId}/subagents/agent-*.meta.json` — agent metadata
- `~/.claude/projects/{slug}/{sessionId}/subagents/agent-*.jsonl` — activity (JSONL tailer)
- `~/.claudeteam/teams.yaml` (or `--roster` override) — roster

**No VS Code extension surfaces touched.** No webview, no message protocol, no watcher loop.

Files modified in this PR:
- `src/shared/types.ts` — added 5 new exported types (AgentState, AgentTile, BackgroundAgent, SessionTree, AgentTree). No existing types removed or modified.
- `package.json` — added `scripts.agent-tree` and `"type": "module"`. The `"type": "module"` is a BREAKING CHANGE for any CJS consumers — none exist yet (the extension entry point is M2 work), but Sage and Maya should be aware this changes module resolution.
- `esbuild.config.mjs` — replaced placeholder with real entry point.

### Failure-mode probes

**Missing session file:**
`--claude-home tests/fixtures/nonexistent` → `No live Claude Code sessions.` (exit 0). `listSessions` returns `[]` on missing directory.

**Malformed JSONL:**
The JSONL tailer (`subagentTailer.ts`) skips malformed lines per M1-06 contract. End-to-end: a session with one malformed line in its subagent JSONL continues rendering with whatever valid data preceded it. If ALL lines are malformed → `model:?` + `running` state (mtime still valid).

**Schema mismatch (Bram's third variant):**
My meta.json as the dispatch subagent is `agentType: "felix"` + `toolUseId: "toolu_016L..."` + no `name` — the persona-named v2.1.145 variant. It correctly renders as a rostered tile for `felix` via `agentType_equals: "felix"`. Confirmed in live output above.

**Empty roster:**
`--roster tests/fixtures/nonexistent.yaml` → all agents in background, no team cards, no crash. Shown in empty-roster probe above.
