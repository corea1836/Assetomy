#!/bin/bash
# Stop Checks Hook — Stop
# 응답을 끝내기 전에 lint → build → test를 돌린다.
# 실패하면 마지막 출력 40줄을 stderr로 보내고 exit 2로 막는다. stderr가 비면 원인이 전달되지 않는다.

[ -f package.json ] || exit 0

out=$( (npm run lint && npm run build && npm run test) 2>&1 )
code=$?

if [ "$code" -ne 0 ]; then
  printf '%s\n' "$out" | tail -n 40 >&2
  exit 2
fi

printf '%s\n' "$out"
