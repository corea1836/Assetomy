#!/usr/bin/env bash
# /review-code를 headless(claude -p)로 실행하고 판정을 종료 코드로 돌려준다. pre-commit 훅과 GitHub Action이 부른다.
# 사용: scripts/review-code.sh staged | pr <번호>
# 종료 코드: 0 Approve · 1 Changes Requested·Blocked · 2 리뷰를 끝내지 못함(Error·Pending, claude 실패, 잘못된 인자)
# 훅을 끄는 이유: Stop 훅(stop-checks.sh)이 리뷰 끝에 lint·build·test를 돌리고, 실패하면 Claude에게 코드를 고치게 한다.
# 임시 파일이 .claude/ 밖(.review-tmp/)인 이유: .claude/는 보호 경로라 허용 규칙을 줘도 headless에서 쓰기가 거부된다.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

TOOLS="Workflow,Bash(git diff *),Bash(git rev-parse *),Bash(git status *),Bash(git merge-base *),Bash(git log *),Bash(git branch *),Bash(mkdir -p .review-tmp),Edit(./.review-tmp/**)"

case "${1:-}" in
  staged)
    PROMPT="/review-code --staged"
    ;;
  pr)
    if ! [[ "${2:-}" =~ ^[0-9]+$ ]]; then
      echo "사용: scripts/review-code.sh staged | pr <번호>" >&2
      exit 2
    fi
    PROMPT="/review-code --pr $2 --post"
    TOOLS="$TOOLS,Bash(git fetch *),Bash(gh pr view *),Bash(gh api *),Bash(bash .claude/skills/review-code/hunks.sh *)"
    ;;
  *)
    echo "사용: scripts/review-code.sh staged | pr <번호>" >&2
    exit 2
    ;;
esac

SCHEMA='{"type":"object","required":["verdict","report"],"properties":{"verdict":{"type":"string","enum":["Approve","Changes Requested","Blocked","Error","Pending"]},"report":{"type":"string"}}}'
APPEND="최종 응답의 report에는 /review-code 3의 두 층 출력 전체를, verdict에는 그 판정을 넣는다. 전제 조건 실패나 workflow 실패로 리뷰를 끝내지 못했으면 verdict는 Error이고 report에 이유를 쓴다. 리뷰할 변경이 없으면 verdict는 Approve다. workflow 결과 알림이 오기 전에 응답을 끝내야 하면 verdict는 Pending이고 판정을 미리 짐작하지 않는다. Bash 명령은 하나씩 실행한다(&&·;·|로 묶지 않고 \$(…)를 쓰지 않는다). 허용 규칙이 명령 단위라 묶인 명령은 거부될 수 있다."

out=$(claude -p "$PROMPT" --output-format json --json-schema "$SCHEMA" --append-system-prompt "$APPEND" \
  --settings '{"disableAllHooks":true}' --permission-mode dontAsk --permission-prompts none --allowedTools "$TOOLS")
code=$?

# 거부된 Bash는 명령을, 파일 도구는 경로만 남긴다(파일 내용은 남기지 않는다).
denied=$(printf '%s' "$out" | jq -r '.permission_denials[]? | "- \(.tool_name): \((.tool_input.command // .tool_input.file_path // "") | .[0:300])"' 2>/dev/null)
[ -n "$denied" ] && printf '거부된 도구:\n%s\n' "$denied" >&2

verdict=$(printf '%s' "$out" | jq -r '.structured_output.verdict // empty' 2>/dev/null)
if [ "$code" -ne 0 ] || [ -z "$verdict" ]; then
  echo "✗ 리뷰를 끝내지 못했습니다(claude 종료 코드 $code)." >&2
  # 실패 종류마다 원인이 담기는 필드가 다르다(result 또는 errors). JSON이 아니면 원문 앞부분을 남긴다.
  if printf '%s' "$out" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$out" | jq -r '.result // empty, (.errors // [] | .[] | tostring), "subtype=\(.subtype) terminal_reason=\(.terminal_reason) api_error_status=\(.api_error_status)"' >&2
  else
    printf '%s\n' "$out" | head -c 2000 >&2
  fi
  exit 2
fi

printf '%s\n' "$out" | jq -r '.structured_output.report'
case "$verdict" in
  Approve) exit 0 ;;
  "Changes Requested" | Blocked) exit 1 ;;
  *) exit 2 ;;
esac
