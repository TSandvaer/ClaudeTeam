// Bundle config — M1-09 adds the CLI entry point.
// M2 will add extension host + webview targets.
//
// CLI target: src/cli/agentTree.ts → dist/cli/agentTree.js
// Platform: Node (no browser shims needed).

const { build } = await import("esbuild");

await build({
  entryPoints: ["src/cli/agentTree.ts"],
  outfile: "dist/cli/agentTree.js",
  bundle: true,
  platform: "node",
  target: "es2022",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  // Mark Node built-ins as external so esbuild doesn't try to bundle them.
  // js-yaml and zod ARE bundled (they're in dependencies, not devDependencies).
  external: [],
});

console.log("[esbuild.config] CLI bundle written to dist/cli/agentTree.js");
