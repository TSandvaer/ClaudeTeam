# Multi-agent persona tile — design spec

Design spec for **ClickUp `86ca1d7er`** (sponsor GUI-test decision 2026-05-29, **option A**): a rostered member with **N≥2 live agents must ALWAYS render as ONE persona tile**, identical in chrome to the single/zero-agent tile, with a small **×N badge** and an **expand affordance** that reveals the individual instances. This **supersedes the M3-10 `CollapsedPersonaGroup` header-tile treatment for ROSTERED members** — the bare count-group header (`Felix ×2 ▸ all finished`, different styling, no persona sprite) is retired for rostered personas.

- **Ticket:** [ClickUp `86ca1d7er`](https://app.clickup.com/t/86ca1d7er).
- **Owner:** Iris (this spec). **Peer reviewer:** Felix (spec / decomposition edges — reducer aggregate-state, instance-list wire shape, the M3-10 type migration).
- **Downstream impl tickets:** filed by orchestrator after sponsor approves direction (Felix host-side aggregate + instance list; Maya webview tile/badge/expand). Decomposition in §5 names the parallel-safe ownership zones + vocabulary contract.
- **Authoring discipline:** Theme-aware first (CLAUDE.md hard rule). Consumes the `--ct-*` token vocabulary and the tile anatomy from `whole-team-display-spec.md` verbatim — extends, never re-specifies. No icons-only (every state glyph text/aria-paired). No data-model field assumed without a Felix sign-off note (§5.3).

## Source artifacts (read on `main` HEAD by Iris 2026-05-29)

- `src/shared/types.ts:296-465` — current `AgentTile`, `CollapsedPersonaGroup` (M3-10, `kind: "collapsed-persona"`), `RosterTileEntry = AgentTile | CollapsedPersonaGroup`, `isCollapsedPersonaGroup` guard, `rosterTiles: Map<teamId, RosterTileEntry[]>`. This spec migrates the rostered path off the wrapper.
- `src/webview/components/collapsedPersonaTile.ts:1-60` — the current header-tile renderer + its group-state rule (`running > idle > finished > error`, "most-active-first" per 86c9yxvah). Aggregate-state §2 below reuses and extends this rule (adds `error` precedence + `available`).
- `team/iris-ux/whole-team-display-spec.md` §2.1 (tile anatomy), §2.2 (per-state table), §3 (sprite area + idle-pool + fallback monogram), §8 (token block). The multi-agent tile IS the §2.1 tile + a badge + an expand region.
- `.claude/docs/persona-pixel-character-animation-prompts.md` — sprite state-per-pose; `idle*` pool; `active_work`/`active_read` triggers; SLOW playback default.
- `.claude/docs/roster-matching.md` § Background-noise — the unrostered **+N chip** that stays UNCHANGED (§4 below).
- `team/DECISIONS.md` (whole-team epic 86ca11187) + memory `[[dashboard-whole-team-always-visible-thesis]]`.

---

## 0. Scope summary

| § | Surface | Lane |
|---|---|---|
| §1 | Single-persona-tile layout for N≥2 (the tile + ×N badge + expand affordance) | webview (tile + badge + expand) |
| §2 | Aggregate-state rule (the tile's headline state) | host (reducer computes) + webview (renders) |
| §3 | Expand / collapse interaction (instance list, focus, keyboard) | webview |
| §4 | Difference from the unrostered background **+N chip** (unchanged) | — |
| §5 | Host vs webview ownership decomposition + M3-10 migration + vocabulary contract | host + webview |
| §6 | Sponsor open questions | away-queue feed |
| §7 | Out of scope / guardrails | — |

---

## 1. Single-persona tile for N≥2 live agents

### 1.1 The principle (option A)

**A rostered member is ALWAYS exactly one tile.** Zero agents → the `available` baseline tile (`whole-team-display-spec` §2.3). One agent → that agent's live tile. **N≥2 agents → still ONE tile** — same persona sprite, same name, same role, same chrome — with:

1. a small **`×N` badge** appended to the name row, and
2. an **expand affordance** (chevron) that reveals the per-instance list (session ids / per-instance state / per-instance elapsed).

The N≥2 tile must be **visually indistinguishable from the N=1 tile at rest** except for (a) the `×N` badge and (b) the expand chevron. No different background, no header-row styling, no "group" chrome — the member reads as one team member who happens to be running multiple instances. This is the whole point of the sponsor's option A: the persona never "demotes" into a bare count group.

### 1.2 Tile anatomy (extends `whole-team-display-spec` §2.1)

```
┌──────────────────────────────────────────────────────────┐
│  ┌────────┐                                                │   ← .agent-tile[data-state][data-count]
│  │        │  ● Felix  [×2 ▸]                      [⋯]      │   row 1: dot + name + ×N badge + chevron + overflow
│  │ SPRITE │  Extension Host Dev                            │   row 2: role
│  │ 68×68  │  tool:Edit reducer.ts                          │   row 3: AGGREGATE activity (the headline instance)
│  │        │  Sonnet · running 2m  (2 agents)               │   row 4: model · aggregate state·elapsed + count hint
│  └────────┘                                                │
│  ── expanded (data-expanded="true") ──────────────────────│
│     ┌─ instance list (.persona-instances) ──────────────┐ │
│     │ ● a1d53b4a   running 2m   tool:Edit reducer.ts     │ │   one .persona-instance-row per agent
│     │ ◐ 7b53d0ee   finished 4m  finished                 │ │
│     └────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- **Rows 1–4 are the existing `whole-team-display-spec` §2.1 rows.** The sprite box (68px), state dot, name, role, activity, model rows are all reused unchanged.
- **`×N` badge** — net-new. A small pill immediately after the display name, before the overflow `[⋯]`. Renders `×N` (e.g. `×2`). Doubles as the **expand toggle** (it carries the chevron); see §3. Token `--ct-radius-chip`, `--ct-color-fg-muted`, `font-size` one step below the name. aria-label `"N agents, expand"` (text-paired — design discipline, no icon-only).
- **Row 3 activity** is the **aggregate / headline activity** — the activity of the instance that "wins" the aggregate state (§2.4). Not a merge of all instances' tools; one representative line so row 3 stays single-line and skimmable.
- **Row 4 count hint** — appends a quiet `(N agents)` suffix after the model·state·elapsed so the multiplicity is legible even before expanding (and for screen-reader users who skim row 4). Muted (`--ct-color-fg-muted`).
- **Sprite pose** follows the aggregate state (§2.4 → §1.4): running-aggregate shows `active_work`/`active_read`; idle/finished/available-aggregate shows an `idle*` pool pose. One sprite — the persona is one character, not N.
- **`data-count` attribute** on the tile carries N (`data-count="2"`); `data-count` absent or `"1"` → no badge, no chevron (renders exactly as today's single tile). This is the single render switch.

### 1.3 The ×N badge — design rules

- **Only renders when N≥2.** N=1 and N=0 (available) never show it (no `×1`).
- **Placement:** name row, right after `.agent-name`, left of the overflow `[⋯]`. Inline, vertically centered with the name baseline.
- **Color:** muted by default (`--ct-color-fg-muted` text on transparent / `--ct-color-bg-chip`). It is **not** a state color — the state dot already carries state. The badge carries *count*, a separate axis. (Keeping count and state on separate visual channels avoids overloading either.)
- **It is the expand toggle.** Clicking the badge expands/collapses the instance list (§3). The chevron glyph (`▸` collapsed / `▾` expanded) sits inside the badge: `[×2 ▸]`. aria-`expanded` reflects state.
- **Pulse suppression on the badge** — when the aggregate state is `running` and the tile pulses (per `whole-team-display-spec` §2.2), the badge does NOT pulse; only the state dot does. The badge is chrome, not a state surface.

### 1.4 Sprite pose under aggregation

One persona = one sprite, regardless of N. The pose maps from the **aggregate state** (§2), not from any single instance:

| Aggregate state | Sprite pose |
|---|---|
| running (any instance running) — headline instance tool == `Read` | `active_read` |
| running — headline instance tool != `Read` | `active_work` |
| idle / finished / available | `idle*` pool member (calm), SLOW playback (`whole-team-display-spec` §3.3) |
| error | `idle*` pool member (no error sprite in V1) |

"Headline instance" = the instance that won the aggregate (§2.4) — its tool decides read-vs-work pose. Rationale: the sprite should reflect "what this member is most-actively doing right now," and a running member is more salient than a finished one.

---

## 2. Aggregate-state rule (the tile's headline state)

The single tile shows ONE state dot. With N instances each in their own state, the tile needs a deterministic **aggregate**. This is a host-computed value (§5.1).

### 2.1 The rule (precise)

> **running if ANY instance is `running`; else `error` if ANY instance is `error`; else `idle` if ANY instance is `idle`; else `finished` if ALL instances are `finished`; else `available`.**

Precedence order, highest wins:

```
running  >  error  >  idle  >  finished  >  available
```

Evaluate top-down; the first tier with ≥1 matching instance is the aggregate. `finished` requires **all** remaining instances finished (it's the bottom of the "alive" tiers); `available` is the floor (no live instances at all — in practice unreachable when N≥2, since N counts live instances, but defined for totality).

### 2.2 Worked examples

| Instance states | Aggregate | Why |
|---|---|---|
| `[running, finished]` | **running** | one still working — the member is active |
| `[running, error]` | **running** | running outranks error (active work is the headline) |
| `[error, finished]` | **error** | no running; an error is the most important remaining fact |
| `[idle, finished]` | **idle** | one alive-but-quiet instance; not "all done" |
| `[finished, finished]` | **finished** | all done — the only all-finished case |
| `[error, idle]` | **error** | error outranks idle |
| `[finished, finished, running]` | **running** | any-running wins regardless of count |

### 2.3 Why this precedence (vs. the M3-10 rule)

The current M3-10 `collapsedPersonaTile.ts` rule is `running > idle > finished` ("most-active-first," 86c9yxvah) and **omits `error`**. This spec **inserts `error` between `running` and `idle`**:

- **running stays top** — an actively-working instance is the headline; the sponsor most wants to see "someone is still on it." (Unchanged from M3-10.)
- **error above idle/finished** — an errored instance is a *call to action* the sponsor should not miss. If one of Felix's two agents errored and the other went idle, the tile must read `error`, not `idle` — otherwise a failure hides behind a quiet sibling. Error is louder than idle/finished but quieter than running (a still-running sibling means the work isn't dead yet).
- **error below running** — debatable, and the alternative (error above running) is a real option. Recommendation: **running > error**, because option A's whole framing is "show the member as one active presence"; a running sibling means the member is still productively working, and the per-instance error is still visible on expand + surfaced in the activity row when no instance is running. Surfaced as **§6 Q1** for sponsor confirmation, with `running > error` as the default.

### 2.4 Headline instance (drives row-3 activity + sprite tool-pose)

The aggregate state names a *tier*; the **headline instance** is the specific instance whose activity row 3 shows and whose tool decides the sprite read-vs-work pose:

- Headline = the **most-recently-active** instance within the winning tier (by `finishedAtMs` for finished, or freshest JSONL activity for running/idle). Ties broken by `agentId` lexical order (deterministic, stable across ticks — no flicker).
- Row 3 renders that instance's `activity` string (e.g. `tool:Edit reducer.ts`). Row 4 renders that instance's `model` + the aggregate `state·elapsed` + `(N agents)`.
- This keeps row 3 single-line and meaningful — it's "the most relevant thing happening" rather than an unreadable merge.

### 2.5 Per-member running color still applies

When the aggregate is `running` and the matched member has a `member.color` (roster YAML, `roster-matching.md` §color), the state dot paints in that color (overriding `--ct-color-state-running`), exactly as the single tile (`whole-team-display-spec` §2.2). idle/error/finished/available aggregates use the semantic state colors. No change to the color rule — it just keys off the aggregate state now.

---

## 3. Expand / collapse interaction

### 3.1 Where the instance list sits

The instance list renders **inline, below rows 1–4, INSIDE the same tile** (not a popup, not a separate panel). It is a child region `.persona-instances` that is `hidden` when collapsed and block when expanded. Expanding **grows the tile downward**; sibling tiles below reflow (acceptable — this is a deliberate user action, not a state tick).

```
┌─ Felix tile (data-expanded="true") ───────────────────────┐
│  ┌────┐ ● Felix [×2 ▾]                          [⋯]        │   rows 1–4 unchanged
│  │spr.│ Extension Host Dev                                 │
│  └────┘ tool:Edit reducer.ts   Sonnet·running 2m (2 agents)│
│  ┌─ .persona-instances ───────────────────────────────────┐│
│  │ ● a1d53b4a   running 2m    tool:Edit reducer.ts         ││   .persona-instance-row (running headline first)
│  │ ◐ 7b53d0ee   finished 4m   finished                     ││   .persona-instance-row
│  └─────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

### 3.2 Instance row anatomy

Each `.persona-instance-row` is a compact single line (NO sprite — the sprite belongs to the persona tile, not per instance; design discipline + avoids N animating sprites in one tile):

| Element | Content | Treatment |
|---|---|---|
| state dot | per-instance state (`● ◐ ○` etc.) | `--ct-state-dot-size`, semantic state color (per-member color NOT applied at instance level — instance dots stay semantic so the failure/idle mix is legible) |
| short id | first 8 chars of the instance `agentId` (or session shortId if more useful — §6 Q2) | `--ct-color-fg-muted` monospace; aria-label "agent id" |
| state·elapsed | `running 2m` / `finished 4m` / `idle 30s` / `error` | the per-instance state + humanized elapsed |
| activity | per-instance `tool:<name> <arg>` or `finished` / `error: <reason>` | `--ct-color-fg-muted`; truncate with ellipsis at the tile width |

Rows are **ordered most-active-first** (running → error → idle → finished), so the headline instance leads. Each row is **clickable → drill-in** (opens that instance's JSONL — reuses the existing `ui:open-transcript` message with that instance's `sessionId` + `agentId`). Hover highlight via `--vscode-list-hoverBackground`.

### 3.3 The expand toggle + keyboard / focus

- **Toggle:** the `[×N ▸]` badge IS the expand control (§1.3). It's a `<button>` with `aria-expanded`, `aria-controls` pointing at the `.persona-instances` region id.
- **Click / Enter / Space** on the badge toggles expansion. Chevron flips `▸`↔`▾`.
- **Keyboard nav inside the expanded list:** Up/Down move focus between `.persona-instance-row`s (each row is focusable, `tabindex` managed roving-style); Enter/Space on a row fires its drill-in; **Esc collapses** the list and returns focus to the `[×N]` badge (focus management — design discipline).
- **Tab order:** badge → overflow `[⋯]` → (if expanded) first instance row → … → next tile. Collapsing removes the instance rows from the tab order (`hidden`).
- **Expansion persistence:** expanded/collapsed state is **webview-local ephemeral UI state**, keyed by `memberId` (not by instance set), and **preserved across re-renders / state ticks** (mirrors the M3-10 `expandedGroupsTracker.ts` pattern — Obs 10 fix `86c9zfmh1`). A state tick that changes an instance's activity must NOT collapse an open list. Reuse / generalize `expandedGroupsTracker` keyed by `memberId`.
- **Default state:** **collapsed.** The single tile + `×N` badge + aggregate state is the resting view; expand is opt-in per the sponsor's option-A intent (one clean tile per member). (Exception consideration — auto-expand on `error` aggregate — surfaced §6 Q3; default is "stay collapsed, the error dot + activity row already signal it.")

### 3.4 Animation

- Expand/collapse uses `--ct-duration-state-transition` (200ms) height transition; no flash, no full-tile re-render (diff at the instance-list level).
- No per-instance entrance animation (keeps it calm; the list is informational, not decorative).

---

## 4. Difference from the unrostered background +N chip (UNCHANGED)

This spec touches **rostered members only**. The unrostered background-noise treatment is **explicitly out of scope and unchanged**:

| | Rostered multi-agent (THIS spec) | Unrostered background **+N chip** (unchanged) |
|---|---|---|
| What it represents | ONE named roster member running N≥2 instances | The aggregate of all **unmatched** agents in a session |
| Visual | A full **persona tile** (sprite + name + role + state) with `×N` badge + inline expand | A single **count chip** `+ N background agents (this session)` with an expandable plain detail list (`roster-matching.md` § Background-noise) |
| Identity | Per-member; the persona is the unit | Per-session; no per-member identity (these aren't on the roster) |
| Sprite | Yes — the member's persona character | No sprite — background agents have no persona |
| Why different | The sponsor curated these — they deserve named, always-present tiles (whole-team thesis) | Background is *noise to be aware of*, not stared at — collapse to a count, never hide (`architecture-overview` non-goals) |

**Hard line:** the `×N` badge on a persona tile and the `+N` background chip are **different components** serving different jobs. Do not converge them. A rostered member never collapses into the background chip, and the background chip never grows persona tiles. (This is the exact failure the sponsor's option-A decision corrects: rostered members were wrongly rendering in a count-group style that *looked like* the background chip.)

---

## 5. Host vs webview ownership decomposition

This is the parallel-coordination output of the spec (per `orchestration-overview` § Iris-leads-with-spec). Felix and Maya build against the same vocabulary contract (§5.4) on disjoint file zones.

### 5.1 Host (Felix) owns: aggregate + instance list emission

The reducer (`src/extension/state/reducer.ts` `buildAgentTree`) is the **single authority** for grouping and aggregate state. It emits, per rostered member with N≥2 live instances, a single wire entry carrying:

- the **member identity** (memberId, teamId, display, role, color) — same fields as a single `AgentTile`;
- the **aggregate state** (computed per §2.1 — host-side, deterministic);
- the **headline activity + model** (the §2.4 headline instance's `activity` + `model`);
- the **count** N;
- the **instance list** — an array of the per-instance `AgentTile`s (each with its own state / activity / agentId / sessionId / finishedAtMs), ordered most-active-first (§3.2).

The webview does **not** compute the aggregate or re-order instances — it renders what the host emits (`architecture-overview`: state in the host is not duplicated in the webview). The aggregate-state function is unit-testable host-side (pure), reusing/extending the `computeGroupState` logic currently in `collapsedPersonaTile.ts` — but **moved host-side** (see §5.5) and extended for `error` + `available`.

### 5.2 Webview (Maya) owns: tile + badge + expand render

The webview renders the host's entry:

- the **persona tile** (reuse `whole-team-display-spec` §2.1 tile + the existing `renderAgentTile` chrome) skinned to the **aggregate state**;
- the **`×N` badge** + chevron (§1.3) — net-new render hunk;
- the **expand region** `.persona-instances` + per-instance rows (§3.2) — net-new;
- **expansion state tracking** keyed by `memberId` (generalize `expandedGroupsTracker.ts`);
- **keyboard / focus management** (§3.3).

The webview pulls the sprite pose from the aggregate state (§1.4) using the existing sprite player; no new sprite work.

### 5.3 Data-model ask for Felix (sign-off gated — no assumption)

Per CLAUDE.md "No data-model changes without Felix's sign-off," the wire shape is a **proposal**, not a baked assumption. Two shapes for Felix to choose:

- **(A) Reshape `CollapsedPersonaGroup` into a `MultiAgentPersonaTile`** that carries the full member identity + `aggregateState` + `headlineActivity`/`headlineModel` + `count` + `instances: AgentTile[]`. The rostered `RosterTileEntry` union becomes `AgentTile | MultiAgentPersonaTile`. The discriminator stays `kind` but the value changes (see §5.5).
- **(B) Keep `CollapsedPersonaGroup`'s name** but add the missing fields (`aggregateState`, `display`, `role`, `color`, `headlineActivity`, `headlineModel`) so it carries full persona identity rather than just `personaName` + `count` + `instances`.

**RECOMMENDATION: (A) a clearly-renamed `MultiAgentPersonaTile`** — the M3-10 `CollapsedPersonaGroup` was a *header-tile* concept (different chrome, "most-active-first" only); option A makes it a *full persona tile*, a different enough concept that a rename prevents a future reader from assuming the old header-tile behavior. Felix scopes whether the `AgentState` aggregate is a new field or reuses the existing `AgentState` union. **Felix edge:** (a) `RosterTileEntry` union change is a shared-type edit touching reducer + CLI flattener (`src/cli/agentTree.ts`) + diagnostics (`src/diagnostics/render.ts`, `src/extension/diagnostics/output.ts`) + tests; confirm those consumers handle the renamed shape. (b) the `claudeteam.collapsePersonaTiles` config flag (M3-10, default true) — under option A, **a rostered member ALWAYS renders as one tile**, so the "flat list of N tiles" opt-out no longer applies to rostered members; Felix decides whether the flag is retired, repurposed (toggle the badge/expand affordance only), or left as a no-op for rostered. Recommend: the flag now toggles **expand-by-default** rather than tile-vs-flat (surfaced §6 Q4).

### 5.4 Vocabulary contract (LOCKED — parallel-dispatch safe)

Both Felix and Maya read identical identifiers (per the user-global parallel-shared-concept discipline):

| Concept | Identifier |
|---|---|
| Wrapper type (recommended option A) | `MultiAgentPersonaTile` |
| Discriminator field + value | `kind: "multi-agent-persona"` |
| Union alias | `RosterTileEntry = AgentTile \| MultiAgentPersonaTile` |
| Type guard | `isMultiAgentPersonaTile(entry): entry is MultiAgentPersonaTile` |
| Aggregate-state field | `aggregateState: AgentState` |
| Headline fields | `headlineActivity: string`, `headlineModel: string` |
| Count field | `count: number` (== `instances.length`) |
| Instance list field | `instances: AgentTile[]` (ordered most-active-first by the host) |
| Export site | `src/shared/types.ts` (consumers import from here) |
| Aggregate-state helper | `computeAggregateState(instances): AgentState` in `src/shared/types.ts` (pure; host + tests import) |
| Webview component | `src/webview/components/multiAgentPersonaTile.ts` |
| Webview CSS hooks | `.agent-tile[data-count]`, `.persona-count-badge`, `.persona-instances`, `.persona-instance-row` |
| Expansion tracker key | `memberId` (string) |

If Felix chooses option B instead, the contract's type name + discriminator value change to `CollapsedPersonaGroup` / `"collapsed-persona"` (retained); all other identifiers stand. **Lock the choice (A vs B) before parallel dispatch** — it's the one ambiguous identifier. Recommend A.

### 5.5 M3-10 `CollapsedPersonaGroup` migration

The current path (`src/shared/types.ts:410-455`, `src/webview/components/collapsedPersonaTile.ts`):

- `CollapsedPersonaGroup { kind: "collapsed-persona"; personaName; count; instances }` — a header tile, expand reveals instances, `computeGroupState` = `running > idle > finished`.

**Migration under option A:**

1. **Rostered members:** replaced by `MultiAgentPersonaTile` (full persona tile, §5.3 option A). The header-tile chrome (`collapsedPersonaTile.ts` `<section class="collapsed-persona">` + `collapsed-persona-header` button + `×N` in a bare header) is **retired for rostered members** — superseded by the §1.2 persona tile.
2. **`computeGroupState`** → moved host-side and renamed `computeAggregateState`, extended with the `error` tier (§2.3) + `available` floor. The webview no longer computes group state.
3. **Uniform-cluster polish (`autoCollapseUniformClusters`, 86c9zmqa8)** — that feature decorated `CollapsedPersonaGroup` with auto-collapse + compact-row layout for all-same-state non-running groups. Under option A the tile is *already* one tile (always "collapsed" to a single persona tile), so the auto-collapse half is **subsumed**; the **compact-row instance layout** can carry forward as the `.persona-instance-row` styling (§3.2). Felix/Maya confirm the `autoCollapseUniformClusters` flag's fate alongside `collapsePersonaTiles` (§5.3 / §6 Q4).
4. **Back-compat:** if the orchestrator still wants the old header-tile for any non-rostered grouping, that path is OUT OF SCOPE here (this spec is rostered-only); the unrostered +N chip (§4) is the only other grouping and it is unchanged. Net: `CollapsedPersonaGroup` can be fully retired once the rostered path migrates — Felix confirms no other live consumer.

> This migration is exactly the kind of shared-concept-rename the orchestration docs warn about; the §5.4 vocabulary contract is the prevention. Felix's review should grep both worktrees for `CollapsedPersonaGroup` / `collapsed-persona` and confirm every consumer is migrated or retired.

---

## 6. Sponsor open questions (away-queue feed)

| # | Question | Iris recommendation |
|---|---|---|
| **Q1** | Aggregate precedence — when one instance is `running` and another is `error`, should the tile read **running** (recommended) or **error**? | **running > error.** Option A frames the member as one active presence; a running sibling means work isn't dead. The error stays visible on expand + in the activity row when nothing is running. (§2.3.) |
| **Q2** | Instance-row identifier — show the **agent id** (first 8 chars, recommended) or the **session shortId**? | **Agent id (first 8).** When N instances run in the *same* session, sessionId is identical across rows and useless as a discriminator; agentId is unique per instance. Show session only if instances span sessions (rare). (§3.2.) |
| **Q3** | Should an **error aggregate auto-expand** the instance list (to surface which instance failed), or stay collapsed (error dot + activity row signal it)? | **Stay collapsed** (default). The error dot + the error summary in row 3 already flag it; auto-expanding fights the option-A "one clean tile" intent. Easy to flip if the sponsor wants louder error surfacing. (§3.3.) |
| **Q4** | Fate of the M3-10 `collapsePersonaTiles` flag (and `autoCollapseUniformClusters`) — retire, or **repurpose to toggle expand-by-default**? | **Repurpose:** `collapsePersonaTiles=false` → multi-agent tiles render **expanded by default**; `true` (default) → collapsed. Keeps the opt-out meaningful without resurrecting flat-list mode (which option A forbids). `autoCollapseUniformClusters` folds into the expand-default behavior. (§5.3 / §5.5.) |

---

## 7. Out of scope / guardrails

- **Background +N chip unchanged** (§4). Unrostered agents still collapse to the per-session count chip — this spec is rostered-only.
- **Multi-session detection unchanged.** This spec does not change how instances are detected, matched, or which sessions surface (cwd-against-workspace filter stands). It only changes how N≥2 detected+matched instances of one member are *rendered*.
- **No code.** Spec + decomposition only; Felix builds the host aggregate + wire shape, Maya builds the tile/badge/expand.
- **One sprite per persona tile.** No N animating sprites in one tile; instance rows are sprite-less (§3.2).
- **No per-instance member color.** Per-member color paints the aggregate dot only; instance-row dots stay semantic (§3.2 / §2.5).
- **No new framework.** Vanilla TS webview (M2 decision). Expand region is a hand-rolled height transition.
- **No data-model field assumed** — §5.3 / §5.4 are proposals for Felix's sign-off; the type name (A vs B) must be locked before parallel dispatch.
