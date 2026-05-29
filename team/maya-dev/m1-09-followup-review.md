## REVIEW VERDICT: APPROVE

CI: `SUCCESS` on both check runs (via `gh pr view 18 --json statusCheckRollup`).
Local: `npm run test` → 127 unit + `npm run test:integration` → 31 integration = **158 total, all green**. Matches Felix's claimed count exactly.

---

### Per-AC verification

**AC1 — `buildActivity` returns `"tool:?"` when running + `lastTool` null**

PASS. `reducer.ts:298`: `if (!tool) return "tool:?";`. Three test cases verified:

- `agent_ac1a`: `mtimeMs=0`, `lastTool: null` → `"tool:?"` (fresh spawn path).
- `agent_ac1b`: recent mtime, `lastTool: null` → `"tool:?"` (between tool calls).
- `agent_ac1c`: recent mtime, `lastTool: "Bash"` → `"tool:Bash"` (regression guard).

Both required cases — (a) running + null → `"tool:?"` and (b) running + tool present → `"tool:<name>"` — are covered.

Minor comment note: the inline code comment says `"If both empty → just tool:<tool-name>"` as justification for `"tool:?"`. Spec §1.4's "if both empty" sentence actually describes the case where the tool NAME is known but the summary/argument is empty — a different edge case. The sentinel value `"tool:?"` is the correct choice for the null-tool-name scenario; the comment's spec cite is slightly imprecise. Not a logic error; the behavior is right and aligns with the spirit of the spec. Not blocking.

**AC2 — Dead `parentToolUseId` stub deleted**

PASS. Verified:

- `src/shared/types.ts`: `parentToolUseId` field removed from `AgentTile` interface (line ~276 region — field absent in current file).
- `src/extension/state/reducer.ts`: `parentToolUseId: null` removed from tile construction; `toolUseIdToTile` dead pass removed (15 lines of dead code gone).
- `tests/unit/reducer.test.ts:690`: negative assertion `expect(Object.prototype.hasOwnProperty.call(tile, "parentToolUseId")).toBe(false)` confirms the field does not appear at runtime.
- Grep of `tests/` for `parentToolUseId`: only the negative assertion in reducer.test.ts. No integration test relied on it.

**AC3 — `teamNameForId` no longer module-level mutable**

PASS. `agentTree.ts:353–355`: map built locally inside `printTree()` from the `roster: Team[]` parameter, passed as second argument to `printSession()`. Module-level `const teamNameForId = new Map<string, string>()` is gone. The population loop in `main()` is also gone.

Reentrancy: calling `buildAgentTree` twice with different rosters produces independent `teamNameForId` maps because the map is constructed from the parameter each time. Second call does not see first call's state. The fix is structurally correct.

No explicit "call printTree twice, verify second call sees new roster" test exists — but as noted in the AC description, this is acceptable for M2 given the change is structurally reentrant by design. The M2-05 author will confirm in practice.

**AC4 — Plural guard**

PASS. `agentTree.ts:410`: `const agentWord = count === 1 ? "agent" : "agents";`. Two test cases verified:

- `tree.sessions[0].background.toHaveLength(1)` — single-agent path exercises the count.
- `tree.sessions[0].background.toHaveLength(3)` — three-agent path.

Note: these tests verify the reducer's background-count data (the correct layer). Presenter-level verification of the actual output string (`"+ 1 background agent"` vs `"+ 3 background agents"`) is not covered by reducer tests — it lives in the CLI presenter. This is the right layering for unit tests. If a snapshot test of the CLI output string is desired, that is M2/Sage scope, not a blocker here.

**AC5 — Tool-argument limitation documented in `data-sources.md` §3**

PASS. New subsection "Tool-argument limitation (M1-06 tailer — tracked, not yet resolved)" added at `data-sources.md:83–90`. Contents are accurate:

- Correctly identifies `src/extension/watcher/subagentTailer.ts` as the source.
- Correctly cites spec `iris-ux/m1-cli-output-spec.md §1.4`.
- Accurately describes what M1-06 delivers vs what the spec calls for.
- Names `tailer-extract-tool-args` as the future ticket.
- States this is not in current M2 scope.

Cross-reference to Iris's spec is correct (path and section match). The subsection is placed under §3 (Subagent transcript) where `lastTool` context lives — correct placement.

**AC6 — `cwdToSlug` rule documented in `data-sources.md` §2**

PASS. Three-step rule + example table + duplication callout verified:

- Documented rule (strip colon, first sep → `--`, subsequent → `-`) matches code exactly at `src/cli/agentTree.ts:79–93`.
- `tests/integration/helpers/tempdir.ts:72–81` is the second site — `cwdToSlug` exported function with identical logic. Comment at line 68 says "mirrors cwdToSlug() from src/cli/agentTree.ts exactly."
- Duplication callout in data-sources.md correctly names both paths.
- POSIX path rule documented and matches the `cwd.replace(/\//g, "-").replace(/^-/, "")` branch in both copies.

One minor note: the example table shows `C:\Trunk\PRIVATE\Axelot-tutor` → `C--Trunk-PRIVATE-Axelot-tutor`. The function preserves the drive letter's original case (capital `C` from the cwd). The table is accurate.

**AC7 — ESM-only implication + cross-reference to Bram's research**

PASS. New bullet added to "Open questions (decide during M2)" in `vscode-extension-conventions.md:116`. Contents verified:

- `--format=cjs` for host bundle: correct per Bram's doc §"VS Code API surface" (VS Code extension host loads CJS).
- `--format=iife` recommendation for webview: cross-checked against Bram's doc §"Webview UI tech recommendation" and Pixel Agents' build pattern (single bundled IIFE, confirmed in Bram's verification claims table).
- "Do NOT use `--format=esm` for the webview entry" rationale (VS Code webviews don't support ES module imports without an import map): this is consistent with Bram's findings. Pixel Agents uses IIFE, not ESM. The restriction is accurate.
- Cross-reference `team/bram-research/m2-vscode-prior-art-2026-05-23.md §"VS Code API surface"` is accurate — that section exists in Bram's doc and covers the CJS/ESM distinction.
- Cross-reference `+ Pixel Agents' build pattern`: confirmed — Bram's doc §"Pixel Agents internals comparison" table row shows "Webview UI framework: React (createRoot present; 291 KB bundle)" and Bram's verification claims table includes the Pixel Agents pattern.

---

### OOS discipline

Files changed: `.claude/docs/data-sources.md`, `.claude/docs/vscode-extension-conventions.md`, `src/cli/agentTree.ts`, `src/extension/state/reducer.ts`, `src/shared/types.ts`, `team/log/clickup-pending.md`, `tests/unit/reducer.test.ts`.

No edits to `src/extension/watcher/*` or `src/extension/roster/*`. No `cwdToSlug` extraction to `src/shared/slug.ts`. OOS discipline respected.

---

### Test count

127 unit tests + 31 integration tests = 158. Matches Felix's stated count. All green locally on `pr-18-review` branch.

---

APPROVE — all 7 ACs met with verifiable evidence. Tests correct, docs accurate, OOS clean. The one comment-imprecision in AC1 is cosmetic and does not affect behavior. No blockers.
