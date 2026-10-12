# Step 3: feature-showcase

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("랜딩 (`/`)" 전체, 특히 "기능 쇼케이스". "색 쓰임"의 확인이 필요한 지출, "차트"의 랜딩 그림 규칙, "모션")
- `/docs/UX_GUIDE.md` ("유치: 랜딩"의 기능 쇼케이스, "3. 일관성"의 용어 표)
- `/docs/PRD.md` (표현 규칙: 후보·의심, 정상 지출일 수 있음)
- `/src/types/dashboard.ts`, `/src/lib/format.ts`, `/src/lib/demo/fixture.ts`
- `/src/app/page.tsx`, `/src/app/page.test.tsx`
- 이전 step에서 만든 파일: `/src/components/landing/hero-visual.tsx`, `/src/components/dashboard/finding-labels.ts`, `/src/components/icons.tsx`(`XIcon`·`CheckIcon`), `/src/app/globals.css`(`reveal`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

"파일 하나로 시작해요" 밴드의 작은 카드 3장을, 글과 그림이 좌우로 번갈아 놓이는 줄 3개로 바꾼다. 구현 파일보다 테스트를 먼저 만든다(TDD).

### 1. `src/components/landing/feature-showcase.tsx` — 서버 컴포넌트 (+ `feature-showcase.test.tsx`)
```tsx
export function FeatureShowcase(props: {
  month: YearMonth;
  dataMonths: YearMonth[];   // 데이터가 있는 달. 컴포넌트에서 오래된 달 → 최근 달로 정렬해 쓴다
  cardLabels: string[];
  snapshot: Snapshot;
  findings: Findings;
}): React.JSX.Element
```
- 줄마다 `<article>` 하나. 글 쪽: 24px `text-primary` 아이콘(지금 `page.tsx`의 `CardIcon`·`SearchIcon`·`ShieldCheckIcon`) → `<h3>` 제목(`text-title-lg text-ink`) → 본문(`text-lg leading-relaxed text-body`). 제목·본문 문구는 지금 `page.tsx`의 `features`와 글자 하나 다르지 않게 옮긴다.
- 그림 쪽: 보조 카드(`rounded-3xl bg-surface-soft p-6 sm:p-8`). `lg:` 이상에서 글·그림 2열이고, 두 번째 줄은 그림이 왼쪽이다. 그 아래 화면에서는 글 → 그림.
- 줄마다 `reveal`을 붙인다.
1. **한 화면에 모든 카드**: `cardLabels` 칩들 → (아래로 모이는 선, `aria-hidden`) → 한 줄 `` `${formatMonthShort(month)} 총지출 ${formatWon(snapshot.total)} · 거래 ${snapshot.transactionCount}건` ``. 카드별 금액은 쓰지 않는다.
2. **확인이 필요한 지출**: 탐지 종류마다 한 칸(`rounded-2xl border border-amber-200 bg-amber-50 text-amber-900`), 칸 머리말은 `FINDING_KIND_LABELS`. 항목이 없는 종류의 칸은 그리지 않는다.
   - 정기결제로 보여요: `recurring` 항목마다 한 줄 — 가맹점 · `formatWon(amount)`, 그 아래 `dataMonths` 눈금(`formatMonthShort`)과 `seriesMonths`에 든 달에만 점. 점 줄은 `aria-hidden`이고, 같은 내용을 `` `${seriesMonths 첫 달}~${마지막 달} 매달 결제` `` 같은 글자로도 둔다.
   - 중복 결제 의심: 첫 `duplicate` 항목의 거래마다 작은 칸 하나(`formatDate(date)` · `formatWon(amount)`) + 가맹점.
   - 고액 결제: 첫 `large` 항목. `snapshot.daily` 막대(그날만 진하게, 나머지 같은 색 40%, `aria-hidden`) + `` `${formatDate(date)} ${merchant} ${formatWon(amount)}` ``.
   - 칸들 아래 캡션 `정상 지출일 수 있어요`(`text-caption text-body`).
3. **연동 없이, 언제든 삭제**: 두 열. `받는 것` — `CheckIcon text-primary` + `카드사에서 받은 이용내역 파일`. `받지 않는 것` — `XIcon text-body` + `카드번호` · `계좌` · `카드사 비밀번호`.
- 화면 문장은 템플릿 문자열 하나로 만든다(HTML에 `<!-- -->`가 끼지 않게).
- 그림 안에 링크·버튼·`tabIndex`를 두지 않는다.
- 테스트: 줄 3개가 `article`이고 각 `h3`와 아이콘이 있다, 문구가 그대로다, 합계 줄, 정기결제 줄·점 개수(`seriesMonths` 길이), 중복 칸 개수(거래 수), 고액 줄, 항목이 없는 종류의 칸은 없다, 받지 않는 것 3개, 링크·버튼이 없다.

### 2. `src/app/page.tsx` (+ `page.test.tsx`)
- 기능 밴드의 카드 그리드와 `features` 상수를 `<FeatureShowcase />`로 바꾼다. 밴드 제목 `파일 하나로 시작해요`(`h2`)는 그대로 둔다. `dataMonths`는 `dashboard.months`의 `month` 값이다.
- 기존 랜딩 테스트("explains the three features…": `h3`가 `article` 안에 있고 아이콘이 있다, 기능 문구)는 그대로 통과해야 한다. 같은 금액·문구가 여러 곳에 나와 `getByText`가 여러 개를 찾으면 `within(...)`으로 범위를 좁힌다. 단언 내용은 줄이지 않는다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3211 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3211/ && break; sleep 0.5; done
curl -sf http://localhost:3211/ | grep -q '9월 총지출 1,517,200원 · 거래 26건'
curl -sf http://localhost:3211/ | grep -q '예시 구름선 통신'
curl -sf http://localhost:3211/ | grep -q '9월 23일 예시 별숲 가구실 920,000원'
curl -sf http://localhost:3211/ | grep -q '카드사 비밀번호'
curl -sf http://localhost:3211/ | grep -q '정상 지출일 수 있어요'
pkill -f 'next start -p 3211'
! grep -q "use client" src/components/landing/feature-showcase.tsx
! grep -rnE "gradient|backdrop-blur|blur-|bg-linear|bg-radial|bg-conic" src --include='*.tsx'
! grep -rn "dangerouslySetInnerHTML" src --include='*.tsx'
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI|위험 지출" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3211'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - 금액·날짜를 `buildDashboard` 결과에서만 가져오는가? `components/`가 DTO만 받는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙과 DESIGN.md 금지 항목을 위반하지 않았는가?
3. 결과에 따라 `phases/3-landing-visual/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `FeatureShowcase` 시그니처와 세 줄의 그림 구성을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 금액·날짜·건수·가맹점명을 손으로 적지 마라. 이유: 랜딩 수치는 `buildDashboard` 결과에서만 가져온다.
- 카드별 금액을 보여주지 마라. 이유: 대시보드에 없는 정보다.
- "위험", "낭비", "절약", "부정 결제", "구독 확정", "이중 결제"를 쓰지 마라. 이유: 탐지는 규칙 기반 후보다(UX_GUIDE 용어 표).
- amber를 탐지 칸 밖(버튼·강조 장식)에 쓰지 마라. 이유: amber는 확인이 필요한 지출과 mock 배너에만 쓴다.
- Recharts나 `'use client'`를 쓰지 마라.
- 히어로·요금·시작 단계 밴드를 고치지 마라. 이유: 이 step의 범위가 아니다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
