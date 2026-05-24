# Away Queue — Sponsor Sign-Off Required

Items the orchestrator deliberately did NOT auto-decide. These require the sponsor's input before any action proceeds.

The orchestrator queues here when a decision falls into the never-auto-decide list (user-global CLAUDE.md):

- Strategic priority shifts (which milestone ships next, scope cuts, pivots, sequence changes, deferrals of in-flight work).
- Subjective-feel calls (visual polish, character voice, copy tone, motion feel, design aesthetic).
- Externally-visible actions (Teams/Slack posts, force-push, force-reset, deletes, force-merge, anything sent to third parties).
- Billing, credit usage, or infrastructure-config changes (Vercel, Azure, cloud accounts, secrets).
- Anything where the only "foundation" is the orchestrator's own confidence.

## Entry schema

Each entry uses an `## YYYY-MM-DD HHMM UTC — <one-line headline>` heading and includes:

- **Question:** what specifically needs sponsor input
- **Context:** what triggered this and what's currently blocked on the answer
- **Options:** the candidate answers the orchestrator considered, with one-line trade-offs each
- **Orchestrator recommendation:** the option the orchestrator would pick if forced, with rationale
- **Status:** `pending` initially; user updates to `answered <date>: <decision>` on return.

---

## Open items

<!-- New entries are appended below this line. -->

## 2026-05-24 0820 UTC — Permission-rule for `mcp__clickup__update_task` on pre-existing tickets?

**Question:** Should the project's `.claude/settings.json` (or sponsor's user-global settings) carry a permission rule that allows `mcp__clickup__update_task` writes unconditionally — so the orchestrator can flip ClickUp ticket statuses across session boundaries without per-action denials?

**Context:** Auto-mode classifier blocked the orchestrator's `mcp__clickup__update_task` on two ticket flips today, both involving tickets categorized as "pre-existing" (created in a prior Claude-process session): (1) `86c9y7y9z → complete` after sponsor's Path Y duplicate-absorption decision (sponsor chose to leave at `to do` rather than authorize); (2) `86c9y9q6h → in review` after Felix's PR #28 opened (orchestrator must own this flip per CLAUDE.md hard rule #5). Failure mode captured in `.claude/docs/orchestration-overview.md` § Common failure modes as the 12th bullet. The `86c9y9q6h → in review` flip currently relies on Felix's `team/log/clickup-pending.md` ENTRY 026 fallback (sub-agent queueing pattern) — will be processed in the merge-flip pair when PR #28 merges, but means the board is temporarily showing `in progress` even though the PR is open.

**Options:**

- **Option A — add `mcp__clickup__update_task` to the allow-list in project `.claude/settings.json`.** Orchestrator can flip any ticket status without prompt. Project-scoped (only affects ClaudeTeam). Trade-off: gives the orchestrator one fewer human-in-the-loop checkpoint on a class of externally-visible action.
- **Option B — add `mcp__clickup__*` writes to sponsor's user-global settings.** Broader scope (affects every orchestrated project using ClickUp). Same trade-off as A but with wider blast radius.
- **Option C — leave as-is.** Every cross-session ticket flip becomes a sponsor-prompt or relies on the `clickup-pending.md` fallback (sub-agent queue + merge-flip pair). Trade-off: slower orchestration; some ticket-status latency between PR open and ticket flip; sponsor stays in the loop on every status change.

**Orchestrator recommendation:** **Option A.** Project-scoped is the right blast radius; the orchestrator's status flips ARE the same external action as the dispatch / PR-open / merge they pair with (which already proceed without prompt). The classifier's session-boundary heuristic makes a category mistake on `mcp__clickup__update_task` calls that are themselves the well-understood orchestrator workflow CLAUDE.md hard rule #5 mandates.

**Status:** **answered 2026-05-24: Option A.** `mcp__clickup__update_task` added to project `.claude/settings.json` allow array; verified by retrying the previously-denied `86c9y9q6h → in review` flip immediately after the settings change (succeeded). Failure-mode bullet in `.claude/docs/orchestration-overview.md` § Common failure modes remains as historical reference but should be marked as resolved-by-permission-rule in a future doc pass.

---

## 2026-05-23 1330 UTC — M2/M3 scope-overlap: absorb roster-render into M2, or keep hardcoded per V1-PLAN?

**Question:** V1-PLAN.md M2 says "Extension scaffold — VS Code extension showing M1 data in a hardcoded webview"; M3 says "Roster config — Load `teams.yaml`, apply matchers, render named tiles vs background bucket". But the roster matcher already shipped in M1 (M1-08, on main). So the M2 webview can either (A) skip the hardcoded-strings interim and consume the live matcher output directly, OR (B) stay literally hardcoded per V1-PLAN's letter and defer matcher consumption to M3. The M2 backlog Nora authored (`team/nora-pl/milestone-2-backlog.md`, merged in PR #16) is written for **Option A** but flags this decision explicitly.

**Context:** This blocks creating the M2 ClickUp tickets and dispatching the first M2 wave. Bram's prior-art research (M2-02) and Iris's M2 tile spec (M2-03) can proceed regardless of the answer — they're both pre-render. But the M2-04 (file-watcher) and M2-05 (webview message protocol) scopes diverge between A and B.

**Options:**

- **Option A — absorb M3's render into M2 (orchestrator's recommendation).** M2 webview consumes live matcher output via the M1 reducer; M3 collapses (since its work is mostly already done). Pro: saves one milestone-cycle of throwaway hardcoded-strings work; ships a real-roster dashboard 1 milestone sooner. Con: M2 ticket count goes from 9 → ~9 (no change — already written for A); M2 effort estimate moves from "1 day" to "1.5 days" (per V1-PLAN's table, M3 was "1-2 days"). Net: ~0.5-1 day saved.
- **Option B — keep hardcoded per V1-PLAN's letter.** M2-04 + M2-05 narrow to hardcoded-strings rendering; M3 stays in V1-PLAN as the roster-render milestone. Pro: matches the V1-PLAN exactly; cleanly separates "scaffold works" from "roster works." Con: M2's webview becomes a throwaway visual that gets thrown out at M3-start. Forces a re-author of the dashboard tile in M3.

**Orchestrator recommendation:** **Option A.** The matcher's already on main; making M2 throw it away just to honor V1-PLAN's table-row separation is mechanical churn without proportional benefit. M1's `npm run agent-tree` already proves the matcher works end-to-end against real `~/.claude/` data. M2's webview should consume the same reducer output, just rendered in a Webview panel instead of stdout.

**Status:** **answered 2026-05-23: Option A** — sponsor confirmed orchestrator's recommendation. Wave 0 dispatch unblocked. M3 milestone renamed to "Roster config + live refresh" to reflect reduced scope (per Nora's backlog § scope-overlap note decision draft).

**Pointers:** [PR #16 M2 backlog](https://github.com/TSandvaer/ClaudeTeam/pull/16); `team/nora-pl/milestone-2-backlog.md` § AC9 / scope-overlap callout; `docs/V1-PLAN.md` § V1 milestones table; M1 retro `.claude/retros/retro-2026-05-23-m1-close.md` § "Next-session backlog" item 1.
