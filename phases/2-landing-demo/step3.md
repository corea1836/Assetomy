# Step 3: demo-page

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` (UC 01 데모, "플랜별 기능"의 데모 열, 표현 규칙)
- `/docs/USER_FLOW.md` ("화면 목록"의 `/demo`, "① 진입 · 인증 · 분기")
- `/docs/DESIGN.md` ("레이아웃", "컴포넌트"의 워드마크, "문구")
- `/src/types/transaction.ts`, `/src/types/dashboard.ts`, `/src/types/category.ts`
- `/src/lib/analytics/dashboard.ts`(`buildDashboard`)와 `detection.ts`(탐지 규칙·임계값 상수)
- 이전 step에서 만든 파일: `/src/lib/format.ts`, `/src/components/dashboard/` 아래 모든 컴포넌트와 테스트

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

로그인 없이 Pro 대시보드를 보여주는 `/demo` 페이지와 그 정적 fixture를 만든다. DB·LLM은 호출하지 않는다. 구현 파일보다 테스트 파일을 먼저 만든다.

### 1. `src/lib/demo/fixture.ts` (+ `fixture.test.ts`)
```ts
export const DEMO_TODAY: IsoDate          // '2026-10-05'
export const DEMO_TRANSACTIONS: Transaction[]
export const DEMO_SUMMARY: string         // 데모용 고정 월 요약(9월)
```
- 기간 `2026-06-01`~`2026-09-30`(4개월), 카드 2장(`생활비 카드`, `온라인 쇼핑 카드`). 달마다 15건 이상.
- 가맹점명은 **가상의 이름**만 쓴다(실존 브랜드·상호 금지). 같은 가맹점명은 같은 `merchantKey`.
- `id`는 고유, `amount`는 0이 아닌 정수. 9월 총지출이 대략 120만~250만 원이 되게 한다.
- `detection.ts`의 실제 규칙으로 9월에 아래가 모두 잡히게 데이터를 설계한다.
  - 정기결제 2건 이상: 4개월 동안 달마다 정확히 1번, 비슷한 날짜·같은 금액(또는 ±5% 이내)으로 결제되는 가맹점(구독·통신 등)
  - 중복 결제 의심 1건 이상: 9월에 같은 카드·같은 날·같은 가맹점·같은 금액(1만 원 이상, 교통 아님) 2건, 그에 대응하는 취소 없음
  - 고액 결제 1건 이상: 9월에 전체 양수 거래 중앙값의 10배를 넘는 결제
- 9월에 취소(음수) 거래가 1건 이상 있다. 9월 카테고리는 7개 이상이다.
- 한 달에 여러 번 가는 카페 같은 가맹점도 넣는다(정기결제로 잡히지 않아야 한다).
- `DEMO_SUMMARY`: fixture의 9월 내용과 맞는 2~3문장. **숫자(0-9)를 쓰지 않는다.** 이유: 금액·건수는 코드로만 계산해 보여준다. `절약`·`낭비`·`부정 결제`·`AI가 분석` 금지. 해요체.
- 테스트로 단언할 것: `buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: 'pro', today: DEMO_TODAY })`의 `month === '2026-09'`, `months.length === 4`, `mom !== null`, `trend?.months.length === 4`, `findings.byKind`의 정기결제 2건 이상·중복 1건 이상·고액 1건 이상, `snapshot.categories.length >= 7`, 9월 음수 거래 존재, 자주 가는 카페가 정기결제 finding에 없음, `id` 고유, 모든 날짜가 기간 안, 같은 가맹점명의 `merchantKey` 일치, `DEMO_SUMMARY`에 숫자와 금지어 없음.

### 2. `src/components/wordmark.tsx` (+ `wordmark.test.tsx`)
```tsx
export function Wordmark(props: { tone?: 'default' | 'onDark' }): React.JSX.Element
```
- 소문자 `assetomy`, `text-[22px] font-medium leading-none tracking-[-0.02em]`. `default`는 `text-primary`, `onDark`는 `text-white`.

### 3. `src/app/demo/page.tsx`
- `export const metadata = { title: '데모 · assetomy' }`
- Next.js 16에서 `searchParams`는 `Promise`다. `month`가 문자열일 때만 넘긴다.
- `buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: 'pro', month, today: DEMO_TODAY })`. 결과가 `null`이거나 `plan !== 'pro'`면 `notFound()`.
- 레이아웃: `max-w-5xl mx-auto px-4 sm:px-6`, 섹션 사이 `space-y-12`, 카드 사이 `gap-6`, `md:` 이상에서 2열.
  1. 헤더: `<Link href="/">`로 감싼 `Wordmark` · 보조 `데모` · 작은 Primary 버튼 `내 명세서로 해보기`(`/login`으로 가는 `Link`)
  2. 안내 한 줄(보조 글자): `예시 데이터로 만든 화면이에요. 실제 카드 내역이 아니에요.`
  3. 상단 줄: `<h1>`(페이지 제목 스타일) + `MonthSelect` + 보조 `{formatMonth(monthOf(lastDate))}까지 반영됨`
     - `<h1>` 텍스트는 **템플릿 문자열 하나**로 만든다: ``{`${formatMonth(month)} 지출`}``. 이유: JSX에서 `{a} 지출`처럼 나누면 HTML에 `<!-- -->`가 끼어 AC가 문자열을 찾지 못한다.
  4. `TotalCard` · `CategoryList` (2열)
  5. `TopMerchants` · `DailyChart` (2열)
  6. `FindingsList`(`dataMonthCount = months.length`)
  7. `trend`가 있으면 `TrendChart`
  8. `MonthlySummary`(`DEMO_SUMMARY`). 9월이 아닌 달을 고르면 요약 대신 보조 문구 `데모 요약은 2026년 9월에만 있어요`.
- `/login`은 아직 없다(이후 phase). 링크만 둔다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # fixture·wordmark 테스트 포함 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3210 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3210/demo && break; sleep 0.5; done
curl -sf http://localhost:3210/demo | grep -q '2026년 9월 지출'
curl -sf http://localhost:3210/demo | grep -q '확인이 필요한 지출'
curl -sf http://localhost:3210/demo | grep -q '내 명세서로 해보기'
curl -sf 'http://localhost:3210/demo?month=2026-07' | grep -q '2026년 7월 지출'
curl -sf 'http://localhost:3210/demo?month=abc' | grep -q '2026년 9월 지출'
pkill -f 'next start -p 3210'
! grep -rnE "@/lib/supabase|@/services|getMode" src/app/demo src/lib/demo
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3210'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`/demo`는 정적 fixture, DB·LLM 호출 없음)
   - ADR 기술 스택과 DESIGN.md 규칙을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-landing-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 fixture export 이름과 9월 탐지 건수, 페이지 경로를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 탐지 규칙이나 임계값을 fixture에 맞추려고 `src/lib/analytics/`를 수정하지 마라. 이유: 데이터를 규칙에 맞춰 설계해야 한다.
- 데모 페이지에서 `buildDashboard` 결과를 가공하거나 숫자를 직접 계산하지 마라. 이유: 금액은 analytics 코드로만 계산한다.
- `DEMO_SUMMARY`에 숫자를 넣지 마라. 이유: 위와 같다.
- 실존 브랜드·상호를 가맹점명으로 쓰지 마라. 이유: 공개 데모에 실제 상호를 쓰지 않는다.
- 데모에 업로드·카테고리 수정·결제 기능을 넣지 마라. 이유: 데모는 보기 전용이다(PRD).
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
