# Step 2: pdf-extract

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("디렉토리 구조", "보안" 중 파일 항목, "테스트" 절)
- `/docs/ADR.md` (ADR-007, ADR-015, ADR-019)
- `/src/lib/parsing/__fixtures__/README.md`
- 이전 step 산출물: `/src/types/parsing.ts`, `/src/lib/parsing/pdf-rows.ts`, `/src/lib/parsing/profiles/hyundai-statement-pdf.ts`와 각 테스트
- 기존 설정: `/package.json`, `/vitest.config.ts`(`server-only`는 테스트에서 빈 모듈로 alias), `/next.config.ts`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

PDF 바이트에서 글자 조각과 좌표를 뽑는 서버 모듈과, 추출 → 줄 묶기 → 프로필을 잇는 진입 함수를 만든다. 업로드 라우트·암호화·DB는 upload phase에서 한다. 구현 파일보다 테스트 파일을 먼저 만든다(TDD guard hook).

### 1. 패키지
- `npm install pdfjs-dist@^6.4.299`(dependencies). 다른 PDF 패키지(`unpdf`, `pdf-parse` 등)는 쓰지 않는다. 이유: 서버리스 빌드에는 한글 CID 글꼴용 `cmaps`가 없어 가맹점명이 빠진다(ADR-019).

### 2. `src/lib/pdf/extract.ts` (`import 'server-only'`)
```ts
export const MAX_PDF_PAGES = 100
export type PdfExtraction =
  | { ok: true; items: PdfTextItem[] }
  | Extract<ParseFailure, { code: 'UNSUPPORTED_FILE' }>
export async function extractPdfTextItems(bytes: Uint8Array): Promise<PdfExtraction>
```
- 첫 5바이트가 `%PDF-`가 아니면 pdfjs를 부르지 않고 `not_pdf`.
- `pdfjs-dist/legacy/build/pdf.mjs`의 `getDocument`를 아래 옵션으로 부른다.
  - `data: bytes.slice()` — 복사본을 넘긴다. 이유: pdfjs가 버퍼를 워커로 넘기며 비울 수 있는데, 호출자는 같은 바이트로 해시·암호화를 해야 한다.
  - `cMapUrl`·`standardFontDataUrl`: 설치된 `pdfjs-dist` 패키지 디렉터리(`createRequire(import.meta.url).resolve('pdfjs-dist/package.json')`의 dirname) 아래 `cmaps/`·`standard_fonts/`. 끝에 `/`를 붙인다. `cMapPacked: true`.
  - `isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, `verbosity: 0`. 이유: PDF 안의 코드를 실행하지 않고, 로그에 파일 내용이 남지 않게 한다.
- 로딩 실패: 에러 `name`이 `'PasswordException'`이면 `encrypted`, 그 밖의 로딩 에러(`InvalidPDFException` 등)는 `not_pdf`. 페이지 처리 중 예상 밖 에러는 그대로 throw한다(일시 장애와 구분하는 일은 upload phase에서 한다).
- `numPages > MAX_PDF_PAGES`면 `too_many_pages`(쪽 내용을 읽기 전에 검사).
- 쪽마다 `getTextContent()`의 `str`이 있는 항목을 `{ page, x: transform[4], y: transform[5], str }`로 모은다. `str === ''`인 항목은 버린다.
- 모든 조각이 공백뿐이면 `no_text`(스캔 이미지 PDF).
- 성공·실패와 관계없이 `loadingTask.destroy()`로 정리한다. pdfjs 6에는 `PDFDocumentProxy.destroy()`가 없다.
- Vitest·Next에서 가짜 워커가 `pdf.worker.mjs`를 찾지 못하면 `GlobalWorkerOptions.workerSrc`를 설치 경로의 `legacy/build/pdf.worker.mjs`로 지정한다.
- `console.*`로 아무것도 남기지 마라.

### 3. `src/lib/pdf/read-statement.ts` (`import 'server-only'`)
```ts
export async function readPdfStatement(bytes: Uint8Array): Promise<ParseResult>
```
- `extractPdfTextItems` 실패면 그대로 돌려준다 → `groupPdfRows` → `detectHyundaiStatement`가 false면 `{ ok: false, code: 'UNSUPPORTED_FILE', reason: 'unknown_format' }` → `parseHyundaiStatement` 결과를 돌려준다.

### 4. 테스트
테스트 안에서 최소 PDF를 문자열로 만드는 헬퍼를 둔다(`src/lib/pdf/test-pdf.ts` 같은 테스트 전용 파일이나 테스트 파일 안). 객체: 1 Catalog, 2 Pages(`/Kids`·`/Count`), 3 Font(`/Type1 /Helvetica`), 쪽마다 Page + Contents 스트림(`<< /Length n >> stream … endstream`), 각 객체의 바이트 오프셋으로 만든 `xref`, `trailer << /Size /Root 1 0 R >>`, `startxref`, `%%EOF`. 예: 내용 `BT /F1 12 Tf 72 700 Td (HELLO) Tj 200 0 Td (1,000) Tj ET` → 조각 `HELLO`(x 72, y 700), `' '`, `1,000`(x 272, y 700).
- `src/lib/pdf/extract.test.ts`
  - `'hello'` 바이트 → `not_pdf`. `'%PDF-1.4 garbage'` → `not_pdf`.
  - 위 최소 PDF → `ok: true`, `{ page: 1, x: 72, y: 700, str: 'HELLO' }`와 `str: '1,000'` 조각이 있다. 호출 뒤 입력 `bytes.byteLength`가 그대로다.
  - 내용이 빈 1쪽 PDF → `no_text`.
  - 빈 쪽 101개 PDF → `too_many_pages`.
  - 암호 PDF → `encrypted`. 만드는 법: 위 최소 PDF에 `<< /Filter /Standard /V 1 /R 2 /O <32바이트 hex> /U <32바이트 hex> /P -4 >>` 객체를 추가하고 trailer에 `/Encrypt n 0 R /ID [<16바이트 hex> <16바이트 hex>]`를 넣는다. 빈 비밀번호 검사가 실패해 pdfjs가 `PasswordException`을 던진다.
- `src/lib/pdf/read-statement.test.ts`
  - 위 최소 PDF → `UNSUPPORTED_FILE`/`unknown_format`.
  - 실제 원본 PDF 테스트: `describe.skipIf(!process.env.ASSETOMY_SAMPLE_PDF)`로 감싼다. 환경변수 경로의 파일을 읽어 `readPdfStatement` → `ok: true`, 78건, `statementTotal` 1,820,075. 같은 결과의 `(date, amount)` 순서가 fixture를 `groupPdfRows` → `parseHyundaiStatement`한 결과의 `(date, amount)` 순서와 같다(가맹점명은 fixture가 익명화돼 다르다). 파일 경로·가맹점명을 테스트 출력에 남기지 마라. 원본 파일은 저장소에 넣지 않는다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # extract·read-statement 테스트 포함 전체 통과(원본 PDF 테스트는 환경변수가 없으면 skip)
node -e "require.resolve('pdfjs-dist/package.json')" && test -f node_modules/pdfjs-dist/cmaps/UniKS-UTF16-H.bcmap
grep -qE "^import ['\"]server-only['\"]" src/lib/pdf/extract.ts && grep -qE "^import ['\"]server-only['\"]" src/lib/pdf/read-statement.ts
! grep -rnE "console\.|from ['\"](unpdf|pdf-parse)" src/lib/pdf --include='*.ts'
! grep -rnE "new Date|Date\.(now|parse|UTC)|process\.env|from ['\"](node:|pdfjs)" src/lib/parsing --include='*.ts' --exclude='*.test.ts'
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/pdf/`는 I/O, `src/lib/parsing/`은 순수)
   - ADR 기술 스택을 벗어나지 않았는가? (`pdfjs-dist`만 추가)
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가? (로그에 파일 내용 없음)
3. 결과에 따라 `phases/4-pdf-parsing/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 파일 경로, `extractPdfTextItems`·`readPdfStatement`·`MAX_PDF_PAGES` 시그니처, 설치한 pdfjs-dist 버전, 원본 PDF 테스트 환경변수 이름(`ASSETOMY_SAMPLE_PDF`)을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `next.config.ts`를 바꾸지 마라(`serverExternalPackages`, `outputFileTracingIncludes` 등). 이유: 이 모듈을 쓰는 라우트가 upload phase에서 생기고, 그때 번들에 cmaps가 들어가는지 함께 검증한다.
- 업로드 라우트·암호화·DB·화면을 만들지 마라. upload phase에서 한다.
- `src/lib/parsing/`에서 pdfjs나 `node:` 모듈을 import하지 마라. 이유: 파싱은 순수 레이어이고 PDF I/O는 `src/lib/pdf/`만 한다.
- 실제 카드 내역 PDF나 그 내용을 저장소·테스트 출력·로그에 남기지 마라. 이유: 개인 데이터다.
- 이전 step의 타입·함수 시그니처를 바꾸지 마라.
- `vercel deploy`를 실행하지 마라.
- 기존 테스트를 깨뜨리지 마라
