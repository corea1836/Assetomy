# Step 5: steps-pricing

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("랜딩 (`/`)" 전체, 특히 "시작 단계", "요금", "CTA 밴드". "색 쓰임", "버튼")
- `/docs/UX_GUIDE.md` ("유치: 랜딩", "전환: 티저 → 업그레이드 모달 → 결제", "2. 점진적 공개")
- `/docs/PRD.md` ("플랜별 기능", 표현 규칙)
- `/src/types/dashboard.ts`, `/src/lib/format.ts`
- `/src/app/page.tsx`, `/src/app/page.test.tsx`
- 이전 step에서 만든 파일: `/src/components/landing/hero-visual.tsx`, `/src/components/landing/feature-showcase.tsx`, `/src/components/landing/summary-band.tsx`, `/src/components/dashboard/finding-labels.ts`, `/src/components/button-styles.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

시작 단계에 단계 연결선과 미니 그림을 넣고, 요금 카드에 "이 플랜에서 보이는 것"을 넣는다. 구현 파일보다 테스트를 먼저 만든다(TDD).

### 1. `src/components/landing/start-steps.tsx` — 서버 컴포넌트 (+ `start-steps.test.tsx`)
```tsx
export function StartSteps(props: { cardLabel: string }): React.JSX.Element
```
- 지금 `page.tsx`의 "이렇게 시작해요" `<ol aria-label="시작하는 순서">`와 `steps` 문구를 옮긴다. 번호(`01`~`03`, `font-mono text-sm text-primary`)·제목(`h3`)·본문은 글자 하나 다르지 않게 둔다.
- 번호 사이를 1px `hairline` 선으로 잇는다(`sm:` 이상 가로, 그 아래 세로). 선은 `aria-hidden`.
- 칸마다 제목 위에 미니 그림(`rounded-2xl border border-hairline bg-canvas`, `aria-hidden`):
  - 01: `XLSX` · `CSV` 형식 배지
  - 02: 카드 라벨 칩 하나(`cardLabel`)
  - 03: 막대 3개짜리 미니 대시보드(`bg-primary`, 길이는 장식용 고정 비율. 금액·숫자 글자를 넣지 않는다)
- `ol`에 `reveal`.
- 테스트: 칸 3개, 번호·제목·본문, 미니 그림이 `aria-hidden`이고 안에 숫자 금액이 없다, 링크·버튼이 없다.

### 2. `src/components/landing/plan-preview.tsx` — 서버 컴포넌트 (+ `plan-preview.test.tsx`)
```tsx
export function PlanPreview(props: { plan: Plan; findings: Findings }): React.JSX.Element
```
- 머리말 `이 플랜에서 보이는 것`(`text-caption`, Free는 `text-body`, Pro는 `text-muted-soft`).
- 두 플랜 공통 첫 줄: `` `확인이 필요한 지출 ${종류별 count 합}건 · 후보 합계 ${formatWon(candidateTotal)}` ``. Free는 `rounded-2xl border border-amber-200 bg-amber-50 text-amber-900`, Pro는 `rounded-2xl border border-hairline-dark bg-surface-dark-elevated text-amber-200` 안에 둔다.
- Pro만 그 아래 상세 2줄: `findings.items`를 금액 큰 순으로 2개, 줄마다 `` `${FINDING_KIND_LABELS[kind]} · ${merchant}` ``와 `formatWon(amount)`(`font-mono`).
- Free에는 상세를 넣지 않는다(흐리게·가려서도 넣지 않는다).
- 테스트: Free는 건수·합계 한 줄만 있고 가맹점명이 없다, Pro는 같은 줄 + 금액 큰 순 2줄.

### 3. `src/app/page.tsx` (+ `page.test.tsx`)
- 시작 단계 밴드의 `<ol>`을 `<StartSteps cardLabel={cardLabels[0]} />`로 바꾼다. 밴드 제목 `이렇게 시작해요`(`h2`)는 그대로.
- Free·Pro 카드의 기능 목록과 버튼 사이에 `<PlanPreview plan="free" … />` / `<PlanPreview plan="pro" … />`를 넣는다. 가격·기능 목록·버튼·해외 가격 안내는 바꾸지 않는다.
- 히어로 후보 줄과 같은 문장이 요금에도 나오므로, 기존 테스트에서 `getByText`가 여러 개를 찾으면 `within(히어로)`로 좁힌다. 단언 내용은 줄이지 않는다.
- 테스트 추가: 요금 카드마다 미리보기가 있다, Pro 미리보기 상세 2줄이 `buildDashboard` 결과를 따른다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run test      # 전체 통과
npm run build     # 컴파일 에러 없음
(npx next start -p 3211 >/dev/null 2>&1 &) ; for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:3211/ && break; sleep 0.5; done
curl -sf http://localhost:3211/ | grep -q '이 플랜에서 보이는 것'
curl -sf http://localhost:3211/ | grep -q '고액 결제 · 예시 별숲 가구실'
curl -sf http://localhost:3211/ | grep -q 'aria-label="시작하는 순서"'
curl -sf http://localhost:3211/ | grep -q '월 6,900원'
curl -sf http://localhost:3211/demo | grep -q '확인이 필요한 지출'
pkill -f 'next start -p 3211'
! grep -q "use client" src/components/landing/start-steps.tsx src/components/landing/plan-preview.tsx
! grep -rnE "gradient|backdrop-blur|blur-|bg-linear|bg-radial|bg-conic" src --include='*.tsx'
! grep -rn "dangerouslySetInnerHTML" src --include='*.tsx'
! grep -rnE "절약|낭비|부정 결제|AI가 분석|Powered by AI|위험 지출" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx'
```
AC가 실패해도 마지막에 `pkill -f 'next start -p 3211'`로 서버를 반드시 끈다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - 금액을 `buildDashboard` 결과에서만 가져오는가? `components/`가 DTO만 받는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙과 DESIGN.md 금지 항목을 위반하지 않았는가?
   - 랜딩 Tab 순서가 `로그인` → `데모 보기` → `무료로 시작하기` → `Pro 시작하기` → `무료로 시작하기` 그대로인가? (그림에 링크·버튼·`tabIndex`가 없는가)
3. 결과에 따라 `phases/3-landing-visual/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `StartSteps`·`PlanPreview` 시그니처와 최종 랜딩 밴드 순서를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- Free 미리보기에 탐지 상세(가맹점·개별 금액)를 넣거나 흐리게 보여주지 마라. 이유: Free에서는 건수·합계만 보인다(PRD, DESIGN 금지 항목의 잠금 blur).
- 업그레이드 유도에 amber를 쓰지 마라. 이유: amber는 확인이 필요한 지출에만 쓴다(UX_GUIDE "4. 대비").
- 가격(`PRO_PRICE_KRW`)·기능 목록·버튼 문구와 링크를 바꾸지 마라.
- 미니 그림에 금액 숫자를 넣지 마라. 이유: 랜딩 숫자는 `buildDashboard` 결과에서만 온다.
- Recharts나 `'use client'`를 쓰지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
