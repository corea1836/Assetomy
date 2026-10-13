# Step 0: summary-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "월 요약", "삭제와 정리")
- `/docs/ADR.md` (ADR-001, ADR-002, ADR-005, ADR-009, ADR-020)
- 기존 마이그레이션: `/supabase/migrations/20261013000000_upload_schema.sql`(테이블·RLS·정책·권한 패턴, `transactions`의 `used_on date`·`upload_id`), `/supabase/migrations/20261013000100_upload_rpc.sql`(`private.lock_user`, `delete_upload` 원본), `/supabase/migrations/20261015000000_dashboard.sql`(`set_merchant_category`의 jsonb 결과·`22023` 처리 방식)
- 기존 pgTAP: `/supabase/tests/upload_schema.test.sql`(`request.jwt.claims`로 authenticated RLS 확인), `/supabase/tests/upload_rpc.test.sql`, `/supabase/tests/dashboard.test.sql`(`_tap`·`_rpc` 임시 테이블, auth.users 임시 사용자, `create_card`→`begin_upload`→`ingest_upload` fixture, `set local role service_role`, 마지막 SELECT와 `rollback`)
- `/scripts/pgtap.sh`(실행 방식 설명만 읽는다. 실행하지 않는다)

기존 마이그레이션과 pgTAP의 작성 방식을 꼼꼼히 읽고 같은 방식으로 작성하라.

## 배경

AI 월간 요약을 (사용자, 월)마다 하나씩 저장한다(ARCHITECTURE "월 요약", ADR-005).

- 서버는 대시보드를 그릴 때 그 달 입력의 해시를 계산하고, 저장된 요약의 `input_hash`가 같으면 다시 만들지 않는다. 다르면 새로 만들어 덮어쓴다.
- 사용자는 RLS로 본인 요약만 select한다. 쓰기는 service_role 전용 RPC로만 한다(ADR-002). Pro 전용 RLS는 두지 않는다(ADR "의도적으로 뺀 것").
- 업로드 삭제·전체 삭제 뒤 늦게 도착한 요약 저장은 "그 달 거래가 없어서" 거절돼야 한다(ARCHITECTURE "삭제와 정리").
- 업로드를 삭제하면 그 업로드 거래가 있던 달의 요약도 같은 트랜잭션에서 지운다. 이유: 지운 거래의 가맹점명이 요약 문장에 남지 않게 한다.
- dev DB는 공유이므로 pgTAP은 트랜잭션 안에서 돌고 롤백한다(ADR-020).

## 작업

### 1. 마이그레이션 `supabase/migrations/20261016000000_ai_summaries.sql`

#### 1-1. 테이블 `public.ai_summaries`

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `user_id` | `uuid not null` | `references auth.users(id) on delete cascade` |
| `month` | `text not null` | `month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'` |
| `plan` | `text not null` | `plan in ('free', 'pro')` |
| `model` | `text not null` | `char_length(model) between 1 and 100` |
| `input_hash` | `text not null` | `input_hash ~ '^[0-9a-f]{64}$'` |
| `summary` | `text not null` | `char_length(summary) between 1 and 1000` |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | |

- 기본 키 `ai_summaries_pkey primary key (user_id, month)`. 제약 이름은 기존 파일처럼 `ai_summaries_<컬럼>_check`로 붙인다.
- `alter table public.ai_summaries enable row level security;`
- 정책 하나: `create policy ai_summaries_select_own on public.ai_summaries for select to authenticated using (user_id = (select auth.uid()));`
- 권한: `revoke all on table public.ai_summaries from anon, authenticated;` → `grant select ... to authenticated;` → `grant select, insert, update, delete ... to service_role;`

#### 1-2. RPC `public.save_ai_summary`

```sql
create function public.save_ai_summary(
  p_user_id uuid, p_month text, p_plan text, p_model text, p_input_hash text, p_summary text
) returns jsonb
language plpgsql security invoker set search_path = ''
```
순서:
1. `perform private.lock_user(p_user_id);` (ARCHITECTURE: 요약 저장은 사용자 단위 쓰기)
2. `p_month`가 null이거나 `'^[0-9]{4}-(0[1-9]|1[0-2])$'`와 맞지 않으면 `raise exception ... using errcode = '22023'`. 나머지 값은 테이블 check 제약(`23514`)에 맡긴다.
3. 그 달 범위는 `v_start := (p_month || '-01')::date`, `v_end := (v_start + interval '1 month')::date`. `public.transactions`에 `user_id = p_user_id and used_on >= v_start and used_on < v_end`인 행이 없으면 저장하지 않고 `{"kind": "no_transactions"}`를 반환한다.
4. `insert ... on conflict (user_id, month) do update set plan, model, input_hash, summary = excluded.*, updated_at = now()`. `created_at`은 처음 값을 유지한다.
5. `{"kind": "saved"}` 반환.
- `revoke execute on function public.save_ai_summary(uuid, text, text, text, text, text) from public, anon, authenticated;` + `grant execute ... to service_role;`
- 함수 안의 내장 함수는 기존 파일처럼 `pg_catalog.` 접두사를 붙인다(`pg_catalog.jsonb_build_object` 등).

#### 1-3. `public.delete_upload` 다시 정의

`create or replace function public.delete_upload(p_user_id uuid, p_upload_id uuid)`로 **시그니처·반환값·기존 순서를 그대로 두고** 한 문장만 더한다. 결과는 아래와 같아야 한다.

```sql
create or replace function public.delete_upload(p_user_id uuid, p_upload_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
begin
  perform private.lock_user(p_user_id);

  select u.* into v_upload
  from public.uploads as u
  where u.id = p_upload_id and u.user_id = p_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'not_found');
  end if;

  if v_upload.status = 'processing' and v_upload.lease_expires_at > now() then
    return pg_catalog.jsonb_build_object('kind', 'processing');
  end if;

  -- 지운 거래의 가맹점명이 요약에 남지 않도록 그 업로드 거래가 있던 달의 요약을 먼저 지운다.
  delete from public.ai_summaries as s
  where s.user_id = p_user_id
    and s.month in (
      select distinct pg_catalog.to_char(t.used_on, 'YYYY-MM')
      from public.transactions as t
      where t.user_id = p_user_id and t.upload_id = p_upload_id
    );

  -- 거래는 FK cascade로 지우고, FK가 없는 upload_attempts는 보존한다.
  delete from public.uploads where id = p_upload_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object('kind', 'deleted');
end;
$$;
```
- 그 뒤에 권한을 다시 명시한다: `revoke execute on function public.delete_upload(uuid, uuid) from public, anon, authenticated;` + `grant execute ... to service_role;`
- `20261015000000_dashboard.sql`의 `uploads_deleted_at` 트리거(업로드 삭제 시각 기록)는 `uploads` 행 삭제에 걸려 있으므로 그대로 동작해야 한다. 트리거를 건드리지 않는다.

### 2. pgTAP `supabase/tests/ai_summaries.test.sql`

기존 파일과 같은 틀(`begin;` → `_tap`·`_rpc` 임시 테이블 → 단언 → `select * from finish()` → `select string_agg(line, E'\n' order by n) as tap from _tap;` → `rollback;`)로 쓴다. 임시 사용자 id는 기존 파일과 겹치지 않게 `00000000-0000-4000-8000-000000000041`~`00000000-0000-4000-8000-000000000044`를 쓴다. 단언은 최소 아래를 포함한다.

- 스키마: `has_table`, `columns_are`(8개), `col_is_pk(... array['user_id','month'])`, RLS 켜짐, 정책이 `ai_summaries_select_own` 하나이고 `SELECT`·`authenticated`용.
- 권한: anon은 테이블 권한 없음, authenticated는 `SELECT`만, service_role은 SELECT·INSERT·UPDATE·DELETE. `save_ai_summary`·`delete_upload` EXECUTE는 service_role만. 두 함수 모두 `prosecdef = false`이고 `proconfig`에 `search_path=""`가 있다.
- 저장(service_role로 호출, fixture는 `create_card`→`begin_upload`→`ingest_upload`로 만든다):
  - 사용자 A에게 2026-08-31·2026-09-01·2026-09-30·2026-10-01 거래가 있을 때 `save_ai_summary(A, '2026-09', ...)` → `saved`, 행 값이 인자와 같다.
  - 같은 달을 다른 `plan`·`model`·`input_hash`·`summary`로 다시 저장 → `saved`, 행이 하나이고 값이 바뀌며 `created_at`은 처음 값 그대로다(`now()`가 트랜잭션 동안 같으므로 저장 전 `created_at`을 과거 시각으로 바꿔 두고 유지되는지 본다).
  - 거래가 없는 달(`'2026-07'`) → `no_transactions`, 행이 생기지 않는다. 거래가 없는 사용자 B의 `'2026-09'` → `no_transactions`(A의 거래가 B에 세지 않는다).
  - `'2026-13'`·`'2026-9'`·null 월 → `22023`. 잘못된 `p_plan`('team')·대문자가 섞인 해시·빈 요약 → `23514`.
- RLS: `request.jwt.claims`로 A가 되어 `set local role authenticated` → A 행만 보이고 B 행(B도 거래를 만든 뒤 저장)은 안 보인다. authenticated가 `insert`·`update`·`delete`를 하면 `42501`. authenticated가 `save_ai_summary`를 실행하면 `42501`.
- 업로드 삭제(service_role):
  - A의 업로드 U1(2026-08·2026-09 거래)과 U2(2026-10 거래), A의 요약 08·09·10월과 B의 09월 요약을 둔다. `delete_upload(A, U1)` → `deleted`, A의 08·09월 요약은 사라지고 A의 10월 요약과 B의 09월 요약은 남는다. U1 시도의 `upload_attempts.deleted_at`이 채워진다(기존 트리거 회귀).
  - lease가 남은 processing 업로드 삭제 → `processing`, 요약이 그대로다. 없는 업로드 id → `not_found`, 요약이 그대로다.
- `delete from auth.users where id = A`가 `lives_ok`이고 A의 요약이 cascade로 0행, B의 요약은 남는다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261016000000_ai_summaries.sql
test -f supabase/tests/ai_summaries.test.sql
grep -qi 'create table public.ai_summaries' supabase/migrations/20261016000000_ai_summaries.sql
test "$(grep -ci 'create policy' supabase/migrations/20261016000000_ai_summaries.sql)" -eq 1
test "$(grep -c 'auth.uid()' supabase/migrations/20261016000000_ai_summaries.sql)" -eq 1
test "$(grep -c 'private.lock_user' supabase/migrations/20261016000000_ai_summaries.sql)" -eq 2
! grep -qi 'security definer' supabase/migrations/20261016000000_ai_summaries.sql
grep -q "for update" supabase/migrations/20261016000000_ai_summaries.sql
grep -q "'processing'" supabase/migrations/20261016000000_ai_summaries.sql
grep -q 'string_agg(line' supabase/tests/ai_summaries.test.sql
test "$(tail -n 3 supabase/tests/ai_summaries.test.sql | grep -ciE '^rollback;')" -eq 1
git diff --quiet HEAD -- supabase/migrations/20261013000000_upload_schema.sql supabase/migrations/20261013000100_upload_rpc.sql supabase/migrations/20261014000000_subscriptions.sql supabase/migrations/20261015000000_dashboard.sql supabase/migrations/20261015000100_dashboard_deletion_definer.sql
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 마이그레이션은 DB에서 실행하지 않으므로 SQL 문법·함수 시그니처·`pg_catalog.` 접두사를 기존 파일과 한 줄씩 대조해 직접 검토한다. 특히 다시 정의한 `delete_upload`를 `20261013000100_upload_rpc.sql`의 원본과 나란히 놓고, 요약 삭제 문장 말고는 달라진 줄이 없는지 확인한다.
2. pgTAP의 `plan(N)`이 실제 단언 수와 같은지 센다(`insert into _tap(line) select` 줄과 `from unnest`로 여러 줄을 만드는 단언을 모두 센다).
3. 아키텍처 체크리스트를 확인한다:
   - 사용자에게 select 정책 하나와 SELECT 권한만 있고, 쓰기는 service_role RPC로만 되는가? (ADR-002)
   - `save_ai_summary`가 사용자 잠금 아래 그 달 거래가 있을 때만 저장하는가? (ARCHITECTURE "삭제와 정리")
   - `delete_upload`가 processing·not_found에서 아무것도 지우지 않고, deleted에서만 그 업로드의 달 요약을 지우는가?
4. 결과에 따라 `phases/10-ai-summary/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션·pgTAP 파일 경로, `ai_summaries` 컬럼·제약·정책, `save_ai_summary` 시그니처와 결과 kind, `delete_upload` 변경, pgTAP 단언 개수, "dev DB 미적용(사용자 쪽에서 push·pgtap.sh 필요)"을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `supabase test db`, `scripts/pgtap.sh`를 실행하지 마라. 이유: dev DB 마이그레이션과 pgTAP 실행은 이 step이 끝난 뒤 사용자 쪽에서 한다(ARCHITECTURE "모드 · 환경").
- 기존 마이그레이션 파일(`20261013*`·`20261014*`·`20261015*`)을 고치지 마라. 이유: 이미 dev DB에 적용됐다. `delete_upload`는 새 마이그레이션에서 `create or replace`로만 바꾼다.
- `delete_upload`의 시그니처·반환 kind·잠금·processing 판단·`upload_attempts` 보존을 바꾸지 마라. 이유: 업로드 API와 기존 pgTAP이 그 동작에 기대고 있다.
- `security definer`를 쓰지 마라. 이유: 기존 RPC와 같이 invoker로 두고 service_role 권한 안에서만 쓴다. `ai_summaries`에는 트리거를 만들지 않으므로 Auth cascade 권한 문제(`20261015000100`)도 생기지 않는다.
- `save_ai_summary`에서 `auth.uid()`를 쓰지 마라. 이유: 서버가 세션에서 꺼낸 user_id를 넘긴다. `auth.uid()`는 select 정책에서만 쓴다.
- 요약 문장·해시를 DB에서 만들거나 검사하지 마라(형식 check 제약만 둔다). 이유: 요약 생성·검증은 앱 코드가 한다(step 2·3).
- 앱 코드(`src/`)를 고치지 마라. 이유: 다음 step에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
