# Step 4: dashboard-page

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/USER_FLOW.md` (화면 목록의 `/dashboard`, ①의 (B) 대시보드 진입, ② 끝의 대시보드, ③, ④)
- `/docs/DESIGN.md` ("화면별 요소", "레이아웃", "문구")
- `/docs/UX_GUIDE.md` ("상태별 다음 단계", "aha", "습관", "계층 구조", "화면 체크리스트")
- `/docs/ARCHITECTURE.md` ("패턴", "레이어 규칙", "보안")
- `/docs/ADR.md` (ADR-011)
- 기존 코드: `/src/app/dashboard/page.tsx`·`page.test.tsx`(지금은 업로드 패널 + 현황 한 줄), `/src/app/demo/page.tsx`(대시보드 배치의 기준), `/src/lib/analytics/dashboard.ts`(`buildDashboard`), `/src/lib/auth.ts`(`requireUser`·`safeNextPath`), `/src/lib/clock.ts`(`seoulToday`), `/src/lib/billing/plan.ts`(`getPlanState`), `/src/components/dashboard/*.tsx`, `/src/components/billing/*.tsx`, `/src/components/upload/*.tsx`, `/src/lib/queries/transactions.ts`
- 브라우저 테스트 문서: `/docs/testing/BROWSER_TESTING.md` ("수동 확인: 업로드", "수동 확인: 결제", "추가할 시나리오")
- 이전 step 산출물: `/src/components/dashboard/teaser-card.tsx`·`trend-lock-card.tsx`·`top-merchants.tsx`·`merchant-category-select.tsx`, `/src/components/billing/upgrade-dialog.tsx`·`pricing-upgrade.tsx`(`teaser` prop), `/src/lib/queries/transactions.ts`(`listTransactions`), `/src/app/api/metrics/route.ts`, `/src/app/api/merchant-categories/route.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

`/dashboard`를 실제 데이터로 그린 월별 대시보드로 바꾼다. 지금은 거래가 있으면 "올린 이용내역" 현황 한 줄과 업로드 패널만 보여준다.

- 읽기는 Server Component다. 거래를 모두 읽어 `buildDashboard({ transactions, plan, month, today })`에 넣고, 그 결과(DTO)만 컴포넌트에 넘긴다(ARCHITECTURE "패턴").
- Free/Pro 게이팅은 `buildDashboard`의 DTO 유니온에서만 한다. 페이지는 `dashboard.plan`으로 분기만 하고, Free 분기에서는 `teaser`·`trendAvailable`·데이터가 있는 달 수만 쓴다. 거래 배열·탐지 상세·추세를 클라이언트 컴포넌트에 넘기지 않는다(AGENTS.md CRITICAL, ADR-011).
- AI 월간 요약은 10-ai-summary phase에서 총지출 카드 아래에 넣는다. 이 step에서는 그 자리를 비워 두고 placeholder 문구도 넣지 않는다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.tsx`).

## 작업

### 1. 로그인 복귀 경로
- 로그인하지 않았을 때 돌아올 경로를 `/dashboard`에 지금 주소의 `month`(`YYYY-MM` 형식이고 월이 01~12일 때만)와 `upgrade=pricing`만 붙여 만든 뒤 `requireUser(nextPath)`에 넘긴다. 이유: `?month=` 북마크와 가격 CTA가 로그인 뒤에도 이어져야 한다(UX_GUIDE "가입"). 다른 파라미터·잘못된 month는 버린다.

### 2. 데이터 읽기
- 세션 클라이언트로 `listCards`·`listDoneUploads`·`getSubscription`, 그리고 카드 라벨 Map으로 `listTransactions`를 읽는다(서로 기다릴 필요 없는 것은 병렬).
- `getPlanState`는 지금처럼(`checkout=success`일 때 강제 동기화).
- `buildDashboard({ transactions, plan: planState.plan, month: 쿼리의 month(문자열일 때), today: seoulToday() })`. 데이터가 없는 달·잘못된 month는 `buildDashboard`가 최근 데이터 월로 바꾼다(USER_FLOW ① (B)).
- 이 변경으로 `getTransactionCoverage`와 `TransactionCoverage` 타입이 어디에서도 쓰이지 않으면 함께 지운다(테스트 포함).

### 3. 화면 (`src/app/dashboard/page.tsx`)
헤더(워드마크 · 설정 · 로그아웃)와 결제 안내(`checkout=success`의 `CheckoutNotice`, Pro의 `upgrade=pricing` 안내)는 지금처럼 둔다. 그 아래:

- **거래 없음**(`buildDashboard`가 null): 지금의 온보딩 + 업로드 패널 그대로.
- **거래 있음**: 데모 페이지와 같은 컴포넌트·배치를 쓴다. 읽는 순서는 UX_GUIDE "계층 구조"다.
  1. 상단 한 줄: `<h1>` `{2026년 9월} 지출` · `MonthSelect` · `{2026년 9월}까지 반영됨`(전체 마지막 이용일의 달) · Secondary 작게 링크 `새 이용내역 추가`(`href="#upload"`).
  2. `md:` 2열: 왼쪽 `TotalCard`, 오른쪽 `CategoryList`.
  3. `md:` 2열: `TopMerchants`(`otherMerchants`, `editable`) · `DailyChart`.
  4. Free: `TeaserCard`(`teaser`, 데이터가 있는 달 수) → `trendAvailable`이면 `TrendLockCard`. Pro: `FindingsList`(`findings`, 데이터가 있는 달 수) → `trend`가 있으면 `TrendChart`. 데모의 "Pro 구분선"·하단 CTA는 넣지 않는다.
  5. 업로드 구역 `<section id="upload">`: `<h2>` `새 이용내역 추가` → 한 줄 `겹치는 거래는 한 번만 반영돼요`(`text-caption text-body`) → `HyundaiGuide` → `UploadPanel` → `UploadHistory`(`올린 파일`). 지금의 `올린 이용내역` 제목과 `월별 대시보드는 준비하고 있어요` 문구는 지운다.
- Free이고 `upgrade=pricing`이면 `PricingUpgrade`에 `teaser`(거래가 없으면 null)를 넘긴다.
- 레이아웃은 `max-w-5xl`, 섹션 사이 `space-y-12`, 카드 사이 `gap-6`(DESIGN "레이아웃"). 375px에서 가로 스크롤이 생기지 않는다.

### 4. 테스트 (먼저 작성, `page.test.tsx`)
`@/lib/auth`·`@/lib/queries/*`·`@/lib/billing/*`·`@/lib/supabase/server`·`@/lib/clock`과 무거운 클라이언트 컴포넌트(차트·업로드 패널 등)를 mock하고, 거래는 데모 fixture(`DEMO_TRANSACTIONS`, 오늘 `DEMO_TODAY`)를 쓴다.
- `requireUser` 인자: 파라미터 없음 → `/dashboard`. `month=2026-09` → `/dashboard?month=2026-09`. `month=2026-13`·`month=abc` → `/dashboard`. `upgrade=pricing&month=2026-08` → 둘 다 유지. `checkout=success`·그 밖의 파라미터는 버린다.
- 거래 없음 → 온보딩·업로드 패널, 대시보드 제목 없음.
- Free: `2026년 9월 지출`·`2026년 9월까지 반영됨`·`새 이용내역 추가`(`#upload`), `TeaserCard`가 `teaser`와 달 수만 받는다(props 키 확인), `TrendLockCard`가 있다, `FindingsList`·`TrendChart`가 렌더되지 않는다, `TopMerchants`가 `editable`이다. 렌더된 HTML에 `확인할 지출 상세`가 없다.
- Pro: `FindingsList`·`TrendChart`가 있고 `TeaserCard`·`TrendLockCard`가 없다.
- `month=2026-07` → 7월 제목. 데이터 없는 달 `month=2025-01` → 최근 데이터 월(9월).
- Free + `upgrade=pricing` → `PricingUpgrade`가 `teaser`를 받는다. Pro + `upgrade=pricing` → 모달 없이 `이미 Pro를 쓰고 있어요`(기존 단언 유지).
- 업로드 구역 `#upload`에 가이드·업로드 패널·올린 파일이 있다. `월별 대시보드는 준비하고 있어요`가 없다.

### 5. 브라우저 테스트 문서 `docs/testing/BROWSER_TESTING.md`
로그인 뒤 화면이라 자동화하지 않는다. 아래를 고친다(브라우저 실행은 하지 않는다):
- "수동 확인: 업로드" 3번을 새 화면에 맞게 고친다(완료 뒤 월별 대시보드가 그려지고, 맨 아래 `올린 파일` 목록).
- 새 절 `## 수동 확인: 대시보드 (UC 08~11, 15)`를 "수동 확인: 결제" 앞에 추가한다. 최소 항목:
  1. 거래가 있는 Free 사용자의 첫 화면(375×667)에 월 제목·반영 기간·총지출이 보이고, 총지출이 업로드 결과의 지출 합과 같다.
  2. 월 선택 → `?month=` 주소와 숫자가 바뀐다. `새 이용내역 추가` → 업로드 구역으로 이동.
  3. Free 티저: 종류별 건수·금액·후보 합계, `Pro로 보기` → 모달 맨 위에 `내 이용내역에서 확인이 필요한 지출 N건 · 후보 합계 N원`. 두 달 이상이면 추세 잠금 카드와 `Pro로 보기`. 페이지 소스(RSC payload)에 탐지 상세 가맹점·거래 id가 없다.
  4. 카테고리 수정: `가장 많이 쓴 곳`의 select로 바꾸면 `저장했어요`, 카테고리 목록 숫자가 바로 바뀌고, 새로고침해도 유지된다. `나머지 N곳 보기` 안의 가맹점도 고칠 수 있다.
  5. 로컬 mock에서 `결제하기` → `Pro가 활성화됐어요`와 함께 티저 자리에 상세 목록·월별 추세가 보인다.
  6. 측정(dev DB, Supabase SQL 편집기): 위 동작 뒤 `user_metrics`에 `first_attempt_at`·`first_success_at`·`teaser_seen_at`·`first_click_at`·`upgrade_source`가 채워지고, mock 결제로는 `first_paid_at`이 비어 있다.
- "추가할 시나리오"의 `/dashboard` Free 줄에서 이번에 수동 확인으로 옮긴 항목을 정리한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # DB 통합 테스트 회귀 없음
grep -q "buildDashboard" src/app/dashboard/page.tsx && grep -q "listTransactions" src/app/dashboard/page.tsx
grep -q 'id="upload"' src/app/dashboard/page.tsx
! grep -n "월별 대시보드는 준비하고 있어요" src/app/dashboard/page.tsx
! grep -rn "getTransactionCoverage" src --include='*.ts' --include='*.tsx'
grep -q "수동 확인: 대시보드" docs/testing/BROWSER_TESTING.md
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - Free 분기에서 거래 배열·탐지 상세·거래 ID·추세가 클라이언트 컴포넌트 props로 넘어가지 않는가? (AGENTS.md CRITICAL, ADR-011)
   - `today`가 `seoulToday()`이고 순수 레이어에 `Date.now()`가 들어가지 않았는가?
   - `requireUser`가 허용된 파라미터만 붙인 내부 경로를 받는가?
   - UX_GUIDE "화면 체크리스트"(다음 단계·Primary 개수·첫 뷰포트·빈 상태·근거·업그레이드 진입 위치·금지 문구)를 지키는가?
3. 결과에 따라 `phases/9-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 페이지 구성 순서, Free/Pro 분기에서 넘기는 props, 복귀 경로 규칙, 지운 코드, 문서에 더한 수동 확인 항목을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 페이지에서 Free/Pro를 다시 판단해 DTO 밖의 데이터를 만들거나, Free 분기에 `transactions`·`findings`·`trend`를 넘기지 마라. 이유: 게이팅은 `buildDashboard` 한 곳에서만 한다(AGENTS.md CRITICAL).
- 요약 카드·요약 placeholder를 넣지 마라. 이유: 10-ai-summary에서 만든다.
- 업로드 컴포넌트(`components/upload/*`)의 동작을 바꾸지 마라. 이유: 업로드 흐름은 7-upload-flow에서 확정됐다. 이 step은 배치만 바꾼다.
- 렌더 중에 측정·카테고리 등 서버 쓰기를 하지 마라. 이유: 렌더 중 쓰기 예외는 AI 요약 저장과 결제 재동기화 두 가지뿐이다(ADR-001).
- `/settings`에 업로드 내역·삭제를 옮기지 마라. 이유: data-management phase에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `supabase` 명령과 `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
