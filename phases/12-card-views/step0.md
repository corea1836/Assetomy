# Step 0: card-view-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "삭제와 정리", "카드 탭")
- `/docs/ADR.md` (ADR-002, ADR-023, **ADR-024**)
- 기존 마이그레이션: `/supabase/migrations/20261013000000_upload_schema.sql`(cards의 `cards_user_id_id_key`·제약 이름 규칙), `/supabase/migrations/20261013000100_upload_rpc.sql`(`private.lock_user`, `create_card` 원본), `/supabase/migrations/20261015000000_dashboard.sql`(`private.record_upload_deletion`과 `uploads_deleted_at` 트리거), `/supabase/migrations/20261015000100_dashboard_deletion_definer.sql`(트리거 함수를 security definer로 둔 이유), `/supabase/migrations/20261016000000_ai_summaries.sql`·`/supabase/migrations/20261016000100_ai_summary_tips.sql`(`ai_summaries` 테이블·RLS·권한·`save_ai_summary`), `/supabase/migrations/20261017000000_card_statements.sql`(cards의 issuer·analysis_basis·cycle_start_day 제약, uploads의 statement_date)
- 기존 pgTAP: `/supabase/tests/ai_summaries.test.sql`(`_tap`·`_rpc` 임시 테이블, 임시 사용자, `set local role service_role`, RLS 단언, Auth 삭제 cascade 단언, 마지막 SELECT와 `rollback` 틀), `/supabase/tests/card_statements.test.sql`(`create_card`·`begin_upload`·`ingest_upload`로 fixture 만드는 방식)
- `/scripts/pgtap.sh`(실행 방식 설명만 읽는다. 실행하지 않는다)

기존 마이그레이션과 pgTAP의 작성 방식을 꼼꼼히 읽고 같은 방식으로 작성하라.

## 배경

대시보드에 카드 탭을 더한다(ADR-024). 카드 탭마다 AI 카드 요약을 만들고 저장한다.

- 월별 카드(`analysis_basis = 'month'`)의 요약은 그 카드의 달력 월(`'YYYY-MM'`) 하나에 하나다.
- 이용 기간 카드(`analysis_basis = 'cycle'`)의 요약은 그 카드의 명세서(결제일 `'YYYY-MM-DD'`, `uploads.statement_date`) 하나에 하나다.
- 요약은 다시 만들 수 있는 캐시다. 그 카드의 done 업로드가 지워지면(사용자 삭제·청구서 교체·보관 기한·전체 삭제) 그 카드의 요약을 **모두** 지운다. 지운 거래의 가맹점명이 요약에 남지 않게 하기 위해서다.
- 사용자는 카드 이름과 분석 기준(월별 / 이용 기간 시작일)을 바꿀 수 있다. 카드사는 바꾸지 않는다(업로드 검사 기준이다). 분석 기준이나 시작일이 바뀌면 그 카드 요약을 모두 지운다.
- `ai_summaries`(전체 탭의 월 요약)는 그대로 둔다.

## 작업

### 1. 마이그레이션 `supabase/migrations/20261018000000_card_views.sql`

#### 1-1. `card_summaries` 테이블

```sql
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
  ...
);
```
- check 제약(이름은 `card_summaries_<컬럼>_check`):
  - `period`: `period ~ '^[0-9]{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12][0-9]|3[01]))?$'` (달 `YYYY-MM` 또는 날짜 `YYYY-MM-DD`)
  - `plan in ('free', 'pro')`, `char_length(model) between 1 and 100`, `input_hash ~ '^[0-9a-f]{64}$'`, `char_length(summary) between 1 and 1000`
  - `tips`: `ai_summaries_tips_check`와 같은 식(1~5개, null·빈 문자열 없음, 합쳐서 1500자 이하)
- RLS를 켜고 정책 하나만 둔다: `card_summaries_select_own` — `for select to authenticated using (user_id = (select auth.uid()))`.
- 권한: `revoke all on table public.card_summaries from anon, authenticated;` → `grant select ... to authenticated;` → `grant select, insert, update, delete ... to service_role;` (`ai_summaries`와 같다)

#### 1-2. `save_card_summary`

```sql
create function public.save_card_summary(
  p_user_id uuid, p_card_id uuid, p_period text, p_plan text, p_model text,
  p_input_hash text, p_summary text, p_tips text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
```
순서를 지켜라.
1. `perform private.lock_user(p_user_id);`
2. `p_period`가 null이면 `raise exception using errcode = '22023', message = 'INVALID_PERIOD';`
3. 카드를 `where c.id = p_card_id and c.user_id = p_user_id`로 읽는다. 없으면 `{"kind":"card_not_found"}`.
4. 카드가 `month`이면 `p_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`가 아니면 `{"kind":"basis_mismatch"}`. 맞으면 그 카드의 거래(`t.user_id = p_user_id and t.card_id = p_card_id`) 중 그 달(`used_on >= 달 1일 and used_on < 다음 달 1일`)이 없으면 `{"kind":"no_data"}`.
5. 카드가 `cycle`이면 `p_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`가 아니면 `{"kind":"basis_mismatch"}`. 맞으면 그 카드의 `status = 'done'`이고 `pg_catalog.to_char(u.statement_date, 'YYYY-MM-DD') = p_period`인 업로드가 없으면 `{"kind":"no_data"}`. **`p_period::date`로 캐스트하지 마라**(이유: `2026-02-30` 같은 값이 22008 예외가 된다. 문자열로 비교하면 그냥 no_data다).
6. `insert ... on conflict (user_id, card_id, period) do update set plan, model, input_hash, summary, tips, updated_at = pg_catalog.now()` → `{"kind":"saved"}`.
- `revoke execute on function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[]) from public, anon, authenticated;` + `grant execute ... to service_role;`

#### 1-3. `update_card`

```sql
create function public.update_card(
  p_user_id uuid, p_card_id uuid, p_label text, p_analysis_basis text, p_cycle_start_day integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
```
순서를 지켜라.
1. `perform private.lock_user(p_user_id);`
2. 카드 행을 `where c.id = p_card_id and c.user_id = p_user_id for update`로 읽는다(`v_card public.cards%rowtype`). 없으면 `{"kind":"not_found"}`.
3. `v_label := pg_catalog.btrim(p_label)`. null이거나 1~30자가 아니면 `{"kind":"invalid_label"}`.
4. 같은 사용자의 **다른** 카드(`id <> p_card_id`)에 같은 라벨이 있으면 `{"kind":"duplicate_label"}`. (자기 라벨 그대로 저장은 허용한다.)
5. `update public.cards set label = v_label, analysis_basis = p_analysis_basis, cycle_start_day = p_cycle_start_day where id = p_card_id and user_id = p_user_id;` — 기준·시작일의 유효성은 테이블 check 제약에 맡긴다(잘못되면 `23514`, `create_card`와 같다). `issuer`·`product_name`·`identity_scope`·`cancel_style`은 바꾸지 않는다.
6. `(v_card.analysis_basis, v_card.cycle_start_day) is distinct from (p_analysis_basis, p_cycle_start_day)`이면 `delete from public.card_summaries where user_id = p_user_id and card_id = p_card_id;` (주석: 기준이 바뀌면 이전 기준의 요약은 다시 볼 수 없다.) 이름만 바뀌면 요약을 지우지 않는다(요약 입력에 카드 이름이 없다).
7. `{"kind":"updated"}`.
- `revoke execute on function public.update_card(uuid, uuid, text, text, integer) from public, anon, authenticated;` + `grant execute ... to service_role;`

#### 1-4. 업로드 삭제 트리거

```sql
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
```
- 주석으로 이유 두 가지를 남긴다: ① 사용자 삭제(`delete_upload`)·청구서 교체(`ingest_upload`)·보관 기한·전체 삭제가 모두 uploads 행 삭제를 거치므로, 이미 적용된 RPC를 고치지 않고 한 곳에서 지운다. ② Auth 사용자 삭제의 cascade에서는 Auth 역할로 실행되는데 그 역할에는 `card_summaries` 권한이 없어서 `security definer`다(`20261015000100_dashboard_deletion_definer.sql`과 같은 이유).
- 이 마이그레이션에서 `security definer`는 이 함수 하나뿐이다.

### 2. 새 pgTAP `supabase/tests/card_views.test.sql`

기존 파일과 같은 틀(`begin;` → `_tap`·`_rpc` → 단언 → `finish()` → `string_agg` → `rollback;`)로 쓴다. 임시 사용자 id는 `00000000-0000-4000-8000-000000000061`(A)·`...062`(B). 카드·업로드·거래 fixture는 `create_card`→`begin_upload`→`ingest_upload`로 만든다(service_role 역할). 단언은 최소 아래를 포함한다.

- 스키마: `card_summaries` 테이블과 열 10개(`columns_are`), `tips`는 `text[]`, 기본 키 (user_id, card_id, period), RLS가 켜져 있고 `card_summaries_select_own` SELECT 정책 하나만 있다, anon 권한 없음·authenticated SELECT만·service_role SELECT·INSERT·UPDATE·DELETE.
- 권한: `save_card_summary(uuid,uuid,text,text,text,text,text,text[])`·`update_card(uuid,uuid,text,text,integer)` EXECUTE는 service_role만, 둘 다 `prosecdef = false`·`search_path=""`. `private.delete_card_summaries_for_upload()`는 `prosecdef = true`·`search_path=""`. `uploads_card_summaries` 트리거가 `public.uploads`에 있다.
- check 제약: postgres 역할로 직접 insert할 때 period `'2026-13'`, `'2026-10-32'`, `'202610'`, plan `'team'`, input_hash `'abc'`, tips 빈 배열·6개는 `23514`.
- `save_card_summary` (월별 카드 MA에 2026-10 거래가 있고 2026-09에는 없음, 이용 기간 카드 CA에 결제일 2026-10-23 done 업로드):
  - MA·`2026-10` → saved, 행이 생긴다. 같은 키로 다시 저장하면 행은 하나이고 summary·tips·input_hash·updated_at이 바뀐다.
  - MA·`2026-09` → no_data. MA·`2026-10-23` → basis_mismatch.
  - CA·`2026-10-23` → saved. CA·`2026-09-23` → no_data. CA·`2026-10` → basis_mismatch. CA·`2026-02-30` → no_data(예외가 아니다).
  - B 사용자로 A의 카드 id를 넘기면 card_not_found. 없는 카드 id → card_not_found. `p_period` null → `22023`.
- `update_card`:
  - MA 이름만 바꾸기 → updated, 라벨이 바뀌고(앞뒤 공백 제거) MA 요약은 남는다.
  - MA를 `cycle`·12일로 → updated, analysis_basis·cycle_start_day가 바뀌고 MA 요약이 모두 지워진다. issuer·product_name은 그대로다.
  - CA의 시작일만 12 → 15 → CA 요약이 지워진다.
  - 다른 카드의 라벨 → duplicate_label. 자기 라벨 그대로 → updated. 공백 라벨·31자 라벨 → invalid_label.
  - `month` + 12일, `cycle` + null, `cycle` + 32일 → `23514`.
  - B 사용자로 A의 카드 → not_found, A 카드 행은 그대로.
  - A의 다른 카드 요약·B의 요약은 어떤 경우에도 남는다.
- 트리거:
  - MA와 다른 카드 MB에 요약을 둔 뒤 `delete_upload`로 MA의 done 업로드를 지우면 MA 요약 0행, MB 요약은 남는다.
  - 청구서 교체: CA의 결제일 2026-10-23 업로드(저장 시각 과거)를 더 늦게 저장한 같은 결제일 파일로 `ingest_upload`해 교체하면(`replaced_upload_id`가 채워짐) CA 요약이 지워진다.
  - postgres 역할로 failed 업로드 행을 지우면 그 카드 요약은 남는다(`when (old.status = 'done')`).
  - postgres 역할로 카드 행을 지우는 대신, A를 `delete from auth.users`로 지우면 오류 없이(`lives_ok`) A의 요약이 0행이고 B 요약은 남는다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261018000000_card_views.sql
test -f supabase/tests/card_views.test.sql
grep -q 'create table public.card_summaries' supabase/migrations/20261018000000_card_views.sql
grep -q 'card_summaries_user_id_card_id_fkey' supabase/migrations/20261018000000_card_views.sql
grep -q 'create function public.save_card_summary' supabase/migrations/20261018000000_card_views.sql
grep -q 'create function public.update_card' supabase/migrations/20261018000000_card_views.sql
grep -q "when (old.status = 'done')" supabase/migrations/20261018000000_card_views.sql
test "$(grep -v '^[[:space:]]*--' supabase/migrations/20261018000000_card_views.sql | grep -ciE '^[[:space:]]*security definer[[:space:]]*$')" -eq 1
test "$(grep -v '^[[:space:]]*--' supabase/migrations/20261018000000_card_views.sql | grep -c 'private.lock_user')" -eq 2
test "$(grep -v '^[[:space:]]*--' supabase/migrations/20261018000000_card_views.sql | grep -c 'auth.uid()')" -eq 1   # RLS 정책 한 곳뿐
! grep -v '^[[:space:]]*--' supabase/migrations/20261018000000_card_views.sql | grep -q 'p_period::date'
grep -q 'string_agg(line' supabase/tests/card_views.test.sql
test "$(tail -n 3 supabase/tests/card_views.test.sql | grep -ciE '^rollback;')" -eq 1
git diff --quiet HEAD -- supabase/migrations/ ':!supabase/migrations/20261018000000_card_views.sql'
git diff --quiet HEAD -- supabase/tests/ ':!supabase/tests/card_views.test.sql'
git diff --quiet HEAD -- src/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 마이그레이션은 DB에서 실행하지 않으므로 SQL 문법·함수 시그니처·`pg_catalog.` 접두사를 기존 파일(`save_ai_summary`, `create_card`)과 한 줄씩 대조해 직접 검토한다.
2. 새 pgTAP의 `plan(N)`이 실제 단언 수와 같은지 센다(`from unnest`로 여러 줄을 만드는 단언도 센다).
3. 아키텍처 체크리스트를 확인한다:
   - 쓰기는 service_role RPC로만 되고, 두 RPC가 invoker·빈 search_path이며 사용자 잠금을 먼저 잡는가? (ADR-002)
   - 사용자는 본인 카드 요약만 select할 수 있는가?
   - 업로드 삭제·청구서 교체·Auth 삭제 cascade 모두에서 그 카드 요약이 지워지는가? (ADR-024)
4. 결과에 따라 `phases/12-card-views/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션·pgTAP 파일 경로, `card_summaries` 키·FK, `save_card_summary`·`update_card` 시그니처와 결과 kind, 트리거 이름과 조건, 새 pgTAP 단언 개수, "dev DB 미적용(사용자 쪽에서 push·pgtap.sh 필요)"을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `supabase test db`, `scripts/pgtap.sh`, `npm run test:db`를 실행하지 마라. 이유: dev DB 마이그레이션과 pgTAP 실행은 이 step이 끝난 뒤 사용자 쪽에서 한다. 이 마이그레이션이 dev DB에 적용되기 전에는 test:db가 의미가 없다.
- 기존 마이그레이션·기존 pgTAP 파일을 고치지 마라. 이유: 이미 dev DB에 적용됐고, 이 step은 새 테이블·함수·트리거만 더한다.
- `delete_upload`·`ingest_upload`·`save_ai_summary`·`ai_summaries`를 다시 만들거나 바꾸지 마라. 이유: 카드 요약 삭제는 uploads 트리거 한 곳에서 한다.
- `save_card_summary`·`update_card`를 `security definer`로 만들지 마라. 이유: 기존 RPC와 같이 invoker로 두고 service_role 권한 안에서만 쓴다. 트리거 함수만 예외다(Auth cascade).
- RPC에서 `auth.uid()`를 쓰지 마라(RLS 정책의 `(select auth.uid())` 한 곳만 쓴다). 이유: 서버가 세션에서 꺼낸 user_id를 넘긴다.
- `update_card`가 `issuer`를 바꾸게 하지 마라. 이유: 카드사는 업로드 검사(CARD_MISMATCH)의 기준이다(ADR-024).
- 앱 코드(`src/`)를 고치지 마라. 이유: 다음 step에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
