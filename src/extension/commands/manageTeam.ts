/**
 * `claudeteam.manageTeam` command (86ca1u0nf).
 *
 * Opens the Manage Team panel from a discoverable entry point — a button in the
 * Dashboard view's title bar (next to the gear) AND a Command Palette entry.
 *
 * ## Why this command exists
 *
 * The Manage Team panel is a render-STATE of the single `claudeteam.dashboard`
 * webview (not its own VS Code view/panel). Its open/closed state is
 * webview-LOCAL (`managePanelOpen` in `src/webview/main.ts`). Historically the
 * ONLY way to set that flag was the suggest-setup card's "Set up team" CTA
 * (the webview's own outbound `ui:open-manage-team` interception). That card
 * only renders in the `suggest-setup` detection state — i.e. when ≥2 agents are
 * scanned AND no `claudeteam.yaml` exists. Once a team is configured the card
 * disappears, leaving NO route back into the panel (the title-bar gear opens
 * the native Settings UI, not the panel). This command is that missing route.
 *
 * ## Mechanism (reuses the existing open path)
 *
 * 1. Reveal the dashboard view (`view.show(true)`) so the panel surface is
 *    visible — if the user invoked from the Command Palette the Activity Bar
 *    tile may not be focused, and `resolveWebviewView` may not have run yet.
 * 2. Re-emit `setup:detection` + `setup:characters` (same data the webview's
 *    `onOpenManageTeam` host handler supplies) so the panel renders against
 *    fresh state — this is what decides WIZARD (no config) vs EDIT (config
 *    present, the #141 surface) layout.
 * 3. Post `setup:open-manage-team` so the webview flips `managePanelOpen=true`
 *    + re-renders. This is the host→webview counterpart of the webview-local
 *    `ui:open-manage-team` flag-flip the suggest card uses.
 *
 * Steps 2+3 are deferred a tick after `view.show(true)` when the webview is not
 * yet resolved, because `webview.postMessage` is fire-and-forget (NOT buffered
 * — see `.claude/docs/vscode-extension-conventions.md`): posting before the
 * webview's listener is wired silently drops the message. When the webview IS
 * already resolved, the posts go out immediately.
 *
 * The command NEVER throws — a title-bar click / palette invocation should not
 * bubble a stack trace to the user.
 *
 * ## OOS
 *
 * Does not change the dashboard tile rendering, the gear→Settings wiring, or
 * the panel's layout logic (wizard-vs-edit is decided exactly as before by the
 * detection + config state).
 *
 * Source: ClickUp 86ca1u0nf
 *         .claude/docs/vscode-extension-conventions.md §"Message protocol"
 */

import * as vscode from "vscode";

/**
 * The dependencies the command needs from the activation flow. Decoupled from
 * the concrete provider / setup-controller so the command logic is unit-testable
 * against fakes (mirrors `openSettings`'s standalone shape).
 */
export interface ManageTeamCommandDeps {
  /**
   * Reveal (and create, if necessary) the dashboard webview view. Returns a
   * promise resolving once VS Code has been asked to show it. Implemented via
   * `provider.view?.show(true)` OR `vscode.commands.executeCommand(
   * "claudeteam.dashboard.focus")` when the view is not yet resolved.
   */
  revealView(): Thenable<void>;
  /**
   * Returns the live `vscode.Webview` if the dashboard view is currently
   * resolved, or `undefined` if it is not (e.g. the Activity Bar tile has
   * never been opened this session). Used to decide immediate-post vs
   * deferred-post.
   */
  getWebview(): vscode.Webview | undefined;
  /**
   * Re-emit `setup:detection` + `setup:characters` to the live webview so the
   * panel renders against fresh data (decides wizard vs edit layout). Same data
   * the webview's `onOpenManageTeam` host handler supplies. No-op when no
   * webview is resolved.
   */
  emitSetup(): void;
  /**
   * Post `setup:open-manage-team` to the live webview so it flips
   * `managePanelOpen = true` + re-renders. No-op when no webview is resolved.
   */
  postOpenPanel(): void;
}

/**
 * Run the `claudeteam.manageTeam` command. Reveals the dashboard view, then
 * emits the setup data + posts the open-panel message. When the webview is not
 * yet resolved, the emit+post are deferred to the next macrotask so they fire
 * AFTER `resolveWebviewView` has wired the webview's message listener (the
 * fire-and-forget postMessage caveat). NEVER throws.
 *
 * Exported for unit tests.
 */
export async function manageTeam(deps: ManageTeamCommandDeps): Promise<void> {
  try {
    await deps.revealView();
    if (deps.getWebview() !== undefined) {
      // View already resolved — listener is wired; post immediately.
      deps.emitSetup();
      deps.postOpenPanel();
      return;
    }
    // View not yet resolved — `revealView()` triggers `resolveWebviewView`,
    // but the webview's `boot()` (which registers the message listener) runs
    // asynchronously in the renderer. Defer the emit+post one macrotask so the
    // listener is wired before we post (postMessage is fire-and-forget — see
    // module docstring). The webview's own boot `ui:refresh` ALSO re-emits the
    // setup messages (main.ts onRefresh), so detection/characters arrive even
    // if this deferred emit races; the open-panel post is the load-bearing one.
    setTimeout(() => {
      deps.emitSetup();
      deps.postOpenPanel();
    }, 0);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ClaudeTeam: failed to open Manage Team: ${(err as Error).message}`,
    );
  }
}

/**
 * Register the `claudeteam.manageTeam` command on the extension context.
 * Pushes the resulting `Disposable` onto `context.subscriptions` for cleanup
 * on deactivate. Returns the `Disposable` so callers (and tests) can hold a
 * reference.
 *
 * `depsFactory` is invoked PER COMMAND INVOCATION (not at registration time) so
 * the command always closes over the CURRENT webview / setup controller — both
 * are replaced on every `resolveWebviewView` (the per-resolve rebind in
 * `main.ts`). Capturing them once at registration would leave the command
 * pointing at a disposed webview after the first `Reload Window`.
 */
export function registerManageTeamCommand(
  context: vscode.ExtensionContext,
  depsFactory: () => ManageTeamCommandDeps,
): vscode.Disposable {
  const disposable = vscode.commands.registerCommand(
    "claudeteam.manageTeam",
    () => {
      void manageTeam(depsFactory());
    },
  );
  context.subscriptions.push(disposable);
  return disposable;
}
