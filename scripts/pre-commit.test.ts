import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// .githooks/pre-commit을 임시 git 저장소에 복사하고, scripts/review-code.sh를 가짜로 바꿔 커밋 허용·거부만 확인한다.
const hook = fileURLToPath(new URL("../.githooks/pre-commit", import.meta.url));

let dir = "";
let fakePhase: ChildProcess | undefined;
const git = (...args: string[]) =>
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pre-commit-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, ".githooks"));
  copyFileSync(hook, join(dir, ".githooks/pre-commit"));
  chmodSync(join(dir, ".githooks/pre-commit"), 0o755);
  mkdirSync(join(dir, "scripts"));
  git("config", "core.hooksPath", ".githooks");
});
afterEach(() => {
  fakePhase?.kill();
  fakePhase = undefined;
  rmSync(dir, { recursive: true, force: true });
});

// 가짜 드라이버: 불렸다는 표시를 남기고 code로 끝난다.
function driver(code: number) {
  writeFileSync(join(dir, "scripts/review-code.sh"), `#!/usr/bin/env bash\necho "$@" > called.txt\necho 리뷰결과\nexit ${code}\n`);
  chmodSync(join(dir, "scripts/review-code.sh"), 0o755);
}

function commit(files: Record<string, string>) {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
    git("add", path);
  }
  const r = git("commit", "-q", "-m", "x");
  return { ...r, called: existsSync(join(dir, "called.txt")) };
}

describe("pre-commit 훅", () => {
  it("docs/·phases/·*.md만 바뀌면 드라이버를 부르지 않고 커밋한다", () => {
    driver(1);
    const r = commit({ "docs/A.md": "a", "phases/x/index.json": "{}", "README.md": "r" });
    expect(r.status).toBe(0);
    expect(r.called).toBe(false);
  });

  it("코드가 바뀌면 staged 모드로 드라이버를 부르고, 0이면 커밋한다", () => {
    driver(0);
    const r = commit({ "src/a.ts": "a", "docs/A.md": "a" });
    expect(r.status).toBe(0);
    expect(r.called).toBe(true);
    expect(git("log", "--oneline").stdout).not.toBe("");
  });

  it("드라이버가 1(major 이상)이면 커밋을 막는다", () => {
    driver(1);
    const r = commit({ "src/a.ts": "a" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--no-verify");
    expect(git("log", "--oneline").status).not.toBe(0);
  });

  it("드라이버가 2(리뷰 실패)면 경고만 하고 커밋한다", () => {
    driver(2);
    const r = commit({ "src/a.ts": "a" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("리뷰를 끝내지 못해");
  });

  it("scripts/execute.py가 실행 중이면 드라이버를 부르지 않는다", async () => {
    driver(1);
    fakePhase = spawn("node", ["-e", "setTimeout(() => {}, 10000)", "scripts/execute.py"], { stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const r = commit({ "src/a.ts": "a" });
    expect(r.status).toBe(0);
    expect(r.called).toBe(false);
  });
});
