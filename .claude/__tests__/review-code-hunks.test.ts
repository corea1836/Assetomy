import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// .claude/skills/review-code/hunks.sh를 임시 git 저장소에서 돌려, PR 인라인 코멘트를 달 수 있는 줄 범위만 나오는지 확인한다.
const script = fileURLToPath(new URL("../skills/review-code/hunks.sh", import.meta.url));
const lines = (from: number, to: number, prefix = "l") =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`).join("\n") + "\n";

let dir = "";
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("review-code hunks.sh", () => {
  it("범위의 새 파일 쪽 hunk를 '경로 시작 끝'으로 출력하고, 삭제만 있는 hunk와 lock 파일은 뺀다", () => {
    dir = mkdtempSync(join(tmpdir(), "review-hunks-"));
    git("init", "-q");
    writeFileSync(join(dir, "a.txt"), lines(1, 30));
    writeFileSync(join(dir, "gone.txt"), lines(1, 3));
    writeFileSync(join(dir, "package-lock.json"), "{}\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");

    writeFileSync(join(dir, "a.txt"), lines(1, 4) + "x5\n" + lines(6, 29) + "x30\n");
    writeFileSync(join(dir, "new.txt"), lines(1, 2));
    writeFileSync(join(dir, "package-lock.json"), "{\"a\":1}\n");
    unlinkSync(join(dir, "gone.txt"));
    git("add", "-A");
    git("commit", "-q", "-m", "change");

    const out = execFileSync("bash", [script, "HEAD~1...HEAD"], { cwd: dir, encoding: "utf8" });
    expect(out).toBe("a.txt 2 8\na.txt 27 30\nnew.txt 1 2\n");
  });
});
