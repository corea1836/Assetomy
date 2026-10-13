create table public.ai_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  plan text not null,
  model text not null,
  input_hash text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_summaries_pkey primary key (user_id, month),
  constraint ai_summaries_month_check check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint ai_summaries_plan_check check (plan in ('free', 'pro')),
  constraint ai_summaries_model_check check (char_length(model) between 1 and 100),
  constraint ai_summaries_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint ai_summaries_summary_check check (char_length(summary) between 1 and 1000)
);

alter table public.ai_summaries enable row level security;

create policy ai_summaries_select_own on public.ai_summaries
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.ai_summaries from anon, authenticated;
grant select on table public.ai_summaries to authenticated;
grant select, insert, update, delete on table public.ai_summaries to service_role;

create function public.save_ai_summary(
  p_user_id uuid, p_month text, p_plan text, p_model text, p_input_hash text, p_summary text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
begin
  perform private.lock_user(p_user_id);

  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'INVALID_MONTH';
  end if;

  v_start := (p_month || '-01')::date;
  v_end := (v_start + interval '1 month')::date;

  if not exists (
    select 1 from public.transactions as t
    where t.user_id = p_user_id and t.used_on >= v_start and t.used_on < v_end
  ) then
    return pg_catalog.jsonb_build_object('kind', 'no_transactions');
  end if;

  insert into public.ai_summaries as s (user_id, month, plan, model, input_hash, summary)
  values (p_user_id, p_month, p_plan, p_model, p_input_hash, p_summary)
  on conflict (user_id, month) do update
  set plan = excluded.plan,
      model = excluded.model,
      input_hash = excluded.input_hash,
      summary = excluded.summary,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('kind', 'saved');
end;
$$;

revoke execute on function public.save_ai_summary(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_ai_summary(uuid, text, text, text, text, text) to service_role;

create or replace function public.delete_upload(p_user_id uuid, p_upload_id uuid)
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

  -- 지운 거래의 가맹점명이 요약에 남지 않도록 그 업로드 거래가 있던 달의 요약을 먼저 지운다.
  delete from public.ai_summaries as s
  where s.user_id = p_user_id
    and s.month in (
      select distinct pg_catalog.to_char(t.used_on, 'YYYY-MM')
      from public.transactions as t
      where t.user_id = p_user_id and t.upload_id = p_upload_id
    );

  -- 거래는 FK cascade로 지우고, FK가 없는 upload_attempts는 보존한다.
  delete from public.uploads where id = p_upload_id and user_id = p_user_id;

  return pg_catalog.jsonb_build_object('kind', 'deleted');
end;
$$;

revoke execute on function public.delete_upload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_upload(uuid, uuid) to service_role;
