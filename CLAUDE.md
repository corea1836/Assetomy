# 프로젝트: assetomy

신용카드 이용내역 파일을 올리면 소비 현황과 확인이 필요한 지출 후보를 보여주는 핀테크 SaaS MVP.
기획은 `docs/PRD.md`, 화면 흐름은 `docs/USER_FLOW.md`, 설계는 `docs/ARCHITECTURE.md`·`docs/ADR.md`, 화면 규칙은 `docs/UI_GUIDE.md`를 따른다.

## 기술 스택
- Next.js 16 (App Router, `src/`, `proxy.ts`) + React 19, Node.js 24 LTS
- TypeScript strict mode
- Tailwind CSS v4 (라이트 모드 고정), Recharts
- Supabase (Auth·Postgres·Storage, Seoul 리전): `@supabase/ssr`, `@supabase/supabase-js`, Supabase CLI
- Anthropic `@anthropic-ai/sdk`: `claude-opus-5-5`, 가맹점 분류와 월 요약에만 사용
- Polar: `@polar-sh/nextjs`, `@polar-sh/sdk`
- 파싱: `papaparse`, SheetJS(CDN tarball)
- 검증·테스트: zod, Vitest, Testing Library, pgTAP
- 배포: Vercel (함수 리전 `icn1`), `@vercel/analytics`

## 아키텍처 규칙
- CRITICAL: 금액·날짜·합계는 코드로만 계산한다. LLM 출력으로 숫자를 만들거나 고치지 않는다. LLM에는 가맹점명과 월 집계만 보낸다(파일 원본·행 샘플 전송 금지).
- CRITICAL: 사용자 ID는 세션(`requireUser()` → `getClaims()`)에서만 가져온다. 요청 본문의 user_id·storage_path를 DB 쓰기에 쓰지 않는다. `proxy.ts`는 세션 갱신만 하고, 권한은 보호 페이지·핸들러마다 다시 확인한다.
- CRITICAL: 사용자는 RLS로 본인 데이터를 select만 한다. 모든 쓰기는 소유권·상태·lease·세대를 검증하는 서버 저장소 함수(service-role, `import 'server-only'`)로 한다. Storage 버킷에는 사용자 정책을 두지 않는다.
- CRITICAL: Free/Pro 게이팅은 `buildDashboard`의 DTO 유니온 한 곳에서만 한다. Free DTO에 탐지 상세·거래 ID·추세·요약을 넣지 않는다. 이유: Server→Client props는 RSC payload로 그대로 노출된다.
- CRITICAL: 세션을 쓰는 POST/DELETE는 허용 Origin과 정확히 일치하는지 검사하고, JSON POST는 `application/json`만 받는다. 웹훅은 서명으로, 정기 작업은 `CRON_SECRET`으로 인증한다.
- CRITICAL: 로그에는 코드와 id만 남긴다. 거래·가맹점·파일명·카드번호, Supabase `error.message`·`details`, LLM 응답 본문을 기록하지 않는다.
- Supabase 목록 조회는 `.range()`로 끝까지 페이지네이션한다. 이유: 1000행에서 에러 없이 잘려 집계가 조용히 틀린다.
- 순수 레이어(`lib/parsing`, `lib/analytics`)는 I/O·`Date.now()`·env를 쓰지 않고 기준일을 `today` 인자로 받는다. 날짜는 `'YYYY-MM-DD'` 문자열로 다루고 Date 객체로 파싱하지 않는다.
- `components/`는 DTO만 받는다. 사용자에게 보이는 에러 문구는 `lib/errors/messages.ts` 한 곳에서 매핑한다.
- 가맹점명·파일명·AI 요약은 텍스트로만 렌더링한다(`dangerouslySetInnerHTML` 금지).
- env는 `lib/env.ts`에서 zod로 lazy 검증한다(빌드 시 throw 금지). mock/live 판단은 `lib/mode.ts`의 `getMode()`만 쓴다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)
- step 세션에서 `vercel deploy`를 실행하지 않는다. 이유: Preview 배포는 `execute.py --deploy`가 하고, Production 배포는 deploy step에서만 한다.

## 명령어
```
npm run dev       # 개발 서버
npm run build     # 프로덕션 빌드
npm run lint      # eslint .
npm run test      # vitest run, 단위 테스트(Docker 불필요)
npm run test:db   # vitest DB·Storage 통합 테스트(로컬 Supabase 실행 필요)
supabase start                          # 로컬 Supabase(Docker)
supabase db reset && supabase test db   # 마이그레이션 적용 + pgTAP
```
