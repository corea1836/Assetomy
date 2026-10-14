begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to authenticated, anon, service_role;
grant usage on sequence _tap_n_seq to authenticated, anon, service_role;
insert into _tap(line) select plan(62);

create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line) select has_table('public', 'ai_summaries', 'ai_summaries 테이블이 있다');
insert into _tap(line) select columns_are(
  'public', 'ai_summaries', array[
    'user_id', 'month', 'plan', 'model', 'input_hash', 'summary', 'created_at', 'updated_at', 'tips'
  ], '요약 저장에 필요한 아홉 컬럼이 있다'
);
insert into _tap(line) select col_type_is(
  'public', 'ai_summaries', 'tips', 'text[]', 'tips는 text[]다'
);
insert into _tap(line) select hasnt_function(
  'public', 'save_ai_summary', array['uuid', 'text', 'text', 'text', 'text', 'text'],
  '팁 없는 옛 save_ai_summary 시그니처는 없다'
);
insert into _tap(line) select col_is_pk(
  'public', 'ai_summaries', array['user_id', 'month'], '(user_id, month)가 기본 키다'
);
insert into _tap(line) select ok(
  (select relrowsecurity from pg_class where oid = 'public.ai_summaries'::regclass),
  'ai_summaries에 RLS가 켜져 있다'
);
insert into _tap(line) select ok(
  (
    select count(*) = 1 and bool_and(
      policyname = 'ai_summaries_select_own' and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
    )
    from pg_policies where schemaname = 'public' and tablename = 'ai_summaries'
  ), 'authenticated의 본인 SELECT 정책 하나만 있다'
);
insert into _tap(line) select table_privs_are(
  'public', 'ai_summaries', 'anon', array[]::text[], 'anon은 요약 테이블 권한이 없다'
);
insert into _tap(line) select table_privs_are(
  'public', 'ai_summaries', 'authenticated', array['SELECT'],
  'authenticated는 요약 SELECT 권한만 가진다'
);
insert into _tap(line) select ok(
  (select bool_and(has_table_privilege('service_role', 'public.ai_summaries', privilege))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)),
  'service_role은 요약 SELECT·INSERT·UPDATE·DELETE 권한이 있다'
);
insert into _tap(line)
select ok(
  has_function_privilege(role_name,
    'public.save_ai_summary(uuid,text,text,text,text,text,text[])', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 save_ai_summary EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line)
select ok(
  has_function_privilege(role_name, 'public.delete_upload(uuid,uuid)', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 delete_upload EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.save_ai_summary(uuid,text,text,text,text,text,text[])'::regprocedure),
  'save_ai_summary는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.delete_upload(uuid,uuid)'::regprocedure),
  'delete_upload은 invoker 권한과 빈 search_path를 쓴다'
);

-- 클라우드 dev의 기존 사용자와 무관한 임시 사용자이며 마지막에 롤백한다.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000041', 'ai-summaries-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000042', 'ai-summaries-b@example.invalid'),
  ('00000000-0000-4000-8000-000000000043', 'ai-summaries-c@example.invalid'),
  ('00000000-0000-4000-8000-000000000044', 'ai-summaries-d@example.invalid');

set local role service_role;
insert into _rpc select 'card_a', public.create_card(
  '00000000-0000-4000-8000-000000000041', '요약 테스트 카드 A', 'hyundai', 'month', null
);
insert into _rpc select 'card_b', public.create_card(
  '00000000-0000-4000-8000-000000000042', '요약 테스트 카드 B', 'hyundai', 'month', null
);
insert into _rpc select 'card_c', public.create_card(
  '00000000-0000-4000-8000-000000000043', '요약 테스트 카드 C', 'hyundai', 'month', null
);

insert into _rpc select 'upload_a1', public.begin_upload(
  '00000000-0000-4000-8000-000000000041', (result->>'card_id')::uuid,
  'a1.csv', repeat('1', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'upload_a2', public.begin_upload(
  '00000000-0000-4000-8000-000000000041', (result->>'card_id')::uuid,
  'a2.csv', repeat('2', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'upload_b', public.begin_upload(
  '00000000-0000-4000-8000-000000000042', (result->>'card_id')::uuid,
  'b.csv', repeat('4', 64), 100
) from _rpc where name = 'card_b';

insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-07', 'free',
    'claude-sonnet-5-5', repeat('a', 64), '7월 요약', array['카드사 앱에서 확인해 보세요'])->>'kind',
  'no_transactions', '거래가 없는 A의 달은 no_transactions다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-07'),
  0::bigint, '거래가 없는 달에는 요약 행을 만들지 않는다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000042', '2026-09', 'free',
    'claude-sonnet-5-5', repeat('b', 64), '9월 요약', array['카드사 앱에서 확인해 보세요'])->>'kind',
  'no_transactions', 'A의 거래는 B의 거래로 세지 않는다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000042' and month = '2026-09'),
  0::bigint, '거래가 없는 B의 달에도 요약 행을 만들지 않는다'
);

insert into _rpc select 'ingest_a1', public.ingest_upload(
  '00000000-0000-4000-8000-000000000041', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-08-31', 'merchant', '8월 가맹점',
      'merchant_key', '8월가맹점', 'amount', 10000, 'event_kind', 'purchase',
      'category', 'food', 'fingerprint', repeat('a', 64)),
    jsonb_build_object('used_on', '2026-09-01', 'merchant', '9월 초 가맹점',
      'merchant_key', '9월초가맹점', 'amount', 11000, 'event_kind', 'purchase',
      'category', 'food', 'fingerprint', repeat('b', 64)),
    jsonb_build_object('used_on', '2026-09-30', 'merchant', '9월 말 가맹점',
      'merchant_key', '9월말가맹점', 'amount', 12000, 'event_kind', 'purchase',
      'category', 'cafe', 'fingerprint', repeat('c', 64))
  ), 0
) from _rpc where name = 'upload_a1';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'ingest_a1'), 'done',
  'A의 첫 업로드 fixture를 저장한다'
);
insert into _rpc select 'ingest_a2', public.ingest_upload(
  '00000000-0000-4000-8000-000000000041', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-01', 'merchant', '10월 가맹점',
      'merchant_key', '10월가맹점', 'amount', 13000, 'event_kind', 'purchase',
      'category', 'shopping', 'fingerprint', repeat('d', 64))
  ), 0
) from _rpc where name = 'upload_a2';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'ingest_a2'), 'done',
  'A의 두 번째 업로드 fixture를 저장한다'
);
insert into _rpc select 'upload_a_processing', public.begin_upload(
  '00000000-0000-4000-8000-000000000041', (result->>'card_id')::uuid,
  'processing.csv', repeat('3', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_b', public.ingest_upload(
  '00000000-0000-4000-8000-000000000042', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-09-15', 'merchant', 'B 가맹점',
      'merchant_key', 'B가맹점', 'amount', 14000, 'event_kind', 'purchase',
      'category', 'food', 'fingerprint', repeat('e', 64))
  ), 0
) from _rpc where name = 'upload_b';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'ingest_b'), 'done',
  'B의 업로드 fixture를 저장한다'
);

insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-08', 'free',
    'claude-sonnet-5-5', repeat('8', 64), '8월 요약 A', array['카드사 앱에서 확인해 보세요'])->>'kind',
  'saved', 'A의 8월 말 거래로 8월 요약을 저장한다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free',
    'claude-sonnet-5-5', repeat('a', 64), '9월 요약 A', array['카드사 앱에서 확인해 보세요'])->>'kind',
  'saved', 'A의 거래가 있는 9월 요약을 저장한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('plan', plan, 'model', model, 'input_hash', input_hash, 'summary', summary, 'tips', tips)
    from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-09'),
  jsonb_build_object('plan', 'free', 'model', 'claude-sonnet-5-5',
    'input_hash', repeat('a', 64), 'summary', '9월 요약 A', 'tips', array['카드사 앱에서 확인해 보세요']),
  '저장된 요약 값은 입력과 같다'
);
update public.ai_summaries set created_at = '2001-01-01T00:00:00Z'
where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-09';
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'pro',
    'claude-opus-5-5', repeat('f', 64), '다시 쓴 9월 요약', array['첫 팁', '둘째 팁'])->>'kind',
  'saved', '같은 달 요약을 새 입력으로 갱신한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('count', count(*), 'plan', min(plan), 'model', min(model),
      'input_hash', min(input_hash), 'summary', min(summary), 'tips', min(tips),
      'created_at', min(created_at))
    from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-09'),
  jsonb_build_object('count', 1, 'plan', 'pro', 'model', 'claude-opus-5-5',
    'input_hash', repeat('f', 64), 'summary', '다시 쓴 9월 요약', 'tips', array['첫 팁', '둘째 팁'],
    'created_at', '2001-01-01T00:00:00Z'::timestamptz),
  '재저장은 행 하나를 갱신하고 created_at을 보존한다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-13', 'free', 'm', repeat('a', 64), 's', array['카드사 앱에서 확인해 보세요'])$$,
  '22023', null, '13월은 입력 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-9', 'free', 'm', repeat('a', 64), 's', array['카드사 앱에서 확인해 보세요'])$$,
  '22023', null, '연월 형식이 아니면 입력 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', null, 'free', 'm', repeat('a', 64), 's', array['카드사 앱에서 확인해 보세요'])$$,
  '22023', null, '월이 null이면 입력 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'team', 'm', repeat('a', 64), 's', array['카드사 앱에서 확인해 보세요'])$$,
  '23514', null, '허용되지 않은 플랜은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('A', 64), 's', array['카드사 앱에서 확인해 보세요'])$$,
  '23514', null, '대문자가 섞인 해시는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), '', array['카드사 앱에서 확인해 보세요'])$$,
  '23514', null, '빈 요약은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), 's', array[]::text[])$$,
  '23514', null, '팁이 없으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), 's', array['1', '2', '3', '4', '5', '6'])$$,
  '23514', null, '팁이 여섯 개면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), 's', array['팁', null])$$,
  '23514', null, 'null 팁은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), 's', array['팁', ''])$$,
  '23514', null, '빈 팁은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), 's', array[repeat('가', 1501)])$$,
  '23514', null, '팁 전체가 1500자를 넘으면 제약 오류다'
);

insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000042', '2026-09', 'free',
    'claude-sonnet-5-5', repeat('b', 64), '9월 요약 B', array['카드사 앱에서 확인해 보세요'])->>'kind',
  'saved', 'B 자신의 거래로 요약을 저장한다'
);
insert into _tap(line) select is(
  (select summary from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000042' and month = '2026-09'),
  '9월 요약 B', 'B 요약이 B 소유로 저장된다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-10', 'free',
    'claude-sonnet-5-5', repeat('c', 64), '10월 요약 A', array['카드사 앱에서 확인해 보세요'])->>'kind',
  'saved', 'A의 10월 요약을 업로드 삭제 회귀 fixture로 저장한다'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-000000000041', 'role', 'authenticated'
)::text, true);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries), 3::bigint,
  'authenticated A에게 자신의 세 요약만 보인다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000042'),
  0::bigint, 'authenticated A에게 B 요약은 보이지 않는다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.ai_summaries (user_id, month, plan, model, input_hash, summary)
    values ('00000000-0000-4000-8000-000000000041', '2026-11', 'free', 'm', repeat('d', 64), 's')$$,
  '42501', null, 'authenticated는 요약을 직접 insert할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.ai_summaries set summary = '변경'
    where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-09'$$,
  '42501', null, 'authenticated는 요약을 직접 update할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$delete from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-09'$$,
  '42501', null, 'authenticated는 요약을 직접 delete할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000041', '2026-09', 'free', 'm', repeat('a', 64), 's', array['카드사 앱에서 확인해 보세요'])$$,
  '42501', null, 'authenticated는 요약 RPC를 실행할 수 없다'
);
reset role;

set local role service_role;
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000041',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_a1'))->>'kind',
  'deleted', '완료 업로드를 삭제한다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000041' and month in ('2026-08', '2026-09')),
  0::bigint, '삭제 업로드 거래가 있던 8월·9월 요약은 제거된다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-10'),
  '다른 업로드 거래가 있는 A의 10월 요약은 유지된다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000042' and month = '2026-09'),
  '다른 사용자의 9월 요약은 유지된다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts
    where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_a1')
      and deleted_at = now()),
  '기존 uploads_deleted_at 트리거가 업로드 삭제 시각을 기록한다'
);
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000041',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_a_processing'))->>'kind',
  'processing', 'lease가 남은 처리 중 업로드는 삭제되지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-10'),
  '처리 중 업로드 삭제 거절은 요약을 유지한다'
);
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000041',
    '00000000-0000-4000-8000-000000000099')->>'kind',
  'not_found', '없는 업로드는 not_found다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000041' and month = '2026-10'),
  '없는 업로드 삭제도 요약을 유지한다'
);
reset role;

insert into _tap(line) select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000000041'$$,
  'A 사용자는 요약 cascade 오류 없이 삭제된다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000041'),
  0::bigint, 'Auth 삭제 시 A의 요약이 cascade로 지워진다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000042'),
  1::bigint, 'Auth 삭제 뒤에도 B의 요약은 남는다'
);

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
