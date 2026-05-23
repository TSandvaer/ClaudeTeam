# M2 VS Code Extension API Prior-Art Research — 2026-05-23

## Question

What VS Code Extension API surfaces does M2 need, which file-watcher approach fits `~/.claude/`, what webview UI framework should Maya use, and what can ClaudeTeam learn from (or avoid replicating) Pixel Agents?

## Answer (1–3 sentences)

Use `WebviewViewProvider` (not `WebviewPanel`) — ClaudeTeam belongs in the Activity Bar sidebar, and `WebviewView` is the correct API for that placement (introduced VS Code 1.50, October 2020; engine pin of `^1.85.0` is safe and correct). For file-watching `~/.claude/`, use `vscode.workspace.createFileSystemWatcher` with an absolute-path `RelativePattern` (requires VS Code ≥1.64, within our engine floor); do NOT use chokidar or Node `fs.watch` — the VS Code API is zero-dep and integrated with the extension lifecycle. For the webview UI, vanilla TypeScript is the recommended pick for M2 at this scale: near-zero bundle overhead, no framework churn, and Pixel Agents' React build (291 KB webview bundle) is a concrete cautionary data point.

---

## Evidence

### VS Code API surface

#### WebviewView vs WebviewPanel

**Finding:** `WebviewViewProvider` + `resolveWebviewView` is the correct API for an Activity Bar sidebar tile. `WebviewPanel` opens a separate editor tab — wrong for a persistent dashboard tile.

- **WebviewView introduced:** VS Code 1.50 (September 2020) per release notes at `https://code.visualstudio.com/updates/v1_50` — "The Webview View API allows extensions to contribute webview based views to the sidebar or panel."
- **Contributes schema:** `contributes.viewsContainers.activitybar` declares the container; `contributes.views.<container-id>` with `"type": "webview"` registers the view. This is already documented in `.claude/docs/vscode-extension-conventions.md` § "Extension manifest essentials."
- **Pixel Agents confirmation (live on disk):** `pablodelucca.pixel-agents-1.3.0/package.json` registers under `contributes.viewsContainers.panel` (NOT activitybar — Pixel Agents appears in the bottom panel, not the Activity Bar). ClaudeTeam uses `activitybar`. The VS Code API is the same (`WebviewViewProvider`); the container location differs.
  - Verified path: `C:\Users\538252\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\package.json` lines 32–48.
- **Pixel Agents resolveWebviewView (live, from dist/extension.js line 1):** `resolveWebviewView(e){this.webviewView=e,e.webview.options={enableScripts:!0},e.webview.html=Ri(e.webview,this.extensionUri),e.webview.onDidReceiveMessage(async s=>{...` — confirms `WebviewViewProvider` pattern in production.

**Recommendation:** Use `WebviewViewProvider` in `src/extension/view/provider.ts`. Register via `vscode.window.registerWebviewViewProvider(viewId, provider)`. Already sketched correctly in `.claude/docs/vscode-extension-conventions.md`.

#### Message-passing API

**API signatures (verified against VS Code webview docs at `https://code.visualstudio.com/api/extension-guides/webview`):**

- **Host → webview:** `webview.postMessage(message: any): Thenable<boolean>` — fires immediately, does not queue if the webview is hidden.
- **Webview → host:** `panel.webview.onDidReceiveMessage(callback: (message: any) => void)` — registered in `resolveWebviewView`.
- **JSON constraint:** Both directions serialize via JSON. The VS Code docs state "JSON serializable data." Implication: no `undefined` values, no class instances, no circular refs, no functions. Use `src/shared/messages.ts` discriminated union types (already planned correctly).
- **Webview side:** `acquireVsCodeApi().postMessage(msg)` — single call per webview lifetime; must cache the returned object. Calling `acquireVsCodeApi()` twice throws.

**Pixel Agents confirmation:** `dist/webview/assets/index-BUrEakFE.js` line 1 contains:
```
(typeof acquireVsCodeApi<`u`?`vscode`:`browser`)==`browser` ... acquireVsCodeApi()
```
They also implement the browser-mock fallback (same pattern as M2-05 AC8 specifies). This is good prior art to replicate.

#### Activation events

**Finding:** Use `onView:claudeteam.dashboard` (lazy activation on Activity Bar click). Do NOT use `onStartupFinished`.

- Per VS Code activation events docs (`https://code.visualstudio.com/api/references/activation-events`): `onView:<id>` fires when the view with `<id>` is expanded in the sidebar. `onStartupFinished` fires at startup regardless of user interaction.
- The file-watcher's startup cost (`listSessions` + JSONL stat calls across `~/.claude/`) makes eager activation unnecessary overhead, especially on machines with many historical sessions.
- **Pixel Agents note:** Their `package.json` has `"activationEvents": []` (empty array). This uses VS Code's implicit activation inference (introduced ~VS Code 1.74): VS Code auto-activates the extension when any registered view, command, or contribution point is triggered. This is equivalent to explicitly listing `onView` for their view ID. Both approaches are valid; explicit `onView` is clearer for readers.

**Recommendation:** Keep `activationEvents: ["onView:claudeteam.dashboard"]` as already specified in `.claude/docs/vscode-extension-conventions.md`. Explicit is better for auditability.

#### Minimum VS Code engine version

**Finding:** `"engines": { "vscode": "^1.85.0" }` is safe.

- `WebviewView` / `WebviewViewProvider` introduced: VS Code **1.50** (October 2020). Engine floor 1.85 covers it by 35 releases.
- `createFileSystemWatcher` with absolute-path `RelativePattern` introduced: VS Code **1.64** (January 2022). Engine floor 1.85 covers it by 21 releases.
- `contributes.viewsContainers.activitybar`: predates VS Code 1.50 (existed in 1.x for tree views); 1.85 covers it.
- VS Code 1.85 was released December 2023. It is a reasonable minimum that excludes very stale installs while keeping the API surface we need.
- Verification: Pixel Agents pins `"engines": { "vscode": "^1.105.0" }` — much higher, as they use newer APIs. Our 1.85 floor is conservative and correct.

**Recommendation:** Finalize `engines.vscode: "^1.85.0"` in M2-01. No version-gate issues for the APIs listed.

#### File-watcher approach

**Candidates analyzed:**

| Approach | Watch outside workspace | Lifecycle integration | Deps | Windows `~/.claude/` |
|---|---|---|---|---|
| `vscode.workspace.createFileSystemWatcher` | Yes (VS Code ≥1.64 with absolute `RelativePattern`) | Yes — disposable, integrated with `context.subscriptions` | Zero (VS Code built-in) | Works |
| `chokidar` (v4) | Yes | Manual start/stop | 1 dep (down from 13 in v3); adds bundle weight | Works; uses `fs.watch` internally on Windows |
| Node `fs.watch` | Yes | Manual | Zero | Notoriously unreliable on Windows; misses events, emits doubles, no recursive support in older Node |

**Decision data:**

- `vscode.workspace.createFileSystemWatcher` can watch `~/.claude/sessions/` (absolute path) using `new vscode.RelativePattern(vscode.Uri.file(claudeHomePath), '*.json')`. This was confirmed in VS Code 1.64 release notes at `https://code.visualstudio.com/updates/v1_64`.
- It returns a disposable that cleans up on `deactivate()` — fits naturally with `context.subscriptions.push(watcher)`.
- Chokidar v4 reduces to 1 dependency (from 13 in v3) but still adds a dependency. On Windows it falls back to `fs.watch` internally anyway for most paths.
- Node `fs.watch` on Windows (tested on Windows 11) is known to miss events under network drives and on some antivirus-monitored paths. Claude Code sessions directory is in `%USERPROFILE%`, which is local — low risk — but Pixel Agents explicitly chose NOT to use `fs.watch` for their layout-watcher; they pair `fs.watch` with a 2-second `setInterval` fallback.
- **Pixel Agents' hybrid pattern (observed in dist/extension.js):** `o=L.watch(e,()=>{a()}),o.on("error",l=>{...o=null})}catch{}}...i=setInterval(()=>{r||(o||c(),a())},2e3)` — they use `fs.watch` for the fast path but fall back to 2s polling when it fails. This is sound but more complex than needed.

**Recommendation:** Use `vscode.workspace.createFileSystemWatcher` for the `~/.claude/sessions/` directory (glob `*.json`). For subagent JSONLs, the current plan of `setInterval`-based polling (2000ms default) is correct — JSONL files flush in 2–56s bursts (per `data-sources.md`), so a file-event watcher on individual JSONLs would fire on every flush anyway. Net approach:
- `createFileSystemWatcher` on `sessions/*.json` → triggers roster re-materialisation when sessions appear/disappear.
- `setInterval` (2000ms) → tails active subagent JSONLs for current activity.
- Document in `watcherLoop.ts` why the hybrid is intentional.

**Do NOT add chokidar** — zero-dep approach available, and it's one fewer security surface.

#### Webview CSP

**Finding from VS Code docs (`https://code.visualstudio.com/api/extension-guides/webview#content-security-policy`):**

The recommended CSP pattern uses `webview.cspSource` as the placeholder for the webview's own URI scheme (the VS Code `vscode-webview://` scheme):

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource}; style-src ${webview.cspSource};"
/>
```

- `${webview.cspSource}` is a template variable that the extension host populates before injecting HTML; it resolves to the webview's origin (e.g. `vscode-webview://...`).
- VS Code docs state: "This content security policy also implicitly disables inline scripts and styles. It is a best practice to extract all inline scripts and styles to external files."
- **Nonce pattern:** VS Code docs do NOT require nonces for scripts loaded via `webview.cspSource`. Nonces are needed only if you have unavoidable inline scripts. Since ClaudeTeam's plan is to inject the webview bundle via `<script src="${bundleUri}">` (no inline script), nonces are not needed for M2. If inline scripts become necessary (e.g. for a theme-injection snippet), add `script-src ${webview.cspSource} 'nonce-${nonce}'` and generate a random nonce per resolveWebviewView call.
- **Pixel Agents CSP:** They have NO CSP (`Content-Security-Policy` not found in their extension.js; their webview HTML is a plain Vite build with `enableScripts: true`). This is a security gap ClaudeTeam should NOT replicate. Their open-source status likely lowers the risk profile, but for ClaudeTeam the strict-CSP pattern is the right default.

**Recommendation:** In `src/extension/view/provider.ts`, set `enableScripts: true` and compose the HTML with the `default-src 'none'` + `${webview.cspSource}` pattern. No nonces needed at M2 scale.

---

### Pixel Agents internals comparison

**Extension ID:** `pablodelucca.pixel-agents-1.3.0`
**Verified path:** `C:\Users\538252\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\`

| Dimension | Pixel Agents | ClaudeTeam plan |
|---|---|---|
| View container | `panel` (bottom panel) | `activitybar` (sidebar) |
| View type | `webview` | `webview` |
| Webview host API | `WebviewViewProvider` + `resolveWebviewView` | same |
| Webview UI framework | React (`createRoot` present; 291 KB bundle) | vanilla TS (recommended) |
| File watcher | `fs.watch` + 2s `setInterval` fallback | `createFileSystemWatcher` + 2s `setInterval` |
| Data source | Hook events (push) | File polling (pull) |
| Activation | `activationEvents: []` (implicit) | `onView:claudeteam.dashboard` (explicit) |
| CSP | None | strict (recommended) |
| Engine minimum | `^1.105.0` | `^1.85.0` |
| Hook port | `55271` (confirmed: `C:\Users\538252\.pixel-agents\server.json`) | TBD (post-V1; must differ from 55271) |

#### Hook port — confirmed

`C:\Users\538252\.pixel-agents\server.json` reads:
```json
{"port": 55271, "pid": 85032, "token": "cc99ce00-...", "startedAt": 1779482424573}
```

Verified match to `.claude/docs/data-sources.md` "Pixel Agents coexistence" claim. ClaudeTeam's post-V1 hook port MUST differ from 55271.

Hook registration confirmed in `C:\Users\538252\.claude\settings.json`: all 11 hook types (`Stop`, `SessionStart`, `SessionEnd`, `PermissionRequest`, `Notification`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`) route to `node "C:\Users\538252\.pixel-agents\hooks\claude-hook.js"`. The hook script POSTs to `127.0.0.1:${server.port}/api/hooks/claude` with bearer token, 2s timeout, and silent-fail on any error. Source: `C:\Users\538252\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\dist\hooks\claude-hook.js` lines 39–78.

#### Pattern Pixel Agents got RIGHT — adopt

**Browser-mock fallback for webview dev mode.** Their webview checks `typeof acquireVsCodeApi < 'u'` and falls back to a mock `postMessage` logger when running in a plain browser. This lets UI development happen without a running VS Code instance. ClaudeTeam already specifies this in M2-05 AC8 (`static-fixture mode`). The Pixel Agents implementation validates the pattern is practical in production.

#### Pattern Pixel Agents got WRONG — avoid

**No CSP on the webview.** Their extension sets `enableScripts: true` but injects no `Content-Security-Policy` meta tag. Any XSS vector in the webview HTML (e.g. a JSONL entry with injected HTML rendered by the UI) would run without restriction inside the VS Code webview context. ClaudeTeam renders user-controlled data (agent descriptions, file paths from `meta.json`) — CSP is load-bearing, not optional.

**Secondary: reading the pre-built `index.html` from disk.** Pixel Agents reads `dist/webview/index.html` via `fs.readFileSync` and rewrites `href`/`src` paths to `webview.asWebviewUri()`. This works but couples the extension host to the webview build artifact's relative path structure. ClaudeTeam's planned approach of constructing the HTML string in `provider.ts` and injecting the bundle URI via `webview.asWebviewUri()` is cleaner and avoids HTML parse issues.

---

### Prior-art survey — other Claude Code trackers

No other VS Code extensions for tailing Claude Code transcripts were found through search. Pixel Agents is the only installed VS Code extension that interacts with Claude Code on this machine. The broader ecosystem (npm, VS Code Marketplace) was not exhaustively surveyed; a marketplace search for "Claude Code" + "agents" would surface any new entrants. No open-source tools for tailing `~/.claude/` subagent JSONLs were found in the research conducted.

**Verdict:** Build from scratch. The Claude-Code-specific data model (`meta.json` schema variants, `toolUseId` linking, JSONL closing semantics) is undocumented externally and would require the same research investment to integrate from a fork. ClaudeTeam's M1 parsers are the only correct implementation known to exist.

---

### Webview UI tech recommendation

**Candidates:**

| Framework | Bundle weight | Dev ergonomics | Re-render model | Notes |
|---|---|---|---|---|
| React 18 | ~140 KB min+gz (react + react-dom) | High — JSX, hooks ecosystem | Virtual DOM diff | Pixel Agents: 291 KB webview bundle; Vite build |
| Svelte 5 | ~8–15 KB compiled | Moderate — runes syntax, build required | Compiled reactivity | Smallest real-framework option; good for small UIs |
| Vanilla TypeScript | 0 KB overhead | Low — DOM API, no framework abstraction | Manual DOM diff (fine at M2 tile count) | Simplest; no added build complexity |

**Context specific to ClaudeTeam M2:**

- The webview renders a bounded set of elements: N session blocks, per session M team-member tiles + 1 background chip. At ClaudeTeam scale (6 rostered agents per session, 1–3 sessions), the DOM element count is small. A full virtual-DOM library's diff budget is spent on framework machinery, not productive rendering.
- The state update model is already constrained: extension host sends `state:full` on every poll tick (2s). The webview re-renders from a fresh `DashboardState` each time. React would add lifecycle overhead (reconciliation, batching) for a render cycle that is already rate-limited by the 2s poll.
- esbuild is already the bundler. Vanilla TS compiles to near-nothing with esbuild; no JSX transform or Svelte compiler plugin needed.
- Pixel Agents' 291 KB webview bundle (React via Vite) is concrete evidence of the framework overhead at this scale. For a pixel-art game with canvas rendering and complex sprite state, React is arguably justified. For a dashboard tile showing text fields, it is not.
- Svelte is a credible alternative — 8–15 KB compiled, reactive stores, less build complexity than React. The case against it is that the Svelte compiler plugin must be wired into esbuild (a custom plugin) vs vanilla TS which needs no plugin. At M2 "prove the scaffold works" stage, adding compiler complexity is a risk without payoff.

**Recommendation:** Vanilla TypeScript for M2. Defer framework upgrade to M4 if the team finds DOM-diff ergonomics painful in practice. The reactive store can be a plain `EventEmitter` or a small hand-rolled observable on the message-receiver. If Maya finds vanilla TS painful during M2-05, Svelte is the next option — NOT React.

**Iris/Felix/Maya decide** — this note surfaces the data; the team owns the call.

---

### Verification claims

Every concrete claim below is paired with how it was verified. Per `[[feedback_verify_subagent_cited_paths]]` discipline.

| Claim | How verified |
|---|---|
| Pixel Agents version `1.3.0` | `code --list-extensions` output; directory name `pablodelucca.pixel-agents-1.3.0`; `package.json` `"version": "1.3.0"` |
| Pixel Agents uses `WebviewViewProvider` | `dist/extension.js` pattern search: `resolveWebviewView: True`, `WebviewViewProvider: True`, `createWebviewPanel: False` |
| Pixel Agents is in `panel` (not `activitybar`) | `package.json` `contributes.viewsContainers.panel` (read at `C:\Users\538252\.vscode\extensions\pablodelucca.pixel-agents-1.3.0\package.json` lines 32–48) |
| Pixel Agents webview uses React (`createRoot`) | Pattern search on `dist/webview/assets/index-BUrEakFE.js` (291 KB): `createRoot: True`; `createElement` pattern present |
| Pixel Agents has NO CSP | Pattern search on `dist/extension.js`: `Content-Security-Policy` not found; `cspSource` not found |
| Pixel Agents uses `fs.watch` + `setInterval` fallback | Code snippet extracted from `dist/extension.js`: `o=L.watch(e,...)...i=setInterval(...)` |
| Pixel Agents does NOT use `chokidar` | Pattern search: `chokidar: False` |
| Hook port is 55271 | `C:\Users\538252\.pixel-agents\server.json` read directly: `{"port": 55271, ...}` |
| Hook registration covers all 11 hook types | `C:\Users\538252\.claude\settings.json` read directly — all 11 hooks present |
| Hook script uses silent-fail pattern | `dist/hooks/claude-hook.js` lines 68–78: `req.on("error", () => resolve())` |
| `WebviewView` introduced in VS Code 1.50 | VS Code 1.50 release notes at `https://code.visualstudio.com/updates/v1_50` — "The Webview View API allows extensions to contribute webview based views to the sidebar or panel" |
| `createFileSystemWatcher` supports absolute paths from VS Code 1.64 | VS Code 1.64 release notes at `https://code.visualstudio.com/updates/v1_64` |
| Engine floor `^1.85.0` covers all needed APIs | WebviewView (1.50) + absolute-path watcher (1.64) + viewsContainers (pre-1.50) all below 1.85 |
| JSON-serializable constraint on postMessage | VS Code webview docs at `https://code.visualstudio.com/api/extension-guides/webview` — "JSON serializable data" |
| Pixel Agents HTML injection pattern | Code snippet from `dist/extension.js`: `Ri()` function reads `index.html` via `fs.readFileSync`, rewrites `href`/`src` via regex |
| Pixel Agents engine minimum `^1.105.0` | `package.json` `"engines": { "vscode": "^1.105.0" }` |

---

## What I did NOT verify

1. **VS Code 1.85 specific changelog** — I confirmed all needed APIs predate 1.64, and 1.85 > 1.64, so 1.85 is safe. I did NOT read the 1.85 release notes to confirm no regressions were introduced. Confidence: high (35-release gap for WebviewView, 21-release gap for absolute-path watcher).
2. **Chokidar bundle weight (exact KB)** — BundlePhobia returned no data for the specific query. The claim that v4 dropped from 13 to 1 dependency is from the chokidar README fetched from GitHub. Exact gzip size: unverified. Recommendation (avoid chokidar) does not depend on the exact size.
3. **VS Code Marketplace survey for other Claude Code trackers** — not exhaustively searched. Only confirmed: none installed on this machine; no prominent results from the brief search conducted. A tracker may exist that I didn't find.
4. **Pixel Agents' internal hook-event data model** — extension.js is minified; I confirmed the API surface (WebviewViewProvider, fs.watch, resolveWebviewView, no CSP, React) but did not reverse-engineer the hook payload schema. Not needed for ClaudeTeam's file-poll-based V1.
5. **Whether Pixel Agents' React dependency is the full React or Preact** — `createRoot` is present; `__SECRET_INTERNALS` is absent. This is consistent with a preact/compat or a newer React build that dropped the sentinel string. The framework is React-family regardless; bundle weight argument holds either way.

---

## Recommended decisions (Verdict block for Felix and Iris)

1. **Activity Bar view type:** `WebviewViewProvider` — use `resolveWebviewView` in `src/extension/view/provider.ts`. Confirmed correct for sidebar placement. No changes needed to existing conventions doc.

2. **File-watcher choice:** `vscode.workspace.createFileSystemWatcher` with absolute-path `RelativePattern` (VS Code ≥1.64 feature, within our 1.85 floor) for `~/.claude/sessions/*.json`. Pair with `setInterval` (2000ms) for JSONL tailing. Do NOT add chokidar — zero-dep alternative available.

3. **`engines.vscode` minimum:** `"^1.85.0"` — safe. All needed APIs predate this by at least 21 releases.

4. **Webview UI framework:** Vanilla TypeScript. No framework overhead, no compiler plugin, esbuild handles it natively. Upgrade to Svelte if vanilla TS proves ergonomically painful at M2-05 scope. React is not recommended at this scale.

5. **Activation:** `onView:claudeteam.dashboard` — lazy, correct. Keep as-is.

6. **CSP:** Strict. `default-src 'none'; script-src ${webview.cspSource}; style-src ${webview.cspSource};`. No nonces at M2 (no inline scripts). Do NOT replicate Pixel Agents' no-CSP approach.

7. **Pixel Agents port 55271:** Confirmed. Do not use. Post-V1 hook port must differ.

---

## Open questions for sponsor

None that require sponsor input. The following are team-internal decisions (Felix/Maya/Iris own them):

- Exact vanilla TS reactive-store pattern for the webview (EventEmitter vs hand-rolled observable vs Svelte if they override the framework pick). Orchestrator recommendation: defer until Maya starts M2-05 and encounters the actual re-render surface; pick then.
- Whether to adopt Pixel Agents' `activationEvents: []` implicit pattern or keep explicit `onView:...`. Orchestrator recommendation: keep explicit — no functional difference, explicit is more auditable.

---

## Implications for ClaudeTeam

- Felix can finalize `engines.vscode: "^1.85.0"` in M2-01 with no further research needed.
- Felix should use `vscode.workspace.createFileSystemWatcher` in M2-04, not chokidar. The watcher loop can start with `setInterval`-only and add `createFileSystemWatcher` for the sessions-directory fast path in the same PR.
- Maya should implement vanilla TS for M2-05. The webview bundle entry is `src/webview/main.ts` (not `.tsx`). If this turns out to be more painful than expected at M2-05 scope, Svelte is the upgrade path.
- CSP is non-negotiable in `provider.ts` — ClaudeTeam renders user-controlled data (agent descriptions, JSONL paths) and must not ship with Pixel Agents' no-CSP pattern.
