# Team-Setup EPIC — Test Plan (TS-04)

QA test plan for the team-setup epic foundation: TS-02 (host, PR #136) + TS-03
(webview, PR #135), both merged to `main`. Maps every TS-02 + TS-03 acceptance
criterion to a test layer (per `.claude/docs/testing-strategy.md`), names the
covering test, and flags gaps + defects found during the QA pass.

**Legend — layer:** U = Layer-1 unit (vitest, pure); I = Layer-2 integration
(fixture filesystem); L3 = Layer-3 `@vscode/test-electron`; M = manual
reload (sponsor post-merge per sub-agent GUI gap); CMP = webview component
(vitest + jsdom).

**Legend — status:** ✅ covered on main; ➕ added by TS-04 (this PR); ⚠️ DEFECT;
🖐 manual / sponsor-deferred.

---

## TS-02 — host (scanner / gen / resolution / matcher / orphan / character sources)

| AC | Summary | Layer | Covering test | Status |
|----|---------|-------|---------------|--------|
| AC1 | Scanner reads `.claude/agents/*.md` → `ScannedAgent[]`; trichotomy ≥2/<2/config | U + I | `teamSetupHost.test.ts` (computeDetectionState, isPersonaAgentFile); `teamSetupFs.test.ts` (scanAgentsFolder 0/1/2+, non-persona exclusion) | ✅ |
| AC2 | `agentType == agents/*.md filename` verified; finding in PR body | doc | Documented in `agentScanner.ts` header (VERIFIED 2026-05-29) + TS-02 PR body; behaviorally exercised by the AC5 matcher routing (➕ below) | ✅ |
| AC3 | Starter config: immutable `agentType_equals`, display=name, empty role, char null, status live; round-trips | U + I | `teamSetupHost.test.ts` (generateStarterConfig); `teamSetupFs.test.ts` (gen→write→read round-trip) | ✅ |
| AC4 | Save writes normalized `claudeteam.yaml`; re-read validates clean | U + I | `teamSetupHost.test.ts` (serializeConfig deterministic + header); `teamSetupFs.test.ts` (round-trip + parent-dir create) | ✅ |
| AC5 | Global `~/.claudeteam/teams.yaml` GONE; no code path reads it; regression-guarded | I | `teamSetupFs.test.ts` (DROP-global source-construction grep); ➕ `teamSetupResolution.test.ts` (DROP-global behavioral proof — matcher feed project-only) | ✅ ➕ |
| AC6 | New agents → non-blocking signal (never mutates); removed agent → `status: orphaned` (not deleted) until confirm-delete | U + I | `teamSetupHost.test.ts` (reconcileOrphans / removeMemberById); `teamSetupFs.test.ts` (orphan flip persists, confirm-delete); ➕ non-mutating-nudge (new agent never auto-adds) + orphan-revive (returning file → live, not duplicated) | ✅ ➕ |
| AC7 | `resolveCharacterSources()` merges bundled + user, bundled-wins dedupe; bundled present after clean build | I | `teamSetupFs.test.ts` (bundled-only-after-clean-build, bundled+user merge, half-harvest skip, empty-grid defend) | ✅ |
| AC8 | New `ui:*` + `setup:*` message types added (not overloaded), JSON-safe; handlers wired with acks | U | `webviewMessageDispatch.test.ts` (isWebviewMessage guards + provider dispatch for all 6 setup ui:*); `teamSetupSchema.test.ts` | ✅ |
| AC9 | Unit + integration per layers; negative paths (malformed yaml, no folder, 1-agent, orphan) | U + I | malformed-yaml (`teamSetupFs.test.ts`), schema-invalid, missing-file; 0/1-agent scans; orphan flow | ✅ |

### TS-04-added cross-cutting host coverage (➕)

| Test | File | What it guards (bug class) | Non-vacuity proof |
|------|------|----------------------------|-------------------|
| gen → PRODUCTION matcher feed routing (v2.1.119 + v2.1.145-persona) | `teamSetupResolution.test.ts` | The untested seam: a `generateStarterConfig` output loaded through `loadRoster` (the SAME call main.ts:561 makes) must route a live agent to the right `(teamId, memberId)`. matcher.test.ts uses hand-built rosters; this connects gen → matcher end-to-end. | Mutating `matchAgent` to return a constant → 3 routing tests fail. |
| AC6 non-mutating nudge | `teamSetupFs.test.ts` | A new agent on disk must NEVER auto-add a member (Decision 3 — nudge, not mutation). | Mutating `reconcileOrphans` to auto-add present agents → test fails. |
| AC6 orphan revive | `teamSetupFs.test.ts` | A returning agent file flips its member back to live, not duplicated. | Pins single-member + live status. |

---

## TS-03 — webview (Manage Team panel / wizard / 3 states / picker / orphan)

| AC | Summary | Layer | Covering test | Status |
|----|---------|-------|---------------|--------|
| AC1 | Manage Team panel: edit list (display+role) + picker grid; assign/clear → `ui:assign-character`; save → `ui:save-team` + ack; reopenable | CMP | `teamSetup.test.ts` (panel edit rows, save preserves match/status, empty-display blocks save); `characterPicker` assign/clear/highlight | ✅ |
| AC2 | Setup wizard: include/exclude → `ui:run-setup` → preview → confirm; fresh member seeded display/blank role/text tile | CMP | `teamSetup.test.ts` (wizard checkboxes default-checked, count line, Preview-disabled-at-0, Confirm posts ui:run-setup with checked names) | ✅ |
| AC3 | Dashboard switches across all 3 `SetupDetectionState`; empty-state copy EXACT | CMP | `teamSetup.test.ts` (renderFull empty/suggest/configured/dismissed/back-compat; EXACT copy constant `NO_ORCHESTRATION_SETUP_COPY`) | ✅ |
| AC4 | Suggest affordance renders + dismisses; picker grid shows merged bundled+user | CMP | `teamSetup.test.ts` (suggest card count line, Set-up/✕/Not-now posts; picker origins [bundled,bundled,user]) | ✅ |
| AC5 | Orphan tile greyed + non-live + confirm-delete → `ui:confirm-orphan-delete`; orchestrator never a tile | CMP | `teamSetup.test.ts` (orphan row greyed + badge + delete btn; confirm starts hidden; orchestrator-not-a-tile asserts only config members) | ✅ |
| AC6 | Per-member character render (no hardcoded gender); `[hidden]`-guarded popovers source-derived | CMP | `characterRender.test.ts`, `removeMember.test.ts` (`[hidden]`-guard derived coverage), `teamSetup.test.ts` (orphan-confirm starts hidden) | ✅ |
| AC7 | Self-Test Report w/ AC(a) live-data-plane smoke; interactive screenshots deferred | M / report | TS-03 PR #135 Self-Test Report (sponsor post-merge confirm per sub-agent GUI gap) | 🖐 |

---

## Layer-3 (`@vscode/test-electron`) — feasibility note

The setup data plane is fully covered at U + I + CMP. A Layer-3 test for the
panel reload (save → `setup:config-saved` → re-render) would exercise the same
message round-trip already covered by `webviewMessageDispatch.test.ts` (host
dispatch) + `teamSetup.test.ts` (webview render) + the live `runTick` path. Per
testing-strategy.md "use [Layer-3] sparingly," NO new Layer-3 test is added in
this PR — the existing `webviewSmoke.test.ts` / `activation.test.ts` cover the
activation + reload smoke that the setup panel rides on. **Manual reload of the
panel binds at sponsor post-merge** per the sub-agent GUI gap (the panel render
logic is webview code; AC(a) smoke is the load-bearing pre-merge gate, satisfied
by TS-03's Self-Test Report).

---

## ⚠️ DEFECT found during QA — empty-role generated config dropped by matcher feed

**Severity:** High (breaks the core epic promise for the default case).
**Origin:** TS-02 (PR #136). **Class:** schema divergence between two read paths.

**Symptom (observed, reproduced by `teamSetupResolution.test.ts`):** a config
produced by `generateStarterConfig` — every member `role: ""` (the documented
lean-OPTIONAL default, spec §7.3) — is **rejected by the production matcher
feed**. `main.ts:206-217` points the watcher's `projectRosterPath` at
`claudeteam.yaml`; the watcher loads it via `loadRoster(undefined, path)`
(`watcherLoop.ts:561`) → `parseFile` → `rosterFileSchema`. That LEGACY schema's
`memberSchema` requires `role: z.string().min(1)` (`schema.ts:58`). On validation
failure `parseFile` (`loader.ts:126-134`) returns `teams: null` — it drops the
ENTIRE file. Verbatim error from the test run:

```
project roster schema error at teams.0.members.0.role:
  Too small: expected string to have >=1 characters
```

**Product impact:** a user who runs the wizard and does NOT type a role for some
member (the shipped default) gets **zero tiles** — the matcher sees an empty
roster. This is exactly the failure the epic exists to prevent (scan → generate →
see your team).

**Isolation:** a config whose members all have NON-EMPTY roles loads + routes
correctly through both meta variants (`teamSetupResolution.test.ts` AC5 block) —
so the matcher + gen logic are sound. ONLY the empty-role default trips the
legacy schema. The new `claudeTeamConfigSchema` (panel read path) correctly makes
role optional (`schema.ts:117`); the two schemas were never reconciled at the
matcher seam.

**Suggested fix (TS-02 follow-up — host):** make the matcher feed tolerate the
`claudeteam.yaml` role-optional shape. Either (a) route `claudeteam.yaml` through
`claudeTeamConfigSchema` in the loader's project-path branch, or (b) relax
`rosterFileSchema`'s `role` to optional/`.default("")` so the two schemas agree.
Option (a) is cleaner (single schema owns the new file format); option (b) is a
one-line change but leaves two schemas to keep in sync.

**Test status:** `teamSetupResolution.test.ts` pins this defect:
- one `it` DOCUMENTS the current (defective) behavior (`roster: []`, role error
  present) — fails when the fix lands, signaling the pin's removal;
- two `it.fails` capture the DESIRED behavior red-ready — promote to plain `it`
  when the fix lands. (Verified: a simulated `rosterFileSchema` role-relax flips
  all three as designed.)

---

## QA verdict

TS-02 + TS-03 shipped with thorough paired tests; all 9 + 7 ACs are covered at
the right layers (or sponsor-deferred per the GUI gap). **One high-severity
defect found** (empty-role config dropped by the matcher feed) that the impl
tests missed because no test crossed the gen → production-matcher-feed seam. The
defect is pinned + a fix is scoped as a TS-02 follow-up. Everything else: AC met.
