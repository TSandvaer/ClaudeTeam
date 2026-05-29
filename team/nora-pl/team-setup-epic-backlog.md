# Team-Setup EPIC Backlog — Project-scoped setup + Manage Team panel + Character picker (Marketplace-ready)

Breakdown of the **team-setup EPIC** (sponsor /grill-me 2026-05-29; 7 LOCKED design decisions) into dispatch-ready child tickets. Authored away-mode by Nora (PL).

> **ClickUp creation:** the Nora session does NOT have the ClickUp `create_task` MCP tool surfaced at runtime (the documented sub-agent MCP gap — see `team/log/clickup-pending.md` § "Why this exists"). The orchestrator creates the EPIC + 4 child tickets in list `901523520912` (status `to do`) from the sections below. A creation-request block is appended to `team/log/clickup-pending.md`. After creation the orchestrator backfills the ClickUp IDs into each header here.

---

## Epic thesis

ClaudeTeam today loads a sponsor-hand-authored **global** roster at `~/.claudeteam/teams.yaml`. That blocks Marketplace distribution: a fresh install against an arbitrary project has nothing to show and forces the user to hand-edit a global YAML file they've never heard of.

This epic flips the model to **project-scoped, self-setup, Marketplace-ready**:

1. The roster lives **per-project** at `<workspace>/.claude/claudeteam.yaml` (the global file is DROPPED).
2. The extension **detects** orchestration setup (`.claude/agents/`) and **walks the user through setup** — scan agents, curate, generate the YAML — with zero file hand-editing.
3. A dedicated **"Manage Team" webview panel** owns the YAML format and lets users edit display names / roles and pick a pixel **character** per member from a grid.
4. Characters ship **bundled** (every install has working defaults) and can be **extended** from an optional user folder at runtime. The hardcoded gender→character binding is replaced with a per-member choice persisted in the YAML.

This is the gate to a publishable extension; Marketplace publication itself is a separate downstream milestone.

---

## Grounding (verified this session against the live worktree)

- **Match-key vocabulary already supported.** `src/extension/roster/matcher.ts:42-43` evaluates `agentType_equals` against `meta.agentType`; `src/extension/roster/schema.ts:55-61` validates a member as `{ id, display, role, color?, match[] }`; `src/shared/types.ts:98-101,132` declares `MatchRule` (incl. `{ agentType_equals: string }`) and `Member.match: MatchRule[]`. **No matcher/schema rule change is needed** to seed `match: [{ agentType_equals: "<agentname>" }]` — Decision 4 sits on existing rails.
- **Global path is wired in 3 places that must be retargeted/dropped** (Decision 1): `src/cli/agentTree.ts:52` (CLI default `~/.claudeteam/teams.yaml`), `src/extension/commands/openRoster.ts` (the whole `claudeteam.openRoster` command auto-creates `~/.claudeteam/teams.yaml`), and `src/extension/main.ts:190` (global path resolution + `package.json:51` command contribution + `package.json:86` `rosterPath` description).
- **Per-project resolution partially exists.** `src/extension/main.ts:482` already computes `<folder>/.claude/teams.yaml` for the FIRST workspace folder — the file NAME changes to `claudeteam.yaml` and the global half is removed. Multi-root is first-folder-only today (matches ratify-on-return default).
- **Bundled-vs-runtime asset split is real.** `.vscodeignore` excludes `assets/` from the `.vsix`; the build "copies the needed PNG frames + bakes the manifest into `dist/webview/` (86ca191uy)". So bundled characters already flow through `dist/` — Decision 7(a) extends that existing path; 7(b) (runtime user folder) is net-new.
- **Webview message protocol is a discriminated union.** `src/shared/messages.ts` already carries `ui:open-roster`, `ui:hide-member`, `ui:show-member`, `ui:show-all-hidden`, `ui:remove-member` and host→webview `state:*` / `roster:*`. New `ui:*` types are ADDED (never overload — messages.ts rule), JSON-safe payloads only (no Map/Set/Date — validated M2-04).
- **Sub-agent GUI gap** applies to every webview-touching ticket here: AC(a) live-data-plane smoke is load-bearing pre-merge; interactive screenshots defer to sponsor post-merge (testing-strategy.md § "Sub-agent GUI gap"). The **install-path validation** (`vsce package` + `code --install-extension` + Activity-Bar open + zero ERR_REQUIRE_ESM) binds at the first shipping PR and needs a GUI-capable executor (sponsor) named at dispatch.

---

## Vocabulary contract (LOCKED — Felix + Maya MUST use these identifiers verbatim)

Per the user-global parallel-agent shared-concept rule + orchestration-overview.md § "Iris-leads-with-spec decomposes parallel-safe ownership zones". TS-02 (Felix) lands these FIRST (Pattern A); TS-03 (Maya) imports them.

**`claudeteam.yaml` file shape** (panel-owned; structured write, normalized on save — NOT comment-preserving):

```yaml
# claudeteam.yaml — project-scoped, panel-managed. Do not hand-edit while the
# Manage Team panel is open; the panel normalizes on save.
version: 1
teams:
  - id: <kebab>
    name: "<display>"
    members:
      - id: <kebab, stable>               # internal id (stable across renames)
        display: "<editable display name>" # editable
        role: "<editable role/title>"      # editable; MAY be empty (lean optional)
        character: "<character-id | null>" # per-member character; null = text tile
        status: live | orphaned            # orphaned = agent file removed, kept greyed
        match:
          - agentType_equals: "<agentname>" # IMMUTABLE; seeded from agents/*.md filename
```

- **Type names (TS-02 authors in `src/shared/types.ts`):**
  - `ClaudeTeamConfig` — the parsed top-level `{ version: number; teams: Team[] }` for the new file (distinct from the existing `RosterFile`; introduced so the loader can branch cleanly during the migration window). Felix decides whether to extend `RosterFile` or introduce `ClaudeTeamConfig` — **document the chosen name in the TS-02 PR body** so Maya + Sage align.
  - `ScannedAgent` — `{ agentName: string; filePath: string }` — one entry per `.claude/agents/*.md` file from the scanner.
  - `MemberCharacter` — the per-member character binding stored as `Member.character: string | null` (character-id referencing a `CharacterSource` entry; `null` = unassigned → text tile).
  - `CharacterSource` — `{ id: string; label: string; origin: "bundled" | "user"; thumbnailPath: string }` — one entry per discoverable character; picker grid renders the merged list (bundled + user).
  - `MemberStatus` — string-literal union `"live" | "orphaned"` on `Member.status`.
- **Detection result type:** `SetupDetectionState` — string-literal union `"suggest-setup" | "empty" | "configured"` (the trichotomy of Decision 2). Host computes it; webview switches on it.
- **Message types (TS-02 authors in `src/shared/messages.ts`; webview consumes):**
  - Host→Webview: `setup:detection` `{ state: SetupDetectionState; scanned: ScannedAgent[] }`, `setup:characters` `{ sources: CharacterSource[] }`, `setup:config-saved` `{ ok: boolean; error?: string }`.
  - Webview→Host: `ui:open-manage-team`, `ui:run-setup` `{ include: string[] }` (agentNames to include), `ui:save-team` `{ config: ClaudeTeamConfig }`, `ui:assign-character` `{ memberId: string; character: string | null }`, `ui:confirm-orphan-delete` `{ memberId: string }`, `ui:dismiss-setup-suggestion`.
  - All payloads JSON-safe (no Map/Set/Date). Add new types; never overload existing ones.
- **Character-source resolver (TS-02 authors host-side):** `resolveCharacterSources()` → merges bundled (`dist/`-baked) + optional user-folder characters into `CharacterSource[]`, dedupes by `id` (bundled wins on collision; document the tiebreak in the PR body). Picker thumbnail source = ratify-on-return (likely south rotation frame).

---

## Sequencing — the load-bearing call

**TS-01 (Iris UX spec) is the solo gate.** Everything visual + the file-surface decomposition depends on it (validated 3× in V1). After it lands:

- **TS-02 (Felix host)** lands the Vocabulary-contract types/schema/messages FIRST (Pattern A — new-type introduction defaults to sequencing), then the scanner / gen / resolution / drift / orphan / character-source / bundled-baking host work.
- **TS-03 (Maya webview)** dispatches AFTER TS-02's types merge to main (Pattern A: `src/shared/types.ts` + `messages.ts` are the shared files). Maya builds the Manage Team panel + 3 dashboard states + empty-state + suggest-setup affordance against the merged vocabulary.
- **TS-04 (Sage QA)** spans the impl tickets; the scanner / gen / resolution / matcher / orphan unit + integration tests can begin against TS-02; the panel tests follow TS-03.

**Recommended dispatch order:**
1. **Wave 0:** TS-01 (Iris) solo.
2. **Wave 1:** TS-02 (Felix) — types/schema/messages first commit, then host impl in the same PR or a fast Pt-1/Pt-2 split if it grows past L.
3. **Wave 2:** TS-03 (Maya) after TS-02 merges. TS-04 (Sage) in parallel on the host surface, extending to the panel after TS-03.

---

## TS-01 — `spec(setup): team-setup + Manage Team panel + character-picker UX spec`

**Owner:** Iris
**Peer reviewer:** Maya (visual) — orchestrator-routes per design-PR pairing
**Size:** L
**Priority:** P0 (epic gate — every other ticket depends on this spec)
**Source:** team-setup EPIC; 7 LOCKED decisions; ratify-on-return open items.

### Scope
Author `team/iris-ux/team-setup-spec.md` covering the full UX surface and decomposing the file surface into parallel-safe ownership zones for Felix (host) + Maya (webview). The spec MUST resolve the four ratify-on-return items as **spec proposals** (sponsor ratifies on return — flag each clearly as `PROPOSAL — sponsor ratify`).

Cover:
1. **Detection trichotomy + states** (Decision 2): the three `SetupDetectionState` values and what the dashboard renders in each — `suggest-setup` (>=2 agents, no config), `empty` (<2 agents) with EXACT copy "This project has no orchestration setup, nothing to show", `configured` (normal dashboard).
2. **Setup wizard** (first-run, Decision 3): scan-agents list with include/exclude checkboxes; the generated-YAML preview/confirm step; what a fresh member looks like (display = agentName seed, role blank, character unassigned/text tile).
3. **Manage Team panel** (Decision 5): edit list (display names + roles, with role optional-vs-required resolved as a proposal); the character-picker grid (thumbnails, merged bundled+user sources, assign/clear per member); reopen affordance; save→normalize behavior messaging ("panel owns the format").
4. **Suggest-setup affordance** (ratify item): propose toast vs in-panel card + dismiss/remember behavior.
5. **Empty-state card** — exact copy + visual treatment.
6. **Orphan/stale treatment** (Decision 3): greyed, non-live tile, confirm-delete affordance.
7. **Orchestrator-not-a-tile** (Decision 6): note the constraint so the panel/list never offers the main session as a member.

### Acceptance criteria
- AC1: Spec covers all three `SetupDetectionState` renders with the empty-state EXACT copy quoted verbatim.
- AC2: Setup-wizard flow specified end-to-end (scan → curate include/exclude → preview → confirm → first dashboard render).
- AC3: Manage Team panel specified: edit fields (display, role), character-picker grid (thumbnail layout, assign/clear, bundled+user merge, unassigned=text tile), reopen path.
- AC4: All four ratify-on-return items addressed as labelled `PROPOSAL — sponsor ratify` (user-character-folder path + validation + thumbnail source; suggest affordance toast-vs-card + dismiss; role optional-vs-required [lean optional]; multi-root [default first folder]).
- AC5: Spec decomposes the file surface into Felix-zone vs Maya-zone ownership (so Wave-1/2 dispatch is parallel-safe) and references the Vocabulary contract identifiers in this backlog by name.
- AC6: Orphan/stale visual + orchestrator-not-a-tile constraint documented.

### Out of scope (OOS)
- Implementation (host or webview) — spec only.
- PixelLab character generation (characters already exist / are a separate pipeline).
- Marketplace listing copy / store assets (downstream publication milestone).
- Re-opening any of the 7 LOCKED decisions.

### Done-when test
`team/iris-ux/team-setup-spec.md` committed; PR body lists each AC with the spec section that satisfies it; the four ratify-on-return proposals are each labelled and findable. Orchestrator-direct review (Iris design spec; Maya peer for visuals).

### Files in play
- `team/iris-ux/team-setup-spec.md` (new).

### Dependencies
- None — this is the gate. References this backlog's Vocabulary contract.

---

## TS-02 — `feat(host): claudeteam.yaml scanner + gen/read/write + project-scope + drift/orphan + character sources`

**Owner:** Felix (extension host)
**Peer reviewer:** Maya
**Size:** L (consider a Pt-1 types/schema/messages PR + Pt-2 impl PR if it grows; Pt-1 lands FIRST per Pattern A)
**Priority:** P0 (host foundation — TS-03 + TS-04 depend on the merged types)
**Source:** team-setup EPIC; Decisions 1, 2, 3, 4, 7; grounding refs above.

### Scope
Land the host side of the team-setup epic, **Vocabulary-contract types/schema/messages FIRST** (Pattern A), then the host logic.

1. **Shared types/schema/messages** (commit first): the Vocabulary-contract identifiers in `src/shared/types.ts` + `src/shared/messages.ts` + the zod schema in `src/extension/roster/schema.ts` extended for the new `claudeteam.yaml` shape (`version`, `Member.character`, `Member.status`). **Document the final chosen type names in the PR body** for Maya + Sage alignment.
2. **Agents-folder scanner** (Decision 2): read `<workspace>/.claude/agents/*.md` → `ScannedAgent[]`; count drives the trichotomy (>=2 → suggest-setup). **Verify runtime `agentType` == `agents/*.md` filename** (Decision 4 explicitly calls this out — confirm against a live capture or fixture and document the finding; if they diverge, surface it as a blocker before seeding match-keys).
3. **Detection** (Decision 2): compute `SetupDetectionState` (`configured` if `claudeteam.yaml` exists; else `suggest-setup` if >=2 agents; else `empty`). Emit `setup:detection`.
4. **Gen / read / write** (Decisions 3, 5): generate a starter `ClaudeTeamConfig` from the included `ScannedAgent[]` (seed `match: [{ agentType_equals }]`, `display` = agentName, `role` empty, `character` null, `status: live`); read + validate the file; **structured write that normalizes on save** (panel owns the format — NOT comment-preserving round-trip).
5. **Project-scoped resolution + DROP global** (Decision 1): resolve `<first-workspace-folder>/.claude/claudeteam.yaml`; **remove** the global `~/.claudeteam/teams.yaml` path from `agentTree.ts:52` + `main.ts:190` + retarget/remove the `claudeteam.openRoster` command (`openRoster.ts`, `package.json:51`) + fix `package.json:86` `rosterPath` description. Multi-root = first folder only (ratify default).
6. **File-watch drift + orphan handling** (Decision 3): watch `.claude/agents/` (RelativePattern + polling fallback per conventions); on NEW agents → non-blocking "N new agents found — review" nudge signal (never auto-mutate); on REMOVED agent whose member exists → mark that member `status: orphaned` (kept, greyed, not a live tile) until user confirms deletion via `ui:confirm-orphan-delete`.
7. **User-character-folder runtime scan + bundled baking** (Decision 7): `resolveCharacterSources()` merges bundled (`dist/`-baked) + optional user folder (PixelLab harvest dirs: `_pixellab_anims/` + `animations.json`) into `CharacterSource[]`; bundled wins on id collision (document). Confirm the bundled characters flow through the existing `dist/` build copy (extend `.vscodeignore`/build per 86ca191uy). User-folder exact path = ratify default (use the sponsor-proposed `~/.claudeteam/characters/` placeholder; gate behind a constant Felix can flip when ratified).
8. **Wire `ui:*` handlers**: `ui:run-setup`, `ui:save-team`, `ui:assign-character`, `ui:confirm-orphan-delete`, `ui:open-manage-team`, `ui:dismiss-setup-suggestion` → host actions + `setup:config-saved` ack.

### Acceptance criteria
- AC1: Scanner reads `.claude/agents/*.md` → `ScannedAgent[]`; >=2 → `suggest-setup`, <2 → `empty`, config-present → `configured` (unit-tested across all three).
- AC2: `agentType == agents/*.md filename` is verified against a real capture/fixture; finding documented in PR body (if divergent, flagged as blocker, not silently seeded).
- AC3: Starter `ClaudeTeamConfig` generated from included agents with immutable `match: [{ agentType_equals }]`, `display`=agentName, empty `role`, `character: null`, `status: live`. Round-trips through validated read.
- AC4: Save path writes a normalized `claudeteam.yaml` (structured, not comment-preserving); re-read validates clean.
- AC5: Global `~/.claudeteam/teams.yaml` is GONE — `agentTree.ts:52` + `main.ts:190` retargeted to project `claudeteam.yaml`; `claudeteam.openRoster` command removed or retargeted (no auto-create of the global file); `package.json` command + `rosterPath` description updated. No code path reads the global file. Regression-guarded.
- AC6: File-watch on `.claude/agents/` fires a non-blocking new-agents signal (never mutates); a removed agent flips its member to `status: orphaned` (not deleted) until `ui:confirm-orphan-delete`.
- AC7: `resolveCharacterSources()` merges bundled + user-folder → `CharacterSource[]` with bundled-wins dedupe; bundled chars present after a clean build (no user folder).
- AC8: New `ui:*` + `setup:*` message types added (not overloaded), JSON-safe; handlers wired with `setup:config-saved` acks.
- AC9: Unit + integration tests per testing-strategy layers; negative paths (malformed yaml → error chip behavior preserved; no agents folder; 1-agent folder; orphan flow).

### Out of scope (OOS)
- Manage Team panel UI / dashboard state rendering (TS-03 — Maya).
- The setup-wizard / picker-grid visual layout (TS-01 spec + TS-03 impl).
- PixelLab character generation.
- Marketplace publication / listing.
- Comment-preserving YAML round-trip (explicitly NOT this — panel owns the format).
- Full multi-root resolution (first folder only).

### Done-when test
`npm run typecheck && npm run test:unit && npm run test:integration` green; PR body documents (a) final type names, (b) the `agentType==filename` verification finding, (c) the character-source dedupe tiebreak. Manifest gate (`vsce package --no-yarn` output) REQUIRED — touches `package.json` (command removal + description). Maya peer-review; Sage QA. Install-path validation (sponsor, named at dispatch) since this is a shipping host PR.

### Files in play
- `src/shared/types.ts`, `src/shared/messages.ts` (new types — commit first).
- `src/extension/roster/schema.ts` (extend for `version`/`character`/`status`).
- `src/extension/roster/loader.ts`, `src/extension/main.ts` (project-scope resolution; drop global at :190).
- `src/cli/agentTree.ts` (drop global default :52).
- `src/extension/commands/openRoster.ts` (remove/retarget).
- `package.json` (command :51 + `rosterPath` description :86).
- New: scanner + config gen/write module(s) under `src/extension/roster/` (Felix names); character-source resolver under `src/extension/` (Felix names); `.vscodeignore`/`esbuild.config.mjs` for bundled-char baking if needed.
- `tests/unit/**`, `tests/integration/**`, `tests/fixtures/**` (new claudeteam.yaml fixtures + agents-folder fixtures).

### Dependencies
- TS-01 (spec — for the detection states, orphan treatment, character-source expectations).

---

## TS-03 — `feat(webview): Manage Team panel + setup wizard + 3 dashboard states + character-picker grid`

**Owner:** Maya (webview)
**Peer reviewer:** Felix
**Size:** L
**Priority:** P0
**Source:** team-setup EPIC; Decisions 2, 3, 5, 6, 7; TS-01 spec.

### Scope
Build the webview side against TS-02's merged vocabulary (Pattern A — dispatch AFTER TS-02 types merge to main).

1. **Manage Team panel** (Decision 5): a reopenable webview panel (wizard layout on first-run; edit layout thereafter). Edit list: per-member `display` + `role` fields (role optional per spec proposal). Character-picker grid: thumbnails from `CharacterSource[]` (merged bundled+user), assign/clear per member, unassigned → text tile. Save → `ui:save-team`; show `setup:config-saved` result.
2. **Setup wizard** (Decision 3): scan-results list with include/exclude checkboxes → `ui:run-setup` → preview → confirm → first dashboard render.
3. **3 dashboard states** (Decision 2): switch on `SetupDetectionState` — `configured` (normal dashboard), `suggest-setup` (the suggest affordance), `empty` (empty-state card with EXACT copy "This project has no orchestration setup, nothing to show").
4. **Suggest-setup affordance** (ratify item — implement per TS-01 proposal): toast-vs-card + dismiss (`ui:dismiss-setup-suggestion`).
5. **Orphan/stale tile** (Decision 3): greyed, non-live, confirm-delete → `ui:confirm-orphan-delete`.
6. **Orchestrator-not-a-tile** (Decision 6): the panel/list never surfaces the main session.
7. **Per-member character rendering** replaces the hardcoded gender binding: render each member's tile with its assigned `character` (text tile when null).

### Acceptance criteria
- AC1: Manage Team panel renders the member edit list (display + role) + character-picker grid; assign/clear writes `ui:assign-character`; save writes `ui:save-team` and surfaces `setup:config-saved`. Panel is reopenable.
- AC2: Setup wizard: include/exclude checkboxes → `ui:run-setup` → preview → confirm. Fresh member shows seeded display, blank role, unassigned (text) tile.
- AC3: Dashboard switches correctly across all three `SetupDetectionState`s; empty-state copy EXACT-matches the locked string.
- AC4: Suggest-setup affordance renders + dismisses per spec; character-picker grid shows merged bundled+user thumbnails.
- AC5: Orphan tile renders greyed + non-live with a confirm-delete affordance wired to `ui:confirm-orphan-delete`; orchestrator never appears as a tile.
- AC6: Per-member character rendering (no hardcoded gender binding); `[hidden]`-toggled flex/grid popovers carry the `[hidden]` guard (source-derived coverage test per conventions).
- AC7: Self-Test Report with AC(a) live-data-plane smoke (load-bearing); interactive screenshots deferred to sponsor post-merge per sub-agent GUI gap.

### Out of scope (OOS)
- Host logic (scanner / gen / write / resolution / character-source) — TS-02.
- YAML format ownership (host writes; webview sends `ClaudeTeamConfig` via `ui:save-team`).
- PixelLab generation.
- Marketplace publication.

### Done-when test
`npm run typecheck && npm run test:unit` green; component tests for panel + wizard + 3 states + picker; `[hidden]`-guard derived test non-vacuous; Self-Test Report (AC(a) smoke present + cited). Felix peer-review; Sage QA. Install-path / interactive screenshots → sponsor post-merge.

### Files in play
- `src/webview/components/**` (new Manage Team panel + wizard + picker grid + empty-state + suggest affordance + orphan tile).
- `src/webview/main.ts`, `src/webview/messageReceiver.ts` (new `ui:*` sends + `setup:*` receives).
- `src/webview/styles/dashboard.css` (panel + grid + states; `[hidden]` guards).
- `src/webview/sprites/**` (per-member character render path; replace gender binding).
- `tests/unit/webview/**` (component + guard-coverage tests).

### Dependencies
- TS-01 (spec) + TS-02 (merged types/schema/messages — Pattern A).

---

## TS-04 — `test(setup): QA across scanner / gen / resolution / matcher / orphan + Manage Team panel`

**Owner:** Sage (QA)
**Peer reviewer:** Felix (host-side) / Maya (webview-side) — orchestrator routes by surface
**Size:** M
**Priority:** P1
**Source:** team-setup EPIC; testing-strategy.md three layers.

### Scope
Author the test plan + the cross-cutting tests the impl tickets don't fully cover, and run the QA pass across the epic. Begin against TS-02's host surface; extend to the panel after TS-03.

1. **Test plan** `team/sage-qa/team-setup-test-plan.md` mapping each AC across TS-02/TS-03 to a layer (unit / integration / Layer-3 / manual-deferred).
2. **Scanner / detection trichotomy** integration tests against fixture agents-folders (0, 1, 2+, with/without config) → correct `SetupDetectionState`.
3. **Gen / read / write round-trip**: starter generation → normalized write → validated re-read; malformed-yaml error path preserved.
4. **Resolution + DROP-global regression**: assert no code path reads `~/.claudeteam/teams.yaml`; project `claudeteam.yaml` resolves from first workspace folder.
5. **Matcher**: seeded `agentType_equals` member matches a live agent of that `agentType` (variant 1 + variant 3 per data-sources schema-detection).
6. **Orphan flow**: agent file removal → member `status: orphaned` (not deleted); confirm-delete removes it; new-agents nudge never auto-mutates.
7. **Character sources**: bundled-only present after clean build; bundled+user merge with bundled-wins dedupe.
8. **Panel** (after TS-03): component/Layer-3 coverage of save → `ui:save-team` → `setup:config-saved` and the 3 dashboard states incl. empty-state EXACT copy.

### Acceptance criteria
- AC1: `team/sage-qa/team-setup-test-plan.md` maps every TS-02 + TS-03 AC to a test layer.
- AC2: Detection-trichotomy integration tests cover 0 / 1 / 2+ agents and config-present, asserting the correct `SetupDetectionState` + empty-state copy.
- AC3: Gen→write→read round-trip + malformed-yaml negative path tested.
- AC4: DROP-global regression test asserts the global file is never read.
- AC5: Matcher test confirms seeded `agentType_equals` matches a live agent (both relevant meta.json variants).
- AC6: Orphan-flow test (orphaned-not-deleted, confirm-delete, non-mutating nudge).
- AC7: Character-source merge + dedupe test; bundled-only-after-clean-build test.
- AC8: Each new test proven non-vacuous (stripping the guarded behavior fails it).

### Out of scope (OOS)
- Authoring impl (host or webview).
- Interactive screenshot capture (sub-agent GUI gap — sponsor post-merge).
- PixelLab generation correctness.

### Done-when test
`npm run test:unit && npm run test:integration` green incl. new tests; test plan committed; Layer-3 added where panel reload coverage is feasible. Peer-review by surface; QA verdict posted on the impl PRs.

### Files in play
- `team/sage-qa/team-setup-test-plan.md` (new).
- `tests/unit/**`, `tests/integration/**`, `tests/vscode-integration/**`, `tests/fixtures/**` (new fixtures + tests).

### Dependencies
- TS-02 (host surface) for scanner/gen/resolution/matcher/orphan tests; TS-03 for panel tests.

---

## Ratify-on-return open items (sponsor-decisions-PENDING — NOT blockers)

Iris proposes spec defaults in TS-01; sponsor ratifies on return. None blocks dispatch.

1. **User-character-folder exact path + valid-character validation + picker thumbnail source.** Proposed default path `~/.claudeteam/characters/`; validation = presence of `animations.json` + `_pixellab_anims/`; thumbnail = south rotation frame. Felix gates the path behind a flippable constant.
2. **Suggest-setup affordance** — toast vs in-panel card + dismiss/remember. Lean: dismissible in-panel card with remember-per-workspace.
3. **Role/title optional vs required** — lean OPTIONAL (member valid with empty role).
4. **Multi-root resolution** — default = first workspace folder; full multi-root deferred to a follow-up.

---

## Decision drafts (for Nora's weekly DECISIONS.md batch — NOT edited in this task)

- `Decision draft:` Roster goes project-scoped at `<workspace>/.claude/claudeteam.yaml` (named to avoid Claude Code's experimental `.claude/teams.yaml`); the global `~/.claudeteam/teams.yaml` + `claudeteam.openRoster` command are dropped. (Sponsor /grill-me 2026-05-29, Decision 1.)
- `Decision draft:` Member match-key is immutable (`agentType_equals` seeded from the agent filename); display name + role + character are separately editable; the Manage Team panel owns the YAML format (normalizes on save, not comment-preserving). (Decisions 4 + 5.)
- `Decision draft:` Per-member character (stored in `claudeteam.yaml`) replaces the hardcoded gender→character binding; characters ship bundled in `dist/` + optionally extend from a runtime user folder. (Decision 7; supersedes memory `project_persona_character_gender_binding`.)
