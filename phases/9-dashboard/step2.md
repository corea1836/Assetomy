# Step 2: dashboard-data

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "데이터 모델"의 측정 기록 경로, "결제 동기화", "테스트")
- `/docs/PRD.md` ("가설 · 지표"의 첫 실결제 규칙)
- `/docs/ADR.md` (ADR-002, ADR-012, ADR-013, ADR-014, ADR-017, ADR-020)
- 기존 코드: `/src/lib/queries/transactions.ts`·`transactions.db.test.ts`(1001행 fixture 패턴), `/src/lib/queries/query-error.ts`(`readQuery`), `/src/lib/queries/merchant-categories.ts`(`.range()` 페이지네이션), `/src/lib/store/store-error.ts`(`callStoreRpc`), `/src/lib/store/subscriptions.ts`·`subscriptions.db.test.ts`(RPC 결과 zod 검증·`user_not_found`), `/src/lib/store/uploads.ts`, `/src/lib/supabase/db-test-helpers.ts`, `/src/lib/billing/deps.ts`·`sync.ts`와 테스트, `/src/lib/env.ts`(`getPolarEnv`), `/src/lib/mode.ts`, `/src/types/transaction.ts`
- 이전 step 산출물: `/supabase/migrations/20261015000000_dashboard.sql`(`user_metrics`, 트리거, `record_metric`, `set_merchant_category`), `/src/types/metrics.ts`, `/src/types/category.ts`(`MerchantCategoryRequest`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드가 읽고 쓰는 데이터 함수를 만든다.

- 읽기(`lib/queries`)는 세션 클라이언트를 인자로 받고 `user_id`를 명시해 거른다(RLS와 이중 방어). 목록은 `.range()`로 끝까지 페이지네이션한다. 이유: 1000행에서 에러 없이 잘려 집계가 조용히 틀린다(AGENTS.md).
- 쓰기(`lib/store`)는 service-role로 RPC만 부른다(`'server-only'`, ADR-002).
- 첫 실결제는 production에서 Pro 상품의 active 구독을 처음 확인한 시각이다. sandbox·mock은 제외한다(PRD). 결제 동기화(`syncFromPolar`)가 Pro를 확인할 때 남긴다.
- 이 step의 DB 통합 테스트는 step 0 마이그레이션이 dev DB에 적용돼 있어야 돈다. 적용은 사용자 쪽에서 한다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 거래 목록 `src/lib/queries/transactions.ts`
```ts
export async function listTransactions(
  supabase: SupabaseClient, userId: string, cardLabels: ReadonlyMap<string, string>,
): Promise<Transaction[]>
```
- `transactions`에서 `id, card_id, used_on, merchant, merchant_key, amount, category`를 `user_id`로 거르고 `used_on` 오름차순·`id` 오름차순으로 1000행씩 `.range()`로 끝까지 읽는다.
- 응답은 zod로 검증한다(`used_on`은 `YYYY-MM-DD` 문자열 그대로 둔다. Date로 파싱하지 않는다. `amount`는 안전한 정수, `category`는 `CATEGORY_IDS`). 실패는 `readQuery`처럼 `QueryError`.
- `cardLabel`은 `cardLabels.get(card_id)`. 없으면 `QueryError("listTransactions", "unknown_card")`. 이유: 카드 FK가 있으므로 없으면 잘못 읽은 것이다.
- 기존 `getTransactionCoverage`는 그대로 둔다(정리는 step 4).

### 2. 측정 저장 `src/lib/store/metrics.ts`
타입은 `src/types/metrics.ts`에 더한다:
```ts
export type StoreMetric = MetricRequest | { event: "first_paid" };
export type RecordMetricResult = { kind: "recorded" | "unchanged" | "user_not_found" };
```
```ts
export async function recordMetric(userId: string, metric: StoreMetric): Promise<RecordMetricResult>
```
- `record_metric` RPC(`p_source`는 `upgrade_click`일 때만 값, 나머지는 null). 결과는 zod로 검증한다.

### 3. 카테고리 수정 저장 `src/lib/store/merchant-categories.ts`
타입은 `src/types/category.ts`에 더한다:
```ts
export type SetMerchantCategoryResult = { kind: "updated"; updated: number } | { kind: "not_found" };
```
```ts
export async function setMerchantCategory(
  userId: string, merchantKey: string, category: CategoryId,
): Promise<SetMerchantCategoryResult>
```
- `set_merchant_category` RPC, 결과 zod 검증.

### 4. 첫 실결제 기록 (`src/lib/billing/deps.ts`·`sync.ts`)
- `BillingDeps`에 추가:
  ```ts
  isProductionBilling: () => boolean;   // live이고 POLAR_ENV가 production
  recordMetric: (userId: string, metric: StoreMetric) => Promise<RecordMetricResult>;
  ```
  `defaultBillingDeps()`는 `isProductionBilling`을 호출될 때 계산한다(`getMode() === "live" && getPolarEnv().server === "production"`). 이유: env는 lazy 검증이다(빌드·mock에서 Polar env를 읽지 않는다).
- `syncFromPolar`가 `synced`이고 저장 결과의 플랜이 `pro`이며 `deps.isProductionBilling()`이 true면 `deps.recordMetric(userId, { event: "first_paid" })`를 부른다.
  - 이 기록이 실패(throw)해도 동기화 결과는 그대로 돌려준다. 로그는 `console.error("billing:first_paid:<StoreError code 또는 unexpected_error>", userId)`만.
  - mock(`skipped`)·sandbox·Free·`failed`·`user_not_found`에서는 부르지 않는다.
- 이 변경으로 기존 테스트의 `BillingDeps` fake에 새 필드가 필요하면 함께 고친다.

### 5. 테스트 (먼저 작성)
- 단위(`*.test.ts`, `@/lib/supabase/admin`·`server` mock): `listTransactions`는 1000행 페이지 다음 페이지를 이어 읽고 짧은 페이지에서 멈춘다, `user_id` 필터·정렬·range 인자, 카드 라벨 매핑, 모르는 카드·잘못된 행이면 `QueryError`이고 메시지에 원문이 없다. `recordMetric`·`setMerchantCategory`는 RPC 이름·인자, kind별 결과, 잘못된 응답이면 `StoreError`. `syncFromPolar`는 위 4의 경우마다 `recordMetric` 호출 여부, 기록 실패 시 결과 유지와 로그 형식.
- DB 통합(`*.db.test.ts`, 테스트마다 `createTestUser`로 임시 사용자, 끝나면 `deleteTestUser`. 세션 대신 admin 클라이언트로 읽는다):
  - `listTransactions`: 사용자 A 1001건(기존 1001행 fixture 방식) + B 거래 → A만 1001건, 카드 라벨이 붙고 날짜 오름차순.
  - `recordMetric`: Free 사용자의 `teaser_seen` recorded → unchanged, `upgrade_click` source 저장, `first_paid` recorded, 없는 사용자 id → user_not_found. admin 클라이언트로 `user_metrics`를 읽어 값을 확인한다.
  - 트리거: `beginUpload`·`ingestUpload`(done) 뒤 `user_metrics.first_attempt_at`·`first_success_at`이 채워지고 `upload_attempts.extends_period`가 true. `deleteUpload` 뒤 그 시도의 `deleted_at`이 채워진다.
  - `setMerchantCategory`: 같은 가맹점 거래 2건 → updated 2, `findMerchantCategories`가 새 카테고리를 돌려준다. 다른 사용자 B의 같은 가맹점 거래는 그대로. 거래 없는 가맹점 → not_found.
  - 모든 테스트가 끝나면 `deleteTestUser`가 에러 없이 끝난다(트리거가 cascade 삭제를 막지 않는다).

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # 새 DB 통합 테스트 포함 전체 통과(dev DB에 step 0 마이그레이션 필요)
test -f src/lib/store/metrics.ts && test -f src/lib/store/merchant-categories.ts
grep -q "server-only" src/lib/store/metrics.ts && grep -q "server-only" src/lib/store/merchant-categories.ts
grep -q "\.range(" src/lib/queries/transactions.ts
! grep -rnE "\.message|\.details|\.hint" src/lib/store/metrics.ts src/lib/store/merchant-categories.ts src/lib/queries/transactions.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`가 `record_metric`·`set_merchant_category` 함수나 `user_metrics` 테이블이 없다는 이유(PostgREST `PGRST202`·`PGRST205`, Postgres `42P01`·`42883`)로 실패하면 코드를 고치지 말고 blocked로 멈춘다.
2. 아키텍처 체크리스트를 확인한다:
   - 쓰기가 service-role RPC로만 되고(`'server-only'`), 읽기가 세션 클라이언트 인자 + `user_id` 필터 + `.range()` 끝까지인가? (AGENTS.md CRITICAL)
   - 첫 실결제가 live + Polar production에서만 기록되고, 기록 실패가 동기화 결과를 바꾸지 않는가? (PRD)
   - 로그·에러에 Supabase `error.message`·`details`, 거래·가맹점명이 없는가?
3. 결과에 따라 `phases/9-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 세 함수의 시그니처와 결과 타입·위치, `BillingDeps` 새 필드, 첫 실결제 기록 조건, 새 DB 테스트 수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(마이그레이션 미적용 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단. 마이그레이션이 없으면 사유에 `supabase db push --linked 후 scripts/pgtap.sh supabase/tests/dashboard.test.sql 필요`를 적는다.

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `scripts/pgtap.sh`를 실행하지 마라. 이유: 공유 dev DB의 스키마 변경은 사용자 쪽에서 한다.
- 마이그레이션 파일을 고치지 마라. 이유: step 0 산출물이 이미 dev DB에 적용됐을 수 있다. 문제가 있으면 blocked로 사유를 적는다.
- `listTransactions`에서 날짜를 Date로 파싱하거나 금액을 다시 계산하지 마라. 이유: 날짜는 문자열로 다루고 집계는 순수 레이어가 한다(AGENTS.md).
- 클라이언트가 `first_paid`를 보낼 길을 만들지 마라. 이유: 첫 실결제는 서버 결제 동기화만 기록한다.
- 측정 기록 실패로 결제 동기화를 실패시키지 마라. 이유: 결제 상태 반영이 측정보다 중요하다.
- API 라우트·화면을 만들지 마라. 이유: step 3·4에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
