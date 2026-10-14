# Step 6: insight-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("화면별 요소"의 **월간 요약 카드·팁 피드백**·총지출 카드·가장 많이 쓴 곳·달라진 카테고리·명세서 총지출 카드, "숫자 · 날짜", "모션 · 아이콘 · 접근성")
- `/docs/USER_FLOW.md` ("② 첫 업로드"의 고지, "④ 월간 재방문"의 [팁 피드백])
- `/docs/ADR.md` (**ADR-025**)
- step 1 산출물: `MonthlySummaryView`의 `tipCategories`(`/src/types/summary.ts`), `/src/lib/summary/monthly-summary.ts`·`card-summary.ts`
- step 2 산출물: `/src/lib/summary-feedback.ts`(`normalizeFeedback`·`feedbackLength`), `/src/types/summary.ts`(`SummaryFeedback`·`SummaryFeedbackRequest`·`SUMMARY_FEEDBACK_MAX_LENGTH`), `/src/lib/errors/messages.ts`(`summaryFeedbackErrorMessage`), `/src/app/api/summary-feedback/route.ts`
- step 3 산출물: 스냅샷의 `transactionCount`·`cancelCount`, `MerchantAmount.cancelCount`
- step 4·5 산출물: `/src/app/dashboard/page.tsx`(피드백 조회), `/src/lib/format.ts`(`formatDiffWon`), 저장되는 요약 문장의 `▲…원`·`▼…원`과 `"\n\n"` 문단
- 화면 코드: `/src/components/dashboard/monthly-summary.tsx`, `/src/app/dashboard/monthly-summary-section.tsx`, `/src/app/dashboard/card-summary-section.tsx`, `/src/components/dashboard/total-card.tsx`, `/src/components/dashboard/statement-total-card.tsx`, `/src/components/dashboard/top-merchants.tsx`, `/src/components/dashboard/category-changes-card.tsx`, `/src/components/dashboard/trend-chart.tsx`, `/src/components/icons.tsx`, `/src/components/upload/data-notice.tsx`와 각 `.test.tsx`
- 클라이언트 저장 컴포넌트 예시: `/src/components/dashboard/merchant-category-select.tsx`(`fetchJson`·`responseError`, 저장 중 상태, `router.refresh()`, 서버 값 동기화), `/src/components/dashboard/card-edit-dialog.tsx`(입력 에러 표시)
- `/docs/testing/BROWSER_TESTING.md`, `/scripts/browser-test/s1-landing-demo.js`, `/scripts/browser-test/s2-demo-september.js`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

ADR-025의 화면 부분이다. 데이터·입력·프롬프트는 앞 step에서 끝났다.
- 요약은 문단마다 `p`로 그리고, 문장 안 `▲…원`·`▼…원`은 화살표 아이콘과 증감 색으로 그린다.
- 팁마다 그 카테고리의 피드백을 보고·쓰고·고친다(실제 대시보드 전체 탭·카드 탭만, 데모·랜딩 제외).
- 거래 건수 옆에 "취소 N건"을 보여준다.
- 달라진 카테고리 목록에 화살표를 붙인다.

## 작업

### 1. 아이콘 (`src/components/icons.tsx`)

- `ArrowUpIcon`(Lucide arrow-up: `<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />`), `ArrowDownIcon`(Lucide arrow-down: `<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />`). 기존 `Svg` 틀을 쓴다(`aria-hidden`, `currentColor`).

### 2. 건수 표시 (`src/lib/format.ts`)

```ts
// 가장 많이 쓴 곳 행의 건수: "3건" · "1건 · 취소 1건" · (건수 0) "취소 1건"
export function formatTransactionCount(count: number, cancelCount: number): string
```
- `TopMerchants` 행: `{count}건` 대신 `formatTransactionCount(count, cancelCount)`(편집 가능·불가 모두).
- `TotalCard`·`StatementTotalCard` 근거 줄은 건수를 늘 쓴다: `` `거래 ${transactionCount}건${cancelCount > 0 ? ` · 취소 ${cancelCount}건` : ""} · 반영 기간 …` ``(취소가 없으면 지금과 같은 글자, 짝만 있으면 "거래 0건 · 취소 1건 · …").

### 3. 달라진 카테고리 화살표 (`category-changes-card.tsx`, `trend-chart.tsx`)

- 증감 색 `span`을 `whitespace-nowrap`으로 하고, 금액 앞에 늘었음 `ArrowUpIcon`·줄었음 `ArrowDownIcon`(`size={16}`, `className="inline-block align-[-0.125em]"`)을 둔다. "+N원 늘었어요"·"−N원 줄었어요" 글자는 그대로 둔다(색·화살표만으로 뜻을 전하지 않는다).

### 4. 요약 카드 (`src/components/dashboard/monthly-summary.tsx`)

- props:
  ```ts
  summary: string;              // 문단은 "\n\n"으로 이어져 있다
  source: "ai" | "example";
  tips?: string[];
  tipCategories?: CategoryId[]; // tips와 같은 길이
  feedback?: SummaryFeedback;   // 카테고리 id → 내 피드백
  feedbackEnabled?: boolean;    // 실제 대시보드만 true
  upgrade?: boolean;
  variant?: SummaryVariant;
  ```
- 본문: `summary.split("\n\n")`의 문단마다 `<p className="text-lg leading-relaxed text-ink break-keep text-pretty">`, 묶음 `div.space-y-3`. `whitespace-pre-line`을 지운다.
- 숫자 강조(`EmphasizedNumbers`): 정규식에 `[▲▼][0-9][0-9,]*원`을 **먼저** 더한다. `▲`로 시작하면 `<strong className="font-semibold tabular-nums whitespace-nowrap text-increase"><ArrowUpIcon size={16} className="inline-block align-[-0.125em]" />{▲를 뺀 금액}</strong>`, `▼`면 `text-decrease`와 `ArrowDownIcon`. 그 밖의 숫자는 지금처럼 `strong`에 `whitespace-nowrap`만 더한다. 화면 글자에 ▲·▼ 문자가 남지 않는다.
- 팁 `li`: 팁 문장 아래에 `feedbackEnabled && tipCategories?.[index]`일 때 `<TipFeedback category={...} initial={feedback?.[category] ?? ""} />`.
- 상태 카드(`MonthlySummaryStatus`)와 데모·랜딩(`source="example"`)은 바뀌지 않는다(데모 요약은 한 문단).

### 5. 팁 피드백 (`src/components/dashboard/tip-feedback.tsx`, `"use client"`)

```ts
export function TipFeedback(props: { category: CategoryId; initial: string }): React.JSX.Element
```
DESIGN "팁 피드백" 그대로:
- 닫힌 상태: `initial`이 있으면 `<p className="text-sm text-body">내 피드백: {initial}</p>`(텍스트로만) + 버튼 "수정", 없으면 버튼 "피드백 남기기". 버튼 클래스 `rounded-lg text-sm font-semibold text-body hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`, `type="button"`, `aria-expanded`.
- 열린 상태(`form.mt-2.space-y-2`): `label`(`text-sm text-ink`) `"{카테고리 이름} 피드백"` → 입력(입력 필드 스타일 `h-12 w-full rounded-xl border border-hairline bg-canvas px-4 text-base text-ink placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary`, 에러면 `border-danger`, `maxLength={SUMMARY_FEEDBACK_MAX_LENGTH}`, 값은 `initial`로 시작) → 한 줄(`flex items-start justify-between gap-3`)에 왼쪽 `text-caption text-body` 두 문장 "피드백은 AI 요약에 함께 보내져요. 개인정보는 적지 마세요"·"비우고 저장하면 피드백을 지워요", 오른쪽 `text-caption tabular-nums text-body` `` `${feedbackLength(normalizeFeedback(value))}/100` `` → 버튼 줄(`flex gap-2`) 작은 Primary "저장"(`type="submit"`) · 작은 Secondary "취소"(`buttonClass`, 저장 중에는 둘 다 disabled).
- 열면 입력에 포커스, "취소"나 저장 성공으로 닫으면 여는 버튼에 포커스를 돌려준다. "취소"는 입력을 `initial`로 되돌린다.
- 저장: `fetchJson("/api/summary-feedback", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, text: value } satisfies SummaryFeedbackRequest) })`. 200이면 닫고 `aria-live="polite"` 영역에 "저장했어요"(삭제였으면 "피드백을 지웠어요")를 알리고 `router.refresh()`. 아니면 입력 아래 `<p id=… className="text-sm text-danger">{summaryFeedbackErrorMessage(code)}</p>`, 입력에 `aria-invalid`·`aria-describedby`. 저장 중 두 번 보내지 않는다(`merchant-category-select.tsx`의 `useRef` 방식).
- 새로고침으로 `initial`이 바뀌면 닫힌 상태의 표시와 입력 시작값을 새 값으로 맞춘다(`merchant-category-select.tsx`의 source 동기화 방식).
- 피드백 글을 `console`에 남기지 마라.

### 6. 요약 section·페이지

- `MonthlySummarySection`·`CardSummarySection`에 `feedback: SummaryFeedback` prop을 더하고, ready면 `MonthlySummary`에 `tipCategories={summary.tipCategories}`, `feedback`, `feedbackEnabled`를 넘긴다.
- `page.tsx`: step 4에서 읽은 피드백을 두 section에 넘긴다. 다른 동작은 바꾸지 마라.

### 7. 고지 (`src/components/upload/data-notice.tsx`)

- 첫 문장을 "분석을 위해 가맹점명과 집계 결과, 내가 남긴 요약 피드백이 AI 서비스로 전송됩니다."로 바꾼다(USER_FLOW ②). 이 문장을 단언하는 테스트(`data-notice`·`onboarding`·`upload-panel`)의 기대값을 함께 고친다.

### 8. 브라우저 시나리오 문서·스크립트

`/docs/testing/BROWSER_TESTING.md`와 `scripts/browser-test/s1-landing-demo.js`·`s2-demo-september.js`에서 **이 phase 때문에 바뀌는 기대값만** 고친다:
- 랜딩 쇼케이스 `9월 총지출 1,517,200원 · 거래 26건` → `거래 24건`(취소 짝, ADR-025).
- 데모 9월 총지출 근거 줄 `거래 26건 · 반영 기간 9/1~9/30` → `거래 24건 · 취소 1건 · 반영 기간 9/1~9/30`.
- 그 밖에 `예시 종이달 상점` 건수 등 취소 짝으로 바뀌는 글자를 단언하는 곳이 있으면 같은 규칙으로 고친다. 6·7·8월에는 취소가 없어 바뀌지 않는다.
- 새 절 `## 수동 확인: 인사이트 개인화`(기존 "수동 확인" 절과 같은 형식)를 더한다. 최소 아래를 담는다:
  1. 로컬 mock·Free 전체 탭(지난달 비교가 있는 달): 요약 카드가 두 문단이고 둘째 문단의 금액 앞에 빨강 위 화살표(늘었음) 또는 파랑 아래 화살표(줄었음)가 있으며 화면에 ▲·▼ 글자가 없다. 팁마다 카테고리 이름이 있고 아래에 "피드백 남기기"가 있다.
  2. 팁의 "피드백 남기기" → 폼(라벨 · 입력 · 두 안내 문장 · `N/100`) → 글 입력 → "저장" → 폼이 닫히고 요약 카드가 "만들고 있어요"로 바뀐 뒤 다시 그려지고, 그 팁 아래 "내 피드백: …"와 "수정"이 보인다. 같은 카테고리의 카드 탭 요약도 다시 만들어진다. DB(Supabase MCP `execute_sql`)에서 `summary_feedback` 1행(글은 출력하지 말고 `char_length(body)`만). "수정" → 비우고 저장 → "피드백 남기기"로 돌아오고 행이 0.
  3. 실제 10월 23일 명세서 카드 탭: 교육 가맹점 행이 "1건 · 취소 1건", 근거 줄이 "거래 N건 · 취소 1건 · 반영 기간 9/12~10/11"(N은 지금 80건에서 짝 수만큼 줄어든 값), 전체 탭 확인할 지출에 취소된 결제가 고액 결제로 나오지 않는다.
  4. Pro 카드 탭 "지난 명세서와 달라진 카테고리"와 전체 탭 추세 카드의 "지난달과 달라진 카테고리" 행 금액 앞에 화살표가 있다.
  5. 로컬 live(`APP_MODE=live`): 요약이 이번 기간 문단 + 지난 기간 대비 문단이고, 팁이 "○○에 N원을 썼고, 그중 가장 많이 쓴 곳은 △△예요 …해 보세요" 형태다. 마트·생활처럼 팁이 있는 카테고리에 "평일 오전 커피라 줄이기 어려워요" 피드백을 저장하면 다시 만든 그 카테고리 팁이 줄이라는 말 대신 맥락에 맞는 행동을 제안하고, 피드백 문장을 그대로 옮기지 않는다.
  6. 이용 기간 카드에 이어진 완료 명세서가 세 장 있으면 비교 문단에 최근 세 번의 흐름 문장이 있다(두 장뿐이면 없다).
  7. 375px: 요약 문단이 어절 단위로 줄바꿈되고 화살표+금액이 줄 끝에서 나뉘지 않으며 가로 스크롤이 없다. 팁 피드백 폼의 버튼·입력이 넘치지 않는다. 스크린샷을 남긴다.

### 9. 테스트

- `icons.test.tsx`: 두 아이콘이 `aria-hidden` SVG이고 크기 prop을 따른다.
- `format.test.ts`: `formatTransactionCount` 세 경우.
- `total-card.test.tsx`·`statement-total-card.test.tsx`: 취소가 있으면 "거래 N건 · 취소 M건 · 반영 기간 …", 없으면 지금 글자, 건수 0 + 취소 1.
- `top-merchants.test.tsx`: "1건 · 취소 1건", "취소 1건", "3건".
- `category-changes-card.test.tsx`·`trend-chart.test.tsx`: 늘었음 행에 위 화살표 SVG, 줄었음 행에 아래 화살표, 글자는 그대로.
- `monthly-summary.test.tsx`: 두 문단이면 `p` 두 개, 한 문단이면 하나. `▲12,000원`이 `text-increase` `strong` 안의 SVG + "12,000원"으로 그려지고 화면 글자에 ▲가 없다. `▼`는 `text-decrease`. 숫자 `strong`에 `whitespace-nowrap`. `feedbackEnabled`일 때만 팁마다 피드백 버튼이 있고, 같은 카테고리 팁 둘은 같은 피드백을 보인다. `source="example"`이면 피드백이 없다. 가맹점명·요약은 텍스트로만 렌더링된다(`<b>` 같은 글자가 태그가 되지 않음).
- `tip-feedback.test.tsx`: 닫힌 상태 두 가지, 열면 입력 포커스, 글자 수 표시(공백 정리 기준), 저장 요청 본문·헤더, 200 → 닫힘·알림·`router.refresh`, 400 → 에러 문구·`aria-invalid`, 저장 중 두 번 누르기 무시, 취소 → 원래 값·버튼 포커스, `initial`이 바뀌면 표시가 바뀜, 피드백 글이 `console`에 남지 않음.
- `monthly-summary-section.test.tsx`·`card-summary-section.test.tsx`: ready면 `tipCategories`·`feedback`·`feedbackEnabled`가 넘어가고, failed면 피드백이 없다.
- `page.test.tsx`: 데모 9월 근거 줄 `거래 24건 · 취소 1건 · 반영 기간 9/1~9/30`, 피드백이 두 section에 넘어간다.
- `data-notice`·`onboarding`·`upload-panel` 테스트: 새 고지 문장.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
test -f src/components/dashboard/tip-feedback.tsx
head -n 1 src/components/dashboard/tip-feedback.tsx | grep -q '"use client"'
grep -q 'export function ArrowUpIcon' src/components/icons.tsx
grep -q 'export function ArrowDownIcon' src/components/icons.tsx
grep -q 'export function formatTransactionCount' src/lib/format.ts
grep -q '/api/summary-feedback' src/components/dashboard/tip-feedback.tsx
grep -q 'summaryFeedbackErrorMessage' src/components/dashboard/tip-feedback.tsx
grep -q 'break-keep' src/components/dashboard/monthly-summary.tsx
! grep -q 'whitespace-pre-line' src/components/dashboard/monthly-summary.tsx
grep -q '내가 남긴 요약 피드백' src/components/upload/data-notice.tsx
grep -q '## 수동 확인: 인사이트 개인화' docs/testing/BROWSER_TESTING.md
grep -q '거래 24건 · 취소 1건 · 반영 기간 9/1~9/30' scripts/browser-test/s2-demo-september.js
! grep -q '거래 26건' scripts/browser-test/s1-landing-demo.js scripts/browser-test/s2-demo-september.js docs/testing/BROWSER_TESTING.md
! grep -rn 'dangerouslySetInnerHTML' src/components/dashboard
! grep -nE 'console\.' src/components/dashboard/tip-feedback.tsx
git diff --quiet HEAD -- supabase/ src/services src/lib/analytics src/lib/summary src/lib/queries src/lib/store src/app/api src/types
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 브라우저 시나리오(`scripts/browser-test/run.sh`)는 돌리지 않는다(phase가 끝난 뒤 `/browser-test`로 확인한다. 피드백·카드 탭은 로그인 세션이 필요해 수동 확인 대상이다).
2. 아키텍처 체크리스트를 확인한다:
   - 컴포넌트가 DTO·요약 결과·피드백만 받고, 클라이언트 컴포넌트 props에 거래·탐지 상세가 들어가지 않는가? (CLAUDE.md CRITICAL)
   - 쓰기는 `PUT /api/summary-feedback`(Origin·JSON 검사)로만 하는가?
   - 가맹점명·요약·피드백을 텍스트로만 렌더링하는가? 사용자에게 보이는 에러 문구가 `messages.ts`에서 오는가?
   - 포인트 색 규칙: 팁 피드백 버튼이 primary가 아닌가? 증감 색은 글자·아이콘에만 칠하는가?
3. 결과에 따라 `phases/13-insight-personalization/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 화살표 아이콘, `formatTransactionCount`, 요약 문단·▲▼ 렌더링, `TipFeedback` 동작, section·페이지 연결, 고지 문장, BROWSER_TESTING 변경(기대값·새 절)을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 이모지·▲▼ 글자를 화면에 그대로 두지 마라. 이유: DESIGN이 이모지 아이콘을 금지하고, 화살표는 SVG로 그린다(ADR-025).
- 팁 피드백 버튼에 primary 색(Text 버튼)을 쓰지 마라. 이유: 팁이 다섯 개면 포인트 색이 한 카드에 다섯 번 나온다(DESIGN "팁 피드백").
- 데모·랜딩에 피드백 UI를 넣지 마라. 이유: 로그인 사용자만 저장할 수 있다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 요약·가맹점명·피드백은 텍스트로만 렌더링한다(CLAUDE.md).
- 흐름(`flow`)을 화면에 그리지 마라. 이유: 흐름은 요약 문단에만 쓴다(ADR-025).
- 데이터·입력·프롬프트(`src/lib/analytics`, `src/lib/summary`, `src/services`, `src/types`)를 고치지 마라. 이유: 앞 step에서 끝났다.
- 브라우저 시나리오 기대값을 이 phase와 무관한 이유로 바꾸지 마라. 이유: 기대값 변경은 의도한 화면 변경이 있을 때만 맞다.
- 기존 테스트를 깨뜨리지 마라(이 step의 화면 변경으로 바뀌는 기대값만 고친다)
