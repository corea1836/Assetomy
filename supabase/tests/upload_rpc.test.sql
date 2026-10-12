begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to service_role;
grant usage on sequence _tap_n_seq to service_role;
insert into _tap(line) select plan(100);

-- RPC 결과와 입력 fixture만 보관한다. 동작 검사는 service_role로 호출한다.
create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line)
select ok(
  has_function_privilege(role_name, signature, 'EXECUTE') = (role_name = 'service_role'),
  role_name || '의 ' || signature || ' EXECUTE 권한이 올바르다'
)
from (values
  ('public.create_card(uuid,text)'),
  ('public.begin_upload(uuid,uuid,text,text,integer)'),
  ('public.ingest_upload(uuid,uuid,text,text,jsonb,integer)'),
  ('public.fail_upload(uuid,uuid,text,text)'),
  ('public.delete_upload(uuid,uuid)'),
  ('private.lock_user(uuid)')
) as functions(signature)
cross join unnest(array['anon', 'authenticated', 'service_role']) as roles(role_name);

insert into _tap(line) select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE')
    and has_schema_privilege('service_role', 'private', 'USAGE'),
  'private 스키마는 service_role만 사용할 수 있다'
);
insert into _tap(line) select ok(
  (
    select count(*) = 6 and bool_and(
      not p.prosecdef and p.proconfig @> array['search_path=""']::text[]
    )
    from pg_proc as p
    where p.oid in (
      'public.create_card(uuid,text)'::regprocedure,
      'public.begin_upload(uuid,uuid,text,text,integer)'::regprocedure,
      'public.ingest_upload(uuid,uuid,text,text,jsonb,integer)'::regprocedure,
      'public.fail_upload(uuid,uuid,text,text)'::regprocedure,
      'public.delete_upload(uuid,uuid)'::regprocedure,
      'private.lock_user(uuid)'::regprocedure
    )
  ),
  '여섯 함수는 invoker 권한과 빈 search_path를 쓴다'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000011', 'upload-rpc-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000012', 'upload-rpc-b@example.invalid');

insert into _rpc(name, result) values ('rows_three', jsonb_build_array(
  jsonb_build_object('used_on', '2026-10-01', 'merchant', '테스트 식당',
    'merchant_key', '테스트식당', 'amount', 10000, 'event_kind', 'purchase',
    'category', 'food', 'fingerprint', repeat('a', 64)),
  jsonb_build_object('used_on', '2026-10-03', 'merchant', '테스트 카페',
    'merchant_key', '테스트카페', 'amount', 20000, 'event_kind', 'purchase',
    'category', 'cafe', 'fingerprint', repeat('b', 64)),
  jsonb_build_object('used_on', '2026-09-30', 'merchant', '테스트 환불',
    'merchant_key', '테스트환불', 'amount', -5000, 'event_kind', 'cancel',
    'category', 'etc', 'fingerprint', repeat('c', 64))
));
insert into _rpc(name, result) values ('rows_new', jsonb_build_array(
  jsonb_build_object('used_on', '2026-10-04', 'merchant', '테스트 마트',
    'merchant_key', '테스트마트', 'amount', 7000, 'event_kind', 'purchase',
    'category', 'grocery', 'fingerprint', repeat('d', 64))
));

set local role service_role;

insert into _rpc select 'card_a', public.create_card(
  '00000000-0000-4000-8000-000000000011', ' 테스트 카드 '
);
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'card_a'), 'created',
  'create_card는 앞뒤 공백을 제거하고 카드를 만든다'
);
insert into _tap(line) select is(
  (select label from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_a')),
  '테스트 카드', 'trim한 라벨을 저장한다'
);
insert into _tap(line) select is(
  public.create_card('00000000-0000-4000-8000-000000000011', '테스트 카드'),
  '{"kind":"duplicate_label"}'::jsonb, '같은 사용자의 같은 라벨은 중복이다'
);
insert into _tap(line) select is(
  public.create_card('00000000-0000-4000-8000-000000000011', '   '),
  '{"kind":"invalid_label"}'::jsonb, '공백만 있는 라벨은 거절한다'
);
insert into _tap(line) select is(
  public.create_card('00000000-0000-4000-8000-000000000011', null),
  '{"kind":"invalid_label"}'::jsonb, 'null 라벨은 거절한다'
);
insert into _tap(line) select is(
  public.create_card('00000000-0000-4000-8000-000000000011', repeat('가', 31)),
  '{"kind":"invalid_label"}'::jsonb, '31자 라벨은 거절한다'
);
insert into _rpc select 'card_b', public.create_card(
  '00000000-0000-4000-8000-000000000012', '테스트 카드'
);
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'card_b'), 'created',
  '다른 사용자는 같은 라벨로 카드를 만들 수 있다'
);
insert into _rpc select 'card_a_other', public.create_card(
  '00000000-0000-4000-8000-000000000011', '다른 카드'
);

insert into _tap(line) select is(
  public.begin_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_b'),
    'fixture.pdf', repeat('0', 64), 100),
  '{"kind":"card_not_found"}'::jsonb, 'B의 카드로 A가 업로드를 시작할 수 없다'
);
insert into _tap(line) select is(
  public.begin_upload('00000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000099', 'fixture.pdf', repeat('0', 64), 100),
  '{"kind":"card_not_found"}'::jsonb, '없는 카드도 같은 결과를 반환한다'
);
insert into _tap(line) select is(
  (select count(*) from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000011'),
  0::bigint, '소유권 거절에는 시도를 기록하지 않는다'
);

insert into _rpc select 'busy_first', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'busy-first.pdf', repeat('1', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'busy_second', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'busy-second.pdf', repeat('2', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'busy_first'), 'started', '첫 업로드를 시작한다'
);
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'busy_second'), 'started', '두 번째 업로드를 시작한다'
);
insert into _tap(line) select is(
  (select (result->>'lease_expires_at')::timestamptz from _rpc where name = 'busy_first'),
  now() + interval '6 minutes', '시작 결과에 6분 lease를 반환한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where
    upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'busy_first')
    and outcome is null), '시작한 업로드를 outcome null인 시도와 연결한다'
);
insert into _tap(line) select is(
  public.begin_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_a'),
    'busy-third.pdf', repeat('3', 64), 100),
  '{"kind":"busy"}'::jsonb, 'lease가 살아 있는 두 업로드 뒤에는 busy다'
);
insert into _tap(line) select is(
  (select count(*) from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000011'),
  2::bigint, 'busy에는 시도를 기록하지 않는다'
);
reset role;
update public.uploads set lease_expires_at = now() - interval '1 second'
where id = (select (result->>'upload_id')::uuid from _rpc where name = 'busy_first');
set local role service_role;
insert into _rpc select 'busy_after_expiry', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'after-expiry.pdf', repeat('3', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'busy_after_expiry'), 'started',
  '만료된 processing은 동시 처리 한도에서 제외한다'
);

reset role;
delete from public.uploads where user_id = '00000000-0000-4000-8000-000000000011';
delete from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000011';
insert into public.upload_attempts (user_id)
select '00000000-0000-4000-8000-000000000011'::uuid from generate_series(1, 30);
set local role service_role;
insert into _tap(line) select is(
  public.begin_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_a'),
    'limited.pdf', repeat('4', 64), 100),
  '{"kind":"rate_limited"}'::jsonb, '24시간 안에 시도가 30개면 rate_limited다'
);
insert into _tap(line) select is(
  (select count(*) from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000011'),
  30::bigint, 'rate_limited에는 시도를 기록하지 않는다'
);
reset role;
update public.upload_attempts set created_at = now() - interval '25 hours'
where user_id = '00000000-0000-4000-8000-000000000011';
insert into public.upload_attempts (user_id)
select '00000000-0000-4000-8000-000000000011'::uuid from generate_series(1, 29);
set local role service_role;
insert into _rpc select 'rate_old_ignored', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'old-ignored.pdf', repeat('4', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'rate_old_ignored'), 'started',
  '25시간 전의 시도는 세지 않아 최근 29개에서 시작할 수 있다'
);
insert into _tap(line) select is(
  public.begin_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'card_id')::uuid from _rpc where name = 'card_a'),
    'limited-again.pdf', repeat('5', 64), 100),
  '{"kind":"rate_limited"}'::jsonb, '이번 시작으로 최근 30개가 되면 다음 시도는 막힌다'
);

reset role;
delete from public.uploads where user_id = '00000000-0000-4000-8000-000000000011';
delete from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000011';
set local role service_role;
insert into _rpc select 'upload_three', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'three.pdf', repeat('5', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_three', public.ingest_upload(
  '00000000-0000-4000-8000-000000000011', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 2
) from _rpc as u cross join _rpc as r where u.name = 'upload_three' and r.name = 'rows_three';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_three'),
  '{"kind":"done","inserted":3,"duplicates":0,"skipped":2,"period_from":"2026-09-30","period_to":"2026-10-03","net_amount":25000}'::jsonb,
  '3행을 저장하고 실제 행의 기간과 환불 포함 합계를 반환한다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')),
  3::bigint, '3행이 같은 업로드에 저장됐다'
);
insert into _tap(line) select is(
  (select jsonb_build_array(identity_scope, cancel_style) from public.cards
    where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_a')),
  '["content","negative_amount"]'::jsonb, '첫 성공이 카드의 식별 범위와 취소 방식을 고정한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('status', status, 'inserted', inserted_count,
    'duplicates', duplicate_count, 'skipped', skipped_count, 'period_from', period_from,
    'period_to', period_to, 'net_amount', net_amount) from public.uploads
    where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')),
  '{"status":"done","inserted":3,"duplicates":0,"skipped":2,"period_from":"2026-09-30","period_to":"2026-10-03","net_amount":25000}'::jsonb,
  '업로드에 계산한 결과를 함께 저장한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')
    and lease_expires_at is null and completed_at = now()), '완료 업로드는 lease를 해제하고 완료 시각을 저장한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')
    and outcome = 'done' and completed_at = now()), '시도도 done으로 끝낸다'
);

insert into _rpc select 'begin_duplicate', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'duplicate.pdf', repeat('5', 64), 100
) from _rpc where name = 'card_a_other';
insert into _tap(line) select is(
  (select result from _rpc where name = 'begin_duplicate'),
  jsonb_build_object('kind', 'duplicate', 'existing_card_id',
    (select result->>'card_id' from _rpc where name = 'card_a')),
  '같은 파일을 다른 카드에 올려도 기존 카드 id와 duplicate를 반환한다'
);
insert into _tap(line) select is(
  (select count(*) from public.uploads where user_id = '00000000-0000-4000-8000-000000000011'),
  1::bigint, 'begin 중복에서는 업로드 행을 만들지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where user_id = '00000000-0000-4000-8000-000000000011'
    and upload_id is null and outcome = 'no_new' and completed_at = now()),
  'begin 중복은 업로드 없는 no_new 시도를 남긴다'
);

insert into _rpc select 'upload_fingerprints', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'fingerprints.pdf', repeat('6', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_fingerprints', public.ingest_upload(
  '00000000-0000-4000-8000-000000000011', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 1
) from _rpc as u cross join _rpc as r where u.name = 'upload_fingerprints' and r.name = 'rows_three';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_fingerprints'),
  '{"kind":"no_new","inserted":0,"duplicates":3,"skipped":1,"period_from":null,"period_to":null,"net_amount":0}'::jsonb,
  '다른 업로드의 같은 fingerprint 3행은 no_new이며 기간은 null이다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where user_id = '00000000-0000-4000-8000-000000000011'),
  3::bigint, 'fingerprint 중복을 다시 저장하지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_fingerprints')
    and outcome = 'no_new' and completed_at = now()), 'fingerprint 중복 시도는 no_new로 끝난다'
);

insert into _rpc select 'upload_mixed', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'mixed.pdf', repeat('7', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'ingest_mixed', public.ingest_upload(
  '00000000-0000-4000-8000-000000000011', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', old_rows.result || new_rows.result, 0
) from _rpc as u cross join _rpc as old_rows cross join _rpc as new_rows
where u.name = 'upload_mixed' and old_rows.name = 'rows_three' and new_rows.name = 'rows_new';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_mixed'),
  '{"kind":"done","inserted":1,"duplicates":3,"skipped":0,"period_from":"2026-10-04","period_to":"2026-10-04","net_amount":7000}'::jsonb,
  '일부 중복에서는 새로 들어간 행만으로 기간과 합계를 계산한다'
);

insert into _rpc select 'same_hash_first', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'same-hash-first.pdf', repeat('8', 64), 100
) from _rpc where name = 'card_a';
insert into _rpc select 'same_hash_second', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'same-hash-second.pdf', repeat('8', 64), 100
) from _rpc where name = 'card_a_other';
insert into _rpc select 'ingest_hash_first', public.ingest_upload(
  '00000000-0000-4000-8000-000000000011', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', jsonb_set(r.result, '{0,fingerprint}', to_jsonb(repeat('e', 64))), 0
) from _rpc as u cross join _rpc as r where u.name = 'same_hash_first' and r.name = 'rows_new';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'ingest_hash_first'), 'done', '같은 해시의 첫 processing은 저장한다'
);
insert into _rpc select 'ingest_hash_second', public.ingest_upload(
  '00000000-0000-4000-8000-000000000011', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', jsonb_set(r.result, '{0,fingerprint}', to_jsonb(repeat('f', 64))), 3
) from _rpc as u cross join _rpc as r where u.name = 'same_hash_second' and r.name = 'rows_new';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_hash_second'),
  jsonb_build_object('kind', 'duplicate', 'existing_card_id', (select result->>'card_id' from _rpc where name = 'card_a')),
  '같은 해시의 두 번째 processing은 기존 카드와 duplicate를 반환한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('status', status, 'inserted', inserted_count, 'duplicates', duplicate_count,
    'skipped', skipped_count, 'lease', lease_expires_at, 'completed_at', completed_at) from public.uploads
    where id = (select (result->>'upload_id')::uuid from _rpc where name = 'same_hash_second')),
  jsonb_build_object('status', 'no_new', 'inserted', 0, 'duplicates', 1, 'skipped', 3, 'lease', null, 'completed_at', now()),
  '동시 파일 중복은 결과 개수와 완료 상태를 저장하고 lease를 해제한다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'same_hash_second')),
  0::bigint, '파일 중복은 다른 fingerprint라도 저장하지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'same_hash_second')
    and outcome = 'no_new' and completed_at = now()), '동시 파일 중복 시도를 no_new로 끝낸다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_a_other')
    and identity_scope is null and cancel_style is null), 'no_new는 카드의 식별 범위를 고정하지 않는다'
);

insert into _rpc select 'upload_expired', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'expired.pdf', repeat('9', 64), 100
) from _rpc where name = 'card_a';
reset role;
update public.uploads set lease_expires_at = now() - interval '1 second'
where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_expired');
set local role service_role;
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_expired'), 'content', 'negative_amount', '[]', 0),
  '{"kind":"lease_expired"}'::jsonb, '만료 lease는 늦은 ingest를 거절한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_expired')
    and status = 'failed' and failure_code = 'LEASE_EXPIRED' and lease_expires_at is null and completed_at = now()),
  '만료 업로드를 LEASE_EXPIRED로 종료한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_expired')
    and outcome = 'failed' and failure_code = 'LEASE_EXPIRED' and completed_at = now()), '만료 시도도 실패로 종료한다'
);

insert into _rpc select 'upload_scope', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'scope.pdf', repeat('a', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_scope'), 'approval_number', 'negative_amount', '[]', 0),
  '{"kind":"card_scope_mismatch"}'::jsonb, '고정된 content 카드에는 approval_number를 섞을 수 없다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_scope')
    and status = 'failed' and failure_code = 'CARD_SCOPE_MISMATCH' and lease_expires_at is null and completed_at = now()),
  '범위가 다른 업로드는 실패로 끝난다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_scope')
    and outcome = 'failed' and failure_code = 'CARD_SCOPE_MISMATCH' and completed_at = now()), '범위가 다른 시도도 실패로 끝난다'
);
insert into _rpc select 'upload_cancel_style', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'cancel-style.pdf', repeat('b', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_cancel_style'), 'content', null, '[]', 0),
  '{"kind":"card_scope_mismatch"}'::jsonb, '취소 방식이 null로 바뀌어도 고정된 쌍의 불일치로 거절한다'
);
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three'), 'content', 'negative_amount', '[]', 0),
  '{"kind":"not_processing","status":"done"}'::jsonb, 'done 업로드는 재ingest하지 않는다'
);
insert into _rpc select 'upload_b', public.begin_upload(
  '00000000-0000-4000-8000-000000000012', (result->>'card_id')::uuid,
  'b.pdf', repeat('5', 64), 100
) from _rpc where name = 'card_b';
insert into _tap(line) select is(
  (select result->>'kind' from _rpc where name = 'upload_b'), 'started', '다른 사용자의 같은 해시는 중복으로 보지 않는다'
);
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_b'), 'content', 'negative_amount', '[]', 0),
  '{"kind":"not_found"}'::jsonb, 'B의 업로드 ingest는 not_found다'
);
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    '20000000-0000-4000-8000-000000000099', 'content', 'negative_amount', '[]', 0),
  '{"kind":"not_found"}'::jsonb, '없는 업로드 ingest도 not_found다'
);

insert into _rpc select 'upload_invalid', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'invalid.pdf', repeat('c', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'),
    'content', 'negative_amount',
    (select jsonb_set(result, '{0,fingerprint}', to_jsonb(repeat('f', 64)))
      || jsonb_set(jsonb_set(result, '{0,fingerprint}', to_jsonb(repeat('0', 64))),
      '{0,category}', '"unknown"'::jsonb) from _rpc where name = 'rows_new'), 0)$$,
  '23514', null, '14개 밖의 카테고리는 제약 위반이다'
);
insert into _tap(line) select is(
  (select status from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid')),
  'processing', '제약 위반 뒤 업로드는 processing 그대로다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid')),
  0::bigint, '잘못된 행과 함께 넣으려던 유효 행도 저장되지 않는다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid')
    and outcome is null and completed_at is null), '제약 위반 뒤 시도도 완료되지 않는다'
);
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'),
    'content', 'negative_amount', (select jsonb_agg('{}'::jsonb) from generate_series(1, 5001)), 0)$$,
  '22023', null, '5001행은 입력 형식 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'),
    'content', 'negative_amount', '{}'::jsonb, 0)$$,
  '22023', null, '배열이 아닌 p_rows는 입력 형식 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'),
    'content', 'negative_amount', null, 0)$$,
  '22023', null, 'SQL null p_rows도 입력 형식 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'),
    'content', 'negative_amount', '[]'::jsonb, -1)$$,
  '22023', null, '음수 p_skipped는 입력 형식 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'),
    'content', 'negative_amount', '[]'::jsonb, null)$$,
  '22023', null, 'null p_skipped는 입력 형식 오류다'
);

insert into _tap(line) select is(
  public.fail_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid'), 'UNREADABLE', 'total_mismatch'),
  '{"kind":"failed"}'::jsonb, 'processing 업로드를 명시적으로 실패 처리한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid')
    and status = 'failed' and failure_code = 'UNREADABLE' and failure_reason = 'total_mismatch'
    and lease_expires_at is null and completed_at = now()), '실패 코드와 reason 코드만 저장하고 lease를 해제한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_invalid')
    and outcome = 'failed' and failure_code = 'UNREADABLE' and completed_at = now()), '명시적 실패는 시도에도 코드를 저장한다'
);
insert into _tap(line) select is(
  public.fail_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three'), 'UNREADABLE', null),
  '{"kind":"not_processing","status":"done"}'::jsonb, 'done 업로드는 실패로 덮어쓰지 않는다'
);
insert into _tap(line) select is(
  public.fail_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_b'), 'UNREADABLE', null),
  '{"kind":"not_found"}'::jsonb, 'B의 업로드 fail은 not_found다'
);
insert into _tap(line) select is(
  public.fail_upload('00000000-0000-4000-8000-000000000011',
    '20000000-0000-4000-8000-000000000099', 'UNREADABLE', null),
  '{"kind":"not_found"}'::jsonb, '없는 업로드 fail도 not_found다'
);

insert into _rpc select 'upload_bad_code', public.begin_upload(
  '00000000-0000-4000-8000-000000000011', (result->>'card_id')::uuid,
  'bad-code.pdf', repeat('d', 64), 100
) from _rpc where name = 'card_a';
insert into _tap(line) select throws_ok(
  $$select public.fail_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code'), 'bad code', null)$$,
  '23514', null, '원문 형태의 잘못된 실패 코드는 제약으로 거절한다'
);
insert into _tap(line) select throws_ok(
  $$select public.fail_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code'), 'UNREADABLE', 'raw message')$$,
  '23514', null, '원문 형태의 잘못된 reason도 제약으로 거절한다'
);
insert into _tap(line) select is(
  (select status from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code')),
  'processing', '잘못된 실패 입력은 업로드 상태를 바꾸지 않는다'
);

insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')),
  '{"kind":"deleted"}'::jsonb, 'done 업로드를 삭제한다'
);
insert into _tap(line) select is(
  (select count(*) from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')),
  0::bigint, '삭제한 업로드 행은 남지 않는다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')),
  0::bigint, '삭제한 업로드의 거래는 cascade로 지워진다'
);
insert into _tap(line) select is(
  (select count(*) from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three') and outcome = 'done'),
  1::bigint, '업로드를 삭제해도 시도 행과 outcome은 남는다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_mixed')),
  1::bigint, '다른 업로드에 저장된 거래는 남는다'
);
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code')),
  '{"kind":"processing"}'::jsonb, 'lease가 살아 있는 processing은 삭제하지 않는다'
);
insert into _tap(line) select is(
  (select count(*) from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code')),
  1::bigint, '삭제 거절된 processing 행은 남는다'
);
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_b')),
  '{"kind":"not_found"}'::jsonb, 'B의 업로드 delete는 not_found다'
);
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three')),
  '{"kind":"not_found"}'::jsonb, '이미 삭제한 업로드도 not_found다'
);
reset role;
update public.uploads set lease_expires_at = now() - interval '1 second'
where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code');
set local role service_role;
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_bad_code')),
  '{"kind":"deleted"}'::jsonb, 'lease가 만료된 processing은 삭제할 수 있다'
);
insert into _tap(line) select is(
  public.ingest_upload('00000000-0000-4000-8000-000000000011',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_three'), 'content', 'negative_amount', '[]', 0),
  '{"kind":"not_found"}'::jsonb, '삭제 뒤 도착한 ingest는 거래를 복원하지 않는다'
);
reset role;

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
