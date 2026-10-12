#!/bin/bash
# 브라우저 시나리오 실행기 — docs/testing/BROWSER_TESTING.md의 시나리오를 dev-browser로 돌린다.
# 사용: scripts/browser-test/run.sh [s1 s3 ...]   (인자가 없으면 전체)
# 프로덕션 빌드를 3100 포트에 띄우고, 끝나면 이 스크립트가 띄운 서버만 끈다.

cd "$(dirname "$0")/../.." || exit 1
ROOT=$(pwd)
DIR=scripts/browser-test
PORT=3100
# Origin 검사와 OAuth 복귀 주소가 이 포트를 쓰게 한다. NEXT_PUBLIC_*는 빌드 때 치환되므로 빌드 전에 둔다.
export NEXT_PUBLIC_SITE_URL="http://localhost:$PORT"

listener() { lsof -ti "tcp:$PORT" -sTCP:LISTEN | head -1; }
cwd_of() { lsof -a -p "$1" -d cwd -Fn | sed -n 's/^n//p'; }

if [ -n "$(listener)" ]; then
  echo "ERROR: $PORT 포트를 이미 쓰고 있어요(서버 위치: $(cwd_of "$(listener)"))." >&2
  exit 1
fi

build=$(npm run build 2>&1) || { printf '%s\n' "$build" | tail -n 20 >&2; echo "ERROR: npm run build 실패" >&2; exit 1; }

npx next start -p "$PORT" >/dev/null 2>&1 &
# 부모(npx)만 끄면 next-server가 남는다. LISTEN 중인 프로세스를 끈다.
trap 'pid=$(listener); [ -n "$pid" ] && kill "$pid"' EXIT

for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$PORT/" && break; sleep 0.5; done
if [ -z "$(listener)" ] || [ "$(cwd_of "$(listener)")" != "$ROOT" ]; then
  echo "ERROR: $PORT 포트에 이 저장소 서버가 뜨지 않았어요." >&2
  exit 1
fi

if [ $# -gt 0 ]; then scenarios=("$@"); else scenarios=(s1 s2 s3 s4 s5 s6 s7); fi

pass=0
fail=0
errors=0
for s in "${scenarios[@]}"; do
  file=$(ls "$DIR/$s"-*.js 2>/dev/null | head -1)
  if [ -z "$file" ]; then
    echo "ERROR: $s 시나리오 파일이 없어요." >&2
    errors=$((errors + 1))
    continue
  fi
  echo "--- $(basename "$file" .js)"
  out=$(cat "$DIR/lib.js" "$file" | dev-browser --browser assetomy-test --headless --idle-timeout 5m --timeout 180 2>&1)
  code=$?
  printf '%s\n' "$out"
  pass=$((pass + $(printf '%s\n' "$out" | grep -c '^PASS')))
  fail=$((fail + $(printf '%s\n' "$out" | grep -c '^FAIL')))
  [ "$code" -eq 0 ] || errors=$((errors + 1))
done

echo "=== PASS $pass · FAIL $fail · 스크립트 오류 $errors"
[ "$fail" -eq 0 ] && [ "$errors" -eq 0 ]
