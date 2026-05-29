## Self-Test Report — TS-02 Pt-2 (`86ca1mw2m`)

Host-only PR; UX-observable via the data the webview (TS-03) renders. Sub-agent GUI gap applies — AC(a) data-plane smoke is load-bearing; interactive screenshots defer to sponsor post-merge.

### AC walkthrough (data-plane smoke — real `~/.claude/` + live tsx run)

- **AC1 (scanner + trichotomy):** ran `scanAgentsFolder` against this repo's real `.claude/agents/` → `bram, felix, iris, maya, nora, sage` (6 personas; `TEAM.md` + `dispatch-template.md` excluded). No `claudeteam.yaml` present → detection = `suggest-setup`. ✅
- **AC2 (`agentType==filename`):** read live `0298adf2-.../subagents/agent-a08fcc4401cf73138.meta.json` = `{"agentType":"felix","name":"felix-pr121",...}` — `agentType` equals `felix.md` stem. Verified across sage/maya/felix captures. ✅
- **AC3/AC4 (gen→write→read):** integration round-trip — `generateStarterConfig(["felix","maya"])` → normalized write → re-read validates clean (version 1, `agentType_equals` seed, `character:null`, `status:live`). Re-serialize byte-identical. ✅
- **AC5 (DROP global):** non-vacuous regression test — scans `src/**` for `homedir()`+`.claudeteam`+`teams.yaml` code construction; passes on this branch, FAILS when the dropped path is reintroduced (verified by temporary sed). `vsce package` shows no `claudeteam.openRoster` command. ✅
- **AC6 (orphan flip):** integration — seed config from felix+maya, delete `maya.md`, `reconcileDrift({felix})` → on-disk `maya.status="orphaned"` (kept), `felix.status="live"`. `confirmOrphanDelete("maya")` removes it. ✅
- **AC7 (char sources):** live smoke after build → `ClaudeTeam-F01-Dev(bundled), ClaudeTeam-M01-Dev(bundled)`. Integration covers bundled-only-after-clean-build, bundled+user merge w/ bundled-wins dedupe, half-harvest skip, empty-dir defense. `vsce package` confirms both char trees baked (220 files each). ✅
- **AC8 (`ui:*`/`setup:*`):** provider dispatch + guard extended for 6 new ui types; `setupController` handlers ack `setup:config-saved`; host posts detection/characters/config-saved. Unit + integration cover the handler logic. ✅
- **AC9 (tests):** 25 unit + 16 integration; negative paths (malformed yaml, schema-invalid, missing file, no-agents-folder, 1-agent, half-harvest) covered; orphan/dismiss/dedupe non-vacuous. ✅

### Side-effect inventory

- **Roster matcher / watcher:** `projectRosterPath` now points at `claudeteam.yaml` (was `teams.yaml`); the matcher reads the SAME file the panel writes. `globalRosterPath` no longer passed (loader treats absent as "no global").
- **CLI `agentTree`:** default roster now `<cwd>/.claude/claudeteam.yaml`; passed as project arg (not global).
- **Message protocol:** 3 new host→wv + retargeted `ui:open-roster`→`ui:open-manage-team`; no existing type overloaded.
- **Build:** sprite-manifest now copies `animations.json` into dist char folders (additive; webview frame-render path unaffected — it uses the baked manifest).
- **Subscription count:** dropped `claudeteam.openRoster` → activate registers 6 (was 7); `subscriptionLeak.test.ts` updated.
- **`src/shared/types.ts`:** NOT touched (Maya's #135 owns the additive `AgentTile.character`).

### Failure-mode probes

- **Missing session/config file:** `readClaudeTeamConfig` → `{ok:false, error:"...not found"}`; detection → `empty`/`suggest-setup` based on scan; no throw.
- **Malformed JSONL / YAML:** `readClaudeTeamConfig` → `{ok:false, error:"...parse error"}`; `reconcileDrift` no-ops the write on malformed config (re-emits detection only — never destroys).
- **Schema mismatch:** schema-invalid (missing `version`) → `{ok:false}`; `claudeTeamConfigSchema.safeParse` is the guard.
- **Empty roster / no agents folder:** scan → `[]`; detection → `empty`; char picker → empty (webview defends per spec §5.2).
- **Two sessions same cwd:** unchanged — detection is workspace-folder-scoped (first folder), independent of session multiplicity.

### Interactive screenshots

Deferred to sponsor post-merge per sub-agent GUI gap (no GUI runtime). Install-path validation (`vsce package` ✅ done; `code --install-extension` + Activity-Bar open) is the sponsor-return item.
