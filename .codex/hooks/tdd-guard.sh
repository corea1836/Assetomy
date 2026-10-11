#!/bin/bash
# TDD Guard 어댑터 — PreToolUse[apply_patch]
# Codex는 file_path 대신 patch 본문을 tool_input.command로 넘긴다.
# 추가·수정 대상 경로를 뽑아 .claude/hooks/tdd-guard.sh로 하나씩 검사하고, 첫 차단 결과를 그대로 낸다.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd')
GUARD="$(git rev-parse --show-toplevel)/.claude/hooks/tdd-guard.sh"

echo "$INPUT" | jq -r '.tool_input.command // empty' \
  | sed -nE 's/^\*\*\* (Add File|Update File|Move to): (.+)$/\2/p' \
  | while IFS= read -r FILE_PATH; do
      case "$FILE_PATH" in
        /*) ;;
        *) FILE_PATH="$CWD/$FILE_PATH" ;;
      esac
      RESULT=$(jq -n --arg f "$FILE_PATH" '{tool_input: {file_path: $f}}' | "$GUARD")
      if [ -n "$RESULT" ]; then
        echo "$RESULT"
        break
      fi
    done

exit 0
