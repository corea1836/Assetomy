# Step 4: summary-band

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("랜딩 (`/`)" 전체, 특히 "다크 밴드의 깊이"와 "9월 요약". "색 쓰임"의 다크 밴드 위 증감, "화면별 요소"의 월간 요약 카드, "숫자 · 날짜")
- `/docs/UX_GUIDE.md` ("유치: 랜딩"의 9월 요약 밴드, "3. 일관성"의 용어 표)
- `/docs/ADR.md` (ADR-005: 숫자는 코드, 문장은 LLM)
- `/src/types/dashboard.ts`, `/src/lib/format.ts`, `/src/lib/demo/fixture.ts`(`DEMO_SUMMARY`, `DEMO_SUMMARY_MONTH`)
- `/src/app/page.tsx`, `/src/app/page.test.tsx`
- 이전 step에서 만든 파일: `/src/components/dashboard/monthly-summary.tsx`, `/src/components/landing/dark-backdrop.tsx`, `/src/components/landing/feature-showcase.tsx`, `/src/components/dashboard/finding-labels.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

기능 쇼케이스와 시작 단계 사이에 다크 밴드 하나를 새로 넣는다. 월간 요약 문장과 그 근거 숫자를 나란히 보여, "문장은 AI가 쓰고 숫자는 코드가 계산한다"를 전한다. 구현 파일보다 테스트를 먼저 만든다(TDD).

### 1. `src/components/landing/summary-band.tsx` — 서버 컴포넌트 (+ `summary-band.test.tsx`)
```tsx
export function SummaryBand(props: {
  month: YearMonth;
  summary: string;
  findings: Findings;
  trend: Trend | null;
  mom: MonthOverMonth | null;
}): React.JSX.Element
```
- `<section className="relative isolate overflow-hidden bg-surface-dark text-white">` + `<DarkBackdrop light="right" />`. 안쪽 너비·여백은 다른 밴드와 같다(`mx-auto max-w-[1248px] px-6 py-24`).
- 제목 `<h2>` `숫자는 코드가 계산하고, 요약은 문장으로 정리해요`(`text-display-sm`), 부제(`text-lg text-muted-soft`) `매달 집계를 읽고 달라진 점과 확인할 지출을 한 문단으로 정리해요.` 제목 묶음에 `reveal`.
- `lg:` 이상 2열. 왼쪽: `<MonthlySummary summary={summary} source="example" />`(민트 카드 그대로). 오른쪽: 근거 `<ol aria-label="요약의 근거">`. 근거 묶음에 `reveal`.
  - 칸마다 `rounded-3xl border border-hairline-dark bg-surface-dark-elevated p-6`. 번호(①②③, `aria-hidden`, `text-primary-on-dark`) · 종류(`FINDING_KIND_LABELS`, `text-amber-200 text-sm`) · 설명(`text-muted-soft`) · 금액(`font-mono text-white`).
  - 순서와 내용(종류에 항목이 없으면 그 칸을 빼고 번호를 당긴다):
    1. 고액 결제: `large` 항목 중 금액이 가장 큰 것. 설명 `` `${formatDate(date)} ${merchant}` ``, 금액 `formatWon(amount)`.
    2. 정기결제로 보여요: 설명은 `recurring` 항목 가맹점을 ` · `로 이은 것, 금액 `` `${byKind.recurring.count}건 · ${formatWon(byKind.recurring.amount)}` ``.
    3. 중복 결제 의심: 첫 `duplicate` 항목. 설명 `` `${formatDate(첫 거래 date)} ${merchant}` ``, 금액 `` `${formatWon(첫 거래 amount)} × ${transactions.length}` ``.
- 아래(전체 너비): `trend`가 있으면 `trend.months` 세로 막대(`role="img"`, `aria-label` `월별 지출 추세 막대(예시)`). 선택 달(`month`) 막대는 `bg-primary-on-dark`, 나머지는 `bg-primary-on-dark/40`. 막대 아래 `formatMonthShort` 라벨. 고액 결제 칸이 있으면 선택 달 막대 위에 ① 표시(`aria-hidden`). 막대 높이는 그 중 최댓값 기준 비율이다.
- 막대 옆이나 아래에 전월 대비 문장(`mom`이 있을 때): `` `${formatMonthShort(previousMonth)}보다 ${formatSignedWon(diff)} 늘었어요` `` / `줄었어요`(음수) / `` `${…}과 같아요` ``(0). 다크 면이라 `text-white`이고 증감 색을 쓰지 않는다.
- 요약 문장을 코드로 쪼개거나, 문장과 근거를 선으로 잇지 않는다.
- 화면 문장은 템플릿 문자열 하나로 만든다. 그림 안에 링크·버튼·`tabIndex`를 두지 않는다.
- 테스트: 제목·부제, 요약 카드와 예시 출처 문구, 근거 순서와 문장 3개, 항목이 없는 종류를 뺐을 때 번호가 당겨지는지, 추세 막대 개수와 선택 달 강조, 전월 대비 문장 3가지(증가·감소·같음), `trend`가 `null`이면 막대가 없는지, 링크·버튼이 없는지.

### 2. `src/app/page.tsx` (+ `page.test.tsx`)
- 기능 쇼케이스 밴드 다음, 시작 단계 밴드 앞에 `<SummaryBand />`를 넣는다. `month === DEMO_SUMMARY_MONTH`일 때만 `summary={DEMO_SUMMARY}`로 그린다. 다른 달이면 밴드를 그리지 않는다. 이유: 요약 문장은 그 달에만 맞다.
- 테스트: 밴드 순서(기능 → 요약 → 시작 단계 → 요금), `buildDashboard`가 다른 달을 돌려주면 밴드가 없는지. 기존 단언은 유지하고, 여러 곳에 같은 텍스트가 나오면 `within(...)`으로 좁힌다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3211 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3211/ && break; sleep 0.5; done
curl -sf http://localhost:3211/ | grep -q '숫자는 코드가 계산하고, 요약은 문장으로 정리해요'
curl -sf http://localhost:3211/ | grep -q '예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요.'
curl -sf http://localhost:3211/ | grep -q 'aria-label="요약의 근거"'
curl -sf http://localhost:3211/ | grep -q '2건 · 69,900원'
curl -sf http://localhost:3211/ | grep -q '32,000원 × 2'
curl -sf http://localhost:3211/ | grep -q '8월보다 +909,200원 늘었어요'
pkill -f 'next start -p 3211'
! grep -q "use client" src/components/landing/summary-band.tsx
! grep -rnE "gradient|backdrop-blur|blur-|bg-linear|bg-radial|bg-conic" src --include='*.tsx'
! grep -rn "dangerouslySetInnerHTML" src --include='*.tsx'
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI|위험 지출" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3211'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - 금액·날짜를 `buildDashboard` 결과에서만 가져오는가? 요약을 텍스트로만 렌더링하는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙과 DESIGN.md 금지 항목을 위반하지 않았는가?
3. 결과에 따라 `phases/3-landing-visual/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `SummaryBand` 시그니처, 근거 순서, 랜딩 밴드 순서를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- LLM을 호출하거나 요약 문장을 새로 만들지 마라. 이유: 랜딩은 fixture의 `DEMO_SUMMARY`만 쓴다.
- `MonthlySummary`에 `source="ai"`를 넘기지 마라. 이유: 이 문장은 AI가 쓴 것이 아니라 예시다.
- 다크 면에서 `text-increase`·`text-decrease`를 쓰지 마라. 이유: 다크 면 대비가 4.5:1에 못 미친다(DESIGN "색 쓰임").
- "AI가 분석했어요", "AI 분석 결과", "Powered by AI"를 쓰지 마라.
- 빛을 두 개 이상 두거나 움직이게 하지 마라. 이유: DESIGN "다크 밴드의 깊이".
- Recharts나 `'use client'`를 쓰지 마라.
- 히어로·기능 쇼케이스·시작 단계·요금 밴드의 내용을 고치지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
