# 아키텍처

이 문서는 구조와 불변 규칙만 담는다. 함수 시그니처·테이블 컬럼·RPC·테스트 시나리오 같은 상세 설계는 각 step 파일에서 정한다.

## 디렉토리 구조
```
src/
├── app/                  # 페이지 + Route Handler
│   ├── page.tsx, demo/, login/, privacy/, terms/    # 공개
│   ├── dashboard/, settings/                      # 보호(requireUser)
│   ├── auth/callback/                             # OAuth 코드 교환
│   └── api/              # cards · uploads · me/data · checkout · portal · metrics
│                         # webhooks/polar · internal/maintenance
├── components/           # UI. DTO만 받는다
├── lib/
│   ├── parsing/          # 순수: 파일 읽기·카드사 프로필·거래 정규화 (__fixtures__/ 실제 파일)
│   ├── analytics/        # 순수: 스냅샷·전월 대비·추세·탐지·buildDashboard
│   ├── ingest/           # 업로드 처리(I/O, 의존성 주입)
│   ├── billing/          # 플랜 조회·Polar 동기화
│   ├── queries/          # 읽기(사용자 세션 + RLS)
│   ├── store/            # 서버 쓰기(service-role로 RPC 호출, 'server-only')
│   ├── supabase/         # server · browser · admin 클라이언트
│   ├── errors/           # 에러 코드 → 사용자 문구(messages.ts)
│   └── auth.ts · origin.ts · env.ts · mode.ts
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
  ├─ 페이지 · API ──────────▶ [Next.js @ Vercel icn1]
  ├─ 파일 PUT(signed URL) ──▶ [Supabase Storage: statements (private, Seoul)]
  └─ 결제 ──────────────────▶ [Polar Checkout]

[Next.js]
  ├─ Server Components ─▶ lib/queries · lib/analytics ─▶ [Postgres] (사용자 세션 + RLS)
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
- 읽기는 Server Component, 쓰기는 Route Handler다. 예외는 2개(AI 요약 저장, 오래된 결제 상태 보완 동기화)이며 대시보드 렌더 중 서버 쓰기 함수로 한다.
- 클라이언트 컴포넌트는 업로드·모달·월 선택처럼 상호작용이 필요한 곳에만 쓴다. 서버 상태는 Server Component와 URL(`?month=`)에 두고, 업로드 진행 상태만 클라이언트 state로 둔다. 완료 후 `router.refresh()`. 전역 상태 라이브러리는 쓰지 않는다.
- Free/Pro 게이팅은 `buildDashboard`의 DTO 유니온 한 곳에서 한다.

## 데이터 모델
| 테이블 | 역할 |
|---|---|
| cards | 사용자 카드 라벨(전체 번호 없음), 카드사 프로필 |
| uploads | 업로드 1건. 상태, 파일 해시, 처리 lease, 저장된 결과 |
| transactions | 정규화 거래. `(user_id, fingerprint)` unique, (user, card, upload) 복합 FK |
| subscriptions | Polar 구독 상태와, 그 상태를 만든 조회의 시작 시각 |
| ai_summaries | (user, month)별 요약과 입력 해시 |
| user_operations | 사용자당 한 행. 데이터 세대, 24시간 업로드 시도 기록. 한도·작업 배타성용 잠금 대상 |
| user_metrics · upload_attempts | 지표용 최소 이력. 업로드를 지워도 남고, 전체 삭제 시 지운다 |
| storage `statements` | 원본 파일. private, 경로 `{uid}/{uploadId}.{ext}`, 파일당 10MB |

- 사용자는 RLS로 본인 행만 select한다. user_metrics·upload_attempts는 사용자가 접근하지 않는다. Storage에는 사용자 정책이 없다.
- 모든 쓰기는 service_role에만 EXECUTE를 준 RPC로 한다. RPC는 `auth.uid()` 대신 서버가 넘긴 user_id와 행 소유권·상태·lease·세대를 검증한다. 권한은 pgTAP으로 단언한다.
- fingerprint = `sha256(cardId|프로필 식별 범위|거래 식별자|거래 종류)`. 같은 파일(file_hash)은 사용자의 어느 카드에 올렸든 no_new다.
- 목록 조회는 `.range()`로 끝까지 페이지네이션한다.

## 업로드 흐름
```
(1) POST /api/uploads         한도 검사 → pending 업로드 커밋 → signed upload URL 발급
(2) Browser → Storage         signed URL로 직접 업로드 (Vercel 4.5MB 본문 제한 회피)
(3) POST /api/uploads/:id/process
      claim(pending → processing, 6분 lease, 사용자당 동시 2개)
      → 다운로드 → file_hash 검사 → 카드사 프로필로 파싱·정규화(코드만)
      → 기존 거래에 없는 가맹점만 Claude 분류(실패는 etc)
      → ingest RPC: 거래 insert와 결과 저장을 한 트랜잭션으로
      → done / no_new / failed. 응답이 불명확하면 상태를 다시 조회하고, 모르면 202
(4) GET /api/uploads/:id      처리 상태·저장된 결과
```
```
[pending] ──claim──▶ [processing] ──신규 거래 커밋──▶ [done] ──사용자 삭제──▶ (즉시 삭제)
    │                     ├─ 같은 파일·모두 중복 ──▶ [no_new]
    │                     └─ 확정 실패·lease 만료 ─▶ [failed]
    └─ 전송 실패·URL 만료 ─────────────────────▶ [failed]
```
- 같은 uploadId 재요청은 저장된 결과를 돌려준다(멱등). 결과가 불명확하면 지우지 않고 보존한다.
- lease가 만료된 processing은 정기 작업이 failed로 끝내며 재claim하지 않는다. ingest는 커밋 시 lease를 확인해 늦은 커밋을 거절한다.
- 반영 기간은 저장된 거래의 최소·최대 이용일이다. 취소·환불은 파일의 날짜로 반영되므로 형식마다 월 귀속이 다를 수 있다(화면에 안내).

## 삭제와 정리
- 업로드 삭제와 전체 삭제는 DB 한 트랜잭션으로 즉시 끝내고, 커밋 후 원본 삭제를 시도한다. 전체 삭제는 데이터 세대를 올려 진행 중인 쓰기를 무효화한다. 계정·구독·한도 기록은 유지한다.
- 5분 주기 정기 작업은 만료된 pending·processing을 failed로 종료하고, 업로드 행이 없거나 no_new·failed인 원본을 지운다. 업로드 행은 URL 발급 전에 커밋되므로 행이 없는 파일은 언제 지워도 안전하다. DB 조회가 실패하면 지우지 않는다.

## 결제 동기화
```
checkout: 이미 Pro면 포털, 아니면 Polar checkout(external_customer_id = 세션 uid)
success 페이지 · 웹훅(서명 검증) · 1시간 이상 오래된 상태 ─▶ syncFromPolar(uid)
  조회 시작 시각 기록 → Polar 현재 상태 조회 → 저장된 조회보다 늦게 시작했을 때만 저장
```
- 조회가 실패하면 기존 상태를 유지한다(Free로 덮지 않음). Pro 상품의 active 구독만 권한으로 본다.
- 첫 실결제는 production에서 active Pro를 처음 확인한 시각이다(쿠폰·무료 구독 미운영 전제).

## API
| 경로 | 역할 |
|---|---|
| `POST /api/cards` | 카드 라벨 등록 |
| `POST /api/uploads` | 업로드 생성 + signed URL 발급 |
| `POST /api/uploads/[id]/process` | 처리 또는 저장된 결과 반환 |
| `GET` · `DELETE /api/uploads/[id]` | 상태 조회 · 업로드 삭제 |
| `DELETE /api/me/data` | 소비 데이터 전체 삭제 |
| `POST /api/checkout` · `/api/portal` | Polar URL 반환 |
| `POST /api/metrics` | 티저 노출·업그레이드 클릭·전송 실패 기록 |
| `POST /api/webhooks/polar` | 서명 검증 → 동기화 |
| `GET /api/internal/maintenance` | 정기 정리(CRON_SECRET) |
| `GET /auth/callback` | OAuth 코드 교환 → next(내부 경로만) |

- 상태 코드: 200 완료 · 202 처리 중 · 400 · 401 · 403 Origin/서명 · 404 없음/타인 소유 · 409 충돌 · 422 파일 문제 · 429 한도 · 503 일시 장애. 에러 본문은 `{ error: { code, reason? } }`이며 원문 메시지를 노출하지 않는다.

## 모드 · 환경
- `getMode()`: production → live, preview → mock, 로컬 → `APP_MODE`(기본 mock). Production은 mock이 될 수 없다.
- mock: Claude는 키워드 분류·고정 요약, Polar는 즉시 활성·해지, Analytics는 no-op. Supabase는 실제를 쓴다(Preview=dev, Production=prod, 로컬=Docker). mock이면 상단 배너를 띄운다.
- 사이트 Origin은 `lib/origin.ts` 한 곳에서 정한다(Preview `https://${VERCEL_URL}`, Production `NEXT_PUBLIC_SITE_URL`, 로컬 localhost). Origin 검사와 OAuth 복귀 URL에 같이 쓴다.
- Preview 배포는 `execute.py --deploy`가, Production 배포는 deploy step이 한다. step 세션은 배포하지 않는다. dev DB 마이그레이션은 사용자가 수동으로 push한다. Cron은 production에서만 돈다.
- env는 `lib/env.ts`에서 lazy 검증한다. 변수 목록은 `.env.example`.

## 보안
- 인증: 보호 페이지·핸들러마다 `requireUser()`(`getClaims`). proxy는 세션 갱신만 한다. next는 내부 경로만 허용한다.
- CSRF: 세션을 쓰는 POST/DELETE는 Origin 정확 일치, JSON POST는 `application/json`만. 웹훅은 서명, Cron은 `CRON_SECRET`.
- 격리: RLS 읽기 + 검증된 서버 쓰기 + 복합 FK. 타인 리소스는 404.
- 파일: private 버킷, 확장자·용량·행 수(5,000)·셀 길이 상한, xlsx ZIP 시그니처, 패치된 SheetJS.
- LLM: 가맹점명과 집계만 보낸다. structured outputs를 쓰고 결과는 코드로 검증한다.
- 헤더 `X-Frame-Options: DENY` · `nosniff` · `strict-origin-when-cross-origin`. XSS는 `react/no-danger`와 텍스트 렌더링으로 막는다.
- 로그는 코드와 id만. 비용은 24시간 30개·동시 2개를 DB에서 원자적으로 제한하고 Anthropic·Vercel 지출 한도를 건다.

## 테스트
- 단위 `*.test.ts`(`npm test`, Docker 불필요), DB·Storage 통합 `*.db.test.ts`(`npm run test:db`), pgTAP `supabase/tests/`. Stop hook은 단위 테스트만 돌린다.
- 파싱은 익명화한 실제 fixture로 카드별·월별·전체 기대 합계와 정확히 일치해야 한다.
- 외부 서비스는 mock으로 단위 테스트하고, 권한·잠금·경합은 DB 통합 테스트로 확인한다.
- **[확정 필요]** 지원 카드사 2종과 파일 확장자는 실제 파일을 확인한 뒤 정한다.
