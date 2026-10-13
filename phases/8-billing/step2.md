# Step 2: billing-core

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "패턴", "결제 동기화", "모드 · 환경", "테스트")
- `/docs/ADR.md` (ADR-001, ADR-012, ADR-014, ADR-015, ADR-020)
- 기존 코드: `/src/lib/store/store-error.ts`(`callStoreRpc`)·`/src/lib/store/cards.ts`·`/src/lib/store/uploads.ts`와 `*.db.test.ts`(RPC 래퍼·DB 통합 테스트 패턴), `/src/lib/queries/query-error.ts`(`readQuery`)·`/src/lib/queries/uploads.ts`(세션 클라이언트 인자 + user_id 명시), `/src/lib/supabase/db-test-helpers.ts`(임시 사용자), `/src/lib/clock.ts`(`seoulToday`), `/src/lib/origin.ts`(`getSiteOrigin`), `/src/lib/mode.ts`, `/vitest.config.ts`
- 이전 step 산출물: `/supabase/migrations/20261014000000_subscriptions.sql`(`save_subscription` 결과 kind), `/src/services/polar/*.ts`(`PolarGateway`·`PolarGatewayError`·`createFakePolarGateway`·`getPolarGateway`), `/src/types/billing.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

결제 상태를 읽고 쓰고 Polar와 맞추는 `lib/billing`을 만든다. 규칙(ARCHITECTURE "결제 동기화", ADR-012):

- `syncFromPolar(uid)`: 조회 시작 시각을 먼저 잡고 → Polar 현재 상태를 조회하고 → `save_subscription`이 "저장된 조회보다 늦게 시작했을 때만" 저장한다.
- Polar에 고객이 없으면(404) Free로 확정한다. 그 밖의 조회 실패와 저장 실패는 기존 상태를 유지한다(Free로 덮지 않음).
- Pro 상품의 active 구독만 Pro다(이 판별은 이미 `PolarGateway`가 한다).
- 결제 기간이 지난 상태: 저장된 Pro의 `current_period_end`가 지났으면 렌더 중에 다시 동기화한다(ADR-001의 예외 2개 중 하나).
- mock(ADR-014): checkout은 Polar 없이 바로 Pro로, 포털은 바로 Free로 저장한다. 동기화는 Polar를 조회하지 않는다.

`lib/billing`은 I/O 레이어이므로 의존성 주입으로 테스트한다. 페이지·핸들러가 세션 클라이언트로 저장된 구독을 읽어 넘기고, 쓰기는 service-role 저장 함수로만 한다(AGENTS.md CRITICAL).

이 step의 DB 통합 테스트는 step 0의 마이그레이션이 dev DB에 push돼 있어야 통과한다. push 전이면 아래 "사용자 개입" 규칙대로 blocked로 멈춘다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 타입 (`src/types/billing.ts`에 추가)
```ts
export type StoredSubscription = {
  plan: Plan;                         // Plan은 src/types/dashboard.ts
  currentPeriodEnd: string | null;    // ISO 8601
  cancelAtPeriodEnd: boolean;
};
export type SaveSubscriptionInput = {
  userId: string;
  syncedFrom: string;                 // 조회 시작 시각 ISO 8601
  plan: Plan;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};
export type SaveSubscriptionResult =
  | { kind: "saved" | "stale"; subscription: StoredSubscription }
  | { kind: "user_not_found" };
export type PlanState =
  | { plan: "free" }
  | { plan: "pro"; periodEnd: IsoDate | null; cancelAtPeriodEnd: boolean }; // periodEnd는 서울 기준 날짜
```

### 2. 저장 `src/lib/store/subscriptions.ts` (`import 'server-only'`)
```ts
export async function saveSubscription(input: SaveSubscriptionInput): Promise<SaveSubscriptionResult>
```
- `callStoreRpc("save_subscription", { p_user_id, p_synced_from, p_plan, p_subscription_id, p_current_period_end, p_cancel_at_period_end }, schema)`. 결과는 zod로 검증하고 snake_case를 camelCase로 바꾼다. 형식이 다르면 `StoreError`(기존 동작).
- free를 저장할 때 `subscriptionId`·`currentPeriodEnd`는 null, `cancelAtPeriodEnd`는 false로 보낸다(DB 제약).

### 3. 읽기 `src/lib/queries/subscriptions.ts` (`import 'server-only'`)
```ts
export async function getSubscription(supabase: SupabaseClient, userId: string): Promise<StoredSubscription | null>
```
- `subscriptions`에서 `.eq("user_id", userId).maybeSingle()`. 행이 없으면 `null`. `readQuery`로 검증한다.

### 4. `src/lib/billing/` (모든 파일 `import 'server-only'`)

```ts
// deps.ts
export type BillingDeps = {
  mode: Mode;
  now: () => Date;
  origin: string;                                   // getSiteOrigin()
  gateway: () => PolarGateway;                      // live에서만 호출. mock에서는 절대 부르지 않는다
  saveSubscription: (input: SaveSubscriptionInput) => Promise<SaveSubscriptionResult>;
};
export function defaultBillingDeps(): BillingDeps   // getMode() · () => new Date() · getSiteOrigin() · getPolarGateway · saveSubscription

// sync.ts
export type SyncResult =
  | { kind: "synced"; subscription: StoredSubscription }
  | { kind: "skipped" }          // mock: Polar를 조회하지 않음
  | { kind: "failed" }           // Polar 조회 실패 또는 저장 실패: 기존 상태 유지
  | { kind: "user_not_found" };  // 탈퇴한 사용자
export async function syncFromPolar(userId: string, deps: BillingDeps): Promise<SyncResult>

// plan.ts
export function toPlanState(subscription: StoredSubscription | null): PlanState
export async function getPlanState(
  userId: string, stored: StoredSubscription | null, deps: BillingDeps, options?: { sync?: boolean },
): Promise<PlanState>

// checkout.ts
export async function startCheckout(
  input: { userId: string; source: UpgradeSource; customerIp: string | null; stored: StoredSubscription | null },
  deps: BillingDeps,
): Promise<string>                                  // 이동할 절대 URL

// portal.ts
export async function openPortal(userId: string, deps: BillingDeps): Promise<string | null>  // null: Polar 고객 없음
```

규칙:
- `syncFromPolar`
  - mock → `skipped`(gateway·저장 함수 미호출).
  - live → `const startedAt = deps.now()`를 **Polar 호출 전에** 잡는다 → `gateway().getCustomerState(userId)` → `no_customer`·`pro: null`은 free, pro는 그 구독 값으로 `saveSubscription({ syncedFrom: startedAt.toISOString(), ... })` → `saved`·`stale`은 `synced`(stale이면 DB에 있는 더 최신 행), `user_not_found`는 그대로.
  - `PolarGatewayError`·`StoreError`(또는 그 밖의 throw) → `failed`. 저장하지 않는다. 에러를 삼킬 때 `console.error("billing:sync:<operation>:<code>", userId)`처럼 코드와 id만 남긴다.
- `toPlanState`: null 또는 free → `{ plan: "free" }`. pro → `periodEnd`는 `currentPeriodEnd`를 `seoulToday(new Date(값))`으로 바꾼 서울 날짜(null이면 null).
- `getPlanState`: `options.sync`가 true이거나, 저장된 값이 pro이고 `currentPeriodEnd`가 있고 `currentPeriodEnd <= deps.now()`면 `syncFromPolar`를 부른다. `synced`면 그 결과로, 그 밖(`skipped`·`failed`·`user_not_found`)이면 넘겨받은 `stored`로 `toPlanState`. 재동기화가 필요 없으면 Polar를 부르지 않는다.
- `startCheckout`
  - 성공 URL `${origin}/dashboard?checkout=success`. 취소 시 돌아갈 URL은 source가 `settings`면 `${origin}/settings`, 나머지는 `${origin}/dashboard`(USER_FLOW ③).
  - 이미 Pro(`stored?.plan === "pro"`):
    - mock → `${origin}/settings`.
    - live → `openPortal`과 같은 포털 URL. Polar 고객이 없으면(null) 아래 Free 경로로 checkout을 만든다(저장된 상태가 낡은 경우).
  - Free:
    - mock → `saveSubscription({ plan: "pro", subscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, syncedFrom: now })` 후 성공 URL. 저장 결과가 `user_not_found`면 throw.
    - live → `gateway().createCheckoutUrl({ userId, customerIp, successUrl, returnUrl, source })`.
  - 실패는 그대로 던진다(핸들러가 503으로 바꾼다).
- `openPortal`: 포털에서 돌아올 URL은 `${origin}/settings`.
  - mock → free 저장(`syncedFrom: now`) 후 `${origin}/settings`.
  - live → `gateway().createPortalUrl({ userId, returnUrl })`(null이면 null).
- 사용자 id는 인자로만 받는다. 이 레이어는 요청 본문을 보지 않는다.

### 5. 테스트 (먼저 작성)
- 단위(`*.test.ts`, 네트워크 없음): `createFakePolarGateway`와 메모리 `saveSubscription` 가짜(synced_from 비교까지 흉내)를 쓴다.
  - sync: mock → skipped이고 gateway·저장 미호출. live no_customer → free 저장. Pro → pro 저장(세 필드). `pro: null` → free 저장. `startedAt`이 Polar 호출 전 시각인지(가짜 `now`가 호출 순서를 기록). gateway 실패 → failed이고 저장 미호출. 저장 throw → failed. stale → DB의 최신 값으로 synced. user_not_found → user_not_found. 로그 인자에 에러 메시지가 없다.
  - plan: `toPlanState`의 free·pro·null, 서울 날짜 변환(`2026-11-12T15:30:00Z` → `2026-11-13`). 기간이 지난 pro → 동기화하고 결과 반영. 기간이 남은 pro·free·null → Polar 미호출. 동기화 실패 → 저장된 pro 유지. `sync: true`면 기간과 무관하게 동기화.
  - checkout: mock Free → pro 저장 + 성공 URL. mock Pro → `/settings` URL이고 저장 없음. live Free → checkout 인자(성공·취소 URL, source별 취소 URL, IP). live Pro → 포털 URL, 포털 null → checkout. 실패는 throw.
  - portal: mock → free 저장 + `/settings`. live → 포털 URL·null.
  - store·queries 래퍼: `vi.mock`한 클라이언트로 인자 이름 변환과 응답 검증 실패 → `StoreError`·`QueryError`.
- DB 통합(`*.db.test.ts`, `npm run test:db`): `src/lib/store/subscriptions.db.test.ts`, `src/lib/queries/subscriptions.db.test.ts`. 테스트마다 `createTestUser()`로 임시 사용자를 만들고 끝나면 `deleteTestUser()`.
  - 처음 저장 → saved, 같은 값으로 `getSubscription`(admin 클라이언트를 인자로)이 읽힘. 더 늦은 시각 free → saved. 더 이른 시각 pro → stale이고 결과가 free. 없는 사용자 id(랜덤 UUID) → user_not_found. 사용자 삭제 후 행 없음.
  - Email 로그인이 꺼져 있어 테스트 세션을 만들 수 없으므로 RLS는 pgTAP(step 0)이 단언한다. DB 테스트의 읽기는 admin 클라이언트를 `getSubscription` 인자로 넘겨 한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # dev DB 통합 테스트 통과(기존 + subscriptions)
test -f src/lib/store/subscriptions.ts && test -f src/lib/queries/subscriptions.ts
test -f src/lib/billing/deps.ts && test -f src/lib/billing/sync.ts && test -f src/lib/billing/plan.ts && test -f src/lib/billing/checkout.ts && test -f src/lib/billing/portal.ts
! grep -rnE "\.message|\.details|\.hint" src/lib/billing src/lib/store/subscriptions.ts src/lib/queries/subscriptions.ts --include='*.ts' --exclude='*.test.ts'
! grep -rnE "fake-gateway|db-test-helpers" src/lib/billing --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - mock 모드에서 `gateway()`가 한 번도 불리지 않는가?
   - 조회 실패 때 Free로 덮지 않는가? 404(고객 없음)만 Free로 확정하는가? (ADR-012)
   - 조회 시작 시각을 Polar 호출 전에 잡는가?
   - 쓰기가 `saveSubscription`(service-role RPC)으로만 일어나는가? (AGENTS.md CRITICAL)
   - 로그에 코드와 id만 있는가?
3. 결과에 따라 `phases/8-billing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `saveSubscription`·`getSubscription`·`BillingDeps`·`defaultBillingDeps`·`syncFromPolar`·`toPlanState`·`getPlanState`·`startCheckout`·`openPortal` 시그니처, `SyncResult`·`PlanState` 형식, mock 동작, DB 테스트 개수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

### 사용자 개입(blocked) 규칙
- `npm run test:db`가 함수·테이블을 찾지 못해 실패하면(PostgREST `PGRST202`·`PGRST205`, Postgres `42883`·`42P01`, "Could not find the function" 등) 코드를 고치지 말고 blocked로 멈춘다. `blocked_reason`: `"마이그레이션 미적용: 20261014000000_subscriptions.sql을 dev DB에 push하고 scripts/pgtap.sh를 실행해야 함"`.
- push된 SQL 자체가 틀려서 실패하면(예: RPC가 예상과 다른 kind를 돌려줌, SQL 런타임 에러) 마이그레이션 파일을 고치지 말고 blocked로 멈춘다. 사유에는 실패한 RPC 이름과 에러 코드만 적는다. 이유: 이미 적용된 마이그레이션은 새 마이그레이션으로 고친다.

## 금지사항

- 요청 본문·쿼리·웹훅 페이로드에서 온 값으로 플랜을 정하지 마라. 이유: 플랜은 Polar 현재 상태 조회 결과로만 정한다(ADR-012).
- 조회가 실패했을 때 Free를 저장하지 마라. 이유: 웹훅이나 Polar가 잠깐 실패해도 결제한 사용자가 Free로 떨어지면 안 된다(ARCHITECTURE "결제 동기화").
- 동기화에 lease·세대 번호·재시도 루프를 넣지 마라. 이유: 조회 시작 시각 조건부 저장으로 충분하다(ADR "의도적으로 뺀 것").
- `user_metrics`·첫 결제 기록을 만들지 마라. 이유: 9-dashboard에서 지표와 함께 만든다.
- Route Handler·페이지·컴포넌트를 만들지 마라. 이유: 다음 step에서 만든다.
- `supabase db push`·`reset`·`query`·`link`, `scripts/pgtap.sh`, `vercel deploy`를 실행하지 마라. 이유: dev DB 마이그레이션은 사용자 쪽에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
