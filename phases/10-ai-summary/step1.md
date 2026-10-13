# Step 1: summary-input

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("플랜별 기능" 표와 그 아래 규칙)
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "패턴"의 Free/Pro 게이팅, "월 요약", "보안"의 LLM 항목)
- `/docs/ADR.md` (ADR-005, ADR-011)
- 기존 코드: `/src/types/dashboard.ts`(`Dashboard` 유니온·`Snapshot`·`MonthOverMonth`·`Findings`·`Trend`), `/src/types/category.ts`(`CATEGORY_LABELS`), `/src/types/transaction.ts`, `/src/lib/analytics/dashboard.ts`(`buildDashboard`)와 테스트, `/src/lib/analytics/comparison.ts`, `/src/lib/analytics/detection.ts`, `/src/lib/demo/fixture.ts`(`DEMO_TRANSACTIONS`·`DEMO_TODAY`)
- 이전 step 산출물: `/supabase/migrations/20261016000000_ai_summaries.sql`(참고만. 이 step은 DB를 쓰지 않는다)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

AI 월간 요약의 LLM 입력을 대시보드 DTO에서 만드는 순수 함수를 만든다.

- Free/Pro 게이팅은 `buildDashboard`의 DTO 유니온 한 곳에서 한다. 요약 입력도 **그 DTO만** 입력으로 받는다(AGENTS.md CRITICAL, ADR-011). Free 입력에는 탐지 상세·추세가 들어갈 수 없다.
- LLM에는 가맹점명과 월 집계만 보낸다(AGENTS.md CRITICAL). 그래서 거래 id·카드 라벨·개별 거래 날짜·일별 금액은 넣지 않는다.
- 이 입력의 `JSON.stringify` 결과는 다음 step에서 해시가 된다. 같은 DTO면 항상 같은 문자열이어야 하므로 키 순서와 배열 순서를 고정한다.
- 순수 레이어(`lib/analytics`)는 I/O·`Date.now()`·env·`node:crypto`를 쓰지 않는다. 해시는 이 step에서 만들지 않는다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 타입 `src/types/summary.ts`

```ts
import type { FindingKind, KindSummary, Period } from "./dashboard";
import type { YearMonth } from "./transaction";

export type SummaryCategory = { category: string; amount: number; ratio: number | null };       // category는 한글 라벨
export type SummaryMerchant = { merchant: string; category: string; amount: number; count: number };
export type SummaryMonthOverMonth = {
  previousMonth: YearMonth; previousTotal: number; diff: number; direction: "up" | "down" | "same";
};
export type SummaryCandidates = {
  recurring: KindSummary; duplicate: KindSummary; large: KindSummary; candidateTotal: number;
};
type SummaryBase = {
  month: YearMonth;
  inProgress: boolean;
  period: Period;
  total: number;
  transactionCount: number;
  categories: SummaryCategory[];
  topMerchants: SummaryMerchant[];
  monthOverMonth: SummaryMonthOverMonth | null;
  candidates: SummaryCandidates;
};
export type FreeSummaryInput = { plan: "free" } & SummaryBase;
export type SummaryFinding = {
  kind: FindingKind; merchant: string; category: string; amount: number;
  transactionCount: number; seriesMonthCount: number | null;
};
export type SummaryTrend = {
  months: { month: YearMonth; total: number; inProgress: boolean }[];
  categoryChanges: { category: string; current: number; previous: number; diff: number }[] | null;
};
export type ProSummaryInput = { plan: "pro" } & SummaryBase & {
  findings: SummaryFinding[];
  trend: SummaryTrend | null;
};
export type SummaryInput = FreeSummaryInput | ProSummaryInput;
```

### 2. 순수 함수 `src/lib/analytics/summary-input.ts`

```ts
export function buildSummaryInput(dashboard: Dashboard): SummaryInput
```
- 객체는 **위 타입에 적힌 키 순서 그대로** 만든다: `plan, month, inProgress, period, total, transactionCount, categories, topMerchants, monthOverMonth, candidates`, Pro는 그 뒤에 `findings, trend`. 하위 객체도 타입의 키 순서를 따른다. 이유: 다음 step이 `JSON.stringify` 결과로 해시를 만든다.
- 값 매핑:
  - `month` = `dashboard.month`. `inProgress`·`period`·`total`·`transactionCount` = `dashboard.snapshot`의 같은 필드.
  - `categories` = `snapshot.categories`를 순서대로, `category`는 `CATEGORY_LABELS[id]`.
  - `topMerchants` = `snapshot.topMerchants`를 순서대로 `{ merchant, category: 라벨, amount, count }`. `merchantKey`와 `otherMerchants`는 넣지 않는다.
  - `monthOverMonth` = `dashboard.mom`이 null이면 null, 아니면 `{ previousMonth, previousTotal, diff, direction }`이고 `direction`은 `diff > 0 → "up"`, `diff < 0 → "down"`, `0 → "same"`.
  - `candidates` = Free는 `dashboard.teaser`, Pro는 `dashboard.findings`의 `byKind.recurring`·`byKind.duplicate`·`byKind.large`(각 `{ count, amount }`)와 `candidateTotal`.
  - Pro `findings` = `dashboard.findings.items`를 순서대로 `{ kind, merchant, category: 라벨, amount, transactionCount: transactions.length, seriesMonthCount: recurring이면 seriesMonths.length, 아니면 null }`. 거래 id·날짜·카드 라벨·`merchantKey`는 넣지 않는다.
  - Pro `trend` = `dashboard.trend`가 null이면 null, 아니면 `months`는 `{ month, total, inProgress }` 그대로, `categoryChanges`는 null이면 null, 아니면 `category`를 라벨로 바꾼 `{ category, current, previous, diff }`.
- Free 분기는 `FreeDashboard`의 필드만 읽는다. `trendAvailable`·`months`·`lastDate`는 넣지 않는다.
- `dashboard.plan`으로 분기하고 다른 값으로 플랜을 정하지 않는다.

### 3. 테스트 `src/lib/analytics/summary-input.test.ts` (먼저 작성)

`buildDashboard({ transactions: DEMO_TRANSACTIONS, plan, month: "2026-09", today: DEMO_TODAY })`로 Free·Pro DTO를 만들고 확인한다. 필요하면 작은 거래 배열을 직접 만들어 쓴다.
- Free: `Object.keys(input)`가 정확히 `["plan","month","inProgress","period","total","transactionCount","categories","topMerchants","monthOverMonth","candidates"]`. `"findings"`·`"trend"` 키가 없다.
- Free: `JSON.stringify(input)`에 Pro DTO의 모든 `findings.items[].transactions[].id`와 모든 거래의 `cardLabel`이 들어 있지 않다. `"seriesMonthCount"`·`"merchantKey"` 문자열도 없다.
- Pro: 키 순서가 Free 키 뒤에 `"findings","trend"`. `findings[i]`의 키가 정확히 `["kind","merchant","category","amount","transactionCount","seriesMonthCount"]`이고, `transactionCount`·`seriesMonthCount`가 DTO에서 센 값과 같다(recurring 아닌 것은 null). `JSON.stringify(input)`에 거래 id·`cardLabel`이 없다.
- 같은 거래로 만든 Free·Pro 입력에서 `plan`·`findings`·`trend`를 뺀 나머지가 deep equal이다.
- `category` 값이 한글 라벨이다(예: `CATEGORY_LABELS.subscription`). `categories`·`topMerchants`·`findings`·`trend.months` 순서가 DTO와 같다.
- `direction`: diff 양수 → up, 음수 → down, 0 → same. `mom`이 null이면 `monthOverMonth`가 null. Pro `trend`가 null이면 null.
- 결정성: 같은 거래로 `buildDashboard`를 두 번 불러 만든 두 입력의 `JSON.stringify`가 같다.
- 카테고리 하나를 바꾼 거래로 만든 입력의 `JSON.stringify`는 달라진다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과
test -f src/types/summary.ts && test -f src/lib/analytics/summary-input.ts && test -f src/lib/analytics/summary-input.test.ts
! grep -nE "node:crypto|Date\.now|new Date|process\.env|server-only|@/lib/supabase|@/services" src/lib/analytics/summary-input.ts
! grep -nE "cardLabel|\.id\b|merchantKey|otherMerchants|daily" src/lib/analytics/summary-input.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - Free 입력이 Free DTO 필드만으로 만들어지고 탐지 상세·추세가 없는가? (AGENTS.md CRITICAL, ADR-011)
   - 거래 id·카드 라벨·개별 거래 날짜·일별 금액이 입력에 없는가? (AGENTS.md CRITICAL "LLM에는 가맹점명, 월 집계")
   - `lib/analytics`가 순수 레이어 규칙을 지키는가?
3. 결과에 따라 `phases/10-ai-summary/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `buildSummaryInput` 시그니처, `src/types/summary.ts`의 타입 이름과 Free·Pro 키 순서, 제외한 필드, 테스트 수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `buildDashboard`·`Dashboard` 타입·탐지·추세 계산을 바꾸지 마라. 이유: 이 step은 이미 만든 DTO를 읽기만 한다.
- 입력에서 금액·건수·비율을 다시 계산하거나 반올림하지 마라. 이유: 숫자는 DTO가 이미 코드로 계산한 값을 그대로 쓴다(AGENTS.md CRITICAL).
- 해시·LLM 호출·DB 조회를 이 파일에 넣지 마라. 이유: 순수 레이어다. 해시는 step 3의 `lib/summary`가 만든다.
- 요약 입력에 `otherMerchants`·`daily`·`months`(월 선택 목록)·`lastDate`를 넣지 마라. 이유: 요약에 필요하지 않고 입력이 커진다.
- `supabase` 명령과 `scripts/pgtap.sh`를 실행하지 마라.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
