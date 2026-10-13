#!/usr/bin/env bash
# 하네스 phase 실행 래퍼. .nvmrc 메이저 버전의 node를 찾아 PATH 앞에 두고, 맥 잠자기를 막고,
# 로그를 phases/<phase>/run-<시각>.log에 남기며 scripts/execute.py를 실행한다.
# 사용: scripts/run-phase.sh <phase-dir> [--resume] [--push] [--deploy]
# 종료 코드는 execute.py 그대로다: 0 완료 · 1 error · 2 blocked · 3 사전 준비 필요.
# node 탐색 순서: $ASSETOMY_NODE_BIN → 현재 PATH → ~/.local/node-v<major>.*/bin → brew node@<major>
set -o pipefail
cd "$(dirname "$0")/.." || exit 1

if [ "$#" -lt 1 ]; then
  echo "사용: scripts/run-phase.sh <phase-dir> [--resume] [--push] [--deploy]"
  exit 64
fi
PHASE="$1"

MAJOR=$(sed -E 's/^v//; s/\..*//' .nvmrc)

node_major() {
  "$1/node" -v 2>/dev/null | sed -E 's/^v//; s/\..*//'
}

find_node_bin() {
  local dir
  for dir in "${ASSETOMY_NODE_BIN:-}" "$(dirname "$(command -v node 2>/dev/null || echo /nonexistent/node)")" \
    "$HOME"/.local/node-v"$MAJOR".*/bin \
    "$(command -v brew >/dev/null 2>&1 && brew --prefix "node@$MAJOR" 2>/dev/null)/bin"; do
    if [ -n "$dir" ] && [ -x "$dir/node" ] && [ "$(node_major "$dir")" = "$MAJOR" ]; then
      echo "$dir"
      return 0
    fi
  done
  return 1
}

NODE_BIN=$(find_node_bin) || {
  echo "✗ Node ${MAJOR}을 찾지 못했습니다. ASSETOMY_NODE_BIN=<node가 있는 bin 폴더>로 지정하세요."
  exit 1
}

LOG_DIR="phases/$PHASE"
[ -d "$LOG_DIR" ] || LOG_DIR="${TMPDIR:-/tmp}"; LOG_DIR="${LOG_DIR%/}"
LOG="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S).log"

RUNNER=(python3 scripts/execute.py "$@")
if command -v caffeinate >/dev/null 2>&1; then
  RUNNER=(caffeinate -dims "${RUNNER[@]}")
fi

echo "node: $NODE_BIN ($("$NODE_BIN/node" -v)) · log: $LOG"
PATH="$NODE_BIN:$PATH" "${RUNNER[@]}" 2>&1 | tee "$LOG"
CODE=${PIPESTATUS[0]}

case "$CODE" in
  0) echo "→ 완료: $PHASE" ;;
  1) echo "→ error: 원인을 고친 뒤 scripts/run-phase.sh $PHASE --resume" ;;
  2) echo "→ blocked: 사유를 해결한 뒤 scripts/run-phase.sh $PHASE --resume" ;;
  3) echo "→ 사전 준비가 필요합니다: 위 안내를 마친 뒤 scripts/run-phase.sh $PHASE" ;;
  *) echo "→ 종료 코드 $CODE: 로그를 확인하세요($LOG)" ;;
esac
exit "$CODE"
