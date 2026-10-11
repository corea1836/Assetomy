# Step 4: landing

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` (목표, "플랜별 기능"의 가격, "가설 · 지표"의 H1)
- `/docs/USER_FLOW.md` ("여정 맵", "① 진입 · 인증 · 분기")
- `/docs/DESIGN.md` (전체. 특히 "랜딩 (`/`)", "컴포넌트", "문구")
- `/docs/ARCHITECTURE.md` ("모드 · 환경": mock이면 Analytics no-op)
- `/src/app/layout.tsx`, `/src/app/layout.test.tsx`, `/src/app/page.tsx`, `/src/app/page.test.tsx`
- 이전 step에서 만든 파일: `/src/lib/demo/fixture.ts`, `/src/components/wordmark.tsx`, `/src/app/demo/page.tsx`, `/src/lib/format.ts`, `/src/lib/analytics/dashboard.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

placeholder인 `/`를 랜딩 페이지로 바꾸고, H1(데모 클릭률)을 재기 위해 Vercel Analytics를 붙인다. 구현 파일보다 테스트 파일을 먼저 만든다.

`@vercel/analytics`를 설치한다.

### 1. Analytics (`src/app/layout.tsx`)
- `getMode() === 'live'`일 때만 `@vercel/analytics/next`의 `<Analytics />`를 body 끝에 렌더링한다. 이유: mock에서는 Analytics가 no-op이어야 한다(ARCHITECTURE).
- `layout.test.tsx`에 `@vercel/analytics/next`를 mock하고 live에서만 렌더링되는지 단언하는 케이스를 추가한다. 기존 mock 배너 단언은 유지한다.

### 2. `src/components/landing/demo-link.tsx` — 'use client' (+ `demo-link.test.tsx`)
```tsx
export function DemoLink(props: { className?: string; children: React.ReactNode }): React.JSX.Element
```
- `next/link`로 `/demo`에 가고, 클릭하면 `@vercel/analytics`의 `track('demo_click')`을 호출한다.
- 테스트: `@vercel/analytics`를 mock하고 클릭 시 `track`이 `'demo_click'`으로 한 번 호출되는지, `href`가 `/demo`인지 단언한다.

### 3. `src/app/page.tsx` — 랜딩
DESIGN.md "랜딩 (`/`)" 규칙을 따른다. 너비 `mx-auto max-w-[1248px] px-6`, 밴드마다 `py-24`. 순서는 다크 히어로 → 흰 밴드 → 회색 밴드 → 다크 CTA다.
- **히어로**(`bg-surface-dark text-white`):
  - 상단 줄: `Wordmark tone="onDark"` · 오른쪽 텍스트 링크 `로그인`(`/login`)
  - `<h1>` `계좌 연동 없이,<br />카드 이용내역 파일만으로` (`text-display-sm lg:text-display-xl`)
  - 부제(`text-lg text-muted-soft`): `흩어진 카드 지출을 한 화면에서 보고, 정기결제와 확인이 필요한 지출을 찾아드려요.`
  - Primary 버튼 `데모 보기`(`DemoLink`) + 보조 `로그인 없이 바로 볼 수 있어요`
  - 오른쪽 목업 카드(`rounded-3xl border border-hairline-dark bg-surface-dark-elevated p-8`): `buildDashboard({ transactions: DEMO_TRANSACTIONS, plan: 'pro', today: DEMO_TODAY })` 결과로 `{formatMonth(month)} 총지출`, `formatWon(snapshot.total)`, 상위 카테고리 3개(라벨·금액·막대), `확인이 필요한 지출 {종류별 count 합}건 · 후보 합계 {formatWon(candidateTotal)}`, 보조 `예시 데이터`. 숫자는 이 결과에서만 가져온다.
- **기능 밴드**(흰 배경): 섹션 제목 `파일 하나로 시작해요`, 기본 카드 3장(`sm:` 2열 · `lg:` 3열)
  1. `한 화면에 모든 카드` — `카드사마다 받은 이용내역 파일을 올리면 카드별로 나눠 합산해요.`
  2. `확인이 필요한 지출` — `정기결제로 보이는 결제, 중복 결제 의심, 평소보다 큰 결제를 찾아드려요. 정상 지출일 수도 있어요.`
  3. `연동 없이, 언제든 삭제` — `계좌나 카드사에 연동하지 않아요. 원본 파일은 암호화해 보관하고, 원할 때 바로 지울 수 있어요.`
- **요금 밴드**(`bg-surface-soft`): 섹션 제목 `요금`, 카드 두 장
  - Free(기본 카드): `Free` · 가격 `0원`(`text-display-md`) · 목록 `월별 소비 현황` · `전월 대비` · `확인할 지출 건수와 합계` · `월간 요약` · 전체 너비 Secondary `무료로 시작하기`(`/login`)
  - Pro(`bg-surface-dark text-white`로 반전): `Pro` · 가격 `월 6,900원` · 목록 `Free의 모든 기능` · `확인할 지출 상세` · `최대 12개월 추세` · `더 자세한 월간 요약` · 전체 너비 Primary `Pro 시작하기`(`/login`)
  - 아래 보조 문구: `해외에서는 $4.99/월로 결제돼요. 결제 통화는 결제 화면에서 정해져요.`
  - KRW 가격은 파일 상단 상수 `PRO_PRICE_KRW = 6_900` 하나로 두고, 주석에 `임시값: PRD [확정 필요]`라고 적는다. 가격 텍스트는 **템플릿 문자열 하나**로 만든다: ``{`월 ${formatWon(PRO_PRICE_KRW)}`}``. 이유: HTML에 `<!-- -->`가 끼면 AC가 찾지 못한다.
- **CTA 밴드**(다크, 가운데 정렬): `이번 달 카드 지출, 파일 하나로 확인해 보세요`(`text-display-sm sm:text-display-md`) + Primary `무료로 시작하기`(`/login`) + 법적 고지(`text-caption`) `assetomy는 계좌나 카드사에 연동하지 않아요.`
- `/login`은 아직 없다(이후 phase). 링크만 둔다. 개인정보 처리방침·약관 링크는 해당 페이지를 만드는 phase에서 추가한다.
- `src/app/page.test.tsx`는 placeholder용이다. 랜딩에 맞게 바꾸거나(히어로 제목·`데모 보기` 링크 `/demo`·Pro 가격 텍스트 단언) 삭제한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # layout·demo-link·page 테스트 포함 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3211 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3211/ && break; sleep 0.5; done
curl -sf http://localhost:3211/ | grep -q '데모 보기'
curl -sf http://localhost:3211/ | grep -q 'href="/demo"'
curl -sf http://localhost:3211/ | grep -q '월 6,900원'
curl -sf http://localhost:3211/ | grep -q '\$4.99/월'
curl -sf http://localhost:3211/demo | grep -q '확인이 필요한 지출'
pkill -f 'next start -p 3211'
grep -qE "track\(['\"]demo_click['\"]\)" src/components/landing/demo-link.tsx
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3211'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택과 DESIGN.md 규칙(랜딩만 다크 밴드, 금지 항목)을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-landing-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 랜딩 섹션 구성, `demo_click` 이벤트 위치, `PRO_PRICE_KRW` 임시값 위치를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 그라데이션, blur, glow 그림자, 이모지 아이콘, "Powered by AI" 배지, 숫자 카운트업을 쓰지 마라. 이유: DESIGN.md 금지 항목이다.
- 목업 카드의 숫자를 손으로 적지 마라. 이유: 금액은 analytics 코드로만 계산한다.
- `track`에 거래·가맹점·파일명 같은 데이터를 넣지 마라. 이벤트 이름만 보낸다. 이유: Analytics에 거래 데이터를 넣지 않는다(PRD).
- mock 모드에서 `<Analytics />`를 렌더링하지 마라.
- 절감 보장·과장 표현(`아껴요`, `절약`, `낭비`)을 쓰지 마라. 이유: PRD 표현 규칙이다.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
