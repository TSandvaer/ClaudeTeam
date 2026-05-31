#!/usr/bin/env bash
# PreToolUse hook that mechanically blocks FABRICATED ClickUp task IDs.
# Ticket `86ca22kbm`.
#
# THE FAILURE MODE THIS PREVENTS
# ------------------------------
# The orchestrator has repeatedly fabricated ClickUp ticket IDs by batching a
# `mcp__clickup__create_task` (producer of the real id) together with an
# `mcp__clickup__update_task` status flip (consumer of the id) in the SAME tool
# message — so the id was typed into the consumer call BEFORE the create
# returned a real value. The id "looked right" but was invented.
#
# THE MECHANICAL GUARD
# --------------------
# Every real ClickUp id the model can legitimately reference must have appeared
# in a PRIOR `tool_result` this session (the return value of an earlier
# create_task / get_task / get_tasks call). This hook fires on PreToolUse for
# the consumer tools, extracts the task id from `tool_input`, and greps the
# session transcript JSONL for that exact id string inside a tool_result entry.
#   - id found in a prior tool_result  → ALLOW (exit 0, no output).
#   - id absent from every tool_result → DENY (block protocol below).
#
# This makes the create→reference seam IMPOSSIBLE to short-circuit in one
# message: a freshly-created ticket's id only lands in a tool_result AFTER the
# create call returns, which can only happen in a LATER tool message.
#
# STDIN SHAPE (PreToolUse, verified against maintain-docs-stop.sh's transcript
# mechanism + the ticket's 3-agent investigation):
#   { "tool_name": "mcp__clickup__update_task",
#     "tool_input": { "task_id": "86ca...", ... },
#     "transcript_path": "<abs path to session JSONL>",
#     "session_id": "...", "cwd": "..." }
#
# TOOL_RESULT SHAPE in the transcript JSONL:
#   {"type":"user","message":{"role":"user","content":[
#       {"type":"tool_result","tool_use_id":"...","content":"...real id..."}]}}
#   (content may be a string or an array of {type:text,text:...} parts — we grep
#   the raw JSONL line text, so either encoding is covered.)
#
# BLOCK PROTOCOL (PreToolUse):
#   exit 0 + stdout JSON:
#   {"hookSpecificOutput":{"hookEventName":"PreToolUse",
#     "permissionDecision":"deny","permissionDecisionReason":"<msg>"}}
#   Allow = exit 0 with NO stdout. (Do NOT exit 2 — Claude ignores the JSON on
#   exit 2.)
#
# FAIL-OPEN POLICY (load-bearing):
#   On ANY internal error — missing/unreadable transcript, no extractable id,
#   unexpected tool_input shape — the hook ALLOWS (exit 0, no output) and logs a
#   diagnostic to stderr. A hook that fails CLOSED would brick every ClickUp
#   write on any edge case and is worse than the failure mode it guards. The
#   guard is a tripwire for the specific fabrication pattern, not a gate on all
#   ClickUp traffic.
#
# DEPENDENCIES: grep / sed only — mirrors maintain-docs-stop.sh; Git Bash on
# Windows lacks jq and we want the hook to run with zero external deps.

set -u

# Helpers ---------------------------------------------------------------------

# fail-open: log reason to stderr, allow the tool call.
allow_open() {
  printf 'validate-no-fabricated-id: ALLOW (fail-open) — %s\n' "$1" >&2
  exit 0
}

input=$(cat)

# Extract the task id from tool_input. ClickUp MCP tools name the field
# differently across tools/versions; the dispatched ticket flagged this as
# unverified. We defensively try the known variants in priority order:
#   task_id  (mcp__clickup__update_task — verified by ticket brief)
#   taskId   (camelCase variant some MCP builds use)
#   id       (bare id fallback)
# create_task_comment / add_task_to_list MAY use any of these for the task id;
# trying all variants keeps the guard working regardless of the exact name, and
# extracting nothing simply falls open (never a false block).
extract_id() {
  local field
  for field in task_id taskId id; do
    local val
    val=$(printf '%s' "$input" \
      | grep -oE "\"${field}\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" \
      | head -1 \
      | sed -E "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/")
    if [[ -n "${val:-}" ]]; then
      printf '%s' "$val"
      return 0
    fi
  done
  return 1
}

task_id=$(extract_id) || allow_open "no task id field (task_id/taskId/id) in tool_input"

if [[ -z "${task_id:-}" ]]; then
  allow_open "extracted empty task id"
fi

# Extract transcript_path from the hook's stdin JSON.
transcript_path=$(printf '%s' "$input" \
  | grep -Eo '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | sed -E 's/.*"transcript_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
  | head -1)

if [[ -z "${transcript_path:-}" || ! -r "$transcript_path" ]]; then
  allow_open "transcript_path missing or unreadable (id=${task_id})"
fi

# Search the transcript for the id appearing in a tool_result entry.
#
# Strategy: scan every JSONL line that contains "tool_result"; on those lines,
# look for the literal task id string. A tool_result is wrapped as a role:user
# record with a content[] entry of type tool_result, so the id (returned by an
# earlier create_task/get_task) appears as a substring of that line's content.
#
# grep -F (fixed string) on the id avoids regex-metachar surprises in ids.
# We require BOTH "tool_result" AND the id on the same JSONL line — a tool_result
# record is a single line, so co-occurrence on one line means the id was part of
# a real returned tool result, not merely mentioned in assistant prose.
found=$(grep -a '"tool_result"' "$transcript_path" 2>/dev/null \
  | grep -aF "$task_id" \
  | head -1 || true)

if [[ -n "${found:-}" ]]; then
  # id appeared in a prior tool_result — it is real. Allow.
  exit 0
fi

# Not found in any tool_result → likely fabricated (typed before create returned).
reason="task_id ${task_id} not found in any prior tool_result this session — run create_task/get_task in a SEPARATE message first, then use the real returned id (anti-fabrication hook, ticket 86ca22kbm)."

# Emit deny JSON. printf with %s for the reason so quotes/newlines in the id
# can't break the JSON; the reason text itself is hook-controlled (no id-derived
# quotes since ids are alphanumeric).
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$reason"
exit 0
