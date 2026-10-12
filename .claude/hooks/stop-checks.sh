#!/bin/bash
# Stop Checks Hook — Stop
# 응답을 끝내기 전에 lint → build → test를 돌린다.
# 실패하면 마지막 출력 40줄을 stderr로 보내고 exit 2로 막는다. stderr가 비면 원인이 전달되지 않는다.

[ -f package.json ] || exit 0

# execute.py가 phase를 돌리는 동안에는 건너뛴다. step마다 AC로 같은 검사를 하고,
# 같은 작업 트리의 TDD 중간 상태와 .next 빌드를 건드리지 않기 위해서다.
pgrep -f 'scripts/[e]xecute\.py' >/dev/null && exit 0

out=$( (npm run lint && npm run build && npm run test) 2>&1 )
code=$?

if [ "$code" -ne 0 ]; then
  printf '%s\n' "$out" | tail -n 40 >&2
  exit 2
fi

printf '%s\n' "$out"
