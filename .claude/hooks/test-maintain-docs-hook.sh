#!/usr/bin/env bash
# Test harness for .claude/hooks/maintain-docs-stop.sh (ticket `86c9z1wrh`).
#
# Builds synthetic transcript JSONL fixtures + a Stop-hook envelope on stdin,
# then asserts the hook's behaviour for each of the documented signal classes:
#
#   1. Substantive (code edit)         → block-response emitted, exit 0
#   2. Substantive (Agent dispatch)    → block-response emitted, exit 0
#   3. Tick-class (STATE.md only)      → silent exit 0 (no stdout)
#   4. Tick-class (clickup-pending)    → silent exit 0
#   5. Mixed (code + STATE.md)         → block-response (any non-tick path wins)
#   6. Pure Q&A (no tool_use)          → silent exit 0
#   7. stop_hook_active re-entry guard → silent exit 0
#   8. Missing transcript_path         → block-response (fail-open)
#
# Each test logs PASS/FAIL with a short rationale and accumulates a counter.
# Exit code reflects total fails (0 = all green).

set -u

HOOK="$(cd "$(dirname "$0")" && pwd)/maintain-docs-stop.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0

# --- helpers -----------------------------------------------------------------

assert_block() {
  local label="$1"
  local out="$2"
  local code="$3"
  if [[ "$code" -eq 0 ]] && printf '%s' "$out" | grep -q '"decision":"block"'; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL  %s — expected block-response, got code=%s out=%q\n' \
      "$label" "$code" "$out"
  fi
}

assert_silent() {
  local label="$1"
  local out="$2"
  local code="$3"
  if [[ "$code" -eq 0 ]] && [[ -z "$out" ]]; then
    PASS=$((PASS + 1))
    printf 'PASS  %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL  %s — expected silent exit 0, got code=%s out=%q\n' \
      "$label" "$code" "$out"
  fi
}

run_hook() {
  local transcript="$1"
  local extra_envelope_field="${2:-}"
  local envelope
  if [[ -n "$extra_envelope_field" ]]; then
    envelope="{\"transcript_path\":\"${transcript}\",${extra_envelope_field}}"
  else
    envelope="{\"transcript_path\":\"${transcript}\"}"
  fi
  printf '%s' "$envelope" | bash "$HOOK"
}

# --- fixture builders --------------------------------------------------------

# Transcript line shapes — minimal viable JSONL.
user_msg() {
  printf '{"role":"user","message":{"content":[{"type":"text","text":"%s"}]}}\n' "$1"
}

tool_use_edit() {
  # $1 = file_path (already JSON-escaped for backslashes if needed)
  printf '{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_%s","name":"Edit","input":{"file_path":"%s","old_string":"a","new_string":"b"}}]}}\n' \
    "$(printf '%s' "$1" | tr -dc 'a-zA-Z0-9' | head -c 10)" "$1"
}

tool_use_write() {
  printf '{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_%s","name":"Write","input":{"file_path":"%s","content":"x"}}]}}\n' \
    "$(printf '%s' "$1" | tr -dc 'a-zA-Z0-9' | head -c 10)" "$1"
}

tool_use_agent() {
  printf '{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_agent_%s","name":"Agent","input":{"description":"%s"}}]}}\n' \
    "$(date +%s%N | tail -c 8)" "$1"
}

tool_use_read() {
  printf '{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_read_%s","name":"Read","input":{"file_path":"%s"}}]}}\n' \
    "$(printf '%s' "$1" | tr -dc 'a-zA-Z0-9' | head -c 10)" "$1"
}

# --- test cases --------------------------------------------------------------

# Test 1: substantive code edit → block
T1="$TMP_DIR/t1-code-edit.jsonl"
{
  user_msg "fix the parser"
  tool_use_edit "c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/src/extension/watcher/metaJsonLoader.ts"
} > "$T1"
OUT=$(run_hook "$T1"); RC=$?
assert_block "1. substantive code edit (Edit on src/...)" "$OUT" "$RC"

# Test 2: substantive Agent dispatch → block (even when no edit paths)
T2="$TMP_DIR/t2-agent.jsonl"
{
  user_msg "dispatch felix"
  tool_use_agent "felix on M5-EH"
} > "$T2"
OUT=$(run_hook "$T2"); RC=$?
assert_block "2. Agent dispatch (no edits)" "$OUT" "$RC"

# Test 3: tick-class — STATE.md only → silent
T3="$TMP_DIR/t3-tick-state.jsonl"
{
  user_msg "Status"
  tool_use_edit "c:/Trunk/PRIVATE/ClaudeTeam/team/STATE.md"
} > "$T3"
OUT=$(run_hook "$T3"); RC=$?
assert_silent "3. tick-class — STATE.md only" "$OUT" "$RC"

# Test 3b: tick-class with Windows backslash path → silent
T3B="$TMP_DIR/t3b-tick-backslash.jsonl"
{
  user_msg "Status"
  tool_use_edit "c:\\\\Trunk\\\\PRIVATE\\\\ClaudeTeam\\\\team\\\\STATE.md"
} > "$T3B"
OUT=$(run_hook "$T3B"); RC=$?
assert_silent "3b. tick-class — STATE.md (Windows backslash path)" "$OUT" "$RC"

# Test 4: tick-class — clickup-pending + decisions-while-away → silent
T4="$TMP_DIR/t4-tick-multi.jsonl"
{
  user_msg "merge PR and log"
  tool_use_edit "c:/Trunk/PRIVATE/ClaudeTeam/team/log/clickup-pending.md"
  tool_use_write "c:/Trunk/PRIVATE/ClaudeTeam/.claude/decisions-while-away.md"
} > "$T4"
OUT=$(run_hook "$T4"); RC=$?
assert_silent "4. tick-class — clickup-pending + decisions-while-away" "$OUT" "$RC"

# Test 4b: persona scratch path → silent
T4B="$TMP_DIR/t4b-persona-scratch.jsonl"
{
  user_msg "review"
  tool_use_write "c:/Trunk/PRIVATE/ClaudeTeam-maya-wt/team/maya-dev/pr-71-review-body.md"
} > "$T4B"
OUT=$(run_hook "$T4B"); RC=$?
assert_silent "4b. tick-class — persona scratch (team/maya-dev/)" "$OUT" "$RC"

# Test 5: mixed — code + STATE.md → block (any non-tick wins)
T5="$TMP_DIR/t5-mixed.jsonl"
{
  user_msg "ship and update state"
  tool_use_edit "c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/src/extension/main.ts"
  tool_use_edit "c:/Trunk/PRIVATE/ClaudeTeam/team/STATE.md"
} > "$T5"
OUT=$(run_hook "$T5"); RC=$?
assert_block "5. mixed — code + STATE.md (non-tick wins)" "$OUT" "$RC"

# Test 6: pure Q&A — only Read tool_use → silent
T6="$TMP_DIR/t6-qa.jsonl"
{
  user_msg "what does this file do?"
  tool_use_read "c:/Trunk/PRIVATE/ClaudeTeam/CLAUDE.md"
} > "$T6"
OUT=$(run_hook "$T6"); RC=$?
assert_silent "6. pure Q&A (Read only, no Edit/Write/Agent)" "$OUT" "$RC"

# Test 7: stop_hook_active re-entry guard → silent (even with code edit)
T7="$TMP_DIR/t7-reentry.jsonl"
{
  user_msg "fix"
  tool_use_edit "c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/src/extension/main.ts"
} > "$T7"
OUT=$(run_hook "$T7" '"stop_hook_active":true'); RC=$?
assert_silent "7. stop_hook_active re-entry guard" "$OUT" "$RC"

# Test 8: missing transcript_path → fail-open block-response
OUT=$(printf '{}' | bash "$HOOK"); RC=$?
assert_block "8. missing transcript_path (fail-open)" "$OUT" "$RC"

# Test 8b: unreadable transcript_path → fail-open block-response
OUT=$(run_hook "$TMP_DIR/does-not-exist.jsonl"); RC=$?
assert_block "8b. unreadable transcript_path (fail-open)" "$OUT" "$RC"

# --- summary -----------------------------------------------------------------

TOTAL=$((PASS + FAIL))
printf '\n%d/%d passed (%d failed)\n' "$PASS" "$TOTAL" "$FAIL"
exit $FAIL
