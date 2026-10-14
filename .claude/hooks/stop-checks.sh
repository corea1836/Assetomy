#!/bin/bash
# Stop Checks Hook — Stop
# 응답을 끝내기 전에 lint → build → test를 돌린다.
# 실패하면 마지막 출력 40줄을 stderr로 보내고 exit 2로 막는다. stderr가 비면 원인이 전달되지 않는다.

[ -f package.json ] || exit 0
# phase 실행 중에는 step 세션이 쓰는 중인 코드라 검사가 실패하고, 그 세션의 next build와 겹친다.
pgrep -f scripts/execute.py >/dev/null && exit 0

out=$( (npm run lint && npm run build && npm run test) 2>&1 )
code=$?

if [ "$code" -ne 0 ]; then
  printf '%s\n' "$out" | tail -n 40 >&2
  exit 2
fi

printf '%s\n' "$out"
