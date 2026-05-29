## Summary

Authored the M2-close retro at `.claude/retros/retro-2026-05-24-m2-close.md` covering the full M2 milestone (M2-01 through M2-09 + 3 NITs follow-ups + M2-06 host↔webview integration + M2-08 Layer-3 tests + the `86c9y9yzu` CJS shim production fix). 12 PRs merged, ~3100 words, structured per `RETRO-TEMPLATE.md`.

Also updated Nora's run log in `team/STATE.md` with this retro entry + a refreshed status line.

## Headline lessons promoted

1. **Auto-decide track record: 10/10 auto-merges, 0 reversals.** Below the 5% calibration floor in orch-autonomy rule 6.5. Recommendation in the retro: surface to sponsor that more classes should be promoted to rule 6.6 auto-decide territory (NITs-ticket-creation from APPROVE_WITH_NITS, log-only-conflict recovery, NITs-absorption-into-downstream).
2. **Path Y pattern (NITs-absorption-into-downstream)** validated as reusable when the follow-up ticket and the downstream ticket touch the same files.
3. **Sub-agent GUI gap reframe** (AC(a) live-runTick load-bearing, AC(b-d) sponsor post-merge) — now documented in `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap", first applied PR #28, structural not one-off.
4. **`mcp__clickup__update_task` permission-rule** landed cleanly after non-deterministic classifier denials hit same-session — cross-project port candidate.
5. **M2-08 caught a real production bug** under AC7 (Node 22+ ERR_REQUIRE_ESM). Validates Layer-3 investment + AC7 "file as follow-up ticket" discipline.
6. **Cross-review pairing held all session** — 12 PRs, 12 valid peer-review headers, 0 self-merges.
7. **Chain-of-deferred-validations anti-pattern surfaced** (M2-01 placeholder-screenshot defer → M2-06 GUI defer → CJS shim hidden until M2-08 Layer-3). Prevention: install-path validation should bind to the first-shipping PR even when visible UI defers.

## Notable anti-patterns named

- `ENTRY-NNN` collisions in `clickup-pending.md` recurred 4× this M2 — prevention (persona-prefixed or timestamp-based IDs) remains open as M3 candidate.
- Test plans authored without checking who can execute them (M2-07 → blocked at M2-06 dispatch).
- Orchestrator narration of merge decisions in main thread — duplicates `decisions-while-away.md` audit content.

## Next-session backlog (8 items filed in retro § "Next-session backlog")

1. M3 backlog authoring (post-sponsor scope confirm).
2. Auto-decide promotion draft (rule 6.6 additions).
3. ENTRY-NNN collision prevention ticket.
4. Port GUI-gap reframe + `mcp__clickup__*` allow-rule to `create-orchestration-project` template.
5. Test-plan executor-mapping discipline update.
6. Install-path validation discipline at first-shipping PR.
7. Main-thread merge-narration tightening.
8. M3 Layer-3 expansion ticket (queued for when M3 backlog crystallizes).

## Reviewer

Orchestrator-direct (retros are coordination artifacts; no peer-dev review needed per dispatch brief).

## Test plan

- [x] Retro file lives at `.claude/retros/retro-2026-05-24-m2-close.md`.
- [x] Structure matches `RETRO-TEMPLATE.md` (Outcome / What went well / What went poorly / Surprising findings / Patterns + anti-patterns / Durable lessons promoted / Next-session backlog).
- [x] Word count comparable to M1 retro (~3100 vs M1's ~2400) — modestly longer to cover 12 merged PRs + the 10 auto-decide entries.
- [x] STATE.md Nora run log updated.
- [x] All cited PRs / commits / file paths verifiable on `origin/main` (`9d5dea9`).

## Decision draft (for next decisions-batch PR)

> **Decision draft:** Promote three additional classes to orch-autonomy rule 6.6 auto-decide territory: (a) NITs-ticket-creation from APPROVE_WITH_NITS review comments when scope is mechanical (verbatim from reviewer's bulleted findings); (b) `clickup-pending.md` log-only-conflict recovery via `git checkout --ours` (already in failure-mode prevention; elevation closes audit gap); (c) NITs-absorption-into-downstream-ticket when follow-up files overlap with a scheduled downstream consumer (validated by M2-04→M2-06 Path Y). Foundation: 10/10 auto-merges with 0 reversals across the M2 cycle (`.claude/decisions-while-away.md` entries 1300/1410/1815/1830/1840/1933/1942/2024/2032/2038/2039/0949 UTC).
