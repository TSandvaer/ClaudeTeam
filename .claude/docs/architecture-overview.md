# Architecture Overview

ClaudeTeam is a **VS Code extension** that gives an accurate, real-time overview of orchestrated Claude Code agent teams. This doc is the architectural one-pager — for the full V1 product plan see [docs/V1-PLAN.md](../../docs/V1-PLAN.md).

## What it does

- Watches the local filesystem under `~/.claude/` for Claude Code session and subagent state.
- Loads a sponsor-defined **roster** (YAML) of canonical team agents.
- Matches live agents against the roster; rostered agents get named tiles, the rest collapse into a per-session noise counter.
- Renders the result in a VS Code Activity Bar webview. Updates in low-seconds.

## V1 architectural shape

```
┌────────────────────────── VS Code Extension ──────────────────────────┐
│                                                                       │
│   ┌── Extension Host (Felix's lane) ──┐    ┌── Webview (Maya's lane) ─┐
│   │                                   │    │                         │
│   │  File-watcher                     │ ─▶ │  Dashboard UI           │
│   │  ├─ poll ~/.claude/sessions/      │    │  ├─ team cards          │
│   │  ├─ tail subagent JSONLs          │    │  ├─ rostered tiles      │
│   │  └─ read meta.json                │    │  ├─ background counter  │
│   │                                   │    │  └─ drill-in            │
│   │  Roster Loader                    │    │                         │
│   │  ├─ load teams.yaml               │ ◀─ │  User interactions      │
│   │  └─ apply match rules             │    │  (click → open JSONL)   │
│   │                                   │    │                         │
│   │  State reducer                    │    │                         │
│   │  └─ post to webview               │    │                         │
│   └───────────────────────────────────┘    └─────────────────────────┘
│           ▲                                                           │
│           │ (file events)                                             │
└───────────┼───────────────────────────────────────────────────────────┘
            │
   ┌────────┴────────┐
   │ ~/.claude/      │  (Claude Code's own state, read-only)
   │   sessions/     │
   │   projects/     │
   └─────────────────┘
```

## Two-tier data plane

1. **File-watcher (always on, V1):** poll `~/.claude/sessions/*.json` every ~2s for the live session list. For each live session, materialise the agent tree from `meta.json` files and tail subagent JSONLs for current activity. Sub-3s staleness, zero load on Claude Code.
2. **Hook tap (optional, post-V1):** register a hook script in `~/.claude/settings.json` posting to a dedicated local port. Use for sub-second updates on `SubagentStart`/`SubagentStop`/`PreToolUse`. Must silent-fail on connection refused so a stopped dashboard doesn't break sessions. **NOT** on Pixel Agents' port — own channel.

V1 starts with file-watcher only. Hooks are M5+ work.

**Steady-state baseline: 100% hash-skip.** Under realistic load (M4-04 measurement: 10-min window, 3 live Claude Code sessions, 52 agents), the file-watcher poll observes a **100% hash-skip rate** — every poll tick computes hashes that match the previous tick and short-circuits before the reducer/render path. The architecture amortizes poll cost to ~zero because JSONL flushes are bursty (per [data-sources.md](data-sources.md)) and the FS-watcher catches inter-poll changes. Future cadence-tuning work should treat 100% as the *expected* steady-state baseline, not an anomaly: the poll interval is not the lever for steady-state performance work; the architecture already did the amortization. Evidence: M4-04 PR #59 (`d9b1b49`) measurement doc at `team/felix-dev/m4-04-cadence-measurement.md`.

## Process boundaries

- **Extension host** owns the filesystem: file-watcher, JSONL parsing, roster matching, state reduction.
- **Webview** owns rendering: takes state messages from the host, renders, sends UI events back.
- **`src/shared/messages.ts`** is the typed message protocol; both sides import it.

State that already exists in the extension host should NOT be duplicated in the webview. Webview-local state is for ephemeral UI concerns (hover, scroll, expanded card).

## Non-goals (V1)

- Cross-machine correlation. Single-machine local-files-only.
- Cloud/remote agents (RemoteTrigger, scheduled routines — no local artefacts to watch).
- Transcript rendering inside the webview (drill-in opens the JSONL in VS Code's native viewer).
- Agent control surfaces (start/stop/send-message — read-only V1).
- Replacing Pixel Agents. ClaudeTeam coexists with its own port (when hooks land).

### Why "talk to an agent" is harder than it looks (relay, not inject)

A recurring sponsor idea is "let me message a team agent (Felix/Maya/…) from the dashboard." A 3-agent investigation (2026-06-15) established the feasibility spectrum — capture it so future sessions don't re-derive it:

- **True live-injection into a running sub-agent is BLOCKED, three independent ways.** (1) The orchestrator's `SendMessage` tool works only because it is the *parent process* that spawned the agents — an in-process mechanism, not a file/network API. (2) The extension is a separate process and didn't spawn anything; there is no external write surface — the IDE lock file `~/.claude/ide/{pid}.lock` carries `{pid, transport, authToken}` but **no port**, and `DirectConnectTransport` in Claude Code is a separate SDK *server* mode, not a route into a live interactive REPL. (3) Claude Code hooks are **one-way** (Claude → hook), never the reverse.
- **Personas are ephemeral.** Each "Felix"/"Maya" is an `agentId` that exits when its task completes (JSONL closes with `stop_reason`). So "message Felix" realistically means "queue for the **next** Felix dispatch," not "interrupt the current one." This makes relay-not-inject the *correct* model, not just the cheap one.
- **Buildable Tier 1 = queue-and-relay through the orchestrator.** Webview input → host appends to a coordination file (e.g. a `.claude/` inbox, same pattern the orchestrator already reads `away-queue.md`/`STATE.md` with) → orchestrator folds it into the named role's next dispatch brief. ~50 lines extension-side, **zero** Claude Code changes; naturally handles "agent already exited" and "no active session" by deferring.
- **Tier 2 (stretch, fragile) = indirect live nudge** via a `FileChanged` hook emitting `hookSpecificOutput.additionalContext` — reaches the *orchestrator* session's next step only, untested for latency/reliability, and still can't target a specific persona.
- The experimental Agent-Teams mailbox (`~/.claude/teams/{team}/`, behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) is the closest *supported* Claude-to-Claude primitive, but it is session-to-session, not extension-to-agent. Prior art (Pixel Agents) is also observe-only and lists "chat with it, redirect it" as aspiration, not shipped.

## Where to look in code

The scaffold doesn't exist yet (M2 work). Expected layout:

- `src/extension/` — extension host (Felix)
- `src/webview/` — webview UI (Maya)
- `src/shared/` — types shared across both (notably `messages.ts`)
- `tests/` — vitest + integration (Sage)
- `tests/fixtures/` — captured `meta.json` / `jsonl` files from real sessions, anonymized
