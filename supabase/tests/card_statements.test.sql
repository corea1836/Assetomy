begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- Management API는 마지막 SELECT만 반환하므로 모든 TAP 줄을 모은다.
create temp table _tap (n serial primary key, line text);
grant insert, select on _tap to service_role;
grant usage on sequence _tap_n_seq to service_role;
insert into _tap(line) select plan(76);

create temp table _rpc (name text primary key, result jsonb not null);
grant insert, select on _rpc to service_role;

insert into _tap(line) select has_column('public', 'cards', 'issuer', 'cards.issuer가 있다');
insert into _tap(line) select has_column('public', 'cards', 'analysis_basis', 'cards.analysis_basis가 있다');
insert into _tap(line) select has_column('public', 'cards', 'cycle_start_day', 'cards.cycle_start_day가 있다');
insert into _tap(line) select has_column('public', 'cards', 'product_name', 'cards.product_name이 있다');
insert into _tap(line) select col_not_null('public', 'cards', 'issuer', 'cards.issuer는 null이 아니다');
insert into _tap(line) select col_not_null('public', 'cards', 'analysis_basis', 'cards.analysis_basis는 null이 아니다');
insert into _tap(line) select has_column('public', 'uploads', 'statement_date', 'uploads.statement_date가 있다');
insert into _tap(line) select has_column('public', 'uploads', 'statement_saved_at', 'uploads.statement_saved_at이 있다');
insert into _tap(line) select has_index('public', 'uploads', 'uploads_done_statement_key', '청구서별 완료 업로드 unique index가 있다');

insert into _tap(line) select ok(
  has_function_privilege('anon', 'public.create_card(uuid,text,text,text,integer)', 'EXECUTE') = false,
  'anon은 새 create_card를 실행할 수 없다'
);
insert into _tap(line) select ok(
  has_function_privilege('authenticated', 'public.create_card(uuid,text,text,text,integer)', 'EXECUTE') = false,
  'authenticated는 새 create_card를 실행할 수 없다'
);
insert into _tap(line) select ok(
  has_function_privilege('service_role', 'public.create_card(uuid,text,text,text,integer)', 'EXECUTE'),
  'service_role은 새 create_card를 실행할 수 있다'
);
insert into _tap(line) select ok(
  has_function_privilege('anon', 'public.ingest_upload(uuid,uuid,text,text,jsonb,integer,text,text,date,timestamptz)', 'EXECUTE') = false,
  'anon은 새 ingest_upload를 실행할 수 없다'
);
insert into _tap(line) select ok(
  has_function_privilege('authenticated', 'public.ingest_upload(uuid,uuid,text,text,jsonb,integer,text,text,date,timestamptz)', 'EXECUTE') = false,
  'authenticated는 새 ingest_upload를 실행할 수 없다'
);
insert into _tap(line) select ok(
  has_function_privilege('service_role', 'public.ingest_upload(uuid,uuid,text,text,jsonb,integer,text,text,date,timestamptz)', 'EXECUTE'),
  'service_role은 새 ingest_upload를 실행할 수 있다'
);
insert into _tap(line) select ok(
  to_regprocedure('public.create_card(uuid,text)') is null,
  '옛 create_card 시그니처는 없다'
);
insert into _tap(line) select ok(
  to_regprocedure('public.ingest_upload(uuid,uuid,text,text,jsonb,integer)') is null,
  '옛 ingest_upload 시그니처는 없다'
);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.create_card(uuid,text,text,text,integer)'::regprocedure),
  '새 create_card는 invoker 권한과 빈 search_path를 쓴다'
);
insert into _tap(line) select ok(
  (select not prosecdef and proconfig @> array['search_path=""']::text[]
    from pg_proc where oid = 'public.ingest_upload(uuid,uuid,text,text,jsonb,integer,text,text,date,timestamptz)'::regprocedure),
  '새 ingest_upload는 invoker 권한과 빈 search_path를 쓴다'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000051', 'card-statements-a@example.invalid'),
  ('00000000-0000-4000-8000-000000000052', 'card-statements-b@example.invalid'),
  ('00000000-0000-4000-8000-000000000053', 'card-statements-c@example.invalid');

insert into _rpc(name, result) values
  ('rows_product_one', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-01', 'merchant', '상품 거래', 'merchant_key', '상품거래',
      'amount', 10000, 'event_kind', 'purchase', 'category', 'shopping', 'fingerprint', repeat('a', 64)))),
  ('rows_product_two', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-02', 'merchant', '상품 거래 둘', 'merchant_key', '상품거래둘',
      'amount', 11000, 'event_kind', 'purchase', 'category', 'shopping', 'fingerprint', repeat('b', 64)))),
  ('rows_no_new', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-03', 'merchant', '중복 거래', 'merchant_key', '중복거래',
      'amount', 12000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('c', 64)))),
  ('rows_null_card', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-04', 'merchant', '미상 카드 거래', 'merchant_key', '미상카드거래',
      'amount', 12500, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('d', 64)))),
  ('rows_statement_first', jsonb_build_array(
    jsonb_build_object('used_on', '2026-09-30', 'merchant', '겹치는 거래', 'merchant_key', '겹치는거래',
      'amount', 13000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('1', 64)),
    jsonb_build_object('used_on', '2026-10-01', 'merchant', '10월 거래 하나', 'merchant_key', '10월거래하나',
      'amount', 14000, 'event_kind', 'purchase', 'category', 'shopping', 'fingerprint', repeat('2', 64)),
    jsonb_build_object('used_on', '2026-10-03', 'merchant', '10월 거래 둘', 'merchant_key', '10월거래둘',
      'amount', 15000, 'event_kind', 'purchase', 'category', 'cafe', 'fingerprint', repeat('3', 64)))),
  ('rows_statement_new', jsonb_build_array(
    jsonb_build_object('used_on', '2026-09-30', 'merchant', '겹치는 거래', 'merchant_key', '겹치는거래',
      'amount', 13000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('1', 64)),
    jsonb_build_object('used_on', '2026-10-05', 'merchant', '새 거래', 'merchant_key', '새거래',
      'amount', 16000, 'event_kind', 'purchase', 'category', 'grocery', 'fingerprint', repeat('4', 64)))),
  ('rows_statement_other', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-06', 'merchant', '다른 거래', 'merchant_key', '다른거래',
      'amount', 17000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('5', 64)))),
  ('rows_statement_null_newer', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-07', 'merchant', '저장 시각 없는 신규 거래', 'merchant_key', '저장시각없는신규거래',
      'amount', 17500, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('7', 64)))),
  ('rows_statement_future_previous', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-08', 'merchant', '미래 저장 시각 기존 거래', 'merchant_key', '미래저장시각기존거래',
      'amount', 18000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('8', 64)))),
  ('rows_statement_future_newer', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-09', 'merchant', '미래 시각 제한 거래', 'merchant_key', '미래시각제한거래',
      'amount', 18500, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('9', 64)))),
  ('rows_statement_other_date', jsonb_build_array(
    jsonb_build_object('used_on', '2026-09-23', 'merchant', '다른 청구일 거래', 'merchant_key', '다른청구일거래',
      'amount', 19000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('e', 64)))),
  ('rows_statement_other_card', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-09', 'merchant', '다른 카드 거래', 'merchant_key', '다른카드거래',
      'amount', 20000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('f', 64)))),
  ('rows_statement_no_date', jsonb_build_array(
    jsonb_build_object('used_on', '2026-10-10', 'merchant', '청구일 없는 거래', 'merchant_key', '청구일없는거래',
      'amount', 21000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('0', 64)))),
  ('rows_user_b', jsonb_build_array(
    jsonb_build_object('used_on', '2026-09-15', 'merchant', '다른 사용자 거래', 'merchant_key', '다른사용자거래',
      'amount', 18000, 'event_kind', 'purchase', 'category', 'food', 'fingerprint', repeat('9', 64))));

set local role service_role;
insert into _rpc select 'card_month', public.create_card(
  '00000000-0000-4000-8000-000000000051', '월별 카드', 'hyundai', 'month', null
);
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'card_month'), 'created', '월별 카드가 만들어진다');
insert into _tap(line) select is(
  (select jsonb_build_object('issuer', issuer, 'analysis_basis', analysis_basis,
      'cycle_start_day', cycle_start_day, 'product_name', product_name)
    from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_month')),
  '{"issuer":"hyundai","analysis_basis":"month","cycle_start_day":null,"product_name":null}'::jsonb,
  '월별 카드의 카드사·분석 기준·시작일·상품명이 맞다'
);
insert into _rpc select 'card_cycle', public.create_card(
  '00000000-0000-4000-8000-000000000051', '이용 기간 카드', 'hyundai', 'cycle', 12
);
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'card_cycle'), 'created', '12일 시작 이용 기간 카드가 만들어진다');
insert into _tap(line) select is(
  (select cycle_start_day from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_cycle')),
  12, '이용 기간 시작일 12를 저장한다'
);
insert into _tap(line) select throws_ok(
  $$select public.create_card('00000000-0000-4000-8000-000000000051', '카드사 오류', 'visa', 'month', null)$$,
  '23514', null, '허용되지 않은 카드사는 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.create_card('00000000-0000-4000-8000-000000000051', '기준 오류', 'hyundai', 'week', null)$$,
  '23514', null, '허용되지 않은 분석 기준은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.create_card('00000000-0000-4000-8000-000000000051', '시작일 없음', 'hyundai', 'cycle', null)$$,
  '23514', null, 'cycle에 시작일이 없으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.create_card('00000000-0000-4000-8000-000000000051', '월별 시작일', 'hyundai', 'month', 12)$$,
  '23514', null, 'month에 시작일이 있으면 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.create_card('00000000-0000-4000-8000-000000000051', '0일 시작', 'hyundai', 'cycle', 0)$$,
  '23514', null, 'cycle 시작일 0은 제약 오류다'
);
insert into _tap(line) select throws_ok(
  $$select public.create_card('00000000-0000-4000-8000-000000000051', '32일 시작', 'hyundai', 'cycle', 32)$$,
  '23514', null, 'cycle 시작일 32는 제약 오류다'
);
insert into _tap(line) select is(
  public.create_card('00000000-0000-4000-8000-000000000051', '   ', 'hyundai', 'month', null),
  '{"kind":"invalid_label"}'::jsonb, '공백 라벨은 invalid_label이다'
);
insert into _tap(line) select is(
  public.create_card('00000000-0000-4000-8000-000000000051', '월별 카드', 'hyundai', 'month', null),
  '{"kind":"duplicate_label"}'::jsonb, '중복 라벨은 duplicate_label이다'
);

insert into _rpc select 'card_issuer', public.create_card(
  '00000000-0000-4000-8000-000000000051', '신한 카드', 'shinhan', 'month', null
);
insert into _rpc select 'card_product', public.create_card(
  '00000000-0000-4000-8000-000000000051', '상품 카드', 'hyundai', 'month', null
);
insert into _rpc select 'card_null', public.create_card(
  '00000000-0000-4000-8000-000000000051', '미상 메타데이터 카드', 'hyundai', 'month', null
);
insert into _rpc select 'card_no_new', public.create_card(
  '00000000-0000-4000-8000-000000000051', '중복 카드', 'hyundai', 'month', null
);
insert into _rpc select 'card_b', public.create_card(
  '00000000-0000-4000-8000-000000000052', '다른 사용자 카드', 'shinhan', 'month', null
);

insert into _rpc select 'issuer_upload', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'issuer.pdf', repeat('a', 64), 100
) from _rpc where name = 'card_issuer';
insert into _rpc select 'issuer_ingest', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'upload_id')::uuid,
  'content', 'negative_amount', '[]', 0, 'hyundai', null, null, null
) from _rpc where name = 'issuer_upload';
insert into _tap(line) select is(
  (select result from _rpc where name = 'issuer_ingest'),
  '{"kind":"card_mismatch","reason":"issuer"}'::jsonb, '카드사가 다르면 issuer 사유로 거절한다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('status', status, 'failure_code', failure_code,
      'failure_reason', failure_reason, 'lease_expires_at', lease_expires_at)
    from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'issuer_upload')),
  '{"status":"failed","failure_code":"CARD_MISMATCH","failure_reason":"issuer","lease_expires_at":null}'::jsonb,
  '카드사 불일치 업로드는 CARD_MISMATCH issuer로 실패한다'
);
insert into _tap(line) select is(
  (select outcome from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'issuer_upload')),
  'failed', '카드사 불일치 시도는 failed다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'issuer_upload')),
  0::bigint, '카드사 불일치 거래는 저장되지 않는다'
);
insert into _tap(line) select is(
  (select product_name from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_issuer')),
  null::text, 'failed는 카드 상품명을 정하지 않는다'
);

insert into _rpc select 'product_upload_first', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'product-first.pdf', repeat('b', 64), 100
) from _rpc where name = 'card_product';
insert into _rpc select 'product_ingest_first', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', null, null
) from _rpc as u cross join _rpc as r where u.name = 'product_upload_first' and r.name = 'rows_product_one';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'product_ingest_first'), 'done', '첫 상품 업로드는 done이다');
insert into _tap(line) select is(
  (select product_name from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_product')),
  '현대카드MM', '첫 done이 카드 상품명을 정한다'
);
insert into _rpc select 'product_upload_mismatch', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'product-mismatch.pdf', repeat('c', 64), 100
) from _rpc where name = 'card_product';
insert into _rpc select 'product_ingest_mismatch', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'upload_id')::uuid,
  'content', 'negative_amount', '[]', 0, 'hyundai', '현대카드ZERO', null, null
) from _rpc where name = 'product_upload_mismatch';
insert into _tap(line) select is(
  (select result from _rpc where name = 'product_ingest_mismatch'),
  '{"kind":"card_mismatch","reason":"product"}'::jsonb, '저장된 상품명과 다르면 product 사유로 거절한다'
);
insert into _tap(line) select is(
  (select product_name from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_product')),
  '현대카드MM', '상품명 불일치는 기존 상품명을 바꾸지 않는다'
);
insert into _rpc select 'product_upload_second', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'product-second.pdf', repeat('d', 64), 100
) from _rpc where name = 'card_product';
insert into _rpc select 'product_ingest_second', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, null, null, null, null
) from _rpc as u cross join _rpc as r where u.name = 'product_upload_second' and r.name = 'rows_product_two';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'product_ingest_second'), 'done', '상품을 다시 모르는 업로드도 done이다');
insert into _tap(line) select is(
  (select product_name from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_product')),
  '현대카드MM', '후속 null 상품명은 첫 상품명을 지우지 않는다'
);

insert into _rpc select 'null_upload', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'null-metadata.pdf', repeat('e', 64), 100
) from _rpc where name = 'card_null';
insert into _rpc select 'null_ingest', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, null, null, null, null
) from _rpc as u cross join _rpc as r where u.name = 'null_upload' and r.name = 'rows_null_card';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'null_ingest'), 'done', '카드사·상품명을 모르는 ingest는 검사 없이 done이다');

insert into _rpc select 'no_new_first_upload', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'no-new-first.pdf', repeat('f', 64), 100
) from _rpc where name = 'card_no_new';
insert into _rpc select 'no_new_first_ingest', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, null, null, null, null
) from _rpc as u cross join _rpc as r where u.name = 'no_new_first_upload' and r.name = 'rows_no_new';
insert into _rpc select 'no_new_second_upload', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'no-new-second.pdf', repeat('0', 64), 100
) from _rpc where name = 'card_no_new';
insert into _rpc select 'no_new_second_ingest', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, null, '현대카드MM', null, null
) from _rpc as u cross join _rpc as r where u.name = 'no_new_second_upload' and r.name = 'rows_no_new';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'no_new_second_ingest'), 'no_new', '중복 거래만 있는 ingest는 no_new다');
insert into _tap(line) select is(
  (select product_name from public.cards where id = (select (result->>'card_id')::uuid from _rpc where name = 'card_no_new')),
  null::text, 'no_new는 상품명을 정하지 않는다'
);

insert into _rpc select 'upload_statement_first', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-first.pdf', repeat('1', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_first', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-23', '2026-10-12 06:15:05+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_first' and r.name = 'rows_statement_first';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_statement_first'), 'done', '첫 청구서 업로드가 done이다');
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_first')),
  3::bigint, '첫 청구서의 세 거래가 저장된다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000051', '2026-09', 'free', 'claude-sonnet-5-5', repeat('a', 64), '9월 A', array['팁'])->>'kind',
  'saved', '9월 A 요약을 교체 전 저장한다'
);
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000051', '2026-10', 'free', 'claude-sonnet-5-5', repeat('b', 64), '10월 A', array['팁'])->>'kind',
  'saved', '10월 A 요약을 교체 전 저장한다'
);

insert into _rpc select 'upload_user_b', public.begin_upload(
  '00000000-0000-4000-8000-000000000052', (result->>'card_id')::uuid,
  'user-b.pdf', repeat('2', 64), 100
) from _rpc where name = 'card_b';
insert into _rpc select 'ingest_user_b', public.ingest_upload(
  '00000000-0000-4000-8000-000000000052', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, null, null, null, null
) from _rpc as u cross join _rpc as r where u.name = 'upload_user_b' and r.name = 'rows_user_b';
insert into _tap(line) select is(
  public.save_ai_summary('00000000-0000-4000-8000-000000000052', '2026-09', 'free', 'claude-sonnet-5-5', repeat('c', 64), '9월 B', array['팁'])->>'kind',
  'saved', '다른 사용자의 9월 요약을 저장한다'
);

insert into _rpc select 'upload_statement_newer', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-newer.pdf', repeat('3', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_newer', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-23', '2026-10-13 22:39:44+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_newer' and r.name = 'rows_statement_new';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_statement_newer')->>'kind', 'done', '더 늦게 저장한 같은 청구서가 done이다'
);
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_statement_newer'),
  jsonb_build_object('kind', 'done', 'inserted', 2, 'duplicates', 0, 'skipped', 0,
    'period_from', '2026-09-30', 'period_to', '2026-10-05', 'net_amount', 29000,
    'statement_date', '2026-10-23', 'replaced_upload_id', (select result->>'upload_id' from _rpc where name = 'upload_statement_first')),
  '교체 결과에 청구일·이전 upload id와 새 거래 수가 들어간다'
);
insert into _tap(line) select is(
  (select count(*) from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_first')),
  0::bigint, '교체 전 업로드 행이 삭제된다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_first')),
  0::bigint, '교체 전 업로드 거래가 삭제된다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('count', count(*), 'inserted', min(inserted_count), 'date', min(statement_date))
    from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_newer')),
  '{"count":1,"inserted":2,"date":"2026-10-23"}'::jsonb, '겹치는 거래를 포함한 새 청구서 행 두 개가 모두 저장된다'
);
insert into _tap(line) select is(
  (select count(*) from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000051' and month in ('2026-09', '2026-10')),
  0::bigint, '교체한 거래가 있던 9월·10월 요약을 삭제한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.ai_summaries where user_id = '00000000-0000-4000-8000-000000000052' and month = '2026-09'),
  '다른 사용자의 요약은 유지한다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_first') and deleted_at is null),
  '교체로 삭제된 업로드의 시도 deleted_at은 null로 복구한다'
);
insert into _tap(line) select is(
  (select count(*) from public.uploads where user_id = '00000000-0000-4000-8000-000000000051'
    and card_id = (select (result->>'card_id')::uuid from _rpc where name = 'card_month')
    and status = 'done' and statement_date = '2026-10-23'),
  1::bigint, '카드와 청구일마다 done 업로드는 하나다'
);

insert into _rpc select 'upload_statement_older', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-older.pdf', repeat('4', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_older', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-23', '2026-10-01 00:00:00+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_older' and r.name = 'rows_statement_other';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_statement_older'), '{"kind":"older_statement"}'::jsonb,
  '더 일찍 받은 같은 청구서는 older_statement다'
);
insert into _tap(line) select is(
  (select jsonb_build_object('status', status, 'inserted', inserted_count, 'statement_date', statement_date)
    from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_older')),
  '{"status":"no_new","inserted":0,"statement_date":"2026-10-23"}'::jsonb,
  '오래된 업로드는 no_new·inserted 0·청구일을 저장한다'
);
insert into _tap(line) select is(
  (select outcome from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_older')),
  'no_new', '오래된 청구서 시도는 no_new다'
);
insert into _tap(line) select is(
  (select count(*) from public.transactions where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_newer')),
  2::bigint, '오래된 청구서는 최신 업로드 거래를 건드리지 않는다'
);

insert into _rpc select 'upload_statement_equal', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-equal.pdf', repeat('5', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_equal', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-23', '2026-10-13 22:39:44+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_equal' and r.name = 'rows_statement_other';
insert into _tap(line) select is(
  (select result from _rpc where name = 'ingest_statement_equal'), '{"kind":"older_statement"}'::jsonb,
  '저장 시각이 같아도 older_statement다'
);

insert into _rpc select 'upload_statement_null_previous', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-null-previous.pdf', repeat('6', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_null_previous', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-24', '2026-10-13 22:39:44+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_null_previous' and r.name = 'rows_statement_other';
insert into _rpc select 'upload_statement_null_newer', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-null-newer.pdf', repeat('7', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_null_newer', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-24', null
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_null_newer' and r.name = 'rows_statement_null_newer';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_statement_null_newer'), 'done', '저장 시각이 없는 새 업로드는 현재 업로드 시각으로 비교해 교체한다');
insert into _tap(line) select is(
  (select result->>'replaced_upload_id' from _rpc where name = 'ingest_statement_null_newer'),
  (select result->>'upload_id' from _rpc where name = 'upload_statement_null_previous'),
  '저장 시각이 없는 청구서가 이전 업로드를 교체한다'
);

insert into _rpc select 'upload_statement_future', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-future.pdf', repeat('8', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_future', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-25', '2099-01-01 00:00:00+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_future' and r.name = 'rows_statement_future_previous';
reset role;
update public.uploads set created_at = '2026-10-13 00:00:00+00'
where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_future');
set local role service_role;
insert into _rpc select 'upload_statement_future_newer', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-future-newer.pdf', repeat('9', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_future_newer', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-10-25', '2026-10-13 22:39:44+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_future_newer' and r.name = 'rows_statement_future_newer';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_statement_future_newer'), 'done', '미래 PDF 저장 시각은 업로드 시각으로 제한해 더 늦은 업로드가 교체한다');
insert into _tap(line) select is(
  (select result->>'replaced_upload_id' from _rpc where name = 'ingest_statement_future_newer'),
  (select result->>'upload_id' from _rpc where name = 'upload_statement_future'),
  '미래 시각 업로드가 실제 업로드 시각 기준으로 교체된다'
);

insert into _rpc select 'upload_statement_other_date', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-other-date.pdf', repeat('0', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_other_date', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', '현대카드MM', '2026-09-23', '2026-10-12 06:15:05+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_other_date' and r.name = 'rows_statement_other_date';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_statement_other_date'), 'done', '다른 청구일은 기존 청구서와 별도로 done이다');

insert into _rpc select 'upload_statement_other_card', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-other-card.pdf', repeat('3', 63) || 'e', 100
) from _rpc where name = 'card_cycle';
insert into _rpc select 'ingest_statement_other_card', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, 'hyundai', null, '2026-10-23', '2026-10-12 06:15:05+00'
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_other_card' and r.name = 'rows_statement_other_card';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_statement_other_card'), 'done', '같은 청구일이어도 다른 카드는 done이다');

insert into _rpc select 'upload_statement_no_date', public.begin_upload(
  '00000000-0000-4000-8000-000000000051', (result->>'card_id')::uuid,
  'statement-no-date.pdf', repeat('4', 64), 100
) from _rpc where name = 'card_month';
insert into _rpc select 'ingest_statement_no_date', public.ingest_upload(
  '00000000-0000-4000-8000-000000000051', (u.result->>'upload_id')::uuid,
  'content', 'negative_amount', r.result, 0, null, null, null, null
) from _rpc as u cross join _rpc as r where u.name = 'upload_statement_no_date' and r.name = 'rows_statement_no_date';
insert into _tap(line) select is((select result->>'kind' from _rpc where name = 'ingest_statement_no_date'), 'done', '청구일이 없는 형식은 교체 검사 없이 done이다');
insert into _tap(line) select is(
  (select count(*) from public.uploads where id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_newer')),
  1::bigint, '청구일이 없는 업로드는 기존 청구서 업로드를 교체하지 않는다'
);
insert into _tap(line) select throws_ok(
  $$select public.ingest_upload('00000000-0000-4000-8000-000000000051',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_no_date'),
    'content', 'negative_amount', '[]', 0, null, null, null, '2026-10-13 00:00:00+00')$$,
  '22023', 'INVALID_INGEST_INPUT', '청구일 없이 PDF 저장 시각만 있으면 입력 오류다'
);

reset role;
set local role postgres;
insert into _tap(line) select throws_ok(
  $$insert into public.uploads (
      user_id, card_id, file_name, file_hash, file_size, status, inserted_count,
      duplicate_count, skipped_count, completed_at, statement_date
    ) values (
      '00000000-0000-4000-8000-000000000051',
      (select (result->>'card_id')::uuid from _rpc where name = 'card_month'),
      'duplicate-statement.pdf', repeat('f', 64), 100, 'done', 0, 0, 0, now(), '2026-10-23')$$,
  '23505', null, 'unique index는 카드·청구일의 두 번째 done을 막는다'
);

set local role service_role;
insert into _tap(line) select is(
  public.delete_upload('00000000-0000-4000-8000-000000000051',
    (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_newer'))->>'kind',
  'deleted', '교체된 최신 업로드는 사용자가 삭제할 수 있다'
);
insert into _tap(line) select ok(
  exists(select 1 from public.upload_attempts where upload_id = (select (result->>'upload_id')::uuid from _rpc where name = 'upload_statement_newer') and deleted_at = now()),
  '사용자 삭제는 upload_attempts.deleted_at에 기록된다'
);
reset role;

insert into _tap(line) select * from finish();
select string_agg(line, E'\n' order by n) as tap from _tap;
rollback;
