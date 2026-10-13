# Step 4: summary-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("화면별 요소"의 월간 요약 카드·월 요약(Free), "버튼"의 Text 스타일, "레이아웃"의 대시보드 첫 줄)
- `/docs/UX_GUIDE.md` (월간 요약 위치, 업그레이드 진입점, AI 표현 규칙)
- `/docs/ARCHITECTURE.md` ("패턴", "월 요약")
- `/docs/USER_FLOW.md` (② 대시보드, ④ 월간 재방문)
- `/docs/testing/BROWSER_TESTING.md` ("수동 확인: 월간 요약")
- 기존 코드: `/src/components/dashboard/monthly-summary.tsx`와 테스트(데모·랜딩이 `source="example"`로 쓴다: `/src/app/demo/page.tsx`, `/src/components/landing/summary-band.tsx`), `/src/components/billing/upgrade-button.tsx`와 테스트, `/src/components/button-styles.ts`, `/src/lib/errors/messages.ts`, `/src/app/dashboard/page.tsx`와 `page.test.tsx`(모듈 mock 방식)
- 이전 step 산출물: `/src/lib/summary/monthly-summary.ts`(`prepareSummary`·`resolveMonthlySummary`·`PreparedSummary`·`SummaryDeps`), `/src/lib/summary/deps.ts`(`defaultSummaryDeps`), `/src/types/summary.ts`(`MonthlySummaryView`), `/src/services/llm/mock-summarizer.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드 총지출 카드 바로 아래에 AI 월간 요약 카드를 붙인다(DESIGN "월간 요약 카드", UX_GUIDE).

- 요약은 대시보드 Server Component 렌더 중에 만든다(ADR-001의 예외). `Suspense`로 감싸 나머지 숫자를 먼저 보여주고, 요약 영역만 "만들고 있어요"를 보인다.
- `Suspense`의 `key`는 입력 해시다. 이유: `router.refresh()`(카테고리 수정·업로드 완료)나 월 이동 때 이미 보이던 경계가 새 요약을 기다리면 화면 전체 갱신이 LLM 응답만큼 늦어진다. key가 바뀌면 그 경계만 새로 "만들고 있어요"를 보인다(ARCHITECTURE "월 요약").
- Free 카드에는 "Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요" + Text 스타일 "Pro로 보기"(upgrade source `summary`)를 둔다. 만드는 중·실패 상태에도 둔다(DESIGN "월 요약(Free)").
- 실패하면 "요약을 만들지 못했어요. 새로고침하면 다시 만들어요."를 보이고 이전 요약은 보이지 않는다(ADR-005).
- `components/`는 DTO·문자열만 받는다(AGENTS.md). 요약 입력(`PreparedSummary`·`SummaryInput`)은 서버에만 있고 클라이언트 컴포넌트로 넘기지 않는다. 이유: Server→Client props는 RSC payload로 노출된다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts(x)`).

## 작업

### 1. 문구 `src/lib/errors/messages.ts`

```ts
export const SUMMARY_STATUS_MESSAGES = {
  pending: "이번 달 요약을 만들고 있어요",
  failed: "요약을 만들지 못했어요. 새로고침하면 다시 만들어요.",
} as const;
```

### 2. Text 스타일 업그레이드 버튼 `src/components/billing/upgrade-button.tsx`

- `variant?: "primary" | "secondary" | "text"`. `text`는 `buttonClass`를 쓰지 않고 `rounded-lg font-semibold text-primary hover:underline active:text-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`를 쓴다(DESIGN "버튼"의 Text, 대시보드 `구독 관리` 링크와 같은 클래스). 동작(모달 열기·포커스 복귀)은 그대로다.

### 3. 요약 카드 `src/components/dashboard/monthly-summary.tsx`

```ts
export function MonthlySummary(props: { summary: string; source: "ai" | "example"; upgrade?: boolean }): React.JSX.Element
export function MonthlySummaryStatus(props: { state: "pending" | "failed"; upgrade?: boolean }): React.JSX.Element
```
- 두 컴포넌트는 같은 카드 겉모양을 쓴다: `section.rounded-3xl bg-primary-soft p-6 sm:p-8`, 제목 줄 `SparklesIcon`(20px `text-primary`) + `h2` "이번 달 요약"(`text-lg font-semibold text-ink`).
- `MonthlySummary`: 기존 본문·출처 줄을 그대로 둔다(데모·랜딩 화면이 바뀌지 않아야 한다). `upgrade`가 true면 출처 줄 아래에 `p.mt-4.text-sm.text-body` "Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요"와 `UpgradeButton source="summary" label="Pro로 보기" variant="text"`.
- `MonthlySummaryStatus`: 본문 자리에 `p.mt-4.text-base.text-body`로 `SUMMARY_STATUS_MESSAGES[state]`. `pending`이면 `section`에 `aria-busy="true"`. 출처 줄은 없다. `upgrade`면 위와 같은 업그레이드 줄.
- 요약 문장은 텍스트로만 렌더링한다(`dangerouslySetInnerHTML` 금지).

### 4. 서버 섹션 `src/app/dashboard/monthly-summary-section.tsx`

```ts
export async function MonthlySummarySection(props: {
  userId: string; prepared: PreparedSummary; deps: SummaryDeps;
}): Promise<React.JSX.Element>
```
- `resolveMonthlySummary(userId, prepared, deps)` 결과가 `ready`면 `<MonthlySummary summary={text} source="ai" upgrade={prepared.plan === "free"} />`, `failed`면 `<MonthlySummaryStatus state="failed" upgrade={prepared.plan === "free"} />`.
- 이 파일에 `"use client"`를 쓰지 않는다. `prepared`·`deps`를 다른 컴포넌트 props로 넘기지 않는다.

### 5. 대시보드 페이지 `src/app/dashboard/page.tsx`

- `dashboard`가 null이 아닐 때만 `const summaryDeps = defaultSummaryDeps(supabase)`, `const preparedSummary = prepareSummary(dashboard, summaryDeps.summarizer)`를 만든다. `prepareSummary`에는 `buildDashboard`가 돌려준 DTO만 넘긴다.
- 왼쪽 열(`TotalCard`가 있는 `flex flex-col gap-6`)에서 `TotalCard` 바로 아래:
  ```tsx
  <Suspense
    key={preparedSummary.inputHash}
    fallback={<MonthlySummaryStatus state="pending" upgrade={dashboard.plan === "free"} />}
  >
    <MonthlySummarySection userId={user.id} prepared={preparedSummary} deps={summaryDeps} />
  </Suspense>
  ```
- `dashboard`가 null(온보딩)이면 요약을 만들지 않는다(`defaultSummaryDeps`·`prepareSummary`를 부르지 않는다).
- 나머지 페이지 동작(`requireUser`의 next, 플랜 조회, 결제 안내, 업로드 구역)은 바꾸지 않는다.

### 6. 테스트 (먼저 작성)

- `monthly-summary.test.tsx`에 추가: `upgrade` 없으면 기존과 같다(데모 출처 문구 포함, `Pro로 보기` 없음). `upgrade`면 안내 문장과 `Pro로 보기` 버튼이 있고 누르면 업그레이드 모달이 열린다(source `summary`, 기존 `upgrade-button.test.tsx`의 확인 방식). `MonthlySummaryStatus` pending은 `aria-busy="true"`·만드는 중 문구·출처 줄 없음, failed는 실패 문구·출처 줄 없음. 요약에 `<b>태그</b>`가 있으면 글자 그대로 보인다.
- `upgrade-button.test.tsx`에 추가: `variant="text"`면 Pill 클래스(`rounded-full`)가 없고 Text 클래스가 있으며 모달을 연다.
- `monthly-summary-section.test.tsx`(fake `SummaryDeps`로 실제 `resolveMonthlySummary`를 거친다. `render(await MonthlySummarySection({...}))`): 저장 해시가 같으면 저장 문장·출처 줄, Free면 `Pro로 보기`, Pro면 없음. 요약기 실패면 실패 문구이고 해시가 다른 저장 문장은 화면에 없다.
- `page.test.tsx`에 추가(`@/lib/summary/deps`와 `./monthly-summary-section` mock): 거래가 있는 Free면 `MonthlySummarySection`이 `prepared.plan === "free"`·`prepared.month === dashboard.month`·`"findings" in prepared.input === false`로 불리고, Pro면 `plan === "pro"`·`findings`가 있다. `userId`가 `requireUser` 결과의 id다. 거래가 없으면 `defaultSummaryDeps`와 섹션이 불리지 않는다. 요약 카드가 총지출 카드 뒤, 카테고리 목록 앞에 온다(문서 순서).
- 기존 데모·랜딩 테스트가 그대로 통과한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과
test -f src/app/dashboard/monthly-summary-section.tsx && test -f src/app/dashboard/monthly-summary-section.test.tsx
grep -q "<Suspense" src/app/dashboard/page.tsx && grep -q "inputHash" src/app/dashboard/page.tsx
! grep -q '"use client"' src/app/dashboard/monthly-summary-section.tsx
! grep -rn "dangerouslySetInnerHTML" src/components/dashboard/monthly-summary.tsx src/app/dashboard/
grep -q "SUMMARY_STATUS_MESSAGES" src/components/dashboard/monthly-summary.tsx
! grep -nE "요약을 만들지 못했어요|요약을 만들고 있어요" src/components/dashboard/monthly-summary.tsx src/app/dashboard/monthly-summary-section.tsx src/app/dashboard/page.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - Free 요약 입력이 Free DTO에서만 만들어지고, `PreparedSummary`·`SummaryInput`이 클라이언트 컴포넌트 props로 가지 않는가? (AGENTS.md CRITICAL: RSC payload)
   - 실패·만드는 중 상태에서 이전 요약 문장이 보이지 않는가? (ADR-005)
   - 사용자에게 보이는 상태 문구가 `lib/errors/messages.ts`에서 오는가? (AGENTS.md)
   - 데모·랜딩의 요약 카드가 바뀌지 않았는가? (`source="example"`, `upgrade` 없음)
3. 결과에 따라 `phases/10-ai-summary/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 컴포넌트 시그니처와 위치, 페이지의 Suspense 배치와 key, 문구 상수, `UpgradeButton` text variant, 새 테스트 수, "브라우저·수동 확인은 하지 않음(BROWSER_TESTING '수동 확인: 월간 요약')"을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 요약을 클라이언트에서 fetch하거나 `/api/summary` 같은 라우트를 만들지 마라. 이유: ADR "의도적으로 뺀 것". 대시보드 Server Component에서 Suspense로 만든다.
- `Suspense`의 key를 빼거나 고정값으로 두지 마라. 이유: 카테고리 수정 뒤 `router.refresh()`가 LLM 응답을 기다리며 화면 전체가 멈춘다.
- `MonthlySummary`의 기존 props 의미와 데모·랜딩 출처 문구를 바꾸지 마라. 이유: 공개 화면 브라우저 시나리오(S2·요약 밴드)가 그 문구를 확인한다.
- 실패·만드는 중 문구를 컴포넌트에 직접 쓰지 마라. 이유: 사용자에게 보이는 에러 문구는 `lib/errors/messages.ts` 한 곳에서 매핑한다(AGENTS.md).
- 요약 카드 말고 다른 업그레이드 진입점(배너·자동 팝업)을 만들지 마라. 이유: 진입점은 source 허용목록 5곳뿐이다(UX_GUIDE).
- `buildDashboard`·`lib/summary`·`services/llm` 동작을 바꾸지 마라. 이유: 이전 step에서 확정했다. 버그를 찾으면 고치지 말고 error로 사유를 적는다.
- 브라우저 테스트(`scripts/browser-test`)를 고치거나 실행하지 마라. 이유: 로그인 뒤 화면은 수동 확인 대상이고, 회귀 확인은 phase가 끝난 뒤 따로 한다.
- `supabase` 명령과 `scripts/pgtap.sh`를 실행하지 마라.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
