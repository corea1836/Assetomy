# Step 2: file-crypto

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델"의 storage `statements`, "보안"의 파일, "모드 · 환경"의 env)
- `/docs/ADR.md` (ADR-007)
- 기존 코드: `/src/lib/env.ts`와 `/src/lib/env.test.ts` (lazy 검증, 실패 시 변수 이름만 throw하는 패턴)
- `/.env.example`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

원본 파일은 서버에서 AES-256-GCM으로 암호화한 뒤에만 Storage에 쓴다(AGENTS.md CRITICAL, ADR-007). 키는 환경변수 `FILE_ENCRYPTION_KEY`(32바이트를 base64로 인코딩, 서버 전용, 환경별로 따로) 하나다. 파일마다 랜덤 IV를 쓴다. 저장 경로(step 4에서 `{userId}/{uploadId}.enc`)를 AAD로 묶어, 다른 사용자·다른 업로드 경로로 옮긴 암호문은 복호화되지 않게 한다. 이 step은 순수한 암호화 함수와 env 검증만 만든다. Storage 저장은 step 4에서 이 함수를 쓴다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. `src/lib/env.ts`에 추가
```ts
export function getFileEncryptionKey(): Uint8Array
```
- `process.env.FILE_ENCRYPTION_KEY`를 읽어 base64로 디코딩한 결과가 정확히 32바이트일 때만 돌려준다.
- 비어 있거나, base64가 아니거나(디코딩 후 다시 인코딩한 값이 원래 값과 다르면 거절), 길이가 32바이트가 아니면 `new Error('FILE_ENCRYPTION_KEY')`를 던진다. 키 값이나 길이를 메시지에 넣지 않는다.
- 기존 함수처럼 호출할 때만 검증한다(모듈 로드 시 throw 금지).

### 2. `src/lib/crypto.ts` (`import 'server-only'`)
```ts
export function sha256Hex(bytes: Uint8Array): string
export function encryptStatement(plaintext: Uint8Array, key: Uint8Array, aad: string): Uint8Array
export function decryptStatement(payload: Uint8Array, key: Uint8Array, aad: string): Uint8Array
```
- `node:crypto`만 쓴다(새 패키지 없음).
- `sha256Hex`: 소문자 hex 64자. 업로드 `file_hash`에 쓴다.
- 암호문 형식: `[버전 1바이트 = 0x01][IV 12바이트][인증 태그 16바이트][암호문]`.
- `encryptStatement`: `aes-256-gcm`, 호출마다 `randomBytes(12)`로 새 IV, `setAAD(utf8(aad))`. 키가 32바이트가 아니면 throw.
- `decryptStatement`: 길이가 29바이트 미만이거나, 버전이 다르거나, 키·AAD·태그·암호문이 맞지 않으면 `new Error('decrypt_failed')`를 던진다. 원래 에러 메시지를 노출하지 않는다.

### 3. `.env.example`에 추가
`Anthropic` 블록 앞에 아래 블록을 넣는다(값은 비워 둔다).
```
# 원본 파일 암호화 키(AES-256, 32바이트 base64). 환경마다 따로 만들고, 잃으면 저장된 원본을 복구할 수 없습니다.
# 생성: openssl rand -base64 32
FILE_ENCRYPTION_KEY=
```

### 4. 테스트 (먼저 작성)
- `src/lib/env.test.ts`에 추가: 32바이트 base64 → 같은 바이트. 빈 값·없음·`not-base64!`·16바이트·33바이트 → 메시지가 정확히 `FILE_ENCRYPTION_KEY`인 에러. 에러 메시지에 입력 값이 없다.
- `src/lib/crypto.test.ts`:
  - `sha256Hex(utf8('abc'))`가 알려진 값 `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - 왕복: 빈 바이트·1바이트·4MB 크기 → 같은 바이트로 복호화.
  - 같은 평문을 두 번 암호화하면 IV와 결과가 다르다.
  - 암호문 안에 평문 바이트열(예: 64바이트 이상의 고유 패턴)이 들어 있지 않다.
  - 첫 바이트가 `0x01`이고 길이는 평문 + 29.
  - 다른 AAD(`userA/upload1` → `userB/upload1`), 다른 키, 태그 1비트 변조, 암호문 1비트 변조, 버전 바이트 변경, 28바이트 입력 → 모두 `decrypt_failed`.
  - 31바이트 키로 암호화하면 throw.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 테스트 포함 전체 통과
test -f src/lib/crypto.ts && test -f src/lib/crypto.test.ts
grep -q '^FILE_ENCRYPTION_KEY=$' .env.example
grep -qE "^import ['\"]server-only['\"]" src/lib/crypto.ts
! grep -nE "console\.|aes-256-cbc|aes-256-ctr|createCipher\(" src/lib/crypto.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조(`lib/crypto.ts`)를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가? (새 패키지 없음, `node:crypto`만)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (키·평문을 로그·에러 메시지에 넣지 않음)
3. 결과에 따라 `phases/6-upload-store/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 세 함수와 `getFileEncryptionKey`의 시그니처, 암호문 형식, 에러 메시지 규칙을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `.env`를 읽거나 고치지 마라. 이유: 실제 키가 들어 있다. 테스트는 `vi.stubEnv`와 `randomBytes(32)`로 만든 키를 쓴다.
- IV를 고정하거나 키·경로에서 만들지 마라. 이유: GCM에서 같은 키로 IV를 재사용하면 기밀성과 무결성이 깨진다.
- 키에서 다른 키를 파생하거나(KDF), 키 버전·교체 기능을 넣지 마라. 이유: MVP는 키 하나이고 교체가 없다(ADR-007 트레이드오프).
- Storage·DB를 부르는 코드를 만들지 마라. 이유: 저장은 step 4(`statement-storage`)에서 이 함수를 써서 만든다.
- 평문·키·암호문을 `console`이나 에러 메시지에 넣지 마라. 이유: 로그에는 코드와 id만 남긴다(AGENTS.md CRITICAL).
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
