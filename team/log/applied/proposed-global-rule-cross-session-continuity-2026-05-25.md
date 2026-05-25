# Proposed global rule — Cross-session orchestrator continuity discipline

**Status:** staged — orchestrator cannot self-edit `~/.claude/CLAUDE.md` per memory `[[classifier-blocks-self-mod-of-orch-autonomy]]`. Sponsor reads + applies on return.

**Path of intended edit:** `C:\Users\538252\.claude\CLAUDE.md` (user-global, applies to ALL orchestrated projects on this machine).

**Authored:** 2026-05-25 by ClaudeTeam orchestrator after a session-restart this morning exposed gaps in cross-session continuity (sponsor's question: *"can this be prevented or helped in some way?"*).

---

## The incident (concrete trigger)

ClaudeTeam session 2026-05-24/25, M3 Wave 1 close:

1. Orchestrator dispatched Felix + Maya on M3-10 (`86c9ydug9`) as `run_in_background: true` Agent tasks.
2. Session ended between turns — cause unknown to the orchestrator (sponsor closed VS Code window, auto-compact, crash — no observable signal distinguished them).
3. On SessionStart, hook re-armed auto-status. Orchestrator confirmed worktrees at `b198403` (the orch commit just BEFORE the M3-10 dispatch) — Felix + Maya had NOT pushed any work before the session died. Zero code lost; re-dispatch from scratch was cheap.
4. Sponsor asked **"can this be prevented or helped in some way?"** — exposing that the resume relied on patient re-derivation from worktrees + ClickUp + STATE.md, not a documented checklist. Lucky outcome (no work lost) masked a real fragility.

**What does NOT survive a session restart:**
- In-flight background Agent tasks (die with the session — confirmed this incident)
- The cron job created by CronCreate (session-scoped per CronCreate docs: "Jobs live only in this Claude session")
- Mid-conversation context not yet persisted to disk (drafted briefs, in-flight decisions, sponsor observations expressed in chat but not yet written down)
- Background Bash poll tasks

**What DOES survive (the existing recovery scaffolding):**
- Project doc preload via SessionStart hook (architecture, data-sources, roster-matching, testing-strategy, orchestration-overview, vscode-extension-conventions, CLAUDE.md, V1-PLAN)
- Auto-status mode + last_tick (state file persisted via gitignored disk file)
- Memory entries (project + user-global)
- ClickUp ticket statuses + GitHub PR states (live via MCP / `gh`)
- Coordination docs: `team/STATE.md`, `team/log/clickup-pending.md`, `team/log/process-incidents.md`, `.claude/decisions-while-away.md`, `team/DECISIONS.md` — all on disk + git
- Worktree branches + commits — git
- Backlogs — `team/nora-pl/milestone-*-backlog.md`

**Residual gap:** sponsor-expressed observations / decisions / preferences that lived only in chat scrollback because orchestrator hadn't persisted them yet by the time the session ended. The wake-discipline rule (staged 2026-05-24) covers in-session wake signals; this rule covers cross-session continuity.

---

## The proposed global rule

Add to `~/.claude/CLAUDE.md` as a new top-level section, naturally after the "Orchestrator wake-signal discipline" section (once that's also applied):

```
## Cross-session orchestrator continuity discipline

When an orchestrator session ends unexpectedly (window close, auto-compact,
crash) or expectedly (sponsor stepping away), the NEXT session must be
able to resume cleanly from on-disk state alone — without re-deriving
intent from chat scrollback. Three disciplines together cover this:

### 1. STATE.md "Resume next-action" header

The first line of `<project>/team/STATE.md` (or equivalent project state
doc) is a single sentence: **"If this session dies right now, the next
orchestrator should do X next."** Updated on every dispatch / merge /
material decision. SessionStart resume reads this FIRST, before re-
deriving from worktrees + ClickUp + git log.

Examples:
- "Felix + Maya in flight on M3-10 (agentIds afbefdae / a25a7b44); on
   resume, check worktrees first — if no branches pushed, re-dispatch
   fresh."
- "Awaiting Maya's verdict on PR #41; merge after APPROVE; cron has
   not yet processed Sage's M3-09 completion."
- "Quiet — no agents in flight, no PRs open; next dispatch is M3-04
   NITs but sponsor has not yet authorized."

The header is ALWAYS current OR ALWAYS-NOT-PRESENT. Never stale. If
the orchestrator is between turns and uncertain what's next, the
header says "Idle; next action depends on <event>." Honest > confident-wrong.

### 2. Sponsor-feedback immediate-persistence

When the sponsor expresses a non-trivial observation, preference, or
decision in chat that isn't already in a file, the orchestrator MUST
persist it BEFORE acting on it. Targets:

- **Durable preferences applying to future sessions** → memory entry
  (project-scoped or user-global per scope of the preference)
- **Team-level decisions** → `team/DECISIONS.md` (append-only)
- **Current-state-relevant observations** → STATE.md (current header)
- **Action items the team needs to track** → ClickUp ticket
  comment (or new ticket if scope warrants)
- **Process-class failures observed** → `team/log/process-incidents.md`

Failure mode this prevents: sponsor says "X is a recurring annoyance,
let's track it" or "from now on do Y instead of Z." Orchestrator
acknowledges and acts — but never writes it down. Session dies; next
orchestrator never sees the feedback and the discipline regresses.

The discipline costs ~10 seconds per qualifying turn. It pays for
itself the first time a session restart preserves a hard-won sponsor
insight.

### 3. Proactive /save-session at risk signals

When the sponsor signals stepping away with intent to resume later
("going to sleep", "saving state", "let's pick this up tomorrow",
"closing the window", "stopping for now", etc.), the orchestrator
MUST invoke `/save-session` automatically BEFORE acknowledging the
signal — without waiting for the sponsor to type the command.

`/save-session` promotes durable insights to memory, writes a
structured state file capturing current task / files / decisions /
next-steps, and returns a paste-ready one-liner for resume. Even if
the sponsor doesn't end up using the one-liner, the memory promotion
and state file persist sponsor observations and current intent across
the session boundary.

Trigger phrases (case-insensitive, any of):
- "going to sleep" / "going to bed" / "good night" / "goodnight"
- "stepping away" / "stepping out" / "be back later"
- "saving state" / "save session" / "save state"
- "closing for the day" / "stopping for now" / "stopping here"
- "see you tomorrow" / "see you later" / "pick this up tomorrow"
- "I'll come back" / "I'll be back" with any time hint

If the sponsor signal is ambiguous (e.g., just "afk for a minute"),
DO NOT save — wait for explicit closure signal. False positives waste
the cache window; missed positives lose insights.

**Why:** ClaudeTeam session 2026-05-24/25 — orchestrator was asked
"can this be prevented or helped in some way?" after a session-
restart re-derived state from scratch. Background Agent tasks
(Felix + Maya on M3-10) died with the session. Zero code lost this
time (agents hadn't pushed yet), but the close-call exposed that
resume relied on patient re-derivation, not a documented checklist.
Sponsor observations in chat scrollback were the residual gap.

**How to apply:** Every orchestrator dispatch / merge / material
decision triggers a STATE.md "Resume" header refresh (discipline 1).
Every non-trivial sponsor observation triggers immediate persistence
to the right target before action (discipline 2). Every step-away
signal triggers /save-session before acknowledgment (discipline 3).
Treat all three as ONE discipline — cross-session continuity is the
goal; the three are the mechanisms.
```

---

## Companion entry for `team/log/process-incidents.md`

Append (newest first) after the existing bash-background entry — see entry `## 2026-05-25 — Session restart with in-flight Agents — lucky-no-loss outcome exposed cross-session continuity gap`.

---

## How to apply this staged diff

When sponsor is back at the machine and ready to update global instructions:

1. Open `C:\Users\538252\.claude\CLAUDE.md`
2. Find the "Orchestrator wake-signal discipline" section (once applied per `team/log/proposed-global-rule-wake-discipline-2026-05-25.md`)
3. Insert the new "Cross-session orchestrator continuity discipline" section AFTER it
4. Optionally update memory entry `[[classifier-blocks-self-mod-of-orch-autonomy]]` to note this as the third known staged-diff-then-apply pattern (after rule 6.6 additions on 2026-05-24 and wake-discipline on 2026-05-25)
5. Delete this staged file or move it to `team/log/applied/proposed-global-rule-cross-session-continuity-2026-05-25.md` as audit trail

---

## Cross-references

- Memory: `[[classifier-blocks-self-mod-of-orch-autonomy]]` — pattern this doc follows
- Staged: `team/log/proposed-global-rule-wake-discipline-2026-05-25.md` — earlier staged rule (in-session wake signals); this rule is its cross-session counterpart
- Project doc: `team/log/proposed-rule-6.6-additions-2026-05-24.md` — prior staged-diff precedent (now applied)
- Skill: `/save-session` (global) — the mechanism discipline 3 invokes
- Process incident: 2026-05-25 entry in `team/log/process-incidents.md` (companion)
