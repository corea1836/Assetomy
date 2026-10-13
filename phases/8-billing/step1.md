# Step 1: polar-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md` (기술 스택: Polar는 `@polar-sh/sdk`만, API 버전 `@polar-sh/sdk/2026-10`만 import)
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "결제 동기화", "모드 · 환경", "보안")
- `/docs/ADR.md` (ADR-012, ADR-014, ADR-018)
- 기존 코드: `/src/lib/env.ts`와 테스트(lazy zod 검증, 에러 메시지는 변수 이름만), `/src/lib/mode.ts`, `/src/services/llm/index.ts`·`/src/services/llm/types.ts`·`/src/services/llm/mock-classifier.ts`(외부 서비스 래퍼 + mock 패턴), `/src/types/dashboard.ts`(`Plan`)
- 이전 step 산출물: `/supabase/migrations/20261014000000_subscriptions.sql`(저장할 필드)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

Polar 호출을 `services/polar/` 인터페이스 뒤에 둔다(ARCHITECTURE "레이어 규칙": 외부 서비스는 인터페이스 뒤에 두고 mock을 함께 만든다). 이 step은 DB를 쓰지 않는다.

쓰는 Polar 기능은 4가지다:
1. 고객 상태 조회: `polar.customers.getStateExternal(externalId)` — `external_id`는 우리 사용자 id(세션 uid)다. 고객이 없으면 404(`errors.ResourceNotFound`).
2. checkout 생성: `polar.checkouts.create({ products, external_customer_id, customer_ip_address, success_url, return_url, metadata })` → `checkout.url`
3. 고객 포털 세션: `polar.customerSessions.create({ external_customer_id, return_url })` → `session.customer_portal_url`. 고객이 없으면 404.
4. 웹훅 검증: `webhooks.validateEvent(body, headers, secret)` — Standard Webhooks 서명(`webhook-id`·`webhook-timestamp`·`webhook-signature`)을 검증하고 이벤트를 파싱한다. 서명이 틀리면 `PolarWebhookVerificationError`, 이 API 버전에 없는 이벤트면 `PolarWebhookUnknownTypeError`(둘 다 `PolarWebhookError`를 상속).

mock 모드(ADR-014)에서는 Polar를 부르지 않는다. mock 동작(결제 = 바로 Pro, 포털 = 바로 Free)은 다음 step의 `lib/billing`이 DB 저장으로 처리하므로, 이 step의 `getPolarGateway()`는 mock 모드에서 호출되면 throw한다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 패키지
- `npm install @polar-sh/sdk@^1.0.2`. import 경로는 `@polar-sh/sdk/2026-10` 하나만 쓴다(`createPolar`, `errors`, `webhooks`, 타입). 루트 경로(`@polar-sh/sdk`)·`2026-04`·`2027-01`을 쓰지 않는다.
- `@polar-sh/nextjs`는 설치하지 않는다.

### 2. 타입 `src/types/billing.ts`
```ts
export const UPGRADE_SOURCES = ["teaser", "trend", "summary", "pricing", "settings"] as const;
export type UpgradeSource = (typeof UPGRADE_SOURCES)[number];
```

### 3. env `src/lib/env.ts`에 추가
```ts
export type PolarEnv = { accessToken: string; server: "sandbox" | "production"; proProductId: string };
export function getPolarEnv(): PolarEnv              // POLAR_ACCESS_TOKEN · POLAR_ENV · POLAR_PRO_PRODUCT_ID
export function getPolarWebhookSecret(): string       // POLAR_WEBHOOK_SECRET
```
- 기존 함수처럼 호출할 때 검증하고(lazy), 실패하면 문제 변수 이름만 담은 `Error`를 던진다. 값은 메시지에 넣지 않는다.
- `POLAR_ENV`는 `sandbox`·`production`만. **`VERCEL_ENV`가 `production`인데 `POLAR_ENV`가 `production`이 아니면 throw**(`"POLAR_ENV"`). 이유: 운영에서 sandbox로 결제받으면 테스트 카드로 Pro가 열린다.
- 빈 문자열은 없는 값으로 본다(기존 `emptyAsUndefined`).

### 4. 인터페이스 `src/services/polar/types.ts`
```ts
export type ProSubscription = {
  subscriptionId: string;
  currentPeriodEnd: string;      // ISO 8601(Polar 값 그대로)
  cancelAtPeriodEnd: boolean;
};
export type PolarCustomerState =
  | { kind: "no_customer" }                          // Polar에 고객이 없음(404)
  | { kind: "customer"; pro: ProSubscription | null }; // pro가 null이면 Free

export type CheckoutInput = {
  userId: string; customerIp: string | null; successUrl: string; returnUrl: string; source: UpgradeSource;
};

export interface PolarGateway {
  getCustomerState(userId: string): Promise<PolarCustomerState>;
  createCheckoutUrl(input: CheckoutInput): Promise<string>;
  createPortalUrl(input: { userId: string; returnUrl: string }): Promise<string | null>; // null: 고객 없음(404)
}

export class PolarGatewayError extends Error {
  constructor(readonly operation: "get_state" | "checkout" | "portal", readonly code: string)
  // message: `polar:<operation>:<code>`. code는 HTTP 상태 숫자 문자열 또는 "network"·"unexpected_response"
}
```

### 5. 실제 구현 `src/services/polar/polar-gateway.ts` (`import 'server-only'`)
```ts
export function createPolarGateway(polar: PolarClient, proProductId: string): PolarGateway
```
- `PolarClient`는 `ReturnType<typeof createPolar>`에서 쓰는 세 메서드(`customers.getStateExternal`·`checkouts.create`·`customerSessions.create`)만 고른 타입이다. 테스트가 가짜 객체를 넘길 수 있게 한다.
- `getCustomerState`: 404면 `no_customer`. 응답의 `active_subscriptions` 중 **`product_id === proProductId`이고 `status === "active"`인 것만** Pro로 본다(ARCHITECTURE "결제 동기화"). 여러 개면 `current_period_end`가 가장 늦은 것. 없으면 `{ kind: "customer", pro: null }`.
- `createCheckoutUrl`: `products: [proProductId]`, `external_customer_id: userId`, `customer_ip_address`는 값이 있을 때만, `success_url`·`return_url`, `metadata: { source }`. 반환은 `checkout.url`.
- `createPortalUrl`: `external_customer_id: userId`, `return_url`. 404면 `null`, 아니면 `customer_portal_url`.
- 404 외의 실패(다른 HTTP 상태, 네트워크, 응답 형식)는 모두 `PolarGatewayError`로 바꿔 던진다. SDK 에러 객체·응답 본문·메시지를 밖으로 넘기지 않는다. 404 판별은 `errors.ResourceNotFound` 인스턴스 또는 SDK 에러의 `statusCode === 404`로 한다(설치된 SDK의 에러 클래스를 확인하라).

### 6. 진입점 `src/services/polar/index.ts` (`import 'server-only'`)
```ts
export function getPolarGateway(): PolarGateway
```
- `getMode() === "mock"`이면 `throw new Error("polar:mock_mode")`. 이유: mock에서 Polar를 부르지 않는다는 규칙을 코드로 막는다.
- live: `createPolar({ accessToken, environment: server, timeout: 10 })`(timeout 단위는 초) → `createPolarGateway(client, proProductId)`.

### 7. 웹훅 검증 `src/services/polar/webhook.ts` (`import 'server-only'`)
```ts
export type PolarWebhookResult =
  | { kind: "state_changed"; externalCustomerId: string | null }
  | { kind: "ignored" }             // 서명은 맞지만 customer.state_changed가 아니거나 이 API 버전에 없는 이벤트
  | { kind: "invalid_signature" }
  | { kind: "invalid_payload" };    // 서명은 맞지만 본문을 파싱하지 못함
export async function parsePolarWebhook(body: string, headers: Headers, secret: string): Promise<PolarWebhookResult>
```
- `webhooks.validateEvent(body, { "webhook-id", "webhook-timestamp", "webhook-signature" }, secret)`. 헤더가 없으면 빈 문자열을 넘긴다.
- `customer.state_changed`면 `event.data.external_id ?? null`. 페이로드의 구독 정보는 쓰지 않는다(동기화는 항상 Polar를 다시 조회한다, ADR-012).
- `PolarWebhookVerificationError` → `invalid_signature`, `PolarWebhookUnknownTypeError` → `ignored`, 그 밖의 `PolarWebhookError` → `invalid_payload`. 그 밖의 throw는 그대로 던진다.

### 8. 테스트 fake `src/services/polar/fake-gateway.ts`
```ts
export function createFakePolarGateway(initial?: Record<string, PolarCustomerState>): PolarGateway & {
  calls: { method: "getCustomerState" | "createCheckoutUrl" | "createPortalUrl"; input: unknown }[];
  setState(userId: string, state: PolarCustomerState): void;
  failNext(method: "getCustomerState" | "createCheckoutUrl" | "createPortalUrl"): void; // 다음 호출 1회 PolarGatewayError
}
```
- 네트워크 없이 메모리로만 동작한다. 상태가 없는 사용자는 `no_customer`. checkout URL은 `https://polar.test/checkout/<userId>`, 포털 URL은 `https://polar.test/portal/<userId>`(고객이 없으면 `null`).
- 다음 step의 `lib/billing` 테스트가 쓴다. 앱 코드(테스트가 아닌 파일)에서 import하지 않는다.

### 9. 테스트 (먼저 작성, 네트워크 없음)
- `env.test.ts`에 추가: Polar 변수 누락·빈 값·잘못된 `POLAR_ENV` → 변수 이름만 담은 에러, 메시지에 값 없음. `VERCEL_ENV=production` + `POLAR_ENV=sandbox` → throw. 웹훅 secret 누락 → throw.
- `polar-gateway.test.ts`(가짜 `PolarClient`):
  - 고객 상태: 404 → `no_customer`. Pro 상품 active → pro(세 필드 매핑). 다른 상품 active만 → `pro: null`. Pro 상품이지만 `status`가 `past_due`·`canceled`·`trialing` → `pro: null`. Pro 구독 2개 → 기간 끝이 늦은 것. 500·네트워크 에러 → `PolarGatewayError`(operation `get_state`)이고 메시지에 SDK 원문이 없다.
  - checkout: 넘긴 인자(`products`·`external_customer_id`·`success_url`·`return_url`·`metadata.source`), IP가 `null`이면 `customer_ip_address`를 보내지 않음, 반환 URL.
  - 포털: 반환 URL, 404 → `null`, 그 밖의 실패 → `PolarGatewayError`(`portal`).
- `index.test.ts`: mock 모드면 throw(`createPolar` 미호출), live면 env 값으로 `createPolar` 호출(`environment`·`timeout: 10`). `@polar-sh/sdk/2026-10`과 `@/lib/env`·`@/lib/mode`는 `vi.mock`.
- `webhook.test.ts`: 테스트 안에서 secret(`whsec_` + base64 키)으로 Standard Webhooks 서명을 직접 만든다(`v1,` + base64(HMAC-SHA256(키 바이트, `${id}.${timestamp}.${body}`)), timestamp는 현재 초). 설치된 SDK의 `validateEvent` 구현을 읽고 그 형식에 맞춰라.
  - 서명이 맞는 `customer.state_changed`(SDK 스키마를 통과하는 최소 페이로드) → `state_changed`와 `external_id`. `external_id`가 null → `externalCustomerId: null`.
  - 서명이 맞는 다른 이벤트(예: `order.created`가 스키마 통과가 어려우면 이 API 버전에 없는 type 문자열) → `ignored`.
  - 서명 한 글자 변경·secret 다름·헤더 누락 → `invalid_signature`.
- `fake-gateway.test.ts`: 기본 `no_customer`, `setState`, `failNext`가 1회만 실패, `calls` 기록.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(네트워크·.env 불필요)
test -f src/services/polar/index.ts && test -f src/services/polar/polar-gateway.ts && test -f src/services/polar/webhook.ts && test -f src/services/polar/fake-gateway.ts
grep -q '"@polar-sh/sdk"' package.json
! grep -q '@polar-sh/nextjs' package.json
! grep -rnE "from \"@polar-sh/sdk\"|@polar-sh/sdk/(2026-04|2027-01)" src
! grep -rnE "console\.|\.message|\.body" src/services/polar --include='*.ts' --exclude='*.test.ts'
! grep -rnE "fake-gateway" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' --exclude='fake-gateway.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `services/polar`의 앱 파일이 모두 `import 'server-only'`인가? (fake 제외)
   - mock 모드에서 Polar 클라이언트를 만들 수 없는가?
   - 에러·반환값에 SDK 원문 메시지·응답 본문·토큰이 없는가? (AGENTS.md CRITICAL: 로그·에러에는 코드와 id만)
   - 단위 테스트가 네트워크·`.env` 없이 도는가?
3. 결과에 따라 `phases/8-billing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `PolarGateway`·`PolarCustomerState`·`PolarWebhookResult`·`PolarGatewayError` 시그니처, `getPolarEnv`·`getPolarWebhookSecret`, `UpgradeSource` 위치, fake 경로와 동작, 설치한 SDK 버전을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Polar API(sandbox 포함)를 호출하는 테스트를 만들지 마라. 이유: 단위 테스트는 네트워크 없이 돌아야 한다(ADR-015).
- 웹훅 페이로드의 구독 상태로 플랜을 정하지 마라. 이유: 동기화는 항상 Polar 현재 상태를 다시 조회한다(ADR-012).
- `@polar-sh/nextjs`를 설치하거나 `Checkout`·`CustomerPortal`·`Webhooks` 헬퍼를 쓰지 마라. 이유: Origin 검사·세션 uid·IP 전달을 우리 Route Handler에서 직접 한다(AGENTS.md 스택).
- `lib/billing`·`lib/store`·Route Handler를 만들지 마라. 이유: 다음 step에서 만든다.
- `.env`를 고치거나 그 값을 출력하지 마라. 토큰을 테스트·fixture에 넣지 마라.
- `supabase` 명령과 `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
