# Step 2: card-analytics

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` (특히 Free/Pro 게이팅 CRITICAL 규칙)
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "패턴", "카드 탭", "월 요약")
- `/docs/ADR.md` (ADR-011, ADR-022, ADR-023, **ADR-024**)
- `/docs/PRD.md` ("플랜별 기능"과 그 아래 카드별 보기·지난 명세서 대비 문단)
- 타입: `/src/types/dashboard.ts`, `/src/types/summary.ts`, `/src/types/transaction.ts`(step 1에서 `statementDate` 추가), `/src/types/card.ts`(step 1에서 `StatementRecord` 추가), `/src/types/upload.ts`(`CardOption`)
- 순수 분석: `/src/lib/analytics/dates.ts`, `/src/lib/analytics/snapshot.ts`, `/src/lib/analytics/comparison.ts`, `/src/lib/analytics/dashboard.ts`, `/src/lib/analytics/summary-input.ts`와 각 `.test.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드에 카드 탭을 더한다(ADR-024). 이 step은 순수 레이어(`lib/analytics`, I/O·`Date.now()`·env 금지, 날짜는 `'YYYY-MM-DD'` 문자열)만 다룬다.

- 월별 카드(`analysisBasis = "month"`): 그 카드 거래만으로 달력 월 스냅샷을 만들고, 지난달 비교는 기존 `buildMonthComparison`(ADR-022)을 그 카드 거래에 그대로 쓴다.
- 이용 기간 카드(`analysisBasis = "cycle"`, `cycleStartDay` 1~31): 명세서(같은 카드·같은 `statementDate`의 거래) 단위로 스냅샷을 만든다. 거래를 이용 기간으로 다시 묶지 않는다. 이용 기간은 결제일과 시작일로 계산해 표시·완료 판단에만 쓴다.
- 카드 탭에는 탐지·추세가 없다. Free/Pro 차이는 Pro에만 있는 "달라진 카테고리"(`categoryChanges`) 하나다.
- 실제 데이터 예: 카드 시작일 12일. 2026-09-23 명세서 = 이용 기간 8/12~9/11, 거래 8/12~9/12(9/12 연회비 포함) 109건. 2026-10-23 명세서 = 이용 기간 9/12~10/11, 거래 9/12~10/11 80건. 두 PDF 모두 10/14에 저장(완료).

## 작업

### 1. 날짜·이용 기간 (`src/lib/analytics/dates.ts`, 새 `src/lib/analytics/statements.ts`)

- `dates.ts`에 `export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[]`(양 끝 포함, `from > to`면 빈 배열)를 더한다. Date 객체를 쓰지 마라(문자열·정수 계산, 기존 `daysInMonth`를 쓴다).
- `statements.ts`:
  ```ts
  // 결제일보다 앞서 시작한 마지막 주기 [시작일 ~ 다음 시작일 전날]. 시작일이 그달에 없으면 그달 말일이 시작일이다.
  export function statementCyclePeriod(statementDate: IsoDate, cycleStartDay: number): Period
  ```
  규칙: 각 달 m의 주기 시작일 `start(m) = m의 min(cycleStartDay, 그달 일수)일`. `s` = `start(m) <= statementDate`인 가장 늦은 시작일(결제일이 있는 달 또는 그 전 달). 이용 기간 = `[start(s의 달 - 1), s의 전날]`. 반드시 아래 표를 테스트로 단언한다.

  | 결제일 | 시작일 | 이용 기간 |
  |---|---|---|
  | 2026-10-23 | 12 | 2026-09-12 ~ 2026-10-11 |
  | 2026-09-23 | 12 | 2026-08-12 ~ 2026-09-11 |
  | 2026-10-14 | 1 | 2026-09-01 ~ 2026-09-30 |
  | 2026-11-12 | 29 | 2026-09-29 ~ 2026-10-28 |
  | 2026-01-05 | 20 | 2025-11-20 ~ 2025-12-19 |
  | 2026-03-25 | 31 | 2026-01-31 ~ 2026-02-27 |
  | 2026-10-12 | 12 | 2026-09-12 ~ 2026-10-11 |
  | 2028-03-10 | 30 | 2028-01-30 ~ 2028-02-28 |

  (2026-03-25·31일: 시작일은 1/31·2/28(평년 말일)·3/31이고 3/31 > 3/25라 `s = 2/28`, 이용 기간 1/31~2/27. 2026-10-12·12일: 시작일 당일이 결제일이면 그날 시작한 주기는 아직 안 끝났으므로 `s = 10/12`, 이용 기간은 전날까지다. 2028-03-10·30일: 2월 시작일은 윤년 29일, 3월 시작일 30일 > 3/10이라 `s = 2/29`, 이용 기간 1/30~2/28.)

### 2. 스냅샷 일반화 (`src/types/dashboard.ts`, `src/lib/analytics/snapshot.ts`)

- 타입:
  ```ts
  export type PeriodSnapshot = {
    period: Period; total: number; transactionCount: number;
    categories: CategoryAmount[]; topMerchants: MerchantAmount[]; otherMerchants: MerchantAmount[];
    daily: DailyAmount[];
  };
  export type Snapshot = PeriodSnapshot & { month: YearMonth; inProgress: boolean };
  ```
  `Snapshot`의 필드와 의미는 바뀌지 않는다(주석은 옮긴다).
- `snapshot.ts`에 `export function buildPeriodSnapshot(transactions: Transaction[], dates: IsoDate[]): PeriodSnapshot`을 만든다. `transactions`는 이미 고른 거래(빈 배열이면 throw), `daily`는 `dates`의 날마다(거래 없는 날 0). 카테고리·가맹점 집계와 정렬·Top 5 규칙은 지금 `buildSnapshot`과 똑같다. `buildSnapshot`은 그 달 거래를 골라 `buildPeriodSnapshot(그 달 거래, datesOfMonth(month))`에 `month`·`inProgress`를 붙이도록 바꾼다. **`buildSnapshot`의 결과는 한 글자도 바뀌면 안 된다**(기존 `snapshot.test.ts`가 고치지 않고 통과해야 한다).

### 3. 카테고리 변화 (`src/lib/analytics/comparison.ts`)

- 지금 내부 함수 `buildCategoryChanges`를 export하고, 인자를 `Pick<PeriodSnapshot, "categories"> | undefined` 두 개로 넓힌다. 동작(차이 0 제외, |차이| 큰 순, 같으면 고정 카테고리 순서)과 `buildTrend` 결과는 바뀌지 않는다.

### 4. 카드 탭 DTO (`src/types/dashboard.ts`, `src/lib/analytics/dashboard.ts`)

타입(이름·필드를 이대로 쓴다):
```ts
export type CardStatementOption = { statementDate: IsoDate; cyclePeriod: Period };
export type StatementComparison = { previousStatementDate: IsoDate; previousTotal: number; diff: number };

export type CardMonthView = {
  basis: "month";
  month: YearMonth;            // 선택된 달
  months: MonthOption[];       // 이 카드 거래가 있는 달, 최신순
  lastDate: IsoDate;           // 이 카드 거래의 마지막 이용일
  snapshot: Snapshot;
  mom: MonthOverMonth | null;
  partialMonth: YearMonth | null;
};
export type CardStatementView = {
  basis: "cycle";
  statementDate: IsoDate;               // 선택된 명세서의 결제일
  statements: CardStatementOption[];    // 이 카드 명세서, 결제일 최신순
  cyclePeriod: Period;                  // 선택된 명세서의 이용 기간
  complete: boolean;                    // 이용 기간이 끝난 뒤 저장한 명세서
  snapshot: PeriodSnapshot;             // 이 명세서 거래
  comparison: StatementComparison | null;
  comparisonSkipped: boolean;           // 바로 전 달 명세서는 있지만 둘 중 하나가 완료 전이라 비교하지 않음
};
type CardDashboardBase = { card: CardOption } & (CardMonthView | CardStatementView);
export type FreeCardDashboard = CardDashboardBase & { plan: "free" };
export type ProCardDashboard = CardDashboardBase & { plan: "pro"; categoryChanges: CategoryChange[] | null };
export type CardDashboard = FreeCardDashboard | ProCardDashboard;
```

함수(`dashboard.ts`, `buildDashboard` 옆):
```ts
export type BuildCardDashboardInput = {
  card: CardOption;
  transactions: Transaction[];     // 사용자의 모든 거래(이 함수가 card.id로 거른다)
  statements: StatementRecord[];   // 사용자의 모든 명세서 기록
  plan: Plan;
  month?: string;                  // 월별 카드에서만 쓴다
  statement?: string;              // 이용 기간 카드에서만 쓴다
  today: IsoDate;
};
export function buildCardDashboard(input: BuildCardDashboardInput): CardDashboard | null
```
규칙:
- `cardTransactions` = `card.id`가 같은 거래.
- **월별**: `cardTransactions`가 없으면 null. `months = listDataMonths(cardTransactions)`, `month` = 요청한 달이 `months`에 있으면 그 달, 아니면 최근 달. `snapshot = buildSnapshot(cardTransactions, month, today)`, `{ mom, partialMonth } = buildMonthComparison(cardTransactions, month, today)`. Pro `categoryChanges` = `mom === null ? null : buildCategoryChanges(snapshot, 그 카드의 mom.previousMonth 스냅샷)`.
- **이용 기간**: `card.cycleStartDay`가 null이면 throw(DB 제약상 생길 수 없다). `statementTransactions` = `cardTransactions` 중 `statementDate !== null`. 없으면 null(결제일 없는 거래는 이 화면에 없다). 명세서 목록 = 서로 다른 `statementDate`의 결제일 최신순. 선택 = 요청한 `statement`와 정확히 같은 결제일이 있으면 그것, 아니면 최신.
  - `cyclePeriod = statementCyclePeriod(선택 결제일, cycleStartDay)`.
  - 완료: `statements`에서 `cardId`·`statementDate`가 같은 기록의 `savedOn > cyclePeriod.to`. 기록이 없으면 완료가 아니다(조회 사이에 생긴 명세서는 다음 렌더에서 맞춰진다).
  - `snapshot = buildPeriodSnapshot(선택 명세서 거래, datesBetween(min(cyclePeriod.from, 첫 거래일), max(cyclePeriod.to, 마지막 거래일)))`.
  - 이전 명세서 = 이 카드 명세서 중 결제일의 달이 `addMonths(선택 결제일의 달, -1)`인 것(둘 이상이면 가장 늦은 결제일). 없으면 `comparison = null, comparisonSkipped = false`. 있으면 이전 명세서도 같은 방식으로 완료를 판단한다. 둘 다 완료면 `comparison = { previousStatementDate, previousTotal: 이전 명세서 거래 합, diff: 선택 합 − 이전 합 }`, `comparisonSkipped = false`. 아니면 `comparison = null, comparisonSkipped = true`.
  - Pro `categoryChanges` = `comparison === null ? null : buildCategoryChanges(snapshot, 이전 명세서 스냅샷)`.
- **게이팅**: Free 객체는 `categoryChanges` 키를 아예 갖지 않는다. 기존 `buildDashboard`처럼 Free·Pro 객체를 필드를 골라 따로 만든다(Pro 객체를 만든 뒤 지우는 방식 금지).
- `card`는 받은 `CardOption`을 그대로 넣는다(화면 머리에 쓴다).
- `buildDashboard`는 바꾸지 않는다.

### 5. 카드 요약 입력 (`src/types/summary.ts`, `src/lib/analytics/summary-input.ts`)

타입:
```ts
export type CardSummaryComparison = { previousTotal: number; diff: number; direction: "up" | "down" | "same" };
type CardSummaryBase = {
  scope: "month" | "statement";
  period: Period;                 // snapshot.period(반영 기간)
  inProgress: boolean;            // 월별: snapshot.inProgress · 명세서: !complete
  total: number;
  transactionCount: number;
  categories: SummaryCategory[];
  topMerchants: SummaryMerchant[];
  comparison: CardSummaryComparison | null;   // 월별: mom · 명세서: comparison
  comparisonSkipped: boolean;     // 월별: partialMonth !== null · 명세서: comparisonSkipped
};
export type FreeCardSummaryInput = { plan: "free" } & CardSummaryBase;
export type ProCardSummaryInput = { plan: "pro" } & CardSummaryBase & {
  categoryChanges: { category: string; current: number; previous: number; diff: number }[] | null;
};
export type CardSummaryInput = FreeCardSummaryInput | ProCardSummaryInput;
```
함수: `export function buildCardSummaryInput(dashboard: CardDashboard): CardSummaryInput`
- 카테고리·가맹점·direction 변환은 `buildSummaryInput`과 같다(카테고리는 `CATEGORY_LABELS` 이름).
- **넣지 않는 것**: 카드 라벨·카드 id·카드사·분석 기준·시작일·결제일·이용 기간·명세서 목록·달 목록·거래 id·개별 거래 날짜·`otherMerchants`·`daily`. 이유: LLM에 카드 정보를 보내지 않는다(ADR-024, ARCHITECTURE "카드 탭").
- Free 입력에는 `categoryChanges` 키가 없다. Pro는 DTO의 `categoryChanges`를 이름으로 바꿔 넣는다.

### 6. 테스트 (`*.test.ts`)

- `dates.test.ts`: `datesBetween` 같은 날·달 경계·윤년 2/29·from > to.
- `statements.test.ts`: 위 표 8행 전부 + 시작일 31일이 30일까지인 달(4월)·2월 평년.
- `snapshot.test.ts`: 기존 테스트는 그대로 두고 `buildPeriodSnapshot`의 daily 범위·두 달에 걸친 기간·빈 배열 throw를 더한다.
- `dashboard.test.ts`(카드 탭):
  - 월별: 다른 카드 거래가 섞이지 않는다. 요청한 달·없는 달 대체. 이 카드만으로 지난달 비교(다른 카드가 지난달을 덮어도 이 카드가 안 덮으면 `partialMonth`). Pro `categoryChanges`는 mom이 있을 때만.
  - 이용 기간(실제 데이터 모양 fixture: 시작일 12, 9/23 명세서 거래 8/12~9/12, 10/23 명세서 거래 9/12~10/11, 저장일 둘 다 10/14): 10/23 선택 시 `cyclePeriod` 9/12~10/11, `complete` true, 스냅샷은 10/23 거래만(9/12 거래도 결제일로 나뉜다), 9/23 대비 `comparison`(diff 부호 포함), daily 첫날 9/12·마지막 날 10/11. 9/23 선택 시 daily가 8/12~9/12(연회비 날까지 넓힘), 이전 명세서 없음 → `comparison` null·`comparisonSkipped` false.
  - 완료 판단: 10/23 명세서의 `savedOn`이 10/11(= 이용 기간 끝)이면 완료가 아니다(`>` 비교) → `comparisonSkipped` true. 이전 명세서만 완료 전이어도 true. 기록이 없는 명세서도 완료 아님.
  - 바로 전 달이 아니면(8/23·10/23만) 비교하지 않고 `comparisonSkipped` false.
  - 요청한 `statement`가 없는 결제일이면 최신. 결제일이 null인 거래만 있으면 null. 다른 카드 거래가 섞이지 않는다.
  - 게이팅: Free 결과에 `categoryChanges` 키가 없다(`"categoryChanges" in result`가 false). Pro는 비교가 있을 때 배열, 없을 때 null.
  - 기존 `buildDashboard` 테스트는 그대로 통과한다.
- `summary-input.test.ts`(카드): scope·inProgress·comparison·comparisonSkipped 매핑(월별·명세서 각각), Free에 `categoryChanges` 키 없음, `JSON.stringify(입력)`에 카드 라벨·카드 id·결제일 문자열(예: `2026-10-23`)·거래 id가 없다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
test -f src/lib/analytics/statements.ts
test -f src/lib/analytics/statements.test.ts
grep -q 'export function buildCardDashboard' src/lib/analytics/dashboard.ts
grep -q 'export function buildCardSummaryInput' src/lib/analytics/summary-input.ts
grep -q 'export function statementCyclePeriod' src/lib/analytics/statements.ts
grep -q 'export function buildPeriodSnapshot' src/lib/analytics/snapshot.ts
! grep -rnE 'new Date|Date\.now|process\.env|from "@/lib/(queries|store|supabase|summary)|from "@/services' src/lib/analytics --include='*.ts' --exclude='*.test.ts'
! grep -rn 'categoryChanges' src/lib/analytics --include='*.ts' --exclude='*.test.ts' -l | grep -vE '^src/lib/analytics/(dashboard|comparison|summary-input)\.ts$'
test "$(git diff HEAD -- src/lib/analytics/snapshot.test.ts src/lib/analytics/comparison.test.ts src/lib/analytics/dashboard.test.ts src/lib/analytics/summary-input.test.ts | grep '^-[^-]' | grep -vc '^-import ')" -eq 0   # 기존 테스트 줄을 지우거나 고치지 않음(추가와 import 줄 수정만)
git diff --quiet HEAD -- supabase/ src/app src/components src/lib/queries src/lib/store src/lib/summary src/services
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 순수 레이어가 I/O·`Date`·env 없이 문자열 날짜만 쓰는가?
   - Free/Pro 차이(`categoryChanges`)가 `lib/analytics/dashboard.ts`의 `buildCardDashboard`에서만 갈리는가? (CLAUDE.md CRITICAL)
   - 카드 요약 입력에 카드 정보·결제일·거래 id가 없는가?
   - `buildSnapshot`·`buildTrend`·`buildDashboard`의 결과가 바뀌지 않았는가(기존 테스트 무수정 통과)?
3. 결과에 따라 `phases/12-card-views/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 새 함수(`datesBetween`, `statementCyclePeriod`, `buildPeriodSnapshot`, export한 `buildCategoryChanges`, `buildCardDashboard`, `buildCardSummaryInput`)와 파일, 새 타입 이름(`PeriodSnapshot`, `CardDashboard`/`CardMonthView`/`CardStatementView`, `CardSummaryInput`)을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 거래를 이용 기간 날짜로 다시 묶지 마라. 명세서는 거래의 `statementDate`로만 묶는다. 이유: 실제 9월 명세서에 이용 기간 밖(9/12) 연회비가 있다(ADR-023·024).
- 카드 탭 DTO에 탐지(`findings`·`teaser`)나 추세(`trend`)를 넣지 마라. 이유: 카드 탭에는 없다(ADR-024).
- `buildDashboard`의 시그니처·결과를 바꾸지 마라. 이유: 전체 탭과 데모가 그대로 써야 한다.
- 기존 테스트 파일의 단언을 고치지 마라(새 테스트 추가만). 이유: 이 step은 기존 결과를 바꾸지 않는 일반화다.
- `lib/analytics`에서 `Date` 객체·`Date.now()`·env·I/O를 쓰지 마라. 이유: 순수 레이어 규칙(CLAUDE.md).
- `components/`·`app/`·`lib/summary`·`services/`를 고치지 마라. 이유: 다음 step에서 한다.
- 기존 테스트를 깨뜨리지 마라
