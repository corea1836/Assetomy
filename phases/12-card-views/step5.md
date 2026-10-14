# Step 5: card-page

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/USER_FLOW.md` ("화면 목록"의 `/dashboard`, "④ 월간 재방문"의 [카드 탭])
- `/docs/ARCHITECTURE.md` ("패턴", "월 요약", "카드 탭")
- `/docs/DESIGN.md` ("레이아웃"의 카드 탭 순서, "화면별 요소"의 카드 탭 항목)
- `/docs/ADR.md` (ADR-001, ADR-011, **ADR-024**)
- 페이지: `/src/app/dashboard/page.tsx`, `/src/app/dashboard/page.test.tsx`, `/src/app/dashboard/monthly-summary-section.tsx`(+ `.test.tsx`)
- step 1 산출물: `/src/lib/queries/statements.ts`(`listStatements`), `/src/lib/queries/transactions.ts`(`statementDate`)
- step 2 산출물: `/src/lib/analytics/dashboard.ts`(`buildCardDashboard`), `/src/types/dashboard.ts`(`CardDashboard`)
- step 3 산출물: `/src/lib/summary/card-summary.ts`(`prepareCardSummary`·`resolveCardSummary`), `/src/lib/summary/deps.ts`(`defaultCardSummaryDeps`)
- step 4 산출물: `/src/components/dashboard/card-tabs.tsx`, `card-heading.tsx`, `card-edit-dialog.tsx`, `period-select.tsx`, `statement-total-card.tsx`, `category-changes-card.tsx`, `empty-card.tsx`, `monthly-summary.tsx`(`variant`)
- `/docs/testing/BROWSER_TESTING.md` ("수동 확인" 절들의 형식)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

대시보드에 카드 탭을 붙인다(ADR-024). 데이터·분석·요약·컴포넌트는 앞 step에서 끝났다. 이 step은 `/dashboard` 페이지에서 URL을 읽어 전체 탭 또는 카드 탭을 조립한다. 전체 탭의 화면·동작은 지금과 같아야 한다.

## 작업

### 1. `src/app/dashboard/card-summary-section.tsx`

`monthly-summary-section.tsx`와 같은 모양의 async 서버 컴포넌트:
```ts
export async function CardSummarySection(props: {
  userId: string; prepared: PreparedCardSummary; deps: CardSummaryDeps; variant: "card-month" | "statement";
}): Promise<React.JSX.Element>
```
`resolveCardSummary` 결과가 failed면 `MonthlySummaryStatus state="failed"`, 아니면 `MonthlySummary source="ai"`(둘 다 `variant`와 `upgrade={prepared.plan === "free"}`).

### 2. `src/app/dashboard/page.tsx`

- `searchParams`에 `card`·`statement`를 더한다(배열이면 첫 값). `requireUser`의 복귀 경로에 지금의 `month`·`upgrade`처럼 `card`(uuid 모양일 때만)·`statement`(`YYYY-MM-DD` 모양일 때만)도 남긴다.
- 조회: 기존 `listCards`·`listDoneUploads`·`getSubscription`과 함께 `listStatements(supabase, user.id)`를 병렬로 읽는다.
- `activeCard` = `cards`에서 `id`가 `card` 파라미터(소문자)와 같은 카드. 없으면 null(= 전체 탭). 다른 사용자의 카드 id는 `listCards`에 없으므로 전체 탭이 된다.
- 전체 탭 DTO `dashboard = buildDashboard(...)`는 지금처럼 항상 만든다(거래가 하나도 없으면 null → 온보딩. 카드 파라미터가 있어도 온보딩이다).
- **전체 탭**(`activeCard === null`, `dashboard !== null`): 지금 화면 그대로에 제목 줄 위 `CardTabs`(`activeCardId={null}`)만 더한다. 월 요약 준비·Suspense·탐지·추세·업로드 구역 모두 지금과 같다.
- **카드 탭**(`activeCard !== null`, `dashboard !== null`):
  - `cardDashboard = buildCardDashboard({ card: activeCard, transactions, statements, plan, month, statement, today: seoulToday() })`.
  - 순서(DESIGN "레이아웃"): `CardTabs`(`activeCardId={activeCard.id}`) → `CardHeading` → (`cardDashboard === null`이면 `EmptyCard`) → 카드 요약 Suspense(전체 폭) → 2열: 월별이면 `TotalCard`(snapshot·mom·partialMonth), 이용 기간이면 `StatementTotalCard` / `CategoryList` → 2열: `TopMerchants editable` / `DailyChart` → Pro이고 `categoryChanges`가 있으면 `CategoryChangesCard`(basis) → 업로드 구역(지금과 같음).
  - 카드 요약: `defaultCardSummaryDeps(supabase)`로 deps를 만들고 `prepareCardSummary(cardDashboard, deps.summarizer)`, `<Suspense key={prepared.inputHash} fallback={<MonthlySummaryStatus state="pending" variant=… upgrade=… />}>` 안에 `CardSummarySection`. `variant`는 월별 `"card-month"`, 이용 기간 `"statement"`.
  - 카드 탭에서는 **전체 탭 월 요약을 준비·생성하지 않는다**(`prepareSummary`·`MonthlySummarySection`·`defaultSummaryDeps`를 부르지 않는다. 이유: 보이지 않는 요약 때문에 LLM을 부르지 않는다). 탐지(`TeaserCard`·`FindingsList`)·추세(`TrendChart`·`TrendLockCard`)도 그리지 않는다.
  - `?checkout=success`·`?upgrade=pricing` 처리(알림·`PricingUpgrade`)는 탭과 관계없이 지금과 같다(`PricingUpgrade`의 teaser는 지금처럼 전체 탭 Free DTO에서).
- 컴포넌트에는 DTO와 `CardOption`만 넘긴다. Free 카드 DTO에는 `categoryChanges`가 없으므로 그대로 넘겨도 된다. 거래 배열·명세서 기록을 컴포넌트 props로 넘기지 마라(이유: RSC payload에 그대로 노출된다).

### 3. 테스트

- `card-summary-section.test.tsx`: ready·failed, variant·upgrade 전달.
- `page.test.tsx`(기존 모킹 방식을 따른다. `listStatements`·`defaultCardSummaryDeps`·`CardSummarySection`도 모킹):
  - 기존 전체 탭 테스트는 그대로 통과하고, 전체 탭에 `카드 보기` 탭(전체가 현재)이 보인다.
  - `?card=<내 카드 id>` 월별 카드: 카드 이름 제목·`월 선택`·카드 요약 섹션·총지출(그 카드 합)이 보이고, 탐지·추세·전체 월 요약이 없으며 `defaultSummaryDeps`·`MonthlySummarySection`이 불리지 않는다.
  - 이용 기간 카드 + `&statement=2026-10-23`: `명세서 선택`, 그 명세서 합, `StatementTotalCard` 문구, 카드 요약 `variant="statement"`.
  - Pro 이용 기간 카드에 비교가 있으면 "지난 명세서와 달라진 카테고리"가 보이고, Free에는 없으며 Free 카드 DTO(카드 요약 준비에 넘긴 값)에 `categoryChanges` 키가 없다.
  - 모르는 카드 id·다른 형식의 `card` 값 → 전체 탭.
  - 거래가 없는 카드 → `이 카드로 올린 내역이 아직 없어요`와 카드 수정 버튼, 카드 요약 없음.
  - 거래가 하나도 없는 사용자 + `?card=` → 온보딩.
  - `requireUser` 복귀 경로에 `card`·`statement`가 남고, 잘못된 모양이면 빠진다.

### 4. 문서 `docs/testing/BROWSER_TESTING.md`

"수동 확인: 월간 요약" 다음에 절을 더한다(다른 절은 고치지 않는다):

```
## 수동 확인: 카드 탭 (UC 17)
자동화하지 않는다(로그인 세션과 실제 명세서가 필요하다). `npm run dev`(3000)에서 `현대` 카드에 9월 23일 명세서(109건 · 1,306,562원)와 10월 23일 명세서(80건 · 1,595,728원)가 있는 사용자로 확인한다. DB는 Supabase MCP `execute_sql`로 본다(가맹점명은 출력하지 않는다).
1. 제목 줄 위 `카드 보기` 탭에 `전체`(현재)와 `현대`가 있다. 전체 탭의 숫자·요약·티저·추세는 이 기능 전과 같다. 375px에서 탭이 넘치면 가로로만 스크롤된다.
2. `현대` → `?card=<id>`, 제목 `현대`, `현대카드 · 월별`, `월 선택`. 달마다 숫자가 그 카드 거래의 그 달 합과 같다. 확인할 지출·월별 추세 카드가 없다. 카드 요약 카드 제목은 `이번 달 요약`이다.
3. `카드 수정` → 모달에 카드사 `현대카드 · 바꿀 수 없어요`, 이름 `현대`, `월별`. `이용 기간` · `12`로 바꾸면 `분석 기준을 바꾸면 이 카드 요약을 다시 만들어요`. `저장` → 모달이 닫히고 `현대카드 · 이용 기간 매달 12일부터`, `명세서 선택`에 `2026년 10월 23일 명세서`·`2026년 9월 23일 명세서`. 다른 카드와 같은 이름이면 저장되지 않고 안내가 보인다. Esc로 닫으면 포커스가 `카드 수정`으로 돌아온다.
4. 10월 23일 명세서: `이용 기간 9/12~10/11`, 총지출 1,595,728원, `9월 23일 명세서보다 +289,166원 늘었어요`, `거래 80건 · 반영 기간 9/12~10/11`. 일별은 9/12부터 10/11까지다. 카드 요약 제목 `이번 명세서 요약`.
5. 9월 23일 명세서: 총지출 1,306,562원, `거래 109건 · 반영 기간 8/12~9/12`, `이용 기간 8/12~9/11`, 지난 명세서 비교 문장이 없다(8월 명세서 없음).
6. Free: 카드 요약 아래 `Pro에서는 달라진 카테고리까지 요약해요` + `Pro로 보기`, 달라진 카테고리 카드는 없다. 페이지 소스(RSC payload)에 `categoryChanges`가 없다. Pro(로컬 mock 결제): 10월 23일 명세서에 `지난 명세서와 달라진 카테고리`가 보이고, live에서 Pro 카드 요약은 가장 많이 늘어난·줄어든 카테고리를 그 카드의 숫자와 같은 금액 차이로 말한다.
7. 로컬 live: 카드 요약 문장 속 숫자가 화면 숫자와 같고 카드 이름·카드사·결제일 숫자를 말하지 않는다. `card_summaries`에 (카드, `2026-10-23`) 행이 생기고 새로고침해도 `updated_at`이 바뀌지 않는다.
8. `카드 수정`으로 다시 `월별`로 바꾸면 그 카드의 `card_summaries` 행이 모두 지워진다. `올린 파일`에서 그 카드 업로드를 지워도 그 카드 행이 모두 지워진다(전체 탭 `ai_summaries`는 그 달 행만 지워진다).
```

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
test -f src/app/dashboard/card-summary-section.tsx
grep -q 'buildCardDashboard' src/app/dashboard/page.tsx
grep -q 'listStatements' src/app/dashboard/page.tsx
grep -q 'CardTabs' src/app/dashboard/page.tsx
grep -q '## 수동 확인: 카드 탭' docs/testing/BROWSER_TESTING.md
! grep -nE 'transactions=\{|statements=\{' src/app/dashboard/page.tsx
test "$(git diff HEAD -- docs/testing/BROWSER_TESTING.md | grep -c '^-[^-]')" -eq 0
git diff --quiet HEAD -- supabase/ src/lib src/services src/components src/types scripts/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 브라우저 시나리오(`scripts/browser-test/run.sh`)는 돌리지 않는다(로그인 세션이 필요해 카드 탭은 수동 확인 대상이다).
2. 아키텍처 체크리스트를 확인한다:
   - 카드 탭의 Free/Pro 차이가 `buildCardDashboard` DTO에서만 오는가? 컴포넌트 props에 거래·명세서 기록·탐지·추세가 들어가지 않는가? (CLAUDE.md CRITICAL)
   - 카드 탭에서 전체 월 요약 LLM 호출을 하지 않는가?
   - 사용자 id는 `requireUser`에서만, 카드는 `listCards`(본인 카드)에서만 고르는가?
   - 전체 탭 화면·동작이 바뀌지 않았는가(기존 페이지 테스트 통과)?
3. 결과에 따라 `phases/12-card-views/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 URL 파라미터 처리, 카드 탭 조립 순서, 카드 요약 Suspense, BROWSER_TESTING 새 절을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 카드 탭에서 `prepareSummary`·`MonthlySummarySection`을 부르지 마라. 이유: 보이지 않는 전체 월 요약 때문에 LLM을 부른다.
- 거래 배열·`StatementRecord`·카드 요약 입력을 클라이언트 컴포넌트 props로 넘기지 마라. 이유: RSC payload로 노출된다.
- 요청 본문·쿼리의 user id를 쓰지 마라. 카드 id는 `listCards` 결과에 있는 것만 쓴다. 이유: CLAUDE.md 인증 규칙.
- `lib/`·`services/`·`components/`·`types/`·`supabase/`를 고치지 마라. 이유: 앞 step에서 끝났다. 꼭 필요한 버그를 찾으면 고치지 말고 summary에 적는다.
- 데모(`/demo`)·랜딩과 브라우저 시나리오(`scripts/browser-test/`)를 바꾸지 마라. 이유: 이번 phase는 실제 대시보드만 바꾼다(ADR-024, 사용자 결정).
- 기존 테스트를 깨뜨리지 마라
