# research(vscode-api): M2 VS Code Extension API prior-art + webview tech pick

Delivers M2-02. Research note is dispatch-ready for Felix (M2-01/M2-04) and Iris/Maya (M2-03/M2-05).

## Summary

- Confirms `WebviewViewProvider` (not `WebviewPanel`) is correct for Activity Bar sidebar placement — introduced VS Code 1.50, covered by `^1.85.0` engine floor.
- Recommends `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (VS Code ≥1.64) for `~/.claude/sessions/*.json`; no chokidar needed.
- Recommends vanilla TypeScript for the webview — Pixel Agents' React build produced a 291 KB webview bundle as concrete evidence of framework overhead at this scale.
- Confirms Pixel Agents hook port 55271 via live read of the server.json on disk.
- Documents the one pattern ClaudeTeam must NOT replicate: Pixel Agents ships with no CSP on the webview.

## Non-obvious findings

1. **Pixel Agents is in the BOTTOM PANEL, not Activity Bar.** Their `contributes.viewsContainers.panel` puts them in VS Code's bottom panel. ClaudeTeam uses `activitybar`. The `WebviewViewProvider` API is the same; only the `viewsContainers` location key differs. Not obvious from their README.

2. **Pixel Agents has zero CSP.** `Content-Security-Policy` is absent from their bundled extension and `enableScripts: true` with no meta tag. Their webview is fully permissive. Since ClaudeTeam renders data from `meta.json` and JSONL files (user-controlled content), this is a concrete security gap to avoid.

3. **`createFileSystemWatcher` with absolute paths is a VS Code 1.64 feature.** Simple glob patterns (without `RelativePattern`) only watch within the workspace. To watch `~/.claude/sessions/*.json` (outside any workspace), you must pass `new vscode.RelativePattern(vscode.Uri.file(absolutePath), '*.json')`. Our `^1.85.0` engine floor covers this — but Felix must use the `RelativePattern` form, not a bare glob string, or the watcher silently does nothing outside the workspace.

4. **`acquireVsCodeApi()` may only be called once per webview lifetime.** The webview must cache the returned object. Calling it twice throws. Pixel Agents caches it correctly. ClaudeTeam's `messageReceiver.ts` must do the same.

5. **Pixel Agents reads `dist/webview/index.html` from disk via `fs.readFileSync`.** They rewrite relative `./assets/...` paths to `webview.asWebviewUri()` via regex. This is functional but fragile. ClaudeTeam's planned approach of constructing the HTML string in `provider.ts` and injecting the bundle URI is cleaner.

6. **Empty `activationEvents: []` is valid since VS Code ~1.74.** VS Code auto-infers activation from registered contributions. Both explicit `onView:...` and implicit `[]` work; explicit is more auditable.

## Verified paths (AC6 compliance)

All concrete claims verified by direct file read or command output in this session:

- `%USERPROFILE%\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\package.json` — version, engines, contributes, activationEvents
- `%USERPROFILE%\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\dist\extension.js` — API patterns (resolveWebviewView, WebviewViewProvider, fs.watch, setInterval, no CSP, no chokidar, no createWebviewPanel)
- `%USERPROFILE%\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\dist\webview\assets\index-BUrEakFE.js` — React framework (createRoot present, 291 KB)
- `%USERPROFILE%\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\dist\hooks\claude-hook.js` — silent-fail pattern
- `%USERPROFILE%\.pixel-agents\server.json` — port 55271 confirmed live
- `%USERPROFILE%\.claude\settings.json` — all 11 hook types registered to Pixel Agents hook script
- VS Code 1.50 release notes (fetched) — WebviewView API introduction date
- VS Code 1.64 release notes (fetched) — absolute-path createFileSystemWatcher
- VS Code webview docs (fetched) — postMessage/onDidReceiveMessage signatures, CSP pattern, JSON constraint
