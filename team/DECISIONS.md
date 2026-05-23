# Decisions Log

Append-only chronicle of team-level decisions on ClaudeTeam. One decision = one entry. Newest at the top. Decisions LIVE here on disk — they do not persist in conversation memory.

**Scope:** project-level / process-level decisions that affect future sessions or other roles. Not for code-level micro-decisions (those live in commit messages and PR bodies).

**Distinction from `.claude/decisions-while-away.md`:** that file captures autonomous orchestrator decisions made under user-global "Orchestrator autonomy" gates, with status tracking (`pending review` / `accepted` / `reversed`). This file (`team/DECISIONS.md`) is the broader team chronicle — including decisions the sponsor made directly, structural choices ratified in conversation, retro-driven changes, etc. An entry can cross-reference a decisions-while-away entry when applicable.

**Entry format:**

```
## YYYY-MM-DD — <one-line decision headline>

**Decided:** <what>
**Context:** <why this came up>
**Alternative considered:** <what we didn't pick + why>
**Implication:** <what changes downstream>
**Reversibility:** <how to undo + cost>
**Pointers:** <PR / file:section / memory-name / conversation reference>
```

Append below. Newest entries at the top.

---

## 2026-05-23 — Adopt RandomGame-style bloat-prevention bundle (this session)

**Decided:** Import three coordination patterns from RandomGame + MarianLearning that ClaudeTeam was missing: (1) `team/log/process-incidents.md` as the append-only failure-mode chronicle (vs growing `.claude/docs/orchestration-overview.md`); (2) `team/STATE.md` as the between-tick source of truth (replaces ad-hoc re-derivation from conversation history); (3) `team/DECISIONS.md` (this file) as the team-decisions log; (4) `.claude/retros/` directory for milestone retros.

**Context:** Sponsor surfaced that the main session was at risk of context bloat. Survey of two sibling orchestrated projects on the machine confirmed both had explicit anti-bloat scaffolding ClaudeTeam lacked. The `.claude/docs/orchestration-overview.md` file is loaded at every SessionStart via the docs-preload hook — failure-mode entries accumulating there is an ever-growing context tax on every future session.

**Alternative considered:** (a) leave the current structure; rely on the maintain-docs Stop hook + auto-memory to keep `.claude/docs/` lean. Rejected — maintain-docs explicitly does not prune (its job is to add), and `.claude/docs/` is the EAGERLY-loaded surface where lean matters most. (b) Stuff everything into `.claude/decisions-while-away.md`. Rejected — that file is for orchestrator-autonomy audit, not team-wide decisions; conflating the two muddies the audit signal.

**Implication:** Future SessionStart context-load shrinks because `orchestration-overview.md` only carries stable patterns (not historical failures). Orchestrator resume reads `team/STATE.md` instead of replaying the last save-session file or re-deriving from conversation. Retros at milestone boundaries (starting with M1's close) become the durable lesson-promotion ritual.

**Reversibility:** ≤1 PR to revert (delete the three new files + re-inline the failure-mode entries back into orchestration-overview.md). Effort: ~20 min. No external system touched.

**Pointers:** This commit (orch-doc bundle landing on `main`). Survey notes: RandomGame `team/STATE.md`, `team/log/process-incidents.md`, `.claude/retros/`; MarianLearning `.claude/agents/dispatch-template.md` § Final-report shape with the explicit "context-bloat is the dominant surface" rationale.

---

## 2026-05-23 — Sponsor doesn't review PRs; team peer-reviews + QA + orchestrator admin-merges

**Decided:** ClaudeTeam's PR gate is fully internal to the team: peer-review (cross-pair Felix↔Maya, Iris→Maya/Felix, Sage→Felix/Maya, Bram/Nora→orch-direct) + Sage QA on AI-testable surface + orchestrator admin-merge after gates clear. Sponsor only signs off sponsor-domain calls (strategic priority, externally-visible actions, billing) — not individual PRs.

**Context:** Bootstrap default assumed sponsor approved each PR pre-merge. Sponsor clarified explicitly that they trust the team's review loop and want PR throughput unblocked.

**Alternative considered:** Sponsor-gates every PR (default for many projects). Rejected — bottleneck on sponsor + cost of disrupted flow exceeded the safety win for a team that has cross-review + QA discipline + admin-merge audit trail.

**Implication:** Orchestrator merges autonomously once gates clear. Sponsor input reserved for sponsor-domain calls. Memory: `[[sponsor-doesnt-review-prs]]`.

**Reversibility:** trivial — orchestrator re-routes merge sign-off through sponsor on request. Effort: 0 min (just changed instructions).

**Pointers:** Conversation 2026-05-23 mid-session; captured in memory `feedback_sponsor_doesnt_review_prs.md`; referenced in `CLAUDE.md` § Autonomy.

---

## 2026-05-23 — `AgentMeta` is a 3-tag union (v2.1.119 + v2.1.145-general + v2.1.145-persona)

**Decided:** Bram's M1-02 probe surfaced a third meta.json schema variant beyond the documented v2.1.119 / v2.1.145 pair: a persona-named v2.1.145 variant with `agentType: <persona-slug>`, `toolUseId` present, no `name`. Observed in 5 of 10 real captures. The `AgentMeta` discriminated union is 3-tag (`schemaVersion: "v2.1.119" | "v2.1.145-general" | "v2.1.145-persona"`).

**Context:** M1-02 fixture capture; M1-05 meta.json parser must handle the variant first-class. Without first-class typing, downstream code would silently misroute persona-named agents into background.

**Alternative considered:** Treat persona-named as a sub-mode of v2.1.145-general (single tag). Rejected — the field-presence delta (`toolUseId` present, no `name`) is structural and the matcher needs to dispatch on it.

**Implication:** Felix widened the union in PR #11 (M1-05). Matcher (PR #10, M1-08) is intentionally schemaVersion-agnostic so the widening is type-only and doesn't break downstream code.

**Reversibility:** narrow back to 2-tag is a typed migration touching ~5 files. Effort: ~30 min. No external system touched.

**Pointers:** `.claude/docs/data-sources.md` §4 (three-variant schema table); `src/shared/types.ts` `AgentMetaSchemaVersion`; Bram's `team/bram-research/m1-fixtures-2026-05-23.md`.

---

## 2026-05-23 — ClickUp MCP tools are NOT surfaced to sub-agent runtimes (permanent harness gap)

**Decided:** Orchestrator owns all ClickUp writes. Sub-agents append intended status transitions to `team/log/clickup-pending.md` under the canonical `## Status-flip queue (sub-agent dispatch fallback)` section; orchestrator flushes on each tick.

**Context:** Persona declarations include `mcp__clickup__*` tools, but Bram's probe (PR #2) confirmed the Claude Code harness filters these from sub-agent runtime — same filtering pattern as the `Agent` tool. This is structural, not a transient outage.

**Alternative considered:** (a) Have personas surface intended transitions via final-report text + orchestrator flips on parsing them. Rejected — fragile parser, no canonical pending state. (b) Wait for harness fix. Rejected — no ETA; fallback is needed regardless.

**Implication:** Every dispatch brief's ClickUp lifecycle block tells the persona about the fallback. Orchestrator flushes the pending queue each tick. Canonical section name codified in dispatch-template.md to prevent merge conflicts (see process-incident "Divergent section headers in clickup-pending.md").

**Reversibility:** if/when harness exposes ClickUp MCP to sub-agents, retire the pending queue and have personas flip directly. Effort: dispatch-template edit + queue-flush + remove the fallback section.

**Pointers:** `.claude/docs/orchestration-overview.md` § ClickUp as hard gate; PR #2; `team/bram-research/probe-clickup-mcp.md`.

---

## 2026-05-23 — Auto-merge orchestration-doc PRs from Nora's lane (no sponsor pre-approval)

**Decided:** PRs touching `team/` planning artifacts (backlogs, decisions logs, role docs, status docs) authored from Nora's worktree merge straight to main after orchestrator review — no per-PR sponsor approval.

**Context:** Backlog and coordination-doc PRs are routine workflow artifacts. Sponsor's bandwidth is finite; routing every doc PR through sponsor review created stalls without adding signal.

**Alternative considered:** Route all `team/` PRs through sponsor for sign-off. Rejected — same bandwidth math as the broader "sponsor doesn't review PRs" decision; no incremental safety vs cost.

**Implication:** Orchestrator merges Nora PRs after gates (no peer-reviewer required for pure planning artifacts unless the PR touches files other roles depend on).

**Reversibility:** trivial — re-route via sponsor on request.

**Pointers:** `CLAUDE.md` § Autonomy; cross-references `[[sponsor-doesnt-review-prs]]`.
