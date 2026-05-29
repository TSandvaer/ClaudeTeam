## Summary

- Authors `team/nora-pl/milestone-2-backlog.md` — 9 dispatch-ready M2 tickets decomposing the "Extension scaffold + webview" milestone into parallelizable lanes.
- Surfaces M2/M3 scope-overlap analysis with a sponsor-decision draft.
- Includes cross-reference table and throughput note with Wave 0/1/2/3 dispatch sequencing.

## Artifacts authored

- `team/nora-pl/milestone-2-backlog.md` — 9 tickets (M2-01 through M2-09), each with Owner / Peer reviewer / Size / Priority / Source / Scope / AC / OOS / Done-when / Files in play / Conflict rule / Dependencies.

## AC coverage

- AC1 — backlog file exists, format mirrors M1 structure. ✅
- AC2 — all required fields present in every ticket. ✅
- AC3 — cross-reference table + throughput note at bottom. ✅
- AC4 — M2-01 is the extension-manifest ticket; Self-Test Report requires `vsce package` stdout. ✅
- AC5 — M2-04 is the file-watcher loop (M1 data plane → live state) including `cwdToSlug` extraction. ✅
- AC6 — M2-06 is the webview-host message protocol integration ticket (covers both directions). ✅
- AC7 — M2-03 is Iris's dashboard tile spec inheriting M1-03 vocabulary + divergences. ✅
- AC8 — M2-07 is Sage's M2 test plan covering Layer-3 checklist + webview-smoke gate enforcement. ✅
- AC9 — M2/M3 scope-overlap flagged at top of backlog with Option A/B analysis and sponsor-decision draft. ✅
- AC10 — M2-02 is Bram's P0 prior-art research (VS Code API, watcher options, framework pick). ✅
- AC11 — Wave 0/1/2/3 sequencing documented; Wave 0 fires 5 agents in parallel. ✅

## M2/M3 scope-overlap decision (sponsor input needed)

**Situation:** V1-PLAN puts roster matching under M3 but M1-08 (matcher) already shipped on main. The backlog is written for Option A (absorb named-tile rendering into M2 using the existing matcher — recommended). If sponsor prefers Option B (pure hardcoded strings in M2), M2-05 and M2-06 scopes narrow. The orchestrator should surface this to sponsor before dispatching Wave 1 (M2-04 + M2-05).

Decision draft in the backlog: accept Option A, rename M3 to "Roster config + live refresh."

## Non-obvious findings

1. **`cwdToSlug` is an M2 prerequisite, not a nice-to-have.** M2-04 (file-watcher) needs slug derivation to locate JSONL paths from session `cwd` values. The M1-09-followup ticket `86c9y6e17` (Felix's NITs) includes the `cwdToSlug` extraction to `src/shared/slug.ts`. M2-04 is scoped to subsume that work — if `86c9y6e17` ships before M2-04 is dispatched, Felix should skip the extraction step in M2-04. The orchestrator needs to coordinate this sequencing.

2. **`engines.vscode` minimum version is a soft dependency on M2-02.** M2-01 needs to finalize `engines.vscode` in `package.json` before `vsce package` can succeed cleanly. The ticket carries a Conflict rule allowing `^1.85.0` as a conservative placeholder, but Bram's M2-02 research could push that higher if `WebviewViewProvider` requires a later version. The orchestrator should merge M2-02 and review its verdict before merging M2-01 if the CI vsce-package step is blocking.

3. **Maya has no Wave 0 work.** M2-05 (webview renderer) is Maya's primary M2 ticket and it depends on M2-01 (manifest) + M2-03 (tile spec). Maya cannot start until both land. The orchestrator may want to give Maya a warm-up task (e.g., review M2-01 as it develops, or pick up M1-09-followup `86c9y6e17` if Felix doesn't take it first). Watch for Maya going idle while Wave 0 is in flight.

4. **The `state:delta` message type is in the shared protocol but scoped out of M2.** `src/shared/messages.ts` will define `state:delta` per the conventions doc, but M2-06 only uses `state:full`. The delta pathway (M4 optimization) should be stubbed in the message bus with a `TODO: M4 — implement delta diffing` comment, not omitted from the type definitions. Otherwise M4 will require a type-breaking change to a shared file.

5. **`src/shared/fixtures.ts` (M2-05 AC9) is the ground truth for testing and dev mode.** Once this file exists, Sage's Layer-3 tests (M2-08) and any Cypress/Playwright-style webview tests can also consume it. The file should export both `FIXTURE_STATE: DashboardState` and a `buildFixtureState(overrides)` helper for test customization. Worth noting in the M2-05 brief so Maya designs it as a test primitive, not just a one-off stub.

6. **Layer-3 tests (M2-08) download a test VS Code binary on first run.** `@vscode/test-electron` downloads the specified VS Code version on first run. CI may need a caching step (`actions/cache` on `~/.vscode-test`) to avoid repeated downloads. Sage should flag this in M2-07's test plan and M2-08's implementation so CI doesn't burn minutes every run.
