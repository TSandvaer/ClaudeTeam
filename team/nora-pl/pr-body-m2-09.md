## Summary

Resolves M1 retro durable-lesson item: `APPROVE_WITH_NITS` must be explicitly enumerated in the dispatch flow, not left implicit.

Two narrow doc edits:

- **`.claude/agents/dispatch-template.md`** — adds `### Cross-review verdict format` subsection (16 lines) enumerating all three valid verdicts (`APPROVE`, `APPROVE_WITH_NITS`, `REQUEST_CHANGES`) with one-line definitions each, plus the guard against misuse (don't downgrade to APPROVE, don't upgrade to REQUEST_CHANGES).
- **`team/log/clickup-pending.md`** — ENTRY 014: `86c9y7jn9 -> in review` (1 line, standard pattern).

No changes to `orchestration-overview.md` — the maintain-docs Stop hook already added the three-verdict enumeration at commit `3827aee` (line 80). Verified correct and complete; AC2 satisfied without modification.

## AC verification

```
grep -n "APPROVE_WITH_NITS" .claude/agents/dispatch-template.md
```
→ lines 114, 120, 123 — explicit enumeration present.

```
grep -n "APPROVE_WITH_NITS" .claude/docs/orchestration-overview.md
```
→ line 80 — three-verdict enumeration from `3827aee`, correct and complete.

## Diff size

17 insertions, 0 deletions. Within the ≤25 line AC4 limit.

## Non-obvious findings

- The maintain-docs Stop hook had already promoted the three-verdict line into `orchestration-overview.md` at commit `3827aee`, capturing the retro insight partially. The `dispatch-template.md` side was the remaining gap — the file had verdict-adjacent content (routing rules) but no explicit verdict enumeration block.
- Placement after "Peer-review routing" is natural: a reviewer reading their routing assignment immediately sees what verdict options they have.
- The negative-use guards ("do NOT downgrade to APPROVE, do NOT upgrade to REQUEST_CHANGES") are load-bearing — the retro identified that the verdict's value comes from using the right one, not just knowing the three names exist.

## ClickUp

ENTRY 014: `86c9y7jn9 -> in review` appended to `team/log/clickup-pending.md`.
