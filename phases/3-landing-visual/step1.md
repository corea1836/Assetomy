# Step 1: summary-card

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("색 쓰임", "화면별 요소"의 총지출 카드·월간 요약 카드, "레이아웃", "문구")
- `/docs/UX_GUIDE.md` ("aha: 첫 대시보드", "1. 계층 구조", "3. 일관성"의 용어 표)
- `/docs/PRD.md` ("플랜별 기능"의 AI 월간 요약, 표현 규칙)
- `/src/components/dashboard/monthly-summary.tsx`, `/src/components/dashboard/monthly-summary.test.tsx`
- `/src/components/dashboard/total-card.tsx`
- `/src/app/demo/page.tsx`, `/src/app/demo/page.test.tsx`
- `/src/lib/demo/fixture.ts`
- 이전 step에서 만든 파일: `/src/components/icons.tsx`(`SparklesIcon`), `/src/app/globals.css`(`primary-soft` 등 토큰)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

월간 요약을 눈에 띄는 민트 카드로 바꾸고, 데모에서 총지출 바로 아래로 옮긴다. 이 카드는 나중에 실제 대시보드와 랜딩(step 4)에서도 그대로 쓴다. 구현 파일보다 테스트를 먼저 고친다(TDD).

### 1. `src/components/dashboard/monthly-summary.tsx` (+ 테스트)
```tsx
export function MonthlySummary(props: {
  summary: string;
  source: "ai" | "example";
}): React.JSX.Element
```
- `<section>`: `rounded-3xl bg-primary-soft p-6 sm:p-8`.
- 제목 줄: `SparklesIcon`(20px, `text-primary`, `aria-hidden`) + `<h2>` "이번 달 요약"(`text-lg font-semibold text-ink`). 제목의 접근 가능한 이름은 "이번 달 요약" 그대로다.
- 본문: `text-lg leading-relaxed text-ink whitespace-pre-line`. 텍스트로만 렌더링한다.
- 본문 아래 출처 한 줄(`text-caption text-body`), `source`에 따라 문구가 정해진다:
  - `"ai"`: `AI가 가맹점명과 집계로 쓴 요약이에요. 금액은 코드로 계산해요.`
  - `"example"`: `예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요.`
- 테스트: 위 클래스, 두 출처 문구, 아이콘 `aria-hidden`, 기존 스크립트 문자열·금지 표현 단언 유지. 기존 단언 중 본문 클래스(`text-base`, `text-body`)는 새 규칙(`text-lg`, `text-ink`)으로 바꾼다.

### 2. `src/lib/demo/fixture.ts`
- `export const DEMO_SUMMARY_MONTH: YearMonth = "2026-09";`를 `DEMO_SUMMARY` 옆에 추가한다. 이유: 데모 페이지와 랜딩(step 4)이 "요약이 있는 달"을 같은 상수로 판단한다.

### 3. `src/app/demo/page.tsx` (+ `page.test.tsx`)
- 첫 줄 그리드(`grid gap-6 md:grid-cols-2`)를 바꾼다: 왼쪽 열은 `flex flex-col gap-6` 안에 `TotalCard` → 요약, 오른쪽 열은 `CategoryList`.
  - `month === DEMO_SUMMARY_MONTH`이면 `<MonthlySummary summary={DEMO_SUMMARY} source="example" />`.
  - 아니면 지금의 안내 문장 `데모 요약은 2026년 9월에만 있어요`(`text-caption text-body`)를 그 자리에 둔다.
- 페이지 아래쪽(추세 다음)에 있던 요약과 안내 문장은 지운다.
- 모바일 읽는 순서는 총지출 → 요약 → 카테고리다(DOM 순서).
- 테스트:
  - 요약 제목이 "총지출" 다음, "카테고리" 앞에 온다.
  - 요약 출처가 예시 문구다.
  - 지난 달(`?month=2026-06`)에서는 같은 자리에 안내 문장이 있고 요약 제목이 없다.
  - 기존 "after the summary" 테스트는 하단 CTA가 추세 다음에 온다는 단언으로 바꾼다. CTA 링크 개수·클래스 단언은 유지한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3211 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3211/demo && break; sleep 0.5; done
curl -sf http://localhost:3211/demo | grep -q '예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요.'
curl -sf 'http://localhost:3211/demo?month=2026-06' | grep -q '데모 요약은 2026년 9월에만 있어요'
pkill -f 'next start -p 3211'
! grep -rn "dangerouslySetInnerHTML" src --include='*.tsx'
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3211'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - `components/`가 DTO·문자열만 받는가? 요약이 텍스트로만 렌더링되는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/3-landing-visual/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `MonthlySummary` 새 시그니처, 출처 문구 두 개, `DEMO_SUMMARY_MONTH`, 데모 첫 줄 배치를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 데모에 `source="ai"`를 쓰지 마라. 이유: 데모 요약은 fixture의 고정 문장이라 AI가 쓴 것이 아니다.
- "AI가 분석했어요", "AI 분석 결과", "Powered by AI" 같은 표현이나 배지를 넣지 마라. 이유: UX_GUIDE 용어 규칙이다. AI는 출처 한 줄에서만 밝힌다.
- 요약 카드에 다크 면이나 색 있는 왼쪽 보더를 쓰지 마라. 이유: 다크 면은 랜딩에만 쓰고, 색 있는 왼쪽 보더 카드는 금지다(DESIGN).
- `TotalCard`·`CategoryList`의 내용과 숫자 계산을 바꾸지 마라. 이유: 이 step은 요약 카드와 배치만 다룬다.
- 랜딩(`src/app/page.tsx`)을 고치지 마라. 이유: 랜딩의 요약 밴드는 step 4에서 만든다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
