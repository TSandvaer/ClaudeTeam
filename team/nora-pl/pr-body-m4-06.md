## Summary

Closes M4 (and V1) with a two-part deliverable in a single file at `.claude/retros/retro-2026-05-25-m4-close.md`:

1. **M4 retro** per `RETRO-TEMPLATE.md` sections — Outcome / What went well / What went poorly / Surprising findings / Patterns + anti-patterns / Durable lessons / Next-session backlog. Covers M4-01 through M4-05 + the never-fabricate rule propagation PR (#55) that shipped this milestone.
2. **V1 close cross-arc retrospective** appended in the same file (Nora's call per backlog M4-06 scope option) — What V1 shipped / What changed across M1→M4 / What stayed stable / What failure modes recurred / What shipped vs deferred / V1 ship-list / V2 candidate-list / Closing note.

## Source

- ClickUp ticket: `86c9ygcmj` (`retro(m4): V1 close — milestone retro + cross-V1-arc retrospective`)
- Backlog: `team/nora-pl/milestone-4-backlog.md § M4-06` (AC1–AC7)
- Template: `.claude/retros/RETRO-TEMPLATE.md`
- Prior retros: `.claude/retros/retro-2026-05-23-m1-close.md`, `retro-2026-05-24-m2-close.md`, `retro-2026-05-25-m3-close.md`

## Headline metrics (sourced — anti-fabrication)

- **PRs covered:** PR #52 (`3cd8c2a`), #53 (`06d53f2`), #54 (`2913479`), #55 (`501dadc`), #56 (`80d02bf`), #57 (`b61c02c`), #58 (`55e4140`), #59 (`d9b1b49`) — verified via `git log --oneline origin/main -25`.
- **Main tip at retro authoring:** `d9b1b49` (PR #59 M4-04 squash-merge).
- **Tests at M4 close:** 386 passing unit + 2 skipped + 68 integration + 23 Layer-3 = **477 passing** (M4 net delta +33 over M3 close's 444 — sourced from Maya's PR #59 verification block + Felix's PR #59 body).
- **Auto-decide cumulative track record across V1:** 31 auto-merges, 0 reversals (M1 + M2 + M3 + M4 sources: prior retros).
- **Discipline rules added this milestone:** 0 (rate converging to zero — M3 produced 5 in crisis-driven authoring; M4 incident-free at orchestration layer).

## Acceptance criteria (per backlog § M4-06)

- **AC1** — Retro file exists at `.claude/retros/retro-2026-05-25-m4-close.md`. ✅ (275 lines).
- **AC2** — Standard `RETRO-TEMPLATE.md` sections present (What went well / What went poorly / Anti-patterns / Durable lessons / Next-session backlog). ✅ — 7 M4 retro sections + 5 V1 cross-arc sections + closing note (13 `## ` headers total verified via `grep -E "^## "`).
- **AC3** — V1 close cross-arc section exists (in same file). ✅ — `## What V1 shipped`, `## What changed across M1 → M2 → M3 → M4`, `## What stayed stable`, `## What failure modes recurred across milestones`, `## What shipped vs deferred`.
- **AC4** — V1 ship-list: one sentence per merged ticket M1–M4 (~50 entries enumerated under § "V1 ship-list").
- **AC5** — V2 candidate-list: enumerated with one-line rationale + S/M/L cost. 14 candidates listed; marketplace publication called out as headline deferral.
- **AC6** — Durable lessons promoted: cited which lessons promote to `.claude/docs/` and which are cross-project memory candidates. Specific candidates:
  - `scripts/` triple-edit pattern → `vscode-extension-conventions.md`
  - tsx-vs-production heap caveat → `testing-strategy.md`
  - 100% hash-skip steady-state baseline → `architecture-overview.md`
  - Iris-leads-decomposes-parallel-zones (3× validated) → `orchestration-overview.md`
  - Self-referential proof in discipline-PRs → cross-project memory `[[discipline-pr-self-referential-proof]]`
  - Measurement-class anti-fabrication framing → cross-project memory `[[measurement-class-anti-fabrication-framing]]`
  - 31/31 auto-decide track record → cross-project memory `[[auto-decide-v1-track-record]]`
- **AC7** — Next-session backlog enumerates: heap-probe follow-up (Felix M4-04 NIT), outstanding ticket reassessments, maintain-docs candidates from PR #59, decisions-log batch PR, marketplace milestone kickoff, cross-project porting candidates, AWAY cadence revisit.

## Out of scope (per backlog)

- Marketplace publication work (separate post-V1 milestone).
- New ticket authoring for V2 (just candidate-list; full V2 plan is its own deliverable).
- Code changes (docs-only).

## Webview-smoke / extension-manifest gate

- Webview-smoke gate: NO (docs-only).
- Extension-manifest gate: NO (docs-only).

## ClickUp lifecycle

- `86c9ygcmj` flipped `to do → in progress` on dispatch (orch-side).
- `to do → in review` queued in `team/log/clickup-pending.md` ENTRY-2026-05-25T09:00:00Z + T09:00:01Z (sub-agent runtime lacks `mcp__clickup__clickup_update_task`).

## Decision drafts (for next weekly DECISIONS.md batch)

- **Decision draft:** V1 closed with the four-milestone arc shape (data → scaffold → config → polish) intact; M5+ projects can reuse this milestone shape as a template.
- **Decision draft:** Iris-leads-with-spec sequencing decomposes parallel-safe ownership zones beyond just producing good visual decisions — promoted to `.claude/docs/orchestration-overview.md` § Dispatch patterns (candidate).
- **Decision draft:** Cumulative auto-decide 31/31 (0% reversal) across V1 validates rule 6.6 promoted classes as well-calibrated; no further class-promotion needed at V1 close.
- **Decision draft:** Marketplace publication deferred post-V1 to its own milestone; V1 dogfooding informs scope/timing.
- **Decision draft:** M4-04 verdict "keep `pollIntervalMs: 2000`; no adaptive cadence; follow-up extension-host heap probe recommended" — ratify the empirical decision.

## Reviewer

Orchestrator-direct (Nora-domain retro per project convention; same pattern as M1/M2/M3 close PRs #16, #31, #49).

## Files in play

- `.claude/retros/retro-2026-05-25-m4-close.md` (new, 275 lines)
- `team/log/clickup-pending.md` (M4-06 status flip queue entries + in-extension-host heap probe NEW-TICKET-REQUEST block)

## Anti-fabrication contract — self-referential proof

Every concrete value in this PR body is sourced:
- Commit SHAs from `git log --oneline origin/main -25` run in the worktree.
- Section counts from `grep -E "^## " .claude/retros/retro-2026-05-25-m4-close.md` run in the worktree.
- Line count from `wc -l .claude/retros/retro-2026-05-25-m4-close.md` = 275.
- Test totals + cumulative auto-decide track record sourced from PR #59 body table + prior retros' Outcome sections (M1: 130 → M2: 278 → M3: 444 → M4: 477).
- ClickUp ticket ID `86c9ygcmj` quoted from the dispatch brief.
- No URLs / IDs / SHAs invented or extrapolated.

## Self-Test Report

- **Verdict:** PASS — retro file authored to template + AC1–AC7 all met. Cross-arc V1 close retrospective produced as the second deliverable.
- **PR URL:** filled in after open.
- **Blockers:** none.
- **Doc updates this PR:** `.claude/retros/retro-2026-05-25-m4-close.md` (new) + `team/log/clickup-pending.md` (status flip queue + heap-probe NEW-TICKET-REQUEST block).
- **Doc updates flagged for follow-up** (per AC6 + Next-session backlog): three `.claude/docs/*.md` promotions (vscode-extension-conventions.md, testing-strategy.md, architecture-overview.md) + `orchestration-overview.md` § Dispatch patterns + three cross-project memory candidates. These promotions are themselves Next-session-backlog items, not in scope for this PR.
