import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// .claude/skills/review-code/post.sh를 가짜 gh(PATH 앞)로 돌려, 요약 코멘트·인라인 리뷰 게시 요청만 본다.
const script = fileURLToPath(new URL("../skills/review-code/post.sh", import.meta.url));
const MARKER = "<!-- review-code:summary -->";

// 가짜 gh: 요청 종류마다 보낸 본문(stdin)을 파일에 남기고 실제 gh의 --jq 결과처럼 출력한다.
// FAKE_STICKY는 이미 있는 요약 코멘트 id 목록, FAKE_COUNT는 페이지별 인라인 코멘트 수다.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> calls.txt
case "$*" in
  *"--method PATCH"*) cat > patched.json; echo "https://github.com/o/r/pull/4#issuecomment-55" ;;
  *"--method POST"*"/issues/"*) cat > summary.json; echo "https://github.com/o/r/pull/4#issuecomment-99" ;;
  *"--method POST"*"/reviews"*) cat > review-posted.json; echo 777 ;;
  *"/issues/"*"/comments"*) printf '%b' "$FAKE_STICKY" ;;
  *) printf '%b\\n' "$FAKE_COUNT" ;;
esac
`;

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "review-post-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, ".review-tmp"));
  writeFileSync(join(dir, "bin/gh"), FAKE_GH);
  chmodSync(join(dir, "bin/gh"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Opts = { comments?: number; count?: number | string; sticky?: string; event?: string };
function run(args: string[], { comments = 0, count = comments, sticky = "", event = "COMMENT" }: Opts = {}) {
  writeFileSync(
    join(dir, ".review-tmp/review.json"),
    JSON.stringify({ commit_id: "abc1234def", event, body: "요약", comments: Array(comments).fill({ path: "a.ts", line: 1 }) }),
  );
  const r = spawnSync("bash", [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, FAKE_COUNT: String(count), FAKE_STICKY: sticky },
  });
  const calls = existsSync(join(dir, "calls.txt")) ? readFileSync(join(dir, "calls.txt"), "utf8").trim().split("\n") : [];
  const read = (name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  return { ...r, calls, read };
}

describe("review-code post.sh", () => {
  it("요약 코멘트가 없으면 새로 달고, 표식과 리뷰한 커밋을 붙인다", () => {
    const r = run(["4"]);
    expect(r.status).toBe(0);
    expect(r.calls).toContain("api --method POST repos/{owner}/{repo}/issues/4/comments --input - --jq .html_url");
    const { body } = r.read("summary.json");
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("요약");
    expect(body).toContain("마지막 리뷰: `abc1234`");
    expect(r.stdout.trim()).toBe("https://github.com/o/r/pull/4#issuecomment-99");
  });

  it("요약 코멘트가 이미 있으면 새로 달지 않고 그 코멘트를 고쳐 쓴다", () => {
    const r = run(["4"], { sticky: "55\n" });
    expect(r.status).toBe(0);
    expect(r.calls).toContain("api --method PATCH repos/{owner}/{repo}/issues/comments/55 --input - --jq .html_url");
    expect(r.calls.some((c) => c.includes("--method POST") && c.includes("/issues/"))).toBe(false);
    expect(r.read("patched.json").body.startsWith(MARKER)).toBe(true);
    expect(r.stdout.trim()).toBe("https://github.com/o/r/pull/4#issuecomment-55");
  });

  it("인라인 지적은 COMMENT 리뷰로 달고, 리뷰 본문에는 요약 링크만 둔다(event가 무엇이든)", () => {
    for (const event of ["APPROVE", "REQUEST_CHANGES"]) {
      const r = run(["4"], { comments: 2, event });
      expect(r.status).toBe(0);
      const review = r.read("review-posted.json");
      expect(review.event).toBe("COMMENT");
      expect(review.body).toContain("https://github.com/o/r/pull/4#issuecomment-99");
      expect(review.body).not.toContain("요약\n");
      expect(review.comments).toHaveLength(2);
      expect(r.calls).toContain("api --paginate repos/{owner}/{repo}/pulls/4/reviews/777/comments --jq length");
    }
  });

  it("인라인 지적이 없으면 리뷰를 달지 않는다", () => {
    const r = run(["4"], { comments: 0 });
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.includes("/reviews"))).toBe(false);
  });

  it("인라인 코멘트가 여러 페이지면 모두 더해서 확인한다(기본 30개씩 잘림)", () => {
    expect(run(["4"], { comments: 35, count: "30\n5" }).status).toBe(0);
  });

  it("게시된 인라인 수가 review.json과 다르면 실패한다", () => {
    const r = run(["4"], { comments: 3, count: 1 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("1/3");
  });

  it("PR 번호가 숫자가 아니면 gh를 부르지 않고 2로 끝난다", () => {
    for (const args of [[], ["4; rm"], ["../1"]]) {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(r.calls).toEqual([]);
    }
  });
});
