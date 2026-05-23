// Placeholder bundle config — no entry points yet (scaffold-only).
// M1-09 wires in the CLI entry; M2 adds extension host + webview targets.
// Running this script as `npm run build` validates the toolchain (exits 0)
// and prints what it will eventually do.

const entries = [];

if (entries.length === 0) {
  console.log("[esbuild.config] No bundle entries yet — scaffold-only build. OK.");
  process.exit(0);
}

const { build } = await import("esbuild");

await Promise.all(
  entries.map((entry) =>
    build({
      ...entry,
      bundle: true,
      platform: entry.platform ?? "node",
      target: "es2022",
      sourcemap: true,
      logLevel: "info",
    }),
  ),
);
