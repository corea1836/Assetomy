# Step 3: upload-store

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "데이터 모델", "업로드 흐름", "테스트")
- `/docs/ADR.md` (ADR-002, ADR-008, ADR-015, ADR-020)
- 이전 step 산출물: `/supabase/migrations/20261013000000_upload_schema.sql`, `/supabase/migrations/20261013000100_upload_rpc.sql`(RPC 시그니처와 `kind` 값), `/src/lib/env.ts`(`getFileEncryptionKey` 포함)
- 기존 코드: `/src/lib/supabase/server.ts`와 테스트(클라이언트 생성·`vi.mock` 패턴), `/src/types/parsing.ts`, `/src/types/category.ts`, `/src/types/transaction.ts`
- `/vitest.config.ts`(unit-node·unit-dom·db 프로젝트), `/package.json`의 `test`·`test:db` 스크립트
- `/node_modules/@supabase/supabase-js`의 `createClient`·`rpc`·`auth.admin.createUser`·`auth.admin.deleteUser` 타입 정의

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

서버 쓰기는 service-role 클라이언트로 RPC를 부르는 `lib/store/`(`import 'server-only'`)에서만 한다(ADR-002). 이 step은 admin 클라이언트, RPC 래퍼(`cards`·`uploads`), DB 통합 테스트 환경을 만든다.

DB 통합 테스트(`*.db.test.ts`, `npm run test:db`)는 클라우드 dev 프로젝트를 쓴다. 로컬·Preview와 같은 DB이므로, 테스트마다 admin API로 임시 사용자를 만들어 그 사용자 행만 다루고 끝나면 지운다. 사용자를 지우면 FK cascade로 그 사용자의 행이 모두 지워진다(ADR-020). `.env`에는 `NEXT_PUBLIC_SUPABASE_URL`과 `SUPABASE_SECRET_KEY`(secret key, `sb_secret_…`)가 들어 있다.

이 step의 DB 통합 테스트는 사용자가 step 0·1의 마이그레이션을 dev DB에 push해야 통과한다. push 전이면 아래 "사용자 개입" 규칙대로 blocked로 멈춘다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. env와 admin 클라이언트
- `src/lib/env.ts`에 `export function getSupabaseAdminEnv(): { url: string; secretKey: string }` — `NEXT_PUBLIC_SUPABASE_URL`(기존 규칙과 같은 URL 검증)과 `SUPABASE_SECRET_KEY`(비어 있지 않음). 실패 시 변수 이름만 throw.
- `src/lib/supabase/admin.ts` (`import 'server-only'`):
  ```ts
  export function createSupabaseAdminClient(): SupabaseClient
  ```
  `createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`. 쿠키·세션을 쓰지 않는다.

### 2. 타입 `src/types/upload.ts`
RPC의 snake_case JSON을 camelCase 판별 유니온으로 옮긴다. 금액·개수는 안전한 정수, 날짜는 `IsoDate` 문자열이다.
```ts
export type UploadStatus = 'processing' | 'done' | 'no_new' | 'failed'
export type CreateCardResult = { kind: 'created'; cardId: string } | { kind: 'duplicate_label' } | { kind: 'invalid_label' }
export type BeginUploadInput = { userId: string; cardId: string; fileName: string; fileHash: string; fileSize: number }
export type BeginUploadResult =
  | { kind: 'started'; uploadId: string; leaseExpiresAt: string }
  | { kind: 'duplicate'; existingCardId: string }
  | { kind: 'card_not_found' } | { kind: 'rate_limited' } | { kind: 'busy' }
export type IngestRow = { usedOn: IsoDate; merchant: string; merchantKey: string; amount: number; eventKind: EventKind; category: CategoryId; fingerprint: string }
export type IngestUploadInput = { userId: string; uploadId: string; identityScope: IdentityScope; cancelStyle: CancelStyle; rows: IngestRow[]; skipped: number }
export type UploadSummary = { inserted: number; duplicates: number; skipped: number; periodFrom: IsoDate | null; periodTo: IsoDate | null; netAmount: number }
export type IngestUploadResult =
  | ({ kind: 'done' | 'no_new' } & UploadSummary)
  | { kind: 'duplicate'; existingCardId: string }
  | { kind: 'not_found' } | { kind: 'not_processing'; status: UploadStatus }
  | { kind: 'lease_expired' } | { kind: 'card_scope_mismatch' }
export type FailUploadResult = { kind: 'failed' } | { kind: 'not_found' } | { kind: 'not_processing'; status: UploadStatus }
export type DeleteUploadResult = { kind: 'deleted' } | { kind: 'not_found' } | { kind: 'processing' }
```

### 3. RPC 래퍼 (`import 'server-only'`, `createSupabaseAdminClient()` 사용)
- `src/lib/store/cards.ts`: `createCard(userId: string, label: string): Promise<CreateCardResult>`
- `src/lib/store/uploads.ts`:
  ```ts
  export async function beginUpload(input: BeginUploadInput): Promise<BeginUploadResult>
  export async function ingestUpload(input: IngestUploadInput): Promise<IngestUploadResult>
  export async function failUpload(userId: string, uploadId: string, code: string, reason?: string): Promise<FailUploadResult>
  export async function deleteUpload(userId: string, uploadId: string): Promise<DeleteUploadResult>
  ```
- RPC 인자 이름은 SQL과 같다(`p_user_id` 등). `IngestRow`는 SQL이 기대하는 snake_case 키(`used_on`, `merchant_key`, `event_kind` …)로 바꿔 `p_rows`에 넣는다.
- 응답은 zod로 검증한다. 모르는 `kind`, 안전한 정수가 아닌 숫자, 형식이 다른 날짜는 throw한다.
- 에러: RPC 에러나 응답 검증 실패는 `StoreError`를 던진다. `StoreError`는 `code`(Postgres SQLSTATE·PostgREST 코드, 또는 `unexpected_response`)와 `operation`(RPC 이름)만 가지며, `message`도 `store:<operation>:<code>` 형식이다. Supabase `error.message`·`details`·`hint`를 담거나 로그로 남기지 않는다. `StoreError`를 둘 파일은 정하되(예: `src/lib/store/store-error.ts`와 테스트) 두 래퍼가 함께 쓴다.

### 4. DB 통합 테스트 환경
- `vitest.config.ts`의 `db` 프로젝트에만 `setupFiles: ['./vitest.db.setup.ts']`, `testTimeout: 30_000`, `fileParallelism: false`를 추가한다. unit 프로젝트는 그대로 둔다(단위 테스트는 env·네트워크 없이 돈다).
- `vitest.db.setup.ts`: Node 내장 `process.loadEnvFile`로 `.env.local`(있으면)을 먼저, 그다음 `.env`를 읽는다(먼저 읽은 값이 남는다). 새 패키지를 쓰지 않는다.
- `src/lib/supabase/db-test-helpers.ts`:
  ```ts
  export async function createTestUser(): Promise<{ id: string }>   // email: `db-test+${randomUUID()}@assetomy.test`, email_confirm: true
  export async function deleteTestUser(id: string): Promise<void>
  ```
  테스트 전용 파일이다. 앱 코드에서 import하지 않는다.

### 5. 테스트 (먼저 작성)
- 단위(`*.test.ts`, `@/lib/supabase/admin`을 `vi.mock`해 가짜 `rpc`를 넣는다):
  - `env.test.ts`: `getSupabaseAdminEnv` 성공·각 변수 누락 시 변수 이름만 담은 에러.
  - `admin.test.ts`: `createClient`가 secret key와 `persistSession: false`로 불린다.
  - `cards.test.ts`·`uploads.test.ts`: 각 RPC가 정확한 이름·snake_case 인자로 불린다. 각 `kind` 응답이 camelCase 유니온으로 바뀐다. 모르는 kind·`net_amount`가 `1.5`·`2**53` → `StoreError('unexpected_response')`. RPC 에러 `{ code: '23514', message: '비밀 가맹점명' }` → `StoreError`의 code가 `23514`이고 `message`·`String(err)`·`JSON.stringify(err)` 어디에도 `비밀 가맹점명`이 없다.
- DB 통합(`src/lib/store/cards.db.test.ts`, `src/lib/store/uploads.db.test.ts`): 테스트마다(또는 파일마다) `createTestUser`로 사용자 A·B를 만들고 `afterAll`/`afterEach`에서 반드시 `deleteTestUser`한다. 실패해도 정리되게 한다.
  - cards: created → duplicate_label → invalid_label.
  - begin: B의 카드 → card_not_found. started 2번 → busy. admin 클라이언트로 한 업로드의 `lease_expires_at`을 과거로 바꾼 뒤 → started. admin으로 `upload_attempts`에 24시간 안의 행 30개를 넣은 사용자 → rate_limited.
  - ingest: 3행 → done(inserted 3, 기간·netAmount 일치), admin으로 읽은 `transactions` 3행, 카드 `identity_scope = 'content'`. 같은 fingerprint를 다른 업로드로 → no_new(duplicates 3). done과 같은 해시로 begin → duplicate와 그 카드 id. lease 만료 업로드 → lease_expired.
  - fail: processing → failed, admin으로 읽은 `failure_code` 일치.
  - delete: done → deleted, 그 업로드의 거래 0행. B가 A의 업로드 삭제 → not_found.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase 불필요)
npm run test:db   # dev DB 통합 테스트 통과
test -f src/lib/supabase/admin.ts && test -f src/lib/store/cards.ts && test -f src/lib/store/uploads.ts
! grep -rnE "console\.|\.message|\.details|\.hint" src/lib/store src/lib/supabase/admin.ts --include='*.ts' --exclude='*.test.ts'
! grep -rnE "db-test-helpers" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조(`lib/supabase/admin`, `lib/store/`)를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (새 패키지 없음)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (`server-only`, 에러에 Supabase 메시지 없음, 사용자 ID는 인자로만 받음)
   - 단위 테스트(`npm run test`)가 네트워크·`.env` 없이 도는가?
3. 결과에 따라 `phases/6-upload-store/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 래퍼 시그니처, `StoreError` 위치·형식, 테스트 헬퍼 경로, db 프로젝트 설정을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

### 사용자 개입(blocked) 규칙
- `npm run test:db`가 함수·테이블을 찾지 못해 실패하면(PostgREST `PGRST202`·`PGRST205`, Postgres `42883`·`42P01`, "Could not find the function" 등) 코드를 고치지 말고 blocked로 멈춘다. `blocked_reason`: `"마이그레이션 미적용: 사용자가 'supabase db push --linked' 후 'supabase test db --linked'를 실행해야 함"`.
- `.env`에 `SUPABASE_SECRET_KEY`나 `NEXT_PUBLIC_SUPABASE_URL`이 없으면 blocked(`".env에 SUPABASE_SECRET_KEY 필요"`).
- push된 SQL 자체가 틀려서 실패하면(예: RPC가 예상과 다른 kind를 돌려줌, SQL 런타임 에러) 마이그레이션 파일을 고치지 말고 blocked로 멈춘다. 사유에는 실패한 RPC 이름과 에러 코드만 적는다. 이유: 이미 적용된 마이그레이션은 사용자와 함께 새 마이그레이션으로 고친다.

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase link`, `supabase test db`를 실행하지 마라. 이유: dev DB 마이그레이션은 사용자가 수동으로 push한다.
- `supabase/migrations/`의 파일을 고치지 마라. 이유: 위 blocked 규칙대로 사용자와 함께 처리한다.
- `.env`를 고치거나 그 값을 출력하지 마라. 이유: 실제 비밀 키가 들어 있다.
- 단위 테스트(`*.test.ts`)에서 실제 Supabase를 부르지 마라. 이유: `npm run test`와 Stop hook은 네트워크 없이 돌아야 한다(ADR-015).
- DB 통합 테스트에서 임시 사용자가 아닌 행을 만들거나 지우지 마라. 이유: dev DB는 로컬 개발·Preview와 함께 쓴다(ADR-020).
- 브라우저용 Supabase 클라이언트나 `getSession()`을 만들지 마라. 이유: 브라우저에 Supabase 클라이언트를 두지 않는다(ADR-021).
- API 라우트·화면·ingest 흐름을 만들지 마라. 이유: 다음 phase(`7-upload-flow`)에서 만든다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
