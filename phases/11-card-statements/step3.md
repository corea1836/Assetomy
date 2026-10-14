# Step 3: statement-ingest

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("업로드 흐름", "데이터 모델"의 청구서 교체, "삭제와 정리", "API")
- `/docs/ADR.md` (ADR-006, ADR-008, ADR-009, **ADR-023**)
- `/docs/USER_FLOW.md` ("② 첫 업로드"의 파일별 결과)
- 이전 step 산출물:
  - `/supabase/migrations/20261017000000_card_statements.sql`: `ingest_upload(..., p_issuer, p_product_name, p_statement_date, p_statement_saved_at)`의 결과 — done·no_new에 `statement_date`·`replaced_upload_id`, `{"kind":"card_mismatch","reason":"issuer"|"product"}`, `{"kind":"older_statement"}`
  - `/src/types/parsing.ts`(`ParseSuccess.issuer`·`statement: { date, productName, savedAt }`), `/src/types/card.ts`
- `/src/types/upload.ts`
- `/src/lib/store/uploads.ts`·`uploads.test.ts`·`uploads.db.test.ts`, `/src/lib/store/statements.ts`(`removeStatements`·`statementPath`)
- `/src/lib/queries/uploads.ts`·`uploads.test.ts`
- `/src/lib/ingest/process-upload.ts`·`process-upload.test.ts`·`process-upload.db.test.ts`
- `/src/app/api/uploads/route.ts`·`route.test.ts`, `/src/app/api/uploads/[id]/route.ts`(커밋 후 원본 삭제를 시도하고 실패는 넘기는 방식)
- `/src/lib/errors/messages.ts`
- `/src/components/upload/upload-panel.tsx`·`upload-panel.test.tsx`(응답 스키마 `uploadSchema`, `resultLine`, `errorAction`), `/src/lib/format.ts`
- `/docs/DESIGN.md` ("업로드 상태 행")

## 배경

파서가 읽은 카드사·카드 상품명·청구서 결제일·PDF 저장 시각을 ingest RPC로 넘기고, RPC의 새 결과를 API까지 이어 준다(ADR-023).

- RPC가 같은 카드·같은 결제일의 이전 done 업로드를 교체하면 `replaced_upload_id`를 돌려준다. DB 커밋 뒤 그 업로드의 암호화 원본(`statements/{uid}/{replacedId}.enc`)을 지운다. 지우지 못해도 업로드는 성공이다(업로드 행이 없는 원본은 나중의 정기 정리가 지운다).
- 이전 파일보다 일찍 저장된 파일이면 RPC는 `older_statement`를 돌려주고 거래를 넣지 않는다. 사용자에게는 실패가 아니라 결과 안내다("더 최근에 받은 명세서가 이미 있어요").
- 파일의 카드사·상품명이 카드와 다르면 `card_mismatch`(reason `issuer`·`product`)다. 사용자가 카드를 다시 고르게 한다.

## 작업

### 1. 타입 `src/types/upload.ts`

- `UploadSummary`에 `statementDate: IsoDate | null`을 더한다.
- `IngestUploadInput`에 `issuer: CardIssuer | null; productName: string | null; statementDate: IsoDate | null; statementSavedAt: string | null`을 더한다.
- `export type CardMismatchReason = "issuer" | "product";`
- `IngestUploadResult`: done·no_new를 `({ kind: "done" | "no_new" } & UploadSummary & { replacedUploadId: string | null })`로 바꾸고 `{ kind: "card_mismatch"; reason: CardMismatchReason }`, `{ kind: "older_statement" }`를 더한다.
- `ProcessUploadOutcome`: done·no_new를 `({ kind: "done" | "no_new"; uploadId: string; replaced: boolean } & UploadSummary)`로 바꾸고 `{ kind: "card_mismatch"; uploadId: string; reason: CardMismatchReason }`, `{ kind: "older_statement"; uploadId: string }`를 더한다.
- `UploadResultDto`: done·no_new에 `replaced: boolean`(그리고 `UploadSummary`의 `statementDate`)이 실리고, `{ kind: "older_statement" }`를 더한다.
- `ApiErrorCode`에 `"CARD_MISMATCH"`를 더한다.

### 2. store `src/lib/store/uploads.ts`

- `ingestUpload`가 `p_issuer`, `p_product_name`, `p_statement_date`, `p_statement_saved_at`를 넘긴다(null은 그대로).
- 결과 스키마: done·no_new에 `statement_date: z.iso.date().nullable()`, `replaced_upload_id: z.uuid().nullable()`을 읽어 `statementDate`·`replacedUploadId`로 바꾼다. `card_mismatch`는 `reason: z.enum(["issuer", "product"])`, `older_statement`를 더한다.

### 3. query `src/lib/queries/uploads.ts`

`getUploadOutcome`이 `statement_date`도 읽어 done·no_new 기록의 `statementDate`로 돌려준다.

### 4. ingest `src/lib/ingest/process-upload.ts`

- `ProcessUploadDeps`에 `removeStatement(userId: string, uploadId: string): Promise<void>`를 더한다.
- `ingestUpload` 호출에 `issuer: parsed.issuer, productName: parsed.statement.productName, statementDate: parsed.statement.date, statementSavedAt: parsed.statement.savedAt`를 넘긴다.
- 결과 처리:
  - done·no_new: `replacedUploadId`가 있으면 `deps.removeStatement(userId, replacedUploadId)`를 기다리고, 던지면 무시한다(업로드 결과는 그대로). 반환은 `{ kind, uploadId, ...UploadSummary, replaced: replacedUploadId !== null }`(`replacedUploadId`는 밖으로 내보내지 않는다).
  - `card_mismatch` → `{ kind: "card_mismatch", uploadId, reason }`, `older_statement` → `{ kind: "older_statement", uploadId }`.
  - 응답이 불명확해 상태를 다시 읽는 경로(`recoverOutcome`)는 교체 여부를 알 수 없으므로 `replaced: false`이고 원본 삭제를 시도하지 않는다.

### 5. API `src/app/api/uploads/route.ts`

- `removeStatement: (u, id) => removeStatements([statementPath(u, id)])`를 deps로 넘긴다.
- `card_mismatch` → 409 `apiError(409, "CARD_MISMATCH", outcome.reason)`.
- `older_statement` → 200 `{ result: { kind: "older_statement" } }`.
- done·no_new는 지금처럼 `{ result: outcome }`이고 이제 `statementDate`·`replaced`가 실린다.
- 로그는 지금처럼 코드와 id만 남긴다. 상품명·결제일·저장 시각을 로그에 넣지 않는다.

### 6. 문구 `src/lib/errors/messages.ts`

- `UPLOAD_ERROR_MESSAGES.CARD_MISMATCH = "이 카드에 올릴 수 없는 파일이에요. 다른 카드를 골라 주세요."`
- `CARD_MISMATCH`의 reason 문구를 `uploadErrorMessage`가 고르게 한다: `issuer` → `"등록한 카드사와 파일의 카드사가 달라요. 맞는 카드를 고르거나 새 카드를 추가해 주세요."`, `product` → `"이 카드에 처음 올린 명세서와 카드 상품이 달라요. 맞는 카드를 고르거나 새 카드를 추가해 주세요."`
- `UNREADABLE_REASONS.multiple_cards = "여러 카드의 거래가 섞여 있어요. 카드별로 다시 받아 주세요."`

### 7. 업로드 패널 결과 `src/components/upload/upload-panel.tsx`, `src/lib/format.ts`

결과 타입이 바뀌므로 패널의 결과 표시를 같은 step에서 맞춘다(카드 등록 폼은 step 4).

- `src/lib/format.ts`에 `formatStatementDate(date: IsoDate): string`을 더한다: `"2026-10-23"` → `"10월 23일 명세서"`(앞자리 0 없음). 문자열을 잘라 만들고 `Date`를 쓰지 않는다.
- `uploadSchema`: done·no_new에 `statementDate: z.iso.date().nullable()`, `replaced: z.boolean()`을 더하고, `z.object({ kind: z.literal("older_statement") })`를 받는다.
- `resultLine`: done이고 `statementDate`가 있으면 맨 앞에 `"10월 23일 명세서 · "`를 붙인다(나머지 `n건 · 기간 · 지출 …원 · 중복 · 제외`는 그대로). `older_statement`는 `"더 최근에 받은 명세서가 이미 있어요. 이 파일은 저장하지 않았어요"`. no_new·duplicate 문구는 그대로다.
- done이고 `replaced`면 결과 줄 아래에 `<p>`로 `"이전에 올린 같은 명세서를 이 파일로 바꿨어요"`를 둔다(DESIGN "업로드 상태 행", `text-sm text-body`).
- `errorAction`: `CARD_MISMATCH`도 `CARD_NOT_FOUND`·`CARD_SCOPE_MISMATCH`처럼 `카드 다시 고르기`(카드 선택을 비우고 대기로)다.
- 완료 뒤 `router.refresh()` 조건은 지금처럼 done이 하나라도 있을 때다(교체도 done이다. `older_statement`만 있으면 새로고침하지 않는다).

### 8. 테스트 (먼저 작성하고 실패를 확인한 뒤 구현한다)

- `process-upload.test.ts`: ingest 인자에 issuer·productName·statementDate·statementSavedAt이 그대로 실린다. `replacedUploadId`가 있으면 `removeStatement(userId, replacedId)`를 한 번 부르고 `replaced: true`, 없으면 부르지 않고 `replaced: false`. `removeStatement`가 던져도 done 결과. `card_mismatch`·`older_statement` 매핑. 불명확한 응답 뒤 복구 경로는 `replaced: false`이고 `removeStatement`를 부르지 않는다.
- `store/uploads.test.ts`: RPC 인자 이름·값, 새 결과 파싱(교체 id·결제일, `card_mismatch` reason, `older_statement`), 알 수 없는 reason이면 오류.
- `queries/uploads.test.ts`: `statementDate` 매핑.
- `route.test.ts`: 409 `{ error: { code: "CARD_MISMATCH", reason: "product" } }`, 200 `older_statement`, done 본문에 `replaced`·`statementDate`, `processUpload`에 넘긴 `removeStatement`가 `removeStatements([statementPath(userId, id)])`를 부른다.
- `messages` 테스트(있으면 그 파일, 없으면 `src/lib/errors/messages.test.ts`): `CARD_MISMATCH` issuer·product·reason 없음, `UNREADABLE` multiple_cards.
- `upload-panel.test.tsx`: 결과 fixture에 `statementDate`·`replaced`를 넣어 타입을 맞추고, `10월 23일 명세서 · 80건 · …` 결과 줄, 교체 안내 줄, `older_statement` 문구(새로고침 안 함), 409 `CARD_MISMATCH`(reason `issuer`)의 문구와 `카드 다시 고르기`를 확인한다. `format` 테스트에 `formatStatementDate`(`2026-01-05` → `1월 5일 명세서`).
- DB 통합(`store/uploads.db.test.ts` 또는 `process-upload.db.test.ts`, 기존 방식대로 임시 사용자): 같은 카드에 결제일 같은 업로드 두 개(저장 시각 이른 것 → 늦은 것)를 ingest하면 두 번째가 done·`replacedUploadId = 첫 업로드 id`이고 첫 업로드 행이 없다. 이른 저장 시각으로 세 번째를 올리면 `older_statement`. 카드사가 다른 카드에 올리면 `card_mismatch`·`issuer`. 테스트가 만든 Storage 객체는 기존 테스트처럼 지운다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
grep -q '"CARD_MISMATCH"' src/types/upload.ts
grep -q 'removeStatement' src/lib/ingest/process-upload.ts
grep -q 'p_statement_saved_at' src/lib/store/uploads.ts
grep -q 'statement_date' src/lib/queries/uploads.ts
grep -q 'older_statement' src/app/api/uploads/route.ts
grep -q 'multiple_cards' src/lib/errors/messages.ts
! grep -nE 'console\.(log|error|warn)\([^)]*(productName|statementDate|savedAt|statement\.)' src/lib/ingest/process-upload.ts src/app/api/uploads/route.ts
git diff --quiet HEAD -- supabase/ src/lib/parsing src/lib/pdf
test -z "$(git diff --name-only HEAD -- src/components | grep -v '^src/components/upload/upload-panel')"
grep -q 'formatStatementDate' src/lib/format.ts
grep -q 'older_statement' src/components/upload/upload-panel.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`가 새 `ingest_upload` 인자(`p_statement_date` 등)를 찾지 못하는 오류로 실패하면 dev DB에 step 0 마이그레이션이 없는 것이다. `"status": "blocked"`, `"blocked_reason": "dev DB에 20261017000000_card_statements 마이그레이션 push 필요"`로 멈춘다.
2. 아키텍처 체크리스트를 확인한다:
   - 교체된 원본 삭제는 DB 커밋(RPC 응답) 뒤에만, 실패해도 결과를 바꾸지 않는가? (ARCHITECTURE "삭제와 정리")
   - 응답이 불명확한 경로에서 업로드·원본을 지우지 않는가? (ADR-008)
   - 로그에 코드와 id만 남기는가?
3. 결과에 따라 `phases/11-card-statements/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`(바뀐 타입·deps `removeStatement`·API 상태 코드·`UploadResultDto` 새 모양·문구, 추가한 테스트 수)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 교체 판단(저장 시각 비교)이나 이전 업로드 삭제를 앱 코드에서 하지 마라. 이유: 사용자 잠금 아래 한 트랜잭션에서 해야 동시 업로드에도 청구서가 하나로 남는다(RPC가 이미 한다).
- 교체된 원본을 RPC 호출 전에 지우지 마라. 이유: RPC가 실패하면 이전 업로드는 남아 있는데 원본만 사라진다.
- `older_statement`를 4xx 에러로 돌려주지 마라. 이유: 사용자가 할 일이 없는 결과 안내다(USER_FLOW).
- `src/components`에서 `upload-panel.tsx`·`upload-panel.test.tsx` 말고는 고치지 마라. 카드 추가 요청·카드 입력칸도 바꾸지 마라. 이유: 카드 등록 폼은 step 4에서 따로 만든다.
- `supabase/`, `lib/parsing`, `lib/pdf`를 고치지 마라.
- `supabase db push` 등 DB 스키마 명령을 실행하지 마라.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
