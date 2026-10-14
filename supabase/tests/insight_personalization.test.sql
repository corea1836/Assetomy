begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to authenticated, anon, service_role;
grant usage on sequence _tap_n_seq to authenticated, anon, service_role;
insert into _tap(line) select plan(78);

create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line) select has_table('public', 'summary_feedback', 'summary_feedback 테이블이 있다');
insert into _tap(line) select columns_are(
  'public', 'summary_feedback', array['user_id', 'category', 'body', 'created_at', 'updated_at'],
  'summary_feedback에 필요한 다섯 열이 있다'
);
insert into _tap(line) select col_type_is('public', 'summary_feedback', 'category', 'text', 'category는 text다');
insert into _tap(line) select col_type_is('public', 'summary_feedback', 'body', 'text', 'body는 text다');
insert into _tap(line) select col_not_null('public', 'summary_feedback', 'user_id', 'user_id는 null이 아니다');
insert into _tap(line) select col_not_null('public', 'summary_feedback', 'category', 'category는 null이 아니다');
insert into _tap(line) select col_not_null('public', 'summary_feedback', 'body', 'body는 null이 아니다');
insert into _tap(line) select col_not_null('public', 'summary_feedback', 'created_at', 'created_at은 null이 아니다');
insert into _tap(line) select col_not_null('public', 'summary_feedback', 'updated_at', 'updated_at은 null이 아니다');
insert into _tap(line) select col_is_pk(
  'public', 'summary_feedback', array['user_id', 'category'], '(user_id, category)가 기본 키다'
);
insert into _tap(line) select ok(
  (select relrowsecurity from pg_class where oid = 'public.summary_feedback'::regclass),
  'summary_feedback에 RLS가 켜져 있다'
);
insert into _tap(line) select ok(
  (select count(*) = 1 and bool_and(
      policyname = 'summary_feedback_select_own' and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
    )
    from pg_policies where schemaname = 'public' and tablename = 'summary_feedback'),
  'authenticated의 본인 SELECT 정책 하나만 있다'
);
insert into _tap(line) select table_privs_are(
  'public', 'summary_feedback', 'anon', array[]::text[], 'anon은 피드백 테이블 권한이 없다'
);
insert into _tap(line) select table_privs_are(
  'public', 'summary_feedback', 'authenticated', array['SELECT'],
  'authenticated는 피드백 SELECT 권한만 가진다'
);
insert into _tap(line) select ok(
  (select bool_and(has_table_privilege('service_role', 'public.summary_feedback', privilege))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)),
  'service_role은 피드백 SELECT·INSERT·UPDATE·DELETE 권한이 있다'
);
insert into _tap(line)
select ok(
  has_function_privilege(role_name, 'public.save_summary_feedback(uuid,text,text)', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 save_summary_feedback EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line)
select ok(
  has_function_privilege(role_name,
    'public.save_ai_summary(uuid,text,text,text,text,text,text[],text[])', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 save_ai_summary EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line)
select ok(
  has_function_privilege(role_name,
    'public.save_card_summary(uuid,uuid,text,text,text,text,text,text[],text[])', 'EXECUTE')
    = (role_name = 'service_role'),
  role_name || '의 save_card_summary EXECUTE 권한이 올바르다'
)
from unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.save_summary_feedback(uuid,text,text)'::regprocedure),
  'save_summary_feedback는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.save_ai_summary(uuid,text,text,text,text,text,text[],text[])'::regprocedure),
  'save_ai_summary는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.save_card_summary(uuid,uuid,text,text,text,text,text,text[],text[])'::regprocedure),
  'save_card_summary는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select hasnt_function(
  'public', 'save_ai_summary', array['uuid', 'text', 'text', 'text', 'text', 'text', 'text[]'],
  'tip_categories 없는 옛 save_ai_summary 시그니처는 없다'
);
insert into _tap(line) select hasnt_function(
  'public', 'save_card_summary', array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text[]'],
  'tip_categories 없는 옛 save_card_summary 시그니처는 없다'
);
insert into _tap(line) select has_column('public', 'ai_summaries', 'tip_categories', 'ai_summaries.tip_categories가 있다');
insert into _tap(line) select col_type_is('public', 'ai_summaries', 'tip_categories', 'text[]', '월 요약 tip_categories는 text[]다');
insert into _tap(line) select col_not_null('public', 'ai_summaries', 'tip_categories', '월 요약 tip_categories는 null이 아니다');
insert into _tap(line) select has_column('public', 'card_summaries', 'tip_categories', 'card_summaries.tip_categories가 있다');
insert into _tap(line) select col_type_is('public', 'card_summaries', 'tip_categories', 'text[]', '카드 요약 tip_categories는 text[]다');
insert into _tap(line) select col_not_null('public', 'card_summaries', 'tip_categories', '카드 요약 tip_categories는 null이 아니다');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000071', 'insight-personalization-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000072', 'insight-personalization-b@example.invalid');

set local role service_role;
insert into _rpc select 'card_a', public.create_card(
  '00000000-0000-4000-8000-000000000071', '인사이트 테스트 카드', 'hyundai', 'month', null
);
insert into _rpc select 'upload_a', public.begin_upload(
  '00000000-0000-4000-8000-000000000071', (result->>'card_id')::uuid,
  'insight.csv', repeat('1', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_a', public.ingest_upload(
  '00000000-0000-4000-8000-000000000071', (result->>'upload_id')::uuid,
  'approval_number', 'negative_amount', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-05', 'merchant', '인사이트 가맹점',
      'merchant_key', '인사이트가맹점', 'amount', 12000, 'event_kind', 'purchase',
      'category', 'food', 'fingerprint', repeat('a', 64))
  ), 0, 'hyundai', null, null, null
) from _rpc where name = 'upload_a';
insert into _rpc select 'card_cycle_a', public.create_card(
  '00000000-0000-4000-8000-000000000071', '인사이트 이용 기간 카드', 'hyundai', 'cycle', 12
);
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_a'), 'done', 'A의 2026-10 거래 fixture를 저장한다');

reset role;
set local role postgres;
insert into _tap(line) select throws_ok(
  $$insert into public.summary_feedback (user_id, category, body)
    values ('00000000-0000-4000-8000-000000000071', 'coffee', '잘못된 카테고리')$$,
  '23514', null, '모르는 피드백 카테고리는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.summary_feedback (user_id, category, body)
    values ('00000000-0000-4000-8000-000000000071', 'food', '')$$,
  '23514', null, '빈 피드백은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.summary_feedback (user_id, category, body)
    values ('00000000-0000-4000-8000-000000000071', 'food', repeat('가', 101))$$,
  '23514', null, '101자 피드백은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.summary_feedback (user_id, category, body)
    values ('00000000-0000-4000-8000-000000000071', 'food', E'줄\n바꿈')$$,
  '23514', null, '줄바꿈 피드백은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.summary_feedback (user_id, category, body)
    values ('00000000-0000-4000-8000-000000000071', 'food', ' 앞 공백')$$,
  '23514', null, '앞 공백 피드백은 제약 오류다'
);
insert into _tap(line) select lives_ok(
  $$insert into public.summary_feedback (user_id, category, body)
    values ('00000000-0000-4000-8000-000000000071', 'etc', repeat('가', 100))$$,
  '100자 피드백은 저장된다'
);
insert into _tap(line) select is(
  (select char_length(body) from public.summary_feedback
    where user_id = '00000000-0000-4000-8000-000000000071' and category = 'etc'),
  100, '100자 피드백 길이가 유지된다'
);
delete from public.summary_feedback
where user_id = '00000000-0000-4000-8000-000000000071' and category = 'etc';

insert into _tap(line) select throws_ok(
  $$insert into public.ai_summaries (user_id, month, plan, model, input_hash, summary, tips, tip_categories)
    values ('00000000-0000-4000-8000-000000000071', '2026-12', 'free', 'm', repeat('a', 64), 's', array['첫 팁', '둘째 팁'], array['food'])$$,
  '23514', null, '월 요약 팁과 카테고리 길이가 다르면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.ai_summaries (user_id, month, plan, model, input_hash, summary, tips, tip_categories)
    values ('00000000-0000-4000-8000-000000000071', '2026-12', 'free', 'm', repeat('a', 64), 's', array['팁'], array['coffee'])$$,
  '23514', null, '월 요약의 모르는 팁 카테고리는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.ai_summaries (user_id, month, plan, model, input_hash, summary, tips, tip_categories)
    values ('00000000-0000-4000-8000-000000000071', '2026-12', 'free', 'm', repeat('a', 64), 's', array['두 팁', '둘째 팁'], array['food', null])$$,
  '23514', null, '월 요약의 null 팁 카테고리는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips, tip_categories)
    values ('00000000-0000-4000-8000-000000000071', (select (result->>'card_id')::uuid from _rpc where name = 'card_a'), '2026-12', 'free', 'm', repeat('a', 64), 's', array['첫 팁', '둘째 팁'], array['food'])$$,
  '23514', null, '카드 요약 팁과 카테고리 길이가 다르면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips, tip_categories)
    values ('00000000-0000-4000-8000-000000000071', (select (result->>'card_id')::uuid from _rpc where name = 'card_a'), '2026-12', 'free', 'm', repeat('a', 64), 's', array['팁'], array['coffee'])$$,
  '23514', null, '카드 요약의 모르는 팁 카테고리는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$insert into public.card_summaries (user_id, card_id, period, plan, model, input_hash, summary, tips, tip_categories)
    values ('00000000-0000-4000-8000-000000000071', (select (result->>'card_id')::uuid from _rpc where name = 'card_a'), '2026-12', 'free', 'm', repeat('a', 64), 's', array['첫 팁', '둘째 팁'], array['food', null])$$,
  '23514', null, '카드 요약의 null 팁 카테고리는 제약 오류다'
);

reset role;
set local role service_role;
insert into _tap(line) select is(
  public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'grocery', '평일 오전 커피예요')->>'kind',
  'saved', 'A의 grocery 피드백을 저장한다'
);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000071' and category = 'grocery'),
  1::bigint, 'A의 같은 카테고리 피드백 행은 하나다'
);
insert into _tap(line) select is(
  public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'grocery', '  주말 장보기예요  ')->>'kind',
  'saved', '같은 키의 A 피드백을 갱신한다'
);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000071' and category = 'grocery'),
  1::bigint, '피드백 수정 뒤에도 행은 하나다'
);
insert into _tap(line) select is(
  (select body from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000071' and category = 'grocery'),
  '주말 장보기예요', '피드백 수정 시 앞뒤 공백을 제거한다'
);
insert into _tap(line) select ok(
  (select updated_at >= created_at from public.summary_feedback
    where user_id = '00000000-0000-4000-8000-000000000071' and category = 'grocery'),
  '피드백 수정 시 updated_at은 created_at보다 늦거나 같다'
);
insert into _tap(line) select is(
  public.save_summary_feedback('00000000-0000-4000-8000-000000000072', 'grocery', 'B의 피드백')->>'kind',
  'saved', 'B의 grocery 피드백을 별도로 저장한다'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-000000000071', 'role', 'authenticated'
)::text, true);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback), 1::bigint,
  'authenticated A에게 A 피드백만 보인다'
);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000072'),
  0::bigint, 'authenticated A에게 B 피드백은 보이지 않는다'
);

reset role;
set local role service_role;
insert into _tap(line) select is(
  public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'grocery', '   ')->>'kind',
  'deleted', '공백만 있는 피드백은 삭제 kind를 반환한다'
);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000071' and category = 'grocery'),
  0::bigint, '공백 피드백 저장은 기존 행을 지운다'
);
insert into _tap(line) select is(
  public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'grocery', '   ')->>'kind',
  'deleted', '이미 없는 피드백도 deleted를 반환한다'
);
insert into _tap(line) select is(
  public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'food', null)->>'kind',
  'deleted', 'null 본문은 해당 카테고리의 deleted를 반환한다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_summary_feedback('00000000-0000-4000-8000-000000000071', null, '피드백')$$,
  '22023', 'INVALID_CATEGORY', 'null 카테고리는 INVALID_CATEGORY다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'coffee', '피드백')$$,
  '23514', null, '모르는 RPC 카테고리는 테이블 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_summary_feedback('00000000-0000-4000-8000-000000000071', 'food', repeat('가', 101))$$,
  '23514', null, '101자 RPC 피드백은 테이블 제약 오류다'
);
insert into _tap(line) select is(
  (select body from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000072' and category = 'grocery'),
  'B의 피드백', 'A의 피드백 저장·삭제와 무관하게 B 피드백은 남는다'
);

insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000071', '2026-10', 'free',
    'claude-sonnet-5-5', repeat('a', 64), '10월 요약', array['팁 하나', '팁 둘'], array['food', 'grocery'])->>'kind',
  'saved', 'A의 2026-10 거래가 있는 월 요약을 저장한다'
);
insert into _tap(line) select is(
  (select tip_categories from public.ai_summaries
    where user_id = '00000000-0000-4000-8000-000000000071' and month = '2026-10'),
  array['food', 'grocery'], '월 요약 팁 카테고리가 저장된다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000071', '2026-10', 'free',
    'claude-sonnet-5-5', repeat('b', 64), '갱신한 요약', array['팁 하나', '팁 둘'], array['food', 'etc'])->>'kind',
  'saved', '같은 월 키를 새 팁 카테고리로 갱신한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('count', count(*), 'tip_categories', min(tip_categories))
    from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000071' and month = '2026-10'),
  jsonb_build_object('count', 1, 'tip_categories', array['food', 'etc']),
  '월 요약 upsert는 행 하나와 새 tip_categories를 유지한다'
);
insert into _tap(line) select throws_ok(
  $$select public.save_ai_summary('00000000-0000-4000-8000-000000000071', '2026-10', 'free', 'm', repeat('a', 64), 's', array['팁 하나', '팁 둘'], array['food'])$$,
  '23514', null, '월 요약 팁 카테고리 길이 불일치는 제약 오류다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000071', '2026-11', 'free',
    'claude-sonnet-5-5', repeat('c', 64), '11월 요약', array['팁'], array['food'])->>'kind',
  'no_transactions', '거래가 없는 달은 no_transactions다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000071',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_a'), '2026-10', 'free',
    'claude-sonnet-5-5', repeat('d', 64), '카드 요약', array['카드 팁'], array['food'])->>'kind',
  'saved', '월별 카드 요약을 저장한다'
);
insert into _tap(line) select is(
  (select tip_categories from public.card_summaries
    where user_id = '00000000-0000-4000-8000-000000000071'
      and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_a') and period = '2026-10'),
  array['food'], '카드 요약 팁 카테고리가 저장된다'
);
insert into _tap(line) select is(
  public.save_card_summary('00000000-0000-4000-8000-000000000071',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_a'), '2026-10-23', 'free',
    'claude-sonnet-5-5', repeat('e', 64), '잘못된 기준', array['팁'], array['food'])->>'kind',
  'basis_mismatch', '월별 카드에 날짜 period를 주면 basis_mismatch다'
);

reset role;
insert into _tap(line) select lives_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-000000000071'$$,
  'Auth 사용자 삭제가 FK cascade로 완료된다'
);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000071'),
  0::bigint, 'Auth 삭제 후 A의 피드백은 없다'
);
insert into _tap(line) select is(
  (select count(*) from public.summary_feedback where user_id = '00000000-0000-4000-8000-000000000072' and category = 'grocery'),
  1::bigint, 'Auth 삭제 후 B의 피드백은 남는다'
);

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
