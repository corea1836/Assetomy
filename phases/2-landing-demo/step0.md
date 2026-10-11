# Step 0: format

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/DESIGN.md` ("숫자 · 날짜", "차트" 절)
- `/src/types/transaction.ts`, `/src/types/dashboard.ts` (`IsoDate`, `YearMonth`, `Period`)
- `/src/lib/analytics/dates.ts` (날짜 문자열 유틸)

이전 phase에서 순수 분석 레이어 `src/lib/analytics/`와 대시보드 DTO 타입(`src/types/dashboard.ts`)이 만들어졌다. 이 phase(2-landing-demo)는 그 DTO를 그리는 컴포넌트와 `/demo`·랜딩 페이지를 만든다.

## 작업

화면에 숫자·날짜를 표시하는 순수 포맷 함수를 `src/lib/format.ts`에 만든다. 이후 모든 컴포넌트는 이 함수만 써서 금액·날짜를 표시한다. 테스트(`src/lib/format.test.ts`)를 먼저 쓴다.

```ts
export function formatWon(amount: number): string        // 1,234,000원 · −12,000원 · 0원
export function formatSignedWon(amount: number): string  // +123,000원 · −45,000원 · 0원
export function formatAxisWon(amount: number): string    // 차트 축: 120만 · 1.5만 · 5,000 · 0 · −3만
export function formatRatio(ratio: number): string       // 0.1234 → 12% · 0.003 → 1% 미만 · −0.05 → −5%
export function formatMonth(month: YearMonth): string    // '2026-09' → 2026년 9월
export function formatMonthShort(month: YearMonth): string // '2026-09' → 9월
export function formatDate(date: IsoDate): string        // '2026-09-05' → 9월 5일
export function formatPeriod(period: Period): string     // 9/1~9/30 · 연도가 다르면 2025/12/28~2026/1/3
```

### 규칙
- 천 단위 구분은 `Intl.NumberFormat('ko-KR')`를 쓴다.
- 음수 부호는 하이픈(`-`)이 아니라 **U+2212 `−`**다. 0에는 부호를 붙이지 않는다.
- `formatAxisWon`: `|값| >= 10,000`이면 만 단위로 나눠 소수 첫째 자리까지 반올림하고 `.0`은 뗀다(`1,200,000 → 120만`, `15,000 → 1.5만`). `|값| < 10,000`이면 천 단위 구분 숫자(`5,000`)다.
- `formatRatio`: 백분율 정수로 반올림한다. `0 < ratio < 0.005`면 `1% 미만`이다.
- 날짜 함수는 문자열만 다룬다. 월·일 앞의 0은 뗀다.

### 테스트로 단언할 것 (최소)
- 위 시그니처 주석의 예시 전부
- `formatWon(-12000)`의 첫 글자가 `'−'`
- `formatWon(0) === '0원'`, `formatSignedWon(0) === '0원'`
- `formatAxisWon(10000) === '1만'`, `formatAxisWon(9999) === '9,999'`, `formatAxisWon(-30000) === '−3만'`

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # format.test.ts 포함 전체 통과
! grep -nE "new Date|Date\.(now|parse|UTC)|process\.env" src/lib/format.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가?
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/2-landing-demo/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 export한 함수 이름을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 날짜를 `Date` 객체로 파싱하지 마라. 이유: 타임존에 따라 하루가 밀린다.
- 금액을 만 단위로 줄여 표시하는 것은 `formatAxisWon`(차트 축)에서만 한다. 이유: DESIGN.md 규칙이다. 그 외 금액은 원 단위 전체를 보여준다.
- `src/lib/analytics/`와 `src/types/`를 수정하지 마라.
- 기존 테스트를 깨뜨리지 마라
