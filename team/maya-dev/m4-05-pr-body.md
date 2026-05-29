## What this PR changes

Implements **M4-01 §2 status-state visuals + transition matrix** on the agent tile per Iris's M4-polish spec. Each rostered tile now telegraphs its state at a glance and signals state changes without distracting the sponsor.

| State | Steady visual | Transition into |
|---|---|---|
| `running` | Green dot + 1.8s pulse (breathing) | Pulse starts; no flash on graceful entry |
| `idle` | Amber dot; rows 2–4 fade to `opacity: 0.78` (role / activity / model) | Opacity eases in over `--ct-duration-state-transition` |
| `finished` | Grey-blue dot + CSS-drawn inner check mark | Check fades in (200ms) |
| `error` | Red dot; static | **One-shot `ct-error-flash`** — tile outline appears + fades over 400ms |

Twelve non-diagonal transitions covered per M4-01 §2.3: graceful transitions (running↔idle, any→finished, any→running, finished→idle, error→{any}) rely on the color/opacity shift alone; only `→ error` gets a flash because error is the one transition that demands attention.

## Vocabulary contract (matches M4-01 §5.4)

- `data-transition` HTML attribute on `.agent-tile` — values `to-running` / `to-idle` / `to-finished` / `to-error` / empty.
- `ct-pulse`, `ct-error-flash` CSS keyframe names.
- `--ct-color-state-*` + `--ct-duration-state-transition` CSS custom properties (consumed from M4-02; M4-02 already on `main` via PR #56).
- `prevState?: AgentState` prop on `AgentTileProps`.
- `PrevStateTracker` interface + `createPrevStateTracker()` factory (new file `src/webview/prevStateTracker.ts`, mirroring the `FinishedTracker` shape).

## Architecture

Tile-state-change detection follows the existing `finishedTracker` pattern:

- Single `prevStateTracker` instance created at webview boot in `main.ts`.
- Threaded `RenderContext` → `SessionBlockProps` → `TeamCardProps` → `AgentTileProps` (and `CollapsedPersonaTileProps` so wrapper expansions also detect transitions).
- `teamCard.ts` reads `tracker.previous(sessionId, agentId)` BEFORE rendering and `tracker.record(...)` AFTER appending — so first render returns `undefined` (correct: first appearance is not a transition) and the next tick sees the prior state.
- Pruned in the same render-pass walk as `finishedTracker` — one tree traversal computes both prune sets.
- Renderer applies `article.dataset.transition = "to-<state>"` synchronously; injectable `scheduleClearTransition` (defaults to `setTimeout`) clears at 400ms (envelope sized for the longest M4-01 animation — the error flash).
- Defensive clear: clear-callback guards on the SAME target value so a rapid second transition that overwrote the attribute isn't clobbered.

## CSS additions (dashboard.css)

- `.state-dot[data-state="running"]` → `animation: ct-pulse 1.8s ease-in-out infinite`
- `.state-dot[data-state="finished"]` → `position: relative` + `::after` pseudo-element drawing the check (rotated borders, no SVG / Unicode glyph; stroke uses `--ct-color-bg-editor` so it contrasts against the dot fill in any theme)
- `.agent-tile[data-state="idle"] .tile-row--{role,activity,model}` → `opacity: 0.78`
- `.tile-row--{role,activity,model}` → `transition: opacity var(--ct-duration-state-transition) ease-out`
- `.agent-tile[data-transition="to-error"]` → `animation: ct-error-flash 400ms ease-out`
- Two `@keyframes` (`ct-pulse`, `ct-error-flash`)
- `@media (prefers-reduced-motion: reduce)` block — elides animation + transition motion; color/opacity END STATES still apply

## Acceptance criteria

- **AC1** (per-state visual cited to M4-01 token) — ✅ each state's CSS rule references the matching `--ct-color-state-*` token; pulse on running, opacity drop on idle rows, ::after on finished, flash class on `to-error` transition.
- **AC2** (state-transition animations per matrix, CSS keyframes only) — ✅ two `@keyframes` (`ct-pulse`, `ct-error-flash`); no JS animation libraries; transition attribute applied at the renderer's prev/next boundary, cleared via `setTimeout` at 400ms.
- **AC3** (`prefers-reduced-motion: reduce` elides motion; color change still applies) — ✅ media block in dashboard.css sets `animation: none` on the pulse + flash selectors and `transition: none` on the opacity/check fade selectors. Color end-states reached instantly.
- **AC4** (aria-label updates per state) — ✅ existing M2 implementation (`{display} — {role} — {STATE_LABEL}`) updates naturally on re-render; new tests pin the per-state label text for all four states.
- **AC5** (component tests cover each state's dot + reduced-motion + aria-label) — ✅ +4 aria-label cases, +1 JS-side reduced-motion invariant test (existing per-state coverage retained).
- **AC6** (state-transition test — render with state X then re-render with state Y, assert transition class) — ✅ 5 transition-flow tests at `renderFull` level (first render skip, change triggers, same-state no-fire, prune on disappearance, back-compat without tracker) + 7 unit-level on `renderAgentTile` (per-transition target verification, scheduled clear path, fresh-overwrite-protection).
- **AC7** (theme-switch probe — dark + light) — ✅ data-plane smoke below; AC(b–d) deferred to sponsor per sub-agent GUI gap.
- **AC8** (`npm run typecheck && npm run test:unit` green) — ✅ both green; lint also green.

## Self-Test Report

### AC walkthrough (data-plane smoke per sub-agent GUI gap)

**AC(a) — live `runTick` data plane.** Ran `npm run agent-tree` against live `~/.claude/` data. Observed three live sessions; the ClaudeTeam session (pid=40888) materialised the `claudeteam-alpha` team with Felix + Maya tiles, each in `finished` state. The rendered output flows through the same `AgentTree` → presenter pipeline the webview consumes, confirming state literals (`finished` / `running` / `idle` / `error`) reach the renderer unbroken. Pulse / fade / check / flash visuals are dashboard.css selectors keyed on `[data-state]` and `[data-transition]` — both attributes set by `renderAgentTile` (already exercised in component tests + the live CLI smoke shows the underlying state values).

**AC(b–d) — interactive screenshots (theme switch, reduced-motion, state walk-through):** deferred to sponsor per `.claude/docs/testing-strategy.md` § "Sub-agent GUI gap — webview-smoke workaround". The data-plane smoke + 378 unit tests cover the load-bearing failure mode; visual confirmation is sponsor-side post-merge.

### Side-effect inventory

- `src/webview/components/agentTile.ts` — added `prevState` + `scheduleClearTransition` props; sets `data-transition` attribute on changed-state render.
- `src/webview/styles/dashboard.css` — new keyframes, per-state rules, reduced-motion block. Existing M2/M4-02 rules untouched.
- `src/webview/prevStateTracker.ts` — NEW file (parallel pattern to `finishedTracker.ts`).
- `src/webview/render.ts`, `src/webview/components/sessionBlock.ts`, `src/webview/components/teamCard.ts`, `src/webview/components/collapsedPersonaTile.ts` — threaded the new tracker through the render chain (additive prop on each `*Props` interface). Pre-existing pruning walk extended to compute both tracker prune sets in one pass.
- `src/webview/main.ts` — instantiates the tracker at boot, threads through `buildCtx()`.
- `tests/unit/webview/dashboardTile.test.ts` — +23 tests.

### State-coverage (data-plane only — visual screenshots deferred)

- Running: data-plane smoke + per-state CSS rule verified in build (`grep ct-pulse dist/webview/dashboard.css`).
- Idle: opacity fade rule verified in build.
- Finished: ::after check pseudo + freshness suffix (M3-04 NIT #3) interoperate.
- Error: ct-error-flash keyframe + selector verified in build.
- Empty / dead session: untouched paths in render.ts; existing tests cover.

### Failure-mode probes

- Reduced-motion preference active → JS-side test confirms `data-transition` still fires (CSS handles motion elision, not JS).
- First render after boot → `prevState` undefined → no transition flash on initial paint (M4-01 §2.5 rule 3).
- Rapid same-tick re-render with same state → no transition flash.
- Tile vanishes between renders → tracker prunes the entry; no leak.
- Back-compat without tracker → render still works; no `data-transition` ever set; existing finished-suffix tests still green.
- Rapid second transition (error → running within 400ms) → fresh attribute survives; clear-callback guards on the SAME target value.

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** YES — AC(a) data-plane smoke present (live `agent-tree` CLI run cited above). AC(b–d) deferred to sponsor per the documented pattern.
- **Extension-manifest gate:** NO — `package.json` unchanged.

## Cross-references

- **M4-01 spec:** `team/iris-ux/m4-polish-spec.md` §2 + §2.10 implementation checklist + §5.4 vocabulary.
- **M4-02 (PR #56, on main):** styling tokens — this PR consumes `--ct-color-state-*` + `--ct-duration-state-transition` directly. No literal hex introduced (per the M4-02 deprecated-hexes appendix discipline).
- **M4-03 (in flight, Felix):** Felix is in parallel on `agentTile.ts` (drill-in affordance — adds `title="Open agent transcript"`). My changes own `prevState` + `scheduleClearTransition` props + the `data-transition` attribute logic; Felix's changes own the `title` attribute. The two edits are independent line-ranges; whichever lands first sets the baseline, the second rebases trivially.

## Non-obvious findings

- **`scheduleClearTransition` injection pattern.** Initially I considered driving the cleanup via `requestAnimationFrame` chains, but injection-style `setTimeout` plays cleaner with vitest fake timers and lets the test exercise both the "scheduled" and "fired" sides of the callback without real time passing. Same pattern used by other webview components that need deferred cleanup (compare collapsedPersonaTile's expand handler, which doesn't need this because expansion is sync).
- **Defensive clear-on-same-target guard.** A naive `setTimeout(() => article.dataset.transition = "", 400)` would clobber a fresher transition's attribute if the host emitted back-to-back state updates within 400ms. The guard compares the current attribute value to the one this setTimeout was scheduled for; if they differ, a newer setTimeout owns the cleanup. Same idiom Felix uses in `watcherLoop.ts` for debounced fs events.
- **`position: relative` on `.state-dot[data-state="finished"]`** is load-bearing — the check mark `::after` uses `position: absolute` and would otherwise anchor to the nearest positioned ancestor (likely `body`). Easy regression target if someone strips the rule.
- **Idle opacity targets only rows 2–4.** Row 1 (state dot + display name) MUST stay full opacity so the sponsor can identify which tile is which at a glance. Earlier draft considered fading the whole tile; rejected because it makes idle tiles read as "dead/discarded" rather than "alive but quiet."
- **Single-pass prune.** The existing `finishedTracker` prune already walks the rosterTiles tree once per render; M4-05 extends that walk to also populate the prevStateTracker's prune set. Two trackers, one tree traversal — keeps per-tick cost flat.
- **Reduced-motion test asymmetry.** jsdom doesn't honor `matchMedia('(prefers-reduced-motion: reduce)')` natively for media-query selector matching — the production media block only fires in a real browser/webview. The JS-side test asserts the RENDERER stays preference-agnostic (still sets `data-transition`) so CSS motion-elision delivers the color/opacity end-states. The visual reduced-motion behavior is a sponsor-side post-merge probe.

## ClickUp lifecycle

- `86c9ygckv` flipped to `in review` via `team/log/clickup-pending.md` ENTRY-2026-05-25T07:51:16Z (orchestrator flushes post-merge per the sub-agent MCP gap convention).
