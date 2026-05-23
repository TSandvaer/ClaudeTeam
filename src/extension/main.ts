/**
 * ClaudeTeam extension entry point.
 *
 * Exports `activate` and `deactivate` per the VS Code extension lifecycle.
 * `activate` is called lazily on `onView:claudeteam.dashboard` (per package.json
 * activationEvents). It registers the WebviewViewProvider and wires extension
 * commands. The file-watcher loop (M2-04) and live message bridge (M2-06) are
 * not wired here yet — this PR's scope is the scaffold only.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Activation cost"
 */

import * as vscode from "vscode";
import { ClaudeTeamViewProvider, VIEW_ID } from "./view/provider.js";

/**
 * Called by VS Code when the extension activates (lazy — fires on first
 * `onView:claudeteam.dashboard` event, i.e. when the user opens the Activity
 * Bar tile for the first time). Keep this fast (<100ms target).
 */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new ClaudeTeamViewProvider(context.extensionUri);

  // Register the WebviewViewProvider for the Activity Bar tile.
  // The view-id must match package.json contributes.views entry.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider),
  );

  // Register commands declared in package.json contributes.commands.
  // Implementations are stubs at M2-01 scope; handlers land in M2-06.
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
 * No-op at M2-01 scope; the file-watcher disposable cleanup lands in M2-04.
 */
export function deactivate(): void {
  // No-op — cleanup via context.subscriptions on deactivate.
}
