#!/usr/bin/env bash
# Stop hook: enforce ScheduleWakeup tripwire on every background Agent dispatch.
#
# Mechanism: delegates the transcript-JSONL inspection to a Python detector
# (`dispatch-sentinel-stop.py`). Python has json stdlib; bash + grep cannot
# reliably differentiate "ScheduleWakeup was in THIS turn" vs "ScheduleWakeup
# was in some previous turn." The Python detector walks the JSONL backwards
# from the end, collecting tool_use blocks from the latest contiguous
# assistant span (until the first user entry).
#
# If the script fails for any reason (missing python, broken transcript, etc.)
# we exit 0 silently. False-positive blocking would be much worse than
# missed-detection here — Claude should always be able to stop a turn.

set -u

input=$(cat)

# Re-entry safety: if Claude is responding to a prior block, let it stop.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Delegate to Python; swallow any error so we never block on a hook bug.
printf '%s' "$input" | python "$CLAUDE_PROJECT_DIR/.claude/hooks/dispatch-sentinel-stop.py" 2>/dev/null || exit 0
