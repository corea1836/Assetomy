begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to authenticated, anon, service_role;
grant usage on sequence _tap_n_seq to authenticated, anon, service_role;
insert into _tap(line) select plan(118);

create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line) select has_table('public', 'user_metrics', 'user_metrics 테이블이 있다');
insert into _tap(line) select columns_are(
  'public', 'user_metrics', array[
    'user_id', 'first_attempt_at', 'first_success_at', 'teaser_seen_at',
    'first_click_at', 'upgrade_source', 'first_paid_at'
  ], '사용자별 첫 시각과 첫 클릭 source를 일곱 컬럼에 저장한다'
);
insert into _tap(line) select col_type_is(
  'public', 'upload_attempts', 'extends_period', 'boolean', 'extends_period는 boolean이다'
);
insert into _tap(line) select col_type_is(
  'public', 'upload_attempts', 'deleted_at', 'timestamp with time zone', 'deleted_at은 timestamptz다'
);

insert into _tap(line)
select ok(
  (select relrowsecurity from pg_class where oid = ('public.' || table_name)::regclass),
  table_name || '에 RLS가 켜져 있다'
)
from unnest(array['user_metrics', 'upload_attempts']) as tables(table_name);
insert into _tap(line)
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = table_name),
  0::bigint, table_name || '에는 사용자 정책이 없다'
)
from unnest(array['user_metrics', 'upload_attempts']) as tables(table_name);
insert into _tap(line)
select table_privs_are(
  'public', table_name::name, role_name::name, array[]::text[],
  role_name || '은 ' || table_name || '에 권한이 없다'
)
from unnest(array['user_metrics', 'upload_attempts']) as tables(table_name)
cross join unnest(array['anon', 'authenticated']) as roles(role_name);
insert into _tap(line)
select ok(
  (select bool_and(has_table_privilege('service_role', 'public.' || table_name, privilege))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)),
  'service_role은 ' || table_name || '의 SELECT·INSERT·UPDATE·DELETE 권한이 있다'
)
from unnest(array['user_metrics', 'upload_attempts']) as tables(table_name);

insert into _tap(line)
select ok(
  has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role'),
  role_name || '의 ' || signature || ' EXECUTE 권한이 올바르다'
)
from (values
  ('public.record_metric(uuid,text,text)'),
  ('public.set_merchant_category(uuid,text,text)'),
  ('private.record_first_upload_attempt()'),
  ('private.record_upload_success()'),
  ('private.record_upload_deletion()')
) as functions(signature)
cross join unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line)
select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = signature::regprocedure),
  signature || '는 invoker 권한과 빈 search_path를 쓴다'
)
from (values
  ('public.record_metric(uuid,text,text)'),
  ('public.set_merchant_category(uuid,text,text)'),
  ('private.record_first_upload_attempt()'),
  ('private.record_upload_success()')
) as functions(signature);
-- Auth의 사용자 삭제 cascade는 upload_attempts 권한이 없는 역할로 이 트리거를 실행한다.
insert into _tap(line) select ok(
  (select prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'private.record_upload_deletion()'::regprocedure),
  'private.record_upload_deletion()는 소유자 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select count(*) = 3 from pg_trigger where not tgisinternal and (
    (tgrelid = 'public.upload_attempts'::regclass and tgname in (
      'upload_attempts_first_attempt', 'upload_attempts_success'
    )) or (tgrelid = 'public.uploads'::regclass and tgname = 'uploads_deleted_at')
  )), '측정 트리거 세 개가 해당 테이블에 있다'
);

-- 기존 dev 사용자와 무관한 임시 사용자이며 마지막에 롤백한다.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000031', 'dashboard-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000032', 'dashboard-b@example.invalid'),
  ('00000000-0000-4000-8000-000000000033', 'dashboard-unsuccessful@example.invalid'),
  ('00000000-0000-4000-8000-000000000034', 'dashboard-direct@example.invalid'),
  ('00000000-0000-4000-8000-000000000035', 'dashboard-free@example.invalid'),
  ('00000000-0000-4000-8000-000000000036', 'dashboard-fallback@example.invalid');

insert into _tap(line) select throws_ok(
  $$insert into public.user_metrics (user_id, upgrade_source)
    values ('00000000-0000-4000-8000-000000000031', 'unknown')$$,
  '23514', null, '허용되지 않은 source는 제약으로 거절한다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.user_metrics (user_id, first_click_at, upgrade_source, first_paid_at)
    values ('00000000-0000-4000-8000-000000000031', now(), 'direct', now())$$,
  '23514', null, '클릭이 있으면 direct로 기록할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.user_metrics (user_id, upgrade_source)
    values ('00000000-0000-4000-8000-000000000031', 'direct')$$,
  '23514', null, 'direct에는 첫 결제 시각이 필요하다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.user_metrics (user_id, first_click_at)
    values ('00000000-0000-4000-8000-000000000031', now())$$,
  '23514', null, '클릭이 있으면 null source도 거절한다'
);

insert into _rpc(name, result) values ('rows_first', jsonb_build_array(
  jsonb_build_object('used_on', '2026-08-05', 'merchant', '테스트 가맹점',
    'merchant_key', '테스트가맹점', 'amount', 10000, 'event_kind', 'purchase',
    'category', 'food', 'fingerprint', repeat('a', 64)),
  jsonb_build_object('used_on', '2026-09-05', 'merchant', '테스트 가맹점',
    'merchant_key', '테스트가맹점', 'amount', 20000, 'event_kind', 'purchase',
    'category', 'cafe', 'fingerprint', repeat('b', 64)),
  jsonb_build_object('used_on', '2026-09-10', 'merchant', '다른 가맹점',
    'merchant_key', '다른가맹점', 'amount', 30000, 'event_kind', 'purchase',
    'category', 'shopping', 'fingerprint', repeat('c', 64))
));
insert into _rpc(name, result) values ('rows_later', jsonb_build_array(
  jsonb_build_object('used_on', '2026-10-01', 'merchant', '다른 가맹점',
    'merchant_key', '다른가맹점', 'amount', 40000, 'event_kind', 'purchase',
    'category', 'shopping', 'fingerprint', repeat('d', 64))
));
insert into _rpc(name, result) values ('rows_inside', jsonb_build_array(
  jsonb_build_object('used_on', '2026-09-20', 'merchant', '다른 가맹점',
    'merchant_key', '다른가맹점', 'amount', 5000, 'event_kind', 'purchase',
    'category', 'shopping', 'fingerprint', repeat('e', 64))
));
insert into _rpc(name, result) values ('rows_equal', jsonb_build_array(
  jsonb_build_object('used_on', '2026-10-01', 'merchant', '다른 가맹점',
    'merchant_key', '다른가맹점', 'amount', 6000, 'event_kind', 'purchase',
    'category', 'shopping', 'fingerprint', repeat('f', 64))
));

set local role service_role;
insert into _rpc select 'card_a', public.create_card(
  '00000000-0000-4000-8000-000000000031', '테스트 카드'
);
insert into _rpc select 'card_b', public.create_card(
  '00000000-0000-4000-8000-000000000032', '테스트 카드'
);
insert into _rpc select 'card_unsuccessful', public.create_card(
  '00000000-0000-4000-8000-000000000033', '테스트 카드'
);
insert into _rpc select 'card_fallback', public.create_card(
  '00000000-0000-4000-8000-000000000036', '테스트 카드'
);

insert into _rpc select 'upload_first', public.begin_upload(
  '00000000-0000-4000-8000-000000000031', (result->>'card_id')::uuid,
  'first.csv', repeat('1', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select ok(
  exists(select 1 from public.user_metrics as m join public.upload_attempts as a using (user_id)
    where m.user_id = '00000000-0000-4000-8000-000000000031'
      and m.first_attempt_at = a.created_at and m.first_success_at is null),
  '첫 begin_upload는 시도 created_at을 기록하고 성공 시각은 비워 둔다'
);
-- now()는 트랜잭션 동안 같으므로 기존 시각을 다르게 두어 덮어쓰기를 검출한다.
update public.user_metrics set first_attempt_at = '2000-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000031';
insert into _rpc select 'upload_later', public.begin_upload(
  '00000000-0000-4000-8000-000000000031', (result->>'card_id')::uuid,
  'later.csv', repeat('2', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  (select first_attempt_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  '2000-01-01T00:00:00Z'::timestamptz, '두 번째 시도는 첫 시각을 바꾸지 않는다'
);
insert into _tap(line) select throws_ok(
  $$update public.upload_attempts set extends_period = true
    where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first')$$,
  '23514', null, 'outcome null인 처리 중 시도에는 extends_period를 넣을 수 없다'
);

insert into _rpc select 'ingest_first', public.ingest_upload(
  '00000000-0000-4000-8000-000000000031', (u.result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', r.result, 0
) from _rpc as u cross join _rpc as r where u.name = 'upload_first' and r.name = 'rows_first';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'ingest_first'), 'done', '첫 ingest는 done이다'
);
insert into _tap(line) select is(
  (select first_success_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  (select completed_at from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first')),
  '첫 done은 completed_at을 첫 성공 시각으로 기록한다'
);
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first')),
  true, '다른 업로드 거래가 없는 첫 done은 extends_period true다'
);
update public.user_metrics set first_success_at = '2000-02-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000031';

-- B의 더 늦은 거래는 A의 기존 기간 비교와 카테고리 수정에 영향을 주지 않는다.
insert into _rpc select 'upload_b', public.begin_upload(
  '00000000-0000-4000-8000-000000000032', (result->>'card_id')::uuid,
  'b.csv', repeat('1', 64), 100
) from _rpc where name = 'card_b';
insert into _rpc select 'ingest_b', public.ingest_upload(
  '00000000-0000-4000-8000-000000000032', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(jsonb_build_object(
    'used_on', '2026-12-01', 'merchant', '테스트 가맹점', 'merchant_key', '테스트가맹점',
    'amount', 10000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('a', 64)
  )), 0
) from _rpc where name = 'upload_b';

insert into _rpc select 'ingest_later', public.ingest_upload(
  '00000000-0000-4000-8000-000000000031', (u.result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', r.result, 0
) from _rpc as u cross join _rpc as r where u.name = 'upload_later' and r.name = 'rows_later';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'ingest_later'), 'done', '뒤 기간 거래를 새로 저장한다'
);
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_later')),
  true, '같은 사용자의 기존 최종일 뒤 거래는 extends_period true다'
);
insert into _tap(line) select is(
  (select first_success_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  '2000-02-01T00:00:00Z'::timestamptz, '두 번째 done은 첫 성공 시각을 바꾸지 않는다'
);

insert into _rpc select 'upload_inside', public.begin_upload(
  '00000000-0000-4000-8000-000000000031', (result->>'card_id')::uuid,
  'inside.csv', repeat('3', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_inside', public.ingest_upload(
  '00000000-0000-4000-8000-000000000031', (u.result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', r.result, 0
) from _rpc as u cross join _rpc as r where u.name = 'upload_inside' and r.name = 'rows_inside';
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_inside')),
  false, '기존 기간 안의 신규 거래는 extends_period false다'
);
insert into _rpc select 'upload_equal', public.begin_upload(
  '00000000-0000-4000-8000-000000000031', (result->>'card_id')::uuid,
  'equal.csv', repeat('4', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_equal', public.ingest_upload(
  '00000000-0000-4000-8000-000000000031', (u.result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', r.result, 0
) from _rpc as u cross join _rpc as r where u.name = 'upload_equal' and r.name = 'rows_equal';
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_equal')),
  false, '기존 최종일과 같은 날의 신규 거래도 extends_period false다'
);
update public.upload_attempts set completed_at = '2001-01-01T00:00:00Z', outcome = 'done'
where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first');
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first')),
  true, '이미 done인 시도를 갱신해도 extends_period를 다시 계산하지 않는다'
);

insert into _rpc select 'begin_duplicate', public.begin_upload(
  '00000000-0000-4000-8000-000000000031', (result->>'card_id')::uuid,
  'duplicate.csv', repeat('1', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'begin_duplicate'), 'duplicate', '같은 파일은 begin에서 중복이다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000031'
    and upload_id is null and outcome = 'no_new' and extends_period is null),
  '업로드 없는 파일 중복 시도는 extends_period null이다'
);

insert into _rpc select 'upload_no_new', public.begin_upload(
  '00000000-0000-4000-8000-000000000033', (result->>'card_id')::uuid,
  'empty.csv', repeat('5', 64), 100
) from _rpc where name = 'card_unsuccessful';
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000033',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_no_new'),
    'approval_number', 'negative_amount', '[]', 0)->>'kind',
  'no_new', '저장할 거래가 없으면 no_new다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000033'
    and first_attempt_at is not null and first_success_at is null), 'no_new는 첫 성공을 기록하지 않는다'
);
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_no_new')),
  null::boolean, 'no_new 시도는 extends_period null이다'
);
insert into _tap(line) select throws_ok(
  $$update public.upload_attempts set extends_period = false
    where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_no_new')$$,
  '23514', null, 'no_new에 extends_period를 넣으면 제약 오류다'
);
insert into _rpc select 'upload_failed', public.begin_upload(
  '00000000-0000-4000-8000-000000000033', (result->>'card_id')::uuid,
  'failed.csv', repeat('6', 64), 100
) from _rpc where name = 'card_unsuccessful';
insert into _tap(line) select is(
  public.fail_upload('00000000-0000-4000-8000-000000000033',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_failed'), 'UNREADABLE', null),
  '{"kind":"failed"}'::jsonb, 'fail_upload는 failed로 끝낸다'
);
insert into _tap(line) select is(
  (select first_success_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000033'),
  null::timestamptz, 'failed도 첫 성공을 기록하지 않는다'
);
insert into _tap(line) select is(
  (select extends_period from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_failed')),
  null::boolean, 'failed 시도는 extends_period null이다'
);
insert into _tap(line) select throws_ok(
  $$update public.upload_attempts set extends_period = true
    where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_failed')$$,
  '23514', null, 'failed에 extends_period를 넣으면 제약 오류다'
);

-- created_at 전달과 completed_at null 폴백은 서버 권한의 시도 갱신으로 검사한다.
insert into public.upload_attempts (user_id, created_at)
values ('00000000-0000-4000-8000-000000000035', '2002-01-01T00:00:00Z');
insert into _tap(line) select is(
  (select first_attempt_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000035'),
  '2002-01-01T00:00:00Z'::timestamptz, '첫 시도 트리거는 now 대신 실제 created_at을 저장한다'
);
insert into _rpc select 'upload_fallback', public.begin_upload(
  '00000000-0000-4000-8000-000000000036', (result->>'card_id')::uuid,
  'fallback.csv', repeat('7', 64), 100
) from _rpc where name = 'card_fallback';
delete from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000036';
update public.upload_attempts set outcome = 'done', completed_at = null
where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_fallback');
insert into _tap(line) select is(
  (select first_success_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000036'),
  now(), '지표 행이 없고 completed_at이 null이면 행을 만들고 now로 첫 성공을 기록한다'
);

insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000031', 'teaser_seen', null),
  '{"kind":"recorded"}'::jsonb, '구독 행 없는 Free의 티저 첫 노출을 기록한다'
);
insert into _tap(line) select is(
  (select teaser_seen_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  now(), '티저 첫 노출 시각을 저장한다'
);
update public.user_metrics set teaser_seen_at = '2003-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000031';
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000031', 'teaser_seen', null),
  '{"kind":"unchanged"}'::jsonb, '두 번째 티저 노출은 unchanged다'
);
insert into _tap(line) select is(
  (select teaser_seen_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  '2003-01-01T00:00:00Z'::timestamptz, '두 번째 노출은 첫 시각을 바꾸지 않는다'
);
insert into _rpc select 'subscription_b', public.save_subscription(
  '00000000-0000-4000-8000-000000000032', now(), 'pro', 'dashboard-pro', now() + interval '1 month', false
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000032', 'teaser_seen', null),
  '{"kind":"unchanged"}'::jsonb, 'Pro의 티저 노출은 기록하지 않는다'
);
insert into _tap(line) select is(
  (select teaser_seen_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000032'),
  null::timestamptz, 'Pro의 티저 시각은 null이다'
);
insert into _rpc select 'subscription_free', public.save_subscription(
  '00000000-0000-4000-8000-000000000035', now(), 'free', null, null, false
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000035', 'teaser_seen', null),
  '{"kind":"recorded"}'::jsonb, '명시적인 Free 구독의 티저 노출도 기록한다'
);

insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000031', 'upgrade_click', 'teaser'),
  '{"kind":"recorded"}'::jsonb, 'Free의 첫 업그레이드 클릭을 기록한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('click', first_click_at, 'source', upgrade_source)
    from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  jsonb_build_object('click', now(), 'source', 'teaser'), '첫 클릭 시각과 teaser source를 저장한다'
);
update public.user_metrics set first_click_at = '2004-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000031';
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000031', 'upgrade_click', 'pricing'),
  '{"kind":"unchanged"}'::jsonb, '두 번째 pricing 클릭은 unchanged다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('click', first_click_at, 'source', upgrade_source)
    from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  jsonb_build_object('click', '2004-01-01T00:00:00Z'::timestamptz, 'source', 'teaser'),
  '첫 클릭 시각과 source를 바꾸지 않는다'
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000032', 'upgrade_click', 'teaser'),
  '{"kind":"unchanged"}'::jsonb, 'Pro의 업그레이드 클릭은 기록하지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000032'
    and first_click_at is null and upgrade_source is null), 'Pro의 클릭 시각과 source는 null이다'
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000035', 'upgrade_click', 'settings'),
  '{"kind":"recorded"}'::jsonb, '명시적인 Free 구독도 클릭을 기록한다'
);

insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000034', 'first_paid', null),
  '{"kind":"recorded"}'::jsonb, '클릭 없는 사용자의 첫 결제를 기록한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('paid', first_paid_at, 'click', first_click_at, 'source', upgrade_source)
    from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000034'),
  jsonb_build_object('paid', now(), 'click', null, 'source', 'direct'), '클릭 없는 첫 결제는 direct다'
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000031', 'first_paid', null),
  '{"kind":"recorded"}'::jsonb, '클릭이 있던 사용자의 첫 결제를 기록한다'
);
insert into _tap(line) select is(
  (select upgrade_source from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  'teaser', '첫 결제도 첫 클릭 source를 유지한다'
);
update public.user_metrics set first_paid_at = '2005-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000031';
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000031', 'first_paid', null),
  '{"kind":"unchanged"}'::jsonb, '두 번째 결제 확인은 unchanged다'
);
insert into _tap(line) select is(
  (select first_paid_at from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  '2005-01-01T00:00:00Z'::timestamptz, '두 번째 결제 확인은 첫 결제 시각을 바꾸지 않는다'
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000032', 'first_paid', null),
  '{"kind":"recorded"}'::jsonb, 'first_paid는 저장된 Pro 플랜에서도 기록한다'
);
insert into _tap(line) select is(
  public.record_metric('00000000-0000-4000-8000-000000000034', 'upgrade_click', 'summary'),
  '{"kind":"unchanged"}'::jsonb, 'direct 결제 뒤의 클릭은 귀속을 바꾸지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000034'
    and upgrade_source = 'direct' and first_click_at is null), 'direct 귀속과 null 클릭을 유지한다'
);
insert into _tap(line)
select is(
  public.record_metric('00000000-0000-4000-8000-000000000099', event_name, source),
  '{"kind":"user_not_found"}'::jsonb, '없는 사용자의 ' || event_name || '는 user_not_found다'
)
from (values ('teaser_seen', null::text), ('upgrade_click', 'trend'), ('first_paid', null::text)) as events(event_name, source);
insert into _tap(line) select is(
  (select count(*) from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000099'),
  0::bigint, '없는 사용자의 지표 행은 만들지 않는다'
);
insert into _tap(line) select throws_ok(
  $$select public.record_metric('00000000-0000-4000-8000-000000000031', 'unknown', null)$$,
  '22023', null, '알 수 없는 event는 입력 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.record_metric('00000000-0000-4000-8000-000000000031', null, null)$$,
  '22023', null, 'null event도 입력 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.record_metric('00000000-0000-4000-8000-000000000032', 'upgrade_click', 'direct')$$,
  '22023', null, 'Pro여도 클릭의 direct source는 입력 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.record_metric('00000000-0000-4000-8000-000000000031', 'upgrade_click', null)$$,
  '22023', null, '클릭의 null source도 입력 오류다'
);

insert into _tap(line) select is(
  public.set_merchant_category('00000000-0000-4000-8000-000000000031', '테스트가맹점', 'grocery'),
  '{"kind":"updated","updated":2}'::jsonb, '같은 가맹점의 서로 다른 달 거래 두 건을 바꾼다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where user_id = '00000000-0000-4000-8000-000000000031'
    and merchant_key = '테스트가맹점' and category = 'grocery'),
  2::bigint, '두 거래의 카테고리가 함께 바뀐다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.merchant_category_overrides where user_id = '00000000-0000-4000-8000-000000000031'
    and merchant_key = '테스트가맹점' and category = 'grocery' and updated_at = now()),
  '수정값과 updated_at을 같은 트랜잭션에 저장한다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where user_id = '00000000-0000-4000-8000-000000000031'
    and merchant_key = '다른가맹점' and category = 'shopping'),
  4::bigint, '같은 사용자의 다른 가맹점 네 거래는 바뀌지 않는다'
);
insert into _tap(line) select is(
  (select category from public.transactions where user_id = '00000000-0000-4000-8000-000000000032'
    and merchant_key = '테스트가맹점'), 'food', '다른 사용자의 같은 가맹점 거래는 바뀌지 않는다'
);
update public.merchant_category_overrides set updated_at = '2006-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000031' and merchant_key = '테스트가맹점';
insert into _tap(line) select is(
  public.set_merchant_category('00000000-0000-4000-8000-000000000031', '테스트가맹점', 'grocery'),
  '{"kind":"updated","updated":0}'::jsonb, '같은 카테고리로 다시 저장하면 바뀐 거래 수는 0이다'
);
insert into _tap(line) select is(
  (select updated_at from public.merchant_category_overrides where user_id = '00000000-0000-4000-8000-000000000031'
    and merchant_key = '테스트가맹점'), now(), '거래 변경이 없어도 수정값의 updated_at을 갱신한다'
);
insert into _tap(line) select is(
  public.set_merchant_category('00000000-0000-4000-8000-000000000031', '없는가맹점', 'food'),
  '{"kind":"not_found"}'::jsonb, '자신의 거래가 없는 가맹점은 not_found다'
);
insert into _tap(line) select is(
  (select count(*) from public.merchant_category_overrides where user_id = '00000000-0000-4000-8000-000000000031'
    and merchant_key = '없는가맹점'), 0::bigint, '거래 없는 가맹점의 수정값을 저장하지 않는다'
);
insert into _tap(line) select is(
  public.set_merchant_category('00000000-0000-4000-8000-000000000033', '테스트가맹점', 'food'),
  '{"kind":"not_found"}'::jsonb, '다른 사용자에게만 거래가 있는 가맹점도 not_found다'
);
insert into _tap(line) select is(
  (select count(*) from public.merchant_category_overrides where user_id = '00000000-0000-4000-8000-000000000033'),
  0::bigint, '다른 사용자의 가맹점으로 수정값을 만들지 않는다'
);
insert into _tap(line) select throws_ok(
  $$select public.set_merchant_category('00000000-0000-4000-8000-000000000031', '테스트가맹점', 'unknown')$$,
  '23514', null, '고정 14개 밖의 카테고리는 테이블 제약 오류다'
);
insert into _tap(line) select is(
  (select category from public.merchant_category_overrides where user_id = '00000000-0000-4000-8000-000000000031'
    and merchant_key = '테스트가맹점'), 'grocery', '잘못된 카테고리는 기존 수정값을 바꾸지 않는다'
);

insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000031',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first')),
  '{"kind":"deleted"}'::jsonb, 'delete_upload로 첫 업로드를 지운다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_first')
    and user_id = '00000000-0000-4000-8000-000000000031' and deleted_at = now()
    and outcome = 'done' and extends_period), '삭제 시각과 성공·재방문 이력을 시도 행에 보존한다'
);
insert into _tap(line) select is(
  (select deleted_at from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_later')),
  null::timestamptz, '다른 업로드의 삭제 시각은 그대로 null이다'
);

reset role;
set local role authenticated;
insert into _tap(line) select throws_ok(
  'select * from public.user_metrics', '42501', null, 'authenticated는 지표를 읽을 수 없다'
);
insert into _tap(line) select throws_ok(
  $$select public.record_metric('00000000-0000-4000-8000-000000000031', 'teaser_seen', null)$$,
  '42501', null, 'authenticated는 측정 RPC를 실행할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$select public.set_merchant_category('00000000-0000-4000-8000-000000000031', '다른가맹점', 'food')$$,
  '42501', null, 'authenticated는 카테고리 RPC를 실행할 수 없다'
);
reset role;
set local role anon;
insert into _tap(line) select throws_ok(
  'select * from public.user_metrics', '42501', null, 'anon은 지표를 읽을 수 없다'
);
reset role;

insert into _tap(line) select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000000031'$$,
  '업로드·시도·지표가 있는 auth 사용자를 cascade 오류 없이 지운다'
);
insert into _tap(line) select is(
  (select count(*) from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000031'),
  0::bigint, 'auth 사용자 삭제 시 지표도 cascade로 지워진다'
);
insert into _tap(line) select is(
  (select count(*) from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000031'),
  0::bigint, 'auth 사용자 삭제 시 시도도 cascade로 지워진다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.user_metrics where user_id = '00000000-0000-4000-8000-000000000032')
    and exists(select 1 from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000032'),
  '다른 사용자의 지표와 시도는 남는다'
);

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
