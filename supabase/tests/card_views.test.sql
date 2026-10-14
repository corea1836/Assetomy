begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to authenticated, anon, service_role;
grant usage on sequence _tap_n_seq to authenticated, anon, service_role;
insert into _tap(line) select plan(82);

create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line) select has_table('public', 'card_summaries', 'card_summaries 테이블이 있다');
insert into _tap(line) select columns_are(
  'public', 'card_summaries', array[
    'user_id', 'card_id', 'period', 'plan', 'model', 'input_hash', 'summary', 'tips', 'created_at', 'updated_at'
  ], '카드 요약에 필요한 열 열 개가 있다'
);
insert into _tap(line) select col_type_is(
  'public', 'card_summaries', 'tips', 'text[]', 'tips는 text[]다'
);
insert into _tap(line) select col_is_pk(
  'public', 'card_summaries', array['user_id', 'card_id', 'period'], '(user_id, card_id, period)가 기본 키다'
);
insert into _tap(line) select ok(
  exists(select 1 from pg_constraint where conname = 'card_summaries_user_id_card_id_fkey'
    and contype = 'f' and conrelid = 'public.card_summaries'::regclass
    and confrelid = 'public.cards'::regclass and confdeltype = 'c'),
  'user_id·card_id 복합 FK는 cards를 참조하고 cascade 삭제한다'
);
insert into _tap(line) select ok(
  (select relrowsecurity from pg_class where oid = 'public.card_summaries'::regclass),
  'card_summaries에 RLS가 켜져 있다'
);
insert into _tap(line) select ok(
  (
    select count(*) = 1 and bool_and(
      policyname = 'card_summaries_select_own' and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
    )
    from pg_policies where schemaname = 'public' and tablename = 'card_summaries'
  ), 'authenticated의 본인 SELECT 정책 하나만 있다'
);
insert into _tap(line) select table_privs_are(
  'public', 'card_summaries', 'anon', array[]::text[], 'anon은 카드 요약 테이블 권한이 없다'
);
insert into _tap(line) select table_privs_are(
  'public', 'card_summaries', 'authenticated', array['SELECT'],
  'authenticated는 카드 요약 SELECT 권한만 가진다'
);
insert into _tap(line) select ok(
  (select bool_and(has_table_privilege('service_role', 'public.card_summaries', privilege))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)),
  'service_role은 카드 요약 SELECT·INSERT·UPDATE·DELETE 권한이 있다'
);
insert into _tap(line)
select ok(
  has_function_privilege(role_name,
    'public.save_card_summary(uuid,uuid,text,text,text,text,text,text[])', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 save_card_summary EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line)
select ok(
  has_function_privilege(role_name,
    'public.update_card(uuid,uuid,text,text,integer)', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 update_card EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.save_card_summary(uuid,uuid,text,text,text,text,text,text[])'::regprocedure),
  'save_card_summary는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.update_card(uuid,uuid,text,text,integer)'::regprocedure),
  'update_card는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'private.delete_card_summaries_for_upload()'::regprocedure),
  '업로드 삭제 트리거 함수만 definer 권한과 빈 search_path를 쓴다'
);
insert into _tap(line)
select ok(
  has_function_privilege(role_name, 'private.delete_card_summaries_for_upload()', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 업로드 트리거 함수 EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line) select ok(
  exists(select 1 from pg_trigger where tgrelid = 'public.uploads'::regclass
    and tgname = 'uploads_card_summaries' and not tgisinternal
    and position('old.status' in pg_get_expr(tgqual, tgrelid)) > 0
    and position('done' in pg_get_expr(tgqual, tgrelid)) > 0),
  'uploads_card_summaries는 done 업로드 삭제에만 연결된다'
);

-- 클라우드 dev의 기존 사용자와 무관한 A·B이며 마지막에 롤백한다.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000061', 'card-views-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000062', 'card-views-b@example.invalid');

set local role service_role;
insert into _rpc select 'card_ma', public.create_card(
  '00000000-0000-4000-8000-000000000061', 'MA', 'hyundai', 'month', null
);
insert into _rpc select 'card_mb', public.create_card(
  '00000000-0000-4000-8000-000000000061', 'MB', 'hyundai', 'month', null
);
insert into _rpc select 'card_ca', public.create_card(
  '00000000-0000-4000-8000-000000000061', 'CA', 'hyundai', 'cycle', 12
);
insert into _rpc select 'card_b', public.create_card(
  '00000000-0000-4000-8000-000000000062', 'B 카드', 'shinhan', 'month', null
);

insert into _rpc select 'upload_ma', public.begin_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'card_id')::uuid,
  'ma.csv', repeat('1', 64), 100
) from _rpc where name = 'card_ma';
insert into _rpc select 'ingest_ma', public.ingest_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-05', 'merchant', 'MA 거래', 'merchant_key', 'MA거래',
      'amount', 12000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('a', 64))
  ), 0, 'hyundai', '현대카드MM', null, null
) from _rpc where name = 'upload_ma';
insert into _rpc select 'upload_mb', public.begin_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'card_id')::uuid,
  'mb.csv', repeat('2', 64), 100
) from _rpc where name = 'card_mb';
insert into _rpc select 'ingest_mb', public.ingest_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-06', 'merchant', 'MB 거래', 'merchant_key', 'MB거래',
      'amount', 13000, 'event_kind', 'purchase', 'category', 'cafe', 'fingerprint', repeat('b', 64))
  ), 0, 'hyundai', null, null, null
) from _rpc where name = 'upload_mb';
insert into _rpc select 'upload_ca', public.begin_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'card_id')::uuid,
  'ca-first.pdf', repeat('3', 64), 100
) from _rpc where name = 'card_ca';
insert into _rpc select 'ingest_ca', public.ingest_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'upload_id')::uuid,
  'content', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-07', 'merchant', 'CA 첫 거래', 'merchant_key', 'CA첫거래',
      'amount', 14000, 'event_kind', 'purchase', 'category', 'shopping', 'fingerprint', repeat('c', 64))
  ), 0, 'hyundai', '현대카드MM', '2026-10-23', '2026-10-10 00:00:00+00'
) from _rpc where name = 'upload_ca';
insert into _rpc select 'upload_b', public.begin_upload(
  '00000000-0000-4000-8000-000000000062', (result->>'card_id')::uuid,
  'b.csv', repeat('4', 64), 100
) from _rpc where name = 'card_b';
insert into _rpc select 'ingest_b', public.ingest_upload(
  '00000000-0000-4000-8000-000000000062', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-08', 'merchant', 'B 거래', 'merchant_key', 'B거래',
      'amount', 15000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('d', 64))
  ), 0, 'shinhan', null, null, null
) from _rpc where name = 'upload_b';
reset role;

insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_ma'), 'done', 'MA 월 거래 fixture를 만든다');
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_mb'), 'done', 'MB 월 거래 fixture를 만든다');
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_ca'), 'done', 'CA 청구서 거래 fixture를 만든다');
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_b'), 'done', 'B 사용자 거래 fixture를 만든다');

set local role service_role;
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('1', 64), 'MA 10월 요약', array['카드 앱에서 확인해 보세요'])->>'kind',
  'saved', 'MA의 2026-10 월 요약을 저장한다'
);
reset role;
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma') and period = '2026-10'),
  1::bigint, '월 요약 저장으로 행 하나가 생긴다'
);
reset role;
update public.card_summaries set updated_at = '2001-01-01 00:00:00+00'
where user_id = '00000000-0000-4000-8000-000000000061'
  and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma') and period = '2026-10';
set local role service_role;
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'pro',
    'claude-opus-5-5', repeat('2', 64), 'MA 다시 쓴 요약', array['첫 팁', '둘째 팁'])->>'kind',
  'saved', '같은 MA 월 키를 새 입력으로 다시 저장한다'
);
reset role;
insert into _tap(line) select is(
  (select jsonb_build_object('count', count(*), 'summary', min(summary), 'tips', min(tips),
      'input_hash', min(input_hash), 'updated_at', min(updated_at) > '2001-01-01 00:00:00+00'::timestamptz)
    from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
      and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma') and period = '2026-10'),
  jsonb_build_object('count', 1, 'summary', 'MA 다시 쓴 요약', 'tips', array['첫 팁', '둘째 팁'],
    'input_hash', repeat('2', 64), 'updated_at', true),
  '재저장은 한 행을 유지하고 요약·팁·해시·updated_at을 갱신한다'
);
set local role service_role;
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-09', 'free',
    'claude-sonnet-5-5', repeat('3', 64), '없는 달', array['팁'])->>'kind',
  'no_data', 'MA에 2026-09 거래가 없으면 no_data다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10-23', 'free',
    'claude-sonnet-5-5', repeat('3', 64), '잘못된 기준', array['팁'])->>'kind',
  'basis_mismatch', '월별 MA에 날짜 period를 주면 basis_mismatch다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), '2026-10-23', 'free',
    'claude-sonnet-5-5', repeat('4', 64), 'CA 명세서 요약', array['팁'])->>'kind',
  'saved', 'CA의 2026-10-23 done 청구서 요약을 저장한다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), '2026-09-23', 'free',
    'claude-sonnet-5-5', repeat('5', 64), '없는 명세서', array['팁'])->>'kind',
  'no_data', 'CA에 2026-09-23 done 업로드가 없으면 no_data다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('5', 64), '잘못된 월', array['팁'])->>'kind',
  'basis_mismatch', 'cycle CA에 월 period를 주면 basis_mismatch다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), '2026-02-30', 'free',
    'claude-sonnet-5-5', repeat('5', 64), '없는 날짜', array['팁'])->>'kind',
  'no_data', '존재하지 않는 날짜 문자열은 예외 없이 no_data다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000062',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('6', 64), '타인 카드', array['팁'])->>'kind',
  'card_not_found', 'B가 A의 카드 id를 넘기면 card_not_found다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    '00000000-0000-4000-8000-000000000099', '2026-10', 'free',
    'claude-sonnet-5-5', repeat('6', 64), '없는 카드', array['팁'])->>'kind',
  'card_not_found', '없는 카드 id는 card_not_found다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), null, 'free',
    'claude-sonnet-5-5', repeat('6', 64), 'null period', array['팁'])$$,
  '22023', 'INVALID_PERIOD', 'null period는 INVALID_PERIOD다'
);

-- 데이터 제약은 서버 권한으로 직접 저장해도 우회할 수 없다.
reset role;
set local role postgres;
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-13', 'free', 'm', repeat('a', 64), 's', array['t'])$$,
  '23514', null, 'period 2026-13은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10-32', 'free', 'm', repeat('a', 64), 's', array['t'])$$,
  '23514', null, 'period 2026-10-32는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '202610', 'free', 'm', repeat('a', 64), 's', array['t'])$$,
  '23514', null, '기간의 구분 기호가 없으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'team', 'm', repeat('a', 64), 's', array['t'])$$,
  '23514', null, '허용되지 않은 plan은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'free', 'm', 'abc', 's', array['t'])$$,
  '23514', null, '잘못된 input_hash는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'free', 'm', repeat('a', 64), 's', array[]::text[])$$,
  '23514', null, '빈 tips 배열은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips)
    values ('00000000-0000-4000-8000-000000000061',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'free', 'm', repeat('a', 64), 's', array['1','2','3','4','5','6'])$$,
  '23514', null, 'tips 여섯 개는 제약 오류다'
);
reset role;

-- done 업로드 삭제는 해당 카드의 요약을 모두 지우고 다른 카드 요약은 보존한다.
set local role service_role;
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_mb'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('7', 64), 'MB 요약', array['팁'])->>'kind',
  'saved', 'MB 보존용 요약을 저장한다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000062',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_b'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('8', 64), 'B 요약', array['팁'])->>'kind',
  'saved', 'B 사용자의 보존용 요약을 저장한다'
);
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000061',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_ma'))->>'kind',
  'deleted', 'delete_upload로 MA의 done 업로드를 지운다'
);
reset role;
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma')),
  0::bigint, 'MA의 done 업로드 삭제가 MA 요약을 모두 지운다'
);
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_mb')),
  1::bigint, 'MA 업로드 삭제 뒤 MB 요약은 남는다'
);

-- MA는 삭제 후 새 데이터를 받아 월별 요약을 다시 만들고 update_card를 검증한다.
set local role service_role;
insert into _rpc select 'upload_ma_again', public.begin_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'card_id')::uuid,
  'ma-again.csv', repeat('5', 64), 100
) from _rpc where name = 'card_ma';
insert into _rpc select 'ingest_ma_again', public.ingest_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-09', 'merchant', 'MA 새 거래', 'merchant_key', 'MA새거래',
      'amount', 16000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('e', 64))
  ), 0, 'hyundai', '현대카드MM', null, null
) from _rpc where name = 'upload_ma_again';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_ma_again'), 'done', 'MA의 새 월 거래를 다시 저장한다');
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('9', 64), 'MA 재생성 요약', array['팁'])->>'kind',
  'saved', 'MA 재업로드 거래로 요약을 다시 만든다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '  생활비  ', 'month', null)->>'kind',
  'updated', 'MA 이름만 공백을 정리해 변경한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('label', label, 'summary_count',
      (select count(*) from public.card_summaries s where s.user_id = c.user_id and s.card_id = c.id),
      'issuer', issuer, 'product_name', product_name)
    from public.cards c where c.id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma')),
  jsonb_build_object('label', '생활비', 'summary_count', 1, 'issuer', 'hyundai', 'product_name', '현대카드MM'),
  '이름 저장은 요약·카드사·상품명을 보존한다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), 'MB', 'month', null)->>'kind',
  'duplicate_label', '다른 카드 라벨과 겹치면 duplicate_label이다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '생활비', 'month', null)->>'kind',
  'updated', '자기 라벨 그대로 저장할 수 있다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '   ', 'month', null)->>'kind',
  'invalid_label', '공백 라벨은 invalid_label이다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), repeat('가', 31), 'month', null)->>'kind',
  'invalid_label', '31자 라벨은 invalid_label이다'
);
insert into _tap(line) select throws_ok(
  $$select public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '생활비', 'month', 12)$$,
  '23514', null, 'month와 cycle 시작일 조합은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '생활비', 'cycle', null)$$,
  '23514', null, 'cycle에 시작일이 없으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '생활비', 'cycle', 32)$$,
  '23514', null, 'cycle 시작일 32는 제약 오류다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000062',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '타인 카드', 'month', null)->>'kind',
  'not_found', 'B가 A의 카드를 수정하면 not_found다'
);
insert into _tap(line) select is(
  (select label from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma')),
  '생활비', 'B의 수정 요청은 A 카드 행을 바꾸지 않는다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    '00000000-0000-4000-8000-000000000099', '없는 카드', 'month', null)->>'kind',
  'not_found', '없는 카드 수정은 not_found다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ma'), '생활비', 'cycle', 12)->>'kind',
  'updated', 'MA를 cycle 12일 기준으로 바꾼다'
);
reset role;
insert into _tap(line) select is(
  (select jsonb_build_object('analysis_basis', analysis_basis, 'cycle_start_day', cycle_start_day,
      'summary_count', (select count(*) from public.card_summaries s where s.user_id = c.user_id and s.card_id = c.id),
      'issuer', issuer, 'product_name', product_name)
    from public.cards c where c.id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ma')),
  jsonb_build_object('analysis_basis', 'cycle', 'cycle_start_day', 12, 'summary_count', 0,
    'issuer', 'hyundai', 'product_name', '현대카드MM'),
  '분석 기준 변경은 MA 요약을 지우고 카드사·상품명은 유지한다'
);
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_mb')),
  1::bigint, 'MA 기준 변경에도 A의 MB 요약은 남는다'
);
set local role service_role;
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), '2026-10-23', 'pro',
    'claude-opus-5-5', repeat('a', 64), 'CA 교체 전 요약', array['팁'])->>'kind',
  'saved', 'CA 교체 트리거 검증용 요약을 저장한다'
);
insert into _rpc select 'upload_ca_replacement', public.begin_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'card_id')::uuid,
  'ca-replacement.pdf', repeat('6', 64), 100
) from _rpc where name = 'card_ca';
insert into _rpc select 'ingest_ca_replacement', public.ingest_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'upload_id')::uuid,
  'content', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-08', 'merchant', 'CA 새 거래', 'merchant_key', 'CA새거래',
      'amount', 17000, 'event_kind', 'purchase', 'category', 'shopping', 'fingerprint', repeat('f', 64))
  ), 0, 'hyundai', '현대카드MM', '2026-10-23', '2026-10-12 00:00:00+00'
) from _rpc where name = 'upload_ca_replacement';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_ca_replacement'), 'done', '더 늦은 같은 청구서 파일이 교체 ingest된다');
insert into _tap(line) select is(
  (select result->>'replaced_upload_id' from _rpc where name = 'ingest_ca_replacement'),
  (select result->>'upload_id' from _rpc where name = 'upload_ca'),
  '같은 청구서 교체 결과에 이전 upload id가 있다'
);
reset role;
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ca')),
  0::bigint, '청구서 교체로 CA 요약을 모두 지운다'
);
set local role service_role;
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), '2026-10-23', 'free',
    'claude-sonnet-5-5', repeat('b', 64), 'CA 다시 저장한 요약', array['팁'])->>'kind',
  'saved', '교체 후 CA 요약을 다시 저장한다'
);
insert into _tap(line) select is(
  public.update_card('00000000-0000-4000-8000-000000000061',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_ca'), 'CA', 'cycle', 15)->>'kind',
  'updated', 'CA 이용 기간 시작일을 12일에서 15일로 바꾼다'
);
reset role;
insert into _tap(line) select is(
  (select jsonb_build_object('cycle_start_day', cycle_start_day,
      'summary_count', (select count(*) from public.card_summaries s where s.user_id = c.user_id and s.card_id = c.id))
    from public.cards c where c.id = (select (result->>'card_id')::uuid from _rpc where name = 'card_ca')),
  jsonb_build_object('cycle_start_day', 15, 'summary_count', 0),
  'CA 시작일 변경은 해당 카드 요약을 지운다'
);
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_mb')),
  1::bigint, 'CA 기준 변경에도 A의 MB 요약은 남는다'
);
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000062'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_b')),
  1::bigint, 'A의 카드 수정은 B 요약을 건드리지 않는다'
);

-- failed 업로드 삭제는 done 전용 트리거를 통과하지 않고 MB 캐시를 유지한다.
set local role service_role;
insert into _rpc select 'upload_failed_mb', public.begin_upload(
  '00000000-0000-4000-8000-000000000061', (result->>'card_id')::uuid,
  'failed.csv', repeat('7', 64), 100
) from _rpc where name = 'card_mb';
reset role;
set local role postgres;
update public.uploads set status = 'failed', lease_expires_at = null,
  failure_code = 'UNREADABLE', completed_at = now()
where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_failed_mb');
delete from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_failed_mb');
reset role;
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_mb')),
  1::bigint, 'postgres가 failed 업로드를 지워도 MB 요약은 남는다'
);

set local role postgres;
insert into _tap(line) select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000000061'$$,
  'Auth 사용자 삭제 cascade가 카드 요약 트리거 오류 없이 끝난다'
);
reset role;
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000061'),
  0::bigint, 'Auth 사용자 삭제 뒤 A의 카드 요약은 없다'
);
insert into _tap(line) select is(
  (select count(*) from public.card_summaries where user_id = '00000000-0000-4000-8000-000000000062'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_b')),
  1::bigint, 'Auth 사용자 A 삭제 뒤 B 요약은 남는다'
);

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
