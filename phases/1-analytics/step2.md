# Step 2: comparison

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("플랜별 기능": 전월 대비, 여러 달 누적 추세)
- `/docs/DESIGN.md` ("차트": 진행 중인 달 표시, "숫자 · 날짜": 전월 대비)
- 이전 step에서 만든 파일: `/src/types/transaction.ts`, `/src/types/dashboard.ts`, `/src/types/category.ts`, `/src/lib/analytics/dates.ts`, `/src/lib/analytics/snapshot.ts`와 각 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

전월 대비와 여러 달 추세를 만드는 순수 함수를 `src/lib/analytics/comparison.ts`에 만든다. 테스트(`src/lib/analytics/comparison.test.ts`)를 먼저 쓴다. 월별 합계 계산은 `snapshot.ts`와 같은 정의(그 달 모든 거래 `amount`의 합)를 쓴다.

```ts
export const TREND_MAX_MONTHS = 12

export function buildMonthOverMonth(
  transactions: Transaction[], month: YearMonth, today: IsoDate,
): MonthOverMonth | null

export function buildTrend(
  transactions: Transaction[], month: YearMonth, today: IsoDate,
): Trend | null
```

### 규칙
- `buildMonthOverMonth`: 아래 중 하나면 `null`이다.
  - 선택 월이 진행 중(`month >= monthOf(today)`)
  - 전월(`addMonths(month, -1)`)에 거래가 0건
  - 그 외에는 `{ previousMonth, previousTotal, diff: 선택 월 total - previousTotal }`.
- `buildTrend`:
  - 구간: `addMonths(month, -(TREND_MAX_MONTHS - 1))`과 "입력 전체에서 가장 이른 거래 월" 중 늦은 쪽부터 선택 월까지, **빈 달도 0으로 포함**한 연속 구간. 오래된 달부터 순서대로.
  - 구간 안에 거래가 있는 달이 2개 미만이면 `null`이다. 이유: 추세는 2개월 이상에서 표시한다.
  - `months[].inProgress`: `m >= monthOf(today)`.
  - `categoryChanges`: `buildMonthOverMonth`가 `null`이면 `null`이다. 아니면 선택 월과 전월 중 한쪽이라도 금액이 있는 카테고리마다 `{ current, previous, diff: current - previous }`를 만들고, `diff === 0`은 빼고, `|diff|` 내림차순, 같으면 `CATEGORY_IDS` 순서로 정렬한다.

### 테스트로 단언할 것 (최소)
- 진행 중인 달 → `mom === null`. 전월 데이터 없음 → `null`. 정상 → `diff` 부호와 값.
- 전월 대비가 취소(음수)를 반영한 합계로 계산된다.
- 추세 구간: 14개월 데이터에서 12개만, 중간 빈 달 0 포함, 선택 월이 마지막, 선택 월 이후 달은 포함하지 않음.
- 데이터 월이 1개면 `null`, 2개면 추세가 있다.
- 진행 중인 달의 `inProgress === true`.
- `categoryChanges` 정렬·0 제외, 진행 중인 달이면 `null`.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # comparison.test.ts 포함 전체 통과
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env" src/lib/analytics --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-analytics/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 export한 함수와 상수 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 진행 중인 달을 전월 대비에 쓰지 마라. 이유: 달이 끝나지 않아 항상 "줄었어요"로 보인다(PRD).
- 월 합계를 `snapshot.ts`와 다른 방식으로 계산하지 마라. 필요하면 내부 헬퍼를 공유한다. 이유: 같은 달 숫자가 화면마다 다르면 신뢰를 잃는다.
- `src/types/`의 타입을 바꾸지 마라.
- 탐지·`buildDashboard`를 이 step에서 만들지 마라.
- 기존 테스트를 깨뜨리지 마라
