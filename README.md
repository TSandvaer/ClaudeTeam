# ClaudeTeam

A VS Code dashboard for orchestrated Claude Code agent teams.

ClaudeTeam gives you an accurate, real-time view of which agents are running across your Claude Code sessions, what they're working on, and how they're organised into sponsor-defined teams — without the noise of ad-hoc background spawns drowning out the signal.

## Status

Pre-V1. See [docs/V1-PLAN.md](docs/V1-PLAN.md) for the V1 plan.

## Why

The existing tracking option in our environment (Pixel Agents) shows every spawn equally — including the ~74% of subagent dispatches that have no name. ClaudeTeam inverts the default: only rostered team agents get named tiles; everything else is collapsed into a per-session noise counter that's still visible but doesn't clutter the view.
