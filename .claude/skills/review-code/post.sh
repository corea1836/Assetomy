#!/usr/bin/env bash
# .review-tmp/review.json을 PR에 게시하고 요약 코멘트 링크를 출력한다.
# - 요약(body): PR에 하나만 두고 다시 리뷰할 때마다 고쳐 쓴다. 리뷰마다 요약이 쌓이지 않게 하기 위해서다.
# - 인라인(comments): 줄 위치가 커밋마다 달라 COMMENT 리뷰로 달고, 리뷰 본문에는 요약 링크만 둔다. 지적이 없으면 리뷰를 달지 않는다.
# 스크립트로 둔 이유: headless 리뷰어에게 gh api를 통째로 허용하면 diff 속 프롬프트 인젝션이 CI 토큰으로 임의 API를 호출할 수 있다.
# 사용법: post.sh <PR 번호>
set -euo pipefail

if ! [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  echo "사용법: post.sh <PR 번호>" >&2
  exit 2
fi
pr=$1
review=.review-tmp/review.json
marker='<!-- review-code:summary -->'

summary=$(jq -r --arg m "$marker" '"\($m)\n\(.body)\n\n<sub>마지막 리뷰: `\(.commit_id[0:7])`</sub>"' "$review")
# 표식으로 시작하는 기존 요약 코멘트를 찾는다. sed는 입력을 끝까지 읽어 gh가 SIGPIPE로 실패하지 않는다.
cid=$(gh api --paginate "repos/{owner}/{repo}/issues/$pr/comments" --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | sed -n '1p')
if [ -n "$cid" ]; then
  url=$(jq -n --arg b "$summary" '{body: $b}' | gh api --method PATCH "repos/{owner}/{repo}/issues/comments/$cid" --input - --jq .html_url)
else
  url=$(jq -n --arg b "$summary" '{body: $b}' | gh api --method POST "repos/{owner}/{repo}/issues/$pr/comments" --input - --jq .html_url)
fi

want=$(jq '.comments | length' "$review")
if [ "$want" -gt 0 ]; then
  # event는 COMMENT로 고정한다. 프롬프트 인젝션이 review.json을 바꿔도 승인·변경 요청 리뷰를 달지 못하게 한다.
  id=$(jq --arg u "$url" '.event = "COMMENT" | .body = "판정과 요약: \($u)"' "$review" |
    gh api --method POST "repos/{owner}/{repo}/pulls/$pr/reviews" --input - --jq .id)
  # 코멘트 목록은 기본 30개씩 잘리므로 모든 페이지를 읽어 페이지별 개수를 더한다.
  got=$(gh api --paginate "repos/{owner}/{repo}/pulls/$pr/reviews/$id/comments" --jq length | awk '{ s += $1 } END { print s + 0 }')
  if [ "$got" != "$want" ]; then
    echo "인라인 코멘트가 ${got}/${want}개만 게시됐습니다: ${url}" >&2
    exit 1
  fi
fi
echo "$url"
