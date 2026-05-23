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

## Where to look in code

The scaffold doesn't exist yet (M2 work). Expected layout:

- `src/extension/` — extension host (Felix)
- `src/webview/` — webview UI (Maya)
- `src/shared/` — types shared across both (notably `messages.ts`)
- `tests/` — vitest + integration (Sage)
- `tests/fixtures/` — captured `meta.json` / `jsonl` files from real sessions, anonymized
