# M4 Polish Spec — Styling Tokens + Status-State Visuals + Drill-in Affordance

Three-part design spec covering V1's final polish milestone. Maya implements §1 in M4-02, §2 in M4-05, §3 in M4-03 (with Felix on host-side verification). Each section ends with an "Implementation checklist for Maya" subsection — drop those bullets directly into the M4-02 / M4-03 / M4-05 dispatch briefs.

- **Ticket:** [ClickUp 86c9ygcgv](https://app.clickup.com/t/86c9ygcgv) — `spec(ux): M4 design — styling tokens + status-state visuals + drill-in affordance model`
- **Owner:** Iris
- **Peer reviewer:** Maya (visual) — Felix consulted only on spec-edges that imply a host-side state-shape change (none surface in V1 scope).
- **Source docs:** `team/iris-ux/m2-dashboard-tile-spec.md` (M2 visual baseline this spec extends), `team/iris-ux/m1-cli-output-spec.md` (state vocabulary baseline), `docs/V1-PLAN.md` line 113 (M4 surfaces) + "Identity & display rules" (state enum), `.claude/docs/vscode-extension-conventions.md` "Webview rules", `src/webview/styles/dashboard.css` (current implementation), `src/shared/types.ts` line 241 (`AgentState` source of truth).
- **Authoring discipline:** Theme-aware first (CLAUDE.md). The four semantic state colors stay as hardcoded hex (carry-over from M2-04); every other color goes through `var(--vscode-*)`. No new icon set, no animation framework.

---

## 0. Scope summary

| Section | Surface | Implementer | Implementing ticket |
|---|---|---|---|
| §1 Styling tokens | `:root` + selector blocks across `dashboard.css` | Maya | M4-02 |
| §2 Status-state visuals + transitions | `state-dot` + `agent-tile` + `error-chip` + keyframes | Maya | M4-05 |
| §3 Drill-in affordance | `agent-tile` cursor/tooltip/keyboard, focus ring, background-chip click-through | Felix + Maya | M4-03 |

Three sections are independent enough that Maya can lift §1 and §2 in either order; §3 is independent of both. Each section's "Implementation checklist for Maya" subsection is paste-ready.

---

## 1. Styling tokens

### 1.1 Goal

Consolidate the implicit constants currently scattered across `src/webview/styles/dashboard.css` into a named token system that:

1. Lives in one `:root` block at the top of the file (extending the existing `--ct-*` block at lines 26–33).
2. Names every reusable value (color, spacing, radius, duration) so Maya can search-and-replace in one pass.
3. Maps each color token to its VS Code theme variable counterpart (`var(--vscode-...)`) with a fallback for older themes. Spacing tokens are literal pixels (theme-independent).
4. Carries forward the four semantic state-color hex values as `--ct-color-state-*` tokens (still hardcoded — color semantics must survive theme switches; CLAUDE.md hard rule).

The M2 spec's §10 token table is the baseline. M4-01 promotes those values from "documentation table" to "first-class `--ct-*` custom properties consumed throughout the stylesheet."

### 1.2 Token catalog

Token count: 20. Sits at the upper edge of AC2's 12–20 target. Promotion bar applied: variables used ≥2 times across distinct selectors get a `--ct-*` token; one-shot variables stay inline as `var(--vscode-NAME, FALLBACK)`.

**1.2.1 Color tokens — theme-mapped (7)**

Each `--ct-color-*` declaration is `var(--vscode-NAME, FALLBACK)`. The fallback values are the spec-§10 VS Code defaults; they fire only when a theme has not defined the variable.

- `--ct-color-fg` — primary text (display, activity, headers). Maps to `var(--vscode-foreground, #cccccc)`.
- `--ct-color-fg-muted` — secondary text (role, model, descriptions, cwd/title). Maps to `var(--vscode-descriptionForeground, #858585)`.
- `--ct-color-bg-editor` — outer panel background. Maps to `var(--vscode-editor-background, #1e1e1e)`.
- `--ct-color-bg-sidebar` — session block background. Maps to `var(--vscode-sideBar-background, var(--ct-color-bg-editor))`.
- `--ct-color-bg-hover` — tile hover / chip hover (5 sites). Maps to `var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.07))`.
- `--ct-color-border` — session block border, team-header rule, background-chip dashed border. Maps to `var(--vscode-panel-border, #444444)`.
- `--ct-color-focus` — focus-visible outline. Maps to `var(--vscode-focusBorder, #007fd4)`. **Used everywhere a focusable surface lives** (tile, chip header, persona header, roster-error chip body, error-chip-action). Single source of truth.

**1.2.2 Inline-only theme variables — NOT promoted (one-shot rationale)**

The following VS Code variables stay as `var(--vscode-NAME, FALLBACK)` inline at their single use site. Promotion would add indirection without reuse value.

- `--vscode-disabledForeground` — 2 uses, both on the dead-session treatment (`.session-block--dead` color + `.session-dead-badge` border). One semantic concept; keep colocated.
- `--vscode-textBlockQuote-background` — single use (`.empty-state-code`).
- `--vscode-button-background` / `--vscode-button-foreground` / `--vscode-button-hoverBackground` — all three single use on `.error-chip-action`.
- `--vscode-inputValidation-error*` (3 vars) / `--vscode-inputValidation-warning*` (3 vars) — each single use, all colocated in `.error-chip--error` / `.error-chip--warning`.

**1.2.3 Semantic state colors — hardcoded (4)**

These four values carry over from M2-04 spec §10.2 with no change. Hardcoded hex; do NOT use `var(--vscode-*)`. Promoted to tokens so future state-treatment work (e.g., border accents, fade tints) can reference one name instead of a literal.

- `--ct-color-state-running` — `#4caf50` (Material Green 500). Active / progressing.
- `--ct-color-state-idle` — `#ffa726` (Material Orange 400). Alive but JSONL stale > 10s.
- `--ct-color-state-finished` — `#78909c` (Material Blue-Grey 400). Completed.
- `--ct-color-state-error` — `#ef5350` (Material Red 400). Parse/load failure.

**1.2.4 Spacing tokens — carry-over (4)**

Already declared at `src/webview/styles/dashboard.css:26–33`. Names and values unchanged; restate for completeness:

- `--ct-space-xs` — `4px`. Inner tile row gap.
- `--ct-space-s` — `8px`. Tile padding, header gap.
- `--ct-space-m` — `12px`. Team card padding, chip padding.
- `--ct-space-l` — `16px`. Session block padding, child tile indent.

**1.2.5 Component dimension tokens — carry-over (2)**

Also already declared. Restate:

- `--ct-state-dot-size` — `10px`. State dot diameter.
- `--ct-state-dot-gap` — `8px`. Gap between state dot and display name.

**1.2.6 Radius + animation tokens — NEW (3, M4-only)**

Three new tokens introduced by M4-01. They unblock §2 status-state visuals (animation duration) and codify the radii currently hardcoded.

- `--ct-radius-tile` — `4px`. Tile, session block, team card, error chip. (Currently inline `border-radius: 4px` on multiple selectors — consolidate.)
- `--ct-radius-chip` — `2px`. Small affordances (chip header focus outline, error-chip-action, error-chip-dismiss, dead-session badge, focus-visible chip outlines).
- `--ct-duration-state-transition` — `200ms`. Default transition duration for state-change animations (§2). Single source of truth so reduced-motion overrides can target one value.

### 1.3 `:root` declaration order

Maya declares tokens in this order in `:root` (top-to-bottom = least-coupled to most-coupled). Comments separate groups.

```css
:root {
  /* Spacing scale (carry-over from M2) */
  --ct-space-xs: 4px;
  --ct-space-s: 8px;
  --ct-space-m: 12px;
  --ct-space-l: 16px;

  /* Component dimensions (carry-over from M2) */
  --ct-state-dot-size: 10px;
  --ct-state-dot-gap: 8px;

  /* Radii + durations (new — M4-01) */
  --ct-radius-tile: 4px;
  --ct-radius-chip: 2px;
  --ct-duration-state-transition: 200ms;

  /* Theme-mapped colors — promoted (≥2 use sites; M4-01 promotion of M2 §10.1 table) */
  --ct-color-fg: var(--vscode-foreground, #cccccc);
  --ct-color-fg-muted: var(--vscode-descriptionForeground, #858585);
  --ct-color-bg-editor: var(--vscode-editor-background, #1e1e1e);
  --ct-color-bg-sidebar: var(--vscode-sideBar-background, var(--ct-color-bg-editor));
  --ct-color-bg-hover: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.07));
  --ct-color-border: var(--vscode-panel-border, #444444);
  --ct-color-focus: var(--vscode-focusBorder, #007fd4);

  /* Semantic state colors (hardcoded — must NOT theme; carry-over from M2 §10.2) */
  --ct-color-state-running: #4caf50;
  --ct-color-state-idle: #ffa726;
  --ct-color-state-finished: #78909c;
  --ct-color-state-error: #ef5350;
}
```

### 1.4 Deprecated direct-hex / direct-`var` appendix (Maya's search-and-replace checklist)

Source: audit of `src/webview/styles/dashboard.css` at HEAD (commit on `origin/main` as of M4-01 authoring). Every line below replaces a literal `var(--vscode-NAME, FALLBACK)` invocation OR a literal hex with the corresponding `--ct-*` token reference.

**Replacement table.** Left column = current pattern; right column = M4-02 replacement. After M4-02, the legitimate `var(--vscode-...)` references remaining inside selector blocks are: **inputValidation error/warning** family, **disabledForeground**, **textBlockQuote-background**, **button-** family, and **editor-font-family** / **font-*** (typography). Everything else flows through `--ct-*`.

| Line(s) | Current (selector-block usage) | Replace with |
|---|---|---|
| 46, 94, 197, 206, 273, 299, 383, 550 | `var(--vscode-foreground, #cccccc)` | `var(--ct-color-fg)` |
| 62, 105, 145, 201, 215, 230, 293, 336, 389, 395, 401, 556 | `var(--vscode-descriptionForeground, #858585)` | `var(--ct-color-fg-muted)` |
| 47 | `var(--vscode-editor-background, #1e1e1e)` | `var(--ct-color-bg-editor)` |
| 76–79 | `var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e))` | `var(--ct-color-bg-sidebar)` |
| 175–178, 282–285, 344–347, 511–514 | `var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.07))` | `var(--ct-color-bg-hover)` |
| 80, 144, 324 | `var(--vscode-panel-border, #444444)` | `var(--ct-color-border)` |
| 179, 286, 348, 482, 515 | `var(--vscode-focusBorder, #007fd4)` | `var(--ct-color-focus)` |
| 234 | `background-color: #4caf50;` | `background-color: var(--ct-color-state-running);` |
| 238 | `background-color: #ffa726;` | `background-color: var(--ct-color-state-idle);` |
| 242 | `background-color: #78909c;` | `background-color: var(--ct-color-state-finished);` |
| 246 | `background-color: #ef5350;` | `background-color: var(--ct-color-state-error);` |
| 81, 166, 272, 326, 417 | `border-radius: 4px;` | `border-radius: var(--ct-radius-tile);` |
| 123, 349, 474, 507, 567 | `border-radius: 2px;` | `border-radius: var(--ct-radius-chip);` |

**Lines that intentionally remain unchanged** (do NOT refactor in M4-02):

- 86, 122 — `var(--vscode-disabledForeground, rgba(204, 204, 204, 0.5))` (one-shot per §1.2.2; dead-session concept colocated).
- 110, 207, 216, 384, 402, 462, 533, 560 — `var(--vscode-editor-font-family, monospace)` (typography, out of M4 scope).
- 421–425, 429–434 — `--vscode-inputValidation-*` family (one-shot per §1.2.2). Stay as `var(--vscode-inputValidation-NAME, FALLBACK)`.
- 471, 472, 481 — `--vscode-button-*` family (one-shot per §1.2.2).
- 562–565 — `var(--vscode-textBlockQuote-background, rgba(255, 255, 255, 0.04))` (one-shot per §1.2.2).
- 43–45, 588 — `var(--vscode-font-family|size|weight)` typography inheritance. Out of scope.

After M4-02, AC2's grep check (`grep -nE "#[0-9a-fA-F]{3,6}|rgb\(" src/webview/styles/dashboard.css`) should match only:
- Lines inside the `:root` block (token declarations themselves).
- Selector blocks holding the one-shot inline vars enumerated above (`disabledForeground`, `inputValidation-*`, `button-*`, `textBlockQuote-background` — their fallback hex literals stay).
- Comment blocks.

### 1.5 Divergences from M2-dashboard-tile-spec

| Divergence | M2 spec said | M4-01 says |
|---|---|---|
| **D1.1** | M2 §10.1 documents theme variables in a markdown table — no `--ct-color-*` indirection layer. CSS consumed `var(--vscode-NAME, fallback)` directly. | M4-01 promotes the M2 §10.1 table to first-class `--ct-color-*` tokens declared at `:root`. CSS consumes `var(--ct-color-*)`. Semantic names beat raw `--vscode-NAME` for readability and one-line theme overrides if ever needed post-V1. |
| **D1.2** | M2 §10.2 listed semantic state hexes as standalone hex constants inside selector blocks (no token name). | M4-01 promotes to `--ct-color-state-*` tokens. Still hardcoded hex values; the indirection is purely naming. |
| **D1.3** | M2 §10.3 declared spacing tokens (kept). M2 did NOT declare radius tokens — `border-radius: 4px` and `border-radius: 2px` were inline literals across 5+ selectors. | M4-01 adds `--ct-radius-tile` (4px) and `--ct-radius-chip` (2px). Consolidation only — no visual change. |
| **D1.4** | M2 had no animation duration token (M2 spec §5.4 explicitly: "No transition/animation — out of scope, M4"). | M4-01 introduces `--ct-duration-state-transition: 200ms`. Used by §2's state-transition keyframes. Reduced-motion override targets one value. |
| **D1.5** | M2 §10.4 typography section: no custom tokens; inherit VS Code's font directly via `var(--vscode-font-*)`. | M4-01 unchanged — typography is NOT promoted to `--ct-*` tokens. Single use site (`body`), inheritance does the work. |

### 1.6 Implementation checklist for Maya (M4-02)

Paste these bullets directly into the M4-02 dispatch brief.

- [ ] Replace the existing `:root` block at `src/webview/styles/dashboard.css:26–33` with the full M4-01 §1.3 declaration (preserves the 6 carry-over tokens; adds 12 color + 4 state-color + 3 radius/duration tokens).
- [ ] Apply every replacement in §1.4's table. Use the line numbers as a starting hint — they may drift if §2/§3 have landed first; grep by the literal pattern in column 2 to confirm.
- [ ] Run `grep -nE "#[0-9a-fA-F]{3,6}|rgb\(" src/webview/styles/dashboard.css` after refactor. Expected hits: only `:root` block + `inputValidation` family + comments. Zero hits inside other selector blocks.
- [ ] Theme-switch probe (per §1.4 + AC3): install vsix, toggle dark↔light, verify tile / chip / error-chip render correctly in both. Cite data-plane smoke per sub-agent GUI gap; defer interactive screenshots to sponsor.
- [ ] Component tests (`tests/unit/webview/*.test.ts`) — no snapshot bumps expected (our tests target structure + attributes, not computed style). Re-run; if a snapshot does bump, justify in PR body.
- [ ] Markup changes: none expected. If a token needs a parent class hook that doesn't exist, scope is single-class minimal AND noted in PR body per M4-02 scope rules.

---

## 2. Status-state visuals + transitions

### 2.1 Goal

Make the four `AgentState` values telegraph their meaning at a glance, and signal state changes without distracting the sponsor. Current M2 implementation: state dot is a static colored circle (`#4caf50` / `#ffa726` / `#78909c` / `#ef5350`); the tile itself has no per-state treatment beyond the dot. M4-01 extends in three directions:

1. **Steady-state visual** per state — what the dot + tile look like when state is stable.
2. **State-transition visual** — what happens visually when a tile's state changes from X to Y.
3. **Accessibility** — aria-label updates, reduced-motion, color-blind contrast.

Constraint: CSS keyframes only (no JS animation libraries). Constraint: subtle. The sponsor watches this dashboard all day; jarring animations are worse than no animation.

### 2.2 Per-state steady visual

| State | State dot | Tile body | Notes |
|---|---|---|---|
| `running` | `--ct-color-state-running` (`#4caf50`), `pulse` animation (see §2.4) — subtle 1.8s breathing cycle on the dot only | Default tile background (transparent), full-opacity text | Pulse runs continuously while state stays `running`. Stops on transition out. |
| `idle` | `--ct-color-state-idle` (`#ffa726`), static | Tile text drops to `opacity: 0.78` — a noticeable but not-dead desaturation. Dot stays full opacity. | The opacity drop is on the tile's inner rows (`.tile-row--role`, `.tile-row--activity`, `.tile-row--model`), NOT the primary row — keeps display name + dot legible. |
| `finished` | `--ct-color-state-finished` (`#78909c`), static. **Inner check overlay** — a CSS-drawn `✓` mark centered inside the dot, using `--ct-color-bg-editor` as the stroke color (so it reads as a notch knocked out of the dot). | Default tile body. Activity field's freshness suffix (`Xs / Xm / Xh`) already provides text-side staleness signal (M3-04 NIT #3). | The completion mark is the M4-01 addition to AC3. Drawn as `::after` pseudo-element on `.state-dot[data-state="finished"]` — no extra DOM, no SVG. |
| `error` | `--ct-color-state-error` (`#ef5350`), static. **No pulse on error** — pulsing red reads as "still happening"; error is a terminal state in V1, so static red + the error chip body carries the alert. | Tile text full opacity (don't fade — the sponsor must read the error reason). Optional 1px border in state color on the tile body (`outline: 1px solid var(--ct-color-state-error)` on hover only — see §2.3 transition treatment for the one-shot flash). | Error chip (M2 §8) remains the primary alert surface; the per-tile state dot is the inline signal. |

**Why pulse only on `running`:** pulse is reserved for "this is alive right now." Idle is "alive but quiet" — fade tells that story without motion. Finished is terminal — adding the inner check is a stronger signal than animation. Error is terminal AND urgent — static red + the error chip surface is louder than a pulse.

**Why fade `idle` but not the primary row:** the display name + dot must stay legible at all times so the sponsor can identify which tile is which when scanning the dashboard. Fading role/activity/model rows preserves identification while signaling "this isn't doing anything right now."

### 2.3 State-transition matrix

Rows = from-state, columns = to-state. Cells = visual treatment applied for the duration of the transition (`var(--ct-duration-state-transition)` — 200ms default).

|              | → running | → idle | → finished | → error |
|---|---|---|---|---|
| **running →** | (self — n/a) | Pulse stops; opacity drop on rows 2–4 eases in. No flash. | Pulse stops; dot's inner check fades in. No flash. | **One-shot flash** — dot fills with `--ct-color-state-error` and tile body gets a 1px error-color outline that fades over 400ms. Pulse stops immediately. |
| **idle →** | Pulse starts; row opacity eases back to 1. No flash. | (self — n/a) | Row opacity restores; inner check fades in. No flash. | **One-shot flash** (same as running→error). |
| **finished →** | Inner check fades out; pulse starts. No flash. | Inner check fades out; row opacity drops. No flash. | (self — n/a; finished is terminal in V1's lifecycle) | Inner check fades out; **one-shot flash** (error treatment). |
| **error →** | Tile outline fades out over 200ms; pulse starts. (Recovery — uncommon but possible if a re-run succeeds.) | Tile outline fades out; row opacity drops. | Tile outline fades out; inner check fades in. | (self — n/a) |

**Twelve non-diagonal cells covered.** Theme:
- **No flash on graceful transitions** (running↔idle, anything→finished, finished↔active). The dot color change + the steady-state visual update is enough — the sponsor's eye catches the color shift.
- **One-shot flash on `→ error` only.** Error is the one transition that demands attention. Flash = dot fills + tile outline appears + both fade over 400ms. The flash is louder than the steady-state error treatment so the sponsor notices the *change* (not just the static red).
- **Recovery from error** (`error → *`) uses outline-fade-out as a "noted, moving on" signal. No flash on the way out — the alert was the entry, not the exit.

**Animation primitives.** Two CSS keyframes total — keep the system small.

```css
@keyframes ct-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}

@keyframes ct-error-flash {
  0%   { outline-color: var(--ct-color-state-error); outline-width: 1px; }
  100% { outline-color: transparent; outline-width: 1px; }
}
```

- `ct-pulse` runs `1.8s ease-in-out infinite` on `.state-dot[data-state="running"]`. Slow enough to feel like breathing, not blinking.
- `ct-error-flash` runs `400ms ease-out` once on `.agent-tile[data-transition="to-error"]` (class added by the renderer for the duration, then removed).

Opacity changes on rows 2–4 (idle treatment) and inner check fade are CSS `transition` properties keyed to `opacity` with `--ct-duration-state-transition` — no keyframes needed.

### 2.4 Inner check mark for `finished` state

Drawn purely with CSS — no SVG, no Unicode glyph (Unicode `✓` rendering varies across system fonts in the webview). The state dot's `::after` pseudo-element creates two perpendicular borders rotated to form a check.

```css
.state-dot[data-state="finished"] {
  position: relative;
}

.state-dot[data-state="finished"]::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 1px;
  width: 3px;
  height: 6px;
  border-right: 1.5px solid var(--ct-color-bg-editor);
  border-bottom: 1.5px solid var(--ct-color-bg-editor);
  transform: rotate(45deg);
  opacity: 1;
  transition: opacity var(--ct-duration-state-transition) ease-out;
}
```

`opacity: 0` on the `::after` when transitioning OUT of `finished` (handled by tile-renderer adding a `data-transition` attribute during the transition window). The 1.5px border thickness reads as a clean tick at 10px dot size; tested mentally against `--ct-state-dot-size`.

Fallback: if any future state-color change makes the check invisible against the dot fill (contrast inversion), the check stroke color `--ct-color-bg-editor` keeps it readable because it inherits from the panel background — always contrasts against the dot.

### 2.5 State-transition detection (Maya implementation contract)

The webview render path (`src/webview/main.ts` + `src/webview/render.ts`) already diffs tiles on each `state:full` arrival. M4-05's `agentTile.ts` extension:

1. **Track previous state per tile** at the render-call boundary. The renderer receives `tile: AgentTile`; the parent caller passes a `prevState: AgentState | undefined` prop (or maintains a tile-state map keyed by `${sessionId}:${agentId}`).
2. **On render**, compare `prevState` to `tile.state`. If different and `prevState` was defined:
   - Add a `data-transition` attribute to the `<article>` element with one of `to-running` / `to-idle` / `to-finished` / `to-error`.
   - Schedule a `setTimeout(() => article.dataset.transition = "", 400)` to clear the transition class after the longest animation completes (400ms covers the error flash; pulse is continuous, not transition-driven).
3. **If `prevState` is undefined** (first render of this tile after webview boot or a `state:full` resync), do NOT set `data-transition` — first appearance is not a transition.
4. **Pulse animation** on `running` is purely CSS — no JS coordination needed. The `[data-state="running"]` selector matches whether the tile just entered running or has been running for hours; pulse runs uniformly.

Implementation cost: one map (`Map<TileKey, AgentState>` at module scope or as a render-state field) + a 3-line `setTimeout` per transition. No memory leak risk — tile keys live as long as the tile renders; removed tiles are GC'd with their key.

### 2.6 Accessibility

**Aria-label updates.** M2 already sets `aria-label="{display} — {role} — {state-label}"` on each `<article>` (line 96–98 of current `agentTile.ts`). M4-05 retains this; the label naturally updates when state changes because the tile re-renders with the new state.

**Reduced-motion.** `@media (prefers-reduced-motion: reduce)` block at the end of `dashboard.css`:

```css
@media (prefers-reduced-motion: reduce) {
  .state-dot[data-state="running"] {
    animation: none;
  }
  .agent-tile[data-transition] {
    animation: none;
  }
  .state-dot[data-state="finished"]::after,
  .tile-row--role,
  .tile-row--activity,
  .tile-row--model {
    transition: none;
  }
}
```

Color changes still happen instantly. The pulse, flash, opacity fade, and inner-check fade are elided — the sponsor still sees state, just no motion. AC4 requirement.

**Color-blind contrast.** The four state colors (green / amber / grey / red) have a known weakness: deuteranopia (most common red-green color blindness) can conflate `#4caf50` running and `#ef5350` error. Mitigations already in place:

- **Shape difference** — `finished` has the inner check mark (only finished has a glyph on the dot).
- **Position difference** — error chip surfaces error separately from the tile dot. Errors do not present as just-a-different-dot-color.
- **Text difference** — aria-label includes the state word; tile activity field for error is `error: <reason>` (literally has "error" in the text).
- **One-shot flash on → error** — the flash is a motion signal, not a color signal, so it survives color-blindness.

M4-01 does not add a fifth visual channel (e.g., dashed border for error) — three mitigations are enough for V1. If post-V1 dogfooding surfaces a real color-blind miss, add a per-state border-style as a follow-up.

### 2.7 Background-chip state visuals (carry-forward only)

Per M2 §7 + M3-04, the background chip shows per-row state as a **literal lowercase word** (`running` / `idle` / `finished`) — no dot, no animation. M4-01 leaves this unchanged. Rationale: background rows are intentionally de-emphasized; adding pulse/fade/check to background rows would defeat the noise-collapse purpose. The full visual treatment (§2.2 + §2.3) applies to **rostered agent tiles only**.

The text color of `.bg-agent-state` (currently `--vscode-descriptionForeground` / `--ct-color-fg-muted` per §1.4) does NOT change per-state-value either. Background-row state is informational text, not a visual signal.

### 2.8 Error chip (carry-forward + minor extension)

The error chip (M2 §8) is independent of per-tile state — it renders for **roster-load errors** and **file-watcher errors**, not for individual tile errors. M4-01 makes one minor adjustment:

- The chip's left-edge icon (the `!` in `.error-chip-icon`) stays unchanged.
- **NEW:** the error chip body's `role="alert" aria-live="polite"` already announces appearance to assistive tech (M2 §8.3). M4-01 confirms this stays — no change to ARIA semantics.

No new error chip variants in M4. The existing `error-chip--error` + `error-chip--warning` cover V1.

### 2.9 Divergences from M2-dashboard-tile-spec

| Divergence | M2 spec said | M4-01 says |
|---|---|---|
| **D2.1** | M2 §5.4 explicitly: "No transition/animation (out of scope, M4)." | M4-01 introduces `ct-pulse` (running) and `ct-error-flash` (→error) keyframes plus `opacity transition` on idle/finished. Subtle by design. |
| **D2.2** | M2 §5.3 finished state: grey dot only, no glyph. | M4-01 adds inner check mark via `::after` on `.state-dot[data-state="finished"]`. Pure CSS; no SVG / Unicode. |
| **D2.3** | M2 §5.3 idle state: amber dot, full-opacity tile body. | M4-01 fades tile rows 2–4 to `opacity: 0.78` while keeping row 1 (dot + display) at full opacity. |
| **D2.4** | M2 had no state-transition behavior. | M4-01 §2.3 transition matrix (12 cells). One-shot flash on `→ error` only; graceful transitions are color-change + steady-state-visual update without flash. |
| **D2.5** | M2 §5.3 erratically referenced "no class toggling — `data-state` selectors handle everything." | M4-01 introduces ONE new attribute: `data-transition` on `<article class="agent-tile">` for the duration of a state change (set on render, cleared via setTimeout). Still attribute-driven; no class toggling. |

### 2.10 Implementation checklist for Maya (M4-05)

- [ ] In `src/webview/styles/dashboard.css`, add `@keyframes ct-pulse` and `@keyframes ct-error-flash` blocks (per §2.3).
- [ ] Update `.state-dot[data-state="running"]` to add `animation: ct-pulse 1.8s ease-in-out infinite`.
- [ ] Update `.state-dot[data-state="finished"]` per §2.4 (position + `::after` pseudo-element drawing the check mark).
- [ ] Add rules: `.agent-tile[data-state="idle"] .tile-row--role`, `.tile-row--activity`, `.tile-row--model` → `opacity: 0.78; transition: opacity var(--ct-duration-state-transition) ease-out`.
- [ ] Add `.agent-tile[data-transition="to-error"]` → `animation: ct-error-flash 400ms ease-out`.
- [ ] Add `@media (prefers-reduced-motion: reduce)` block per §2.6 — elide all animations + transitions but preserve color/opacity end-states.
- [ ] In `src/webview/components/agentTile.ts`, add `prevState?: AgentState` prop to `AgentTileProps`. On render, if `prevState !== undefined && prevState !== tile.state`, set `article.dataset.transition = "to-" + tile.state` and schedule `setTimeout(() => article.dataset.transition = "", 400)`.
- [ ] In `src/webview/render.ts` (or wherever `renderAgentTile` is called from), maintain a `Map<TileKey, AgentState>` of last-rendered states keyed by `${sessionId}:${agentId}`. Pass `prevState` from the map; update after render.
- [ ] Component tests in `tests/unit/webview/agentTile.test.ts`:
  - Each state renders with the expected `data-state` attribute and the correct background-color computed style (or, if computed-style is not available in jsdom, assert the CSS rule presence via the rendered class).
  - `aria-label` reflects current state.
  - Rendering with `prevState=running, tile.state=error` sets `data-transition="to-error"`; rendering with `prevState=undefined` does NOT set `data-transition`.
- [ ] Reduced-motion test (jsdom doesn't honor `matchMedia('(prefers-reduced-motion: reduce)')` natively — assert via fake `window.matchMedia` mock that the production code branches correctly OR cite the manual probe in the Self-Test Report).
- [ ] Theme-switch probe + state walk-through: install vsix, observe a tile in each state in dark and light themes. AC(a) data-plane smoke; AC(b–d) deferred to sponsor.
- [ ] Pulse subtlety probe (Sponsor post-merge): watch the dashboard with several running agents for 30s — pulse should feel like breathing, not blinking. If it reads as distracting, file a follow-up to bump duration from 1.8s to 2.4s (token-driven; one-line change).

---

## 3. Drill-in affordance model

### 3.1 Goal

Make the dashboard's primary interaction — click a tile → open the agent's JSONL — feel like an *obvious* affordance. Today (M2-06): the path works (`ui:open-transcript` → `handleOpenTranscript` → `showTextDocument`); the visible cues are minimal (default cursor, no tooltip, no explicit click target indication beyond the hover background change at M2-05). M4-03 closes the affordance gap without changing the interaction surface.

Constraint: V1 plan defers in-webview transcript rendering. Drill-in opens VS Code's native JSONL viewer. M4-03 polishes the affordance; it does NOT change the destination.

### 3.2 Cursor + click target zone

**Cursor.** `cursor: pointer` on:
- `.agent-tile` (the whole tile — already set in M2; carries forward).
- `.collapsed-persona-header` (the persona-group header — already set in M2).
- `.chip-header` (the background-chip toggle — already set in M2).
- `.error-chip-action` (the "Open Roster File" button — already set in M2).
- `.error-chip-dismiss` (the warning × button — already set in M2).
- `.roster-error-chip-body` (M3-04 click-to-expand — already set).

**Default cursor (no `pointer`)** on:
- Session header (`.session-header`) — not clickable in V1.
- Team header (`.team-header`) — not clickable in V1.
- Background row body (`.bg-agent-row`) — not clickable in V1 (no per-row drill-in; the chip header toggles the list).
- Error chip body, error chip detail text — not clickable (only the explicit action buttons are).

This matches the M2 baseline; M4-01 confirms no changes are needed. Felix verifies during M4-03.

**Click target zone — whole tile.** The `<article class="agent-tile">` element is the click target. Clicking anywhere inside the tile (dot, name, role text, activity text, model text) triggers `ui:open-transcript`. This is the M2 implementation (`agentTile.ts` attaches `addEventListener("click", fire)` on the article); M4-01 retains it. Verification: Felix manually clicks each region of a tile in the M4-03 probe and confirms all regions fire.

### 3.3 Tooltip

**Tooltip text.** Set `title="Open agent transcript"` on the `<article class="agent-tile">` element. Wording rationale:

- "Open" tells the user the click does something — they don't have to guess.
- "agent transcript" names the destination concretely. The user knows what they'll see (the JSONL file in VS Code's editor).
- Length is intentionally short — the OS tooltip delay (~500–1000ms) means long tooltips feel laggy.

**Considered and rejected wordings:**
- "Click to open JSONL" — leaks implementation. The user doesn't need to know it's JSONL.
- "View activity log" — vague; the activity field is already on the tile, so "activity log" implies "the same data again."
- "Open in editor" — too generic; doesn't say what opens.

**No tooltip on background-row bodies** (not clickable in V1).
**No tooltip on chip header / collapsed-persona header** beyond the existing aria-label — those have their own affordance (chevron + count) and a tooltip would clutter.

### 3.4 Hover + focus visuals

**Hover state** (mouse) — already implemented in M2 §5.4:
- Background: `var(--ct-color-bg-hover)` (M4-02 token; falls back to `var(--vscode-list-hoverBackground)` if M4-02 hasn't landed).
- Outline: `1px solid var(--ct-color-focus)`.
- No transition (instant — fits the snappy-affordance feel).

**Focus-visible state** (keyboard tab) — already implemented; same treatment as hover. Browsers + VS Code's webview honor `:focus-visible` correctly to suppress the outline on click-induced focus (sponsor doesn't want a permanent outline after clicking).

**M4-03 verification:** Felix confirms the M2 hover + focus-visible visuals still work post-M3 (no regressions from later tile changes). Sage's QA cites the data-plane smoke + the manual Tab-and-Enter probe.

### 3.5 Keyboard activation

- `tabindex="0"` on `<article class="agent-tile">` — already set in M2 (`agentTile.ts` line 94).
- `role="button"` on the same element — already set (line 93).
- `keydown` listener for `Enter` and `Space` — already set (lines 144–149). Fires the same `ui:open-transcript` message.

**M4-03 additions** (already aligned with M2 baseline; M4-03 verifies):
- Tab order is DOM source order: session → team → tiles (within team, in render order) → chip header → next session. No custom focus management; the natural document order is correct.
- Focused tile's outline is visible against both light and dark VS Code themes (relies on `--ct-color-focus` → `--vscode-focusBorder`, which themes correctly).
- After clicking a tile, focus moves to the opened editor (handled by `showTextDocument` — VS Code default behavior). On return to the webview (Ctrl+Shift+P → "Focus on ClaudeTeam" or Activity Bar click), the tile that was clicked is NOT re-focused — focus restarts at the first tile. Acceptable V1 behavior; do NOT add focus-restoration in M4-03 (out of scope).

### 3.6 `showTextDocument` preview-flag decision

Per M4-03 scope #6 (sponsor flagged as "Implementation-time judgment call"): should `showTextDocument(uri)` use `{ preview: true }` (which replaces the preview tab on next open) or stay with the current behavior (regular editor tab, accumulates)?

**M4-01 recommendation: `{ preview: true }`.** Rationale:

- The drill-in interaction is *exploratory* — the sponsor clicks a tile to see what an agent is doing, scans the JSONL, often clicks another tile next.
- Without `preview: true`, every click opens a new tab; after browsing 10 agents the editor area is choked with JSONL tabs the sponsor has to manually close.
- `preview: true` matches VS Code's native Explorer behavior (single-click in Explorer opens preview; double-click promotes to a regular tab). Sponsors who know VS Code expect this affordance.
- The preview tab is promotable (sponsor edits or double-clicks the title → it becomes a regular tab and the next drill-in opens a new preview). Zero loss of capability.

**Felix's M4-03 implementation:** change `vscode.window.showTextDocument(uri)` to `vscode.window.showTextDocument(uri, { preview: true })` in `src/extension/main.ts` (line 303 per M4 backlog). Document the decision in the PR body.

**Reversibility:** if sponsor dogfooding shows preview-mode is annoying (e.g., losing position when switching between two agents repeatedly), the change is a one-line revert. M4-04 retro can capture the verdict.

### 3.7 Background-chip click-through behavior

Per M2 §7.3 the background chip header toggles the detail list (`hidden` attribute add/remove + chevron flip + `aria-expanded` flip). M4-01 confirms this stays unchanged. Specifically:

- Chip header click = toggle expand/collapse (no host roundtrip; webview-local).
- Background row click = nothing (V1: no per-row drill-in; `BackgroundAgent` has no `agentId` for drill-in to use, per M2 §11.3).
- Chevron `▶` / `▼` is decorative-only (already `aria-hidden="true"`).
- Detail list shows up to N rows; no scrolling treatment in V1 (the sponsor expects to see all background rows when expanded; if the count grows large, the natural sidebar scroll handles overflow).

**Implementation in M4-03 for the background chip:** no changes. M4-03 explicitly excludes background chip per M4-03 OOS rule ("Background chip click affordance — out of scope"). M4-01 confirms M2's behavior is the V1 final.

### 3.8 Divergences from M2-dashboard-tile-spec

| Divergence | M2 spec said | M4-01 says |
|---|---|---|
| **D3.1** | M2 §5 tile DOM included `tabindex`, `role="button"`, click handlers. No tooltip attribute. | M4-01 adds `title="Open agent transcript"` to the tile article. Wording locked here. |
| **D3.2** | M2's interaction contract §9: `vscode.window.showTextDocument()` on the JSONL — preview-flag unspecified. | M4-01 §3.6 recommends `{ preview: true }`. Felix implements in M4-03 + documents in PR body. |
| **D3.3** | M2 §6 had a team-card refresh button (`.team-refresh`). M3 changes may have moved or removed it. | M4-01 does NOT address the team-refresh button. If it survives M3, M4-03 leaves it alone (it has its own `aria-label="Refresh team data"` and `title="Refresh"` — already adequate affordance). If it's been removed, M4-01 does not re-introduce it. |
| **D3.4** | M2 §5.4 hover/focus: `var(--vscode-list-hoverBackground)` + `1px solid var(--vscode-focusBorder)`. | M4-01 unchanged; consumes via `--ct-color-bg-hover` and `--ct-color-focus` post-M4-02. Visual identical. |
| **D3.5** | M2 §12.4 listed "drill-in opens JSONL in VS Code editor" as a manual-probe AC. | M4-01 §3.6 promotes the implementation detail (preview-flag) to spec-level; the manual probe remains the verification mechanism. |

### 3.9 Implementation checklist for Maya + Felix (M4-03)

**Webview (Maya touches `src/webview/components/agentTile.ts`):**

- [ ] Add `article.setAttribute("title", "Open agent transcript");` after the existing attribute setters in `renderAgentTile` (between lines 95 and 99 of current `agentTile.ts`).
- [ ] Verify (no code change expected) that `tabindex="0"`, `role="button"`, `cursor: pointer` (from CSS), and the click + keydown handlers all remain in place post-M3. These are M2 carry-over; M4-03 is a verification gate, not a re-implementation.
- [ ] Component test extension in `tests/unit/webview/agentTile.test.ts`:
  - Assert rendered article has `title="Open agent transcript"` attribute.
  - Assert click on the article fires `ui:open-transcript` with correct payload (carry-over from M2 tests; verify still green).
  - Assert keydown `Enter` and `Space` fire the same payload (carry-over; verify still green).

**Host (Felix touches `src/extension/main.ts`):**

- [ ] Change `vscode.window.showTextDocument(uri)` to `vscode.window.showTextDocument(uri, { preview: true })` at the M2-06 handler line (per M4 backlog, line 303).
- [ ] Defensive behavior preserved: unknown sessionId / missing file / showTextDocument failure → error message, no throw (existing M2-06 behavior; verify untouched).
- [ ] PR body documents the preview-flag decision (cite M4-01 §3.6).

**Manual probe (Felix's Self-Test Report):**

- [ ] Install the new vsix.
- [ ] Click a rostered tile → JSONL opens in a **preview** tab (italicized tab title in VS Code).
- [ ] Click a second rostered tile → the first preview tab is **replaced** (not accumulated).
- [ ] Double-click a tile (or modify the file in the preview tab) → preview promotes to regular tab; next drill-in opens a new preview.
- [ ] Tab to focus a tile → outline visible.
- [ ] Press Enter on focused tile → JSONL opens.
- [ ] Press Space on focused tile → JSONL opens.
- [ ] Hover a tile → "Open agent transcript" tooltip appears after OS-standard delay.
- [ ] Click various regions of a tile (dot, display, role, activity, model) → each fires drill-in.
- [ ] Self-Test Report cites all of the above with one screenshot + the opened file path. AC(b–d) deferred to sponsor per sub-agent GUI gap.

---

## 4. Combined "Implementation checklist for Maya / Felix" — copy-paste blocks

For dispatch-brief efficiency, the per-section checklists from §1.6, §2.10, §3.9 are re-collated below as paste-ready code-fenced blocks the orchestrator can lift directly into M4-02 / M4-03 / M4-05 briefs.

### 4.1 M4-02 paste block

```
Implementation checklist (M4-01 §1.6):
- Replace :root at dashboard.css:26–33 with full M4-01 §1.3 block (6 carry-over + 12 color + 4 state-color + 3 radius/duration tokens).
- Apply every replacement in M4-01 §1.4 table. Grep by literal pattern (line numbers may drift).
- Post-refactor: grep -nE "#[0-9a-fA-F]{3,6}|rgb\(" dashboard.css → hits only inside :root + inputValidation family + comments.
- Theme-switch probe: install vsix, toggle dark↔light, render correct. Cite data-plane smoke.
- No snapshot bumps expected; justify in PR body if any.
- No markup changes expected; minimal-class-add-only if necessary, noted in PR body.
```

### 4.2 M4-05 paste block

```
Implementation checklist (M4-01 §2.10):
- Add @keyframes ct-pulse + ct-error-flash to dashboard.css.
- .state-dot[data-state="running"]: animation: ct-pulse 1.8s ease-in-out infinite.
- .state-dot[data-state="finished"]: position relative + ::after check per §2.4.
- .agent-tile[data-state="idle"] .tile-row--{role,activity,model}: opacity 0.78 + transition.
- .agent-tile[data-transition="to-error"]: animation: ct-error-flash 400ms ease-out.
- @media (prefers-reduced-motion: reduce): elide animation/transition per §2.6.
- agentTile.ts: add prevState prop; on render, set data-transition + setTimeout 400ms clear.
- render.ts: Map<TileKey, AgentState> tracking; pass prevState; update post-render.
- Tests: each state's data-state + aria-label; transition data-transition set when prevState differs and not set when prevState undefined; reduced-motion via matchMedia mock or manual probe.
- Pulse subtlety probe (sponsor post-merge): if distracting, follow-up to bump 1.8s → 2.4s (token-driven).
```

### 4.3 M4-03 paste block

```
Implementation checklist (M4-01 §3.9):

Webview (Maya):
- agentTile.ts renderAgentTile: add article.setAttribute("title", "Open agent transcript").
- Verify M2 carry-over: tabindex=0, role=button, cursor:pointer (CSS), click + keydown handlers — all should still be in place post-M3.
- Tests: assert title attribute; verify click + Enter + Space still fire ui:open-transcript.

Host (Felix):
- src/extension/main.ts handleOpenTranscript: change showTextDocument(uri) → showTextDocument(uri, { preview: true }).
- Preserve existing defensive behavior (unknown id / missing file / failure → error message no throw).
- PR body documents preview-flag decision, cite M4-01 §3.6.

Manual probe (Felix Self-Test Report):
- Install vsix. Click rostered tile → preview tab opens. Click another → first replaced.
- Double-click → promote to regular. Tab → outline visible. Enter → opens. Space → opens.
- Hover → "Open agent transcript" tooltip after OS delay.
- Click each tile region (dot/display/role/activity/model) → all fire.
- Cite data-plane smoke; defer interactive screenshots per sub-agent GUI gap.
```

---

## 5. Cross-section coordination notes

### 5.1 If M4-05 lands before M4-02 (token refactor)

M4-05's keyframes + new CSS rules will use **literal hex** for state colors (`#4caf50` etc.) since the `--ct-color-state-*` tokens don't exist yet. M4-02's refactor then absorbs those literal hex into the token system per §1.4's appendix. M4-02's deprecated-hexes appendix is correct for both orderings — the row count is identical, the literal values are the same. M4-05 PR body should explicitly note "uses literal hex; M4-02 token refactor will absorb."

### 5.2 If M4-03 lands before M4-05 (markup overlap on `agentTile.ts`)

M4-03 only adds one attribute (`title`). M4-05 adds one prop (`prevState`) and one attribute (`data-transition`). The two changes are independent — neither touches the other's lines. Whichever lands first sets the baseline; the second rebases trivially. PR-body cross-reference per M4-05 conflict-rule section.

### 5.3 If M4-02 lands before §2 / §3

M4-05 and M4-03 consume `--ct-*` tokens directly (cleaner). No special handling.

### 5.4 Vocabulary contract (per parallel-agent global rule)

M4-01 introduces three **new identifier names** that downstream tickets must use verbatim:

| Identifier | Type | Owner of declaration | Consumers |
|---|---|---|---|
| `--ct-radius-tile` | CSS custom property | M4-02 declares; §1.3 spec | All radius-4px sites (M4-02 refactor) |
| `--ct-radius-chip` | CSS custom property | M4-02 declares; §1.3 spec | All radius-2px sites (M4-02 refactor) |
| `--ct-duration-state-transition` | CSS custom property | M4-02 declares; §1.3 spec | M4-05 keyframes + transitions |
| `--ct-color-state-{running,idle,finished,error}` | CSS custom property | M4-02 declares; §1.3 spec | M4-05 state visuals, M4-02 refactor of state dot |
| `data-transition` | HTML data attribute on `.agent-tile` | M4-05 declares; §2.5 spec. Values: `to-running` / `to-idle` / `to-finished` / `to-error` / empty string | M4-05 internal only (CSS selector + setTimeout clear) |
| `ct-pulse`, `ct-error-flash` | CSS keyframe names | M4-05 declares; §2.3 spec | M4-05 internal only |
| `prevState` | TypeScript prop name on `AgentTileProps` | M4-05 declares | M4-05 internal (render.ts → agentTile.ts) |
| Tile tooltip text: `"Open agent transcript"` | string literal | M4-03 declares | M4-03 (matches M4-01 §3.3 wording) |

Maya owns most of these (all three impl tickets are Maya); Felix's M4-03 sees only the tooltip string + the preview-flag change. No cross-agent vocabulary risk in M4 because the implementer of every shared concept is Maya.

---

## 6. Audit trail

- **V1-PLAN line 113** — M4 Live polish: Styling, drill-in, status states, refresh-cadence tuning.
- **V1-PLAN "Identity & display rules"** — `state` definition (running / idle / finished / error).
- **M2-dashboard-tile-spec.md §5, §7, §8, §9, §10** — visual baseline this spec extends.
- **M1-cli-output-spec.md §2** — state vocabulary baseline (carry-over).
- **src/webview/styles/dashboard.css** (current `main`) — implementation snapshot audited for §1.4 deprecated-hexes appendix.
- **src/webview/components/agentTile.ts** — current implementation reviewed for §2 + §3 implementation contract.
- **src/shared/types.ts:241** — `AgentState` type definition (`"running" | "idle" | "finished" | "error"`).
- **CLAUDE.md hard rule** — semantic state colors stay hardcoded across theme switches.

---

*Spec authored M4-01. Implements three independent sections (tokens / state visuals / drill-in affordance) per M4 backlog. Maya implements §1 in M4-02, §3 in M4-03 (with Felix on host), §2 in M4-05. M4-06 retro evaluates outcome.*
