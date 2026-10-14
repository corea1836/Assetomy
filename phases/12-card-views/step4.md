# Step 4: card-components

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` (특히 "화면별 요소"의 **카드 탭·카드 머리·명세서 선택·카드 수정 모달·명세서 총지출 카드·달라진 카테고리·카드 요약·빈 카드**, "총지출 카드", "월간 요약 카드", "카드 등록 폼", "모달", "버튼", "레이아웃", "숫자 · 날짜", "문구", "접근성")
- `/docs/USER_FLOW.md` ("④ 월간 재방문"의 [카드 탭])
- `/docs/ARCHITECTURE.md` ("패턴", "카드 탭")
- step 2 산출물: `/src/types/dashboard.ts`(`CardDashboard`·`CardMonthView`·`CardStatementView`·`PeriodSnapshot`·`StatementComparison`·`CategoryChange`)
- step 1 산출물: `/src/app/api/cards/[id]/route.ts`(PUT 요청·응답 규칙), `/src/types/card.ts`, `/src/types/upload.ts`(`CardOption`)
- 기존 컴포넌트: `/src/components/dashboard/total-card.tsx`, `/src/components/dashboard/month-select.tsx`, `/src/components/dashboard/monthly-summary.tsx`, `/src/components/dashboard/trend-chart.tsx`("지난달과 달라진 카테고리" 목록), `/src/components/upload/card-form.tsx`(분석 기준 fieldset·시작일 입력·도움말), `/src/components/upload/delete-upload-dialog.tsx`(모달 포커스·스크롤 잠금·Esc 처리), `/src/components/upload/api-reply.ts`, `/src/components/button-styles.ts`, `/src/lib/format.ts`, `/src/lib/errors/messages.ts`와 각 `.test.tsx`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드에 카드 탭을 더한다(ADR-024). 이 step은 `components/`와 문구·형식 도우미만 만든다. 페이지 조립(`app/dashboard/page.tsx`)은 다음 step이 한다. 컴포넌트는 DTO만 받는다(CLAUDE.md). 디자인은 `docs/DESIGN.md`의 클래스·문구를 그대로 쓴다.

## 작업

### 1. 형식·문구

- `src/lib/format.ts`: `formatStatementOption(date: IsoDate): string` → `"2026년 10월 23일 명세서"`. `formatCardBasis(card: Pick<CardOption, "issuer" | "analysisBasis" | "cycleStartDay">): string` → `"현대카드 · 월별"` / `"현대카드 · 이용 기간 매달 12일부터"`(`CARD_ISSUER_LABELS`).
- `src/lib/errors/messages.ts`:
  - `SUMMARY_STATUS_MESSAGES`에 `statementPending: "이번 명세서 요약을 만들고 있어요"`를 더한다(기존 키·문구는 그대로).
  - `cardEditErrorMessage(code: string): string` — `INVALID_LABEL` "카드 이름은 1~30자로 입력해 주세요.", `DUPLICATE_LABEL` "같은 이름의 카드가 있어요. 다른 이름을 입력해 주세요.", `INVALID_CARD` "분석 기준을 확인해 주세요. 이용 기간은 매달 1~31일 중 시작일을 입력해요.", `NOT_FOUND` "카드를 찾을 수 없어요. 새로고침해 주세요.", 그 밖(네트워크·503 등) "잠시 후 다시 시도해 주세요."

### 2. 새 컴포넌트 (`src/components/dashboard/`)

모두 DESIGN.md의 해당 항목 클래스·문구를 따른다. 시그니처는 이대로 쓴다.

- `card-tabs.tsx` (서버 컴포넌트)
  ```ts
  export function CardTabs(props: { cards: { id: string; label: string }[]; activeCardId: string | null }): React.JSX.Element
  ```
  `nav aria-label="카드 보기"`, "전체"(`/dashboard`) + 카드마다 `/dashboard?card=<id>`(id는 `encodeURIComponent`). 현재 탭에 `aria-current="page"`. 링크(`next/link`)만 쓰고 클라이언트 JS를 쓰지 않는다.
- `period-select.tsx` (클라이언트)
  ```ts
  export function PeriodSelect(props: {
    cardId: string; param: "month" | "statement"; value: string;
    options: { value: string; label: string }[]; ariaLabel: string;
  }): React.JSX.Element
  ```
  바꾸면 `router.push(`${pathname}?card=<cardId>&<param>=<value>`)`(`URLSearchParams`로 만든다). `MonthSelect`처럼 `key={value}` + `defaultValue`로 이동 중 되돌아가 보이지 않게 한다. 스타일은 `MonthSelect`와 같다. `MonthSelect`는 바꾸지 마라(전체 탭·데모가 쓴다).
- `card-heading.tsx` (서버 컴포넌트)
  ```ts
  export function CardHeading(props: { card: CardOption; dashboard: CardDashboard | null }): React.JSX.Element
  ```
  첫 줄: `h1` 카드 이름 · (dashboard가 있으면) 기간 선택 · 반영 표시 · Secondary 작게 "새 이용내역 추가"(`#upload`). 월별이면 `PeriodSelect`(param `month`, 옵션 `dashboard.months`를 `formatMonth`, aria-label "월 선택")와 `"<formatMonth(monthOf(lastDate))>까지 반영됨"`. 이용 기간이면 `PeriodSelect`(param `statement`, 옵션 `dashboard.statements`를 `formatStatementOption`, aria-label "명세서 선택")와 `"이용 기간 <formatPeriod(cyclePeriod)>"`. 둘째 줄: `formatCardBasis(card)` + `CardEditButton`.
- `card-edit-dialog.tsx` (클라이언트)
  ```ts
  export function CardEditButton(props: { card: CardOption }): React.JSX.Element
  ```
  Secondary 작게 "카드 수정" 버튼과 모달. 모달은 DESIGN "카드 수정 모달"대로: 제목 "카드 수정"(`role="dialog"`, `aria-modal`, `aria-labelledby`), 카드사 글자, 이름 입력(현재 이름으로 시작), 분석 기준 라디오(현재 기준), 이용 기간이면 "매달 [N]일부터" 입력(현재 시작일, 1~31)과 도움말(카드 등록 폼과 같은 문구 규칙), 기준·시작일이 처음 값과 다르면 "분석 기준을 바꾸면 이 카드 요약을 다시 만들어요", Primary "저장" · Secondary "취소".
  - 저장: `fetchJson(`/api/cards/${encodeURIComponent(card.id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, analysisBasis, cycleStartDay }) })`. 본문에 `issuer`를 넣지 않는다. 200 `{ updated: true }`면 모달을 닫고 `router.refresh()`. 아니면 `responseError`로 코드를 읽어 `cardEditErrorMessage`를 해당 입력 아래(`text-sm text-danger`, `aria-describedby`)에 보여준다. 라벨 1~30자·시작일 1~31은 보내기 전에도 확인한다(같은 문구).
  - 저장 중에는 두 버튼과 입력을 disabled, 두 번 보내지 않는다. 취소·Esc·오버레이 클릭으로 닫고, 닫으면 "카드 수정" 버튼으로 포커스를 돌린다(`DeleteUploadDialog`와 같은 방식).
  - 분석 기준 fieldset·시작일 입력·도움말은 `CardForm`과 같은 마크업·문구다. `CardForm`에서 공용 컴포넌트(예: `src/components/upload/analysis-basis-fields.tsx`)로 뽑아 두 곳에서 써도 된다. 뽑으면 `card-form.test.tsx`가 고치지 않고 통과해야 한다.
- `statement-total-card.tsx` (서버 컴포넌트)
  ```ts
  export function StatementTotalCard(props: {
    snapshot: PeriodSnapshot; cyclePeriod: Period; complete: boolean;
    comparison: StatementComparison | null; comparisonSkipped: boolean;
  }): React.JSX.Element
  ```
  DESIGN "명세서 총지출 카드". 비교 문장: `"<formatDate(previousStatementDate)> 명세서보다 <formatSignedWon(diff)> 늘었어요/줄었어요"`(증감 색·`font-mono`는 `TotalCard`와 같다), diff 0이면 `"<날짜> 명세서와 같아요"`. `comparisonSkipped`면 "이용 기간이 끝나기 전에 받은 명세서가 있어 지난 명세서와 비교하지 않았어요". 근거 줄: `"거래 N건 · 반영 기간 <formatPeriod(snapshot.period)>"`, `"이용 기간 <formatPeriod(cyclePeriod)>"`, "취소·환불은 카드사 파일의 날짜 기준으로 반영돼요", `!complete`면 "이용 기간이 끝나기 전에 받은 명세서예요. 그 뒤 거래는 빠져 있을 수 있어요".
- `category-changes-card.tsx` (서버 컴포넌트)
  ```ts
  export function CategoryChangesCard(props: { changes: CategoryChange[]; basis: "month" | "cycle" }): React.JSX.Element | null
  ```
  `changes`가 비면 null. 제목 "지난달과 달라진 카테고리"(month) / "지난 명세서와 달라진 카테고리"(cycle). 행은 `TrendChart`의 같은 목록과 같은 마크업. `TrendChart`는 바꾸지 마라.
- `empty-card.tsx` (서버 컴포넌트)
  ```ts
  export function EmptyCard(): React.JSX.Element
  ```
  DESIGN "빈 카드": 가운데 정렬 보조 카드에 "이 카드로 올린 내역이 아직 없어요" + Secondary "새 이용내역 추가"(`#upload`).

### 3. 요약 카드 변형 (`src/components/dashboard/monthly-summary.tsx`)

- `MonthlySummary`·`MonthlySummaryStatus`에 옵션 prop `variant?: "month" | "card-month" | "statement"`(기본 `"month"`)를 더한다.
  - 제목: `month`·`card-month` "이번 달 요약", `statement` "이번 명세서 요약".
  - 만드는 중 문구: `statement`면 `SUMMARY_STATUS_MESSAGES.statementPending`, 나머지는 `pending`.
  - Free 안내(`upgrade`): `month`는 지금 문구 그대로, `card-month`·`statement`는 "Pro에서는 달라진 카테고리까지 요약해요" + 같은 "Pro로 보기"(source `summary`).
- `variant`를 주지 않은 기존 호출(전체 탭·데모·랜딩)의 출력은 바뀌면 안 된다(기존 테스트 무수정 통과).

### 4. 테스트 (`*.test.tsx`, Testing Library)

- `CardTabs`: "전체" + 카드 이름 링크와 href, 현재 탭 `aria-current`, 전체 탭이 현재일 때.
- `PeriodSelect`: 옵션 순서·선택값, 바꾸면 `?card=...&statement=...`(또는 month)로 push.
- `CardHeading`: 월별·이용 기간 각각 선택기 aria-label·반영 표시 문구·기준 문구, dashboard가 null이면 선택기 없이 이름·기준·카드 수정만.
- `CardEditButton`: 열기·현재 값 채움·카드사 글자, 기준 바꾸면 안내 문구, 저장 시 PUT 본문(`issuer` 없음)과 성공 시 닫힘·`router.refresh` 호출, 409 → 중복 이름 문구, 400 `INVALID_CARD` → 기준 문구, 네트워크 실패 → 재시도 문구, 저장 중 두 번 클릭해도 한 번만 보냄, Esc로 닫고 포커스 복귀, 31자 이름·시작일 0은 보내지 않음.
- `StatementTotalCard`: 늘었어요/줄었어요/같아요 문장과 날짜, `comparisonSkipped` 문장, 근거 줄 3~4개, 완료 전 안내.
- `CategoryChangesCard`: 제목 두 가지, 빈 배열이면 렌더 없음, 증감 문구.
- `EmptyCard`: 문구와 `#upload` 링크.
- `MonthlySummary`·`MonthlySummaryStatus`: `variant`별 제목·만드는 중 문구·Free 안내, `variant` 없을 때 기존 출력.
- `format`·`messages`: 새 함수 단위 테스트.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
for f in card-tabs period-select card-heading card-edit-dialog statement-total-card category-changes-card empty-card; do test -f "src/components/dashboard/$f.tsx" && test -f "src/components/dashboard/$f.test.tsx" || exit 1; done
grep -q 'aria-label="카드 보기"' src/components/dashboard/card-tabs.tsx
grep -q 'method: "PUT"' src/components/dashboard/card-edit-dialog.tsx
! grep -nE 'JSON\.stringify\([^)]*issuer' src/components/dashboard/card-edit-dialog.tsx
! grep -rn 'dangerouslySetInnerHTML' src/components
! grep -rnE 'from "@/lib/(queries|store|supabase|summary)|from "@/services' src/components --include='*.tsx' --exclude='*.test.tsx'
test "$(git diff HEAD -- src/components/dashboard/monthly-summary.test.tsx src/components/dashboard/month-select.test.tsx src/components/dashboard/trend-chart.test.tsx src/components/upload/card-form.test.tsx src/components/dashboard/total-card.test.tsx | grep '^-[^-]' | grep -vc '^-import ')" -eq 0
git diff --quiet HEAD -- src/components/dashboard/month-select.tsx src/components/dashboard/trend-chart.tsx src/components/dashboard/total-card.tsx
git diff --quiet HEAD -- supabase/ src/app src/lib/analytics src/lib/queries src/lib/store src/lib/summary src/services
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 컴포넌트가 DTO·`CardOption`만 받고 데이터 계층을 import하지 않는가?
   - DESIGN.md의 클래스·문구를 따르는가(포인트 색은 탭에 쓰지 않음, 증감 색은 글자에만, 버튼은 `buttonClass`)?
   - 사용자 문구는 `lib/errors/messages.ts`에서 오는가(에러 문구)?
   - 카드 이름은 텍스트로만 렌더링하는가?
   - 클라이언트 컴포넌트는 상호작용이 필요한 곳(`PeriodSelect`, `CardEditButton`)뿐인가?
3. 결과에 따라 `phases/12-card-views/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 새 컴포넌트 이름·props, `MonthlySummary`의 `variant`, 새 형식·문구 함수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `app/dashboard/page.tsx`를 고치지 마라. 이유: 페이지 조립은 다음 step에서 한다.
- `MonthSelect`·`TrendChart`·`TotalCard`를 바꾸지 마라. 이유: 전체 탭·데모가 쓰고, 브라우저 시나리오 기대값이 걸려 있다.
- 카드 수정 요청에 카드사(`issuer`)를 보내거나 카드사 입력을 두지 마라. 이유: 카드사는 바꾸지 않는다(ADR-024).
- 탭·카드 머리에 포인트 색(`primary`)이나 그라데이션을 쓰지 마라. 이유: DESIGN "카드 탭"·"금지".
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 카드 이름·요약은 텍스트로만 렌더링한다.
- 브라우저 시나리오(`scripts/browser-test/`)·`docs/testing/BROWSER_TESTING.md`를 고치지 마라. 이유: 다음 step에서 한다.
- 기존 테스트를 깨뜨리지 마라
