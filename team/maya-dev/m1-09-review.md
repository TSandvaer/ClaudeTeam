## REVIEW VERDICT: APPROVE_WITH_NITS

CI: `SUCCESS` on both check runs (run IDs 26333236024 + 26333233461, via `gh pr view 14 --json statusCheckRollup`).
Local: `npm run build && npm run test -- reducer` → 22/22 passed. Full suite 121/121 green.

---

### AC coverage

| AC | Verified | Evidence |
|---|---|---|
| AC1 — `buildAgentTree` pure function, no fs | PASS | `reducer.ts:84` — no `fs`, `path`, or Node builtins imported. TypeScript import list confirms. |
| AC2 — CLI entrypoint with `--claude-home` + `--roster` | PASS | `src/cli/agentTree.ts` exists; both flags exercised in Self-Test probes. |
| AC3 — `npm run build && npm run agent-tree` exits 0 | PASS | Self-Test build output + local confirmed. `package.json:13` `scripts.agent-tree`. |
| AC4 — output matches M1-03 spec (session header, team card, tile, chip) | PASS WITH NITS | Live output in Self-Test matches structural shape. See nits below. |
| AC5 — all four states renderable | PASS | `running` + `idle` + `finished` captured live; `error` verified via unit test (reducer.test.ts:313). |
| AC6 — empty-state handling | PASS | Both probes confirmed verbatim: `No live Claude Code sessions.` and `(no rostered teams matched; roster missing or empty)`. |
| AC7 — `reducer.test.ts` covers all four required scenarios | PASS | 22 tests; all four scenarios (state-transitions, no-match, two-sessions-same-cwd, session-disappears-mid-tree) plus schema-drift regression, Bram's M1-02 "finished from parent signal" guard. |
| AC8 — Self-Test Report with live output | PASS | Self-Test comment on PR contains live output including at least one rostered tile + background chip. |

---

### OOS discipline

Files changed: `esbuild.config.mjs`, `package.json`, `src/cli/agentTree.ts`, `src/extension/state/reducer.ts`, `src/shared/types.ts`, `team/felix-dev/`, `team/log/clickup-pending.md`, `tests/unit/reducer.test.ts`.

No edits to `src/extension/watcher/*` or `src/extension/roster/*`. OOS discipline respected.

---

### Code quality findings

**NIT 1 — `buildActivity` returns `"running"` bare string when `lastTool` is null (spec divergence).**
`reducer.ts:309–310`: when state is `running` but `activity?.lastTool` is null, the function returns the bare string `"running"` — not `"tool:?"` or anything in the spec's `tool:` prefix format. The spec §1.4 says: `running → tool:<tool-name> <summary>`, fallback when summary unavailable is `tool:<tool-name>`. There is no defined fallback for "tool name itself unknown." The live Self-Test shows `tool:Bash` (tool known), so this path only fires for fresh spawns — and those currently read `"running"` which the CLI presenter pads and prints without the `tool:` prefix, misaligning with the spec glyph-row example format. Suggest returning `"tool:?"` to maintain the `tool:` prefix consistently. Does not affect the four-state model; this is a display string edge case.

**NIT 2 — `parentToolUseId` tree-link pass is a dead stub.**
`reducer.ts:178–190`: `toolUseIdToTile` is built but never used to set `parentToolUseId` on any tile. The field stays `null` for all tiles. The presenter (`agentTree.ts`) also doesn't render the `\-- ` child-indent prefix. Both sides are consistently unimplemented, so no incorrect output in V1 (all M1-era agents are depth-1). But the tree-link pass is dead code that adds confusion. Recommend either removing the `toolUseIdToTile` build loop with a `// TODO(M2):` comment, or completing both sides together in a follow-up ticket. Not a blocker.

**NIT 3 — `teamNameForId` is module-level mutable state.**
`agentTree.ts:414–428`: `const teamNameForId = new Map<string, string>()` at module scope, populated in `main()` and read inside `printSession()`. For the one-shot CLI this is harmless. When the M2 file-watcher imports this module and calls `main()` repeatedly (or uses `printTree()` from multiple call sites), this becomes a re-entrant hazard. Recommend moving `teamNameForId` to a local inside `printTree(tree, roster)` or threading the roster into `printSession`. Add a `// NOTE: module-level; safe for one-shot CLI only` comment at minimum so M2 author knows to refactor.

**NIT 4 — `+ 1 background agents` grammar.**
`agentTree.ts:404`: count is not pluralized. With 1 background agent the output reads `+ 1 background agents (this session)`. The spec §1.6 only shows examples with N > 1, so this isn't spec-violating, but it's grammatically incorrect. Low priority; suggest `count === 1 ? "agent" : "agents"` guard.

**NIT 5 — Activity string for `running` state omits tool argument (partial spec conformance).**
Spec §1.4 requires `tool:<tool-name> <one-line summary>` where the summary is the first argument/path. The `SubagentActivity` type (from M1-06) only exposes `lastTool`; no `lastToolArg` field. So the reducer can only produce `tool:Bash`, not `tool:Bash mkdir...`. This is a M1-06 contract limitation, not an M1-09 error. Calling it out for Sage's awareness; a follow-up ticket should extend `SubagentActivity` with `lastToolFirstArg?: string` and update the reducer. Not a blocker for this PR.

---

### Non-obvious findings — doc-promotion candidates

1. **`cwdToSlug` rule verified in code (PR body non-obvious finding #1).** `data-sources.md §2` says "path separators replaced by `--`" but the actual rule is: drive colon dropped, first separator → `--`, subsequent → `-`. Felix's implementation at `agentTree.ts:79–93` is verified correct against 5 real paths. The doc wording is ambiguous and should be tightened. Suggest updating `data-sources.md §2` to match: "drive colon dropped; first separator → `--`; subsequent separators → `-`." Promote to `.claude/docs/data-sources.md`.

2. **`"type": "module"` in package.json is a CJS-consumer breaking change.** Flagged in self-test but worth capturing: any future M2 code that tries to `require()` the CLI bundle or uses CommonJS-style `module.exports` will break silently. The M2 extension host entry point must be ESM-only (or a second esbuild target with `format: "cjs"` for the VS Code extension process). Promote to `vscode-extension-conventions.md` as an open question for M2.

---

### Self-Test Report completeness (per Sage test plan §M1-09)

- [x] Verification method stated
- [x] AC walkthrough (all 8 ACs with file:line evidence)
- [x] Side-effect inventory (files read, files modified, no writes)
- [x] Live `npm run agent-tree` output pasted
- [x] Empty-state probe (`--claude-home nonexistent`)
- [x] Empty-roster probe (`--roster nonexistent.yaml`)
- [x] Failure-mode probes (missing session, malformed JSONL, schema mismatch, empty roster)

Report is complete. All 5 required elements plus failure-mode probes present.

---

APPROVE_WITH_NITS — 5 nits, all non-blocking. AC1–AC8 met with cite-able evidence. Tests cover all named bug classes including the Bram M1-02 "finished from parent signal" regression guard and all three schema variants. OOS respected. CI green.
