# EPIC 86ca11187 Backlog — Whole-Team-Always-Visible Dashboard

Breakdown of EPIC `86ca11187` (filed 2026-05-28; full scope in [team/DECISIONS.md](../DECISIONS.md) § 2026-05-28 "Whole-team-always-visible dashboard") into dispatch-ready child tickets.

**Epic thesis:** change the dashboard display model from "render tiles for DETECTED live agents matched to the roster" to "seed a tile for the FULL roster as an always-present baseline, with live state overlaid." Plus persona pixel-character rendering, user-driven hide/remove agent culling (NO auto-hide — sponsor rejected), and two UX fixes surfaced from live dogfood (session-title prominence, DEAD-card handling).

**Grounding (verified this session):**
- `src/extension/state/reducer.ts:152-266` builds `rosterTiles` by iterating `agents` (detected live agents only). A roster member who never dispatched produces no `AgentTile`. This is the root cause the epic's full-roster-baseline change addresses.
- `AgentTile` (`src/shared/types.ts:282-358`) is keyed by `memberId` + `teamId` and carries `agentId`, `state`, `activity`, `model`, optional `memberColor`/`finishedAtMs`. A baseline (never-run) tile needs a new `AgentState` value or a "baseline/available" flag — a host-side type decision (Felix lane, design-light).
- Session-label resolution is SOLVED on the wire: `resolveSessionLabel` (`src/shared/types.ts`) returns `customTitle > aiTitle > workspace-folder` and the webview renders it in `.session-title` (`src/webview/components/sessionBlock.ts`). The dogfood complaint is the VISUAL HIERARCHY — `SESSION <uuid>` reads dominant over the resolved title — i.e. a CSS/markup-order fix in the session header, NOT a data fix.
- DEAD-card lifecycle is file-driven (no timer) per `vscode-extension-conventions.md` § "Session-tile identity and DEAD prune semantics": dead tiles self-prune when Claude Code removes `~/.claude/sessions/{pid}.json`. A "hide dead" toggle is net-new UI state, not a lifecycle change.

---

## Sequencing — the load-bearing call

Two tickets are **DESIGN-INDEPENDENT** (no `team/iris/whole-team-display-spec.md` dependency) and dispatch-ready NOW:

- **E-01 — full-roster baseline tiles (reducer/host)** — a data-model change. The VISUAL of a baseline tile is design-dependent (E-04 owns that), but the reducer producing baseline tiles + the new state/flag on the wire is pure host work. Felix can land the reducer + types + a minimal/placeholder render behind the existing tile path; Maya re-skins under the Iris spec in E-04/E-05. Dispatch first.
- **E-02 — session-title prominence (webview CSS/markup)** — a self-contained hierarchy fix in the session header. Data already on the wire; this is markup-order + token sizing. Design-light (Maya-lane); does NOT need the full whole-team spec. Dispatch in parallel with E-01.

Everything else is **DESIGN-DEPENDENT** — await Iris's `team/iris/whole-team-display-spec.md`:

- **E-03 — Iris design spec (the gate).** Decomposes the file surface into parallel-safe ownership zones (validated 3× in V1 — see orchestration-overview.md § "Iris-leads-with-spec decomposes parallel-safe ownership zones"). Must cover: (1) baseline/available tile visual + how it differs from idle, (2) persona pixel-character placement/sizing/pose→state mapping + playback (slow + dwell), (3) hide/show/remove affordances + the "show hidden" reveal control, (4) DEAD-card hide-toggle treatment (if in scope — see E-08 decision).
- **E-04 — persona pixel-character rendering (webview).** Depends on E-03 (placement/size) AND the harvested sprites. Needs the metadata.json reverse-map + pose→state + slow/dwell playback per the persona-anim doc.
- **E-05 — baseline tile visual skin (webview).** Depends on E-03 + E-01 (the wire shape). Skins the baseline/available state E-01 introduces.
- **E-06 — hide agent (reversible) host+webview.** Depends on E-03 (affordance design). Persisted hidden-set + filter (host) + per-tile hide/show UI + "show hidden" reveal (webview).
- **E-07 — remove agent (yaml-gated) host+webview.** Depends on E-03 + E-06 (shares the cull-action surface). Per-tile remove → fully suppressed; returns only by re-adding to teams.yaml.
- **E-08 — DEAD-card hide toggle.** Depends on a sponsor IN/OUT-of-scope decision (see ticket) + E-03 if IN. Smallest item; may be cut.
- **E-09 — Sage test plan + QA pass.** Spans the epic; depends on the impl tickets it covers.

**Recommended dispatch order:**
1. **Wave 0 (now, parallel):** E-01 (Felix) + E-02 (Maya) — design-independent. Iris E-03 spec dispatched in parallel (Iris worktree free; no PixelLab conflict — sponsor's open offer).
2. **Wave 1 (after E-03 spec lands + E-01 merges):** E-04 (Maya, sprites) + E-05 (Maya or Felix, baseline skin) + E-06 (Felix host + Maya webview). Parallel-safe per the Iris-spec ownership zones; apply the Vocabulary contract block if E-06 introduces a shared host↔webview type (likely — `hiddenMemberIds` or similar).
3. **Wave 2:** E-07 (remove, builds on E-06) + E-08 (DEAD toggle, if sponsor says IN).
4. **Wave 3:** E-09 (Sage QA across the merged surface) → epic close.

**Vocabulary-contract flag:** E-01 introduces a shared concept (baseline tile state/flag) consumed by E-05's webview skin. Sequence E-01 → E-05 (Pattern A) OR include the 5-identifier Vocabulary contract block at dispatch (Pattern B) per the user-global parallel-agent rule. E-06's hidden-set type is the second shared-concept surface (host filter ↔ webview UI).

---

## E-01 — `feat(reducer): seed full-roster baseline tiles for never-run members`

**Owner:** Felix (host / reducer)
**Peer reviewer:** Maya
**Size:** M
**Priority:** P0 (epic foundation — every always-visible-team behavior depends on baseline tiles existing on the wire)
**Design-dependency:** **INDEPENDENT** — dispatch-ready now. (Baseline-tile *visual* is E-05/E-03; this ticket is the data model + a non-regressing render path.)
**Source:** EPIC 86ca11187; DECISIONS.md 2026-05-28; verified root cause `src/extension/state/reducer.ts:152-266` (rosterTiles built from detected `agents` only).

### Scope

The reducer currently builds `rosterTiles` by iterating detected live agents and matching each to the roster. Members never dispatched (Iris/Nora/Bram in a typical session) produce no tile. Change the model: for every team in the merged roster, seed a tile for EVERY `member` as a baseline, then overlay live state where a detected agent matches that member.

- For each `Team` in `roster`, for each `Member`, emit a baseline `AgentTile` (display/role/teamId/memberId/memberColor from the roster; a new "never-run" liveness representation).
- When a detected agent matches a member, the live tile OVERLAYS/REPLACES that member's baseline tile (live `state`/`activity`/`model`/`agentId` win). Existing collapse/multi-agent behavior (M3-10 `CollapsedPersonaGroup`) is preserved for members with N≥1 live agents.
- Introduce the baseline liveness representation as the shared concept — EITHER a new `AgentState` value (e.g. `"available"`) OR a `baseline: true` discriminator on `AgentTile`. **Felix decides the host-side shape** (tech call); document the chosen identifier names in the PR body for E-05's vocabulary alignment.

### Acceptance criteria

- AC1: Given a roster with members that have NO matching detected agent, `buildAgentTree` emits a baseline `AgentTile` for each such member (correct `memberId`/`teamId`/`display`/`role`/`memberColor`).
- AC2: Given a detected live agent matching a member, the live tile takes precedence over that member's baseline (no duplicate tile for the same `memberId` within a team).
- AC3: Member declaration order in `teams.yaml` is preserved in `rosterTiles[teamId]` ordering for baseline + live tiles alike (extends existing member-order sort at `reducer.ts:269-277`).
- AC4: Existing M3-10 persona-collapse behavior for N≥1 live agents is unchanged (regression-guarded).
- AC5: Baseline tiles carry a clearly-discriminable liveness representation distinct from `idle`/`finished` (so the webview + the existing hide-idle/hide-finished filters treat "never ran" correctly — a baseline tile must NOT be hidden by `hideIdleAgents` since it isn't idle-from-running, it's never-run; confirm interaction with `hideIdleAgents`/`hideFinishedAgents` filters and document).
- AC6: Unit tests cover: roster with 0 detected agents (all baseline), roster with partial detection (mix baseline + live), live agent overlaying its baseline, empty roster (no tiles, unchanged), member-order preservation.

### Out of scope (OOS)

- The baseline tile's VISUAL treatment (E-05 / Iris E-03 — this ticket may render baseline tiles via the existing tile path or a minimal placeholder; re-skin is downstream).
- Persona pixel-character rendering (E-04).
- Hide/remove agent UX (E-06/E-07).
- Any teams.yaml schema change (baseline applies to the roster as-is).

### Done-when test

`npm run typecheck && npm run test:unit` green; new reducer unit tests (AC6) pass; PR body documents the chosen baseline-liveness identifier names (for E-05 vocabulary alignment) + the filter-interaction decision (AC5).

### Files in play

- Owned: `src/extension/state/reducer.ts`, `src/shared/types.ts` (new state value or `baseline` field), `tests/unit/**/reducer*.test.ts`.
- Read-only: `roster-matching.md`, `src/extension/roster/matcher.ts`, `data-sources.md` § Liveness inference.

**Webview-smoke / extension-manifest gate:** NO manifest change. Webview-smoke applies only if a webview render path changes; if E-01 keeps the existing render path, AC(a) data-plane smoke per sub-agent GUI gap suffices.

---

## E-02 — `fix(webview): elevate resolved session title over the SESSION-uuid line`

**Owner:** Maya (webview / CSS)
**Peer reviewer:** Felix (data-shape sanity) OR Maya self + Sage QA
**Size:** S
**Priority:** P1 (live-dogfood papercut; self-contained)
**Design-dependency:** **INDEPENDENT** — design-light hierarchy fix; does NOT need the whole-team spec. (If Iris wants to weigh in on exact type ramp, that's a NIT, not a blocker.)
**Source:** EPIC 86ca11187; live dogfood diagnosis 2026-05-28 (sponsor observed `SESSION <uuid>` dominant, resolved title e.g. "claude team - continued" subordinate). Data already on wire via `resolveSessionLabel`.

### Scope

In the session header, the resolved label (`resolveSessionLabel` → `.session-title`) currently reads subordinate to the `SESSION <uuid>` text. Re-order/re-weight the header so the resolved human title is the dominant element and the uuid/short-id is the secondary/metadata line.

- Promote `.session-title` (resolved label) to the visually-dominant position (size/weight/order).
- Demote the `SESSION <uuid>` / short-id to a secondary muted line (or inline metadata).
- Preserve the `gitBranch` chip + `data-label-source` attribute (no behavior change to either).
- Use existing tokens / `--vscode-*` vars per webview rules; no new hardcoded hex.

### Acceptance criteria

- AC1: The resolved session label (`.session-title`) renders as the dominant text in the session header (larger/bolder/first-read), verifiable in the rendered DOM + component test asserting relative ordering/class.
- AC2: The `SESSION <uuid>`/short-id renders as a secondary muted element, still present (not removed — audit value), visually subordinate.
- AC3: `gitBranch` chip and `data-label-source` attribute behavior unchanged (existing tests still pass).
- AC4: All three label tiers still resolve correctly (custom-title / ai-title / workspace-folder) — existing `sessionBlock.test.ts` + `sessionLabel.test.ts` green; add/adjust a component assertion for the new hierarchy.
- AC5: Theme-aware (dark + light) — no hardcoded color that breaks one theme.

### Out of scope (OOS)

- Changing the label-RESOLUTION logic (`resolveSessionLabel` is correct; this is presentation only).
- Removing the uuid/short-id (kept as secondary metadata).
- DEAD-card header changes (E-08).
- Any host-side change.

### Done-when test

`npm run test:unit` green incl. updated `sessionBlock.test.ts` hierarchy assertion; Self-Test Report posted (AC(a) data-plane N/A — pure webview; AC(b-d) interactive screenshots deferred to sponsor post-merge per sub-agent GUI gap, OR sponsor confirms the reload pre-merge if convenient).

### Files in play

- Owned: `src/webview/components/sessionBlock.ts`, `src/webview/styles/dashboard.css`, `tests/unit/webview/sessionBlock.test.ts`.
- Read-only: `src/shared/types.ts` (`resolveSessionLabel`), `vscode-extension-conventions.md` § Session label resolution.

**Webview-smoke / extension-manifest gate:** Webview-smoke YES (renders webview chrome) — sub-agent GUI gap applies; screenshots bind sponsor post-merge.

---

## E-03 — `spec(ux): whole-team-always-visible dashboard — baseline tiles + persona chars + hide/remove + DEAD toggle`

**Owner:** Iris
**Peer reviewer:** Maya (visual) — Felix consulted on any host-side state-shape implication
**Size:** L
**Priority:** P0 (the gate — Wave 1 webview tickets E-04/E-05/E-06 all decompose off this spec)
**Design-dependency:** N/A (this IS the design spec). Dispatchable in PARALLEL with E-01/E-02 (Iris worktree free; no PixelLab conflict).
**Source:** EPIC 86ca11187; DECISIONS.md 2026-05-28; `.claude/docs/persona-pixel-character-animation-prompts.md`; `team/iris-ux/m4-polish-spec.md` (visual-language baseline to extend).

### Scope

Author `team/iris/whole-team-display-spec.md` (NOTE path: Iris's worktree convention — confirm `team/iris-ux/` vs `team/iris/`; prior specs live at `team/iris-ux/`). Four sections, each an implementation-ready ownership zone:

1. **Baseline / available tile visual** — how a never-run roster member's tile looks and how it differs from `idle` (which is run-then-stale) and `finished`. Color/dot treatment, label, opacity. Interaction with `hideIdleAgents`/`hideFinishedAgents` filters (a baseline tile is neither — spec the intended filter semantics so Felix's E-01 AC5 and Maya's E-05 agree).
2. **Persona pixel-character placement** — sprite size at the tile scale (68px refs harvested), placement within the tile, pose→state mapping (`idle*` pool → idle/baseline; `working` → tool≠Read; `reading` → tool==Read), playback requirements (SLOW + per-anim dwell — render-time, NOT regeneration, per the persona-anim doc), reduced-motion fallback (static frame).
3. **Hide / show / remove affordances** — per-tile hide control (icon? hover-reveal?), the "show hidden agents" reveal control (where it lives, what it lists), per-agent un-hide, and the remove control (distinct affordance from hide; confirm-step?). State-persistence note (hidden set persists across reloads; removed returns only via teams.yaml).
4. **DEAD-card handling** — if the sponsor rules a "hide dead" toggle IN (E-08), spec the toggle treatment; if OUT, spec is a one-line "no control — file-driven prune stays" note.

### Acceptance criteria

- AC1: `team/iris*/whole-team-display-spec.md` authored with the four sections above, each with an "Implementation checklist for Maya/Felix" subsection (file-grepable, paste-ready into dispatch briefs).
- AC2: Section 1 defines the baseline/available state's full visual + names the intended `hideIdleAgents`/`hideFinishedAgents` filter interaction (so E-01 AC5 and E-05 are unambiguous).
- AC3: Section 2 maps every harvested pose (`idle`, `idle_snack`, `idle_stretch`, `idle_phone`, `idle_hips`, `working`, `reading`, + the new idle-pool variants once harvested) to a dashboard state, and states the slow/dwell playback requirement + reduced-motion fallback.
- AC4: Section 3 specifies hide vs remove as DISTINCT affordances + the "show hidden" reveal + persistence model; cross-refs the DECISIONS.md hide/remove definitions verbatim (no scope drift — NO auto-hide).
- AC5: Section includes a "Divergences from m4-polish-spec" audit-trail subsection.
- AC6: PR body cites EPIC 86ca11187 + DECISIONS.md 2026-05-28 + the persona-anim doc as sources.

### Out of scope (OOS)

- Implementation (Maya/Felix own Wave 1).
- New sprite generation (PixelLab is orchestrator-only; spec consumes harvested sprites, does not commission them).
- teams.yaml schema design (remove is yaml-gated using the EXISTING schema — re-add a member; no new field).
- The session-title hierarchy fix (E-02, already independent).

### Done-when test

Spec file exists with four implementation-ready sections + checklists; Maya/Felix confirm any Wave 1 section is dispatchable without back-and-forth (the spec-decomposes-ownership-zones test).

### Files in play

- Owned: `team/iris*/whole-team-display-spec.md` (new).
- Read-only: `.claude/docs/persona-pixel-character-animation-prompts.md`, `team/iris-ux/m4-polish-spec.md`, DECISIONS.md, `src/webview/components/agentTile.ts`.

**Webview-smoke / extension-manifest gate:** NO (spec only).

---

## E-04 — `feat(webview): render persona pixel-characters in roster tiles`

**Owner:** Maya (webview)
**Peer reviewer:** Felix
**Size:** L
**Priority:** P1
**Design-dependency:** **DESIGN-DEPENDENT** — await E-03 §2 (placement/size/pose-map/playback). Also depends on harvested sprites being on disk (`assets/sprites/ClaudeTeam-M01-Dev/` etc.) — currently only the original 7 poses are committed; new idle-pool poses NOT yet harvested (see STATE.md). Confirm sprite availability at dispatch.
**Source:** EPIC 86ca11187; E-03 §2; persona-anim doc § Webview wiring note + Naming convention.

### Scope

Render the harvested persona sprite + animation in each roster tile per E-03 §2. Build the `metadata.json` reverse-map (`animation_name → folder`), select the pose by dashboard state (`idle*` pool random for idle/baseline; `working` for tool≠Read; `reading` for tool==Read), and play frames with SLOW + per-anim dwell timing (render-time control — webview holds each frame; optional per-frame dwell overrides per persona-anim doc § Playback speed). Reduced-motion → static frame.

### Acceptance criteria

- AC1: A tile for a roster member with harvested sprites renders the persona character (south-facing frames) at the E-03-specified size.
- AC2: Pose selection follows the pose→state map (reading on Read, working on other tools, idle-pool otherwise/baseline); idle pool selects across `idle*` variants.
- AC3: Playback is slow (per-anim default ms from E-03/persona-anim doc) with the specified dwell-before-restart; NOT real-time.
- AC4: `@media (prefers-reduced-motion: reduce)` → single static frame, no animation.
- AC5: Members without harvested sprites fall back gracefully to the current dot/tile (no broken-image).
- AC6: Reverse-map sourced from each group's `metadata.json` (not hardcoded folder names — UUID-mangled per the doc).

### Out of scope (OOS)

- Generating sprites (orchestrator-only PixelLab).
- Baseline tile non-sprite visual (E-05).
- Hide/remove UX (E-06/E-07).

### Done-when test

`npm run test:unit` green incl. reverse-map + pose-selection unit tests; Self-Test Report (AC(a) data-plane smoke materializing a tile with sprite; AC(b-d) screenshots deferred to sponsor — webview-smoke + GUI-gap).

### Files in play

- Owned: `src/webview/components/agentTile.ts`, sprite-loader/reverse-map module (new), `src/webview/styles/dashboard.css`, `tests/unit/webview/**`.
- Read-only: `assets/sprites/**/_pixellab_anims/**/metadata.json`, persona-anim doc, E-03 spec.

**Webview-smoke / extension-manifest gate:** Webview-smoke YES. If sprite assets change `.vsiignore`/bundling, extension-manifest gate may apply — confirm at dispatch.

---

## E-05 — `feat(webview): baseline / available tile skin`

**Owner:** Maya (or Felix if purely token-level) — webview
**Peer reviewer:** Felix
**Size:** S–M
**Priority:** P1
**Design-dependency:** **DESIGN-DEPENDENT** — await E-03 §1 (baseline visual) AND E-01 merged (wire shape + chosen liveness identifier). Pattern A sequencing: E-01 → E-05.
**Source:** EPIC 86ca11187; E-03 §1; E-01 wire shape.

### Scope

Skin the baseline/available state that E-01 introduces on the wire, per E-03 §1. Render the baseline tile distinctly from idle/finished (per spec); honor the filter-interaction decision (baseline NOT hidden by hide-idle/hide-finished).

### Acceptance criteria

- AC1: Baseline tiles render with the E-03 §1 visual treatment, distinct from idle/finished.
- AC2: The webview consumes E-01's exact liveness identifier (vocabulary-aligned — grep E-01's merged shape, do not invent).
- AC3: `hideIdleAgents`/`hideFinishedAgents` do NOT hide baseline tiles (per E-01 AC5 + E-03 §1 decision).
- AC4: Theme-aware; unit/component tests for baseline render + filter interaction.

### Out of scope (OOS)

- Persona sprite (E-04 — may compose, but sprite rendering is E-04's deliverable).
- The reducer change (E-01).
- Hide/remove controls (E-06/E-07).

### Done-when test

`npm run test:unit` green incl. baseline-render + filter-interaction tests; Self-Test Report (data-plane smoke + deferred screenshots).

### Files in play

- Owned: `src/webview/components/agentTile.ts`, `src/webview/styles/dashboard.css`, `tests/unit/webview/**`.
- Read-only: E-01's merged `src/shared/types.ts` shape, E-03 spec.

**Webview-smoke / extension-manifest gate:** Webview-smoke YES.

---

## E-06 — `feat: hide agent (reversible, manual) — host filter + webview controls`

**Owner:** Felix (host: persisted hidden-set + filter) + Maya (webview: hide/show controls + "show hidden" reveal). Decompose into E-06a (Felix) + E-06b (Maya) at dispatch, OR single ticket with both lanes if scope stays S/M.
**Peer reviewer:** cross-pair (Felix↔Maya)
**Size:** M (combined) — split if it grows
**Priority:** P1
**Design-dependency:** **DESIGN-DEPENDENT** — await E-03 §3 (affordances + persistence model).
**Source:** EPIC 86ca11187; DECISIONS.md 2026-05-28 (hide = reversible in-UI cull, persists across reloads, NO auto-hide); E-03 §3.

### Scope

Per-tile "hide" drops a member from the default view; a "show hidden agents" toggle reveals hidden members; per-agent "show" un-hides. Hidden set PERSISTS across reloads (workspaceState or settings — Felix's tech call). Reversible; entirely user-driven (NO automatic hide-by-inactivity — sponsor-rejected, guard against re-introducing).

- **Host (E-06a):** persisted hidden-member set (keyed by `memberId`+`teamId`); filter applied to the emitted tree (or a flag carried to the webview so the webview filters — design call documented in PR); message protocol additions for hide/show/show-all per `messages.ts` "add a new type, don't overload" rule.
- **Webview (E-06b):** per-tile hide affordance, "show hidden agents" reveal control listing hidden members, per-member un-hide. Consumes the host's persisted state.

**Vocabulary contract (shared concept — REQUIRED at dispatch):** the hidden-set type + the hide/show message types span host↔webview. Name them explicitly: type (e.g. `HiddenMemberKey`), message types (e.g. `ui:hide-member` / `ui:show-member` / `ui:show-all-hidden`), export site (`src/shared/messages.ts` + `src/shared/types.ts`). Sequence host (E-06a) before webview (E-06b) per Pattern A, OR ship the contract block.

### Acceptance criteria

- AC1: Clicking hide on a tile removes that member from the default view.
- AC2: A "show hidden agents" control reveals hidden members; per-member un-hide restores it to the default view.
- AC3: Hidden state persists across webview reload AND window reload (cite the persistence store).
- AC4: Hide is purely user-driven — no code path hides a member automatically (regression-guard: a test asserting no auto-hide-by-time/inactivity exists).
- AC5: Baseline (never-run) members are hide-able (the epic's primary declutter use case).
- AC6: Host + webview unit/integration tests; message round-trip test (JSON-safe per messages.ts constraint).

### Out of scope (OOS)

- Remove agent (E-07 — distinct, more permanent).
- Auto-hide-by-inactivity (EXPLICITLY rejected by sponsor — do NOT implement).
- DEAD-card hide (E-08).

### Done-when test

`npm run typecheck && npm run test:unit && npm run test:integration` green; hide/show round-trip + persistence + no-auto-hide tests pass; Self-Test Report (webview-smoke + GUI-gap).

### Files in play

- Owned (host): `src/extension/state/reducer.ts` or a filter module, `src/extension/view/provider.ts`, `src/shared/messages.ts`, `src/shared/types.ts`, persistence (workspaceState).
- Owned (webview): `src/webview/components/agentTile.ts`, hidden-reveal component (new), `src/webview/messageReceiver.ts`.
- Read-only: E-03 §3, `vscode-extension-conventions.md` § Message protocol (JSON-safe + fire-and-forget caveats).

**Webview-smoke / extension-manifest gate:** Webview-smoke YES. If hide-state is exposed as a setting, extension-manifest gate (package.json `configuration`) applies.

---

## E-07 — `feat: remove agent (yaml-gated restore) — host + webview`

**Owner:** Felix (host) + Maya (webview)
**Peer reviewer:** cross-pair
**Size:** S–M
**Priority:** P2
**Design-dependency:** **DESIGN-DEPENDENT** — await E-03 §3 + builds on E-06 (shares the cull-action surface + persistence pattern).
**Source:** EPIC 86ca11187; DECISIONS.md 2026-05-28 (remove = fully suppressed, not even under "show hidden"; returns ONLY by re-adding to teams.yaml).

### Scope

Per-tile "remove" fully suppresses a member (NOT shown even under "show hidden"); the member returns ONLY by re-adding it to teams.yaml. Distinct affordance from hide (E-06). Uses the EXISTING teams.yaml schema (re-add the member entry) — no new schema field.

### Acceptance criteria

- AC1: Removing a member fully suppresses its tile — not in default view, not under "show hidden agents".
- AC2: Removed state persists across reloads (cite store).
- AC3: Re-adding the member to teams.yaml (or removing the removal record) restores the member on the next roster reload — verify the roster-watcher path reinstates it.
- AC4: Remove is a DISTINCT affordance from hide (per E-03 §3); a confirm-step if E-03 specifies one.
- AC5: Tests: remove suppresses beyond show-hidden; yaml re-add restores; persistence.

### Out of scope (OOS)

- New teams.yaml schema fields (uses existing member entries).
- Hide (E-06).
- Editing teams.yaml from the UI (V1 is YAML-only config per M3 decisions; restore is a manual sponsor edit).

### Done-when test

`npm run typecheck && test:unit && test:integration` green; remove + yaml-restore + persistence tests pass; Self-Test Report.

### Files in play

- Owned (host): removed-set persistence + filter, roster-reload reinstate path, `src/shared/messages.ts`/`types.ts`.
- Owned (webview): remove affordance on tile, `src/webview/messageReceiver.ts`.
- Read-only: E-03 §3, `roster-matching.md` § Config locations + watcher.

**Webview-smoke / extension-manifest gate:** Webview-smoke YES.

---

## E-08 — `feat(webview): hide-dead-session toggle` (PENDING SPONSOR IN/OUT)

**Owner:** Maya (webview) — if IN scope
**Peer reviewer:** Felix
**Size:** XS–S
**Priority:** P3
**Design-dependency:** **BLOCKED on a sponsor IN/OUT decision** (queued to orchestrator). If IN, also depends on E-03 §4.
**Source:** EPIC 86ca11187; live dogfood 2026-05-28 (dead session cards persist header-only + "dead" badge until Claude Code deletes `~/.claude/sessions/{pid}.json`; no "hide dead" control).

### Decision needed (orchestrator → sponsor)

DEAD cards already self-prune when the process file is removed (file-driven, `vscode-extension-conventions.md` § DEAD prune semantics). The question is whether a MANUAL "hide dead" control is wanted for the window between process-exit and file-cleanup.

**Nora's recommendation: defer / likely CUT for V1.5.** The dead window is typically seconds (the FS-watcher fires `onDidDelete` → out-of-band tick). A manual toggle adds UI + persisted state for a transient condition. Recommend the sponsor only takes this IN if dogfood shows dead cards persisting long enough to annoy (e.g. Claude Code not cleaning up `{pid}.json` promptly on reload). If IN, it's the smallest ticket; if OUT, E-03 §4 is a one-line "no control" note.

### Scope (if IN)

A "hide dead sessions" toggle that suppresses dead-session headers from the view; persisted; reversible. Does NOT change the file-driven prune lifecycle — purely a display filter for the transient window.

### Acceptance criteria (if IN)

- AC1: A "hide dead sessions" toggle suppresses dead-session headers when on.
- AC2: Toggle state persists across reload.
- AC3: Live sessions unaffected; lifecycle prune behavior unchanged when toggle off.
- AC4: Tests for toggle on/off + persistence.

### Out of scope (OOS)

- Changing the file-driven prune lifecycle.
- Auto-hiding dead cards by age (would be auto-cull — against the epic's no-auto-hide principle; if any timed behavior is wanted, surface explicitly to sponsor).

### Files in play (if IN)

- Owned: `src/webview/components/sessionBlock.ts`, toggle control, `src/webview/styles/dashboard.css`.

**Webview-smoke / extension-manifest gate:** Webview-smoke YES (if IN).

---

## E-09 — `test(qa): whole-team-always-visible epic — test plan + QA pass`

**Owner:** Sage
**Peer reviewer:** Felix (host-side) / Maya (webview-side) per Sage-PR routing
**Size:** M
**Priority:** P1
**Design-dependency:** Depends on the impl tickets it covers (E-01/E-04/E-05/E-06/E-07, + E-08 if IN). Test PLAN can be authored off the ACs once E-03 lands; QA PASS runs against merged impl.
**Source:** EPIC 86ca11187; testing-strategy.md three-layer model; the E-01..E-08 ACs.

### Scope

Author a test plan mapping each impl ticket's ACs to Layer 1/2/3 coverage, then run the QA pass once impl merges. Acceptance-criteria → test-plan is Nora→Sage's standard handoff.

### Acceptance criteria

- AC1: Test plan at `team/sage-qa/epic-86ca11187-test-plan.md` covering baseline-tile reducer (L1/L2), persona-sprite render (L1 reverse-map + sponsor visual confirm), hide/remove round-trip + persistence (L1/L2), no-auto-hide regression guard, session-title hierarchy (L1 component).
- AC2: Negative-path assertions named per surface (empty roster, member without sprites, hide-then-reload, remove-then-yaml-restore).
- AC3: QA verdict (APPROVE / REQUEST_CHANGES) per impl PR per Sage's QA contract.

### Out of scope (OOS)

- Authoring impl (E-01..E-08).
- Sprite generation.

### Done-when test

Test plan authored; each impl PR carries Sage's verdict before merge per the reviewer-track gate.

### Files in play

- Owned: `team/sage-qa/epic-86ca11187-test-plan.md`, `tests/**` additions as QA finds gaps.
- Read-only: all E-01..E-08 PRs + testing-strategy.md.

**Webview-smoke / extension-manifest gate:** N/A (QA authors/runs tests; does not change manifest).

---

## Open question for sponsor (queued to orchestrator)

**E-08 DEAD-card hide toggle: IN or OUT for this epic?** Nora recommends OUT/defer (dead window is transient + file-driven prune already handles it). Sponsor decides; if OUT, E-03 §4 collapses to a one-line note.
