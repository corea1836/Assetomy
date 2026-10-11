# Step 0: domain-types

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("플랜별 기능", "카테고리" 절)
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "패턴" 절)
- `/docs/ADR.md` (ADR-010, ADR-011, ADR-017)
- 기존 설정: `/package.json`, `/tsconfig.json`, `/vitest.config.ts`, `/eslint.config.mjs`

이전 phase(0-foundation)에서 Next.js 16 · Vitest(`.test.ts`=node, `.test.tsx`=jsdom) · `lib/env.ts`·`mode.ts`·`origin.ts`가 만들어졌다. 이 phase(1-analytics)는 대시보드 숫자를 만드는 **순수 레이어** `src/lib/analytics/`를 만든다.

## 작업

이 step은 analytics 전체가 공유하는 **도메인 타입**과 **날짜 문자열 유틸**을 만든다. 아래 타입은 이후 컴포넌트·DB 레이어와의 계약이므로 이름·필드를 그대로 쓴다.

구현 파일보다 테스트 파일을 먼저 만든다. 이유: TDD guard hook이 같은 폴더에 테스트 파일이 없는 구현 파일 작성을 막는다(`src/types/`는 예외).

### 1. `src/types/category.ts`
```ts
export const CATEGORY_IDS = [
  'food', 'cafe', 'delivery', 'transport', 'shopping', 'grocery', 'subscription',
  'housing', 'health', 'culture', 'travel', 'education', 'finance', 'etc',
] as const
export type CategoryId = (typeof CATEGORY_IDS)[number]
export const CATEGORY_LABELS: Record<CategoryId, string>
```
라벨은 순서대로 `식비, 카페·간식, 배달, 교통, 쇼핑, 마트·생활, 구독·정기결제, 주거·통신, 의료·건강, 문화·여가, 여행·숙박, 교육, 금융·보험, 기타`다. `CATEGORY_IDS`의 순서는 정렬 동점 처리에도 쓰인다.

### 2. `src/types/transaction.ts`
```ts
export type IsoDate = string   // 'YYYY-MM-DD'
export type YearMonth = string // 'YYYY-MM'

export type Transaction = {
  id: string
  cardId: string
  cardLabel: string      // 사용자가 붙인 카드 이름
  date: IsoDate          // 이용일
  merchant: string       // 표시용 가맹점명
  merchantKey: string    // 정규화 가맹점명. 그룹핑·카테고리 수정의 단위
  amount: number         // 원 단위 안전한 정수. 지출 양수, 취소·환불 음수
  category: CategoryId
}
```

### 3. `src/types/dashboard.ts` — 대시보드 DTO
```ts
export type Plan = 'free' | 'pro'
export type Period = { from: IsoDate; to: IsoDate }
export type MonthOption = { month: YearMonth; period: Period }

export type CategoryAmount = { category: CategoryId; amount: number; ratio: number | null }
export type MerchantAmount = {
  merchantKey: string; merchant: string; category: CategoryId; amount: number; count: number
}
export type DailyAmount = { date: IsoDate; amount: number }

export type Snapshot = {
  month: YearMonth
  period: Period              // 그 달 거래의 첫·마지막 이용일(반영 기간)
  total: number               // 그 달 거래 금액 합(취소·환불 포함)
  transactionCount: number
  inProgress: boolean         // 진행 중인 달
  categories: CategoryAmount[]
  topMerchants: MerchantAmount[]
  daily: DailyAmount[]        // 그 달 1일~말일, 거래 없는 날은 0
}

export type MonthOverMonth = { previousMonth: YearMonth; previousTotal: number; diff: number }

export type FindingKind = 'recurring' | 'duplicate' | 'large'
export type KindSummary = { count: number; amount: number }
export type FindingSummary = { byKind: Record<FindingKind, KindSummary>; candidateTotal: number }
export type Teaser = FindingSummary

export type FindingTransaction = { id: string; date: IsoDate; amount: number; cardLabel: string }
type FindingBase = {
  merchantKey: string; merchant: string; category: CategoryId
  amount: number                       // transactions의 amount 합
  transactions: FindingTransaction[]
}
export type Finding =
  | (FindingBase & { kind: 'recurring'; seriesMonths: YearMonth[] })
  | (FindingBase & { kind: 'duplicate' | 'large' })
export type Findings = FindingSummary & { items: Finding[] }

export type TrendMonth = { month: YearMonth; total: number; inProgress: boolean }
export type CategoryChange = { category: CategoryId; current: number; previous: number; diff: number }
export type Trend = { months: TrendMonth[]; categoryChanges: CategoryChange[] | null }

type DashboardBase = {
  month: YearMonth            // 선택된 달
  months: MonthOption[]       // 거래가 있는 달, 최신순
  lastDate: IsoDate           // 전체 거래의 마지막 이용일
  snapshot: Snapshot
  mom: MonthOverMonth | null
}
export type FreeDashboard = DashboardBase & { plan: 'free'; teaser: Teaser; trendAvailable: boolean }
export type ProDashboard = DashboardBase & { plan: 'pro'; findings: Findings; trend: Trend | null }
export type Dashboard = FreeDashboard | ProDashboard
```
- Free DTO에는 탐지 상세(`items`)·거래 ID·추세가 **구조적으로** 들어갈 수 없게 이 형태를 유지한다. 이유: Server→Client props는 RSC payload로 그대로 노출된다(ADR-011).

### 4. `src/lib/analytics/dates.ts` — 날짜 문자열 유틸
```ts
export function monthOf(date: IsoDate): YearMonth
export function addMonths(month: YearMonth, n: number): YearMonth   // n은 음수 가능
export function daysInMonth(month: YearMonth): number
export function datesOfMonth(month: YearMonth): IsoDate[]          // 1일~말일
export function daysBetween(from: IsoDate, to: IsoDate): number     // to - from (일)
```
- `Date` 객체·`Date.parse`·`Date.UTC`를 쓰지 말고 정수 연산(예: days-from-civil)으로 구현한다. 이유: 순수 레이어는 날짜를 `'YYYY-MM-DD'` 문자열로 다루고 타임존 영향을 받지 않아야 한다.
- 테스트(`src/lib/analytics/dates.test.ts`)를 먼저 쓴다. 최소한 아래를 단언한다.
  - 윤년: `daysInMonth('2024-02') = 29`, `'2025-02' = 28`, `'2000-02' = 29`, `'2100-02' = 28`
  - 연도 경계: `addMonths('2026-01', -1) = '2025-12'`, `addMonths('2025-12', 1) = '2026-01'`, `addMonths('2026-03', -14) = '2025-01'`
  - `daysBetween('2025-12-31', '2026-01-01') = 1`, `daysBetween('2024-02-01', '2024-03-01') = 29`, `daysBetween('2026-03-01', '2026-02-01') = -28`
  - `datesOfMonth('2026-02')`는 28개이고 `'2026-02-01'`로 시작해 `'2026-02-28'`로 끝난다
  - `monthOf('2026-09-15') = '2026-09'`

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # dates.test.ts 포함 전체 통과
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env" src/lib/analytics --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/types/`, `src/lib/analytics/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/1-analytics/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 만든 타입 파일 경로와 `dates.ts`의 export 목록을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 위 타입의 이름·필드를 바꾸거나 필드를 추가하지 마라. 이유: 이후 step과 컴포넌트 phase가 이 형태를 계약으로 쓴다.
- `src/lib/analytics/`에서 I/O, `Date`, `process.env`, `@/lib/supabase`·`@/services` import를 쓰지 마라. 이유: 순수 레이어다.
- 스냅샷·탐지 등 이후 step의 함수를 미리 만들지 마라.
- 기존 테스트를 깨뜨리지 마라
