# Step 0: pdf-rows

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/PRD.md` ("지원 범위" 절)
- `/docs/ARCHITECTURE.md` ("디렉토리 구조", "데이터 모델" 아래 fingerprint 설명, "테스트" 절)
- `/docs/ADR.md` (ADR-004, ADR-006, ADR-019)
- `/src/types/transaction.ts` (`IsoDate`), `/src/lib/analytics/dates.ts`
- `/src/lib/parsing/__fixtures__/README.md`, `/src/lib/parsing/__fixtures__/hyundai-statement-pdf.items.json` (앞부분)
- 기존 설정: `/package.json`, `/tsconfig.json`(`resolveJsonModule: true`), `/vitest.config.ts`

이전 phase에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

이 phase(4-pdf-parsing)는 현대카드 명세서 "이용 내역" PDF를 거래 목록으로 읽는 파싱 레이어를 만든다. 업로드·DB·화면은 다음 phase에서 한다. 이 step은 파싱 전체가 공유하는 **타입**, **값 정규화 함수**, PDF 글자 조각을 **줄로 묶는 순수 함수**를 만든다.

구현 파일보다 테스트 파일을 먼저 만든다. 이유: TDD guard hook이 같은 폴더에 테스트 파일이 없는 구현 파일 작성을 막는다(`src/types/`는 예외).

### 1. `src/types/parsing.ts`
아래 이름·필드를 그대로 쓴다. 다음 step과 upload phase가 계약으로 쓴다.
```ts
import type { IsoDate } from './transaction'

// PDF에서 뽑은 글자 조각. page는 1부터, x·y는 PDF 좌표(y는 위로 갈수록 크다)
export type PdfTextItem = { page: number; x: number; y: number; str: string }
export type PdfCell = { x: number; str: string }
export type PdfRow = { page: number; y: number; cells: PdfCell[]; text: string }

export type EventKind = 'purchase' | 'cancel'
export type IdentityScope = 'content'            // 승인번호 범위는 표 형식 프로필에서 추가한다
export type CancelStyle = 'negative_amount'
export type StatementProfile = 'hyundai_statement_pdf'

export type ParsedTransaction = {
  date: IsoDate
  merchant: string        // 표시용 가맹점명
  merchantKey: string     // normalizeMerchantKey(merchant)
  amount: number          // 원 단위 안전한 정수. 지출 양수, 취소·환불 음수
  eventKind: EventKind    // amount < 0 이면 'cancel'
  sourceEventKey: string  // 식별 범위 안의 거래 키(ADR-006)
}

export type ParseSuccess = {
  ok: true
  profile: StatementProfile
  identityScope: IdentityScope
  cancelStyle: CancelStyle
  statementTotal: number
  transactions: ParsedTransaction[]
}

export type UnsupportedFileReason = 'not_pdf' | 'encrypted' | 'too_many_pages' | 'no_text' | 'unknown_format'
export type UnreadableReason =
  | 'total_mismatch' | 'not_lump_sum' | 'cancel_label' | 'broken_layout' | 'no_transactions' | 'too_many_rows'

export type ParseFailure =
  | { ok: false; code: 'UNSUPPORTED_FILE'; reason: UnsupportedFileReason }
  | { ok: false; code: 'UNREADABLE'; reason: UnreadableReason }

export type ParseResult = ParseSuccess | ParseFailure
```

### 2. `src/lib/parsing/normalize.ts`
```ts
export function normalizeMerchantKey(merchant: string): string
export function parseWonAmount(text: string): number | null
export function contentEventKeys(rows: { date: IsoDate; merchantKey: string; amount: number }[]): string[]
```
- `normalizeMerchantKey`: NFKC 정규화 → 연속 공백을 공백 하나로 → 앞뒤 공백 제거 → 영문 대문자. 예: `' Acme*  Cloud ＳＵＢ '` → `'ACME* CLOUD SUB'`, `'오늘마트24R햇살점'`은 그대로.
- `parseWonAmount`: 앞뒤 공백을 허용하고, 선택적 `-`와 세 자리 콤마 그룹 또는 콤마 없는 숫자만 받는다. `'1,820,075'` → `1820075`, `'-12,000'` → `-12000`, `'350'` → `350`. `'1,82,0'`·`'12.5'`·`'1,000원'`·`''`·`'₩1,000'`처럼 형식이 다르거나 `Number.isSafeInteger`가 아니면 `null`. 이유: 금액은 코드가 결정적으로 읽어야 하고, 애매한 값은 추측하지 않는다.
- `contentEventKeys`: 입력 순서대로 `${date}|${merchantKey}|${amount}|${n}`을 돌려준다. `n`은 같은 `(date, merchantKey, amount)` 조합 안에서 몇 번째로 나왔는지(0부터)다. 예: 같은 날·가맹점·금액 3건 → `…|0`, `…|1`, `…|2`. 이유: 승인번호가 없는 형식에서 같은 명세서를 다시 올려도 같은 키가 나오고, 실제로 여러 번 결제한 거래는 각각 남는다(ADR-006).

### 3. `src/lib/parsing/pdf-rows.ts`
```ts
export const ROW_Y_TOLERANCE = 4
export function groupPdfRows(items: PdfTextItem[]): PdfRow[]
```
- 각 조각의 `str`에서 사용자 정의 영역 문자(U+E000–U+F8FF, 아이콘 글자)를 지우고, 빈 문자열이 된 조각은 버린다. 공백만 있는 조각(`' '`)은 남긴다. 이유: 가맹점명 안의 띄어쓰기가 별도 조각으로 온다.
- 쪽 오름차순, 같은 쪽에서는 y 내림차순(위 → 아래), 같은 y면 x 오름차순으로 정렬한다. 그다음 순서대로 보면서, 직전 줄과 같은 쪽이고 그 줄의 기준 y(줄의 첫 조각 y)와 차이가 `ROW_Y_TOLERANCE` 이하이면 같은 줄에 넣고, 아니면 새 줄을 시작한다. 줄의 `y`는 기준 y다.
- 줄 안의 `cells`는 x 오름차순이다. `text`는 cells의 `str`을 구분자 없이 이어 붙인 뒤 연속 공백을 하나로 줄이고 앞뒤 공백을 없앤 값이다.
- `text`가 빈 줄은 결과에서 뺀다. 결과 순서는 쪽 오름차순, 위 → 아래다.
- 입력 배열을 변경하지 않는다.

### 4. 테스트
- `src/lib/parsing/normalize.test.ts`: 위 예시를 모두 단언한다. `contentEventKeys`는 같은 조합 3건과 다른 조합이 섞인 입력에서 순번이 조합별로 따로 매겨지는지 본다.
- `src/lib/parsing/pdf-rows.test.ts`: fixture(`./__fixtures__/hyundai-statement-pdf.items.json`을 `PdfTextItem[]`로 import)로 아래를 단언한다.
  - 결과는 284줄이고 1~12쪽이 모두 있다. 빈 `text` 줄이 없다.
  - 처음 8줄의 `text`는 차례로 `'10월 23일 명세서'`, `'1,820,075원'`, `'간편결제 내역 자세히 보려면? 상세 정보 보기'`, `'최근순 고액순'`, `'26. 10. 11 (일)'`, `'한빛주유소50,000원'`, `'일시불 현대카드MM'`, `'적립 예정 750(1.5%)'`이다.
  - 두 번째 줄의 cells `str`은 `['1,820,075', '원']`이다(y 차이 약 2.6인 두 조각이 한 줄로 묶임).
  - 2쪽 마지막 3줄은 `'ACME* CLOUD SUB30,131원'`, `'(USD:22.00)'`, `'일시불 현대카드MM'`이고, 3쪽 첫 줄은 `'적립 예정 451(1.5%)'`이다.
  - 12쪽은 `'명세서 이용 안내'`, `'맨 위로'` 두 줄이다.
  - 직접 만든 입력으로: 아이콘 글자만 있는 조각이 빠지는지, y 차이 4와 5의 경계, 다른 쪽의 같은 y가 다른 줄이 되는지, 입력을 변경하지 않는지 확인한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # normalize·pdf-rows 테스트 포함 전체 통과
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env|from ['\"]node:" src/lib/parsing --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/types/`, `src/lib/parsing/`)
   - ADR 기술 스택을 벗어나지 않았는가? (이 step은 새 패키지를 설치하지 않는다)
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/4-pdf-parsing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 만든 파일 경로와 export 시그니처(`groupPdfRows`, `normalizeMerchantKey`, `parseWonAmount`, `contentEventKeys`, `ROW_Y_TOLERANCE`)를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/lib/parsing/`에서 I/O, `Date`, `process.env`, `node:` 모듈을 쓰지 마라. 이유: 순수 레이어다(PDF 바이트 읽기는 step 2의 `src/lib/pdf/`가 한다).
- 위 타입의 이름·필드를 바꾸지 마라. 이유: 다음 step과 upload phase가 계약으로 쓴다.
- fixture JSON을 고치거나 새 실제 카드 내역을 저장소에 넣지 마라. 이유: 익명화를 마친 파일이고, 원본은 개인 데이터다.
- 현대카드 프로필(`profiles/`)·PDF 추출(`src/lib/pdf/`)을 미리 만들지 마라. 다음 step에서 한다.
- 패키지를 설치하지 마라.
- 기존 테스트를 깨뜨리지 마라
