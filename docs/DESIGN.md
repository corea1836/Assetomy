# 디자인

Assetomy Design System을 이 제품(한국어 대시보드 MVP)에 맞게 줄인 규칙이다. 여기 없는 컴포넌트는 새로 디자인하지 말고 아래 토큰과 규칙을 조합한다.

## 원칙
1. **숫자가 주인공이다.** 합계·금액과 그 반영 기간이 먼저 보이게 한다.
2. **신뢰가 먼저다.** 과장하거나 불안을 부추기지 않는다. 확정되지 않은 것은 "후보·의심"이라고 부른다.
3. **대시보드는 도구다.** 마케팅 패턴(다크 밴드·큰 display 글자·목업)은 랜딩에만 쓴다.

## 금지
- blur(glass), 그라데이션(글자·배경·버튼), 배경 gradient orb, 글로우 그림자
- 보라/인디고, 색 있는 왼쪽 보더 카드, 이모지 아이콘, 빨간 경고 배너 남발
- "Powered by AI" 배지, 숫자 카운트업·차트 진입 애니메이션
- 잠금 카드를 blur·모자이크로 가리기(정적 예시로 보여준다)

## 토큰 (`src/app/globals.css`)
```css
@import "tailwindcss";

@theme {
  --color-primary: #0B7A5E;          /* 포인트는 이것 하나. 드물게 쓴다 */
  --color-primary-active: #08604A;
  --color-primary-disabled: #A9C4BC;
  --color-canvas: #FFFFFF;
  --color-surface-soft: #F7F7F7;
  --color-surface-strong: #EEF0F3;
  --color-surface-dark: #0A0B0D;
  --color-surface-dark-elevated: #16181C;
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
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
}

@theme inline {
  --font-mono: var(--font-jetbrains-mono), "Pretendard Variable", ui-monospace, monospace;
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
| 확인이 필요한 지출 | `bg-amber-50 border-amber-200 text-amber-900` |
| 에러 | `bg-red-50 text-danger` |
| 다크 밴드 위 | `text-white`, 보조 `text-muted-soft` |

- 증가=빨강·감소=파랑은 국내 관례다. 색만으로 구분하지 않고 부호와 "늘었어요/줄었어요"를 함께 쓴다.
- 포인트 색은 한 화면 구역에 한두 곳만 쓴다.

## 차트 (Recharts)
- 카테고리는 금액순 가로 막대 목록(이름 · 금액 · 비율), 일별은 세로 막대다. 추세(Pro)는 월별 세로 막대로 그리고, 진행 중인 달은 `var(--color-muted-soft)` + "진행 중"으로 표시한다.
- 막대는 `var(--color-primary)` 단색. 원형·도넛, 카테고리별 색, 범례를 쓰지 않는다.
- `maxBarSize={24}`, 값 쪽 끝만 4px 둥글게(`radius={[4, 4, 0, 0]}`, 가로는 `[0, 4, 4, 0]`). `isAnimationActive={false}`.
- 축은 "120만"처럼 만 단위로 쓰고, 12px `body` 색 `font-mono`. 툴팁은 원 단위 전체 금액을 `rounded-lg border border-hairline bg-canvas px-3 py-2 shadow-soft`에 보여준다.
- 그리드는 가로선만 1px `hairline-soft`. 글자는 막대 색이 아니라 `ink`·`body`.

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
Pill 공통:   inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold
             transition-[background-color,transform] duration-120 ease-standard active:scale-[.98]
             focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary
             disabled:cursor-not-allowed disabled:active:scale-100
Primary:     + bg-primary text-white active:bg-primary-active disabled:bg-primary-disabled
Secondary:   + bg-surface-strong text-ink active:bg-hairline disabled:text-muted-soft
Destructive: + bg-surface-strong text-danger active:bg-hairline   (항상 확인 단계를 거친다)
작게:        + h-9 px-4 text-sm
Text:        font-semibold text-primary hover:underline active:text-primary-active  (포커스 링은 공통과 같다)
```
- hover에는 바뀌지 않는다. 누를 때만 어두워지고 98%로 줄어든다.
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
- **월 요약(Free)**: 본문 아래 "Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요" + Text "Pro로 보기"(upgrade source `summary`).
- **잠금 카드(Free 추세)**: 보조 카드에 정적 예시(가짜 수치임을 밝힘) + 한 줄 설명 + Primary "Pro로 보기". 실제 데이터를 가리지 않는다.
- **후보 지출 티저(Free)**: amber 박스(`rounded-3xl border p-6 sm:p-8`)에 종류별 건수·금액과 `candidateTotal`. "정상 지출일 수 있어요. 상세에서 확인해 보세요."
- **업로드 상태 행**: 파일명(말줄임) · 카드 라벨 · 상태(대기 / 올리는 중 / 분석 중 / 확인 필요 / 완료 / 실패) · 결과 한 줄. 완료는 `text-primary`. 실패는 `text-danger`로 쓰고 원인과 다음 행동 버튼을 붙인다. 확인 필요 행에는 작은 Primary "열 확인하기"를 둔다.
- **매핑 확인**: 제안된 열(이용일 · 가맹점 · 금액 · 승인번호 · 취소 표시)을 원래 열 이름과 함께 보여준다(수정 불가). 아래에 처음 5행 미리보기 표를 둔다. 문구는 "처음 보는 형식이에요. 열이 맞는지 확인해 주세요."이고, 버튼은 Primary "이대로 읽기" · Secondary "취소".
- **카테고리 수정**: 카테고리 목록·Top N 행의 select(고정 14개). 바꾸면 바로 저장하고 다시 그린다. "같은 가맹점의 모든 거래에 적용돼요".
- **mock 배너**: `bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900`, "테스트 모드: AI 분석과 결제는 모의로 동작합니다".
- **워드마크**: 로고 파일 없이 소문자 `assetomy`, `text-[22px] font-medium leading-none tracking-[-0.02em] text-primary`(다크 위에서는 `text-white`).

## 레이아웃
- 대시보드·설정: `max-w-5xl mx-auto px-4 sm:px-6`. 1열 기본, `md:` 이상에서 KPI·차트 2열. 카드 사이 `gap-6`, 섹션 사이 `space-y-12`.
- 대시보드 상단 한 줄: 월 선택기 · 반영 기간 · "새 명세서 추가".
- 좌측 정렬 기본. 중앙 정렬은 모달·빈 상태·랜딩 CTA에만 쓴다.

### 랜딩 (`/`)
- 너비 `mx-auto max-w-[1248px] px-6`, 밴드마다 `py-24`. 순서: 다크 히어로 → 흰/회색(`bg-surface-soft`) 밴드 → 다크 CTA.
- 히어로(`bg-surface-dark text-white`): 헤드라인 `text-display-sm lg:text-display-xl`, 부제 `text-lg text-muted-soft`, Primary "데모 보기". 오른쪽에는 대시보드 카드 목업 1장(`rounded-3xl border border-hairline-dark bg-surface-dark-elevated p-8`)을 두고, 수치는 `/demo` fixture 값을 쓴다.
- 섹션 제목 `text-display-sm`. 기능 카드는 기본 카드로 `sm:` 2열 · `lg:` 3열.
- 가격: Free·Pro 카드 두 장. Pro는 리본 대신 `bg-surface-dark text-white`로 반전한다. 가격은 `text-display-md`, 버튼은 전체 너비(Free Secondary, Pro Primary).
- CTA 밴드: 다크, 가운데 정렬, `text-display-sm sm:text-display-md` + 버튼 하나. 법적 고지는 `text-caption text-body`.

## 타이포그래피
- 글자는 Pretendard Variable, 숫자는 JetBrains Mono 500. 런타임에 외부 CDN에서 글꼴을 받지 않는다.
  - Pretendard: `pretendard` 패키지의 `pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css`를 루트 레이아웃에서 import한다(전체 woff2 약 2MB 대신 필요한 글자 조각만 받는다).
  - JetBrains Mono: `next/font/google`(`weight: '500'`, `variable: '--font-jetbrains-mono'`).
- 숫자만 따로 놓이는 자리(큰 숫자·표·목록 금액·차트)는 `font-mono`. 문장 안 숫자·날짜는 본문 글꼴 + `tabular-nums`.
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
- 애니메이션은 스켈레톤 `animate-pulse`, 스피너 `animate-spin`, 120~200ms `ease-standard` 색·크기 전환만 쓴다.
- 아이콘은 인라인 SVG다(Lucide 모양을 필요한 것만 복사). `strokeWidth 2`, 20px(버튼 안 18px), `currentColor`. 아이콘 라이브러리·아이콘 폰트·원형 배경을 쓰지 않는다.
- 색만으로 의미를 전달하지 않는다. 정보를 담은 글자는 대비 4.5:1 이상. 버튼·입력에는 보이는 포커스 표시를 둔다. 차트 수치는 카테고리 목록으로 텍스트로도 제공한다.

## 디자인 시스템과 다르게 정한 것
| 항목 | 원본 | 여기 | 이유 |
|------|------|------|------|
| 글꼴 | Inter Tight·Inter | Pretendard | Inter 계열에 한글이 없다 |
| 증감 색 | 상승 그린 / 하락 빨강 | 증가 빨강 / 감소 파랑 | 지출 증가가 좋은 신호로 읽히면 안 된다. 국내 관례 |
| 보조 글자 | `muted` | `body` | `muted`는 대비 3.9:1로 WCAG AA 미달 |
| 아이콘 | Lucide 아이콘 폰트(CDN) | 인라인 SVG | 런타임 외부 의존을 두지 않는다 |
| 상태 면 색 | 없음 | amber, `red-50` | 경고·에러 면 색이 없다 |
