# Step 3: dashboard-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "데이터 모델"의 측정 기록 경로, "API"와 상태 코드, "보안")
- `/docs/PRD.md` ("가설 · 지표" 아래 `user_metrics` 규칙, "카테고리")
- `/docs/ADR.md` (ADR-013, ADR-017)
- 기존 코드: `/src/app/api/checkout/route.ts`·`route.test.ts`(JSON API 순서와 테스트 패턴), `/src/app/api/uploads/[id]/route.ts`(DELETE와 404 매핑), `/src/lib/http.ts`(`apiError`·`checkMutationRequest`), `/src/lib/auth.ts`(`getSessionUser`), `/src/types/upload.ts`(`ApiErrorCode`), `/src/types/billing.ts`(`UPGRADE_SOURCES`), `/src/types/category.ts`(`CATEGORY_IDS`)
- 이전 step 산출물: `/src/lib/store/metrics.ts`(`recordMetric`), `/src/lib/store/merchant-categories.ts`(`setMerchantCategory`), `/src/types/metrics.ts`(`MetricRequest`), `/src/types/category.ts`(`MerchantCategoryRequest`·`MerchantCategoryResponse`), `/src/components/send-metric.ts`·`/src/components/dashboard/merchant-category-select.tsx`(이 API를 부르는 쪽의 요청 형식)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드가 부르는 쓰기 API 2개를 만든다. Route Handler는 `세션 → Origin·입력 검증 → lib 호출 → HTTP 매핑`만 한다(ARCHITECTURE "레이어 규칙").

| 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/metrics` | JSON `MetricRequest`(`{ event: "teaser_seen" }` 또는 `{ event: "upgrade_click", source }`) | 204 본문 없음 |
| `PUT /api/merchant-categories` | JSON `MerchantCategoryRequest`(`{ merchantKey, category }`) | 200 `MerchantCategoryResponse`(`{ updated }`) |

- 사용자 ID는 세션(`getSessionUser()`)에서만 가져온다. 본문의 user_id를 쓰지 않는다. API에서는 `requireUser()`를 쓰지 않고 401을 돌려준다.
- 세션을 쓰는 POST/PUT은 Origin 정확 일치와 `application/json`만 받는다(AGENTS.md CRITICAL).
- 에러 본문은 `{ error: { code, reason? } }`이고 원문 메시지를 노출하지 않는다. 로그는 코드와 id만 남긴다(가맹점명·merchantKey를 로그에 남기지 않는다).

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. `POST /api/metrics` (`src/app/api/metrics/route.ts`)
- 순서: 세션 없음 401 `UNAUTHORIZED` → `checkMutationRequest(request, "application/json")`(403·400) → 본문 JSON을 zod 판별 유니온으로 검증: `{ event: "teaser_seen" }` | `{ event: "upgrade_click", source: z.enum(UPGRADE_SOURCES) }`. 다른 키는 무시한다. 파싱 실패·알 수 없는 event(`first_paid` 포함)·허용되지 않은 source → 400 `BAD_REQUEST`.
- `recordMetric(user.id, metric)` → `recorded`·`unchanged` → 204(본문 없음). `user_not_found` → 401 `UNAUTHORIZED`.
- throw → 503 `TEMPORARY_FAILURE`, `console.error("metrics:<에러 클래스 이름>", user.id)`.

### 2. `PUT /api/merchant-categories` (`src/app/api/merchant-categories/route.ts`)
- 순서: 세션 없음 401 → `checkMutationRequest(request, "application/json")` → 본문 `{ merchantKey: string(1~200자), category: z.enum(CATEGORY_IDS) }`, 다른 키 무시. 실패 → 400 `BAD_REQUEST`.
- `setMerchantCategory(user.id, merchantKey, category)` → `updated` → 200 `{ updated }`. `not_found` → 404 `NOT_FOUND`.
- throw → 503 `TEMPORARY_FAILURE`, `console.error("merchant_categories:<에러 클래스 이름>", user.id)`.
- 다른 메서드(GET 등)는 만들지 않는다.

### 3. 테스트 (먼저 작성, `@/lib/auth`·`@/lib/store/*`를 `vi.mock`, 네트워크 없음)
- 두 경로 공통: 세션 없음 401(store 미호출), Origin 다름 403, `text/plain` 400, JSON 깨짐 400, 본문의 `userId`·`user_id`를 무시하고 세션 id로 호출, throw → 503이고 응답 본문·로그 인자에 에러 메시지·merchantKey가 없다.
- metrics: `teaser_seen` → 204·빈 본문, `upgrade_click` + `teaser` → 204이고 source 전달, `upgrade_click` source 없음·`banner` → 400, `first_paid` → 400(store 미호출), `user_not_found` → 401.
- merchant-categories: 정상 → 200 `{ updated: 2 }`, 빈 merchantKey·201자·모르는 category → 400, `not_found` → 404.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(Supabase·네트워크 불필요)
npm run test:db   # 기존 DB 통합 테스트 회귀 없음
test -f src/app/api/metrics/route.ts && test -f src/app/api/merchant-categories/route.ts
grep -q "checkMutationRequest" src/app/api/metrics/route.ts && grep -q "checkMutationRequest" src/app/api/merchant-categories/route.ts
! grep -rnE "\.message|\.details|\.hint|user_id|requireUser|first_paid" src/app/api/metrics/route.ts src/app/api/merchant-categories/route.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 두 API가 세션 uid만 쓰고, Origin 정확 일치와 `application/json`을 검사하는가? (AGENTS.md CRITICAL)
   - 클라이언트가 `first_paid`를 기록할 수 없는가? (PRD: 첫 실결제는 production 결제 확인만)
   - 에러 응답·로그에 원문 메시지·가맹점 정보가 없는가?
3. 결과에 따라 `phases/9-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 두 경로의 요청·응답 형식과 상태 코드 매핑을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 요청 본문의 user_id를 쓰지 마라. 이유: AGENTS.md CRITICAL(사용자 ID는 세션에서만).
- `requireUser()`를 API에서 쓰지 마라. 이유: API에 로그인 페이지 리다이렉트를 돌려주면 클라이언트가 실패를 해석할 수 없다.
- metrics API에 `first_paid`를 허용하지 마라. 이유: 첫 실결제는 서버의 production 결제 동기화만 기록한다.
- 화면·컴포넌트와 `src/app/dashboard/page.tsx`를 고치지 마라. 이유: 다음 step에서 조립한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `supabase` 명령과 `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
