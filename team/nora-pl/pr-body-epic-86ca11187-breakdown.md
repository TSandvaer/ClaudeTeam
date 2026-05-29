## EPIC 86ca11187 breakdown — whole-team-always-visible dashboard

Breaks EPIC `86ca11187` into 9 dispatch-ready child tickets (E-01..E-09). No code — planning + coordination artifacts only.

### Artifacts authored
- **`team/nora-pl/epic-86ca11187-backlog.md`** (new) — 9 tickets, each with title / ACs / OOS / done-when / owner-lane / size / priority / files-in-play / design-dependency + dependency note. Sequencing section at top.
- **`team/DECISIONS.md`** — sequencing decision (2026-05-29): which tickets are design-independent (E-01, E-02) vs design-dependent (E-03 gate → E-04/05/06/07/08; E-09 spans).
- **`team/log/clickup-pending.md`** — ClickUp create+flip requests for the 9 tickets (Nora's sub-agent runtime has no `mcp__clickup__*` surfaced — orchestrator creates).
- **`team/STATE.md`** — Resume header + Nora run-log updated.

### Sequencing (the load-bearing call)
- **DESIGN-INDEPENDENT — dispatch NOW:** E-01 (Felix, reducer full-roster baseline tiles — root cause verified `src/extension/state/reducer.ts:152-266`) + E-02 (Maya, session-title prominence — data already on wire via `resolveSessionLabel`, hierarchy/CSS fix only).
- **E-03 (Iris design spec)** dispatchable in PARALLEL (worktree free, no PixelLab conflict); gates Wave 1.
- **DESIGN-DEPENDENT — await E-03:** E-04 persona sprites, E-05 baseline skin, E-06 hide agent, E-07 remove agent, E-08 DEAD toggle, E-09 QA.

**Recommended dispatch order:** Wave 0 (E-01+E-02+E-03 parallel) → Wave 1 (E-04+E-05+E-06; Pattern A sequence E-01→E-05 for the shared baseline-state vocabulary) → Wave 2 (E-07+E-08) → Wave 3 (E-09 QA → epic close).

### Decision draft (for next DECISIONS.md batch)
`Decision draft:` EPIC 86ca11187 sequenced design-independent (E-01 reducer baseline + E-02 session-title) ahead of the Iris spec; E-03 spec parallel; full rationale in DECISIONS.md 2026-05-29.

### Open sponsor question (queued to orchestrator)
**E-08 DEAD-card hide toggle: IN or OUT for this epic?** Nora recommends OUT/defer — the dead window is transient (file-driven prune via FS-watcher `onDidDelete` already handles it). If OUT, E-03 §4 collapses to a one-line note.

### Reviewer
Nora coordination-doc PR → orchestrator-merge direct (touches shared coord docs DECISIONS.md/STATE.md/clickup-pending.md, per PR routing).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
