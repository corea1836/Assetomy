# Step 3: cancel-pairing

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("레이어 규칙", **"거래 건수(취소 짝)"**)
- `/docs/ADR.md` (ADR-010, **ADR-025**의 1번)
- `/docs/PRD.md` ("플랜별 기능"의 거래 건수 문단)
- 순수 분석 코드: `/src/lib/analytics/snapshot.ts`, `/src/lib/analytics/detection.ts`(`detectDuplicates`의 취소 반영 방식, `detectLarge`), `/src/lib/analytics/dashboard.ts`, `/src/lib/analytics/summary-input.ts`와 각 `.test.ts`
- 타입: `/src/types/dashboard.ts`(`MerchantAmount`, `PeriodSnapshot`, `Snapshot`), `/src/types/transaction.ts`
- 데모 데이터: `/src/lib/demo/fixture.ts`(9월 `예시 종이달 상점` 26일 48,000원 결제와 29일 −48,000원 취소)

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

거래 건수가 취소된 결제를 세지 않게 한다(ADR-025). 실제 10월 명세서의 교육 가맹점은 10/5 254,000원 결제, 10/5 −254,000원 취소, 10/9 284,000원 결제인데 지금은 "3건"이다. 바뀐 뒤에는 "1건"이고 취소 1건을 따로 센다. 금액(284,000원)은 그대로다.

- 짝은 **같은 카드·같은 정규화 가맹점(`merchantKey`)에서 금액이 정확히 반대**인 취소(음수)와 결제(양수)다.
- 취소를 이용일·id 오름차순으로 하나씩 보며, 이용일이 **같거나 앞선**, 아직 짝이 없는 같은 금액 결제 중 **가장 늦은 것**(이용일이 같으면 id가 큰 것)과 짝짓는다. 그런 결제가 없으면 그 취소는 짝이 없다.
- 짝이 없는 음수(부분 취소·지난 기간 결제의 취소)는 지금처럼 거래 1건이다.
- 스냅샷의 짝은 그 스냅샷에 넘긴 거래(그 달·그 명세서) 안에서만 짓는다. 고액 결제 탐지는 탐지에 넘긴 전체 거래로 짝을 짓는다.
- 화면 표시("취소 N건")는 step 6에서 한다. 이 step은 순수 레이어와 타입만 바꾼다.

## 작업

### 1. 짝 짓기 (`src/lib/analytics/cancellations.ts`, 새 파일)

```ts
// 같은 카드·같은 정규화 가맹점에서 금액이 정확히 반대인 취소와 결제를 짝짓는다(ADR-025).
// 짝지은 거래(결제·취소 모두)의 id를 돌려준다.
export function pairCancellations(transactions: Transaction[]): Set<string>
```
- 위 "배경"의 규칙 그대로. 입력 배열 순서와 결과가 무관해야 한다(먼저 정렬한다). 입력을 바꾸지 마라.

### 2. 스냅샷 (`src/lib/analytics/snapshot.ts`, `src/types/dashboard.ts`)

- `MerchantAmount`에 `cancelCount: number`(그 가맹점의 짝지은 취소 수)를 더한다. `count`는 이제 **짝을 뺀** 그 가맹점 거래 수다.
- `PeriodSnapshot`에 `cancelCount: number`(짝의 수)를 더한다. `transactionCount`는 이제 **짝을 뺀** 거래 수다(`transactions.length - 짝지은 거래 수`). 타입 주석을 이 뜻으로 고친다.
- `buildPeriodSnapshot`이 `pairCancellations(transactions)`로 위 값을 계산한다. `buildSnapshot`은 `cancelCount`도 옮긴다.
- 바꾸지 않는 것: `total`·카테고리 금액·일별 금액·가맹점 금액(짝도 금액에는 그대로 더한다), 가맹점 정렬·`topMerchants`(금액 양수만 5곳)·`otherMerchants`, 표시 가맹점명(가장 최근 거래) 규칙. 결제와 취소만 있는 가맹점(금액 0, count 0, cancelCount 1)은 지금처럼 `otherMerchants`에 남는다.

### 3. 고액 결제 탐지 (`src/lib/analytics/detection.ts`)

- `detectLarge`는 `pairCancellations(transactions)`로 짝지은 결제를 양수 표본(`LARGE_MIN_SAMPLE`·중앙값)과 후보에서 모두 뺀다. 나머지 규칙(임계값·정렬)은 그대로다.
- `detectRecurring`·`detectDuplicates`·`summarizeFindings`는 바꾸지 마라(중복 결제 의심은 이미 취소를 반영한다).

### 4. 영향 받는 곳

- `summary-input.ts`는 스냅샷의 `transactionCount`·가맹점 `count`를 그대로 쓰므로 코드는 바꾸지 않는다. 요약 입력에 `cancelCount`를 더하지 마라.
- `MerchantAmount`·`PeriodSnapshot` 객체를 직접 만드는 테스트 fixture·컴포넌트 테스트는 타입 오류를 없애는 만큼 `cancelCount: 0`을 더한다.

### 5. 테스트

- `cancellations.test.ts`:
  1. 254,000 결제(10/5) + −254,000 취소(10/5) + 284,000 결제(10/9) → 앞의 결제와 취소가 짝, 284,000은 짝 없음.
  2. 취소(10/3)가 같은 금액 결제(10/5)보다 앞서면 짝 없음.
  3. 같은 금액 결제 10/1·10/4 + 취소 10/6 → 10/4 결제와 짝.
  4. 같은 날 같은 금액 결제 둘 + 같은 날 취소 → id가 큰 결제와 짝.
  5. 다른 카드의 같은 가맹점, 같은 카드의 다른 가맹점 → 짝 없음.
  6. 금액이 다른 부분 취소(30,000 결제, −10,000 취소) → 짝 없음.
  7. 결제 둘 + 취소 둘 → 두 짝. 결제 하나 + 취소 둘 → 이른 취소가 짝, 늦은 취소는 짝 없음.
  8. 입력 순서를 뒤집어도 결과가 같다. 입력 배열을 바꾸지 않는다.
- `snapshot.test.ts`: 1번 예시로 `transactionCount` 1, `cancelCount` 1, 가맹점 `count` 1·`cancelCount` 1, 금액 284,000. 짝만 있는 가맹점은 `otherMerchants`에 count 0·cancelCount 1. 짝 없는 환불은 1건. 짝이 없으면 지금과 같은 값(`cancelCount` 0).
- `detection.test.ts`: 취소된 고액 결제는 후보가 아니다. 짝지은 결제는 표본에서도 빠진다(양수 20건 경계: 20건 중 1건이 짝이면 표본이 19건이라 탐지하지 않음). 다른 달의 취소와도 짝지어 빠진다.
- `dashboard.test.ts`·`summary-input.test.ts`: 데모 9월 스냅샷 `transactionCount` 24·`cancelCount` 1, `예시 종이달 상점` count 1·cancelCount 1, 요약 입력 `transactionCount` 24.
- 기대값이 바뀌는 기존 테스트(예: `/src/app/dashboard/page.test.tsx`의 `거래 26건 · 반영 기간 9/1~9/30` → `거래 24건 · 반영 기간 9/1~9/30`, 랜딩 쇼케이스 건수)는 **이 규칙 때문에 바뀌는 것만** 고치고, 테스트 이름이나 주석에 "취소 짝(ADR-025)"을 남긴다. 다른 이유로 실패하는 테스트의 기대값을 고치지 마라.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 단위 테스트 전체 통과
test -f src/lib/analytics/cancellations.ts
grep -q 'export function pairCancellations' src/lib/analytics/cancellations.ts
grep -q 'cancelCount: number' src/types/dashboard.ts
grep -q 'pairCancellations' src/lib/analytics/snapshot.ts
grep -q 'pairCancellations' src/lib/analytics/detection.ts
! grep -nE 'Date\.now|new Date|process\.env' src/lib/analytics/cancellations.ts
! grep -q 'cancelCount' src/lib/analytics/summary-input.ts
test "$(git diff HEAD --name-only -- supabase/ src/services src/lib/summary src/lib/queries src/lib/store src/app src/components | grep -Evc '\.test\.tsx?$')" -eq 0   # 테스트 파일만 바뀜
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 순수 레이어가 I/O·`Date.now()`·env를 쓰지 않는가?
   - 금액 합계(총지출·카테고리·가맹점·일별)가 바뀌지 않았는가? 데모 9월 총지출이 1,517,200원 그대로인가?
   - Free DTO에 새 상세가 들어가지 않았는가(건수만 바뀜)?
3. 결과에 따라 `phases/13-insight-personalization/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `pairCancellations` 규칙, `transactionCount`·`count`의 새 뜻과 `cancelCount` 필드, `detectLarge` 변경, 데모 9월 24건·취소 1건, 고친 기존 테스트 기대값을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 금액(`total`, 카테고리·가맹점·일별 금액)에서 짝을 빼지 마라. 이유: 취소는 금액으로는 이미 상쇄된다. 건수만 바꾼다(ADR-025).
- 기간을 넘는 취소나 금액이 다른 부분 취소를 짝짓지 마라. 이유: ADR-025의 트레이드오프로 정한 범위다(고액 결제 탐지만 전체 거래로 짝짓는다).
- 데모 fixture(`src/lib/demo/fixture.ts`)를 바꾸지 마라. 이유: 랜딩·데모 숫자는 fixture를 그대로 계산한 결과여야 한다.
- 컴포넌트·페이지 코드를 고치지 마라(테스트 기대값만). 이유: "취소 N건" 표시는 step 6에서 한다.
- 기존 테스트를 깨뜨리지 마라(위 규칙으로 기대값이 바뀌는 테스트만 고친다)
