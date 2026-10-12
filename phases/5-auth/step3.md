# Step 3: auth-pages

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("컴포넌트"의 버튼, "화면별 요소"의 로그인 화면·구글 로그인 버튼·대시보드 헤더·워드마크, "레이아웃", "타이포그래피", "문구", "디자인 시스템과 다르게 정한 것")
- `/docs/UX_GUIDE.md` ("가입 (`/login`)", "문구", "5. 접근성", "화면 체크리스트")
- `/docs/USER_FLOW.md` ("① 진입 · 인증 · 분기")
- `/docs/ADR.md` (ADR-021)
- 기존 코드: `/src/app/demo/page.tsx`(헤더·워드마크 링크 패턴), `/src/app/demo/page.test.tsx`(async 페이지 테스트 패턴), `/src/components/button-styles.ts`, `/src/components/wordmark.tsx`, `/src/components/icons.tsx`
- 이전 step 산출물: `/src/lib/auth.ts`, `/src/lib/errors/messages.ts`, `/src/types/auth.ts`, `/src/app/auth/*/route.ts`와 각 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

사용자가 보는 로그인 화면과, 로그인 뒤 도착하는 보호 페이지를 만든다. 랜딩·데모의 가입 링크는 이미 `/login`을 가리키고, `next`가 없으면 `/dashboard`로 돌아간다. `/dashboard`의 온보딩·업로드는 upload phase에서 만들고, 이 step의 `/dashboard`는 로그인 확인과 로그아웃만 있는 최소 화면이다.

화면 관점(UX_GUIDE 프로 팁 1): 가입 단계 · "구글로 금방 시작할 수 있나, 무엇을 넘기나" · 다음 단계 "Google로 계속하기".

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook. `page.tsx`는 예외지만 `page.test.tsx`를 함께 만든다).

## 작업

### 1. `src/components/google-sign-in-button.tsx`
```tsx
export function GoogleSignInButton(): React.JSX.Element
```
- `<button type="submit">`. DESIGN "구글 로그인 버튼": `group inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-[#747775] bg-white px-5 text-base font-medium text-[#1F1F1F] transition-[background-color,transform] duration-120 ease-standard hover:bg-surface-soft active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.
- 글자 앞에 Google 표준 "G" 로고 SVG(18px, `aria-hidden="true"`, 4색 `#EA4335` · `#4285F4` · `#FBBC05` · `#34A853`, viewBox 비율 유지). 색·비율을 바꾸지 않는다. 이 로고는 이 컴포넌트 파일 안에 둔다(`icons.tsx`는 `currentColor` 단색 규칙이라 넣지 않는다).
- 문구는 `Google로 계속하기`.
- 서버 컴포넌트로 둔다(`'use client'` 없음).

### 2. `src/app/login/page.tsx`
```tsx
export const metadata = { title: '로그인 · assetomy' }
export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>
}): Promise<React.JSX.Element>
```
- `const next = safeNextPath(params.next)`. `await getSessionUser()`가 있으면 `redirect(next)`(이미 로그인한 사용자).
- `parseLoginErrorCode(params.error)`가 코드면 `LOGIN_ERROR_MESSAGES[code]`를 에러 박스로 보여준다. 모르는 값은 무시한다.
- 레이아웃(DESIGN "로그인 화면"):
  - 헤더: `/demo`와 같은 폭·여백으로 워드마크만(`/` 링크, 같은 포커스 링 클래스).
  - 본문 `<main>`: `mx-auto max-w-sm px-4 pt-16 text-center`.
    - `<h1 className="text-title-lg text-ink">구글 계정으로 시작해요</h1>`
    - `<p className="mt-3 text-base text-body">카드번호·계좌·카드사 비밀번호는 받지 않아요</p>`
    - 에러가 있으면 `<p role="alert" className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-danger">{문구}</p>`
    - `<form method="post" action="/auth/login" className="mt-8">` 안에 `<input type="hidden" name="next" value={next} />`와 `<GoogleSignInButton />`.
- 에러 문구는 `lib/errors/messages.ts`에서만 가져온다. 화면에 문구를 직접 적지 않는다.

### 3. `src/app/dashboard/page.tsx`
```tsx
export const metadata = { title: '대시보드 · assetomy' }
export default async function DashboardPage(): Promise<React.JSX.Element>
```
- 맨 처음 `await requireUser('/dashboard')`.
- 레이아웃: `mx-auto max-w-5xl px-4 pb-12 sm:px-6`(DESIGN "레이아웃").
  - 헤더(DESIGN "대시보드 헤더"): 왼쪽 워드마크(`/` 링크), 오른쪽 `<form method="post" action="/auth/logout"><button type="submit" className={buttonClass('secondary', 'sm')}>로그아웃</button></form>`.
  - 본문: `<h1 className="text-title-lg text-ink">아직 올린 이용내역이 없어요</h1>`와 `<p className="mt-3 text-base text-body">카드 이용내역 올리기를 준비하고 있어요.</p>`. 이 본문은 upload phase에서 온보딩으로 바뀐다.
- 사용자 id·이메일을 화면에 보여주지 않는다.

### 4. 테스트 (먼저 작성)
- `src/components/google-sign-in-button.test.tsx`: 이름 `Google로 계속하기`인 버튼, `type="submit"`, `border-[#747775]`·`bg-white`·`h-11` 클래스, SVG가 `aria-hidden`이고 4색 `fill`을 모두 가진다.
- `src/app/login/page.test.tsx`: `@/lib/auth`를 `vi.mock`하되 `safeNextPath`는 실제 구현을 쓴다(`importOriginal`). `next/navigation`의 `redirect`는 표시용 에러를 throw하는 mock. `render(await LoginPage({ searchParams: Promise.resolve({...}) }))`.
  - 기본: h1·안내 문장·버튼이 있고, 폼 `action="/auth/login"`·`method="post"`, hidden `next` 값 `/dashboard`. `role="alert"` 없음. 워드마크 링크 `href="/"`.
  - `next: '/dashboard?month=2026-09'` → hidden 값 그대로. `next: '//evil.com'`·`['/a', '/b']` → `/dashboard`.
  - `error: 'cancelled'`·`'failed'` → alert 문구가 `LOGIN_ERROR_MESSAGES`와 같다. `error: 'zzz'` → alert 없음.
  - 로그인 상태(`getSessionUser`가 `{ id: 'u1' }`) → `redirect('/dashboard?month=2026-09')`가 불린다.
  - 화면 글자에 `!`, `명세서`, `AI가 분석했어요`가 없다.
- `src/app/dashboard/page.test.tsx`: `@/lib/auth`의 `requireUser`를 mock한다. `requireUser('/dashboard')`로 불린다. 로그아웃 버튼이 `action="/auth/logout"`·`method="post"` 폼 안에 있고 `bg-surface-strong`·`h-9` 클래스. h1 문구. `requireUser`가 throw하면(리다이렉트) 페이지도 throw한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 테스트 포함 전체 통과
test -f src/app/login/page.tsx && test -f src/app/dashboard/page.tsx && test -f src/components/google-sign-in-button.tsx
! grep -rnE "'use client'|\"use client\"|dangerouslySetInnerHTML|console\." src/app/login src/app/dashboard src/components/google-sign-in-button.tsx
grep -qE "requireUser\([\"']/dashboard[\"']\)" src/app/dashboard/page.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`app/login`, `app/dashboard`, `components/`)
   - ADR 기술 스택을 벗어나지 않았는가? (새 패키지·아이콘 라이브러리 없음)
   - AGENTS.md CRITICAL 규칙을 위반하지 않았는가? (보호 페이지가 `requireUser()`로 다시 확인, 에러 문구는 `messages.ts`, 클라이언트 컴포넌트 없음)
   - UX_GUIDE "화면 체크리스트" 중 해당 항목(다음 단계가 가장 눈에 띔, 에러에 다음 행동, 키보드로 진행, 금지 문구 없음)을 지키는가?
3. 결과에 따라 `phases/5-auth/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 두 페이지와 버튼 컴포넌트 경로, 화면 문구(h1·버튼·에러), 폼 action을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 구글 버튼을 `buttonClass('primary')`(초록)로 만들거나 G 로고를 단색·다른 색으로 바꾸지 마라. 이유: Google 브랜드 가이드 준수가 OAuth 앱 검증 요건이다(ADR-021).
- 클라이언트 컴포넌트·브라우저 Supabase 클라이언트로 로그인·로그아웃하지 마라. 이유: 폼 POST로 Route Handler에 보낸다(ADR-021).
- `/dashboard`에 온보딩·업로드·차트·데모 fixture를 넣지 마라. 이유: upload·dashboard phase에서 실제 데이터로 만든다.
- 랜딩(`src/app/page.tsx`)·데모(`src/app/demo/page.tsx`)의 링크와 테스트를 바꾸지 마라. 이유: 이미 `/login`을 가리키고, `next`가 없으면 `/dashboard`로 간다.
- `scripts/browser-test/`와 `docs/testing/`을 고치지 마라. 이유: phase가 끝난 뒤 브라우저 테스트를 돌리며 함께 갱신한다.
- 사용자 id·이메일을 화면이나 로그에 남기지 마라.
- 이전 step의 시그니처를 바꾸지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
