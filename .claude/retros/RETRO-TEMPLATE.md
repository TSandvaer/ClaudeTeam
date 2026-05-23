# Retro Template

Copy this template to `.claude/retros/retro-YYYY-MM-DD-<scope>.md` at milestone boundaries (M1 close, M2 close, major wave close, post-incident) or whenever a cluster of merged PRs / dispatches surfaces patterns worth promoting out of conversation context.

**Why retros exist:** the dominant context-bloat surface in orchestrated projects is verbose post-mortems and pattern observations sitting in the main conversation window. A retro file PROMOTES those observations to disk, where they can be (a) referenced later without re-deriving, and (b) promoted into `.claude/docs/` / `team/log/process-incidents.md` / auto-memory if durable.

---

# Retro — <Milestone / Wave / Incident scope>

**Date:** YYYY-MM-DD
**Scope:** <one-line description — e.g. "M1 close — 11 tickets, 8 PRs merged">
**Author:** <orchestrator | Nora | etc.>

## Outcome

<2-4 sentences: what shipped, headline metrics (PRs merged, tests added, etc.), any reverts or broken-main events>

| PR | Author / scope | Merged at |
|---|---|---|
| #N | <persona> — <scope> | <SHA> |

## What went well

- **<Pattern name>** — concrete description; what observable evidence supported it.
- ...

## What went poorly

- **<Anti-pattern / failure name>** — what happened, what was the root cause, what was the cost (orchestrator time, agent re-dispatches, broken-main duration).
- ...

## Surprising findings

- **<Finding>** — what we didn't expect, what it implies for future work. These are the highest-value entries — they're the ones least likely to be captured in any other artifact.
- ...

## Patterns + anti-patterns to internalize

- **PATTERN — <name>**: <description + when it applies>. Validated by <evidence>.
- **ANTI-PATTERN — <name>**: <description + how to avoid>.

## Durable lessons promoted

- **<lesson>** → <where it went: `.claude/docs/<file>.md` section / auto-memory `feedback_*` / `team/log/process-incidents.md` entry>.

## Next-session backlog

1. <concrete action — file ticket, write follow-up PR, refine dispatch template, etc.>
2. ...

---

## How to use this template

1. **Copy to a dated file:** `cp .claude/retros/RETRO-TEMPLATE.md .claude/retros/retro-2026-05-23-m1-close.md` (or similar).
2. **Author after a milestone closes** — within the same session if possible, so context is fresh. Aim for ≤2 pages.
3. **Promote durable lessons** in the same orchestration round you write the retro:
   - **Stable pattern** → `.claude/docs/orchestration-overview.md` or another `.claude/docs/*.md` (eagerly loaded).
   - **Recurring failure mode** → append entry to `team/log/process-incidents.md` (lazy-loaded chronicle).
   - **Cross-project lesson** → auto-memory `feedback_*` entry.
4. **Cross-reference** in `team/DECISIONS.md` if the retro triggered a structural decision.
5. **Don't** repeat in the next conversation what's already in the retro — the file IS the artifact. Cite, don't paraphrase.

The retro file itself doesn't need to be context-loaded by SessionStart — it lives in `.claude/retros/` for later reference. Only the promoted lessons (the bullets you moved to `orchestration-overview.md` / memory / incidents) carry into future-session context.
