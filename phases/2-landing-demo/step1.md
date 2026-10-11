# Step 1: snapshot-components

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` (전체. 특히 "색 쓰임", "차트", "컴포넌트", "레이아웃", "숫자 · 날짜", "문구")
- `/docs/USER_FLOW.md` ("② 첫 업로드 → aha"의 대시보드, "④ 월간 재방문")
- `/src/types/dashboard.ts`, `/src/types/category.ts`, `/src/types/transaction.ts`
- 이전 step에서 만든 파일: `/src/lib/format.ts`, `/src/lib/format.test.ts`
- 기존 테스트 설정: `/vitest.config.ts`, `/vitest.setup.ts`, `/src/components/mock-banner.tsx`와 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

월별 스냅샷 DTO를 그리는 대시보드 컴포넌트를 `src/components/dashboard/`에 만든다. 이 컴포넌트는 `/demo`와 이후 실제 `/dashboard`가 함께 쓴다. 각 컴포넌트마다 같은 폴더에 `*.test.tsx`를 **먼저** 쓴다. 이유: TDD guard hook이 테스트 없는 구현 파일 작성을 막는다.

`recharts`를 설치한다.

### 컴포넌트
```tsx
// month-select.tsx — 'use client'
export function MonthSelect(props: { months: MonthOption[]; month: YearMonth }): React.JSX.Element
// total-card.tsx
export function TotalCard(props: { snapshot: Snapshot; mom: MonthOverMonth | null }): React.JSX.Element
// category-list.tsx
export function CategoryList(props: { categories: CategoryAmount[] }): React.JSX.Element
// top-merchants.tsx
export function TopMerchants(props: { merchants: MerchantAmount[] }): React.JSX.Element
// daily-chart.tsx — 'use client'
export function DailyChart(props: { daily: DailyAmount[] }): React.JSX.Element
```

- **MonthSelect**: `<select aria-label="월 선택">`. 옵션 라벨은 `formatMonth(month)`, 최신순(`months` 순서 그대로). 값을 바꾸면 `usePathname()`의 현재 경로에 `?month=YYYY-MM`를 붙여 `router.push`한다. 입력·select 스타일(DESIGN.md)을 쓰되 너비는 내용에 맞춘다.
- **TotalCard**: 기본 카드. 제목 `총지출`, 큰 숫자 `formatWon(total)`, 보조 `거래 N건 · 반영 기간 {formatPeriod(period)}`, 그 아래 보조 문구 `취소·환불은 카드사 파일의 날짜 기준으로 반영돼요`.
  - `mom`이 있으면 `{formatMonthShort(previousMonth)}보다` + `diff > 0`: `text-increase`로 `{formatSignedWon(diff)} 늘었어요` / `diff < 0`: `text-decrease`로 `{formatSignedWon(diff)} 줄었어요` / `0`: `text-body`로 `같아요`.
  - `mom`이 `null`이면 전월 대비 줄을 그리지 않는다.
  - `snapshot.inProgress`면 보조 문구 `진행 중인 달이에요`를 더한다.
- **CategoryList**: 기본 카드, 섹션 제목 `카테고리`. 행마다 `CATEGORY_LABELS[category]` · `formatWon(amount)` · `ratio`가 있으면 `formatRatio(ratio)`. 그 아래 가로 막대(`bg-primary`, 높이 8px, 오른쪽 끝만 4px 둥글게)의 너비는 목록 중 최대 양수 금액 대비 비율이다. 금액이 0 이하인 행은 막대를 그리지 않는다. 막대는 Recharts가 아니라 `div`로 그린다.
- **TopMerchants**: 기본 카드, 섹션 제목 `가장 많이 쓴 곳`. 행마다 가맹점명(말줄임) · 카테고리 라벨(보조) · `N건` · 금액(오른쪽 정렬 `font-mono`).
- **DailyChart**: 기본 카드, 섹션 제목 `일별 지출`. Recharts 세로 `BarChart`, DESIGN.md "차트" 규칙을 그대로 따른다(`var(--color-primary)` 단색, `maxBarSize={24}`, `radius={[4, 4, 0, 0]}`, `isAnimationActive={false}`, 가로 그리드만, 축 `formatAxisWon`·12px `font-mono`, 툴팁은 `formatDate`와 `formatWon`). X축은 일(1~31)만 표시한다. 차트를 감싼 요소에 `role="img"`와 `aria-label="일별 지출 막대 차트"`를 둔다.

### 공통 규칙
- props로 받은 DTO만 쓴다. 데이터를 가져오거나 `buildDashboard`·`getMode`를 호출하지 않는다.
- 금액·날짜는 `src/lib/format.ts` 함수로만 표시한다. 금액 표시에 `font-mono`를 쓴다.
- 가맹점명은 JSX 텍스트로만 렌더링한다.
- jsdom에 `ResizeObserver`가 없어 Recharts가 실패하면 `vitest.setup.ts`에 최소 stub을 추가한다.

### 테스트로 단언할 것 (최소)
- MonthSelect: 옵션 라벨과 순서, 선택 시 `router.push('/demo?month=2026-07')` 호출(`next/navigation`을 mock하고 pathname은 `/demo`)
- TotalCard: 증가·감소·같음·`mom === null` 각각의 문구와 색 클래스, 진행 중 문구, 음수 합계의 `−` 표시
- CategoryList: 순서 유지, 라벨·금액·비율 텍스트, 음수 행에 막대 없음
- TopMerchants: `<img src=x onerror=alert(1)>` 같은 가맹점명이 텍스트로 보이고 `img` 요소가 생기지 않음
- DailyChart: 렌더링 중 throw하지 않고 `role="img"` 요소가 있음

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 컴포넌트 테스트 포함 전체 통과
! grep -rnE "dangerouslySetInnerHTML|getMode|buildDashboard|@/lib/supabase" src/components
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`components/`는 DTO만 받는다)
   - ADR 기술 스택과 DESIGN.md 규칙을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-landing-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 컴포넌트 파일 경로와 export 이름, Recharts 버전, 추가한 테스트 stub을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 원형·도넛 차트, 카테고리별 색, 범례, 차트 진입 애니메이션, 숫자 카운트업을 쓰지 마라. 이유: DESIGN.md 금지 항목이다.
- 아이콘 라이브러리를 설치하지 마라. 이유: 아이콘은 필요한 것만 인라인 SVG로 쓴다(DESIGN.md).
- 컴포넌트 안에서 Free/Pro를 판단하지 마라. 이유: 게이팅은 `buildDashboard` DTO 유니온 한 곳에서만 한다.
- 탐지·추세·요약 컴포넌트, 페이지는 이 step에서 만들지 마라.
- `src/lib/analytics/`와 `src/types/`를 수정하지 마라.
- 기존 테스트를 깨뜨리지 마라
