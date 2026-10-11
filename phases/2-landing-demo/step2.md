# Step 2: insight-components

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("플랜별 기능": 탐지 표현 규칙·0건 문구·`candidateTotal`)
- `/docs/DESIGN.md` (전체. 특히 "색 쓰임"의 확인이 필요한 지출, "차트"의 추세, "문구")
- `/src/types/dashboard.ts`, `/src/types/category.ts`
- 이전 step에서 만든 파일: `/src/lib/format.ts`, `/src/components/dashboard/` 아래 컴포넌트와 테스트(특히 `daily-chart.tsx`의 Recharts 사용 방식), `/vitest.setup.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

Pro 대시보드의 탐지 상세·추세와 월 요약을 그리는 컴포넌트를 `src/components/dashboard/`에 만든다. 각 컴포넌트마다 같은 폴더에 `*.test.tsx`를 **먼저** 쓴다.

```tsx
// findings-list.tsx
export function FindingsList(props: { findings: Findings; dataMonthCount: number }): React.JSX.Element
// trend-chart.tsx — 'use client'
export function TrendChart(props: { trend: Trend }): React.JSX.Element
// monthly-summary.tsx
export function MonthlySummary(props: { summary: string }): React.JSX.Element
```

- **FindingsList**: 섹션 제목 `확인이 필요한 지출`.
  - 요약 박스(`rounded-3xl border bg-amber-50 border-amber-200 text-amber-900 p-6 sm:p-8`): 종류별 `정기결제로 보여요` · `중복 결제 의심` · `고액 결제` 각각 `N건 · {formatWon(amount)}`, 그리고 `후보 합계 {formatWon(candidateTotal)}`와 보조 문구 `같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요.`
  - 상세 목록(기본 카드): finding마다 종류 라벨 · 가맹점명 · 카테고리 라벨 · `formatWon(amount)`. 그 아래 거래마다 `formatDate(date)` · `cardLabel` · `formatWon(amount)`. 정기결제는 `seriesMonths`를 `formatMonthShort`로 이어 `6월 · 7월 · 8월 결제`처럼 보여준다.
  - `items`가 비어 있으면 요약·목록 대신 `이번 규칙으로 확인할 지출 후보가 발견되지 않았어요`를 보여준다.
  - `dataMonthCount < 2`면 보조 문구 `한 달치만 더 올리면 정기결제를 찾아드려요`를 더한다.
- **TrendChart**: 기본 카드, 섹션 제목 `월별 추세`.
  - Recharts 세로 `BarChart`(DESIGN.md "차트" 규칙). X축 `formatMonthShort`. `inProgress`인 달의 막대는 `var(--color-muted-soft)`로 칠하고 축 라벨 옆이나 아래에 `진행 중`을 표시한다. 차트를 감싼 요소에 `role="img"`, `aria-label="월별 지출 추세 막대 차트"`를 두고, 같은 수치를 `sr-only` 목록(`{formatMonth(month)} {formatWon(total)}`)으로도 제공한다.
  - `categoryChanges`가 있으면 차트 아래에 행마다 `CATEGORY_LABELS[category]` · `diff > 0`: `text-increase` `{formatSignedWon(diff)} 늘었어요` / `diff < 0`: `text-decrease` `{formatSignedWon(diff)} 줄었어요`. 제목은 `지난달과 달라진 카테고리`. `null`이면 이 목록을 그리지 않는다.
- **MonthlySummary**: 기본 카드, 제목 `이번 달 요약`, 본문은 `text-base text-body leading-relaxed whitespace-pre-line`. `summary`를 JSX 텍스트로만 렌더링한다.

### 공통 규칙
- props로 받은 DTO만 쓴다. 금액·날짜는 `src/lib/format.ts`로만 표시한다.
- 문구에 `절약`, `낭비`, `부정 결제`, `AI가 분석`을 쓰지 않는다(DESIGN.md "문구").

### 테스트로 단언할 것 (최소)
- FindingsList: 종류별 건수·금액과 후보 합계 텍스트 · 정기결제의 달 목록 · 거래의 카드 라벨과 날짜 · `items` 0건 문구 · `dataMonthCount=1` 문구
- TrendChart: throw 없이 렌더링, `role="img"`, `sr-only` 목록에 월별 합계, 진행 중 표시, `categoryChanges` 증가·감소 문구와 색 클래스, `null`이면 목록 없음
- MonthlySummary: `<script>alert(1)</script>` 같은 요약이 텍스트로 보이고 `script` 요소가 생기지 않음
- 세 컴포넌트가 렌더링한 텍스트에 `절약`·`낭비`·`부정 결제`가 없음

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 컴포넌트 테스트 포함 전체 통과
! grep -rnE "dangerouslySetInnerHTML|getMode|buildDashboard|@/lib/supabase" src/components
! grep -rnE "절약|낭비|부정 결제|AI가 분석" src/components --include='*.tsx' --exclude='*.test.tsx'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`components/`는 DTO만 받는다)
   - ADR 기술 스택과 DESIGN.md 규칙을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-landing-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 컴포넌트 파일 경로와 export 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 후보 금액을 "절감 가능 금액"처럼 표현하지 마라. 이유: 후보는 정상 지출일 수 있고 절감 보장 표현은 금지다(PRD).
- Free용 티저·잠금 카드·업그레이드 버튼을 이 step에서 만들지 마라. 이유: 실제 대시보드 phase에서 결제 흐름과 함께 만든다.
- 빨간 경고 배너, 색 있는 왼쪽 보더 카드, blur를 쓰지 마라. 이유: DESIGN.md 금지 항목이다.
- `src/lib/analytics/`와 `src/types/`를 수정하지 마라.
- 기존 테스트를 깨뜨리지 마라
