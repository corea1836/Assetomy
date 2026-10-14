# Step 0: insight-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "삭제와 정리", "월 요약")
- `/docs/ADR.md` (ADR-002, ADR-005, ADR-024, **ADR-025**)
- 기존 마이그레이션: `/supabase/migrations/20261013000000_upload_schema.sql`(`merchant_category_overrides_category_check`의 카테고리 14개 목록과 제약 이름 규칙), `/supabase/migrations/20261013000100_upload_rpc.sql`(`private.lock_user`), `/supabase/migrations/20261016000000_ai_summaries.sql`(`ai_summaries` 테이블·RLS·권한), `/supabase/migrations/20261016000100_ai_summary_tips.sql`(지금의 `save_ai_summary` 본문, 기존 요약을 지우고 열을 더한 방식), `/supabase/migrations/20261018000000_card_views.sql`(지금의 `save_card_summary` 본문, `card_summaries`)
- 기존 pgTAP: `/supabase/tests/ai_summaries.test.sql`(`_tap`·`_rpc` 임시 테이블, 임시 사용자, `set local role service_role`, RLS 단언, Auth 삭제 cascade 단언, 마지막 SELECT와 `rollback` 틀), `/supabase/tests/card_views.test.sql`, `/supabase/tests/card_statements.test.sql`
- `/scripts/pgtap.sh`(실행 방식 설명만 읽는다. 실행하지 않는다)

기존 마이그레이션과 pgTAP의 작성 방식을 꼼꼼히 읽고 같은 방식으로 작성하라.

## 배경

인사이트 개인화(ADR-025)의 DB 부분이다.

- 요약의 절약 팁은 이제 카테고리 하나에 붙는다. 팁과 같은 길이의 카테고리 id 배열 `tip_categories`를 `ai_summaries`·`card_summaries`에 저장한다. 요약 형식(두 문단·카테고리 팁)이 바뀌므로 저장된 요약은 모두 지운다(다시 만들 수 있는 캐시다).
- 사용자는 팁마다 그 카테고리에 대한 피드백을 남긴다. 사용자×카테고리마다 하나, 100자, 수정·삭제. 새 테이블 `summary_feedback`과 저장 RPC를 만든다. 피드백은 사용자가 비우고 저장하면 지운다. Auth 사용자를 지우면 FK cascade로 지운다(전체 삭제 RPC는 아직 없다. data-management phase에서 만든다).

## 작업

### 1. 마이그레이션 `supabase/migrations/20261019000000_insight_personalization.sql`

#### 1-1. `summary_feedback` 테이블

```sql
create table public.summary_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint summary_feedback_pkey primary key (user_id, category),
  ...
);
```
- check 제약:
  - `summary_feedback_category_check`: `category in (...)` — `merchant_category_overrides_category_check`와 **같은 14개 id, 같은 순서**.
  - `summary_feedback_body_check`: `char_length(body) between 1 and 100 and body = pg_catalog.btrim(body) and body !~ '[[:cntrl:]]'` (앞뒤 공백·줄바꿈·제어 문자 금지. 서버가 공백을 하나로 줄여 넘긴다).
- RLS를 켜고 정책 하나만 둔다: `summary_feedback_select_own` — `for select to authenticated using (user_id = (select auth.uid()))`.
- 권한: `revoke all on table public.summary_feedback from anon, authenticated;` → `grant select ... to authenticated;` → `grant select, insert, update, delete ... to service_role;` (`ai_summaries`와 같다).

#### 1-2. `save_summary_feedback`

```sql
create function public.save_summary_feedback(p_user_id uuid, p_category text, p_body text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
```
순서를 지켜라.
1. `perform private.lock_user(p_user_id);`
2. `p_category`가 null이면 `raise exception using errcode = '22023', message = 'INVALID_CATEGORY';`
3. `v_body := pg_catalog.btrim(p_body);` 가 null이거나 `''`이면 `delete from public.summary_feedback where user_id = p_user_id and category = p_category;` 후 `{"kind":"deleted"}` (지울 행이 없어도 deleted).
4. 아니면 `insert ... values (p_user_id, p_category, v_body) on conflict (user_id, category) do update set body = excluded.body, updated_at = pg_catalog.now()` → `{"kind":"saved"}`. 카테고리 값·길이·제어 문자 검사는 테이블 check 제약에 맡긴다(어기면 `23514`).
- `revoke execute on function public.save_summary_feedback(uuid, text, text) from public, anon, authenticated;` + `grant execute ... to service_role;`

#### 1-3. 팁 카테고리 열

```sql
-- 요약 형식이 두 문단·카테고리 팁으로 바뀐다(ADR-025). 저장된 요약은 다시 만들 수 있는 캐시이므로 지운다.
delete from public.ai_summaries;
delete from public.card_summaries;
```
그다음 두 테이블에 같은 모양으로 더한다(제약 이름 `ai_summaries_tip_categories_check`·`card_summaries_tip_categories_check`):
```sql
alter table public.ai_summaries
  add column tip_categories text[] not null,
  add constraint ai_summaries_tip_categories_check check (
    cardinality(tip_categories) = cardinality(tips)
    and array_position(tip_categories, null) is null
    and tip_categories <@ array[ ...14개 id... ]::text[]
  );
```
- 14개 id 목록은 1-1과 같다.

#### 1-4. 저장 RPC 다시 만들기

- `drop function public.save_ai_summary(uuid, text, text, text, text, text, text[]);` 후 `p_tip_categories text[]`를 **맨 뒤**에 더한 `public.save_ai_summary(p_user_id uuid, p_month text, p_plan text, p_model text, p_input_hash text, p_summary text, p_tips text[], p_tip_categories text[])`를 만든다. 본문은 `20261016000100_ai_summary_tips.sql`의 것을 그대로 옮기고, insert 열·values와 `on conflict ... do update set`에 `tip_categories`만 더한다(`tip_categories = excluded.tip_categories`). 결과 kind(`saved`·`no_transactions`)와 `INVALID_MONTH` 예외는 그대로다.
- `drop function public.save_card_summary(uuid, uuid, text, text, text, text, text, text[]);` 후 `p_tip_categories text[]`를 **맨 뒤**에 더한 `public.save_card_summary(p_user_id uuid, p_card_id uuid, p_period text, p_plan text, p_model text, p_input_hash text, p_summary text, p_tips text[], p_tip_categories text[])`를 만든다. 본문은 `20261018000000_card_views.sql`의 것을 그대로 옮기고 같은 방식으로 `tip_categories`만 더한다. 결과 kind(`saved`·`card_not_found`·`basis_mismatch`·`no_data`)와 `INVALID_PERIOD` 예외, `to_char` 비교(캐스트 금지)는 그대로다.
- 두 함수 모두 `security invoker`, `set search_path = ''`, 새 시그니처로 `revoke execute ... from public, anon, authenticated;` + `grant execute ... to service_role;`.
- 길이가 다르거나 모르는 카테고리면 1-3의 check 제약이 `23514`로 막는다. RPC 안에서 따로 검사하지 않는다.

### 2. 새 pgTAP `supabase/tests/insight_personalization.test.sql`

기존 파일과 같은 틀(`begin;` → `_tap`·`_rpc` → 단언 → `finish()` → `string_agg` → `rollback;`)로 쓴다. 임시 사용자 id는 `00000000-0000-4000-8000-000000000071`(A)·`...072`(B). 카드·업로드·거래 fixture는 `card_views.test.sql`처럼 `create_card`→`begin_upload`→`ingest_upload`로 만든다(service_role 역할). 단언은 최소 아래를 포함한다.

- `summary_feedback` 스키마: 테이블과 열 5개(`columns_are`), 기본 키 (user_id, category), RLS가 켜져 있고 `summary_feedback_select_own` SELECT 정책 하나만 있다, anon 권한 없음·authenticated SELECT만·service_role SELECT·INSERT·UPDATE·DELETE.
- 권한: `save_summary_feedback(uuid,text,text)`·`save_ai_summary(uuid,text,text,text,text,text,text[],text[])`·`save_card_summary(uuid,uuid,text,text,text,text,text,text[],text[])` EXECUTE는 service_role만, 셋 다 `prosecdef = false`·`search_path=""`. 옛 시그니처 `save_ai_summary(uuid,text,text,text,text,text,text[])`·`save_card_summary(uuid,uuid,text,text,text,text,text,text[])`는 없다(`hasnt_function`).
- `summary_feedback` check 제약(postgres 역할로 직접 insert): category `'coffee'`, body `''`, 101자, `E'줄\n바꿈'`, `' 앞 공백'`은 `23514`. 100자는 들어간다.
- `save_summary_feedback`:
  - A·`grocery`·`'평일 오전 커피예요'` → saved, 행 하나. 같은 키로 `'  주말 장보기예요  '` → saved, 행은 하나이고 body가 `'주말 장보기예요'`(앞뒤 공백 제거)이며 updated_at이 바뀌지 않았거나 늦다(트랜잭션 안이라 같을 수 있다. `>=`로 단언).
  - A·`grocery`·`'   '` → deleted, 행 0. 같은 호출을 한 번 더 → deleted(오류 없음). A·`food`·null → deleted.
  - `p_category` null → `22023`. category `'coffee'`·body 있음 → `23514`. 101자 → `23514`.
  - B의 `grocery` 피드백은 A의 저장·삭제와 상관없이 남는다.
- RLS: `set local role authenticated` + `request.jwt.claims`의 sub를 A로 두면 A의 피드백만 보이고 B의 것은 안 보인다(`ai_summaries.test.sql`의 RLS 단언 방식 그대로).
- 팁 카테고리 열: `ai_summaries`·`card_summaries`에 `tip_categories`가 있고 `text[]`이며 not null이다. postgres 역할 직접 insert에서 tips 2개 + tip_categories 1개, 모르는 id `'coffee'`, null 원소가 있으면 `23514`.
- `save_ai_summary`(새 시그니처): A의 2026-10 거래가 있을 때 `array['팁 하나','팁 둘']`·`array['food','grocery']` → saved, 저장된 `tip_categories = array['food','grocery']`. 같은 키로 다시 저장하면 행은 하나이고 tip_categories가 바뀐다. 길이가 다르면 `23514`. 거래가 없는 달 → no_transactions.
- `save_card_summary`(새 시그니처): 월별 카드·그 달 → saved이고 tip_categories가 저장된다. 기존 kind 분기 하나(`basis_mismatch`)가 그대로 동작한다.
- Auth 삭제: A를 `delete from auth.users`로 지우면 오류 없이(`lives_ok`) A의 피드백이 0행이고 B 피드백은 남는다.

### 3. 기존 pgTAP 갱신

새 시그니처·열 때문에 깨지는 부분만 고친다: `/supabase/tests/ai_summaries.test.sql`, `/supabase/tests/card_views.test.sql`, `/supabase/tests/card_statements.test.sql`.
- `save_ai_summary(..., array[...])`·`save_card_summary(..., array[...])` 호출 끝에 팁 개수와 같은 길이의 카테고리 배열 인자를 더한다(예: `array['팁']` → `array['팁'], array['food']`).
- postgres 역할로 `ai_summaries`·`card_summaries`에 직접 insert하는 곳에는 `tip_categories` 열과 값을 더한다(check 제약 실패를 기대하는 insert는 실패 원인이 그대로 그 제약이 되게 tip_categories를 올바른 값으로 둔다).
- `has_function`·`function_privs_are`·`is(... proconfig ...)` 등에 쓰인 두 RPC의 인자 타입 배열에 `'text[]'`를 하나 더한다. `columns_are` 목록에 `tip_categories`를 더한다.
- 단언의 기대 결과(뜻)를 바꾸지 마라. 단언 수가 바뀌지 않으면 `plan(N)`도 그대로 둔다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261019000000_insight_personalization.sql
test -f supabase/tests/insight_personalization.test.sql
grep -q 'create table public.summary_feedback' supabase/migrations/20261019000000_insight_personalization.sql
grep -q 'create function public.save_summary_feedback' supabase/migrations/20261019000000_insight_personalization.sql
grep -q 'ai_summaries_tip_categories_check' supabase/migrations/20261019000000_insight_personalization.sql
grep -q 'card_summaries_tip_categories_check' supabase/migrations/20261019000000_insight_personalization.sql
grep -q 'drop function public.save_ai_summary(uuid, text, text, text, text, text, text\[\]);' supabase/migrations/20261019000000_insight_personalization.sql
grep -q 'drop function public.save_card_summary(uuid, uuid, text, text, text, text, text, text\[\]);' supabase/migrations/20261019000000_insight_personalization.sql
grep -q '^delete from public.ai_summaries;' supabase/migrations/20261019000000_insight_personalization.sql
grep -q '^delete from public.card_summaries;' supabase/migrations/20261019000000_insight_personalization.sql
! grep -v '^[[:space:]]*--' supabase/migrations/20261019000000_insight_personalization.sql | grep -qiE 'security definer'
test "$(grep -v '^[[:space:]]*--' supabase/migrations/20261019000000_insight_personalization.sql | grep -c 'private.lock_user')" -eq 3
test "$(grep -v '^[[:space:]]*--' supabase/migrations/20261019000000_insight_personalization.sql | grep -c 'auth.uid()')" -eq 1   # RLS 정책 한 곳뿐
! grep -v '^[[:space:]]*--' supabase/migrations/20261019000000_insight_personalization.sql | grep -q 'p_period::date'
grep -q 'string_agg(line' supabase/tests/insight_personalization.test.sql
test "$(tail -n 3 supabase/tests/insight_personalization.test.sql | grep -ciE '^rollback;')" -eq 1
git diff --quiet HEAD -- supabase/migrations/ ':!supabase/migrations/20261019000000_insight_personalization.sql'
git diff --quiet HEAD -- supabase/tests/ ':!supabase/tests/insight_personalization.test.sql' ':!supabase/tests/ai_summaries.test.sql' ':!supabase/tests/card_views.test.sql' ':!supabase/tests/card_statements.test.sql'
git diff --quiet HEAD -- src/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 마이그레이션은 DB에서 실행하지 않으므로 SQL 문법·함수 시그니처·`pg_catalog.` 접두사를 기존 파일(`save_ai_summary`, `save_card_summary`, `set_merchant_category`)과 한 줄씩 대조해 직접 검토한다. 옮긴 두 RPC 본문이 원본과 `tip_categories` 말고는 같은지 diff로 확인한다.
2. 새 pgTAP의 `plan(N)`이 실제 단언 수와 같은지 센다(`from unnest`로 여러 줄을 만드는 단언도 센다). 고친 기존 pgTAP 세 파일도 `plan(N)`과 단언 수가 맞는지 다시 센다.
3. 아키텍처 체크리스트를 확인한다:
   - 쓰기는 service_role RPC로만 되고, 세 RPC가 invoker·빈 search_path이며 사용자 잠금을 먼저 잡는가? (ADR-002)
   - 사용자는 본인 피드백만 select할 수 있는가?
   - 팁과 팁 카테고리의 길이가 다르거나 모르는 카테고리면 DB가 막는가? (ADR-025)
4. 결과에 따라 `phases/13-insight-personalization/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션·pgTAP 파일 경로, `summary_feedback` 키·제약, `save_summary_feedback(uuid,text,text)` 결과 kind, 두 저장 RPC의 새 시그니처, 고친 기존 pgTAP 파일, 새 pgTAP 단언 개수, "dev DB 미적용(push·pgtap.sh 필요)"을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `supabase test db`, `scripts/pgtap.sh`, `npm run test:db`를 실행하지 마라. 이유: dev DB 마이그레이션과 pgTAP 실행은 이 step이 끝난 뒤 따로 한다. 적용 전에는 test:db가 의미가 없다.
- 기존 마이그레이션 파일을 고치지 마라. 이유: 이미 dev DB에 적용됐다. 바뀌는 RPC는 새 마이그레이션에서 drop 후 다시 만든다.
- 기존 pgTAP의 단언 뜻을 바꾸거나 단언을 지우지 마라. 이유: 새 시그니처·열에 맞추는 수정만 이 step의 범위다.
- 새 RPC를 `security definer`로 만들지 마라. 이유: 기존 RPC와 같이 invoker로 두고 service_role 권한 안에서만 쓴다.
- RPC에서 `auth.uid()`를 쓰지 마라(RLS 정책의 `(select auth.uid())` 한 곳만). 이유: 서버가 세션에서 꺼낸 user_id를 넘긴다.
- `summary_feedback`에 기간·카드·요약 id 열을 더하지 마라. 이유: 피드백은 사용자×카테고리 하나이고 모든 요약이 같이 쓴다(ADR-025).
- 앱 코드(`src/`)를 고치지 마라. 이유: 다음 step에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
