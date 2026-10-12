import { existsSync } from "node:fs";

// loadEnvFile는 이미 있는 값을 덮어쓰지 않으므로 local과 실행 환경이 우선한다.
for (const path of [".env.local", ".env"]) {
  if (existsSync(path)) process.loadEnvFile(path);
}
