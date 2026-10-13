-- 요약에 해 볼 일 팁 목록을 더한다. 기존 요약은 다시 만들 수 있는 캐시이고 프롬프트도 바뀌므로 지운다.
delete from public.ai_summaries;

alter table public.ai_summaries
  add column tips text[] not null,
  add constraint ai_summaries_tips_check check (
    cardinality(tips) between 1 and 3
    and array_position(tips, null) is null
    and '' <> all (tips)
    and char_length(array_to_string(tips, '')) <= 900
  );

drop function public.save_ai_summary(uuid, text, text, text, text, text);

create function public.save_ai_summary(
  p_user_id uuid, p_month text, p_plan text, p_model text, p_input_hash text, p_summary text, p_tips text[]
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

  insert into public.ai_summaries as s (user_id, month, plan, model, input_hash, summary, tips)
  values (p_user_id, p_month, p_plan, p_model, p_input_hash, p_summary, p_tips)
  on conflict (user_id, month) do update
  set plan = excluded.plan,
      model = excluded.model,
      input_hash = excluded.input_hash,
      summary = excluded.summary,
      tips = excluded.tips,
      updated_at = pg_catalog.now();

  return pg_catalog.jsonb_build_object('kind', 'saved');
end;
$$;

revoke execute on function public.save_ai_summary(uuid, text, text, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.save_ai_summary(uuid, text, text, text, text, text, text[]) to service_role;
