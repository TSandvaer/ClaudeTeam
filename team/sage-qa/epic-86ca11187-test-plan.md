# Test Plan — EPIC 86ca11187 (Whole-Team-Always-Visible Dashboard)

**Owner:** Sage (QA) · **Ticket:** E-09 · **Epic:** 86ca11187
**Source ACs:** `team/nora-pl/epic-86ca11187-backlog.md` §§ E-01..E-08
**Layer model:** `.claude/docs/testing-strategy.md` (L1 unit / L2 integration-fixture-FS / L3 @vscode/test-electron + manual reload)

This plan maps each merged-epic surface to its test coverage, names the negative
path per surface, records the AI-testable QA-pass verdict against current `main`,
and flags items that re-run after Maya's E-07b (remove WEBVIEW) merges.

---

## Merge status on `main` at plan time (verified `git log origin/main`)

| Ticket | Surface | PR | Status |
|---|---|---|---|
| E-01 | full-roster baseline reducer + `available` AgentState | #114 | MERGED `2356216` |
| E-02 | session-title prominence (webview) | #113 | MERGED `01ade3b` |
| E-03 | Iris design spec | #109 | MERGED `a3d67c8` |
| E-04 | persona pixel-sprite render (webview) | #116 | MERGED `d28833`→`da7b977` |
| E-05 | baseline/available tile skin (webview) | #117 | MERGED `a7806ba` |
| E-06a | persisted hide-member set + filter + protocol (host) | #115 | MERGED `c445161` |
| E-06b | hide affordance + show-hidden reveal (webview) | #118 | MERGED `b81ce17` |
| E-07a | persisted remove-member set + filter + yaml reinstate (host) | #119 | MERGED `bcf6ea1` |
| **E-07b** | **remove affordance (webview)** | **branch `maya/86ca1agc5-e07b-remove-webview`** | **IN FLIGHT — not pushed to origin; QA items marked `PENDING-E-07b`** |
| E-08 | DEAD-card hide toggle | — | OUT (Nora rec; sponsor deferred — not in epic) |

**Sprite-binding discrepancy (do-not-fail item):** `main`'s
`src/webview/sprites/spriteManifest.ts` carries the 2-member PROVISIONAL binding
`{ felix: "ClaudeTeam-F01-Dev", maya: "ClaudeTeam-M01-Dev" }` (lines 60-61). The
sponsor's 2026-05-29 gender binding (felix/bram→M01-Dev; maya/iris/nora/sage→F01-Dev)
lands via Maya's E-07b PR and is NOT yet on `main`. The current binding is both
2-member-only AND gender-crossed relative to the intended mapping. This is the
expected pre-E-07b state — the persona-sprite reverse-map plumbing (E-04) is what
this plan tests; the member→face *binding values* are sponsor-visual-confirm
deferred and re-checked when E-07b merges.

---

## Surface-by-surface coverage map

### S1 — E-01 full-roster baseline tiles (`available` AgentState) — HOST / reducer

Root change: `buildAgentTree` (`src/extension/state/reducer.ts:269-329`) seeds a
baseline `available` `AgentTile` for every `teams.yaml` member with NO detected
agent; a detected agent overlays (wins) its baseline slot.

| AC | Coverage | Layer | Test |
|---|---|---|---|
| E-01 AC1 baseline tile per never-run member | reducer emits `available` tile w/ correct memberId/teamId/display/role/color | L1 | `tests/unit/reducer.test.ts` (baseline-seed describe) |
| E-01 AC2 live overlays baseline (no dup per memberId) | detected tile wins; no second tile for same memberId | L1 | `tests/unit/reducer.test.ts` |
| E-01 AC3 member-declaration-order preserved | sort at `reducer.ts:331-339` keeps baseline + live interleaved in yaml order | L1 | `tests/unit/reducer.test.ts` |
| E-01 AC4 M3-10 collapse unchanged (N≥1) | `groupTilesByPersona` still groups detected N>1 | L1 | `tests/unit/webview/collapsedPersonaTile.test.ts` + reducer group tests |
| E-01 AC5 `available` distinct from idle/finished; NOT hidden by hide-idle/hide-finished | filter-interaction | L1 | `tests/unit/availableFilterInteraction.test.ts` |
| E-01 AC6 partial/full/empty roster, overlay, order | reducer matrix | L1 | `tests/unit/reducer.test.ts` |
| live wire round-trip | runTick emits baseline tiles through real FS pipeline | L2 | `tests/integration/watcherLoop.test.ts` |

**Negative path — empty roster:** roster with `teams: []` → zero team cards, zero
baseline tiles, background panel still renders. Covered: `tests/unit/reducer.test.ts`
(empty-roster) + `tests/unit/loader.test.ts` (empty/malformed yaml fallback). The
`available` state must NEVER be emitted for a non-rostered (background) agent —
asserted by reducer's background-bucket tests.

### S2 — E-02 session-title hierarchy — WEBVIEW (L1 component)

`resolveSessionLabel` data is unchanged; E-02 is markup/CSS order so the resolved
title is dominant and `SESSION <uuid>` is the muted secondary chip.

| AC | Coverage | Layer | Test |
|---|---|---|---|
| E-02 AC1 resolved label dominant | DOM order/class assertion | L1 | `tests/unit/webview/sessionBlock.test.ts` |
| E-02 AC2 uuid/short-id demoted, still present | secondary muted element present | L1 | `tests/unit/webview/sessionBlock.test.ts` |
| E-02 AC3 gitBranch chip + `data-label-source` unchanged | existing assertions still green | L1 | `tests/unit/webview/sessionBlock.test.ts` + `tests/unit/sessionLabel.test.ts` |
| E-02 AC4 all three label tiers resolve | custom/ai/workspace fallback | L1 | `tests/unit/sessionLabel.test.ts` (23) |
| E-02 AC5 theme-aware | `--vscode-*` tokens, no hardcoded hex | L3/manual | sponsor post-merge confirm (GUI gap) |

**Negative path — empty / whitespace title:** customTitle whitespace → falls
through to ai-title; ai-title `(no title yet)` sentinel → workspace-folder
fallback. Covered: `sessionLabel.test.ts` priority-chain edge cases.

### S3 — E-04 persona pixel-sprite reverse-map — WEBVIEW (L1)

Reverse-map (`animation_name → folder` via committed `animations.json`), pose→state
selection, slow/dwell playback, reduced-motion fallback, graceful no-sprite fallback.

| AC | Coverage | Layer | Test |
|---|---|---|---|
| E-04 AC1 tile renders persona sprite (south frames) at spec size | sprite tile render | L1 | `tests/unit/webview/spriteTile.test.ts` (14) |
| E-04 AC2 pose→state map (reading=Read, working≠Read, idle-pool else) | pose picker | L1 | `tests/unit/webview/posePicker.test.ts` |
| E-04 AC3 slow + dwell playback (not real-time) | frame-timing | L1 | `tests/unit/webview/spriteTracker.test.ts` |
| E-04 AC4 reduced-motion → static frame | `prefers-reduced-motion` branch | L1 | `tests/unit/webview/spriteTile.test.ts` / `spriteTracker.test.ts` |
| E-04 AC5 members without sprites → graceful dot/tile fallback (no broken-image) | manifest fallback | L1 | `tests/unit/webview/spriteManifest.test.ts` |
| E-04 AC6 reverse-map sourced from manifest, not hardcoded folder names | manifest read | L1 | `tests/unit/webview/spriteManifest.test.ts` |
| member→face binding VALUES (gender mapping) | — | sponsor visual confirm | **DEFERRED** — provisional 2-member binding on main; re-check at E-07b merge |

**Negative path — member without sprites:** `spriteManifest` returns no charName
→ tile renders the legacy dot, no `<img>` 404. Covered: `spriteManifest.test.ts`
fallback case + `spriteTile.test.ts` no-sprite branch. **OOS guard:** this plan does
NOT edit `spriteManifest.ts` or its binding test (Maya owns in E-07b).

### S4 — E-05 available/baseline tile skin — WEBVIEW (L1)

| AC | Coverage | Layer | Test |
|---|---|---|---|
| E-05 AC1 baseline tile distinct visual from idle/finished | render | L1 | `tests/unit/webview/availableTile.test.ts` |
| E-05 AC2 consumes E-01's exact `available` liveness identifier | vocabulary-aligned (no invented value) | L1 | `tests/unit/webview/availableTile.test.ts` |
| E-05 AC3 hide-idle/hide-finished do NOT hide baseline | filter interaction (webview side) | L1 | `tests/unit/availableFilterInteraction.test.ts` |
| E-05 AC4 theme-aware; render + filter tests | component | L1 | `tests/unit/webview/availableTile.test.ts` |

**Negative path — baseline under active filters:** with `hideIdleAgents=true` AND
`hideFinishedAgents=true`, a team whose only live tile was finished-and-hidden
still renders its `available` baselines (card does NOT vanish). This is the
load-bearing filter-interaction assertion — covered `availableFilterInteraction.test.ts`.

### S5 — E-06 hide round-trip + persistence — HOST (E-06a) + WEBVIEW (E-06b)

| AC | Coverage | Layer | Test |
|---|---|---|---|
| E-06 AC1 hide drops member from default view | filter suppression | L1 | `tests/unit/hideMembersFilter.test.ts` |
| E-06 AC2 show-hidden reveals; per-member un-hide restores | store mutation + webview reveal | L1 | `tests/unit/hiddenMembersStore.test.ts` + `tests/unit/webview/hideMember.test.ts` |
| E-06 AC3 persists across webview + window reload | workspaceState rehydrate | L1 | `tests/unit/hiddenMembersStore.test.ts` (rehydrate from memento) |
| E-06 AC4 **no auto-hide** regression-guard | store has no time/inactivity mutator; filter pure-read | L1 | `tests/unit/hiddenMembersStore.test.ts:162` + `tests/unit/hideMembersFilter.test.ts:356` |
| E-06 AC5 baseline (never-run) members are hide-able | hide an `available` tile | L1 | `tests/unit/hideMembersFilter.test.ts` |
| E-06 AC6 message round-trip JSON-safe | `ui:hide/show/show-all` | L1 | `tests/unit/webviewMessageDispatch.test.ts` + `tests/unit/messageBus.test.ts` |

**Negative path — hide-then-reload:** rehydrate store from a persisted memento and
assert the member stays hidden (no reset-to-visible on boot). Covered by
`hiddenMembersStore.test.ts` rehydrate. **Negative path — hide all members:** team
card empties → team key pruned from `teamOrder` (no empty card). Covered in
`hideMembersFilter.test.ts`.

### S6 — E-07 remove (suppress-beyond-show-hidden + yaml restore + persistence)

E-07a (host) MERGED; E-07b (webview affordance) IN FLIGHT.

| AC | Coverage | Layer | Test | Status |
|---|---|---|---|---|
| E-07 AC1 remove suppresses beyond default AND show-hidden | filter drops; `removedMemberKeys` (not hidden) on wire so reveal never offers it | L1 | `tests/unit/removeMembersFilter.test.ts` (host) | NOW |
| E-07 AC2 removed persists across reloads | workspaceState rehydrate (armed flag) | L1 | `tests/unit/removedMembersStore.test.ts` | NOW |
| E-07 AC3 yaml re-add restores on next roster reload | `reconcile()` absent→present arm semantics | L1 | `tests/unit/removedMembersStore.test.ts` (reconcile) | NOW |
| E-07 AC3 reinstate via roster-watcher path (live) | roster reload triggers reconcile + re-emit | L2 | `tests/integration/rosterWatcher.test.ts` (reinstate path — verify present; add if gap) | NOW |
| E-07 AC4 remove is DISTINCT affordance from hide (+ confirm step if spec'd) | webview affordance | L1 | E-07b `tests/unit/webview/**` | **PENDING-E-07b** |
| E-07 AC5 tests: remove>show-hidden, yaml-restore, persistence | host covered; webview affordance | L1 | host: NOW; affordance: **PENDING-E-07b** |
| E-07 webview: removed member never offered an un-hide control | reveal surface consumes `removedMemberKeys` | L1 | E-07b webview reveal test | **PENDING-E-07b** |

**Negative path — remove-then-yaml-restore:** (a) `remove()` adds un-armed →
suppressed but NOT reinstated on the immediate next reload (member still in yaml);
(b) reconcile with member ABSENT → arms the key; (c) reconcile with member PRESENT
again → reinstates (tile reappears). All three arms covered:
`removedMembersStore.test.ts` reconcile describe. **Negative path — corrupt memento:**
non-object / bare-string-array persisted shape tolerated (dropped, no throw) —
covered in `removedMembersStore.test.ts` rehydrate-defensive.

### S7 — NO-AUTO-HIDE / NO-AUTO-REMOVE end-to-end regression guard (bug class)

**Why this is its own surface:** the unit guards (S5 AC4 / S6) prove the *filter*
and the *store* don't auto-populate. They do NOT prove that nothing UPSTREAM in the
live tick pipeline (reducer → state-driven filters → member filters → wire
serialize) ever feeds a member into the hidden/removed set as a side effect of an
idle/finished/stale tile appearing. Asserting `X.size === 0` after one filter call
catches the instance; driving the FULL `runTick` pipeline across MULTIPLE ticks
with cull-eligible states present and asserting both persisted sets stay empty
catches the bug CLASS (an auto-hide reintroduced anywhere in the chain).

**New test (this PR):** `tests/integration/noAutoCullPipeline.test.ts` (NEW file —
does not touch existing store/filter tests or `spriteManifest.ts`). Wires REAL
`HiddenMembersStore` + `RemovedMembersStore` (in-memory mementos) into `runTick`
via `getHiddenMemberKeys`/`getRemovedMemberKeys`, materializes a fixture FS with a
running + an idle (stale-mtime) + a finished agent across N ticks, and asserts:

- Both stores' `.keys().size === 0` after every tick (sponsor REJECTED auto-hide
  — DECISIONS §36).
- `hiddenMemberKeys` / `removedMemberKeys` on the emitted wire stay `[]`.
- Idle + finished tiles remain present in the tree (NOT silently suppressed by a
  time/inactivity path) when both member-sets are empty and hide-idle/hide-finished
  are OFF (V1 whole-team-always-visible default).

This is the regression guard E-09 AC1 names; it complements (does not duplicate)
the unit-level banned-method + pure-read guards.

---

## Layer-3 / manual (sponsor post-merge, sub-agent GUI gap)

Per `testing-strategy.md` § "Sub-agent GUI gap": webview-touching ACs (E-02/E-04/
E-05/E-06b/E-07b) have data-plane smoke as the load-bearing pre-merge gate; the
interactive `Reload Window` + tile-click + theme-toggle screenshots bind sponsor
post-merge. Sage does NOT REQUEST CHANGES solely for missing screenshots when the
data-plane smoke is present and cited.

Existing L3 automated coverage that backstops the manual checklist:
`tests/vscode-integration/suite/{activation,webviewSmoke,themeSwitch,drillIn,rosterHotReload}.test.ts`.

---

## QA-pass verdict (AI-testable, against current `main`)

- **Full suite green at plan time:** unit **919 passed / 2 skipped** (47 files);
  integration **121 passed** (9 files). Re-run with the new S7 guard reported in
  the PR body.
- **PASSES NOW:** S1 (E-01 reducer/baseline), S2 (E-02 title), S3 (E-04 reverse-map
  plumbing — binding VALUES deferred), S4 (E-05 skin + filter interaction), S5 (E-06
  hide round-trip + persistence + no-auto-hide), S6 host arm (E-07a remove filter +
  store reconcile + persistence), S7 (new no-auto-cull pipeline guard).
- **PENDING-E-07b:** S6 webview affordance items (E-07 AC4, remove-vs-hide distinct
  affordance, removed-never-revealed in webview reveal surface), and re-confirm of
  the 6-member gender sprite binding (S3 binding VALUES). Re-run these after Maya's
  E-07b PR merges.
- **DEFERRED (sponsor visual):** E-02 AC5 theme, E-04 AC1/AC3 visual playback feel,
  all interactive-screenshot ACs — post-merge confirm per GUI gap.

## Per-PR QA routing reminder (E-09 AC3)

When dispatched to QA an individual epic PR, apply Sage's QA contract
(`testing-strategy.md` § "Sage's QA contract"): REQUEST CHANGES on missing
Self-Test Report / unconfirmed AC walkthrough / missing regression test for the
bug class / unhandled schema-drift (parser PRs) / no negative-path assertion.
Host PRs → Felix peer-reviews; webview PRs → Maya. Sage cannot self-QA Sage's
own test PRs (this one routes to Felix, host-side).
