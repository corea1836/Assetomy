# Step 2: app-shell

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` (토큰 · 타이포그래피 · "mock 배너" · 금지)
- `/docs/ARCHITECTURE.md` ("모드 · 환경" 절)
- 이전 step에서 만든 파일: `/src/app/layout.tsx`, `/src/app/globals.css`, `/src/app/page.tsx`, `/src/lib/mode.ts`, `/src/lib/mode.test.ts`, `/src/lib/env.ts`, `/vitest.config.ts`와 Vitest 관련 설정 파일, `/package.json`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

디자인 토큰, 글꼴, 루트 레이아웃, mock 배너를 만든다. 랜딩·대시보드 화면은 만들지 않는다.

구현 파일보다 테스트 파일을 먼저 만든다. 이유: TDD guard hook이 같은 폴더에 테스트 파일이 없는 구현 파일 작성을 막는다.

### 1. `src/app/globals.css`
- `docs/DESIGN.md`의 "토큰" 코드 블록(`@import "tailwindcss";`, `@theme { ... }`, `@theme inline { ... }`)을 **그대로** 옮긴다.

### 2. 글꼴
- Pretendard: `pretendard` 패키지를 설치하고 `layout.tsx`에서 `pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css`를 import한다.
- JetBrains Mono: `next/font/google`의 `JetBrains_Mono`를 `weight: '500'`, `variable: '--font-jetbrains-mono'`로 불러오고, `<html>`에 그 `variable` 클래스를 붙인다. 이 CSS 변수는 `globals.css`의 `--font-mono`가 참조한다.

### 3. `src/components/mock-banner.tsx`
```tsx
export function MockBanner(): React.JSX.Element  // props 없음
```
- 문구: `테스트 모드: AI 분석과 결제는 모의로 동작합니다`
- 클래스: `bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900`
- 테스트를 먼저 쓴다: `src/components/mock-banner.test.tsx`에서 위 문구가 렌더링되는지 단언한다. 파일에 `@vitest-environment` 주석 없이 jsdom에서 돌아야 한다(step 0에서 설정한 환경 분리 확인).

### 4. `src/app/layout.tsx`
- `<html lang="ko" className={jetbrainsMono.variable}>`
- `<body className="bg-canvas text-ink font-sans antialiased">`
- `metadata`: `title: "assetomy"`, `description: "계좌 연동 없이, 카드 이용내역 파일만으로 확인할 지출을 찾아줘요."`
- body 맨 위에서 `getMode() === 'mock'`일 때만 `<MockBanner />`를 렌더링한다.

### 5. `src/app/page.tsx`
- placeholder를 유지한다. 필요하면 토큰 클래스만 적용한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # mock-banner.test.tsx 포함 전체 통과
APP_MODE=mock npm run build && grep -rq --include='*.html' "테스트 모드" .next/server/app
APP_MODE=live npm run build && ! grep -rq --include='*.html' "테스트 모드" .next/server/app
grep -q -- '--color-primary: #0B7A5E' src/app/globals.css
grep -q 'pretendardvariable-dynamic-subset.css' src/app/layout.tsx
! grep -rqE 'fonts\.googleapis\.com|cdn\.jsdelivr' src
! grep -rq 'prefers-color-scheme' src
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/components/`는 DTO·props만 받는다)
   - ADR 기술 스택과 DESIGN.md 규칙을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-foundation/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 토큰·글꼴 적용 위치와 mock 배너를 띄우는 방식을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단. 빌드 중 Google Fonts 다운로드가 네트워크 문제로 실패하면 우회하지 말고 여기에 해당한다.

## 금지사항

- `MockBanner` 안에서 `getMode()`를 호출하지 마라. 이유: `components/`는 props만 받고, 표시 여부는 layout이 정한다.
- DESIGN.md의 토큰 값을 바꾸거나 새 토큰을 추가하지 마라. 이유: 화면 규칙의 단일 출처는 DESIGN.md다.
- 런타임에 외부 CDN에서 글꼴을 받지 마라(`fonts.googleapis.com` `<link>`, jsdelivr 등). 이유: DESIGN.md 규칙이다. `next/font/google`은 빌드 때 받아 self-host하므로 허용된다.
- Pretendard 전체 woff2(`pretendardvariable.css` 등)를 import하지 마라. 이유: 약 2MB다. dynamic-subset만 쓴다.
- `prefers-color-scheme: dark` 스타일이나 `dark:` 변형을 넣지 마라. 이유: 라이트 모드 고정이다.
- 랜딩·데모·대시보드 UI, `@vercel/analytics`를 추가하지 마라. 이유: 이후 phase의 범위다.
- 기존 테스트를 깨뜨리지 마라
