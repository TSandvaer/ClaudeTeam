# chore(docs): Obs 8 NITs follow-up — stale comment + M5 spec resync

Ticket: [`86c9zfrzt`](https://app.clickup.com/t/86c9zfrzt). Mechanical doc/comment refresh — NO code-behavior changes. Follows Obs 8 (PR #84, `86c9zfmgg`) which shipped the action-toggle label convention ("Hide finished" ↔ "Show finished — N hidden") replacing the original always-"Hide finished" wording.

## Scope

### NIT 1 — Stale source comment

`src/webview/components/headerChip.ts:86` previously read:

> Label — verbal portion. Static "Hide finished" prefix; the count phrase is the count span (separately hidable).

The label is no longer static — `labelTextForState` (lines 173-187) toggles between `"Hide finished"` (filter off) and `"Show finished — N hidden"` (filter on). Comment rewritten to describe the current behavior and cite Obs 8 / `86c9zfmgg`.

### NIT 2 — M5 spec resync

`team/iris-ux/m5-hide-finished-spec.md` resync of every section that still pinned the original `"Hide finished — N hidden"` convention:

- **§4.2 state table** (lines 240/242/243) — ON-state rows updated to "Show finished — none yet" / "Show finished — N hidden"; appended "Click WILL hide / Click WILL show" notes plus a label-convention footnote citing sponsor verbatim and PR #84.
- **§5.2 template table** (lines 314-317) — filter-on rows flipped to "Show finished — …"; appended a "Why the action-toggle convention" rationale + history reference.
- **§7.3 vocabulary contract** (lines 462-465) — chip label literals flipped to "Show finished — …" on the ON branch; appended a blockquote with the original baseline + sponsor verbatim for history.
- **§9.2 Maya paste block** (line 547) — phrasing updated from "between 'Hide finished' and the count phrase" to the action-toggle convention.
- **§9.2 manual probe** (line 566) — post-toggle label updated from "Hide finished — 1 hidden" → "Show finished — 1 hidden".

Original wording preserved as history per dispatch guidance (footnote / blockquote in each section), so the spec remains auditable.

## Out of scope

- No code-behavior changes.
- Other docs that may also reference the old convention (catch-as-found, not exhaustive).

## Verification

- `npm run typecheck` — clean.
- `npx vitest run` — 482 passed, 2 skipped (no regressions; existing 21-test `headerChip.test.ts` suite still green — it already asserts the action-toggle labels per Obs 8).
- Diff: 2 files, 22 insertions / 14 deletions.

## Reviewer

Maya peer-review (cross-pair, mechanical scope).
