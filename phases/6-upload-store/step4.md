# Step 4: statement-storage

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델"의 storage `statements`, "업로드 흐름", "삭제와 정리", "보안"의 파일)
- `/docs/ADR.md` (ADR-007, ADR-009)
- 이전 step 산출물: `/supabase/migrations/20261013000000_upload_schema.sql`(버킷 `statements`), `/src/lib/crypto.ts`, `/src/lib/env.ts`(`getFileEncryptionKey`), `/src/lib/supabase/admin.ts`, `StoreError` 파일, `/src/lib/supabase/db-test-helpers.ts`, `/vitest.db.setup.ts`와 각 테스트
- `/node_modules/@supabase/storage-js`의 `upload`·`download`·`remove` 타입 정의

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

원본 파일은 서버에서 AES-256-GCM으로 암호화한 뒤에만 Storage에 쓴다. 평문은 메모리에서만 다룬다(AGENTS.md CRITICAL, ADR-007). 이 모듈은 **평문을 받아 안에서 암호화한 뒤 저장하는 함수만** 공개한다. 그래서 이 모듈로는 평문을 저장할 방법이 없다. 경로는 `{userId}/{uploadId}.enc`이고, 같은 문자열을 AAD로 써서 다른 경로로 옮긴 암호문은 복호화되지 않는다. 버킷 `statements`는 private이고 사용자 정책이 없어서 service-role(admin 클라이언트)만 접근한다.

원본 삭제는 DB 커밋 뒤에 시도하고, 실패하면 정기 작업이 지운다(ADR-009). 정기 작업은 뒤 phase에서 만든다. 이 step의 `removeStatements`는 실패를 숨기지 않고 던지고, 호출부(다음 phase)가 best-effort로 다룬다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. `src/lib/store/statements.ts` (`import 'server-only'`)
```ts
export const STATEMENTS_BUCKET = 'statements'
export function statementPath(userId: string, uploadId: string): string      // `${userId}/${uploadId}.enc`
export async function saveStatement(userId: string, uploadId: string, plaintext: Uint8Array): Promise<void>
export async function removeStatements(paths: string[]): Promise<void>
```
- `statementPath`: `userId`·`uploadId`가 소문자 UUID 형식이 아니면 throw한다. 이유: 경로 조작(`../`, `/`)을 막는다.
- `saveStatement`:
  1. `path = statementPath(userId, uploadId)`
  2. `payload = encryptStatement(plaintext, getFileEncryptionKey(), path)`
  3. `createSupabaseAdminClient().storage.from(STATEMENTS_BUCKET).upload(path, payload, { contentType: 'application/octet-stream', upsert: false })`
  4. 에러면 `StoreError`(operation `statements.upload`, code는 Storage 에러의 상태 코드나 이름. 메시지 없음)를 던진다.
- `removeStatements`: 빈 배열이면 호출하지 않는다. 모든 경로가 `statementPath` 형식인지 확인한 뒤 `remove(paths)`. 에러면 `StoreError`(operation `statements.remove`).
- 복호화해서 읽는 함수(`loadStatement`)는 만들지 않는다. 이유: 저장된 원본을 다시 읽는 곳은 fallback-mapping phase의 "이대로 읽기"뿐이고, 그때 추가한다.

### 2. 테스트 (먼저 작성)
- 단위 `src/lib/store/statements.test.ts` (`@/lib/supabase/admin`을 `vi.mock`, `vi.stubEnv('FILE_ENCRYPTION_KEY', randomBytes(32).toString('base64'))`):
  - `statementPath`가 `<uuid>/<uuid>.enc`. `../x`, 대문자, 빈 문자열, `a/b` → throw.
  - `saveStatement`가 `upload`를 정확히 한 번, 버킷 `statements`·경로·`contentType: 'application/octet-stream'`·`upsert: false`로 부른다.
  - 넘긴 바이트가 평문과 다르고, 평문의 64바이트 고유 패턴을 포함하지 않으며, `decryptStatement(넘긴 바이트, 키, 경로)`가 평문과 같다.
  - 잘못된 id면 `upload`를 부르지 않는다. 키가 없으면 `FILE_ENCRYPTION_KEY` 에러이고 `upload`를 부르지 않는다.
  - Storage 에러 `{ message: '비밀 파일명.pdf', statusCode: '409' }` → `StoreError`이고, 에러 어디에도 `비밀 파일명`이 없다.
  - `removeStatements([])`는 `remove`를 부르지 않는다. 잘못된 경로가 섞이면 throw하고 `remove`를 부르지 않는다.
- DB 통합 `src/lib/store/statements.db.test.ts` (실제 dev 버킷, `createTestUser`로 만든 사용자 id, `randomUUID()` 업로드 id):
  - `saveStatement` 뒤 admin 클라이언트로 `download`한 바이트가 평문과 다르고, `decryptStatement`로 평문이 나온다.
  - 같은 경로로 다시 `saveStatement` → `StoreError`(덮어쓰지 않음).
  - `removeStatements([path])` 뒤 `download`가 실패한다.
  - `afterAll`에서 남은 객체를 지우고 사용자를 지운다(사용자를 지워도 Storage 객체는 지워지지 않는다).

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase 불필요)
npm run test:db   # dev DB·Storage 통합 테스트 통과
test -f src/lib/store/statements.ts && test -f src/lib/store/statements.test.ts && test -f src/lib/store/statements.db.test.ts
! grep -nE "console\.|\.message|upsert: *true|getPublicUrl|createSignedUrl" src/lib/store/statements.ts
test "$(grep -c "encryptStatement(" src/lib/store/statements.ts)" -ge 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - Storage에 쓰는 경로가 `saveStatement` 하나뿐이고, 항상 암호화한 바이트만 쓰는가? (AGENTS.md CRITICAL)
   - 공개 URL·signed URL을 만들지 않는가? (ADR "의도적으로 뺀 것")
   - 에러·로그에 파일명·평문·Supabase 메시지가 없는가?
3. 결과에 따라 `phases/6-upload-store/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 네 export의 시그니처, 경로·AAD 규칙, 에러 operation 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단
   - `npm run test:db`가 버킷을 찾지 못하면(`Bucket not found`) 코드를 고치지 말고 blocked(`"마이그레이션 미적용: 사용자가 'supabase db push --linked'를 실행해야 함"`).

## 금지사항

- 평문을 Storage에 쓰는 함수나 옵션을 만들지 마라(`saveRaw`, `encrypt: false` 등). 이유: 평문 원본을 Storage에 남기지 않는다(AGENTS.md CRITICAL).
- `upsert: true`를 쓰지 마라. 이유: 같은 업로드 경로를 덮어쓰면 이미 처리된 원본이 바뀔 수 있다.
- 공개 URL·signed URL을 만들지 마라. 이유: 브라우저가 Storage에 직접 접근하지 않는다(ADR-007, "의도적으로 뺀 것").
- Storage 버킷·정책을 코드나 SQL로 바꾸지 마라. 이유: 버킷은 step 0 마이그레이션이 만들었고 사용자 정책을 두지 않는다.
- `supabase db push`·`supabase link`를 실행하지 마라. `.env`를 고치거나 출력하지 마라.
- 단위 테스트에서 실제 Supabase를 부르지 마라. DB 통합 테스트에서 임시 사용자 경로 밖의 객체를 만들거나 지우지 마라. 이유: dev 버킷을 함께 쓴다(ADR-020).
- 업로드 API·ingest 흐름을 만들지 마라. 이유: 다음 phase(`7-upload-flow`)에서 만든다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
