create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create function private.lock_user(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('assetomy:user:' || p_user_id::text, 0)
  );
$$;

revoke execute on function private.lock_user(uuid) from public, anon, authenticated;
grant execute on function private.lock_user(uuid) to service_role;

create function public.create_card(p_user_id uuid, p_label text)
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

  insert into public.cards (user_id, label)
  values (p_user_id, v_label)
  on conflict (user_id, label) do nothing
  returning id into v_card_id;

  if v_card_id is null then
    return pg_catalog.jsonb_build_object('kind', 'duplicate_label');
  end if;

  return pg_catalog.jsonb_build_object('kind', 'created', 'card_id', v_card_id);
end;
$$;

revoke execute on function public.create_card(uuid, text) from public, anon, authenticated;
grant execute on function public.create_card(uuid, text) to service_role;

create function public.begin_upload(
  p_user_id uuid,
  p_card_id uuid,
  p_file_name text,
  p_file_hash text,
  p_file_size integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_existing_card_id uuid;
  v_upload_id uuid;
  v_lease_expires_at timestamptz;
begin
  perform private.lock_user(p_user_id);

  if not exists (
    select 1 from public.cards as c
    where c.id = p_card_id and c.user_id = p_user_id
  ) then
    return pg_catalog.jsonb_build_object('kind', 'card_not_found');
  end if;

  if (
    select pg_catalog.count(*) from public.upload_attempts as a
    where a.user_id = p_user_id and a.created_at > now() - interval '24 hours'
  ) >= 30 then
    return pg_catalog.jsonb_build_object('kind', 'rate_limited');
  end if;

  if (
    select pg_catalog.count(*) from public.uploads as u
    where u.user_id = p_user_id and u.status = 'processing' and u.lease_expires_at > now()
  ) >= 2 then
    return pg_catalog.jsonb_build_object('kind', 'busy');
  end if;

  insert into public.upload_attempts (user_id)
  values (p_user_id)
  returning id into v_attempt_id;

  select u.card_id into v_existing_card_id
  from public.uploads as u
  where u.user_id = p_user_id and u.status = 'done' and u.file_hash = p_file_hash
  order by u.created_at, u.id
  limit 1;

  if found then
    update public.upload_attempts
    set outcome = 'no_new', completed_at = now()
    where id = v_attempt_id and user_id = p_user_id;

    return pg_catalog.jsonb_build_object('kind', 'duplicate', 'existing_card_id', v_existing_card_id);
  end if;

  insert into public.uploads (
    user_id, card_id, file_name, file_hash, file_size, status, lease_expires_at
  ) values (
    p_user_id, p_card_id, p_file_name, p_file_hash, p_file_size,
    'processing', now() + interval '6 minutes'
  )
  returning id, lease_expires_at into v_upload_id, v_lease_expires_at;

  update public.upload_attempts
  set upload_id = v_upload_id
  where id = v_attempt_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'kind', 'started', 'upload_id', v_upload_id, 'lease_expires_at', v_lease_expires_at
  );
end;
$$;

revoke execute on function public.begin_upload(uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.begin_upload(uuid, uuid, text, text, integer) to service_role;

create function public.ingest_upload(
  p_user_id uuid,
  p_upload_id uuid,
  p_identity_scope text,
  p_cancel_style text,
  p_rows jsonb,
  p_skipped integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_card public.cards%rowtype;
  v_existing_card_id uuid;
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

  if v_status = 'done' and v_card.identity_scope is null then
    update public.cards
    set identity_scope = p_identity_scope, cancel_style = p_cancel_style
    where id = v_upload.card_id and user_id = p_user_id;
  end if;

  update public.uploads
  set status = v_status, lease_expires_at = null, inserted_count = v_inserted,
    duplicate_count = v_duplicates, skipped_count = p_skipped,
    period_from = v_period_from, period_to = v_period_to, net_amount = v_net_amount,
    completed_at = now()
  where id = p_upload_id and user_id = p_user_id;

  update public.upload_attempts
  set outcome = v_status, completed_at = now()
  where upload_id = p_upload_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'kind', v_status, 'inserted', v_inserted, 'duplicates', v_duplicates, 'skipped', p_skipped,
    'period_from', v_period_from, 'period_to', v_period_to, 'net_amount', v_net_amount
  );
end;
$$;

revoke execute on function public.ingest_upload(uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.ingest_upload(uuid, uuid, text, text, jsonb, integer) to service_role;

create function public.fail_upload(p_user_id uuid, p_upload_id uuid, p_code text, p_reason text)
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

  if v_upload.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'not_processing', 'status', v_upload.status);
  end if;

  update public.uploads
  set status = 'failed', failure_code = p_code, failure_reason = p_reason,
    lease_expires_at = null, completed_at = now()
  where id = p_upload_id and user_id = p_user_id;

  update public.upload_attempts
  set outcome = 'failed', failure_code = p_code, completed_at = now()
  where upload_id = p_upload_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object('kind', 'failed');
end;
$$;

revoke execute on function public.fail_upload(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_upload(uuid, uuid, text, text) to service_role;

create function public.delete_upload(p_user_id uuid, p_upload_id uuid)
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

  -- 거래는 FK cascade로 지우고, FK가 없는 upload_attempts는 보존한다.
  delete from public.uploads where id = p_upload_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object('kind', 'deleted');
end;
$$;

revoke execute on function public.delete_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_upload(uuid, uuid) to service_role;
