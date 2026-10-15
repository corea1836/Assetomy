import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// .claude/skills/review-code/post.sh를 가짜 gh(PATH 앞)로 돌려, 게시 요청과 인라인 코멘트 수 확인만 본다.
const script = fileURLToPath(new URL("../skills/review-code/post.sh", import.meta.url));

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "review-post-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, ".review-tmp"));
  // 실제 gh처럼 POST면 보낸 본문(stdin)을 posted.json에 남기고 --jq '.id, .html_url' 결과를 두 줄로,
  // 그 밖(코멘트 목록)이면 FAKE_COUNT를 출력한다.
  writeFileSync(
    join(dir, "bin/gh"),
    '#!/usr/bin/env bash\necho "$*" >> calls.txt\n' +
      'if [[ " $* " == *" --method POST "* ]]; then cat > posted.json; printf \'777\\nhttps://github.com/o/r/pull/4#pullrequestreview-777\\n\'; else echo "$FAKE_COUNT"; fi\n',
  );
  chmodSync(join(dir, "bin/gh"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// count는 페이지별 코멘트 수다(예: "30\n5"면 두 페이지).
function run(args: string[], comments: number, count: number | string, event = "COMMENT") {
  writeFileSync(join(dir, ".review-tmp/review.json"), JSON.stringify({ event, body: "요약", comments: Array(comments).fill({}) }));
  const r = spawnSync("bash", [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, FAKE_COUNT: String(count) },
  });
  const calls = existsSync(join(dir, "calls.txt")) ? readFileSync(join(dir, "calls.txt"), "utf8").trim().split("\n") : [];
  return { ...r, calls };
}

describe("review-code post.sh", () => {
  it("review.json을 그 PR 리뷰로 게시하고, 인라인 수가 맞으면 리뷰 링크를 출력한다", () => {
    const r = run(["4"], 2, 2);
    expect(r.status).toBe(0);
    expect(r.calls[0]).toBe("api --method POST repos/{owner}/{repo}/pulls/4/reviews --input - --jq .id, .html_url");
    expect(r.calls[1]).toBe("api --paginate repos/{owner}/{repo}/pulls/4/reviews/777/comments --jq length");
    expect(r.stdout.trim()).toBe("https://github.com/o/r/pull/4#pullrequestreview-777");
  });

  it("review.json의 event가 무엇이든 COMMENT로 게시한다(승인·변경 요청 리뷰를 달지 못하게)", () => {
    for (const event of ["APPROVE", "REQUEST_CHANGES"]) {
      expect(run(["4"], 1, 1, event).status).toBe(0);
      const posted = JSON.parse(readFileSync(join(dir, "posted.json"), "utf8"));
      expect(posted).toMatchObject({ event: "COMMENT", body: "요약" });
    }
  });

  it("인라인 코멘트가 여러 페이지면 모두 더해서 확인한다(기본 30개씩 잘림)", () => {
    expect(run(["4"], 35, "30\n5").status).toBe(0);
  });

  it("게시된 인라인 수가 review.json과 다르면 실패한다", () => {
    const r = run(["4"], 3, 1);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("1/3");
  });

  it("PR 번호가 숫자가 아니면 gh를 부르지 않고 2로 끝난다", () => {
    for (const args of [[], ["4; rm"], ["../1"]]) {
      const r = run(args, 0, 0);
      expect(r.status).toBe(2);
      expect(r.calls).toEqual([]);
    }
  });
});
