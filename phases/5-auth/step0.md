# Step 0: supabase-session

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("디렉토리 구조", "모드 · 환경", "보안"의 인증·CSRF 항목)
- `/docs/ADR.md` (ADR-002, ADR-020, ADR-021)
- 기존 코드: `/src/lib/env.ts`·`/src/lib/env.test.ts`(lazy 검증 패턴), `/src/lib/origin.ts`, `/vitest.config.ts`(`server-only`는 테스트에서 빈 모듈로 alias), `/package.json`
- Next.js 16 proxy 문서: `/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
- 패키지 설치 후 `/node_modules/@supabase/ssr/README.md`와 타입 정의(`createServerClient`의 `cookies.getAll`·`setAll` 시그니처)

기존 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

Supabase는 클라우드 dev 프로젝트에 URL·publishable key로 연결한다(로컬 Docker 없음, ADR-020). 로그인은 서버에서 시작하고 브라우저용 Supabase 클라이언트는 두지 않는다(ADR-021). 이 step은 서버에서 쓸 Supabase 클라이언트와 세션 갱신 proxy만 만든다. 로그인 라우트·화면·`requireUser`는 다음 step에서 만든다. 테이블은 만들지 않는다(upload phase).

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook이 테스트 없는 구현 파일 작성을 막는다).

## 작업

### 1. 패키지
- `npm install @supabase/ssr@^0.12.7 @supabase/supabase-js@^2.117.3` (dependencies).

### 2. `src/lib/env.ts`에 Supabase 공개 설정 추가
```ts
export type SupabaseEnv = { url: string; publishableKey: string }
export function getSupabaseEnv(): SupabaseEnv
```
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 호출할 때마다 읽는다(모듈 로드 시점에 읽거나 throw하지 않는다. 빌드는 env 없이 통과해야 한다).
- `process.env.NEXT_PUBLIC_SUPABASE_URL`처럼 이름을 그대로 쓴다. 이유: Next.js는 `NEXT_PUBLIC_*`를 빌드 때 이 표현식 그대로 치환한다.
- zod로 검증한다. URL은 `http:`·`https:` URL, 키는 비어 있지 않은 문자열. 빈 문자열은 없는 값으로 본다(기존 `emptyAsUndefined`).
- 실패하면 기존 `getDeploymentEnv`처럼 **변수 이름만** 메시지로 throw한다(`"NEXT_PUBLIC_SUPABASE_URL"`, 둘 다면 `", "`로 잇는다). 값은 메시지에 넣지 않는다.
- `SUPABASE_SECRET_KEY`는 읽지 않는다(admin 클라이언트는 upload phase).

### 3. `src/lib/supabase/server.ts` (`import 'server-only'`)
```ts
export async function createSupabaseServerClient(): Promise<SupabaseClient>
```
- `@supabase/ssr`의 `createServerClient(url, publishableKey, { cookies: { getAll, setAll } })`. 값은 `getSupabaseEnv()`에서, 쿠키는 `next/headers`의 `await cookies()`에서 가져온다.
- `setAll`은 받은 쿠키를 모두 `cookieStore.set(name, value, options)`로 쓴다. Server Component에서 불리면 Next가 쿠키 쓰기를 막아 throw하므로 try/catch로 삼킨다(세션 갱신은 proxy가 한다). README가 `setAll`의 두 번째 인자(캐시 헤더)를 설명하면 Route Handler·Server Component에서는 쓰지 않아도 된다.
- Database 제네릭 타입은 넣지 않는다(테이블이 아직 없다).

### 4. `src/proxy.ts`
```ts
export async function proxy(request: NextRequest): Promise<NextResponse>
export const config = { matcher: [ /* 정적 파일 제외 */ ] }
```
- README의 Next.js proxy(middleware) 패턴대로 만든다.
  1. `let response = NextResponse.next({ request })`
  2. `createServerClient(url, publishableKey, { cookies: { getAll: () => request.cookies.getAll(), setAll(cookiesToSet, headers?) { … } } })`. `setAll`은 `request.cookies.set(name, value)`로 요청 쿠키를 갱신하고, `response = NextResponse.next({ request })`로 다시 만든 뒤 `response.cookies.set(name, value, options)`로 응답에 쓴다. 두 번째 인자로 캐시 헤더가 오면 응답 헤더에 그대로 넣는다.
  3. `createServerClient`와 `getClaims()` 사이에 다른 코드를 두지 않는다(README 경고).
  4. `await supabase.auth.getClaims()`를 한 번 부른다. 결과로 분기하지 않는다.
  5. `response`를 반환한다.
- 리다이렉트·권한 검사를 하지 않는다. 보호는 페이지·핸들러마다 `requireUser()`가 한다(다음 step).
- matcher는 `_next/static`, `_next/image`, `favicon.ico`, 이미지 확장자(`svg|png|jpg|jpeg|gif|webp|ico`)를 제외한 모든 경로다. matcher는 정적 리터럴이어야 한다.

### 5. 테스트 (먼저 작성)
- `src/lib/env.test.ts`에 `getSupabaseEnv` 케이스 추가: 정상 값 → `{ url, publishableKey }`, 둘 다 없음/빈 문자열 → 메시지가 정확히 변수 이름들, `not-a-url`·`ftp://x` → `NEXT_PUBLIC_SUPABASE_URL`, 에러 메시지에 키 값이 들어 있지 않음, 호출마다 새 값을 읽음. 기존 `beforeEach`의 env 초기화 목록에 두 변수를 추가한다.
- `src/lib/supabase/server.test.ts`: `next/headers`와 `@supabase/ssr`을 `vi.mock`한다. `createServerClient`가 env의 URL·키로 불리고, `getAll`이 쿠키 저장소의 `getAll()`을 돌려주고, `setAll`이 쿠키마다 `set`을 부르고, `set`이 throw해도 `setAll`이 throw하지 않는다.
- `src/proxy.test.ts`: `@supabase/ssr`을 `vi.mock`해 가짜 `createServerClient`가 쿠키 메서드를 잡아 두고 `{ auth: { getClaims } }`를 돌려주게 한다. `getClaims`가 `setAll([{ name: 'sb-test-auth-token', value: 'refreshed', options: { path: '/' } }])`을 부르게 하면 → 응답의 `Set-Cookie`에 `sb-test-auth-token=refreshed`가 있고, 리다이렉트가 아니며(`location` 헤더 없음), `getClaims`가 한 번 불린다. 쿠키 없는 요청도 리다이렉트 없이 통과한다. `config.matcher`가 `_next/static`을 제외한다(정규식으로 `/_next/static/x.js`가 안 맞고 `/dashboard`가 맞는지).
- 테스트에서 env는 `vi.stubEnv`로 넣는다(예: `https://example.supabase.co`, `sb_publishable_test`). 실제 `.env` 값을 쓰거나 출력하지 않는다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 테스트 포함 전체 통과
npm ls @supabase/ssr @supabase/supabase-js
grep -qE "^import ['\"]server-only['\"]" src/lib/supabase/server.ts
test -f src/proxy.ts && ! test -f src/middleware.ts
! grep -rnE "redirect|console\." src/proxy.ts
! grep -rnE "createBrowserClient|SUPABASE_SECRET_KEY|getSession\(" src --include='*.ts' --include='*.tsx'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/supabase/server.ts`, `src/proxy.ts`)
   - ADR 기술 스택을 벗어나지 않았는가? (`@supabase/ssr`·`@supabase/supabase-js`만 추가)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (proxy는 세션 갱신만, 로그에 쿠키·토큰 없음, env는 `lib/env.ts`에서 lazy 검증)
3. 결과에 따라 `phases/5-auth/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 설치한 두 패키지 버전, `getSupabaseEnv`·`createSupabaseServerClient`·`proxy` 시그니처와 파일 경로, matcher 요약을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (API 키, 외부 인증, 수동 설정 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 브라우저용 Supabase 클라이언트(`createBrowserClient`, `src/lib/supabase/browser.ts`)를 만들지 마라. 이유: 로그인은 서버에서 시작한다(ADR-021).
- proxy에서 리다이렉트하거나 로그인 여부로 분기하지 마라. 이유: proxy는 세션 갱신만 하고, 권한은 보호 페이지·핸들러마다 다시 확인한다(AGENTS.md CRITICAL).
- `auth.getSession()`으로 사용자를 판단하지 마라. 이유: 쿠키의 JWT 서명을 검증하지 않는다. `getClaims()`를 쓴다.
- `SUPABASE_SECRET_KEY`·admin 클라이언트를 만들지 마라. 이유: 서버 쓰기는 upload phase에서 만든다.
- `supabase/` 폴더(config.toml·migrations)를 만들거나 고치지 마라. 이유: 인증 설정은 대시보드에서 관리하고(ADR-020), 테이블은 upload phase에서 만든다.
- `.env`를 읽어 출력하거나 고치지 마라. 이유: 실제 키가 들어 있다.
- 쿠키 값·토큰·Supabase 에러 메시지를 `console.*`로 남기지 마라. 이유: 로그에는 코드와 id만 남긴다.
- 로그인 라우트·화면·`requireUser`를 만들지 마라. 다음 step에서 한다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
