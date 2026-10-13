create table public.user_metrics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_attempt_at timestamptz,
  first_success_at timestamptz,
  teaser_seen_at timestamptz,
  first_click_at timestamptz,
  upgrade_source text,
  first_paid_at timestamptz,
  constraint user_metrics_upgrade_source_check check (
    upgrade_source in ('teaser', 'trend', 'summary', 'pricing', 'settings', 'direct')
  ),
  -- 첫 클릭이 있으면 그 클릭의 source로 귀속한다. direct는 클릭 없이 결제한 사용자만이다.
  constraint user_metrics_click_source_check check (
    first_click_at is null or (upgrade_source is not null and upgrade_source <> 'direct')
  ),
  constraint user_metrics_direct_check check (
    upgrade_source is distinct from 'direct' or (first_click_at is null and first_paid_at is not null)
  )
);

alter table public.user_metrics enable row level security;

revoke all on table public.user_metrics from anon, authenticated;
grant select, insert, update, delete on table public.user_metrics to service_role;

alter table public.upload_attempts
  add column extends_period boolean,
  add column deleted_at timestamptz,
  add constraint upload_attempts_extends_period_check check (
    extends_period is null or outcome is not distinct from 'done'
  );

create function private.record_first_upload_attempt()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.user_metrics as m (user_id, first_attempt_at)
  values (new.user_id, new.created_at)
  on conflict (user_id) do update
  set first_attempt_at = excluded.first_attempt_at
  where m.first_attempt_at is null;

  return null;
end;
$$;

create function private.record_upload_success()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_previous_last date;
  v_upload_last date;
begin
  -- ingest_upload는 거래를 넣은 뒤 시도를 done으로 바꾸므로, 이 업로드 거래를 빼야 기존 최종 이용일이다.
  select pg_catalog.max(t.used_on) into v_previous_last
  from public.transactions as t
  where t.user_id = new.user_id and t.upload_id is distinct from new.upload_id;

  select pg_catalog.max(t.used_on) into v_upload_last
  from public.transactions as t
  where t.user_id = new.user_id and t.upload_id = new.upload_id;

  new.extends_period := v_previous_last is null or coalesce(v_upload_last > v_previous_last, false);

  insert into public.user_metrics as m (user_id, first_success_at)
  values (new.user_id, coalesce(new.completed_at, pg_catalog.now()))
  on conflict (user_id) do update
  set first_success_at = excluded.first_success_at
  where m.first_success_at is null;

  return new;
end;
$$;

create function private.record_upload_deletion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.upload_attempts
  set deleted_at = pg_catalog.now()
  where user_id = old.user_id and upload_id = old.id and deleted_at is null;

  return null;
end;
$$;

revoke execute on function private.record_first_upload_attempt() from public, anon, authenticated;
revoke execute on function private.record_upload_success() from public, anon, authenticated;
revoke execute on function private.record_upload_deletion() from public, anon, authenticated;
grant execute on function private.record_first_upload_attempt() to service_role;
grant execute on function private.record_upload_success() to service_role;
grant execute on function private.record_upload_deletion() to service_role;

-- 측정은 이미 적용된 업로드 RPC를 고치지 않고 같은 트랜잭션의 트리거로 남긴다.
create trigger upload_attempts_first_attempt
after insert on public.upload_attempts
for each row execute function private.record_first_upload_attempt();

create trigger upload_attempts_success
before update of outcome on public.upload_attempts
for each row
when (new.outcome = 'done' and old.outcome is distinct from 'done')
execute function private.record_upload_success();

create trigger uploads_deleted_at
after delete on public.uploads
for each row execute function private.record_upload_deletion();

create function public.record_metric(p_user_id uuid, p_event text, p_source text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_event is null or p_event not in ('teaser_seen', 'upgrade_click', 'first_paid') then
    raise exception using errcode = '22023', message = 'INVALID_METRIC_EVENT';
  end if;

  if p_event = 'upgrade_click' and (
    p_source is null or p_source not in ('teaser', 'trend', 'summary', 'pricing', 'settings')
  ) then
    raise exception using errcode = '22023', message = 'INVALID_UPGRADE_SOURCE';
  end if;

  perform private.lock_user(p_user_id);

  -- 티저 노출·클릭은 그 시점에 Free인 사용자만 센다(H3 분모). 구독 행이 없으면 Free다.
  if p_event in ('teaser_seen', 'upgrade_click') and exists (
    select 1 from public.subscriptions as s
    where s.user_id = p_user_id and s.plan = 'pro'
  ) then
    return pg_catalog.jsonb_build_object('kind', 'unchanged');
  end if;

  if p_event = 'teaser_seen' then
    insert into public.user_metrics as m (user_id, teaser_seen_at)
    values (p_user_id, pg_catalog.now())
    on conflict (user_id) do update
    set teaser_seen_at = excluded.teaser_seen_at
    where m.teaser_seen_at is null;
  elsif p_event = 'upgrade_click' then
    -- 첫 클릭(또는 클릭 없는 결제의 direct)으로 귀속을 고정한다.
    insert into public.user_metrics as m (user_id, first_click_at, upgrade_source)
    values (p_user_id, pg_catalog.now(), p_source)
    on conflict (user_id) do update
    set first_click_at = excluded.first_click_at, upgrade_source = excluded.upgrade_source
    where m.upgrade_source is null;
  else
    insert into public.user_metrics as m (user_id, first_paid_at, upgrade_source)
    values (p_user_id, pg_catalog.now(), 'direct')
    on conflict (user_id) do update
    set first_paid_at = excluded.first_paid_at, upgrade_source = coalesce(m.upgrade_source, 'direct')
    where m.first_paid_at is null;
  end if;

  if found then
    return pg_catalog.jsonb_build_object('kind', 'recorded');
  end if;
  return pg_catalog.jsonb_build_object('kind', 'unchanged');
exception
  when foreign_key_violation then
    return pg_catalog.jsonb_build_object('kind', 'user_not_found');
end;
$$;

revoke execute on function public.record_metric(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_metric(uuid, text, text) to service_role;

create function public.set_merchant_category(p_user_id uuid, p_merchant_key text, p_category text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  perform private.lock_user(p_user_id);

  -- 거래가 없는 가맹점의 수정값은 남기지 않는다(남의 가맹점·없는 가맹점).
  if not exists (
    select 1 from public.transactions as t
    where t.user_id = p_user_id and t.merchant_key = p_merchant_key
  ) then
    return pg_catalog.jsonb_build_object('kind', 'not_found');
  end if;

  insert into public.merchant_category_overrides as o (user_id, merchant_key, category)
  values (p_user_id, p_merchant_key, p_category)
  on conflict (user_id, merchant_key) do update
  set category = excluded.category, updated_at = pg_catalog.now();

  update public.transactions
  set category = p_category
  where user_id = p_user_id and merchant_key = p_merchant_key and category <> p_category;
  get diagnostics v_updated = row_count;

  return pg_catalog.jsonb_build_object('kind', 'updated', 'updated', v_updated);
end;
$$;

revoke execute on function public.set_merchant_category(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_merchant_category(uuid, text, text) to service_role;
