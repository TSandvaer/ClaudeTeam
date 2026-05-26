# M5 Hide-Finished-Agents Spec — Dashboard noise-reduction filter for terminal-state tiles

Design spec for a sponsor-controlled filter that suppresses `finished`-state agent tiles from the dashboard, reducing background clutter once an agent's work has terminated. Pairs a `claudeteam.*` configuration scalar (VS Code Settings) with an in-dashboard **header chip** so the sponsor can flip the filter without leaving the pane.

- **Ticket:** [ClickUp 86c9ytyq7](https://app.clickup.com/t/86c9ytyq7) — `feat(ux): hide-finished-agents control for dashboard`
- **Owner:** Iris
- **Peer reviewer (this spec PR):** Maya (visual) per Iris-PRs → Maya routing.
- **Sibling ticket (interaction):** [ClickUp 86c9yxv94](https://app.clickup.com/t/86c9yxv94) — Defect 6a finished-elapsed-time fix (Felix in flight).
- **Source quote (verbatim):** *"i dont [want] to see idle agents, or at least i want a toggle not to show idle"* — `team/dogfood/2026-05-25-session-lifecycle-quirks.md` §Observation 7.
- **Source ticket options:** Shape 1 (config toggle), Shape 2 (default-hide w/ reveal), Shape 3 (auto-expire).
- **Authoring discipline:** Theme-aware first (`--vscode-*` tokens via the `--ct-*` indirection layer from M4-01). No new tokens beyond what M4-01 §1 already declares. No new icon set.

---

## 0. Scope summary + decomposition

| Section | Surface | Implementer | Implementing ticket | Parallel-safe? |
|---|---|---|---|---|
| §1 Chosen shape + rationale | (design — no code) | (spec) | M5 — this PR | n/a |
| §2 Configuration key + manifest entry | `package.json` `contributes.configuration` | Felix | M5-EH (extension host) | Yes — independent of §3 |
| §3 Host-side filter + delta semantics | `src/extension/state/reducer.ts` or post-reducer projection + `messageBus.serializeState` | Felix | M5-EH (same as §2) | Yes |
| §4 Header chip — toggle affordance | `src/webview/components/headerChip.ts` (NEW) + `src/webview/render.ts` mount | Maya | M5-WV (webview) | Yes — depends only on §5 wire shape |
| §5 Hidden-count surface (in chip) | wire fields `hiddenFinishedCount` + `config.hideFinishedAgents` on `SerializedDashboardState` + AgentTree | Felix (declares) + Maya (consumes) | M5-EH + M5-WV | Yes — vocabulary contract in §7 |
| §6 Visual treatment + interaction states | `src/webview/styles/dashboard.css` (`.ct-header-chip` block) | Maya | M5-WV | Yes |
| §7 Vocabulary contract | (cross-section index) | — | — | — |

**Parallel-dispatch readiness:** Felix (M5-EH) and Maya (M5-WV) can dispatch simultaneously now that sponsor has answered Q1/Q2/Q3 (see §8) because the **vocabulary contract** in §7 fixes every shared identifier name + the wire-shape addition. Felix owns the `hideFinishedAgents` setting reading + the filtering logic + the `hiddenFinishedCount` field + the new `config` block on `SerializedDashboardState` (§3.5 Field B); Maya owns the `ct-header-chip` DOM/CSS + the `claudeteam.toggleHideFinished` command + the `ui:set-config` message consumption + reading `state.config?.hideFinishedAgents` for the chip's initial state. The two PRs touch disjoint file sets except for `src/shared/messages.ts` (one new message type — Felix declares the type, Maya imports). Sequence the type-declaration tick first if there's any doubt, but the shape is small enough (one new union member + two new optional fields on `SerializedDashboardState`) that parallel is the recommended path.

---

## 1. Chosen shape + rationale

**Chosen: Shape 1 (config toggle) + a Shape 2 affordance (in-dashboard control), filtering on `finished` state only.**

### 1.1 Why not pure Shape 2 (default-hide)

Default-hide is too opinionated for V1. The dashboard's V1 thesis is "accurate overview" — defaulting to hidden silently changes what the user sees on first install vs after first session activity, making the empty-state experience confusing ("the dashboard is broken — where are my agents?"). Default OFF + opt-in is the safer first cut.

### 1.2 Why not pure Shape 3 (auto-expire)

Auto-expire requires a per-tile **finished-at timestamp** that survives across polls. The webview-local `finishedTracker` (`src/webview/finishedTracker.ts`, M3-04 NIT #3) already tracks first-observed-finished-at for elapsed-time display — but auto-expire would couple the spec to that tracker's semantics, which Felix is actively reworking under Defect 6a (`86c9yxv94`). Coupling a new feature to an in-flight defect fix is a sequencing risk. Auto-expire is the right post-V1 path if dogfood shows the filter-toggle is too coarse; for V1 the toggle alone gives the sponsor the requested affordance without entangling with Defect 6a's state machine.

See §5.3 for the explicit interaction call-out with Defect 6a.

### 1.3 Why a header chip alongside the config key

The sponsor's verbatim quote is *"a toggle not to show idle"*. A toggle implies "I can flip this fast, in context." VS Code's Settings UI requires opening Settings → searching for "claudeteam" → flipping a checkbox → returning to the dashboard. That's the correct surface for a one-time configuration, NOT for a per-session "the dashboard is cluttered right now, let me filter." A header chip in the dashboard itself (positioned at the top of the mount, persistent across renders) gives the toggle the immediacy the sponsor asked for. The chip writes back to the same config key, so the two surfaces stay in sync.

### 1.4 Why `finished` only (not idle, not error)

- **`finished`** is the ticket's titled scope (`hide-finished-agents`) and the dominant noise class. Once an agent has completed, its tile carries no further information beyond the completion artifact — Defect 6a's elapsed-time fix gives the sponsor an "I just saw it complete" affordance for ~30 seconds; beyond that, the tile is residue.
- **`idle`** (the sponsor's verbatim word) is **ambiguous in current dashboard behavior** per Observation 6 — the dashboard is currently misclassifying long-thinking-turn `idle` as `finished` (defect 6 in the dogfood note). Hiding `idle` would compound the misclassification gap. Once Defect 6 is resolved and `idle` is reliably distinguished from `finished`, a follow-up ticket can extend the filter (§8 §Open Questions Q1).
- **`error`** must never be filtered. Errors are load-bearing alerts; hiding them defeats the dashboard.

The config key is **named to permit extension** (see §2.1 — `hideFinishedAgents` is a single-purpose scalar; extending to `idle` becomes a second scalar, not a re-shape of the existing one). This keeps the V1 surface tight without locking out the post-V1 path.

### 1.5 Why not auto-expire as a stretch goal

Out of scope for this spec. If dogfood after M5 lands says the toggle is too coarse, file a follow-up `feat(ux): auto-expire finished tiles after N seconds` — that ticket depends on Defect 6a being resolved first (Felix's elapsed-time fix gives auto-expire its timer).

---

## 2. Configuration key + manifest entry

### 2.1 The key

Add ONE new scalar to `package.json` `contributes.configuration.properties`:

```json
"claudeteam.hideFinishedAgents": {
  "type": "boolean",
  "default": false,
  "description": "Hide rostered agent tiles whose state is 'finished'. When true, the dashboard suppresses finished tiles and shows a count chip in the header (e.g. '3 finished hidden — show'). Background-noise rows are not affected — they collapse via the background chip instead. Toggle via Settings or the dashboard header chip."
}
```

**Why this naming:**

- `hideFinishedAgents` (camelCase, matches existing `claudeteam.showAllSessionsGlobally`, `claudeteam.collapsePersonaTiles`).
- **Verb-first** (`hide…`, not `show…`) — matches the sponsor's verbatim "i dont want to see…" frame; default `false` = "off, show everything" reads correctly.
- **Single-state scoped** — the key controls one state. If post-V1 work extends to `idle`, that's a SECOND scalar (`hideIdleAgents`), not a re-shape of this one. Two scalars compose cleanly; nested enums confuse the Settings UI (see `vscode-extension-conventions.md` §"Why configuration lists only scalars").

**Why `default: false`:** opt-in for V1. Sponsor explicitly framed it as "i want a toggle" — toggles default to off. First-install experience shows everything, no surprise empty states.

### 2.2 Manifest-touching gate

Per hard rule #4, the M5-EH PR (Felix) must include `vsce package --no-yarn` output in its Self-Test Report.

---

## 3. Host-side filter + delta semantics

### 3.1 Where the filter lives

The filter applies at **`buildAgentTree` exit / `serializeState` entry**, NOT inside the reducer's per-tile classification. Two reasons:

1. The reducer's job is to compute *truth* about each agent. Filtering is a *presentation* concern. Keeping them separate means the filter can be flipped on/off without invalidating the cached agent-tree.
2. The webview needs to know **how many tiles were filtered** (§5 — the chip displays the count). A post-reducer filter pass can produce both the filtered tree AND the count in one walk.

### 3.2 The filter function (Felix's contract)

Add a new file `src/extension/state/hideFinishedFilter.ts`:

```typescript
// Pseudo-signature — Felix authors the real impl.
export interface HideFinishedResult {
  tree: AgentTree;
  hiddenFinishedCount: number;
}

export function applyHideFinishedFilter(
  tree: AgentTree,
  hideFinished: boolean,
): HideFinishedResult;
```

**Filter semantics:**

1. **When `hideFinished === false`:** identity transform — return the input tree unchanged + `hiddenFinishedCount: 0`. No allocation if possible (just `{ tree, hiddenFinishedCount: 0 }`).
2. **When `hideFinished === true`:**
   - For each `SessionTree.rosterTiles[teamId]`:
     - For each `RosterTileEntry`:
       - **If bare `AgentTile` with `state === "finished"`** → drop it; increment `hiddenFinishedCount`.
       - **If `CollapsedPersonaGroup`**: walk `instances`; drop each instance with `state === "finished"`; increment counter per drop. If ALL instances drop, the wrapper itself is dropped (the team's tile list shrinks). If SOME drop, the wrapper's `count` and `instances` are rebuilt with the survivors (back to N=1 means unwrap to a bare `AgentTile`; N=0 means drop the wrapper entirely — see §3.4 invariant).
   - If a team's tile list becomes empty after filtering, **the team card is suppressed** (matches existing behavior — sessionBlock already suppresses empty teams per `m2-dashboard-tile-spec.md` §6).
   - **Background agents are NOT filtered.** They're already collapsed via the background chip; further filtering would double-hide.
   - Return the filtered tree + the running count.

### 3.3 Reading the config

```typescript
const hideFinished = vscode.workspace
  .getConfiguration("claudeteam")
  .get<boolean>("hideFinishedAgents", false);
```

Subscribe to `vscode.workspace.onDidChangeConfiguration` for `claudeteam.hideFinishedAgents` — fire an immediate state re-emit (the host already has the unfiltered tree cached from the last poll; re-running the filter is cheap, no need to re-poll the filesystem).

### 3.4 Filter invariants (Felix tests these)

- `applyHideFinishedFilter(t, false).tree === t` (referential identity when off).
- `applyHideFinishedFilter(t, true).hiddenFinishedCount >= 0`.
- Sum of `hiddenFinishedCount` across all sessions = total finished tiles in the unfiltered tree.
- A `CollapsedPersonaGroup` with `instances.length === 0` is NEVER emitted post-filter — collapse to "drop the wrapper" instead.
- The original `tree` is **not mutated** — the filter returns a new tree (or the same reference when off).

### 3.5 Wire-shape addition

Add TWO new fields to `SerializedDashboardState` (and its in-memory mirror `AgentTree`):

**Field A — the hidden count (used by the chip label):**

```typescript
/**
 * Count of rostered agent tiles suppressed this tick because their state
 * was "finished" AND `claudeteam.hideFinishedAgents === true`. Used by the
 * webview header chip to render "N finished hidden — show" / "hide".
 *
 * Optional + defaults to 0 — back-compat with pre-M5 consumers and
 * with the filter-off case (no count to render). Webview MUST treat
 * `undefined` as 0.
 */
hiddenFinishedCount?: number;
```

**Field B — the config mirror (used by the chip's initial state):**

```typescript
/**
 * Mirror of `claudeteam.*` config scalars relevant to the webview's
 * rendering. Lets the chip boot with its toggle reflecting the truth
 * stored in VS Code Settings (no roundtrip required for initial render).
 *
 * Optional — back-compat with pre-M5 consumers. Webview MUST treat
 * the entire `config` block AND individual fields as possibly undefined
 * and default to `false`.
 */
config?: {
  hideFinishedAgents?: boolean;
};
```

**Why a `config` block (not a flat `hideFinishedAgents?: boolean`):** the chip pattern will likely return (`hideIdleAgents` post-Defect-6 per §8 Q1; future filter / display toggles). A nested `config` block admits new mirror fields without polluting the top-level wire shape — every new chip-controlled scalar adds one key under `config`, not one top-level field.

**Felix's host-side population:** in `messageBus.serializeState(...)`, read each mirrored config key once and embed it:

```typescript
const cfg = vscode.workspace.getConfiguration("claudeteam");
const serialized: SerializedDashboardState = {
  ...existingFields,
  hiddenFinishedCount,
  config: {
    hideFinishedAgents: cfg.get<boolean>("hideFinishedAgents", false),
  },
};
```

Webview reads `state.config?.hideFinishedAgents ?? false` for the chip's initial `aria-pressed` / `data-hide-finished` value. The optimistic UI flip (§4.3) takes over from there; the next `state:full` re-confirms the value authoritatively after the host applies the change via `workspace.getConfiguration().update(...)`.

JSON-safe (booleans + plain integer). No Map/Set/Date — fits the existing serialization contract.

### 3.6 Delta-mode handling (post-V1, but contract is here)

`StateDelta` does NOT need a new field for filtered tiles. Delta producers (M4 optimization, not yet wired) treat filtered-out tiles as `removed` (just as if the session ended). When the filter flips off mid-session, the host emits a fresh `state:full` (not a delta) — clearing all phantom-removed tiles and re-adding the formerly-hidden ones. This is the simpler protocol and avoids divergence between filter state and delta replay.

---

## 4. Header chip — toggle affordance

### 4.1 Where it lives in the DOM

A new component `src/webview/components/headerChip.ts` renders the chip. Mount position: **ABOVE the session blocks and BELOW both error chips**. The table is authoritative; mount order top-to-bottom:

1. `rosterErrorChip` (M3-04 — when `state.rosterErrors` non-empty)
2. legacy `errorChip` (M2-05 — event-driven)
3. **`headerChip` (M5 — NEW)**
4. session blocks (one per session)
5. `emptyState` (when no sessions)

Rationale for position 3: error chips are higher-priority alerts (RED) — they must dominate. The header chip is a quiet utility control — sits above the data it filters but below the alerts that override everything.

### 4.2 DOM shape

```html
<aside class="ct-header-chip" data-hide-finished="false" data-hidden-count="0">
  <button type="button"
          class="ct-header-chip-toggle"
          aria-pressed="false"
          title="Hide finished agents">
    <span class="ct-header-chip-label">Hide finished</span>
    <span class="ct-header-chip-count" hidden>0</span>
  </button>
</aside>
```

States the chip can be in:

| `data-hide-finished` | `hiddenFinishedCount` | Label rendered | aria-pressed | Notes |
|---|---|---|---|---|
| `false` | 0 | "Hide finished" | `false` | Initial / opt-in baseline. No count badge. |
| `false` | N>0 | (impossible by §3.2 contract — count is 0 when filter off) | — | Guarded in render — if observed, render as if N=0. |
| `true` | 0 | "Hide finished — none yet" | `true` | Filter is on, but no finished tiles exist this tick. Visible but understated. |
| `true` | N>0 | "Hide finished — N hidden" | `true` | The dominant ON state. Label compactly reports what the filter is doing. |

**Why a single button (not separate "show" / "hide" controls):** the chip toggles. `aria-pressed` (per [W3C ARIA toggle-button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/#toggle-button)) is the canonical accessibility surface for two-state controls — assistive tech announces "Hide finished, pressed" or "Hide finished, not pressed."

**Why `<aside>` (not `<section>` or `<div>`):** semantically the chip is tangential to the main dashboard content (it's a control, not data). `<aside>` is the correct landmark per HTML5 semantics; screen readers can skip it with landmark navigation.

### 4.3 Interaction

- **Click / Enter / Space** on the toggle → flip `data-hide-finished`, flip `aria-pressed`, post a `ui:set-config` message to the host (see §4.5).
- **Optimistic UI:** the chip flips its visual state IMMEDIATELY on click (no wait for host roundtrip). The host's eventual `state:full` (or `state:delta` post-V1) re-renders the dashboard with the filter applied. If the host fails to apply (unexpected), the next render restores chip state from the wire — eventual consistency.
- **Keyboard:** native button semantics give Enter + Space free.
- **Tab order:** chip sits BEFORE session blocks in DOM order, so it's the first focusable element after the error chips. Sponsor pressing Tab from address bar / activity bar reaches the toggle first — appropriate for a primary control.

### 4.4 New command (optional but recommended)

Add to `package.json` `contributes.commands`:

```json
{
  "command": "claudeteam.toggleHideFinished",
  "title": "ClaudeTeam: Toggle Hide Finished Agents",
  "icon": "$(eye-closed)"
}
```

The command flips the config key (host-side; same path as the chip click). Sponsor can bind a keyboard shortcut via `keybindings.json` if they want one. The command is also discoverable via `Ctrl+Shift+P`.

The chip itself does NOT need to invoke the command — the chip posts directly to the host (`ui:set-config`). The command is a parallel surface for keybinding / palette discoverability.

### 4.5 New webview → host message

Extend `WebviewMessage` in `src/shared/messages.ts`:

```typescript
/** User toggled a config-backed dashboard setting (chip / command path). */
export type SetConfigMessage = {
  type: "ui:set-config";
  payload: {
    key: "hideFinishedAgents";
    value: boolean;
  };
};
```

**Why a generic `ui:set-config` (not `ui:toggle-hide-finished`):** the chip pattern will likely return for future filters (`hideIdleAgents`, `hideBackgroundAgents`, etc. — sponsor's "or at least i want a toggle" hints at more to come). A generic message type with `{ key, value }` admits new settings without proliferating message types. The `key` is a string-literal union initially; extending it adds union members, not new messages.

Host handles by calling `vscode.workspace.getConfiguration("claudeteam").update(key, value, vscode.ConfigurationTarget.Global)` (sponsor confirmed `Global` per §8 Q3) and lets the existing `onDidChangeConfiguration` listener re-fire the filter.

### 4.6 Empty-state interaction

When the dashboard is empty (no sessions, or all sessions dead), should the header chip render?

**Recommendation: YES, always render, but disabled-looking when `hiddenFinishedCount === 0`.** Rationale:

- The chip is a persistent control, like a settings checkbox at the top of a panel. Hiding it would make the toggle non-discoverable when the user opens an empty dashboard.
- When the count is 0, the chip is visually de-emphasized (lower opacity, see §6.2) but still clickable — flipping ON in an empty dashboard pre-arms the filter for when sessions arrive.

**Render-mount implementation note (Maya M5-WV):** the current `src/webview/render.ts` empty branch (around `render.ts:264`) replaces the mount with only `renderEmptyState()` — the chip would NOT survive that path as written. M5-WV must amend the empty branch to mount the array `[rosterErrorChip, errorChip, headerChip, emptyState]` (per the §4.1 order, dropping session blocks but keeping the chip stack) instead of `[emptyState]`. Both branches (with-sessions + empty) must produce the chip at position 3.

---

## 5. Hidden-count surface (in chip)

### 5.1 What the count shows

`hiddenFinishedCount` from the wire (§3.5). It's the **total across all sessions** in the current dashboard, NOT per-session. Rationale: the chip is a global filter (the config key is global), so the count must be global to match.

### 5.2 Label templates

| Condition | Rendered label |
|---|---|
| filter off | `Hide finished` |
| filter on + 0 hidden | `Hide finished — none yet` |
| filter on + N=1 | `Hide finished — 1 hidden` |
| filter on + N>1 | `Hide finished — N hidden` |

**Why include the count in the visible label (not a tooltip):** the sponsor needs to know whether the filter is doing anything WITHOUT hovering. Hover-only feedback fails when the sponsor scans the dashboard at a glance.

**Why "hidden" (not "filtered" / "suppressed" / "off-screen"):** matches the verb in the config key (`hideFinishedAgents`). One vocabulary across config, command, chip, and docs.

### 5.3 Interaction with Defect 6a (`86c9yxv94`, Felix in flight)

Defect 6a's scope: fix the misclassification where idle agents render as `finished 0s`. Felix is reworking the elapsed-time computation in the reducer / finishedTracker.

**Spec coupling:**

- **Same surface, different concerns.** Defect 6a corrects the **classification** of `idle` vs `finished`. M5's filter operates on the result of that classification. The two are sequential in the data flow: classify → filter.
- **No vocabulary collision.** Defect 6a touches `AgentTile.state` semantics + `finishedTracker.ts`; M5 touches `hideFinishedAgents` config + `hideFinishedFilter.ts`. Felix can land 6a first OR M5-EH first — either order works. If 6a lands first, M5's filter sees a more accurate `finished` distribution (fewer false positives). If M5 lands first, the filter operates on the M2 baseline classification; when 6a lands later, the filter behavior tightens automatically (some previously-hidden tiles will re-appear as their state corrects to `idle`).
- **No spec change required to either side.** The spec for M5 does NOT need to wait for 6a. Both can dispatch in parallel.

**Status update (2026-05-26):** Defect 6a (`86c9yxv94`) merged 2026-05-26 at main SHA `7670e09` (PR #69 — `fix(reducer): finished elapsed-time suffix via FinishedMap`). Defect 6b (`86c9yxvah`) merged same round at `4669ae0` (PR #68 — `fix(webview): collapsed-group state-dot`). The Defect-6 family is closed; the coupling Iris cited as a reason to reject Shape 3 (auto-expire) is now resolved on main. **Shape 3 stays rejected** as a design call (per §1.2 — auto-expire is the right post-V1 path if dogfood shows the toggle is too coarse; not in V1 scope), but the original blocker is informational only. Sage's M5 test plan no longer needs the "filter respects misclassified-finished" regression — `idle` and `finished` are now reliably distinguished on main, so the M5 filter operates on accurate classifications by construction. The §8 Q1 follow-up ticket (extend filter to `idle`) is the natural next step now that Defect 6 closes.

---

## 6. Visual treatment + interaction states

### 6.1 Chip CSS — base block

Add to `src/webview/styles/dashboard.css`:

```css
.ct-header-chip {
  display: flex;
  justify-content: flex-end;
  padding: var(--ct-space-s) var(--ct-space-m);
  /* No border / background on the wrapper — the inner button carries chrome. */
}

.ct-header-chip-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--ct-space-xs);
  padding: 4px 10px;
  background-color: transparent;
  color: var(--ct-color-fg-muted);
  border: 1px solid var(--ct-color-border);
  border-radius: var(--ct-radius-chip);
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.2;
  transition:
    background-color var(--ct-duration-state-transition) ease-out,
    color var(--ct-duration-state-transition) ease-out,
    border-color var(--ct-duration-state-transition) ease-out;
}

.ct-header-chip-toggle:hover {
  background-color: var(--ct-color-bg-hover);
  color: var(--ct-color-fg);
}

.ct-header-chip-toggle:focus-visible {
  outline: 1px solid var(--ct-color-focus);
  outline-offset: 1px;
}

/* ON state — filter active. Border + text shift to fg (not muted). */
.ct-header-chip[data-hide-finished="true"] .ct-header-chip-toggle {
  color: var(--ct-color-fg);
  border-color: var(--ct-color-fg-muted);
  /* Subtle inset to telegraph "pressed." */
  background-color: var(--ct-color-bg-hover);
}

/* Disabled-looking when filter is on but nothing to hide (count=0). */
.ct-header-chip[data-hidden-count="0"][data-hide-finished="true"]
  .ct-header-chip-toggle {
  opacity: 0.7;
}

.ct-header-chip-count {
  /* Inline counter — rendered separately so it can hide via [hidden]. */
  font-variant-numeric: tabular-nums;
}
```

All tokens consumed are M4-01 declarations (`--ct-space-*`, `--ct-color-*`, `--ct-radius-chip`, `--ct-duration-state-transition`). **No new tokens required.** This is a strict consume-only — confirms M4-01 §1.2.6's "Single source of truth so reduced-motion overrides can target one value" by reusing the existing duration.

### 6.2 Reduced-motion

The transitions (`background-color`, `color`, `border-color`) are subtle and short. The existing `@media (prefers-reduced-motion: reduce)` block in `dashboard.css` (M4-01 §2.6) elides `.agent-tile[data-transition]` and `.state-dot` animations — extend it to elide the chip's `transition` declarations too:

```css
@media (prefers-reduced-motion: reduce) {
  /* ...existing M4-01 §2.6 rules... */
  .ct-header-chip-toggle {
    transition: none;
  }
}
```

Color/border end-states still apply instantly. Filter behavior is unchanged.

### 6.3 Theme-switch behavior

All colors flow through `--ct-color-*` tokens (which flow through `--vscode-*`). Theme-switch is automatic — no per-theme overrides needed. Maya's Self-Test Report cites dark↔light renders.

### 6.4 Color-blind / contrast

The chip uses no semantic state color (green / amber / red) — only `--ct-color-fg`, `--ct-color-fg-muted`, `--ct-color-border`, `--ct-color-bg-hover`. These are theme-neutral and pass contrast in both default themes. No additional probes required.

---

## 7. Vocabulary contract (per parallel-agent global rule)

Per `~/.claude/CLAUDE.md` "Parallel-agent shared-concept vocabulary discipline" — every identifier the parallel-dispatched Felix + Maya implementations will reference is fixed here. Both PRs MUST use these names verbatim.

### 7.1 Host + shared identifiers (Felix declares)

| Identifier | Kind | Declared by | Consumed by | Notes |
|---|---|---|---|---|
| `claudeteam.hideFinishedAgents` | `package.json` config key | Felix (M5-EH) | Felix (host read) + Maya (chip writes via `ui:set-config`) | Default `false`. |
| `claudeteam.toggleHideFinished` | `package.json` command id | Felix (M5-EH) | Both | Optional but recommended; Maya MAY add a button reference. |
| `applyHideFinishedFilter` | exported function | Felix (M5-EH) | Felix internal | In `src/extension/state/hideFinishedFilter.ts` (NEW). |
| `HideFinishedResult` | TS interface | Felix (M5-EH) | Felix internal | Shape: `{ tree: AgentTree; hiddenFinishedCount: number }`. |
| `hiddenFinishedCount` | optional field on `AgentTree` + `SerializedDashboardState` | Felix (M5-EH) | Maya (M5-WV) reads | Wire shape: `number | undefined`. Webview MUST treat `undefined` as `0`. |
| `config` (block on `SerializedDashboardState`) | optional nested block | Felix (M5-EH) | Maya (M5-WV) reads | Shape: `{ hideFinishedAgents?: boolean }`. Webview reads `state.config?.hideFinishedAgents ?? false` for initial chip state. See §3.5 Field B. |
| `SetConfigMessage` | TS type union member on `WebviewMessage` | Felix declares in `src/shared/messages.ts` | Maya imports | Payload shape: `{ key: "hideFinishedAgents"; value: boolean }`. See §7.3 for the discriminator value. |

### 7.2 Webview-only identifiers (Maya declares)

| Identifier | Kind | Declared by | Consumed by | Notes |
|---|---|---|---|---|
| `ct-header-chip` | CSS class on root `<aside>` | Maya (M5-WV) | Maya internal | Defines the block. |
| `ct-header-chip-toggle` | CSS class on inner `<button>` | Maya (M5-WV) | Maya internal | The interactive surface. |
| `ct-header-chip-label` | CSS class on label `<span>` | Maya (M5-WV) | Maya internal | Holds the verbal portion. |
| `ct-header-chip-count` | CSS class on count `<span>` | Maya (M5-WV) | Maya internal | Holds the numeric portion (hidden when 0 / filter off). |
| `data-hide-finished` | HTML data attribute on `<aside>` | Maya (M5-WV) | Maya internal (CSS) | Values: `"true"` / `"false"`. |
| `data-hidden-count` | HTML data attribute on `<aside>` | Maya (M5-WV) | Maya internal (CSS) | String form of `hiddenFinishedCount` (`"0"` / `"1"` / `"N"`). |
| `headerChip` | TS module + export `renderHeaderChip` | Maya (M5-WV) | Maya internal (called from `render.ts`) | In `src/webview/components/headerChip.ts` (NEW). Mirror the existing `renderErrorChip` pattern. |
| `HeaderChipProps` | TS interface | Maya (M5-WV) | Maya internal | Shape: `{ hideFinished: boolean; hiddenCount: number; postMessage: (msg: WebviewMessage) => void }`. |

### 7.3 Discriminator + literal values (exact strings)

| Surface | Exact value | Where used |
|---|---|---|
| `SetConfigMessage.type` discriminator | `"ui:set-config"` | Webview posts; host's message handler discriminates on it. |
| `SetConfigMessage.payload.key` literal | `"hideFinishedAgents"` | The only `key` value valid for M5 (extending to `"hideIdleAgents"` etc. is a follow-up — see §8 Q1). |
| Chip label — filter off | `"Hide finished"` | No em-dash, no count. |
| Chip label — filter on + 0 hidden | `"Hide finished — none yet"` | Em-dash `—` (U+2014). |
| Chip label — filter on + N=1 | `"Hide finished — 1 hidden"` | Em-dash `—` (U+2014). |
| Chip label — filter on + N>1 | `"Hide finished — N hidden"` (N substituted) | Em-dash `—` (U+2014). |

### 7.4 Ownership boundary

**No identifiers are owned by both sides.** Felix and Maya can dispatch in parallel. The only file touched by both is `src/shared/messages.ts` (Felix adds the type; Maya imports it from the same file). Sequence-of-merge is irrelevant — whichever lands first, the other rebases trivially on the addition.

---

## 8. Sponsor questions — ANSWERED 2026-05-26

All three open questions confirmed by sponsor 2026-05-26 (accept-defaults; Iris's recommendations stand). Recorded here for spec-as-source-of-truth so M5-EH / M5-WV dispatch briefs can reference final answers.

**Q1 — `idle` extension follow-up?** **ANSWERED 2026-05-26: YES — follow-up ticket filed for post-base-feature scope.**

The sponsor's verbatim said *"idle agents"*. This M5 spec scopes to `finished` only because Defect 6 (idle-misclassified-as-finished) was unresolved at design time. Now that Defect 6a (`86c9yxv94` PR #69) + Defect 6b (`86c9yxvah` PR #68) merged 2026-05-26, `idle` is a reliable distinct state and the extension follow-up is unblocked.

- **Follow-up ticket:** ClickUp ID `<INSERT-CLICKUP-FOLLOWUP-ID>` — `feat(ux): extend hide-finished filter to idle agents (hideIdleAgents)` (orchestrator-filed 2026-05-26 this round; ID to be backfilled by orchestrator since sub-agent does not have ClickUp MCP access to fetch the verbatim ID). The follow-up adds a SECOND scalar `claudeteam.hideIdleAgents` per §2.1's two-scalars-not-one-enum design — it does NOT re-shape the M5 scope.
- **This M5 ticket ships finished-only** — no scope creep.

**Q2 — Default `false` or `true`?** **ANSWERED 2026-05-26: `false` — sponsor confirmed Iris recommendation.**

Ship default `false` for V1 install safety. First-install experience shows everything; no surprise empty states. The chip itself is the opt-in surface. Revisit after dogfood.

- `package.json` manifest: `"default": false` per §2.1.
- §2.1 description text: as-written (no change needed).
- Chip's initial render: filter OFF, no count badge, label `"Hide finished"`.

**Q3 — Config target: Global or Workspace?** **ANSWERED 2026-05-26: `ConfigurationTarget.Global` — sponsor confirmed Iris recommendation.**

The chip writes back to `vscode.workspace.getConfiguration("claudeteam").update("hideFinishedAgents", value, vscode.ConfigurationTarget.Global)`. One toggle, applies across all VS Code windows / workspaces. Easier mental model than per-workspace scoping; matches how the sponsor will use it (a personal preference statement, not a per-workspace concern).

- Felix's M5-EH `ui:set-config` handler: hardcode `ConfigurationTarget.Global` in the `update(...)` call.
- Spec §4.5 text: as-written (the parenthetical "(or `Workspace` — see §8 Q3)" can be dropped at impl time, but is harmless until then).

---

## 9. Implementation checklists — paste-ready blocks

### 9.1 M5-EH (Felix) paste block

```
Ticket: M5-EH — feat(ext): hide-finished-agents host filter + config wiring
Spec section: m5-hide-finished-spec.md §2, §3, §5, §7
Branch: felix/<ticket-id>-m5-eh-hide-finished

Implementation checklist:
- package.json: add claudeteam.hideFinishedAgents (boolean, default false — sponsor confirmed §8 Q2) per §2.1.
- package.json: add claudeteam.toggleHideFinished command per §4.4 (Felix declares the contributes entry; the command handler in main.ts toggles the config key).
- src/shared/types.ts: add hiddenFinishedCount?: number AND optional config block to AgentTree (or via mirror on SerializedDashboardState — see §3.5).
- src/shared/messages.ts: add SerializedDashboardState.hiddenFinishedCount?: number; add SerializedDashboardState.config?: { hideFinishedAgents?: boolean } (per §3.5 Field B — chip's initial-state mirror); add SetConfigMessage type to WebviewMessage union (discriminator "ui:set-config" per §7.3).
- src/extension/state/hideFinishedFilter.ts (NEW): export applyHideFinishedFilter + HideFinishedResult per §3.2.
- Reducer/messageBus integration: apply filter at serializeState entry; thread hiddenFinishedCount AND config.hideFinishedAgents (read once per serialization from vscode.workspace.getConfiguration("claudeteam")) onto the wire payload per §3.5.
- onDidChangeConfiguration listener for claudeteam.hideFinishedAgents → re-emit state:full (or delta) immediately.
- Host handler for ui:set-config messages: validate key === "hideFinishedAgents", call workspace.getConfiguration("claudeteam").update(key, value, vscode.ConfigurationTarget.Global) — sponsor confirmed Global per §8 Q3.
- Tests (vitest unit + integration):
  - applyHideFinishedFilter — off → identity; on → drops finished tiles + counts.
  - CollapsedPersonaGroup with mixed states → wrapper rebuilt with survivors; all-finished → wrapper dropped.
  - Empty team after filter → suppressed.
  - hiddenFinishedCount sums across sessions.
  - Background agents NEVER filtered.
  - serializeState emits config.hideFinishedAgents matching workspace configuration.
- vsce package --no-yarn output in Self-Test Report (manifest gate).
- Cite data-plane smoke (live runTick against ~/.claude/ with a finished agent); defer interactive screenshots to sponsor.
- PR body: cross-ref to Defect 6a (86c9yxv94, MERGED 2026-05-26 main `7670e09`) — non-interaction per §5.3 status update.

Out of scope:
- Chip rendering (Maya M5-WV).
- Auto-expire (post-V1, see spec §1.5).
- Extending filter to `idle` (spec §8 Q1 follow-up ticket, separate scope).
```

### 9.2 M5-WV (Maya) paste block

```
Ticket: M5-WV — feat(webview): hide-finished header chip + visuals
Spec section: m5-hide-finished-spec.md §4, §5.2, §6, §7
Branch: maya/<ticket-id>-m5-wv-header-chip

Implementation checklist:
- src/webview/components/headerChip.ts (NEW): export renderHeaderChip(props: HeaderChipProps): HTMLElement per §4.2.
  - Props per §7.2: { hideFinished: boolean; hiddenCount: number; postMessage: (msg: WebviewMessage) => void }.
  - DOM shape: <aside class="ct-header-chip" data-hide-finished data-hidden-count><button class="ct-header-chip-toggle" aria-pressed type="button" title>...<span class="ct-header-chip-label">...<span class="ct-header-chip-count" hidden></span></button></aside>.
  - Label text per §5.2 / §7.3 templates (em-dash U+2014 between "Hide finished" and the count phrase).
  - Click + Enter + Space all fire ui:set-config (discriminator "ui:set-config" per §7.3) with payload { key: "hideFinishedAgents", value: !hideFinished }.
  - Optimistic UI: flip data-hide-finished + aria-pressed immediately on click; host roundtrip eventually re-renders authoritatively.
- src/webview/render.ts:
  - Mount headerChip at position 3 in the top-to-bottom order (§4.1). Always render — both with-sessions branch AND empty branch must produce the chip (per NIT 3 / §4.6 render-mount note).
  - Read chip initial state from `state.config?.hideFinishedAgents ?? false` (§3.5 Field B — Felix populates the field; webview reads it on every state:full).
  - Read hiddenCount from `state.hiddenFinishedCount ?? 0`.
- src/webview/styles/dashboard.css: add the §6.1 block. Extend the existing @media (prefers-reduced-motion: reduce) block per §6.2.
- Tests (vitest unit, jsdom):
  - Chip renders with correct label per each state in §4.2 table.
  - aria-pressed reflects data-hide-finished.
  - Click fires ui:set-config with toggled value.
  - Keyboard Enter + Space fire the same message.
  - Count span [hidden] when filter off or count=0; visible when filter on + count>0.
  - Empty-state branch: chip still present at position 3 above emptyState.
  - state.config?.hideFinishedAgents undefined → chip boots OFF; true → chip boots ON.
  - Reduced-motion: assert via fake matchMedia mock that transitions are elided OR cite manual probe in Self-Test Report.
- Manual probe (Self-Test Report):
  - Install vsix.
  - Open dashboard with a finished agent visible. Toggle the chip → tile vanishes, chip label updates to "Hide finished — 1 hidden".
  - Toggle again → tile reappears, label reverts.
  - Theme-switch dark↔light — chip renders correctly in both.
  - Tab to chip → outline visible. Press Enter → toggles. Press Space → toggles.
  - Reload window with hideFinishedAgents=true in Settings → chip boots ON.
  - Cite data-plane smoke; defer interactive screenshots to sponsor.

Wire-shape contract (settled per §3.5 + §7.1): Felix populates `state.config.hideFinishedAgents` on every state:full. Maya consumes from there; no inference, no roundtrip required for initial render.

Out of scope:
- Host-side filtering logic (Felix M5-EH).
- New tokens (M4-01 §1 already covers all needed).
- Per-session chip variant (this is a global chip).
```

---

## 10. Cross-section coordination notes

### 10.1 Merge order: M5-EH first if both ready simultaneously

If both PRs are review-ready at the same time, **merge M5-EH first** so that Maya's M5-WV branch sees the new types (`hiddenFinishedCount`, `SetConfigMessage`) on `origin/main` when rebasing. Maya should NOT rebase M5-WV onto an unmerged M5-EH branch — the rebase will produce conflict markers on the messages.ts file even if the additions are logically compatible.

If they review-ready out of order, no special handling — `messages.ts` additions are append-only.

### 10.2 If Defect 6a lands between M5-EH and M5-WV

If Felix lands Defect 6a (`86c9yxv94`) between M5-EH and M5-WV merges, no spec change — M5-WV's chip renders against whatever `hiddenFinishedCount` the (post-6a) host provides. The filter sees post-6a classification; previously-misclassified-finished tiles will now correctly stay as `idle` and remain visible. This is the intended outcome.

### 10.3 Sponsor Q2 / Q3 — answered (no override)

Sponsor confirmed Iris's recommendations 2026-05-26 (per §8): `default: false`, `ConfigurationTarget.Global`. The override paths previously documented here are not exercised — M5-EH ships the recommended values verbatim. (Reversal is still cheap if dogfood after M5 motivates: one-line manifest flip for Q2, one-line handler change for Q3 — both safe to redo as follow-ups.)

---

## 11. Audit trail

- **ClickUp ticket `86c9ytyq7`** — feature ask + three implementation shapes.
- **Defect 6a `86c9yxv94`** — sibling defect, in-flight Felix work on elapsed-time.
- **Sponsor verbatim quote** — `team/dogfood/2026-05-25-session-lifecycle-quirks.md` §Observation 7.
- **M4-01 polish spec** — `team/iris-ux/m4-polish-spec.md` §1 (token system this spec consumes).
- **M2 tile spec baseline** — `team/iris-ux/m2-dashboard-tile-spec.md` §6 (empty-team suppression rule that this spec piggybacks on).
- **VS Code conventions** — `.claude/docs/vscode-extension-conventions.md` §"Why configuration lists only scalars" (informs §2.1's two-scalars-not-one-enum choice), §"Message protocol" (informs §4.5's new message type), §"JSON-serialization constraint" (informs §3.5's wire-shape choice).
- **Parallel-agent vocabulary rule** — user-global CLAUDE.md "Parallel-agent shared-concept vocabulary discipline" (informs §7).
- **AgentTree / SerializedDashboardState** — `src/shared/types.ts:453` + `src/shared/messages.ts:65` (in-memory + wire shapes this spec extends).
- **CollapsedPersonaGroup contract** — `src/shared/types.ts:317` (M3-10) + `src/webview/components/collapsedPersonaTile.ts` (informs §3.2's wrapper-handling rule).

---

*Spec authored M5. Q1/Q2/Q3 answered by sponsor 2026-05-26 (accept-defaults). Two implementation tickets (M5-EH host + M5-WV webview) dispatch in parallel — no further sponsor sign-off required for the design. Estimated size: M5-EH = S (config + filter + tests); M5-WV = S (chip component + CSS + tests). Single-PR retro lands together at M5-RETRO.*
