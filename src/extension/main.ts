/**
 * ClaudeTeam extension entry point (M2-06 — live host ↔ webview bridge).
 *
 * Exports `activate` and `deactivate` per the VS Code extension lifecycle.
 * `activate` is called lazily on `onView:claudeteam.dashboard` (per
 * package.json activationEvents). It:
 *   1. Registers the WebviewViewProvider.
 *   2. On view-resolved: starts the file-watcher loop, wires its emissions
 *      to `postState(webview, state)`, and installs the webview → host
 *      message handlers (`ui:open-transcript`, `ui:open-roster`,
 *      `ui:refresh`).
 *   3. Registers the command palette entries (Refresh, Open Roster, Open
 *      Transcript-of-the-selected-tile) — thin shims around the webview
 *      handlers.
 *
 * The file-watcher loop is gated on view resolution — it does NOT start at
 * activation time, only when the user opens the Activity Bar tile. This
 * preserves the <100ms cold-activation target per
 * `.claude/docs/vscode-extension-conventions.md` § "Activation cost".
 *
 * **Subscription-leak fix (M2-06 absorbed-NIT #1).** Prior to this PR,
 * `onResolved` pushed a fresh `dispose` wrapper onto `context.subscriptions`
 * on every invocation — VS Code calls `resolveWebviewView` on every webview
 * reload (e.g. `Developer: Reload Window`), and the subscription stack would
 * grow unbounded across reload cycles. The fix: hold the prior disposable
 * out-of-band and call its `dispose()` BEFORE rebinding, and only register
 * the cleanup wrapper on `context.subscriptions` ONCE during `activate`.
 *
 * Source: .claude/docs/vscode-extension-conventions.md
 *         .claude/docs/data-sources.md §2 (cwdToSlug for transcript path)
 *         team/nora-pl/milestone-2-backlog.md §M2-06 AC2/AC3/AC4/AC5/AC6/AC7(e)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import * as vscode from "vscode";

import {
  ClaudeTeamViewProvider,
  VIEW_ID,
  type WebviewMessageHandlers,
} from "./view/provider.js";
import { startWatcher, type WatcherHandle } from "./watcher/watcherLoop.js";
import { startRosterWatcher } from "./roster/rosterWatcher.js";
import {
  openRoster,
  registerOpenRosterCommand,
} from "./commands/openRoster.js";
import { postState } from "./messageBus.js";
import { cwdToSlug } from "../shared/slug.js";

/**
 * Called by VS Code when the extension activates (lazy — fires on first
 * `onView:claudeteam.dashboard` event, i.e. when the user opens the Activity
 * Bar tile for the first time). Keep this fast (<100ms target).
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ClaudeTeamViewProvider(context.extensionUri);

  // Held out-of-band across resolveWebviewView invocations. Disposed-and-
  // replaced on every rebind so the subscription stack stays bounded
  // (M2-06 absorbed-NIT #1 — see AC7(e) verification).
  let watcherHandle: WatcherHandle | null = null;
  /**
   * Roster YAML watcher (M3-01). Disposed-and-replaced on every webview
   * resolve in lockstep with `watcherHandle`. The cleanup wrapper below
   * tears it down on `deactivate()`.
   */
  let rosterWatcherDisposable: vscode.Disposable | null = null;

  // Note (M3-02): the `claudeteam.openRoster` command and the
  // `ui:open-roster` webview message both delegate to
  // {@link openRoster} from `./commands/openRoster.js`, which resolves the
  // GLOBAL roster path via `claudeteam.rosterPath` config (or the
  // documented default `~/.claudeteam/teams.yaml`). No `resolvedRosterPath`
  // closure is needed on this side — `openRoster()` reads config fresh
  // every invocation, so the most recent edited value always wins.

  // Cleanup wrapper registered ONCE on activation. It tracks the *current*
  // watcher reference at the time `deactivate()` runs — not a snapshot from
  // the closure captured at resolve-time. Avoiding the per-resolve push is
  // the leak fix.
  context.subscriptions.push({
    dispose: () => {
      watcherHandle?.dispose();
      watcherHandle = null;
      rosterWatcherDisposable?.dispose();
      rosterWatcherDisposable = null;
    },
  });

  provider.onResolved((webview) => {
    // Dispose any prior watcher BEFORE rebinding — VS Code resolves the view
    // again after `Reload Window`, and a stale watcher would keep ticking
    // against a disposed webview (postMessage throws → caught in messageBus).
    watcherHandle?.dispose();
    rosterWatcherDisposable?.dispose();
    rosterWatcherDisposable = null;

    const config = vscode.workspace.getConfiguration("claudeteam");
    const pollIntervalMs = config.get<number>("pollIntervalMs") ?? 2000;
    const rosterPathOverride = config.get<string>("rosterPath") ?? "";
    // M3-01 AC8: feature-flagged polling fallback for FS-watcher unreliability.
    // Default 0 = OFF; positive values enable a setInterval-driven mtime check.
    const rosterPollIntervalMs =
      config.get<number>("rosterPollIntervalMs") ?? 0;

    const claudeHome = join(homedir(), ".claude");
    const globalRosterPath =
      rosterPathOverride.length > 0
        ? rosterPathOverride
        : join(homedir(), ".claudeteam", "teams.yaml");

    // Project roster: <first workspace folder>/.claude/teams.yaml when a
    // folder is open. Falls through to undefined (loader treats absent paths
    // as "no project roster").
    const projectRosterPath = resolveProjectRosterPath();

    watcherHandle = startWatcher({
      claudeHome,
      globalRosterPath,
      projectRosterPath,
      pollIntervalMs,
      onStateChange: (state) => {
        void postState(webview, state);
      },
      logger: {
        warn: (msg) => console.warn(`[claudeteam.watcher] ${msg}`),
      },
    });

    // M3-01: live YAML hot-reload. On any change to the global or per-project
    // roster file, debounce 250ms, then trigger a watcher tick. The tick
    // re-runs loadRoster (already inside runTick) and reposts state to the
    // webview — so the user's YAML edit lands in the dashboard within
    // ~debounce + 1 tick (typically <500ms). The watcher itself never
    // throws — parse/validation failures surface through the matcher's
    // input as the previous valid roster (loadRoster already swallows
    // errors and reports them in `errors`); M3-04 renders the chip.
    rosterWatcherDisposable = startRosterWatcher({
      globalPath: globalRosterPath,
      projectPath: projectRosterPath,
      pollIntervalMs: rosterPollIntervalMs,
      onRosterChange: () => {
        // The tick re-reads disk; we discard the RosterLoadResult here
        // and let runTick own the canonical reload. Keeps a single source
        // of truth for "what roster is in effect right now".
        watcherHandle?.triggerTick();
      },
      logger: {
        warn: (msg) => console.warn(`[claudeteam.rosterWatcher] ${msg}`),
        info: (msg) => console.info(`[claudeteam.rosterWatcher] ${msg}`),
      },
    });

    // Wire webview → host message dispatch. Handlers close over the current
    // watcherHandle / webview / resolvedRosterPath — replacing the handler
    // set on every resolve is intentional (the prior set referenced the
    // now-disposed watcher).
    const handlers: WebviewMessageHandlers = {
      onOpenTranscript: (msg) => {
        handleOpenTranscript(
          msg.payload.sessionId,
          msg.payload.agentId,
          claudeHome,
          () => watcherHandle?.getLastState() ?? null,
        );
      },
      onOpenRoster: () => {
        // M3-02 AC6: the webview "Edit Roster" button surfaces the same
        // openRoster flow as the command palette — auto-creates the file
        // if missing. Eliminates the NIT #3 (M3-01 PR #35 comment 4528643161)
        // existsSync→createFileSystemWatcher race by guaranteeing the
        // directory + file exist after this handler returns.
        void openRoster();
      },
      onRefresh: () => {
        watcherHandle?.triggerTick();
      },
    };
    provider.setMessageHandlers(handlers);
  });

  // Register the WebviewViewProvider for the Activity Bar tile.
  // The view-id must match package.json contributes.views entry.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  // Register commands declared in package.json contributes.commands.
  // These are thin shims that delegate to the webview message handlers so
  // the command palette and webview UI funnel through the same code paths.
  //
  // `claudeteam.openRoster` is registered separately via
  // {@link registerOpenRosterCommand} — it owns its own auto-create-on-
  // missing logic and does not need a closure over `watcherHandle`.
  registerOpenRosterCommand(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("claudeteam.refresh", () => {
      watcherHandle?.triggerTick();
    }),

    vscode.commands.registerCommand(
      "claudeteam.openAgentTranscript",
      // The command palette has no way to pre-select an agent; surface a
      // hint to use the dashboard tiles. Tile clicks go through the
      // `ui:open-transcript` webview message above.
      () => {
        void vscode.window.showInformationMessage(
          "ClaudeTeam: click an agent tile in the dashboard to open its transcript.",
        );
      },
    ),
  );
}

/**
 * Called by VS Code on extension deactivation (window close, disable,
 * reload). Cleanup runs via `context.subscriptions` — the dispose wrapper
 * registered in `activate` tears down the live watcher.
 */
export function deactivate(): void {
  // No-op — cleanup via context.subscriptions on deactivate.
}

// =============================================================================
// Webview-message handlers (exported for unit test coverage)
// =============================================================================

/**
 * Resolve project roster path from the first workspace folder, if any.
 * Returns undefined when no folder is open (extension running without a
 * workspace — still valid; only global roster applies).
 *
 * Exported for tests.
 */
export function resolveProjectRosterPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return join(folder.uri.fsPath, ".claude", "teams.yaml");
}

/**
 * Open the JSONL transcript for a given (sessionId, agentId). The path is
 * derived from the last-known state's `cwd` via the canonical `cwdToSlug`
 * rule (see `.claude/docs/data-sources.md` §2).
 *
 * Defensive behavior (per AC3):
 *   - Unknown sessionId → error message; do NOT throw.
 *   - File doesn't exist on disk → error message; do NOT throw.
 *   - showTextDocument failure → error message swallowed; do NOT throw.
 *
 * Exported for unit test coverage.
 */
export function handleOpenTranscript(
  sessionId: string,
  agentId: string,
  claudeHome: string,
  getLastState: () => { sessions: { sessionId: string; cwd: string }[] } | null,
): void {
  const state = getLastState();
  const session = state?.sessions.find((s) => s.sessionId === sessionId);
  if (!session) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: session ${sessionId} not found in current state.`,
    );
    return;
  }
  const slug = cwdToSlug(session.cwd);
  const jsonlPath = join(
    claudeHome,
    "projects",
    slug,
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`,
  );
  if (!existsSync(jsonlPath)) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: transcript not found: ${jsonlPath}`,
    );
    return;
  }
  // Open the file in the active editor group. The preview/preserve flags
  // are defaults — the user gets a normal editor tab.
  void vscode.window.showTextDocument(vscode.Uri.file(jsonlPath));
}

// `handleOpenRoster` (M2-06) was removed in M3-02 in favor of the
// auto-creating `openRoster` flow in `./commands/openRoster.ts`. The
// auto-create behavior absorbs NIT #3 from M3-01's peer-review (the
// existsSync→createFileSystemWatcher race in registerDirWatcher). Both
// the command palette entry and the `ui:open-roster` webview message now
// route through the new flow.
