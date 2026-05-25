# Dogfood — session-tile lifecycle quirks (2026-05-25)

First V1 dogfood install. Three observations on session-tile rendering across window-reload and pane-close cycles. Filed for Bram/Felix triage — current-behavior-is-intentional is a valid outcome; this is observation, not bug claim.

## Context

- Sponsor: Thomas
- Install commit: `0bb0290` (fresh `claudeteam-0.0.1.vsix` packaged this session)
- Install method: `code --install-extension claudeteam-0.0.1.vsix --force` + window reload
- Host: Windows 11 Enterprise, VS Code (workspace = `c:\Trunk\PRIVATE\ClaudeTeam`)
- Roster: global `~/.claudeteam/teams.yaml` with `claudeteam-alpha` team (Felix/Maya/Sage/Iris/Nora/Bram)
- Live CC session at observation time: `c68d51dd` (this conversation)

## Observation 1 — Two DEAD tiles for the same session ID, different PIDs

**Screenshot 1 (immediately after window reload):**

Dashboard shows two session tiles, both with the same session ID `c68d51dd` but different PIDs:
- `SESSION c68d51dd  [claude-vscode]  pid=34528` — DEAD
- `SESSION c68d51dd  [claude-vscode]  pid=38268` — DEAD

Below them: "No live Claude Code sessions."

**Question for triage:** Is tile identity intentionally keyed by `(sessionId, pid)`, so previous PIDs accumulate as DEAD entries? If yes — that's the audit-trail design choice. If no — there's a stale-tile dedup gap.

## Observation 2 — DEAD tiles pruned over time

**Screenshot 2 (some seconds/minutes later, no user action):**

Same session ID `c68d51dd` but now showing ONE tile with `pid=35944` and no DEAD badge — the two prior DEAD tiles vanished.

**Question for triage:** What's the prune cadence? Is the timestamp-based threshold documented anywhere? If a user opens the dashboard right after a reload, they see DEAD entries; a moment later they're gone — predictable but undocumented surface.

## Observation 3 — "No live Claude Code sessions" after pane close + reopen

**Action:** Click the robot Activity Bar icon to close the ClaudeTeam pane, then click again to reopen.

**Observation:** Dashboard re-renders with "No live Claude Code sessions." displayed, despite the underlying CC session (`c68d51dd`) being verifiably alive and active (this conversation was actively running at the moment).

**Hypothesis (label per never-fabricate):** Likely a webview-disposal-and-remount race — VS Code may dispose the webview on pane close; on reopen, the webview re-initializes empty and waits for the next poll cycle (default 2000ms per `claudeteam.pollIntervalMs`) before showing data. The host may not be pushing accumulated state eagerly to a re-attaching webview.

**Question for triage:** Should the extension host serialize current state on webview disposal and replay-on-restore? Or is a sub-2s "empty splash" acceptable UX? Either is a valid call — the current behavior is undocumented.

## Observation 4 — Cross-project persona-name collision attributes agents to wrong team

After appending a second team (`embergrave-randomgame`) to `~/.claudeteam/teams.yaml` for the dogfood, sponsor opened a RandomGame VS Code workspace and clicked the ClaudeTeam pane. Dashboard immediately showed a session card with cwd `c:\Trunk\PRIVATE\MARIAN-TUTOR` labeled `TEAM embergrave-randomgame (6 rostered)` containing 6 Devon tiles — but those Devons belong to MARIAN-TUTOR's own Devon persona, not Embergrave's.

**Root cause:** the embergrave roster's matchers (`name_prefix: "devon-"`, `agentType_equals: "devon"`) are project-blind. Any agent named "devon" anywhere on disk matches the embergrave team card. MARIAN-TUTOR also has a Devon persona, so its dispatches false-attribute to embergrave.

The matcher behavior is per spec (see [.claude/docs/roster-matching.md](../../.claude/docs/roster-matching.md)) — but the **global roster location** is the wrong fit when sibling projects share persona names. Per-project `<project-root>/.claude/teams.yaml` IS cwd-scoped and avoids the collision.

**Triage question:** should the docs / package.json description recommend per-project rosters as the DEFAULT and global as the exception? The current package.json description reads "uses the default global location (~/.claudeteam/teams.yaml) with per-project fallback" — that ordering primes users toward the failure mode.

**Workaround applied 2026-05-25:** migrated both rosters from global to per-project — `c:\Trunk\PRIVATE\RandomGame\.claude\teams.yaml` + `c:\Trunk\PRIVATE\ClaudeTeam\.claude\teams.yaml`. Global file reset to a placeholder with `teams: []` and a comment explaining the policy.

## Observation 5 — Cross-workspace session visibility

Same sponsor screenshot shows sessions from THREE different workspaces simultaneously:
- `d6073874` cwd `c:\Trunk\PRIVATE\MARIAN-TUTOR`
- `81dd5643` cwd `c:\Trunk\PRIVATE\RandomGame`
- `add9b370` cwd `c:\Trunk\PRIVATE\RandomGame`
- `c68d51dd` cwd `c:\Trunk\PRIVATE\ClaudeTeam`

Per package.json default, `claudeteam.showAllSessionsGlobally: false` should restrict to sessions whose cwd matches an open workspace folder. The RandomGame window is open; the others should not show.

**Candidate causes (none investigated):**
- Sponsor enabled `showAllSessionsGlobally: true` in user settings at some point.
- The cwd-matching logic is leakier than the description suggests.
- A historical session left behind state that bypasses the filter.

**Triage:** confirm intended behavior + verify the current setting in sponsor's user config + tighten the filter if a leak is real.

## Observation 6 — Subagent liveness misclassification: idle agents shown as `finished 0s`

**Symptom (sponsor screenshot of RandomGame session `81dd5643`, 2026-05-25):** dashboard shows `Priya ×3` collapsed group with all three tiles labeled `finished`. The third tile reads `finished 0s`. Sponsor's orchestrator chat in the same window confirms the third Priya was dispatched seconds earlier ("Priya ClaudeTeam golden-nuggets mining") and is still in flight per the running orch's Update Todos.

**Ground-truth verification (orchestrator-side Bash, 2026-05-25 16:19:18 UTC):**
- Agent meta.json at `~/.claude/projects/c--Trunk-PRIVATE-RandomGame/81dd5643-1f53-46cd-8142-11fc9f774804/subagents/agent-a870af32b8f71233e.meta.json` quoted verbatim: `{"agentType":"priya","description":"Priya ClaudeTeam golden-nuggets mining","toolUseId":"toolu_01PXZDL7TF9Vk5838tb6Cwah"}`
- Agent JSONL's last line at check time: assistant message timestamped `2026-05-25T16:18:45.503Z` with text `"I have enough to write the findings doc + tight final report."` — 33 seconds before the check.
- JSONL mtime ~78s old at check time. Agent was between actions but actively planning the next write.
- Agent's own JSONL has no closing artifact (consistent with [data-sources.md § JSONL closing semantics](../../.claude/docs/data-sources.md) — agent JSONLs never carry a closing assistant message; the closing tool_result lives in the parent. Orchestrator did not grep the full parent JSONL to confirm tool_result absence — speculative on that one specific datum).

**Root-cause hypothesis (label per never-fabricate — not patch-confirmed):** dashboard liveness inference appears to collapse the spec'd `idle` state into `finished` when both:
- JSONL mtime > ~10s (so `running` predicate per [data-sources.md § Liveness inference](../../.claude/docs/data-sources.md) doesn't fire), AND
- Parent has not yet received closing `tool_result` for the agent's `toolUseId` (so `finished` predicate SHOULDN'T fire either).

Per spec, that case should resolve to `idle`. Dashboard appears to default to `finished` with elapsed-time measured against an absent completion timestamp, producing the `0s` figure.

**Connection to earlier symptom in same session:** ~5 min before this screenshot, sponsor reported "Priya is supposed to be working but I can't see it" — orch had dispatched a Priya whose meta.json was on disk but whose tile was missing from the dashboard. Same root cause: while JSONL was fresh (<10s) the `running` predicate fired and the tile rendered; when JSONL went stale during a long thinking turn, the tile fell into the misclassified-finished bucket. Earlier sponsor observation = no tile visible; this observation = tile visible but mislabeled `finished 0s`. Both are the same gap.

**Triage:** state-detection in the reducer likely needs an explicit `idle` branch (or a different default when neither `running` nor `finished` predicates fire). Affects every long-thinking turn or slow-flush window — common during audit/analysis dispatches that reason for tens of seconds before the next tool call.

## Observation 7 — Sponsor preference: hide-finished agents from dashboard view (noise reduction)

**Class:** UX preference / feature request. Distinct from Observation 6 (bug-class: wrong state label). Obs 7 is feature-class: state label may be correct, but sponsor doesn't want to see finished items at all (or wants the option not to).

**Source (sponsor chat 2026-05-25, verbatim):** *"i dont [want] to see idle agents, or at least i want a toggle not to show idle"*. Said while viewing the RandomGame dashboard with `TEAM embergrave-randomgame (3 rostered)` showing 6 visible tiles (`Priya ×4` collapsed + Devon `finished 16s` + Drew `finished 16s`) while 3 NEW dispatches had just fired (visible in the orchestrator's right pane "Dispatched in parallel" table: Drew agent `a1f29601...`, Devon `aaf8d5352...`, Priya `a4d39d9fb...`). The OLD finished tiles cluttered the view; the NEW running tiles either weren't yet visible or collapsed into existing persona groups.

**Three plausible implementation shapes** (sponsor did not state a preference among them):
1. **Config toggle** — `claudeteam.hideFinishedAgents: boolean` (default `false`). Discoverable via VS Code Settings. Opt-in.
2. **Default-hide with reveal** — finished tiles hidden by default; UI control re-exposes them on demand. More opinionated default but matches sponsor's stated preference.
3. **Auto-expire** — finished tiles fade out after N seconds (configurable, e.g. 30s default). Preserves "I just saw it complete" affordance while reducing long-term clutter.

Combinations are possible (toggle controlling whether auto-expire is enabled, etc.).

**Triage:** Iris (UX shape) + Felix (extension-host filtering / config wiring) + Maya (webview rendering of filtered view). Filed as separate ticket from `86c9yteju` because feature-class triage path differs from bug-class.

## Repro

1. Install vsix: `code --install-extension claudeteam-0.0.1.vsix --force`
2. Reload window in a workspace where you have a live CC session active.
3. Open the ClaudeTeam pane immediately.
4. Observe DEAD-tile state. Wait. Observe pruning.
5. Close the pane (click robot icon). Reopen. Observe state.
6. (For Obs 4+5) — open a second workspace in another VS Code window, ensure its project has a persona name that collides with another rostered project. Observe team-card attribution + global session visibility.

## Acceptance for triage

Bram / Felix to:
1. Confirm whether each observation is intentional or a defect.
2. For intentional: add a one-paragraph note to `vscode-extension-conventions.md` or `data-sources.md` covering the tile-identity-keying rule + prune cadence + webview-disposal contract.
3. For defects: open follow-up implementation tickets, sized appropriately.

## Out of scope

- Roster-matching behavior — not exercised here (current session has no rostered Agent dispatches at observation time).
- Polling cadence tuning — already validated in M4-04.
- Marketplace publication scope — separate post-V1 milestone.

## Pointer

ClickUp ticket: filed under post-V1 dogfood backlog, references this file as the canonical artifact.
