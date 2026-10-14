# Step 1: statement-parse

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", "업로드 흐름")
- `/docs/ADR.md` (ADR-006, ADR-019, **ADR-023**)
- `/src/types/parsing.ts`, `/src/types/transaction.ts`
- `/src/lib/parsing/profiles/hyundai-statement-pdf.ts`와 테스트(`row()`·`statementRows()`·`editedFixtureRows()` 도우미)
- `/src/lib/parsing/pdf-rows.ts`(`row.text`는 셀을 이어 붙여 공백을 하나로 줄인 값이다)
- `/src/lib/parsing/__fixtures__/README.md`와 `hyundai-statement-pdf.items.json`(익명화한 실제 파일의 글자 조각)
- `/src/lib/pdf/extract.ts`·`extract.test.ts`·`read-statement.ts`·`read-statement.test.ts`·`test-pdf.ts`
- `/src/lib/analytics/dates.ts`(`daysInMonth`)
- `ParseSuccess`를 만드는 테스트: `/src/lib/ingest/process-upload.test.ts`, `/src/lib/ingest/process-upload.db.test.ts`
- 이전 step 산출물: `/supabase/migrations/20261017000000_card_statements.sql`(이 step의 값이 결국 `ingest_upload`의 `p_issuer`·`p_product_name`·`p_statement_date`·`p_statement_saved_at`로 간다. 이 step에서는 연결하지 않는다)

## 배경

현대카드 이용 내역 PDF에서 청구서와 카드를 알아내는 값 세 가지를 읽는다(ADR-023).

- **청구서 결제일**: 1쪽 머리글 `10월 23일 명세서`. 연도가 없으므로 "마지막 거래일(취소 포함 모든 거래의 최대 이용일) 이후 처음 오는 그 월·일"로 정한다. 예: 마지막 거래일 2026-10-11 → 2026-10-23, 2026-12-11에 끝나는 `1월 23일 명세서` → 2027-01-23. 그 날짜가 마지막 거래일과 같으면 같은 해다.
- **카드 상품명**: 거래마다 붙는 결제 방식 줄. 실제 파일의 셀은 `["일시불"," ","현대카드","MM"]`, 결제가 취소된 거래는 `["일시불"," ","현대카드","MM","0","원"]`(text `일시불 현대카드MM0원`), 연회비는 `["현대카드","MM"]`처럼 `일시불`이 없다. 상품명은 세 경우 모두 `현대카드MM`이다. 결제일이 같은 여러 카드가 한 PDF에 섞이면 상품명이 둘 이상이 되고, 이 파일은 받지 않는다(UNREADABLE `multiple_cards`).
- **PDF 저장 시각**: PDF 메타데이터 `/CreationDate`. 실제 파일 값은 `D:20261013223944Z00'00'`(iOS 인쇄 저장). 없거나 읽을 수 없으면 null이다(나중에 DB가 업로드 시각으로 대체한다).
- 카드사: 이 프로필은 현대카드다(`issuer: "hyundai"`).

## 작업

### 1. 카드 타입 `src/types/card.ts` (새 파일)

```ts
export const CARD_ISSUERS = ["hyundai", "shinhan", "samsung", "kb", "lotte", "hana", "woori", "bc", "nh"] as const;
export type CardIssuer = (typeof CARD_ISSUERS)[number];
export const CARD_ISSUER_LABELS: Record<CardIssuer, string>; // 현대카드·신한카드·삼성카드·KB국민카드·롯데카드·하나카드·우리카드·BC카드·NH농협카드 (이 순서)
```
`src/types/category.ts`의 `CATEGORY_IDS`·`CATEGORY_LABELS`와 같은 형태로 쓴다. 순서와 id는 DB check 제약(`cards_issuer_check`)과 같아야 한다.

### 2. 파싱 타입 `src/types/parsing.ts`

```ts
export type StatementInfo = {
  date: IsoDate;            // 청구서 결제일
  productName: string;      // 카드 상품명(예: "현대카드MM")
  savedAt: string | null;   // PDF 저장 시각, ISO 8601(예: "2026-10-13T22:39:44Z"), 없으면 null
};
export type ParseSuccess = {
  ok: true; profile: StatementProfile; issuer: CardIssuer;
  identityScope: IdentityScope; cancelStyle: CancelStyle;
  statementTotal: number; statement: StatementInfo; transactions: ParsedTransaction[];
};
```
`UnreadableReason`에 `"multiple_cards"`를 더한다.

### 3. 프로필 `src/lib/parsing/profiles/hyundai-statement-pdf.ts`

시그니처: `export function parseHyundaiStatement(rows: PdfRow[], savedAt: string | null = null): ParseResult`

- 머리글 정규식에서 월·일을 꺼낸다(지금 `HEADER`를 캡처 그룹이 있는 형태로 바꾼다).
- 결제 방식 줄(일시불 줄과 연회비의 `현대카드…` 줄)을 읽을 때마다 상품명을 모은다. 상품명은 **셀로** 읽는다(`readTransaction`이 금액을 셀로 읽는 것과 같은 이유: text에서는 `MM0원`의 경계를 알 수 없다): 마지막 셀이 `원`이면 마지막 두 셀을, 마지막 셀이 `/^-?[\d,]+원$/`이면 마지막 한 셀을 뺀 나머지 셀을 이어 붙이고 공백을 하나로 줄여 trim한 뒤 앞의 `일시불 `을 뗀다. 결과가 `현대카드`로 시작하지 않거나 40자를 넘으면 `broken_layout`이다.
- 금액 0원이라 저장하지 않는 거래의 결제 방식 줄도 상품명 수집에 포함한다. `결제 취소` 줄은 결제 방식 줄이 없으므로 수집하지 않는다.
- 반복이 끝난 뒤 순서: `no_transactions` → `too_many_rows` → 상품명이 2개 이상이면 `multiple_cards`(0개면 `broken_layout`) → `total_mismatch` → 결제일 계산(달력에 없는 날짜면 `broken_layout`).
- 결제일 계산은 같은 파일 안의 작은 순수 함수로 둔다: `statementDate(month: number, day: number, lastDate: IsoDate): IsoDate | null`. 날짜는 `'YYYY-MM-DD'` 문자열 비교로 다루고 `Date` 객체를 쓰지 않는다(AGENTS.md 순수 레이어 규칙). 일이 그 달의 `daysInMonth`보다 크면 null.
- 성공 결과에 `issuer: "hyundai"`, `statement: { date, productName, savedAt }`을 넣는다. 나머지 필드·거래·`sourceEventKey`는 지금과 같다.

### 4. PDF 저장 시각 `src/lib/pdf/pdf-date.ts` (새 파일, 순수 함수)

```ts
export function parsePdfDate(value: unknown): string | null;
```
- 받는 형식: 앞의 `D:`는 있어도 없어도 된다. 그 뒤 `YYYYMMDDHHmmSS` 14자리와 시간대가 반드시 있어야 한다. 시간대는 `Z`(뒤에 `00'00'`·`00'00`이 붙어도 됨) 또는 `+HH'mm'`·`+HH'mm`·`+HHmm`(`-`도 같음).
- 돌려주는 값: `Z`면 `YYYY-MM-DDTHH:mm:ssZ`, 아니면 `YYYY-MM-DDTHH:mm:ss+HH:MM`. 예: `D:20261013223944Z00'00'` → `2026-10-13T22:39:44Z`, `D:20261014073944+09'00'` → `2026-10-14T07:39:44+09:00`.
- 문자열이 아니거나, 형식이 다르거나, 월 1~12·일 1~그 달 말일·시 0~23·분·초 0~59·시간대 시 0~23·분 0~59를 벗어나면 null. `Date`로 파싱하거나 현재 시각과 비교하지 않는다(미래 시각 제한은 DB가 한다).

### 5. 추출 `src/lib/pdf/extract.ts`, `read-statement.ts`

- `PdfExtraction`의 성공을 `{ ok: true; items: PdfTextItem[]; savedAt: string | null }`로 바꾼다. 문서를 연 뒤 `document.getMetadata()`의 `info.CreationDate`를 `parsePdfDate`로 읽는다. `getMetadata`가 던지면 savedAt은 null로 두고 계속한다(메타데이터 때문에 업로드를 실패시키지 않는다).
- `readPdfStatement`는 `parseHyundaiStatement(rows, extraction.savedAt)`로 넘긴다.
- `src/lib/pdf/test-pdf.ts`의 `makeTestPdf`에 세 번째 인자 `info?: { creationDate?: string }`을 더해, 있으면 `/Info` 사전(`<< /CreationDate (값) >>`)을 객체로 넣고 trailer에 `/Info N 0 R`을 단다. 기존 호출은 그대로 동작해야 한다.

### 6. 테스트 (먼저 작성하고 실패를 확인한 뒤 구현한다)

- `hyundai-statement-pdf.test.ts`
  - fixture 전체: `issuer`가 `hyundai`, `statement`가 `{ date: "2026-10-23", productName: "현대카드MM", savedAt: null }`, 두 번째 인자로 넘긴 savedAt이 그대로 실린다. 기존 기대값(78건·1,820,075원·월별 합계·sourceEventKey)은 그대로다.
  - 합성 행: `["일시불"," ","현대카드","MM","0","원"]` 결제 방식 줄과 연회비의 `["현대카드","MM"]` 줄이 있어도 상품명은 `현대카드MM`. 거래 둘의 상품명이 `현대카드MM`·`현대카드ZERO`면 `multiple_cards`. 상품명 셀이 `현대카드`로 시작하지 않으면 `broken_layout`.
  - 결제일: `1월 23일 명세서` + 마지막 거래일 2026-12-11 → `2027-01-23`. `10월 11일 명세서` + 마지막 거래일 2026-10-11 → `2026-10-11`. `2월 30일 명세서` → `broken_layout`. `statementDate` 단위 테스트(2월 29일: 마지막 거래일 2027-01-10 → 2027년에 없음 → null, 2028-01-10 → `2028-02-29`).
- `pdf-date.test.ts`: 위 예시 두 개, `D:` 없는 값, `Z`만 있는 값, `+0900`, 시간대 없는 값 → null, `D:20261313...` 같은 범위 밖 값 → null, 숫자·undefined → null.
- `extract.test.ts`: `makeTestPdf([TEST_TEXT_STREAM], false, { creationDate: "D:20261013223944Z00'00'" })` → `savedAt = "2026-10-13T22:39:44Z"`, info 없는 PDF → null.
- `read-statement.test.ts`의 로컬 샘플 테스트(`ASSETOMY_SAMPLE_PDF`가 있을 때만)에 `statement.date === "2026-10-23"`, `statement.productName === "현대카드MM"`, `statement.savedAt`이 ISO 형식(`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/`)인지 더한다. 실패 출력에 경로·가맹점이 나오지 않는 지금 방식을 지킨다.
- `process-upload.test.ts`·`process-upload.db.test.ts`의 `ParseSuccess` fixture에 `issuer: "hyundai"`와 `statement`(예: `{ date: "2026-10-23", productName: "현대카드MM", savedAt: null }`)를 더해 타입을 맞춘다. 그 밖의 단언은 바꾸지 않는다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -f src/types/card.ts
test -f src/lib/pdf/pdf-date.ts
test -f src/lib/pdf/pdf-date.test.ts
grep -q '"multiple_cards"' src/types/parsing.ts
grep -q 'savedAt' src/lib/pdf/extract.ts
grep -q 'getMetadata' src/lib/pdf/extract.ts
! grep -nE 'new Date|Date\.(now|parse)' src/lib/parsing/profiles/hyundai-statement-pdf.ts src/lib/pdf/pdf-date.ts
! grep -rn "^import 'server-only'\|^import \"server-only\"" src/lib/pdf/pdf-date.ts
git diff --quiet HEAD -- supabase/
```

## 검증 절차

1. 위 AC 커맨드를 실행한다. 로컬에 실제 PDF가 있으면(이 step의 세션에는 없을 수 있다) `ASSETOMY_SAMPLE_PDF=<경로> npx vitest run src/lib/pdf/read-statement.test.ts`도 통과해야 한다. 경로가 없으면 건너뛴다.
2. fixture 테스트의 기존 기대값(건수·합계·월별 합계·키)이 하나도 바뀌지 않았는지 diff로 확인한다.
3. 아키텍처 체크리스트를 확인한다:
   - `lib/parsing`은 I/O·`Date`·env를 쓰지 않는가? 메타데이터 읽기는 `lib/pdf`(I/O)에만 있는가?
   - 상품명·저장 시각·결제일을 로그에 남기지 않는가?
4. 결과에 따라 `phases/11-card-statements/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`(새·바뀐 시그니처 `parseHyundaiStatement(rows, savedAt)`·`parsePdfDate`·`StatementInfo`·`ParseSuccess.issuer`·`CARD_ISSUERS`/`CARD_ISSUER_LABELS`, 판정 순서, 추가한 테스트 수)
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `sourceEventKey`·가맹점명 정규화·합계 대조·기존 판정(일시불·취소·통화 줄·연회비)을 바꾸지 마라. 이유: 이미 저장된 거래의 fingerprint와 실제 파일 검증 결과가 그 규칙에 기대고 있다(ADR-006).
- 상품명을 `row.text`에 정규식을 걸어 뽑지 마라. 이유: 취소 거래의 `현대카드MM0원`처럼 상품명과 금액이 공백 없이 붙어 경계를 잃는다. 셀로 읽는다.
- 결제일 연도를 오늘 날짜나 PDF 저장 시각으로 정하지 마라. 이유: 순수 레이어는 현재 시각을 모르고, 저장 시각은 없을 수 있다. 마지막 거래일로만 정한다.
- 실제 PDF·가맹점명을 저장소나 테스트 출력에 넣지 마라. 이유: 개인 카드 내역이다. 합성 행과 익명화 fixture만 쓴다.
- `processUpload`·업로드 API·store를 고치지 마라(테스트 fixture 타입 맞춤만 허용). 이유: step 3에서 연결한다.
- `supabase/`를 고치지 마라.
- 기존 테스트를 깨뜨리지 마라
