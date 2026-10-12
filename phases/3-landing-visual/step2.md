# Step 2: hero-visual

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("랜딩 (`/`)" 전체, 특히 "다크 밴드의 깊이"와 "히어로". "차트"의 랜딩 그림 규칙, "색 쓰임")
- `/docs/UX_GUIDE.md` ("유치: 랜딩", "1. 계층 구조"의 랜딩 히어로 읽는 순서와 첫 화면 규칙)
- `/src/types/dashboard.ts`, `/src/lib/format.ts`, `/src/lib/demo/fixture.ts`
- `/src/components/dashboard/findings-list.tsx`
- `/src/app/page.tsx`, `/src/app/page.test.tsx`
- 이전 step에서 만든 파일: `/src/app/globals.css`(`surface-dark-raised`, `shadow-float`), `/src/components/landing/dark-backdrop.tsx`, `/src/components/icons.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

히어로 오른쪽의 목업 카드 한 장을 "흩어진 파일이 한 화면으로 모인다"를 보여주는 겹친 그림으로 바꾼다. 구현 파일보다 테스트를 먼저 만든다(TDD).

### 1. 탐지 종류 라벨 공유 (`src/components/dashboard/finding-labels.ts`)
- `findings-list.tsx` 안의 `KIND_LABELS`를 `export const FINDING_KIND_LABELS: Record<FindingKind, string>`로 이 파일에 옮기고, `findings-list.tsx`는 이것을 import한다. 문구는 바꾸지 않는다. 이유: 랜딩 그림이 같은 라벨을 다시 적지 않게 한다.

### 2. `src/components/landing/hero-visual.tsx` — 서버 컴포넌트 (+ `hero-visual.test.tsx`)
```tsx
export function HeroVisual(props: {
  month: YearMonth;
  cardLabels: string[];
  snapshot: Snapshot;
  findings: Findings;
}): React.JSX.Element
```
DESIGN.md "히어로"의 그림 1~4를 그린다.
1. **파일 칩**: `cardLabels` 앞 2개에 확장자 `.xlsx`, `.csv`를 순서대로 붙인 칩(`surface-dark-elevated`, `border-hairline-dark`, `rounded-full` 또는 `rounded-2xl`). `lg:` 이상에서는 칩에서 앞 카드로 이어지는 1px `hairline-dark` 선(인라인 SVG, `aria-hidden`).
2. **뒤 카드**(`rounded-3xl border border-hairline-dark bg-surface-dark-elevated`, `lg:` 이상에서만 보이고 앞 카드보다 위·오른쪽으로 어긋남): `snapshot.daily` 세로 막대. 가장 큰 날만 `bg-primary-on-dark`, 나머지는 `bg-primary-on-dark/40`. 막대 묶음은 `role="img"`, `aria-label`은 `` `${formatMonth(month)} 일별 지출 막대(예시)` ``.
3. **앞 카드**(`rounded-3xl border border-hairline-dark bg-surface-dark-raised shadow-float p-8`): 지금 `page.tsx` 목업 카드의 내용을 그대로 옮긴다 — `{formatMonth(month)} 총지출`, `formatWon(snapshot.total)`(`font-mono text-3xl`), `ul aria-label="예시 상위 카테고리"`의 상위 3개(라벨·금액·`div.bg-primary-on-dark` 막대), 후보 줄 `확인이 필요한 지출 {종류별 count 합}건 · 후보 합계 {formatWon(candidateTotal)}`(`text-amber-200`), `예시 데이터`.
4. **떠 있는 칩**(`rounded-2xl border border-hairline-dark bg-surface-dark-raised shadow-float`, `lg:` 이상에서 앞 카드 아래 모서리에 걸침): `findings.items`의 첫 `duplicate` 항목으로 `` `${FINDING_KIND_LABELS.duplicate} · ${formatDate(첫 거래 date)} ${formatWon(첫 거래 amount)} × ${transactions.length}` ``(`text-amber-200`). 중복 결제 의심 항목이 없으면 칩을 그리지 않는다.
- `lg:` 아래 화면에서는 겹치지 않고 세로로 쌓는다: 파일 칩 줄 → 앞 카드 → 떠 있는 칩. 뒤 카드와 연결선은 숨긴다. 375px에서 가로 스크롤이 생기면 안 된다.
- 화면에 보이는 문장은 **템플릿 문자열 하나**로 만든다. 이유: JSX 조각이 나뉘면 HTML에 `<!-- -->`가 끼어 AC의 문자열 검색이 실패한다.
- 그림 안에 링크·버튼·`tabIndex`를 두지 않는다.
- 테스트: props 숫자가 그대로 나오는지(총지출·카테고리 3개·후보 줄·떠 있는 칩 문장), 카드 라벨 칩, duplicate가 없을 때 칩이 없는지, 일별 막대의 `role="img"` 이름, 링크·버튼이 없는지.

### 3. `src/app/page.tsx` (+ `page.test.tsx`)
- 히어로 오른쪽 목업 카드를 `<HeroVisual />`로 바꾼다. `cardLabels`는 `[...new Set(DEMO_TRANSACTIONS.map(({ cardLabel }) => cardLabel))]`로 만든다(숫자가 아니라 라벨이므로 페이지에서 만든다).
- 히어로 글 쪽(헤드라인 → 부제 → 데모 보기 → 안내)은 그대로 두고, `lg:` 아래 화면에서 그림은 글 아래에 온다.
- 기존 랜딩 테스트(목업 숫자, `buildDashboard` 결과가 바뀌면 숫자가 따라 바뀌는지)는 그대로 통과해야 한다. 떠 있는 칩 문장 단언을 하나 추가한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3211 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3211/ && break; sleep 0.5; done
curl -sf http://localhost:3211/ | grep -q '중복 결제 의심 · 9월 18일 32,000원 × 2'
curl -sf http://localhost:3211/ | grep -q '생활비 카드.xlsx'
curl -sf http://localhost:3211/ | grep -q '온라인 쇼핑 카드.csv'
curl -sf http://localhost:3211/ | grep -q '1,517,200원'
curl -sf http://localhost:3211/demo | grep -q '중복 결제 의심'
pkill -f 'next start -p 3211'
! grep -q "use client" src/components/landing/hero-visual.tsx
! grep -rnE "gradient|backdrop-blur|blur-|bg-linear|bg-radial|bg-conic" src --include='*.tsx'
! grep -rn "dangerouslySetInnerHTML" src --include='*.tsx'
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3211'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - 금액·날짜를 `buildDashboard` 결과에서만 가져오는가? `components/`가 DTO만 받는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙과 DESIGN.md 금지 항목을 위반하지 않았는가?
3. 결과에 따라 `phases/3-landing-visual/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `HeroVisual` 시그니처, `FINDING_KIND_LABELS` 위치, 페이지의 `cardLabels` 계산을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 금액·날짜·건수를 손으로 적지 마라. 이유: 숫자는 analytics 코드로만 만든다. 기존 테스트가 `buildDashboard`를 바꿔 숫자가 따라오는지 확인한다.
- 카드별 금액을 보여주지 마라. 이유: 대시보드에 없는 정보라 데모가 약속하지 않은 화면이 된다(DESIGN "기능 쇼케이스").
- Recharts나 `'use client'`를 쓰지 마라. 이유: 랜딩 그림은 서버에서 div·SVG로 그린다.
- 카테고리별로 다른 색, 글로우, blur, 그라데이션 클래스를 쓰지 마라. 이유: DESIGN.md 금지 항목이다.
- 히어로에 `reveal`(등장 모션)을 붙이지 마라. 이유: 첫 화면은 바로 보여야 한다.
- 히어로 글 쪽의 문구·링크·Tab 순서를 바꾸지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
