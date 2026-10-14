# Step 0: card-statement-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "업로드 흐름", "삭제와 정리")
- `/docs/ADR.md` (ADR-002, ADR-006, ADR-008, ADR-020, **ADR-023**)
- 기존 마이그레이션: `/supabase/migrations/20261013000000_upload_schema.sql`(cards·uploads 제약 이름 규칙), `/supabase/migrations/20261013000100_upload_rpc.sql`(`create_card`·`ingest_upload` 원본), `/supabase/migrations/20261015000000_dashboard.sql`(`uploads_deleted_at` 트리거·`upload_attempts_success` 트리거), `/supabase/migrations/20261015000100_dashboard_deletion_definer.sql`, `/supabase/migrations/20261016000000_ai_summaries.sql`(`delete_upload`의 요약 삭제 문장)
- 기존 pgTAP: `/supabase/tests/upload_schema.test.sql`, `/supabase/tests/upload_rpc.test.sql`, `/supabase/tests/dashboard.test.sql`, `/supabase/tests/ai_summaries.test.sql`(`_tap`·`_rpc` 임시 테이블, 임시 사용자, `set local role service_role`, 마지막 SELECT와 `rollback` 틀)
- `/scripts/pgtap.sh`(실행 방식 설명만 읽는다. 실행하지 않는다)

기존 마이그레이션과 pgTAP의 작성 방식을 꼼꼼히 읽고 같은 방식으로 작성하라.

## 배경

카드를 카드사·이름·분석 기준으로 등록하고, 현대카드 명세서 PDF는 청구서(결제일) 단위로 카드에 이어 붙인다(ADR-023).

- 카드: 카드사(`hyundai`·`shinhan`·`samsung`·`kb`·`lotte`·`hana`·`woori`·`bc`·`nh`), 분석 기준(`month` 월별 / `cycle` 이용 기간), 이용 기간 시작일(1~31, `cycle`일 때만), 카드 상품명(첫 성공 업로드에서 정해짐, 예: `현대카드MM`).
- 업로드: 청구서 결제일(`statement_date`, 예: 2026-10-23)과 PDF 저장 시각(`statement_saved_at`). 둘 다 모르는 형식(나중의 csv)도 있어 null을 허용한다.
- ingest 때 파일의 카드사가 카드의 카드사와 다르거나, 상품명이 카드에 저장된 상품명과 다르면 `CARD_MISMATCH`로 실패시킨다.
- 같은 카드·같은 결제일의 done 업로드가 있으면 저장 시각을 비교한다. 새 파일이 더 늦으면 이전 업로드(거래·그 거래가 있던 달의 요약)를 지우고 새 거래를 넣는다. 아니면 거래를 넣지 않고 no_new로 끝낸다.
- 비교하는 시각은 `least(coalesce(statement_saved_at, created_at), created_at)`이다. 이유: 업로드보다 뒤에 저장된 파일은 없으므로, 기기 시계가 미래로 틀린 PDF가 영원히 이기지 못하게 한다.
- 교체로 지운 업로드는 사용자 삭제가 아니다. `uploads_deleted_at` 트리거가 남긴 `upload_attempts.deleted_at`을 같은 트랜잭션에서 null로 되돌린다. 이유: H5 신뢰 지표(성공 24시간 내 사용자 삭제)를 부풀리지 않는다.
- dev DB는 공유이고 이미 앞선 마이그레이션이 적용돼 있다. 지금까지 읽을 수 있는 파일은 현대카드 PDF뿐이라 기존 카드의 카드사는 `hyundai`로 채운다.

## 작업

### 1. 마이그레이션 `supabase/migrations/20261017000000_card_statements.sql`

#### 1-1. cards 컬럼

```sql
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
```

#### 1-2. uploads 컬럼과 부분 unique index

```sql
alter table public.uploads
  add column statement_date date,
  add column statement_saved_at timestamptz,
  add constraint uploads_statement_saved_at_check check (statement_saved_at is null or statement_date is not null);

-- 카드·청구서마다 done 업로드는 하나다(ADR-023). ingest가 사용자 잠금 아래 지키고, 이 index가 다시 막는다.
create unique index uploads_done_statement_key on public.uploads (user_id, card_id, statement_date)
  where status = 'done' and statement_date is not null;
```

#### 1-3. `create_card` 다시 만들기

인자가 바뀌므로 `drop function public.create_card(uuid, text);` 뒤에 새로 만든다. 새 인자에 default를 두지 않는다(이유: 카드사·분석 기준은 서버가 항상 명시해 넘긴다. 숨은 기본값은 빠뜨린 값을 감춘다).

```sql
create function public.create_card(
  p_user_id uuid, p_label text, p_issuer text, p_analysis_basis text, p_cycle_start_day integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
```
- 라벨 처리·결과는 원본과 같다: `btrim` 후 1~30자가 아니면 `{"kind":"invalid_label"}`, `on conflict (user_id, label) do nothing`으로 겹치면 `{"kind":"duplicate_label"}`, 만들면 `{"kind":"created","card_id":...}`.
- insert 컬럼은 `(user_id, label, issuer, analysis_basis, cycle_start_day)`. 카드사·분석 기준·시작일의 유효성은 테이블 check 제약에 맡긴다(잘못되면 `23514`). `product_name`·`identity_scope`·`cancel_style`은 넣지 않는다(첫 성공 ingest가 정한다).
- `revoke execute on function public.create_card(uuid, text, text, text, integer) from public, anon, authenticated;` + `grant execute ... to service_role;`

#### 1-4. `ingest_upload` 다시 만들기

`drop function public.ingest_upload(uuid, uuid, text, text, jsonb, integer);` 뒤에 새 인자 4개를 **default null**로 더해 만든다(이유: 카드사·상품명·청구서를 모르는 형식은 검사·교체 없이 지금처럼 동작한다. 기존 호출도 그대로 쓸 수 있다).

```sql
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
```

본문은 `20261013000100_upload_rpc.sql`의 원본을 그대로 옮기고 아래만 바꾼다. 순서를 지켜라.

1. 입력 검사(원본) 뒤에 `if p_statement_saved_at is not null and p_statement_date is null then raise exception using errcode = '22023', message = 'INVALID_INGEST_INPUT'; end if;`
2. 잠금 → 업로드 행 `for update` → not_found → not_processing → lease_expired → 카드 행 `for update` → `card_scope_mismatch` (원본 그대로).
3. **카드 검사(새로)**: `p_issuer is not null and v_card.issuer <> p_issuer`이면 reason `'issuer'`, 아니고 `p_product_name is not null and v_card.product_name is not null and v_card.product_name <> p_product_name`이면 reason `'product'`. 둘 중 하나면 업로드를 `status = 'failed', failure_code = 'CARD_MISMATCH', failure_reason = <reason>, lease_expires_at = null, completed_at = now()`로, 시도를 `outcome = 'failed', failure_code = 'CARD_MISMATCH', completed_at = now()`로 바꾸고 `{"kind":"card_mismatch","reason":<reason>}`를 반환한다.
4. 같은 파일(file_hash) 검사 → `duplicate` (원본 그대로).
5. **청구서 비교(새로)**: `p_statement_date is not null`이면 같은 사용자·같은 카드(`v_upload.card_id`)·`status = 'done'`·`statement_date = p_statement_date`·`id <> p_upload_id`인 업로드를 `for update`로 읽는다(`v_previous public.uploads%rowtype`). 있으면:
   - `least(coalesce(p_statement_saved_at, v_upload.created_at), v_upload.created_at) <= least(coalesce(v_previous.statement_saved_at, v_previous.created_at), v_previous.created_at)`이면(새 파일이 더 늦지 않음) 업로드를 `status = 'no_new', inserted_count = 0, duplicate_count = v_row_count, skipped_count = p_skipped, statement_date = p_statement_date, statement_saved_at = p_statement_saved_at, lease_expires_at = null, completed_at = now()`로, 시도를 `outcome = 'no_new', completed_at = now()`로 바꾸고 `{"kind":"older_statement"}`를 반환한다. 거래는 넣지 않는다.
   - 더 늦으면 교체한다. ① `delete_upload`(`20261016000000`)와 같은 문장으로 `v_previous.id` 거래가 있던 달의 `ai_summaries`를 지운다. ② `delete from public.uploads where id = v_previous.id and user_id = p_user_id;`(거래는 FK cascade). ③ `update public.upload_attempts set deleted_at = null where user_id = p_user_id and upload_id = v_previous.id;`(주석: 교체는 사용자 삭제가 아니다, H5). ④ `v_replaced_upload_id := v_previous.id;`
6. 거래 insert와 집계(원본 그대로).
7. done이면 카드를 `identity_scope = coalesce(identity_scope, p_identity_scope), cancel_style = coalesce(cancel_style, p_cancel_style), product_name = coalesce(product_name, p_product_name)`로 갱신한다(첫 성공만 정한다. 원본의 `if v_card.identity_scope is null` 조건문은 이 한 문장으로 바꾼다).
8. 업로드 최종 update에 `statement_date = p_statement_date, statement_saved_at = p_statement_saved_at`를 더한다.
9. 반환 객체에 `'statement_date', p_statement_date, 'replaced_upload_id', v_replaced_upload_id`를 더한다(없으면 JSON null).
- `revoke execute on function public.ingest_upload(uuid, uuid, text, text, jsonb, integer, text, text, date, timestamptz) from public, anon, authenticated;` + `grant execute ... to service_role;`
- 함수 안 내장 함수는 기존처럼 `pg_catalog.` 접두사를 붙인다(`pg_catalog.jsonb_build_object`, `pg_catalog.least`는 키워드라 접두사 없이 `least`, `pg_catalog.to_char` 등).

### 2. 기존 pgTAP 고치기 (시그니처가 바뀐 곳만)

- `supabase/tests/upload_rpc.test.sql`: 권한·`prosecdef` 단언의 `'public.create_card(uuid,text)'`·`'public.ingest_upload(uuid,uuid,text,text,jsonb,integer)'` 문자열(4곳)을 새 시그니처 `'public.create_card(uuid,text,text,text,integer)'`·`'public.ingest_upload(uuid,uuid,text,text,jsonb,integer,text,text,date,timestamptz)'`로 바꾼다. `done`·`no_new` 결과 JSON 전체를 비교하는 `is(...)` 3곳에 `"statement_date":null,"replaced_upload_id":null`을 더한다.
- `upload_rpc.test.sql`·`dashboard.test.sql`·`ai_summaries.test.sql`의 `public.create_card(<user>, <label>)` 호출(16곳)을 `public.create_card(<user>, <label>, 'hyundai', 'month', null)`로 바꾼다. null 라벨·31자 라벨 단언도 같은 방식으로 인자만 늘린다.
- `upload_schema.test.sql`의 `insert into public.cards (id, user_id, label, identity_scope, cancel_style)` fixture에 `issuer`·`analysis_basis` 컬럼과 `'hyundai'`·`'month'` 값을 더한다.
- 위 말고는 기존 단언·plan 수를 바꾸지 마라. 바뀐 결과를 맞추려고 기대값을 고치는 일은 위 목록만 허용한다.

### 3. 새 pgTAP `supabase/tests/card_statements.test.sql`

기존 파일과 같은 틀(`begin;` → `_tap`·`_rpc` → 단언 → `finish()` → `string_agg` → `rollback;`)로 쓴다. 임시 사용자 id는 `00000000-0000-4000-8000-000000000051`~`...053`, 카드·업로드 fixture는 `create_card`→`begin_upload`→`ingest_upload`로 만든다(직접 insert는 unique index 단언에서만). 저장 시각은 고정된 과거 값(예: `T0 = 2026-10-01 00:00:00+00`, `T1 = 2026-10-12 06:15:05+00`, `T2 = 2026-10-13 22:39:44+00`)을 쓴다. 한 트랜잭션 안에서는 `now()`가 같으므로 업로드 시각을 다르게 해야 하는 단언은 postgres 역할로 `created_at`을 과거로 바꿔 둔 뒤 비교한다. 단언은 최소 아래를 포함한다.

- 스키마: cards의 새 컬럼 4개(`has_column`, `col_not_null` issuer·analysis_basis), uploads의 새 컬럼 2개, `uploads_done_statement_key` index가 있다.
- 권한: 새 `create_card`·`ingest_upload` EXECUTE는 service_role만, 둘 다 `prosecdef = false`·`search_path=""`. 옛 시그니처 `public.create_card(uuid,text)`와 `public.ingest_upload(uuid,uuid,text,text,jsonb,integer)`가 없다(`to_regprocedure(...) is null`).
- `create_card`: 월별 카드 → `created`, 행의 issuer·analysis_basis·cycle_start_day(null)·product_name(null)이 맞다. 이용 기간 12일 카드 → `created`, cycle_start_day 12. `23514`: 카드사 `'visa'`, 분석 기준 `'week'`, `cycle`+null 시작일, `month`+12일, `cycle`+0일, `cycle`+32일. 공백 라벨 → `invalid_label`, 같은 라벨 → `duplicate_label`.
- 카드 검사: 신한(`shinhan`)으로 만든 카드에 `p_issuer = 'hyundai'`로 ingest → `{"kind":"card_mismatch","reason":"issuer"}`, 업로드 `failed`·`CARD_MISMATCH`·reason `issuer`, 시도 `failed`, 거래 0행. 상품명 `현대카드MM`이 저장된 카드에 `현대카드ZERO`로 ingest → reason `product`. `p_issuer`·`p_product_name`이 null이면 검사하지 않고 done이다.
- 첫 done이 카드의 `product_name`을 정하고, 다음 done이 다른 값을 넘겨도(같은 상품) 바뀌지 않는다. no_new·failed는 정하지 않는다.
- 청구서 교체: 카드 A에 결제일 2026-10-23·저장 T1로 U1 done(거래 3행, 이 중 한 행은 2026-09 거래) → A의 2026-09·2026-10 요약을 `save_ai_summary`로 저장 → 같은 결제일·저장 T2로 U2(겹치는 행 + 새 행) → `kind = done`, `replaced_upload_id = U1`, `statement_date = 2026-10-23`, U1 행·U1 거래 0행, U2 거래가 겹치는 행까지 모두 들어감(inserted가 U2 행 수와 같다), A의 2026-09·2026-10 요약 삭제, 다른 사용자 요약은 남음, U1 시도의 `deleted_at`이 null, 카드·결제일의 done 업로드는 U2 하나.
- 더 일찍 저장한 파일: 같은 결제일·저장 T0로 U3 → `{"kind":"older_statement"}`, U3 `no_new`·inserted 0·`statement_date` 채워짐, 시도 `no_new`, U2와 그 거래는 그대로. 저장 시각이 같으면(T2) 역시 `older_statement`.
- 저장 시각 없음: 이전 업로드의 저장 시각이 과거(T2)이면 `p_statement_saved_at = null`인 새 업로드(업로드 시각 = now)가 교체한다.
- 미래 저장 시각 제한: 저장 시각 `2099-01-01`로 done한 업로드의 `created_at`을 `2026-10-13 00:00:00+00`으로 바꿔 둔 뒤, 같은 결제일·저장 T2인 새 업로드가 교체한다(제한이 없으면 2099가 이겨 `older_statement`가 된다).
- 결제일이 다르면(2026-09-23) 교체하지 않고 둘 다 done. 같은 결제일이어도 다른 카드면 교체하지 않는다. `p_statement_date`가 null이면 교체 검사를 하지 않는다. `p_statement_saved_at`만 있고 `p_statement_date`가 null이면 `22023`.
- unique index: postgres 역할로 같은 (user, card, statement_date)의 두 번째 done 행을 넣으면 `23505`.
- 교체 뒤 `delete_upload`로 U2를 지우면 그 시도의 `deleted_at`은 채워진다(사용자 삭제는 그대로 기록).

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261017000000_card_statements.sql
test -f supabase/tests/card_statements.test.sql
grep -q 'drop function public.create_card(uuid, text);' supabase/migrations/20261017000000_card_statements.sql
grep -q 'drop function public.ingest_upload(uuid, uuid, text, text, jsonb, integer);' supabase/migrations/20261017000000_card_statements.sql
grep -q 'uploads_done_statement_key' supabase/migrations/20261017000000_card_statements.sql
grep -q "set deleted_at = null" supabase/migrations/20261017000000_card_statements.sql
grep -q "'older_statement'" supabase/migrations/20261017000000_card_statements.sql
grep -q "'card_mismatch'" supabase/migrations/20261017000000_card_statements.sql
test "$(grep -c 'private.lock_user' supabase/migrations/20261017000000_card_statements.sql)" -eq 1
! grep -qi 'security definer' supabase/migrations/20261017000000_card_statements.sql
! grep -q 'auth.uid()' supabase/migrations/20261017000000_card_statements.sql
! grep -q "create_card('00000000-0000-4000-8000-0000000000[0-9][0-9]', '[^']*')" supabase/tests/*.sql
grep -q 'string_agg(line' supabase/tests/card_statements.test.sql
test "$(tail -n 3 supabase/tests/card_statements.test.sql | grep -ciE '^rollback;')" -eq 1
git diff --quiet HEAD -- supabase/migrations/20261013000000_upload_schema.sql supabase/migrations/20261013000100_upload_rpc.sql supabase/migrations/20261014000000_subscriptions.sql supabase/migrations/20261015000000_dashboard.sql supabase/migrations/20261015000100_dashboard_deletion_definer.sql supabase/migrations/20261016000000_ai_summaries.sql supabase/migrations/20261016000100_ai_summary_tips.sql
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 마이그레이션은 DB에서 실행하지 않으므로 SQL 문법·함수 시그니처·`pg_catalog.` 접두사를 기존 파일과 한 줄씩 대조해 직접 검토한다. 특히 새 `ingest_upload`를 원본과 나란히 놓고, "작업 1-4"에 적은 변경 말고는 달라진 줄이 없는지 확인한다.
2. 새 pgTAP의 `plan(N)`이 실제 단언 수와 같은지 센다(`from unnest`·`cross join`으로 여러 줄을 만드는 단언도 센다). 고친 기존 pgTAP의 `plan(N)`은 그대로여야 한다.
3. 아키텍처 체크리스트를 확인한다:
   - 쓰기는 service_role RPC로만 되고, 새 함수도 invoker·빈 search_path인가? (ADR-002)
   - 교체가 사용자 잠금 아래 한 트랜잭션에서 이전 업로드·거래·그 달 요약을 지우고, 시도 이력의 삭제 시각을 되돌리는가? (ADR-023)
   - `p_issuer`·`p_product_name`·`p_statement_date`가 null이면 지금과 똑같이 동작하는가?
4. 결과에 따라 `phases/11-card-statements/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션·pgTAP 파일 경로, cards·uploads 새 컬럼과 제약·index, `create_card`·`ingest_upload` 새 시그니처와 결과 kind(`card_mismatch` reason, `older_statement`, done의 `statement_date`·`replaced_upload_id`), 고친 기존 pgTAP 파일, 새 pgTAP 단언 개수, "dev DB 미적용(사용자 쪽에서 push·pgtap.sh 필요)"을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `supabase test db`, `scripts/pgtap.sh`를 실행하지 마라. 이유: dev DB 마이그레이션과 pgTAP 실행은 이 step이 끝난 뒤 사용자 쪽에서 한다(ARCHITECTURE "모드 · 환경").
- 기존 마이그레이션 파일을 고치지 마라. 이유: 이미 dev DB에 적용됐다. 함수는 새 마이그레이션에서 drop 후 다시 만든다.
- `create function` 전에 옛 시그니처를 drop하지 않은 채 같은 이름의 함수를 만들지 마라. 이유: default가 있는 새 함수와 옛 함수가 함께 있으면 기존 호출이 "function is not unique"로 실패한다.
- `create_card`의 새 인자에 default를 두지 마라. 이유: 카드사·분석 기준을 빠뜨린 호출이 조용히 현대카드·월별 카드를 만들게 된다.
- `security definer`를 쓰지 마라. 이유: 기존 RPC와 같이 invoker로 두고 service_role 권한 안에서만 쓴다. 트리거 함수는 이 step에서 만들거나 바꾸지 않는다.
- `uploads_deleted_at`·`upload_attempts_success` 트리거와 `delete_upload`를 바꾸지 마라. 이유: 사용자 삭제 기록은 그대로 두고, 교체 경로에서만 같은 트랜잭션 안에서 되돌린다.
- RPC에서 `auth.uid()`를 쓰지 마라. 이유: 서버가 세션에서 꺼낸 user_id를 넘긴다.
- 앱 코드(`src/`)를 고치지 마라. 이유: 다음 step에서 한다. 새 `ingest_upload` 인자는 default가 있어 지금 앱 코드가 그대로 동작하지만, `create_card`는 인자가 바뀌어 dev DB에 적용되면 지금 앱의 카드 추가가 실패한다(step 2에서 고친다).
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
