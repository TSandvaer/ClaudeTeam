# Roster-Count Chip Triage — 2026-05-26

## Question

Sponsor observed `(1 rostered)` chip label on a vsix built from pre-PR-#82 main
when `teams.yaml` has 3 (or 6) rostered personas. Is the chip undercounting? If yes,
what file:line is the bug?

## Answer (1–3 sentences)

The chip is NOT buggy. `(1 rostered)` is correct behavior: the chip counts
`RosterTileEntry[]` items actually matched in the current session, not the number
of members in `teams.yaml`. On the observed vsix (at `9e29686`) when only
Bram's running agent had matched tiles (all others were hidden by the
hide-finished filter or not yet dispatched), the count correctly read `(1
rostered)`. The `(3 rostered)` reading from the same vsix on the same day
corroborates this — three personas (Felix, Maya, Bram) had matched tiles in that
tick.

## Evidence

### 1. Chip-label source (`src/webview/components/teamCard.ts:97`)

```
countSpan.textContent = `(${tiles.length} rostered)`;
```

`tiles` is the `RosterTileEntry[]` passed from `sessionBlock.ts:104`:

```
const tiles = session.rosterTiles.get(teamId) ?? [];
```

`rosterTiles` is populated by the reducer only for teams that have at least one
matched agent (`reducer.ts:221-225`). So `tiles.length` = number of distinct
`RosterTileEntry` items (bare `AgentTile` or `CollapsedPersonaGroup`) that matched
in this session under that teamId.

- `src/webview/components/teamCard.ts:34-36` (doc comment): "The card counts each
  entry as `1 rostered` regardless of wrapper expansion — a Felix ×4 wrapper still
  reads as a single tile in the header."

### 2. teamCard comment confirms design intent

`src/webview/components/teamCard.ts:34-37` explicitly states the design:

> The card counts each entry as "1 rostered" regardless of wrapper expansion — a
> Felix ×4 wrapper still reads as a single tile in the header (matches sponsor's
> mental model that the persona is the unit of display, not the dispatch).

### 3. Reducer: `teamOrder` only contains teams with ≥1 matched tile

`src/extension/state/reducer.ts:143-225`: `rosterTiles` is an empty Map at the
start of each session walk. Teams are added only when a matched agent lands
(`reducer.ts:221`). `teamOrder` is sorted by roster declaration order but only
contains teams that registered at least one tile.

### 4. hideFinishedFilter CAN reduce tiles.length to zero

`src/extension/state/hideFinishedFilter.ts:86-133`: when `hideFinishedAgents=true`,
finished tiles are dropped from `rosterTiles`. A `CollapsedPersonaGroup` whose ALL
instances are finished is dropped entirely (`hideFinishedFilter.ts:102`). If only one
persona has non-finished tiles surviving the filter, `tiles.length = 1` →
`(1 rostered)` is correct.

### 5. Dogfood observation confirms the math

`team/dogfood/2026-05-26-obs-dashboard-quirks.md` lines 39-41 (at vsix `9e29686`):

> Team card `TEAM claudeteam-alpha (3 rostered)` — Collapsed groups: `Felix ×6`,
> `Maya ×6`, `Bram ×4` — all 16 of these are finished tiles from prior dispatches

Three `CollapsedPersonaGroup` wrappers in the session → `tiles.length = 3` →
`(3 rostered)`. Consistent with the counting logic.

### 6. teams.yaml has 6 members at both SHA targets

`git show 9e29686:.claude/teams.yaml` and `git show 6150e9f:.claude/teams.yaml`
both contain 6 members (Felix, Maya, Sage, Iris, Nora, Bram) under `claudeteam-alpha`.
The YAML member count is never used for the chip label — only live matched tiles
count.

### 7. `(1 rostered)` scenario reconstruction

Given the dogfood observation showing hide-finished-filter was togglable, a `(1
rostered)` reading would occur when the filter is ON and only one persona has a
non-finished tile. Example: Bram running (1 non-finished tile) + Felix and Maya all
finished (dropped by filter) → `tiles.length = 1` → `(1 rostered)`. No code path
produces `(1 rostered)` from a 6-member roster when all six have active tiles unless
the filter or session-scoping trims the set.

## What I did NOT verify

- The exact session + filter state at which the sponsor originally saw `(1 rostered)`.
  The observation is not in the dogfood doc; it comes from the ticket brief. Cannot
  confirm without a screenshot from the sponsor's session at that moment.
- Whether the `(1 rostered)` was from a session where genuinely only 1 persona was
  matched (e.g., Bram alone in flight with hide-finished ON) vs. a display
  calculation bug in an older build. The code path at `9e29686` (same commit the
  dogfood doc references) is clean — no off-by-one, no roster-size confusion.
- Post-PR-#82 (`6150e9f`) chip behavior — the Obs 9 fix changed `readFinishedToolUseIds`
  only; `teamCard.ts` chip label is unchanged. The chip label code is identical at
  `9e29686` and `6150e9f`.

## Implications for ClaudeTeam

- **No code fix needed for the chip label.** The behavior is by design: the chip
  counts matched tiles in the current session, not YAML members.
- **Potential UX confusion.** Sponsor may have expected `(6 rostered)` because they
  have 6 members in `teams.yaml`. The chip semantics — "how many distinct persona
  groups are visible in this session right now" — are not obvious from the label.
  A follow-up UX ticket may be appropriate to clarify the label (e.g., `(3 of 6
  rostered active)`) but that is a UX polish call, not a defect.
- **Filter interaction is the most likely `(1 rostered)` cause.** Hide-finished
  filter + a session where only 1 persona has a non-finished agent = `(1 rostered)`.
  Document this interaction in the UI spec if it causes repeated sponsor confusion.
