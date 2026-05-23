/**
 * Webview entry point — static placeholder (M2-01 scope).
 *
 * At M2-01 this file contains only a placeholder log to confirm the bundle
 * loads. The full renderer (tile layout, message receiver, state updates) is
 * implemented by Maya in M2-05.
 *
 * Build target: IIFE (esbuild --format=iife). Runs in the VS Code webview
 * context (`vscode-webview://` origin, enableScripts: true). ES module
 * imports are NOT supported in this context — esbuild bundles everything into
 * a single IIFE. Source: vscode-extension-conventions.md "Open questions" §ESM.
 */

// Placeholder — replaces the "ClaudeTeam loading…" static text injected by
// provider.ts once the bundle executes. Maya's M2-05 replaces this block.
const root = document.getElementById("root");
if (root) {
  root.textContent = "ClaudeTeam — webview bundle loaded (M2-01 stub)";
}
