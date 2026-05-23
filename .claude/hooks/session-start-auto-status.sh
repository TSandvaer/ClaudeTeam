#!/usr/bin/env bash
# SessionStart hook — re-arms the auto-status loop if it was left enabled
# before this session started.
#
# The auto-status loop is session-scoped: it dies on session restart / resume /
# clear. This hook reads the durable intent from .claude/auto-status.state and,
# if auto-status was left enabled, injects context telling the orchestrator to
# re-arm the loop in the recorded mode. This is the restart-survival mechanism —
# without it, re-arming depends on the user remembering.
#
# Deliberately NOT matched on `compact`: compaction keeps the same session, so
# the loop may still be alive — re-arming there risks stacking a second loop.
# A loop that dies mid-session (rare) is surfaced via a stale `last_tick`, which
# the no-arg `auto-status` command reports.
#
# Always exits 0; never blocks.

set -eu

STATE_FILE="$CLAUDE_PROJECT_DIR/.claude/auto-status.state"
if [ ! -f "$STATE_FILE" ]; then
  STATE_FILE="$CLAUDE_PROJECT_DIR/../.claude/auto-status.state"
fi
[ -f "$STATE_FILE" ] || exit 0

getval() { grep -E "^$1=" "$STATE_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

ENABLED="$(getval enabled)"
MODE="$(getval mode)"
INTERVAL="$(getval interval)"
LAST_TICK="$(getval last_tick)"

[ "$ENABLED" = "true" ] || exit 0
MODE="${MODE:-local}"
INTERVAL="${INTERVAL:-5m}"

CONTEXT="# Auto-status re-arm (SessionStart)

auto-status was left **enabled** before this session (mode=\`$MODE\`, interval=\`$INTERVAL\`, last_tick=\`${LAST_TICK:-never}\`).

The auto-status loop is session-scoped and does NOT survive a session restart — so it is **not running right now**. Re-arm it as your first action this session: invoke the \`auto-status\` skill with argument \`$MODE\` (use \`on\` if mode is \`local\`). Do this before handling the user's request, unless the user's first message explicitly turns auto-status off."

node -e '
const ctx = process.argv[1];
const mode = process.argv[2];
process.stdout.write(JSON.stringify({
  systemMessage: `Auto-status was enabled (mode=${mode}) — re-arm pending.`,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: ctx,
  },
}));
' "$CONTEXT" "$MODE"
