# Step 3: upload-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "업로드 흐름", "API"의 상태 코드, "보안")
- `/docs/ADR.md` (ADR-007, ADR-008, ADR-009, ADR-019, ADR-021)
- 기존 코드: `/src/app/auth/logout/route.ts`와 테스트(Origin·Content-Type 검사, 에러 본문 형식, Route Handler 테스트 패턴), `/src/lib/auth.ts`(`getSessionUser`), `/src/lib/origin.ts`, `/src/lib/supabase/server.ts`, `/src/lib/pdf/read-statement.ts`·`/src/lib/pdf/extract.ts`(pdfjs 경로·cmaps), `/next.config.ts`·`/next.config.test.ts`, `/src/lib/store/*.ts`, `/src/types/upload.ts`, `/src/types/parsing.ts`
- 이전 step 산출물: `/src/services/llm/index.ts`(`getMerchantClassifier`), `/src/lib/queries/*.ts`, `/src/lib/ingest/process-upload.ts`, `/src/lib/retention.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

업로드 API 3개를 만든다. Route Handler는 `requireUser → Origin·입력 검증 → lib 호출 → HTTP 매핑`만 한다(ARCHITECTURE "레이어 규칙").

| 경로 | 역할 |
|---|---|
| `POST /api/cards` | 카드 라벨 등록(JSON) |
| `POST /api/uploads` | multipart `{cardId, file}` → `processUpload` |
| `DELETE /api/uploads/[id]` | 업로드 삭제("틀렸어요") → 원본 삭제 시도 |

- 사용자 ID는 세션(`getSessionUser()` → `getClaims()`)에서만 가져온다. 본문의 user_id·storage_path를 쓰지 않는다. API는 로그인 페이지로 리다이렉트하지 않고 401 JSON을 돌려준다.
- 에러 본문은 `{ error: { code, reason? } }`이고 원문 메시지를 노출하지 않는다. 로그는 코드와 id만 남긴다.
- 이번 phase는 PDF만 받는다(csv·xlsx는 폴백 매핑 phase에서).
- pdfjs-dist는 한글 CID 글꼴을 읽으려면 `cmaps/`가 필요하다. 함수 번들에 cmaps가 빠지면 예외 없이 한글만 사라져 모든 PDF가 `unknown_format`이 된다(실측). 그래서 `next.config`에 번들 설정을 넣고, 빌드 산출물의 trace(`.nft.json`)에 cmaps·worker가 들어갔는지 스크립트로 검증한다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 오늘 날짜 `src/lib/clock.ts`
```ts
export function seoulToday(now?: Date): IsoDate   // Asia/Seoul 기준 'YYYY-MM-DD'
```
- `Intl.DateTimeFormat`(timeZone `Asia/Seoul`)으로 만든다. 순수 레이어가 아니므로 기본값 `new Date()`를 써도 된다. 테스트: `2026-10-12T15:30:00Z` → `2026-10-13`, `2026-10-12T14:59:59Z` → `2026-10-12`.

### 2. API 공통 `src/lib/http.ts` (`import 'server-only'`)
```ts
export type ApiErrorCode =
  | "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND"
  | "INVALID_LABEL" | "DUPLICATE_LABEL"
  | "CARD_NOT_FOUND" | "CARD_SCOPE_MISMATCH" | "UPLOAD_PROCESSING"
  | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE" | "UNREADABLE"
  | "RATE_LIMITED" | "BUSY" | "TEMPORARY_FAILURE";
export function apiError(status: number, code: ApiErrorCode, reason?: string): Response
export function checkMutationRequest(request: Request, mediaType: "application/json" | "multipart/form-data" | null): Response | null
```
- `ApiErrorCode`는 화면에서도 쓰므로 타입은 `src/types/upload.ts`에 두고 `http.ts`는 import한다.
- `checkMutationRequest`: Origin이 `isAllowedOrigin`과 정확히 같지 않으면 403 `FORBIDDEN`. `mediaType`이 있으면 Content-Type의 미디어 타입(파라미터 제외, 소문자)이 정확히 같아야 하고 아니면 400 `BAD_REQUEST`. 통과하면 `null`.
- 순서는 모든 핸들러에서 같다: 세션 없음 401 `UNAUTHORIZED` → Origin 403 → Content-Type 400 → 입력 검증.

### 3. 타입 (`src/types/upload.ts`에 추가)
```ts
export type ApiErrorCode = /* 위 목록 */;
export type ApiErrorBody = { error: { code: ApiErrorCode; reason?: string } };
export type UploadResultDto =
  | ({ kind: "done" | "no_new"; uploadId: string } & UploadSummary)
  | { kind: "duplicate"; existingCardLabel: string | null };
export type CreateCardResponse = { card: CardOption };
export type UploadResponse = { result: UploadResultDto };
```

### 4. `POST /api/cards` (`src/app/api/cards/route.ts`)
- JSON `{ label: string }`(zod, 다른 키 무시). 본문 파싱 실패·형식 오류 → 400 `BAD_REQUEST`.
- `createCard(user.id, label)`: `created` → 201 `{ card: { id, label: 앞뒤 공백을 지운 라벨 } }`, `duplicate_label` → 409 `DUPLICATE_LABEL`, `invalid_label` → 400 `INVALID_LABEL`. 저장 함수 throw → 503 `TEMPORARY_FAILURE`.

### 5. `POST /api/uploads` (`src/app/api/uploads/route.ts`)
- `export const maxDuration = 300;` 이유: lease(6분)보다 짧아야 강제 종료 전에 lease가 남는다(ADR-008).
- 검사 순서: 401 → 403 → `multipart/form-data` 아니면 400 → `Content-Length`가 있고 4MB + 64KB를 넘으면 본문을 읽지 않고 422 `FILE_TOO_LARGE` → `request.formData()` 실패 → 400 → `cardId`가 UUID 문자열이 아니거나 `file`이 `File`이 아니면 400 → `file.size`가 0이면 422 `UNSUPPORTED_FILE`·`empty_file`, 4,194,304바이트 초과면 422 `FILE_TOO_LARGE` → 파일명 확장자가 `.pdf`(대소문자 무시)가 아니면 422 `UNSUPPORTED_FILE`·`not_pdf`.
- 파일명: 앞뒤 공백을 지우고, 비었으면 `statement.pdf`, 255자를 넘으면 확장자를 남기고 255자 이하로 자른다(DB 제약 `1..255`). 경로 구분자는 그대로 저장해도 되지만 저장 경로에는 쓰지 않는다(Storage 경로는 `{userId}/{uploadId}.enc`).
- `processUpload({ userId: user.id, cardId, fileName, bytes }, deps)`. deps는 이 핸들러에서 묶는다:
  - `today: seoulToday()`, 저장 함수(`beginUpload`·`ingestUpload`·`failUpload`·`saveStatement`), `readStatement: readPdfStatement`, `classifier: getMerchantClassifier()`
  - `findMerchantCategories`·`getUploadOutcome`은 `await createSupabaseServerClient()`(세션, RLS)와 `user.id`를 묶은 함수.
- outcome → HTTP:

  | outcome | 응답 |
  |---|---|
  | `done`·`no_new` | 200 `{ result: { kind, uploadId, ...요약 } }` |
  | `duplicate` | 200 `{ result: { kind: "duplicate", existingCardLabel } }` (`listCards`로 라벨 조회, 없거나 조회 실패면 `null`) |
  | `rejected` | 422 `{ error: { code, reason } }` |
  | `card_not_found` | 404 `CARD_NOT_FOUND` |
  | `card_scope_mismatch` | 409 `CARD_SCOPE_MISMATCH` |
  | `rate_limited` · `busy` | 429 `RATE_LIMITED` · `BUSY` |
  | `temporary_failure`, 그 밖의 throw(분류기 키 누락 포함) | 503 `TEMPORARY_FAILURE` |
- 로그: 503·throw일 때만 `console.error("upload:<outcome 또는 에러 클래스 이름>", uploadId ?? "-")` 형식. 파일명·가맹점·에러 메시지를 남기지 않는다.

### 6. `DELETE /api/uploads/[id]` (`src/app/api/uploads/[id]/route.ts`)
- 401 → 403(본문이 없으므로 Content-Type은 보지 않는다, `checkMutationRequest(request, null)`) → `id`가 UUID가 아니면 404 `NOT_FOUND`.
- `deleteUpload(user.id, id)`: `deleted` → `removeStatements([statementPath(user.id, id)])`를 시도하고 실패는 무시(정기 정리가 지운다, ADR-009) → 200 `{ deleted: true }`. `not_found` → 404 `NOT_FOUND`, `processing` → 409 `UPLOAD_PROCESSING`, throw → 503 `TEMPORARY_FAILURE`.
- Next 16 동적 라우트의 `params`는 Promise다(`{ params }: { params: Promise<{ id: string }> }`). 설치된 Next 타입을 확인하라.

### 7. pdfjs 번들 설정과 검증
- `next.config.ts`에 추가하고 `next.config.test.ts`에 단언을 더한다(기존 헤더·`agentRules` 유지):
  ```ts
  serverExternalPackages: ["pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/uploads": [
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
  ```
- `scripts/check-pdf-trace.mjs`(Node 내장 모듈만): 빌드 후 `.next/server/app/api/uploads/route.js.nft.json`을 읽어, `node_modules/pdfjs-dist/cmaps/`의 모든 파일(현재 169개, `UniKS-UCS2-H.bcmap`·`Adobe-Korea1-UCS2.bcmap` 포함)과 `legacy/build/pdf.worker.mjs`·`legacy/build/pdf.mjs`가 trace에 있는지 확인한다. 경로는 nft 파일 위치 기준 상대경로이므로 절대경로로 풀어 비교한다. 빠진 파일이 있으면 개수와 앞의 몇 개 이름을 출력하고 exit 1, 다 있으면 한 줄 요약과 exit 0. trace 파일이 없으면 그 경로를 알려주고 exit 1.
- `package.json` 스크립트는 추가하지 않는다(AC에서 직접 실행).

### 8. 테스트 (먼저 작성)
- `clock.test.ts`: 위 두 경계.
- `http.test.ts`: Origin 누락·`"null"`·다른 Origin → 403, Content-Type `application/json; charset=utf-8` 통과, `text/plain` → 400, `mediaType: null`이면 Content-Type을 보지 않음, 에러 본문 형식.
- Route Handler 테스트(`route.test.ts`, `@/lib/auth`·`@/lib/store/*`·`@/lib/ingest/process-upload`·`@/lib/queries/*`·`@/services/llm`·`@/lib/supabase/server`를 `vi.mock`, 네트워크 없음):
  - 공통: 세션 없음 401(저장 함수 미호출), Origin 다름 403, 잘못된 Content-Type 400.
  - cards: 201·409·400(빈 라벨→`INVALID_LABEL`, JSON 깨짐→`BAD_REQUEST`)·503. `createCard`에 세션 user id가 넘어감(본문에 `userId`를 넣어도 무시).
  - uploads: `Content-Length` 5,000,000 → 422 `FILE_TOO_LARGE`이고 `formData` 미호출. 4MB+1바이트 파일 → 422. `.csv` → 422 `UNSUPPORTED_FILE`·`not_pdf`. 0바이트 → `empty_file`. 잘못된 cardId → 400. 300자 파일명 → `processUpload`에 255자 이하·`.pdf`로 끝나는 이름. outcome 표의 모든 행을 HTTP로 매핑(duplicate의 라벨 조회 포함). `processUpload` throw → 503이고 응답 본문에 에러 메시지가 없음. `maxDuration === 300`.
  - delete: deleted → 200과 `removeStatements`에 `{userId}/{id}.enc`, `removeStatements` throw여도 200, not_found 404, processing 409, UUID 아님 404(삭제 함수 미호출).
- 로그 단언: 503 경로에서 `console.error` 인자에 파일명·에러 메시지가 없다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
node scripts/check-pdf-trace.mjs   # build 뒤 실행. cmaps·worker가 /api/uploads trace에 포함
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase 불필요)
npm run test:db   # 기존 DB 통합 테스트 회귀 없음
test -f src/app/api/cards/route.ts && test -f src/app/api/uploads/route.ts && test -f "src/app/api/uploads/[id]/route.ts"
! grep -rnE "\.message|\.details|\.hint|user_id|storage_path" src/app/api --include='route.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 사용자 ID를 세션에서만 가져오는가? 본문의 user_id·경로를 쓰지 않는가? (CLAUDE.md CRITICAL)
   - 모든 POST/DELETE가 Origin을 검사하고, JSON은 `application/json`만, 업로드는 `multipart/form-data`만 받는가?
   - 에러 응답·로그에 원문 메시지·파일명·가맹점이 없는가?
   - `requireUser`의 리다이렉트 대신 401 JSON을 돌려주는가?
3. 결과에 따라 `phases/7-upload-flow/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 세 경로의 요청·응답 형식, `ApiErrorCode`·DTO 타입 위치, 상태 코드 매핑, `seoulToday`·`checkMutationRequest` 위치, trace 검증 결과(포함 파일 수)를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 요청 본문이나 쿼리의 user_id·storage_path·파일 경로를 DB·Storage 호출에 쓰지 마라. 이유: CLAUDE.md CRITICAL(사용자 ID는 세션에서만).
- `requireUser()`를 API에서 쓰지 마라. 이유: API 호출에 로그인 페이지 리다이렉트(307 HTML)를 돌려주면 클라이언트가 실패를 해석할 수 없다. `getSessionUser()`로 401을 돌려준다.
- 브라우저용 Supabase 클라이언트나 signed URL 업로드를 만들지 마라. 이유: 서버 직접 수신 + 암호화(ADR-007, ADR-021).
- 업로드에 202·상태 폴링·`GET /api/uploads/[id]`를 만들지 마라. 이유: 요청 하나로 수신·처리한다(ADR "의도적으로 뺀 것").
- `POST /api/uploads/[id]/mapping`을 만들지 마라. 이유: 폴백 매핑 phase에서 만든다.
- 응답·로그에 `error.message`, 파일명, 가맹점명, LLM 응답을 넣지 마라. 이유: CLAUDE.md CRITICAL.
- 실제 PDF 원본을 테스트·fixture로 쓰거나 커밋하지 마라. 이유: 개인 카드 데이터다. 필요하면 `src/lib/pdf/test-pdf.ts`의 합성 PDF를 쓴다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
