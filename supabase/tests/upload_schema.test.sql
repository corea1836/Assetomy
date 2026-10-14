begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to authenticated, anon;
grant usage on sequence _tap_n_seq to authenticated, anon;
insert into _tap(line) select plan(63);

insert into _tap(line)
select has_table('public', table_name::name, table_name || ' 테이블이 있다')
from unnest(array[
  'cards', 'uploads', 'transactions', 'upload_attempts', 'merchant_category_overrides'
]) as tables(table_name);

insert into _tap(line)
select ok(
  coalesce((
    select c.relrowsecurity
    from pg_class as c
    join pg_namespace as ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = table_name
  ), false),
  table_name || '에 RLS가 켜져 있다'
)
from unnest(array[
  'cards', 'uploads', 'transactions', 'upload_attempts', 'merchant_category_overrides'
]) as tables(table_name);

insert into _tap(line)
select table_privs_are(
  'public', table_name::name, 'authenticated',
  case when table_name = 'upload_attempts' then array[]::text[] else array['SELECT'] end,
  'authenticated는 ' || table_name || '에 허용된 SELECT만 가진다'
)
from unnest(array[
  'cards', 'uploads', 'transactions', 'upload_attempts', 'merchant_category_overrides'
]) as tables(table_name);

insert into _tap(line)
select table_privs_are(
  'public', table_name::name, 'anon', array[]::text[],
  'anon은 ' || table_name || '에 권한이 없다'
)
from unnest(array[
  'cards', 'uploads', 'transactions', 'upload_attempts', 'merchant_category_overrides'
]) as tables(table_name);

-- service_role에 기존 기본 권한이 더 있어도 필수 네 권한은 모두 있어야 한다.
insert into _tap(line)
select ok(
  (
    select bool_and(has_table_privilege('service_role', 'public.' || table_name, privilege))
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as privileges(privilege)
  ),
  'service_role은 ' || table_name || '의 SELECT·INSERT·UPDATE·DELETE 권한이 있다'
)
from unnest(array[
  'cards', 'uploads', 'transactions', 'upload_attempts', 'merchant_category_overrides'
]) as tables(table_name);

insert into _tap(line) select ok(
  (
    select count(*) = 4 and bool_and(cmd = 'SELECT' and roles = array['authenticated']::name[])
    from pg_policies
    where schemaname = 'public' and tablename in (
      'cards', 'uploads', 'transactions', 'upload_attempts', 'merchant_category_overrides'
    )
  ),
  '공개 스키마의 다섯 테이블에는 authenticated SELECT 정책 네 개만 있다'
);
insert into _tap(line) select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'upload_attempts'),
  0::bigint,
  'upload_attempts에는 사용자 정책이 없다'
);
insert into _tap(line) select is(
  (
    select count(*)
    from pg_constraint as c
    join pg_attribute as a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.upload_attempts'::regclass
      and c.contype = 'f' and a.attname = 'upload_id'
  ),
  0::bigint,
  'upload_attempts.upload_id에는 FK가 없다'
);

-- 클라우드 dev의 기존 사용자와 무관한 A·B를 만들고 마지막에 롤백한다.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'upload-schema-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'upload-schema-b@example.invalid');

insert into public.cards (id, user_id, label, issuer, analysis_basis, identity_scope, cancel_style) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '테스트 카드', 'hyundai', 'month', 'content', 'negative_amount'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   '테스트 카드', 'hyundai', 'month', null, null);

insert into public.uploads (
  id, user_id, card_id, file_name, file_hash, file_size, status,
  inserted_count, duplicate_count, skipped_count, period_from, period_to, net_amount, completed_at
) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 'fixture-a.pdf', repeat('a', 64), 100, 'done',
   1, 0, 0, '2026-10-01', '2026-10-01', 10000, now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', 'fixture-b.pdf', repeat('b', 64), 100, 'done',
   1, 0, 0, '2026-10-02', '2026-10-02', 20000, now());

insert into public.transactions (
  id, user_id, card_id, upload_id, used_on, merchant, merchant_key,
  amount, event_kind, category, fingerprint
) values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '2026-10-01', '테스트 가맹점 A', '테스트가맹점a', 10000, 'purchase', 'food', repeat('c', 64)),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002',
   '2026-10-02', '테스트 가맹점 B', '테스트가맹점b', 20000, 'purchase', 'cafe', repeat('d', 64));

insert into public.merchant_category_overrides (user_id, merchant_key, category) values
  ('00000000-0000-4000-8000-000000000001', '테스트가맹점a', 'food'),
  ('00000000-0000-4000-8000-000000000002', '테스트가맹점b', 'cafe');

insert into public.upload_attempts (id, user_id, upload_id, outcome, completed_at) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000001', 'done', now());

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-000000000001', 'role', 'authenticated'
)::text, true);

insert into _tap(line) select results_eq(
  'select id from public.cards order by id',
  array['10000000-0000-4000-8000-000000000001'::uuid],
  'A에게는 A의 카드만 보인다'
);
insert into _tap(line) select results_eq(
  'select id from public.uploads order by id',
  array['20000000-0000-4000-8000-000000000001'::uuid],
  'A에게는 A의 업로드만 보인다'
);
insert into _tap(line) select results_eq(
  'select id from public.transactions order by id',
  array['30000000-0000-4000-8000-000000000001'::uuid],
  'A에게는 A의 거래만 보인다'
);
insert into _tap(line) select results_eq(
  'select merchant_key from public.merchant_category_overrides order by merchant_key',
  array['테스트가맹점a'::text],
  'A에게는 A의 카테고리 수정값만 보인다'
);

insert into _tap(line) select throws_ok(
  $$insert into public.cards (user_id, label)
    values ('00000000-0000-4000-8000-000000000001', '추가 카드')$$,
  '42501', null, 'authenticated는 카드를 직접 추가할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set category = 'etc'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated는 거래를 직접 수정할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$delete from public.uploads where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated는 업로드를 직접 삭제할 수 없다'
);
insert into _tap(line) select throws_ok(
  'select * from public.upload_attempts',
  '42501', null, 'authenticated는 시도 이력을 읽을 수 없다'
);
reset role;

set local role anon;
insert into _tap(line) select throws_ok(
  'select * from public.cards',
  '42501', null, 'anon은 카드를 읽을 수 없다'
);
reset role;

insert into _tap(line) select throws_ok(
  $$insert into public.transactions (
      user_id, card_id, upload_id, used_on, merchant, merchant_key,
      amount, event_kind, category, fingerprint
    ) select user_id, card_id, upload_id, used_on, merchant, merchant_key,
      amount, event_kind, category, fingerprint
    from public.transactions where id = '30000000-0000-4000-8000-000000000001'$$,
  '23505', null, '같은 사용자의 같은 fingerprint는 중복 저장할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set event_kind = 'cancel'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', null, '양수 금액을 cancel로 저장할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set amount = -10000
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', null, '음수 금액을 purchase로 저장할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set category = 'unknown'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', null, '거래는 고정 14개 밖의 카테고리를 거절한다'
);
insert into _tap(line) select throws_ok(
  $$update public.merchant_category_overrides set category = 'unknown'
    where user_id = '00000000-0000-4000-8000-000000000001'$$,
  '23514', null, '카테고리 수정값도 고정 14개 밖의 값을 거절한다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set card_id = '10000000-0000-4000-8000-000000000001'
    where id = '30000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'B의 거래에 A의 카드를 지정할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set upload_id = '20000000-0000-4000-8000-000000000001'
    where id = '30000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'B의 거래에 A의 업로드를 지정할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.uploads set card_id = '10000000-0000-4000-8000-000000000001'
    where id = '20000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'B의 업로드에 A의 카드를 지정할 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.uploads set failure_code = 'bad code'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'uploads는 원문을 담은 잘못된 failure_code를 거절한다'
);
insert into _tap(line) select throws_ok(
  $$update public.upload_attempts set failure_code = 'bad code'
    where id = '40000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'upload_attempts도 잘못된 failure_code를 거절한다'
);
insert into _tap(line) select throws_ok(
  $$update public.uploads set status = 'processing'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'processing에는 lease가 필요하다'
);
insert into _tap(line) select throws_ok(
  $$update public.uploads set lease_expires_at = now() + interval '6 minutes'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  '23514', null, '종료 상태에는 lease를 남길 수 없다'
);
insert into _tap(line) select throws_ok(
  $$update public.cards set identity_scope = 'content'
    where id = '10000000-0000-4000-8000-000000000002'$$,
  '23514', null, '카드의 식별 범위와 취소 표기 방식은 함께 설정한다'
);
insert into _tap(line) select throws_ok(
  $$update public.cards set label = ' 테스트 카드 '
    where id = '10000000-0000-4000-8000-000000000001'$$,
  '23514', null, '카드 라벨 앞뒤의 공백을 거절한다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set amount = 9007199254740992
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', null, '안전한 정수 범위를 넘는 금액을 거절한다'
);
insert into _tap(line) select throws_ok(
  $$update public.transactions set amount = '-9223372036854775808'::bigint, event_kind = 'cancel'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'bigint 최솟값도 오버플로 없이 제약 위반으로 거절한다'
);
insert into _tap(line) select lives_ok(
  $$update public.transactions set amount = 9007199254740991
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '안전한 정수의 양수 상한을 저장할 수 있다'
);
insert into _tap(line) select lives_ok(
  $$update public.transactions set amount = -9007199254740991, event_kind = 'cancel'
    where id = '30000000-0000-4000-8000-000000000001'$$,
  '안전한 정수의 음수 하한을 저장할 수 있다'
);

delete from public.uploads where id = '20000000-0000-4000-8000-000000000001';
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = '20000000-0000-4000-8000-000000000001'),
  0::bigint,
  '업로드를 삭제하면 해당 업로드의 거래가 cascade로 삭제된다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where id = '30000000-0000-4000-8000-000000000002'),
  1::bigint,
  '다른 업로드의 거래는 남는다'
);
insert into _tap(line) select is(
  (select count(*) from public.upload_attempts where upload_id = '20000000-0000-4000-8000-000000000001'),
  1::bigint,
  '업로드를 삭제해도 시도 이력과 upload_id는 남는다'
);

insert into _tap(line) select ok(
  exists(select 1 from storage.buckets where id = 'statements' and name = 'statements'),
  'statements 버킷이 있다'
);
insert into _tap(line) select is(
  (select public from storage.buckets where id = 'statements'),
  false,
  'statements 버킷은 private이다'
);
insert into _tap(line) select is(
  (select file_size_limit from storage.buckets where id = 'statements'),
  4195328::bigint,
  '버킷 용량 상한은 원본 4MB와 암호화 헤더용 1KB이다'
);
insert into _tap(line) select is(
  (select allowed_mime_types from storage.buckets where id = 'statements'),
  array['application/octet-stream']::text[],
  '버킷에는 암호화 바이트열용 MIME만 허용한다'
);
insert into _tap(line) select is(
  (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%statements%' or coalesce(with_check, '') like '%statements%')
  ),
  0::bigint,
  'statements를 위한 Storage 사용자 정책은 없다'
);

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
