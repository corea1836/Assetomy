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

# event는 COMMENT로 고정한다. 프롬프트 인젝션이 review.json을 바꿔도 승인·변경 요청 리뷰를 달지 못하게 한다.
{ read -r id; read -r url; } < <(jq '.event = "COMMENT"' .review-tmp/review.json |
  gh api --method POST "repos/{owner}/{repo}/pulls/$1/reviews" --input - --jq '.id, .html_url')
want=$(jq '.comments | length' .review-tmp/review.json)
# 코멘트 목록은 기본 30개씩 잘리므로 모든 페이지를 읽어 페이지별 개수를 더한다.
got=$(gh api --paginate "repos/{owner}/{repo}/pulls/$1/reviews/$id/comments" --jq length | awk '{ s += $1 } END { print s + 0 }')

if [ "$got" != "$want" ]; then
  echo "인라인 코멘트가 ${got}/${want}개만 게시됐습니다: ${url}" >&2
  exit 1
fi
echo "$url"
