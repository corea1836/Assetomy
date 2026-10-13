# Step 0: dashboard-schema

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("가설 · 지표" 표와 그 아래 규칙, "카테고리")
- `/docs/ARCHITECTURE.md` ("데이터 모델"의 측정 기록 경로, "삭제와 정리")
- `/docs/ADR.md` (ADR-002, ADR-013, ADR-017, ADR-020)
- 기존 마이그레이션: `/supabase/migrations/20261013000000_upload_schema.sql`(테이블·RLS·권한 패턴, `upload_attempts`·`merchant_category_overrides`), `/supabase/migrations/20261013000100_upload_rpc.sql`(`private.lock_user`, `begin_upload`·`ingest_upload`·`fail_upload`·`delete_upload`가 `upload_attempts`를 쓰는 순서), `/supabase/migrations/20261014000000_subscriptions.sql`(`subscriptions`, FK 위반을 `user_not_found`로 돌려주는 방식)
- 기존 pgTAP: `/supabase/tests/upload_schema.test.sql`, `/supabase/tests/upload_rpc.test.sql`, `/supabase/tests/subscriptions.test.sql`(결과를 `_tap`에 모아 마지막 SELECT로 반환, `begin … rollback`, service_role로 RPC 호출)
- `/scripts/pgtap.sh`(실행 방식 설명만 읽는다. 실행하지 않는다)

기존 마이그레이션의 작성 방식을 꼼꼼히 읽고 같은 방식으로 작성하라.

## 배경

대시보드 phase에 필요한 DB 변경을 마이그레이션 하나로 만든다.

1. **측정 이력(PRD H2~H5, ADR-013)**: `user_metrics`는 사용자당 한 행이고 "처음" 시각만 남긴다. 업로드 측정은 이미 있는 `upload_attempts`에 두 칼럼을 더한다.
   - H2 첫 시도·첫 성공, H4 재방문 판정(`extends_period`), H5 업로드 삭제 시각은 **트리거**로 남긴다. 이유: 이미 dev DB에 적용된 업로드 RPC(`begin_upload`·`ingest_upload`·`delete_upload`)를 다시 쓰지 않고, 같은 트랜잭션 안에서 빠짐없이 남기기 위해서다.
   - H3 티저 첫 노출·첫 업그레이드 클릭·첫 실결제는 서버가 RPC `record_metric`으로 남긴다.
2. **카테고리 수정(UC-15, ADR-017)**: 가맹점의 카테고리를 바꾸면 (사용자, 정규화 가맹점명)별 수정값을 저장하고 같은 트랜잭션에서 그 사용자의 같은 가맹점 거래를 모두 바꾼다. 새 업로드는 이미 `merchant_category_overrides`를 먼저 읽는다(`src/lib/queries/merchant-categories.ts`).

사용자는 `user_metrics`·`upload_attempts`에 접근하지 않는다. 모든 쓰기는 service_role 전용 RPC(또는 그 RPC 안에서 도는 트리거)로 한다(ADR-002). dev DB는 공유이므로 pgTAP은 트랜잭션 안에서 돌고 롤백한다(ADR-020).

## 작업

### 1. 마이그레이션 `supabase/migrations/20261015000000_dashboard.sql`

#### 1-1. `user_metrics`
```sql
create table public.user_metrics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_attempt_at timestamptz,   -- 첫 업로드 시도(upload_attempts 첫 행)
  first_success_at timestamptz,   -- 첫 done(no_new는 성공이 아니다)
  teaser_seen_at timestamptz,     -- Free 티저 첫 노출
  first_click_at timestamptz,     -- 첫 업그레이드 클릭(클릭 당시 Free)
  upgrade_source text,            -- 첫 클릭의 source, 클릭 없이 결제했으면 'direct'
  first_paid_at timestamptz       -- production에서 active Pro를 처음 확인한 시각
);
```
- 제약: `upgrade_source in ('teaser','trend','summary','pricing','settings','direct')`. `first_click_at`이 있으면 `upgrade_source`는 `direct`가 아닌 5개 중 하나다. `upgrade_source = 'direct'`면 `first_click_at is null and first_paid_at is not null`이다.
- RLS를 켜고 **정책을 만들지 않는다**. 권한: anon·authenticated에서 모두 revoke, service_role에 select·insert·update·delete.

#### 1-2. `upload_attempts` 칼럼 추가
```sql
alter table public.upload_attempts
  add column extends_period boolean,   -- done일 때만: 기존 최종 이용일보다 뒤의 거래를 추가했나(H4)
  add column deleted_at timestamptz;   -- 업로드 행이 지워진 시각(H5)
```
- `extends_period`는 `outcome = 'done'`일 때만 값이 있다(그 밖에는 null). 제약으로 둔다: `extends_period is null or outcome = 'done'`.

#### 1-3. 트리거 (`private` 스키마의 트리거 함수, `security invoker`, `set search_path = ''`)
- **첫 시도**: `upload_attempts` insert 뒤 → `user_metrics`에 그 사용자 행을 upsert하고 `first_attempt_at`이 null일 때만 새 행의 `created_at`으로 채운다.
- **첫 성공·재방문 판정**: `upload_attempts`의 `outcome`이 `done`이 아니던 행이 `done`으로 바뀔 때(before update):
  - `new.extends_period` = 이 업로드(`new.upload_id`)의 거래 중 가장 늦은 `used_on`이, 같은 사용자의 **다른 업로드** 거래 중 가장 늦은 `used_on`보다 뒤면 true, 아니면 false. 다른 업로드 거래가 없으면 true. 이유: `ingest_upload`는 거래를 넣은 뒤에 `upload_attempts`를 바꾸므로, 이 업로드 거래를 빼고 비교해야 "기존 최종 이용일"이 된다.
  - `user_metrics.first_success_at`이 null일 때만 `new.completed_at`(null이면 `now()`)으로 채운다(행이 없으면 만든다).
- **삭제 시각**: `uploads` 행이 지워진 뒤 → 같은 사용자·같은 `upload_id`의 `upload_attempts` 중 `deleted_at`이 null인 행에 `now()`를 넣는다.
- 트리거 함수는 `revoke execute ... from public, anon, authenticated`.
- 트리거는 auth 사용자 삭제(cascade)로 `uploads`·`upload_attempts`가 지워질 때도 에러 없이 끝나야 한다. 이유: DB 통합 테스트가 끝날 때 admin API로 임시 사용자를 지운다.

#### 1-4. RPC `record_metric`
```sql
public.record_metric(p_user_id uuid, p_event text, p_source text) returns jsonb
```
- `private.lock_user(p_user_id)`로 사용자 잠금을 잡는다. 이유: 이후 phase의 전체 삭제·탈퇴가 같은 잠금 아래에서 측정 이력을 지운다.
- `p_event`:
  - `'teaser_seen'`: 사용자가 Free일 때만(`subscriptions` 행이 없거나 `plan = 'free'`) `teaser_seen_at`이 null이면 `now()`.
  - `'upgrade_click'`: `p_source`는 `teaser/trend/summary/pricing/settings` 중 하나여야 한다. 사용자가 Free이고 `upgrade_source`가 null일 때만 `first_click_at = now()`, `upgrade_source = p_source`. 이유: 첫 클릭 기준 귀속으로 고정하고, H3 클릭 분모는 클릭 당시 Free 사용자다(PRD).
  - `'first_paid'`: `first_paid_at`이 null이면 `now()`, `upgrade_source`가 null이면 `'direct'`. 플랜은 보지 않는다(호출하는 서버가 production active Pro를 확인했다).
  - 그 밖의 `p_event`, `upgrade_click`인데 허용되지 않은 `p_source` → 에러(`raise exception using errcode = '22023'`). 서버 코드가 잘못된 것이므로 숨기지 않는다.
- 결과(jsonb): 값을 새로 채웠으면 `{"kind":"recorded"}`, 조건 때문에 바꾸지 않았으면 `{"kind":"unchanged"}`, auth 사용자가 없으면(FK 위반 `23503`) `{"kind":"user_not_found"}`.

#### 1-5. RPC `set_merchant_category`
```sql
public.set_merchant_category(p_user_id uuid, p_merchant_key text, p_category text) returns jsonb
```
- `private.lock_user(p_user_id)`.
- 그 사용자에게 `merchant_key = p_merchant_key`인 거래가 하나도 없으면 `{"kind":"not_found"}`이고 아무것도 저장하지 않는다. 이유: 남의 가맹점이나 없는 가맹점의 수정값이 쌓이지 않게 한다.
- `merchant_category_overrides`에 upsert(`updated_at = now()`) → 같은 사용자·같은 `merchant_key` 거래 중 카테고리가 다른 행의 `category`를 바꾼다.
- 결과 `{"kind":"updated","updated": 바뀐 거래 수}`.
- 허용되지 않은 카테고리는 테이블 제약 위반 에러를 그대로 낸다(잡지 않는다).

두 RPC 모두 `security invoker`, `set search_path = ''`, `pg_catalog.` 접두사, `revoke execute ... from public, anon, authenticated` + `grant execute ... to service_role`.

### 2. pgTAP `supabase/tests/dashboard.test.sql`

기존 테스트 파일과 같은 틀(`begin` → pgtap 확장 → `_tap` 임시 테이블 → `plan(n)` → 단언 → `finish()` → `select string_agg(line, E'\n' order by n) as tap from _tap;` → `rollback;`)로 쓴다. 테스트 사용자는 트랜잭션 안에서 `auth.users`에 직접 insert하고, 업로드는 실제 RPC(`create_card`·`begin_upload`·`ingest_upload`·`delete_upload`)를 service_role로 불러 만든다.

단언(최소):
- `user_metrics`: RLS 켜짐, 정책 0개, anon·authenticated 권한 없음, service_role 권한 있음. 칼럼 제약(잘못된 source, click이 있는데 direct, direct인데 결제 없음)이 거절된다.
- `record_metric`·`set_merchant_category` EXECUTE: anon·authenticated 없음, service_role 있음. 두 함수와 트리거 함수가 invoker이고 빈 search_path다.
- 첫 시도: 처음 `begin_upload` → `first_attempt_at`이 채워지고, 두 번째 시도는 값을 바꾸지 않는다.
- 첫 성공: `ingest_upload`가 done → `first_success_at` 채움. no_new·`fail_upload`로 끝난 시도는 채우지 않는다. 두 번째 done은 값을 바꾸지 않는다.
- `extends_period`: 첫 done은 true. 기존 최종 이용일보다 뒤 거래가 있는 업로드는 true. 기존 기간 안의 거래만 새로 넣은 업로드는 false. no_new·failed 시도는 null.
- 삭제 시각: `delete_upload` 뒤 그 업로드의 `upload_attempts.deleted_at`이 채워지고 행은 남는다. 다른 업로드의 시도는 그대로다.
- `record_metric`:
  - Free 사용자 `teaser_seen` → recorded, 다시 → unchanged. Pro 사용자(`save_subscription`으로 pro 저장) → unchanged이고 값이 없다.
  - Free `upgrade_click`(`teaser`) → recorded·source teaser. 이어서 `pricing` → unchanged이고 source는 teaser 그대로. Pro 사용자 클릭 → unchanged.
  - 클릭 없는 사용자 `first_paid` → recorded·source `direct`. 클릭이 있던 사용자 `first_paid` → source 유지. 두 번째 `first_paid` → unchanged.
  - 없는 사용자 → user_not_found이고 행이 생기지 않는다. 알 수 없는 event·허용되지 않은 source → 에러(`throws_ok`).
- `set_merchant_category`:
  - 같은 `merchant_key` 거래 2건(서로 다른 달)과 다른 가맹점 거래가 있을 때 → updated 2, 두 거래만 바뀌고 수정값 행이 생긴다. 같은 카테고리로 다시 → updated 0.
  - 다른 사용자의 같은 `merchant_key` 거래는 바뀌지 않는다.
  - 거래가 없는 `merchant_key` → not_found이고 수정값 행이 없다. 허용되지 않은 카테고리 → 에러.
- auth 사용자를 지우면(업로드·시도·지표가 있는 상태) 에러 없이 `user_metrics`·`upload_attempts`가 cascade로 지워진다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261015000000_dashboard.sql
test -f supabase/tests/dashboard.test.sql
grep -qiE 'create table public.user_metrics' supabase/migrations/20261015000000_dashboard.sql
! grep -niE 'create policy' supabase/migrations/20261015000000_dashboard.sql
! grep -niE 'security definer|auth\.uid\(\)' supabase/migrations/20261015000000_dashboard.sql
test "$(grep -c 'private.lock_user' supabase/migrations/20261015000000_dashboard.sql)" -ge 2
grep -q 'string_agg(line' supabase/tests/dashboard.test.sql
test "$(tail -n 3 supabase/tests/dashboard.test.sql | grep -ciE '^rollback;')" -eq 1
git diff --quiet HEAD -- supabase/migrations/20261013000000_upload_schema.sql supabase/migrations/20261013000100_upload_rpc.sql supabase/migrations/20261014000000_subscriptions.sql
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 마이그레이션은 DB에서 실행하지 않으므로, SQL 문법·함수 시그니처·`pg_catalog.` 접두사를 기존 파일과 한 줄씩 대조해 직접 검토한다.
2. 아키텍처 체크리스트를 확인한다:
   - `user_metrics`·`upload_attempts`에 사용자 정책·권한이 하나도 없는가? (ARCHITECTURE "데이터 모델")
   - RPC·트리거 함수가 `security invoker`·`search_path = ''`이고, RPC는 service_role 전용 EXECUTE인가?
   - `record_metric`이 클릭 당시 Free만 기록하고, 첫 클릭 source를 바꾸지 않는가? (PRD "가설 · 지표")
   - `set_merchant_category`가 사용자 잠금 아래 한 트랜잭션에서 수정값과 거래를 함께 바꾸는가? (ADR-017)
3. 결과에 따라 `phases/9-dashboard/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 마이그레이션·pgTAP 파일 경로, `user_metrics` 칼럼과 제약, `upload_attempts` 추가 칼럼, 트리거 이름과 동작, 두 RPC 시그니처와 결과 kind별 jsonb 필드, 단언 개수를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase db query`, `supabase link`, `supabase test db`, `scripts/pgtap.sh`를 실행하지 마라. 이유: dev DB 마이그레이션과 pgTAP 실행은 이 step이 끝난 뒤 사용자 쪽에서 한다(ARCHITECTURE "모드 · 환경").
- 기존 마이그레이션 파일(`20261013*.sql`, `20261014*.sql`)을 고치지 마라. 기존 업로드 RPC를 `create or replace`로 다시 정의하지도 마라. 이유: 이미 dev DB에 적용됐고, 측정은 트리거로 남기기로 했다.
- 사용자(authenticated)에게 `user_metrics`·`upload_attempts` 권한이나 정책을 주지 마라. 이유: 측정 이력은 사용자가 접근하지 않는다(ARCHITECTURE "데이터 모델").
- `security definer`를 쓰지 마라. 이유: 기존 함수와 같이 invoker로 두고 service_role 권한 안에서만 쓴다.
- RPC에서 `auth.uid()`를 쓰지 마라. 이유: 서버가 세션에서 꺼낸 user_id를 넘긴다.
- `ai_summaries` 테이블을 만들지 마라. 이유: 10-ai-summary에서 만든다.
- 앱 코드(`src/`)를 고치지 마라. 이유: 다음 step에서 한다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
