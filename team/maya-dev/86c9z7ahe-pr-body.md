# chore(repo): MIT LICENSE + package.json license=MIT (86c9z7ahe)

Adds a standard MIT LICENSE at the repo root and flips `package.json` `"license"` from `"UNLICENSED"` to `"MIT"`. Resolves the `vsce package` warning surfaced during the V1 dogfood vsix rebuild: `WARNING LICENSE, LICENSE.md, or LICENSE.txt not found`.

## Changes

- New `LICENSE` (no extension, all-caps filename) — standard MIT text, `Copyright (c) 2026 Thomas Sandvær`.
- `package.json` `"license": "UNLICENSED"` → `"license": "MIT"`.

## AC verification

- **AC1** — `LICENSE` (no extension) created with standard MIT text. ✅
- **AC2** — Copyright line is `Copyright (c) 2026 Thomas Sandvær`. ✅
- **AC3** — `npx vsce package --no-yarn` no longer emits the LICENSE warning. Verified via `npx vsce package --no-yarn 2>&1 | grep -iE "warning|error"` → `NO WARNINGS OR ERRORS EMITTED`. vsce auto-renames `LICENSE` → `LICENSE.txt` inside the bundled vsix (standard vsce behavior). ✅
- **AC4** — `package.json` `"license"` field is now `"MIT"`. ✅
- **AC5** — No test/build regression. `npm run typecheck` clean; `npm test` → **464 passed, 2 skipped, 0 failed** across 24 test files. ✅
- **AC6** — Self-Test Report below. ✅

## Self-Test Report

### vsce package output (excerpt)

```
 INFO  Files included in the VSIX:
claudeteam-0.0.1.vsix
├─ [Content_Types].xml
├─ extension.vsixmanifest
└─ extension/
   ├─ LICENSE.txt
   ├─ README.md [0.76 KB]
   ├─ package.json [5.82 KB]
   └─ dist/
      ├─ extension/
      │  ├─ main.cjs [674.08 KB]
      │  └─ main.cjs.map [1.32 MB]
      └─ webview/
         ├─ dashboard.css [12.7 KB]
         ├─ dashboard.css.map [31.28 KB]
         ├─ main.js [35.66 KB]
         └─ main.js.map [137.9 KB]

 DONE  Packaged: C:\Trunk\PRIVATE\ClaudeTeam-maya-wt\claudeteam-0.0.1.vsix (11 files, 402.4 KB)
```

Note the `LICENSE.txt` line under `extension/` — vsce renamed the on-disk `LICENSE` (no extension) to `LICENSE.txt` inside the vsix, satisfying VS Code Marketplace expectations.

### Pre-change vsce signature (from sponsor's V1 dogfood report)

`WARNING LICENSE, LICENSE.md, or LICENSE.txt not found` — gone in this PR's output.

### Side-effect inventory

- `.vscodeignore` was checked — does not exclude `LICENSE`, so vsce includes it in the vsix without further changes.
- Webview rendering unchanged — this is a repo-root file + manifest scalar change only. No UI surface touched.
- No screenshot needed per the testing-strategy.md Self-Test contract — this PR does not change any user-visible surface (webview / commands / icons / chrome).

### Test gates

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (vitest) | 464 passed, 2 skipped, 0 failed (24 test files) |
| `npx vsce package --no-yarn` | LICENSE.txt included; zero warnings/errors |

## Notes for maintain-docs

The vsce LICENSE-rename behavior (on-disk `LICENSE` → `LICENSE.txt` inside vsix) was not previously captured in `.claude/docs/`. Worth a brief note in `vscode-extension-conventions.md` under "Build & package" if maintain-docs sees value: the filename inside the vsix differs from the source-tree filename, which can surprise future packaging work.
