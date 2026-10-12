# Step 1: auth-core

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("디렉토리 구조", "보안"의 인증 항목)
- `/docs/ADR.md` (ADR-021)
- `/docs/USER_FLOW.md` ("① 진입 · 인증 · 분기"의 (A) 인증 게이트)
- `/docs/DESIGN.md` ("문구", "화면별 요소"의 로그인 화면)
- 이전 step 산출물: `/src/lib/supabase/server.ts`(`createSupabaseServerClient`), `/src/lib/env.ts`, `/src/proxy.ts`와 각 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

로그인 흐름에서 여러 곳이 같이 쓰는 규칙을 한 곳에 둔다: 로그인 후 돌아갈 경로(`next`) 검사, 세션 사용자 조회, 보호 페이지의 로그인 강제, 로그인 에러 코드와 사용자 문구. 라우트·화면은 다음 step에서 만든다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook).

## 작업

### 1. `src/types/auth.ts`
```ts
export type SessionUser = { id: string }
export type LoginErrorCode = 'cancelled' | 'failed'
```
- `cancelled`: 구글 동의 화면에서 취소. `failed`: 그 밖의 모든 실패(코드 없음, 교환 실패, OAuth 시작 실패).

### 2. `src/lib/errors/messages.ts`
```ts
export const LOGIN_ERROR_MESSAGES: Record<LoginErrorCode, string>
export function parseLoginErrorCode(value: unknown): LoginErrorCode | null
```
- 문구(그대로 쓴다):
  - `cancelled`: `구글 로그인을 취소했어요. 계속하려면 다시 시도해 주세요.`
  - `failed`: `로그인을 마치지 못했어요. 잠시 후 다시 시도해 주세요.`
- `parseLoginErrorCode`는 값이 정확히 `'cancelled'` 또는 `'failed'` 문자열일 때만 코드를 돌려주고, 배열·다른 문자열·`undefined`는 `null`이다(검색 파라미터 `?error=`를 받는다).
- 이 파일은 사용자에게 보이는 에러 문구를 모으는 곳이다(AGENTS.md). upload phase가 업로드 코드를 여기에 추가한다.

### 3. `src/lib/auth.ts` (`import 'server-only'`)
```ts
export const DEFAULT_NEXT_PATH = '/dashboard'
export function safeNextPath(value: unknown): string
export function loginPath(next: string, error?: LoginErrorCode): string
export async function getSessionUser(): Promise<SessionUser | null>
export async function requireUser(nextPath: string): Promise<SessionUser>
```
- `safeNextPath`: 아래를 모두 만족하는 문자열만 그대로 돌려주고, 아니면 `DEFAULT_NEXT_PATH`.
  - `/`로 시작한다. `//`로 시작하지 않는다. `\`가 어디에도 없다. 제어 문자(`\u0000-\u001F`, `\u007F`)가 없다.
  - 경로 부분(`?`·`#` 앞)이 `/login`이거나 `/login/`으로 시작하지 않고, `/auth/`로 시작하지 않는다. 이유: 로그인 화면은 이미 로그인한 사용자를 `next`로 보내므로, `next=/login`이면 무한 리다이렉트가 생긴다.
  - 쿼리는 유지한다(`/dashboard?month=2026-09` → 그대로).
- `loginPath(next, error?)`: `/login?next=<encodeURIComponent(next)>`, error가 있으면 `&error=<code>`를 붙인다. 예: `loginPath('/dashboard?month=2026-09', 'failed')` → `/login?next=%2Fdashboard%3Fmonth%3D2026-09&error=failed`. 사이트 Origin은 붙이지 않는다(호출자가 붙인다).
- `getSessionUser`: `createSupabaseServerClient()` → `auth.getClaims()`. 에러가 있거나 `data?.claims?.sub`가 문자열이 아니면 `null`, 아니면 `{ id: claims.sub }`. 에러 내용을 로그로 남기지 않는다.
- `requireUser(nextPath)`: `getSessionUser()`가 `null`이면 `next/navigation`의 `redirect(loginPath(safeNextPath(nextPath)))`, 아니면 사용자를 돌려준다. 보호 페이지가 자기 경로를 넘긴다(예: `requireUser('/dashboard')`). Route Handler는 upload phase에서 `getSessionUser()`로 401을 돌려준다.
- 사용자 ID는 이 함수들로만 얻는다(AGENTS.md CRITICAL: 세션의 `getClaims()`에서만).

### 4. 테스트 (먼저 작성)
- `src/lib/errors/messages.test.ts`: 두 코드 파싱, `['failed']`·`'FAILED'`·`'x'`·`undefined`·`''` → `null`. 두 문구에 `다시 시도`가 있고 `!`가 없다.
- `src/lib/auth.test.ts`: `@/lib/supabase/server`와 `next/navigation`(`redirect`가 표시용 에러를 throw)을 `vi.mock`한다.
  - `safeNextPath` 표: 허용 `/dashboard`, `/dashboard?month=2026-09`, `/settings#x`, `/` / 거절 `undefined`, `''`, `['/dashboard']`, `dashboard`, `//evil.com`, `/\\evil.com`, `https://evil.com`, `/dash\nboard`, `/login`, `/login?next=/x`, `/login/x`, `/auth/callback`, `/auth/login`. 거절은 모두 `/dashboard`.
  - `loginPath` 인코딩 예시 두 개(error 있음·없음).
  - `getSessionUser`: claims 있음 → `{ id }`, `error` 있음 → `null`, `data: null` → `null`, `sub` 없음 → `null`.
  - `requireUser`: 사용자 없음 → `redirect('/login?next=%2Fdashboard')`, 위험한 경로를 넘기면 `redirect('/login?next=%2Fdashboard')`, 사용자 있음 → 사용자 반환·`redirect` 안 부름.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 테스트 포함 전체 통과
grep -qE "^import ['\"]server-only['\"]" src/lib/auth.ts
! grep -rnE "console\.|getSession\(" src/lib/auth.ts src/lib/errors
test -f src/types/auth.ts && test -f src/lib/errors/messages.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`lib/auth.ts`, `lib/errors/messages.ts`, `types/auth.ts`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 패키지 없음)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (사용자 ID는 `getClaims()`에서만, 로그에 에러 내용 없음)
3. 결과에 따라 `phases/5-auth/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 파일 경로, 다섯 개 export 시그니처, `LoginErrorCode` 값, `next` 거절 규칙 요약을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `next` 검사에 `new URL(next, origin)`의 결과 origin 비교만 쓰지 마라. 이유: 위 문자열 규칙(`//`·`\`·`/login`·`/auth/` 거절)이 USER_FLOW의 규칙이고, 테스트 표가 그 규칙을 단언한다.
- `requireUser`에서 401 응답을 만들지 마라. 이유: 페이지용이다. Route Handler용 처리는 upload phase에서 `getSessionUser()`로 한다.
- 라우트(`src/app/auth/*`)·화면(`/login`, `/dashboard`)을 만들지 마라. 다음 step에서 한다.
- 이전 step의 시그니처(`getSupabaseEnv`, `createSupabaseServerClient`, `proxy`)를 바꾸지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
