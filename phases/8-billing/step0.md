# Step 0: subscription-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "결제 동기화", "삭제와 정리")
- `/docs/ADR.md` (ADR-002, ADR-012, ADR-016, ADR-020)
- 기존 마이그레이션: `/supabase/migrations/20261013000000_upload_schema.sql`(테이블·RLS·권한 패턴), `/supabase/migrations/20261013000100_upload_rpc.sql`(`private.lock_user`, RPC 작성 패턴: `security invoker`, `set search_path = ''`, `pg_catalog.` 접두사, jsonb 결과, service_role 전용 EXECUTE)
- 기존 pgTAP: `/supabase/tests/upload_schema.test.sql`, `/supabase/tests/upload_rpc.test.sql`(결과를 `_tap`에 모아 마지막 SELECT로 반환, `begin … rollback`)
- `/scripts/pgtap.sh`(실행 방식 설명만 읽는다. 실행하지 않는다)

기존 마이그레이션의 작성 방식을 꼼꼼히 읽고 같은 방식으로 작성하라.

## 배경

결제 상태를 저장할 `subscriptions` 테이블과 저장 RPC를 만든다. 쓰기 흐름은 ADR-012다: 동기화는 조회를 시작한 시각(`synced_from`)을 들고 Polar 현재 상태를 조회하고, 저장된 행보다 늦게 시작한 조회일 때만 저장한다. 그래서 먼저 시작한 조회가 늦게 도착해도 최신 상태를 덮지 않는다. lease·세대 번호는 쓰지 않는다(ADR "의도적으로 뺀 것").

사용자는 RLS로 본인 행만 select하고, 쓰기는 service_role 전용 RPC로만 한다(ADR-002). dev DB는 공유이므로 pgTAP은 트랜잭션 안에서 돌고 롤백한다(ADR-020).

## 작업

### 1. 마이그레이션 `supabase/migrations/20261014000000_subscriptions.sql`

테이블:
```sql
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null,                       -- 'free' | 'pro'
  polar_subscription_id text,               -- Polar 구독 id(live Pro만)
  current_period_end timestamptz,           -- 현재 결제 기간 끝(live Pro만)
  cancel_at_period_end boolean not null default false,
  synced_from timestamptz not null,         -- 이 행을 만든 조회의 시작 시각
  updated_at timestamptz not null default now()
);
```
- 제약: `plan in ('free','pro')`. `plan = 'free'`면 `polar_subscription_id is null and current_period_end is null and not cancel_at_period_end`. `polar_subscription_id`는 1~100자. mock의 Pro는 구독 id·기간 끝이 모두 null일 수 있으므로 Pro에는 not null을 강제하지 않는다.
- RLS를 켜고 정책은 select 하나만: `subscriptions_select_own ... for select to authenticated using (user_id = (select auth.uid()))`.
- 권한: anon·authenticated에서 모두 revoke → authenticated에 select만 → service_role에 select·insert·update·delete. 기존 마이그레이션과 같은 순서로 쓴다.

RPC:
```sql
public.save_subscription(
  p_user_id uuid,
  p_synced_from timestamptz,
  p_plan text,
  p_subscription_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
) returns jsonb
```
- `private.lock_user(p_user_id)`로 사용자 잠금을 잡는다. 이유: 이후 phase의 탈퇴가 같은 잠금 아래에서 구독 상태를 확인한다(ARCHITECTURE "삭제와 정리").
- 행이 없으면 insert, 있으면 **저장된 `synced_from`이 `p_synced_from`보다 이전일 때만** update한다(같은 시각은 덮지 않는다). update할 때 `updated_at = now()`.
- 결과(jsonb):
  - 저장했으면 `{"kind":"saved", "plan", "current_period_end", "cancel_at_period_end"}`
  - 더 늦게 시작한 조회가 이미 저장돼 있으면 `{"kind":"stale", ...저장돼 있는 행의 같은 세 필드}`
  - `p_user_id`의 auth 사용자가 없으면(FK 위반 `23503`) `{"kind":"user_not_found"}`. 이유: 탈퇴 뒤 도착한 웹훅은 200으로 무시한다(ADR-016).
- 입력이 테이블 제약을 어기면(예: free인데 구독 id가 있음) 그대로 에러를 낸다(잡지 않는다). 서버 코드가 잘못된 것이므로 숨기지 않는다.
- `p_synced_from`·`p_plan`·`p_cancel_at_period_end`가 null이면 에러를 낸다(제약·not null 위반으로 충분하다).
- `security invoker`, `set search_path = ''`. `revoke execute ... from public, anon, authenticated` + `grant execute ... to service_role`.

### 2. pgTAP `supabase/tests/subscriptions.test.sql`

기존 테스트 파일과 같은 틀(`begin` → pgtap 확장 → `_tap` 임시 테이블 → `plan(n)` → 단언 → `finish()` → `select string_agg(line, E'\n' order by n) as tap from _tap;` → `rollback;`)로 쓴다. 테스트 사용자는 트랜잭션 안에서 `auth.users`에 직접 insert한다(기존 파일의 방식을 따른다).

단언(최소):
- 테이블·RLS 켜짐·select 정책만 있음(insert·update·delete·all 정책 없음).
- 권한: authenticated는 select만 있고 insert·update·delete가 없다. anon은 아무 권한이 없다.
- `save_subscription` EXECUTE 권한: anon·authenticated 없음, service_role 있음.
- RLS: 사용자 A로 `set local role authenticated` + `request.jwt.claims`의 `sub`를 A로 두면 A의 행만 보이고 B의 행은 0행이다.
- RPC 동작(service_role로 호출):
  - 행이 없을 때 → `saved`, 저장된 plan·기간 끝·해지 예약이 입력과 같다.
  - 더 늦은 `synced_from`으로 pro → free → `saved`이고 행이 free가 된다.
  - 더 이른 `synced_from`으로 pro를 보내면 → `stale`이고 결과에 저장돼 있는 free 행이 담기며 행은 그대로다.
  - 같은 `synced_from`으로 다시 보내면 → `stale`.
  - 없는 사용자 id → `user_not_found`, 행이 생기지 않는다.
  - free인데 `p_subscription_id`가 있으면 에러(`throws_ok`).
  - Pro + 구독 id·기간 끝·해지 예약 true 저장 → 결과의 세 필드가 입력과 같다.
- 사용자 삭제 시 cascade로 구독 행이 지워진다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261014000000_subscriptions.sql
test -f supabase/tests/subscriptions.test.sql
grep -qiE 'enable row level security' supabase/migrations/20261014000000_subscriptions.sql
! grep -niE 'for (insert|update|delete|all)' supabase/migrations/20261014000000_subscriptions.sql
grep -q 'private.lock_user' supabase/migrations/20261014000000_subscriptions.sql
grep -q 'string_agg(line' supabase/tests/subscriptions.test.sql
test "$(tail -n 3 supabase/tests/subscriptions.test.sql | grep -ciE '^rollback;')" -eq 1
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 사용자에게 쓰기 권한·쓰기 정책이 하나도 없는가? (AGENTS.md CRITICAL)
   - RPC가 `security invoker`·`search_path = ''`·service_role 전용 EXECUTE인가?
   - 조건부 저장이 "저장된 synced_from < 입력 synced_from"일 때만 update하는가? (ADR-012)
3. 결과에 따라 `phases/8-billing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션·pgTAP 파일 경로, 테이블 컬럼과 제약, RPC 시그니처와 결과 kind별 jsonb 필드, 단언 개수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `supabase test db`, `scripts/pgtap.sh`를 실행하지 마라. 이유: dev DB 마이그레이션과 pgTAP 실행은 이 step이 끝난 뒤 사용자 쪽에서 한다(ARCHITECTURE "모드 · 환경").
- 기존 마이그레이션 파일(`20261013*.sql`)을 고치지 마라. 이유: 이미 dev DB에 적용됐다.
- 사용자(authenticated)에게 insert·update·delete 권한이나 쓰기 정책을 주지 마라. 이유: AGENTS.md CRITICAL(쓰기는 서버 저장소 함수로만).
- `user_metrics`·`ai_summaries` 테이블을 만들지 마라. 이유: 9-dashboard에서 만든다.
- RPC에서 `auth.uid()`를 쓰지 마라. 이유: 서버가 세션에서 꺼낸 user_id를 넘긴다(ARCHITECTURE "데이터 모델").
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
