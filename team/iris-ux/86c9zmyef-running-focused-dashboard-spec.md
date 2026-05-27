# Running-focused dashboard spec — member colors + hide-idle-by-default

Design spec for the V1-reframe sponsor proposed 2026-05-27: shift the dashboard's primary purpose from "audit which rostered members exist" to "show who's actively working right now". Two coupled mechanisms — a **member-defined color on the running-state dot** so each rostered persona is instantly identifiable at a glance, and a **hide-idle-by-default behavior** so the running set is the unfiltered foreground. A transition strategy (feature flag vs. settings toggle vs. full replacement) is recommended in §4.

- **Ticket:** [ClickUp 86c9zmyef](https://app.clickup.com/t/86c9zmyef) — `feat(ux): running-focused dashboard (member colors + hide-idle-by-default)`
- **Owner:** Iris
- **Peer reviewer (this spec PR):** Felix per the design-PR cross-review pairing (spec edges — feasibility of the color rule under current reducer / state-shape; feasibility of the idle-collapse pattern under current `RosterTileEntry` types).
- **Downstream impl tickets:** TBD — filed after sponsor approves the spec direction.
- **Source quote (paraphrased, sponsor 2026-05-27):** dashboard should be reframed from "show me who exists" to "show me who is working right now"; running dot should carry a member-defined color (roster-side); idle members should collapse out of sight by default.
- **Source artifacts (live `main` reads, all verified by orchestrator-side grep/Read 2026-05-27):**
  - `src/shared/types.ts:104-116` — `Member` interface; `color?: string` already optional on the schema.
  - `src/shared/types.ts:259` — `AgentState = "running" | "idle" | "finished" | "error"` enum.
  - `src/shared/types.ts:265-321` — `AgentTile` shape (no per-tile color field today; member identity is `memberId` + `teamId` only).
  - `src/shared/types.ts:495-547` — `AgentTree.config` block (existing mirror for `hideFinishedAgents`, `autoCollapseUniformClusters`).
  - `src/webview/components/agentTile.ts:208-215` — current state-dot DOM (`<span class="state-dot" data-state>`, no inline style today).
  - `src/webview/styles/dashboard.css:56-60` — `--ct-color-state-{running,idle,finished,error}` hardcoded hex tokens (Material palette per M4-01 §1.2.3).
  - `src/webview/styles/dashboard.css:247-274` — `.state-dot` block + per-state selectors.
  - `package.json:96-115` — existing dashboard config scalars (`collapsePersonaTiles`, `hideFinishedAgents`, `autoCollapseUniformClusters`).
  - `.claude/docs/roster-matching.md:13-28` — roster YAML schema already documents the optional `color: "#RRGGBB"` field.
  - `team/iris-ux/m4-polish-spec.md` §2.2 — state-visual conventions (running = pulse + full opacity; idle = static + opacity 0.78 on rows 2–4; etc.).
  - `team/iris-ux/m5-hide-finished-spec.md` §3.2 / §3.5 / §6 — wrapper-aware filter precedent (this spec extends the same pattern to `idle`).
  - `team/iris-ux/86c9zmqa8-uniform-cluster-spec.md` — option-shape format precedent (this spec uses the same structure).
- **Authoring discipline:** Theme-aware first (CLAUDE.md). No new tokens beyond what M4-01 §1 already declares + the one new token-class introduced in §2.4 (`--ct-color-running-dot` per-tile override slot). No new icon set. No animation framework changes.

---

## 0. Scope summary

| Section | Surface | Notes |
|---|---|---|
| §1 Problem statement | (design — no code) | Reframes sponsor's intent; defines "running-focused". |
| §2 Member color on running dot | host + roster schema + webview render | Schema already permits `color`; spec defines flow + validation + theme-contrast rule. |
| §3 Hide-idle-by-default | new config scalar + filter pass + chip | Mirrors M5's `hideFinishedAgents` pattern at structural level (re-uses chip / config-mirror conventions). |
| §4 Transition strategy | (design — picks shipping shape) | Recommend: pair of settings scalars, defaulting to the new behavior — A+B. |
| §5 ASCII wireframes | (design — three scenarios) | Rostered+running, rostered+idle-collapsed, finished-shown. |
| §6 Out of scope for V1 | (design — guardrails) | Multi-color-per-member, per-state color, color animation, color presets. |
| §7 Vocabulary contract | (downstream impl) | All identifier names pre-named per parallel-dispatch rule. |
| §8 Sponsor questions | (away-queue feed) | 4 open questions with recommendations. |
| §9 Composition with prior specs | (cross-section) | M5 hide-finished, M3-10 wrappers, M4-01 state visuals, 86c9zmqa8 uniform clusters. |
| §10 Audit trail | (sourcing) | Every cited identifier sourced from live `main` reads. |

---

## 1. Problem statement

### 1.1 Sponsor's reframe (paraphrased 2026-05-27)

The dashboard's current visual thesis is **"who's on the team and what is each member doing right now"**: every rostered persona renders a tile per dispatch — whether running, idle, or finished — and the sponsor's eye has to scan all of them to find the one(s) actually doing work. The proposed reframe is **"show me who is working right now, by name and color, and let everything else fade out of sight"** — running members are the only foreground; idle is collapsed; finished can be hidden via the existing M5 surface; the dashboard becomes a live-activity readout rather than a roster audit.

Two specific mechanisms requested:

1. **Member-defined color on the running dot.** Each rostered member's running-state dot renders in a roster-supplied color, distinguishing personas at a glance without reading the name (sponsor's eye learns "the blue dot is Felix; the green dot is Maya"). Idle / finished / error states retain the M4-01 semantic state colors — running gets the personalization.
2. **Hide-idle-by-default.** Idle members fall out of the foreground unless the sponsor opts in. The "N idle" group-hint is still visible (so the sponsor knows there are idle members; the dashboard isn't lying), but the per-instance tile rows for idle members don't render unless the sponsor expands the group.

### 1.2 Why this is a V1 thesis shift, not a polish pass

The 86c9zmqa8 uniform-cluster spec polished a sub-case (visual cost of expanding a uniform group). The M5 hide-finished spec added a filter for terminal-state tiles. This spec **changes the default visual thesis of the dashboard**: idle becomes a second-class state by default. That's a bigger shift than "polish the cluster expand"; it deserves an explicit transition strategy (§4) rather than just landing as a polish PR.

### 1.3 What stays the same

- **The roster is still the source of truth for membership.** A member with no live dispatches still appears (as an empty roster row OR a collapsed entry — see §3.4) so the sponsor knows the roster intent. The dashboard does NOT pretend a configured-but-quiet member doesn't exist.
- **Background-noise treatment unchanged.** Background agents still collapse to the count chip per `roster-matching.md` "Background-noise display". This spec is a rostered-tile concern.
- **State-dot semantics unchanged for non-running states.** Idle = `--ct-color-state-idle` (M4 §2.2). Finished = `--ct-color-state-finished` + check overlay. Error = `--ct-color-state-error`. Only the running dot gets per-member color.
- **Finished filter (M5) and uniform-cluster collapse (86c9zmqa8) compose unchanged.** This spec adds a sibling filter for `idle` and a member-color paint pass; it does NOT replace the M5 / 86c9zmqa8 surfaces.

---

## 2. Member-defined color on running dot

### 2.1 The schema (already done — V1 schema is sufficient)

Per `src/shared/types.ts:104-116` (live `main` read 2026-05-27):

```typescript
export interface Member {
  id: string;
  display: string;
  role: string;
  color?: string;        // ALREADY DEFINED — optional hex per member.
  match: MatchRule[];
}
```

And per `.claude/docs/roster-matching.md:13-28`:

```yaml
members:
  - id: felix
    display: "Felix"
    role: "Extension Host Dev"
    color: "#5d8aa8"        # Already documented in the schema.
    match: [...]
```

**No schema change required.** The roster YAML's `color` field has existed since M1; it's been threaded through the roster loader and parsed onto `Member.color` but not yet consumed by the webview's state-dot render path (currently the webview's CSS uses `--ct-color-state-running` for every running dot regardless of member).

### 2.2 What this spec adds — the wire field

Today's `AgentTile` (`src/shared/types.ts:265-321`) does NOT carry the member's color. The webview only knows `tile.memberId` + `tile.teamId`; it has no path from "Felix the tile" to "Felix the member's `color`".

Add ONE new optional field to `AgentTile`:

```typescript
/**
 * Optional hex-color string from the matched roster `Member.color`. When
 * defined, the webview paints the RUNNING-state dot in this color
 * (overriding `--ct-color-state-running`). Idle / finished / error states
 * IGNORE this field — they retain the M4-01 semantic state colors.
 *
 * Format: 6-digit hex with leading `#` (e.g. `"#5d8aa8"`). Other formats
 * (rgb(), named colors, 3-digit hex) are NOT supported in V1 — the loader
 * normalizes to 6-digit lowercase hex or drops the field with a warning.
 *
 * Optional for back-compat with rosters that don't set `color` and with
 * pre-86c9zmyef wire consumers; absent → webview renders running dot in
 * the default `--ct-color-state-running` token.
 *
 * Source: spec 86c9zmyef §2.2.
 */
memberColor?: string;
```

**Why on `AgentTile` (not derived in the webview from `memberId`):** the webview today has no roster reference — only the reducer's projection (`SessionTree.rosterTiles[teamId] → RosterTileEntry[]`). Adding a roster lookup to the webview would mean either threading the full `Team[]` down the wire (large, redundant with the tile's existing identity) OR sending a `Map<memberId, color>` alongside (small but a new wire field). Both worse than stamping the color on the tile at host-side projection: the tile already exists per-dispatch, the field is at-most 7 chars when present, and the path from `Member.color → AgentTile.memberColor` is one assignment in `buildAgentTree`.

**Wire-shape impact:** one new optional field on `AgentTile`. JSON-safe (string | undefined). Back-compat — pre-86c9zmyef wire emitters omit it; webview defaults to current behavior.

### 2.3 Default-color rule (when `member.color` is omitted)

Two reasonable behaviors. Spec **recommends Option A**:

- **Option A — `member.color` omitted ⇒ `tile.memberColor` undefined ⇒ webview renders running dot in `--ct-color-state-running` (current behavior, default Material green).** This is the "opt-in personalization" model: members get the default semantic color until the sponsor decides to personalize. The first-install / fresh-roster experience matches the current dashboard exactly.
- **Option B — auto-generate a stable per-member color from `member.id` hash if not specified.** This is the "every member gets a distinct color always" model. Higher visual variety out of the box, but the colors are essentially random — sponsor can't predict that Felix will be blue without opening the dashboard, and contrast-against-theme is uncontrolled.

**Recommendation: Option A.** Rationales:

1. Sponsor authored the request; the personalization is a sponsor act of curation. Auto-generated colors short-circuit that act.
2. Auto-generation introduces a hidden source of theme-contrast bugs (the generator can land on a near-white color in light theme; sponsor never asked for it). Personalization is a controlled choice.
3. Reversibility: if Option A turns out to be too quiet (sponsor wants distinct colors but doesn't want to write 8 hex values), Option B can be added later as a `claudeteam.autoGenerateMemberColors` opt-in. The reverse (auto-generating by default, then carving out opt-out) is harder to walk back without forcing sponsors to relearn the dashboard.

§8 Q3 reserves the call for sponsor confirmation.

### 2.4 Webview render — how the color paints

The current `.state-dot` block (`src/webview/styles/dashboard.css:247-274`):

```css
.state-dot { background-color: var(--ct-color-fg-muted); ... }
.state-dot[data-state="running"] { background-color: var(--ct-color-state-running); }
```

The proposed override layer adds a CSS custom property bound on the article element:

```css
/* On agentTile.ts render, when tile.memberColor is set, the article gets:
     style="--ct-color-running-dot: #5d8aa8;"
   The state-dot reads the override; falls back to the semantic token
   when undefined. */
.state-dot[data-state="running"] {
  background-color: var(--ct-color-running-dot, var(--ct-color-state-running));
}
```

The renderer in `agentTile.ts` adds (after the `data-state` setattr, ~line 155):

```typescript
if (tile.memberColor !== undefined) {
  article.style.setProperty("--ct-color-running-dot", tile.memberColor);
}
```

**No global CSS rule churn.** Existing M4-01 tokens are untouched; the new `--ct-color-running-dot` is a per-tile inline custom property with a fallback to the existing token, so untagged tiles paint exactly as today.

**Pulse animation still runs.** M4-01 §2.4's `ct-pulse` animation runs on `.state-dot[data-state="running"]` — it animates `box-shadow` / `transform`, not `background-color`, so the pulse just inherits whatever color the dot paints. No animation rule needs to know about `memberColor`.

### 2.5 Theme-contrast considerations

Sponsor-supplied colors can be near-invisible against either VS Code's dark or light theme background. The webview cannot solve this universally (the sponsor chose the color), but the spec sets three guardrails:

1. **Documented contrast suggestion.** `roster-matching.md` already documents the `color` field; the spec extends that doc with a brief note: "*Pick a color that contrasts with both light and dark editor backgrounds. Material palette mid-saturation values (e.g. `#5d8aa8`, `#9caf88`, `#cd853f`) typically pass; pure black (`#000`) or pure white (`#fff`) will fail one theme.*" No hard rule — sponsor authority.
2. **Sponsor selects the color; webview does not augment contrast.** No automatic outline / halo / shadow guardrail is layered behind a low-contrast `memberColor` — live `src/webview/styles/dashboard.css` paints the running dot as opacity-only (verified during PR #98 impl). Contrast is left to sponsor color selection at roster-yaml time; the documented contrast suggestion (item 1 above) is the only nudge. Members with `color` unset or dropped-as-invalid fall back to `--ct-color-state-running` per §2.3 Option A and §2.6 — those tiles render with the same default visibility as pre-reframe.
3. **Validation drops invalid colors with a warning surface.** See §2.6.

### 2.6 Invalid-color handling

The roster loader (`src/extension/roster/loader.ts` — Felix's surface) validates `member.color` as follows when reading the YAML:

| Input | Behavior |
|---|---|
| Field absent | `Member.color = undefined`. No warning. Falls back to semantic color (Option A default). |
| Field present, **valid 6-digit hex** with `#` (case-insensitive) | `Member.color = "#" + lowercase`. No warning. |
| Field present, **valid 3-digit hex** (e.g. `"#5da"`) | Expand to 6-digit (`#55ddaa`), normalize to lowercase. No warning. **(Optional — see §8 Q4)** |
| Field present, **invalid format** (e.g. `"reddish"`, `"rgb(255,0,0)"`, `"5d8aa8"` no `#`) | Drop the field (`Member.color = undefined`). Emit a `RosterLoadResult.warnings` entry: `"team '<teamId>' member '<memberId>': invalid color '<raw>' — expected 6-digit hex with leading '#'. Falling back to default running color."`. The existing roster-warning chip (M3-04) surfaces the warning to the sponsor; no crash. |

**Why dropping, not erroring:** an invalid color is a typo, not a configuration crisis. The dashboard should still render with semantic colors; the warning chip tells the sponsor to fix the YAML.

**Why not accepting `rgb()` / named colors / 8-digit hex:** V1 surface is narrow. Sponsors can manually convert any color picker output to 6-digit hex. Extending the accepted formats is post-V1 polish.

---

## 3. Hide-idle-by-default

### 3.1 The pattern — clone M5's hide-finished structure

M5 already shipped the canonical "filter at host-side `serializeState` entry + render a header chip + mirror config back to the webview" pattern (`team/iris-ux/m5-hide-finished-spec.md` §3, §4). This spec **clones that structure for `idle`** rather than inventing a new mechanism. Reusing it means:

- Same filter location (host-side, post-reducer projection).
- Same wire-shape extension pattern (one new count field, one new entry under `AgentTree.config`).
- Same chip pattern (a `data-hide-idle` `<aside>` button alongside the existing `data-hide-finished` chip).
- Same `ui:set-config` message protocol; only the `key` literal extends to a new union member.

### 3.2 The config scalar

Add ONE new key to `package.json` `contributes.configuration.properties`:

```json
"claudeteam.hideIdleAgents": {
  "type": "boolean",
  "default": true,
  "description": "Hide rostered agent tiles whose state is 'idle'. When true (default), the dashboard suppresses idle tiles by default — running members are the foreground. An 'N idle hidden — show' chip in the header reveals the hidden tiles on click. Default true; turn off to restore the show-everything M5-baseline behavior."
}
```

**Why default `true` (different from M5's default-`false` for `hideFinishedAgents`):**

The sponsor explicitly requested hide-idle-**by-default** in the verbatim. M5's `hideFinishedAgents` defaulted to `false` because terminal-state hiding has a "where did my agent go?" risk; M5-Q2 confirmed it. `hideIdleAgents` defaulted to `true` is the spec's central design statement — the running-focused dashboard's first-install experience IS the running-focused experience. Sponsors who want the old M5-baseline can flip the chip OFF.

Composition with M5: `hideFinishedAgents` is independent. Both can be true (the dashboard shows only running members + a few count chips); both can be false (the M2-baseline). One can be flipped without affecting the other.

§8 Q1 reserves the `default: true` call for sponsor confirmation.

### 3.3 The filter — `applyHideIdleFilter`

Mirroring `applyHideFinishedFilter` from M5 (`src/extension/state/hideFinishedFilter.ts`):

```typescript
// In src/extension/state/hideIdleFilter.ts (NEW), or merged with hideFinishedFilter into a
// generic stateFilter.ts — see §3.6 implementation note.
export interface HideIdleResult {
  tree: AgentTree;
  hiddenIdleCount: number;
}

export function applyHideIdleFilter(
  tree: AgentTree,
  hideIdle: boolean,
): HideIdleResult;
```

**Filter semantics (parallel to M5 §3.2):**

1. **When `hideIdle === false`:** identity transform — `{ tree, hiddenIdleCount: 0 }`.
2. **When `hideIdle === true`:**
   - For each `SessionTree.rosterTiles[teamId]`:
     - For each `RosterTileEntry`:
       - **Bare `AgentTile` with `state === "idle"`** → drop it; increment `hiddenIdleCount`.
       - **`CollapsedPersonaGroup`**: walk `instances`; drop each `state === "idle"`; increment counter per drop. If ALL drop, the wrapper drops entirely. If SOME drop, the wrapper is rebuilt with the survivors (N=1 unwraps to a bare `AgentTile` per existing M3-10 contract; N=0 drops the wrapper).
   - **Empty team after filtering → team card suppressed** (existing M2 §6 invariant).
   - **Background agents NOT filtered.**
   - Return the filtered tree + count.

**Composition with M5 filter:** apply `hideFinishedFilter` first, then `hideIdleFilter` on its result. Order is symmetric (`finished` and `idle` are disjoint states, no double-counting risk), but the deterministic order avoids surprise. The wire-shape carries both counts independently.

**Composition with 86c9zmqa8 uniform-cluster behavior:** the auto-collapse gate (`computeIsUniform`) fires AFTER the host-side filters; the filter operates on the wire-shape pre-render. Once `idle`-state tiles are filtered out, a previously-uniform `idle` cluster either disappears entirely OR becomes a `running`-cluster (no longer uniform-eligible per the §1.2 exclusion rule). No conflict.

### 3.4 The collapsed "N idle" group hint — TWO design alternatives

This is the spec's biggest design call. The sponsor's request is "idle members collapsed under 'N idle' group hint" — but where does the hint live?

**Option A — Per-team collapsed row (recommended).** Inside each team card, if any of that team's tiles were filtered as `idle`, render one collapsed-row affordance at the END of the team's tile list:

```
┌── Team: ClaudeTeam Alpha ────────────────────┐
│  [Felix tile — running]                       │
│  [Maya tile — running]                        │
│  ─ 3 idle hidden — show ─                     │ ← collapsed row (clickable)
└───────────────────────────────────────────────┘
```

Clicking the row toggles a per-team expanded view that renders the idle tiles inline (in the same team card, below the running tiles). The toggle is webview-local state (NOT persisted to config); a re-render or re-mount resets it.

Pros: per-team context is preserved (the sponsor sees "ClaudeTeam Alpha has 3 idle"). Click is local — the global chip stays for the global filter; the per-team row is a quick-peek. Composes cleanly with existing team-card rendering (`teamCard.ts`).

Cons: two surfaces (per-team row + global chip). Two affordances to learn.

**Option B — Global "N idle hidden — show" chip only.** Reuse the M5 chip pattern wholesale: one header chip controls global filter. Per-team rows do NOT render the "N idle" hint. Sponsor clicks the global chip → idle tiles unfilter globally → reappear in their team cards.

Pros: single mechanism — clones M5 exactly. Lower impl cost. Less screen real estate consumed per team card.

Cons: per-team awareness is lost. Sponsor sees the count "12 idle hidden" but can't tell whether those 12 are spread across teams or concentrated in one team without unfiltering them all.

**Recommendation: Option A + B together (both surfaces).** The global chip is the canonical filter control (matches M5 pattern; one source of truth for the config state). The per-team rows are passive informational hints — they show "this team has N idle" without their own interactivity (the click on the row OR on the global chip both go to the global filter; the row is a smaller affordance that fires the same `ui:set-config` message). This keeps the global chip as canonical while restoring per-team awareness.

If per-team click should toggle ONLY that team's idle (not global), that's a per-team-scoped filter — significantly more complex (per-team config state, new wire fields, new chip variant). NOT in V1 scope; flagged as post-V1 follow-up if dogfood asks for it.

§8 Q2 reserves the choice between Option A, B, or A+B for sponsor confirmation.

### 3.5 Finished-tile treatment under the new defaults

With the running-focused defaults, finished tiles need a coordinated answer:

| `hideIdleAgents` | `hideFinishedAgents` | What renders |
|---|---|---|
| `true` (default) | `false` (M5 default) | Running tiles + finished tiles + idle collapsed under "N idle" hint. Finished IS visible — keeps the "I just saw it complete" affordance (M5 §1.4 rationale). |
| `true` | `true` | Running tiles only. Idle and finished both filtered; both chips show counts. Maximum running-focus. |
| `false` | `false` | M5 baseline (status quo before this spec). Show everything. |
| `false` | `true` | Running + idle + bg, no finished. Existing M5-on state. |

**Spec ships with the (`hideIdleAgents=true`, `hideFinishedAgents=false`) pair as the V1 default.** Sponsor opts into the maximum-focus mode by flipping the M5 chip too. No additional finished-tile logic — M5's existing pattern is unchanged.

§8 Q1 also covers whether `hideFinishedAgents` should flip default from `false` to `true` in this V1-reframe. Spec recommends **leaving M5's default alone** — finished is different from idle (terminal vs alive), and M5's design rationale (Q2: install-safety) still holds.

### 3.6 Implementation note — file co-location

Two reasonable splits for Felix's host-side impl:

- **Split A — two filter files (`hideFinishedFilter.ts` + `hideIdleFilter.ts`)**, applied in sequence. Mirrors M5's existing layout; each file is small + testable in isolation. Lower diff cost.
- **Split B — one generic `stateFilter.ts` exporting `applyStateFilter(tree, { hideFinished, hideIdle })`**, replacing both. Single source of truth for both filters; future per-state filters extend the same module. Higher refactor cost (M5's existing `hideFinishedFilter.ts` rewires; tests update).

**Recommendation: Split A for V1.** M5's file already exists, ships, and is tested. Adding `hideIdleFilter.ts` next to it is a minimum-change addition. Split B is the right post-V1 refactor if a third state filter (`hideErrorAgents` — almost certainly never) appears; for V1 with exactly two filters, the duplication cost is trivially small.

§8 — no sponsor question, Felix's call at impl time.

---

## 4. Transition strategy

The sponsor explicitly asked about this: feature flag? settings toggle? full replacement? Spec recommends **a settings-scalar-based opt-in/opt-out with the new behavior as default** (Option C below). Each candidate is enumerated.

### 4.1 Option A — Feature flag (opt-in, default OFF)

Ship the new behavior behind `claudeteam.runningFocusedDashboard: false` (default). When false, dashboard renders exactly as it does on `main` today. When true, member colors paint + idle is hidden by default + the new chip renders.

**Pros:** Maximum safety. Sponsors don't see any change unless they opt in. Reversibility is one-line.

**Cons:** The reframe never reaches the sponsor population that doesn't go searching in Settings. Feature flags shipped default-OFF are routinely forgotten in dogfood; we'd be paying the impl cost without paying the UX dividend.

### 4.2 Option B — Settings toggle (full replacement, default ON)

Drop the old M2-baseline behavior entirely. The new behavior IS the dashboard; no setting controls "use the old visual thesis or the new one" — only the granular per-feature scalars (`hideIdleAgents`, `hideFinishedAgents`, etc.) exist.

**Pros:** Cleanest mental model. No dead code path. Sponsor sees the new dashboard on next-install.

**Cons:** No safety net if dogfood reveals the running-focused thesis is wrong. The granular scalars (especially `hideIdleAgents=false`) are the only path back to something resembling the old M5-baseline, but they don't compose into the literal M2-baseline (member colors still paint; running pulse is still personalized).

### 4.3 Option C — Per-feature settings scalars, new behavior as default (RECOMMENDED)

Ship the two mechanisms as two independent config scalars:

- `claudeteam.hideIdleAgents: true` (default — §3.2)
- (member-color rendering is unconditional — no setting; the color paints whenever `memberColor` is on the wire; absence falls back to the default semantic color)

There is NO master "use the new dashboard" flag. The two mechanisms compose with the existing M5 / 86c9zmqa8 settings. A sponsor who wants the old M2-baseline flips `hideIdleAgents=false` AND ignores `member.color` in their roster YAML.

**Pros:**
- The reframe ships as the default (matches sponsor's verbatim intent).
- Granular reversibility: any individual feature can be turned off independently.
- No master flag means no dead code path; both branches stay alive in production and tested.
- Member colors and idle-hide are conceptually distinct; their settings staying distinct matches their nature.

**Cons:**
- Sponsor reviewing settings sees two independent scalars and has to assemble the running-focused thesis themselves if they want to articulate it ("hide idle + add colors → running-focused"). Reasonable: the dashboard's purpose statement lives in CLAUDE.md / V1-PLAN.md, not in settings.

### 4.4 Recommendation

**Recommend Option C.** Rationales:

1. **Matches the way M5 and 86c9zmqa8 already shipped.** Both were per-feature scalars; both default to the polished behavior. The team has a working precedent.
2. **Avoids master-flag rot.** A `runningFocusedDashboard` flag would be dead code on either branch of its default; one branch always becomes the orphan to chase down.
3. **Aligns with the "no big-bang change" hard rule** (CLAUDE.md "Defers to user-global Orchestrator autonomy"). Each scalar is independently revertable.
4. **Composability.** Sponsor can pair `hideIdleAgents=true` + `hideFinishedAgents=true` for the maximum-focus mode; or flip just one for a partial reframe. The space of dashboard variants is the product of the scalars, not a binary choice.

§8 Q1 reserves the `default: true` call for sponsor confirmation.

---

## 5. ASCII wireframes

### 5.1 Scenario A — Rostered + running (the foreground)

Sponsor has 4 rostered members; 2 are currently running (Felix on a real task, Maya on a real task), 1 is idle (Nora), 1 has no live dispatch (Iris). Default state: `hideIdleAgents=true`, `hideFinishedAgents=false`.

```
┌── Header ────────────────────────────────────────────────────────┐
│  [Hide finished]  [Show idle — 1 hidden]                         │ ← two chips (M5 + new)
└──────────────────────────────────────────────────────────────────┘

┌── Session #1 (PID 34528, "Drafting M6") ────────────────────────┐
│  ┌── Team: ClaudeTeam Alpha ────────────────────────────────┐    │
│  │  ● (blue)  Felix                                          │    │
│  │            Extension Host Dev                             │    │
│  │            tool:Edit src/extension/state/reducer.ts       │    │
│  │            claude-opus-4-7                                │    │
│  │                                                           │    │
│  │  ● (green) Maya                                           │    │
│  │            Webview UI Dev                                 │    │
│  │            tool:Read src/webview/components/agentTile.ts  │    │
│  │            claude-opus-4-7                                │    │
│  │                                                           │    │
│  │  ─ 1 idle hidden — show ─                                 │ ← per-team row (Option A+B)
│  └───────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

Key visual cues:
- Felix's running dot paints in his member-color (blue hex from his roster YAML); Maya's in green. Both dots pulse (M4-01 §2.4) — animation inherits the new color.
- Idle Nora is NOT rendered as a tile. The "1 idle hidden — show" row is the only signal her tile exists in this team.
- Iris is unmentioned because she has no live dispatch — empty roster row treatment is unchanged.
- Header chip (M5 baseline) + new chip stack at the top.

### 5.2 Scenario B — Rostered + idle expanded (sponsor clicked the chip)

Sponsor clicked the global chip OR the per-team "1 idle hidden — show" row → all idle tiles unfilter:

```
┌── Header ────────────────────────────────────────────────────────┐
│  [Hide finished]  [Hide idle — show all]                         │
└──────────────────────────────────────────────────────────────────┘

┌── Session #1 ────────────────────────────────────────────────────┐
│  ┌── Team: ClaudeTeam Alpha ────────────────────────────────┐    │
│  │  ● (blue)  Felix                          running         │    │
│  │  ● (green) Maya                           running         │    │
│  │  ● (M4-orange idle dot) Nora              idle 47s        │ ← idle tile, M4-orange dot
│  │            Test/QA                                        │
│  │            idle 47s                                       │
│  │            claude-opus-4-7                                │
│  └───────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

Key visual cues:
- Idle Nora's dot is M4-orange (`--ct-color-state-idle`); member-color does NOT apply to idle dots (§1.3). This is intentional — the personalization is for **identification while running**, not always-on branding.
- Idle tile body has rows 2–4 at `opacity: 0.78` per M4-01 §2.2 — unchanged.

### 5.3 Scenario C — Maximum focus + finished visible

`hideIdleAgents=true`, `hideFinishedAgents=true` (sponsor toggled both), one Maya-task just finished:

```
┌── Header ────────────────────────────────────────────────────────┐
│  [Show finished — 1 hidden]  [Show idle — 2 hidden]              │
└──────────────────────────────────────────────────────────────────┘

┌── Session #1 ────────────────────────────────────────────────────┐
│  ┌── Team: ClaudeTeam Alpha ────────────────────────────────┐    │
│  │  ● (blue)  Felix                          running         │    │
│  │  ─ 2 idle hidden — show ─                                 │    │
│  └───────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

Key visual cues:
- Only running members render. Both filter chips show counts.
- The per-team row only shows the "idle" count; if BOTH filters are on and a team has BOTH hidden, a future polish could show "2 idle, 1 finished hidden — show all" but V1 ships per-state rows separately (the global chips already enumerate per-state counts). Flagged as post-V1 polish.

### 5.4 Scenario D — Color-blind / theme contrast edge case

Sponsor sets Felix's color to `"#5d8aa8"` (slate blue). Theme switches from dark to light:

```
Dark theme:           Light theme:
● (slate blue)        ● (slate blue — slightly washed against white)
   Felix                 Felix
```

The dot remains slate-blue. The halo (pulse animation) inherits `--ct-color-state-running` (Material Green) per §2.5 guardrail — the halo is visible in both themes (green-on-dark + green-on-light both pass contrast). The dot's contrast against the theme background is the sponsor's responsibility (per §2.5 doc note).

---

## 6. Out of scope for V1 of this reframe

- **Multi-color per member.** Each member has at-most one color. Multi-color (e.g. one for state A, another for state B) is out.
- **Per-state color.** Idle / finished / error dots do NOT carry the member color. The personalization is running-only.
- **Animation tied to color.** Pulse keeps the M4-01 §2.4 animation parameters; no per-color animation timing.
- **Color presets / picker UI.** Sponsor edits YAML directly per `roster-matching.md` config-locations rule. No in-dashboard color picker.
- **Color contrast auto-correction.** Spec does NOT auto-darken/lighten sponsor's chosen color for contrast — see §2.5 (sponsor authority).
- **Per-team idle filter scope.** Toggle is global; per-team idle-filter scopes are post-V1.
- **Combined "N idle, M finished hidden" row.** Per-team rows show only the idle count in V1; per-team finished counts continue to surface only via the global M5 chip.
- **A master `runningFocusedDashboard` boolean.** Per §4.4 — granular scalars only.
- **Member-color on the CLI / non-dashboard surfaces.** This spec is dashboard-only. The CLI presenter (`team/iris-ux/m1-cli-output-spec.md`) ignores `memberColor`; no terminal-color emit.
- **Hot-reload of `member.color` changes mid-session.** The roster file-watcher (`roster-matching.md`) reloads on YAML edit; the new color flows through on the next `state:full` tick. Acceptable. No special hot-reload code path beyond what the loader already does.

---

## 7. Vocabulary contract

Per `~/.claude/CLAUDE.md` "Parallel-agent shared-concept vocabulary discipline" — every identifier the parallel-dispatched impl PRs will reference is fixed here.

### 7.1 Host + shared identifiers (Felix declares)

| Identifier | Kind | Declared by | Consumed by | Notes |
|---|---|---|---|---|
| `claudeteam.hideIdleAgents` | `package.json` config key | Felix | Felix (host read) + Maya (chip writes via `ui:set-config`) | Default `true` per §3.2 (pending §8 Q1). |
| `claudeteam.toggleHideIdle` | `package.json` command id | Felix | Both | Optional but recommended; parallels `claudeteam.toggleHideFinished` (M5). |
| `applyHideIdleFilter` | exported function | Felix | Felix internal | In `src/extension/state/hideIdleFilter.ts` (NEW; per §3.6 Split A). |
| `HideIdleResult` | TS interface | Felix | Felix internal | Shape: `{ tree: AgentTree; hiddenIdleCount: number }`. |
| `hiddenIdleCount` | optional field on `AgentTree` + `SerializedDashboardState` | Felix | Maya reads | Wire shape: `number \| undefined`. Webview MUST treat `undefined` as `0`. |
| `config.hideIdleAgents` | new entry under existing `AgentTree.config` block | Felix | Maya reads | Boolean. Webview reads `state.config?.hideIdleAgents ?? false` for chip's initial state (matches M5 §3.5 Field B pattern). |
| `memberColor` | optional field on `AgentTile` | Felix | Maya reads | Wire shape: `string \| undefined` (6-digit hex with `#`). Webview applies as inline `--ct-color-running-dot` CSS custom property. |
| `SetConfigMessage.payload.key` literal extension | TS union extension | Felix declares in `src/shared/messages.ts` | Maya imports | New union member: `"hideIdleAgents"` joins the existing `"hideFinishedAgents"`. |

### 7.2 Webview-only identifiers (Maya declares)

| Identifier | Kind | Notes |
|---|---|---|
| `--ct-color-running-dot` | CSS custom property | Per-tile inline override on `<article class="agent-tile">` when `tile.memberColor` is set. Read by `.state-dot[data-state="running"]` with semantic-token fallback. |
| `ct-team-idle-row` | CSS class on per-team `<div>` row | Per-team "N idle hidden — show" row affordance (§3.4 Option A). |
| `data-hide-idle` | HTML data attribute on the new chip `<aside>` | Values: `"true"` / `"false"`. Parallels M5's `data-hide-finished`. |
| `data-hidden-idle-count` | HTML data attribute on the new chip `<aside>` | String form of `hiddenIdleCount`. |
| `renderIdleChip` | TS export in `src/webview/components/headerChip.ts` OR a new sibling file | If headerChip.ts is generalized to render both M5's + this spec's chip, prefer one component with two prop sets; alternatively a new `idleChip.ts` file. Maya's call. |

### 7.3 Discriminator + literal values (exact strings)

| Surface | Exact value | Where used |
|---|---|---|
| Chip label — filter off | `"Hide idle"` | Click WILL hide. |
| Chip label — filter on + 0 hidden | `"Show idle — none yet"` | Em-dash `—` (U+2014). Click WILL show. |
| Chip label — filter on + N=1 | `"Show idle — 1 hidden"` | Em-dash. Click WILL show. |
| Chip label — filter on + N>1 | `"Show idle — N hidden"` (N substituted) | Em-dash. Click WILL show. |
| Per-team row label — N=1 | `"1 idle hidden — show"` | Em-dash. Click toggles the global filter (same as the chip). |
| Per-team row label — N>1 | `"N idle hidden — show"` (N substituted) | Em-dash. |
| `SetConfigMessage.payload.key` new literal | `"hideIdleAgents"` | Webview chip + per-team row both post this. |
| Config description (package.json) | `"Hide rostered agent tiles whose state is 'idle'. When true (default), the dashboard suppresses idle tiles by default — running members are the foreground. An 'N idle hidden — show' chip in the header reveals the hidden tiles on click. Default true; turn off to restore the show-everything M5-baseline behavior."` | §3.2. Final wording reserved for sponsor (§8 Q1). |

### 7.4 Ownership boundary

Same pattern as M5 §7.4 — no identifier owned by both sides. The only file touched by both Felix and Maya is `src/shared/messages.ts` (Felix extends the `SetConfigMessage` key union; Maya imports). Sequence-of-merge irrelevant — additions are append-only.

---

## 8. Sponsor questions — reserved for confirmation

Four small calls remain open. Each carries Iris's recommendation; sponsor's confirmation unlocks impl dispatch.

### Q1 — Defaults for the two new behaviors

**Recommendations:**
- `claudeteam.hideIdleAgents: true` (per §3.2 / §4.4 — matches sponsor's "hide-idle-by-default" verbatim).
- `claudeteam.hideFinishedAgents` STAYS at its M5 default of `false` (per §3.5 — M5's Q2 rationale unchanged).
- Member color default: Option A (omitted ⇒ semantic color; no auto-generation per §2.3).

### Q2 — Per-team "N idle" hint surface (A / B / A+B)

**Recommendation: Option A+B** (global chip is canonical; per-team rows are passive informational hints firing the same `ui:set-config` message). Highest per-team awareness; minimum new state.

**Alternative considered:** Option B-only (global chip, no per-team row). Lower impl cost; sponsor loses per-team awareness when filter is on. Trade-off depends on whether the sponsor frequently runs multi-team rosters; V1 dogfood roster has one team, so the awareness loss is small for V1 specifically, but the pattern should scale.

### Q3 — Color-default behavior (Option A vs Option B)

**Recommendation: Option A** (omitted `member.color` ⇒ webview default; no auto-generation). Personalization is curatorial; auto-generation introduces hidden contrast bugs. See §2.3 for the full rationale.

**Alternative:** Option B (auto-generate from `member.id` hash). Acceptable if sponsor strongly prefers "every member is distinct by default" — but recommend revisiting post-V1 if dogfood shows sponsors not bothering to set colors.

### Q4 — 3-digit hex color shorthand acceptance

**Recommendation: Accept and normalize.** `#5da` expands to `#55ddaa`. Sponsors who copy values from quick mood-board tools often get 3-digit shorthand; rejecting it is friction.

**Alternative:** Strict 6-digit only — simpler validator, no expansion logic. Marginally less convenient. Either is reasonable. Defaulting to "accept" is sponsor-friendly with negligible impl cost (one regex branch).

---

## 9. Composition with prior specs

### 9.1 With M5 (`m5-hide-finished-spec.md`)

This spec **clones M5's pattern**. The two filters are independent (`hideFinishedAgents` ⊥ `hideIdleAgents`), apply in sequence (finished first, then idle), and emit separate counts. Both chips render side-by-side in the header. The wire-shape extension matches M5's: one new optional count + one new entry under `AgentTree.config`. Per §3.6 Split A, the host-side files stay separate (`hideFinishedFilter.ts` + `hideIdleFilter.ts`).

### 9.2 With M3-10 wrapper (`CollapsedPersonaGroup`)

Both filters walk the wrapper's `instances` and rebuild on partial-drop, matching M5 §3.2's contract. Adding `idle` to that walk is one new `state === "idle"` check. Wrapper invariants (no empty `instances`, N=1 unwraps) are preserved.

### 9.3 With 86c9zmqa8 uniform-cluster polish

The `computeIsUniform` gate operates webview-side after filters (host-side projection) and the M3-10 wrapper-rebuild have run. An `idle`-uniform cluster either disappears entirely (all instances filtered) or becomes a non-uniform-by-state cluster (if mixed) — both reduce to the existing 86c9zmqa8 logic. No interaction.

### 9.4 With M4-01 polish (`m4-polish-spec.md`)

State-dot semantic colors (§1.2.3) are unchanged for `idle` / `finished` / `error`. The running-color token (`--ct-color-state-running`) remains the **fallback** when `tile.memberColor` is absent — the new per-tile inline custom property (`--ct-color-running-dot`) is a thin override layer. The pulse animation (M4-01 §2.4) inherits whatever `background-color` resolves to; no animation code knows about `memberColor`. Reduced-motion (`@media (prefers-reduced-motion: reduce)`) is unaffected.

### 9.5 With roster-matching docs (`.claude/docs/roster-matching.md`)

The `color` field is already documented as optional. The impl docs PR (downstream of this spec) extends the documentation with the theme-contrast suggestion (§2.5 #1) and the validation table (§2.6).

---

## 10. Audit trail

- **ClickUp ticket `86c9zmyef`** — feature ask (running-focused dashboard reframe).
- **Sponsor's verbatim intent** — paraphrased above (no quoted-verbatim file artifact yet; sponsor's dispatch brief is the source).
- **`src/shared/types.ts:105-133`** — `Member` interface (carries `Member.color?: string` at line 130) already on schema (live `main` read).
- **`src/shared/types.ts:259`** — `AgentState` enum (live `main` read).
- **`src/shared/types.ts:265-321`** — `AgentTile` shape (informs §2.2 `memberColor` placement).
- **`src/shared/types.ts:495-547`** — `AgentTree.config` block (informs §3 mirror pattern).
- **`src/webview/components/agentTile.ts:208-215`** — current state-dot DOM (informs §2.4 paint location).
- **`src/webview/styles/dashboard.css:247-274`** — current `.state-dot` CSS (informs §2.4 fallback rule).
- **`src/webview/styles/dashboard.css:58-61`** — semantic state-color tokens (informs §1.3 / §2.5).
- **`package.json:96-115`** — existing dashboard config scalars (informs §3.2 + §4.3 naming + structure).
- **`.claude/docs/roster-matching.md:13-28, 56-73`** — roster YAML schema + config locations.
- **`team/iris-ux/m4-polish-spec.md` §1.2.3 + §2.2 + §2.4** — token system + state visuals + pulse animation.
- **`team/iris-ux/m5-hide-finished-spec.md` §3 / §4 / §6** — host-side filter + chip + wire-shape pattern (cloned here).
- **`team/iris-ux/86c9zmqa8-uniform-cluster-spec.md`** — option-shape spec format precedent.
- **`team/iris-ux/m2-dashboard-tile-spec.md` §5 / §6** — tile baseline + empty-team suppression (informs §3.3 invariants).
- **Parallel-agent vocabulary discipline** — user-global CLAUDE.md (informs §7).
- **CLAUDE.md hard rule** — no orchestrator-side coding; spec proposes, Felix + Maya implement.

---

*Spec authored against M4-01 + M5 + 86c9zmqa8 baselines. Recommended path: Option C transition strategy (per-feature scalars), `hideIdleAgents` default `true`, member-color Option A (no auto-generate), per-team row + global chip both rendering (Option A+B). Sponsor confirms §8 Q1 / Q2 / Q3 / Q4 before downstream impl tickets are filed. Estimated impl size: 1 ticket for the host-side wiring (memberColor projection + applyHideIdleFilter + wire-shape additions + manifest scalar) ≈ S; 1 ticket for the webview-side (state-dot color paint + new chip + per-team row + tests) ≈ S. Lands as two parallel-safe dispatches with the vocabulary contract in §7 satisfying the global rule.*
