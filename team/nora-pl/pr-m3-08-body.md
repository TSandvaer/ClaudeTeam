## Summary

Adds a "Main-thread narration discipline" subsection to `.claude/docs/orchestration-overview.md` § PR & merge protocol. Codifies the rule that post-auto-merge, the orchestrator posts a single-line acknowledgment to the main thread and lets `.claude/decisions-while-away.md` carry the full Decided/Foundation/Alternative/Reversibility/Status record.

## Source

- `.claude/retros/retro-2026-05-24-m2-close.md` § What went poorly "Orchestrator narration in main thread is still a context-bloat surface"
- `.claude/retros/retro-2026-05-24-m2-close.md` § Next-session backlog item 6
- Memory `feedback_session_bloat_distinct_from_project_bloat`

## Acceptance criteria

- [x] **AC1** — New subsection "Main-thread narration discipline" added to `.claude/docs/orchestration-overview.md` § PR & merge protocol (`.claude/docs/orchestration-overview.md:93`). Content covers: one-line acknowledgment post-merge; detailed rationale lives in `decisions-while-away.md`; same discipline already applied upstream to dispatch briefs.
- [x] **AC2** — Explicitly references the M2-close retro's "10-20 lines per auto-merge × 10+ per milestone" cost framing as motivation (`.claude/docs/orchestration-overview.md:99`).
- [x] **AC3** — PR diff is 8 lines total (cap: 30). Verified via `git diff --stat`.

## Done-when verification

```
grep -n "Main-thread narration discipline" .claude/docs/orchestration-overview.md
# 93:### Main-thread narration discipline
```

## Out of scope (per backlog)

- Refactor of `decisions-while-away.md` schema.
- Changes to `dispatch-template.md`.
- Tooling / automation.

## Merge class

Orchestrator-direct merge (no ClickUp ticket — `ClickUp:NO — orch-direct chore class` per backlog).

Decision draft: post-auto-merge main-thread acknowledgment is one line; full audit content lives in `decisions-while-away.md`. Codified to stop the 10-20-line-per-merge bloat measured in the M2-close retro.
