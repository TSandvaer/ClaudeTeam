# Terminal Tab Name on Session Card — 2026-05-27

## Question

Is it feasible to pick up the VS Code terminal tab name (set by `start-flow` via OSC 0 to the PBI title) and display it on the ClaudeTeam session card? If yes, what is the implementation path?

## Answer (1–3 sentences)

**Feasible — but only for CLI-entrypoint sessions running in a VS Code integrated terminal, not for `claude-vscode` extension-spawned sessions.** The correlation path is: get the parent PID of `claude.exe` from the OS process table → match to `terminal.processId` across `vscode.window.terminals` → read `terminal.name`. For the sponsor's `start-flow` workflow this path works when the orchestrator runs in an integrated terminal tab; it is unreliable or impossible when running from the VS Code chat panel or an external terminal.

## Evidence

### Q1: VS Code terminal API surface

Verified against local `vscode.d.ts` at `C:\Users\538252\AppData\Local\Programs\Microsoft VS Code\f6cfa2ea24\resources\app\out\vscode-dts\vscode.d.ts`.

**`Terminal` interface** (lines 7669–7746):
- `readonly name: string` — the tab's display label (set by OSC 0 at runtime).
- `readonly processId: Thenable<number | undefined>` — async; resolves to the **shell** PID (the process VS Code spawned to run the terminal, e.g. `pwsh.exe`). NOT the child process (claude.exe).
- `readonly shellIntegration: TerminalShellIntegration | undefined` — present only when shell integration is active; may never activate (cmd.exe, some PowerShell configs).

**`TerminalShellIntegration`** (lines 7828–7834):
- `readonly cwd: Uri | undefined` — current working directory. Not useful for session correlation.

**`window` namespace** (lines 11161–11185):
- `const terminals: readonly Terminal[]` — all currently open VS Code integrated terminals.
- `const onDidOpenTerminal: Event<Terminal>` — fires on terminal creation.
- `const onDidCloseTerminal: Event<Terminal>` — fires on terminal disposal.

Source: `C:\Users\538252\AppData\Local\Programs\Microsoft VS Code\f6cfa2ea24\resources\app\out\vscode-dts\vscode.d.ts` lines 7669–7746, 7828–7834, 11161–11185.

### Q2: Terminal ↔ session correlation heuristic

**`claude-vscode` sessions (entrypoint = `"claude-vscode"`):** The extension host's Node.js service (`Code.exe --type=utility --utility-sub-type=node.mojom.NodeService`) spawns `claude.exe` directly. Verified live on this machine — all 5 active sessions show parent `Code.exe` NodeService, not any shell:

```
claude PID=48200 -> Parent PID=57468 Name=Code.exe (NodeService)
claude PID=51304 -> Parent PID=58384 Name=Code.exe (NodeService)
```

These sessions have **no terminal parent** in `window.terminals`. There is no shell PID to match against `terminal.processId`. Correlation is structurally impossible for this entrypoint.

**`cli` sessions (entrypoint = `"cli"`):** When the sponsor runs `claude` from a VS Code integrated terminal, the chain is:
```
pwsh.exe (terminal.processId) → claude.exe (session PID in sessions/{pid}.json)
```
The correlation algorithm:
1. For each `SessionRecord` with `entrypoint === "cli"`, look up `claude.exe`'s parent PID via the OS process table.
2. For each `vscode.window.Terminal`, await `terminal.processId` (async).
3. Match: `terminalProcessId === parentPidOfClaudeExe` → `terminal.name` is the tab label.

Getting the parent PID in the extension host (Node.js) requires a subprocess call — options:
- `wmic process get parentprocessid,processid` (Windows, deprecated but present)
- PowerShell: `(Get-CimInstance Win32_Process -Filter "ProcessId=<pid>").ParentProcessId`
- `@vscode/windows-process-tree` npm package (VS Code's own — not in our deps)

None of these are in the current dependency set (`package.json` has only `js-yaml` and `zod`).

Source: live process inspection on this machine via `Get-CimInstance Win32_Process`, confirmed against sessions JSON at `C:\Users\538252\.claude\sessions\*.json`.

### Q3: Sponsor workflow reliability

The `start-flow` skill (`C:\Users\538252\.claude\skills\start-flow\SKILL.md` lines 36–43) emits the OSC 0 escape to rename the terminal tab:
```bash
printf '\033]0;%s\007' "{PBI_ID} {PBI_TITLE}"
```

The skill note (line 160) is explicit: *"The OSC 0 escape only changes the terminal tab title in VS Code. The Claude Code chat session header is not user-renamable from inside the agent."*

This means `start-flow` is invoked from a **VS Code integrated terminal** running a CLI-entrypoint Claude session. When it is, the correlation path (Q2) applies and `terminal.name` will contain the PBI title. Reliability depends on:

- (a) Terminal must be VS Code integrated — OSC 0 in an external terminal (Windows Terminal, ConEmu) would change that tab's title but it won't appear in `window.terminals`. **Risk: medium** — if sponsor has VS Code integrated terminal open, this works; external terminal is invisible.
- (b) `terminal.processId` is `Thenable<number | undefined>` — the async resolution adds latency on every tick and may return `undefined` for some terminal configurations. **Risk: low** in practice (returns promptly for standard shells).
- (c) The OSC 0 rename is best-effort. If the integrated terminal's tab title is already pinned by the user, the rename may not persist. **Risk: low** per skill's own notes.
- (d) `window.terminals` is only visible to extensions running in the same VS Code window as the terminal. Our extension is an Activity Bar panel in VS Code — same window. **Risk: none** for the standard case.

**Bottom line on reliability:** When sponsor uses VS Code integrated terminal for the orchestrator session, correlation works reliably. When sponsor uses external terminal (or VS Code chat panel), it silently produces no tab name — no error, just empty/null.

### Q4: Wire-shape additions

To carry the terminal tab name, `SessionRecord` needs one new optional field:

```typescript
// In src/shared/types.ts — SessionRecord
tabName?: string;  // Terminal tab label from window.terminals match; undefined when not CLI or no match
```

And `SessionTree` correspondingly (already passes through `SessionRecord` fields):

```typescript
// SessionTree.tabName?: string — would render on the session card header
```

The extension host resolves this asynchronously (terminal.processId is Thenable) — the resolution must happen once per watcher tick, not per-render. The watcher loop would need to gather terminal matches at tick start and pass into `buildAgentTree`.

### Q5: Render placement

The session card header currently renders: `shortId` + `cwd`. The `ai-title` field (from the parent JSONL's `ai-title` record) is already surfaced as `SessionTree.title` — verified: `ca69fcdd` session has `aiTitle: "Polish obs13 diagnostics"`.

Proposed placement: render `tabName` as a secondary label below `title`, only when present. Or replace/supplement the `ai-title` with `tabName` when available (tabName is sponsor-authored intent; ai-title is AI-generated summary).

Iris should decide the exact visual treatment — this is her design lane, not Bram's.

### Q6: OOS sanity

Out of scope:
- Supporting external terminals (Windows Terminal, ConEmu). `window.terminals` is VS Code-only.
- Supporting `claude-vscode` entrypoint sessions (no terminal parent PID to match).
- Real-time tab-rename updates mid-session. One read per tick is sufficient.
- Shell integration (`TerminalShellIntegration`) — not needed; `terminal.name` is on the base `Terminal` interface.
- Multi-platform parent PID lookup abstraction. Windows-first is correct for V1 (sponsor is on Windows, `wmic`/CIM works).

## What I did NOT verify

1. **Whether `wmic` or PowerShell CIM call from Node.js child_process works within the VS Code extension host sandbox.** VS Code extensions run in a Node.js process that can call child_process; the subprocess can invoke `wmic`. But I did not execute this from inside the extension host context — there may be process sandbox restrictions. **Would need a probe from Felix during impl.**

2. **Whether `terminal.processId` resolves correctly when the terminal was opened before the ClaudeTeam extension activated.** The `window.terminals` snapshot at activation includes all pre-existing terminals, but processId resolution for those has not been tested in this session.

3. **Whether the OSC 0 rename persists after the terminal loses and regains focus in VS Code** — the tab label may reset to the shell name on certain VS Code versions. Not probed.

4. **`@vscode/windows-process-tree` availability + licensing** — it's a VS Code internal package, not published to npm under that name. Alternative: `node-windows-process-tree`. Not checked for compatibility with the project's esbuild/CJS pipeline.

## Implications for ClaudeTeam

- **Feasible for the sponsor's primary workflow** — CLI-entrypoint orchestrator sessions in an integrated terminal can pick up the tab name set by `start-flow`. The PBI title appears on the session card header.
- **Implementation ticket scope (Felix):** (1) Add async parent-PID lookup in `sessionRegistry.ts` or a new `terminalMatcher.ts` helper; (2) expose `vscode.window.terminals` to the watcher loop (requires passing it in from `main.ts`); (3) add `tabName?: string` to `SessionRecord` and `SessionTree`; (4) render `tabName` in `sessionBlock.ts` per Iris's placement decision.
- **Dependency concern:** getting the parent PID on Windows needs either a subprocess call or a new npm dependency. Felix should evaluate `node-windows-process-tree` vs. inline `wmic`/PowerShell subprocess call for reliability + esbuild compatibility.
- **Silent graceful degradation** is the correct fallback: sessions with `entrypoint === "claude-vscode"` or no matched terminal simply omit `tabName`. No error state needed.
