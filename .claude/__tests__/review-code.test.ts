import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// .claude/workflows/review-code.js를 workflow 런타임 대신 가짜 agent·pipeline·parallel로 돌려 판정 로직만 확인한다.
const source = readFileSync(fileURLToPath(new URL("../workflows/review-code.js", import.meta.url)), "utf8");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...params: string[]
) => (...args: unknown[]) => Promise<unknown>;
const workflow = new AsyncFunction(
  "args", "agent", "pipeline", "parallel", "phase", "log",
  source.replace("export const meta", "const meta"),
);

type Opts = { agentType?: string; label?: string; prompt?: string };
type Item = { severity: string; file: string; line: number; fix: string; dimensions: string[] };
type Result = {
  confirmed: Item[]; unverified: Item[]; unsure: Item[]; rejected: Item[];
  strengths: unknown[]; failedDimensions: string[];
};

async function parallel(thunks: Array<() => Promise<unknown>>) {
  return Promise.all(thunks.map((thunk) => thunk().catch(() => null)));
}

async function pipeline(items: unknown[], ...stages: Array<(prev: unknown, item: unknown, i: number) => unknown>) {
  return Promise.all(items.map(async (item, i) => {
    let result: unknown = item;
    for (const stage of stages) {
      try { result = await stage(result, item, i); } catch { return null; }
    }
    return result;
  }));
}

const args = { range: "main...HEAD", diffPath: ".claude/review-tmp/diff.patch", files: ["M\tsrc/a.ts"], untracked: [], docs: [] };
const finding = (over: Partial<Item> = {}) => ({
  severity: "major", file: "src/a.ts", line: 10, title: "제목", tldr: "요약", good: "기준", fix: "fix()",
  rule: "CLAUDE.md", scenario: "입력 → 결과", ...over,
});
const vote = (v: string, over: object = {}) => ({ vote: v, evidence: ["src/a.ts:10"], reason: v, ...over });

// reviews: 차원 → 리뷰 결과(null이면 실패), votes: skeptic 번호(1~3) → 표
function run(reviews: Record<string, unknown>, votes: (n: number) => unknown = () => vote("upheld")) {
  const calls: Opts[] = [];
  const agent = async (prompt: string, opts: Opts) => {
    calls.push({ ...opts, prompt });
    if (opts.agentType === "review-skeptic") return votes(Number(opts.label?.match(/#(\d)$/)?.[1]));
    const dimension = opts.agentType?.replace("review-", "") ?? "";
    return dimension in reviews ? reviews[dimension] : { findings: [], strengths: [] };
  };
  const result = workflow(args, agent, pipeline, parallel, () => {}, () => {}) as Promise<Result>;
  return { calls, result };
}

describe("review-code workflow", () => {
  it("diff 없이 직접 실행되면 스킬로 실행하라고 안내한다", async () => {
    await expect(workflow(undefined, null, pipeline, parallel, () => {}, () => {})).resolves.toMatch(/스킬로 실행/);
  });

  it("차원마다 review-<차원>을 부르고, nit이 아닌 지적마다 skeptic 3명을 부른다", async () => {
    const { calls, result } = run({ correctness: { findings: [finding(), finding({ severity: "nit", line: 20 })], strengths: [] } });
    await result;
    expect(calls.filter((c) => c.agentType !== "review-skeptic").map((c) => c.agentType).sort())
      .toEqual(["review-architecture", "review-correctness", "review-security"]);
    expect(calls.filter((c) => c.agentType === "review-skeptic")).toHaveLength(3);
  });

  it("리뷰어와 skeptic 프롬프트 모두 문장을 한국어로 쓰라고 지시한다", async () => {
    const { calls, result } = run({ correctness: { findings: [finding()], strengths: [] } });
    await result;
    expect(calls).toHaveLength(6);
    for (const call of calls) expect(call.prompt).toContain("한국어로 쓴다");
  });

  it("refuted가 2표 이상이면 거짓 양성으로 기각한다", async () => {
    const { result } = run({ correctness: { findings: [finding()], strengths: [] } }, (n) => vote(n === 1 ? "upheld" : "refuted"));
    const out = await result;
    expect(out.confirmed).toHaveLength(0);
    expect(out.rejected).toHaveLength(1);
  });

  it("upheld가 2표 이상이면 confirmed이고, 심각도는 upheld 표 중 가장 높은 것, Fix는 upheld 표가 고친 것을 쓴다", async () => {
    const { result } = run({ security: { findings: [finding({ severity: "critical" })], strengths: [] } }, (n) =>
      n === 1 ? vote("upheld", { severity: "minor", fix: "fixed()" }) : n === 2 ? vote("upheld", { severity: "major" }) : vote("refuted"));
    const [item] = (await result).confirmed;
    expect(item).toMatchObject({ severity: "major", fix: "fixed()", dimensions: ["security"] });
  });

  it("심각도를 제안하지 않은 upheld 표는 리뷰어의 심각도에 동의한 것으로 본다", async () => {
    const { result } = run({ security: { findings: [finding({ severity: "critical" })], strengths: [] } }, (n) =>
      n === 1 ? vote("upheld") : vote("upheld", { severity: "minor" }));
    expect((await result).confirmed[0].severity).toBe("critical");
  });

  it("근거를 인용하지 않은 표와 실패한 표는 unsure로 센다", async () => {
    const { result } = run({ correctness: { findings: [finding()], strengths: [] } }, (n) =>
      n === 1 ? vote("upheld") : n === 2 ? vote("upheld", { evidence: [] }) : null);
    const out = await result;
    expect(out.confirmed).toHaveLength(0);
    expect(out.unsure).toHaveLength(1);
  });

  it("nit은 검증하지 않고 unverified로 둔다", async () => {
    const { result } = run({ architecture: { findings: [finding({ severity: "nit" })], strengths: [] } }, () => vote("refuted"));
    const out = await result;
    expect(out.unverified).toHaveLength(1);
    expect(out.rejected).toHaveLength(0);
  });

  it("같은 file:line 지적은 차원을 합쳐 한 건으로 만들고 높은 심각도를 따른다", async () => {
    const { result } = run({
      correctness: { findings: [finding({ severity: "minor" })], strengths: [] },
      security: { findings: [finding({ severity: "critical" })], strengths: [{ text: "requireUser를 먼저 부른다" }] },
    });
    const out = await result;
    expect(out.confirmed).toHaveLength(1);
    expect(out.confirmed[0].severity).toBe("critical");
    expect([...out.confirmed[0].dimensions].sort()).toEqual(["correctness", "security"]);
    expect(out.strengths).toEqual([{ text: "requireUser를 먼저 부른다", dimension: "security" }]);
  });

  it("리뷰 에이전트가 실패한 차원은 failedDimensions에 남긴다", async () => {
    const { result } = run({ security: null });
    expect((await result).failedDimensions).toEqual(["security"]);
  });
});
