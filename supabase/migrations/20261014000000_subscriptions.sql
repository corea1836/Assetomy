create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null,
  polar_subscription_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  synced_from timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint subscriptions_plan_check check (plan in ('free', 'pro')),
  constraint subscriptions_free_fields_check check (
    plan <> 'free' or (
      polar_subscription_id is null and current_period_end is null and not cancel_at_period_end
    )
  ),
  constraint subscriptions_polar_subscription_id_check check (
    char_length(polar_subscription_id) between 1 and 100
  )
);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_own on public.subscriptions
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;
grant select, insert, update, delete on table public.subscriptions to service_role;

create function public.save_subscription(
  p_user_id uuid,
  p_synced_from timestamptz,
  p_plan text,
  p_subscription_id text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_kind text := 'saved';
begin
  perform private.lock_user(p_user_id);

  -- 같은 사용자의 탈퇴와 직렬화하고, 먼저 시작한 조회가 최신 상태를 덮지 못하게 한다.
  insert into public.subscriptions as s (
    user_id, plan, polar_subscription_id, current_period_end, cancel_at_period_end, synced_from
  ) values (
    p_user_id, p_plan, p_subscription_id, p_current_period_end, p_cancel_at_period_end, p_synced_from
  )
  on conflict (user_id) do update
  set plan = excluded.plan,
    polar_subscription_id = excluded.polar_subscription_id,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    synced_from = excluded.synced_from,
    updated_at = pg_catalog.now()
  where s.synced_from < excluded.synced_from
  returning * into v_subscription;

  if not found then
    select s.* into v_subscription
    from public.subscriptions as s
    where s.user_id = p_user_id;
    v_kind := 'stale';
  end if;

  return pg_catalog.jsonb_build_object(
    'kind', v_kind, 'plan', v_subscription.plan,
    'current_period_end', v_subscription.current_period_end,
    'cancel_at_period_end', v_subscription.cancel_at_period_end
  );
exception
  when foreign_key_violation then
    return pg_catalog.jsonb_build_object('kind', 'user_not_found');
end;
$$;

revoke execute on function public.save_subscription(uuid, timestamptz, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.save_subscription(uuid, timestamptz, text, text, timestamptz, boolean)
  to service_role;
