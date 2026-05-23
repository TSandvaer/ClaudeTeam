---
name: maintain-docs
description: Auto-triggered after every turn (via Stop hook) — silently reviews the turn for findings/new/altered code worth capturing in `.claude/docs/`. Spawns 3 parallel sonnet proposers + 1 sonnet consolidator, auto-applies merged doc edits, and emits output to the main thread ONLY when documentation was actually changed. Also invokable manually via /maintain-docs.
---

# Maintain Docs (auto)

Capture non-obvious knowledge from the current turn into `<PROJECT_ROOT>/.claude/docs/` so future Claude sessions start informed. This skill runs automatically after every turn via the Stop hook at `.claude/hooks/maintain-docs-stop.sh`, and is also invokable on demand.

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

**Ticket-id cites > scratch `.md` cites.** When a capture would cite a source artifact, prefer cite shapes that are durable in `git log`:

- **PREFER:** ClickUp ticket IDs, PR numbers (`PR #N`), commit SHAs, file:line refs against a known commit.
- **AVOID:** paths to scratch markdown files that aren't yet committed. These vanish on branch switch and aren't retrievable from `git log` by future readers.

## Step 2: Inventory + conversation brief

- List `<PROJECT_ROOT>/.claude/docs/` contents.
- Read the "Detailed Documentation" section of `<PROJECT_ROOT>/CLAUDE.md` to get the current index.
- Write a 200–500 word internal brief of this turn's **non-obvious** findings: architectural decisions, gotchas, constraints that surfaced, patterns validated, new systems touched. Exclude routine narration, trivial fixes, and anything already covered in existing docs.

## Step 3: Three parallel proposer agents (single message, 3 Agent calls)

Call the Agent tool 3 times **in the same message** with `subagent_type: general-purpose` and `model: sonnet`. Identical prompt for each (label them A, B, C):

```
You are proposing documentation updates for <PROJECT_ROOT>/.claude/docs/ based on a recent conversation turn.

## Conversation brief
<BRIEF FROM STEP 2>

## Existing docs inventory
<FILE LIST FROM STEP 1>

## Existing index (from CLAUDE.md "Detailed Documentation" section)
<INDEX SECTION>

## Your task — answer both questions
1. **Is the finding / new or altered code worth updating or adding to documentation?** For each candidate from the brief, decide: skip, add to an existing doc (which one and where), or warrants a new doc.
2. **How can the documentation be improved along quality, coverage, relevance?** Does the brief reveal missing coverage? Does it contradict anything stale? Any redundancy worth consolidating?

Read relevant existing docs before proposing, so you don't duplicate what is already there.

## Output format — propose only, do NOT edit files
For each proposed change, emit a block:

---
action: update | create
file: <path relative to project root>
rationale: <one sentence — why this matters for future Claude>
location_hint: <"end of file" | "after section '<heading>'" | "new section: <title>">   # update only
content: |
  <verbatim markdown to insert OR the full new file body for create>
---

If you find nothing worth changing, return exactly: NO_PROPOSALS

## Rules
- Propose only — do NOT write, edit, or touch any files.
- Do NOT touch git state.
- Do NOT modify CLAUDE.md directly (the consolidator handles the index line).
- Quality over quantity. One sharp insight beats five shallow bullets.
```

## Step 4: Consolidator agent (single sonnet agent)

Once the 3 proposers return, spawn ONE consolidator with `subagent_type: general-purpose` and `model: sonnet`:

```
You are consolidating 3 independent documentation proposals into one final plan.

## Conversation brief
<BRIEF>

## Proposal A
<AGENT A OUTPUT>

## Proposal B
<AGENT B OUTPUT>

## Proposal C
<AGENT C OUTPUT>

## Your task
1. **Identify overlaps** — same insight, same/different target files. Merge into one operation.
2. **Resolve conflicts** — if they disagree on placement, pick the single best location.
3. **Apply consensus threshold** — if only 1 of 3 flagged a borderline insight, drop it. If 2+ flagged it, keep it. A single strong, clearly-documented proposal can survive alone if the rationale is solid.
4. **Reject noise** — drop anything that feels like filler, restates existing docs, or doesn't meet the "non-obvious, reusable knowledge" bar.
5. **New docs** — only keep if content is substantive (no stubs, no placeholder outlines); filename in kebab-case; produce a one-line index entry for CLAUDE.md.

## Output format — final plan
Numbered list, each fully specified:

1. action=update
   file: <path>
   location_hint: <end of file | after section "..." | new section "...">
   content: |
     <verbatim markdown to insert>
   rationale: <short>

2. action=create
   file: <path>
   body: |
     <full file body>
   claude_md_index_line: "- [Title](.claude/docs/<filename>.md) — one-line hook"
   rationale: <short>

If the consolidated plan is empty, return exactly: NO_CHANGES
```

## Step 5: Apply the plan

If consolidator returned `NO_CHANGES` → stop silently (emit nothing to the main thread).

Otherwise, apply each operation:

- **update**: use Edit (or Write for full-file rewrites) to insert the content at the specified location. Match the existing doc's tone/structure.
- **create**: use Write to create the new file, AND use Edit on `<PROJECT_ROOT>/CLAUDE.md` to add the index line under "Detailed Documentation".
- Never touch files outside `<PROJECT_ROOT>/.claude/docs/` and `<PROJECT_ROOT>/CLAUDE.md`.
- Never run git commands, never stage, never commit.

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

- **Never commit, stage, or touch git state.**
- **Never edit files outside `.claude/docs/` and CLAUDE.md.**
- **Stay silent unless docs changed.** No start message, no no-change message — main-thread output is reserved for the Step 6 report, which only fires when docs were actually updated.
- **Quality over quantity.** Docs are trusted context; polluting them makes them worse, not better.
- **Avoid CLAUDE.md bloat.** Only add index lines for genuinely new doc files.
- **Do not re-invoke yourself.** The Stop hook's `stop_hook_active` flag prevents re-entry, but don't spawn nested maintain-docs calls either.
