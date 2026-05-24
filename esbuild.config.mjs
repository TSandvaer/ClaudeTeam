/**
 * esbuild build configuration.
 *
 * Three bundles:
 *
 *   1. Extension host  (CJS, external vscode)
 *      src/extension/main.ts → dist/extension/main.cjs
 *      - CommonJS required: VS Code still loads extension entry points as CJS.
 *      - `.cjs` extension is load-bearing: root package.json declares
 *        `"type": "module"`, so Node's package-scope resolution would
 *        otherwise treat `dist/extension/main.js` as ESM under Node 22+ and
 *        reject the host's `require()` call with `ERR_REQUIRE_ESM`. Naming
 *        the output `.cjs` makes the format unambiguous to Node regardless
 *        of parent package scope — no sibling `dist/extension/package.json`
 *        marker needed. See ticket 86c9y9yzu and
 *        team/sage-qa/m2-08-layer3-run-notes.md §"Bug #1" for the original
 *        symptom + root-cause analysis. The package.json `main` field must
 *        match (`dist/extension/main.cjs`).
 *      - `vscode` is always external — the host runtime provides it.
 *      - js-yaml and zod are bundled (runtime deps, not devDeps).
 *
 *   2. Webview         (IIFE, no externals)
 *      src/webview/main.ts → dist/webview/main.js
 *      - IIFE required: VS Code webviews don't support ES module imports in
 *        injected <script> tags. No import map available in the webview
 *        context. See vscode-extension-conventions.md "Open questions §ESM".
 *      - acquireVsCodeApi() is a webview global, not an npm module — no external.
 *
 *   3. CLI             (ESM, Node)
 *      src/cli/agentTree.ts → dist/cli/agentTree.js
 *      - Retained from M1-09. Not affected by the extension targets.
 *
 * `npm run watch` (AC10) starts all three in parallel via Promise.all with
 * esbuild's `context.watch()`.
 *
 * Source: .claude/docs/vscode-extension-conventions.md "Build & package"
 *         team/bram-research/m2-vscode-prior-art-2026-05-23.md §"VS Code API surface"
 */

const { build, context } = await import("esbuild");

const isWatch = process.argv.includes("--watch");

// ---------------------------------------------------------------------------
// Shared base options
// ---------------------------------------------------------------------------

const commonOptions = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

// ---------------------------------------------------------------------------
// Target definitions
// ---------------------------------------------------------------------------

/** Extension host bundle — CJS, external vscode. */
const extensionHostTarget = {
  ...commonOptions,
  entryPoints: ["src/extension/main.ts"],
  outfile: "dist/extension/main.cjs",
  platform: "node",
  target: "es2022",
  format: "cjs",
  // vscode is provided by the extension host runtime; never bundle it.
  external: ["vscode"],
};

/** Webview bundle — IIFE, all deps bundled (no externals). */
const webviewTarget = {
  ...commonOptions,
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview/main.js",
  platform: "browser",
  target: "es2020",
  format: "iife",
  // No externals: acquireVsCodeApi is a webview global, not an npm module.
  external: [],
};

/**
 * Webview CSS bundle — esbuild emits CSS to a sibling output file. Linked
 * from the webview HTML via <link rel="stylesheet"> with the standard CSP
 * style-src ${webview.cspSource} directive (no inline <style> tags).
 */
const webviewCssTarget = {
  ...commonOptions,
  entryPoints: ["src/webview/styles/dashboard.css"],
  outfile: "dist/webview/dashboard.css",
  loader: { ".css": "css" },
};

/** CLI bundle — ESM, Node (retained from M1-09). */
const cliTarget = {
  ...commonOptions,
  entryPoints: ["src/cli/agentTree.ts"],
  outfile: "dist/cli/agentTree.js",
  platform: "node",
  target: "es2022",
  format: "esm",
  external: [],
};

// ---------------------------------------------------------------------------
// Build or watch
// ---------------------------------------------------------------------------

if (isWatch) {
  // Watch mode — all targets run in parallel via esbuild contexts.
  // `npm run watch` passes --watch.
  const [extCtx, webCtx, webCssCtx, cliCtx] = await Promise.all([
    context(extensionHostTarget),
    context(webviewTarget),
    context(webviewCssTarget),
    context(cliTarget),
  ]);

  await Promise.all([
    extCtx.watch(),
    webCtx.watch(),
    webCssCtx.watch(),
    cliCtx.watch(),
  ]);

  console.log(
    "[esbuild.config] Watch mode active — rebuilding on file changes...",
  );
  // Keep the process alive; Ctrl-C to stop.
} else {
  // One-shot build.
  await Promise.all([
    build(extensionHostTarget),
    build(webviewTarget),
    build(webviewCssTarget),
    build(cliTarget),
  ]);

  console.log("[esbuild.config] Build complete:");
  console.log("  dist/extension/main.cjs    (extension host, CJS)");
  console.log("  dist/webview/main.js       (webview JS, IIFE)");
  console.log("  dist/webview/dashboard.css (webview CSS)");
  console.log("  dist/cli/agentTree.js      (CLI, ESM)");
}
