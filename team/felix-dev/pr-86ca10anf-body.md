## 86ca10anf — full team always displayed: flip `hideIdleAgents` default `true → false`

Sponsor's whole-team-always-visible thesis (memory `project_dashboard_whole_team_thesis.md`, 2026-05-27) makes the running-focused hide-idle-by-default the wrong first-install experience. This flips the **default** only — the hide-idle filter, chip, command, and `ui:set-config` toggle path remain a full capability for sponsors who want the running-focused view.

### What changed (default `true → false`)

| Site | Before | After | Role |
|---|---|---|---|
| `package.json` `claudeteam.hideIdleAgents.default` | `true` | `false` | Authoritative VS Code Settings default (+ description rewrite). |
| `src/extension/main.ts:223` `getHideIdleAgents` fallback | `?? true` | `?? false` | Host config-read fallback (unregistered-setting safety). |
| `src/extension/main.ts:442` `toggleHideIdle` current-read fallback | `?? true` | `?? false` | Command-palette toggle's "current value" read. |
| `src/extension/watcher/watcherLoop.ts:292` `getHideIdleAgents?.() ?? …` | `?? true` | `?? false` | Per-tick options-builder fallback. |
| `src/extension/watcher/watcherLoop.ts:591` `const hideIdle = …` | `opts.hideIdleAgents !== false` | `opts.hideIdleAgents === true` | **Load-bearing filter-application default.** Now matches the `hideFinished === true` sibling (line 578) and the wire serializer — no split-brain. |

JSDoc on `WatcherLoopOptions.getHideIdleAgents` + the two command/option comment blocks updated to say "default false / whole team always-visible."

### No split-brain (host read ⇄ wire default agree)

After the flip, **every** site treats absent/undefined as `false`:
- Host filter-application: `watcherLoop.ts:591` `=== true`
- Wire serializer: `messageBus.ts:88` `state.config?.hideIdleAgents === true` (unchanged — already default-false)
- Hash: `watcherLoop.ts:696` `=== true` (unchanged)
- Webview reader: `render.ts:214-217` `typeof … === "boolean" ? … : false` (unchanged)

Previously `watcherLoop.ts:591` was the lone `!== false` (default-true) outlier against `=== true`/`?? false` everywhere else — that was the split-brain this ticket eliminates.

### Capability preserved (OOS respected)

- Toggle/chip untouched: `headerChip.ts`, `teamCard.ts:229` (chip renders when `hideIdle === true && hiddenIdleCount > 0`), `provider.ts:263`, `messages.ts` `SetConfigMessage` union still carries `"hideIdleAgents"`.
- `claudeteam.toggleHideIdle` command intact (only its fallback default flipped).
- `hideFinishedAgents` untouched. Persona-character integration untouched.
- `src/extension/state/hideIdleFilter.ts` unit logic unchanged — the filter still hides idle tiles when invoked with `hideIdle === true`.

### Tests

- `tests/integration/watcherLoop.test.ts` — the default-behavior test rewritten: omit `hideIdleAgents` → idle tile **stays**, `hiddenIdleCount === 0`, `config.hideIdleAgents === false` (was: suppressed / count 1 / true). The explicit-on and explicit-off tests are unchanged (they pass explicit values; behavior identical).
- `tests/unit/hideIdleFilter.test.ts` — intact (pure-filter logic unchanged).
- `tests/unit/messageBus.test.ts:197` "defaults to false when absent" — already correct; no change needed (it always expected the wire default-false).

### Evidence

- typecheck: `npm run typecheck` clean.
- build: `npm run build` — all bundles emitted (`dist/extension/main.cjs`).
- unit: `npm run test:unit` — 730 passed / 2 skipped / 0 failed.
- integration: `npm run test:integration` — 111 passed / 0 failed (incl. 16 watcherLoop tests).
- `vsce package --no-yarn` — see Self-Test Report comment.
