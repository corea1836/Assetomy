# Step 1: snapshot

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("핵심 기능" UC 08, "플랜별 기능")
- `/docs/USER_FLOW.md` ("② 첫 업로드 → aha"의 대시보드, "④ 월간 재방문")
- `/docs/ARCHITECTURE.md` ("레이어 규칙" 절)
- 이전 step에서 만든 파일: `/src/types/category.ts`, `/src/types/transaction.ts`, `/src/types/dashboard.ts`, `/src/lib/analytics/dates.ts`, `/src/lib/analytics/dates.test.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

월별 스냅샷과 "거래가 있는 달" 목록을 만드는 순수 함수를 `src/lib/analytics/snapshot.ts`에 만든다. 테스트(`src/lib/analytics/snapshot.test.ts`)를 먼저 쓴다.

```ts
export const TOP_MERCHANT_LIMIT = 5

export function listDataMonths(transactions: Transaction[]): MonthOption[]
export function buildSnapshot(transactions: Transaction[], month: YearMonth, today: IsoDate): Snapshot
```

### 규칙
- `listDataMonths`: 거래가 1건 이상 있는 달만, **최신순**. `period`는 그 달 거래의 최소·최대 이용일이다.
- `buildSnapshot`은 입력 중 `monthOf(date) === month`인 거래만 쓴다.
  - `total`: 그 달 모든 거래 `amount`의 합(음수 포함). 정수 합이며 반올림하지 않는다.
  - `period`: 그 달 거래의 최소·최대 이용일. 그 달 거래가 0건이면 throw한다(호출자는 데이터가 있는 달만 넘긴다).
  - `transactionCount`: 그 달 거래 수.
  - `inProgress`: `month >= monthOf(today)`.
  - `categories`: 카테고리별 금액 합이 0이 아닌 것만. 금액 내림차순, 같으면 `CATEGORY_IDS` 순서. `ratio`는 `total > 0`이면 `amount / total`, 아니면 `null`.
  - `topMerchants`: `merchantKey`별 금액 합이 **양수**인 것만. 금액 내림차순, 같으면 `merchantKey` 오름차순, 최대 `TOP_MERCHANT_LIMIT`개. `merchant`·`category`는 그 가맹점의 가장 늦은 이용일 거래 값(같은 날이면 `id`가 사전순으로 가장 큰 거래)을 쓴다. `count`는 그 달 그 가맹점의 거래 수(음수 포함).
  - `daily`: `datesOfMonth(month)` 전체를 순서대로, 날짜별 금액 합(없으면 0).
- 불변식: `sum(categories.amount) === total`, `sum(daily.amount) === total`.

### 테스트로 단언할 것 (최소)
- 두 카드에 같은 날·가맹점·금액 거래가 있어도 둘 다 합계에 들어간다.
- 취소(음수)가 그 달 `total`·카테고리·일별에서 차감된다.
- 다른 달 거래는 섞이지 않는다.
- 위 불변식 두 개.
- `inProgress`: `today`가 같은 달이면 `true`, 다음 달이면 `false`.
- 카테고리 정렬·동점 처리, Top 5 자르기와 동점 처리, 금액 합이 0 이하인 가맹점 제외.
- `daily` 길이가 그 달 일수와 같고 거래 없는 날은 0.
- `listDataMonths`가 최신순이고 거래 없는 달을 건너뛰며 `period`가 맞다.
- 입력 배열 순서를 바꿔도 결과가 같다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # snapshot.test.ts 포함 전체 통과
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env" src/lib/analytics --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가? (금액은 코드로만 계산)
3. 결과에 따라 `phases/1-analytics/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 export한 함수와 상수 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 금액을 반올림하거나 부동소수로 누적하지 마라(비율 `ratio`만 예외). 이유: 원본 합계와 정확히 일치해야 한다.
- 같은 날·가맹점·금액 거래를 합치거나 중복 제거하지 마라. 이유: 중복 제거는 저장 단계의 fingerprint가 이미 했고, 남은 거래는 모두 실제 거래다.
- `src/types/`의 타입을 바꾸지 마라.
- 전월 대비·추세·탐지·`buildDashboard`를 이 step에서 만들지 마라.
- 기존 테스트를 깨뜨리지 마라
