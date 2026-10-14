create table public.summary_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint summary_feedback_pkey primary key (user_id, category),
  constraint summary_feedback_category_check check (category in (
    'food', 'cafe', 'delivery', 'transport', 'shopping', 'grocery', 'subscription',
    'housing', 'health', 'culture', 'travel', 'education', 'finance', 'etc'
  )),
  constraint summary_feedback_body_check check (
    char_length(body) between 1 and 100
    and body = pg_catalog.btrim(body)
    and body !~ '[[:cntrl:]]'
  )
);

alter table public.summary_feedback enable row level security;

create policy summary_feedback_select_own on public.summary_feedback
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.summary_feedback from anon, authenticated;
grant select on table public.summary_feedback to authenticated;
grant select, insert, update, delete on table public.summary_feedback to service_role;

create function public.save_summary_feedback(p_user_id uuid, p_category text, p_body text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_body text;
begin
  perform private.lock_user(p_user_id);

  if p_category is null then
    raise exception using errcode = '22023', message = 'INVALID_CATEGORY';
  end if;

  v_body := pg_catalog.btrim(p_body);
  if v_body is null or v_body = '' then
    delete from public.summary_feedback
    where user_id = p_user_id and category = p_category;

    return pg_catalog.jsonb_build_object('kind', 'deleted');
  end if;

  insert into public.summary_feedback as f (user_id, category, body)
  values (p_user_id, p_category, v_body)
  on conflict (user_id, category) do update
  set body = excluded.body,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('kind', 'saved');
end;
$$;

revoke execute on function public.save_summary_feedback(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_summary_feedback(uuid, text, text) to service_role;

-- 요약 형식이 두 문단·카테고리 팁으로 바뀐다(ADR-025). 저장된 요약은 다시 만들 수 있는 캐시이므로 지운다.
delete from public.ai_summaries;
delete from public.card_summaries;

alter table public.ai_summaries
  add column tip_categories text[] not null,
  add constraint ai_summaries_tip_categories_check check (
    cardinality(tip_categories) = cardinality(tips)
    and array_position(tip_categories, null) is null
    and tip_categories <@ array[
      'food', 'cafe', 'delivery', 'transport', 'shopping', 'grocery', 'subscription',
      'housing', 'health', 'culture', 'travel', 'education', 'finance', 'etc'
    ]::text[]
  );

alter table public.card_summaries
  add column tip_categories text[] not null,
  add constraint card_summaries_tip_categories_check check (
    cardinality(tip_categories) = cardinality(tips)
    and array_position(tip_categories, null) is null
    and tip_categories <@ array[
      'food', 'cafe', 'delivery', 'transport', 'shopping', 'grocery', 'subscription',
      'housing', 'health', 'culture', 'travel', 'education', 'finance', 'etc'
    ]::text[]
  );

drop function public.save_ai_summary(uuid, text, text, text, text, text, text[]);

create function public.save_ai_summary(
  p_user_id uuid, p_month text, p_plan text, p_model text, p_input_hash text,
  p_summary text, p_tips text[], p_tip_categories text[]
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

  insert into public.ai_summaries as s (
    user_id, month, plan, model, input_hash, summary, tips, tip_categories
  ) values (
    p_user_id, p_month, p_plan, p_model, p_input_hash, p_summary, p_tips, p_tip_categories
  )
  on conflict (user_id, month) do update
  set plan = excluded.plan,
      model = excluded.model,
      input_hash = excluded.input_hash,
      summary = excluded.summary,
      tips = excluded.tips,
      tip_categories = excluded.tip_categories,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('kind', 'saved');
end;
$$;

revoke execute on function public.save_ai_summary(uuid, text, text, text, text, text, text[], text[])
  from public, anon, authenticated;
grant execute on function public.save_ai_summary(uuid, text, text, text, text, text, text[], text[])
  to service_role;

drop function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[]);

create function public.save_card_summary(
  p_user_id uuid, p_card_id uuid, p_period text, p_plan text, p_model text,
  p_input_hash text, p_summary text, p_tips text[], p_tip_categories text[]
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
    user_id, card_id, period, plan, model, input_hash, summary, tips, tip_categories
  ) values (
    p_user_id, p_card_id, p_period, p_plan, p_model, p_input_hash, p_summary, p_tips, p_tip_categories
  )
  on conflict (user_id, card_id, period) do update
  set plan = excluded.plan,
      model = excluded.model,
      input_hash = excluded.input_hash,
      summary = excluded.summary,
      tips = excluded.tips,
      tip_categories = excluded.tip_categories,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('kind', 'saved');
end;
$$;

revoke execute on function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[], text[])
  from public, anon, authenticated;
grant execute on function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[], text[])
  to service_role;
