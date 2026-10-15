---
name: review-code
description: 변경분을 correctness·security·architecture 서브에이전트로 병렬 리뷰하고, 지적마다 skeptic 3명의 2/3 다수결로 거짓 양성을 걸러, 인라인 코멘트와 PR 요약 형식으로 터미널에 출력한다. PR이 있으면 확인 후 GitHub에 게시한다.
argument-hint: "[git 범위, 예: main...HEAD | --staged | --pr <번호> [--post]]"
---

변경분을 workflow `review-code`로 리뷰하고 두 층으로 출력하라. 인자: $ARGUMENTS (git 범위 또는 아래 옵션. 비어 있으면 아래 기본 범위)
- `--staged`: 커밋 전 staged 변경만 본다. pre-commit 훅이 쓴다.
- `--pr <번호>`: 그 PR을 PR 모드로 본다. CI가 쓴다(detached HEAD라 현재 브랜치로 PR을 찾지 못한다).
- `--post`: 4의 게시를 묻지 않고 한다. `--pr`과 함께만 쓴다.

왜 병렬인가: 차원별 전문성(에이전트마다 자기 체크리스트만 맡음) + 동시 실행 속도(가장 느린 차원 하나만큼 걸림). 대가는 토큰이라 차원 밖 지적을 금지하고, nit은 검증하지 않는다. 심각도 정의는 `.claude/workflows/review-code.js`의 `SEVERITY` 한 곳에 있다.

## 1. 수집
1. `--staged`면 로컬 모드다. 아니면 `gh pr view [<번호>] --json number,url,baseRefName,headRefOid`가 성공하면 PR 모드, 실패하면(gh 없음·로그인 안 됨·PR 없음) 로컬 모드다.
   - PR 모드는 `git rev-parse HEAD`가 `headRefOid`와 같고 `git status --porcelain`이 비어야 한다. 아니면 "push 먼저(로컬 줄 번호가 PR과 달라진다)"라고 하고 멈춘다.
2. 범위: git 범위 인자가 있으면 그 범위. `--staged`는 `--cached`이고 미추적 파일은 구하지 않는다. PR 모드는 `git fetch origin <baseRefName>` 뒤 `origin/<baseRefName>...HEAD`. 로컬 모드는 `$(git merge-base main HEAD)`(작업 트리까지)이고 미추적 새 파일은 `git ls-files --others --exclude-standard`로 구한다.
3. diff와 파일 목록:
   ```
   mkdir -p .review-tmp
   git diff <범위> -- . ':(exclude)package-lock.json' > .review-tmp/diff.patch
   git diff --name-status <범위> -- . ':(exclude)package-lock.json'
   ```
   diff와 미추적 파일이 모두 비면 "리뷰할 변경 없음"으로 끝낸다.
4. PR 모드면 인라인으로 달 수 있는 줄 범위(hunk)를 구한다: `bash .claude/skills/review-code/hunks.sh <범위>` (한 줄에 `경로 시작 끝`)
5. 문서: 브랜치가 `feat-<phase>`이고 `phases/<phase>/`가 있으면 `phases/<phase>/step*.md` 경로 목록.

## 2. 실행
`Workflow({ name: "review-code", args: { range, diffPath: ".review-tmp/diff.patch", files, untracked, docs } })`
- `files`는 name-status 줄 배열, `untracked`·`docs`는 경로 배열이다. args는 JSON 값 그대로 넘긴다(문자열로 감싸지 않는다).
- 결과: `{ confirmed, unverified, unsure, rejected, strengths, failedDimensions }`. 지적마다 `severity, file, line, title, tldr, good, fix, rule, scenario, dimensions, votes`가 있다.

## 3. 출력 (두 층)
두 모드 모두 아래 형식 그대로 세션에 먼저 출력한다.
- 집계는 `confirmed` + `unverified`(nit)로 센다. 판정: critical ≥ 1이면 **Blocked**, major ≥ 1이면 **Changes Requested**, 그 밖에는 **Approve**.
- 차원별 건수도 같은 집계로 센다. 여러 차원이 함께 낸 지적은 차원마다 1건씩 세므로 합이 전체보다 클 수 있다. `failedDimensions`에 있는 차원은 0이 아니라 `실패`로 적는다.
- 심각도 표시: critical 🔴 · major 🟠 · minor 🟡 · nit ⚪

인라인 코멘트 → PR 전체 요약 순으로 보여 준다. 터미널은 줄바꿈 하나를 이어 붙이므로 줄마다 빈 줄을 둔다. 아래에 없는 항목(구분선, 꼬리말, 확인 필요·기각 목록)은 넣지 않는다.

**인라인 코멘트** (`confirmed`와 `unverified` 하나에 하나, 4줄. nit은 제목 끝에 "(미검증)")
````
### 인라인 코멘트 · `{file}:{line}`

🔴 **[critical] [{dimensions}] {title}**

**✗ TL;DR** {tldr}

**✓ Good** {good}

**→ Fix** `{fix}`
````
- `{dimensions}`는 지적을 낸 차원이다. 여러 개면 `·`로 잇는다(예: `[correctness·security]`).
- Fix가 여러 줄이면 4번째 줄을 `**→ Fix**`로 쓰고 바로 아래 코드 블록에 넣는다.

**PR 전체 요약** (1개)
```
### PR 전체 요약

**판정: {판정}** · 🔴 n · 🟠 n · 🟡 n · ⚪ n

**차원** correctness n · security n · architecture n

**Walkthrough**
- {2~3줄. `git log --oneline <범위>`와 `git diff --stat <범위>`를 보고 쓴다}

**잘된 점**
- {strengths에서 2~3개}

**critical·major**
- 🟠 [major] [{dimensions}] {title} — `{file}:{line}`

**다음 액션**
- {critical·major 수정 → /review-code 다시 실행 · 확인 필요 n건 직접 판단(`file:line`을 함께 적는다) · 실패한 차원 다시 실행}
```

## 4. 게시 (PR 모드만)
1. 지적마다 1-4의 hunk 중 같은 경로에서 `시작 ≤ line ≤ 끝`인 것이 있으면 인라인, 없으면 diff 밖 지적이다.
2. "PR #n에 요약 1개와 인라인 n개를 게시할까요?"라고 묻고 답을 기다린다. diff 밖 지적이 있으면 개수도 함께 알린다. `--post`면 묻지 않고 3으로 간다.
3. 확인하면 `.review-tmp/review.json`을 쓴다: `{ "commit_id": headRefOid, "event": "COMMENT", "body": 요약, "comments": [{ "path", "line", "side": "RIGHT", "body": 인라인 }] }`
   - 인라인 body는 4줄 형식에서 `### 인라인 코멘트 · ...` 제목 줄을 뺀 것이다(GitHub가 위치를 보여 준다).
   - diff 밖 지적은 요약 body의 **critical·major** 뒤에 **diff 밖 지적** 목록으로 같은 한 줄 형식(`- 🟡 [minor] [{dimensions}] {title} — `{file}:{line}``)으로 적는다. 없으면 이 항목을 넣지 않는다.
4. `bash .claude/skills/review-code/post.sh <n>`으로 게시한다. 리뷰를 게시하고, 인라인 코멘트 수가 review.json과 같은지 확인한 뒤 리뷰 링크를 출력한다. 0이 아닌 종료 코드면 stderr를 그대로 알린다. `gh api`를 직접 부르지 않는다(headless에서는 post.sh만 허용된다).

## 금지사항
- 리뷰 중에 코드를 고치지 마라. 이유: 지적이 검증되기 전이다. 고치는 것은 사용자 확인 뒤에 한다.
- 확인 없이 게시하지 마라(`--post`는 예외). 이유: PR 코멘트는 외부에 공개된다.
- hunk 밖 줄을 인라인 코멘트로 넣지 마라. 이유: GitHub가 리뷰 전체를 422로 거절한다.
- event를 `APPROVE`·`REQUEST_CHANGES`로 쓰지 마라. 이유: 본인 PR에는 달 수 없다. 판정은 요약 본문에 적는다.
- workflow 결과의 지적을 더하거나 빼거나 심각도를 바꾸지 마라. 이유: skeptic 검증을 거친 결과만 보여 준다.
