# Step 0: merchant-classifier

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("디렉토리 구조", "레이어 규칙", "모드 · 환경", "보안"의 LLM 항목)
- `/docs/ADR.md` (ADR-005, ADR-014, ADR-017)
- `/docs/PRD.md` ("카테고리")
- 기존 코드: `/src/types/category.ts`(`CATEGORY_IDS`·`CATEGORY_LABELS`), `/src/lib/env.ts`와 `/src/lib/env.test.ts`(lazy 검증·`vi.stubEnv` 패턴), `/src/lib/mode.ts`, `/src/lib/parsing/normalize.ts`(`normalizeMerchantKey`)
- 설치 후: `/node_modules/@anthropic-ai/sdk`의 `messages.parse`, `helpers/zod`(`zodOutputFormat`), 에러 클래스(`Anthropic.APIError` 등), 클라이언트 옵션(`timeout`·`maxRetries`) 타입 정의

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 배경

업로드한 거래의 카테고리는 사용자 수정값 → 기존 거래의 같은 가맹점 → Claude 분류 순서로 정한다(ADR-017). 이 step은 마지막 단계인 **가맹점 분류기**만 만든다. 앞의 두 단계(조회)와 업로드 처리는 다음 step들이 만든다.

- live 모드: `claude-haiku-5-5`가 가맹점명만 보고 고정 14개 카테고리 중 하나를 고른다. 200개씩 나눠 동시 3개까지 보낸다. 실패·누락·잘못된 값은 `'etc'`로 두고 업로드는 계속한다(ADR-005).
- mock 모드(로컬 기본·Preview): API 키 없이 키워드 규칙으로 분류한다(ADR-014). mock은 테스트 fake로도 쓴다.
- 외부 서비스는 `src/services/`에 인터페이스 뒤에 두고 `import 'server-only'`를 붙인다.

구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook: 같은 폴더의 `*.test.ts`).

## 작업

### 1. 패키지
- `npm install @anthropic-ai/sdk`(최신). 다른 패키지는 추가하지 않는다. zod는 이미 있는 v4를 쓴다.

### 2. env
- `src/lib/env.ts`에 `export function getAnthropicApiKey(): string` — `ANTHROPIC_API_KEY`가 비어 있지 않은 문자열이어야 한다. 실패하면 `new Error("ANTHROPIC_API_KEY")`(변수 이름만)를 던진다. 다른 env 함수처럼 호출할 때만 검증한다(모듈 로드 시 검증 금지).

### 3. 인터페이스 `src/services/llm/types.ts`
```ts
export type MerchantInput = { merchantKey: string; merchant: string };
export interface MerchantClassifier {
  // 입력의 모든 merchantKey에 대해 카테고리를 돌려준다. 분류하지 못한 키는 'etc'.
  classify(merchants: MerchantInput[]): Promise<Map<string, CategoryId>>;
}
```
- `classify`는 던지지 않는다. 어떤 실패든 해당 키를 `'etc'`로 채워 돌려준다.
- 입력에 같은 `merchantKey`가 여러 번 있으면 한 번만 분류한다(첫 번째 `merchant`를 쓴다). 빈 입력이면 외부 호출 없이 빈 Map.

### 4. mock 분류기 `src/services/llm/mock-classifier.ts`
```ts
export function createMockClassifier(): MerchantClassifier
```
- `merchantKey`(이미 NFKC·대문자 정규화됨)에 키워드가 들어 있으면 그 카테고리, 없으면 `'etc'`. 규칙 목록은 코드 안의 배열(키워드 → 카테고리)로 두고, 먼저 맞은 규칙을 쓴다.
- 최소 규칙(테스트로 고정): `스타벅스`·`커피`·`카페` → `cafe`, `배달의민족`·`쿠팡이츠`·`요기요` → `delivery`, `택시`·`지하철`·`버스`·`코레일` → `transport`, `이마트`·`홈플러스`·`롯데마트`·`GS25`·`CU`·`세븐일레븐` → `grocery`, `넷플릭스`·`NETFLIX`·`유튜브`·`YOUTUBE`·`SPOTIFY` → `subscription`, `쿠팡`·`무신사` → `shopping`, `병원`·`약국`·`의원` → `health`, `CGV`·`메가박스` → `culture`, `호텔`·`항공` → `travel`, `통신`·`관리비` → `housing`, `보험` → `finance`, `학원` → `education`, `식당`·`김밥` → `food`. `쿠팡이츠`가 `쿠팡`보다 먼저 맞도록 순서를 정한다.
- 외부 호출·env·`Date.now()`를 쓰지 않는다.

### 5. Haiku 분류기 `src/services/llm/haiku-classifier.ts`
```ts
export const CLASSIFIER_MODEL = "claude-haiku-5-5";
export const CLASSIFY_BATCH_SIZE = 200;
export const CLASSIFY_CONCURRENCY = 3;
export function createHaikuClassifier(client: Pick<Anthropic, "messages">): MerchantClassifier
```
- 고유 키를 200개씩 나누고, 동시에 최대 3개 요청만 진행한다(새 패키지 없이 간단한 작업 큐로).
- 요청: `client.messages.parse({ model: CLASSIFIER_MODEL, max_tokens: 16000, output_config: { effort: "low", format: zodOutputFormat(schema) }, system, messages })`.
  - 응답 스키마(zod): `{ results: Array<{ index: number(int); category: enum(CATEGORY_IDS) }> }`. `index`는 그 배치 안의 0부터 시작하는 번호다. 가맹점명을 응답으로 되받지 않는다(이름 비교 오류를 피함).
  - `system`: 한국 신용카드 가맹점명을 14개 카테고리 중 하나로 분류하라는 지시와 카테고리 id·한국어 이름 목록(`CATEGORY_LABELS`), 모르면 `etc`. 고정 문자열로 둔다(요청마다 바뀌는 값을 넣지 않는다).
  - `messages`: user 한 개. 내용은 `index`와 가맹점 표시명(`merchant`) 목록뿐이다(예: 줄마다 `0\t스타벅스 강남점`).
  - SDK의 `zodOutputFormat`이 프로젝트의 zod v4와 맞지 않으면 `messages.create`에 `output_config.format`으로 JSON 스키마를 직접 넘기고 응답 텍스트를 같은 zod 스키마로 검증한다. 어느 쪽이든 응답은 코드로 검증한다.
- 결과 처리: 범위 밖·중복 `index`, 스키마에 맞지 않는 응답, `parsed_output`이 없거나 `stop_reason`이 `refusal`·`max_tokens`인 응답은 버린다. 버려지거나 빠진 키, 요청이 실패한 배치의 키는 모두 `'etc'`.
- 에러 처리: 배치 하나의 실패가 다른 배치에 영향을 주지 않는다. 로그를 남긴다면 `llm:classify:<HTTP status 또는 에러 클래스 이름>` 형식만 쓴다.

### 6. 선택 함수 `src/services/llm/index.ts`
```ts
export function getMerchantClassifier(): MerchantClassifier
```
- `getMode()`가 `mock`이면 `createMockClassifier()`. `live`면 `new Anthropic({ apiKey: getAnthropicApiKey(), timeout: 30_000, maxRetries: 1 })`로 `createHaikuClassifier`. live에서 키가 없으면 `getAnthropicApiKey()`의 에러가 그대로 던져진다(설정 오류를 'etc'로 숨기지 않는다).
- `src/services/llm/` 아래 모든 파일은 `import 'server-only'`(타입 전용 파일은 예외 가능).

### 7. 테스트 (먼저 작성)
- `env.test.ts`: `getAnthropicApiKey` 성공 · 누락/빈 값이면 메시지가 정확히 `ANTHROPIC_API_KEY`.
- `mock-classifier.test.ts`: 위 최소 규칙 각각, `쿠팡이츠` → delivery, 모르는 가맹점 → etc, 중복 키 1회, 빈 입력.
- `haiku-classifier.test.ts`: 가짜 client(`{ messages: { parse: vi.fn() } }` 또는 대체 경로라면 `create`)로
  - 450개 고유 가맹점 → 요청 3번(200·200·50), 동시 진행 수가 3을 넘지 않음(지연된 promise로 측정). 1,000개면 요청 5번이고 최대 동시 3.
  - 요청 본문에 `model: "claude-haiku-5-5"`, user 메시지에는 가맹점명과 번호만 있다(금액·날짜·카드 라벨 같은 다른 값이 없음을 입력에 섞어 확인할 수 없으므로, 입력 타입이 `MerchantInput`뿐임과 메시지 문자열이 가맹점명들과 번호로만 이루어졌음을 단언).
  - 정상 응답 → Map 매핑, 범위 밖·중복 index 무시, 잘못된 category → etc, 누락 → etc.
  - 배치 하나가 reject(`new Error("x")`) → 그 배치만 etc, 나머지는 정상. `parsed_output: null`·`stop_reason: "refusal"` → etc.
  - `classify`가 어떤 경우에도 reject하지 않는다.
- `index.test.ts`: `vi.stubEnv`로 mock 모드 → 키 없이 mock 분류기, live 모드 + 키 없음 → `ANTHROPIC_API_KEY` 에러, live + 키 → Haiku 분류기(생성자 `vi.mock`). 실제 네트워크 호출 없음.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 새 단위 테스트 포함 전체 통과(네트워크·API 키 불필요)
node -e "require.resolve('@anthropic-ai/sdk')"
test -f src/services/llm/types.ts && test -f src/services/llm/mock-classifier.ts && test -f src/services/llm/haiku-classifier.ts && test -f src/services/llm/index.ts
grep -q '"claude-haiku-5-5"' src/services/llm/haiku-classifier.ts
! grep -rnE "claude-(opus|sonnet)" src/services/llm --include='*.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/services/llm/`에 `server-only`로 두었는가? `components/`·클라이언트 코드에서 import하지 않는가?
   - LLM에 가맹점명 외의 값(금액·날짜·카드·파일명)을 보내지 않는가? (CLAUDE.md CRITICAL)
   - 분류 결과를 코드로 검증하고, 실패를 'etc'로 바꾸는가?
   - 로그에 가맹점명·LLM 응답 본문·에러 메시지가 없는가?
3. 결과에 따라 `phases/7-upload-flow/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 `MerchantClassifier` 시그니처, 선택 함수, 배치·동시성 상수, mock 규칙 위치, SDK 버전과 structured outputs 사용 방식(parse 또는 create 대체 경로)을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요(패키지 설치 네트워크 실패 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 Anthropic API를 호출하지 마라(테스트 포함). 이유: 단위 테스트는 네트워크·키 없이 돌아야 하고(ADR-015), `.env`에 키가 없다.
- `claude-haiku-5-5` 외 모델을 분류에 쓰지 마라. 이유: 분류는 Haiku로 정했다(ADR-005).
- 가맹점명 외의 값(금액·날짜·카드 라벨·파일명·원본)을 LLM 요청에 넣지 마라. 이유: CLAUDE.md CRITICAL, 국외 이전 범위를 처리방침에 고지한 범위로 제한한다.
- 분류 실패를 throw로 올리지 마라(live 키 누락만 예외). 이유: 분류 장애로 업로드가 실패하면 안 된다(ADR-005).
- LLM 응답 본문·가맹점명·`error.message`를 로그에 남기지 마라. 이유: CLAUDE.md CRITICAL.
- 업로드 처리·조회·API·화면을 만들지 마라. 이유: 다음 step에서 만든다.
- `.env`를 고치거나 그 값을 출력하지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
