#!/usr/bin/env bash
# pgTAP 테스트를 linked 프로젝트(dev)에서 Management API로 실행한다. Docker·psql·DB 비밀번호가 필요 없다.
# 사용: scripts/pgtap.sh [파일...]   (기본: supabase/tests/*.test.sql)
# 전제: supabase login, supabase link --project-ref <dev ref>, 마이그레이션 push 완료.
#
# 이 경로는 마지막 SELECT의 결과만 돌려준다. 그래서 테스트 파일은 begin … rollback 안에서
# 단언 결과를 임시 테이블 _tap에 모으고, 마지막에 `select string_agg(line, E'\n' order by n) as tap from _tap;`로
# TAP 전체를 돌려줘야 한다(supabase/tests/*.test.sql 참고).
set -uo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=(supabase/tests/*.test.sql)
fi

failed=0
for file in "${files[@]}"; do
  echo "== $file"
  out=$(supabase db query --linked -f "$file" --output-format json 2>&1)
  code=$?
  # JSON 문자열 안의 \n을 줄바꿈으로 풀어 TAP 줄로 본다.
  tap=$(printf '%s\n' "$out" | perl -pe 's/\\n/\n/g; s/\\"/"/g')
  printf '%s\n' "$tap"

  if [ "$code" -ne 0 ]; then
    echo "FAIL: supabase db query 종료 코드 $code"
    failed=1
  elif ! printf '%s\n' "$tap" | grep -qE '1\.\.[0-9]+'; then
    echo "FAIL: TAP 결과가 없음(마지막 SELECT가 _tap을 돌려주는지 확인)"
    failed=1
  elif printf '%s\n' "$tap" | grep -qE '(^|[^a-z])not ok [0-9]|Looks like you'; then
    echo "FAIL: 실패한 단언이 있음"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "pgTAP: 실패"
  exit 1
fi
echo "pgTAP: 모두 통과"
