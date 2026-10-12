# Step 0: visual-foundation

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` (전체. 특히 "금지", "토큰", "색 쓰임", "버튼", "랜딩 → 다크 밴드의 깊이", "모션 · 아이콘 · 접근성")
- `/docs/UX_GUIDE.md` ("유치: 랜딩", "1. 계층 구조")
- `/src/app/globals.css`
- `/src/components/button-styles.ts`, `/src/components/button-styles.test.ts`
- `/src/components/icons.tsx`, `/src/components/icons.test.tsx`
- `/src/components/landing/demo-link.tsx`
- `/src/app/page.tsx`, `/src/app/page.test.tsx`

이전 phase에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

이 phase는 랜딩을 시각적으로 강화한다. 이 step은 뒤 step들이 쓸 토대(토큰·버튼 hover·아이콘·다크 밴드 깊이·등장 모션)를 만들고, 지금 랜딩의 다크 밴드에 적용한다. 구현 파일보다 테스트를 먼저 고친다(TDD).

### 1. 토큰 (`src/app/globals.css`)
DESIGN.md "토큰"의 코드 블록과 같게 맞춘다. 새로 추가하는 것:
- `--color-primary-hover: #096D54;`
- `--color-surface-dark-raised: #1F2228;`
- `--shadow-float: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 24px 48px -12px rgb(0 0 0 / 0.6);`
- `--color-primary-soft` 주석을 DESIGN.md와 같게 고친다.

### 2. 다크 밴드 깊이 (`src/app/globals.css` + `src/components/landing/dark-backdrop.tsx`)
- CSS 클래스 두 개를 정의한다(`@utility` 또는 `@layer components`):
  - `landing-dots`: 24px 간격의 1px 흰 점(불투명도 6%) 반복 무늬. 가운데는 보이고 가장자리로 갈수록 사라지게 `mask-image`를 건다.
  - `landing-light`: `primary-on-dark`(#3DD6A3) 불투명도 8% 이하에서 투명으로 사라지는 radial 하나.
- 서버 컴포넌트(+ `dark-backdrop.test.tsx`):
  ```tsx
  export function DarkBackdrop(props: { light: "right" | "center" }): React.JSX.Element
  ```
  - 밴드 전체를 덮는 `aria-hidden="true"` `pointer-events-none absolute inset-0 -z-10` 레이어 안에 `landing-dots` 레이어 하나와 `landing-light` 레이어 하나를 그린다. `light`는 빛의 위치다(`right`: 오른쪽 그림 뒤, `center`: 가운데 제목 뒤).
  - 쓰는 쪽 `<section>`에는 `relative isolate overflow-hidden`을 준다. 이유: `-z-10` 레이어가 밴드 밖으로 새거나 글자 위로 올라오지 않게 한다.
- 그라데이션 CSS(`radial-gradient` 등)는 `globals.css`의 이 두 클래스 안에만 둔다. `.tsx`에 그라데이션 클래스나 인라인 스타일을 쓰지 않는다.

### 3. 등장 모션 (`src/app/globals.css`)
- 클래스 `reveal`: 화면에 들어올 때 한 번, 불투명도 0→1과 `translate: 0 24px`→제자리. CSS scroll-driven(`animation-timeline: view()`, `animation-range`는 진입 구간)으로만 한다.
- `@media (prefers-reduced-motion: no-preference)`와 `@supports (animation-timeline: view())` 안에서만 애니메이션을 건다. 이유: 동작 줄이기 사용자와 미지원 브라우저에서는 처음부터 보여야 한다. 이 조건 밖에서 `opacity: 0`을 주지 마라.
- 히어로에는 적용하지 않는다(첫 화면). 지금 랜딩에서는 기능 밴드·시작 단계·요금·CTA 밴드의 제목 묶음과 카드 묶음에 `reveal`을 붙인다.

### 4. 버튼 hover (`src/components/button-styles.ts` + 테스트)
DESIGN.md "버튼"을 따른다.
- 공통: `group` 추가.
- Primary: `hover:bg-primary-hover` 추가(기존 `active:bg-primary-active`·`disabled:bg-primary-disabled` 유지).
- Secondary: `hover:bg-hairline`, `disabled:bg-surface-strong` 추가(기존 유지).
- 테스트: 위 클래스가 들어가는지, 기존 단언은 그대로 통과하는지.

### 5. 아이콘 (`src/components/icons.tsx` + 테스트)
기존 `Svg` 헬퍼로 세 개를 추가한다. Lucide 모양이다.
```tsx
export function ArrowRightIcon(props: IconProps): React.JSX.Element  // <path d="M5 12h14" /> <path d="m12 5 7 7-7 7" />
export function SparklesIcon(props: IconProps): React.JSX.Element    // <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" /> <path d="M20 3v4" /> <path d="M22 5h-4" /> <path d="M4 17v2" /> <path d="M5 18H3" />
export function XIcon(props: IconProps): React.JSX.Element           // <path d="M18 6 6 18" /> <path d="m6 6 12 12" />
```
- `icons.test.tsx`의 `it.each` 목록에 세 개를 추가한다.

### 6. 지금 랜딩에 적용 (`src/app/page.tsx` + `page.test.tsx`)
- 히어로 `<section>`: `relative isolate overflow-hidden` + `<DarkBackdrop light="right" />`.
- CTA 밴드 `<section>`: 같은 방식으로 `<DarkBackdrop light="center" />`.
- Pro 가격 카드: `shadow-float` 추가(점·빛은 두지 않는다).
- 히어로 "데모 보기"와 CTA 밴드 "무료로 시작하기" 글자 뒤에 `ArrowRightIcon`(18px, `transition-transform duration-200 ease-standard group-hover:translate-x-1`). 링크의 접근 가능한 이름은 그대로 "데모 보기"·"무료로 시작하기"여야 한다(아이콘은 `aria-hidden`).
- 히어로의 목업 카드는 이 step에서 바꾸지 않는다(step 2에서 바꾼다).
- 테스트에 추가: 히어로와 CTA 밴드 안에 `aria-hidden` 레이어와 `.landing-dots`가 있다, "데모 보기" 링크 안에 `svg[aria-hidden="true"]`가 있다, Pro 카드에 `shadow-float`가 있다, 히어로 밖의 각 밴드에 `reveal`이 있고 히어로 안에는 없다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # 전체 통과
npm run build     # 컴파일 에러 없음
grep -q -- '--color-primary-hover: #096D54' src/app/globals.css
grep -q -- '--color-surface-dark-raised: #1F2228' src/app/globals.css
grep -q -- '--shadow-float' src/app/globals.css
grep -q 'animation-timeline: view()' src/app/globals.css
grep -q 'prefers-reduced-motion' src/app/globals.css
! grep -rnE "gradient|backdrop-blur|blur-|bg-linear|bg-radial|bg-conic" src --include='*.tsx'
! grep -rn "dangerouslySetInnerHTML" src --include='*.tsx'
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`components/landing/`에 랜딩 전용 컴포넌트)
   - ADR 기술 스택과 DESIGN.md 규칙(깊이 예외는 랜딩 다크 밴드에만, 글로우·blur 금지)을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/3-landing-visual/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 새 토큰 이름, `DarkBackdrop` 시그니처, `landing-dots`·`landing-light`·`reveal` 클래스 이름, 새 아이콘 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 히어로에 `reveal`을 붙이지 마라. 이유: 첫 화면 글자가 늦게 보이면 안 된다(UX_GUIDE 첫 화면 규칙).
- 색 있는 그림자(글로우), `backdrop-filter`/blur, 여러 개의 빛, 움직이는 빛을 쓰지 마라. 이유: DESIGN.md 금지 항목이다.
- 등장 모션을 JS(IntersectionObserver 등)나 `'use client'`로 만들지 마라. 이유: 랜딩에 클라이언트 JS를 늘리지 않는다.
- 대시보드 컴포넌트(`components/dashboard/`)와 데모 페이지를 고치지 마라. 이유: 이 step의 범위가 아니다. 버튼 hover는 `buttonClass`를 통해 자동으로 적용된다.
- 기존 테스트의 단언을 지우거나 약하게 바꾸지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
