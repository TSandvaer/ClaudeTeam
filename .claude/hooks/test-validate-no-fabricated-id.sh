#!/usr/bin/env bash
# Test harness for .claude/hooks/validate-no-fabricated-id.sh (ticket `86ca22kbm`).
#
# Builds synthetic PreToolUse stdin envelopes + transcript JSONL fixtures and
# asserts the hook's behaviour per documented case:
#
#   a. id PRESENT in a prior tool_result   → ALLOW (exit 0, NO stdout)
#   b. id ABSENT from every tool_result    → DENY (exit 0, deny JSON on stdout)
#   c. id present only in assistant prose   → DENY (must co-occur on a
#                                             tool_result line, not just be
#                                             mentioned)  [strengthens non-vacuity]
#   d. id present in tool_result via array-content encoding → ALLOW
#   e. taskId (camelCase) field variant present → resolves + ALLOW
#   f. missing transcript_path              → ALLOW (fail-open)
#   g. unreadable transcript_path           → ALLOW (fail-open)
#   h. no extractable id in tool_input      → ALLOW (fail-open)
#
# NON-VACUITY: case (b) is the load-bearing one — removing the
# `grep -aF "$task_id"` membership check from the hook (i.e. always-allow) makes
# (b) and (c) FAIL. The test is therefore non-vacuous w.r.t. the guard.
#
# Each test logs PASS/FAIL with a short rationale and accumulates a counter.
# Exit code reflects total fails (0 = all green).

set -u

HOOK="$(cd "$(dirname "$0")" && pwd)/validate-no-fabricated-id.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0

# --- helpers -----------------------------------------------------------------

assert_allow() {  # label, out, code  — allow == exit 0 AND empty stdout
  local label="$1" out="$2" code="$3"
  if [[ "$code" -eq 0 ]] && [[ -z "$out" ]]; then
    PASS=$((PASS + 1)); printf 'PASS  %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL  %s — expected ALLOW (exit 0, no stdout), got code=%s out=%q\n' \
      "$label" "$code" "$out"
  fi
}

assert_deny() {  # label, out, code — deny == exit 0 AND deny JSON on stdout
  local label="$1" out="$2" code="$3"
  if [[ "$code" -eq 0 ]] \
     && printf '%s' "$out" | grep -q '"permissionDecision":"deny"' \
     && printf '%s' "$out" | grep -q '"hookEventName":"PreToolUse"'; then
    PASS=$((PASS + 1)); printf 'PASS  %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL  %s — expected DENY JSON, got code=%s out=%q\n' \
      "$label" "$code" "$out"
  fi
}

run_hook() {  # stdin-json
  printf '%s' "$1" | bash "$HOOK"
}

# --- fixtures ----------------------------------------------------------------

# Transcript where 86ca99real WAS returned by a real create_task tool_result,
# and 86caPROSE is only mentioned in assistant text (never in a tool_result).
TR_GOOD="$TMP_DIR/transcript-good.jsonl"
cat > "$TR_GOOD" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"create a ticket"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I will reference 86caPROSE later."},{"type":"tool_use","id":"toolu_c1","name":"mcp__clickup__create_task","input":{"name":"new ticket"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_c1","content":"{\"id\":\"86ca99real\",\"name\":\"new ticket\",\"status\":\"to do\"}"}]}}
EOF

# Transcript where the id is in a tool_result but content is an ARRAY of text
# parts (the alternate tool_result content encoding).
TR_ARRAY="$TMP_DIR/transcript-array.jsonl"
cat > "$TR_ARRAY" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"get the ticket"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_g1","name":"mcp__clickup__get_task","input":{"task_id":"86caARRAYid"}}]}}
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_g1","content":[{"type":"text","text":"Task 86caARRAYid status to do"}]}]}}
EOF

# --- test cases --------------------------------------------------------------

# a. id present in a tool_result → ALLOW
OUT=$(run_hook '{"tool_name":"mcp__clickup__update_task","tool_input":{"task_id":"86ca99real","status":"in review"},"transcript_path":"'"$TR_GOOD"'"}'); RC=$?
assert_allow "a. id present in prior tool_result (update_task)" "$OUT" "$RC"

# b. id absent from every tool_result → DENY (LOAD-BEARING non-vacuity case)
OUT=$(run_hook '{"tool_name":"mcp__clickup__update_task","tool_input":{"task_id":"86caFABRICATED","status":"in review"},"transcript_path":"'"$TR_GOOD"'"}'); RC=$?
assert_deny "b. id absent from all tool_results (fabricated) → deny" "$OUT" "$RC"

# c. id only in assistant prose, never in a tool_result → DENY
OUT=$(run_hook '{"tool_name":"mcp__clickup__update_task","tool_input":{"task_id":"86caPROSE","status":"in review"},"transcript_path":"'"$TR_GOOD"'"}'); RC=$?
assert_deny "c. id mentioned in prose but not in a tool_result → deny" "$OUT" "$RC"

# d. id present via array-content tool_result → ALLOW
OUT=$(run_hook '{"tool_name":"mcp__clickup__create_task_comment","tool_input":{"task_id":"86caARRAYid","comment_text":"x"},"transcript_path":"'"$TR_ARRAY"'"}'); RC=$?
assert_allow "d. id in array-encoded tool_result (create_task_comment)" "$OUT" "$RC"

# e. taskId (camelCase) variant resolves + ALLOW
OUT=$(run_hook '{"tool_name":"mcp__clickup__add_task_to_list","tool_input":{"taskId":"86ca99real","listId":"123"},"transcript_path":"'"$TR_GOOD"'"}'); RC=$?
assert_allow "e. taskId camelCase variant resolves (add_task_to_list)" "$OUT" "$RC"

# f. missing transcript_path → ALLOW (fail-open)
OUT=$(run_hook '{"tool_name":"mcp__clickup__update_task","tool_input":{"task_id":"86ca99real","status":"in review"}}'); RC=$?
assert_allow "f. missing transcript_path → fail-open allow" "$OUT" "$RC"

# g. unreadable transcript_path → ALLOW (fail-open)
OUT=$(run_hook '{"tool_name":"mcp__clickup__update_task","tool_input":{"task_id":"86ca99real"},"transcript_path":"'"$TMP_DIR"'/does-not-exist.jsonl"}'); RC=$?
assert_allow "g. unreadable transcript_path → fail-open allow" "$OUT" "$RC"

# h. no extractable id field in tool_input → ALLOW (fail-open)
OUT=$(run_hook '{"tool_name":"mcp__clickup__update_task","tool_input":{"status":"in review"},"transcript_path":"'"$TR_GOOD"'"}'); RC=$?
assert_allow "h. no id field in tool_input → fail-open allow" "$OUT" "$RC"

# --- summary -----------------------------------------------------------------

TOTAL=$((PASS + FAIL))
printf '\n%d/%d passed (%d failed)\n' "$PASS" "$TOTAL" "$FAIL"
exit $FAIL
