# Step 1: hyundai-pdf

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("지원 범위" 절)
- `/docs/ADR.md` (ADR-003, ADR-006, ADR-019)
- `/src/lib/parsing/__fixtures__/README.md`
- 이전 step 산출물: `/src/types/parsing.ts`, `/src/lib/parsing/normalize.ts`, `/src/lib/parsing/pdf-rows.ts`와 각 테스트
- `/src/lib/analytics/dates.ts` (`daysInMonth`)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

현대카드 앱·웹의 명세서 "이용 내역" 화면을 PDF로 저장한 형식을 읽는 **카드사 프로필**을 순수 함수로 만든다. 입력은 `groupPdfRows`가 만든 줄 목록이다. 구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook).

### 형식 (fixture `groupPdfRows` 결과 일부)
```
10월 23일 명세서                    ← 헤더(1쪽)
1,820,075원                         ← 명세서 금액(헤더 바로 다음 줄)
간편결제 내역 자세히 보려면? 상세 정보 보기
최근순 고액순
26. 10. 11 (일)                     ← 날짜 줄
한빛주유소50,000원                  ← 거래 줄: cells [...가맹점 조각, '50,000', '원']
일시불 현대카드MM                   ← 결제 방식 줄
적립 예정 750(1.5%)
...
ACME* CLOUD SUB30,131원             ← 2쪽 끝
(USD:22.00)                         ← 통화 줄(거래 줄과 결제 방식 줄 사이에 올 수 있음)
일시불 현대카드MM
적립 예정 451(1.5%)                 ← 3쪽 첫 줄(쪽이 넘어가며 앞 거래의 적립 줄이 떨어짐)
...
SKYAPI (USD:11.00)15,073원          ← 통화 표기가 가맹점 조각에 붙은 경우
민자도로후불교통카드 1건10,000원    ← 끝에 " N건"이 붙은 경우(적립 줄 없음)
```

### `src/lib/parsing/profiles/hyundai-statement-pdf.ts`
```ts
export const MAX_TRANSACTIONS = 5000
export function detectHyundaiStatement(rows: PdfRow[]): boolean
export function parseHyundaiStatement(rows: PdfRow[]): ParseResult
```
- `detectHyundaiStatement`: 1쪽에 `^\d{1,2}월 \d{1,2}일 명세서$`인 줄이 있고, 어느 줄이든 `현대카드`를 포함하면 true.
- `parseHyundaiStatement` 규칙. 처음 만난 실패를 바로 돌려준다.
  1. 헤더 줄(1쪽의 첫 `…월 …일 명세서` 줄)이 없으면 `{ ok: false, code: 'UNSUPPORTED_FILE', reason: 'unknown_format' }`.
  2. 헤더 바로 다음 줄이 `^(-?\d{1,3}(?:,\d{3})*)원$`이 아니면 `UNREADABLE`/`broken_layout`. 맞으면 `parseWonAmount`로 `statementTotal`을 읽는다.
  3. 그다음 줄부터 차례로 본다.
     - **날짜 줄** `^(\d{2})\. (\d{1,2})\. (\d{1,2}) \([월화수목금토일]\)$` → 현재 이용일 `20YY-MM-DD`. 월이 1~12가 아니거나 일이 `daysInMonth`를 넘으면 `broken_layout`.
     - **거래 줄**: 마지막 cell(trim)이 `'원'`이고 그 앞 cell(trim)이 `parseWonAmount`로 읽히면 그 값이 금액이고, 나머지 왼쪽 cells가 가맹점 조각이다. 마지막 cell 하나가 `^(-?\d{1,3}(?:,\d{3})*)원$`이면 그것이 금액이고 나머지가 가맹점 조각이다. 금액은 반드시 cell 단위로 읽는다. 이유: `text`는 구분자 없이 붙어 있어 `QS25` 같은 가맹점명 끝 숫자와 금액이 섞인다.
       - 가맹점 = 가맹점 조각을 이어 붙이고 연속 공백을 하나로·앞뒤 공백 제거 → 끝의 통화 표기 `\s*\([A-Z]{3}\s*:\s*[\d,.]+\)$` 제거 → 끝의 `\s+\d+건$` 제거 → trim. 결과가 비면 `broken_layout`.
       - 현재 이용일이 아직 없으면 `broken_layout`.
       - 다음 줄부터 통화 줄(`^\([A-Z]{3}\s*:\s*[\d,.]+\)$`)은 건너뛰고, 처음 나온 줄이 **결제 방식 줄**이어야 한다. 그 줄이 `현대카드`를 포함하지 않거나 없으면 `broken_layout`. `일시불 `로 시작하지 않으면 `not_lump_sum`. 이유: 할부가 섞인 명세서는 회차 금액이 정기결제로 오탐되고, 실제 파일로 검증되지 않았다(ADR-003·019).
       - 거래 줄 `text`나 결제 방식 줄 `text`에 `취소`가 있고 금액이 양수면 `cancel_label`. 이유: 상태 표시형 취소는 해석하지 않는다(ADR-004). 음수 금액은 취소로 읽는다(`eventKind: 'cancel'`).
       - 금액이 0이면 거래로 넣지 않는다.
       - 결제 방식 줄까지 소비한 뒤 그다음 줄부터 계속 본다.
     - **그 밖의 줄**(적립 예정, 분할결제 신청하기, 광고, 정렬 버튼, 푸터, 쪽 머리의 떨어진 적립 줄)은 무시한다.
  4. 거래가 0건이면 `no_transactions`, `MAX_TRANSACTIONS`를 넘으면 `too_many_rows`.
  5. 거래 금액 합이 `statementTotal`과 정확히 같지 않으면 `total_mismatch`. 이유: 카드사가 계산한 금액과 대조해 처음 보는 줄이 섞여도 틀린 숫자를 저장하지 않는다(ADR-019).
  6. 성공: `{ ok: true, profile: 'hyundai_statement_pdf', identityScope: 'content', cancelStyle: 'negative_amount', statementTotal, transactions }`. transactions는 파일 순서(위 → 아래)이고 `merchantKey = normalizeMerchantKey(merchant)`, `sourceEventKey`는 `contentEventKeys`로 만든다.
- 금액·날짜·합계는 이 코드로만 계산한다. LLM이나 추정값을 쓰지 않는다.

### 테스트 `src/lib/parsing/profiles/hyundai-statement-pdf.test.ts`
fixture를 `groupPdfRows`로 묶어 쓴다. 실패 사례는 fixture 조각 배열을 복사해 (쪽, y, str)로 찾은 조각의 `str`만 바꾸거나 지우는 작은 헬퍼로 만든다(원본 fixture 객체를 변경하지 않는다). fixture 배열은 화면 순서가 아니므로 아래 좌표로 조각을 찾는다.
- 성공(fixture 그대로):
  - `detectHyundaiStatement`가 true. `ok: true`, `profile: 'hyundai_statement_pdf'`, `identityScope: 'content'`, `cancelStyle: 'negative_amount'`, `statementTotal: 1820075`.
  - 78건, 금액 합 1,820,075, 모두 `eventKind: 'purchase'`. 월별 합: `2026-09` 804,201 · `2026-10` 1,015,874. 이용일 최소 `2026-09-12`, 최대 `2026-10-11`.
  - 첫 거래 `{ date: '2026-10-11', merchant: '한빛주유소', merchantKey: '한빛주유소', amount: 50000, eventKind: 'purchase', sourceEventKey: '2026-10-11|한빛주유소|50000|0' }`, 마지막 거래 `date: '2026-09-12'`, `merchant: '오늘마트24R햇살점'`, `amount: 6500`.
  - `merchant: 'SKYAPI'`(2026-10-06, 15,073), `'ACME* CLOUD SUB'`(2026-10-06, 30,131), `'민자도로후불교통카드'`(2026-10-08, 10,000), `'(주)결제대행 - (주)달빛떡집'`(2026-09-19, 40,000), `'택시-가람 00 가 0000'`(2026-09-15, 6,400)이 있다.
  - `sourceEventKey` 78개가 모두 다르고, `'2026-09-18|오늘마트24R햇살점|2000|0'`·`…|1`·`…|2`가 모두 있다.
- 실패·변형:
  - 명세서 금액 조각(1쪽 y 648.2 `'1,820,075'`) → `'1,820,076'`: `UNREADABLE`/`total_mismatch`.
  - 1쪽 y 449 부근 `'일시불'` 조각 → `'할부(3개월)'`: `not_lump_sum`.
  - 마지막 거래 금액 조각(11쪽 y 293.7 `'6,500'`) → `'-6,500'`이고 명세서 금액을 `'1,807,075'`로: 성공, 마지막 거래 `amount: -6500`, `eventKind: 'cancel'`, `sourceEventKey: '2026-09-12|오늘마트24R햇살점|-6500|0'`.
  - 첫 거래 가맹점 조각(1쪽 y 469.8 `'한빛주유소'`) → `'한빛주유소 취소'`: `cancel_label`.
  - 1쪽 y 511 부근 날짜 줄(`'26. 10. 11 ('`, `'일'`, `')'`) 조각을 모두 지움: 첫 거래 앞에 날짜가 없어 `broken_layout`.
  - 1쪽 y 449 부근 결제 방식 줄(`'일시불'`, `' '`, `'현대카드'`, `'MM'`) 조각을 모두 지움: `broken_layout`.
  - 1쪽 y 680.2 `'명세서'` 조각 제거: `detectHyundaiStatement` false, `parse`는 `UNSUPPORTED_FILE`/`unknown_format`.
  - 헤더·명세서 금액·날짜 줄만 있는 행 목록: `no_transactions`.
  - 직접 만든 행 5,001건(명세서 금액을 합계와 맞춤): `too_many_rows`.
  - 날짜 줄 `26. 2. 30 (월)`: `broken_layout`.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # hyundai-statement-pdf 테스트 포함 전체 통과
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env|from ['\"]node:" src/lib/parsing --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/parsing/profiles/`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가? (금액·날짜·합계는 코드로만)
3. 결과에 따라 `phases/4-pdf-parsing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 파일 경로, `detectHyundaiStatement`·`parseHyundaiStatement`·`MAX_TRANSACTIONS` 시그니처, fixture 결과(78건·1,820,075원)를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 규칙에 없는 줄을 추측으로 거래로 만들거나 합계 불일치를 보정하지 마라. 이유: 틀린 숫자를 저장하느니 거절한다(ADR-019).
- 승인번호·카드번호를 만들어 넣지 마라. 식별은 `contentEventKeys`로만 한다.
- 이전 step의 타입·함수 시그니처를 바꾸지 마라. 필요한 헬퍼는 이 프로필 파일 안에 둔다.
- fixture JSON을 고치지 마라.
- `src/lib/parsing/`에서 I/O, `Date`, `process.env`, `node:` 모듈을 쓰지 마라.
- PDF 추출(`src/lib/pdf/`)을 미리 만들거나 패키지를 설치하지 마라. 다음 step에서 한다.
- 기존 테스트를 깨뜨리지 마라
