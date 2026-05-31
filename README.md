# ClaudeTeam

A VS Code dashboard for orchestrated Claude Code agent teams.

ClaudeTeam gives you an accurate, real-time view of which agents are running across your Claude Code sessions, what they're working on, and how they're organised into sponsor-defined teams — without the noise of ad-hoc background spawns drowning out the signal.

## Status

Pre-V1. See [docs/V1-PLAN.md](docs/V1-PLAN.md) for the V1 plan.

## Why

The existing tracking option in our environment (Pixel Agents) shows every spawn equally — including the ~74% of subagent dispatches that have no name. ClaudeTeam inverts the default: only rostered team agents get named tiles; everything else is collapsed into a per-session noise counter that's still visible but doesn't clutter the view.

## Dev install loop

To dogfood a local change, build + package + install a **uniquely-versioned**
`.vsix` so VS Code never serves cached bits from a previous same-version
install:

```bash
npm run dev:install      # build → package (fresh dev version) → install --force
```

This runs `scripts/dev-package.mjs` then `scripts/dev-install.mjs`:

- `dev:package` builds the bundles, stamps a unique version
  `0.0.1-dev.<timestamp>` into a **temporary** `package.json`, runs
  `vsce package --no-yarn`, then restores the original `package.json` — so the
  source tree shows no version churn in `git status`. Each run emits a new
  `claudeteam-0.0.1-dev.<timestamp>.vsix`.
- `dev:install` resolves the newest `claudeteam-*-dev.*.vsix` and runs
  `code --install-extension <vsix> --force`.

Run just the package step with `npm run dev:package` if you want to install
manually. After installing, `Ctrl+Shift+P → Developer: Reload Window` to pick up
the new build.

> **Why the unique version?** The source `version` is permanently `0.0.1`.
> Installing two different builds that both report `0.0.1` lets VS Code's
> extension cache serve the OLD bits — you preview a stale build. A unique
> per-build version string defeats that collision. The `-dev.<n>` prerelease
> sorts below the eventual `0.0.1` release, so it never interferes with a
> Marketplace publish. (ticket 86ca22e5r)
