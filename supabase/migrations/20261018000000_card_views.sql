create table public.card_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  period text not null,
  plan text not null,
  model text not null,
  input_hash text not null,
  summary text not null,
  tips text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_summaries_pkey primary key (user_id, card_id, period),
  constraint card_summaries_user_id_card_id_fkey foreign key (user_id, card_id)
    references public.cards (user_id, id) on delete cascade,
  constraint card_summaries_period_check check (
    period ~ '^[0-9]{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?$'
  ),
  constraint card_summaries_plan_check check (plan in ('free', 'pro')),
  constraint card_summaries_model_check check (pg_catalog.char_length(model) between 1 and 100),
  constraint card_summaries_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint card_summaries_summary_check check (pg_catalog.char_length(summary) between 1 and 1000),
  constraint card_summaries_tips_check check (
    cardinality(tips) between 1 and 5
    and array_position(tips, null) is null
    and '' <> all (tips)
    and pg_catalog.char_length(array_to_string(tips, '')) <= 1500
  )
);

alter table public.card_summaries enable row level security;

create policy card_summaries_select_own on public.card_summaries
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.card_summaries from anon, authenticated;
grant select on table public.card_summaries to authenticated;
grant select, insert, update, delete on table public.card_summaries to service_role;

create function public.save_card_summary(
  p_user_id uuid, p_card_id uuid, p_period text, p_plan text, p_model text,
  p_input_hash text, p_summary text, p_tips text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card public.cards%rowtype;
  v_start date;
  v_end date;
begin
  perform private.lock_user(p_user_id);

  if p_period is null then
    raise exception using errcode = '22023', message = 'INVALID_PERIOD';
  end if;

  select c.* into v_card
  from public.cards as c
  where c.id = p_card_id and c.user_id = p_user_id;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'card_not_found');
  end if;

  if v_card.analysis_basis = 'month' then
    if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      return pg_catalog.jsonb_build_object('kind', 'basis_mismatch');
    end if;

    v_start := (p_period || '-01')::date;
    v_end := (v_start + interval '1 month')::date;

    if not exists (
      select 1 from public.transactions as t
      where t.user_id = p_user_id and t.card_id = p_card_id
        and t.used_on >= v_start and t.used_on < v_end
    ) then
      return pg_catalog.jsonb_build_object('kind', 'no_data');
    end if;
  elsif v_card.analysis_basis = 'cycle' then
    if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
      return pg_catalog.jsonb_build_object('kind', 'basis_mismatch');
    end if;

    if not exists (
      select 1 from public.uploads as u
      where u.user_id = p_user_id and u.card_id = p_card_id and u.status = 'done'
        and pg_catalog.to_char(u.statement_date, 'YYYY-MM-DD') = p_period
    ) then
      return pg_catalog.jsonb_build_object('kind', 'no_data');
    end if;
  else
    return pg_catalog.jsonb_build_object('kind', 'basis_mismatch');
  end if;

  insert into public.card_summaries as s (
    user_id, card_id, period, plan, model, input_hash, summary, tips
  ) values (
    p_user_id, p_card_id, p_period, p_plan, p_model, p_input_hash, p_summary, p_tips
  )
  on conflict (user_id, card_id, period) do update
  set plan = excluded.plan,
      model = excluded.model,
      input_hash = excluded.input_hash,
      summary = excluded.summary,
      tips = excluded.tips,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('kind', 'saved');
end;
$$;

revoke execute on function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[])
  to service_role;

create function public.update_card(
  p_user_id uuid, p_card_id uuid, p_label text, p_analysis_basis text, p_cycle_start_day integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card public.cards%rowtype;
  v_label text;
begin
  perform private.lock_user(p_user_id);

  select c.* into v_card
  from public.cards as c
  where c.id = p_card_id and c.user_id = p_user_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('kind', 'not_found');
  end if;

  v_label := pg_catalog.btrim(p_label);
  if v_label is null or pg_catalog.char_length(v_label) not between 1 and 30 then
    return pg_catalog.jsonb_build_object('kind', 'invalid_label');
  end if;

  if exists (
    select 1 from public.cards as c
    where c.user_id = p_user_id and c.id <> p_card_id and c.label = v_label
  ) then
    return pg_catalog.jsonb_build_object('kind', 'duplicate_label');
  end if;

  update public.cards
  set label = v_label, analysis_basis = p_analysis_basis, cycle_start_day = p_cycle_start_day
  where id = p_card_id and user_id = p_user_id;

  if (v_card.analysis_basis, v_card.cycle_start_day)
      is distinct from (p_analysis_basis, p_cycle_start_day) then
    -- 분석 기준이 바뀌면 이전 기준의 요약은 다시 볼 수 없다.
    delete from public.card_summaries
    where user_id = p_user_id and card_id = p_card_id;
  end if;

  return pg_catalog.jsonb_build_object('kind', 'updated');
end;
$$;

revoke execute on function public.update_card(uuid, uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.update_card(uuid, uuid, text, text, integer)
  to service_role;

-- 사용자 삭제·청구서 교체·보관 기한·전체 삭제는 모두 uploads 행 삭제를 거치므로, 기존 RPC를 바꾸지 않고 여기서 카드 요약을 지운다.
-- Auth 사용자 삭제 cascade에서는 Auth 역할에 card_summaries 권한이 없으므로 security definer로 실행한다.
create function private.delete_card_summaries_for_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.card_summaries
  where user_id = old.user_id and card_id = old.card_id;
  return null;
end;
$$;

revoke execute on function private.delete_card_summaries_for_upload() from public, anon, authenticated;
grant execute on function private.delete_card_summaries_for_upload() to service_role;

create trigger uploads_card_summaries
after delete on public.uploads
for each row
when (old.status = 'done')
execute function private.delete_card_summaries_for_upload();
