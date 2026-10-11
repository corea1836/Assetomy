# Step 3: detection

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("플랜별 기능": 탐지·티저·`candidateTotal`·표현 규칙)
- `/docs/ADR.md` (ADR-010 탐지 규칙, ADR-011)
- 이전 step에서 만든 파일: `/src/types/transaction.ts`, `/src/types/dashboard.ts`, `/src/types/category.ts`, `/src/lib/analytics/dates.ts`, `/src/lib/analytics/snapshot.ts`, `/src/lib/analytics/comparison.ts`와 각 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

확인이 필요한 지출 후보(정기결제·중복 결제 의심·고액 결제)를 찾는 규칙 기반 순수 함수를 `src/lib/analytics/detection.ts`에 만든다. 테스트(`src/lib/analytics/detection.test.ts`)를 먼저 쓴다.

```ts
export const RECURRING_MIN_GAP_DAYS = 28
export const RECURRING_MAX_GAP_DAYS = 35
export const RECURRING_AMOUNT_TOLERANCE = 0.1
export const DUPLICATE_MIN_AMOUNT = 10_000
export const LARGE_MIN_SAMPLE = 20
export const LARGE_MEDIAN_MULTIPLIER = 10

export function detectRecurring(transactions: Transaction[], month: YearMonth): Finding[]
export function detectDuplicates(transactions: Transaction[], month: YearMonth): Finding[]
export function detectLarge(transactions: Transaction[], month: YearMonth): Finding[]
export function detectFindings(transactions: Transaction[], month: YearMonth): Finding[]
export function summarizeFindings(findings: Finding[]): FindingSummary
```
`transactions`는 사용자의 전체 거래(최대 12개월)이고, 결과 탐지는 **선택 월(`month`)의 거래**에 대한 것이다.

### 정기결제 `detectRecurring`
1. 양수 거래만 `merchantKey`별로 묶는다.
2. 한 가맹점에서 같은 달에 양수 거래가 2건 이상인 달은 그 달의 거래를 모두 판단에서 뺀다. 이유: 자주 가는 가맹점(카페 등)의 우연한 28~35일 간격을 정기결제로 오탐하지 않는다.
3. 남은 거래를 이용일 순으로 놓고, 이웃한 두 거래가 `daysBetween`으로 28~35일이고 `|뒤 금액 - 앞 금액| <= 앞 금액 × 0.1`이면 같은 시리즈로 잇는다. 끊기면 새 시리즈다.
4. 거래가 2건 이상인 시리즈 중 선택 월 거래를 포함하는 것마다 finding 1개를 만든다: `transactions`는 선택 월의 그 거래, `amount`는 그 금액, `seriesMonths`는 시리즈 거래들의 달(오름차순).

### 중복 결제 의심 `detectDuplicates`
1. 선택 월의 양수 거래 중 `amount >= DUPLICATE_MIN_AMOUNT`이고 `category !== 'transport'`인 것을 `(cardId, date, merchantKey, amount)`로 묶는다. 같은 카드로 묶는 이유: 이중 청구는 같은 결제 수단에서 생긴다.
2. 입력 전체에서 같은 `cardId`·`merchantKey`이고 `amount === -금액`인 취소 거래 수를 그룹 건수에서 뺀다. 이유: 결제 후 취소하고 다시 결제하는 경우가 흔하다.
3. 남은 건수가 2 이상인 그룹마다 finding 1개: `transactions`는 그룹의 양수 거래 전부, `amount`는 그 합.

### 고액 결제 `detectLarge`
1. 입력 전체의 양수 거래가 `LARGE_MIN_SAMPLE`건 미만이면 `[]`.
2. 양수 거래 금액의 중앙값(짝수 개면 가운데 두 값의 평균)을 구한다.
3. 선택 월의 양수 거래 중 `amount > 중앙값 × LARGE_MEDIAN_MULTIPLIER`인 거래마다 finding 1개.

### 공통
- finding의 `merchant`·`category`는 finding에 담긴 거래 중 이용일이 가장 늦은 거래의 값이다. `FindingTransaction`은 `{ id, date, amount, cardLabel }`만 담는다.
- `detectFindings`: 세 결과를 합쳐 `recurring → duplicate → large` 순서, 같은 종류 안에서는 `amount` 내림차순, 같으면 `merchantKey` 오름차순으로 정렬한다.
- `summarizeFindings`:
  - `byKind[kind] = { count: 그 종류 finding 수, amount: 그 종류 finding amount 합 }`. 탐지가 없는 종류도 `{ count: 0, amount: 0 }`로 채운다.
  - `candidateTotal`: 모든 finding의 거래를 **거래 `id` 기준으로 한 번씩만** 세어 금액을 더한 값. 같은 거래가 여러 종류에 걸려도 한 번만 더한다.

### 테스트로 단언할 것 (최소)
- 정기결제: 3개월 연속 월 1회 같은 금액 → 선택 월에 1건, `seriesMonths` 3개 · 간격 27일 또는 36일이면 아님 · 금액 11% 차이면 아님 · 1개월만 있으면 아님 · 같은 달 2건 있는 카페는 아님 · 선택 월에 결제가 없으면 그 달 결과에 없음
- 중복: 같은 카드·날·가맹점·금액 2건 → 1건 · 다른 카드면 아님 · 9,999원이면 아님 · 교통이면 아님 · 같은 금액 취소 1건이 있으면 아님 · 3건 + 취소 1건 → 1건
- 고액: 양수 19건이면 `[]` · 20건에서 중앙값 × 10 초과만 · 정확히 × 10이면 아님 · 선택 월 밖의 고액은 제외
- `summarizeFindings`: 같은 거래가 정기결제와 고액에 동시에 걸리면 `byKind`에는 각각 들어가고 `candidateTotal`에는 한 번만 들어간다 · 빈 입력이면 모두 0
- 정렬 규칙, 입력 순서를 바꿔도 결과가 같음

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # detection.test.ts 포함 전체 통과
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env" src/lib/analytics --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (탐지는 규칙 기반 코드, LLM 없음)
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-analytics/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 export한 함수와 임계값 상수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 임계값을 상수 밖에 하드코딩하지 마라. 이유: 오탐을 보고 조정할 때 한 곳만 바꿔야 한다.
- `candidateTotal`을 `byKind` 금액의 합으로 계산하지 마라. 이유: 같은 거래가 여러 탐지에 걸리면 이중 합산된다(PRD).
- 탐지 결과를 "절감액"으로 해석하는 필드나 이름을 만들지 마라. 이유: 후보는 정상 지출일 수 있다.
- `src/types/`의 타입을 바꾸지 마라.
- `buildDashboard`를 이 step에서 만들지 마라.
- 기존 테스트를 깨뜨리지 마라
