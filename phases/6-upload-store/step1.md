# Step 1: upload-rpc

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("데이터 모델", "업로드 흐름", "삭제와 정리")
- `/docs/ADR.md` (ADR-002, ADR-006, ADR-008, ADR-009, ADR-013)
- `/docs/PRD.md` ("지원 범위", "운영 한도")
- 이전 step 산출물: `/supabase/migrations/20261013000000_upload_schema.sql`, `/supabase/tests/upload_schema.test.sql`
- `/src/types/category.ts`, `/src/types/parsing.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

모든 쓰기는 service_role에만 EXECUTE를 준 RPC로 한다. RPC는 `auth.uid()`를 쓰지 않고, 서버가 세션에서 꺼내 넘긴 `p_user_id`로 행 소유권·상태·lease를 검증한다(ADR-002). 사용자 단위 쓰기는 사용자별 advisory lock으로 직렬화한다. 이 세션은 SQL을 DB에 적용하지 않는다(사용자가 push한다). 그래서 SQL을 실행해 볼 수 없다. plpgsql 문법, `jsonb_to_recordset`, `on conflict ... do nothing returning`, `get diagnostics` 같은 구문을 꼼꼼히 확인하라.

## 작업

### 1. `supabase/migrations/20261013000100_upload_rpc.sql`

공통 규칙(모든 함수):
- `language plpgsql`(잠금 함수는 sql도 가능), `security invoker`, `set search_path = ''`. 본문의 모든 테이블·함수는 스키마 이름을 붙인다(`public.uploads`, `private.lock_user`, `pg_catalog.now()`는 생략 가능).
- 함수마다 `revoke execute on function ... from public, anon, authenticated;` 후 `grant execute on function ... to service_role;`.
- 결과는 `jsonb` 객체 하나로 돌려준다. 키는 snake_case이고 항상 `kind`가 있다. 예상한 실패(남의 리소스, 한도 등)는 예외가 아니라 `kind`로 돌려준다. 입력 형식 위반(제약 위반)은 예외 그대로 둔다.
- 남의 리소스와 없는 리소스는 같은 `kind`(`not_found`·`card_not_found`)로 돌려준다(ARCHITECTURE: 타인 리소스는 404).

**잠금 헬퍼**
- `create schema if not exists private;`, `revoke all on schema private from public, anon, authenticated;`, `grant usage on schema private to service_role;`. 이유: `private` 스키마는 Data API에 노출되지 않는다.
- `private.lock_user(p_user_id uuid) returns void` — `pg_advisory_xact_lock(hashtextextended('assetomy:user:' || p_user_id::text, 0))`. EXECUTE는 service_role만.

**`public.create_card(p_user_id uuid, p_label text) returns jsonb`**
- `btrim(p_label)`이 null이거나 길이가 1~30이 아니면 `{kind:'invalid_label'}`.
- insert `on conflict (user_id, label) do nothing returning id` → `{kind:'created', card_id}`, 충돌이면 `{kind:'duplicate_label'}`.

**`public.begin_upload(p_user_id uuid, p_card_id uuid, p_file_name text, p_file_hash text, p_file_size integer) returns jsonb`**

`private.lock_user(p_user_id)` 아래에서 이 순서대로 한다:
1. 카드가 `p_user_id` 소유가 아니면 `{kind:'card_not_found'}`.
2. `upload_attempts`에서 이 사용자의 `created_at > now() - interval '24 hours'`가 30개 이상이면 `{kind:'rate_limited'}`(시도를 기록하지 않음).
3. `uploads`에서 이 사용자의 `status = 'processing' and lease_expires_at > now()`가 2개 이상이면 `{kind:'busy'}`(시도를 기록하지 않음). lease가 만료된 processing은 세지 않는다.
4. `upload_attempts`에 행을 넣는다(outcome null).
5. 이 사용자의 `status = 'done'`인 업로드 중 `file_hash = p_file_hash`가 있으면, 업로드 행을 만들지 않는다. 방금 넣은 시도의 `outcome = 'no_new'`, `completed_at = now()`로 갱신하고 `{kind:'duplicate', existing_card_id}`(그 done 업로드의 card_id, 여러 개면 가장 이른 것)를 돌려준다.
6. 아니면 `uploads`에 `status = 'processing'`, `lease_expires_at = now() + interval '6 minutes'`로 넣는다. 시도의 `upload_id`를 새 업로드 id로 갱신하고 `{kind:'started', upload_id, lease_expires_at}`를 돌려준다.

**`public.ingest_upload(p_user_id uuid, p_upload_id uuid, p_identity_scope text, p_cancel_style text, p_rows jsonb, p_skipped integer) returns jsonb`**

`p_rows`는 `[{used_on:'YYYY-MM-DD', merchant, merchant_key, amount, event_kind, category, fingerprint}, ...]` 배열이다. 배열이 아니거나 5000개를 넘으면, 또는 `p_skipped`가 null이거나 음수면 예외를 던진다(`raise exception using errcode = '22023'`).

`private.lock_user(p_user_id)` 아래에서, 하나의 트랜잭션으로 이 순서대로 한다:
1. `p_upload_id`이면서 `p_user_id` 소유인 업로드를 `for update`로 읽는다. 없으면 `{kind:'not_found'}`.
2. `status <> 'processing'`이면 `{kind:'not_processing', status}`.
3. `lease_expires_at <= now()`면 업로드를 `status = 'failed'`, `failure_code = 'LEASE_EXPIRED'`, `lease_expires_at = null`, `completed_at = now()`로 바꾼다. 시도(`upload_attempts.upload_id = p_upload_id`)를 `outcome = 'failed'`, `failure_code = 'LEASE_EXPIRED'`, `completed_at = now()`로 바꾸고 `{kind:'lease_expired'}`. 이유: 늦은 커밋을 거절하고 만료 행을 끝낸다(ADR-008).
4. 업로드의 카드를 `for update`로 읽는다. `identity_scope`가 있는데 `(identity_scope, cancel_style)`이 `(p_identity_scope, p_cancel_style)`와 다르면, 업로드와 시도를 `failed`·`CARD_SCOPE_MISMATCH`로 끝내고 `{kind:'card_scope_mismatch'}`(ADR-006 카드 고정).
5. 이 사용자의 다른 업로드 중 `status = 'done'`이고 `file_hash`가 같은 것이 있으면, 업로드를 `status = 'no_new'`, `inserted_count = 0`, `duplicate_count = jsonb_array_length(p_rows)`, `skipped_count = p_skipped`, `lease_expires_at = null`, `completed_at = now()`로 바꾼다. 시도를 `no_new`로 바꾸고 `{kind:'duplicate', existing_card_id}`. 이유: 같은 파일이 동시에 처리된 경우다.
6. `jsonb_to_recordset(p_rows)`의 행을 `public.transactions`에 `(user_id, card_id, upload_id)` = (p_user_id, 업로드의 card_id, p_upload_id)로 넣는다. `on conflict (user_id, fingerprint) do nothing`이고, 실제로 들어간 행만 센다.
7. `inserted` = 들어간 행 수, `duplicates` = `jsonb_array_length(p_rows) - inserted`, `period_from`·`period_to` = 들어간 행의 `used_on` 최소·최대, `net_amount` = 들어간 행의 `amount` 합(없으면 0).
8. `inserted = 0`이면 `status = 'no_new'`, 아니면 `status = 'done'`. done이고 카드의 `identity_scope`가 null이면 카드에 `(p_identity_scope, p_cancel_style)`을 저장한다(첫 성공 업로드로 고정).
9. 업로드에 `status`, `lease_expires_at = null`, 세 개수, 기간, `net_amount`, `completed_at = now()`를 저장한다. 시도를 같은 outcome과 `completed_at = now()`로 갱신한다.
10. `{kind: 'done' | 'no_new', inserted, duplicates, skipped, period_from, period_to, net_amount}`를 돌려준다(no_new면 기간은 null).

**`public.fail_upload(p_user_id uuid, p_upload_id uuid, p_code text, p_reason text) returns jsonb`**
- `lock_user` 아래에서 `p_user_id` 소유 업로드를 `for update`로 읽는다. 없으면 `{kind:'not_found'}`, processing이 아니면 `{kind:'not_processing', status}`.
- `status = 'failed'`, `failure_code = p_code`, `failure_reason = p_reason`, `lease_expires_at = null`, `completed_at = now()`. 시도도 `failed`·`p_code`로 갱신한다. `{kind:'failed'}`.
- 코드·reason 형식은 테이블 check가 강제한다(위반 시 `23514` 예외).

**`public.delete_upload(p_user_id uuid, p_upload_id uuid) returns jsonb`**
- `lock_user` 아래에서 `p_user_id` 소유 업로드를 `for update`로 읽는다. 없으면 `{kind:'not_found'}`.
- `status = 'processing' and lease_expires_at > now()`면 `{kind:'processing'}`(지우지 않음).
- 아니면 업로드 행을 지운다(그 업로드의 거래는 FK cascade로 지워진다). `upload_attempts`는 그대로 둔다. `{kind:'deleted'}`.
- Storage 원본은 지우지 않는다. 커밋 후 서버 코드가 지운다(ARCHITECTURE "삭제와 정리").

### 2. `supabase/tests/upload_rpc.test.sql` (pgTAP)

형식은 `upload_schema.test.sql`과 같다(`begin` … `rollback`, `auth.users`에 `(id, email)`로 사용자 생성). 동작 검사는 `set local role service_role;`로 실행하고, 준비·확인용 직접 조작(lease를 과거로 바꾸기, 시도 행 30개 넣기)은 `reset role;` 뒤 postgres로 한다.

다음을 단언한다:
- 권한: 다섯 RPC와 `private.lock_user`는 `anon`·`authenticated`에 EXECUTE가 없고 `service_role`에는 있다(`function_privs_are` 또는 `has_function_privilege`).
- `create_card`: created → 같은 라벨이면 duplicate_label → `'   '`은 invalid_label → 다른 사용자는 같은 라벨로 created.
- `begin_upload`
  - B의 카드로 A가 호출하면 card_not_found.
  - started 2번 뒤 세 번째는 busy. 그중 하나의 lease를 과거로 바꾸면 다시 started.
  - 24시간 안의 시도가 30개면 rate_limited. 25시간 전 시도는 세지 않는다.
  - 성공(done) 업로드와 같은 해시면 duplicate와 그 카드 id. 업로드 행이 늘지 않고, 시도는 `no_new`로 기록된다.
- `ingest_upload`
  - 3행 → done, inserted 3, 기간·`net_amount`가 넣은 값과 일치. 카드 `identity_scope`가 `content`로 고정된다.
  - 같은 fingerprint 3행을 다른 업로드로 → no_new, duplicates 3.
  - 같은 해시의 processing 업로드 둘 → 첫째 done 뒤 둘째는 duplicate.
  - lease 만료 → lease_expired, 업로드 `failed`·`LEASE_EXPIRED`.
  - 카드 범위가 `content`인데 `approval_number`로 호출 → card_scope_mismatch, 업로드 failed.
  - done 업로드에 다시 호출 → not_processing. B의 업로드 → not_found.
  - 14개 밖 카테고리 행 → `23514` 예외, 그 업로드는 processing 그대로, 거래 0행.
  - 5001행 → `22023` 예외.
- `fail_upload`: processing → failed와 코드 저장. `'bad code'` → `23514`. B의 업로드 → not_found.
- `delete_upload`: done → deleted, 그 업로드의 거래 0행, 시도 행은 남음. lease가 살아 있는 processing → processing. B의 업로드 → not_found.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 기존 테스트 전체 통과
test -f supabase/migrations/20261013000100_upload_rpc.sql
test -f supabase/tests/upload_rpc.test.sql
! grep -niE 'security definer|auth\.uid\(\)' supabase/migrations/20261013000100_upload_rpc.sql
test "$(grep -ciE "set search_path *= *''" supabase/migrations/20261013000100_upload_rpc.sql)" -ge 6
test "$(grep -ciE 'grant execute on function' supabase/migrations/20261013000100_upload_rpc.sql)" -ge 6
! grep -niE 'create (table|policy)' supabase/migrations/20261013000100_upload_rpc.sql
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 모든 RPC가 `p_user_id`로 소유권을 검증하고 `lock_user` 아래에서 도는가? (`create_card` 제외)
   - ingest의 거래 insert와 상태·결과 갱신이 한 함수(한 트랜잭션)인가? (ADR-008)
   - 저장하는 실패 정보가 코드뿐인가? (AGENTS.md CRITICAL 로그·원문 규칙)
3. 결과에 따라 `phases/6-upload-store/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 RPC 다섯 개의 시그니처와 `kind` 값 목록을 담는다(다음 step이 TypeScript 래퍼를 만든다).
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `supabase db push`, `supabase db reset`, `supabase link`, `supabase test db`를 실행하지 마라. 이유: dev DB 마이그레이션은 사용자가 수동으로 push한다.
- 이전 마이그레이션(`20261013000000_upload_schema.sql`)을 고치지 마라. 이유: 같은 phase 안에서도 마이그레이션을 쌓아 적용 순서를 고정한다. 스키마를 바꿔야 하면 이 마이그레이션에 `alter`를 쓴다.
- `security definer`를 쓰지 마라. 이유: 호출자는 service_role뿐이고, 정의자 권한은 search_path·권한 상승 위험만 늘린다.
- RPC 안에서 `auth.uid()`를 쓰지 마라. 이유: service_role 호출에는 사용자 JWT가 없다. 서버가 세션에서 꺼낸 `p_user_id`로 검증한다(ADR-002).
- 금액·기간·건수를 클라이언트가 보낸 값으로 저장하지 마라(`p_skipped` 제외). 이유: 실제로 들어간 행에서 계산해야 중복 제외가 반영된다.
- 거래 행을 RPC 밖에서 따로 넣는 경로를 만들지 마라. 이유: 거래 insert와 결과 저장은 한 트랜잭션이어야 한다(ADR-008).
- `src/` 코드를 바꾸지 마라. 이 step은 SQL만 다룬다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
