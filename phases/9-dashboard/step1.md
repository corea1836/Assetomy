# Step 1: dashboard-components

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("플랜별 기능"과 그 아래 규칙, "카테고리")
- `/docs/USER_FLOW.md` (② 끝의 대시보드, ③ Pro 전환, ④ 카테고리 수정)
- `/docs/DESIGN.md` ("화면별 요소"의 가장 많이 쓴 곳·카테고리 수정·잠금 카드·후보 지출 티저·모달, "문구", "모션 · 아이콘 · 접근성")
- `/docs/UX_GUIDE.md` ("전환", "Figma 원칙 7가지 적용", "화면 체크리스트")
- `/docs/ADR.md` (ADR-011, ADR-013, ADR-017)
- 기존 코드: `/src/types/dashboard.ts`, `/src/types/category.ts`, `/src/types/billing.ts`(`UPGRADE_SOURCES`), `/src/lib/analytics/snapshot.ts`와 테스트, `/src/components/dashboard/*.tsx`(특히 `top-merchants.tsx`, `category-list.tsx`의 `<details>` 접기, `findings-list.tsx`의 amber 박스), `/src/components/billing/upgrade-dialog.tsx`·`upgrade-button.tsx`·`pricing-upgrade.tsx`와 테스트, `/src/components/upload/api-reply.ts`(`fetchJson`·`responseError`), `/src/components/upload/upload-history.tsx`(aria-live 안내 패턴), `/src/lib/errors/messages.ts`, `/src/app/demo/page.tsx`, `/src/components/landing/plan-preview.tsx`(후보 건수 계산)
- 브라우저 시나리오: `/docs/testing/BROWSER_TESTING.md`의 S2, `/scripts/browser-test/s2-demo-september.js`
- 이전 step 산출물: `/supabase/migrations/20261015000000_dashboard.sql`(`record_metric`의 event·source 규칙, `set_merchant_category`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

실제 대시보드(step 4)에 들어갈 화면 조각을 만든다. 이 step은 DB·API를 쓰지 않는다. API(`POST /api/metrics`, `PUT /api/merchant-categories`)는 step 3에서 만들고, 여기서는 아래 요청 형식으로 부르는 클라이언트 코드와 그 테스트(fetch mock)만 만든다.

- Free/Pro 게이팅은 `buildDashboard`의 DTO 유니온에서만 한다(ADR-011). 여기서 만드는 Free용 컴포넌트는 `Teaser`(건수·합계)만 받는다. 탐지 상세·거래 ID·추세를 props로 받지 않는다. 이유: Server→Client props는 RSC payload로 그대로 노출된다.
- 업그레이드 진입점 5곳(teaser·trend·summary·pricing·settings)은 모두 같은 `UpgradeDialog`를 연다(UX_GUIDE "전환"). 그래서 "첫 업그레이드 클릭" 측정은 모달이 열릴 때 한 곳에서 보낸다.
- "가장 많이 쓴 곳"은 금액순 5곳 + 그 달의 나머지 가맹점을 접어 두고, 실제 대시보드에서는 행마다 카테고리 select를 둔다(DESIGN). 데모는 select 없이 글자로 보여준다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts(x)`).

## 작업

### 1. 타입
- `src/types/dashboard.ts`의 `Snapshot`에 `otherMerchants: MerchantAmount[]`를 추가한다(주석: 그 달의 `topMerchants` 밖 가맹점, 금액순).
- `src/types/category.ts`에 추가:
  ```ts
  export type MerchantCategoryRequest = { merchantKey: string; category: CategoryId };
  export type MerchantCategoryResponse = { updated: number };
  ```
- 새 파일 `src/types/metrics.ts`:
  ```ts
  export type MetricRequest =
    | { event: "teaser_seen" }
    | { event: "upgrade_click"; source: UpgradeSource };
  ```
  `first_paid`는 넣지 않는다. 이유: 첫 실결제는 서버의 결제 동기화만 기록한다(클라이언트가 보낼 수 없다).

### 2. 스냅샷 `src/lib/analytics/snapshot.ts`
- `buildSnapshot`이 `otherMerchants`를 만든다: 그 달 가맹점(`merchantKey` 단위) 중 `topMerchants`에 없는 것 전부. 금액이 0 이하인 가맹점(환불만 있는 곳)도 넣는다. 이유: 카테고리를 고칠 수 있어야 한다. 정렬은 금액 내림차순, 같으면 `merchantKey` 오름차순. 각 항목의 `merchant`·`category`는 `topMerchants`와 같은 규칙(그 달 가장 늦은 거래)으로 정한다.
- `topMerchants`의 규칙(양수만, 5개)은 바꾸지 않는다.
- 테스트: `topMerchants`와 `otherMerchants`를 합치면 그 달의 모든 `merchantKey`가 정확히 한 번씩 나온다. 음수 가맹점이 `otherMerchants`에 있다. 데모 fixture 9월의 `otherMerchants` 개수와 첫 항목을 단언한다(값은 fixture로 계산해 테스트에 적는다).

### 3. 가장 많이 쓴 곳 `src/components/dashboard/top-merchants.tsx`
```ts
export function TopMerchants({ merchants, otherMerchants, editable }: {
  merchants: MerchantAmount[]; otherMerchants: MerchantAmount[]; editable?: boolean;
}): React.JSX.Element
```
- 보이는 목록은 `merchants`(5곳). `otherMerchants`가 있으면 카테고리 목록과 같은 `<details>` + Text 스타일 summary `나머지 N곳 보기`로 접는다.
- 행: 가맹점명(말줄임) · `카테고리 · N건` · 금액(오른쪽 `font-mono`, 음수는 `text-body`). `editable`이면 카테고리 글자 자리에 아래 select를 둔다(`N건`은 그대로 글자로 둔다). `editable`이면 카드 아래쪽에 한 줄 `카테고리를 바꾸면 같은 가맹점의 모든 거래에 적용돼요`(`text-caption text-body`).
- 데모(`src/app/demo/page.tsx`)는 `otherMerchants={snapshot.otherMerchants}`를 넘기고 `editable`을 주지 않는다.

### 4. 카테고리 select `src/components/dashboard/merchant-category-select.tsx` (client)
```ts
export function MerchantCategorySelect({ merchantKey, merchant, category }: {
  merchantKey: string; merchant: string; category: CategoryId;
}): React.JSX.Element
```
- 행 안 select(`h-9 rounded-lg px-3 text-sm`, DESIGN "입력 필드 · select"), `aria-label`은 `${merchant} 카테고리`, 옵션은 `CATEGORY_IDS` 순서와 `CATEGORY_LABELS`.
- 바꾸면 바로 `PUT /api/merchant-categories`(JSON `MerchantCategoryRequest`, `Content-Type: application/json`). 저장 중에는 select를 비활성화하고 중복 요청을 보내지 않는다.
  - 200 → `router.refresh()`, `aria-live="polite"` 영역에 `저장했어요`.
  - 실패 → select를 이전 값으로 되돌리고 같은 영역에 `categoryErrorMessage(code)`(아래)를 보여준다. 오류 응답은 `responseError`로 해석한다.
- 가맹점명은 텍스트로만 렌더링한다.

### 5. 문구 `src/lib/errors/messages.ts`
```ts
export function categoryErrorMessage(code: ApiErrorCode): string
```
- `NOT_FOUND` → `이 가맹점의 거래를 찾지 못했어요. 새로고침한 뒤 다시 시도해 주세요.` · `UNAUTHORIZED` → 기존 로그인 만료 문구 · `TEMPORARY_FAILURE`와 그 밖 → `카테고리를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.`

### 6. 측정 전송 `src/components/send-metric.ts`
```ts
export function sendMetric(metric: MetricRequest): void
```
- `POST /api/metrics`, JSON, `keepalive: true`. 응답·실패를 기다리거나 화면에 보여주지 않는다(예외도 삼킨다). 이유: 측정 실패가 사용자 행동을 막으면 안 된다.

### 7. 후보 지출 티저(Free) `src/components/dashboard/teaser-card.tsx`
```ts
export function TeaserCard({ teaser, dataMonthCount }: { teaser: Teaser; dataMonthCount: number }): React.JSX.Element
```
- 제목 `<h2>` `확인이 필요한 지출`(데모의 `FindingsList`와 같은 제목).
- 후보가 있으면(종류별 `count` 합 > 0): amber 박스(`rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900 sm:p-8`)에 종류별 `건 · 금액`(`ul aria-label="탐지 종류별 요약"`, `FINDING_KIND_LABELS`)과 `후보 합계`(`candidateTotal`), 캡션 `같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요. 상세에서 확인해 보세요.` 박스 바로 아래 Primary `UpgradeButton`(`source="teaser"`, label `Pro로 보기`, `teaser` 전달). 마운트될 때 `sendMetric({ event: "teaser_seen" })`를 한 번 보낸다(티저 노출 측정).
- 후보가 0건이면 `이번 규칙으로 확인할 지출 후보가 발견되지 않았어요`만 보여주고 버튼·측정이 없다.
- `dataMonthCount < 2`면 아래에 `한 달치만 더 올리면 정기결제를 찾아드려요`.
- 측정 효과처럼 클라이언트가 필요한 부분만 작은 client 컴포넌트로 나눠도 된다. props는 `Teaser`와 숫자뿐이어야 한다.

### 8. 추세 잠금 카드(Free) `src/components/dashboard/trend-lock-card.tsx`
```ts
export function TrendLockCard(): React.JSX.Element
```
- 보조 카드(`rounded-3xl bg-surface-soft p-6 sm:p-8`), 제목 `<h2>` `월별 추세`.
- 정적 예시: 4개월 세로 막대를 div로 그린다(단색 `bg-primary`, 값 쪽 끝 4px 둥글게, 마지막 달만 진하게 하지 않는다). 막대 묶음은 `aria-hidden`이고 아래에 `예시 그림이에요. 실제 내 데이터가 아니에요.`(`text-caption text-body`). blur·모자이크를 쓰지 않는다. 실제 데이터를 props로 받지 않는다.
- 설명 한 줄 `Pro에서는 여러 달 지출 추세와 지난달과 달라진 카테고리를 볼 수 있어요` + Primary `UpgradeButton`(`source="trend"`, label `Pro로 보기`).

### 9. 업그레이드 모달·버튼
- `UpgradeDialog`에 선택 prop `teaser?: Teaser | null`을 더한다. 후보가 있으면(종류별 `count` 합 > 0) 제목 바로 아래, 예시 목록보다 위에 `내 이용내역에서 확인이 필요한 지출 N건 · 후보 합계 N원`(건수는 `plan-preview.tsx`와 같이 종류별 `count` 합). 이유: UX_GUIDE 모달 순서(내 후보 → 상세 예시 → 가격). 없으면 지금처럼 예시부터.
- `UpgradeDialog`가 열릴 때(마운트) `sendMetric({ event: "upgrade_click", source })`를 한 번 보낸다. StrictMode의 이중 effect로 두 번 보내도 서버가 첫 값만 남기므로 막기 위해 복잡하게 만들지 않는다.
- `UpgradeButton`과 `PricingUpgrade`에 선택 prop `teaser?: Teaser | null`을 더해 모달로 넘긴다. `PricingUpgrade`·설정 화면의 기존 사용은 그대로 동작해야 한다.

### 10. 데모 브라우저 시나리오
- "가장 많이 쓴 곳"에 접기가 생기므로 `scripts/browser-test/s2-demo-september.js`의 가맹점 확인을 카테고리 확인과 같은 방식으로 고친다: 보이는 목록(`:scope > ul > li`) 5개는 지금 기대값 그대로, 닫힌 `나머지 N곳 보기`, 펼치면 전체 개수. N은 데모 fixture로 계산한 값이다.
- `docs/testing/BROWSER_TESTING.md` S2 표의 "가장 많이 쓴 곳" 행을 같은 내용으로 고친다. 브라우저 실행은 하지 않는다(시나리오 실행은 phase 끝에 한다).

### 11. 테스트 (먼저 작성)
- `snapshot.test.ts`: 위 2의 단언.
- `top-merchants.test.tsx`: 5곳 표시·`나머지 N곳 보기` 접힘·`otherMerchants`가 없으면 접기 없음, `editable`이 없으면 select가 없고 카테고리 글자, `editable`이면 행마다 `… 카테고리` select와 안내 한 줄.
- `merchant-category-select.test.tsx`(fetch·`next/navigation` mock): 바꾸면 PUT 본문이 `{ merchantKey, category }`이고 Content-Type이 JSON, 저장 중 비활성화, 200이면 `refresh` 호출과 `저장했어요`, 404·503·네트워크 실패면 이전 값 복원과 해당 문구, 두 번 빠르게 바꿔도 요청 1번.
- `teaser-card.test.tsx`: 후보 있음 → 종류별 줄·후보 합계·캡션·`Pro로 보기` 버튼, 마운트 시 `teaser_seen` 1번. 0건 → 안내 문구만, 버튼·측정 없음. `dataMonthCount` 1 → 한 달치 안내. 렌더 결과에 가맹점명·거래 날짜가 없다(받지 않는다).
- `trend-lock-card.test.tsx`: 예시 안내 문구, `Pro로 보기` 클릭 → 모달 열림, blur 클래스 없음.
- `upgrade-dialog.test.tsx`: `teaser`가 있으면 내 후보 줄이 예시보다 먼저 나온다. 없거나 0건이면 줄이 없다. 열릴 때 `upgrade_click`과 source가 전송된다(fetch mock). 기존 단언(포커스·Esc·결제하기)이 계속 통과한다.
- `send-metric.test.ts`: 요청 형식(메서드·경로·JSON·keepalive), fetch가 throw해도 예외가 밖으로 나오지 않는다.
- `messages.test.ts`: `categoryErrorMessage`의 코드별 문구.
- 데모 페이지 테스트: "가장 많이 쓴 곳"에 select가 없고 접기가 있다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
test -f src/components/dashboard/teaser-card.tsx && test -f src/components/dashboard/trend-lock-card.tsx
test -f src/components/dashboard/merchant-category-select.tsx && test -f src/components/send-metric.ts && test -f src/types/metrics.ts
! grep -rnE "Findings|FindingTransaction|Trend\b|transactions" src/components/dashboard/teaser-card.tsx src/components/dashboard/trend-lock-card.tsx
! grep -rnE "dangerouslySetInnerHTML|blur" src/components/dashboard src/components/billing
! grep -rn "first_paid" src/types/metrics.ts src/components
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - Free용 컴포넌트(`TeaserCard`·`TrendLockCard`·`UpgradeDialog`의 `teaser`)가 `Teaser` 외의 탐지 상세·거래 ID·추세를 받지 않는가? (AGENTS.md CRITICAL, ADR-011)
   - 잠금 카드가 blur 없이 정적 예시이고 가짜 수치임을 밝히는가? (DESIGN "금지")
   - 문구가 DESIGN·UX_GUIDE의 용어표·금지 문구를 지키는가(절약·낭비·부정 결제·"AI가 분석했어요" 없음)?
   - 상태 변화(카테고리 저장)가 `aria-live`로 알려지고, 에러 문구는 `messages.ts`에서 오는가?
3. 결과에 따라 `phases/9-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 새 타입과 위치, 컴포넌트별 props 시그니처, 각 컴포넌트가 보내는 요청(경로·본문), 데모 시나리오의 새 기대값을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/app/dashboard/page.tsx`를 고치지 마라. 이유: 화면 조립은 step 4에서 한다(이 step의 데모 페이지 변경은 `otherMerchants` 전달만).
- API 라우트·`lib/store`·`lib/queries`·마이그레이션을 만들거나 고치지 마라. 이유: step 2·3에서 한다.
- `buildDashboard`의 Free/Pro 분기와 `FreeDashboard`·`ProDashboard` 필드를 바꾸지 마라. 이유: 게이팅은 한 곳에서만 하고 이미 테스트로 고정돼 있다(`otherMerchants`는 Free·Pro 공통인 `Snapshot`에만 더한다).
- 카테고리 목록(`CategoryList`) 행에 select를 넣지 마라. 이유: 카테고리 수정은 가맹점 행에서만 한다(DESIGN).
- 측정 요청 실패를 사용자에게 보여주거나 재시도하지 마라. 이유: 측정은 사용자 행동을 막지 않는다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `supabase` 명령과 `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
