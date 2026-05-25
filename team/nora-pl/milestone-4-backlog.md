# M4 Backlog — Live Polish (V1 Close)

Sponsor-confirmed M4 scope: V1's final "Live polish" milestone covering ALL FOUR V1-PLAN areas — styling, drill-in affordance polish, status-state visuals (running/idle/finished), and refresh-cadence tuning. Iris **leads** with design specs before any dev dispatch (styling + status-states). Drill-in (M4-03) and cadence (M4-04) ship in parallel without Iris design.

**Output:** an extension that (1) looks polished against Iris's M4 tokens, (2) telegraphs running/idle/finished state changes legibly via Iris-designed visuals, (3) makes drill-in feel like an obvious affordance (cursor / tooltip / click target), (4) ticks at a tuned cadence under realistic multi-session load, and (5) closes V1 with a retro consolidating the four-milestone arc.

**Marketplace publication is DEFERRED post-V1.** V1 dogfooding informs whether/when to publish; gets its own milestone after V1 close.

Each entry is dispatch-ready — the orchestrator can lift any ticket into a brief without further clarification from Nora.

ClickUp IDs are appended once the orchestrator creates tickets in list `901523520912` at dispatch time. All M4-NN tickets get a ClickUp ticket (none are orch-direct chores).

**Sequencing:** Iris M4-01 design spec FIRST. Then dev wave parallel: M4-02 (styling impl, depends M4-01) + M4-03 (drill-in polish, independent) + M4-04 (cadence, independent) + M4-05 (status-states impl, depends M4-01). M4-06 closes V1 after all five merge.

**Parallel-vocabulary discipline reminder:** If any M4 dev ticket introduces a shared concept (new type / new event / new wire-field) consumed by another in-flight ticket, the dispatch brief MUST include the Vocabulary contract block (5 identifiers: type / union / guard / discriminator / export-site) per the user-global parallel-agent rule + project-side dispatch-template.md update. M4-02 and M4-05 are the most likely surfaces — both Maya, sequential by Iris-spec dependency, so vocabulary risk is low; but flag at dispatch if Felix joins either ticket for host-side work.

**Carry-over from M3 retro (Next-session backlog):** four outstanding follow-up tickets are reassessed at M4-06 close, not gated on M4 work itself. Listed under "Out-of-repo / out-of-M4 follow-ups" below for visibility.

---

## Out-of-M4 follow-ups (filed elsewhere — listed here for visibility, NOT M4 work)

- **`86c9yb0yg` — M3-01 NITs (Felix XS, sponsor-held to bundle with M4).** Reassess scope at M4-06 close — either bundled into a Felix M4 ticket if files overlap, or fired as a standalone XS post-V1.
- **`86c9ydz4k` — formatFreshness NIT (likely absorbed into PR #47).** Orchestrator confirms at next dispatch wave and flips to complete if confirmed.
- **`86c9yee3g` — PR #47 cosmetic NITs (Maya XS, mechanical).** Eligible for absorption into M4-05 if Maya's M4-05 PR touches the same files (apply NITs-absorption-into-downstream-ticket auto-decide pattern per user-global rule 6).
- **`86c9y7y9z` — M2-04 NITs (sponsor-held since M2).** Reassess scope at M4 planning — likely retire as stale or roll into M4-02 styling pass if visual.
- **Dispatch-template.md Vocabulary contract block** — orch-direct doc PR; should land before the first M4 parallel dispatch that shares a new concept (see M3 retro § Next-session backlog item 1).
- **STATE.md schema convention rollout** — record dispatch-time + expected-by per in-flight agent on next M4 dispatch (see M3 retro item 2).
- **Decisions-log batch PR (Nora weekly cadence)** — collect M3 `Decision draft:` lines into next `team/DECISIONS.md` batch PR (see M3 retro item 6).
- **Marketplace publication milestone** — explicitly DEFERRED post-V1 per sponsor 2026-05-25. Standalone milestone authored after V1 dogfooding informs scope (publisher account setup, README/CHANGELOG/LICENSE polish, marketplace icon, vsce publish gates, etc.).

---

## M4-01 — `spec(ux): M4 design — styling tokens + status-state visuals + drill-in affordance model`

**Owner:** Iris
**Peer reviewer:** Maya (visual) — Felix consulted on spec edges if any host-side state-shape change implied
**Size:** M
**Priority:** P0 (anchor of the milestone — M4-02 and M4-05 implementations both depend on this spec; M4-03 drill-in affordance also references this spec's tooltip/cursor section, though M4-03 can proceed in parallel using sponsor's "click → open file" default if M4-01 hasn't landed)
**Source:** V1-PLAN line 113 ("M4 Live polish: Styling, drill-in, status states, refresh-cadence tuning"); V1-PLAN §"Identity & display rules" → `state` definition (running / idle / finished); sponsor scope decision 2026-05-25 ("Iris leads with design specs before any dev dispatch"); `team/iris-ux/m2-dashboard-tile-spec.md` (M2 visual language baseline — M4-01 extends, does not replace)
**ClickUp:** yes (create at dispatch)

### Scope

Three-part design spec deliverable, authored at `team/iris-ux/m4-polish-spec.md`:

1. **Styling tokens** — codify the dashboard's color palette, spacing scale, typography ramp, and theme-aware token names (e.g., `--ct-color-running`, `--ct-color-idle`, `--ct-color-finished`, `--ct-spacing-tile-gap`, `--ct-radius-tile`). Map every token to its VS Code theme variable counterpart (`var(--vscode-...)` where applicable; literal fallback otherwise). M2 visual language is the baseline — Iris consolidates the implicit constants currently scattered across `src/webview/styles/dashboard.css` into a named token system Maya can implement against.

2. **Status-state visuals** — visual treatment per state (`running` / `idle` / `finished` / `error`): color dot, optional pulse animation for `running`, fade/desaturation for `idle`, completion mark for `finished`, error chip carry-forward. State transitions: how does a tile telegraph "just transitioned from running → finished" without distracting (subtle one-shot animation? color flash? both?). Accessibility: aria-label updates per state, color-blind-safe contrast, reduced-motion respect.

3. **Drill-in affordance model** — cursor (`pointer` on rostered tile body), tooltip text (e.g., "Open agent transcript"), click-target zone (whole tile vs explicit icon), hover state (subtle elevation? border accent?), keyboard activation (Enter on focused tile fires open-transcript). Background-chip click-through behavior: confirm or refine M2-03 §D3's collapse-toggle interaction. Iris specifies; Maya implements in M4-02 styling pass (whole-tile click target + hover) and Felix verifies host-side behavior in M4-03.

### Acceptance criteria

- AC1: `team/iris-ux/m4-polish-spec.md` (new) authored with three top-level sections matching scope #1–#3. Each section is implementation-ready: Maya can pick up any section and implement without back-and-forth.
- AC2: Styling tokens section lists every token name + its semantic purpose + its theme-mapping (`var(--vscode-...)` or literal hex). Token count target: 12–20 tokens. Includes a "deprecated direct hexes" appendix listing every literal color/spacing value currently in `src/webview/styles/dashboard.css` that the new token replaces — Maya uses this as her search-and-replace checklist.
- AC3: Status-state visuals section includes a state-transition matrix (rows = from-state, columns = to-state, cells = visual treatment for the transition). The four core states (`running` / `idle` / `finished` / `error`) yield 12 non-diagonal transitions; spec covers each (most will be "no special treatment" — what matters is the explicit decisions).
- AC4: Status-state section explicitly addresses reduced-motion (`@media (prefers-reduced-motion: reduce)`) — any pulse/flash animations have a no-motion fallback.
- AC5: Drill-in affordance section specifies: cursor on rostered tile body = `pointer`; cursor on non-clickable elements (background chip header, error chip) = per-element decision; tooltip text wording; click-target shape (whole tile vs nested element); keyboard activation (Enter / Space when focused); focus-visible outline treatment.
- AC6: Spec includes a "Divergences from M2-dashboard-tile-spec" section listing every M2 visual decision being changed/extended (Iris's audit trail; same pattern as M2's "Divergences from M1-03 §2").
- AC7: Spec includes an "Implementation checklist for Maya" subsection at the end of each section — bulleted, file-grepable, suitable for direct paste into M4-02 / M4-05 dispatch briefs.
- AC8: PR body cites the V1-PLAN line + the M2 tile spec as source docs (audit trail for the spec-of-a-spec lineage).

### Out of scope (OOS)

- Implementation (Maya owns in M4-02 + M4-05).
- New icon set / iconography overhaul — codicons remain the default per M2-04.
- Re-design of the background chip layout — only the click-through affordance is in scope; the chip's structural layout stays M2-03 §5.
- Settings-UI form for theme tweaks (out of V1; YAML-only config per M3 decisions).
- Drill-in panel inside webview — V1 plan explicitly defers transcript rendering to VS Code's native JSONL viewer; M4-01 affordance section covers the click-to-open path only.
- Animation framework adoption (CSS keyframes only; no JS animation libraries).

### Done-when test

```bash
# Spec exists at expected path
ls team/iris-ux/m4-polish-spec.md
# Spec includes the three required top-level sections
grep -n "^## " team/iris-ux/m4-polish-spec.md | grep -E "Styling tokens|Status-state visuals|Drill-in affordance"
# Token count meets target
grep -c "^- \`--ct-" team/iris-ux/m4-polish-spec.md  # expect 12-20
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO — spec-only PR, no code changes.
- **Extension-manifest gate:** NO.

### Files in play

- Owned (Iris writes): `team/iris-ux/m4-polish-spec.md` (new).
- Read-only references: `team/iris-ux/m2-dashboard-tile-spec.md`, `src/webview/styles/dashboard.css` (audit current literal values for the deprecated-hexes appendix), `src/shared/types.ts` (`AgentTile.state` enum source), `docs/V1-PLAN.md` §"Identity & display rules".

### Dependencies

- None. Iris is the lead surface — kicks off the M4 wave.

---

## M4-02 — `feat(webview): styling tokens + theme-mapping refactor (per M4-01 §1)`

**Owner:** Maya
**Peer reviewer:** Felix (if host-side state-shape changes are implied) OR Iris (visual-only check) — Maya picks reviewer per primary touch; default Felix per the project's Felix↔Maya cross-review pairing
**Size:** M
**Priority:** P1 (depends on M4-01 §1; ships V1's polish layer)
**Source:** M4-01 §1 (Styling tokens); V1-PLAN line 113 (M4 styling); `.claude/docs/vscode-extension-conventions.md` §"Webview CSS theming"
**ClickUp:** yes (create at dispatch)

### Scope

Refactor `src/webview/styles/dashboard.css` to consume the M4-01 token system. Every literal color/spacing value listed in M4-01 §1's "deprecated direct hexes" appendix gets replaced with a `var(--ct-...)` reference. New token declarations live in a top-of-file `:root` block (or per-theme overrides where applicable). VS Code theme variables drive the underlying values via `var(--vscode-...)` mapping.

**No state-shape changes expected.** This is a CSS-only refactor; agent-tile / background-chip / error-chip / team-card markup is unchanged. If Maya discovers a markup change is required (e.g., a token needs a parent class hook that doesn't exist), the change MUST be minimal AND noted in the PR body — if it grows beyond a single class addition, file a follow-up rather than expanding this ticket's scope.

### Acceptance criteria

- AC1: Every token declared in M4-01 §1 is present as a `--ct-*` custom property in `src/webview/styles/dashboard.css` `:root` (or appropriate scope).
- AC2: Every literal color/spacing value listed in M4-01 §1's deprecated-hexes appendix is replaced with the corresponding `var(--ct-*)` reference. `grep -nE "#[0-9a-fA-F]{3,6}|rgb\(" src/webview/styles/dashboard.css` returns zero hits inside selector blocks (the `:root` declarations themselves may contain literals or `var(--vscode-...)` mappings).
- AC3: Theme switch verified — dark and light VS Code themes both render correctly (Maya's Self-Test Report cites a manual reload + screenshot of each theme; AC(a) data-plane smoke per the sub-agent GUI gap pattern, AC(b–d) interactive screenshots deferred to sponsor post-merge).
- AC4: Existing component tests (`tests/unit/webview/*.test.ts`) remain green. No snapshot bumps unless explicitly justified in the PR body (a CSS variable name change ripples to snapshots only if the snapshot captures computed style — which it shouldn't for our component tests).
- AC5: `npm run typecheck && npm run test:unit` green.
- AC6: Markup changes (if any) are documented in the PR body with rationale per scope's "minimal markup change" rule.

### Out of scope (OOS)

- Status-state visual changes (M4-05).
- Drill-in affordance changes (M4-03).
- Component restructuring (`*.ts` files in `src/webview/components/`) — CSS-only refactor; markup edits only if AC6's threshold is hit.
- New Iris spec divergences — implement M4-01 §1 verbatim; flag any ambiguity for a M4-01 amendment rather than improvising.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-maya-wt
npm run typecheck && npm run test:unit
# Hex literals removed from selector blocks
grep -nE "#[0-9a-fA-F]{3,6}|rgb\(" src/webview/styles/dashboard.css | grep -v "^:root\|^/\*"
# Should return zero (or only allowed :root / comment lines)
# Manual: install vsix, toggle VS Code theme dark↔light, dashboard renders correctly in both
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** YES — CSS-only changes still touch webview rendering. AC(a) data-plane smoke required (live tile renders in both themes); AC(b–d) interactive screenshots deferred to sponsor post-merge per sub-agent GUI gap.
- **Extension-manifest gate:** NO — `package.json` unchanged.

### Files in play

- Owned (Maya writes): `src/webview/styles/dashboard.css`.
- Modified (only if AC6 threshold hit): one or more `src/webview/components/*.ts` (minimal class additions).
- Read-only references: `team/iris-ux/m4-polish-spec.md` §1 (Styling tokens + deprecated-hexes appendix), `.claude/docs/vscode-extension-conventions.md` §"Webview CSS theming".

### Conflict rule

If M4-02 lands AFTER M4-05, Maya rebases on the M4-05'd CSS (status-state visuals already in place using literal hex — M4-02's refactor replaces those hex with tokens as well). Coordinate via PR-body cross-reference; whichever ships first owns the token-naming baseline.

### Dependencies

- M4-01 (Iris styling tokens section — hard dep; Maya cannot pick up until M4-01 merges or is far enough along to lift the §1 deliverable as draft).

---

## M4-03 — `feat(host+webview): drill-in affordance polish (cursor / tooltip / click-target)`

**Owner:** Felix (host-side verification + any settings touch); paired with Maya for any webview-side cursor/tooltip class additions
**Peer reviewer:** Maya (since most surface is webview affordance; Felix↔Maya pairing)
**Size:** S
**Priority:** P1 (independent of M4-01 per sponsor; ships affordance polish on the existing drill-in path)
**Source:** V1-PLAN line 27 ("Drill-in: open the agent's JSONL transcript in VS Code's native file viewer") — already shipped in M2-06's `handleOpenTranscript` (`src/extension/main.ts:303`); sponsor scope decision 2026-05-25 ("standard interaction — click → open file; independent of M4-01"); M4-01 §3 drill-in affordance model (consumed if M4-01 has landed; otherwise sponsor's stated default applies)

**ClickUp:** yes (create at dispatch)

### Scope

The drill-in code path is already end-to-end (webview tile click → `ui:open-transcript` → host `handleOpenTranscript` → `vscode.window.showTextDocument`). M4-03 closes the affordance gaps:

1. **Verify the existing path still works** post-M3 (regression check; one manual click → open cycle in the Self-Test Report).
2. **Cursor:** `cursor: pointer` on the rostered agent tile body when clickable; default cursor on non-clickable elements (background chip header is exempt — it has its own toggle interaction).
3. **Tooltip:** `title="Open agent transcript"` (or M4-01 §3-specified wording if M4-01 has landed) on the tile body.
4. **Click target zone:** whole-tile click (not just a nested element) — confirm or fix per M4-01 §3; sponsor's stated default is whole-tile.
5. **Keyboard activation:** Enter (and optionally Space) on a focused rostered tile fires the same `ui:open-transcript` payload. Add `tabindex="0"` and a focus-visible outline if not already present.
6. **Optional preview-vs-tab flag:** the current `vscode.window.showTextDocument(uri)` opens in a regular editor tab. Consider whether `{ preview: true }` (replaces the preview tab on next open) is the better default for drill-in. **Implementation-time judgment call** — document the chosen default in the PR body. Default to current behavior (regular tab) unless sponsor's M4-01 spec calls for preview mode.

### Acceptance criteria

- AC1: Manual regression: install the new vsix, click a rostered tile, the JSONL opens in a VS Code editor tab. Self-Test Report cites the click + the opened file path + the agent id/session id used.
- AC2: `src/webview/components/agentTile.ts` (or its parent renderer) sets `cursor: pointer` (via CSS class or inline style — Maya's call, consistent with M4-02 if landed) on the tile body. Background chip header and error chip retain their existing cursor semantics.
- AC3: Tile body has `title="Open agent transcript"` (or M4-01 §3 wording if landed). Tooltip appears on hover after the OS-standard delay.
- AC4: Tile body click target is the whole tile (not just `display`/`role` text) — verified by clicking various tile regions in the manual probe.
- AC5: Tile body has `tabindex="0"` and a `focus-visible` outline using `var(--ct-focus-outline)` (or M4-02 token; literal `var(--vscode-focusBorder)` fallback if M4-02 hasn't landed). Pressing Enter on a focused tile fires `ui:open-transcript` with the correct sessionId+agentId payload.
- AC6: `handleOpenTranscript` in `src/extension/main.ts` is unchanged unless AC6's preview-flag decision changes it; document any change in PR body. Existing defensive behavior (unknown sessionId / missing file / showTextDocument failure → error message, no throw) is preserved.
- AC7: Unit test in `tests/unit/webview/agentTile.test.ts` (extend if exists, create if not) — asserts the rendered tile has `tabindex="0"`, `cursor: pointer` class or inline style, and the tooltip attribute. Keyboard-activation behavior tested via simulated keydown.
- AC8: `npm run typecheck && npm run test:unit` green.

### Out of scope (OOS)

- Webview-side transcript rendering (V1-PLAN line 32 — explicitly out of V1).
- Re-architecting `handleOpenTranscript`'s defensive behavior.
- New drill-in destinations (e.g., open meta.json instead of JSONL — V1 plan is JSONL only).
- Hover-state styling beyond the focus-visible outline + cursor (Maya covers visual hover in M4-02 if any).
- Background chip click affordance — out of scope; M4-01 §3 covers the background chip if it changes, but the chip's existing toggle is acceptable as-is.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run typecheck && npm run test:unit
# Manual: install vsix, click a rostered tile → JSONL opens.
# Tab to focus a tile → outline visible → Enter → JSONL opens.
# Hover a tile → "Open agent transcript" tooltip appears.
```

Self-Test Report posted with AC(a) data-plane smoke + AC(b–d) sponsor post-merge deferral note per the sub-agent GUI gap pattern.

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** YES — webview tile markup changes (tabindex, title, click handler verification). AC(a) data-plane smoke required; AC(b–d) interactive screenshots deferred to sponsor post-merge per sub-agent GUI gap.
- **Extension-manifest gate:** NO — `package.json` unchanged.

### Files in play

- Owned (Felix writes): minor host-side verification touches to `src/extension/main.ts` (only if preview-flag decision changes the call), `tests/unit/webview/agentTile.test.ts` (extend or create).
- Modified: `src/webview/components/agentTile.ts` (tabindex, title, keyboard handler), `src/webview/styles/dashboard.css` (cursor + focus-visible — coordinate with M4-02 if landed; if M4-02 already added these, this PR's CSS touch is a no-op).
- Read-only references: V1-PLAN line 27, M2-dashboard-tile-spec §6 (Interaction Contract), `team/iris-ux/m4-polish-spec.md` §3 if landed.

### Conflict rule

If M4-02 lands first AND adds cursor/focus styling via tokens, M4-03 verifies the tile markup gets the right class hook. If M4-03 lands first, M4-02 absorbs the cursor/focus classes into the token system on its pass. Either order is acceptable; cross-reference in PR bodies.

### Dependencies

- None hard. Soft dep on M4-01 §3 for tooltip wording (otherwise default applies). Independent of M4-02 (CSS values can be literal initially, refactored to tokens by M4-02).

---

## M4-04 — `feat(host): refresh-cadence tuning + measurement under multi-session load`

**Owner:** Felix (host-side cadence; Sage authors Layer-3 coverage of the tuned cadence)
**Peer reviewer:** Maya
**Size:** M
**Priority:** P1 (V1-PLAN line 121 explicit M4 surface — "Activity polling cadence: 2s is the default plan; tune in M4"; independent of Iris design)
**Source:** V1-PLAN line 113 (M4 "refresh-cadence tuning"); V1-PLAN line 121 ("tune in M4"); current default `claudeteam.pollIntervalMs: 2000` in `package.json` (declared at M3-01); `src/extension/watcher/watcherLoop.ts` `MIN_POLL_MS` clamp + hash-skip optimization
**ClickUp:** yes (create at dispatch)

### Scope

Three-part deliverable:

1. **Measure** — under realistic multi-session load (sponsor-typical: 3–6 live Claude Code sessions across 2–3 workspaces, each with 1–5 active subagents), profile the current 2s poll: tick duration distribution (p50/p95/max), CPU% impact, FS-watcher event volume vs poll-driven volume, hash-skip rate (how many ticks produce no state change).
2. **Tune** — propose and apply a new default (e.g., raise to 3s if p95 is well within budget AND hash-skip rate is high; lower to 1.5s if responsiveness gaps are perceived; OR introduce adaptive cadence: faster when an FS event recently fired, slower when state has been quiet for N ticks). The tuned default is the new `claudeteam.pollIntervalMs` value in `package.json`; the user's manual override still applies.
3. **Document the measurement methodology** so future cadence tunes are repeatable. Lives at `team/felix-dev/m4-04-cadence-measurement.md`.

The MIN_POLL_MS clamp in `watcherLoop.ts` may also be revisited — Felix's call based on measurement.

### Acceptance criteria

- AC1: `team/felix-dev/m4-04-cadence-measurement.md` (new) documents: measurement environment (machine specs, OS, Claude Code version, multi-session count), methodology (how ticks were timed — `performance.now()` around `runTick`?), raw numbers (p50/p95/max tick duration, CPU%, hash-skip rate per cadence tested), recommendation + rationale.
- AC2: `package.json` `claudeteam.pollIntervalMs` default value updated to the tuned number. Default description string updated if needed to reflect the new value.
- AC3: If adaptive cadence is implemented (Felix's call), `src/extension/watcher/watcherLoop.ts` gains the adaptive logic with code-comment explaining the heuristic. State machine: explicit, testable, documented. If adaptive is NOT chosen, the doc explains why (e.g., "fixed cadence is well-bounded; adaptive added complexity for negligible gain in measured scenarios").
- AC4: `MIN_POLL_MS` clamp is either left at current value (decision documented) or adjusted (decision documented). Test coverage in `tests/unit/watcherLoop.test.ts` extends to cover the new value / clamp behavior.
- AC5: Existing watcher unit tests remain green. New tests cover any adaptive logic if implemented.
- AC6: Memory-leak probe — Felix runs the watcher for ≥10 minutes under load and confirms no monotonic memory growth in the extension host process (manual probe via VS Code's Process Explorer or `ps`/Task Manager; cites in the measurement doc).
- AC7: `npm run typecheck && npm run test:unit && npm run test:integration` green.
- AC8: PR body summarizes the recommendation in 3–5 sentences (full detail lives in the measurement doc) — orchestrator-friendly for merge-decision context.

### Out of scope (OOS)

- Hook-tap implementation (V1-PLAN line 34 — "Hook-based sub-second activity updates ... promote if needed" — explicitly out of V1).
- Restructuring the file-watcher architecture (only cadence is tuned; FS-watcher topology unchanged).
- Per-session cadence overrides (one global cadence; M4 keeps it simple).
- New telemetry / metrics infrastructure beyond ad-hoc measurement in the doc.
- Replacing `setInterval` with a different scheduling primitive — `setInterval` + tick guards is the V1 baseline; revisit post-V1 if measurement surfaces issues.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-felix-wt
npm run typecheck && npm run test:unit && npm run test:integration
# Manual: install vsix with the tuned cadence; observe dashboard under 3-6 live sessions for ≥10 min.
# Confirm: responsiveness feels right (no perceived lag for state changes); CPU% within budget; no memory growth.
# Measurement doc updated with the actual readings from the manual probe.
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO — host-side tuning only; webview render path unchanged.
- **Extension-manifest gate:** YES — `package.json` `contributes.configuration` default changes. Include `vsce package --no-yarn` stdout in Self-Test Report.

### Files in play

- Owned (Felix writes): `team/felix-dev/m4-04-cadence-measurement.md` (new).
- Modified: `src/extension/watcher/watcherLoop.ts` (adaptive logic if chosen; MIN_POLL_MS if adjusted), `package.json` (`pollIntervalMs` default + description string), `tests/unit/watcherLoop.test.ts` (extend for new behavior).
- Read-only references: V1-PLAN line 121, M2 hash-skip implementation (`watcherLoop.ts` lines 207–212).

### Dependencies

- None. Independent of Iris design; independent of all other M4 tickets.

---

## M4-05 — `feat(webview): status-state visuals + transitions (per M4-01 §2)`

**Owner:** Maya
**Peer reviewer:** Felix
**Size:** M
**Priority:** P1 (depends on M4-01 §2; user-visible polish layer telegraphing running/idle/finished/error)
**Source:** M4-01 §2 (Status-state visuals); V1-PLAN line 113 (M4 status states); V1-PLAN §"Identity & display rules" state definitions (running / idle / finished / error)
**ClickUp:** yes (create at dispatch)

### Scope

Implement the M4-01 §2 status-state visual treatment on `AgentTile` (and any other state-bearing component — error chip per M4-01 §2 carry-forward). Per state:

- `running` — color dot per M4-01 token; optional pulse animation with reduced-motion fallback.
- `idle` — fade/desaturation per M4-01.
- `finished` — completion mark per M4-01.
- `error` — existing error chip behavior; M4-01 §2 may extend.

Plus state-transition visuals per the M4-01 transition matrix — typically one-shot subtle animations (CSS keyframes) on `state` change. Tile renderer detects state change at the prev/next prop boundary and applies the transition class for the animation duration.

### Acceptance criteria

- AC1: `src/webview/components/agentTile.ts` consumes the M4-01 §2 visual treatment for each of the four states (`running` / `idle` / `finished` / `error`). Visual treatment cites the M4-01 token(s) for each state.
- AC2: State-transition animations are implemented per the M4-01 transition matrix. Implementation uses CSS keyframes (no JS animation libraries). Each transition has a defined duration (typically 150–400ms) per M4-01.
- AC3: `@media (prefers-reduced-motion: reduce)` block disables all animations; transitions still happen visually (color change) but without motion (no pulse, no flash) per M4-01 AC4.
- AC4: aria-label updates per state per M4-01 (e.g., `aria-label="Felix (Backend Dev) — Running"`; updates to `... — Idle` on state change). Screen-reader-friendly.
- AC5: Component tests in `tests/unit/webview/agentTile.test.ts` extend to cover: each state renders the expected dot color class; reduced-motion path elides the animation class; aria-label reflects current state.
- AC6: State-transition test — render `agentTile` with state `running`, re-render with state `finished`, assert the transition class is applied for the M4-01-specified duration then removed.
- AC7: Theme-switch probe — dark and light themes both render state visuals correctly (Self-Test Report cites manual reload + screenshot of each state in each theme; AC(a) data-plane smoke + AC(b–d) deferred to sponsor per sub-agent GUI gap).
- AC8: `npm run typecheck && npm run test:unit` green.

### Out of scope (OOS)

- New state values beyond the four defined in V1-PLAN (no `paused`, `queued`, etc.).
- Status-state changes to the background chip (per M4-01 §2 scope unless explicitly extended — Maya implements only what M4-01 covers).
- Sparkline / activity ribbon (M3 retro M4 surface candidates that did NOT make sponsor's M4 scope decision — explicitly OOS this milestone).
- Styling token refactor (M4-02 owns); M4-05 may use literal M4-01-cited values if M4-02 hasn't landed, then M4-02 absorbs into tokens.

### Done-when test

```bash
cd c:/Trunk/PRIVATE/ClaudeTeam-maya-wt
npm run typecheck && npm run test:unit
# Manual: install vsix, observe a tile transition running → finished (let an agent complete naturally OR use fixture);
# verify the transition is visible AND non-disruptive.
# Toggle OS reduced-motion setting; verify animations elide while color change still applies.
# Toggle VS Code theme dark↔light; verify each state renders correctly in both.
```

Self-Test Report posted with AC(a) data-plane smoke + AC(b–d) sponsor post-merge deferral note.

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** YES — webview rendering changes (state visuals + transitions). AC(a) data-plane smoke required; AC(b–d) interactive screenshots deferred to sponsor post-merge per sub-agent GUI gap.
- **Extension-manifest gate:** NO — `package.json` unchanged.

### Files in play

- Owned (Maya writes): `src/webview/components/agentTile.ts` (state visual treatment + transition detection), `src/webview/styles/dashboard.css` (state-color tokens + keyframes — coordinate with M4-02 if landed), `tests/unit/webview/agentTile.test.ts` (extend for state + transition coverage).
- Read-only references: `team/iris-ux/m4-polish-spec.md` §2 (Status-state visuals + transition matrix), `src/shared/types.ts` (`AgentTile.state` enum), V1-PLAN §"Identity & display rules".

### Conflict rule

If M4-02 (styling tokens refactor) lands first, M4-05's CSS uses the M4-02 token names directly. If M4-05 lands first, it may use literal hex per M4-01 §2; M4-02 absorbs into tokens on its pass per M4-02's deprecated-hexes appendix update.

If M4-05 modifies `agentTile.ts` in ways that conflict with M4-03's tabindex/title/click changes, coordinate via PR-body cross-reference; whichever lands first owns the markup baseline.

### Dependencies

- M4-01 §2 (Iris status-state visuals spec — hard dep).
- M4-02 (soft; M4-05 can use literal values, then M4-02 tokenizes).
- M4-03 (soft; tile markup coordination — both modify `agentTile.ts`).

---

## M4-06 — `retro(m4): V1 close — milestone retro + cross-V1-arc retrospective`

**Owner:** Nora
**Peer reviewer:** orchestrator-direct (retro is Nora-domain per project convention; same pattern as M1/M2/M3 close)
**Size:** M
**Priority:** P2 (housekeeping but mandatory V1 close — fires after M4-01 through M4-05 all merge)
**Source:** Project convention (every milestone closes with a retro per `.claude/retros/RETRO-TEMPLATE.md`); V1-PLAN line 115 ("Total: ~1 week of focused work" — V1 close warrants a cross-milestone arc retro on top of the standard M4 retro)
**ClickUp:** yes (create at dispatch)

### Scope

Two-part deliverable:

1. **M4 retro** at `.claude/retros/retro-YYYY-MM-DD-m4-close.md` — standard format per `RETRO-TEMPLATE.md`. Honest grades; structural fixes for failures; durable lessons promoted to memory / `.claude/docs/` / `process-incidents.md`. Covers M4-01 through M4-05 (5 tickets).
2. **V1 close retrospective** appended to the M4 retro (or as a separate `retro-YYYY-MM-DD-v1-close.md` — Nora's call) — cross-milestone arc retro covering M1 → M2 → M3 → M4. Themes to address: what changed across the arc (data plane → extension scaffold → roster config → polish), what stayed stable (orchestration model, 6-persona roster, reviewer-track gate), what failure modes recurred across milestones (chain-of-deferred-validations was the M2 lesson; vocabulary divergence was the M3 lesson; M4 surfaces?), and what shipped vs what got deferred (marketplace publication, hook tap, in-webview transcript, sparkline ribbons).

V1 close retro also produces:
- A V1 ship-list (one-sentence summary of every M1–M4 ticket's outcome) — useful for the deferred marketplace milestone's README/CHANGELOG.
- A V2 candidate-list — the deferred surfaces from V1 plus any new surfaces M4 dogfooding revealed.

### Acceptance criteria

- AC1: M4 retro file exists at `.claude/retros/retro-YYYY-MM-DD-m4-close.md` (date filled in at authoring time).
- AC2: M4 retro follows the `RETRO-TEMPLATE.md` structure: What went well / What went poorly / Anti-patterns observed / Durable lessons (promoted) / Next-session backlog. Each section is honest — no victory-lap framing.
- AC3: V1 close cross-arc section exists (either appended to AC1's file or as a standalone `retro-YYYY-MM-DD-v1-close.md`). Covers: what changed across M1→M4, what stayed stable, what failure modes recurred, what shipped vs deferred.
- AC4: V1 ship-list section: one sentence per merged ticket M1 through M4 (~25–35 tickets total per the running M1/M2/M3 + 5 M4 tickets). Useful prose for the post-V1 marketplace milestone's README.
- AC5: V2 candidate-list section: enumerated, each item with a one-line rationale and a rough cost estimate (S/M/L). Sources: V1-PLAN OOS items + M4 dogfooding observations + any deferred ClickUp tickets at V1 close.
- AC6: Durable lessons promoted: any cross-milestone pattern (e.g., "Iris-leads-with-spec sequencing was applied in M2 and M4 with measurably better dev-ticket clarity") promoted to memory and/or `.claude/docs/orchestration-overview.md`. Promotion decisions cited in the retro.
- AC7: Next-session backlog enumerates: any non-V1 outstanding follow-up tickets (M2-04 NITs if still unresolved, M3-01 NITs if not absorbed, etc.); marketplace publication milestone kickoff prep; cross-project porting candidates for `create-orchestration-project` skill.

### Out of scope (OOS)

- Marketplace publication work (separate milestone, post-V1).
- New ticket authoring for V2 (just candidate-list; full V2 plan is its own deliverable).
- Code changes — retro is docs-only.

### Done-when test

```bash
ls .claude/retros/retro-*-m4-close.md
# Retro file exists with the standard sections
grep -E "^## " .claude/retros/retro-*-m4-close.md | grep -E "What went well|What went poorly|Anti-patterns|Durable lessons|Next-session"
# All five RETRO-TEMPLATE sections present
grep -E "^## V1 close|V1 ship-list|V2 candidate" .claude/retros/retro-*-*.md
# Cross-arc section present (either in m4-close file or in standalone v1-close file)
```

### Webview-smoke / extension-manifest gate

- **Webview-smoke gate:** NO — docs-only.
- **Extension-manifest gate:** NO — docs-only.

### Files in play

- Owned (Nora writes): `.claude/retros/retro-YYYY-MM-DD-m4-close.md` (new), optionally `.claude/retros/retro-YYYY-MM-DD-v1-close.md` (new — if Nora splits the cross-arc retro into its own file).
- Optionally modified: memory entries (durable lessons promotion), `.claude/docs/orchestration-overview.md` (if a cross-milestone pattern warrants doc promotion).

### Dependencies

- M4-01, M4-02, M4-03, M4-04, M4-05 — all five must be merged before retro fires (retro grades the milestone's actual outcome, not its plan).

---

## Cross-references

| Ticket | Depends on | Blocks |
|---|---|---|
| M4-01 | — | M4-02 (§1), M4-05 (§2); soft on M4-03 (§3) |
| M4-02 | M4-01 §1 | — |
| M4-03 | — (soft on M4-01 §3) | — |
| M4-04 | — | — |
| M4-05 | M4-01 §2 (soft on M4-02 + M4-03 for shared CSS / markup coord) | — |
| M4-06 | M4-01, M4-02, M4-03, M4-04, M4-05 | — |

---

## Throughput / wave plan

**Wave 0 (Day 1) — Iris-only:**

- **M4-01** — Iris design spec (P0, M) — anchor of the milestone; nothing else can fire on the dev-impl side until §1 + §2 are far enough along to lift.

Why solo: sponsor explicit ("Iris leads with design specs before any dev dispatch"). M4-03 and M4-04 *could* fire in parallel with M4-01 (both are spec-independent), but starting Iris alone keeps the dev-load clean and lets her produce the spec without same-tick distraction from in-flight dev questions on M4-03/04.

**Wave 1 (after M4-01 merge OR M4-01 is far-enough along to lift §3 default for M4-03) — dev parallel wave:**

- **M4-02** — Maya: styling tokens impl (P1, M) — depends on M4-01 §1.
- **M4-03** — Felix + minor Maya touch: drill-in affordance polish (P1, S) — independent of M4-01; sponsor's default applies if M4-01 §3 hasn't landed.
- **M4-04** — Felix: refresh-cadence tuning (P1, M) — independent.
- **M4-05** — Maya: status-state visuals impl (P1, M) — depends on M4-01 §2.

Expected parallelism: 4 agents in flight (Felix×2 on M4-03/04, Maya×2 on M4-02/05). Maya double-load: M4-02 and M4-05 both modify `dashboard.css` and `agentTile.ts` — coordinate via PR-body cross-reference per the Conflict rule sections. Sponsor may want to sequence Maya's two tickets (M4-02 first, then M4-05 once M4-02 merges) to eliminate the conflict-rule overhead — orchestrator's call at dispatch time based on Maya's bandwidth.

If Maya is sequenced: Wave 1 ships Felix M4-03 + Felix M4-04 + Maya M4-02 in parallel; Wave 1b ships Maya M4-05 after M4-02 merges. 3-then-1 instead of 4-parallel.

**Wave 2 (after all five impl tickets merge):**

- **M4-06** — Nora: M4 retro + V1 close cross-arc retrospective (P2, M).

Sage's role across waves: Sage QAs every M4 dev ticket (M4-02 / M4-03 / M4-04 / M4-05) per the project's "Sage QAs all" convention. Sage's Layer-3 expansion for M4 surfaces is folded into the dev tickets' acceptance tests (no standalone Sage ticket this milestone — M4 doesn't add new orchestration / state-shape surfaces warranting a dedicated Layer-3 expansion ticket like M3-09; if M4-04 or M4-05 surfaces a Layer-3 gap during QA, Sage files a follow-up).

**Expected parallelism peak:** Wave 1 with 4 agents (or 3 if Maya sequenced). M4 is more sequential than M3 (which had a 5–6-agent Wave 0) because Iris's design spec gates two of the four dev tickets.

---

## Tickets requiring ClickUp creation at dispatch time

- M4-01, M4-02, M4-03, M4-04, M4-05, M4-06 (all six — every M4-NN gets a ClickUp ticket per sponsor scope decision; no orch-direct chores in M4).

## Tickets that are orch-direct chore class (no ClickUp ticket)

- None this milestone. (The out-of-M4 follow-ups listed at top — dispatch-template Vocabulary contract, STATE.md schema rollout, decisions-log batch — are orch-direct chores but not M4 tickets.)

---

## Webview-smoke gate ticket roll-up

- **M4-02** — YES (CSS rendering)
- **M4-03** — YES (tile markup changes)
- **M4-05** — YES (state visuals rendering)
- (M4-01 / M4-04 / M4-06 — NO)

## Extension-manifest gate ticket roll-up

- **M4-04** — YES (`claudeteam.pollIntervalMs` default change)
- (All others — NO)

## Cross-review pairing roll-up

- Iris authors: M4-01 → Maya reviews (visual) with Felix on spec-edge consult if needed
- Maya authors: M4-02, M4-05 → Felix reviews
- Felix authors: M4-03, M4-04 → Maya reviews
- Nora authors: M4-06 → orchestrator-direct

---

## M4 milestone done-when

Compound check that proves M4 is shippable AND V1 closes:

1. `team/iris-ux/m4-polish-spec.md` exists and covers the three required sections (tokens / state visuals / drill-in affordance).
2. Dashboard CSS consumes M4-01 tokens (zero literal hex in selector blocks); dark and light themes render correctly.
3. Rostered tile drill-in: hover → tooltip; click → JSONL opens; keyboard Enter on focused tile → JSONL opens; cursor is `pointer`.
4. Status-state visuals: running tiles pulse (or M4-01-spec'd treatment); idle tiles fade; finished tiles show completion mark; state transitions animate per M4-01 transition matrix; reduced-motion respected.
5. Refresh cadence: tuned default in `package.json`; measurement doc captured; ≥10 min observation under load shows no memory growth.
6. M4 retro merged at `.claude/retros/retro-*-m4-close.md`; V1 close cross-arc retrospective produced.
7. Sponsor performs the V1 dogfooding probe: install vsix in their primary workspace, observe dashboard for a multi-hour session, confirm V1 is fit-for-purpose. (Failures here block the marketplace milestone but do not block M4 sign-off; sponsor's call at retro time.)
