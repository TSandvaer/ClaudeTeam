# Proposed global rule — Parallel-agent shared-concept vocabulary discipline

**Status:** staged — orchestrator cannot self-edit `~/.claude/CLAUDE.md` per memory `[[classifier-blocks-self-mod-of-orch-autonomy]]`. Sponsor reads + applies on return.

**Path of intended edit:** `C:\Users\538252\.claude\CLAUDE.md` (user-global).

**Authored:** 2026-05-25 by ClaudeTeam orchestrator after a parallel-dispatch coordination gap on M3-10 produced a non-mergeable PR rebase.

---

## The incident (concrete trigger)

ClaudeTeam M3-10 (`86c9ydug9` persona-tile-collapse), 2026-05-25:

- Orchestrator dispatched **Felix** on host (reducer + config + types) and **Maya** on webview (render + tests + NIT absorption) IN PARALLEL with identical state-shape contract in both briefs: *"When N>1 rostered tiles share matched-roster persona name, reducer outputs `{personaName: string, count: number, instances: AgentTile[]}`. N=1 = existing AgentTile shape unchanged. Felix exports wrapper type from `src/shared/types.ts`; Maya imports."*
- Each agent picked their own type-vocabulary:

| Felix's branch (PR #48) | Maya's branch (PR #47) |
|---|---|
| `PersonaGroup` | `CollapsedPersonaGroup` |
| `TileOrGroup` (union) | `RosterTileEntry` (union) |
| `isPersonaGroup` (guard) | `isCollapsedPersonaGroup` (guard) |
| `kind: "group"` (discriminator) | `kind: "collapsed-persona"` (discriminator) |

- **Cross-review missed it.** Felix reviewed PR #47 (Maya): APPROVE_WITH_NITS (2 unrelated NITs). Maya reviewed PR #48 (Felix): APPROVE clean. Neither flagged the vocabulary mismatch.
- **Merge sequence:** PR #47 merged first (Maya canonical landed on main). PR #48 then failed `gh pr merge` with merge conflicts across `src/shared/messages.ts`, `src/webview/components/sessionBlock.ts`, `src/webview/main.ts`, `src/webview/render.ts`. The rebase could not be resolved with simple `--ours` / `--theirs` because Felix's reducer (his net-new code) referenced `PersonaGroup` / `TileOrGroup` / `isPersonaGroup` — types that don't exist on main.
- **Recovery cost:** Felix re-dispatched for a reconciliation rebase (sed-rename type vocabulary + drop redundant defs + force-push). ~5-10 min extra in drain.

**Why the contract didn't prevent it:** the contract specified the SHAPE (`{personaName, count, instances}`) and the DIRECTIONALITY (Felix exports → Maya imports) but NOT the actual identifier names (type name, union alias, guard function, discriminator string value). Each agent independently picked plausible names.

---

## The proposed global rule

Add to `~/.claude/CLAUDE.md` as a new top-level section, naturally after "Orchestrator main-thread bloat discipline" (once that's applied):

```
## Parallel-agent shared-concept vocabulary discipline

When dispatching multiple agents in parallel to work on different surfaces of
a SHARED CONCEPT (a new type, a new event shape, a new wire-format field, a
new guard function, etc.), the dispatch briefs MUST specify exact IDENTIFIER
NAMES, not just shape contracts. Shape contracts alone leave naming
ambiguous — each agent invents their own vocabulary and the parallel PRs
become non-mergeable.

**Required in any parallel-shared-concept dispatch:**

1. **Type name.** "The wrapper type is `<ExactName>`."
2. **Union alias.** "The union is `<ExactName>` = `<A> | <B>`."
3. **Type-guard function.** "The guard is `<ExactName>` returning `entry is <Type>`."
4. **Discriminator value(s).** "The discriminator value is `'<exact-string>'`."
5. **Export site.** "Defined in `<exact-file-path>`; consumers import from there."
6. **Optional: webview-vs-host suffix convention.** If the concept spans webview
   + host with different shapes, name the variants explicitly
   (e.g. `WebviewSessionTree` + `SessionTree`).

**Two acceptable patterns when vocabulary is unsettled:**

- **Pattern A — Sequence the dispatches.** Dispatch the type-author FIRST
  (typically the surface that owns shared/types.ts or the canonical type
  file). Merge their PR. THEN dispatch the consumer(s) against the merged-
  on-main vocabulary. Costs one merge cycle of latency; eliminates the
  vocabulary divergence by construction.

- **Pattern B — Parallel with named-vocabulary contract.** Both dispatches
  in parallel as today, but the brief includes a "Vocabulary contract"
  subsection listing all 5 items above. Both agents read the SAME names
  in their briefs. Faster but requires orchestrator discipline to write
  the contract.

Pattern A is the default for any NEW type introduction. Pattern B is
acceptable when the orchestrator has high confidence about the names
upfront AND wants the parallelism.

**Cross-review check:** when peer-reviewing a PR that's parallel to another
in-flight PR sharing a concept, EXPLICITLY check vocabulary alignment —
grep the other PR's branch for the type / guard / discriminator names + verify
they match yours. Flag any divergence as REQUEST_CHANGES (NOT
APPROVE_WITH_NITS — vocabulary divergence is mergeability-blocking, not
NIT-class).

**Dispatch-template addition:** the project's `.claude/agents/dispatch-template.md`
should gain a new "Vocabulary contract (shared-concept parallel dispatches
only)" block alongside the existing "Scoped contract" block.

**Why:** ClaudeTeam M3-10 (2026-05-25) — orchestrator dispatched Felix +
Maya in parallel with a shape-contract that didn't name identifiers; each
invented their own vocabulary (`PersonaGroup` vs `CollapsedPersonaGroup`);
cross-review missed it; PR #48 was non-mergeable post-PR-#47-merge and
required a reconciliation re-dispatch. Cost ~5-10 min extra in drain. The
shape contract felt sufficient because the agents are "smart enough" to
match names — but smart-enough isn't repeatable across sessions / orchs.
Names must be specified explicitly OR sequenced via Pattern A.

**How to apply:** before any parallel dispatch where two or more agents
will reference a SHARED new type / event / wire-format / guard, either
sequence them (Pattern A — recommended default) or write the Vocabulary
contract block (Pattern B) explicitly listing the 5 items above. In
cross-review of parallel PRs, grep the sibling branch for vocabulary and
flag divergences as REQUEST_CHANGES.
```

---

## Companion entry for `team/log/process-incidents.md`

Already added — see `## 2026-05-25 — Parallel-agent type-vocabulary divergence on M3-10 produced non-mergeable PR rebase`.

---

## Companion update for `.claude/agents/dispatch-template.md`

Add a new optional block after § 3 "Scoped contract":

```markdown
### 3a. Vocabulary contract (mandatory for parallel dispatches sharing a NEW concept)

When dispatching multiple agents in parallel where two or more will
reference a new type / event / wire shape / guard function, include the
following block in BOTH briefs verbatim:

**Vocabulary contract (both reviewers + authors read same paragraph):**

- **Type name:** `<ExactName>` (defined in `<exact-file-path>`)
- **Union alias:** `<ExactName>` = `<A> | <B>`
- **Type guard:** `<exactName>` returning `entry is <Type>`
- **Discriminator value(s):** `'<exact-string>'`
- **Webview/host variant suffix (if any):** `Webview<X>` vs `<X>`
```

This is project-scoped (lives in dispatch-template.md), not global. Apply
when the global rule applies.

---

## How to apply this staged diff

1. Open `C:\Users\538252\.claude\CLAUDE.md`
2. Find "Orchestrator main-thread bloat discipline" section (once that's applied per `team/log/proposed-global-rule-main-thread-bloat-discipline-2026-05-25.md`)
3. Insert the new "Parallel-agent shared-concept vocabulary discipline" section AFTER it
4. Also apply the dispatch-template.md addition (project-scoped, ClaudeTeam repo)
5. Update memory entry `[[classifier-blocks-self-mod-of-orch-autonomy]]` to note this as the fifth known staged-diff-then-apply pattern
6. Delete this staged file or move it to `team/log/applied/` as audit trail

---

## Cross-references

- Memory: `[[classifier-blocks-self-mod-of-orch-autonomy]]` — pattern this doc follows
- Staged: `team/log/proposed-global-rule-wake-discipline-2026-05-25.md`, `cross-session-continuity-2026-05-25.md`, `main-thread-bloat-discipline-2026-05-25.md` — sibling staged rules
- Project doc: [.claude/agents/dispatch-template.md](.claude/agents/dispatch-template.md) — companion update
- Process incident: 2026-05-25 entry in `team/log/process-incidents.md` (companion)
