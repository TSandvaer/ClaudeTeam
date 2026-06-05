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
#   9. Auto-memory promotion           → silent exit 0   (86c9z7yrh allowlist gap)
#  10. /save-session state file         → silent exit 0   (86c9z7yrh allowlist gap)
#  11. Memory write + code edit         → block (non-vacuity guard)
#
# Fixtures are HEREDOC-inlined per test so each case reads as literal JSONL —
# the prior helper-based shape obscured the actual content the hook regexes
# against. Each test logs PASS/FAIL with a short rationale and accumulates a
# counter. Exit code reflects total fails (0 = all green).

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

# --- test cases --------------------------------------------------------------

# Test 1: substantive code edit → block
T1="$TMP_DIR/t1-code-edit.jsonl"
cat > "$T1" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"fix the parser"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t1","name":"Edit","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/src/extension/watcher/metaJsonLoader.ts","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T1"); RC=$?
assert_block "1. substantive code edit (Edit on src/...)" "$OUT" "$RC"

# Test 2: substantive Agent dispatch → block (even when no edit paths)
T2="$TMP_DIR/t2-agent.jsonl"
cat > "$T2" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"dispatch felix"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t2","name":"Agent","input":{"description":"felix on M5-EH"}}]}}
EOF
OUT=$(run_hook "$T2"); RC=$?
assert_block "2. Agent dispatch (no edits)" "$OUT" "$RC"

# Test 3: tick-class — STATE.md only → silent
T3="$TMP_DIR/t3-tick-state.jsonl"
cat > "$T3" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"Status"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t3","name":"Edit","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam/team/STATE.md","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T3"); RC=$?
assert_silent "3. tick-class — STATE.md only" "$OUT" "$RC"

# Test 3b: tick-class with Windows backslash path → silent
# Double-backslash escapes survive as `\\` in JSON (representing one `\`),
# matching the on-disk transcript shape.
T3B="$TMP_DIR/t3b-tick-backslash.jsonl"
cat > "$T3B" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"Status"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t3b","name":"Edit","input":{"file_path":"c:\\Trunk\\PRIVATE\\ClaudeTeam\\team\\STATE.md","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T3B"); RC=$?
assert_silent "3b. tick-class — STATE.md (Windows backslash path)" "$OUT" "$RC"

# Test 4: tick-class — clickup-pending + decisions-while-away → silent
T4="$TMP_DIR/t4-tick-multi.jsonl"
cat > "$T4" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"merge PR and log"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t4a","name":"Edit","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam/team/log/clickup-pending.md","old_string":"a","new_string":"b"}}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t4b","name":"Write","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam/.claude/decisions-while-away.md","content":"x"}}]}}
EOF
OUT=$(run_hook "$T4"); RC=$?
assert_silent "4. tick-class — clickup-pending + decisions-while-away" "$OUT" "$RC"

# Test 4b: persona scratch path → silent
T4B="$TMP_DIR/t4b-persona-scratch.jsonl"
cat > "$T4B" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"review"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t4b","name":"Write","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam-maya-wt/team/maya-dev/pr-71-review-body.md","content":"x"}}]}}
EOF
OUT=$(run_hook "$T4B"); RC=$?
assert_silent "4b. tick-class — persona scratch (team/maya-dev/)" "$OUT" "$RC"

# Test 5: mixed — code + STATE.md → block (any non-tick wins)
T5="$TMP_DIR/t5-mixed.jsonl"
cat > "$T5" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"ship and update state"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t5a","name":"Edit","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/src/extension/main.ts","old_string":"a","new_string":"b"}}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t5b","name":"Edit","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam/team/STATE.md","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T5"); RC=$?
assert_block "5. mixed — code + STATE.md (non-tick wins)" "$OUT" "$RC"

# Test 6: pure Q&A — only Read tool_use → silent
T6="$TMP_DIR/t6-qa.jsonl"
cat > "$T6" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"what does this file do?"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t6","name":"Read","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam/CLAUDE.md"}}]}}
EOF
OUT=$(run_hook "$T6"); RC=$?
assert_silent "6. pure Q&A (Read only, no Edit/Write/Agent)" "$OUT" "$RC"

# Test 7: stop_hook_active re-entry guard → silent (even with code edit)
T7="$TMP_DIR/t7-reentry.jsonl"
cat > "$T7" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"fix"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t7","name":"Edit","input":{"file_path":"c:/Trunk/PRIVATE/ClaudeTeam-felix-wt/src/extension/main.ts","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T7" '"stop_hook_active":true'); RC=$?
assert_silent "7. stop_hook_active re-entry guard" "$OUT" "$RC"

# Test 8: missing transcript_path → fail-open block-response
OUT=$(printf '{}' | bash "$HOOK"); RC=$?
assert_block "8. missing transcript_path (fail-open)" "$OUT" "$RC"

# Test 8b: unreadable transcript_path → fail-open block-response
OUT=$(run_hook "$TMP_DIR/does-not-exist.jsonl"); RC=$?
assert_block "8b. unreadable transcript_path (fail-open)" "$OUT" "$RC"

# --- early-exit allowlist-gap fixtures (ticket 86c9z7yrh) --------------------
# The two ~/.claude/projects/<slug>/{memory,sessions}/ surfaces were a tick-class
# allowlist GAP: a save-session / memory-promotion turn writes ONLY these files
# (+ STATE.md), yet the pre-fix hook block-fired the maintain-docs banner because
# those dirs were absent from tick_pattern. Paths use the real on-disk Windows
# backslash shape captured from live transcripts.

# Test 9: tick-class — auto-memory promotion (memory/*.md + STATE.md) → silent
T9="$TMP_DIR/t9-memory-promotion.jsonl"
cat > "$T9" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"save session"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t9a","name":"Write","input":{"file_path":"C:\\Users\\538252\\.claude\\projects\\c--Trunk-PRIVATE-ClaudeTeam\\memory\\feedback_bypass_mode_runtime_outranks_settings.md","content":"x"}}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t9b","name":"Edit","input":{"file_path":"c:\\Trunk\\PRIVATE\\ClaudeTeam\\team\\STATE.md","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T9"); RC=$?
assert_silent "9. tick-class — auto-memory promotion (memory/*.md + STATE.md)" "$OUT" "$RC"

# Test 10: tick-class — /save-session state file only → silent
T10="$TMP_DIR/t10-session-state.jsonl"
cat > "$T10" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"save"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t10","name":"Write","input":{"file_path":"C:\\Users\\538252\\.claude\\projects\\c--Trunk-PRIVATE-ClaudeTeam\\sessions\\session-2026-06-04-2149-drain-nits.md","content":"x"}}]}}
EOF
OUT=$(run_hook "$T10"); RC=$?
assert_silent "10. tick-class — /save-session state file (sessions/session-*.md)" "$OUT" "$RC"

# Test 11: NON-VACUITY guard — memory write + REAL code edit → block.
# Proves the new memory/sessions patterns do NOT over-match: a turn that also
# touches code is still doc-worthy. Reverting the fix keeps tests 9-10 green but
# this asserts the guard direction holds; reverting tick_pattern's anchoring so
# memory matched `.*` would (wrongly) silence this — the assert catches it.
T11="$TMP_DIR/t11-memory-plus-code.jsonl"
cat > "$T11" <<'EOF'
{"role":"user","message":{"content":[{"type":"text","text":"promote insight and fix parser"}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t11a","name":"Edit","input":{"file_path":"C:\\Users\\538252\\.claude\\projects\\c--Trunk-PRIVATE-ClaudeTeam\\memory\\MEMORY.md","old_string":"a","new_string":"b"}}]}}
{"role":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_t11b","name":"Edit","input":{"file_path":"c:\\Trunk\\PRIVATE\\ClaudeTeam-felix-wt\\src\\extension\\watcher\\metaJsonLoader.ts","old_string":"a","new_string":"b"}}]}}
EOF
OUT=$(run_hook "$T11"); RC=$?
assert_block "11. non-vacuity — memory write + code edit (non-tick wins)" "$OUT" "$RC"

# --- summary -----------------------------------------------------------------

TOTAL=$((PASS + FAIL))
printf '\n%d/%d passed (%d failed)\n' "$PASS" "$TOTAL" "$FAIL"
exit $FAIL
