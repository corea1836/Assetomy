# Step 2: ingest

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "데이터 모델"의 fingerprint, "업로드 흐름", "삭제와 정리"의 보관 기한, "테스트")
- `/docs/ADR.md` (ADR-005, ADR-006, ADR-007, ADR-008, ADR-009, ADR-017, ADR-019)
- `/docs/PRD.md` ("지원 범위", "카테고리", "데이터 보관")
- 기존 코드: `/src/types/parsing.ts`(`ParseResult`·`ParsedTransaction`), `/src/lib/pdf/read-statement.ts`, `/src/lib/parsing/normalize.ts`, `/src/lib/crypto.ts`(`sha256Hex`·`decryptStatement`), `/src/lib/analytics/dates.ts`(`addMonths`·`daysInMonth`·`monthOf`), `/src/lib/store/uploads.ts`, `/src/lib/store/statements.ts`, `/src/lib/store/statements.db.test.ts`(Storage 정리 패턴), `/src/types/upload.ts`
- 이전 step 산출물: `/src/services/llm/types.ts`·`/src/services/llm/mock-classifier.ts`, `/src/lib/queries/*.ts`, `/src/lib/queries/query-error.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

`src/lib/ingest/`는 파일 하나를 받아 거래 저장까지 끝내는 업로드 처리다(I/O, 의존성 주입). 저장·조회·분류·파싱 함수는 모두 인자로 받는다. 다음 step의 Route Handler가 실제 구현(`lib/store`·`lib/queries`·`services/llm`·`readPdfStatement`)을 묶어 넘긴다.

처리 순서(ARCHITECTURE "업로드 흐름"):
```
sha256 → beginUpload(사용자 잠금·한도·같은 파일 검사, processing + 6분 lease)
  → saveStatement(AES-256-GCM 암호화본만 Storage에)
  → readStatement(PDF 파싱, 실패면 failUpload(코드, reason))
  → 보관 기한 밖 거래 제외(skipped)
  → 카테고리: 사용자 수정값 → 기존 거래 → 분류기(실패는 etc)
  → fingerprint → ingestUpload(한 트랜잭션) → done / no_new / 그 외
  → ingest RPC가 throw하거나 not_processing이면 상태를 한 번 다시 읽어 done·no_new면 그 결과, 아니면 temporary_failure(행은 그대로 둔다)
```

이번 phase는 현대카드 명세서 PDF만 읽는다. 식별 범위는 `content`, 취소 표기는 `negative_amount`다(`ParseSuccess`가 알려줌).

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 보관 기한 `src/lib/retention.ts` (순수: I/O·`Date.now()`·env 금지)
```ts
export const RETENTION_MONTHS = 12;
export function retentionCutoff(today: IsoDate): IsoDate
```
- `today`에서 12개월 전 같은 날. 그 달에 같은 날이 없으면 그 달 말일(`2028-02-29` → `2027-02-28`). 문자열로만 계산한다(Date 객체 금지).
- 이용일이 `cutoff` 이상인 거래만 저장한다. 정기 정리(이후 phase)도 이 함수를 쓴다.

### 2. fingerprint `src/lib/ingest/fingerprint.ts` (`import 'server-only'`)
```ts
export function transactionFingerprint(input: {
  cardId: string; identityScope: IdentityScope; sourceEventKey: string; eventKind: EventKind;
}): string
```
- `sha256Hex(UTF-8("<cardId>|<identityScope>|<sourceEventKey>|<eventKind>"))`(ADR-006). `cardId`는 소문자 UUID여야 하고 아니면 throw한다(대소문자가 다르면 같은 거래가 다른 fingerprint가 됨). 호출자가 소문자로 바꿔 넘긴다.

### 3. 타입 (`src/types/upload.ts`에 추가)
```ts
export type ProcessUploadInput = { userId: string; cardId: string; fileName: string; bytes: Uint8Array };
export type ProcessUploadOutcome =
  | ({ kind: "done" | "no_new"; uploadId: string } & UploadSummary)
  | { kind: "duplicate"; existingCardId: string }
  | { kind: "rejected"; uploadId: string; code: "UNSUPPORTED_FILE"; reason: UnsupportedFileReason }
  | { kind: "rejected"; uploadId: string; code: "UNREADABLE"; reason: UnreadableReason }
  | { kind: "card_not_found" } | { kind: "rate_limited" } | { kind: "busy" }
  | { kind: "card_scope_mismatch"; uploadId: string }
  | { kind: "temporary_failure"; uploadId: string | null };
```

### 4. 처리 함수 `src/lib/ingest/process-upload.ts` (`import 'server-only'`)
```ts
export type ProcessUploadDeps = {
  today: IsoDate;
  beginUpload(input: BeginUploadInput): Promise<BeginUploadResult>;
  saveStatement(userId: string, uploadId: string, plaintext: Uint8Array): Promise<void>;
  readStatement(bytes: Uint8Array): Promise<ParseResult>;
  findMerchantCategories(merchantKeys: string[]): Promise<Map<string, CategoryId>>;
  classifier: MerchantClassifier;
  ingestUpload(input: IngestUploadInput): Promise<IngestUploadResult>;
  failUpload(userId: string, uploadId: string, code: string, reason?: string): Promise<FailUploadResult>;
  getUploadOutcome(uploadId: string): Promise<UploadOutcomeRecord | null>;
};
export async function processUpload(input: ProcessUploadInput, deps: ProcessUploadDeps): Promise<ProcessUploadOutcome>
```
규칙:
- `fileHash = sha256Hex(bytes)`, `fileSize = bytes.byteLength`, `cardId`는 소문자로 바꿔 쓴다. 파일 크기·확장자 검증은 Route Handler가 이미 했다고 가정한다.
- `beginUpload`가 `started`가 아니면 그 결과를 그대로 outcome으로 옮긴다(`duplicate`는 업로드 행·원본이 없다). 이 경우 저장·파싱을 하지 않는다. `beginUpload`가 throw하면 `temporary_failure`(uploadId null).
- `started` 이후 실패는 `failUpload`로 업로드를 끝낸다. 코드·reason(DB 제약: 코드 `^[A-Z_]{1,40}$`, reason `^[a-z_]{1,40}$`):
  - 파싱 실패: `ParseFailure`의 `code`·`reason` 그대로 → `rejected`.
  - 원본 저장 실패: `INTERNAL_ERROR`·`storage` → `temporary_failure`. 이때 파싱하지 않는다.
  - `readStatement`가 throw(워커 누락 등): `INTERNAL_ERROR`·`parser` → `temporary_failure`.
  - `findMerchantCategories`가 throw: `INTERNAL_ERROR`·`categories` → `temporary_failure`.
  - `failUpload` 자체가 실패해도 삼키고 같은 outcome을 돌려준다(행은 lease 만료 후 실패로 정리된다, ADR-008).
- 보관 기한: `retentionCutoff(deps.today)`보다 이른 이용일의 거래는 rows에서 빼고 개수를 `skipped`로 넘긴다. 모두 빠져도 빈 rows로 `ingestUpload`를 부른다(RPC가 `no_new`로 끝낸다).
- 카테고리: 남은 거래의 고유 `merchantKey`로 `findMerchantCategories`를 한 번 부른다. 결과에 없는 키만 `classifier.classify`에 `{ merchantKey, merchant }`(첫 거래의 표시명)로 넘긴다. 분류기가 계약과 달리 throw하면 그 키들은 모두 `'etc'`. 결과에 없는 키도 `'etc'`.
- rows: `{ usedOn: date, merchant, merchantKey, amount, eventKind, category, fingerprint }`. `identityScope`·`cancelStyle`은 `ParseSuccess`의 값.
- `ingestUpload` 결과:
  - `done`·`no_new` → 같은 kind와 요약.
  - `duplicate`(같은 파일이 동시에 처리돼 먼저 끝남) → `{ kind: "duplicate", existingCardId }`.
  - `card_scope_mismatch` → 그대로(RPC가 이미 failed로 끝냄). `lease_expired`·`not_found` → `temporary_failure`.
  - `not_processing` 또는 throw → `getUploadOutcome(uploadId)`를 **한 번** 부른다. `done`·`no_new`면 그 요약으로 성공 outcome, 그 외·`null`·throw면 `temporary_failure`. 이 경로에서는 `failUpload`를 부르지 않는다(커밋됐는지 모르는 행은 보존, ADR-008).
- 로그를 남기지 않는다(로그는 Route Handler가 코드와 id만 남긴다). 평문 바이트를 다른 곳에 저장하지 않는다.

### 5. 테스트 (먼저 작성)
- `src/lib/retention.test.ts`: `2026-10-13` → `2025-10-13`, `2026-03-31` → `2025-03-31`, `2028-02-29` → `2027-02-28`, `2026-01-05` → `2025-01-05`.
- `fingerprint.test.ts`: 알려진 입력의 sha256 hex(직접 계산한 기대값), 대문자·형식이 틀린 cardId → throw, 필드가 하나만 달라도 값이 다름.
- `process-upload.test.ts`(모든 의존성 fake, 네트워크 없음):
  - begin의 `card_not_found`·`rate_limited`·`busy`·`duplicate` → 그대로, `saveStatement`·`readStatement` 미호출.
  - 정상 흐름: `beginUpload` 인자(해시·크기·소문자 cardId), `saveStatement`가 `readStatement`보다 먼저 같은 바이트로 불림, rows의 fingerprint·category, `ingestUpload` 인자의 `identityScope: "content"`·`cancelStyle: "negative_amount"`.
  - 보관 기한: `today = "2026-10-13"`에서 `2025-10-12` 거래는 빠지고 `skipped` 1, `2025-10-13`은 남음. 모두 빠지면 빈 rows.
  - 카테고리 우선순위: 조회 결과에 있는 키는 분류기에 넘기지 않음, 없는 키만 표시명과 함께 넘김, 분류기 throw → etc.
  - 실패 경로마다 `failUpload`의 코드·reason과 outcome: 파싱 실패(`UNREADABLE`·`total_mismatch`), 저장 실패(`INTERNAL_ERROR`·`storage`, 파싱 미호출), 파서 throw(`parser`), 조회 throw(`categories`), `failUpload`도 throw.
  - ingest 결과 매핑: `duplicate`·`card_scope_mismatch`·`lease_expired`·`not_found`.
  - ingest throw → `getUploadOutcome`이 done이면 done 요약, processing이면 `temporary_failure`이고 `failUpload` 미호출. `not_processing`도 같은 경로. `getUploadOutcome`도 throw → `temporary_failure`.
- `process-upload.db.test.ts`(dev DB·Storage 통합): 실제 `beginUpload`·`saveStatement`·`ingestUpload`·`failUpload`, admin 클라이언트를 넘긴 `findMerchantCategories`·`getUploadOutcome`, `createMockClassifier()`, 가짜 `readStatement`(합성 `ParseSuccess`: 거래 4건, 하나는 보관 기한 밖, 하나는 `스타벅스`, 하나는 수정값을 미리 넣은 가맹점, 하나는 모르는 가맹점), 고정 `today`.
  - `vi.stubEnv("FILE_ENCRYPTION_KEY", 랜덤 32바이트 base64)`로 테스트 키를 쓴다(`statements.db.test.ts`와 같은 방식).
  - done: admin으로 읽은 거래 3건의 category(수정값 > cafe > etc)와 fingerprint가 `transactionFingerprint` 결과와 같다. `skipped` 1. Storage `statementPath(userId, uploadId)` 객체를 내려받아 같은 키로 복호화하면 원본 바이트와 같고, 내려받은 바이트는 원본과 다르다.
  - 같은 바이트로 다시 → `duplicate`와 첫 카드 id. 바이트만 다르고 같은 거래 → `no_new`(duplicates 3).
  - 가짜 `readStatement`가 `UNREADABLE`·`total_mismatch` → `rejected`, admin으로 읽은 업로드 `status = 'failed'`·`failure_code`·`failure_reason` 일치.
  - 정리: 만든 업로드의 원본 경로를 `removeStatements`로 지운 뒤 임시 사용자를 지운다(Auth 사용자 삭제는 Storage 객체를 지우지 않음). 실패해도 정리되게 한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase 불필요)
npm run test:db   # dev DB·Storage 통합 테스트 통과
test -f src/lib/retention.ts && test -f src/lib/ingest/fingerprint.ts && test -f src/lib/ingest/process-upload.ts
! grep -rnE "console\.|\.message" src/lib/ingest src/lib/retention.ts --include='*.ts' --exclude='*.test.ts'
! grep -rnE "Date\.now|new Date|process\.env" src/lib/retention.ts src/lib/ingest --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `processUpload`는 저장·조회·분류·파싱 구현을 직접 import하지 않고 deps로만 받는가? (타입 import는 허용)
   - 금액·날짜를 LLM 출력으로 만들거나 고치지 않는가? 분류기에 가맹점명만 넘기는가?
   - 불명확한 ingest 결과에서 행을 실패 처리·삭제하지 않는가?
   - 평문 원본을 Storage·DB·로그에 남기지 않는가?
3. 결과에 따라 `phases/7-upload-flow/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `processUpload`·`ProcessUploadDeps`·`ProcessUploadOutcome` 시그니처, failUpload 코드·reason 목록, `retentionCutoff`·`transactionFingerprint` 위치를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

### 사용자 개입(blocked) 규칙
- `npm run test:db`가 테이블·함수·버킷을 찾지 못하면(PostgREST `PGRST202`·`PGRST205`, Postgres `42883`·`42P01`, Storage `Bucket not found`) 코드를 고치지 말고 blocked: `"dev DB에 6-upload-store 마이그레이션이 없음: 사용자가 supabase db push --linked 확인 필요"`.
- 네트워크로 dev 프로젝트에 닿지 않으면 blocked: `"dev Supabase 프로젝트 연결 실패(일시 정지 여부 확인 필요)"`.
- RPC가 예상과 다른 kind를 돌려주거나 SQL 런타임 에러가 나면 마이그레이션을 고치지 말고 blocked(사유에 RPC 이름과 에러 코드만).

## 금지사항

- 실제 PDF 원본(`~/Downloads/*.pdf` 등)을 테스트·fixture로 복사하거나 커밋하지 마라. 이유: 실제 개인 카드 데이터다. DB 통합 테스트는 합성 `ParseSuccess`를 쓴다.
- 실제 Anthropic API를 부르지 마라. 이유: 테스트는 mock 분류기로 충분하고 키가 없다.
- `supabase/migrations/`를 고치거나 `supabase db push`·`db reset`·`db query`·`link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 이번 phase는 스키마 변경이 없고, 공유 dev DB 변경은 사용자가 한다.
- ingest가 불명확할 때(throw·not_processing) `failUpload`·`deleteUpload`를 부르지 마라. 이유: 커밋됐을 수 있는 완료 거래를 잃는다(ADR-008).
- 로그·에러에 가맹점명·파일명·거래 값을 넣지 마라. 이유: CLAUDE.md CRITICAL.
- 순수 레이어(`lib/retention.ts`)에서 Date 객체·`Date.now()`·env를 쓰지 마라. 이유: CLAUDE.md 규칙, 기준일은 `today` 인자로 받는다.
- Route Handler·화면을 만들지 마라. 이유: 다음 step에서 만든다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
