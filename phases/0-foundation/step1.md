# Step 1: env-mode

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/AGENTS.md`
- `/docs/ARCHITECTURE.md` ("모드 · 환경", "보안" 절)
- `/docs/ADR.md` (ADR-014)
- `/.env.example`
- 이전 step에서 만든 파일: `/package.json`, `/tsconfig.json`, `/next.config.ts`, `/vitest.config.ts`와 Vitest 관련 설정 파일

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

## 작업

mock/live 판단(`getMode`)과 사이트 Origin(`getSiteOrigin`)을 정하는 모듈을 만든다. `getMode()`는 mock/live를 판단하는 **유일한** 지점이다. `lib/origin.ts`는 이후 Origin 검사(CSRF)와 OAuth 복귀 URL이 함께 쓰는 사이트 Origin의 단일 출처다.

구현 파일보다 테스트 파일을 먼저 만든다. 이유: TDD guard hook이 같은 폴더에 테스트 파일이 없는 구현 파일 작성을 막는다.

### 0. 패키지와 테스트 설정
- `zod`, `server-only`를 설치한다.
- Vitest에서 `import 'server-only'`가 들어 있는 모듈을 import할 수 있게 설정한다(예: 테스트에서만 빈 모듈로 alias). 앱 빌드에서는 `server-only`가 원래대로 동작해야 한다.

### 1. `src/lib/env.ts`
```ts
import 'server-only'

export type DeploymentEnv = {
  vercelEnv: 'production' | 'preview' | 'development' | undefined // VERCEL_ENV
  vercelUrl: string | undefined                                     // VERCEL_URL (호스트만, 스킴 없음)
  siteUrl: string | undefined                                       // NEXT_PUBLIC_SITE_URL
  appMode: 'mock' | 'live' | undefined                              // APP_MODE
}

export function getDeploymentEnv(): DeploymentEnv
```
- 호출할 때마다 `process.env`에서 읽고 zod로 검증한다(lazy).
- 빈 문자열은 `undefined`로 취급한다. 이유: `.env.example`처럼 `KEY=` 형태로 비워 둔 변수가 흔하다.
- 허용되지 않은 `VERCEL_ENV`·`APP_MODE` 값, URL이 아닌 `NEXT_PUBLIC_SITE_URL`은 throw한다. 에러 메시지에는 **변수 이름만** 넣는다.

### 2. `src/lib/mode.ts`
```ts
export type Mode = 'mock' | 'live'
export function getMode(): Mode
```
| `VERCEL_ENV` | 결과 |
|---|---|
| `production` | 항상 `live` (`APP_MODE` 무시) |
| `preview` | 항상 `mock` (`APP_MODE` 무시) |
| 없음 · `development` | `APP_MODE`, 없으면 `mock` |

### 3. `src/lib/origin.ts`
```ts
export function getSiteOrigin(): string
export function isAllowedOrigin(origin: string | null): boolean
```
- `getSiteOrigin()`:
  | `VERCEL_ENV` | 결과 |
  |---|---|
  | `production` | `NEXT_PUBLIC_SITE_URL` 필수, `https:`만 허용. 없거나 http면 throw |
  | `preview` | `https://${VERCEL_URL}`. `VERCEL_URL`이 없으면 throw |
  | 없음 · `development` | `NEXT_PUBLIC_SITE_URL`, 없으면 `http://localhost:3000` |
- 반환값은 항상 `new URL(...).origin` 형태다(경로·끝 슬래시 없음).
- `isAllowedOrigin(origin)`은 `origin === getSiteOrigin()`일 때만 `true`다. `null`, 문자열 `"null"`은 `false`다.

### 4. 테스트 (`src/lib/env.test.ts`, `src/lib/mode.test.ts`, `src/lib/origin.test.ts`)
- 각 테스트에서 `VERCEL_ENV`, `VERCEL_URL`, `NEXT_PUBLIC_SITE_URL`, `APP_MODE`를 모두 명시적으로 설정하거나 지우고, 테스트가 끝나면 원래대로 되돌린다(`vi.stubEnv` / `vi.unstubAllEnvs`). 이유: 셸이나 `.env` 값에 따라 결과가 달라지면 안 된다.
- 최소한 아래 경우를 단언한다.
  - `getMode`: production + `APP_MODE=mock` → `live` · preview + `APP_MODE=live` → `mock` · 로컬 기본 → `mock` · 로컬 `APP_MODE=live` → `live` · `VERCEL_ENV=development` + `APP_MODE=live` → `live`
  - `APP_MODE=abc` → throw. 에러 메시지에 `APP_MODE`는 있고 `abc`는 없다.
  - `getSiteOrigin`: production `https://assetomy.example/path/` → `https://assetomy.example` · production에 값 없음 → throw · production `http://...` → throw · preview `VERCEL_URL=x.vercel.app` → `https://x.vercel.app` · preview에 `VERCEL_URL` 없음 → throw · 로컬 기본 → `http://localhost:3000` · 로컬 `NEXT_PUBLIC_SITE_URL=http://localhost:3001` → `http://localhost:3001`
  - `isAllowedOrigin`: 정확히 같은 Origin → `true`. 끝 슬래시 추가, 스킴·포트 차이, 서브도메인, `https://assetomy.example.evil.com`, `null`, `"null"` → `false`
  - 관련 env를 모두 지운 상태에서 세 모듈을 새로 import해도(`vi.resetModules` 후 dynamic import) throw하지 않는다. 이유: 빌드 시 env가 없어도 import는 성공해야 한다.

## Acceptance Criteria

```bash
npm run lint      # 에러 없음
npm run build     # 컴파일 에러 없음
npm run test      # 전체 단위 테스트 통과
npx vitest run src/lib/env.test.ts src/lib/mode.test.ts src/lib/origin.test.ts
grep -qE "import ['\"]server-only['\"]" src/lib/env.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/lib/env.ts` · `mode.ts` · `origin.ts`)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md(AGENTS.md) CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-foundation/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`. summary에는 export한 함수 이름과 Vitest의 `server-only` 처리 방식을 담는다.
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 모듈 최상위에서 `process.env`를 읽거나 zod로 parse하지 마라. 이유: 빌드할 때 env가 없으면 import만으로 throw한다.
- `process.env.NODE_ENV`로 mock/live를 판단하지 마라. 이유: 로컬에서 `next start`를 하면 `NODE_ENV`가 production이지만 `APP_MODE`를 따라야 한다. 판단은 `VERCEL_ENV` 기준이다.
- `getMode()` 말고 mock/live를 판단하는 함수를 따로 만들지 마라. 이유: 판단 지점이 하나여야 Production이 mock이 될 수 없다는 보장이 유지된다.
- Origin을 prefix·`endsWith`·`includes`·정규식으로 비교하지 마라. 이유: `https://<사이트>.evil.com` 같은 주소로 우회된다.
- 허용 Origin 목록에 `VERCEL_BRANCH_URL`이나, production에서 `localhost`를 추가하지 마라. 이유: 허용 Origin은 환경마다 정확히 하나다.
- 에러 메시지나 로그에 env 값을 넣지 마라. 이유: 이후 같은 모듈에 비밀값 getter가 추가된다.
- Supabase·Anthropic·Polar·`CRON_SECRET`·`FILE_ENCRYPTION_KEY` getter를 미리 만들지 마라. 이유: 그 변수를 쓰는 phase에서 테스트와 함께 추가한다.
- `.env.example`을 수정하지 마라.
- 기존 테스트를 깨뜨리지 마라
