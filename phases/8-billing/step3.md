# Step 3: billing-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "결제 동기화", "API"의 상태 코드, "보안")
- `/docs/USER_FLOW.md` (③ Pro 전환)
- `/docs/ADR.md` (ADR-012, ADR-014, ADR-016, ADR-018)
- 기존 코드: `/src/app/api/cards/route.ts`·`/src/app/api/uploads/[id]/route.ts`와 테스트(Route Handler 순서·테스트 패턴), `/src/lib/http.ts`(`apiError`·`checkMutationRequest`), `/src/lib/auth.ts`(`getSessionUser`), `/src/lib/supabase/server.ts`, `/src/types/upload.ts`(`ApiErrorCode`)
- 이전 step 산출물: `/src/lib/billing/*.ts`, `/src/lib/queries/subscriptions.ts`, `/src/services/polar/webhook.ts`(`parsePolarWebhook`), `/src/lib/env.ts`(`getPolarWebhookSecret`), `/src/types/billing.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

결제 API 3개를 만든다. Route Handler는 `세션 → Origin·입력 검증 → lib 호출 → HTTP 매핑`만 한다(ARCHITECTURE "레이어 규칙").

| 경로 | 역할 |
|---|---|
| `POST /api/checkout` | JSON `{ source }` → 이미 Pro면 포털 URL, 아니면 Polar checkout URL(mock은 바로 Pro 저장 후 성공 URL) |
| `POST /api/portal` | 고객 포털 URL(mock은 바로 Free 저장 후 `/settings`) |
| `POST /api/webhooks/polar` | 서명 검증 → `customer.state_changed`면 `syncFromPolar(external_id)` |

- 사용자 ID는 세션(`getSessionUser()`)에서만 가져온다. 본문의 user_id를 쓰지 않는다. API는 리다이렉트하지 않고 JSON을 돌려준다. 브라우저가 받은 URL로 이동한다.
- 웹훅은 세션·Origin 대신 서명으로 인증한다(AGENTS.md CRITICAL).
- 에러 본문은 `{ error: { code, reason? } }`이고 원문 메시지를 노출하지 않는다. 로그는 코드와 id만 남긴다.
- Polar는 고객 위치로 통화를 고르므로 서버에서 만든 checkout에는 요청자 IP를 넘긴다(ADR-018). Vercel은 `x-forwarded-for`의 첫 값에 실제 요청자 IP를 넣는다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 요청자 IP `src/lib/http.ts`에 추가
```ts
export function clientIp(headers: Headers): string | null
```
- `x-forwarded-for`의 첫 값(쉼표 앞, 공백 제거). 없으면 `x-real-ip`. `node:net`의 `isIP`로 IP가 아니면 `null`.
- loopback(`127.0.0.0/8`, `::1`), 사설(`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local(`169.254/16`, `fe80::/10`), IPv4-mapped IPv6의 같은 대역이면 `null`. 이유: 로컬 개발에서 Polar에 의미 없는 IP를 넘기지 않는다. `node:net`의 `BlockList`를 쓴다.

### 2. 응답 타입 (`src/types/billing.ts`에 추가)
```ts
export type BillingUrlResponse = { url: string };
```

### 3. `POST /api/checkout` (`src/app/api/checkout/route.ts`)
- 순서: 세션 없음 401 `UNAUTHORIZED` → `checkMutationRequest(request, "application/json")`(403·400) → 본문 JSON `{ source }`(zod `z.enum(UPGRADE_SOURCES)`, 다른 키 무시). 파싱 실패·허용되지 않은 source → 400 `BAD_REQUEST`.
- `getSubscription(await createSupabaseServerClient(), user.id)` → `startCheckout({ userId: user.id, source, customerIp: clientIp(request.headers), stored }, defaultBillingDeps())` → 200 `{ url }`.
- 읽기·`startCheckout`이 throw → 503 `TEMPORARY_FAILURE`, `console.error("billing:checkout:<에러 클래스 이름>", user.id)`.

### 4. `POST /api/portal` (`src/app/api/portal/route.ts`)
- 세션 없음 401 → `checkMutationRequest(request, "application/json")` → 본문은 읽지 않는다(`{}`를 보내도 되고 무시한다).
- `openPortal(user.id, defaultBillingDeps())` → URL이면 200 `{ url }`, `null`이면 404 `NOT_FOUND`(Polar 고객 없음). throw → 503 `TEMPORARY_FAILURE`(로그는 위와 같은 형식, `billing:portal:…`).

### 5. `POST /api/webhooks/polar` (`src/app/api/webhooks/polar/route.ts`)
- `getMode() === "mock"`이면 본문을 읽지 않고 404 `NOT_FOUND`(ARCHITECTURE "결제 동기화": mock 웹훅은 404).
- 세션·Origin·Content-Type을 보지 않는다. 본문은 `await request.text()`로 원문 그대로 읽는다(서명은 원문 바이트로 검증한다. JSON으로 먼저 파싱하지 않는다).
- `getPolarWebhookSecret()`가 throw하면 500 `{ error: { code: "TEMPORARY_FAILURE" } }`와 `console.error("billing:webhook:secret_missing")`.
- `parsePolarWebhook(body, request.headers, secret)`:

  | 결과 | 응답 |
  |---|---|
  | `invalid_signature` | 403 `FORBIDDEN` |
  | `invalid_payload` | 400 `BAD_REQUEST` |
  | `ignored` | 200 `{ received: true }` |
  | `state_changed`, `externalCustomerId`가 null이거나 UUID가 아님 | 200 `{ received: true }`(동기화하지 않음) |
  | `state_changed` → `syncFromPolar(externalCustomerId, defaultBillingDeps())`가 `synced`·`user_not_found` | 200 `{ received: true }`(탈퇴 뒤 도착한 웹훅은 무시, ADR-016) |
  | `syncFromPolar`가 `failed` | 503 `TEMPORARY_FAILURE`(Polar가 다시 보낸다) |
  | `parsePolarWebhook` throw | 500 `TEMPORARY_FAILURE` |

- 로그는 403·400·500·503에서만 `console.error("billing:webhook:<결과>", 사용자 id 또는 "-")`. 본문·헤더·서명을 남기지 않는다.

### 6. 테스트 (먼저 작성, 네트워크 없음)
- `http.test.ts`에 `clientIp`: `203.0.113.5, 10.0.0.1` → `203.0.113.5`. `x-real-ip`만 있으면 그 값. `::1`·`127.0.0.1`·`10.1.2.3`·`192.168.0.1`·`172.20.0.1`·`::ffff:127.0.0.1`·`fe80::1` → null. `not-an-ip` → null. 헤더 없음 → null. 공인 IPv6(`2001:db8::1`은 문서용이라 BlockList에 넣지 않는다) → 그대로.
- Route Handler 테스트(`route.test.ts`, `@/lib/auth`·`@/lib/billing/*`·`@/lib/queries/subscriptions`·`@/lib/supabase/server`·`@/services/polar/webhook`·`@/lib/env`·`@/lib/mode`를 `vi.mock`):
  - checkout: 세션 없음 401(lib 미호출), Origin 다름 403, `text/plain` 400, JSON 깨짐 400, `source: "banner"` 400, 정상 → 200 `{ url }`이고 `startCheckout`에 세션 user id·source·`clientIp` 결과·저장된 구독이 넘어감(본문의 `userId`는 무시). throw → 503이고 응답·로그에 에러 메시지가 없음.
  - portal: 401·403·400(Content-Type), URL → 200, null → 404, throw → 503.
  - webhook: mock 모드 → 404이고 `request.text`·`parsePolarWebhook` 미호출. 위 표의 모든 행. secret 없음 → 500. 세션 함수(`getSessionUser`)를 부르지 않음. 로그 인자에 본문·서명이 없음.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # 기존 DB 통합 테스트 회귀 없음
test -f src/app/api/checkout/route.ts && test -f src/app/api/portal/route.ts && test -f src/app/api/webhooks/polar/route.ts
! grep -rnE "\.message|\.details|\.hint|user_id" src/app/api/checkout src/app/api/portal src/app/api/webhooks --include='route.ts'
! grep -nE "getSessionUser|checkMutationRequest" src/app/api/webhooks/polar/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - checkout·portal이 세션 uid만 쓰고, Origin 정확 일치와 `application/json`을 검사하는가? (AGENTS.md CRITICAL)
   - 웹훅이 서명으로만 인증하고, 원문 본문으로 검증하며, 페이로드 값으로 플랜을 정하지 않는가? (ADR-012)
   - mock 모드에서 웹훅이 404이고 Polar를 부르지 않는가?
   - 에러 응답·로그에 원문 메시지·본문·서명이 없는가?
3. 결과에 따라 `phases/8-billing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 세 경로의 요청·응답 형식과 상태 코드 매핑, `clientIp` 위치·규칙, `BillingUrlResponse` 위치를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 요청 본문의 user_id·plan·customer id를 쓰지 마라. 이유: AGENTS.md CRITICAL(사용자 ID는 세션에서만), 플랜은 Polar 조회로만 정한다(ADR-012).
- `requireUser()`를 API에서 쓰지 마라. 이유: API에 로그인 페이지 리다이렉트(HTML)를 돌려주면 클라이언트가 실패를 해석할 수 없다. `getSessionUser()`로 401을 돌려준다.
- checkout·portal에서 303 리다이렉트로 Polar에 보내지 마라. 이유: JSON 요청(`application/json`)만 받으므로 폼 POST가 아니다. 브라우저가 `{ url }`을 받아 이동한다.
- 웹훅 본문을 `request.json()`으로 먼저 읽지 마라. 이유: 서명은 원문으로 검증해야 한다.
- `POST /api/metrics`·`user_metrics` 기록을 만들지 마라. 이유: 9-dashboard에서 만든다.
- 화면·컴포넌트를 만들지 마라. 이유: 다음 step에서 만든다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `supabase` 명령과 `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
