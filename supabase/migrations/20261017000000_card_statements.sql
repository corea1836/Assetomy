alter table public.cards
  add column issuer text,
  add column analysis_basis text not null default 'month',
  add column cycle_start_day integer,
  add column product_name text;

-- 지금까지 읽을 수 있는 파일은 현대카드 명세서 PDF뿐이라 기존 카드는 모두 현대카드다.
update public.cards set issuer = 'hyundai';

alter table public.cards
  alter column issuer set not null,
  alter column analysis_basis drop default,
  add constraint cards_issuer_check check (issuer in (
    'hyundai', 'shinhan', 'samsung', 'kb', 'lotte', 'hana', 'woori', 'bc', 'nh'
  )),
  add constraint cards_analysis_basis_check check (analysis_basis in ('month', 'cycle')),
  add constraint cards_cycle_start_day_check check (cycle_start_day between 1 and 31),
  add constraint cards_cycle_pair_check check ((analysis_basis = 'cycle') = (cycle_start_day is not null)),
  add constraint cards_product_name_check check (
    product_name = pg_catalog.btrim(product_name) and pg_catalog.char_length(product_name) between 1 and 40
  );

alter table public.uploads
  add column statement_date date,
  add column statement_saved_at timestamptz,
  add constraint uploads_statement_saved_at_check check (statement_saved_at is null or statement_date is not null);

-- 카드·청구서마다 done 업로드는 하나다(ADR-023). ingest가 사용자 잠금 아래 지키고, 이 index가 다시 막는다.
create unique index uploads_done_statement_key on public.uploads (user_id, card_id, statement_date)
  where status = 'done' and statement_date is not null;

drop function public.create_card(uuid, text);

create function public.create_card(
  p_user_id uuid, p_label text, p_issuer text, p_analysis_basis text, p_cycle_start_day integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_label text := pg_catalog.btrim(p_label);
  v_card_id uuid;
begin
  if v_label is null or pg_catalog.char_length(v_label) not between 1 and 30 then
    return pg_catalog.jsonb_build_object('kind', 'invalid_label');
  end if;

  insert into public.cards (user_id, label, issuer, analysis_basis, cycle_start_day)
  values (p_user_id, v_label, p_issuer, p_analysis_basis, p_cycle_start_day)
  on conflict (user_id, label) do nothing
  returning id into v_card_id;

  if v_card_id is null then
    return pg_catalog.jsonb_build_object('kind', 'duplicate_label');
  end if;

  return pg_catalog.jsonb_build_object('kind', 'created', 'card_id', v_card_id);
end;
$$;

revoke execute on function public.create_card(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_card(uuid, text, text, text, integer) to service_role;

drop function public.ingest_upload(uuid, uuid, text, text, jsonb, integer);

create function public.ingest_upload(
  p_user_id uuid,
  p_upload_id uuid,
  p_identity_scope text,
  p_cancel_style text,
  p_rows jsonb,
  p_skipped integer,
  p_issuer text default null,
  p_product_name text default null,
  p_statement_date date default null,
  p_statement_saved_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_card public.cards%rowtype;
  v_previous public.uploads%rowtype;
  v_existing_card_id uuid;
  v_replaced_upload_id uuid;
  v_failure_reason text;
  v_row_count integer;
  v_inserted integer;
  v_duplicates integer;
  v_period_from date;
  v_period_to date;
  v_net_amount bigint;
  v_status text;
begin
  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'INVALID_ROWS';
  end if;

  v_row_count := pg_catalog.jsonb_array_length(p_rows);
  if v_row_count > 5000 or p_skipped is null or p_skipped < 0 then
    raise exception using errcode = '22023', message = 'INVALID_INGEST_INPUT';
  end if;

  if p_statement_saved_at is not null and p_statement_date is null then
    raise exception using errcode = '22023', message = 'INVALID_INGEST_INPUT';
  end if;

  perform private.lock_user(p_user_id);

  select u.* into v_upload
  from public.uploads as u
  where u.id = p_upload_id and u.user_id = p_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'not_found');
  end if;

  if v_upload.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'not_processing', 'status', v_upload.status);
  end if;

  if v_upload.lease_expires_at <= now() then
    update public.uploads
    set status = 'failed', failure_code = 'LEASE_EXPIRED', lease_expires_at = null, completed_at = now()
    where id = p_upload_id and user_id = p_user_id;

    update public.upload_attempts
    set outcome = 'failed', failure_code = 'LEASE_EXPIRED', completed_at = now()
    where upload_id = p_upload_id and user_id = p_user_id;

    return pg_catalog.jsonb_build_object('kind', 'lease_expired');
  end if;

  select c.* into v_card
  from public.cards as c
  where c.id = v_upload.card_id and c.user_id = p_user_id
  for update;

  if v_card.identity_scope is not null and
    (v_card.identity_scope, v_card.cancel_style) is distinct from (p_identity_scope, p_cancel_style)
  then
    update public.uploads
    set status = 'failed', failure_code = 'CARD_SCOPE_MISMATCH', lease_expires_at = null, completed_at = now()
    where id = p_upload_id and user_id = p_user_id;

    update public.upload_attempts
    set outcome = 'failed', failure_code = 'CARD_SCOPE_MISMATCH', completed_at = now()
    where upload_id = p_upload_id and user_id = p_user_id;

    return pg_catalog.jsonb_build_object('kind', 'card_scope_mismatch');
  end if;

  v_failure_reason := null;
  if p_issuer is not null and v_card.issuer <> p_issuer then
    v_failure_reason := 'issuer';
  elsif p_product_name is not null and v_card.product_name is not null
    and v_card.product_name <> p_product_name then
    v_failure_reason := 'product';
  end if;

  if v_failure_reason is not null then
    update public.uploads
    set status = 'failed', failure_code = 'CARD_MISMATCH', failure_reason = v_failure_reason,
      lease_expires_at = null, completed_at = now()
    where id = p_upload_id and user_id = p_user_id;

    update public.upload_attempts
    set outcome = 'failed', failure_code = 'CARD_MISMATCH', completed_at = now()
    where upload_id = p_upload_id and user_id = p_user_id;

    return pg_catalog.jsonb_build_object('kind', 'card_mismatch', 'reason', v_failure_reason);
  end if;

  select u.card_id into v_existing_card_id
  from public.uploads as u
  where u.user_id = p_user_id and u.id <> p_upload_id
    and u.status = 'done' and u.file_hash = v_upload.file_hash
  order by u.created_at, u.id
  limit 1;

  if found then
    update public.uploads
    set status = 'no_new', inserted_count = 0, duplicate_count = v_row_count,
      skipped_count = p_skipped, lease_expires_at = null, completed_at = now()
    where id = p_upload_id and user_id = p_user_id;

    update public.upload_attempts
    set outcome = 'no_new', completed_at = now()
    where upload_id = p_upload_id and user_id = p_user_id;

    return pg_catalog.jsonb_build_object('kind', 'duplicate', 'existing_card_id', v_existing_card_id);
  end if;

  if p_statement_date is not null then
    select u.* into v_previous
    from public.uploads as u
    where u.user_id = p_user_id and u.card_id = v_upload.card_id
      and u.status = 'done' and u.statement_date = p_statement_date and u.id <> p_upload_id
    for update;

    if found then
      if least(coalesce(p_statement_saved_at, v_upload.created_at), v_upload.created_at)
        <= least(coalesce(v_previous.statement_saved_at, v_previous.created_at), v_previous.created_at) then
        update public.uploads
        set status = 'no_new', inserted_count = 0, duplicate_count = v_row_count,
          skipped_count = p_skipped, statement_date = p_statement_date,
          statement_saved_at = p_statement_saved_at, lease_expires_at = null, completed_at = now()
        where id = p_upload_id and user_id = p_user_id;

        update public.upload_attempts
        set outcome = 'no_new', completed_at = now()
        where upload_id = p_upload_id and user_id = p_user_id;

        return pg_catalog.jsonb_build_object('kind', 'older_statement');
      end if;

      -- 지운 거래의 가맹점명이 요약에 남지 않도록 그 업로드 거래가 있던 달의 요약을 먼저 지운다.
      delete from public.ai_summaries as s
      where s.user_id = p_user_id
        and s.month in (
          select distinct pg_catalog.to_char(t.used_on, 'YYYY-MM')
          from public.transactions as t
          where t.user_id = p_user_id and t.upload_id = v_previous.id
        );

      -- 거래는 FK cascade로 지우고, FK가 없는 upload_attempts는 보존한다.
      delete from public.uploads where id = v_previous.id and user_id = p_user_id;

      -- 청구서 교체는 사용자 삭제가 아니므로 H5 삭제 지표에 포함하지 않는다.
      update public.upload_attempts set deleted_at = null
      where user_id = p_user_id and upload_id = v_previous.id;

      v_replaced_upload_id := v_previous.id;
    end if;
  end if;

  -- RETURNING에 나온 행만 집계해야 중복 거래가 기간·합계에 섞이지 않는다.
  with inserted_rows as (
    insert into public.transactions (
      user_id, card_id, upload_id, used_on, merchant, merchant_key,
      amount, event_kind, category, fingerprint
    )
    select p_user_id, v_upload.card_id, p_upload_id, r.used_on, r.merchant, r.merchant_key,
      r.amount, r.event_kind, r.category, r.fingerprint
    from pg_catalog.jsonb_to_recordset(p_rows) as r(
      used_on date, merchant text, merchant_key text, amount bigint,
      event_kind text, category text, fingerprint text
    )
    on conflict (user_id, fingerprint) do nothing
    returning used_on, amount
  )
  select pg_catalog.count(*)::integer, pg_catalog.min(used_on), pg_catalog.max(used_on),
    coalesce(pg_catalog.sum(amount), 0)::bigint
  into v_inserted, v_period_from, v_period_to, v_net_amount
  from inserted_rows;

  v_duplicates := v_row_count - v_inserted;
  v_status := case when v_inserted = 0 then 'no_new' else 'done' end;

  if v_status = 'done' then
    update public.cards
    set identity_scope = coalesce(identity_scope, p_identity_scope),
      cancel_style = coalesce(cancel_style, p_cancel_style),
      product_name = coalesce(product_name, p_product_name)
    where id = v_upload.card_id and user_id = p_user_id;
  end if;

  update public.uploads
  set status = v_status, lease_expires_at = null, inserted_count = v_inserted,
    duplicate_count = v_duplicates, skipped_count = p_skipped,
    period_from = v_period_from, period_to = v_period_to, net_amount = v_net_amount,
    statement_date = p_statement_date, statement_saved_at = p_statement_saved_at,
    completed_at = now()
  where id = p_upload_id and user_id = p_user_id;

  update public.upload_attempts
  set outcome = v_status, completed_at = now()
  where upload_id = p_upload_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'kind', v_status, 'inserted', v_inserted, 'duplicates', v_duplicates, 'skipped', p_skipped,
    'period_from', v_period_from, 'period_to', v_period_to, 'net_amount', v_net_amount,
    'statement_date', p_statement_date, 'replaced_upload_id', v_replaced_upload_id
  );
end;
$$;

revoke execute on function public.ingest_upload(uuid, uuid, text, text, jsonb, integer, text, text, date, timestamptz) from public, anon, authenticated;
grant execute on function public.ingest_upload(uuid, uuid, text, text, jsonb, integer, text, text, date, timestamptz) to service_role;
