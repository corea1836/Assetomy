# assetomy

신용카드 이용내역 파일을 올리면 소비 현황과 확인이 필요한 지출 후보를 보여주는 핀테크 SaaS MVP.

- 기획 `docs/PRD.md` · 화면 흐름 `docs/USER_FLOW.md` · 설계 `docs/ARCHITECTURE.md`·`docs/ADR.md` · 화면 규칙 `docs/DESIGN.md`
- 개발 명령과 규칙은 `CLAUDE.md`

## 결제는 어떻게 안전한가

결제는 [Polar](https://polar.sh)가 처리하고, assetomy는 카드 정보를 받거나 저장하지 않는다. assetomy가 지키는 것은 "누가 Pro인가"이다. 이 판단이 위조되거나 틀리지 않도록 아래처럼 설계했다(ADR-012).

### 원칙: 정답은 Polar, DB는 사본

```
[결제하기] → POST /api/checkout → Polar 결제 화면 → /dashboard?checkout=success
                                        │
                                        └─ Polar → POST /api/webhooks/polar (customer.state_changed)

성공 페이지 · 웹훅 · 설정 화면 · 기간이 지난 Pro · 결제하기 클릭
   └─▶ syncFromPolar(uid): 조회 시작 시각 기록 → Polar에 현재 상태 조회 → DB(subscriptions)에 저장
화면·기능은 DB 값으로만 Pro/Free를 판단한다
```

- 플랜을 바꾸는 입력은 **Polar API가 직접 답한 현재 상태** 하나뿐이다. 요청 본문·쿼리·헤더·웹훅 페이로드의 값으로 플랜을 정하지 않는다.
- 웹훅은 "이 고객 상태가 바뀌었다"는 **신호로만** 쓴다. 페이로드에서는 `external_id`(우리 사용자 id)만 꺼내고, 상태는 Polar에 다시 묻는다.
- DB 값을 손으로 바꿔도 다음 동기화 때 Polar 값으로 돌아온다. DB 버그나 잘못된 쓰기로 Pro가 생기거나 사라지지 않는다.

### 위조를 막는 장치

| 위협 | 막는 방법 | 코드 |
|---|---|---|
| 남의 계정으로 결제를 연결하거나 남의 구독 포털 열기 | 사용자 id는 서명된 로그인 토큰(JWT, `getClaims`)에서만 꺼낸다. checkout 본문은 `source`만 받고, Polar에는 `external_customer_id = 세션 uid`로 보낸다 | `src/app/api/checkout/route.ts`, `src/services/polar/polar-gateway.ts` |
| 다른 사이트가 내 브라우저로 결제 요청 보내기(CSRF) | 세션을 쓰는 POST는 Origin이 정확히 같아야 하고 `application/json`만 받는다 | `src/lib/http.ts` |
| 가짜 웹훅으로 Pro 만들기 | Standard Webhooks 서명(`webhook-id`·`webhook-timestamp`·원문 본문의 HMAC-SHA256)을 원문 그대로 검증한다. 틀리면 403 | `src/services/polar/webhook.ts`, `src/app/api/webhooks/polar/route.ts` |
| 옛날 웹훅 재전송 | 서명에 timestamp가 들어가고, 5분이 지난 요청은 거절한다(SDK) | 〃 |
| 서명 키가 새도 거짓 상태 심기 | 페이로드의 구독 상태를 쓰지 않고 Polar를 다시 조회한다 | `src/lib/billing/sync.ts` |
| 공개 키로 구독 행을 직접 수정 | RLS로 본인 행 select만 허용하고, 사용자에게 insert·update·delete 권한이 없다 | `supabase/migrations/20261014000000_subscriptions.sql` |
| 공개 키로 저장 함수(RPC)를 직접 호출 | Postgres는 함수 실행 권한을 기본으로 모두에게 주므로, `save_subscription`에서 public·anon·authenticated를 revoke하고 service_role에만 준다 | 〃, `supabase/tests/subscriptions.test.sql`(pgTAP 단언) |
| 다른 상품·미결제 구독을 Pro로 인정 | Pro 상품이고 `status === "active"`인 구독만 Pro다(`past_due`·`trialing`·`canceled`는 Free) | `src/services/polar/polar-gateway.ts` |

### 정합성을 지키는 장치

| 상황 | 동작 | 코드 |
|---|---|---|
| 같은 웹훅이 여러 번 옴 | 매번 현재 상태를 다시 조회해 저장하므로 결과가 같다. 그래서 처리한 event_id를 저장하지 않는다 | `src/lib/billing/sync.ts` |
| 웹훅·조회의 순서가 뒤바뀜 | 조회를 **시작한** 시각(`synced_from`)이 저장된 값보다 늦을 때만 저장한다. 늦게 시작한 조회가 더 최신 상태를 봤기 때문이다. 저장은 사용자별 잠금 아래에서 한다 | `save_subscription` RPC |
| 처리 중 DB·Polar 장애 | 저장하지 않고 503을 돌려준다. Polar가 웹훅을 다시 보내면 처음부터 다시 조회한다(중간 상태 없음) | `src/app/api/webhooks/polar/route.ts` |
| Polar 조회 실패 | 기존 상태를 유지한다(Free로 덮지 않음). Polar에 고객이 없다는 404만 Free로 확정한다 | `src/lib/billing/sync.ts` |
| 결제 직후 웹훅보다 먼저 돌아옴 | 성공 페이지가 Polar를 바로 조회한다. 아직 처리 중이면 "결제 반영 중"을 보여주고, 웹훅이 오면 반영된다 | `src/app/dashboard/page.tsx` |
| 웹훅 반영 전에 결제하기를 또 누름 | checkout을 만들기 전에 Polar 현재 상태로 동기화한다. 이미 active Pro면 두 번째 결제 대신 포털을 연다 | `src/lib/billing/checkout.ts` |
| 해지 예약·기간 만료 | 해지 예약은 기간 끝까지 Pro다. 저장된 Pro의 기간 끝이 지나면 화면을 그릴 때 다시 조회해 갱신·만료를 반영한다 | `src/lib/billing/plan.ts` |
| 탈퇴 뒤 도착한 웹훅 | 사용자가 없으면 저장하지 않고 200으로 무시한다 | `save_subscription` RPC |

### 환경 분리

- `getMode()`는 Vercel production이면 항상 live다. mock(결제 = 바로 Pro, Polar 미호출)은 로컬·Preview에서만 돈다(ADR-014). mock에서는 웹훅이 404다.
- production에서 `POLAR_ENV`가 `production`이 아니면 Polar 클라이언트를 만들지 않는다. 운영이 sandbox로 결제받아 테스트 카드로 Pro가 열리는 일을 막는다(`src/lib/env.ts`).
- Polar 토큰은 필요한 권한만 쓴다: `checkouts:write`, `customer_sessions:write`, `customers:read`. 구독을 바꾸거나 상품을 읽는 권한은 없다.
- 로그에는 코드와 사용자 id만 남긴다(예: `billing:webhook:failed <uid>`). 본문·서명·Polar 에러 원문을 남기지 않는다.

### 알려진 한계

- 웹훅이 오래 실패하고 사용자가 성공 페이지 전에 탭을 닫으면, 설정 화면을 열거나 Polar가 재전송할 때까지 Free로 보인다(결제 기록은 Polar에 있다).
- Polar 장애 중 기간이 끝난 Pro는 조회가 성공할 때까지 Pro로 유지된다. 갱신한 사용자를 Free로 떨어뜨리지 않는 쪽을 택했다.
- 기간 중간의 환불·강제 해지는 웹훅이 오지 않으면 다음 기간 끝까지 Pro로 남는다.
- 웹훅마다 Polar API를 한 번 호출한다. 결제 완료 메일처럼 이벤트마다 한 번만 해야 하는 일을 추가하면, 그때 event_id 기록을 상태 저장과 같은 트랜잭션으로 넣어야 한다.

### 운영 설정

- Polar 웹훅 엔드포인트 `https://<도메인>/api/webhooks/polar`, 이벤트는 `customer.state_changed`만 선택하고 secret을 `POLAR_WEBHOOK_SECRET`에 넣는다.
- 로컬에서 웹훅을 받을 때: `polar listen http://localhost:3000/api/webhooks/polar`(출력된 secret을 `.env`에).
