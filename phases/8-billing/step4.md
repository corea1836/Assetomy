# Step 4: billing-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/USER_FLOW.md` (화면 목록, ① 진입의 "Pro 시작하기", ③ Pro 전환, ⑤ 설정의 플랜)
- `/docs/UX_GUIDE.md` ("전환: 티저 → 업그레이드 모달 → 결제", "계층 구조", 접근성, 모달 버튼 배치, CTA 문구)
- `/docs/DESIGN.md` (토큰, 버튼, "모달", Pro 표시, 금지 사항)
- `/docs/ARCHITECTURE.md` ("패턴", "결제 동기화")
- `/docs/testing/BROWSER_TESTING.md` (S5 랜딩 href, 보호 페이지)
- 기존 코드: `/src/app/dashboard/page.tsx`와 테스트, `/src/app/page.tsx`(가격 밴드·`PRO_PRICE_KRW`)와 테스트, `/src/app/login/page.tsx`(`searchParams` Promise 처리), `/src/components/upload/delete-upload-dialog.tsx`(모달 포커스·Esc·Tab 순환·스크롤 잠금 패턴), `/src/components/upload/api-reply.ts`(`fetchJson`·`responseError`), `/src/components/button-styles.ts`, `/src/components/dashboard/finding-labels.ts`, `/src/lib/errors/messages.ts`, `/src/lib/format.ts`, `/scripts/browser-test/s5-signup-links.js`·`s7-login.js`
- 이전 step 산출물: `/src/lib/billing/*.ts`(`defaultBillingDeps`·`getPlanState`), `/src/lib/queries/subscriptions.ts`, `/src/app/api/checkout/route.ts`·`/src/app/api/portal/route.ts`(응답 `{ url }`), `/src/types/billing.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

결제에 필요한 최소 화면을 만든다. 월별 대시보드(티저·잠금 카드·요약)는 9-dashboard에서 만든다. 그래서 이번 phase의 업그레이드 진입점은 `pricing`(랜딩 가격 → 로그인 → 대시보드에서 모달)과 `settings`(설정의 업그레이드) 둘뿐이다. 9에서 `teaser`·`trend`·`summary` 진입점이 같은 모달을 쓴다.

- 업그레이드 모달 순서(UX_GUIDE "전환"): 내 후보 건수·합계(Free DTO, **9에서 추가**) → Pro에서 보이는 상세(정적 예시, 가짜 수치임을 밝힘) → 가격(KRW, 해외 $4.99/월) → 해지 안내 한 줄 → 결제하기 · 닫기.
- 모달은 사용자가 누를 때만 연다. 예외는 랜딩 "Pro 시작하기"를 눌러 로그인한 뒤 돌아온 `/dashboard?upgrade=pricing`이다(사용자가 누른 행동이 로그인 뒤에 이어진다, UX_GUIDE).
- 결제하기 → `POST /api/checkout` JSON `{ source }` → `{ url }`로 `window.location.assign`. 결제를 마치면 Polar가 `/dashboard?checkout=success`로 보내고, 대시보드는 렌더 중 `syncFromPolar`로 상태를 맞춘다(`getPlanState(..., { sync: true })`). mock은 checkout이 바로 Pro를 저장하고 같은 URL을 돌려준다.
- 결제 완료 안내는 "Pro가 활성화됐어요", 아직 반영 전이면 "결제 반영 중…" + 새로고침 안내(USER_FLOW ③). `aria-live="polite"`로 알린다.
- 가격은 `월 6,900원`(KRW, sandbox 상품 가격과 같음, PRD [확정 필요])과 "해외에서는 $4.99/월로 결제돼요"다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts(x)`).

## 작업

### 1. 가격 상수 `src/lib/pricing.ts`
```ts
export const PRO_PRICE_KRW = 6_900; // 임시값: PRD [확정 필요]
export const PRO_PRICE_USD_LABEL = "$4.99/월";
```
- `src/app/page.tsx`의 `PRO_PRICE_KRW`를 이 파일에서 import하도록 옮긴다(값·화면 그대로). 클라이언트 컴포넌트도 쓰므로 `server-only`를 붙이지 않는다.

### 2. 에러 문구 `src/lib/errors/messages.ts`에 추가
```ts
export function billingErrorMessage(code: ApiErrorCode): string
```
- `TEMPORARY_FAILURE` → "결제 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요."
- `NOT_FOUND` → "구독 정보를 찾지 못했어요. 새로고침한 뒤 다시 시도해 주세요."
- `UNAUTHORIZED` → 기존 업로드 문구와 같은 "로그인이 만료됐어요. 다시 로그인해 주세요."
- 그 밖 → "요청을 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요."

### 3. 컴포넌트 `src/components/billing/` (모두 DTO·원시값만 받는다)

```tsx
// upgrade-dialog.tsx ("use client")
export function UpgradeDialog(props: { source: UpgradeSource; opener: HTMLElement | null; onClose: () => void }): React.JSX.Element

// upgrade-button.tsx ("use client") — 눌렀을 때 모달을 연다(settings, 9의 teaser·trend·summary)
export function UpgradeButton(props: { source: UpgradeSource; label: string; variant?: "primary" | "secondary" }): React.JSX.Element

// pricing-upgrade.tsx ("use client") — /dashboard?upgrade=pricing에서 마운트되면 바로 모달을 연다
export function PricingUpgrade(): React.JSX.Element

// manage-subscription-button.tsx ("use client") — 구독 관리 → POST /api/portal → 이동
export function ManageSubscriptionButton(): React.JSX.Element

// checkout-notice.tsx — ?checkout=success 결과 안내
export function CheckoutNotice(props: { plan: Plan }): React.JSX.Element
```

- `UpgradeDialog`
  - DESIGN "모달": 오버레이 `fixed inset-0 bg-surface-dark/40`(blur 금지), 패널 `rounded-3xl bg-canvas p-6 sm:p-8 max-w-md w-full`. `role="dialog"`·`aria-modal`·`aria-labelledby`.
  - 포커스·Esc·Tab 순환·body 스크롤 잠금·닫힐 때 `opener` 포커스 복귀는 `DeleteUploadDialog`와 같은 방식으로 이 파일 안에 구현한다. `opener`가 null이면 포커스를 되돌리지 않는다.
  - 내용 순서: 제목 "Pro에서 확인할 지출 상세를 볼 수 있어요" → 정적 예시 목록(이 파일의 상수 2~3줄. 종류 라벨은 `FINDING_KIND_LABELS`, 가맹점은 "예시 OTT"처럼 가짜임이 드러나는 이름. amber 면 `bg-amber-50 border-amber-200 text-amber-900`) + 캡션 "예시 화면이에요. 실제 내 데이터가 아니에요." → 가격 `월 6,900원`(`formatWon(PRO_PRICE_KRW)`) + "해외에서는 $4.99/월로 결제돼요" → "설정에서 언제든 해지할 수 있어요. 남은 기간까지 Pro로 써요" → 버튼.
  - 버튼: Primary "결제하기", Secondary "닫기". 모바일은 전체 너비로 쌓고 Primary가 위, `sm:` 이상은 오른쪽 정렬이고 Primary가 오른쪽 끝(UX_GUIDE).
  - 결제하기: `fetchJson("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source }) })`. 200이고 `{ url: string }`(zod)이면 `window.location.assign(url)`(버튼은 "결제 화면 여는 중…"으로 비활성 유지). 아니면 `responseError`의 code로 `billingErrorMessage`를 `role="alert"`로 보여주고 다시 누를 수 있게 한다. 처리 중에는 Esc·닫기를 막는다. 두 번 눌러도 요청은 한 번이다.
  - 절감액·할인·남은 시간·"지금 아니면" 같은 문구를 쓰지 않는다(UX_GUIDE). amber를 버튼에 쓰지 않는다.
- `UpgradeButton`: 버튼(`buttonClass(variant ?? "primary")`)을 누르면 `UpgradeDialog`를 열고, 닫으면 그 버튼으로 포커스를 돌린다.
- `PricingUpgrade`: 마운트되면 `source="pricing"`으로 모달을 연다(보이는 버튼 없음, `opener` null). 닫으면 `router.replace("/dashboard")`로 `?upgrade=pricing`을 지운다(새로고침해도 다시 열리지 않게).
- `ManageSubscriptionButton`: Secondary "구독 관리". `fetchJson("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })` → `{ url }`이면 이동, 아니면 `billingErrorMessage`를 `role="alert"`로 보여준다.
- `CheckoutNotice`: `role="status"` + `aria-live="polite"`. `pro` → "Pro가 활성화됐어요". `free` → "결제 반영 중…" + "잠시 후 새로고침해 주세요" + 같은 주소(`/dashboard?checkout=success`)로 가는 Text 링크 "새로고침". primary 계열 색(완료·다음 단계)을 쓰고 amber·danger를 쓰지 않는다.

### 4. `/settings` (`src/app/settings/page.tsx`)
- `export const metadata = { title: "설정 · assetomy" }`. `requireUser("/settings")`.
- `getSubscription(await createSupabaseServerClient(), user.id)` → `getPlanState(user.id, stored, defaultBillingDeps())`(기간이 지난 Pro만 재동기화).
- 헤더는 대시보드와 같은 모양: 워드마크(`/`) · "대시보드"(`/dashboard`) 링크 · 로그아웃 폼.
- h1 "설정", 섹션 h2 "플랜":
  - Free: "Free 플랜을 쓰고 있어요" + `UpgradeButton source="settings" label="업그레이드"`.
  - Pro: Pro 표시(DESIGN "Pro 표시" 클래스) + 해지 예약이고 `periodEnd`가 있으면 "`YYYY-MM-DD`까지 Pro로 쓸 수 있어요", 해지 예약이 아니고 `periodEnd`가 있으면 "다음 결제일 `YYYY-MM-DD`", `periodEnd`가 없으면(mock) 날짜 문구 없음 + `ManageSubscriptionButton`.
- 업로드 내역·전체 삭제·탈퇴는 만들지 않는다(data-management phase).

### 5. 대시보드 (`src/app/dashboard/page.tsx`)
- `searchParams: Promise<{ checkout?: string | string[]; upgrade?: string | string[] }>`를 받는다(로그인 페이지의 처리 방식을 따른다. 배열이면 첫 값).
- 기존 조회와 함께 `getSubscription`을 읽고 `getPlanState(user.id, stored, defaultBillingDeps(), { sync: checkout === "success" })`.
- 헤더의 로그아웃 왼쪽에 "설정"(`/settings`) 링크(Secondary sm 모양).
- `checkout === "success"`면 `<main>` 맨 위에 `CheckoutNotice plan={planState.plan}`.
- `upgrade === "pricing"`이고 Free면 `PricingUpgrade`를 렌더한다. Pro면 렌더하지 않는다.
- 기존 온보딩·업로드 패널·올린 파일 목록은 그대로 둔다.

### 6. 랜딩 (`src/app/page.tsx`)
- 가격 밴드 "Pro 시작하기" href: 로그인 상태면 `/dashboard?upgrade=pricing`, 아니면 `/login?next=${encodeURIComponent("/dashboard?upgrade=pricing")}`(= `/login?next=%2Fdashboard%3Fupgrade%3Dpricing`). 다른 링크는 그대로.

### 7. 브라우저 테스트 기대값 (파일만 고친다, 실행하지 않는다)
- `docs/testing/BROWSER_TESTING.md`와 `scripts/browser-test/s5-signup-links.js`: 랜딩 `Pro 시작하기` href를 `/login?next=%2Fdashboard%3Fupgrade%3Dpricing`로 바꾼다(로그인하지 않은 상태).
- 같은 문서의 "보호 페이지"와 그 시나리오 스크립트(`s7-login.js` 등 `/dashboard` 리다이렉트를 확인하는 곳): 로그인하지 않고 `/settings` → `/login?next=%2Fsettings`를 추가한다.
- 문서의 "수동 확인"에 결제 항목을 추가한다(로그인 필요, 자동화하지 않음): mock에서 설정 → 업그레이드 → 결제하기 → `Pro가 활성화됐어요` → 설정에 Pro 표시 → 구독 관리 → Free. live+sandbox에서 테스트 카드 결제 → 결제 완료 안내, `polar listen`으로 받은 웹훅 200, 포털에서 해지 → "YYYY-MM-DD까지 Pro".

### 8. 테스트 (먼저 작성)
- `upgrade-dialog.test.tsx`: 내용 순서(예시 → 가격 → 해지 안내 → 버튼), "예시 화면이에요" 캡션, 가격 `월 6,900원`과 `$4.99/월`, 열리면 패널로 포커스, Esc로 닫힘, Tab 순환, 닫히면 opener 포커스. 결제하기 → `fetch`에 `/api/checkout`·POST·`application/json`·`{"source":"settings"}`, 200 `{url}`이면 `window.location.assign(url)`, 두 번 눌러도 fetch 1회, 503이면 `role="alert"`에 `billingErrorMessage("TEMPORARY_FAILURE")`이고 버튼이 다시 활성. 금지 문구("절약", "할인", "지금") 없음.
- `upgrade-button.test.tsx`: 누르면 모달, 닫으면 버튼 포커스.
- `pricing-upgrade.test.tsx`: 마운트 시 모달이 열리고 결제하기가 `source: "pricing"`을 보냄, 닫으면 `router.replace("/dashboard")`(`next/navigation` mock).
- `manage-subscription-button.test.tsx`: 200 → 이동, 404 → 문구.
- `checkout-notice.test.tsx`: pro·free 문구, `role="status"`·`aria-live="polite"`, 새로고침 링크 href.
- 페이지 테스트(`vi.mock`으로 `@/lib/auth`·`@/lib/queries/*`·`@/lib/billing/*`·`@/lib/supabase/server`):
  - settings: 로그인 필요(`requireUser("/settings")`), Free → 업그레이드 버튼, Pro 해지 예약 → "2026-11-13까지 Pro로 쓸 수 있어요"와 구독 관리, Pro 갱신 예정 → "다음 결제일 …", mock Pro(periodEnd null) → 날짜 문구 없음. 업로드 목록·전체 삭제·탈퇴 없음.
  - dashboard: "설정" 링크, `?checkout=success`면 `getPlanState`가 `{ sync: true }`로 불리고 안내가 보임, 없으면 `sync`가 true가 아니고 안내 없음, `?upgrade=pricing` + Free → 모달 열림, + Pro → 모달 없음. 기존 단언 유지.
  - landing: 로그인 전·후의 `Pro 시작하기` href.
- `messages.test.ts`: `billingErrorMessage`의 네 경우.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # 기존 DB 통합 테스트 회귀 없음
test -f src/app/settings/page.tsx && test -f src/components/billing/upgrade-dialog.tsx && test -f src/lib/pricing.ts
! grep -rn "dangerouslySetInnerHTML" src/components/billing src/app/settings
! grep -rnE "@/lib/(billing|queries|store|supabase)|@/services/" src/components/billing
! grep -n "const PRO_PRICE_KRW" src/app/page.tsx
grep -q "upgrade%3Dpricing" scripts/browser-test/s5-signup-links.js
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `components/billing`이 DTO·원시값만 받고 서버 모듈을 import하지 않는가? (AGENTS.md)
   - 업그레이드 진입점이 `pricing`·`settings` 두 곳뿐이고, 전역 배너·자동 팝업이 없는가? (`?upgrade=pricing` 제외, UX_GUIDE)
   - 사용자에게 보이는 에러 문구가 `lib/errors/messages.ts`에서만 오는가?
   - 모달이 키보드만으로 열고·결제하기·닫기까지 되는가? (UX_GUIDE 접근성)
   - 금지 문구와 amber 버튼이 없는가? (DESIGN·UX_GUIDE)
3. 결과에 따라 `phases/8-billing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 컴포넌트 시그니처와 위치, `/settings`·대시보드·랜딩 변경점, `billingErrorMessage`·`PRO_PRICE_KRW` 위치, 고친 브라우저 테스트 파일을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 티저·잠금 카드·월 요약·`buildDashboard` 연결·월 선택을 만들지 마라. 이유: 9-dashboard에서 만든다.
- 모달에 내 후보 건수·합계를 넣지 마라. 이유: Free DTO가 9에서 생긴다. 9가 같은 모달에 붙인다.
- `DeleteUploadDialog`나 기존 업로드 컴포넌트를 리팩터링하지 마라. 이유: 이번 변경과 무관한 수정이다.
- `/settings`에 업로드 내역·전체 삭제·탈퇴를 만들지 마라. 이유: data-management phase에서 만든다. 대시보드의 "올린 파일"은 그대로 둔다.
- 업그레이드 진입점을 헤더·전역 배너에 두지 마라. 이유: 진입점은 source 허용목록의 자리뿐이다(UX_GUIDE).
- `POST /api/metrics`를 부르거나 만들지 마라. 이유: 9-dashboard에서 만든다.
- 브라우저용 Supabase 클라이언트를 만들지 마라. 이유: ADR-021.
- 브라우저 테스트(`scripts/browser-test/run.sh`)·`dev-browser`를 실행하지 마라. 이유: 브라우저 확인은 phase가 끝난 뒤 따로 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `supabase` 명령과 `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
