# 아키텍처

이 문서는 구조와 불변 규칙만 담는다. 함수 시그니처·테이블 컬럼·RPC·테스트 시나리오 같은 상세 설계는 각 step 파일에서 정한다.

## 디렉토리 구조
```
src/
├── app/                  # 페이지 + Route Handler
│   ├── page.tsx, demo/, login/, privacy/, terms/    # 공개
│   ├── dashboard/, settings/                      # 보호(requireUser)
│   ├── auth/             # login(구글 OAuth 시작) · callback(코드 교환) · logout
│   └── api/              # cards · uploads · merchant-categories · me · checkout · portal · metrics
│                         # webhooks/polar · internal/maintenance
├── components/           # UI. DTO만 받는다
├── lib/
│   ├── parsing/          # 순수: 파일 읽기·PDF 줄 묶기·카드사 프로필·폴백 매핑 적용·값 패턴·거래 정규화 (__fixtures__/ 익명화한 실제 파일)
│   ├── pdf/              # PDF 글자·좌표 추출(pdfjs-dist + cmaps, 'server-only')
│   ├── analytics/        # 순수: 스냅샷·전월 대비·추세·탐지·buildDashboard
│   ├── ingest/           # 업로드 처리(I/O, 의존성 주입)
│   ├── billing/          # 플랜 조회·Polar 동기화
│   ├── queries/          # 읽기(사용자 세션 + RLS)
│   ├── store/            # 서버 쓰기(service-role로 RPC 호출, 'server-only')
│   ├── supabase/         # server · admin 클라이언트(브라우저용 클라이언트는 두지 않는다)
│   ├── errors/           # 에러 코드 → 사용자 문구(messages.ts)
│   └── auth.ts · origin.ts · env.ts · mode.ts · crypto.ts(원본 AES-256-GCM) · http.ts(API 에러·Origin 검사) · clock.ts(서울 기준 오늘) · retention.ts(12개월 기준일)
├── services/             # llm · polar 래퍼와 mock ('server-only')
├── types/                # 도메인 타입 · 에러 코드
└── proxy.ts              # 세션 갱신만
supabase/
├── migrations/
└── tests/                # pgTAP
```

## 시스템 구성
```
[Browser]
  ├─ 페이지 · API · 파일(4MB) ──▶ [Next.js @ Vercel icn1]
  └─ 결제 ──────────────────────▶ [Polar Checkout]

[Next.js]
  ├─ Server Components ─▶ lib/queries · lib/analytics ─▶ [Postgres] (사용자 세션 + RLS)
  ├─ app/api/uploads ─▶ lib/crypto ─▶ [Supabase Storage: statements (private, Seoul, 암호화본만)]
  ├─ app/api/* ─▶ lib/ingest ─▶ services/llm ─▶ [Anthropic, 국외]
  ├─ app/api/checkout · portal ─▶ services/polar ─▶ [Polar, 국외]
  ├─ /api/webhooks/polar ◀── [Polar] (서명 검증)
  └─ /api/internal/maintenance ◀── [Vercel Cron] (CRON_SECRET)
```

## 레이어 규칙
```
app/       requireUser → Origin·입력 검증 → lib 호출 → HTTP 매핑
lib/       parsing · analytics(순수) / ingest · billing · queries · store(I/O)
services/  llm · polar ('server-only')
types/     도메인 타입 · 에러 코드
```
- 위에서 아래로만 의존한다. `components/`는 DTO만 받는다.
- 순수 레이어는 I/O·`Date.now()`·env를 쓰지 않고 `today`를 인자로 받는다. 날짜는 `'YYYY-MM-DD'` 문자열, 금액은 원 단위 안전한 정수다(지출 양수, 환불·취소 음수).
- 외부 서비스(LLM·Polar)는 인터페이스 뒤에 두고 mock 구현을 함께 만든다. mock은 테스트 fake로도 쓴다.

## 패턴
- 읽기는 Server Component, 쓰기는 Route Handler다. 예외는 2개(AI 요약 저장, 결제 상태 재동기화: 결제 완료 화면·기간이 지난 Pro·설정 화면)이며 대시보드·설정 렌더 중 서버 쓰기 함수로 한다.
- 클라이언트 컴포넌트는 업로드·모달·월 선택처럼 상호작용이 필요한 곳에만 쓴다. 서버 상태는 Server Component와 URL(`?month=`)에 두고, 업로드 진행 상태만 클라이언트 state로 둔다. 완료 후 `router.refresh()`. 전역 상태 라이브러리는 쓰지 않는다.
- Free/Pro 게이팅은 `buildDashboard`의 DTO 유니온 한 곳에서 한다. AI 월간 요약의 입력도 그 DTO에서 만든다(Free는 Free DTO 범위만 Sonnet으로, Pro는 Opus로).

## 데이터 모델
| 테이블 | 역할 |
|---|---|
| cards | 사용자 카드 라벨(전체 번호 없음), 첫 성공 업로드의 식별 범위·취소 표기 방식 |
| uploads | 업로드 1건. 상태(매핑 대기 포함), 파일 해시, 만료 시각(lease), 매핑 제안, 저장된 결과 |
| transactions | 정규화 거래. `(user_id, fingerprint)` unique, (user, card, upload) 복합 FK |
| column_mappings | (user, 헤더 시그니처)별로 사용자가 확인한 폴백 매핑 |
| merchant_category_overrides | (user, 정규화 가맹점명)별 사용자 카테고리 수정값 |
| subscriptions | Polar 구독 상태와, 그 상태를 만든 조회의 시작 시각 |
| ai_summaries | (user, month)별 요약과 입력 해시 |
| user_metrics · upload_attempts | 지표용 최소 이력. 업로드를 지워도 남고, 전체 삭제 시 지운다. 24시간 업로드 한도도 upload_attempts로 센다 |
| storage `statements` | 원본 파일의 AES-256-GCM 암호화본만. private, 경로 `{uid}/{uploadId}.enc`, 원본 기준 파일당 4MB |

- 사용자는 RLS로 본인 행만 select한다. user_metrics·upload_attempts는 사용자가 접근하지 않는다. Storage에는 사용자 정책이 없다.
- 모든 쓰기는 service_role에만 EXECUTE를 준 RPC로 한다. RPC는 `auth.uid()` 대신 서버가 넘긴 user_id와 행 소유권·상태·lease를 검증한다. 권한은 pgTAP으로 단언한다.
- 사용자 단위 쓰기(업로드 수신·ingest·삭제·요약 저장·탈퇴)는 사용자별 advisory lock(`pg_advisory_xact_lock`)으로 직렬화한다.
- fingerprint = `sha256(cardId|식별 범위|거래 식별자|거래 종류)`. 식별 범위는 식별자 종류(예: 승인번호)라서 프로필 경로와 폴백 경로에서 같은 거래는 같은 값이 된다. 식별자가 없는 현대카드 명세서 PDF는 식별 범위가 `content`이고 거래 식별자는 `이용일|정규화 가맹점명|금액|같은 내용 안 순번`이다. 같은 파일(file_hash)은 사용자의 어느 카드에 올렸든 no_new다.
- 카드는 첫 성공 업로드의 식별 범위·취소 표기 방식으로 고정한다. 경로(프로필·폴백)가 달라도 둘이 같으면 같은 카드에 올릴 수 있다.
- 목록 조회는 `.range()`로 끝까지 페이지네이션한다.

## 업로드 흐름
```
(1) POST /api/uploads          multipart {cardId, file}(원본 4MB)
      사용자 잠금 → 24시간 30개·동시 2개 검사 → file_hash 검사(같은 파일이면 업로드 행·원본 없이 no_new)
      → processing 업로드 커밋(6분 lease) → AES-256-GCM 암호화 후 Storage 저장(평문은 메모리에서만) → 형식 판정
         ├ 카드사 프로필 있음 / 저장된 폴백 매핑 있음 ─▶ (3)
         ├ PDF인데 프로필 없음 ─▶ UNSUPPORTED_FILE(PDF는 폴백 없음)
         └ 없음 → Haiku 매핑 제안(헤더 + 값 패턴) → 제안을 업로드 행에 저장
                 → needs_mapping(1시간 만료, lease 해제) + 미리보기 응답
(2) POST /api/uploads/:id/mapping   본문 없음("이대로 읽기")
      저장된 제안을 column_mappings에 저장 → claim(needs_mapping → processing) → 복호화 → (3)
(3)   코드로 파싱·정규화 → 수정값·기존 거래에 없는 가맹점만 Haiku 분류(실패는 etc)
      → ingest RPC: 거래 insert와 결과 저장을 한 트랜잭션으로 → done / no_new / failed
      → RPC 오류면 상태를 한 번 다시 읽어 done이면 결과, 아니면 503(행은 보존)
```
```
(업로드 요청) ──▶ [processing] ──신규 거래 커밋──▶ [done] ──사용자 삭제·12개월 경과──▶ (삭제)
                     │    ▲
                     │    └──"이대로 읽기"·claim──┐
                     ├─ 처음 보는 형식 ──▶ [needs_mapping] ──취소──▶ (삭제)
                     │                                    └─1시간 경과──▶ [failed]
                     ├─ 모두 중복(같은 파일 동시 처리 포함) ──▶ [no_new]
                     └─ 확정 실패·lease 만료 ─▶ [failed]
```
- 응답을 받지 못하면 같은 파일을 다시 올린다. 첫 요청이 커밋됐다면 file_hash·fingerprint 때문에 no_new가 되고, 아니면 새로 처리된다. 결과가 불명확한 행은 지우지 않는다.
- 이미 done인 업로드와 file_hash가 같으면 업로드 행을 만들지 않고 시도만 기록해 no_new로 응답한다(원본을 저장하지 않음). 같은 파일이 동시에 처리되면 ingest가 다시 확인해 늦은 쪽을 no_new로 끝낸다.
- lease가 만료된 processing은 재claim하지 않는다. ingest는 커밋 시 lease를 확인해 늦은 커밋을 거절하고 그 업로드를 failed로 끝낸다. 나머지 만료 행은 정기 작업이 failed로 끝낸다. 동시 처리 한도는 lease가 남은 processing만 세므로 정기 작업 전에도 한도가 막히지 않는다. needs_mapping은 lease를 잡지 않아 동시 처리 한도에 세지 않는다.
- 미리보기는 사용자 본인에게만 반환하고 LLM에 보내지 않는다. 클라이언트는 매핑을 보내지 않고, 서버가 저장한 제안만 확정한다.
- 반영 기간은 저장된 거래의 최소·최대 이용일이다. 취소·환불은 파일의 날짜로 반영되므로 형식마다 월 귀속이 다를 수 있다(화면에 안내).

## 삭제와 정리
- 업로드 삭제와 전체 삭제는 DB 한 트랜잭션으로 즉시 끝내고, 커밋 후 원본 삭제를 시도한다. 삭제 뒤 늦게 도착한 ingest는 업로드 행이 없어서, 요약 저장은 그 달 거래가 없어서 거절된다. 전체 삭제는 계정·구독을 유지한다(24시간 업로드 한도는 upload_attempts와 함께 초기화된다).
- 탈퇴는 전체 삭제와 같은 트랜잭션에서 운영 기록까지 지우고, 커밋 후 Auth 사용자를 삭제한다. 자동 갱신 예정인 구독이 있으면 409로 거절한다. 탈퇴 뒤 도착한 웹훅은 사용자가 없어 200으로 무시한다.
- 5분 주기 정기 작업은 만료된 processing(lease)·needs_mapping(1시간)을 failed로 종료하고, 업로드 행이 없거나 no_new·failed인 원본을 지운다. 업로드 행은 파일 저장 전에 커밋되므로 행이 없는 파일은 언제 지워도 안전하다. DB 조회가 실패하면 지우지 않는다.
- 보관 기한: 같은 정기 작업이 이용일 기준 12개월이 지난 거래·요약을 지우고, 거래가 모두 사라진 업로드의 행과 원본을 지운다. ingest는 보관 기한 밖의 거래를 저장하지 않는다(skipped).

## 결제 동기화
```
checkout: 이미 Pro면 포털, 아니면 Polar checkout(external_customer_id = 세션 uid, customer_ip_address = 요청자 IP)
success 페이지 · 웹훅(서명 검증) · 결제 기간이 지난 상태 ─▶ syncFromPolar(uid)
  조회 시작 시각 기록 → Polar 현재 상태 조회 → 저장된 조회보다 늦게 시작했을 때만 저장
```
- Polar에 고객이 없으면(404) Free로 확정하고, 그 밖의 조회 실패는 기존 상태를 유지한다(Free로 덮지 않음). Pro 상품의 active 구독만 권한으로 본다.
- 결제 기간이 지난 상태: 저장된 Pro의 결제 기간 끝이 지났으면 대시보드·설정을 렌더할 때 다시 동기화한다. 설정은 기간과 관계없이 렌더할 때마다 동기화한다(결제 반영이 늦은 사용자와 포털에서 돌아온 사용자가 플랜을 확인하는 곳).
- 웹훅은 서명이 틀리면 403, `customer.state_changed`가 아니거나 `external_id`가 없으면 200으로 무시한다. 동기화 중 Polar 조회가 실패하면 503을 돌려 Polar가 다시 보내게 한다.
- mock: checkout은 Polar 없이 바로 Pro로, 포털은 바로 Free로 저장한다. 동기화는 Polar를 조회하지 않고 저장된 상태를 쓰며, 웹훅은 404다.
- 첫 실결제는 production에서 active Pro를 처음 확인한 시각이다(쿠폰·무료 구독 미운영 전제).
- Pro 상품은 USD $4.99를 기본 가격으로, KRW 가격을 추가로 둔다. Polar는 고객 위치로 통화를 고르므로 서버에서 만든 checkout에는 요청자 IP를 넘긴다.

## API
| 경로 | 역할 |
|---|---|
| `POST /api/cards` | 카드 라벨 등록 |
| `POST /api/uploads` | 파일 수신 → 암호화 저장 → 처리, 또는 매핑 제안(needs_mapping) |
| `POST /api/uploads/[id]/mapping` | 저장된 매핑 제안 확정 → 처리 |
| `DELETE /api/uploads/[id]` | 업로드 삭제(매핑 대기 취소 포함) |
| `PUT /api/merchant-categories` | 가맹점 카테고리 수정 → 그 가맹점 거래 갱신 |
| `DELETE /api/me/data` | 소비 데이터 전체 삭제 |
| `DELETE /api/me` | 탈퇴(데이터·계정 삭제) |
| `POST /api/checkout` · `/api/portal` | Polar URL 반환 |
| `POST /api/metrics` | 티저 노출·업그레이드 클릭 기록 |
| `POST /api/webhooks/polar` | 서명 검증 → 동기화 |
| `GET /api/internal/maintenance` | 정기 정리(CRON_SECRET) |
| `POST /auth/login` | 폼 `{next}` · Origin 검사 → 서버에서 구글 OAuth(PKCE) 시작 → 303 |
| `GET /auth/callback` | OAuth 코드 교환 → next(내부 경로만) |
| `POST /auth/logout` | Origin 검사 → 로그아웃 → 303 `/` |

- 상태 코드: 200 완료·매핑 대기 · 400 · 401 · 403 Origin/서명 · 404 없음/타인 소유 · 409 충돌 · 422 파일 문제 · 429 한도 · 503 일시 장애. 에러 본문은 `{ error: { code, reason? } }`이며 원문 메시지를 노출하지 않는다.

## 모드 · 환경
- `getMode()`: production → live, preview → mock, 로컬 → `APP_MODE`(기본 mock). Production은 mock이 될 수 없다.
- mock: Claude는 키워드 분류·헤더 키워드 매핑·고정 요약, Polar는 즉시 활성·해지, Analytics는 no-op. Supabase는 실제를 쓴다(로컬·Preview=dev, Production=prod). mock이면 상단 배너를 띄운다.
- Supabase는 클라우드 프로젝트에 URL·키로 연결한다(로컬 Docker를 쓰지 않는다, ADR-020). 인증 설정(Google provider · Site URL · Redirect URLs · 이메일 가입 끔)은 프로젝트 대시보드에서 관리하고, `supabase/`는 마이그레이션·pgTAP용으로 둔다.
- 사이트 Origin은 `lib/origin.ts` 한 곳에서 정한다(Preview `https://${VERCEL_URL}`, Production `NEXT_PUBLIC_SITE_URL`, 로컬 localhost). Origin 검사와 OAuth 복귀 URL에 같이 쓴다.
- Preview 배포는 `execute.py --deploy`가, Production 배포는 deploy step이 한다. step 세션은 배포하지 않는다. dev DB 마이그레이션은 사용자가 수동으로 push한다. Cron은 production에서만 돈다.
- env는 `lib/env.ts`에서 lazy 검증한다. 변수 목록은 `.env.example`. 원본 암호화 키 `FILE_ENCRYPTION_KEY`(32바이트, 서버 전용, 환경별로 따로)를 쓴다.

## 보안
- 인증: 보호 페이지·핸들러마다 `requireUser()`(`getClaims`). proxy는 세션 갱신만 한다. next는 내부 경로만 허용한다. 구글 로그인은 서버에서 시작하고(PKCE, ADR-021) 브라우저에 Supabase 클라이언트를 두지 않는다.
- CSRF: 세션을 쓰는 POST/PUT/DELETE는 Origin 정확 일치, JSON 요청은 `application/json`만, 파일 업로드는 `multipart/form-data`만. 로그인·로그아웃 폼(`/auth/login`·`/auth/logout`)은 `application/x-www-form-urlencoded`만 받고 Origin을 검사한다. 웹훅은 서명, Cron은 `CRON_SECRET`.
- 격리: RLS 읽기 + 검증된 서버 쓰기 + 복합 FK. 타인 리소스는 404.
- 파일: private 버킷에 암호화본만(AES-256-GCM, 파일마다 랜덤 IV). 평문 원본은 메모리에서만 다룬다. 확장자·용량(4MB)·행 수(5,000)·셀 길이 상한, xlsx ZIP 시그니처, 패치된 SheetJS. PDF는 `%PDF-` 시그니처·100쪽 상한·암호 PDF 거절, pdfjs-dist는 `isEvalSupported: false`로 글자·좌표만 읽는다.
- LLM: 분류에는 가맹점명, 요약에는 월 집계, 폴백 매핑에는 헤더와 값 패턴(숫자 → 9, 문자 → X)만 보낸다. 실제 셀 값과 원본은 보내지 않는다. structured outputs를 쓰고 결과는 코드로 검증한다.
- 헤더 `X-Frame-Options: DENY` · `nosniff` · `strict-origin-when-cross-origin`. XSS는 `react/no-danger`와 텍스트 렌더링으로 막는다.
- 로그는 코드와 id만. 비용은 24시간 30개·동시 2개를 DB에서 원자적으로 제한하고 Anthropic·Vercel 지출 한도를 건다.

## 테스트
- 단위 `*.test.ts`(`npm test`, Supabase 불필요), DB·Storage 통합 `*.db.test.ts`(`npm run test:db`), pgTAP `supabase/tests/`. Stop hook은 단위 테스트만 돌린다.
- 파싱은 익명화한 실제 fixture로 카드별·월별·전체 기대 합계와 정확히 일치해야 한다. 표 형식(csv·xlsx) fixture는 프로필 없이 폴백 매핑으로 읽어도 같은 합계와 fingerprint가 나와야 한다. PDF fixture는 원본 대신 익명화한 글자 조각·좌표 JSON이고, 원본 PDF 테스트는 로컬에 파일이 있을 때만 돈다.
- 외부 서비스는 mock으로 단위 테스트하고, 권한·잠금·경합은 DB 통합 테스트로 확인한다.
- dev DB를 함께 쓰므로 DB 통합 테스트는 테스트마다 admin API로 임시 사용자를 만들어 그 사용자 행만 다루고 끝나면 지운다. pgTAP은 트랜잭션 안에서 돌고 롤백하며, `scripts/pgtap.sh`로 실행한다(Docker 불필요, ADR-020).
- **[확정 필요]** 초기 프로필의 나머지 카드사 1종과 .xls 지원 여부는 실제 파일을 확인한 뒤 정한다(첫 프로필은 현대카드 명세서 PDF).
