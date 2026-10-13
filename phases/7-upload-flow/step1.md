# Step 1: upload-queries

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("디렉토리 구조", "레이어 규칙", "데이터 모델", "업로드 흐름", "테스트")
- `/docs/ADR.md` (ADR-002, ADR-008, ADR-015, ADR-017, ADR-020)
- 스키마: `/supabase/migrations/20261013000000_upload_schema.sql`(cards·uploads·transactions·merchant_category_overrides 컬럼과 RLS)
- 기존 코드: `/src/lib/store/store-error.ts`(에러 형식), `/src/lib/store/uploads.ts`(zod 응답 검증 패턴), `/src/lib/store/*.db.test.ts`(임시 사용자 패턴), `/src/lib/supabase/admin.ts`, `/src/lib/supabase/server.ts`, `/src/lib/supabase/db-test-helpers.ts`, `/src/types/upload.ts`, `/src/types/category.ts`, `/src/types/transaction.ts`
- 이전 step 산출물: `/src/services/llm/types.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

읽기는 `src/lib/queries/`가 한다(ARCHITECTURE "디렉토리 구조"). 운영 코드에서는 사용자 세션 클라이언트(`createSupabaseServerClient()`, RLS 적용)를 넘긴다. 이 step은 업로드 흐름과 대시보드가 쓸 조회 4개를 만든다.

- 모든 조회 함수는 Supabase 클라이언트와 `userId`를 인자로 받고, RLS에 더해 `.eq("user_id", userId)` 조건을 **명시**한다. 이유: dev 프로젝트는 Email 로그인이 꺼져 있어 DB 통합 테스트에서 사용자 세션을 만들 수 없다. 그래서 통합 테스트는 admin 클라이언트(RLS 우회)를 넘겨 쿼리를 검증한다. RLS 자체는 pgTAP(`supabase/tests/upload_schema.test.sql`)이 이미 단언한다.
- 목록 조회는 `.range()`로 1000행씩 끝까지 읽는다. 이유: 1000행에서 에러 없이 잘려 결과가 조용히 틀린다(CLAUDE.md).
- DB 통합 테스트(`*.db.test.ts`)는 클라우드 dev 프로젝트를 쓴다. 테스트마다 `createTestUser`로 임시 사용자를 만들고 반드시 `deleteTestUser`로 지운다(ADR-020). 데이터는 6-upload-store의 저장 함수(`createCard`·`beginUpload`·`ingestUpload`)와 admin 클라이언트 insert(merchant_category_overrides는 service_role에 insert 권한이 있음)로 만든다. 이번 step은 Storage를 쓰지 않는다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 타입 (`src/types/upload.ts`에 추가)
```ts
export type CardOption = { id: string; label: string };
export type TransactionCoverage = { count: number; from: IsoDate | null; to: IsoDate | null };
export type UploadOutcomeRecord =
  | ({ status: "done" | "no_new" } & UploadSummary)
  | { status: "processing" | "failed" };
```

### 2. 에러 `src/lib/queries/query-error.ts`
- `QueryError extends Error`: `operation`·`code`만 가지고 `message`는 `query:<operation>:<code>`. Supabase `error.message`·`details`·`hint`를 담지 않는다(`StoreError`와 같은 규칙). Supabase 에러는 `error.code || "unexpected_response"`, zod 검증 실패는 `unexpected_response`.

### 3. 조회 함수 (`import 'server-only'`, 첫 인자 `supabase: SupabaseClient`)
- `src/lib/queries/cards.ts`
  ```ts
  export async function listCards(supabase: SupabaseClient, userId: string): Promise<CardOption[]>
  ```
  `created_at, id` 오름차순, `.range()`로 끝까지.
- `src/lib/queries/merchant-categories.ts`
  ```ts
  export async function findMerchantCategories(
    supabase: SupabaseClient, userId: string, merchantKeys: string[],
  ): Promise<Map<string, CategoryId>>
  ```
  - 중복을 지운 키를 100개씩 나눠 `.in("merchant_key", chunk)`로 조회한다(URL 길이 제한). 각 조회도 `.range()`로 끝까지 읽는다.
  - 우선순위: `merchant_category_overrides`의 값 → 없으면 `transactions`에서 같은 `merchant_key`의 가장 최근 거래(`created_at` 내림차순, 같으면 `id` 내림차순) 카테고리. 둘 다 없으면 Map에 넣지 않는다(분류기가 채운다).
  - 빈 배열이면 DB를 부르지 않고 빈 Map.
- `src/lib/queries/uploads.ts`
  ```ts
  export async function getUploadOutcome(
    supabase: SupabaseClient, userId: string, uploadId: string,
  ): Promise<UploadOutcomeRecord | null>
  ```
  - ingest RPC 응답이 불명확할 때 한 번 다시 읽는 용도다(ARCHITECTURE "업로드 흐름"). 행이 없으면 `null`. `done`·`no_new`면 `inserted_count`·`duplicate_count`·`skipped_count`·`period_from`·`period_to`·`net_amount`를 `UploadSummary`로 옮긴다(`net_amount`는 안전한 정수만, 아니면 `QueryError`).
- `src/lib/queries/transactions.ts`
  ```ts
  export async function getTransactionCoverage(supabase: SupabaseClient, userId: string): Promise<TransactionCoverage>
  ```
  - 건수는 `count: "exact", head: true`, 첫·마지막 이용일은 `used_on` 오름/내림차순 `limit(1)`. 거래가 없으면 `{ count: 0, from: null, to: null }`.
- 응답 행은 zod로 검증한다(카테고리는 `CATEGORY_IDS`, 날짜는 `YYYY-MM-DD`, id는 uuid). 형식이 다르면 `QueryError(operation, "unexpected_response")`.

### 4. 테스트 (먼저 작성)
- 단위(`*.test.ts`, 가짜 클라이언트로 네트워크 없이):
  - `query-error.test.ts`: 메시지 형식, `{ code: "42501", message: "비밀 가맹점명" }` 에러 → `message`·`String(err)`·`JSON.stringify(err)`에 `비밀 가맹점명`이 없다.
  - `merchant-categories.test.ts`: 250개 키(중복 포함) → `.in()` 호출이 고유 키 기준 100개 이하 묶음으로 나뉜다. 빈 배열이면 클라이언트 호출 없음. 수정값이 거래 카테고리보다 우선.
  - 각 함수에 `.eq("user_id", userId)`가 걸린다(가짜 빌더가 받은 호출을 기록해 단언).
- DB 통합(`src/lib/queries/*.db.test.ts`, admin 클라이언트를 넘김, 사용자 A·B):
  - `listCards`: A의 카드 2장만 생성 순서대로, B의 카드는 나오지 않음.
  - `findMerchantCategories`: A에 거래(`ingestUpload`로 `merchantKey` X=food, Y=cafe)와 수정값(Y=shopping) → X=food, Y=shopping, 모르는 키 없음. B의 같은 키 거래·수정값은 A 결과에 섞이지 않음. 키 150개를 넘겨도 동작(묶음 경계).
  - `getUploadOutcome`: done 업로드 → 요약 일치, processing → `{ status: "processing" }`, 다른 사용자의 업로드 id → `null`.
  - `getTransactionCoverage`: 거래 없음 → 0·null. 한 업로드로 1,001건(서로 다른 fingerprint·이용일) 저장 → count 1001, from·to 일치. B의 거래는 세지 않음.
  - 실패해도 `afterEach`/`afterAll`에서 임시 사용자를 지운다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase 불필요)
npm run test:db   # dev DB 통합 테스트 통과
test -f src/lib/queries/cards.ts && test -f src/lib/queries/merchant-categories.ts && test -f src/lib/queries/uploads.ts && test -f src/lib/queries/transactions.ts
! grep -rnE "console\.|\.message|\.details|\.hint" src/lib/queries --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `lib/queries/`는 읽기만 하는가? (insert·update·delete·rpc 없음)
   - 모든 조회가 `user_id` 조건을 명시하고, 목록은 `.range()`로 끝까지 읽는가?
   - 에러에 Supabase 메시지가 없는가? `server-only`인가?
3. 결과에 따라 `phases/7-upload-flow/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 4개 함수 시그니처, `QueryError` 위치·형식, 추가한 타입을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

### 사용자 개입(blocked) 규칙
- `npm run test:db`가 테이블·함수를 찾지 못하면(PostgREST `PGRST202`·`PGRST205`, Postgres `42883`·`42P01`) 코드를 고치지 말고 blocked: `"dev DB에 6-upload-store 마이그레이션이 없음: 사용자가 supabase db push --linked 확인 필요"`.
- `.env`에 `SUPABASE_SECRET_KEY`·`NEXT_PUBLIC_SUPABASE_URL`이 없으면 blocked.
- 네트워크로 dev 프로젝트에 닿지 않으면(`fetch failed`, DNS 오류) blocked: `"dev Supabase 프로젝트 연결 실패(일시 정지 여부 확인 필요)"`.

## 금지사항

- `supabase/migrations/`를 고치거나 새 마이그레이션을 만들지 마라. 이유: 이번 phase는 스키마 변경 없이 진행하고, 마이그레이션 적용은 사용자가 한다.
- `supabase db push`·`db reset`·`db query`·`link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 공유 dev DB 변경은 사용자가 한다.
- 조회 함수 안에서 `createSupabaseServerClient()`나 `createSupabaseAdminClient()`를 직접 부르지 마라. 이유: 운영은 세션 클라이언트, 테스트는 admin 클라이언트를 호출자가 넘긴다.
- 단위 테스트에서 실제 Supabase를 부르지 마라. 이유: `npm run test`와 Stop hook은 네트워크 없이 돈다(ADR-015).
- DB 통합 테스트에서 임시 사용자가 아닌 행을 만들거나 지우지 마라. 이유: dev DB를 로컬·Preview와 함께 쓴다(ADR-020).
- 업로드 처리·API·화면을 만들지 마라. 이유: 다음 step에서 만든다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
