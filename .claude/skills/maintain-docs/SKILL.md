---
name: maintain-docs
description: Auto-triggered after every turn (via Stop hook) — silently reviews the turn for findings/new/altered code worth capturing in `.claude/docs/`. Spawns 3 parallel sonnet proposers + 1 sonnet consolidator, auto-applies merged doc edits, and emits output to the main thread ONLY when documentation was actually changed. Also invokable manually via /maintain-docs.
---

# Maintain Docs (auto)

Capture non-obvious knowledge from the current turn into `<PROJECT_ROOT>/.claude/docs/`. Auto-fires via the Stop hook at `.claude/hooks/maintain-docs-stop.sh` (which itself early-exits silently on tick-class turns — see ticket `86c9z1wrh` + the hook's header).

## Step 0: Visibility policy (read first)

- **Run silently by default.** Do NOT emit a start message; do NOT emit a no-change message. The user does not need to know on every turn that the hook fired.
- Emit output to the main thread ONLY when documentation was actually changed (see Step 6).
- Subagent spawns and tool calls are fine — they appear in the trace but do not bloat the main thread message log.

## Step 1: Early-exit filter

Skip the rest of the skill and end silently if this turn was:

- A greeting, acknowledgment, or trivial clarification
- Pure Q&A with no code changes and no architectural conclusions
- A routine edit with no surprise, constraint, or design decision surfaced
- Tool-only exploration (reads/greps) where nothing new was concluded
- A task that simply repeats patterns already covered in existing `.claude/docs/`
- An orchestration tick (heartbeat, dispatch announcement, ticket-status flip) without a code/architecture change — the orchestrator's own activity log is captured by memory + session state, not docs

The bar is high: most turns fail this filter. Only continue when the turn produced a non-obvious insight, a new feature area, a gotcha, or a validated pattern future Claude would benefit from knowing cold.

**Unmerged-API defer rule.** Even if the early-exit filter doesn't fire, captures that would cite a function / API / file / commit only present on an UNMERGED feature branch should DEFER until the parent PR merges. The alternative is to keep the proposal but tag it explicitly as "pending PR #N merge" so peer-reviewers know the cite cannot be verified against `main` yet.

**Ticket-id cites > scratch `.md` cites.** PREFER durable `git log`-retrievable shapes — ClickUp ticket IDs, `PR #N`, commit SHAs, file:line against a known commit.
AVOID paths to uncommitted scratch markdown — they vanish on branch switch and are not retrievable by future readers.

## Steps 2–5: Brief → proposers → consolidator → apply

1. **Inventory + brief.** List `.claude/docs/`, read CLAUDE.md's "Detailed Documentation" index, draft a 200–500 word internal brief of the turn's non-obvious findings (excl. routine narration and existing-doc coverage).
2. **3 parallel proposers** — Agent tool, 3 calls in one message, `subagent_type: general-purpose`, `model: sonnet`. Each receives the brief + inventory + index and emits `update | create` blocks with `file`, `rationale`, `location_hint`, and verbatim `content`. They DO NOT edit files / touch git / modify CLAUDE.md directly. Return `NO_PROPOSALS` when nothing qualifies.
3. **1 consolidator** — sonnet agent merges overlaps, resolves placement conflicts, applies the consensus threshold (drop borderline 1-of-3 picks; keep 2-of-3+), rejects noise/restated/sub-bar items. Returns a numbered plan with `action`, `file`, `location_hint`/`body`, `content`, optional `claude_md_index_line`, `rationale` — or `NO_CHANGES`.
4. **Apply.** `NO_CHANGES` → stop silently. Else Edit (insert) or Write (full-file / new doc); `create` actions also Edit CLAUDE.md to add the index line under "Detailed Documentation". Never touch files outside `.claude/docs/` and CLAUDE.md. Never run git commands.

## Step 6: Report (only if changes were applied)

Emit exactly this shape, nothing else:

```
Documentation updated based on this turn's findings:
- <file> — <short rationale>
- <file> — <short rationale>
```

No preamble. No "I'll now...". No closing. No summary of what the skill did — only the list of changed files and why.

When no changes were applied, emit NOTHING to the main thread.

## Guardrails

Never commit/stage/touch git state. Never edit files outside `.claude/docs/` and CLAUDE.md. Quality over quantity — pollution makes docs worse. Avoid CLAUDE.md bloat — index lines only for genuinely new doc files. Do not re-invoke yourself; the `stop_hook_active` flag prevents re-entry.
