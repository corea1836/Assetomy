#!/bin/bash
# Step Command Guard — PreToolUse[Bash] (Codex step 세션 전용)
# execute.py가 띄운 Codex는 샌드박스 없이 네트워크를 쓴다. 공유 dev DB·Supabase 연결·배포를 바꾸는 명령은
# 사용자(또는 사용자가 허락한 Claude 세션)가 하므로 step 세션에서는 막는다. 스크립트 안에서 부르는 경우는 보지 않는다.
# exit 2여야 실제로 차단된다.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

SUPABASE='supabase[[:space:]]+(db[[:space:]]+(push|reset|query)|link|unlink|migration[[:space:]]+(repair|squash|up|down))'
VERCEL='vercel[[:space:]]+(deploy|--prod|promote|alias|rm|remove|env|link)'

if echo "$COMMAND" | grep -qE "$SUPABASE|$VERCEL"; then
  echo 'BLOCKED: step 세션에서는 dev DB 변경(supabase db push·reset·query, migration)·Supabase 연결·Vercel 명령을 실행하지 않는다. 필요하면 blocked로 멈추고 blocked_reason에 사용자가 실행할 명령을 적어라.' >&2
  exit 2
fi

exit 0
