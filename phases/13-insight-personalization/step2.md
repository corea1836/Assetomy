# Step 2: feedback-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "API", "보안")
- `/docs/ADR.md` (ADR-002, **ADR-025**의 4번)
- `/docs/USER_FLOW.md` ("④ 월간 재방문"의 [팁 피드백])
- step 0 산출물: `/supabase/migrations/20261019000000_insight_personalization.sql`(`summary_feedback`, `save_summary_feedback`)
- step 1 산출물: `/src/types/summary.ts`
- 같은 모양의 기존 코드(이 방식을 그대로 따른다):
  - `/src/app/api/merchant-categories/route.ts`(+ `route.test.ts`): 세션 → Origin·Content-Type 검사 → JSON 파싱 → zod → 저장 → 응답, 예외는 503과 코드만 남기는 로그
  - `/src/lib/store/merchant-categories.ts`(+ `.test.ts`, `.db.test.ts`), `/src/lib/store/store-error.ts`(`callStoreRpc`)
  - `/src/lib/queries/merchant-categories.ts`(+ `.test.ts`, `.db.test.ts`), `/src/lib/queries/query-error.ts`(`readQuery`)
  - `/src/lib/http.ts`(`apiError`, `checkMutationRequest`), `/src/lib/auth.ts`(`getSessionUser`)
  - `/src/lib/errors/messages.ts`(`cardEditErrorMessage`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

사용자는 요약의 팁마다 그 카테고리에 대한 피드백을 남긴다(ADR-025). 사용자×카테고리마다 하나, 공백을 한 칸으로 줄인 뒤 100자까지, 비우고 저장하면 지운다. Free·Pro 모두 쓴다. 이 step은 데이터 경로(타입·조회·저장·API·에러 문구)만 만든다. 요약 입력에 넣는 일은 step 4, 화면은 step 6이다.

## 작업

### 1. 타입 (`src/types/summary.ts`)

```ts
export const SUMMARY_FEEDBACK_MAX_LENGTH = 100;
export type SummaryFeedback = Partial<Record<CategoryId, string>>;      // 카테고리 id → 피드백
export type SummaryFeedbackRequest = { category: CategoryId; text: string };
export type SummaryFeedbackResponse = { saved: true } | { deleted: true };
export type SaveSummaryFeedbackResult = { kind: "saved" | "deleted" };
```

### 2. 글 정리 (`src/lib/summary-feedback.ts`, 순수 함수, `server-only` 아님)

```ts
// 공백·줄바꿈을 한 칸으로 줄이고 앞뒤 공백을 지운다. API와 입력칸 글자 수가 같은 규칙을 쓴다.
export function normalizeFeedback(text: string): string
// 글자 수(코드 포인트). DB의 char_length와 같게 센다.
export function feedbackLength(text: string): number   // Array.from(text).length
```

### 3. 조회 (`src/lib/queries/summary-feedback.ts`)

```ts
export async function listSummaryFeedback(supabase: SupabaseClient, userId: string): Promise<SummaryFeedback>
```
- `summary_feedback`에서 `category, body`를 `user_id = userId`로, `.order("category")`와 `.range()` 페이지네이션 루프로 끝까지 읽는다(행은 많아야 14개지만 프로젝트 규칙대로 루프를 둔다. `merchant-categories.ts`의 PAGE_SIZE 방식).
- `readQuery`와 zod(`category: z.enum(CATEGORY_IDS)`, `body: z.string().min(1).max(400)` — zod는 UTF-16 단위로 세므로 DB의 100자(코드 포인트)보다 넉넉히 둔다)로 검증하고 `{ [category]: body }`로 돌려준다. 없으면 `{}`.

### 4. 저장 (`src/lib/store/summary-feedback.ts`, `import "server-only"`)

```ts
export async function saveSummaryFeedback(
  userId: string, category: CategoryId, body: string,
): Promise<SaveSummaryFeedbackResult>
```
- `callStoreRpc("save_summary_feedback", { p_user_id: userId, p_category: category, p_body: body }, schema)`. 결과 스키마는 `{ kind: "saved" | "deleted" }`.

### 5. API (`src/app/api/summary-feedback/route.ts`)

`PUT` 하나. `merchant-categories/route.ts`와 같은 순서로 쓴다.
1. `getSessionUser()`가 없으면 401 `UNAUTHORIZED`(Origin·본문을 보기 전에).
2. `checkMutationRequest(request, "application/json")`(Origin 정확 일치·Content-Type).
3. JSON 파싱 실패면 400 `BAD_REQUEST`.
4. zod `z.object({ category: z.enum(CATEGORY_IDS), text: z.string().max(1000) })` 실패면 400 `BAD_REQUEST`.
5. `normalizeFeedback(text)`의 `feedbackLength`가 `SUMMARY_FEEDBACK_MAX_LENGTH`를 넘으면 400 `BAD_REQUEST`. 빈 문자열은 삭제 요청이다(그대로 넘긴다).
6. `saveSummaryFeedback(user.id, category, normalized)` → `saved`면 200 `{ saved: true }`, `deleted`면 200 `{ deleted: true }`(`satisfies SummaryFeedbackResponse`).
7. 예외는 `console.error(\`summary_feedback:${constructor name}\`, userId)` 후 503 `TEMPORARY_FAILURE`.
- 사용자 id는 세션에서만 쓴다. 본문의 다른 필드(user_id 등)는 무시한다.

### 6. 에러 문구 (`src/lib/errors/messages.ts`)

```ts
export function summaryFeedbackErrorMessage(code: string): string
// BAD_REQUEST → "피드백은 100자까지 쓸 수 있어요."
// UNAUTHORIZED → "로그인이 만료됐어요. 다시 로그인해 주세요."
// 그 밖 → "저장하지 못했어요. 잠시 후 다시 시도해 주세요."
```

### 7. 테스트

- `src/lib/summary-feedback.test.ts`: 줄바꿈·탭·연속 공백이 한 칸, 앞뒤 공백 제거, 이모지·한글 글자 수(`feedbackLength("👍")`는 1).
- `route.test.ts`(merchant-categories 테스트와 같은 틀): 401이 Origin·본문 검사보다 먼저, Origin 다름 403, Content-Type 다름 415(기존 `checkMutationRequest` 결과 그대로), 깨진 JSON·모르는 카테고리·문자열이 아닌 text 400, 정리 후 101자 400·100자 통과, `"  평일\n오전  커피 "`가 `"평일 오전 커피"`로 저장 함수에 넘어감, 빈 글·공백만 → 저장 함수에 `""` → `{ deleted: true }`, `{ saved: true }`, 본문의 `user_id`를 무시하고 세션 id로 저장, 저장 함수 throw → 503이고 로그에 피드백 글이 없음.
- `summary-feedback.test.ts`(queries·store): 응답 매핑·RPC 인자·결과 스키마 실패.
- `summary-feedback.db.test.ts`(queries·store, 테스트마다 임시 사용자): 저장 → 조회에 보임, 같은 카테고리 다시 저장하면 하나로 바뀜, `""` 저장 → 지워짐, A로 조회하면 B의 피드백이 섞이지 않음(`user_id` 필터), 101자는 저장 실패.
  - 다른 `.db.test.ts`(`src/lib/queries/merchant-categories.db.test.ts`, `src/lib/queries/subscriptions.db.test.ts`)와 같이 임시 사용자는 `src/lib/supabase/db-test-helpers.ts`의 `createTestUser`·`deleteTestUser`로 만들고 지우며, 조회는 `createSupabaseAdminClient()`로 한다. RLS(본인 피드백만 select)는 step 0의 pgTAP(`supabase/tests/insight_personalization.test.sql`)이 이미 확인한다.
  - 사용자 로그인(`signInWithPassword` 등)으로 세션 클라이언트를 만들지 마라. 이유: dev 프로젝트는 이메일 로그인이 꺼져 있어(`email_provider_disabled`) 실패하고, 기존 DB 테스트도 로그인하지 않는다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
npm run test:db   # DB 통합 테스트 전체 통과(dev DB에 step 0 마이그레이션이 적용돼 있어야 한다)
test -f src/app/api/summary-feedback/route.ts
test -f src/lib/queries/summary-feedback.ts
test -f src/lib/store/summary-feedback.ts
test -f src/lib/summary-feedback.ts
grep -q 'export function summaryFeedbackErrorMessage' src/lib/errors/messages.ts
grep -q 'checkMutationRequest(request, "application/json")' src/app/api/summary-feedback/route.ts
grep -q '"server-only"' src/lib/store/summary-feedback.ts
! grep -q 'server-only' src/lib/summary-feedback.ts
! grep -nE 'console\.(error|log|warn)\([^)]*(text|body|normalized)' src/app/api/summary-feedback/route.ts
git diff --quiet HEAD -- supabase/ src/components src/lib/analytics src/lib/summary src/services src/app/dashboard
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
   - `npm run test:db`가 `summary_feedback`·`save_summary_feedback`이 없다는 오류(예: `42P01`, `PGRST202`, `PGRST205`, "Could not find the function")로 실패하면 dev DB에 step 0 마이그레이션이 적용되지 않은 것이다. 고치려 하지 말고 `"status": "blocked"`, `"blocked_reason": "dev DB에 20261019000000_insight_personalization 마이그레이션이 적용되지 않아 test:db를 돌릴 수 없음(push 필요)"`로 멈춘다.
2. 아키텍처 체크리스트를 확인한다:
   - 사용자 id는 세션에서만 오고, 쓰기는 service_role RPC로만 하는가? (CLAUDE.md CRITICAL)
   - Origin 정확 일치·`application/json`만 받는가?
   - 로그에 피드백 글이 남지 않는가?
3. 결과에 따라 `phases/13-insight-personalization/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 타입·상수, `normalizeFeedback`·`feedbackLength`, `listSummaryFeedback`·`saveSummaryFeedback`, API 경로와 응답, 에러 문구 함수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 피드백 글을 로그·에러 응답에 넣지 마라. 이유: CLAUDE.md 로그 규칙(팁 피드백 포함).
- 요청 본문의 user_id를 쓰지 마라. 이유: 사용자 ID는 세션에서만 가져온다(CLAUDE.md CRITICAL).
- 피드백을 DELETE 메서드나 다른 경로로 나누지 마라. 이유: 빈 글 저장이 삭제다(ARCHITECTURE "API").
- 요약 입력·프롬프트·화면을 고치지 마라. 이유: step 4~6에서 한다.
- `supabase db push`·`reset`·`query`·`link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 마이그레이션 적용은 따로 한다. `npm run test:db`만 돌린다.
- 기존 테스트를 깨뜨리지 마라
