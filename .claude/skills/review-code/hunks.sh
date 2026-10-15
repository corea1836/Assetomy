#!/usr/bin/env bash
# PR 인라인 코멘트를 달 수 있는 새 파일 쪽 줄 범위(hunk)를 "경로 시작 끝"으로 한 줄씩 출력한다.
# SKILL.md에 awk를 직접 쓰지 않는 이유: 스킬 로더가 awk의 $0를 스킬 인자로 바꾼다.
# 사용법: hunks.sh <git 범위>
set -euo pipefail

git diff --no-color "$1" -- . ':(exclude)package-lock.json' |
  awk '/^\+\+\+ b\//{f=substr($0,7)} /^@@/{split($3,a,","); s=substr(a[1],2); n=(a[2]==""?1:a[2]); if(n>0) print f, s, s+n-1}'
