# Step 4: upload-ui

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/USER_FLOW.md` ("② 첫 업로드 → aha", "④ 월간 재방문")
- `/docs/UX_GUIDE.md` ("상태별 다음 단계", "활성화: 빈 대시보드 → 첫 업로드", "신뢰와 통제", 원칙 3·5·6, "문구", "화면 체크리스트")
- `/docs/DESIGN.md` (버튼·입력 필드·목록 행·모달·"업로드 상태 행"·"문구"·레이아웃)
- `/docs/ARCHITECTURE.md` ("패턴": 클라이언트 컴포넌트·`router.refresh()`)
- 기존 코드: `/src/app/dashboard/page.tsx`와 테스트, `/src/components/button-styles.ts`, `/src/components/dashboard/category-list.tsx`(`<details>` 패턴), `/src/components/icons.tsx`, `/src/lib/errors/messages.ts`와 테스트, `/src/lib/format.ts`(`formatWon`·`formatPeriod`), `/src/app/login/page.tsx`(에러 박스 패턴)
- 이전 step 산출물: `/src/types/upload.ts`(`CardOption`·`UploadResultDto`·`ApiErrorCode`·`ApiErrorBody`·`CreateCardResponse`·`UploadResponse`), `/src/app/api/cards/route.ts`, `/src/app/api/uploads/route.ts`, `/src/app/api/uploads/[id]/route.ts`, `/src/lib/queries/cards.ts`·`/src/lib/queries/transactions.ts`, `/src/lib/supabase/server.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

`/dashboard`에 첫 업로드 화면을 만든다. 실제 월별 대시보드(스냅샷·탐지·요약)는 결제 phase 뒤의 대시보드 phase에서 플랜 게이팅과 함께 만든다. 이번 step의 화면은 두 가지다.

- **거래 없음**: 온보딩(3단계 · 현대카드 가이드 · 데이터 고지) + 업로드 패널.
- **거래 있음**: 저장 현황 한 줄("거래 N건 · 반영 기간 …") + "새 이용내역 추가" 업로드 패널. 여기에 차트·합계·카테고리를 그리지 않는다.

이번 phase는 현대카드 명세서 "이용 내역" PDF만 읽는다. 다른 카드사는 가이드 대신 "다른 카드사 이용내역은 준비 중이에요" 한 줄만 둔다. 처음 보는 형식의 매핑 확인("확인 필요" 상태, "열 확인하기")은 만들지 않는다.

여정 단계 · 질문 · 다음 단계(UX_GUIDE 프로 팁 1): 활성화 · "어디서 받지? 제대로 읽히나?" · 파일 선택 → 카드 고르기 → 올리기.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts(x)`).

## 작업

### 1. 에러 문구 `src/lib/errors/messages.ts`에 추가
```ts
export function uploadErrorMessage(code: ApiErrorCode, reason?: string): string
```
아래 문구를 그대로 쓴다(해요체, 느낌표 없음). 모르는 reason은 코드 기본 문구.

| code · reason | 문구 |
|---|---|
| `FILE_TOO_LARGE` | 파일이 4MB를 넘어요. 기간을 나눠서 받아 주세요. |
| `UNSUPPORTED_FILE` · `not_pdf` | 지금은 현대카드 이용 내역 PDF만 읽을 수 있어요. |
| `UNSUPPORTED_FILE` · `empty_file` | 빈 파일이에요. 이용내역을 다시 받아 주세요. |
| `UNSUPPORTED_FILE` · `encrypted` | 암호가 걸린 PDF는 읽을 수 없어요. 암호 없이 다시 저장해 주세요. |
| `UNSUPPORTED_FILE` · `too_many_pages` | 100쪽이 넘는 PDF는 읽을 수 없어요. 기간을 나눠서 받아 주세요. |
| `UNSUPPORTED_FILE` · `no_text` | 글자를 읽을 수 없는 PDF예요. 앱이나 웹에서 PDF로 저장한 파일을 올려 주세요. |
| `UNSUPPORTED_FILE` · `unknown_format`(기본) | 현대카드 명세서의 "이용 내역" 화면을 PDF로 저장한 파일인지 확인해 주세요. |
| `UNREADABLE` · `total_mismatch` | 명세서 금액과 거래 합계가 맞지 않아 저장하지 않았어요. |
| `UNREADABLE` · `not_lump_sum` | 할부처럼 일시불이 아닌 거래가 있어 저장하지 않았어요. 지금은 일시불 거래만 읽을 수 있어요. |
| `UNREADABLE` · `cancel_label` | 취소 표시가 있는 거래가 있어 저장하지 않았어요. |
| `UNREADABLE` · `no_transactions` | 저장할 거래가 없는 파일이에요. |
| `UNREADABLE` · `too_many_rows` | 거래가 5,000건을 넘어요. 기간을 나눠서 받아 주세요. |
| `UNREADABLE` · `broken_layout`(기본) | 파일의 줄 배치를 읽지 못했어요. 이용 내역을 최근순으로 두고 다시 저장해 주세요. |
| `CARD_NOT_FOUND` | 카드를 찾을 수 없어요. 카드를 다시 골라 주세요. |
| `CARD_SCOPE_MISMATCH` | 이 카드에 올렸던 파일과 형식이 달라요. 다른 카드를 골라 주세요. |
| `RATE_LIMITED` | 최근 24시간 동안 올릴 수 있는 30개를 모두 썼어요. 시간이 지난 뒤 다시 올려 주세요. |
| `BUSY` | 다른 파일을 처리하고 있어요. 잠시 후 다시 시도해 주세요. |
| `TEMPORARY_FAILURE` | 처리를 마치지 못했어요. 잠시 후 다시 시도해 주세요. |
| `UNAUTHORIZED` | 로그인이 만료됐어요. 다시 로그인해 주세요. |
| `INVALID_LABEL` | 카드 이름은 1~30자로 입력해 주세요. |
| `DUPLICATE_LABEL` | 같은 이름의 카드가 있어요. 목록에서 골라 주세요. |
| `UPLOAD_PROCESSING` | 아직 처리 중이에요. 잠시 후 다시 시도해 주세요. |
| `BAD_REQUEST` · `FORBIDDEN` · `NOT_FOUND` | 요청을 처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요. |

- 브라우저 검사에서 빠진 파일도 같은 문구를 쓴다(확장자 → `UNSUPPORTED_FILE`·`not_pdf`, 4MB 초과 → `FILE_TOO_LARGE`).
- 네트워크 오류·JSON이 아닌 응답·알 수 없는 code는 `TEMPORARY_FAILURE`로 본다.

### 2. 온보딩 `src/components/upload/onboarding.tsx` (Server Component, props 없음 또는 고정 문구만)
- 제목 `h1` "카드 이용내역을 올려 주세요", 아래 한 줄 "최근 3개월치 카드 이용내역을 올리면 정기결제와 확인할 지출을 찾아드려요".
- 3단계 목록(`ol`): ① 카드사에서 이용내역 받기 — "청구서 말고 이용내역(승인내역)"을 `font-semibold`로. 그 아래 `<details id="guide-hyundai">`(summary "현대카드 이용내역 받는 법"): "앱이나 웹의 명세서에서 '이용 내역'을 최근순으로 두고 PDF로 저장해 주세요." / "할부나 취소 표시가 있는 명세서는 아직 읽지 못해요." 그리고 `text-sm text-body`로 "다른 카드사 이용내역은 준비 중이에요". ② 파일마다 카드 고르기 — "같은 카드는 같은 이름으로 골라 주세요. 카드번호는 받지 않아요." ③ 올리기.
- 다른 화면 요소(차트·0원 카드)를 그리지 않는다(UX "빈 대시보드의 목표는 첫 파일 하나").

### 3. 데이터 고지 `src/components/upload/data-notice.tsx`
- `text-caption text-body` 두 줄, 파일 선택 버튼 바로 아래(근접성): "분석을 위해 가맹점명과 집계 결과가 AI 서비스로 전송됩니다." / "원본 파일은 암호화해 보관하고, 거래는 이용일 기준 12개월 뒤 삭제됩니다." 접거나 숨기지 않는다. 설정 화면도 나중에 이 컴포넌트를 쓴다.

### 4. 업로드 패널 `src/components/upload/upload-panel.tsx` (`'use client'`)
```ts
export function UploadPanel(props: { cards: CardOption[] }): React.JSX.Element
```
- **파일 선택**: 라벨이 붙은 `<input type="file" multiple accept=".pdf,application/pdf">`(접근 가능한 이름 "파일 선택", 키보드로 열 수 있어야 함). 행이 없으면 "파일 선택"이 Primary, 행이 있으면 "올리기"가 Primary이고 파일 선택(이름 "파일 추가")은 Secondary. 아래 caption: "원본 파일은 암호화해 보관해요", "파일당 4MB · 최근 24시간 30개 · 동시에 2개씩 처리해요", "여러 카드가 섞인 파일은 카드별로 다시 받아 주세요", "기간이 겹쳐도 같은 거래는 한 번만 반영돼요". 그다음 `DataNotice`.
- **브라우저 검사**: 확장자 `.pdf`(대소문자 무시)가 아니거나 4,194,304바이트를 넘는 파일은 행에 실패 사유를 붙이고 올리지 않는다. 나머지는 "대기" 행.
- **업로드 상태 행**(DESIGN "업로드 상태 행", 목록 행 스타일): 파일명(말줄임) · 카드 · 상태(대기 / 올리는 중 / 분석 중 / 완료 / 실패) · 결과 한 줄. 완료 `text-primary`, 실패 `text-danger` + 원인 + 다음 행동.
  - 대기 행: 행 안 select(`h-9 rounded-lg px-3 text-sm`, 접근 가능한 이름 "카드")에 "카드 선택" · 기존 카드 라벨 · "새 카드 추가". "새 카드 추가"를 고르면 그 행에 입력 필드(placeholder "예: 신한 생활비", 최대 30자)와 작은 버튼 "추가"가 나온다. `POST /api/cards`(JSON) → 201이면 모든 행의 목록에 추가하고 그 행에서 선택, 실패면 그 행에 `uploadErrorMessage` 문구. 카드는 자동으로 고르지 않는다(카드가 한 장이어도). 대기 행에는 작은 Secondary "빼기".
  - "올리기"는 대기 행이 모두 카드를 골랐을 때만 누를 수 있다. 아니면 비활성화하고 caption "카드를 고르지 않은 파일이 N개 있어요".
  - 처리: 대기 행을 순서대로 최대 2개씩 동시에 보낸다. 요청은 `src/components/upload/send-upload.ts`의 `sendUpload(form: FormData, onSent: () => void): Promise<{ status: number; body: unknown }>`(XMLHttpRequest, `xhr.upload`의 `load` 때 `onSent` 호출, 네트워크 오류는 `status: 0`)로 보낸다. 보내기 시작하면 "올리는 중", `onSent` 뒤 "분석 중".
  - 결과 한 줄(`UploadResultDto`):
    - `done`: "`{inserted}`건 · `{formatPeriod}` · 지출 `{formatWon(netAmount)}`"에 0이 아닐 때만 " · 중복 `{duplicates}`건", " · 제외 `{skipped}`건". 옆에 작은 Secondary "틀렸어요".
    - `no_new`: "이미 올린 내역이에요"에 `skipped`가 0이 아니면 " · 12개월이 지난 거래 `{skipped}`건 제외".
    - `duplicate`: "이미 올린 내역이에요". `existingCardLabel`이 있고 이 행의 카드 라벨과 다르면 다음 줄에 "'`{label}`' 카드로 올렸던 파일이에요. 카드를 잘못 지정했다면 기존 업로드를 삭제하고 다시 올려 주세요".
  - 실패 행의 다음 행동: `TEMPORARY_FAILURE`·`BUSY`·네트워크 오류 → 작은 버튼 "다시 시도"(같은 파일·카드로 다시 대기열에), `CARD_NOT_FOUND`·`CARD_SCOPE_MISMATCH` → "카드 다시 고르기"(대기 행으로 되돌리고 카드 선택을 비움), `FILE_TOO_LARGE`·`UNSUPPORTED_FILE`·`UNREADABLE` → "가이드 열기"(`#guide-hyundai` `<details>`를 열고 그 summary로 포커스·스크롤, 없으면 버튼을 그리지 않음), `UNAUTHORIZED` → `/login?next=%2Fdashboard` 링크 "다시 로그인". 그 밖에는 버튼 없음.
  - 처리 중인 행이 없어지는 시점에 이번 묶음에서 `done`이 하나라도 있었으면 `router.refresh()`를 한 번 부른다(UX "결과 보기 버튼을 찾게 하지 않는다").
- **틀렸어요 확인 모달**(DESIGN "모달", UX 원칙 4·5): 제목 "이 업로드를 삭제할까요?", 본문 "이 파일로 처음 저장된 거래 `{inserted}`건을 지워요. 다른 파일과 겹쳐서 제외됐던 거래는 되살아나지 않으니, 필요하면 그 파일을 다시 올려 주세요." 버튼은 Destructive "삭제"와 Secondary "취소"만(Primary 없음). `role="dialog"`·`aria-modal`·제목 연결, 열리면 패널 안으로 포커스, Esc·취소로 닫히고 연 버튼으로 포커스 복귀. 오버레이 `bg-surface-dark/40`(blur 금지).
  - "삭제" → `DELETE /api/uploads/{uploadId}` → 200이면 행 상태를 "삭제했어요"(`text-body`)로 바꾸고 `router.refresh()`. 실패면 모달 안에 `uploadErrorMessage` 문구(`role="alert"`)를 보이고 다시 누를 수 있게 둔다. 처리 중에는 버튼 비활성화.
- **알림**: `aria-live="polite"` 영역 하나에 상태 변화를 짧게 알린다(예: "`{파일명}` 완료"). 파일별 에러는 그 행에 붙인다.
- 버튼은 `buttonClass`로만 만들고(Destructive는 DESIGN의 클래스), 행 안 작은 버튼 사이는 8px 이상 띄운다. 375px 폭에서 가로 스크롤이 없어야 한다(행은 줄바꿈).

### 5. 대시보드 페이지 `src/app/dashboard/page.tsx`
- `await requireUser("/dashboard")` 뒤 `createSupabaseServerClient()`로 `listCards`·`getTransactionCoverage`(사용자 세션, RLS). 기존 헤더(워드마크·로그아웃)는 유지한다.
- `count === 0`: `<Onboarding />` + `<UploadPanel cards={cards} />`(온보딩 ③ 위치).
- `count > 0`: `h1` "올린 이용내역", 바로 아래 "거래 `{count}`건 · 반영 기간 `{formatPeriod({from, to})}`"(숫자 옆 근거, UX 원칙 4)와 caption "월별 대시보드는 준비하고 있어요". 그 아래 섹션 제목 "새 이용내역 추가" + 접힌 현대카드 가이드(`<details id="guide-hyundai">`, 온보딩과 같은 문구 — 가이드 블록을 별도 컴포넌트로 빼서 함께 쓴다) + `<UploadPanel cards={cards} />`.
- 컴포넌트에는 DTO(`CardOption[]`, 숫자·날짜 문자열)만 넘긴다. Supabase 클라이언트·user id를 클라이언트 컴포넌트에 넘기지 않는다.

### 6. 테스트 (먼저 작성, Testing Library, 네트워크 없음)
- `messages.test.ts`: 모든 `ApiErrorCode`에 문구가 있다. 표의 reason별 문구, 모르는 reason → 기본 문구. 금지 문구("지금 바로", "놓치지 마세요", 느낌표)가 없다.
- `onboarding.test.tsx`: 제목·3단계·`font-semibold` 강조·`#guide-hyundai` details·"다른 카드사 이용내역은 준비 중이에요"·고지 두 문장.
- `upload-panel.test.tsx`(`sendUpload`·`fetch`·`next/navigation`의 `useRouter`를 mock):
  - `.csv`·4MB 초과 파일은 사유가 붙고 올리지 않음. "파일 선택" 버튼 이름, 행이 생기면 "올리기"가 Primary.
  - 카드를 고르기 전에는 "올리기" 비활성화와 caption, 카드 한 장이어도 자동 선택 없음.
  - 새 카드: `POST /api/cards`에 `{"label":"신한 생활비"}`·`Content-Type: application/json`, 201 → 다른 행 select에도 옵션이 생김, 409 → `DUPLICATE_LABEL` 문구.
  - 파일 3개 업로드 → 동시에 진행 중인 `sendUpload`가 2개를 넘지 않음, `onSent` 전후 "올리는 중"→"분석 중", FormData에 `cardId`·`file`.
  - 결과 한 줄: done(중복·제외 0이면 생략), no_new(+제외), duplicate(다른 라벨이면 안내 줄).
  - 실패 행동: 503 → "다시 시도"가 같은 파일을 다시 보냄, 422 `UNREADABLE`·`total_mismatch` → 문구와 "가이드 열기", 404 `CARD_NOT_FOUND` → "카드 다시 고르기", `status: 0` → `TEMPORARY_FAILURE` 문구.
  - 모든 행이 끝나고 done이 있으면 `router.refresh` 1회, done이 없으면 0회.
  - 틀렸어요: 모달이 열리면 포커스가 모달 안, Esc로 닫히면 "틀렸어요"로 포커스 복귀, Primary 버튼 없음, "삭제" → `DELETE /api/uploads/<id>` → "삭제했어요"와 `router.refresh`, 실패 → `role="alert"` 문구.
  - `aria-live="polite"` 영역이 있다.
- `src/app/dashboard/page.test.tsx`: `requireUser`·queries·server client mock. 거래 0 → 온보딩·패널, 거래 있음 → 현황 한 줄(`formatPeriod`)·"새 이용내역 추가"·패널, `listCards` 결과가 패널 props로 전달. 기존 단언(로그아웃 폼 등)은 유지·갱신.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
node scripts/check-pdf-trace.mjs   # build 뒤 실행. 번들 설정 회귀 없음
npm run test      # 새 컴포넌트 테스트 포함 전체 통과
npm run test:db   # 기존 DB 통합 테스트 회귀 없음
test -f src/components/upload/upload-panel.tsx && test -f src/components/upload/onboarding.tsx && test -f src/components/upload/send-upload.ts
! grep -rn "dangerouslySetInnerHTML" src/components/upload src/app/dashboard
! grep -rnE "@/lib/(store|queries|supabase|ingest)|@/services" src/components/upload
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `components/`는 DTO만 받는가? 클라이언트 컴포넌트가 서버 모듈(store·queries·supabase·services)을 import하지 않는가?
   - 사용자에게 보이는 에러 문구가 `lib/errors/messages.ts` 한 곳에서 오는가?
   - 파일명·가맹점명을 텍스트로만 렌더링하는가?
   - UX_GUIDE "화면 체크리스트"(다음 단계 하나, 빈·처리 중·에러·완료 상태, 에러에 다음 행동, `aria-live`, 키보드 진행, 금지 문구·용어표)를 지키는가?
3. 결과에 따라 `phases/7-upload-flow/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 컴포넌트 경로와 props, `sendUpload` 시그니처, `uploadErrorMessage`, 대시보드 두 상태를 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 월별 스냅샷·차트·합계 카드·탐지·요약·업그레이드 진입점을 대시보드에 그리지 마라. 이유: 플랜 게이팅(`buildDashboard` DTO 유니온)과 함께 대시보드 phase에서 만든다(CLAUDE.md CRITICAL).
- 매핑 확인 화면, csv·xlsx 선택, 다른 카드사 가이드를 만들지 마라. 이유: 폴백 매핑 phase 범위이고, 지금 받으면 실패만 늘어난다.
- 카드를 자동으로 고르지 마라. 이유: 잘못 지정하면 삭제 후 다시 올려야 한다(UX_GUIDE 활성화).
- 브라우저용 Supabase 클라이언트를 만들거나 클라이언트에서 Supabase를 직접 부르지 마라. 이유: ADR-021.
- 업로드 요청에 user id·저장 경로를 넣지 마라. 이유: 서버가 세션에서만 정한다.
- `dangerouslySetInnerHTML`을 쓰지 마라. 이유: 파일명·카드 라벨은 사용자 입력이다(CLAUDE.md).
- 업로드 상태를 전역 상태 라이브러리·localStorage에 두지 마라. 이유: 업로드 진행 상태만 클라이언트 state로 둔다(ARCHITECTURE "패턴").
- 새 npm 패키지를 추가하지 마라.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
