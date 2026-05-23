#!/usr/bin/env bash
# SessionStart hook — preloads project documentation from .claude/docs/
# into Claude's context.
#
# Output is wrapped as a JSON object with the `additionalContext` field
# rather than raw stdout. Claude Code truncates raw stdout to ~2KB before
# injection, but `additionalContext` bypasses that limit, so the full
# docs blob actually reaches the model.
#
# Falls back to $CLAUDE_PROJECT_DIR/../.claude/docs so this script also
# works when invoked from a subdirectory — Claude Code does not walk up
# the filesystem to find a parent .claude/, so the subdirectory needs
# its own settings.json that points back here.
#
# Always exits 0; never blocks.

set -eu

DOCS_DIR="$CLAUDE_PROJECT_DIR/.claude/docs"
if [ ! -d "$DOCS_DIR" ]; then
  DOCS_DIR="$CLAUDE_PROJECT_DIR/../.claude/docs"
fi
if [ ! -d "$DOCS_DIR" ]; then
  exit 0
fi

shopt -s nullglob
docs=("$DOCS_DIR"/*.md)
[ ${#docs[@]} -gt 0 ] || exit 0

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  echo "# Project documentation (preloaded from $DOCS_DIR at session start)"
  echo
  echo "These reference docs are already in context. Do NOT call Read on them again unless the user asks for an exact verbatim quote."
  echo
  echo "## First-response confirmation (mandatory)"
  echo
  echo "Begin your VERY FIRST response of this session with this exact line, on its own:"
  echo
  echo "> Project docs preloaded (${#docs[@]} files). Ready."
  echo
  echo "Then a blank line, then answer the user's request normally. This is non-negotiable — always include the confirmation line, even if the user's prompt is short (e.g. 'yes', 'hi'). It is the user's only visible signal that the SessionStart hook fired. Do NOT repeat it on subsequent turns; only the first response of the session."
  for f in "${docs[@]}"; do
    echo
    echo "---"
    echo
    echo "## $(basename "$f")"
    echo
    cat "$f"
  done
} > "$TMP"

# Emit the canonical SessionStart hook output:
#   - systemMessage: visible banner shown to the user in the chat UI, so the
#     user (and teammates) know the preload fired and how much was injected.
#   - hookSpecificOutput.additionalContext: the actual docs payload, injected
#     silently into the model's context. additionalContext at the top level is
#     NOT recognised — it must be nested under hookSpecificOutput.
# Reading via fs avoids shell-quoting pitfalls.
DOC_COUNT=${#docs[@]}
node -e '
const fs = require("fs");
const data = fs.readFileSync(process.argv[1], "utf8");
const docCount = Number(process.argv[2]);
const kb = Math.round(data.length / 1024);
process.stdout.write(JSON.stringify({
  systemMessage: `Project docs preloaded into Claude context (${docCount} files, ${kb}KB).`,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: data,
  },
}));
' "$TMP" "$DOC_COUNT"
