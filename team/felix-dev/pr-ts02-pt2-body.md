## TS-02 Pt-2 — host implementation (`86ca1mw2m`)

Host side of the team-setup epic. Pt-1 (types/schema/messages, `5d4884b` / #133) is consumed, not redefined. Builds on the LOCKED Vocabulary contract.

### What landed (AC1–AC9)

- **AC1 — scanner + detection trichotomy.** `agentScanner.scanAgentsFolder` reads `<workspace>/.claude/agents/*.md` → `ScannedAgent[]`, excluding non-persona docs (`TEAM.md`, `dispatch-template.md`, uppercase stems). `detection.computeDetectionState`: config present → `configured`; ≥2 agents → `suggest-setup`; <2 → `empty`. (`detection.ts`, `agentScanner.ts`)
- **AC2 — `agentType == agents/*.md filename` VERIFIED.** Against live captures in `~/.claude/projects/c--Trunk-PRIVATE-ClaudeTeam/0298adf2-.../subagents/*.meta.json` (2026-05-29): every persona sub-agent carries `agentType` equal to the file stem — `{"agentType":"felix",...}`←`felix.md`, `{"agentType":"sage",...}`←`sage.md`, `{"agentType":"maya",...}`←`maya.md`. The per-dispatch slug lives in `name` (`"felix-pr121"`), NOT `agentType`. Seeding `match:[{agentType_equals: agentName}]` matches live agents with no separate mapping. NOT divergent → not a blocker.
- **AC3 — starter gen.** `generateStarterConfig`: per included agent → `{id=display=agentName, role:"", character:null, status:"live", match:[{agentType_equals:agentName}]}`. De-dups doubled selections. Round-trips through validated read.
- **AC4 — normalized structured write.** `writeClaudeTeamConfig` re-serializes from the config object via `serializeConfig` (NOT comment-preserving — panel owns the format). Deterministic output (re-serializing identical config is byte-identical). Header comment re-asserts the panel-managed contract.
- **AC5 — project-scope + DROP global.** `resolveProjectRosterPath` → `<first-folder>/.claude/claudeteam.yaml`. Global `~/.claudeteam/teams.yaml` removed from `main.ts` (no `globalRosterPath` passed to watcher/rosterWatcher), `agentTree.ts:52` (now `<cwd>/.claude/claudeteam.yaml`), `openRoster.ts` + its test DELETED, `package.json` command `claudeteam.openRoster` removed + `rosterPath` description fixed. The legacy `ui:open-roster` webview button is RETARGETED to `ui:open-manage-team` (provider dispatch). **Regression-guarded** by a non-vacuous source-scan test (verified: reintroducing `join(homedir(),".claudeteam","teams.yaml")` fails it).
- **AC6 — drift + orphan.** `agentWatcher` (RelativePattern `*.md` + polling fallback, mirrors `rosterWatcher`) fires a debounced diff. New agents → non-blocking console nudge (NEVER auto-mutates). Removed agents → `orphanReconcile.reconcileOrphans` flips the backing member to `status:orphaned` (KEPT, not deleted) + persists; revives to `live` when the file returns. `confirmOrphanDelete` is the ONLY member-delete path.
- **AC7 — character sources.** `resolveCharacterSources` merges bundled (`dist/webview/sprites/`) + user-folder (`~/.claudeteam/characters/`, behind the flippable `resolveUserCharacterDir` constant) → `CharacterSource[]`, **bundled wins on id collision**. Valid-character = `animations.json` + `_pixellab_anims/` (half-harvests skipped). **Bundled-baking fix:** the sprite-manifest build now ALSO copies `animations.json` into the dist char folder (was PNG-tree only) so bundled chars pass validation — verified in the `.vsix` (220 files each under `ClaudeTeam-F01-Dev`/`ClaudeTeam-M01-Dev`) AND via a live smoke (`character sources: ClaudeTeam-F01-Dev(bundled), ClaudeTeam-M01-Dev(bundled)`).
- **AC8 — `ui:*` + `setup:*` wired.** `setupController` owns `ui:run-setup` / `ui:save-team` / `ui:assign-character` / `ui:confirm-orphan-delete` / `ui:open-manage-team` / `ui:dismiss-setup-suggestion`; each acks `setup:config-saved` (and re-emits `setup:detection` on success). Host posts `setup:detection` / `setup:characters` / `setup:config-saved` via new `messageBus` helpers. Provider dispatch + `isWebviewMessage` guard extended (payload validation per type).
- **AC9 — tests.** Unit (`teamSetupHost.test.ts`, 25) + integration (`teamSetupFs.test.ts`, 16): trichotomy, gen→write→read round-trip, malformed-yaml + schema-invalid + missing negative paths, char merge/dedupe/half-harvest/empty, orphan flip-persists + confirm-delete + dismiss, DROP-global regression (non-vacuous).

### Documented decisions (for Maya + Sage)

- **Type name:** used `ClaudeTeamConfig` (Pt-1 already authored it as a distinct type from `RosterFile`).
- **`agentType==filename`:** verified, evidence above.
- **Char dedupe tiebreak:** BUNDLED WINS (a user folder shadowing a bundled id is dropped + logged).
- **Flippable defaults (unratified — gated):** user-char path `~/.claudeteam/characters/` behind `resolveUserCharacterDir`; suggest threshold `SUGGEST_SETUP_MIN_AGENTS=2`; multi-root = first folder; role optional (schema default `""`).

### Per-member sprite wiring — coordination note (Path 2)

Maya's TS-03 (#135, not yet merged) adds the additive `AgentTile.character?` / `MultiAgentPersonaTile.character?` fields. This branch is off `5d4884b` (pre-#135) and does NOT define them — adding the field independently would collide on `src/shared/types.ts`. **Sequencing: merge #135 first**, then a one-line follow-up stamps `tile.character = matchedMember.character` at the reducer build sites (`reducer.ts:232`, `:311`, multi-agent identity carry `:614`/`:667`). This PR fully persists `Member.character` in `claudeteam.yaml` (read/write/assign), so the data is on disk and ready. Per-member sprites gender-fall-back until that follow-up (not broken).

### Gate

- typecheck ✅ · lint ✅ · unit 1000 passed ✅ · integration 133 passed, 1 failed (pre-existing `mainReplay.test.ts` AC5 — triage `86ca1n87m`, OUT OF SCOPE; baseline was also 1-failed; **no new failures**).
- Manifest gate: `vsce package --no-yarn` ✅ → `claudeteam-0.0.1.vsix` (455 files, 1.27 MB), bundled chars baked.
- `mainReplay.test.ts` assertions retargeted to count `state:full` posts (resolve now also emits `setup:*`) — the replay mechanism's subject is unchanged.

### Install-path / GUI validation

Sponsor-return item (sub-agent has no GUI). Data-plane smoke performed: real `.claude/agents/` scan → `bram, felix, iris, maya, nora, sage` (TEAM.md/dispatch-template.md excluded); no config → `suggest-setup`; bundled chars resolve from dist.

Reviewer: **Maya**. QA: **Sage**.
