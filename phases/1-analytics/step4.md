# Step 4: build-dashboard

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` (CRITICAL: Free/Pro 게이팅은 `buildDashboard` 한 곳)
- `/docs/ADR.md` (ADR-011)
- `/docs/USER_FLOW.md` ("① 진입 · 인증 · 분기"의 (B) 대시보드 진입: 월 대체 규칙)
- 이전 step에서 만든 파일: `/src/types/dashboard.ts`, `/src/types/transaction.ts`, `/src/lib/analytics/dates.ts`, `/src/lib/analytics/snapshot.ts`, `/src/lib/analytics/comparison.ts`, `/src/lib/analytics/detection.ts`와 각 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

플랜별 대시보드 DTO를 만드는 단일 진입점을 `src/lib/analytics/dashboard.ts`에 만든다. 테스트(`src/lib/analytics/dashboard.test.ts`)를 먼저 쓴다.

```ts
export type BuildDashboardInput = {
  transactions: Transaction[]
  plan: Plan
  month?: string        // URL의 ?month= 값 그대로(검증 전)
  today: IsoDate
}

export function buildDashboard(input: BuildDashboardInput): Dashboard | null
```

### 규칙
- 거래가 0건이면 `null`이다(온보딩 화면).
- 선택 월: `month`가 `listDataMonths` 결과에 있으면 그 달, 아니면(없음·형식 오류·데이터 없는 달) 가장 최근 데이터 월.
- 공통 필드: `month`, `months`(`listDataMonths`), `lastDate`(전체 거래의 최대 이용일), `snapshot`(`buildSnapshot`), `mom`(`buildMonthOverMonth`).
- 탐지: `detectFindings(transactions, month)` → `summarizeFindings`.
- `plan === 'free'`: `{ ...공통, plan: 'free', teaser: { byKind, candidateTotal }, trendAvailable: buildTrend(...) !== null }`
- `plan === 'pro'`: `{ ...공통, plan: 'pro', findings: { byKind, candidateTotal, items }, trend: buildTrend(...) }`
- Free 객체는 **새 객체 리터럴로** 만들고, findings나 trend 객체를 spread하지 않는다. 이유: 숨겨야 할 필드가 실수로 섞여 RSC payload로 나간다.

### 테스트로 단언할 것 (최소)
- 빈 입력 → `null`.
- 월 대체: 요청 월이 데이터에 있으면 그 달, 없거나 `'abc'`·`'2026-13'`·`undefined`면 최근 데이터 월.
- **Free 유출 방지**: 정기결제·중복·고액이 모두 걸리는 데이터로 Free DTO를 만들고,
  - `Object.keys(dto).sort()`가 `['lastDate','mom','month','months','plan','snapshot','teaser','trendAvailable']`와 같다.
  - `Object.keys(dto.teaser).sort()`가 `['byKind','candidateTotal']`와 같다.
  - `JSON.stringify(dto)`에 입력 거래의 어떤 `id`도, `"items"`, `"trend"`, `"seriesMonths"`, `"transactions"` 문자열도 들어 있지 않다.
- 같은 데이터의 Free `teaser`와 Pro `findings`의 `byKind`·`candidateTotal`이 같다.
- Pro DTO에 `items`와 `trend`가 있다. 데이터 월이 1개면 Pro `trend === null`, Free `trendAvailable === false`.
- `snapshot.total`이 선택 월 거래 금액 합과 정확히 같다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # dashboard.test.ts 포함 전체 통과
npx vitest run src/lib/analytics
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env" src/lib/analytics --include='*.ts' --exclude='*.test.ts'
! grep -rnE "from ['\"](node:|fs|@/lib/supabase|@/services|@/lib/env|@/lib/mode)" src/lib/analytics --include='*.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가? (Free DTO에 탐지 상세·거래 ID·추세 없음)
3. 결과에 따라 `phases/1-analytics/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `buildDashboard` 시그니처와 월 대체 규칙을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- Free/Pro 분기를 `buildDashboard` 밖(컴포넌트·페이지)에 두지 마라. 이유: 게이팅은 DTO 유니온 한 곳에서만 한다(CRITICAL).
- Free DTO에 `items`·거래 ID·`trend`·`seriesMonths`를 넣지 마라. 빈 배열이나 `null`로도 넣지 마라. 이유: 키 존재만으로도 계약이 흐려지고 이후 실수로 채워질 수 있다.
- `today`를 함수 안에서 만들지 마라(`Date.now()` 금지). 호출자가 넘긴다.
- `src/types/`의 타입을 바꾸지 마라.
- 기존 테스트를 깨뜨리지 마라
