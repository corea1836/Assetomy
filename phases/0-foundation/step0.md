# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` (디렉토리 구조 · 보안 · 테스트)
- `/docs/ADR.md` (ADR-001, ADR-015)
- `/.gitignore`, `/.vercelignore`, `/.env.example` (이미 있는 파일이다. 덮어쓰지 않는다)
- `/.claude/hooks/tdd-guard.sh`, `/.codex/hooks/stop-check.sh` (이 저장소의 hook 규칙. 같은 폴더에 테스트 파일이 먼저 있어야 `.ts`/`.tsx` 구현 파일을 쓸 수 있고, 턴이 끝날 때마다 `npm run lint && npm run build && npm run test`가 돈다)

저장소에는 아직 앱 코드가 없다. 문서와 하네스 스크립트만 있다.

## 작업

Next.js 16 앱의 **도구 체인만** 구성한다. 화면·도메인 코드는 만들지 않는다.

### 1. `package.json`
- `name: "assetomy"`, `private: true`, `engines: { "node": "24.x" }`
- scripts: `dev`(`next dev`), `build`(`next build`), `start`(`next start`), `lint`(`eslint .`), `test`, `test:db`
- dependencies: `next@16`, `react@19`, `react-dom@19`
- devDependencies: `typescript`, `@types/node`, `@types/react`, `@types/react-dom`, `eslint`, `eslint-config-next`(next와 같은 메이저), `tailwindcss@4`, `@tailwindcss/postcss`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/jest-dom`
- 로컬 Node가 24가 아니어서 npm이 `EBADENGINE` 경고를 내면 무시하고 진행한다. 이유: Vercel은 `engines` 기준으로 Node 24에서 빌드한다.

### 2. `tsconfig.json`
- `compilerOptions.strict: true`, 경로 별칭 `@/*` → `./src/*`, Next.js 플러그인 포함.
- JSON에 주석을 넣지 않는다. 이유: AC가 `jq`로 읽는다.

### 3. `eslint.config.mjs` (flat config)
- `eslint-config-next`의 core-web-vitals와 TypeScript 설정을 쓴다.
- `react/no-danger: "error"`를 추가한다. 이유: 가맹점명·파일명·AI 요약은 텍스트로만 렌더링한다(XSS 방지).
- 무시: `.next/`, `node_modules/`, `next-env.d.ts`, `coverage/`, `phases/`

### 4. `postcss.config.mjs`
- `@tailwindcss/postcss` 플러그인 하나만 쓴다.

### 5. `next.config.ts` — 보안 헤더
테스트를 먼저 쓴다: 루트에 `next.config.test.ts`를 만들고, `next.config.ts`의 default export에서 `headers()`를 호출해 모든 경로(`/:path*`)에 아래 3개가 정확한 값으로 들어 있는지 단언한다.

| 헤더 | 값 |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

`next.config.ts`에는 이 `headers()` 외의 옵션을 넣지 않는다.

### 6. Vitest
설정 파일 구성 방식(파일 수, projects 사용 여부 등)은 재량이다. 다음 결과만 만족하면 된다.
- `npm run test`: `**/*.test.{ts,tsx}` 중 `*.db.test.ts`를 **제외**하고 실행한다. `node_modules/`, `.next/`는 제외한다.
- `.test.ts`는 `node` 환경, `.test.tsx`는 `jsdom` 환경에서 돈다. 파일마다 `@vitest-environment` 주석을 붙이지 않아도 되게 설정으로 나눈다.
- `.test.tsx`에서 `@testing-library/jest-dom` matcher(`toBeInTheDocument` 등)를 타입 에러 없이 쓸 수 있다.
- `npm run test:db`: `**/*.db.test.ts`**만** 실행하고, 그런 파일이 하나도 없어도 exit 0이다. 이유: DB 통합 테스트는 로컬 Supabase(Docker)가 필요해 단위 테스트와 분리한다(ADR-015).
- 테스트 코드에서 `@/` 별칭이 동작한다.

### 7. `src/app` 최소 골격
- `src/app/globals.css`: `@import "tailwindcss";` 한 줄만. 디자인 토큰은 이후 step에서 넣는다.
- `src/app/layout.tsx`: `<html lang="ko">`, `<body>`, `./globals.css` import, `metadata.title = "assetomy"`.
- `src/app/page.tsx`: "assetomy" 텍스트만 있는 placeholder. 랜딩은 이후 phase에서 만든다.

### 8. `.gitignore`
- 기존 내용은 그대로 둔다. 빠진 항목이 있을 때만 추가한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # next.config.test.ts 통과
npm run test:db   # 테스트 파일이 없어도 exit 0
npx eslint --print-config src/app/page.tsx | jq -e '.rules["react/no-danger"][0] | . == 2 or . == "error"'
jq -e '.compilerOptions.strict == true' tsconfig.json
jq -e '.engines.node == "24.x"' package.json
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/app` 아래 App Router)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-foundation/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 다음 step이 알아야 할 것(설치한 next·vitest 버전, Vitest 설정 파일 경로와 node/jsdom 환경을 나눈 방식)을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (패키지 레지스트리 접근 불가 등) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 루트에서 `create-next-app`을 실행하지 마라. 이유: 비어 있지 않은 디렉터리라 실패하거나 `AGENTS.md`·`CLAUDE.md`·`.gitignore` 같은 기존 파일을 덮어쓸 수 있다. 파일은 직접 만든다.
- `AGENTS.md`, `CLAUDE.md`, `docs/`, `scripts/`, `.claude/`, `.codex/`, `.env.example`, `.vercelignore`를 수정하지 마라. 이유: 하네스와 설계 문서이며 이 step의 범위가 아니다.
- 이 step에서 쓰지 않는 패키지(`@supabase/*`, `@anthropic-ai/sdk`, `@polar-sh/*`, `recharts`, `papaparse`, SheetJS, `zod`, `server-only`, `@vercel/analytics`, `pretendard`)를 설치하지 마라. 이유: 실제로 쓰는 step에서 설치해야 그때 버전과 용도를 확인할 수 있다.
- `prefers-color-scheme: dark` 스타일이나 `dark:` 변형을 넣지 마라. 이유: 라이트 모드 고정이다.
- lint 스크립트에 `next lint`를 쓰지 마라. 이유: Next.js 16에서 제거됐다. `eslint .`을 쓴다.
- `src/lib/`, `src/components/` 등 아직 쓰지 않는 디렉터리나 빈 파일을 만들지 마라. 이유: 이후 step이 테스트와 함께 만든다.
- `vercel deploy`를 실행하지 마라. 이유: Preview 배포는 `execute.py --deploy`가 한다.
- 기존 테스트를 깨뜨리지 마라
