# Step 2: card-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "데이터 모델", "API", "보안")
- `/docs/ADR.md` (ADR-002, **ADR-023**)
- `/docs/USER_FLOW.md` ("② 첫 업로드"의 카드 등록 폼)
- 이전 step 산출물: `/supabase/migrations/20261017000000_card_statements.sql`(`create_card(p_user_id, p_label, p_issuer, p_analysis_basis, p_cycle_start_day)`와 cards 새 컬럼·check 제약), `/src/types/card.ts`(`CARD_ISSUERS`·`CardIssuer`·`CARD_ISSUER_LABELS`)
- `/src/types/upload.ts`(`CardOption`·`CreateCardResult`·`CreateCardResponse`·`ApiErrorCode`)
- `/src/lib/store/cards.ts`·`cards.test.ts`·`cards.db.test.ts`, `/src/lib/store/store-error.ts`
- `/src/lib/queries/cards.ts`·`cards.test.ts`·`cards.db.test.ts`, `/src/lib/queries/query-error.ts`
- `/src/app/api/cards/route.ts`·`route.test.ts`, `/src/lib/http.ts`
- `/src/lib/errors/messages.ts`
- `/src/lib/supabase/db-test-helpers.ts`와 `createCard`를 부르는 DB 테스트 전부(`grep -rln "createCard(" src`)
- `/src/components/upload/upload-panel.tsx`(카드 추가 응답을 `cardSchema`로 읽는 부분만)

## 배경

카드는 카드사·이름·분석 기준(`month` 월별 / `cycle` 이용 기간)·이용 기간 시작일(1~31, `cycle`일 때만)로 등록한다(ADR-023). 이 step은 서버 쪽(store·query·API)만 바꾼다. 등록 폼 화면은 step 4에서 만든다.

- dev DB에는 step 0 마이그레이션이 적용돼 있어야 한다. `create_card`의 인자가 바뀌어서, 이 step 전 앱 코드는 카드를 만들 수 없다.

## 작업

### 1. 타입

- `src/types/card.ts`에 더한다:
  ```ts
  export const ANALYSIS_BASES = ["month", "cycle"] as const;
  export type AnalysisBasis = (typeof ANALYSIS_BASES)[number];
  export type NewCardInput = {
    label: string; issuer: CardIssuer; analysisBasis: AnalysisBasis; cycleStartDay: number | null;
  };
  ```
- `src/types/upload.ts`: `CardOption`을 `{ id: string; label: string; issuer: CardIssuer; analysisBasis: AnalysisBasis; cycleStartDay: number | null }`로 바꾼다. `ApiErrorCode`에 `"INVALID_CARD"`를 더한다.

### 2. store `src/lib/store/cards.ts`

```ts
export async function createCard(userId: string, input: NewCardInput): Promise<CreateCardResult>;
```
- RPC 인자: `p_user_id`, `p_label: input.label`, `p_issuer`, `p_analysis_basis`, `p_cycle_start_day`(null 그대로). 결과 스키마는 지금과 같다.
- `src/lib/supabase/db-test-helpers.ts`에 DB 테스트용 상수를 둔다: `export const TEST_CARD = { issuer: "hyundai", analysisBasis: "month", cycleStartDay: null } as const satisfies Omit<NewCardInput, "label">;`. `createCard(userId, "라벨")`을 부르는 모든 DB 테스트를 `createCard(userId, { label: "라벨", ...TEST_CARD })`로 바꾼다(단언은 바꾸지 않는다).

### 3. query `src/lib/queries/cards.ts`

- `listCards`가 `id, label, issuer, analysis_basis, cycle_start_day`를 읽어 `CardOption[]`(camelCase)로 돌려준다. 응답 스키마는 issuer를 `z.enum(CARD_ISSUERS)`, analysis_basis를 `z.enum(ANALYSIS_BASES)`, cycle_start_day를 `z.int().min(1).max(31).nullable()`로 검사한다. 페이지네이션(`.range()` 끝까지)·정렬은 그대로다.

### 4. API `src/app/api/cards/route.ts`

- 본문: `{ label: string, issuer: CardIssuer, analysisBasis: AnalysisBasis, cycleStartDay: number | null }`.
  - JSON이 아니거나 `label`이 문자열이 아니면 400 `BAD_REQUEST`(지금과 같음).
  - `issuer`가 목록에 없거나, `analysisBasis`가 `month`·`cycle`이 아니거나, `cycleStartDay`가 1~31 정수가 아니거나, `cycle`인데 시작일이 null이거나 `month`인데 시작일이 null이 아니면 400 `INVALID_CARD`.
  - 라벨은 지금처럼 trim해서 넘기고 `invalid_label` → 400 `INVALID_LABEL`, `duplicate_label` → 409 `DUPLICATE_LABEL`.
  - 본문에 다른 키(`userId`, `storage_path` 등)가 있어도 무시한다. 사용자 id는 세션에서만 쓴다.
- 201 응답: `{ card: CardOption }`(id·trim한 label·issuer·analysisBasis·cycleStartDay).
- 인증 → Origin·Content-Type 검사 → 본문 검사 순서와 503 처리는 지금과 같다.

### 5. 문구 `src/lib/errors/messages.ts`

`UPLOAD_ERROR_MESSAGES`에 `INVALID_CARD: "카드사와 분석 기준을 확인해 주세요. 이용 기간은 매달 1~31일 중 시작일을 입력해요."`를 더한다.

### 6. 업로드 패널 타입만 맞추기

`src/components/upload/upload-panel.tsx`의 카드 추가 응답 스키마(`cardSchema`)가 새 `CardOption` 필드를 읽도록 고친다(issuer는 `z.enum(CARD_ISSUERS)`, analysisBasis는 `z.enum(ANALYSIS_BASES)`, cycleStartDay는 1~31 정수 또는 null). 카드 추가 요청 본문과 화면은 바꾸지 않는다(step 4에서 등록 폼과 함께 바꾼다). `CardOption`을 만드는 기존 테스트 fixture(`src/components/upload/upload-panel.test.tsx`, `src/app/api/uploads/route.test.ts`, `src/app/dashboard/page.test.tsx` 등, `grep -rln "CardOption\|listCards" src`)는 새 필드(예: `issuer: "hyundai", analysisBasis: "month", cycleStartDay: null`)를 넣어 타입만 맞춘다. 단언은 바꾸지 않는다.

### 7. 테스트 (먼저 작성하고 실패를 확인한 뒤 구현한다)

- `route.test.ts`: 월별 카드 201(응답 본문 전체, `createCard`가 `{ label: "생활비 카드", issuer, analysisBasis: "month", cycleStartDay: null }`로 불림), 이용 기간 12일 카드 201, `INVALID_CARD` 6가지(없는 카드사, 없는 분석 기준, `cycle`+null, `month`+12, 0, 32, 1.5 중 최소 6개), 본문의 `userId`가 무시됨, 기존 401·403·415·400·409·503 테스트 유지.
- `store/cards.test.ts`: RPC 인자 이름·값.
- `queries/cards.test.ts`: 새 컬럼 매핑, 잘못된 issuer 행이면 조회 오류.
- `store/cards.db.test.ts`·`queries/cards.db.test.ts`: 이용 기간 카드를 만들고 `listCards`가 issuer·analysisBasis·cycleStartDay를 돌려준다. 다른 사용자 카드는 안 보인다(기존 단언 유지).

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npm run test:db
grep -q '"INVALID_CARD"' src/types/upload.ts
grep -q 'INVALID_CARD' src/lib/errors/messages.ts
grep -q 'p_cycle_start_day' src/lib/store/cards.ts
grep -q 'cycle_start_day' src/lib/queries/cards.ts
grep -q 'TEST_CARD' src/lib/supabase/db-test-helpers.ts
! grep -rnE 'createCard\([a-zA-Z]+, "[^"]*"\)' src
git diff --quiet HEAD -- supabase/ src/lib/parsing src/lib/pdf src/lib/ingest/process-upload.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. `npm run test:db`가 `create_card` 함수를 찾지 못하거나(`PGRST202`, "Could not find the function") 인자 개수가 맞지 않는다는 오류로 실패하면 dev DB에 step 0 마이그레이션이 아직 적용되지 않은 것이다. 코드를 옛 시그니처로 되돌리지 말고 `"status": "blocked"`, `"blocked_reason": "dev DB에 20261017000000_card_statements 마이그레이션 push 필요(supabase db push --linked 후 --resume)"`로 멈춘다.
2. 아키텍처 체크리스트를 확인한다:
   - 사용자 id를 세션에서만 가져오는가? 요청 본문의 다른 키를 DB 쓰기에 쓰지 않는가?
   - 쓰기는 store(service-role RPC)로만, 읽기는 query(세션 클라이언트 + `user_id` 조건)로만 하는가?
   - 사용자에게 보이는 문구는 `lib/errors/messages.ts`에만 있는가?
3. 결과에 따라 `phases/11-card-statements/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`(`createCard(userId, NewCardInput)`, `CardOption` 새 필드, `POST /api/cards` 본문·400 `INVALID_CARD` 조건, `TEST_CARD`, 추가한 테스트 수)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 카드사·분석 기준·시작일을 빠뜨린 요청에 기본값(현대카드·월별)을 채우지 마라. 이유: 사용자가 고르지 않은 카드사로 등록되면 이후 업로드가 카드사 불일치로 거절된다. 400 `INVALID_CARD`로 돌려준다.
- 카드 수정·삭제 API를 만들지 마라. 이유: 카드 이름·분석 기준 바꾸기는 다음 phase의 카드 화면에서, 카드 삭제는 데이터 관리 phase에서 한다.
- 업로드 패널의 카드 추가 요청 본문·화면을 바꾸지 마라. 이유: step 4에서 등록 폼과 함께 바꾼다(그 전까지 패널의 카드 추가는 400을 받는다).
- `supabase/`, `lib/parsing`, `lib/pdf`, `processUpload`를 고치지 마라.
- `supabase db push` 등 DB 스키마 명령을 실행하지 마라.
- `.env`를 고치거나 그 값을 출력하지 마라.
- 기존 테스트를 깨뜨리지 마라
