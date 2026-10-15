import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scripts/review-code.sh를 가짜 claude(PATH 앞)로 돌려, 넘기는 인자와 판정 → 종료 코드 변환만 확인한다.
const script = fileURLToPath(new URL("./review-code.sh", import.meta.url));

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "review-code-sh-"));
  writeFileSync(
    join(dir, "claude"),
    '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$FAKE_ARGS"\ncat "$FAKE_OUT"\nexit "${FAKE_CODE:-0}"\n',
  );
  chmodSync(join(dir, "claude"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], output: unknown, code = 0) {
  writeFileSync(join(dir, "out.json"), typeof output === "string" ? output : JSON.stringify(output));
  const r = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_ARGS: join(dir, "args.txt"),
      FAKE_OUT: join(dir, "out.json"),
      FAKE_CODE: String(code),
    },
  });
  const called = existsSync(join(dir, "args.txt"));
  return { ...r, called, claudeArgs: called ? readFileSync(join(dir, "args.txt"), "utf8").split("\n") : [] };
}

const result = (verdict: string, extra: object = {}) => ({
  result: "",
  structured_output: { verdict, report: `### PR 전체 요약\n\n**판정: ${verdict}**` },
  ...extra,
});
const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("review-code.sh", () => {
  it("staged 모드는 /review-code --staged를 훅 없이 실행하고, diff는 쓰게 하되 게시 도구는 허용하지 않는다", () => {
    const r = run(["staged"], result("Approve"));
    expect(r.status).toBe(0);
    expect(r.claudeArgs).toContain("-p");
    expect(r.claudeArgs).toContain("/review-code --staged");
    expect(JSON.parse(argAfter(r.claudeArgs, "--settings"))).toEqual({ disableAllHooks: true });
    expect(argAfter(r.claudeArgs, "--permission-mode")).toBe("dontAsk");
    expect(argAfter(r.claudeArgs, "--allowedTools")).toContain("Workflow");
    // .claude/ 아래는 보호 경로라 허용 규칙을 줘도 headless에서 쓰기가 거부된다.
    expect(argAfter(r.claudeArgs, "--allowedTools")).toContain("Edit(./.review-tmp/**)");
    expect(argAfter(r.claudeArgs, "--allowedTools")).not.toContain(".claude/review-tmp");
    expect(argAfter(r.claudeArgs, "--allowedTools")).not.toContain("gh api");
    expect(r.stdout).toContain("**판정: Approve**");
  });

  it("pr 모드는 /review-code --pr <번호> --post를 실행하고 게시 도구를 허용한다", () => {
    const r = run(["pr", "12"], result("Approve"));
    expect(r.status).toBe(0);
    expect(r.claudeArgs).toContain("/review-code --pr 12 --post");
    expect(argAfter(r.claudeArgs, "--allowedTools")).toContain("Bash(gh api *)");
  });

  it("판정 스키마는 verdict·report를 요구한다", () => {
    const r = run(["staged"], result("Approve"));
    const schema = JSON.parse(argAfter(r.claudeArgs, "--json-schema"));
    expect(schema.required).toEqual(["verdict", "report"]);
    expect(schema.properties.verdict.enum).toEqual(["Approve", "Changes Requested", "Blocked", "Error", "Pending"]);
  });

  it.each(["Changes Requested", "Blocked"])("판정이 %s면 1로 끝나고 report를 출력한다", (verdict) => {
    const r = run(["staged"], result(verdict));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`**판정: ${verdict}**`);
  });

  it.each(["Error", "Pending"])("판정이 %s면 2로 끝나고 report를 출력한다", (verdict) => {
    const r = run(["pr", "3"], result(verdict));
    expect(r.status).toBe(2);
    expect(r.stdout).toContain(`**판정: ${verdict}**`);
  });

  it("claude가 실패하거나 structured_output이 없으면 2로 끝난다", () => {
    expect(run(["staged"], { result: "Not logged in" }, 1).status).toBe(2);
    expect(run(["staged"], { result: "끝" }).status).toBe(2);
    expect(run(["staged"], "not json").status).toBe(2);
  });

  it("거부된 도구가 있으면 이름만 stderr에 남긴다", () => {
    const r = run(["staged"], result("Approve", {
      permission_denials: [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "secret-cmd" } }],
    }));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("Bash");
    expect(r.stderr).not.toContain("secret-cmd");
  });

  it("모드가 없거나 PR 번호가 숫자가 아니면 claude를 부르지 않고 2로 끝난다", () => {
    for (const args of [[], ["pr"], ["pr", "12; rm"], ["main...HEAD"]]) {
      const r = run(args, result("Approve"));
      expect(r.status).toBe(2);
      expect(r.called).toBe(false);
    }
  });
});
