# Step 0: upload-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "업로드 흐름", "보안"의 격리, "테스트")
- `/docs/ADR.md` (ADR-002, ADR-006, ADR-007, ADR-008, ADR-017, ADR-020)
- `/src/types/category.ts` (`CATEGORY_IDS` 14개)
- `/src/types/parsing.ts` (`EventKind`, `IdentityScope`, `CancelStyle`, `ParsedTransaction`)
- `/src/types/transaction.ts`
- `/supabase/config.toml`

이전 phase에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

이 phase(`6-upload-store`)는 업로드에 필요한 저장 기반(테이블·RPC·암호화·Storage)을 만든다. API·화면·분류·ingest 흐름은 다음 phase(`7-upload-flow`)에서 만든다. 이 step은 첫 마이그레이션으로 테이블·RLS·권한·Storage 버킷을 만든다. RPC는 다음 step에서 만든다.

Supabase는 클라우드 dev 프로젝트를 쓴다(ADR-020). 이 세션은 마이그레이션을 DB에 push하지 않는다. 사용자가 나중에 `supabase db push --linked && supabase test db --linked`로 적용·검증한다. 그래서 이 step에서는 SQL을 실행해 볼 수 없다. Postgres 문법과 Supabase 스키마(`auth.users`, `storage.buckets`, `storage.objects`)를 정확히 따르고, 함수 본문·제약 이름을 꼼꼼히 확인하라.

## 작업

### 1. `supabase/migrations/20261013000000_upload_schema.sql`

모든 객체는 `public` 스키마에 스키마 이름을 붙여 만든다(`public.cards`). 컬럼·제약은 아래와 같다. 다음 step과 다음 phase가 이 이름을 그대로 쓰므로 바꾸지 마라.

**`public.cards`** — 사용자 카드 라벨
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `label text not null` — `label = btrim(label)`이고 길이 1~30
- `identity_scope text` · `cancel_style text` — null 허용. 각각 `~ '^[a-z_]{1,30}$'`. 둘 다 null이거나 둘 다 값이 있어야 한다(check). 첫 성공 업로드에서 고정된다(ADR-006).
- `created_at timestamptz not null default now()`
- `unique (user_id, label)`, `unique (user_id, id)`(복합 FK 대상)

**`public.uploads`** — 업로드 1건
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `card_id uuid not null`, `foreign key (user_id, card_id) references public.cards (user_id, id)` — 삭제 동작은 기본값(NO ACTION)
- `file_name text not null` 길이 1~255
- `file_hash text not null` `~ '^[0-9a-f]{64}$'`(원본 평문의 sha256)
- `file_size integer not null` 1~4194304
- `status text not null` — `'processing' | 'done' | 'no_new' | 'failed'`
- `lease_expires_at timestamptz` — `(status = 'processing') = (lease_expires_at is not null)` check
- `failure_code text` `~ '^[A-Z_]{1,40}$'` · `failure_reason text` `~ '^[a-z_]{1,40}$'` (코드만 저장한다. 메시지·원문을 저장하지 않는다)
- `inserted_count integer` · `duplicate_count integer` · `skipped_count integer` (null 또는 0 이상)
- `period_from date` · `period_to date` · `net_amount bigint`
- `created_at timestamptz not null default now()`, `completed_at timestamptz`
- `unique (user_id, id)`
- 인덱스: `(user_id, status)`, `(user_id, file_hash)`

**`public.transactions`** — 정규화 거래
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `card_id uuid not null`, `upload_id uuid not null`
- `foreign key (user_id, card_id) references public.cards (user_id, id)` (기본 NO ACTION)
- `foreign key (user_id, upload_id) references public.uploads (user_id, id) on delete cascade` — 업로드를 지우면 그 업로드가 넣은 거래가 지워진다
- `used_on date not null`(이용일)
- `merchant text not null` · `merchant_key text not null` 길이 1~200
- `amount bigint not null` — `abs(amount) <= 9007199254740991`
- `event_kind text not null` — `'purchase' | 'cancel'`, `(event_kind = 'cancel') = (amount < 0)` check
- `category text not null` — `CATEGORY_IDS` 14개만(check)
- `fingerprint text not null` `~ '^[0-9a-f]{64}$'`
- `created_at timestamptz not null default now()`
- `unique (user_id, fingerprint)`
- 인덱스: `(user_id, used_on)`, `(user_id, merchant_key)`, `(user_id, upload_id)`, `(user_id, card_id)`

**`public.upload_attempts`** — 측정·24시간 한도용 최소 이력(ADR-013). 업로드를 지워도 남는다.
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `upload_id uuid` — **FK를 걸지 않는다**. 이유: 업로드 행을 지워도 시도 기록은 남아야 한다.
- `outcome text` — null(진행 중) 또는 `'done' | 'no_new' | 'failed'`
- `failure_code text` `~ '^[A-Z_]{1,40}$'`
- `created_at timestamptz not null default now()`, `completed_at timestamptz`
- 인덱스: `(user_id, created_at)`, `(upload_id)`

**`public.merchant_category_overrides`** — 가맹점별 사용자 카테고리 수정값(ADR-017). 쓰기 RPC는 대시보드 phase에서 만든다.
- `user_id uuid not null references auth.users(id) on delete cascade`
- `merchant_key text not null` 길이 1~200
- `category text not null` — `CATEGORY_IDS` 14개만
- `updated_at timestamptz not null default now()`
- `primary key (user_id, merchant_key)`

**RLS·권한** (ADR-002: 사용자는 본인 행 select만, 쓰기는 service-role RPC만)
- 다섯 테이블 모두 `enable row level security`.
- `cards`·`uploads`·`transactions`·`merchant_category_overrides`에만 select 정책 하나씩: `for select to authenticated using (user_id = (select auth.uid()))`. insert·update·delete·all 정책은 만들지 않는다.
- `upload_attempts`에는 정책을 만들지 않는다(사용자 접근 불가).
- 기본 권한에 기대지 말고 명시한다:
  - 다섯 테이블 모두 `revoke all ... from anon, authenticated`
  - `grant select on` 위 네 테이블 `to authenticated`
  - 다섯 테이블 모두 `grant select, insert, update, delete ... to service_role`

**Storage 버킷** (ADR-007)
- `insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('statements', 'statements', false, 4195328, array['application/octet-stream']) on conflict (id) do nothing;`
  - 4195328 = 원본 상한 4MB(4194304) + 암호화 헤더 여유 1KB
- `storage.objects`에 정책을 만들지 않는다.

### 2. `supabase/tests/upload_schema.test.sql` (pgTAP)

`begin;` → `create extension if not exists pgtap with schema extensions;` → `select plan(N);` → 테스트 → `select * from finish();` → `rollback;`. 사용자 행은 postgres 권한으로 `auth.users`에 `(id, email)`만 넣어 만든다. 사용자 역할 흉내는 `set local role authenticated;`와 `select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);`로 하고, 다음 검사 전에 `reset role;`로 돌아온다.

다음을 단언한다:
- 다섯 테이블이 있고 RLS가 켜져 있다(`pg_class.relrowsecurity`).
- 권한: `authenticated`는 네 테이블에 SELECT만, `upload_attempts`에는 아무 권한도 없다. `anon`은 다섯 테이블 모두 권한이 없다. `service_role`은 다섯 테이블에 SELECT·INSERT·UPDATE·DELETE가 있다(`table_privs_are` 등).
- 사용자 A·B의 카드·업로드·거래·수정값을 postgres로 넣은 뒤, A로 select하면 A의 행만 보인다(네 테이블 각각).
- A로 `cards`에 insert, `transactions`에 update, `uploads`에 delete하면 `42501`.
- `anon`으로 `cards` select하면 `42501`.
- `transactions`에 같은 `(user_id, fingerprint)`를 두 번 넣으면 `23505`.
- `event_kind = 'cancel'`인데 `amount > 0`이면 `23514`. 14개 밖 카테고리면 `23514`.
- 사용자 B의 거래에 A의 `card_id`를 넣으면 `23503`(복합 FK).
- 업로드를 지우면 그 업로드의 거래가 지워진다(cascade).
- `failure_code = 'bad code'`면 `23514`.
- 버킷 `statements`가 있고 `public = false`다. `pg_policies`에 `schemaname = 'storage'`·`tablename = 'objects'`이면서 `qual`이나 `with_check`에 `statements`가 들어간 정책이 0개다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261013000000_upload_schema.sql
test -f supabase/tests/upload_schema.test.sql
test "$(grep -ciE 'enable row level security' supabase/migrations/20261013000000_upload_schema.sql)" -ge 5
! grep -niE 'for (insert|update|delete|all)' supabase/migrations/20261013000000_upload_schema.sql
! grep -niE 'on storage\.objects' supabase/migrations/20261013000000_upload_schema.sql
! grep -niE 'create (or replace )?function' supabase/migrations/20261013000000_upload_schema.sql
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md "데이터 모델"의 테이블·역할과 일치하는가?
   - 사용자에게 쓰기 권한·쓰기 정책이 하나도 없는가? (AGENTS.md CRITICAL)
   - Storage 버킷이 private이고 사용자 정책이 없는가?
3. 결과에 따라 `phases/6-upload-store/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션 파일 경로, 다섯 테이블 이름과 핵심 제약(unique·복합 FK·cascade), 버킷 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase link`, `supabase test db`를 실행하지 마라. 이유: dev DB 마이그레이션은 사용자가 수동으로 push한다(ARCHITECTURE "모드 · 환경").
- 이 step에서 함수·RPC를 만들지 마라. 이유: 다음 step(`upload-rpc`)이 별도 마이그레이션으로 만든다.
- `needs_mapping` 상태, `column_mappings`·`subscriptions`·`ai_summaries`·`user_metrics` 테이블을 만들지 마라. 이유: 각각 fallback-mapping·billing·dashboard phase에서 만든다.
- 사용자(`authenticated`·`anon`)에게 insert·update·delete 권한이나 정책을 주지 마라. 이유: 모든 쓰기는 소유권을 검증하는 service-role RPC로 한다(ADR-002).
- `upload_attempts.upload_id`에 FK를 걸지 마라. 이유: 업로드를 지워도 측정 이력은 남아야 한다(ADR-013).
- 컬럼·테이블·버킷 이름을 위 명세와 다르게 짓지 마라. 이유: 다음 step과 다음 phase가 이 이름을 그대로 쓴다.
- `src/` 코드를 바꾸지 마라. 이 step은 SQL만 다룬다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
