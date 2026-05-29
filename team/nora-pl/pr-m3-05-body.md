## Summary

Replaces sequential `ENTRY-NNN:` line prefix in `team/log/clickup-pending.md` with a timestamp-based scheme (`ENTRY-<ISO-8601-UTC-timestamp>:`, e.g. `ENTRY-2026-05-24T08:30:00Z:`) to eliminate parallel-dispatch collisions. This failure mode hit 4× during M2 (per M2-close retro) and was documented as "Prevention TBD" in `.claude/docs/orchestration-overview.md` — now applied.

Existing historical `ENTRY-NNN:` entries are left in place per the sponsor's explicit leave-as-historical decision. A switchover marker line inside the existing fenced block delineates legacy vs. new format.

Ticket: M3-05 (orch-direct chore — no ClickUp ticket per project convention).

## File touches (4 inserts / 3 deletes — under the 30-line AC4 cap)

1. **`.claude/agents/dispatch-template.md`** — § 4 ClickUp lifecycle code-fence example updated from `ENTRY NNN:` to `ENTRY-<ISO-8601-UTC-timestamp>:`, plus a one-line rationale specifying the rule and why (parallel-dispatch collision).
2. **`team/log/clickup-pending.md`** — appended one-line switchover marker inside the existing fenced block at the bottom of the legacy entries: `# --- Switchover 2026-05-24 (M3-05): entries above use legacy sequential ENTRY-NNN; entries below use timestamp-based ENTRY-<ISO-8601-UTC>. ---`
3. **`.claude/docs/orchestration-overview.md`** — § Common failure modes bullet 10 trailing sentence updated from "Prevention TBD (likely persona-prefixed or timestamp-based entry IDs)." to "Prevention applied 2026-05-24: timestamp-based IDs per `.claude/agents/dispatch-template.md` § Status-flip queue. Legacy sequential IDs in entries dated before 2026-05-24 remain as historical."
4. **No migration of existing `ENTRY-NNN:` entries** — sponsor's leave-as-historical decision. Entries 002–029 stay as-is.

## AC roll-up

- AC1 — dispatch-template.md ENTRY format updated. ✅
- AC2 — clickup-pending.md switchover marker appended. ✅ (no migration)
- AC3 — orchestration-overview.md failure-mode bullet 10 updated. ✅
- AC4 — diff = 4 inserts / 3 deletes across 3 files; well under the 30-line cap. ✅

## Done-when greps (both hit)

```
$ grep -n "ENTRY-2026" .claude/agents/dispatch-template.md
57:  Use `ENTRY-<ISO-8601-UTC-timestamp>:` as the line prefix … (e.g., `ENTRY-2026-05-24T08:30:00Z:`)…

$ grep -n "Prevention applied" .claude/docs/orchestration-overview.md
124:- **ENTRY-number collision in `clickup-pending.md`** — … Prevention applied 2026-05-24: …
```

## Webview-smoke / extension-manifest gate

- Webview-smoke: NO — coordination-doc PR, no code touched.
- Extension-manifest: NO — `package.json` untouched.

## Cross-review

Orch-direct (Nora's coordination-doc PR per `.claude/agents/dispatch-template.md` § Peer-review routing). No peer-reviewer.

## Non-obvious findings

- The dispatch-template's code-fence example is the canonical "what to write" reference for personas; updating the example line is the load-bearing edit (more than any prose paragraph that might wrap around it). Personas copy the example.
- `clickup-pending.md` legacy `ENTRY NNN:` entries don't need migration because IDs are write-once: once an entry is appended and the orchestrator flushes it, the ID itself is never re-referenced — the ticket-ID + transition is what matters. Leave-as-historical is a no-cost choice.
- The fact that PR #32 (Bram's M3 prior-art) landed before this PR means M3-01/M3-02 dispatches can already adopt the new ENTRY format — Felix's parallel M3-01 dispatch is instructed to use it. If his PR lands first using the new scheme, that's the convention demonstrated in-band; this PR's AC1 codifies the rule.
