#!/usr/bin/env bash
# Stop hook that triggers the maintain-docs skill — but ONLY when the turn
# actually did something doc-worthy. See ticket `86c9z1wrh`.
#
# Transcript mechanism: Stop hooks receive a JSON envelope on stdin containing
# `transcript_path` (absolute path to the session JSONL). We tail that file from
# the most-recent real user message forward and classify each tool_use we see.
#
# Doc-worthy signals (invoke the skill):
#   - Edit / Write / NotebookEdit against a CODE/TEST/DOC path
#   - Agent dispatch (sub-agent work may surface findings the parent thread
#     wouldn't otherwise see)
#
# Tick-class signals (exit silently — would early-exit the skill anyway, and
# the Stop banner is the bloat we are removing):
#   - Edits whose every file_path matches the orchestration-coordination set
#     below (STATE.md, clickup-pending.md, decisions-while-away.md, etc.)
#     AND no Agent dispatch occurred this turn
#
# Re-entry after maintain-docs itself runs is gated by stop_hook_active=true.
#
# JSON / transcript parsing uses grep / sed only — Git Bash on Windows lacks jq
# and we want zero external dependencies.
#
# Cross-ref: `.claude/docs/orchestration-overview.md` § Main-thread narration
# discipline and `.claude/skills/maintain-docs/SKILL.md` § Step 1 early-exit
# filter (the in-skill filter is the safety net; this hook is the cheaper
# first cut so the Stop banner does not flash on every tick turn).

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

# Single-pass extraction of every doc-worthy tool_use in the slice. One grep
# stream emits either an `AGENT` marker (sub-agent dispatch) or an `EDIT <path>`
# line (Edit/Write/NotebookEdit). Avoids re-scanning the slice — important on
# 20k+ line transcripts.
classified=$(tail -n "+${last_user_line}" "$transcript_path" \
  | grep -oE '"type":"tool_use","id":"[^"]+","name":"(Agent|Edit|Write|NotebookEdit)"(,"input":\{[^}]*"file_path":"[^"]+")?' \
  | sed -E \
      -e 's/.*"name":"Agent".*/AGENT/' \
      -e 's/.*"name":"(Edit|Write|NotebookEdit)".*"file_path":"([^"]+)".*/EDIT \2/')

# Agent dispatches always count as doc-worthy — sub-agent work may produce
# findings that should land in .claude/docs/.
if printf '%s\n' "$classified" | grep -q '^AGENT$'; then
  printf '%s' "$block_response"
  exit 0
fi

# Collect every Edit/Write/NotebookEdit file_path. If there are none, the turn
# had no doc-worthy file writes — exit silently.
edit_paths=$(printf '%s\n' "$classified" | sed -n 's/^EDIT //p')

if [[ -z "${edit_paths:-}" ]]; then
  # No file-modifying / agent-spawning tool calls this turn — skip silently.
  exit 0
fi

# Tick-class file-path patterns. If EVERY edit path in the turn matches one of
# these, the turn was pure orchestration coordination — exit silently. Any
# single path that does NOT match (code, tests, docs, or unknown surface) flips
# the turn to doc-worthy and invokes the skill.
#
# Patterns are matched against the JSON-encoded path string (backslashes appear
# as `\\` on Windows transcripts) — both `team/STATE.md` and
# `team\\STATE.md` variants must match. We normalise by replacing `\\` with `/`
# before the regex check.
tick_pattern='(^|/)(team/STATE\.md|team/DECISIONS\.md|team/log/clickup-pending\.md|team/log/process-incidents\.md|\.claude/decisions-while-away\.md|\.claude/away-queue\.md|\.claude/auto-status\.state|team/(felix-dev|maya-dev|sage-qa|bram-research|iris-ux|nora-tickets|dogfood)/.*)$'

all_tick=1
while IFS= read -r path; do
  [[ -z "$path" ]] && continue
  normalized=${path//\\\\/\/}
  normalized=${normalized//\\/\/}
  if ! printf '%s' "$normalized" | grep -Eq "$tick_pattern"; then
    all_tick=0
    break
  fi
done <<< "$edit_paths"

if [[ "$all_tick" -eq 1 ]]; then
  # Pure orch-coord turn — would early-exit the skill, suppress the banner.
  exit 0
fi

# At least one code / test / doc edit — invoke the skill.
printf '%s' "$block_response"
exit 0
