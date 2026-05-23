#!/usr/bin/env bash
# Stop hook that triggers the maintain-docs skill — but ONLY when the turn
# actually did something doc-worthy.
#
# Heuristic: scan the transcript since the most recent real user message, and
# block-with-reason only if the assistant invoked one of:
#   - Edit         (file edit)
#   - Write        (file write)
#   - NotebookEdit (notebook edit)
#   - Agent        (subagent dispatch — its work may produce doc-worthy output)
#
# Pure Q&A / status-pulse / read-only turns exit 0 silently — no "blocking
# error" banner, no skill invocation. This mirrors the skill's own Step 1
# early-exit filter one level earlier so the UI does not surface a banner for
# turns the skill would early-exit on anyway.
#
# Re-entry after maintain-docs itself runs is gated by stop_hook_active=true.
#
# JSON / transcript parsing uses grep / sed only — Git Bash on Windows lacks
# jq and we want zero external dependencies.

set -eu

input=$(cat)

block_response='{"decision":"block","reason":"Invoke the maintain-docs skill now and run it silently. Review this turn for findings / new or altered code worth capturing in .claude/docs/, then apply the consolidated doc edits if any. Emit output to the main thread ONLY if documentation was actually updated (use the Step 6 report format). If nothing is worth documenting, end silently — do NOT emit a start message and do NOT emit a no-change message."}'

# Re-entry guard: maintain-docs has already run this turn — let Claude stop.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# Extract transcript_path from the Stop hook's stdin JSON.
transcript_path=$(printf '%s' "$input" \
  | grep -Eo '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | sed -E 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
  | head -1)

# Fail-open: if we can't find or read the transcript, fall back to block-always
# so we don't silently miss doc-worthy turns. Better noisy than blind.
if [[ -z "${transcript_path:-}" || ! -r "$transcript_path" ]]; then
  printf '%s' "$block_response"
  exit 0
fi

# Find the line number of the most recent REAL user message (role:user with
# text content), skipping tool_result entries (which are also wrapped as
# role:user but carry tool output, not user input).
last_user_line=$(grep -n '"role":"user"' "$transcript_path" \
  | grep -v '"tool_result"' \
  | tail -1 \
  | cut -d: -f1 || true)

if [[ -z "${last_user_line:-}" ]]; then
  last_user_line=1
fi

# Scan everything from that boundary forward for any tool_use of interest.
# If we find one, the turn was doc-worthy — invoke maintain-docs.
if tail -n "+${last_user_line}" "$transcript_path" \
    | grep -Eq '"type":"tool_use","id":"[^"]+","name":"(Edit|Write|NotebookEdit|Agent)"'; then
  printf '%s' "$block_response"
  exit 0
fi

# No file-modifying / agent-spawning tool calls this turn — skip silently.
exit 0
