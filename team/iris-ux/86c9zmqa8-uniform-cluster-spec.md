# Uniform-cluster expansion spec — collapsed-persona group polish

Design spec for the post-V1 polish pass on the collapsed-persona wrapper (M3-10). Targets the case the sponsor flagged 2026-05-27: a wrapper of N identical-looking instances (all `idle`, all same role, all same model) where the expand-into-N-rows interaction surfaces no marginal information. Proposes four candidate shapes (a / b / c / d) for the ticket body's enumerated options, recommends a default, and reserves final wording for sponsor confirmation.

- **Ticket:** [ClickUp 86c9zmqa8](https://app.clickup.com/t/86c9zmqa8) — `polish(webview): collapsed-group expansion adds little value for uniform clusters — auto-collapse or compact-row treatment`
- **Owner:** Iris
- **Peer reviewer (this spec PR):** orch-direct per Iris-design-only convention.
- **Downstream impl ticket:** TBD — filed after sponsor picks a shape.
- **Source quote (verbatim, 2026-05-27):** *"why do i need to see al these repeadet names under each name? what is the value?"*
- **Source artifacts:**
  - `src/webview/components/collapsedPersonaTile.ts` — current implementation (M3-10, M4-05, Obs 10, Defect 6b).
  - `src/shared/types.ts:323-355` — `CollapsedPersonaGroup` wire shape.
  - `team/iris-ux/m2-dashboard-tile-spec.md` §5 — bare `AgentTile` layout.
  - `team/iris-ux/m4-polish-spec.md` §2.2 — state visuals (idle = full-opacity dot + 0.78 opacity rows 2–4).
  - `team/iris-ux/m5-hide-finished-spec.md` §3.2 — wrapper-aware filter precedent (sibling polish pass on the same surface).
- **Authoring discipline:** Theme-aware first (CLAUDE.md). No new tokens — consumes M4-01 §1's `--ct-*` set. No new icon set. No animation framework.

---

## 0. Scope summary

| Section | Surface | Notes |
|---|---|---|
| §1 Problem statement | (design — no code) | Re-frames sponsor's verbatim; defines "uniform cluster." |
| §2 Option A — auto-collapse uniform clusters | `collapsedPersonaTile.ts` initial-render gate | Lowest-risk option; default-recommend. |
| §3 Option B — compact-row treatment when expanded | `collapsedPersonaTile.ts` populate-instances path + new CSS rule | Highest information-preservation; medium impl cost. |
| §4 Option C — header-only (no expand affordance) for uniform clusters | `collapsedPersonaTile.ts` chevron + click suppression | Most aggressive; risks defensive surprise. |
| §5 Option D — "Show instances" link instead of chevron | `collapsedPersonaTile.ts` header treatment | Affordance-level change; preserves drill-in but hides default-state chevron. |
| §6 Comparison matrix | (design — cross-section) | Side-by-side. |
| §7 Recommendation | (design — picks default) | Pattern A + compact-row fallback when expanded; sponsor confirms. |
| §8 Vocabulary contract | (downstream Maya impl) | Config flag, CSS class, label wording all pre-named. |
| §9 Sponsor questions | (away-queue feed) | One open question on the threshold; recommendation provided. |
| §10 Out-of-scope / non-goals | (design — guardrails) | What this spec does NOT change. |

---

## 1. Problem statement

### 1.1 Sponsor verbatim and observed symptom

Sponsor 2026-05-27: *"why do i need to see al these repeadet names under each name? what is the value?"*

Translation against the current implementation:

- The webview currently renders any `CollapsedPersonaGroup` (N>1 instances of one persona) as a header tile with an `aria-expanded` chevron. Click expands; instances render as full `<article class="agent-tile">` rows (4 rows each — name, role, activity, model).
- When all instances are in the same "boring" state — e.g. four `Felix` instances all `idle 14s`, same role, same model — expanding yields four near-identical 4-row tiles stacked vertically. The visual cost is high (16 rows of repeated text); the marginal information is near-zero (the activity-line elapsed-time is the only field that varies, by a few seconds).

### 1.2 What "uniform cluster" means in this spec

A `CollapsedPersonaGroup` qualifies as a **uniform cluster** when ALL of:

1. `group.instances.length >= 2` (it's already a group — bare tiles unaffected).
2. **All instances share the same `state`** — every `tile.state` is the same value.
3. The shared state is **not `running` and not `error`** — i.e. it's `idle` OR `finished`.
4. **All instances share the same `role`** — `tile.role` matches across all instances. (Roster guarantees this trivially in V1 since `role` is roster-derived per `member.role`; documented for forward-compat.)

A cluster that fails any of these is **mixed** (the existing M3-10 expand behavior is correct for it — the per-instance rows DO carry differentiating information).

**Why exclude `running`:** an actively-running instance's activity field updates per poll (`tool:Edit src/...`) — the rows are NOT repeated even if everything else looks identical. Sponsor likely DOES want to drill in on a running cluster to see what each instance is doing.

**Why exclude `error`:** errors are load-bearing alerts. Even if all instances share the same error reason, each instance is potentially a separate failure to investigate. Auto-collapsing visibility on an error cluster is the wrong call.

**Why ignore `activity` and `model` in the uniformity test:** activity wobbles per poll (`idle 14s` → `idle 16s`); model is roster-stable. Testing on those would either thrash the auto-collapse logic (activity) or be redundant (model). State + role is the stable signal.

### 1.3 What's NOT the problem

- **The wrapper itself.** M3-10's wrapping decision is correct — without it, four Felix tiles take 16 rows by default. The wrapper already saves 12 of those rows in the collapsed state.
- **The chevron / click affordance in general.** When a cluster is mixed (one `running` + three `idle`), drill-in IS valuable. The polish target is specifically the uniform case.
- **The persona name / count in the header.** "Felix ×4" is exactly the right header label — sponsor knows what's there.

The polish problem is purely: *what happens when the sponsor clicks the chevron on a uniform cluster, and is that click even an inviting affordance?*

---

## 2. Option A — auto-collapse uniform clusters (suppress initial expand-restore)

### 2.1 What this option does

Uniform clusters always render **collapsed by default**, even if the `expandedGroupsTracker` (Obs 10, `86c9zfmh1`) recorded a previous expansion in this session. The chevron remains visible; click still works; sponsor can manually expand if they want to see the rows. The change is purely about the INITIAL state on each render.

Concretely: in `renderCollapsedPersonaTile()`, the `initiallyExpanded` computation changes from:

```ts
const initiallyExpanded =
  trackerKey !== undefined && expandedGroupsTracker !== undefined
    ? expandedGroupsTracker.isExpanded(trackerKey)
    : false;
```

to (proposed):

```ts
const isUniform = computeIsUniform(group.instances);
const initiallyExpanded =
  isUniform
    ? false   // auto-collapse uniform clusters regardless of tracker
    : trackerKey !== undefined && expandedGroupsTracker !== undefined
      ? expandedGroupsTracker.isExpanded(trackerKey)
      : false;
```

Where `computeIsUniform` is a new pure function next to `computeGroupState`:

```ts
export function computeIsUniform(instances: AgentTile[]): boolean {
  if (instances.length < 2) return false;
  const first = instances[0];
  if (first.state === "running" || first.state === "error") return false;
  for (const t of instances) {
    if (t.state !== first.state) return false;
    if (t.role !== first.role) return false;
  }
  return true;
}
```

### 2.2 Wireframe — auto-collapsed uniform cluster

```
┌──────────────────────────────────────────────┐
│  ●  ▶  Felix ×4                              │  ← collapsed header (always)
│        idle                                  │  ← (optional) status hint row
└──────────────────────────────────────────────┘

Click chevron → manually expands (unchanged from M3-10)
```

The "status hint row" is an optional addition (§2.4) — the header could carry a one-line summary of the shared state instead of forcing the sponsor to read it from the state-dot color alone.

### 2.3 Behavior on click

- First click → expands. Per-instance tiles render exactly as today (M3-10 + M4-05 transitions + Defect 6b state).
- The `expandedGroupsTracker` STILL records the click (so the click is persistent within the session for THIS tracker key).
- But the next render auto-collapses again because Option A's gate fires BEFORE the tracker read.

**Trade-off:** the tracker becomes write-only for uniform clusters. Sponsor's click "doesn't stick" across the next re-render. This is the central UX tension of Option A.

### 2.4 Optional sub-variant: status-hint row in the header

When auto-collapsed, append a tiny secondary line to the header:

```
●  ▶  Felix ×4
       all idle
```

Rationale: in the auto-collapsed state, the sponsor's question shifts from "what are these doing?" to "is this state stable?" One word of secondary text (`all idle` / `all finished`) answers it without expanding.

Spec mark this as Option A.1 (sub-variant) — pure additive, can ship with or without §2.3's auto-collapse gate.

### 2.5 Pros / Cons

**Pros:**
- Lowest-risk option. Existing M3-10 click behavior unchanged; only the initial state is overridden.
- Sponsor's question ("why do I need to see these?") is answered: by default, you don't see them. Click to opt in.
- Implementation is a pure-function gate + one branch in `renderCollapsedPersonaTile`. Tests are pure.

**Cons:**
- Click doesn't stick. Sponsor who DOES want to look at uniform-cluster instances repeatedly within a session has to re-click on every poll tick (~2s). May be frustrating in dogfood.
- The "click cost" of getting at the data is now paid every time — not just once per session. For active investigation, this regresses.

### 2.6 Mitigation for the "click doesn't stick" cost

If §2.5's "Cons" bullet proves to be a real annoyance in dogfood, the natural follow-up is to add an "Expand all uniform clusters" sponsor preference scalar (e.g. `claudeteam.alwaysExpandUniformClusters`). M5 already established the precedent of a chip-or-setting pair for filter-class preferences. NOT in scope for THIS spec — flag as post-V1 follow-up.

---

## 3. Option B — compact-row treatment when expanded (rows collapse to one line)

### 3.1 What this option does

Uniform clusters expand to a **single compact row per instance** instead of the standard 4-row tile. The chevron + click affordance are unchanged from M3-10. The change is in the populate-instances render path.

A compact row carries: agent display (e.g. `Felix [a]`, `Felix [b]` — short disambiguator) + state-dot + one-line activity. No role row (uniform), no model row (uniform), no separate name row stacked vertically.

### 3.2 Wireframe — expanded uniform cluster, compact rows

```
┌──────────────────────────────────────────────┐
│  ●  ▼  Felix ×4                              │  ← expanded header
│       ├ ●  Felix [a]   idle 14s              │  ← compact row 1
│       ├ ●  Felix [b]   idle 16s              │  ← compact row 2
│       ├ ●  Felix [c]   idle 15s              │  ← compact row 3
│       └ ●  Felix [d]   idle 14s              │  ← compact row 4
└──────────────────────────────────────────────┘
```

DOM shape (sketched):

```html
<div class="collapsed-persona-instances" data-compact="true">
  <article class="agent-tile agent-tile--compact" data-agent-id data-state>
    <span class="state-dot" data-state></span>
    <span class="agent-display">Felix [a]</span>
    <span class="agent-activity-compact">idle 14s</span>
  </article>
  ...
</div>
```

The `agent-tile--compact` modifier shares all event listeners with the standard tile (drill-in click still fires `ui:open-transcript`); only the visual layout differs.

### 3.3 Disambiguator strategy

The `[a]` / `[b]` / `[c]` / `[d]` labels are NOT in the wire shape. They're rendered at the webview from the agent's index within `group.instances`. The actual `agentId` is still on `data-agent-id` for drill-in resolution.

**Why bracketed letters and not numbers:** "Felix 1 / Felix 2" reads like priority ordering ("Felix is the first one"); bracketed letters read like sibling labels ("the a-instance, the b-instance"). Sponsor can drill in to find the actual agent ID.

**Letters beyond 4:** roll over `[e]`, `[f]`, etc. up to `[z]`. Beyond 26 instances (a count we have never observed in practice), continue with `[aa]`, `[ab]`. The labels are display-only; collision impossible because the `agentId` is the real key.

### 3.4 Falls back to standard rows for mixed clusters

A mixed cluster (e.g. one `running` + three `idle`) still expands to standard 4-row tiles. The compact treatment is gated on `computeIsUniform(group.instances)` per §2.1, evaluated at expand-time.

### 3.5 Pros / Cons

**Pros:**
- Preserves drill-in: sponsor who clicks to look at the cluster still gets per-instance access. The "click sticks" naturally because the tracker behavior is unchanged.
- Highest information density when expanded — 4 instances now fit in 5 rows total (header + 4 compact rows) instead of 17 rows (header + 4 × 4-row tiles).
- Activity-line elapsed-time still visible per instance, which is the one varying field even in a "uniform" cluster.

**Cons:**
- More implementation cost. Requires a new tile variant (`agent-tile--compact`) with shared event wiring + a new CSS rule block + a new component test path.
- The `[a]` / `[b]` disambiguator is a new vocabulary the sponsor has to learn. May feel artificial.
- A uniform cluster the sponsor never wants to expand still costs a chevron click to discover whether anything has changed — Option B does NOT address the sponsor's question "why do I need to see these"; it just makes the seeing cheaper if they do click.

### 3.6 Composes with Option A

Option B and Option A are NOT mutually exclusive. Both can ship: A controls the INITIAL state (auto-collapsed); B controls the EXPANDED render (compact rows). If both ship, a uniform cluster auto-collapses by default; clicking to expand yields compact rows instead of full tiles.

§6 comparison matrix lists this as Option A+B (recommendation: A+B in §7).

---

## 4. Option C — header-only treatment (no expand affordance for uniform clusters)

### 4.1 What this option does

Uniform clusters render with **NO chevron**. The header is the only surface — no expand, no click-to-drill into per-instance. The cluster reads as a single visual unit.

Sponsor wanting per-instance drill-in for a uniform cluster has to go elsewhere (e.g. terminal `claudeteam ls --agents` CLI, or a future right-click menu). The dashboard surface intentionally hides the affordance.

### 4.2 Wireframe — header-only uniform cluster

```
┌──────────────────────────────────────────────┐
│  ●     Felix ×4   idle                       │  ← no chevron, no click affordance
└──────────────────────────────────────────────┘
```

### 4.3 Pros / Cons

**Pros:**
- Most direct answer to sponsor's verbatim. "Why do I need to see these?" → "You don't, and we don't even offer it."
- Lowest visual surface area: the header IS the whole cluster.
- Forces a clear-eyed answer to a UX question: does the dashboard need per-instance drill for ANY cluster, or is the cluster the unit?

**Cons:**
- **Affordance regression.** M3-10 already shipped expand-for-drill-in as a documented capability. Removing it for a sub-class of cluster is a defensive surprise — sponsor who learns "click the chevron to drill in" now sees clusters where the affordance silently doesn't exist.
- **Hides debugging access.** Even on a uniform `idle` cluster, the per-instance JSONL drill-in (M4-03) might be the easiest way to see what each instance LAST did. Removing the affordance forecloses this without a replacement.
- **The mixed/uniform classification could change between polls.** Cluster of `[idle, idle, idle, idle]` → 2s later `[running, idle, idle, idle]` → chevron suddenly appears. The shape of the affordance shifts beneath the sponsor's hand. Defensive UX failure.

### 4.4 Verdict

Not recommended. The cons (especially §4.3 bullet 3 — affordance flicker on cluster-state change) outweigh the pros. Documented here for completeness of the option enumeration.

---

## 5. Option D — "Show instances" link instead of chevron

### 5.1 What this option does

For uniform clusters, the chevron icon is replaced with a small **text link** at the end of the header: `Show instances` (or `Show 4 instances`). Click expands; once expanded, the link reads `Hide instances`. Mixed clusters keep the chevron.

Rationale: a chevron in the header is a strong "this is a container, expand me" signal. A text link is a softer "if you want, click to drill" signal. For a uniform cluster, the softer signal matches the lower expected value of expanding.

### 5.2 Wireframe — uniform cluster with text link

```
Collapsed:
┌──────────────────────────────────────────────┐
│  ●  Felix ×4   idle             Show instances│
└──────────────────────────────────────────────┘

Expanded:
┌──────────────────────────────────────────────┐
│  ●  Felix ×4   idle             Hide instances│
│     [4 standard or compact tiles below]      │
└──────────────────────────────────────────────┘
```

### 5.3 Pros / Cons

**Pros:**
- Softer affordance matches the lower expected value of expanding a uniform cluster.
- Reads like an opt-in invitation rather than a default-discoverable expandable.
- Preserves drill-in and chevron-tracker behavior — sponsor who wants the data can still get it.

**Cons:**
- Two affordance shapes (chevron + text link) on the same component is a small but real inconsistency. Maya implements two click targets across the wrapper.
- Text link is wider than a chevron; on narrow VS Code sidebars (≤200px) it may wrap or get clipped.
- Doesn't reduce the visual cost when EXPANDED — only changes the affordance discovery surface. The 16-rows problem reappears on click unless paired with Option B.

### 5.4 Verdict

Reasonable, but doesn't compose as cleanly with the other options as Option A+B does. If the sponsor explicitly wants the affordance-soften flavor without the auto-collapse-resets-the-tracker tension, Option D + Option B is a viable alternative. Documented for completeness; not the default recommendation.

---

## 6. Comparison matrix

| Dimension | A (auto-collapse) | B (compact rows) | C (header-only) | D (text link) | **A+B (combined)** |
|---|---|---|---|---|---|
| **Answers sponsor verbatim?** | Yes — by default you don't see them. | Partial — still visible if expanded; just shorter. | Yes — never see them, no opt-in. | Partial — opt-in framing. | Yes — auto-collapsed AND, if opted in, compact. |
| **Drill-in preserved?** | Yes (chevron still works). | Yes (rows are clickable). | NO — affordance removed. | Yes (link still works). | Yes. |
| **Click sticks across polls?** | NO — auto-collapse overrides tracker. | Yes — tracker unchanged. | n/a — no click. | Yes — tracker unchanged. | NO on default, but mitigation via expand-all setting. |
| **Visual cost when expanded** | 17 rows (4 × 4-row tiles + header). | 5 rows (4 compact + header). | n/a — header only. | 17 rows (unchanged from M3-10) | 5 rows. |
| **New CSS** | 0 rules. | 1 new modifier (`agent-tile--compact`). | 0 (just suppression). | 1 new (`.collapsed-persona-show-link`). | 1 (compact). |
| **New TS** | 1 pure fn (`computeIsUniform`) + 1 gate. | 1 pure fn + new tile variant + render branch. | 1 pure fn + chevron/click suppression. | 1 pure fn + link variant + tracker gate. | All of A + all of B. |
| **Affordance-flicker risk on cluster-state change** | Low (chevron remains; only the initial-expand state changes). | None. | **HIGH** (chevron appears/disappears as cluster changes uniformity). | Medium (chevron↔link swap). | Low. |
| **Implementation size (T-shirt)** | XS | S | XS | S | S |
| **Reversibility (single revert)?** | Yes. | Yes. | Yes. | Yes. | Yes — A and B are independent commits. |
| **Composability** | Composes with B (recommended) and D. | Composes with A, C, D. | Does not compose with A (C overrides A — pick one). | Composes with B. | — |
| **Sponsor question answered?** | Direct. | Indirect (cost mitigation). | Direct but defensive. | Indirect (opt-in framing). | **Direct + cost mitigation.** |

---

## 7. Recommendation

**Recommend: Option A + Option B combined.**

Rationale:

- **A directly answers the sponsor's verbatim question.** By default, you don't see the repeated names. The default-state matches the sponsor's complaint exactly.
- **B mitigates the regression that A's click-doesn't-stick introduces.** When the sponsor DOES click to expand a uniform cluster, the expanded result is 5 rows (compact) instead of 17 rows (full tiles) — the second-tier UX cost of "I clicked to look, and there's still too much" disappears.
- **Together they cost roughly one S-sized impl ticket.** Option A is XS on its own; B is S on its own; combined still S because both touch the same component.
- **Reversibility is per-option.** If A turns out too aggressive (sponsor wants the click to stick after all), revert only A's gate — B's compact rows continue to be the win. If B turns out unhelpful (compact rows are too terse for sponsor's drill-in use), revert only B — A's auto-collapse continues to be the win.
- **The Option A.1 status-hint row (`all idle`) is recommended as a sub-add** because it answers the "what state is the cluster in" question without expanding. Tiny visual surface (one line, fg-muted), big information density.
- **Composes cleanly with the existing wrapper / Obs 10 tracker / M5 hide-finished surface.** No vocabulary collision, no protocol change required. The `expandedGroupsTracker` continues to record the click for non-uniform clusters; the new `computeIsUniform` gate is the only branch added.

**Default labels chosen (reserve final wording for sponsor confirmation in §9):**

- Status hint (Option A.1): one of `"all idle"` / `"all finished"` (matches `computeIsUniform`-eligible states; matches existing CLI vocabulary `m1-cli-output-spec.md` §2).
- Compact tile activity (Option B): the existing `activity` field verbatim (e.g. `"idle 14s"`, `"finished 12m"`) — no new vocabulary.
- Disambiguator (Option B): `[a]` / `[b]` / `[c]` / `[d]` per §3.3.

### 7.1 Alternatives flagged but not recommended

- **Option C (header-only)** — defensive surprise; affordance flicker on uniformity transitions is the dealbreaker. Documented for completeness.
- **Option D (text link)** — affordance-shape inconsistency without sufficient payoff. Documented for completeness.
- **"Do nothing" — keep M3-10 baseline.** Sponsor's verbatim quote is direct feedback that the current shape is wrong; status-quo isn't a viable answer here.

---

## 8. Vocabulary contract (for downstream Maya impl)

Per `~/.claude/CLAUDE.md` "Parallel-agent shared-concept vocabulary discipline" — every identifier the downstream Maya impl PR will reference is named here. Maya MUST use these names verbatim to avoid the M3-10-class vocabulary divergence.

### 8.1 Host + shared identifiers

| Identifier | Kind | Owner | Notes |
|---|---|---|---|
| `claudeteam.autoCollapseUniformClusters` | `package.json` config scalar (boolean) | Maya declares in webview-impl PR; Felix consulted for the manifest add | Default `true` per §7 recommendation. Sponsor can opt out via VS Code Settings. Disabling restores M3-10 baseline behavior. |
| `computeIsUniform` | exported pure function | Maya declares in `src/webview/components/collapsedPersonaTile.ts` (NEW export) | Signature: `(instances: AgentTile[]) => boolean`. Per §2.1. |

No new wire fields. The uniformity computation lives entirely webview-side (`AgentTile.state` + `AgentTile.role` are already on the wire). Felix's host code is **untouched** by this spec.

### 8.2 Webview-only identifiers (Maya declares)

| Identifier | Kind | Notes |
|---|---|---|
| `agent-tile--compact` | CSS class modifier on `<article class="agent-tile">` | Option B compact variant. Per §3.2. |
| `collapsed-persona-status-hint` | CSS class on a `<span>` inside the header | Option A.1 status-hint row. Per §2.4. |
| `data-uniform` | HTML data attribute on `<section class="collapsed-persona">` | Values: `"true"` / `"false"`. Used by CSS to gate compact-row styling and (when off) to elide the auto-collapse override. |
| `agent-activity-compact` | CSS class on `<span>` inside compact tile | The one-line activity span (per §3.2). |
| `STATUS_HINT_LABEL` | const map in `collapsedPersonaTile.ts` | `{ idle: "all idle", finished: "all finished" }`. Per §7 recommendation. |
| `DISAMBIGUATOR_LETTERS` | const string in `collapsedPersonaTile.ts` | `"abcdefghijklmnopqrstuvwxyz"`. Used by the disambiguator strategy in §3.3. |

### 8.3 Discriminator + literal values (exact strings)

| Surface | Exact value | Where used |
|---|---|---|
| Status-hint label — `idle` cluster | `"all idle"` | §2.4 wireframe; §7 default. |
| Status-hint label — `finished` cluster | `"all finished"` | §2.4 wireframe; §7 default. |
| Disambiguator format | `"[a]"` / `"[b]"` / `"[c]"` … | §3.3. Bracketed lowercase letter. |
| Config description (package.json) | `"Auto-collapse uniform clusters (same persona, same state, all idle or finished). When true, the dashboard hides per-instance rows for clusters that carry no varying information; the chevron still allows manual expand. Default true; turn off to restore the M3-10 always-respect-expand-tracker behavior."` | §8.1 manifest entry. Final wording reserved for sponsor (§9 Q1). |

### 8.4 Test-name conventions

Maya's impl PR should include tests under `tests/unit/webview/collapsedPersonaTile.test.ts` with descriptions matching these phrases (for grep-discoverability post-merge):

- `"computeIsUniform — true for all-idle same-role"`
- `"computeIsUniform — false on size <2"`
- `"computeIsUniform — false on running state"`
- `"computeIsUniform — false on error state"`
- `"computeIsUniform — false on mixed states"`
- `"computeIsUniform — false on mixed roles"`
- `"uniform cluster — auto-collapsed regardless of tracker"`
- `"uniform cluster — manual click still expands"`
- `"uniform cluster — compact rows render with disambiguator"`
- `"mixed cluster — expand respects tracker as before"`
- `"mixed cluster — compact-row treatment NOT applied"`
- `"claudeteam.autoCollapseUniformClusters=false → uniform cluster behaves as M3-10 baseline"`

---

## 9. Sponsor questions — reserved for confirmation

Three small calls remain open. Each carries Iris's recommendation; sponsor's confirmation unlocks Maya's impl dispatch.

### Q1 — Status-hint label wording

**Recommendation:** `"all idle"` / `"all finished"`.

**Alternative considered:** `"4 idle"` / `"4 finished"` (count-prefixed; reads like the bg-chip vocabulary). Rejected because the count is already in the header (`Felix ×4`); duplicating it in the hint is redundant. The `"all"` framing names the *uniformity* itself, not the count.

### Q2 — Default for `claudeteam.autoCollapseUniformClusters`

**Recommendation:** `true` (auto-collapse ON by default).

**Rationale:** sponsor's verbatim quote is direct feedback that the current shape is wrong. Defaulting OFF would ship the polish but require sponsor to find and flip a setting before they see the benefit. Default-ON matches the spirit of the complaint.

**Reversibility:** one-line manifest flip if dogfood shows it's too aggressive.

### Q3 — Include Option A.1 (status-hint row in header) or hold for a follow-up?

**Recommendation:** include A.1 in the impl. It's purely additive (one `<span>`, one CSS rule, one const map of 4 entries) and meaningfully improves the auto-collapsed state's information density.

**Alternative:** ship Option A + B without A.1 in the first impl PR; file A.1 as a follow-up if sponsor signals interest. This keeps the first impl PR slightly smaller (S → XS-S boundary).

---

## 10. Out of scope / non-goals

- **Changing the `CollapsedPersonaGroup` wire shape.** Felix's host code is untouched. Uniformity is computed webview-side from existing `AgentTile.state` + `AgentTile.role`.
- **Changing the M3-10 collapse-threshold rule.** The host still wraps N≥2 same-persona dispatches into a `CollapsedPersonaGroup`; this spec only changes how the wrapper is RENDERED for the uniform subset.
- **Adding a per-instance summary panel.** Not in scope — the disambiguator letters + activity field carry per-instance info already; further drill-down belongs to M4-03's `ui:open-transcript` path.
- **Bulk-action UI** (e.g. "kill all idle Felix instances"). Read-only V1.
- **Cross-persona uniform clusters** (e.g. all team members idle). The wrapper is per-persona by construction; this spec doesn't change that.
- **Sponsor preference scalar for `claudeteam.alwaysExpandUniformClusters`** (the natural follow-up if §2.5's "click doesn't stick" cost proves annoying). Filed as post-V1 follow-up; not in this impl PR.
- **Animation / motion** beyond what M4-01 §2 already covers. No new keyframes; no new transitions.

---

## 11. Cross-section coordination notes

### 11.1 Composes with M5 hide-finished filter

The M5 filter operates on a `CollapsedPersonaGroup`'s `instances` array — when all `finished` instances are dropped, the wrapper either shrinks (still uniform) or unwraps (back to bare tile). The post-filter wrapper still passes through `computeIsUniform` per §2.1's check. No interaction conflict.

### 11.2 Composes with Defect 6b state label

Defect 6b's `computeGroupState` returns the most-active-first priority across instances. Option A's `computeIsUniform` is a stricter check (all same state, not just dominant state). Both functions can coexist in the same file. The wrapper header's state-dot continues to use `computeGroupState`; the uniformity gate uses `computeIsUniform`. No identifier collision.

### 11.3 Composes with Obs 10 expansion tracker

When `computeIsUniform` returns `true`, the tracker read is bypassed — `initiallyExpanded` is forced to `false`. The tracker's `setExpanded` STILL writes on click, so the manual expand still records (for diagnostic / replay purposes); it just doesn't drive the next render's initial state. No tracker contract change.

If Option A is sponsor-rejected, this short-circuit is reverted and the tracker behavior is fully restored.

---

## 12. Audit trail

- **ClickUp ticket `86c9zmqa8`** — polish ticket with sponsor verbatim.
- **`src/webview/components/collapsedPersonaTile.ts`** (current `main`) — M3-10 baseline + M4-05 prevState + Obs 10 tracker + Defect 6b state label.
- **`team/iris-ux/m2-dashboard-tile-spec.md` §5** — bare tile layout (compact-row variant of §3 inherits from this).
- **`team/iris-ux/m4-polish-spec.md` §2.2** — idle state visual treatment (compact rows match this convention).
- **`team/iris-ux/m5-hide-finished-spec.md` §3.2** — wrapper-aware filter precedent (§11.1).
- **CLAUDE.md hard rule** — no orchestrator-side coding; spec proposes, Maya implements.
- **`~/.claude/CLAUDE.md` "Parallel-agent shared-concept vocabulary discipline"** — informs §8.

---

*Spec authored against M3-10 + M4-05 + Obs 10 baselines. Recommended path: Option A + B + A.1 sub-variant. Sponsor confirms §9 Q1 / Q2 / Q3 before downstream Maya impl ticket is filed. Estimated impl size: S.*
