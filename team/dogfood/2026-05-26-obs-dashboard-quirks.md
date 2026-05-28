# Dogfood — dashboard observability quirks (2026-05-26)

Sponsor surfaced four observability quirks during Round-3 verification dispatch on main `9e29686c2d112e6badb71a54c8910f7c164ccc8b`. Filed for triage — current-behavior-may-be-intentional for #4; the others are defect candidates.

## Context

- Sponsor: Thomas
- Install commit: `9e29686` (verified via `git -C c:/Trunk/PRIVATE/ClaudeTeam rev-parse HEAD` at 2026-05-26T14:05:30Z)
- Vsix in use: built from `9e29686` post-merge wave (PR #77 forceRefresh + PR #78 LICENSE + PR #79 maintain-docs NITs)
- Workspace: `c:\Trunk\PRIVATE\ClaudeTeam`
- Roster: per-project `<workspace>/.claude/teams.yaml` with `claudeteam-alpha` team (3 rostered: Felix, Maya, Bram)
- Live session at observation time: `baf09ef7` (pid=39516) — orchestrator session
- In-flight sub-agent: Bram Round-3 triage (ticket `86c9z8ev9`, agent name `bram-obs3-r3-surface-c`), dispatched ~20 min before observation. Branch `bram/86c9z8ev9-obs3-r3-surface-c-7s` created at origin/main but no commits yet (still in source-read phase).

## Observation 8 — Hide-finished chip label not state-aware

**Symptom (sponsor verbatim):** *"If i click the 'Hide finished x hidden' button, that should be named 'show finished x hidden'."*

**Observed dashboard text:**

- When filter is ON (finished hidden): chip displays `Hide finished — 16 hidden`
- When filter is OFF (finished visible): chip displays `Hide finished` (no count)

**Expected behavior (per sponsor's UX intent):** the chip label should describe the action the user will take if they click — i.e., when filter is ON and finished are hidden, the click action is to SHOW them, so label should be `Show finished — X hidden`. When filter is OFF, click action is to HIDE finished, so label should remain `Hide finished` (with optional count).

**Triage:** Maya (webview chip rendering). Likely a single-line conditional in [src/webview/components/headerChip.ts](src/webview/components/headerChip.ts) (or equivalent — exact file/line uncited; Maya identifies on triage). XS.

**Out of scope:** chip color/icon changes; restructuring the click handler.

## Observation 9 — Currently-running sub-agent not visible on dashboard

**Symptom (sponsor verbatim):** *"its not good that i cannot see him, I hope it will be fixed"*

**Observed behavior:** sponsor dispatched Bram (Round-3 triage) ~20 minutes before observation time. The orchestrator's `<task-notification>` system confirms the agent is alive. Bram is currently in his source-read phase (no JSONL yet; no commits in his worktree per `git log` on `bram/86c9z8ev9-obs3-r3-surface-c-7s`).

The dashboard shows:
- Orchestrator session tile `SESSION baf09ef7 [claude-vscode] pid=39516`
- Team card `TEAM claudeteam-alpha (3 rostered)`
- Collapsed groups: `Felix ×6`, `Maya ×6`, `Bram ×4` — **all 16 of these are finished tiles from prior dispatches**
- **NO running Bram tile for the current Round-3 dispatch**

**Ground-truth verification (orchestrator-side):**
- The current Bram dispatch IS in flight (per `<task-notification>` system + Agent tool tracking, ~20 min ago)
- Branch `bram/86c9z8ev9-obs3-r3-surface-c-7s` exists locally (per `git -C bram-wt status` on observation turn)
- Bram has not yet emitted tool-use activity that would write a JSONL on disk — he's still in initialization / first source-read

**Candidate root causes (none verified — Bram or Felix to triage):**

1. **Predicted symptom (verify before patching):** Bram's agent JSONL file may not yet exist on disk because he hasn't emitted his first tool call. The watcher only surfaces agents with detectable file-system presence — agents in their thinking phase pre-tool-use are invisible.
2. **Predicted symptom (verify before patching):** Watcher tick may have raced — if the new agent's meta.json was created between watcher polls, the next 2000ms tick should pick it up. Sponsor's observation was a single point-in-time snapshot.
3. **Speculative — no source yet:** active-state rendering bug specifically affecting running tiles vs finished tiles. The matcher pipeline may treat "no JSONL" and "no agent" as equivalent.

**Implication if root cause is #1 or #2:** the V1 product promise of "real-time observability" has a blind spot during the initialization phase of every dispatched agent. Could be seconds-to-minutes depending on agent's first action. Worth understanding even if not a "bug."

**Implication if root cause is #3:** running-tile rendering is broken for fresh dispatches. Major defect.

**Triage:** Bram (research first — identify which root cause). Likely Felix follow-up for fix.

## Observation 10 — Collapsed-group expansion state not preserved across re-renders

**Symptom (sponsor verbatim):** *"If i click on bram i see image 2, but it closes in 1 second everytime i try to expand a finished agent."*

**Observed behavior:** sponsor clicks the `Bram ×4` collapsed-group chevron → group expands to show 4 individual Bram tiles (each labeled "Internals Consultant", with `finished Ns Ms` timing + `claude-sonnet-4-6` model badge). Within ~1 second, the group auto-collapses back to `Bram ×4`.

**Hypothesis (label per never-fabricate — not patch-confirmed):** the dashboard re-renders the entire team-card view every poll tick (default `claudeteam.pollIntervalMs: 2000`). Expansion state lives in webview-only ephemeral DOM state, NOT in the persisted dashboard state model. Each re-render rebuilds the DOM and resets all expansion toggles to their default (collapsed). The 1s observation is plausible if the tick fires shortly after the click.

**Triage:** Maya (webview state management). Likely needs an `expandedGroups: Set<string>` in webview-local state that survives re-renders. S.

**Out of scope:** changing the poll interval; reworking the re-render strategy globally.

## Observation 11 — Finished elapsed-time format confusing

**Symptom (orch observation, not sponsor verbatim):** finished sub-agent tiles display two adjacent time values, e.g. `finished 19289s 3s`, `finished 4854s 3s`, `finished 9427s 3s`, `finished 2387s 3s`.

**Inferred format (best guess — Maya verifies on triage):** `finished <wall-seconds-since-finish>s <task-duration>s`. So "finished 19289s 3s" reads as "this agent finished ~5.4 hours ago and ran for 3 seconds."

**UX concern:** the dual-number format is non-obvious to readers. The first number can grow into hours/days (`19289s` = 5.4h, hard to parse mentally). The second number's relationship to the first is unclear without context.

**Suggested improvements (sponsor decides):**
- Humanize the first value: `finished 5h ago — 3s task` (or similar)
- Compact form: `5h 3s` with tooltip explaining
- Drop one of the two values if redundant

**Class:** UX polish, not defect. Lower priority than 8-10. May absorb into a broader rendering polish ticket.

**Triage:** Maya (webview). XS-S depending on chosen format.

## Repro

1. Have a Claude Code session active (or open one with `claude` in the current workspace).
2. Install vsix built from `9e29686` (or later if forceRefresh is on main).
3. Open the ClaudeTeam pane.
4. For Obs 9: dispatch any sub-agent (e.g. via the Claude Code orch). Observe whether the running tile appears within ~5 seconds.
5. For Obs 10: with finished sub-agents visible (toggle "Hide finished" off if needed), click any collapsed-group chevron. Observe whether the expansion survives the next 2-second poll tick.
6. For Obs 8: observe the chip label in BOTH states (filter on, filter off) and compare to a "describe-the-action" mental model.
7. For Obs 11: dispatch any sub-agent, wait for completion, observe the elapsed-time format on the finished tile.

## Acceptance for triage

Bram + Maya + Felix to:
1. Confirm whether each observation is intentional or a defect.
2. For intentional: add a one-paragraph note to `vscode-extension-conventions.md` or `data-sources.md` covering the rationale.
3. For defects: open follow-up implementation tickets, sized appropriately.

## Out of scope

- Surface C residual 7s gap (ticket `86c9z8ev9` is Bram Round-3 in flight; separate scope).
- Hide-finished chip filtering correctness (sponsor verified the filter itself works — clicking does hide/show finished tiles).
- Tests for any of the above — Sage will pick up coverage as part of the fix tickets.

## Pointer

ClickUp tickets: pending sponsor authorization. Suggested mapping:

| Obs | Title (suggested) | Owner | Priority | Size |
|---|---|---|---|---|
| 8 | `fix(webview): hide-finished chip label state-aware (Show vs Hide)` | Maya | P3 | XS |
| 9 | `triage(host): running sub-agent not visible on dashboard during init phase` | Bram (triage) → Felix (fix) | P2 | S+S |
| 10 | `fix(webview): preserve collapsed-group expansion state across re-renders` | Maya | P3 | S |
| 11 | `fix(webview): humanize finished elapsed-time format` | Maya | P4 | XS-S |
