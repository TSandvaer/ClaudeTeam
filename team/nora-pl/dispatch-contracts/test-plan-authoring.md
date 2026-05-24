# Test-plan authoring — dispatch contract

When the orchestrator dispatches Sage (or any persona) to author a test plan or acceptance-criteria document with manual-verification ACs, the test plan MUST include an **Executor mapping table** alongside the per-ticket sign-off checklists. Every manual-verification AC maps to:

- **Executor role** — Felix / Maya / Sage / sponsor / Layer-3-automated.
- **Runtime capability required** — CLI / sub-agent process / VS Code window + screenshot capability / `@vscode/test-electron`.

Any AC with executor `sponsor` that is also marked pre-merge-blocking MUST be flagged for review at backlog-authoring time — sponsor is not a pre-merge gate by default.

Example row format (one per manual-verification AC):

| Ticket / AC | Executor | Runtime capability | Pre-merge gate? |
|---|---|---|---|
| M3-04 / AC6 drill-in regression | Maya | VS Code window + screenshot | Yes — sub-agent GUI gap reframe applies (AC(a) data-plane smoke pre-merge, AC(b-d) sponsor post-merge) |

## Anti-pattern callout — M2-07

M2-07's webview-smoke gate AC was authored for "Maya or PR author" execution; both were sub-agents with no GUI runtime, surfacing at dispatch time. Map executors at authoring time, not at dispatch.
