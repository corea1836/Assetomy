#!/bin/bash
# Stop Guard — Stop
# 턴이 끝날 때 lint·build·test를 돌리고, 실패하면 출력과 함께 한 번 더 이어서 고치게 한다.
# Codex Stop hook은 exit 0 + JSON만 유효하다. stop_hook_active면 이미 이어간 턴이라 루프를 막기 위해 통과시킨다.

INPUT=$(cat)
cd "$(git rev-parse --show-toplevel)" || exit 0
[ -f package.json ] || exit 0
[ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ] && exit 0

OUTPUT=$(npm run lint 2>&1 && npm run build 2>&1 && npm run test 2>&1) && exit 0

jq -n --arg out "$(echo "$OUTPUT" | tail -c 4000)" \
  '{decision: "block", reason: ("lint·build·test 중 실패가 있다. 아래 출력을 보고 고쳐라.\n\n" + $out)}'
exit 0
