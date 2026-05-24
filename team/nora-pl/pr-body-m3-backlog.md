## Summary

M3 backlog — sponsor-confirmed scope "Roster config + live refresh." 9 tickets across 3 waves, covering live YAML hot-reload, window-scoped session filtering, roster-error UX, four orch/test discipline carry-overs from M2-close, and Layer-3 coverage extension.

## Ticket count by wave

- **Wave 0 (5-6 in parallel):** M3-01 (Felix L), M3-03 (Felix M), M3-05/06/07/08 (Nora ×4 S orch-direct chores)
- **Wave 1:** M3-02 (Felix S — may fire in Wave 0 if bandwidth), M3-04 (Maya M)
- **Wave 2:** M3-09 (Sage M Layer-3 expansion)

## Dependency graph (terse)

```
PR #32 (Bram, in-review) ┐
                         ├─→ M3-01 (Felix, hot-reload)  ┐
                         │                              │
                         └─→ M3-02 (Felix, openRoster)  ├─→ M3-04 (Maya, UX) ─→ M3-09 (Sage, L3)
                                                        │
M2-06 (merged) ─→ M3-03 (Felix, window filter) ─────────┘

M3-05/06/07/08 (Nora orch-direct chores) — zero-dep, fire any time
```

## Mix

- **5 tickets needing ClickUp creation at dispatch:** M3-01, M3-02, M3-03, M3-04, M3-09 (code/test work)
- **4 tickets orch-direct chore class (no ClickUp):** M3-05, M3-06, M3-07, M3-08

## Gates applied

- **Webview-smoke gate:** M3-03 (state-shape change), M3-04 (rendering changes)
- **Extension-manifest gate:** M3-03 (`claudeteam.showAllSessionsGlobally` setting), M3-01 conditionally (if AC8 fallback wires a user-facing setting)
- **Sub-agent GUI gap:** documented per-ticket where applicable; deferred-screenshot pattern applies to M3-01 / M3-03 / M3-04

## Out-of-repo

Cross-project port of "Sub-agent GUI gap" reframe + `mcp__clickup__update_task` allow-rule to `create-orchestration-project` skill `port-improvements` mode — listed in the backlog file's preamble as visibility-only, NOT M3 work.

## Cross-review

Orch-direct (Nora's backlog files are orch-direct per project convention).

## Decision drafts

(None in this PR — surface tickets will produce decision drafts at merge time.)
