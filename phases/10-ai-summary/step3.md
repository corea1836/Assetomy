# Step 3: summary-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "패턴", "월 요약", "삭제와 정리", "테스트")
- `/docs/ADR.md` (ADR-001, ADR-002, ADR-005, ADR-011, ADR-020)
- 기존 코드: `/src/lib/queries/subscriptions.ts`·`query-error.ts`(`readQuery`·`maybeSingle`·zod 검증), `/src/lib/store/subscriptions.ts`·`store-error.ts`(`callStoreRpc`), `/src/lib/store/uploads.ts`(`deleteUpload`), `/src/lib/billing/deps.ts`·`sync.ts`와 테스트(의존성 주입·로그 형식 `console.error("<영역>:<단계>:<코드>", userId)`), `/src/lib/queries/transactions.db.test.ts`(임시 사용자·`createCard`→`beginUpload`→`ingestUpload` fixture), `/src/lib/supabase/db-test-helpers.ts`
- 이전 step 산출물: `/supabase/migrations/20261016000000_ai_summaries.sql`(`ai_summaries`, `save_ai_summary`, 다시 정의한 `delete_upload`), `/src/types/summary.ts`, `/src/lib/analytics/summary-input.ts`(`buildSummaryInput`), `/src/services/llm/types.ts`(`MonthlySummarizer`·`SummaryResult`), `/src/services/llm/index.ts`(`getMonthlySummarizer`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

요약을 읽고·만들고·저장하는 흐름을 하나로 묶는다(ARCHITECTURE "월 요약").

```
prepareSummary(DTO) → 입력 = buildSummaryInput(DTO), 해시 = sha256(JSON.stringify({ model, input }))
resolveMonthlySummary → 저장된 해시가 같으면 그 문장 / 아니면 요약기 → 저장 → 그 문장 / 실패면 failed
```
- 해시에 모델 이름을 넣는 이유: mock과 live가 dev DB를 같이 쓰므로 mock 문구가 live에서 보이면 안 된다(ADR-005). 입력에 `plan`이 있으므로 플랜이 바뀌면 해시도 바뀐다.
- 해시가 다르면 저장된 문장을 **절대** 돌려주지 않는다. 이유: Pro에서 Free로 바뀐 사용자에게 탐지 상세가 담긴 요약이 보이면 안 된다(ADR-005·011).
- 읽기(`lib/queries`)는 세션 클라이언트를 인자로 받고 `user_id`를 명시해 거른다. 쓰기(`lib/store`)는 service-role RPC만(ADR-002).
- 이 step의 DB 통합 테스트는 step 0 마이그레이션이 dev DB에 적용돼 있어야 돈다. 적용은 사용자 쪽에서 한다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 타입 (`src/types/summary.ts`에 추가)

```ts
export type StoredSummary = { inputHash: string; summary: string };
export type SaveSummaryInput = {
  userId: string; month: YearMonth; plan: Plan; model: string; inputHash: string; summary: string;
};
export type SaveSummaryResult = { kind: "saved" | "no_transactions" };
export type MonthlySummaryView = { kind: "ready"; text: string } | { kind: "failed" };
```

### 2. 읽기 `src/lib/queries/summaries.ts`

```ts
export async function getStoredSummary(supabase: SupabaseClient, userId: string, month: YearMonth): Promise<StoredSummary | null>
```
- `ai_summaries`에서 `input_hash, summary`를 `user_id`·`month`로 거르고 `.maybeSingle()`. `readQuery`와 zod로 검증한다(`input_hash`는 `/^[0-9a-f]{64}$/`, `summary`는 1자 이상 문자열). 실패는 `QueryError`.

### 3. 쓰기 `src/lib/store/summaries.ts`

```ts
export async function saveSummary(input: SaveSummaryInput): Promise<SaveSummaryResult>
```
- `callStoreRpc("save_ai_summary", { p_user_id, p_month, p_plan, p_model, p_input_hash, p_summary }, schema)`. 결과는 `{ kind: "saved" } | { kind: "no_transactions" }`만 통과시키는 zod.

### 4. 조율 `src/lib/summary/monthly-summary.ts` (`import "server-only"`)

```ts
export type PreparedSummary = {
  month: YearMonth; plan: Plan; model: string; input: SummaryInput; inputHash: string;
};
export function prepareSummary(dashboard: Dashboard, summarizer: Pick<MonthlySummarizer, "modelFor">): PreparedSummary

export type SummaryDeps = {
  loadStored: (userId: string, month: YearMonth) => Promise<StoredSummary | null>;
  summarizer: MonthlySummarizer;
  save: (input: SaveSummaryInput) => Promise<SaveSummaryResult>;
};
export async function resolveMonthlySummary(
  userId: string, prepared: PreparedSummary, deps: SummaryDeps,
): Promise<MonthlySummaryView>
```
- `prepareSummary`: `input = buildSummaryInput(dashboard)`, `model = summarizer.modelFor(dashboard.plan)`, `inputHash = createHash("sha256").update(JSON.stringify({ model, input })).digest("hex")`(`node:crypto`), `month = dashboard.month`, `plan = dashboard.plan`.
- `resolveMonthlySummary` 순서(어떤 경우에도 reject하지 않는다):
  1. `loadStored`가 throw → `console.error("summary:load:<code>", userId)` 후 `{ kind: "failed" }`. 요약기를 부르지 않는다.
  2. 저장된 행이 있고 `inputHash`가 `prepared.inputHash`와 같으면 `{ kind: "ready", text: stored.summary }`. 요약기·저장을 부르지 않는다.
  3. `summarizer.summarize(prepared.input)`. `ok: false`면 `console.error("summary:generate:<reason>", userId)` 후 `{ kind: "failed" }`. 저장하지 않는다. 해시가 달랐던 저장 문장은 돌려주지 않는다.
  4. 성공이면 `save({ userId, month, plan, model, inputHash, summary: text })`.
     - `saved` → `{ kind: "ready", text }`.
     - `no_transactions` → `console.error("summary:save:no_transactions", userId)` 후 `{ kind: "failed" }`. 이유: 그 사이 거래가 지워졌다.
     - throw → `console.error("summary:save:<code>", userId)` 후 `{ kind: "ready", text }`. 이유: 문장은 이미 검증됐고, 저장이 안 되면 다음 조회 때 다시 만든다.
  - `<code>`는 `QueryError`·`StoreError`면 그 `code`, 아니면 `unexpected_error`. 로그 두 번째 인자는 `userId`만. 요약 문장·입력·에러 원문을 로그에 넣지 않는다.
  - `summarizer.summarize`가 약속을 어기고 throw하면 `summary:generate:unexpected_error`로 failed.

### 5. 기본 의존성 `src/lib/summary/deps.ts` (`import "server-only"`)

```ts
export function defaultSummaryDeps(supabase: SupabaseClient): SummaryDeps
```
- `loadStored: (userId, month) => getStoredSummary(supabase, userId, month)`, `summarizer: getMonthlySummarizer()`, `save: saveSummary`.

### 6. 테스트 (먼저 작성)

- 단위 `src/lib/summary/monthly-summary.test.ts`(fake deps, `console.error` spy):
  - `prepareSummary`: `inputHash`가 64자리 소문자 hex이고, 같은 DTO·모델이면 같고, 모델만 다르면(`"mock"` vs `"claude-sonnet-5-5"`) 다르고, 같은 거래의 Free·Pro DTO는 다르고, 카테고리 하나가 바뀐 거래면 다르다. `input`이 `buildSummaryInput(dashboard)`와 deep equal, `model`이 `modelFor(plan)`.
  - `resolveMonthlySummary`: 위 4의 분기마다 반환값, 요약기·저장 호출 여부와 인자, 로그 형식(`toHaveBeenCalledWith("summary:generate:number", userId)` 식)을 단언한다. 해시가 다른 저장 행이 있고 요약이 실패하면 `failed`이고 저장 문장이 결과에 없다. 모든 `console.error` 호출 인자에 요약 문장·가맹점명이 없다.
- 단위 `src/lib/queries/summaries.test.ts`·`src/lib/store/summaries.test.ts`(`@/lib/supabase/admin` mock 또는 fake client): 테이블·필터·select 컬럼, RPC 이름·인자, 잘못된 응답이면 `QueryError`·`StoreError`이고 메시지에 원문이 없다.
- DB 통합(`*.db.test.ts`, 테스트마다 `createTestUser`, 끝나면 `deleteTestUser`. 세션 대신 admin 클라이언트로 읽는다):
  - `src/lib/store/summaries.db.test.ts`: 거래가 없는 달 `saveSummary` → `no_transactions`, `getStoredSummary` → null. 2026-09 거래를 `ingestUpload`로 넣은 뒤 저장 → `saved`, `getStoredSummary(admin, A, "2026-09")`가 `{ inputHash, summary }`. 다른 해시·문장으로 다시 저장하면 바뀐 값을 읽는다. 사용자 B id로 A의 달을 읽으면 null.
  - 같은 파일에서 업로드 삭제: A의 업로드 U1(2026-08·09 거래)·U2(2026-10 거래)와 08·09·10월 요약을 저장한 뒤 `deleteUpload(A, U1)` → `deleted`, 08·09월은 null, 10월은 그대로.
  - 테스트가 끝나면 `deleteTestUser`가 에러 없이 끝난다(요약이 있는 사용자의 Auth cascade 삭제).

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # 새 DB 통합 테스트 포함 전체 통과(dev DB에 step 0 마이그레이션 필요)
test -f src/lib/queries/summaries.ts && test -f src/lib/store/summaries.ts && test -f src/lib/summary/monthly-summary.ts && test -f src/lib/summary/deps.ts
grep -q "server-only" src/lib/store/summaries.ts && grep -q "server-only" src/lib/summary/monthly-summary.ts && grep -q "server-only" src/lib/summary/deps.ts
! grep -rnE "\.message|\.details|\.hint" src/lib/queries/summaries.ts src/lib/store/summaries.ts src/lib/summary/
! grep -rnE "console\.(log|info|warn)" src/lib/summary/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`가 `save_ai_summary` 함수나 `ai_summaries` 테이블이 없다는 이유(PostgREST `PGRST202`·`PGRST205`, Postgres `42P01`·`42883`)로 실패하면 코드를 고치지 말고 blocked로 멈춘다.
2. 아키텍처 체크리스트를 확인한다:
   - 해시가 다를 때 저장된 문장을 돌려주는 경로가 하나도 없는가? (ADR-005·011)
   - 쓰기가 service-role RPC로만 되고(`'server-only'`), 읽기가 세션 클라이언트 인자 + `user_id` 필터인가? (ADR-002)
   - 로그가 `summary:<단계>:<코드>`와 `userId`뿐인가? (AGENTS.md CRITICAL)
3. 결과에 따라 `phases/10-ai-summary/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 함수 시그니처와 위치, 추가한 타입, 해시 공식, `resolveMonthlySummary` 분기와 로그 코드, 새 단위·DB 테스트 수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(마이그레이션 미적용 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단. 마이그레이션이 없으면 사유에 `supabase db push --linked 후 scripts/pgtap.sh supabase/tests/ai_summaries.test.sql 필요`를 적는다.

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 공유 dev DB의 스키마 변경은 사용자 쪽에서 한다.
- 마이그레이션 파일을 고치지 마라. 이유: step 0 산출물이 이미 dev DB에 적용됐을 수 있다. 문제가 있으면 blocked로 사유를 적는다.
- 해시가 다른 저장 요약을 "임시로" 보여주거나 실패 시 대신 돌려주지 마라. 이유: 플랜이 바뀐 사용자에게 이전 플랜의 요약이 보인다.
- `prepareSummary`에 DTO가 아닌 값(거래 배열·구독 행 등)을 받지 마라. 이유: Free 요약은 Free DTO만 입력으로 만든다(AGENTS.md CRITICAL).
- 요약 생성을 위한 API 라우트를 만들지 마라. 이유: 요약은 대시보드 Server Component 렌더 중에 만든다(ADR-001, ADR "의도적으로 뺀 것"의 `/api/summary`).
- 화면·컴포넌트를 만들지 마라. 이유: step 4에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
