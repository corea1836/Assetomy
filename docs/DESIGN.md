# 디자인

Assetomy Design System을 이 제품(한국어 대시보드 MVP)에 맞게 줄인 규칙이다. 여기 없는 컴포넌트는 새로 디자인하지 말고 아래 토큰과 규칙을 조합한다.

## 원칙
1. **숫자가 주인공이다.** 합계·금액과 그 반영 기간이 먼저 보이게 한다.
2. **신뢰가 먼저다.** 과장하거나 불안을 부추기지 않는다. 확정되지 않은 것은 "후보·의심"이라고 부른다.
3. **대시보드는 도구다.** 마케팅 패턴(다크 밴드·큰 display 글자·목업·다크 밴드의 깊이·등장 모션)은 랜딩에만 쓴다.

## 금지
- blur(glass), 그라데이션(글자·버튼·밝은 면 배경), 색 있는 orb, 글로우(색 있는 그림자). 예외는 랜딩 다크 밴드의 점 그리드와 빛 하나뿐이다(아래 "랜딩 → 다크 밴드의 깊이")
- 보라/인디고, 색 있는 왼쪽 보더 카드, 이모지 아이콘, 빨간 경고 배너 남발
- "Powered by AI" 배지, 숫자 카운트업·막대가 자라는 모션·차트 진입 애니메이션
- 잠금 카드를 blur·모자이크로 가리기(정적 예시로 보여준다)

## 토큰 (`src/app/globals.css`)
```css
@import "tailwindcss";

@theme {
  --color-primary: #0B7A5E;          /* 포인트는 이것 하나. 드물게 쓴다 */
  --color-primary-hover: #096D54;    /* Primary 버튼 hover. primary와 primary-active 사이 */
  --color-primary-active: #08604A;
  --color-primary-disabled: #A9C4BC;
  --color-primary-soft: #E7F3EE;     /* Pro 표시·월간 요약 카드 바탕. Pro 글자는 primary-active(6.6:1) */
  --color-primary-on-dark: #3DD6A3;  /* 다크 면 위 막대·아이콘. surface-dark-elevated 대비 9.6:1 */
  --color-canvas: #FFFFFF;
  --color-surface-soft: #F7F7F7;
  --color-surface-strong: #EEF0F3;
  --color-surface-dark: #0A0B0D;
  --color-surface-dark-elevated: #16181C;
  --color-surface-dark-raised: #1F2228; /* 다크 면 3단계: 겹친 카드 앞면·떠 있는 칩 */
  --color-hairline: #DEE1E6;
  --color-hairline-soft: #EEF0F3;
  --color-hairline-dark: #2A2D33;
  --color-ink: #0A0B0D;
  --color-body: #5B616E;
  --color-muted: #7C828A;            /* 대비 3.9:1. placeholder에만 */
  --color-muted-soft: #A8ACB3;
  --color-increase: #CF202F;         /* 증감·위험 색은 글자에만 칠한다 */
  --color-decrease: #1B64DA;
  --color-danger: #CF202F;

  --font-sans: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  --text-caption: 0.8125rem; --text-caption--line-height: 1.5;
  --text-title-lg: 2rem; --text-title-lg--line-height: 1.2; --text-title-lg--letter-spacing: -0.4px;
  --text-display-sm: 2.25rem; --text-display-sm--line-height: 1.2; --text-display-sm--letter-spacing: -0.5px;
  --text-display-md: 2.75rem; --text-display-md--line-height: 1.15; --text-display-md--letter-spacing: -1px;
  --text-display-xl: 4rem; --text-display-xl--line-height: 1.15; --text-display-xl--letter-spacing: -1.6px;

  --shadow-soft: 0 4px 12px rgb(0 0 0 / 0.04);
  --shadow-float: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 24px 48px -12px rgb(0 0 0 / 0.6); /* 떠 있는 다크 면. 검은 그림자만 */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}

@theme inline {
  --font-mono: var(--font-jetbrains-mono), "Pretendard Variable", ui-monospace, monospace;
}

@layer base {
  body { word-break: keep-all; overflow-wrap: break-word; }
}
```
- Tailwind 기본 팔레트는 amber(확인 필요·mock 배너)와 `red-50`(에러 박스)만 쓴다.

## 색 쓰임
| 용도 | 값 |
|------|------|
| 페이지·카드 | `bg-canvas`, 카드 테두리 `border-hairline` |
| 보조 카드·회색 밴드 | `bg-surface-soft` (테두리 없음) |
| 구분선 | `border-hairline`, 표·목록 안은 `border-hairline-soft` |
| 제목·큰 숫자 / 본문·보조 | `text-ink` / `text-body` |
| placeholder / 비활성 | `text-muted` / `text-muted-soft` |
| 주요 버튼·링크·차트 막대·업로드 완료 | `primary` |
| 지출 증가 / 감소 | `text-increase` / `text-decrease` |
| 환불·취소(음수 금액) | `text-body` + "−" |
| 확인이 필요한 지출 | `bg-amber-50 border-amber-200 text-amber-900` (다크 면 위에서는 `text-amber-200`) |
| 에러 | `bg-red-50 text-danger` |
| 다크 밴드 위 | `text-white`, 보조 `text-muted-soft`, 막대·아이콘 `primary-on-dark`. 증감은 색 없이 흰 글자 + 부호 + "늘었어요/줄었어요"(`increase`는 다크 면 대비 3.7:1) |
| 다크 면 3단계 | 밴드 `surface-dark` → 카드 `surface-dark-elevated` → 겹친 앞면·떠 있는 칩 `surface-dark-raised` + `shadow-float` |
| Pro 표시 | `rounded-full bg-primary-soft px-2.5 py-0.5 text-caption font-semibold text-primary-active` |
| 월간 요약 카드 | `bg-primary-soft`, 반짝임 아이콘 `text-primary` |

- 증가=빨강·감소=파랑은 국내 관례다. 색만으로 구분하지 않고 부호와 "늘었어요/줄었어요"를 함께 쓴다.
- 포인트 색은 한 화면 구역에 한두 곳만 쓴다.

## 차트 (Recharts)
- 카테고리는 금액순 가로 막대 목록(이름 · 금액 · 비율), 일별은 세로 막대다. 추세(Pro)는 월별 세로 막대로 그리고, 진행 중인 달은 `var(--color-muted-soft)` + "진행 중"으로 표시한다.
- 막대는 `var(--color-primary)` 단색. 원형·도넛, 카테고리별 색, 범례를 쓰지 않는다.
- `maxBarSize={24}`, 값 쪽 끝만 4px 둥글게(`radius={[4, 4, 0, 0]}`, 가로는 `[0, 4, 4, 0]`). `isAnimationActive={false}`.
- 축은 "120만"처럼 만 단위로 쓰고, 12px `body` 색 `font-mono`. 툴팁은 원 단위 전체 금액을 `rounded-lg border border-hairline bg-canvas px-3 py-2 shadow-soft`에 보여준다.
- 그리드는 가로선만 1px `hairline-soft`. 글자는 막대 색이 아니라 `ink`·`body`.
- 차트는 `<div role="img" aria-label="… 막대 차트">`로 감싸고 차트에 `accessibilityLayer={false}`를 준다. 이유: Recharts 3 기본값은 안쪽 `svg`를 이름 없는 `role="application"` 포커스 요소로 만들어, Tab이 차트에 멈추고 화면낭독기가 축 숫자를 나열한다.
- 랜딩 그림의 막대는 Recharts 대신 서버 컴포넌트의 div·인라인 SVG로 그린다. 단색·값 쪽 끝 4px 규칙은 같고, 다크 면에서는 `primary-on-dark`다. 한 막대를 짚을 때는 나머지를 같은 색 40% 투명도로 낮춘다(다른 색을 쓰지 않는다).

## 컴포넌트
모서리: 버튼 `rounded-full` · 카드·모달 `rounded-3xl` · 입력·select `rounded-xl` · 툴팁·행 안 select `rounded-lg`. 각진 모서리는 쓰지 않고, 표·목록 행은 구분선으로 나눈다.

### 카드
```
기본:    rounded-3xl border border-hairline bg-canvas p-6 sm:p-8
보조:    rounded-3xl bg-surface-soft p-6 sm:p-8
제목:    text-sm text-body
큰 숫자: font-mono text-3xl font-medium text-ink
```

### 버튼
```
Pill 공통:   group inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold
             transition-[background-color,transform] duration-120 ease-standard active:scale-[.98]
             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
             disabled:cursor-not-allowed disabled:active:scale-100
Primary:     + bg-primary text-white hover:bg-primary-hover active:bg-primary-active
               disabled:bg-primary-disabled
Secondary:   + bg-surface-strong text-ink hover:bg-hairline active:bg-hairline
               disabled:bg-surface-strong disabled:text-muted-soft
Destructive: + bg-surface-strong text-danger hover:bg-hairline active:bg-hairline   (항상 확인 단계를 거친다)
작게:        + h-9 px-4 text-sm
Text:        font-semibold text-primary hover:underline active:text-primary-active  (포커스 링은 공통과 같다)
화살표:      버튼 글자 뒤 ArrowRightIcon 18px + transition-transform duration-200 ease-standard
             group-hover:translate-x-1
```
- Primary · Secondary 클래스는 `components/button-styles.ts`의 `buttonClass(variant, size?)`로만 만든다.
- 마우스를 올리면 Primary는 `primary-hover`, Secondary는 `hairline`으로 바뀐다. 누르면 Primary는 `primary-active`로 더 어두워지고, 모두 98%로 줄어든다. disabled 버튼은 hover로 바뀌지 않는다. Tailwind v4의 `hover:`는 마우스가 있는 기기에서만 적용된다.
- 화살표는 다른 화면으로 넘어가는 랜딩 CTA(히어로 "데모 보기", CTA 밴드 "무료로 시작하기")에만 붙인다.
- Primary는 구역당 한두 개. Text도 포인트 색이라 Primary 옆 "취소"는 Secondary로 한다.

### 입력 필드 · select
```
h-12 w-full rounded-xl border border-hairline bg-canvas px-4 text-base text-ink placeholder:text-muted
focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary
disabled:bg-surface-soft disabled:text-muted-soft      에러: border-danger
```
- 글자는 16px로 둔다. 이유: 16px 미만이면 iOS Safari가 포커스 때 화면을 확대한다. 행 안의 select만 `h-9 rounded-lg px-3 text-sm`.

### 목록 행 · 표
- 행: `border-b border-hairline-soft px-2 py-3`. 표 머리글은 `border-b border-hairline text-sm font-semibold text-body`, 셀은 `py-2 text-sm text-ink`.
- 금액은 오른쪽 정렬 `font-mono`.

### 모달 (업그레이드·삭제·탈퇴 확인)
```
오버레이: fixed inset-0 bg-surface-dark/40   (blur 금지)
패널:     rounded-3xl bg-canvas p-6 sm:p-8 max-w-md w-full
```

### 화면별 요소
- **총지출 카드**: 큰 숫자 바로 아래 전월 대비 문장. 거래 건수·반영 기간·취소·환불 기준은 카드 아래쪽에 `border-t border-hairline-soft`로 나눠 둔다(카드가 늘어나면 아래에 붙는다).
- **월간 요약 카드**: 총지출 카드 바로 아래(`md:` 이상에서는 왼쪽 열에 총지출과 함께 쌓고, 오른쪽 열은 카테고리). `rounded-3xl bg-primary-soft p-6 sm:p-8`. 제목 줄은 `SparklesIcon`(20px `text-primary`) + "이번 달 요약"(`text-lg font-semibold text-ink`), 본문 `text-lg leading-relaxed text-ink whitespace-pre-line`, 그 아래 출처 한 줄 `text-caption text-body`. 출처는 실제 대시보드 "AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.", 데모·랜딩 "예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."(데모 요약은 fixture의 고정 문장이다).
- **카테고리 목록**: 금액순 5개까지 보이고, 나머지는 `<details>`로 접어 Text 스타일 summary "나머지 N개 카테고리 보기"를 둔다. 막대는 전체 최댓값 기준이다.
- **데모 Pro 구분선**: 탐지 영역 앞에 `border-t border-hairline pt-8` + Pro 표시 + "여기부터 Pro 화면이에요. Free에서는 확인할 지출의 건수와 합계만 보여요."
- **데모 하단 CTA**: 보조 카드에 "내 카드로 확인해 보세요" + 한 문장 + Primary "내 이용내역으로 해보기".
- **월 요약(Free)**: 본문 아래 "Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요" + Text "Pro로 보기"(upgrade source `summary`).
- **잠금 카드(Free 추세)**: 보조 카드에 정적 예시(가짜 수치임을 밝힘) + 한 줄 설명 + Primary "Pro로 보기". 실제 데이터를 가리지 않는다.
- **후보 지출 티저(Free)**: amber 박스(`rounded-3xl border p-6 sm:p-8`)에 종류별 건수·금액과 `candidateTotal`. "정상 지출일 수 있어요. 상세에서 확인해 보세요."
- **업로드 상태 행**: 파일명(말줄임) · 카드 라벨 · 상태(대기 / 올리는 중 / 분석 중 / 확인 필요 / 완료 / 실패) · 결과 한 줄. 완료는 `text-primary`. 실패는 `text-danger`로 쓰고 원인과 다음 행동 버튼을 붙인다. 확인 필요 행에는 작은 Primary "열 확인하기"를 둔다.
- **매핑 확인**: 제안된 열(이용일 · 가맹점 · 금액 · 승인번호 · 취소 표시)을 원래 열 이름과 함께 보여준다(수정 불가). 아래에 처음 5행 미리보기 표를 둔다. 문구는 "처음 보는 형식이에요. 열이 맞는지 확인해 주세요."이고, 버튼은 Primary "이대로 읽기" · Secondary "취소".
- **가장 많이 쓴 곳**: 금액순 5곳을 보이고, 그 달의 나머지 가맹점(환불만 있는 가맹점 포함)은 카테고리 목록과 같은 `<details>`로 접어 Text 스타일 summary "나머지 N곳 보기"를 둔다.
- **카테고리 수정**: 실제 대시보드의 "가장 많이 쓴 곳" 행(5곳과 나머지 가맹점)마다 행 안 select(고정 14개). 바꾸면 바로 저장하고 다시 그린다. "같은 가맹점의 모든 거래에 적용돼요". 데모는 select 없이 글자로 보여준다.
- **로그인 화면**(`/login`): 상단에 워드마크(`/` 링크)만 둔다. 본문은 가운데 정렬 `mx-auto max-w-sm px-4 pt-16`: 제목 `text-title-lg` "구글 계정으로 시작해요" → `text-base text-body` "카드번호·계좌·카드사 비밀번호는 받지 않아요" → (`?error`가 있으면) 에러 박스 → 구글 로그인 버튼(전체 너비). 에러 박스는 `rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-danger`, `role="alert"`이고 원인과 "다시 시도해 주세요"를 함께 쓴다(문구는 `lib/errors/messages.ts`).
- **구글 로그인 버튼**: Google 브랜드 가이드의 라이트 테마다. Pill 공통의 높이·모양·누름·포커스 링(`h-11 rounded-full … active:scale-[.98] focus-visible:outline-primary`)에 `w-full border border-[#747775] bg-white font-medium text-[#1F1F1F] hover:bg-surface-soft`. 글자 앞에 원래 색 G 로고(18px, 색·비율을 바꾸지 않고 `aria-hidden`), 문구 "Google로 계속하기". `buttonClass`를 쓰지 않는 유일한 버튼이고, 로고는 `icons.tsx` 규칙(`currentColor`)의 예외다.
- **대시보드 헤더**: 왼쪽 워드마크(`/` 링크), 오른쪽 Secondary 작게 "로그아웃"(`POST /auth/logout` 폼).
- **mock 배너**: `bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900`, "테스트 모드: AI 분석과 결제는 모의로 동작합니다".
- **워드마크**: 로고 파일 없이 소문자 `assetomy`, `text-[22px] font-medium leading-none tracking-[-0.02em] text-primary`(다크 위에서는 `text-white`).

## 레이아웃
- 대시보드·설정: `max-w-5xl mx-auto px-4 sm:px-6`. 1열 기본, `md:` 이상에서 KPI·차트 2열. 첫 줄은 왼쪽 열에 총지출·월간 요약 카드를 쌓고 오른쪽 열에 카테고리를 둔다. 카드 사이 `gap-6`, 섹션 사이 `space-y-12`.
- 대시보드 상단 한 줄: 월 선택기 · 반영 기간 · "새 이용내역 추가"(같은 페이지 맨 아래 업로드 구역으로 이동).
- 좌측 정렬 기본. 중앙 정렬은 모달·빈 상태·랜딩 CTA·로그인 화면에만 쓴다.

### 랜딩 (`/`)
- 너비 `mx-auto max-w-[1248px] px-6`, 밴드마다 `py-24`. 순서: 다크 히어로 → 기능 쇼케이스(흰) → 9월 요약(다크) → 시작 단계(`bg-surface-soft`) → 요금(흰) → 다크 CTA.
- 섹션 제목 `text-display-sm`.
- 랜딩의 모든 수치는 `/demo`와 같은 fixture를 `buildDashboard`에 넣은 결과에서 가져온다. 화면에 숫자를 직접 적지 않는다. 데모에서 같은 숫자를 다시 보게 하기 위해서다.
- 그림은 서버 컴포넌트에서 div·인라인 SVG로 그린다(Recharts·클라이언트 JS를 쓰지 않는다). 장식 레이어는 `aria-hidden`이고, 정보를 담은 그림은 같은 내용을 글자(목록·캡션)로도 둔다.
- 그림 안에 링크·버튼을 두지 않는다. 랜딩 Tab 순서는 `로그인` → `데모 보기` → `무료로 시작하기` → `Pro 시작하기` → `무료로 시작하기` 그대로다. 로그인한 사용자에게는 헤더의 `로그인` 자리에 같은 모양의 `대시보드`(`/dashboard`)를 보여준다. 로그인한 Pro에게는 가격 Pro 카드의 `Pro 시작하기` 자리에 같은 모양의 `구독 관리`(`/settings`)를 보여준다.
- 375px에서 가로 스크롤이 생기지 않는다. 겹치거나 비어져 나오는 배치는 `lg:` 이상에서만 하고, 그 아래 화면에서는 그림 요소를 세로로 쌓는다.

#### 다크 밴드의 깊이 (히어로 · 9월 요약 · CTA)
- 면은 3단계로 쌓는다(색 쓰임의 "다크 면 3단계"). 카드는 `rounded-3xl border border-hairline-dark`.
- 밴드 바탕에 점 그리드를 깐다: 24px 간격 2px 흰 점, 불투명도 16%. 가운데 35%까지는 보이고 85%에서 사라진다(mask). 이 레이어는 `aria-hidden`, `pointer-events-none`이다.
- 빛은 밴드마다 하나까지, 그림이나 제목 뒤에만 둔다: `primary-on-dark` 불투명도 22% 이하에서 65% 지점까지 투명으로 사라지는 radial. 여러 개·여러 색·움직이는 빛은 쓰지 않는다.
- 이 값은 2026-10-12에 세 강도(6%·8% / 12%·14% / 16%·22%)를 화면으로 비교해 골랐다. 더 낮은 값은 `#0A0B0D` 위에서 거의 보이지 않았다.
- Pro 가격 카드는 `bg-surface-dark` + `shadow-float`이고 점 그리드·빛은 두지 않는다.

#### 히어로
- 읽는 순서: 헤드라인(`text-display-sm lg:text-display-xl`) → 부제(`text-lg leading-relaxed text-muted-soft`) → Primary "데모 보기" + 화살표 → "로그인 없이 바로 볼 수 있어요" → 그림. `lg:` 이상에서 그림은 오른쪽 열, 그 아래 화면에서는 글 아래다. 첫 화면(375×667)에 헤드라인과 "데모 보기"가 들어온다.
- 그림은 "흩어진 파일이 한 화면으로 모인다"를 보여준다.
  1. 파일 칩 2개: fixture의 카드 라벨(`생활비 카드` · `온라인 쇼핑 카드`)과 파일 형식(`.xlsx` · `.csv`). `surface-dark-elevated` 칩, 앞 카드로 이어지는 1px `hairline-dark` 선(SVG).
  2. 뒤 카드(`surface-dark-elevated`, 앞 카드보다 위·오른쪽으로 어긋남): 그 달 일별 막대. 가장 큰 날만 `primary-on-dark`, 나머지는 같은 색 40%.
  3. 앞 카드(`surface-dark-raised` + `shadow-float`): `2026년 9월 총지출`, 큰 숫자, 상위 카테고리 3개 막대(`ul aria-label="예시 상위 카테고리"`), 후보 줄 `확인이 필요한 지출 N건 · 후보 합계 N원`(`text-amber-200`), `예시 데이터`.
  4. 떠 있는 칩(`surface-dark-raised` + `shadow-float`, 앞 카드 모서리에 걸침): 중복 결제 의심 건 `중복 결제 의심 · 9월 18일 32,000원 × 2`(`text-amber-200`).

#### 기능 쇼케이스 (흰)
- 제목 "파일 하나로 시작해요" 아래 줄 3개. `lg:` 이상에서 글과 그림 2열이고 그림 쪽이 줄마다 좌우로 바뀐다. 그 아래 화면에서는 글 → 그림.
- 글: 24px `text-primary` 아이콘 → 제목(`text-title-lg`) → 본문(`text-lg leading-relaxed text-body`). 그림: 보조 카드(`rounded-3xl bg-surface-soft p-6 sm:p-8`).
  1. **한 화면에 모든 카드**: 카드 라벨 칩 2개가 합계 한 줄(`9월 총지출 1,517,200원 · 거래 26건`)로 모인다. 카드별 금액은 쓰지 않는다(대시보드에 없는 정보다).
  2. **확인이 필요한 지출**: 탐지 종류마다 한 칸, amber 면(`bg-amber-50 border-amber-200 text-amber-900`). 정기결제로 보여요는 데이터가 있는 달 눈금 위에 결제한 달마다 점(`seriesMonths`)과 가맹점·금액, 중복 결제 의심은 같은 날 같은 금액 칸 2개, 고액 결제는 그 달 일별 막대 중 그날만 진하게 하고 금액을 붙인다. 아래 캡션 "정상 지출일 수 있어요".
  3. **연동 없이, 언제든 삭제**: 받는 것(이용내역 파일, 체크 `text-primary`)과 받지 않는 것(카드번호 · 계좌 · 카드사 비밀번호, X `text-body`) 두 열.

#### 9월 요약 (다크)
- 제목 "숫자는 코드가 계산하고, 요약은 문장으로 정리해요", 부제 한 문장 `text-muted-soft`.
- 왼쪽: 월간 요약 카드(대시보드와 같은 민트 카드, 데모 출처 문구). 오른쪽: 근거 `ol aria-label="요약의 근거"` 3칸(`surface-dark-elevated` 카드). 칸마다 번호(①②③) · 탐지 종류(`text-amber-200`) · 날짜·가맹점 · 금액(`font-mono text-white`). 값은 `findings`에서 가져온다(고액 결제 → 정기결제 → 중복 결제 의심 순).
- 아래: 데이터가 있는 달의 월별 막대(`trend.months`)와 선택 달 막대 위의 ① 표시, 전월 대비 문장. 다크 면이라 증감 색을 쓰지 않는다.
- 요약 문장을 코드로 쪼개 근거와 선으로 잇지 않는다. 이유: 실제 요약은 형식 없는 AI 문장이라, 데모에 없는 구조를 약속하게 된다.

#### 시작 단계 (`bg-surface-soft`)
- `<ol aria-label="시작하는 순서">` 3칸(`sm:` 3열). 번호 `font-mono text-sm text-primary`("01"), 제목 `text-lg font-semibold`. 번호 사이를 1px `hairline` 선으로 잇는다(`sm:` 이상 가로, 그 아래 세로).
- 칸마다 제목 위에 미니 그림(`rounded-2xl border border-hairline bg-canvas`, `aria-hidden`): 01 `XLSX` · `CSV` 형식 배지, 02 카드 라벨 칩, 03 막대 3개짜리 미니 대시보드.

#### 요금 (흰)
- 제목 아래 한 문장(`text-lg text-body`). Free·Pro 카드 두 장. Pro는 리본 대신 다크로 반전한다(위 "다크 밴드의 깊이"). 가격은 `text-display-md`, 기능 목록은 체크 아이콘(Free `text-primary`, Pro `text-primary-on-dark`), 버튼은 전체 너비(Free Secondary, Pro Primary).
- 기능 목록과 버튼 사이에 "이 플랜에서 보이는 것" 한 칸. Free는 `확인이 필요한 지출 N건 · 후보 합계 N원`(건수·합계만), Pro는 같은 줄 아래 탐지 상세 2줄(종류 · 가맹점 · 금액). 값은 `findings`에서 가져온다.

#### CTA 밴드 (다크)
- 가운데 정렬, `text-display-sm sm:text-display-md` + Primary "무료로 시작하기" + 화살표. 고지는 `text-caption text-muted-soft`.

## 타이포그래피
- 글자는 Pretendard Variable, 숫자는 JetBrains Mono 500. 런타임에 외부 CDN에서 글꼴을 받지 않는다.
  - Pretendard: `pretendard` 패키지의 `pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css`를 루트 레이아웃에서 import한다(전체 woff2 약 2MB 대신 필요한 글자 조각만 받는다).
  - JetBrains Mono: `next/font/google`(`weight: '500'`, `variable: '--font-jetbrains-mono'`).
- 숫자만 따로 놓이는 자리(큰 숫자·표·목록 금액·차트)는 `font-mono`. 문장 안 숫자·날짜는 본문 글꼴 + `tabular-nums`.
- 한글은 어절 단위로 줄을 바꾼다(`body`의 `word-break: keep-all`). 띄어쓰기 없는 긴 가맹점명은 `overflow-wrap: break-word`로 넘치지 않는다.
- display·`title-lg`는 굵기 400. 강조는 600.

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | `text-title-lg text-ink` |
| 섹션 제목 | `text-lg font-semibold text-ink` |
| 카드 제목 | `text-sm text-body` |
| 큰 숫자 | `font-mono text-3xl font-medium text-ink` |
| 본문 | `text-base text-body` (긴 요약은 `leading-relaxed`) |
| 보조 | `text-caption text-body` |

## 숫자 · 날짜
- 금액 `1,234,000원`(`Intl.NumberFormat('ko-KR')`), 음수 `−12,000원`(U+2212 마이너스). 만 단위 축약은 차트 축에만 쓴다.
- 전월 대비 `+123,000원 늘었어요` / `−45,000원 줄었어요`. 비교할 수 없으면 표시하지 않는다.
- 가격: 랜딩·모달은 `월 N원`(KRW). 결제 통화는 Polar가 고객 위치로 정한다(해외 `$4.99/월`).
- 날짜 `9월 15일`, 기간 `9/15~9/30`, 월 `2026년 9월`.

## 문구
- 해요체로 짧고 차분하게 쓴다. 재촉·과장·느낌표를 쓰지 않고, 형용사보다 사실을 쓴다("원본 파일은 암호화해 보관해요").
- "확인이 필요한 지출", "중복 결제 의심", "정기결제로 보여요"처럼 쓴다. "절약할 수 있어요", "낭비", "부정 결제", "AI가 분석했어요"는 쓰지 않는다.
- 에러는 원인과 다음 행동을 함께 쓴다("청구서 대신 이용내역을 받아 주세요"). 문구는 `lib/errors/messages.ts`에서 관리한다.
- 빈 상태는 한 문장과 버튼 하나.

## 모션 · 아이콘 · 접근성
- 애니메이션은 스켈레톤 `animate-pulse`, 스피너 `animate-spin`, 120~200ms `ease-standard` 색·크기·위치 전환(버튼 hover·누름, 화살표 이동)만 쓴다. 예외는 아래 랜딩 등장 모션 하나다.
- 랜딩 등장 모션: 히어로를 뺀 밴드의 제목 묶음과 그림이 화면에 들어올 때 한 번, 불투명도 0→1과 24px 아래→제자리. 구역 위쪽이 화면에 160px 들어오면 다 보인다(`animation-range: entry 0% entry 160px`. 화면보다 긴 구역도 같은 시점). CSS scroll-driven(`animation-timeline: view()`)으로만 하고 JS를 쓰지 않는다. `prefers-reduced-motion: reduce`이거나 브라우저가 지원하지 않으면 처음부터 보인다. 숫자와 막대 길이는 움직이지 않는다.
- 아이콘은 `components/icons.tsx`의 인라인 SVG다(Lucide 모양을 필요한 것만 복사). `strokeWidth 2`, 20px(버튼 안 18px, 랜딩 기능 24px, 월간 요약 반짝임 20px), `currentColor`, `aria-hidden`. 아이콘 라이브러리·아이콘 폰트·원형 배경을 쓰지 않는다.
- 색만으로 의미를 전달하지 않는다. 정보를 담은 글자는 대비 4.5:1 이상. 버튼·입력에는 보이는 포커스 표시를 둔다. 차트 수치는 카테고리 목록으로 텍스트로도 제공한다.

## 디자인 시스템과 다르게 정한 것
| 항목 | 원본 | 여기 | 이유 |
|------|------|------|------|
| 글꼴 | Inter Tight·Inter | Pretendard | Inter 계열에 한글이 없다 |
| 증감 색 | 상승 그린 / 하락 빨강 | 증가 빨강 / 감소 파랑 | 지출 증가가 좋은 신호로 읽히면 안 된다. 국내 관례 |
| 보조 글자 | `muted` | `body` | `muted`는 대비 3.9:1로 WCAG AA 미달 |
| 아이콘 | Lucide 아이콘 폰트(CDN) | 인라인 SVG | 런타임 외부 의존을 두지 않는다 |
| 상태 면 색 | 없음 | amber, `red-50` | 경고·에러 면 색이 없다 |
| 구글 로그인 버튼 | Primary 버튼 | Google 브랜드 가이드 라이트 테마(`#747775` 테두리 · `#1F1F1F` 글자 · 원래 색 G) | 브랜드 가이드 준수가 OAuth 앱 검증 요건이다(ADR-021) |
