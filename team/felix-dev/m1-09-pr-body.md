## feat(cli): reducer + agent-tree CLI driver (M1-09)

Composes M1-05/06/07/08 parsers into `buildAgentTree` + a one-shot CLI that
prints the live `~/.claude/` agent tree per Iris's M1-03 spec.

### What changed

**New files:**
- `src/extension/state/reducer.ts` — `buildAgentTree(sessions, agentData, activities, finishedIds, roster, nowMs)` pure function. Zero filesystem reads. Handles all three meta.json schema variants, all four agent states, two sessions with same `cwd`, parse-error agents, fresh spawns with no JSONL yet.
- `src/cli/agentTree.ts` — CLI entrypoint. Reads `~/.claude/` (or `--claude-home`), loads roster (`~/.claudeteam/teams.yaml` or `--roster`), reduces, prints per M1-03. Exits 0 always.
- `tests/unit/reducer.test.ts` — 22 unit tests covering all AC7 scenarios.

**Extended:**
- `src/shared/types.ts` — added `AgentState`, `AgentTile`, `BackgroundAgent`, `SessionTree`, `AgentTree` types. Field names match Iris's §6 Glossary exactly.

**Modified:**
- `package.json` — added `scripts.agent-tree`, `"type": "module"`.
- `esbuild.config.mjs` — wired `src/cli/agentTree.ts` → `dist/cli/agentTree.js`.

### Non-obvious findings

1. **Slug derivation was underdocumented.** `data-sources.md §2` says "path separators replaced by `--`" which I initially interpreted as each separator → `--`. The actual on-disk pattern is: drive colon dropped, first separator → `--`, subsequent separators → `-`. Verified against 5 real project directories. The cwdToSlug function is now verified.

2. **`nowMs` must be injected into `inferState`**, not just `buildAgentTree`. The liveness check compares `nowMs - mtimeMs` against the 10s threshold — without injection, tests cannot control time and the stale-vs-running boundary is nondeterministic.

3. **`type: "module"` needed in `package.json`** for the esbuild ESM output to load cleanly under Node v25. Without it, Node warns and does a second parse. Added as part of AC3.

4. **`inferState` does NOT need the `AgentMeta` param** despite the initial design. The finished/idle/running/error inference only needs `session.isAlive`, `activity.mtimeMs`, and `finishedIds`. The meta was a dead param — removed.

5. **Background agent line uses raw `agentType`** from the meta (e.g. `"felix"`, `"devon"`, `"tess"`). For RandomGame sessions, these are persona slugs that aren't in the ClaudeTeam roster, so they correctly fall to background and render their `agentType` as-is. This is working as designed — the background chip shows the raw `agentType` per spec §1.6.

6. **Parent JSONL scan for `ai-title` and `tool_result` is synchronous** (uses `readFileSync`). The CLI is one-shot; async would add complexity for no throughput benefit. M2 file-watcher can make this async when needed.

7. **Fresh spawn (JSONL mtime=0, session alive) collapses to `running`** per spec §2.3 "spawned-but-no-JSONL-yet". The reducer does not emit a fourth state for this — per spec, it's a running tile with `tool:?` activity.

### AC walkthrough summary

All 8 ACs met — see Self-Test Report comment for full evidence.

### Test counts after this PR

```
matcher 28 + loader 16 + metaJsonLoader 23 + subagentTailer 13 + sessionRegistry 19 + reducer 22 = 121 unit tests, all green
```
