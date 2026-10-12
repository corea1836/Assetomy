create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  identity_scope text,
  cancel_style text,
  created_at timestamptz not null default now(),
  constraint cards_label_check check (label = btrim(label) and char_length(label) between 1 and 30),
  constraint cards_identity_scope_check check (identity_scope ~ '^[a-z_]{1,30}$'),
  constraint cards_cancel_style_check check (cancel_style ~ '^[a-z_]{1,30}$'),
  constraint cards_identity_pair_check check ((identity_scope is null) = (cancel_style is null)),
  constraint cards_user_id_label_key unique (user_id, label),
  constraint cards_user_id_id_key unique (user_id, id)
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  file_name text not null,
  file_hash text not null,
  file_size integer not null,
  status text not null,
  lease_expires_at timestamptz,
  failure_code text,
  failure_reason text,
  inserted_count integer,
  duplicate_count integer,
  skipped_count integer,
  period_from date,
  period_to date,
  net_amount bigint,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint uploads_user_id_card_id_fkey foreign key (user_id, card_id)
    references public.cards (user_id, id),
  constraint uploads_file_name_check check (char_length(file_name) between 1 and 255),
  constraint uploads_file_hash_check check (file_hash ~ '^[0-9a-f]{64}$'),
  constraint uploads_file_size_check check (file_size between 1 and 4194304),
  constraint uploads_status_check check (status in ('processing', 'done', 'no_new', 'failed')),
  constraint uploads_lease_check check ((status = 'processing') = (lease_expires_at is not null)),
  constraint uploads_failure_code_check check (failure_code ~ '^[A-Z_]{1,40}$'),
  constraint uploads_failure_reason_check check (failure_reason ~ '^[a-z_]{1,40}$'),
  constraint uploads_inserted_count_check check (inserted_count >= 0),
  constraint uploads_duplicate_count_check check (duplicate_count >= 0),
  constraint uploads_skipped_count_check check (skipped_count >= 0),
  constraint uploads_user_id_id_key unique (user_id, id)
);

create index uploads_user_id_status_idx on public.uploads (user_id, status);
create index uploads_user_id_file_hash_idx on public.uploads (user_id, file_hash);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  upload_id uuid not null,
  used_on date not null,
  merchant text not null,
  merchant_key text not null,
  amount bigint not null,
  event_kind text not null,
  category text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint transactions_user_id_card_id_fkey foreign key (user_id, card_id)
    references public.cards (user_id, id),
  constraint transactions_user_id_upload_id_fkey foreign key (user_id, upload_id)
    references public.uploads (user_id, id) on delete cascade,
  constraint transactions_merchant_check check (char_length(merchant) between 1 and 200),
  constraint transactions_merchant_key_check check (char_length(merchant_key) between 1 and 200),
  -- numeric으로 변환해 bigint 최솟값의 abs 오버플로도 피한다.
  constraint transactions_amount_check check (abs(amount::numeric) <= 9007199254740991),
  constraint transactions_event_kind_check check (event_kind in ('purchase', 'cancel')),
  constraint transactions_event_amount_check check ((event_kind = 'cancel') = (amount < 0)),
  constraint transactions_category_check check (category in (
    'food', 'cafe', 'delivery', 'transport', 'shopping', 'grocery', 'subscription',
    'housing', 'health', 'culture', 'travel', 'education', 'finance', 'etc'
  )),
  constraint transactions_fingerprint_check check (fingerprint ~ '^[0-9a-f]{64}$'),
  constraint transactions_user_id_fingerprint_key unique (user_id, fingerprint)
);

create index transactions_user_id_used_on_idx on public.transactions (user_id, used_on);
create index transactions_user_id_merchant_key_idx on public.transactions (user_id, merchant_key);
create index transactions_user_id_upload_id_idx on public.transactions (user_id, upload_id);
create index transactions_user_id_card_id_idx on public.transactions (user_id, card_id);

create table public.upload_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 업로드 삭제 후에도 측정 이력을 남기므로 upload_id에는 FK를 걸지 않는다.
  upload_id uuid,
  outcome text,
  failure_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint upload_attempts_outcome_check check (outcome in ('done', 'no_new', 'failed')),
  constraint upload_attempts_failure_code_check check (failure_code ~ '^[A-Z_]{1,40}$')
);

create index upload_attempts_user_id_created_at_idx on public.upload_attempts (user_id, created_at);
create index upload_attempts_upload_id_idx on public.upload_attempts (upload_id);

create table public.merchant_category_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category text not null,
  updated_at timestamptz not null default now(),
  constraint merchant_category_overrides_pkey primary key (user_id, merchant_key),
  constraint merchant_category_overrides_merchant_key_check check (char_length(merchant_key) between 1 and 200),
  constraint merchant_category_overrides_category_check check (category in (
    'food', 'cafe', 'delivery', 'transport', 'shopping', 'grocery', 'subscription',
    'housing', 'health', 'culture', 'travel', 'education', 'finance', 'etc'
  ))
);

alter table public.cards enable row level security;
alter table public.uploads enable row level security;
alter table public.transactions enable row level security;
alter table public.upload_attempts enable row level security;
alter table public.merchant_category_overrides enable row level security;

create policy cards_select_own on public.cards
  for select to authenticated using (user_id = (select auth.uid()));
create policy uploads_select_own on public.uploads
  for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy merchant_category_overrides_select_own on public.merchant_category_overrides
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on table public.cards, public.uploads, public.transactions,
  public.upload_attempts, public.merchant_category_overrides from anon, authenticated;

grant select on table public.cards, public.uploads, public.transactions,
  public.merchant_category_overrides to authenticated;

grant select, insert, update, delete on table public.cards, public.uploads,
  public.transactions, public.upload_attempts, public.merchant_category_overrides to service_role;

-- 원본 4MB + 암호화 헤더 여유 1KB. Storage 사용자 정책은 만들지 않는다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statements', 'statements', false, 4195328, array['application/octet-stream'])
on conflict (id) do nothing;
