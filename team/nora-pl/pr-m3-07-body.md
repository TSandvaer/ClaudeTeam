## Summary

Adds an "Install-path validation discipline" subsection under `.claude/docs/testing-strategy.md` § "Placeholder-PR screenshot exception" — codifies that the screenshot deferral does NOT release the `.vsix` install + activation gate at the first shipping PR, even when downstream replacement is planned.

## Source

- `.claude/retros/retro-2026-05-24-m2-close.md` § Next-session backlog item 5
- `.claude/retros/retro-2026-05-24-m2-close.md` § Anti-patterns "Chain of deferred manual validations"

## Acceptance criteria

- [x] **AC1** — New subsection "Install-path validation discipline" added under § "Placeholder-PR screenshot exception" (`.claude/docs/testing-strategy.md:99`). Content covers: `.vsix` install + activation on Node 22+ is load-bearing pre-merge for the FIRST shipping PR; the 4-step manual probe (`vsce package --no-yarn` → `code --install-extension` → open Activity Bar → confirm zero ERR_REQUIRE_ESM / activation errors in Output channel within 5s); failure blocks merge.
- [x] **AC2** — Explicitly cites M2-01 → M2-08 (PR #29) → CJS shim incident as originating evidence (`.claude/docs/testing-strategy.md:110`): "The Node 22+ ERR_REQUIRE_ESM activation failure was latent from M2-01's `.vsix` and only surfaced at M2-08's Layer-3 tests three tickets later, because the placeholder exception masked the install-validation gap. The install path is the load-bearing test."
- [x] **AC3** — Clarifies interaction with sub-agent GUI gap (`.claude/docs/testing-strategy.md:112`): when both author + reviewer are sub-agents, install-path validation is the ONE pre-merge gate requiring a GUI-capable executor; surface at dispatch time (name the install performer in the brief) so unfulfillable merge gates aren't discovered post-CI-green.
- [x] **AC4** — PR diff is 15 lines total (cap: 40). Verified via `git diff --stat`.

## Done-when verification

```
grep -n "Install-path validation discipline" .claude/docs/testing-strategy.md
# 99:#### Install-path validation discipline

grep -n "ERR_REQUIRE_ESM" .claude/docs/testing-strategy.md
# 106:4. Confirms zero `ERR_REQUIRE_ESM` / activation errors ...
# 110:**Originating evidence (M2-01 → M2-08, PR #29).** The Node 22+ `ERR_REQUIRE_ESM` ...
```

## Out of scope (per backlog)

- Changes to the sub-agent GUI gap reframe itself.
- Automation for `.vsix` install testing.
- Retroactive M2-01 application.

## Merge class

Orchestrator-direct merge (no ClickUp ticket — `ClickUp:NO — orch-direct chore class` per backlog).

Decision draft: install-path validation is load-bearing pre-merge for the first shipping PR even under the placeholder-screenshot exception — codified to prevent another M2-01 → M2-08 latent-bug chain.
