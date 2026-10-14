# Step 4: card-form

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("입력 필드 · select", "업로드 상태 행", **"카드 등록 폼"**, 버튼 규칙)
- `/docs/UX_GUIDE.md` (폼·에러·접근성 규칙)
- `/docs/USER_FLOW.md` ("② 첫 업로드"의 `[파일 선택]` 카드 등록 폼)
- `/docs/ADR.md` (**ADR-023**)
- 이전 step 산출물: `/src/types/card.ts`(`CARD_ISSUERS`·`CARD_ISSUER_LABELS`·`ANALYSIS_BASES`·`NewCardInput`), `/src/types/upload.ts`(`CardOption`), `/src/app/api/cards/route.ts`(본문 `{ label, issuer, analysisBasis, cycleStartDay }`, 201 `{ card }`, 400 `INVALID_LABEL`·`INVALID_CARD`, 409 `DUPLICATE_LABEL`)
- `/src/components/upload/upload-panel.tsx`·`upload-panel.test.tsx`(지금의 카드 입력칸 `새 카드 이름`·`addCard`·`cardSchema`·`Row.label`·`Row.cardError`·`Row.addingCard`)
- `/src/components/upload/api-reply.ts`(`fetchJson`·`responseError`), `/src/components/button-styles.ts`
- `/src/lib/errors/messages.ts`(`uploadErrorMessage`)

## 배경

업로드 행의 카드 입력칸을 카드 등록 폼으로 바꾼다(ADR-023, DESIGN "카드 등록 폼"). 카드가 없으면 파일 행에 폼이 바로 보이고, 카드가 있으면 `카드 선택`의 `새 카드 추가`를 고를 때 보인다(지금과 같은 조건).

- 카드사 9개 중 기본은 현대카드다. 이름은 카드사를 고르면 `현대카드 1`처럼 그 카드사의 다음 번호로 채운다. 사용자가 이름을 고치면 그 뒤로는 덮지 않는다.
- 분석 기준은 `월별`(기본)과 `이용 기간`이다. 이용 기간이면 `매달 [N]일부터`(1~31)를 받는다. 이 값은 다음 phase의 카드별 화면에서 쓴다.

## 작업

### 1. 다음 번호 `src/components/upload/next-card-label.ts`

```ts
export function nextCardLabel(issuer: CardIssuer, cards: Pick<CardOption, "issuer" | "label">[]): string;
```
- `${CARD_ISSUER_LABELS[issuer]} ${n}`. n은 (그 카드사 카드 수 + 1)에서 시작해, 같은 라벨이 이미 있으면(카드사와 상관없이 모든 카드의 라벨과 비교) 1씩 늘린다. 예: 카드 없음 → `현대카드 1`, 현대카드 1장 → `현대카드 2`, 신한 카드 이름이 `현대카드 2`이고 현대카드 1장 → `현대카드 3`.

### 2. 등록 폼 `src/components/upload/card-form.tsx` (client)

```tsx
export function CardForm(props: {
  cards: CardOption[];                  // 등록한 카드 + 이 화면에서 만든 카드
  disabled: boolean;                    // 업로드 진행 중
  onPendingChange(pending: boolean): void;
  onCreated(card: CardOption): void;
}): React.JSX.Element;
```
- 마크업 순서·스타일은 DESIGN "카드 등록 폼"을 따른다: `form` 안에 카드사 `select`(보이는 라벨 `카드사`, 옵션 9개는 `CARD_ISSUERS` 순서와 `CARD_ISSUER_LABELS`) → 이름 입력(보이는 라벨 `카드 이름`, `maxLength=30`) → `fieldset`(`legend` `분석 기준`, 라디오 `월별`·`이용 기간`) → 이용 기간이면 `매달` + 숫자 입력(`inputmode="numeric"`, `aria-label="이용 기간 시작일"`) + `일부터`와 도움말 → 작은 Primary `추가`(보내는 중 `추가 중…`).
- 이름: 사용자가 입력칸을 고치기 전까지 표시값은 `nextCardLabel(issuer, cards)`이다(카드사나 `cards`가 바뀌면 따라 바뀐다). 한 번이라도 고치면 그 값을 쓴다.
- 도움말: 시작일 N이 1이면 `1일부터 그달 말일까지를 한 명세서로 봐요`, 2~31이면 `N일부터 다음 달 (N-1)일까지를 한 명세서로 봐요`, 비었거나 잘못되면 `12일이면 12일부터 다음 달 11일까지를 한 명세서로 봐요`.
- 제출 전 검사: 이름 trim이 1~30자가 아니면 `uploadErrorMessage("INVALID_LABEL")`, 이용 기간인데 시작일이 1~31 정수(숫자만, 앞뒤 공백 없음)가 아니면 `uploadErrorMessage("INVALID_CARD")`를 폼 아래 `text-sm text-danger`로 보이고 요청하지 않는다. 에러 문구는 `aria-describedby`로 해당 입력에 연결한다.
- 요청: `fetchJson("/api/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, issuer, analysisBasis, cycleStartDay }) })`. `cycleStartDay`는 월별이면 `null`, 이용 기간이면 숫자. 보내는 동안 `onPendingChange(true)`, 끝나면 `false`.
- 201이고 응답이 `{ card: CardOption }` 스키마(지금 패널의 `cardSchema`를 이 파일로 옮긴다)에 맞으면 `onCreated(card)`. 아니면 `responseError(reply.body)`의 코드를 `uploadErrorMessage`로 보여준다.
- `useId`로 id를 만들어 한 화면에 폼이 여러 개여도 라벨 연결이 겹치지 않게 한다.

### 3. 패널 `src/components/upload/upload-panel.tsx`

- 행 안의 카드 입력칸(`새 카드 이름` 입력·`추가` 버튼·`addCard`)을 `CardForm`으로 바꾼다. 보이는 조건은 지금과 같다(`row.status === "waiting" && (row.cardId === NEW_CARD || options.length === 0)`).
- `onCreated`: 지금 `addCard` 성공 처리와 같다(만든 카드를 `createdCards`에 넣고 그 행의 `cardId`를 그 카드로, 알림 `"<파일명> 카드 추가 완료"`). `onPendingChange`는 `Row.addingCard`를 바꾼다(`올리기`·`빼기`·카드 선택을 막는 지금 동작 유지).
- `Row.label`·`Row.cardError`처럼 폼으로 옮겨 쓰이지 않게 된 상태·함수·import는 지운다.
- 업로드·결과·삭제 흐름은 바꾸지 않는다.

### 4. 테스트 (먼저 작성하고 실패를 확인한 뒤 구현한다)

- `next-card-label.test.ts`: 위 예시 세 개와 다른 카드사(`kb` → `KB국민카드 1`).
- `card-form.test.tsx`:
  - 처음에 카드사 `현대카드`, 이름 `현대카드 1`, `월별` 선택, 시작일 입력이 없다.
  - 카드사를 `신한카드`로 바꾸면 이름이 `신한카드 1`. 이름을 `생활비카드`로 고친 뒤 카드사를 바꿔도 `생활비카드`.
  - `cards`에 현대카드가 한 장 있으면 `현대카드 2`.
  - `이용 기간` → 시작일 입력과 도움말이 보이고, 12를 넣으면 `12일부터 다음 달 11일까지를 한 명세서로 봐요`, 1이면 그달 말일 문구.
  - 시작일 0·32·빈칸·`1.5`·`12일`이면 `INVALID_CARD` 문구가 보이고 `fetch`를 부르지 않는다. 이름을 비우면 `INVALID_LABEL` 문구.
  - 제출 본문이 정확하다: 월별 `{ label: "현대카드 1", issuer: "hyundai", analysisBasis: "month", cycleStartDay: null }`, 이용 기간 `{ ..., analysisBasis: "cycle", cycleStartDay: 12 }`. 201이면 `onCreated`에 카드가 오고, `onPendingChange`가 true → false로 불린다.
  - 409 `DUPLICATE_LABEL`·400 `INVALID_CARD`·503이면 해당 문구가 보이고 `onCreated`를 부르지 않는다.
  - 폼이 두 개여도 라벨로 각 입력을 찾을 수 있다(id 충돌 없음).
- `upload-panel.test.tsx`: 기존 카드 추가 테스트를 새 폼으로 옮긴다(카드가 없으면 행에 `카드사`·`카드 이름`이 바로 보임, `새 카드 추가`로 폼 열기, 추가 뒤 그 행의 카드가 선택되고 `올리기` 가능, 추가 중에는 `올리기`가 막힘). 두 파일 행에서 첫 행이 `현대카드 1`을 만들면 둘째 행의 폼 이름이 `현대카드 2`로 바뀐다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -f src/components/upload/card-form.tsx
test -f src/components/upload/card-form.test.tsx
test -f src/components/upload/next-card-label.ts
grep -q 'CardForm' src/components/upload/upload-panel.tsx
! grep -q '새 카드 이름' src/components/upload/upload-panel.tsx
! grep -rn 'dangerouslySetInnerHTML' src/components/upload
git diff --quiet HEAD -- supabase/ src/app src/lib/store src/lib/queries src/lib/ingest src/lib/parsing src/lib/pdf
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `components/`는 DTO(`CardOption`)만 받는가? 사용자에게 보이는 에러 문구는 `lib/errors/messages.ts`의 `uploadErrorMessage`로만 만드는가? (도움말·라벨 문구는 컴포넌트에 둬도 된다)
   - DESIGN "카드 등록 폼"·"입력 필드 · select"의 클래스(입력 `h-12 rounded-xl text-base`, 라디오 `size-4 accent-primary`)를 따르는가? 375px에서 가로로 넘치지 않게 `w-full min-w-0`을 지키는가?
   - 각 입력에 보이는 라벨이나 `aria-label`이 있고, 에러가 `aria-describedby`로 연결되는가?
3. 결과에 따라 `phases/11-card-statements/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`(`CardForm` props, `nextCardLabel`, 패널에서 지운 상태, 추가한 테스트 수, 브라우저 확인은 로그인 세션이 필요해 BROWSER_TESTING "수동 확인: 카드 · 청구서"로 넘김)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 카드사·분석 기준을 서버에 보내지 않거나 기본값만 보내는 단축을 하지 마라. 이유: 서버는 셋을 모두 요구하고(없으면 400), 사용자가 고른 값이 이후 업로드의 카드사 검사에 쓰인다.
- 카드 이름이 비었을 때 서버에 맡기지 말고 화면에서 먼저 막아라. 다만 서버 응답의 에러도 그대로 보여 줘라(라벨 중복은 서버만 안다).
- 카드 수정·삭제 화면을 만들지 마라. 이유: 다음 phase(카드 탭)와 데이터 관리 phase에서 한다.
- 결과 줄·교체 안내·`older_statement` 문구(step 3에서 만듦)와 업로드 흐름을 바꾸지 마라.
- 새 UI 라이브러리를 들이지 마라. 이유: ADR 기술 스택 밖이다.
- `src/app`, `lib/store`, `lib/queries`, `lib/ingest`, `lib/parsing`, `lib/pdf`, `supabase/`를 고치지 마라.
- 기존 테스트를 깨뜨리지 마라
