/**
 * `claudeteam.openPlaybackTuner` command (E5 86ca2189v).
 *
 * Opens the Playback Tuner panel from a discoverable entry point — a button in
 * the Dashboard view's title bar (next to Manage Team + the gear) AND a Command
 * Palette entry. Mirrors `claudeteam.manageTeam` exactly.
 *
 * ## Mechanism (reuses the on-demand-panel pattern)
 *
 * 1. Reveal the dashboard view (`view.show(true)`) so the panel surface is
 *    visible — if invoked from the Command Palette the Activity Bar tile may not
 *    be focused, and `resolveWebviewView` may not have run yet.
 * 2. Post `tuner:open-playback-tuner` so the webview flips `tunerPanelOpen=true`
 *    + re-renders. This is the host→webview counterpart of the webview-local
 *    flag-flip.
 *
 * The post is deferred a macrotask after `view.show(true)` when the webview is
 * not yet resolved, because `webview.postMessage` is fire-and-forget (NOT
 * buffered — see `.claude/docs/vscode-extension-conventions.md`): posting before
 * the webview's listener is wired silently drops the message. When the webview IS
 * already resolved, the post goes out immediately.
 *
 * The tuner reads the BAKED `GENERATED_SPRITE_MANIFEST` directly (webview-side)
 * for its char/anim lists + cascade source — so unlike Manage Team there is no
 * `emitSetup` step; the panel needs no host-pushed data to render. The only host
 * round-trip is the save (`ui:save-playback-override` → `playback:override-saved`).
 *
 * The command NEVER throws.
 *
 * Source: ClickUp 86ca2189v · team/iris-design/anim-tuner-spec.md §2.
 */

import * as vscode from "vscode";

/** Dependencies the command needs from the activation flow (test-friendly). */
export interface OpenPlaybackTunerCommandDeps {
  /**
   * Reveal (and create, if necessary) the dashboard webview view. Implemented
   * via `provider.view?.show(true)` OR `vscode.commands.executeCommand(
   * "claudeteam.dashboard.focus")` when the view is not yet resolved.
   */
  revealView(): Thenable<void>;
  /**
   * Returns the live `vscode.Webview` if the dashboard view is currently
   * resolved, or `undefined` if not. Decides immediate-post vs deferred-post.
   */
  getWebview(): vscode.Webview | undefined;
  /**
   * Post `tuner:open-playback-tuner` to the live webview so it flips
   * `tunerPanelOpen = true` + re-renders. No-op when no webview is resolved.
   */
  postOpenPanel(): void;
}

/**
 * Run the `claudeteam.openPlaybackTuner` command. Reveals the dashboard view,
 * then posts the open-panel message (immediately if resolved, deferred one
 * macrotask otherwise so the webview's listener is wired first — fire-and-forget
 * caveat). NEVER throws. Exported for unit tests.
 */
export async function openPlaybackTuner(
  deps: OpenPlaybackTunerCommandDeps,
): Promise<void> {
  try {
    await deps.revealView();
    if (deps.getWebview() !== undefined) {
      deps.postOpenPanel();
      return;
    }
    setTimeout(() => {
      deps.postOpenPanel();
    }, 0);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: failed to open Playback Tuner: ${(err as Error).message}`,
    );
  }
}

/**
 * Register the `claudeteam.openPlaybackTuner` command. `depsFactory` is invoked
 * PER INVOCATION so the command always closes over the CURRENT webview (replaced
 * on every `resolveWebviewView`). Pushes the disposable onto
 * `context.subscriptions`. Returns it for tests.
 */
export function registerOpenPlaybackTunerCommand(
  context: vscode.ExtensionContext,
  depsFactory: () => OpenPlaybackTunerCommandDeps,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand(
    "claudeteam.openPlaybackTuner",
    () => {
      void openPlaybackTuner(depsFactory());
    },
  );
  context.subscriptions.push(disposable);
  return disposable;
}
