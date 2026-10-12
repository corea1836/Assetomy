# Step 2: auth-routes

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("API", "보안"의 인증·CSRF 항목, "모드 · 환경"의 사이트 Origin)
- `/docs/ADR.md` (ADR-020, ADR-021)
- `/docs/USER_FLOW.md` ("① 진입 · 인증 · 분기")
- 기존 코드: `/src/lib/origin.ts`(`getSiteOrigin`, `isAllowedOrigin`)와 테스트
- 이전 step 산출물: `/src/lib/supabase/server.ts`, `/src/lib/auth.ts`, `/src/lib/errors/messages.ts`, `/src/types/auth.ts`와 각 테스트
- `/node_modules/@supabase/supabase-js`의 `signInWithOAuth`·`exchangeCodeForSession`·`signOut` 타입 정의

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

구글 로그인은 서버에서 PKCE로 시작한다(ADR-021). `/login`의 HTML 폼이 `POST /auth/login`으로 `next`를 보내고, 서버 Supabase 클라이언트의 `signInWithOAuth`가 PKCE code verifier를 쿠키에 쓴 뒤 구글 주소를 돌려준다. 구글 → Supabase(`https://<ref>.supabase.co/auth/v1/callback`) → `/auth/callback?code=…&next=…`로 돌아오면 코드를 교환해 세션 쿠키를 쓴다. Supabase 대시보드의 Redirect URLs에는 `http://localhost:3000/auth/callback`, `http://localhost:3100/auth/callback`이 등록돼 있다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `route.test.ts`).

## 작업

모든 리다이렉트 주소는 `getSiteOrigin()` + 경로로 만든 절대 URL이다. 요청 URL의 host로 만들지 않는다. 이유: 사이트 Origin은 `lib/origin.ts` 한 곳에서 정한다(ARCHITECTURE "모드 · 환경").

### 1. `src/app/auth/login/route.ts`
```ts
export async function POST(request: Request): Promise<Response>
```
1. `isAllowedOrigin(request.headers.get('origin'))`가 false면 403 `{ error: { code: 'FORBIDDEN' } }`.
2. `content-type`의 미디어 타입(`;` 앞, 소문자)이 `application/x-www-form-urlencoded`가 아니면 400 `{ error: { code: 'BAD_REQUEST' } }`.
3. `const next = safeNextPath((await request.formData()).get('next'))`.
4. `redirectTo = \`${getSiteOrigin()}/auth/callback?next=${encodeURIComponent(next)}\``.
5. `createSupabaseServerClient()` → `auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
6. 에러가 있거나 `data.url`이 없으면 303 → `getSiteOrigin() + loginPath(next, 'failed')`.
7. 성공이면 `NextResponse.redirect(data.url, 303)`. 이유: `signInWithOAuth`가 `cookies()`로 쓴 code verifier 쿠키가 이 응답에 실려야 콜백에서 교환할 수 있다.

### 2. `src/app/auth/callback/route.ts`
```ts
export async function GET(request: Request): Promise<Response>
```
- 검색 파라미터 `code`, `error`, `next`를 읽고 `next = safeNextPath(next)`.
- `error`가 있으면 코드 교환을 하지 않는다. `error === 'access_denied'`면 `cancelled`, 그 밖은 `failed` → 302 `getSiteOrigin() + loginPath(next, code)`.
- `code`가 없으면 `failed`.
- `auth.exchangeCodeForSession(code)`가 에러면 `failed`, 성공이면 302 `getSiteOrigin() + next`.
- `error_description`이나 Supabase 에러 메시지를 응답·로그에 넣지 않는다.

### 3. `src/app/auth/logout/route.ts`
```ts
export async function POST(request: Request): Promise<Response>
```
- login과 같은 Origin(403)·content-type(400) 검사.
- `auth.signOut({ scope: 'local' })`. 이유: 이 기기의 세션만 끝낸다.
- 성공이면 303 → `getSiteOrigin() + '/'`. 에러면 303 → `getSiteOrigin() + '/dashboard'`(세션이 남았으니 대시보드에 머물러 다시 시도할 수 있다).

### 4. 테스트 (먼저 작성)
각 폴더에 `route.test.ts`. `@/lib/supabase/server`를 `vi.mock`해 가짜 `auth` 메서드를 넣는다. env는 `vi.stubEnv('VERCEL_ENV', undefined)`, `vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')`.
요청은 `new Request('http://localhost:3000/auth/login', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ next }) })`처럼 만든다.
- login
  - Origin 없음 · `https://evil.example` · `http://localhost:3100` → 403, `signInWithOAuth` 안 부름.
  - `application/json` · content-type 없음 → 400.
  - `next=/dashboard?month=2026-09` → `signInWithOAuth`가 `{ provider: 'google', options: { redirectTo: 'http://localhost:3000/auth/callback?next=%2Fdashboard%3Fmonth%3D2026-09' } }`로 불림, 303, `location`이 가짜 `data.url`.
  - `next` 없음 · `//evil.com` · `/login` → redirectTo의 next가 `%2Fdashboard`.
  - `signInWithOAuth`가 에러 → 303 `http://localhost:3000/login?next=%2Fdashboard&error=failed`. 응답 본문에 에러 메시지가 없다.
- callback
  - `?code=abc&next=%2Fdashboard%3Fmonth%3D2026-09` → `exchangeCodeForSession('abc')`, 302 `http://localhost:3000/dashboard?month=2026-09`.
  - 요청 URL이 `http://evil.example/auth/callback?code=abc`여도 `location`이 `http://localhost:3000/`로 시작한다.
  - `?error=access_denied&error_description=x` → 교환 안 부름, `…/login?next=%2Fdashboard&error=cancelled`. `location`에 `error_description` 값이 없다.
  - `?error=server_error` → `error=failed`. code 없음 → `failed`. 교환 에러 → `failed`. `next=//evil.com` → 성공 시 `http://localhost:3000/dashboard`.
- logout
  - 403·400 케이스는 login과 같다(`signOut` 안 부름).
  - 성공 → `signOut({ scope: 'local' })`, 303 `http://localhost:3000/`. 에러 → 303 `http://localhost:3000/dashboard`.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 테스트 포함 전체 통과
test -f src/app/auth/login/route.ts && test -f src/app/auth/callback/route.ts && test -f src/app/auth/logout/route.ts
! grep -rnE "console\.|error_description|\.message|request\.url\)\.origin|getSession\(" src/app/auth --include='route.ts'
! grep -rnE "export (async )?function (GET|PUT|DELETE|PATCH)" src/app/auth/login/route.ts src/app/auth/logout/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md의 API 표(`POST /auth/login`, `GET /auth/callback`, `POST /auth/logout`)와 일치하는가?
   - ADR 기술 스택을 벗어나지 않았는가? (새 패키지 없음, 브라우저 Supabase 클라이언트 없음)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (POST는 Origin 정확 일치, 로그에 에러 내용 없음, 리다이렉트는 내부 경로만)
3. 결과에 따라 `phases/5-auth/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 세 라우트의 경로·메서드·상태 코드·리다이렉트 규칙을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 로그인 시작을 GET으로 만들지 마라. 이유: 상태(code verifier 쿠키)를 쓰는 요청이라 폼 POST + Origin 검사로 받는다(ADR-021).
- Server Action으로 만들지 마라. 이유: 쓰기 패턴은 Route Handler로 통일한다(ADR-001).
- 리다이렉트 주소를 `request.url`이나 `Host` 헤더로 만들지 마라. 이유: 사이트 Origin은 `getSiteOrigin()` 한 곳에서 정한다.
- `error_description`, Supabase `error.message`를 응답·로그·리다이렉트 URL에 넣지 마라. 이유: 로그와 사용자에게는 코드만 보낸다(AGENTS.md CRITICAL).
- 실제 Supabase 프로젝트를 부르는 테스트를 만들지 마라. 이유: 단위 테스트는 Supabase 없이 돈다(ADR-015).
- 화면(`/login`, `/dashboard`)을 만들지 마라. 다음 step에서 한다.
- 이전 step의 시그니처를 바꾸지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
