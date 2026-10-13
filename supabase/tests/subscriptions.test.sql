begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to authenticated, anon, service_role;
grant usage on sequence _tap_n_seq to authenticated, anon, service_role;
insert into _tap(line) select plan(51);

create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line) select has_table('public', 'subscriptions', 'subscriptions 테이블이 있다');
insert into _tap(line) select columns_are(
  'public', 'subscriptions', array[
    'user_id', 'plan', 'polar_subscription_id', 'current_period_end',
    'cancel_at_period_end', 'synced_from', 'updated_at'
  ], '구독 상태와 조회 시작 시각을 일곱 컬럼에 저장한다'
);
insert into _tap(line) select ok(
  (select relrowsecurity from pg_class where oid = 'public.subscriptions'::regclass),
  'subscriptions에 RLS가 켜져 있다'
);
insert into _tap(line) select ok(
  (
    select count(*) = 1 and bool_and(
      policyname = 'subscriptions_select_own' and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
    )
    from pg_policies where schemaname = 'public' and tablename = 'subscriptions'
  ), 'authenticated의 본인 SELECT 정책 하나만 있다'
);
insert into _tap(line) select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'subscriptions'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0::bigint, '구독에는 사용자 쓰기 정책이 없다'
);
insert into _tap(line) select table_privs_are(
  'public', 'subscriptions', 'authenticated', array['SELECT'],
  'authenticated는 구독 SELECT 권한만 가진다'
);
insert into _tap(line) select table_privs_are(
  'public', 'subscriptions', 'anon', array[]::text[], 'anon은 구독 테이블 권한이 없다'
);
insert into _tap(line) select ok(
  (select bool_and(has_table_privilege('service_role', 'public.subscriptions', privilege))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)),
  'service_role은 구독 SELECT·INSERT·UPDATE·DELETE 권한이 있다'
);
insert into _tap(line)
select ok(
  has_function_privilege(role_name,
    'public.save_subscription(uuid,timestamptz,text,text,timestamptz,boolean)', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 save_subscription EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[] from pg_proc
    where oid = 'public.save_subscription(uuid,timestamptz,text,text,timestamptz,boolean)'::regprocedure),
  'save_subscription은 invoker 권한과 빈 search_path를 쓴다'
);

-- 클라우드 dev의 기존 사용자와 무관한 A·B를 만들고 마지막에 롤백한다.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000021', 'subscriptions-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000022', 'subscriptions-b@example.invalid');
insert into public.subscriptions (user_id, plan, synced_from) values
  ('00000000-0000-4000-8000-000000000022', 'free', '2026-10-14T00:00:00Z');

set local role service_role;
insert into _rpc select 'initial', public.save_subscription(
  '00000000-0000-4000-8000-000000000021', '2026-10-14T00:00:00Z',
  'pro', 'subscription-a', '2026-11-14T00:00:00Z', false
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'initial'),
  jsonb_build_object('kind', 'saved', 'plan', 'pro',
    'current_period_end', '2026-11-14T00:00:00Z'::timestamptz, 'cancel_at_period_end', false),
  '첫 저장은 saved와 입력의 플랜·기간 끝·해지 예약을 반환한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('plan', plan, 'subscription_id', polar_subscription_id,
    'period_end', current_period_end, 'cancel', cancel_at_period_end,
    'synced_from', synced_from, 'updated_at', updated_at)
    from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'),
  jsonb_build_object('plan', 'pro', 'subscription_id', 'subscription-a',
    'period_end', '2026-11-14T00:00:00Z'::timestamptz, 'cancel', false,
    'synced_from', '2026-10-14T00:00:00Z'::timestamptz, 'updated_at', now()),
  '첫 저장은 입력값과 updated_at을 저장한다'
);

reset role;
update public.subscriptions set updated_at = '2000-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000021';
set local role service_role;
insert into _rpc select 'free', public.save_subscription(
  '00000000-0000-4000-8000-000000000021', '2026-10-14T00:01:00Z', 'free', null, null, false
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'free'),
  '{"kind":"saved","plan":"free","current_period_end":null,"cancel_at_period_end":false}'::jsonb,
  '더 늦게 시작한 조회는 Pro를 Free로 바꾸고 saved를 반환한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('plan', plan, 'subscription_id', polar_subscription_id,
    'period_end', current_period_end, 'cancel', cancel_at_period_end,
    'synced_from', synced_from, 'updated_at', updated_at)
    from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'),
  jsonb_build_object('plan', 'free', 'subscription_id', null, 'period_end', null, 'cancel', false,
    'synced_from', '2026-10-14T00:01:00Z'::timestamptz, 'updated_at', now()),
  'Free 전환 시 구독 id·기간 끝을 비우고 조회 시각과 updated_at을 갱신한다'
);

insert into _rpc select 'stale', public.save_subscription(
  '00000000-0000-4000-8000-000000000021', '2026-10-14T00:00:00Z',
  'pro', 'subscription-old', '2026-11-14T00:00:00Z', true
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'stale'),
  '{"kind":"stale","plan":"free","current_period_end":null,"cancel_at_period_end":false}'::jsonb,
  '먼저 시작한 조회는 stale과 저장된 Free의 세 필드를 반환한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'
    and plan = 'free' and polar_subscription_id is null and current_period_end is null
    and not cancel_at_period_end and synced_from = '2026-10-14T00:01:00Z' and updated_at = now()),
  '먼저 시작한 조회는 저장된 Free 행을 바꾸지 않는다'
);
insert into _rpc select 'same_time', public.save_subscription(
  '00000000-0000-4000-8000-000000000021', '2026-10-14T00:01:00Z',
  'pro', 'subscription-same-time', '2026-11-14T00:00:00Z', true
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'same_time'),
  '{"kind":"stale","plan":"free","current_period_end":null,"cancel_at_period_end":false}'::jsonb,
  '같은 조회 시작 시각도 stale이다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'
    and plan = 'free' and polar_subscription_id is null and current_period_end is null
    and not cancel_at_period_end and synced_from = '2026-10-14T00:01:00Z' and updated_at = now()),
  '같은 시각의 조회도 저장된 행을 바꾸지 않는다'
);
insert into _tap(line) select is(
  public.save_subscription('00000000-0000-4000-8000-000000000099',
    '2026-10-14T00:00:00Z', 'free', null, null, false),
  '{"kind":"user_not_found"}'::jsonb, '없는 auth 사용자는 user_not_found다'
);
insert into _tap(line) select is(
  (select count(*) from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000099'),
  0::bigint, '없는 사용자의 구독 행은 만들지 않는다'
);

insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', 'free', 'subscription-invalid', null, false)$$,
  '23514', null, 'Free에 구독 id를 넣으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', 'free', null, '2026-11-14T00:00:00Z', false)$$,
  '23514', null, 'Free에 기간 끝을 넣으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', 'free', null, null, true)$$,
  '23514', null, 'Free에 해지 예약을 넣으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', 'unknown', null, null, false)$$,
  '23514', null, 'Free·Pro 외의 플랜은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', 'pro', '', null, false)$$,
  '23514', null, '빈 구독 id는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', 'pro', repeat('a', 101), null, false)$$,
  '23514', null, '101자 구독 id는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000099',
    null, 'free', null, null, false)$$,
  '23502', null, '신규 행의 null 조회 시작 시각은 오류로 노출한다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:02:00Z', null, null, null, false)$$,
  '23502', null, 'null 플랜은 오류로 노출한다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:00:00Z', 'free', null, null, null)$$,
  '23502', null, '오래된 조회도 null 해지 예약을 숨기지 않는다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    null, 'free', null, null, false)$$,
  '23502', null, '기존 행이 있어도 null 조회 시작 시각은 오류다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'
    and plan = 'free' and polar_subscription_id is null and current_period_end is null
    and not cancel_at_period_end and synced_from = '2026-10-14T00:01:00Z' and updated_at = now()),
  '잘못된 입력은 저장된 구독을 바꾸지 않는다'
);

insert into _rpc select 'cancelled_pro', public.save_subscription(
  '00000000-0000-4000-8000-000000000021', '2026-10-14T00:02:00Z',
  'pro', 'subscription-a', '2026-11-14T00:00:00Z', true
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'cancelled_pro'),
  jsonb_build_object('kind', 'saved', 'plan', 'pro',
    'current_period_end', '2026-11-14T00:00:00Z'::timestamptz, 'cancel_at_period_end', true),
  '해지 예약 Pro의 저장 결과는 입력의 세 필드와 같다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'
    and plan = 'pro' and polar_subscription_id = 'subscription-a'
    and current_period_end = '2026-11-14T00:00:00Z' and cancel_at_period_end
    and synced_from = '2026-10-14T00:02:00Z'),
  '해지 예약 Pro의 구독 id·기간 끝·해지 예약을 저장한다'
);
insert into _tap(line) select lives_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:03:00Z', 'pro', repeat('a', 100), null, false)$$,
  '100자 구독 id는 저장할 수 있다'
);
insert into _tap(line) select lives_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:04:00Z', 'pro', 'a', null, false)$$,
  '1자 구독 id는 저장할 수 있다'
);
insert into _rpc select 'mock_pro', public.save_subscription(
  '00000000-0000-4000-8000-000000000021', '2026-10-14T00:05:00Z', 'pro', null, null, false
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'mock_pro'),
  '{"kind":"saved","plan":"pro","current_period_end":null,"cancel_at_period_end":false}'::jsonb,
  'mock Pro는 구독 id와 기간 끝이 null이어도 saved다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'
    and plan = 'pro' and polar_subscription_id is null and current_period_end is null
    and not cancel_at_period_end and synced_from = '2026-10-14T00:05:00Z'),
  'mock Pro를 live 구독 정보 없이 저장한다'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-000000000021', 'role', 'authenticated'
)::text, true);
insert into _tap(line) select results_eq(
  'select user_id from public.subscriptions order by user_id',
  array['00000000-0000-4000-8000-000000000021'::uuid], 'A에게는 A의 구독만 보인다'
);
insert into _tap(line) select is(
  (select count(*) from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000022'),
  0::bigint, 'A는 B의 구독을 읽을 수 없다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.subscriptions (user_id, plan, synced_from)
    values ('00000000-0000-4000-8000-000000000021', 'free', now())$$,
  '42501', null, 'authenticated는 구독을 직접 추가할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.subscriptions set plan = 'free'
    where user_id = '00000000-0000-4000-8000-000000000021'$$,
  '42501', null, 'authenticated는 구독을 직접 수정할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$delete from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'$$,
  '42501', null, 'authenticated는 구독을 직접 삭제할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:06:00Z', 'free', null, null, false)$$,
  '42501', null, 'authenticated는 저장 RPC를 실행할 수 없다'
);
reset role;

set local role anon;
insert into _tap(line) select throws_ok(
  'select * from public.subscriptions', '42501', null, 'anon은 구독을 읽을 수 없다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:06:00Z', 'free', null, null, false)$$,
  '42501', null, 'anon은 저장 RPC를 실행할 수 없다'
);
reset role;

delete from auth.users where id = '00000000-0000-4000-8000-000000000021';
insert into _tap(line) select is(
  (select count(*) from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'),
  0::bigint, '사용자 삭제 시 구독 행도 cascade로 지워진다'
);
insert into _tap(line) select is(
  (select count(*) from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000022'),
  1::bigint, '다른 사용자의 구독은 남는다'
);
set local role service_role;
insert into _tap(line) select is(
  public.save_subscription('00000000-0000-4000-8000-000000000021',
    '2026-10-14T00:06:00Z', 'pro', 'subscription-late', '2026-11-14T00:00:00Z', false),
  '{"kind":"user_not_found"}'::jsonb, '탈퇴 뒤 도착한 조회도 user_not_found다'
);
insert into _tap(line) select is(
  (select count(*) from public.subscriptions where user_id = '00000000-0000-4000-8000-000000000021'),
  0::bigint, '탈퇴 뒤 도착한 조회는 구독을 복원하지 않는다'
);
reset role;

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
