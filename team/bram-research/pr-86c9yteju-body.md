## research(triage): V1 dogfood 6-observation triage (86c9yteju)

Triages all 6 observations from `team/dogfood/2026-05-25-session-lifecycle-quirks.md` (sponsor-sourced, install commit `0bb0290`). Obs 7 (hide-finished feature) is OOS per ticket scope.

### Verdicts

| Obs | Classification | One-liner |
|-----|----------------|-----------|
| 1 | mixed | (sessionId, pid) keying is intentional; undocumented |
| 2 | mixed | DEAD-tile prune is file-driven (no timer); undocumented |
| 3 | defect | Pane reopen shows empty state — host does not replay last state to remounted webview |
| 4 | intentional | Already resolved (per-project roster migration) + documented in roster-matching.md |
| 5 | mixed | Filter logic correct; Obs 5 was no-workspace passthrough artifact; passthrough undocumented |
| 6 | defect | Two gaps: (6a) finished activity string has no elapsed-time suffix; (6b) CollapsedPersonaGroup state label aggregation suspect |

### Evidence base (verified file:line)

- `src/extension/watcher/sessionRegistry.ts:113-121` — listSessions() reads all {pid}.json files; no dedup by sessionId (Obs 1)
- `src/extension/watcher/watcherLoop.ts:225,226-240` — initial tick is fire-and-forget async; FS-watcher onDidDelete triggers immediate tick (Obs 2)
- `src/extension/main.ts:94-101` — prior watcher disposed before new one starts; no prior-state replay (Obs 3)
- `.claude/docs/roster-matching.md:65-73` — "Recommended default: per-project" section present and correct (Obs 4 resolved)
- `src/extension/watcher/sessionFilter.ts:75-88,79-81` — filter correct; passthrough when no folder open (Obs 5)
- `src/extension/state/reducer.ts` — inferState() correctly returns "idle" for stale JSONL; buildActivity("finished") returns bare "finished" with no elapsed time (Obs 6a); buildActivity("idle") returns "idle ${elapsedS}s" (Obs 6 liveness inference confirmed correct)

### Follow-up tickets drafted (in triage doc)

- **Obs 3:** `fix(host): replay last-known state to remounted webview` — Felix, S, P1
- **Obs 6a:** `fix(reducer): add elapsed-time suffix to finished activity string` — Felix, S, P2
- **Obs 6b:** `fix(webview): CollapsedPersonaGroup state label should reflect live instances` — Maya, S, P2 (webview source read needed to confirm root cause before implementation)

### Doc additions enumerated (for orch to apply)

Three additions to `vscode-extension-conventions.md` (all Bram-drafts in triage doc, no code changes):
1. Session-tile identity is (sessionId, pid) not sessionId alone (Obs 1)
2. DEAD tile pruning is file-driven not timer-driven (Obs 2)
3. Session filter edge cases — don't-strand passthrough when no folder open (Obs 5)

### ClickUp

- `86c9yteju → in review` appended to `team/log/clickup-pending.md` (sub-agent MCP fallback per orchestration-overview.md)
