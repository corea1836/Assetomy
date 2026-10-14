# Step 1: summary-contract

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("월 요약", "카드 탭", "보안"의 LLM 항목)
- `/docs/ADR.md` (ADR-005, **ADR-025**의 3·5·7번)
- step 0 산출물: `/supabase/migrations/20261019000000_insight_personalization.sql`(`tip_categories` 열과 새 `save_ai_summary`·`save_card_summary` 시그니처)
- 요약 타입: `/src/types/summary.ts`, `/src/types/category.ts`(`CATEGORY_IDS`·`CATEGORY_LABELS`)
- 요약 서비스: `/src/services/llm/types.ts`, `/src/services/llm/summary-text.ts`, `/src/services/llm/claude-summarizer.ts`, `/src/services/llm/mock-summarizer.ts`와 각 `.test.ts`
- 요약 조율: `/src/lib/summary/monthly-summary.ts`, `/src/lib/summary/card-summary.ts`, `/src/lib/summary/deps.ts`와 각 `.test.ts`
- 저장·조회: `/src/lib/store/summaries.ts`(+ `.test.ts`, `.db.test.ts`), `/src/lib/queries/summaries.ts`(+ `.test.ts`)
- 화면 쪽 테스트 fixture: `/src/app/dashboard/monthly-summary-section.test.tsx`, `/src/app/dashboard/card-summary-section.test.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

요약의 출력 모양을 바꾼다(ADR-025). 이 step은 **모양과 저장 경로**만 바꾸고, 프롬프트 문장은 바꾸지 않는다(프롬프트는 step 5에서 한 번에 바꾼다).

- LLM은 이제 `{ summary, comparison, tips: [{ category, text }] }`를 낸다. `summary`는 이번 기간 문단, `comparison`은 지난 기간 대비 문단(쓸 것이 없으면 빈 문자열), 팁마다 입력 카테고리 이름이 붙는다.
- 코드는 문단마다 검증하고, 두 문단을 `"\n\n"`으로 이어 하나의 `summary` 문자열로 저장한다. 팁의 카테고리는 이름 → 카테고리 id로 바꿔 팁과 같은 길이의 `tipCategories`로 저장한다(DB 열 `tip_categories`).
- 화면 컴포넌트는 이 step에서 바꾸지 않는다(`tips: string[]`는 그대로라 지금 화면이 계속 그려진다). 팁 카테고리를 쓰는 화면은 step 6에서 만든다.

## 작업

### 1. 타입 (`src/types/summary.ts`)

```ts
// LLM이 structured outputs로 내는 모양. tips[].category는 입력 categories[].category(카테고리 이름) 중 하나다.
export type SummaryDraft = {
  summary: string;     // 이번 기간 문단
  comparison: string;  // 지난 기간 대비 문단. 쓸 것이 없으면 ""
  tips: { category: string; text: string }[];
};
// 검증·자리표시자 채움을 마친 모양. summary는 문단을 "\n\n"으로 이은 것이고 tipCategories는 tips와 같은 길이다.
export type SummaryContent = { summary: string; tips: string[]; tipCategories: CategoryId[] };
```
- `SaveSummaryInput`·`SaveCardSummaryInput`에 `tipCategories: CategoryId[]`를 더한다. `StoredSummary`·`MonthlySummaryView`는 `SummaryContent`를 그대로 쓰므로 함께 바뀐다.

### 2. 검증 (`src/services/llm/summary-text.ts`, `src/services/llm/types.ts`)

- `checkSummaryContent(raw: SummaryDraft, input: SummaryInput | CardSummaryInput): SummaryContentCheck`로 바꾼다. 성공 결과는 `{ ok: true } & SummaryContent`.
- 실패 reason에 `"tip_category"`를 더한다(`SummaryContentCheck`와 `SummaryFailureReason` 둘 다).
- 문단 정리: 각 문단과 팁 문장은 검증 전에 `text.replace(/\s+/g, " ").trim()`으로 공백·줄바꿈을 한 칸으로 줄인다.
- 검사 순서를 지켜라(테스트가 reason을 단언한다):
  1. 팁 개수가 1~5가 아니면 `length`.
  2. `summary` 문단: 지금의 `renderText`로 검증(길이 `SUMMARY_LENGTH` 20~500).
  3. `comparison` 문단: 정리한 값이 `""`이면 건너뛴다. 아니면 `renderText`로 검증하고 길이는 새 상수 `COMPARISON_LENGTH = { min: 5, max: 400 }`.
  4. 팁을 순서대로: `category.trim()`이 `input.categories`의 `category`(이름) 중 하나가 아니거나, 정리한 팁 문장에 그 이름이 들어 있지 않으면 `tip_category`. 통과하면 `renderText`로 검증(길이 `TIP_LENGTH` 10~300).
- 성공하면 `summary = comparison === "" ? 요약 : \`${요약}\n\n${비교}\``, `tips`는 채운 문장, `tipCategories`는 이름을 id로 바꾼 값(`CATEGORY_LABELS`를 뒤집은 표, 모듈 상수로 한 번 만든다).
- 자리표시자 해석·숫자·마크다운·금지 표현 규칙, `FIELD_FORMATS`, 가맹점명 목록은 **바꾸지 마라**(step 5에서 바꾼다).

### 3. Claude 요약 (`src/services/llm/claude-summarizer.ts`)

- structured outputs 스키마를 `z.object({ summary: z.string(), comparison: z.string(), tips: z.array(z.object({ category: z.string(), text: z.string() })) })`로 바꾼다. 월 요약·카드 요약 둘 다 이 스키마를 쓴다.
- `COMMON_SYSTEM`·`FREE_SYSTEM`·`PRO_SYSTEM`·`CARD_FREE_SYSTEM`·`CARD_PRO_SYSTEM` 문자열은 **한 글자도 바꾸지 마라**. 이유: step 5에서 한 번에 바꾸고 sha256 가드도 그때 갱신한다. 이 step에서는 `claude-summarizer.test.ts`의 sha256 가드(`422a5999…`, `5396c81e…`)가 그대로 통과해야 한다.
- 요청 옵션·실패 매핑은 그대로다.

### 4. mock 요약 (`src/services/llm/mock-summarizer.ts`)

- 팁은 입력 카테고리에 붙어야 하므로 고정 문장 대신 입력 카테고리 이름을 넣어 만든다. 규칙:
  - 팁을 붙일 카테고리: `input.categories` 중 이름이 `"기타"`가 아닌 것을 순서대로(없으면 `"기타"`를 포함한 전체). 입력 배열에서의 위치 `i`를 함께 기억한다.
  - 팁 문장 틀(앞에서부터 플랜별 개수만큼, 카테고리가 모자라면 그만큼만):
    1. `` `${name} 지출은 {categories[${i}].amount}이에요. 다음 달 예산을 먼저 정해 보세요.` ``
    2. `` `${name} 지출은 자주 가는 곳부터 한 주에 갈 횟수를 정해 보세요.` ``
    3. `` `${name} 지출이 지난번과 달라졌다면 그 이유를 살펴보세요.` ``
  - 팁 개수: 월 mock Free 3 · Pro 3, 카드 mock Free 2 · Pro 3.
  - `summary`는 지금 mock의 요약 문장 그대로, `comparison`은 `""`(step 5에서 채운다).
  - 만든 `SummaryDraft`를 `checkSummaryContent`로 채워 돌려준다(지금과 같은 방식).
- `promptFor(plan)`은 고정 내용(요약 문장, 팁 문장 틀을 `"<카테고리>"`·`0`으로 채운 문장, 플랜별 팁 개수)의 JSON이다. 입력에 따라 바뀌지 않아야 한다.
- `modelFor`는 그대로 `MOCK_SUMMARY_MODEL`이다.

### 5. 조율 (`src/lib/summary/monthly-summary.ts`, `src/lib/summary/card-summary.ts`)

- 저장 호출에 `tipCategories: result.tipCategories`를 더한다. ready 결과(`{ kind: "ready", summary, tips, tipCategories }`)는 저장된 요약에서도, 새로 만든 요약에서도 `tipCategories`를 담는다.
- 흐름·로그·해시 규칙은 바꾸지 마라.

### 6. 저장·조회 (`src/lib/store/summaries.ts`, `src/lib/queries/summaries.ts`)

- `saveSummary`·`saveCardSummary`의 RPC 인자에 `p_tip_categories: input.tipCategories`를 더한다(step 0의 새 시그니처).
- 저장된 요약 조회는 `tip_categories`도 읽는다. 스키마는 `z.array(z.enum(CATEGORY_IDS)).min(1).max(5)`이고 `tips`와 길이가 다르면 스키마 실패(지금처럼 `QueryError`)다. 결과에 `tipCategories`를 담는다.

### 7. 테스트

- `summary-text.test.ts`: 기존 테스트의 입력을 새 모양(`{ summary, comparison: "", tips: [{ category, text }] }`)으로 바꾼다. 팁 문장에는 그 팁의 카테고리 이름을 넣는다. **어떤 입력이 어떤 reason으로 탈락하는지라는 기존 기대는 바꾸지 마라.** 새 테스트:
  - `comparison`이 `""`면 요약은 한 문단(`"\n\n"` 없음), 있으면 `"요약\n\n비교"`.
  - 문단 안의 줄바꿈·연속 공백이 한 칸으로 저장된다(`"\n\n"`은 문단 사이에만 있다).
  - `comparison`의 숫자·자리표시자·마크다운·금지 표현·길이(5자 미만, 400자 초과) 탈락.
  - `tip_category`: 입력에 없는 카테고리 이름, 문장에 카테고리 이름이 없음, 앞뒤 공백이 있는 이름은 통과. 입력에 `"기타"`가 있으면 `"기타"` 팁도 통과한다.
  - `tipCategories`가 id로 바뀌고 팁 순서와 같다(같은 카테고리가 두 번이면 두 번).
  - 검사 순서: 팁 개수가 6개이고 요약도 틀리면 `length`.
- `claude-summarizer.test.ts`: fake 응답을 새 모양으로 바꾸고, 결과에 `tipCategories`가 있는지 단언한다. 스키마에 맞지 않는 응답(`comparison` 없음)은 `invalid_output`. sha256 가드는 그대로 통과해야 한다.
- `mock-summarizer.test.ts`: 월·카드 mock이 Free·Pro 입력에서 모두 ok이고, 팁마다 카테고리 이름이 들어 있으며 `tipCategories`가 입력 카테고리 id다. `"기타"`만 있는 입력에서도 ok다. 입력 카테고리가 한 개면 팁도 한 개다. `promptFor`가 입력과 무관하다.
- `monthly-summary.test.ts`·`card-summary.test.ts`·`deps.test.ts`: 저장 인자에 `tipCategories`가 있고, ready 결과(저장된 요약·새 요약)에 `tipCategories`가 있다.
- `summaries.test.ts`(store·queries): RPC 인자 `p_tip_categories`, 조회 결과 `tipCategories`, 길이가 다른 행은 실패.
- `summaries.db.test.ts`: 저장 → 조회 왕복에서 `tipCategories`가 그대로 돌아온다. 길이가 다르면 저장이 실패한다(`23514`).
- 화면 쪽 테스트 fixture(`monthly-summary-section.test.tsx`·`card-summary-section.test.tsx` 등)는 타입 오류를 없애는 만큼만 `tipCategories`를 더한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
npm run test:db   # DB 통합 테스트 전체 통과(dev DB에 step 0 마이그레이션이 적용돼 있어야 한다)
grep -q 'export type SummaryDraft' src/types/summary.ts
grep -q 'tipCategories: CategoryId\[\]' src/types/summary.ts
grep -q 'tip_category' src/services/llm/summary-text.ts
grep -q 'COMPARISON_LENGTH' src/services/llm/summary-text.ts
grep -q 'comparison: z.string()' src/services/llm/claude-summarizer.ts
grep -q 'p_tip_categories' src/lib/store/summaries.ts
grep -q 'tip_categories' src/lib/queries/summaries.ts
grep -q '422a5999f7d3039af4750d718a47a1a5f97a0109cacf87b1c703ef64bd682c96' src/services/llm/claude-summarizer.test.ts
grep -q '5396c81eee1cf2b4f203b772986c988cc062fc1d4949f5d45b3ce984ca37a748' src/services/llm/claude-summarizer.test.ts
git diff --quiet HEAD -- supabase/ src/app/dashboard/page.tsx src/app/dashboard/monthly-summary-section.tsx src/app/dashboard/card-summary-section.tsx
test "$(git diff HEAD --name-only -- src/components src/lib/analytics | grep -Evc '\.test\.tsx?$')" -eq 0
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
   - `npm run test:db`가 `tip_categories` 열이나 새 RPC 시그니처가 없다는 오류(예: `42703`, `PGRST202`, "Could not find the function")로 실패하면 코드 문제가 아니라 dev DB에 step 0 마이그레이션이 아직 적용되지 않은 것이다. 이때는 고치려 하지 말고 `"status": "blocked"`, `"blocked_reason": "dev DB에 20261019000000_insight_personalization 마이그레이션이 적용되지 않아 test:db를 돌릴 수 없음(push 필요)"`로 멈춘다.
2. `git diff HEAD -- src/services/llm/claude-summarizer.ts`에서 `*_SYSTEM` 문자열 줄이 바뀌지 않았는지 확인한다.
3. 아키텍처 체크리스트를 확인한다:
   - 요약의 숫자는 여전히 자리표시자로만 받고 코드가 채우며, 검증을 통과하지 못하면 결과 전체를 버리는가? (ADR-005)
   - 팁 카테고리는 입력 카테고리에서만 오고 id로 저장되는가? (ADR-025)
   - 로그에 코드와 id만 남기는가? `services/`가 `import "server-only"`를 유지하는가?
4. 결과에 따라 `phases/13-insight-personalization/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `SummaryDraft`·`SummaryContent.tipCategories`, `checkSummaryContent`의 검사 순서와 새 reason, `COMPARISON_LENGTH`, structured outputs 스키마, mock 팁 규칙, 저장·조회의 `tip_categories`를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 프롬프트 상수(`*_SYSTEM`)를 바꾸지 마라. 이유: step 5에서 입력이 다 갖춰진 뒤 한 번에 바꾼다.
- `FIELD_FORMATS`·자리표시자 이름 규칙·금지 표현·`SUMMARY_LENGTH`·`TIP_LENGTH`·팁 개수 규칙을 바꾸지 마라. 이유: 이 step은 출력 모양과 저장 경로만 다룬다.
- 화면 컴포넌트(`src/components/`)와 `page.tsx`·요약 section 컴포넌트를 고치지 마라. 이유: 팁 카테고리를 쓰는 화면은 step 6에서 만든다.
- 팁 카테고리를 LLM 출력의 이름 그대로(한글) 저장하지 마라. 이유: DB는 카테고리 id만 받는다(step 0 check 제약).
- 실제 Anthropic API를 테스트에서 부르지 마라. 이유: 단위 테스트는 fake 클라이언트·mock으로 한다.
- 로그에 요약·팁 문장, LLM 응답을 남기지 마라. 이유: CLAUDE.md 로그 규칙.
- `supabase db push`·`reset`·`query`·`link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 마이그레이션 적용은 따로 한다. `npm run test:db`만 돌린다.
- 기존 테스트를 깨뜨리지 마라
