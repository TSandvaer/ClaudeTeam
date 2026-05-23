/**
 * ClaudeTeam extension entry point.
 *
 * Exports `activate` and `deactivate` per the VS Code extension lifecycle.
 * `activate` is called lazily on `onView:claudeteam.dashboard` (per package.json
 * activationEvents). It:
 *   1. Registers the WebviewViewProvider.
 *   2. Wires the file-watcher loop to start when the view resolves.
 *   3. Registers the placeholder command handlers (live wiring in M2-06).
 *
 * The file-watcher loop is gated on view resolution — it does NOT start at
 * activation time, only when the user opens the Activity Bar tile. This
 * preserves the <100ms cold-activation target per
 * `.claude/docs/vscode-extension-conventions.md` § "Activation cost".
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Activation cost"
 *         team/nora-pl/milestone-2-backlog.md § M2-04 AC6
 */

import { homedir } from "node:os";
import { join } from "node:path";

import * as vscode from "vscode";

import { ClaudeTeamViewProvider, VIEW_ID } from "./view/provider.js";
import { startWatcher } from "./watcher/watcherLoop.js";
import { postState } from "./messageBus.js";

/**
 * Called by VS Code when the extension activates (lazy — fires on first
 * `onView:claudeteam.dashboard` event, i.e. when the user opens the Activity
 * Bar tile for the first time). Keep this fast (<100ms target).
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ClaudeTeamViewProvider(context.extensionUri);

  // Disposable wrapper for the active watcher (null until view resolves).
  let watcherDisposable: vscode.Disposable | null = null;

  // When the view resolves, start the file-watcher loop and pipe its
  // emitted state into postState(). Replaces any prior watcher (e.g. on a
  // webview reload — VS Code resolves the view again after `Reload Window`).
  provider.onResolved((webview) => {
    watcherDisposable?.dispose();

    const config = vscode.workspace.getConfiguration("claudeteam");
    const pollIntervalMs = config.get<number>("pollIntervalMs") ?? 2000;
    const rosterPathOverride = config.get<string>("rosterPath") ?? "";

    const claudeHome = join(homedir(), ".claude");
    const globalRosterPath =
      rosterPathOverride.length > 0
        ? rosterPathOverride
        : join(homedir(), ".claudeteam", "teams.yaml");

    watcherDisposable = startWatcher({
      claudeHome,
      globalRosterPath,
      pollIntervalMs,
      onStateChange: (state) => {
        void postState(webview, state);
      },
      logger: {
        warn: (msg) => console.warn(`[claudeteam.watcher] ${msg}`),
      },
    });

    // Register the disposable for cleanup on `deactivate()`.
    context.subscriptions.push({
      dispose: () => {
        watcherDisposable?.dispose();
        watcherDisposable = null;
      },
    });
  });

  // Register the WebviewViewProvider for the Activity Bar tile.
  // The view-id must match package.json contributes.views entry.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  // Register commands declared in package.json contributes.commands.
  // Implementations are stubs at M2-04 scope; live handlers land in M2-06.
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeteam.refresh", () => {
      // M2-06: trigger an immediate watcher tick via messageBus.
    }),

    vscode.commands.registerCommand("claudeteam.openRoster", () => {
      // M2-06: open the resolved teams.yaml path in the editor.
    }),

    vscode.commands.registerCommand("claudeteam.openAgentTranscript", () => {
      // M2-06: open a selected agent's JSONL in VS Code's native viewer.
    }),
  );
}

/**
 * Called by VS Code on extension deactivation (window close, disable, reload).
 * No-op — every disposable is registered on `context.subscriptions` and VS
 * Code disposes them automatically. Kept as an explicit export for the
 * VS Code lifecycle.
 */
export function deactivate(): void {
  // No-op — cleanup via context.subscriptions on deactivate.
}
