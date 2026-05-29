# chore(webview+host): remove global "Hide finished" / "Hide idle" chips

Ticket: `86ca1gdbp` (P3). Sponsor decision 2026-05-29 — the global state-filter chips are superseded by the whole-team-always-visible default + the per-member "⋯" hide. This PR removes them end-to-end. **The per-member hide / remove / show-hidden surfaces (`hideMembersFilter` + `removeMembersFilter` + their messages) are UNTOUCHED.**

## What was removed

**Webview:**
- `src/webview/components/headerChip.ts` — deleted (both the `finished` + `idle` `HeaderChipKind` variants lived here).
- `render.ts` — removed the two `renderHeaderChip` mounts, the `readHeaderChipState` / `readIdleChipState` reader fns, the `renderHeaderChip` import, and the `hideIdle` / `hiddenIdleCount` threading into `renderSessionBlock`.
- `sessionBlock.ts` + `teamCard.ts` — removed the `hideIdle` / `hiddenIdleCount` props + threading; removed the per-team "N idle hidden — show" passive row (`renderTeamIdleRow`) and its now-unused `EM_DASH` / `WebviewMessage` import in teamCard.
- `main.ts` (webview) — removed the `hiddenFinishedCount` / `hiddenIdleCount` hydration passthrough.
- `dashboard.css` — removed `.ct-header-chip*` block, the `.ct-team-idle-row` block, and the reduced-motion `.ct-header-chip-toggle` elide.

**Host:**
- `package.json` — removed `claudeteam.hideFinishedAgents` + `claudeteam.hideIdleAgents` config props and the `claudeteam.toggleHideFinished` + `claudeteam.toggleHideIdle` commands.
- `main.ts` — removed the two toggle command registrations, the two `onDidChangeConfiguration` listeners, the `getHideFinishedAgents` / `getHideIdleAgents` watcher getters, the `onSetConfig` handler, and the `handleSetConfig` function.
- `watcherLoop.ts` — removed the two filter imports + getter options + runTick options + tick wiring + the filter application; `applyHideMembersFilter` now consumes the reducer's `tree` directly. Removed `hiddenFinishedCount` / `hiddenIdleCount` / `config.hide*Agents` from the wire-shape return + from `hashState`.
- `messageBus.ts` (`serializeState`) + `shared/types.ts` (`AgentTree`) + `shared/messages.ts` (`SerializedDashboardState`) — removed `hiddenFinishedCount` / `hiddenIdleCount` and `config.hideFinishedAgents` / `config.hideIdleAgents`.
- `shared/messages.ts` — removed the now-orphaned `SetConfigMessage` type + its `WebviewMessage` union member (its only `key`s were the two removed scalars; per-member hide uses distinct `ui:hide-member` etc. messages).
- `provider.ts` — removed the `SetConfigMessage` import, the `onSetConfig` handler field, the `ui:set-config` dispatch case, and the `isWebviewMessage` guard branch. The guard now **rejects** `ui:set-config` (regression-guarded so a stale webview can't drive a dead path).

## Tests

- Deleted: `hideFinishedFilter.test.ts`, `hideIdleFilter.test.ts`, `headerChip.test.ts`, `availableFilterInteraction.test.ts` (the latter was wholly dedicated to the removed filters; the analogous `available`-survival guard for the surviving `hideMembersFilter` remains in `hideMembersFilter.test.ts`).
- Pruned removed-field assertions from `messageBus.test.ts`, `watcherLoop.test.ts` (hash), `hydrateState.test.ts` (re-pointed config-passthrough coverage at the surviving `autoCollapseUniformClusters`), `hideMembersFilter.test.ts` (pass-through fields), `dashboardTile.test.ts` (per-team idle-row describe block), and the integration `watcherLoop.test.ts` (the two filter describe blocks).
- `webviewMessageDispatch.test.ts` — replaced the `ui:set-config` accept-coverage with a 2-case **reject** guard.
- `subscriptionLeak.test.ts` — command count 9 → 7.

## Gate evidence

- `npm run typecheck` — clean (production source typechecks with zero `hideFinished`/`hideIdle` refs; only an intentional 3-line explanatory note remains in `hideMembersFilter.ts`).
- `npm run lint` — clean.
- `npm run test:unit` — 915 passed / 2 skipped (47 files).
- `npm run test:integration` — 118 passed (10 files).
- `npm run build` — all 6 bundles emit; host bundle is `dist/extension/main.cjs` (CJS). `node -e "require('./dist/extension/main.cjs')"` fails only on `Cannot find module 'vscode'` (esbuild-external, expected outside the extension host) — NOT `ERR_REQUIRE_ESM`, so the CJS format chain is intact.
- **Manifest gate:** `npx vsce package --no-yarn` → `Packaged: claudeteam-0.0.1.vsix (447 files, 1.22 MB)`, no `contributes` schema errors after removing the two commands + two config props.

See the Self-Test Report comment for AC walkthrough, side-effect inventory, and failure-mode probes.
