# Step 4: insight-input

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("월 요약", "카드 탭"의 3기간 흐름)
- `/docs/ADR.md` (ADR-011, ADR-022, ADR-024, **ADR-025**의 2·3·4번)
- `/docs/PRD.md` ("플랜별 기능"의 AI 요약·카드 요약·팁 피드백 문단)
- 순수 분석: `/src/lib/analytics/dashboard.ts`(`buildCardDashboard`, `statementIsComplete`), `/src/lib/analytics/comparison.ts`(`buildMonthComparison`, `buildCategoryChanges`), `/src/lib/analytics/snapshot.ts`, `/src/lib/analytics/statements.ts`, `/src/lib/analytics/dates.ts`, `/src/lib/analytics/summary-input.ts`와 각 `.test.ts`
- 타입: `/src/types/dashboard.ts`, `/src/types/summary.ts`, `/src/types/category.ts`
- step 2 산출물: `/src/types/summary.ts`(`SummaryFeedback`), `/src/lib/queries/summary-feedback.ts`(`listSummaryFeedback`)
- step 3 산출물: `/src/lib/analytics/cancellations.ts`, 스냅샷의 `cancelCount`
- 요약 조율: `/src/lib/summary/monthly-summary.ts`(`prepareSummary`), `/src/lib/summary/card-summary.ts`(`prepareCardSummary`)와 `.test.ts`
- 페이지: `/src/app/dashboard/page.tsx`, `/src/app/dashboard/page.test.tsx`(모듈 mock 방식), `/src/app/dashboard/monthly-summary-section.test.tsx`, `/src/app/dashboard/card-summary-section.test.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

요약 입력을 개인화한다(ADR-025). 프롬프트는 step 5에서 바꾸므로, 이 step은 입력 JSON에 새 값을 넣는 일까지만 한다.

1. **카테고리별 최다 가맹점**: 입력 `categories[i]`마다 그 카테고리에서 가장 많이 쓴 가맹점(이름·금액·건수)을 붙인다. 팁이 "마트·생활에 N원을 썼고, 그중 가장 많이 쓴 곳은 ○○예요"처럼 쓰게 하기 위해서다.
2. **팁 피드백**: 입력 `categories[i]`마다 사용자가 그 카테고리에 남긴 피드백(없으면 null)을 붙인다. 피드백은 DTO 밖에서 들어가는 유일한 입력이다(사용자가 쓴 글이라 플랜 게이팅과 무관하다). 입력 해시에 들어가므로 피드백을 저장하면 요약이 다시 만들어진다.
3. **카드 3기간 흐름**: 카드 탭 DTO와 카드 요약 입력에, 지금 기간과 바로 앞 두 기간이 이어지고 비교 조건을 모두 지킬 때만 세 기간의 총액과 흐름 라벨을 넣는다. Free는 총액 흐름, Pro는 카테고리별 흐름까지. 흐름은 화면에 그리지 않는다.

## 작업

### 1. 흐름 라벨 (`src/lib/analytics/flow.ts`, 새 파일, 순수)

```ts
export const FLOW_STEADY_RATIO = 0.1;
export const FLOW_CATEGORY_LIMIT = 5;
// 오래된 순 금액의 흐름. 이웃한 두 값의 차이가 둘 중 큰 절댓값의 10% 이하면 "비슷한 걸음"이다.
export function flowDirection(values: readonly number[]): FlowDirection
```
- 이웃한 값 a → b마다: `|b − a| <= FLOW_STEADY_RATIO * max(|a|, |b|)`면 비슷, 아니면 b > a면 늘어남, b < a면 줄어듦.
- 모든 걸음이 비슷 → `"steady"`, 모두 늘어남 → `"rising"`, 모두 줄어듦 → `"falling"`, 그 밖(늘었다 줄어듦, 비슷 + 늘어남 등) → `"mixed"`.
- 값이 2개 미만이면 throw한다(호출하는 쪽은 늘 3개를 넘긴다).

### 2. 타입 (`src/types/dashboard.ts`)

```ts
export type FlowDirection = "rising" | "falling" | "steady" | "mixed";
// 월별 카드는 그 달, 이용 기간 카드는 명세서 결제일의 달
export type FlowPeriod = { month: YearMonth; total: number };
export type CardFlow = { periods: FlowPeriod[]; direction: FlowDirection };   // periods는 오래된 순 3개
export type CategoryFlow = { category: CategoryId; direction: FlowDirection; amounts: number[] }; // periods와 같은 순서
```
- `FreeCardDashboard`에 `flow: CardFlow | null`, `ProCardDashboard`에 `flow: (CardFlow & { categories: CategoryFlow[] }) | null`.

### 3. 카드 DTO의 흐름 (`src/lib/analytics/dashboard.ts`의 `buildCardDashboard`)

- **월별 카드**: 선택한 달 `m`의 `mom`이 있고, `buildMonthComparison(cardTransactions, mom.previousMonth, today).mom`도 있을 때만 만든다. 세 기간은 `[전전달, 지난달, m]`이고 총액은 각 달의 `buildSnapshot(...).total`이다.
- **이용 기간 카드**: `comparison`이 있고(선택한 명세서와 바로 전 달 명세서가 모두 완료), 바로 전 달 명세서 결제일의 달보다 한 달 앞선 달에 결제일이 있는 명세서(그 달에 여럿이면 가장 늦은 결제일, 지금 `previousStatementDate`를 고르는 방식과 같다)가 있고 `statementIsComplete`일 때만 만든다. 세 기간의 `month`는 각 명세서 결제일의 달이고 총액은 각 명세서 거래의 `buildPeriodSnapshot(..., []).total`이다.
- 조건이 하나라도 안 맞으면 `flow: null`.
- `direction = flowDirection(세 총액)`.
- Pro만 `categories`: 이번 기간 스냅샷의 `categories` 중 금액이 양수이고 `etc`가 아닌 것을 금액순 그대로 `FLOW_CATEGORY_LIMIT`개까지. `amounts`는 세 기간 스냅샷에서 그 카테고리 금액(없으면 0), `direction = flowDirection(amounts)`.
- **Free DTO의 `flow`에는 `categories` 키 자체가 없어야 한다**(Free용 객체를 따로 만든다). 이유: Free DTO에 카테고리 변화를 넣지 않는다(CLAUDE.md CRITICAL).
- 전체 탭 `buildDashboard`는 바꾸지 마라.

### 4. 요약 입력 (`src/lib/analytics/summary-input.ts`, `src/types/summary.ts`)

```ts
export function buildSummaryInput(dashboard: Dashboard, feedback: SummaryFeedback): SummaryInput
export function buildCardSummaryInput(dashboard: CardDashboard, feedback: SummaryFeedback): CardSummaryInput
```
- `SummaryCategory`를 바꾼다:
  ```ts
  export type SummaryCategory = {
    category: string; amount: number; ratio: number | null;
    topMerchant: { merchant: string; amount: number; count: number } | null;
    feedback: string | null;
  };
  ```
  - `topMerchant`: 스냅샷의 `[...topMerchants, ...otherMerchants]`에서 그 카테고리 id이고 금액이 양수인 첫 가맹점(두 목록을 이으면 금액순이다). 없으면 null. `count`는 스냅샷의 가맹점 건수(취소 짝을 뺀 값) 그대로.
  - `feedback`: `feedback[카테고리 id] ?? null`.
  - 월 요약·카드 요약 모두 같은 규칙.
- 카드 요약 입력의 흐름:
  ```ts
  export type SummaryFlow = { direction: FlowDirection; periods: { month: YearMonth; total: number }[] };
  export type SummaryCategoryFlow = {
    category: string;  // 카테고리 이름
    direction: FlowDirection;
    periods: { month: YearMonth; amount: number }[];  // 흐름의 periods와 같은 달·순서
  };
  ```
  - `FreeCardSummaryInput`에 `flow: SummaryFlow | null`, `ProCardSummaryInput`에 `flow: (SummaryFlow & { categories: SummaryCategoryFlow[] }) | null`. DTO의 `flow`를 그대로 옮기되 카테고리는 이름으로, `amounts`는 `periods[i].month`와 짝지은 `{ month, amount }`로 바꾼다.
  - 이 모양을 지켜라. 이유: step 5의 자리표시자 `{flow.periods[0].total}`·`{flow.categories[0].periods[1].amount}`가 배열 항목의 `month`(→ "N월")와 `category` 이름으로 검증된다.
- 입력에 카드 라벨·카드사·결제일·거래 id·개별 거래 날짜를 넣지 마라(지금처럼).

### 5. 조율·페이지 (`src/lib/summary/*.ts`, `src/app/dashboard/page.tsx`)

- `prepareSummary(dashboard, summarizer, feedback: SummaryFeedback)`, `prepareCardSummary(dashboard, summarizer, feedback: SummaryFeedback)`로 바꾸고 입력 생성에 넘긴다. 해시 규칙(`sha256(JSON.stringify({ model, prompt, input }))`)은 그대로라 피드백이 바뀌면 해시가 바뀐다.
- `page.tsx`: 첫 `Promise.all`에 `listSummaryFeedback(supabase, user.id)`를 더하고, 그 결과를 `prepareSummary`·`prepareCardSummary`에 넘긴다. 다른 동작은 바꾸지 마라(피드백을 화면에 넘기는 일은 step 6).
- `page.test.tsx`는 `@/lib/queries/summary-feedback`을 다른 조회처럼 mock하고, 피드백이 준비 함수에 넘어가는지 단언을 하나 더한다.

### 6. 테스트

- `flow.test.ts`: `[100,120,150]` rising, `[150,120,100]` falling, `[100,105,98]` steady, `[100,150,120]` mixed, `[100,100,150]` mixed, `[0,0,0]` steady, 경계(`[100,110]`은 차이 10 ≤ 11이라 steady, `[100,112]`는 rising), 음수 포함 값도 절댓값 기준, 값 1개면 throw.
- `dashboard.test.ts`:
  - 월별 카드: 세 달이 모두 덮이면(ADR-022) `flow`의 periods·direction, 두 달만 있으면 null, 가운데 달이 일부만 있으면(지난달·전전달 비교가 partial) null, 진행 중인 달 선택 시 null.
  - 이용 기간 카드: 완료 명세서 세 장이 이어지면 flow(달은 결제일의 달), 전전 명세서가 미완료거나 없거나 한 달이 비면 null.
  - Pro `categories`: etc 제외, 금액순 5개까지, 앞 기간에 없는 카테고리는 0. Free DTO의 `flow`에 `categories` 키가 없다(`"categories" in flow`가 false), Free DTO JSON에 카테고리 흐름 값이 없다.
- `summary-input.test.ts`: `topMerchant`(가장 큰 양수 가맹점, `otherMerchants`에 있는 경우, 환불만 있으면 null), `feedback` 붙임(없는 카테고리는 null, 입력에 없는 카테고리의 피드백은 들어가지 않음), 카드 입력 흐름 변환, Free 카드 입력 JSON에 카테고리 흐름이 없음, 입력 JSON에 카드 라벨·카드사가 없음.
- `monthly-summary.test.ts`·`card-summary.test.ts`: 피드백이 바뀌면 입력 해시가 바뀌고, 같으면 같다.
- 기존 테스트의 `buildSummaryInput(dto)`·`prepareSummary(dto, summarizer)` 호출은 `{}`(피드백 없음)를 넘기도록 고친다.
- `src/services`·`src/components`의 테스트가 요약 입력·DTO를 직접 만드는 곳은 타입 오류를 없애는 만큼만 새 필드(`topMerchant: null`, `feedback: null`, `flow: null`)를 더한다. 그 폴더의 테스트 아닌 코드는 바꾸지 마라.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
test -f src/lib/analytics/flow.ts
grep -q 'export function flowDirection' src/lib/analytics/flow.ts
grep -q 'FLOW_STEADY_RATIO = 0.1' src/lib/analytics/flow.ts
grep -q 'export type FlowDirection' src/types/dashboard.ts
grep -q 'topMerchant' src/types/summary.ts
grep -q 'feedback: SummaryFeedback' src/lib/analytics/summary-input.ts
grep -q 'listSummaryFeedback' src/app/dashboard/page.tsx
! grep -nE 'Date\.now|new Date|process\.env' src/lib/analytics/flow.ts src/lib/analytics/summary-input.ts
git diff --quiet HEAD -- supabase/ src/lib/queries src/lib/store src/app/api src/app/dashboard/monthly-summary-section.tsx src/app/dashboard/card-summary-section.tsx
test "$(git diff HEAD --name-only -- src/services src/components | grep -Evc '\.test\.tsx?$')" -eq 0
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - Free/Pro 차이가 `buildCardDashboard` DTO에서만 오고, Free DTO·Free 입력에 카테고리 흐름이 없는가? (CLAUDE.md CRITICAL)
   - 요약 입력에 카드 라벨·카드사·결제일·거래 id가 없는가? 피드백 말고 DTO 밖 값이 들어가지 않았는가?
   - 순수 레이어가 `today` 인자만 쓰는가?
   - 이 step에서 프롬프트·검증 코드가 바뀌지 않았는가(`src/services` 무변경)?
3. 결과에 따라 `phases/13-insight-personalization/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `flowDirection` 규칙, DTO `flow` 조건(월별·이용 기간)과 Free/Pro 모양, 입력의 `topMerchant`·`feedback`·`flow` 경로, `prepare*`의 새 인자, 페이지의 피드백 조회를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 흐름을 화면 컴포넌트에 넘기거나 그리지 마라. 이유: 흐름은 요약의 비교 문단에만 쓴다(ADR-025).
- 흐름 라벨을 LLM이 정하게 하거나 10% 기준을 바꾸지 마라. 이유: 방향은 코드가 정한다(ADR-025).
- 전체 탭(`buildDashboard`·`buildSummaryInput`의 Pro 추세)에 3기간 흐름을 더하지 마라. 이유: 카드 요약만의 결정이다. Pro 전체 탭은 이미 추세가 있다.
- 피드백을 DTO(`Dashboard`·`CardDashboard`)에 넣지 마라. 이유: DTO는 플랜 게이팅 경계이고, 피드백은 요약 입력에만 들어간다.
- 프롬프트·검증(`src/services/llm`)을 고치지 마라. 이유: step 5에서 한다.
- 기존 테스트를 깨뜨리지 마라
