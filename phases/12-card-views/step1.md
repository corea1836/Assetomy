# Step 1: card-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "데이터 모델", "카드 탭", "API", "보안")
- `/docs/ADR.md` (ADR-002, ADR-023, **ADR-024**)
- step 0 산출물: `/supabase/migrations/20261018000000_card_views.sql`(`card_summaries`, `save_card_summary`·`update_card`의 인자와 결과 kind)
- 타입: `/src/types/transaction.ts`, `/src/types/card.ts`, `/src/types/upload.ts`(`CardOption`·`CreateCardResult`·`ApiErrorCode`), `/src/types/summary.ts`
- 읽기: `/src/lib/queries/transactions.ts`(+ `.test.ts`·`.db.test.ts`), `/src/lib/queries/summaries.ts`(+ `.test.ts`), `/src/lib/queries/uploads.ts`, `/src/lib/queries/query-error.ts`, `/src/lib/clock.ts`
- 쓰기: `/src/lib/store/cards.ts`(+ `.test.ts`·`.db.test.ts`), `/src/lib/store/summaries.ts`(+ `.test.ts`·`.db.test.ts`), `/src/lib/store/store-error.ts`
- API: `/src/app/api/cards/route.ts`(+ `route.test.ts`), `/src/app/api/uploads/[id]/route.ts`(동적 경로 params 처리), `/src/lib/http.ts`
- DB 테스트: `/src/lib/supabase/db-test-helpers.ts`, `/vitest.db.setup.ts`
- `Transaction` 객체를 만드는 곳: `grep -rln 'cardLabel:' src`로 찾는다(`src/lib/demo/fixture.ts`와 여러 테스트 파일).

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드에 카드 탭을 더한다(ADR-024). 이용 기간 카드는 명세서(청구서) 단위로 보므로, 거래마다 그 거래를 넣은 업로드의 청구서 결제일(`uploads.statement_date`)이 필요하고, 명세서마다 PDF를 저장한 날(완료 판단용)이 필요하다. 이 step은 그 데이터를 읽고, 카드 요약과 카드 수정을 쓰는 I/O 계층만 만든다. 분석(순수 함수)·요약 생성·화면은 다음 step이 한다.

## 작업

### 1. 타입

- `src/types/transaction.ts`의 `Transaction`에 필드를 더한다:
  ```ts
  statementDate: IsoDate | null; // 이 거래를 넣은 업로드의 청구서 결제일. 결제일을 모르는 업로드면 null
  ```
  필수 필드다(옵션 `?`로 두지 마라. 이유: 빠뜨린 곳이 컴파일 오류로 드러나야 한다). `Transaction`을 만드는 모든 곳(데모 fixture, 테스트의 factory·객체)에 값을 넣는다. 데모 fixture와 기존 테스트는 `statementDate: null`이다.
- `src/types/card.ts`에 더한다:
  ```ts
  export type CardUpdateInput = { label: string; analysisBasis: AnalysisBasis; cycleStartDay: number | null };
  export type UpdateCardResult =
    | { kind: "updated" } | { kind: "not_found" } | { kind: "invalid_label" } | { kind: "duplicate_label" };
  // 명세서(같은 카드·결제일의 done 업로드) 하나. savedOn은 PDF 저장일(서울)
  export type StatementRecord = { cardId: string; statementDate: IsoDate; savedOn: IsoDate };
  ```
- `src/types/summary.ts`에 더한다:
  ```ts
  export type SaveCardSummaryInput = {
    userId: string; cardId: string; period: string; // 'YYYY-MM' 또는 결제일 'YYYY-MM-DD'
    plan: Plan; model: string; inputHash: string; summary: string; tips: string[];
  };
  export type SaveCardSummaryResult = { kind: "saved" | "card_not_found" | "basis_mismatch" | "no_data" };
  ```

### 2. 읽기 (`lib/queries`, 사용자 세션 + RLS, `import "server-only"`)

- `listTransactions(supabase, userId, cardLabels)`: 시그니처는 그대로 두고, 같은 select에서 업로드의 결제일을 함께 읽는다.
  - select에 `upload:uploads!transactions_user_id_upload_id_fkey(statement_date)`를 더한다(복합 FK `(user_id, upload_id) → uploads(user_id, id)`로 묶인 many-to-one 임베드). 응답 스키마는 `upload: z.object({ statement_date: z.iso.date().nullable() })`이고 `statementDate`로 옮긴다. 임베드가 null이거나 모양이 다르면 지금처럼 응답 검증 실패(`QueryError`)다.
  - 이유: 거래와 업로드를 따로 읽으면 그 사이 업로드가 지워지거나 생겨 거래와 결제일이 어긋난다. 한 쿼리로 읽는다.
  - 페이지네이션·정렬·`cardLabels`로 라벨을 붙이는 동작은 바꾸지 마라.
- 새 파일 `src/lib/queries/statements.ts`:
  ```ts
  export async function listStatements(supabase: SupabaseClient, userId: string): Promise<StatementRecord[]>
  ```
  - `uploads`에서 `user_id = userId`, `status = 'done'`, `statement_date`가 null이 아닌 행의 `card_id, statement_date, statement_saved_at, created_at`을 읽는다. 정렬 `statement_date desc, id desc`, `.range()`로 1000행씩 끝까지 읽는다(`listDoneUploads`와 같은 방식).
  - `savedOn` = 서울 날짜(`seoulToday(new Date(ms))`, `lib/clock.ts`)이고 `ms = min(statement_saved_at ?? created_at, created_at)`이다(ADR-023의 비교 시각과 같다. 업로드보다 뒤에 저장된 파일은 없다).
  - 응답 스키마: `statement_saved_at`·`created_at`은 `z.iso.datetime({ offset: true })`(saved는 nullable).
- `src/lib/queries/summaries.ts`에 더한다:
  ```ts
  export async function getStoredCardSummary(
    supabase: SupabaseClient, userId: string, cardId: string, period: string,
  ): Promise<StoredSummary | null>
  ```
  `card_summaries`에서 `user_id`·`card_id`·`period`로 `input_hash, summary, tips`를 `maybeSingle()`로 읽는다. 응답 스키마는 `getStoredSummary`와 같다(팁 1~5개).

### 3. 쓰기 (`lib/store`, service-role RPC, `import "server-only"`)

- `src/lib/store/summaries.ts`에 `saveCardSummary(input: SaveCardSummaryInput): Promise<SaveCardSummaryResult>` — `callStoreRpc("save_card_summary", { p_user_id, p_card_id, p_period, p_plan, p_model, p_input_hash, p_summary, p_tips }, schema)`. 결과 스키마는 `kind` 네 값만 허용한다.
- `src/lib/store/cards.ts`에 `updateCard(userId: string, cardId: string, input: CardUpdateInput): Promise<UpdateCardResult>` — `callStoreRpc("update_card", { p_user_id, p_card_id, p_label, p_analysis_basis, p_cycle_start_day }, schema)`. 결과 스키마는 `kind` 네 값만 허용한다.

### 4. API `src/app/api/cards/[id]/route.ts` — `PUT`

`POST /api/cards`와 `DELETE /api/uploads/[id]`의 방식을 따른다. 순서:
1. `getSessionUser()` 없으면 401 `UNAUTHORIZED`.
2. `checkMutationRequest(request, "application/json")` (Origin 정확 일치·JSON만).
3. `(await params).id`가 uuid가 아니면 404 `NOT_FOUND`. uuid면 소문자로 바꿔 쓴다.
4. 본문 JSON 파싱 실패·객체가 아님·`label`이 문자열이 아님 → 400 `BAD_REQUEST`.
5. `analysisBasis`(`month`·`cycle`)·`cycleStartDay`(1~31 정수 또는 null)가 틀리거나, `cycle`인데 null이거나 `month`인데 숫자면 → 400 `INVALID_CARD`(POST와 같은 규칙).
6. `updateCard(user.id, id, { label: label.trim(), analysisBasis, cycleStartDay })`.
   - `updated` → 200 `{ updated: true }`
   - `not_found` → 404 `NOT_FOUND`
   - `invalid_label` → 400 `INVALID_LABEL`
   - `duplicate_label` → 409 `DUPLICATE_LABEL`
7. 그 밖의 예외 → 503 `TEMPORARY_FAILURE`.
- 본문의 `issuer`·`userId`·`user_id`·`cardId` 같은 키는 읽지 않는다. 사용자 id는 세션에서만, 카드 id는 경로에서만 가져온다.
- POST와 검증 스키마를 공유하고 싶으면 `src/app/api/cards/card-input.ts`로 옮겨 두 라우트가 같이 쓴다(선택). 옮기면 POST의 기존 테스트가 그대로 통과해야 한다.

### 5. 테스트

- 단위(`*.test.ts`, Supabase 불필요):
  - `listTransactions`: 임베드 `upload.statement_date`가 `statementDate`로 옮겨지고(날짜·null 둘 다), select 문자열에 임베드가 들어가며, 임베드가 없거나 null이면 `QueryError`.
  - `listStatements`: 1000행 넘게 페이지를 끝까지 읽고 매 페이지에 사용자·done·결제일 조건과 정렬이 걸린다. `savedOn` 계산: 저장 시각 `2026-10-13T22:39:44+00:00`(서울 10/14 07:39)과 업로드 시각 `2026-10-14T05:40:52+00:00` → `2026-10-14`. 저장 시각이 null이면 업로드 시각의 서울 날짜. 저장 시각이 업로드 시각보다 늦으면 업로드 시각을 쓴다(예: 저장 `2099-01-01T00:00:00+00:00`, 업로드 `2026-10-11T16:00:00+00:00` → `2026-10-12`). 응답 모양이 틀리면 `QueryError`.
  - `getStoredCardSummary`: 조건 3개(`user_id`·`card_id`·`period`)와 결과 변환, 없으면 null.
  - `saveCardSummary`·`updateCard`: RPC 이름·인자 이름이 정확하고, 모르는 kind는 `StoreError`.
  - `PUT /api/cards/[id]`: 401, Origin 403, JSON 아닌 content-type 400, 잘못된 id 404, 깨진 JSON 400, 라벨 없음 400, 기준 규칙 위반 400 `INVALID_CARD`(세 경우), 결과 kind별 응답 4개, `updateCard`가 throw하면 503. `updateCard`는 세션 user id·경로 id(소문자)·trim한 라벨로 불리고 본문의 `userId`·`issuer`는 무시된다.
- DB 통합(`*.db.test.ts`, `npm run test:db`, 테스트마다 임시 사용자): 기존 파일에 더하거나 새 파일을 만든다.
  - `listTransactions`: 결제일이 있는 업로드(`ingest_upload`에 `p_statement_date`를 넘김)와 없는 업로드의 거래가 각각 그 결제일·null을 갖는다(사용자 세션 대신 기존 db 테스트처럼 admin 클라이언트로 조회하되 `user_id` 조건을 건다).
  - `listStatements`: done 업로드만, 결제일 있는 것만 돌려준다.
  - `saveCardSummary` → `getStoredCardSummary`로 읽힌다. `updateCard`로 기준을 바꾸면 그 카드 요약이 사라진다. 업로드를 `deleteUpload`로 지우면 그 카드 요약이 사라진다.
  - 테스트 사용자는 `deleteTestUser`로 지운다(카드 요약이 있는 사용자도 오류 없이 지워져야 한다. uploads 삭제 트리거가 Auth 역할로 돌기 때문이다).

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
npm run test:db   # DB 통합 테스트 전체 통과(dev DB에 step 0 마이그레이션이 적용돼 있어야 한다)
test -f src/lib/queries/statements.ts
test -f "src/app/api/cards/[id]/route.ts"
grep -q 'transactions_user_id_upload_id_fkey' src/lib/queries/transactions.ts
grep -q 'statementDate: IsoDate | null' src/types/transaction.ts
grep -q '"save_card_summary"' src/lib/store/summaries.ts
grep -q '"update_card"' src/lib/store/cards.ts
grep -q 'export async function PUT' "src/app/api/cards/[id]/route.ts"
! grep -q 'statementDate?:' src/types/transaction.ts
git diff --quiet HEAD -- supabase/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
   - `npm run test:db`가 `card_summaries`·`save_card_summary`·`update_card`가 없다는 오류(예: `42P01`, `PGRST202`, `PGRST205`, "Could not find the function")로 실패하면 코드 문제가 아니라 dev DB에 step 0 마이그레이션이 아직 적용되지 않은 것이다. 이때는 고치려 하지 말고 `"status": "blocked"`, `"blocked_reason": "dev DB에 20261018000000_card_views 마이그레이션이 적용되지 않아 test:db를 돌릴 수 없음(push 필요)"`로 멈춘다.
   - 임베드(`uploads!transactions_user_id_upload_id_fkey`)가 PostgREST에서 관계를 찾지 못한다는 오류(`PGRST200`)면 그 메시지의 코드만 기록하고 error로 멈춘다(다른 방식으로 우회하지 마라).
2. 아키텍처 체크리스트를 확인한다:
   - 읽기는 세션 클라이언트 + `user_id` 조건, 쓰기는 service-role RPC만 쓰는가?
   - 목록 조회는 `.range()`로 끝까지 읽는가?
   - API가 사용자 id를 세션에서만, 카드 id를 경로에서만 가져오고 Origin·JSON을 검사하는가?
   - 로그에 코드·id 말고 다른 값(라벨·응답 본문·`error.message`)을 남기지 않는가?
3. 결과에 따라 `phases/12-card-views/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 새 타입(`Transaction.statementDate`, `StatementRecord`, `CardUpdateInput`·`UpdateCardResult`, `SaveCardSummaryInput`·`Result`)과 위치, 새 함수(`listStatements`, `getStoredCardSummary`, `saveCardSummary`, `updateCard`)와 파일, `PUT /api/cards/[id]` 응답 규칙을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`·`reset`·`query`·`link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 마이그레이션 적용은 사용자 쪽에서 한다. `npm run test:db`만 돌린다.
- `supabase/` 아래 파일을 고치지 마라. 이유: 스키마는 step 0에서 끝났고 dev DB에 적용됐다.
- 거래와 업로드를 두 쿼리로 따로 읽어 코드에서 맞추지 마라. 이유: 두 쿼리 사이에 업로드가 바뀌면 결제일이 어긋난다(ARCHITECTURE "카드 탭").
- `Transaction.statementDate`를 옵션 필드로 두지 마라. 이유: 값을 빠뜨린 곳이 컴파일에서 드러나야 한다.
- `lib/analytics`·`lib/summary`·`services/`·`components/`·`app/dashboard`의 동작을 바꾸지 마라(타입에 맞춰 `statementDate: null`을 넣는 것만 허용). 이유: 다음 step에서 한다.
- 카드 수정 API가 카드사(`issuer`)를 받거나 바꾸게 하지 마라. 이유: 카드사는 업로드 검사 기준이다(ADR-024).
- 로그에 카드 라벨·요약 본문·Supabase `error.message`를 남기지 마라. 이유: CLAUDE.md 로그 규칙.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
