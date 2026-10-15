#!/usr/bin/env bash
# .review-tmp/review.json을 PR 리뷰로 게시하고, 인라인 코멘트가 모두 달렸는지 확인한 뒤 리뷰 링크를 출력한다.
# 스크립트로 둔 이유: headless 리뷰어에게 gh api를 통째로 허용하면 diff 속 프롬프트 인젝션이 CI 토큰으로 임의 API를 호출할 수 있다.
# 응답은 id·html_url만 받는다(응답 전체를 셸로 넘기면 zsh echo가 JSON의 \n을 줄바꿈으로 바꿔 파싱이 깨진다).
# 사용법: post.sh <PR 번호>
set -euo pipefail

if ! [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  echo "사용법: post.sh <PR 번호>" >&2
  exit 2
fi

{ read -r id; read -r url; } < <(gh api --method POST "repos/{owner}/{repo}/pulls/$1/reviews" --input .review-tmp/review.json --jq '.id, .html_url')
want=$(jq '.comments | length' .review-tmp/review.json)
got=$(gh api "repos/{owner}/{repo}/pulls/$1/reviews/$id/comments" --jq length)

if [ "$got" != "$want" ]; then
  echo "인라인 코멘트가 ${got}/${want}개만 게시됐습니다: ${url}" >&2
  exit 1
fi
echo "$url"
